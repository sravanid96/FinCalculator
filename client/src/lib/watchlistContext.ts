import type {
  BacktestSymbolResult,
  FrameworkAnalysis,
  StockQuote,
  TradeIdea,
  WatchlistContextSnapshot,
} from "@shared/optionsSchema";

export function buildWatchlistContext(opts: {
  idea: TradeIdea;
  frameworkAnalysis?: FrameworkAnalysis;
  quote?: StockQuote;
  backtest?: BacktestSymbolResult;
  fundamentals?: WatchlistContextSnapshot["fundamentals"];
}): WatchlistContextSnapshot {
  const { idea, frameworkAnalysis, quote, backtest, fundamentals } = opts;

  return {
    capturedAt: new Date().toISOString(),
    strategy: idea.strategy,
    recommendation: idea.recommendation,
    hasEarningsRisk: idea.hasEarningsRisk,
    earningsDate: idea.earningsDate,
    probabilityOfProfit: idea.probabilityOfProfit,
    daysToExpiration: idea.daysToExpiration,
    pillarScores: frameworkAnalysis?.scores,
    technical: frameworkAnalysis?.indicators
      ? {
          rsi: frameworkAnalysis.indicators.rsi,
          trend: frameworkAnalysis.indicators.trend,
          ivRank: frameworkAnalysis.indicators.ivRank,
        }
      : undefined,
    historicalEdge: backtest?.historicalEdge,
    backtestWinRate: backtest?.winRate,
    quotePe: quote?.pe,
    fundamentals,
  };
}
