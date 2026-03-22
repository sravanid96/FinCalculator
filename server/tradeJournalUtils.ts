/** Realized P&L after fees (USD). Long: (exit − entry) × qty × mult − fees. Short: (entry − exit) × qty × mult − fees. */
export function computeRealizedPnl(params: {
  side: string;
  entryPrice: string | number;
  exitPrice: string | number;
  quantity: number;
  contractMultiplier: string | number;
  fees: string | number;
}): number {
  const entry = Number(params.entryPrice);
  const exit = Number(params.exitPrice);
  const qty = params.quantity;
  const mult = Number(params.contractMultiplier);
  const fees = Number(params.fees);
  const gross =
    params.side === "short"
      ? (entry - exit) * qty * mult
      : (exit - entry) * qty * mult;
  return Math.round((gross - fees) * 100) / 100;
}

export function tradeJournalStats(rows: { realizedPnl: string | null; exitDate: Date | null }[]) {
  const closed = rows.filter((r) => r.exitDate != null && r.realizedPnl != null);
  const pnls = closed.map((r) => Number(r.realizedPnl));
  const wins = pnls.filter((p) => p > 0);
  const losses = pnls.filter((p) => p < 0);
  const totalPnl = pnls.reduce((a, b) => a + b, 0);
  const winRate = closed.length > 0 ? wins.length / closed.length : null;
  const sumWins = wins.reduce((a, b) => a + b, 0);
  const sumLossAbs = losses.reduce((a, b) => a + Math.abs(b), 0);
  /** JSON cannot represent Infinity; use sentinel for UI */
  let profitFactor: number | "infinite" | null = null;
  if (losses.length === 0 && wins.length > 0) {
    profitFactor = "infinite";
  } else if (sumLossAbs > 0) {
    profitFactor = sumWins / sumLossAbs;
  }
  return {
    closedCount: closed.length,
    openCount: rows.length - closed.length,
    winCount: wins.length,
    lossCount: losses.length,
    totalRealizedPnl: totalPnl,
    winRate,
    profitFactor,
  };
}
