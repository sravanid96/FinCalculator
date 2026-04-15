import { Router, Request, Response } from "express";
import {
  getStockQuote,
  getHistoricalPrices,
  getOptionsChain,
  searchTickers,
  getMostActiveTickers,
  getOptionsChainTargeted,
} from "./services/yahooFinance";
import { calculatePL } from "./services/optionsCalculator";
import { calculateSupportResistance } from "./services/supportResistance";
import { getUpcomingEarnings } from "./services/earningsService";
import { generateTradeIdeas, generateStrategyComparison } from "./services/tradeIdeaGenerator";
import { generateFrameworkAnalysis, calculateRSI } from "./services/frameworkAnalysis";
import { plCalculationSchema, DEFAULT_TRADE_CONFIG } from "../shared/optionsSchema";
import type { TickerAnalysis, TopOptionTradeIdea, TradeIdea, OptionsChain } from "../shared/optionsSchema";

const router = Router();

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

async function asyncPool<T, R>(
  poolLimit: number,
  items: T[],
  iteratorFn: (item: T, idx: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = [];
  let nextIndex = 0;

  const workerCount = Math.max(1, Math.min(poolLimit, items.length));
  const workers = Array.from({ length: workerCount }, async () => {
    while (true) {
      const idx = nextIndex++;
      if (idx >= items.length) return;

      try {
        const r = await iteratorFn(items[idx], idx);
        results.push(r);
      } catch {
        // Ignore individual failures; we only return successful results.
      }
    }
  });

  await Promise.all(workers);
  return results;
}

function pickBestCreditIdea(ideas: TradeIdea[]): TradeIdea | null {
  const allowed = new Set(["put_credit_spread", "call_credit_spread", "iron_condor"]);
  const filtered = ideas.filter((i) => allowed.has(i.strategy));
  if (filtered.length === 0) return null;

  // Prefer higher POP, then better risk/reward.
  const sorted = [...filtered];
  sorted.sort((a, b) => {
    if (b.probabilityOfProfit !== a.probabilityOfProfit) {
      return b.probabilityOfProfit - a.probabilityOfProfit;
    }
    return b.riskRewardRatio - a.riskRewardRatio;
  });
  return sorted[0];
}

function computeIdeaLiquidityScore(chain: OptionsChain, idea: TradeIdea): number {
  const exp = chain.expirations.find((e) => e.expirationDate === idea.expirationDate);
  if (!exp) return 0;

  const lookup = (leg: TradeIdea["legs"][number]) => {
    const list = leg.type === "call" ? exp.calls : exp.puts;
    return list.find((o) => o.strike === leg.strike);
  };

  const legs = idea.legs.map(lookup).filter(Boolean) as any[];
  if (legs.length === 0) return 0;

  // Heuristic: log-scaled OI+volume around the chosen strikes.
  const raw = legs.reduce((sum, o) => sum + Math.log1p((o.openInterest || 0) + (o.volume || 0)), 0);
  // Normalize to ~0-100 with a soft cap.
  return Math.round(100 * clamp01(raw / 12));
}

function computeOverallScore(idea: TradeIdea, liquidityScore: number): number {
  const pop = clamp01(idea.probabilityOfProfit / 100);
  const rr = clamp01(idea.riskRewardRatio / 1);
  const liq = clamp01(liquidityScore / 100);

  const dteFit = clamp01(1 - Math.abs(idea.daysToExpiration - DEFAULT_TRADE_CONFIG.targetDTE) / 45);

  // Conviction: POP + Liquidity dominate; RR helps; DTE close to target gets a bump.
  return Math.round((pop * 0.55 + liq * 0.25 + rr * 0.1 + dteFit * 0.1) * 100);
}

async function getRSIWithFallback(symbol: string, primaryMonths: number, fallbackMonths: number): Promise<number | null> {
  try {
    const primary = await getHistoricalPrices(symbol, primaryMonths);
    const primaryCloses = primary.map((p) => p.close);
    const rsiPrimary = calculateRSI(primaryCloses, 14);
    if (rsiPrimary !== null) return rsiPrimary;

    const fallback = await getHistoricalPrices(symbol, fallbackMonths);
    const fallbackCloses = fallback.map((p) => p.close);
    return calculateRSI(fallbackCloses, 14);
  } catch {
    return null;
  }
}

function buildRSIAnalysisForTopIdeas(
  rsi: number,
  strategy: TradeIdea["strategy"]
): { value: number; zone: "overbought" | "oversold" | "neutral"; confidenceBoost: number; signal: string } {
  const zone = rsi >= 70 ? "overbought" : rsi <= 30 ? "oversold" : "neutral";

  // Keep consistent with tradeIdeaGenerator.ts behavior (simplified but aligned)
  const bullish = new Set<TradeIdea["strategy"]>(["put_credit_spread", "long_call", "cash_secured_put", "covered_call"]);
  const bearish = new Set<TradeIdea["strategy"]>(["call_credit_spread", "long_put"]);
  const neutral = new Set<TradeIdea["strategy"]>(["iron_condor", "iron_butterfly", "straddle", "strangle"]);

  let confidenceBoost = 0;
  let signal = `RSI ${rsi.toFixed(1)} neutral`;

  if (bullish.has(strategy)) {
    if (zone === "oversold") {
      confidenceBoost = 15;
      signal = `RSI ${rsi.toFixed(1)} oversold - bullish bias`;
    } else if (zone === "overbought") {
      confidenceBoost = -10;
      signal = `RSI ${rsi.toFixed(1)} overbought - caution for bullish plays`;
    } else {
      signal = `RSI ${rsi.toFixed(1)} neutral - standard bullish conditions`;
    }
  } else if (bearish.has(strategy)) {
    if (zone === "overbought") {
      confidenceBoost = 15;
      signal = `RSI ${rsi.toFixed(1)} overbought - bearish bias`;
    } else if (zone === "oversold") {
      confidenceBoost = -10;
      signal = `RSI ${rsi.toFixed(1)} oversold - caution for bearish plays`;
    } else {
      signal = `RSI ${rsi.toFixed(1)} neutral - standard bearish conditions`;
    }
  } else if (neutral.has(strategy)) {
    if (zone === "neutral") {
      confidenceBoost = 10;
      signal = `RSI ${rsi.toFixed(1)} neutral - good for range strategies`;
    } else {
      confidenceBoost = -5;
      signal = `RSI ${rsi.toFixed(1)} at extreme - range strategies riskier`;
    }
  }

  return { value: rsi, zone, confidenceBoost, signal };
}

// Top 20 "most active" + best credit idea per symbol
router.get("/top-ideas", async (req: Request, res: Response) => {
  try {
    const limit = Math.min(Number.parseInt((req.query.limit as string) || "20", 10) || 20, 50);
    const universeSize = Math.min(
      Number.parseInt((req.query.universe as string) || "120", 10) || 120,
      120
    );
    const minPop = Math.max(
      40,
      Math.min(Number.parseInt((req.query.minPop as string) || "55", 10) || 55, 85)
    );
    const minLiq = Math.max(
      0,
      Math.min(Number.parseInt((req.query.minLiq as string) || "15", 10) || 15, 100)
    );
    const allowEarnings = (req.query.allowEarnings as string) === "true";

    const mostActive = await getMostActiveTickers(universeSize);
    if (!mostActive.length) return res.json([]);

    const stats = {
      universe: mostActive.length,
      withOptions: 0,
      withIdeas: 0,
      filteredPop: 0,
      filteredEarnings: 0,
      filteredLiquidity: 0,
      errors: 0,
    };

    const rows = await asyncPool(10, mostActive, async (t) => {
      const symbol = t.symbol.toUpperCase();

      try {
        const quote = await getStockQuote(symbol);
        const [chain, earnings] = await Promise.all([
          getOptionsChainTargeted(symbol, DEFAULT_TRADE_CONFIG.targetDTE, 1),
          getUpcomingEarnings(symbol),
        ]);

        // Require options expirations to exist.
        if (!chain.expirations?.length) return null;
        stats.withOptions += 1;

        // Generate ideas without RSI first (avoid 120x historical calls -> throttling)
        const ideas = generateTradeIdeas(chain, earnings, DEFAULT_TRADE_CONFIG, null);
        const best = pickBestCreditIdea(ideas);
        if (!best) return null;
        stats.withIdeas += 1;

        // Filters (tunable). Earnings risk can be allowed but penalized.
        if (best.probabilityOfProfit < minPop) {
          stats.filteredPop += 1;
          return null;
        }
        if (best.hasEarningsRisk && !allowEarnings) {
          stats.filteredEarnings += 1;
          return null;
        }

        const liquidityScore = computeIdeaLiquidityScore(chain, best);
        if (liquidityScore < minLiq) {
          stats.filteredLiquidity += 1;
          return null;
        }

        const reasons: string[] = [
          `POP ${best.probabilityOfProfit.toFixed(0)}%`,
          `Liquidity ${liquidityScore}/100`,
          `${best.daysToExpiration} DTE`,
          `R:R ${best.riskRewardRatio.toFixed(2)}`,
        ];

        let score = computeOverallScore(best, liquidityScore);
        if (best.hasEarningsRisk) {
          score = Math.max(0, score - 20);
          reasons.push("Earnings risk");
        }

        const row: TopOptionTradeIdea = {
          symbol: quote.symbol,
          name: quote.name,
          price: quote.price,
          changePercent: quote.changePercent,
          volume: quote.volume,
          updatedAt: new Date().toISOString(),
          idea: best,
          score,
          liquidityScore,
          reasons,
        };
        return row;
      } catch {
        stats.errors += 1;
        return null;
      }
    });

    const top = (rows.filter(Boolean) as TopOptionTradeIdea[])
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    if ((req.query.debug as string) === "true") {
      return res.json({ stats, items: top });
    }

    // Attach RSI only for the final returned list to avoid Yahoo throttling.
    await Promise.all(
      top.map(async (row) => {
        const rsi = await getRSIWithFallback(row.symbol, 6, 12);
        if (rsi === null) return;

        (row.idea as any).rsiAnalysis = buildRSIAnalysisForTopIdeas(rsi, row.idea.strategy);

        if ((row.idea as any).rsiAnalysis?.zone && (row.idea as any).rsiAnalysis.zone !== "neutral") {
          const zoneLabel =
            (row.idea as any).rsiAnalysis.zone === "overbought" ? "Overbought" : "Oversold";
          row.reasons.push(`RSI ${(row.idea as any).rsiAnalysis.value.toFixed(0)} (${zoneLabel})`);
        }

        // Apply RSI confidence boost to overall score (small bump).
        const boost = (row.idea as any).rsiAnalysis?.confidenceBoost ?? 0;
        row.score = Math.max(0, Math.min(100, row.score + Math.round(boost / 2)));
      })
    );

    res.json(top);
  } catch (error) {
    console.error("Error building top ideas:", error);
    res.status(500).json({ error: "Failed to fetch top ideas" });
  }
});

// Search for tickers
router.get("/search", async (req: Request, res: Response) => {
  try {
    const query = req.query.q as string;
    if (!query) {
      return res.json([]);
    }
    const results = await searchTickers(query);
    res.json(results);
  } catch (error) {
    console.error("Error searching tickers:", error);
    res.status(500).json({ error: "Failed to search tickers" });
  }
});

// Get stock quote
router.get("/quote/:ticker", async (req: Request, res: Response) => {
  try {
    const { ticker } = req.params;
    const quote = await getStockQuote(ticker.toUpperCase());
    res.json(quote);
  } catch (error) {
    console.error(`Error fetching quote for ${req.params.ticker}:`, error);
    res.status(500).json({ error: "Failed to fetch stock quote" });
  }
});

// Get options chain
router.get("/chain/:ticker", async (req: Request, res: Response) => {
  try {
    const { ticker } = req.params;
    const chain = await getOptionsChain(ticker.toUpperCase());
    res.json(chain);
  } catch (error) {
    console.error(`Error fetching options chain for ${req.params.ticker}:`, error);
    res.status(500).json({ error: "Failed to fetch options chain" });
  }
});

// Get historical prices
router.get("/historical/:ticker", async (req: Request, res: Response) => {
  try {
    const { ticker } = req.params;
    const months = Number.parseInt(req.query.months as string, 10) || 6;
    const prices = await getHistoricalPrices(ticker.toUpperCase(), months);
    res.json(prices);
  } catch (error) {
    console.error(`Error fetching historical data for ${req.params.ticker}:`, error);
    res.status(500).json({ error: "Failed to fetch historical data" });
  }
});

// Get support/resistance levels
router.get("/support-resistance/:ticker", async (req: Request, res: Response) => {
  try {
    const { ticker } = req.params;
    const [prices, quote] = await Promise.all([
      getHistoricalPrices(ticker.toUpperCase(), 6),
      getStockQuote(ticker.toUpperCase()),
    ]);

    const levels = calculateSupportResistance(prices, quote.price);
    res.json({ levels, currentPrice: quote.price, historicalPrices: prices });
  } catch (error) {
    console.error(`Error calculating S/R for ${req.params.ticker}:`, error);
    res.status(500).json({ error: "Failed to calculate support/resistance" });
  }
});

// Get upcoming earnings
router.get("/earnings/:ticker", async (req: Request, res: Response) => {
  try {
    const { ticker } = req.params;
    const earnings = await getUpcomingEarnings(ticker.toUpperCase());
    res.json(earnings);
  } catch (error) {
    console.error(`Error fetching earnings for ${req.params.ticker}:`, error);
    res.status(500).json({ error: "Failed to fetch earnings data" });
  }
});

// Calculate P&L for a trade
router.post("/calculate", async (req: Request, res: Response) => {
  try {
    const validation = plCalculationSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({ error: validation.error.issues });
    }

    const { legs, underlyingPrice, priceRange, daysToExpiration } = validation.data;
    const result = calculatePL(legs, underlyingPrice, priceRange, daysToExpiration);
    res.json(result);
  } catch (error) {
    console.error("Error calculating P&L:", error);
    res.status(500).json({ error: "Failed to calculate P&L" });
  }
});

