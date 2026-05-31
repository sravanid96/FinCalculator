import {
  getStockQuote,
  getHistoricalPrices,
  getOptionsChainTargeted,
  getMostActiveTickers,
} from "./yahooFinance";
import { getUpcomingEarnings } from "./earningsService";
import { generateTradeIdeas } from "./tradeIdeaGenerator";
import { calculateRSI } from "./frameworkAnalysis";
import { DEFAULT_TRADE_CONFIG } from "../../shared/optionsSchema";
import type { TopOptionTradeIdea, TradeIdea, OptionsChain } from "../../shared/optionsSchema";

export interface FetchTopIdeasOptions {
  limit?: number;
  universeSize?: number;
  minPop?: number;
  minLiq?: number;
  allowEarnings?: boolean;
  bypassCache?: boolean;
}

// Cache the final top ideas result to avoid hammering Yahoo on page refreshes
const IS_PRODUCTION = process.env.NODE_ENV === "production";
const TOP_IDEAS_CACHE_TTL = IS_PRODUCTION ? 10 * 60 * 1000 : 2 * 60 * 1000; // 10 min prod, 2 min dev
let topIdeasCache: { data: TopOptionTradeIdea[]; timestamp: number; key: string } | null = null;

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

async function asyncPool<T, R>(
  poolLimit: number,
  items: T[],
  iteratorFn: (item: T, idx: number) => Promise<R>,
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
        // Ignore individual failures.
      }
    }
  });

  await Promise.all(workers);
  return results;
}

function pickBestCreditIdea(ideas: TradeIdea[]): TradeIdea | null {
  // Prefer directional credit spreads and cash-secured puts. Iron condors are only used
  // as a last resort (and capped at <2% of the final list downstream) — they were
  // dominating selection because they tie on POP but win on credit/RR.
  const preferred = new Set(["put_credit_spread", "call_credit_spread", "cash_secured_put"]);
  const byPopThenRr = (a: TradeIdea, b: TradeIdea) => {
    if (b.probabilityOfProfit !== a.probabilityOfProfit) {
      return b.probabilityOfProfit - a.probabilityOfProfit;
    }
    return b.riskRewardRatio - a.riskRewardRatio;
  };

  const preferredIdeas = ideas.filter((i) => preferred.has(i.strategy));
  if (preferredIdeas.length > 0) {
    return [...preferredIdeas].sort(byPopThenRr)[0];
  }

  const ironCondors = ideas.filter((i) => i.strategy === "iron_condor");
  if (ironCondors.length > 0) {
    return [...ironCondors].sort(byPopThenRr)[0];
  }
  return null;
}

function computeIdeaLiquidityScore(chain: OptionsChain, idea: TradeIdea): number {
  const exp = chain.expirations.find((e) => e.expirationDate === idea.expirationDate);
  if (!exp) return 0;

  const lookup = (leg: TradeIdea["legs"][number]) => {
    const list = leg.type === "call" ? exp.calls : exp.puts;
    return list.find((o) => o.strike === leg.strike);
  };

  const legs = idea.legs.map(lookup).filter(Boolean) as Array<{
    openInterest?: number;
    volume?: number;
  }>;
  if (legs.length === 0) return 0;

  const raw = legs.reduce(
    (sum, o) => sum + Math.log1p((o.openInterest || 0) + (o.volume || 0)),
    0,
  );
  return Math.round(100 * clamp01(raw / 12));
}

function computeOverallScore(idea: TradeIdea, liquidityScore: number): number {
  const pop = clamp01(idea.probabilityOfProfit / 100);
  const rr = clamp01(idea.riskRewardRatio / 1);
  const liq = clamp01(liquidityScore / 100);
  const dteFit = clamp01(1 - Math.abs(idea.daysToExpiration - DEFAULT_TRADE_CONFIG.targetDTE) / 45);
  return Math.round((pop * 0.55 + liq * 0.25 + rr * 0.1 + dteFit * 0.1) * 100);
}

