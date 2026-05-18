import type { BacktestSymbolResult } from "@shared/optionsSchema";

/** Mirrors client TopTradeIdeasTab tradeability scoring. */
export function calculateTradeabilityScore(
  backtest: BacktestSymbolResult | undefined,
): number | null {
  if (!backtest) return null;

  const winRateWeight = 0.4;
  const profitFactorWeight = 0.3;
  const sharpeWeight = 0.2;
  const drawdownWeight = 0.1;

  const winRateScore = Math.min(backtest.winRate, 100);
  const profitFactorScore = Math.min((backtest.profitFactor / 2) * 100, 100);
  const sharpeScore = Math.min(((backtest.sharpe + 1) / 3) * 100, 100);
  const drawdownScore = Math.max(0, 100 - Math.abs(backtest.maxDrawdownPct));

  return Math.round(
    winRateScore * winRateWeight +
      profitFactorScore * profitFactorWeight +
      sharpeScore * sharpeWeight +
      drawdownScore * drawdownWeight,
  );
}

const EDGE_ORDER: Record<string, number> = {
  strong: 0,
  positive: 1,
  flat: 2,
  negative: 3,
};

export function compareByHistoricalEdge(
  a: BacktestSymbolResult | undefined,
  b: BacktestSymbolResult | undefined,
): number {
  const edgeA = a?.historicalEdge != null ? (EDGE_ORDER[a.historicalEdge] ?? 4) : 4;
  const edgeB = b?.historicalEdge != null ? (EDGE_ORDER[b.historicalEdge] ?? 4) : 4;
  if (edgeA !== edgeB) return edgeA - edgeB;

  const scoreA = calculateTradeabilityScore(a) ?? 0;
  const scoreB = calculateTradeabilityScore(b) ?? 0;
  return scoreB - scoreA;
}