// Generate trade ideas for a ticker
router.get("/trade-ideas/:ticker", async (req: Request, res: Response) => {
  try {
    const { ticker } = req.params;
    const upperTicker = ticker.toUpperCase();

    const [chain, earnings] = await Promise.all([
      getOptionsChain(upperTicker),
      getUpcomingEarnings(upperTicker),
    ]);

    const ideas = generateTradeIdeas(chain, earnings, DEFAULT_TRADE_CONFIG);
    res.json(ideas);
  } catch (error) {
    console.error(`Error generating trade ideas for ${req.params.ticker}:`, error);
    res.status(500).json({ error: "Failed to generate trade ideas" });
  }
});

// Compare strategies for a ticker
router.get("/strategies/:ticker", async (req: Request, res: Response) => {
  try {
    const { ticker } = req.params;
    const upperTicker = ticker.toUpperCase();

    const [chain, earnings, quote] = await Promise.all([
      getOptionsChain(upperTicker),
      getUpcomingEarnings(upperTicker),
      getStockQuote(upperTicker),
    ]);

    const comparisons = generateStrategyComparison(chain, earnings, quote);
    res.json(comparisons);
  } catch (error) {
    console.error(`Error comparing strategies for ${req.params.ticker}:`, error);
    res.status(500).json({ error: "Failed to compare strategies" });
  }
});