async function getRSIWithFallback(
  symbol: string,
  primaryMonths: number,
  fallbackMonths: number,
): Promise<number | null> {
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
  strategy: TradeIdea["strategy"],
): {
  value: number;
  zone: "overbought" | "oversold" | "neutral";
  confidenceBoost: number;
  signal: string;
} {
  const zone = rsi >= 70 ? "overbought" : rsi <= 30 ? "oversold" : "neutral";

  const bullish = new Set<TradeIdea["strategy"]>([
    "put_credit_spread",
    "long_call",
    "cash_secured_put",
    "covered_call",
  ]);
  const bearish = new Set<TradeIdea["strategy"]>(["call_credit_spread", "long_put"]);
  const neutral = new Set<TradeIdea["strategy"]>([
    "iron_condor",
    "iron_butterfly",
    "straddle",
    "strangle",
  ]);

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

/** Same pipeline as GET /api/options/top-ideas. */
export async function fetchTopTradeIdeas(
  opts: FetchTopIdeasOptions = {},
): Promise<TopOptionTradeIdea[]> {
  const limit = Math.min(opts.limit ?? 20, 50);
  const universeSize = Math.min(opts.universeSize ?? 120, 120);
  const minPop = Math.max(40, Math.min(opts.minPop ?? 55, 85));
  const minLiq = Math.max(0, Math.min(opts.minLiq ?? 15, 100));
  const allowEarnings = opts.allowEarnings ?? true;

  // Check result cache first (avoids hammering Yahoo on page refreshes)
  const cacheKey = `${limit}:${universeSize}:${minPop}:${minLiq}:${allowEarnings}`;
  if (
    !opts.bypassCache &&
    topIdeasCache &&
    topIdeasCache.key === cacheKey &&
    Date.now() - topIdeasCache.timestamp < TOP_IDEAS_CACHE_TTL
  ) {
    return topIdeasCache.data;
  }

  const mostActive = await getMostActiveTickers(universeSize);
  if (!mostActive.length) return [];

  // Lower concurrency in production to avoid Yahoo rate limits (4 instead of 10)
  const concurrency = IS_PRODUCTION ? 4 : 8;
  const rows = await asyncPool(concurrency, mostActive, async (t) => {
    const symbol = t.symbol.toUpperCase();

    try {
      const quote = await getStockQuote(symbol);
      const [chain, earnings] = await Promise.all([
        getOptionsChainTargeted(symbol, DEFAULT_TRADE_CONFIG.targetDTE, 1),
        getUpcomingEarnings(symbol),
      ]);

      if (!chain.expirations?.length) return null;

      const ideas = generateTradeIdeas(chain, earnings, DEFAULT_TRADE_CONFIG, null);
      const best = pickBestCreditIdea(ideas);
      if (!best) return null;

      if (best.probabilityOfProfit < minPop) return null;
      if (best.hasEarningsRisk && !allowEarnings) return null;

      const liquidityScore = computeIdeaLiquidityScore(chain, best);
      if (liquidityScore < minLiq) return null;

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
      return null;
    }
  });

  const ranked = (rows.filter(Boolean) as TopOptionTradeIdea[]).sort(
    (a, b) => b.score - a.score,
  );

  // Cap iron condors at < 2% of the returned list (e.g. 0 for a 20-row list).
  const maxIronCondors = Math.floor(limit * 0.02);
  const top: TopOptionTradeIdea[] = [];
  let ironCondorCount = 0;
  for (const row of ranked) {
    if (top.length >= limit) break;
    if (row.idea.strategy === "iron_condor") {
      if (ironCondorCount >= maxIronCondors) continue;
      ironCondorCount++;
    }
    top.push(row);
  }

  await Promise.all(
    top.map(async (row) => {
      const rsi = await getRSIWithFallback(row.symbol, 6, 12);
      if (rsi === null) return;

      (row.idea as TradeIdea & { rsiAnalysis?: ReturnType<typeof buildRSIAnalysisForTopIdeas> })
        .rsiAnalysis = buildRSIAnalysisForTopIdeas(rsi, row.idea.strategy);

      const rsiAnalysis = (row.idea as TradeIdea & { rsiAnalysis?: { zone: string; value: number; confidenceBoost: number } })
        .rsiAnalysis;
      if (rsiAnalysis?.zone && rsiAnalysis.zone !== "neutral") {
        const zoneLabel = rsiAnalysis.zone === "overbought" ? "Overbought" : "Oversold";
        row.reasons.push(`RSI ${rsiAnalysis.value.toFixed(0)} (${zoneLabel})`);
      }

      const boost = rsiAnalysis?.confidenceBoost ?? 0;
      row.score = Math.max(0, Math.min(100, row.score + Math.round(boost / 2)));
    }),
  );

  // Cache the result
  topIdeasCache = { data: top, timestamp: Date.now(), key: cacheKey };

  return top;
}
