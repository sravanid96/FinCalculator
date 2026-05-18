import { fetchTopTradeIdeas } from "./topIdeasService";
import { fetchMarketSnapshot } from "./marketSnapshotService";
import { backtestSymbols, DEFAULT_BACKTEST_CONFIG } from "./backtestEngine";
import {
  calculateTradeabilityScore,
  compareByHistoricalEdge,
} from "./tradeabilityScore";
import type {
  BacktestSymbolResult,
  TopOptionTradeIdea,
} from "@shared/optionsSchema";
import type { MarketIndexSnapshot } from "./marketSnapshotService";

export interface DigestIdeaRow {
  idea: TopOptionTradeIdea;
  backtest?: BacktestSymbolResult;
  tradeabilityScore: number | null;
}

export interface WeeklyMarketDigest {
  generatedAt: string;
  market: {
    generatedAt: string;
    indices: MarketIndexSnapshot[];
  };
  highConvictionIdeas: DigestIdeaRow[];
  methodology: string[];
}

const DIGEST_BACKTEST_YEARS = 2;

function isHighConviction(backtest: BacktestSymbolResult | undefined): boolean {
  if (!backtest) return false;
  return backtest.historicalEdge === "strong" || backtest.historicalEdge === "positive";
}

/** Build weekly digest: market snapshot + backtest-filtered top ideas (Ideas tab logic). */
export async function buildWeeklyMarketDigest(): Promise<WeeklyMarketDigest> {
  const [market, topIdeas] = await Promise.all([
    fetchMarketSnapshot(),
    fetchTopTradeIdeas({
      limit: 20,
      universeSize: 120,
      minPop: 55,
      minLiq: 15,
      allowEarnings: true,
    }),
  ]);

  const symbols = topIdeas.map((r) => r.symbol.toUpperCase());
  let backtestResults: BacktestSymbolResult[] = [];

  if (symbols.length > 0) {
    backtestResults = await backtestSymbols(
      symbols,
      {
        ...DEFAULT_BACKTEST_CONFIG,
        strategy: "put_credit_spread",
        targetDelta: 30,
        spreadWidth: 5,
        takeProfitPct: 50,
        entryFrequencyDays: 5,
      },
      DIGEST_BACKTEST_YEARS,
      4,
    );
  }

  const backtestMap = new Map(
    backtestResults.map((r) => [r.symbol.toUpperCase(), r]),
  );

  const ranked: DigestIdeaRow[] = topIdeas
    .filter((row) => {
      const bt = backtestMap.get(row.symbol.toUpperCase());
      if (bt?.historicalEdge === "negative") return false;
      return isHighConviction(bt);
    })
    .map((idea) => {
      const backtest = backtestMap.get(idea.symbol.toUpperCase());
      return {
        idea,
        backtest,
        tradeabilityScore: calculateTradeabilityScore(backtest),
      };
    })
    .sort((a, b) =>
      compareByHistoricalEdge(a.backtest, b.backtest),
    )
    .slice(0, 10);

  return {
    generatedAt: new Date().toISOString(),
    market,
    highConvictionIdeas: ranked,
    methodology: [
      "Ideas scanned from Yahoo most-active universe with credit-spread filters (POP ≥ 55%, liquidity ≥ 15).",
      "Backtested 2-year put credit spread (30Δ, $5 width, 50% profit target, weekly entries).",
      "Included only symbols with strong or positive historical edge; negative edge excluded.",
      "Not investment advice. Past performance does not guarantee future results.",
    ],
  };
}
