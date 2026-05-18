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
}

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
  const allowed = new Set(["put_credit_spread", "call_credit_spread", "iron_condor"]);
  const filtered = ideas.filter((i) => allowed.has(i.strategy));
  if (filtered.length === 0) return null;

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

  const mostActive = await getMostActiveTickers(universeSize);
  if (!mostActive.length) return [];

  const rows = await asyncPool(10, mostActive, async (t) => {
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

  const top = (rows.filter(Boolean) as TopOptionTradeIdea[])
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

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

  return top;
}