// Full analysis for a ticker (combines all data)
router.get("/analysis/:ticker", async (req: Request, res: Response) => {
  try {
    const { ticker } = req.params;
    const upperTicker = ticker.toUpperCase();

    // Fetch all data in parallel
    const [quote, chain, historicalPrices, earnings] = await Promise.all([
      getStockQuote(upperTicker),
      getOptionsChain(upperTicker),
      getHistoricalPrices(upperTicker, 6),
      getUpcomingEarnings(upperTicker),
    ]);

    // Calculate support/resistance
    const supportResistance = calculateSupportResistance(historicalPrices, quote.price);

    // Calculate RSI for confidence boost in trade ideas (fallback to more history)
    const closes = historicalPrices.map((p) => p.close);
    let rsi = calculateRSI(closes, 14);
    if (rsi === null) {
      rsi = await getRSIWithFallback(upperTicker, 12, 24);
    }

    // Generate trade ideas with RSI-based confidence boost
    const tradeIdeas = generateTradeIdeas(chain, earnings, DEFAULT_TRADE_CONFIG, rsi);
    const strategyComparisons = generateStrategyComparison(chain, earnings, quote);

    // Generate framework analysis with auto-calculated checks and scores
    const frameworkAnalysis = await generateFrameworkAnalysis(
      quote,
      historicalPrices,
      chain,
      supportResistance,
      earnings,
      tradeIdeas
    );

    const analysis: TickerAnalysis = {
      quote,
      optionsChain: chain,
      supportResistance,
      upcomingEarnings: earnings,
      tradeIdeas,
      strategyComparisons,
      frameworkAnalysis,
    };

    res.json(analysis);
  } catch (error) {
    console.error(`Error analyzing ${req.params.ticker}:`, error);
    res.status(500).json({ error: "Failed to analyze ticker", details: (error as Error).message });
  }
});

export default router;
