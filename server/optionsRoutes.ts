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
import {
  backtestSymbols,
  backtestSymbol,
  DEFAULT_BACKTEST_CONFIG,
  METHODOLOGY_NOTES,
} from "./services/backtestEngine";
import { plCalculationSchema, DEFAULT_TRADE_CONFIG } from "../shared/optionsSchema";
import type {
  TickerAnalysis,
  TopOptionTradeIdea,
  TradeIdea,
  OptionsChain,
  BacktestConfig,
  OptionStrategy,
  BacktestTop20Response,
} from "../shared/optionsSchema";

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

// ============================================================================
// Backtest endpoints
// ============================================================================

// In-memory cache for backtest results (expensive to compute).
// Key is JSON of { symbols, cfg, years }. TTL is long (24h) since historical data
// doesn't change intraday.
const BACKTEST_CACHE_TTL = 24 * 60 * 60 * 1000;
const backtestCache = new Map<string, { data: any; timestamp: number }>();

function getBacktestCached<T>(key: string): T | null {
  const c = backtestCache.get(key);
  if (c && Date.now() - c.timestamp < BACKTEST_CACHE_TTL) return c.data as T;
  return null;
}

function setBacktestCached(key: string, data: any): void {
  backtestCache.set(key, { data, timestamp: Date.now() });
}

/** Parse + validate strategy query. Allow-list to what the engine supports. */
function parseStrategy(q: unknown): OptionStrategy {
  const allowed = new Set(["put_credit_spread", "call_credit_spread", "iron_condor"]);
  if (typeof q === "string" && allowed.has(q)) return q as OptionStrategy;
  return "put_credit_spread";
}

function buildConfigFromQuery(req: Request): BacktestConfig {
  return {
    strategy: parseStrategy(req.query.strategy),
    dte: Math.max(
      14,
      Math.min(Number.parseInt((req.query.dte as string) || "45", 10) || 45, 90)
    ),
    targetDelta: Math.max(
      10,
      Math.min(Number.parseInt((req.query.delta as string) || "30", 10) || 30, 45)
    ),
    spreadWidth: Math.max(
      1,
      Math.min(Number.parseFloat((req.query.width as string) || "5") || 5, 25)
    ),
    takeProfitPct: Math.max(
      20,
      Math.min(Number.parseInt((req.query.tp as string) || "50", 10) || 50, 90)
    ),
    stopLossMult: DEFAULT_BACKTEST_CONFIG.stopLossMult,
    entryFrequencyDays: Math.max(
      1,
      Math.min(Number.parseInt((req.query.freq as string) || "5", 10) || 5, 30)
    ),
  };
}

function emptyBacktestResponse(
  cfg: BacktestConfig,
  years: number,
  extraNotes: string[] = []
): BacktestTop20Response {
  return {
    generatedAt: new Date().toISOString(),
    yearsTested: years,
    config: cfg,
    results: [],
    summary: {
      totalTrades: 0,
      aggregateWinRate: 0,
      aggregateAvgPnl: 0,
      aggregateTotalPnl: 0,
      symbolsWithPositiveEdge: 0,
      symbolsWithNegativeEdge: 0,
      benchmarkSpyReturnPct: null,
    },
    methodology: [...extraNotes, ...METHODOLOGY_NOTES],
  };
}

// Backtest across the top-N most-active universe OR a custom list of symbols.
// Design note: this endpoint is "best-effort" — individual symbol failures never
// cause the whole response to 500. Transient Yahoo validation errors, rate
// limits, or network blips produce partial results instead of an error.
//
// Query params:
//   symbols=AAPL,MSFT,GOOG  — optional comma-separated list of specific symbols to backtest
//   limit=15                — fallback count if symbols not provided
//   years=2                 — lookback period
router.get("/backtest/top20", async (req: Request, res: Response) => {
  const years = Math.max(
    1,
    Math.min(Number.parseFloat((req.query.years as string) || "2") || 2, 5)
  );
  const cfg = buildConfigFromQuery(req);

  // If client provides specific symbols, use those; otherwise fall back to most-active
  const symbolsParam = (req.query.symbols as string)?.trim();
  let symbols: string[] = [];

  if (symbolsParam) {
    // Use the client-provided list
    symbols = symbolsParam
      .split(",")
      .map((s) => s.trim().toUpperCase())
      .filter((s) => s.length > 0 && s.length <= 10)
      .slice(0, 30); // Cap at 30 symbols max
  } else {
    // Fall back to most-active
    const limit = Math.min(
      Number.parseInt((req.query.limit as string) || "15", 10) || 15,
      30
    );
    try {
      const mostActive = await getMostActiveTickers(limit);
      symbols = mostActive.map((t) => t.symbol.toUpperCase());
    } catch (e) {
      console.warn(
        "getMostActiveTickers failed:",
        (e as Error).message,
      );
    }
  }

  if (symbols.length === 0) {
    return res.json(
      emptyBacktestResponse(cfg, years, [
        "⚠ No symbols to backtest. Either provide ?symbols=AAPL,MSFT,... or the most-active list couldn't be loaded (Yahoo rate-limit). Try again in a few minutes.",
      ]),
    );
  }

  try {
    const cacheKey = `bt:top:${symbols.join(",")}:${years}:${JSON.stringify(cfg)}`;
    const cached = getBacktestCached<BacktestTop20Response>(cacheKey);
    if (cached) return res.json(cached);

    const results = await backtestSymbols(symbols, cfg, years, 4);
    results.sort((a, b) => {
      const edgeOrder = { strong: 0, positive: 1, flat: 2, negative: 3 };
      const aE = edgeOrder[a.historicalEdge];
      const bE = edgeOrder[b.historicalEdge];
      if (aE !== bE) return aE - bE;
      if (b.sharpe !== a.sharpe) return b.sharpe - a.sharpe;
      return b.winRate - a.winRate;
    });

    let benchmarkSpyReturnPct: number | null = null;
    try {
      const spyBt = await backtestSymbol("SPY", cfg, years);
      if (spyBt) benchmarkSpyReturnPct = spyBt.buyHoldReturnPct;
    } catch (e) {
      console.warn("SPY benchmark failed:", (e as Error).message);
    }

    const totalTrades = results.reduce((s, r) => s + r.tradesCount, 0);
    const totalWins = results.reduce((s, r) => s + r.wins, 0);
    const totalPnl = results.reduce((s, r) => s + r.totalPnl, 0);
    const aggregateWinRate = totalTrades > 0 ? (totalWins / totalTrades) * 100 : 0;
    const aggregateAvgPnl = totalTrades > 0 ? totalPnl / totalTrades : 0;
    const symbolsWithPositiveEdge = results.filter(
      (r) => r.historicalEdge === "positive" || r.historicalEdge === "strong",
    ).length;
    const symbolsWithNegativeEdge = results.filter(
      (r) => r.historicalEdge === "negative",
    ).length;

    const extraNotes: string[] = [];
    if (results.length === 0) {
      extraNotes.push(
        `⚠ Could not retrieve historical data for any of the ${symbols.length} symbols. Yahoo may be rate-limiting this server. Retry in a few minutes.`,
      );
    } else if (results.length < symbols.length) {
      extraNotes.push(
        `ℹ Retrieved ${results.length} of ${symbols.length} symbols (some were skipped due to transient data errors).`,
      );
    }

    const response: BacktestTop20Response = {
      generatedAt: new Date().toISOString(),
      yearsTested: years,
      config: cfg,
      results,
      summary: {
        totalTrades,
        aggregateWinRate: Math.round(aggregateWinRate * 10) / 10,
        aggregateAvgPnl: Math.round(aggregateAvgPnl * 100) / 100,
        aggregateTotalPnl: Math.round(totalPnl * 100) / 100,
        symbolsWithPositiveEdge,
        symbolsWithNegativeEdge,
        benchmarkSpyReturnPct,
      },
      methodology: [...extraNotes, ...METHODOLOGY_NOTES],
    };

    setBacktestCached(cacheKey, response);
    res.json(response);
  } catch (error) {
    console.error("Unexpected error in /backtest/top20:", error);
    // Never return HTML or a non-JSON body — always return a valid response
    // shape so the client can render something useful.
    res
      .status(200)
      .json(
        emptyBacktestResponse(cfg, years, [
          `⚠ Backtest failed unexpectedly on the server: ${(error as Error).message ?? "unknown error"}. See server logs for details.`,
        ]),
      );
  }
});

// Backtest a single ticker (deep dive)
router.get("/backtest/:ticker", async (req: Request, res: Response) => {
  const ticker = req.params.ticker.toUpperCase();
  const years = Math.max(
    1,
    Math.min(Number.parseFloat((req.query.years as string) || "2") || 2, 5)
  );
  const cfg = buildConfigFromQuery(req);
  try {
    const cacheKey = `bt:one:${ticker}:${years}:${JSON.stringify(cfg)}`;
    const cached = getBacktestCached<any>(cacheKey);
    if (cached) return res.json(cached);

    const result = await backtestSymbol(ticker, cfg, years);
    if (!result) {
      return res.status(200).json({
        generatedAt: new Date().toISOString(),
        yearsTested: years,
        config: cfg,
        result: null,
        methodology: [
          `⚠ Not enough clean historical data for ${ticker} over ${years}y to build a backtest. Try a more liquid symbol or a shorter window.`,
          ...METHODOLOGY_NOTES,
        ],
      });
    }
    const payload = {
      generatedAt: new Date().toISOString(),
      yearsTested: years,
      config: cfg,
      result,
      methodology: METHODOLOGY_NOTES,
    };
    setBacktestCached(cacheKey, payload);
    res.json(payload);
  } catch (error) {
    console.error(`Error backtesting ${ticker}:`, error);
    res.status(200).json({
      generatedAt: new Date().toISOString(),
      yearsTested: years,
      config: cfg,
      result: null,
      methodology: [
        `⚠ Server error running backtest for ${ticker}: ${(error as Error).message ?? "unknown"}.`,
        ...METHODOLOGY_NOTES,
      ],
    });
  }
});

export default router;
