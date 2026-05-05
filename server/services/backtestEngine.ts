/**
 * Backtest engine for defined-risk credit spread strategies.
 *
 * Methodology (important — this is a SIMULATION, not a replay of live options prices):
 *   1. Pull daily OHLCV history for the symbol.
 *   2. At each entry point (every N trading days), compute trailing 30-day realized
 *      volatility as a proxy for implied volatility.
 *   3. Use Black-Scholes + that vol to:
 *        - pick a short strike near the target delta
 *        - price the credit received
 *   4. Walk day-by-day forward. At each day, re-price the spread with current
 *      realized vol. Apply exit rules (50% profit target, 21-DTE management, expiry).
 *   5. Settle P&L using actual realized price on exit day (for expiry) or BS mid on
 *      early close.
 *
 * Caveats the UI surfaces to the user:
 *   - No bid-ask slippage modeled (credits are mid).
 *   - No volatility skew (short put IV ≈ long put IV in reality the former is higher).
 *   - Uses realized vol, not IV — usually realized > IV for short-dated, so results
 *     slightly overstate credit in high-vol regimes.
 *   - Expect a 15–30% haircut vs live trading results.
 */

import { getHistoricalPrices } from "./yahooFinance";
import { blackScholesPrice } from "./optionsCalculator";
import type {
  BacktestConfig,
  BacktestTradeResult,
  BacktestSymbolResult,
  PriceDataPoint,
  OptionStrategy,
} from "../../shared/optionsSchema";
import { STRATEGY_NAMES } from "../../shared/optionsSchema";

const RISK_FREE_RATE = 0.045; // ~10yr treasury yield approximation

// ============================================================================
// Statistics helpers
// ============================================================================

/** Inverse normal CDF via rational approximation (Beasley–Springer–Moro). */
function normInv(p: number): number {
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;
  // Constants
  const a = [
    -3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2,
    1.38357751867269e2, -3.066479806614716e1, 2.506628277459239,
  ];
  const b = [
    -5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2,
    6.680131188771972e1, -1.328068155288572e1,
  ];
  const c = [
    -7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838,
    -2.549732539343734, 4.374664141464968, 2.938163982698783,
  ];
  const d = [
    7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996,
    3.754408661907416,
  ];
  const plow = 0.02425;
  const phigh = 1 - plow;

  let q: number, r: number, x: number;
  if (p < plow) {
    q = Math.sqrt(-2 * Math.log(p));
    x =
      (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  } else if (p <= phigh) {
    q = p - 0.5;
    r = q * q;
    x =
      ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) /
      (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  } else {
    q = Math.sqrt(-2 * Math.log(1 - p));
    x =
      -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  return x;
}

/** Annualized realized volatility from the last `window` daily closes. */
function realizedVol(closes: number[], endIdx: number, window = 30): number | null {
  const start = endIdx - window;
  if (start < 1) return null;
  const rets: number[] = [];
  for (let i = start + 1; i <= endIdx; i++) {
    const r = Math.log(closes[i] / closes[i - 1]);
    if (!Number.isFinite(r)) return null;
    rets.push(r);
  }
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const variance =
    rets.reduce((s, r) => s + (r - mean) ** 2, 0) / Math.max(1, rets.length - 1);
  const dailyStd = Math.sqrt(variance);
  return dailyStd * Math.sqrt(252);
}

/** Returns index with date >= targetDate, or closest after. Returns -1 if past end. */
function findIndexAfterDays(
  prices: PriceDataPoint[],
  fromIdx: number,
  calendarDays: number
): number {
  const target = new Date(prices[fromIdx].date);
  target.setDate(target.getDate() + calendarDays);
  for (let i = fromIdx + 1; i < prices.length; i++) {
    if (new Date(prices[i].date).getTime() >= target.getTime()) return i;
  }
  return -1;
}

// ============================================================================
// Strike selection (30-delta put / call) via Black-Scholes inversion
// ============================================================================

function putStrikeForTargetDelta(
  spot: number,
  sigma: number,
  T: number,
  targetDelta: number // e.g. 0.30 (absolute magnitude)
): number {
  // |put delta| = N(-d1) = targetDelta  ->  d1 = -normInv(targetDelta)
  const d1 = -normInv(Math.max(0.01, Math.min(0.99, targetDelta)));
  // d1 = (ln(S/K) + (r + σ²/2)T) / (σ√T)  ->  K = S·exp((r+σ²/2)T - d1·σ√T)
  const K = spot * Math.exp((RISK_FREE_RATE + 0.5 * sigma * sigma) * T - d1 * sigma * Math.sqrt(T));
  return roundStrike(K, spot);
}

function callStrikeForTargetDelta(
  spot: number,
  sigma: number,
  T: number,
  targetDelta: number
): number {
  // call delta = N(d1) = targetDelta -> d1 = normInv(targetDelta)
  const d1 = normInv(Math.max(0.01, Math.min(0.99, targetDelta)));
  const K = spot * Math.exp((RISK_FREE_RATE + 0.5 * sigma * sigma) * T - d1 * sigma * Math.sqrt(T));
  return roundStrike(K, spot);
}

/** Round strike to realistic increments: $1 for <$50, $2.5 for <$200, $5 above. */
function roundStrike(strike: number, spot: number): number {
  const inc = spot < 50 ? 1 : spot < 200 ? 2.5 : 5;
  return Math.round(strike / inc) * inc;
}

// ============================================================================
// Spread pricing
// ============================================================================

function creditPutSpread(
  spot: number,
  shortK: number,
  longK: number,
  sigma: number,
  T: number
): number {
  const shortP = blackScholesPrice("put", spot, shortK, T, RISK_FREE_RATE, sigma);
  const longP = blackScholesPrice("put", spot, longK, T, RISK_FREE_RATE, sigma);
  return Math.max(0, shortP - longP);
}

function creditCallSpread(
  spot: number,
  shortK: number,
  longK: number,
  sigma: number,
  T: number
): number {
  const shortC = blackScholesPrice("call", spot, shortK, T, RISK_FREE_RATE, sigma);
  const longC = blackScholesPrice("call", spot, longK, T, RISK_FREE_RATE, sigma);
  return Math.max(0, shortC - longC);
}

function creditIronCondor(
  spot: number,
  putShortK: number,
  putLongK: number,
  callShortK: number,
  callLongK: number,
  sigma: number,
  T: number
): number {
  return (
    creditPutSpread(spot, putShortK, putLongK, sigma, T) +
    creditCallSpread(spot, callShortK, callLongK, sigma, T)
  );
}

/** Settle put credit spread at expiry. `credit` & `width` in points (per share). */
function settlePutSpread(spotAtExp: number, shortK: number, longK: number, credit: number): number {
  // Intrinsic value of short put at expiry
  const shortVal = Math.max(0, shortK - spotAtExp);
  const longVal = Math.max(0, longK - spotAtExp);
  const debit = shortVal - longVal; // cost to close
  return (credit - debit) * 100; // per contract
}

function settleCallSpread(spotAtExp: number, shortK: number, longK: number, credit: number): number {
  const shortVal = Math.max(0, spotAtExp - shortK);
  const longVal = Math.max(0, spotAtExp - longK);
  const debit = shortVal - longVal;
  return (credit - debit) * 100;
}

function settleIronCondor(
  spotAtExp: number,
  putShortK: number,
  putLongK: number,
  callShortK: number,
  callLongK: number,
  credit: number
): number {
  const putShortVal = Math.max(0, putShortK - spotAtExp);
  const putLongVal = Math.max(0, putLongK - spotAtExp);
  const callShortVal = Math.max(0, spotAtExp - callShortK);
  const callLongVal = Math.max(0, spotAtExp - callLongK);
  const debit = putShortVal - putLongVal + callShortVal - callLongVal;
  return (credit - debit) * 100;
}

// ============================================================================
// Per-strategy simulated trade
// ============================================================================

function simulatePutCreditSpread(
  prices: PriceDataPoint[],
  closes: number[],
  entryIdx: number,
  cfg: BacktestConfig,
  volRegimeCutoffs: { low: number; high: number }
): BacktestTradeResult | null {
  const entry = prices[entryIdx];
  const sigma = realizedVol(closes, entryIdx, 30);
  if (!sigma || sigma < 0.08 || sigma > 2) return null; // skip implausible vol

  const T = cfg.dte / 365;
  const spot = entry.close;
  const shortK = putStrikeForTargetDelta(spot, sigma, T, cfg.targetDelta / 100);
  const longK = shortK - cfg.spreadWidth;
  if (longK <= 0) return null;

  const credit = creditPutSpread(spot, shortK, longK, sigma, T);
  if (credit <= 0.02) return null; // skip pennies; not a real trade
  if (credit >= cfg.spreadWidth) return null; // arbitrage-like, skip

  const maxLoss = cfg.spreadWidth - credit;
  const profitTargetValue = credit * (1 - cfg.takeProfitPct / 100); // buy back at this price

  const exitIdxByExpiry = findIndexAfterDays(prices, entryIdx, cfg.dte);
  if (exitIdxByExpiry < 0) return null; // not enough data
  const mgmtIdxCalendar = cfg.dte - 21;
  const exitIdxByMgmt = mgmtIdxCalendar > 0
    ? findIndexAfterDays(prices, entryIdx, mgmtIdxCalendar)
    : -1;

  // Walk day by day, check for profit target
  let exitIdx = exitIdxByExpiry;
  let exitReason: BacktestTradeResult["exitReason"] = "expiry";
  let pnl = 0;
  let hitTarget = false;

  for (let i = entryIdx + 1; i < exitIdxByExpiry; i++) {
    const daysRemaining = Math.max(0.5, cfg.dte - (i - entryIdx));
    const Tnow = daysRemaining / 365;
    const sigmaNow = realizedVol(closes, i, 30) ?? sigma;
    const currentValue = creditPutSpread(closes[i], shortK, longK, sigmaNow, Tnow);
    if (currentValue <= profitTargetValue) {
      exitIdx = i;
      exitReason = "profit_target";
      pnl = (credit - currentValue) * 100;
      hitTarget = true;
      break;
    }
    if (exitIdxByMgmt > 0 && i >= exitIdxByMgmt) {
      exitIdx = i;
      exitReason = "dte_management";
      pnl = (credit - currentValue) * 100;
      hitTarget = true;
      break;
    }
  }

  if (!hitTarget) {
    pnl = settlePutSpread(prices[exitIdx].close, shortK, longK, credit);
  }

  const regime: BacktestTradeResult["regime"] =
    sigma < volRegimeCutoffs.low
      ? "low_vol"
      : sigma > volRegimeCutoffs.high
        ? "high_vol"
        : "normal_vol";

  return {
    entryDate: entry.date,
    exitDate: prices[exitIdx].date,
    exitReason,
    daysHeld: exitIdx - entryIdx,
    entryPrice: spot,
    exitUnderlyingPrice: prices[exitIdx].close,
    shortStrike: shortK,
    longStrike: longK,
    creditReceived: credit,
    maxLoss,
    pnl: Math.round(pnl * 100) / 100,
    pnlPct: Math.round((pnl / (maxLoss * 100)) * 1000) / 10,
    isWin: pnl > 0,
    regime,
    nearEarnings: false, // populated later if earnings dates known
  };
}

function simulateCallCreditSpread(
  prices: PriceDataPoint[],
  closes: number[],
  entryIdx: number,
  cfg: BacktestConfig,
  volRegimeCutoffs: { low: number; high: number }
): BacktestTradeResult | null {
  const entry = prices[entryIdx];
  const sigma = realizedVol(closes, entryIdx, 30);
  if (!sigma || sigma < 0.08 || sigma > 2) return null;

  const T = cfg.dte / 365;
  const spot = entry.close;
  const shortK = callStrikeForTargetDelta(spot, sigma, T, cfg.targetDelta / 100);
  const longK = shortK + cfg.spreadWidth;

  const credit = creditCallSpread(spot, shortK, longK, sigma, T);
  if (credit <= 0.02) return null;
  if (credit >= cfg.spreadWidth) return null;

  const maxLoss = cfg.spreadWidth - credit;
  const profitTargetValue = credit * (1 - cfg.takeProfitPct / 100);

  const exitIdxByExpiry = findIndexAfterDays(prices, entryIdx, cfg.dte);
  if (exitIdxByExpiry < 0) return null;
  const mgmtDaysCalendar = cfg.dte - 21;
  const exitIdxByMgmt = mgmtDaysCalendar > 0
    ? findIndexAfterDays(prices, entryIdx, mgmtDaysCalendar)
    : -1;

  let exitIdx = exitIdxByExpiry;
  let exitReason: BacktestTradeResult["exitReason"] = "expiry";
  let pnl = 0;
  let hitTarget = false;

  for (let i = entryIdx + 1; i < exitIdxByExpiry; i++) {
    const daysRemaining = Math.max(0.5, cfg.dte - (i - entryIdx));
    const Tnow = daysRemaining / 365;
    const sigmaNow = realizedVol(closes, i, 30) ?? sigma;
    const currentValue = creditCallSpread(closes[i], shortK, longK, sigmaNow, Tnow);
    if (currentValue <= profitTargetValue) {
      exitIdx = i;
      exitReason = "profit_target";
      pnl = (credit - currentValue) * 100;
      hitTarget = true;
      break;
    }
    if (exitIdxByMgmt > 0 && i >= exitIdxByMgmt) {
      exitIdx = i;
      exitReason = "dte_management";
      pnl = (credit - currentValue) * 100;
      hitTarget = true;
      break;
    }
  }

  if (!hitTarget) {
    pnl = settleCallSpread(prices[exitIdx].close, shortK, longK, credit);
  }

  const regime: BacktestTradeResult["regime"] =
    sigma < volRegimeCutoffs.low
      ? "low_vol"
      : sigma > volRegimeCutoffs.high
        ? "high_vol"
        : "normal_vol";

  return {
    entryDate: entry.date,
    exitDate: prices[exitIdx].date,
    exitReason,
    daysHeld: exitIdx - entryIdx,
    entryPrice: spot,
    exitUnderlyingPrice: prices[exitIdx].close,
    shortStrike: shortK,
    longStrike: longK,
    creditReceived: credit,
    maxLoss,
    pnl: Math.round(pnl * 100) / 100,
    pnlPct: Math.round((pnl / (maxLoss * 100)) * 1000) / 10,
    isWin: pnl > 0,
    regime,
    nearEarnings: false,
  };
}

function simulateIronCondor(
  prices: PriceDataPoint[],
  closes: number[],
  entryIdx: number,
  cfg: BacktestConfig,
  volRegimeCutoffs: { low: number; high: number }
): BacktestTradeResult | null {
  const entry = prices[entryIdx];
  const sigma = realizedVol(closes, entryIdx, 30);
  if (!sigma || sigma < 0.08 || sigma > 2) return null;

  const T = cfg.dte / 365;
  const spot = entry.close;
  const putShortK = putStrikeForTargetDelta(spot, sigma, T, cfg.targetDelta / 100);
  const putLongK = putShortK - cfg.spreadWidth;
  const callShortK = callStrikeForTargetDelta(spot, sigma, T, cfg.targetDelta / 100);
  const callLongK = callShortK + cfg.spreadWidth;
  if (putLongK <= 0) return null;
  if (callShortK <= putShortK) return null;

  const credit = creditIronCondor(spot, putShortK, putLongK, callShortK, callLongK, sigma, T);
  if (credit <= 0.04) return null;
  if (credit >= cfg.spreadWidth) return null;

  // Iron condor max loss = spreadWidth - credit (one side can go max loss, not both).
  const maxLoss = cfg.spreadWidth - credit;
  const profitTargetValue = credit * (1 - cfg.takeProfitPct / 100);

  const exitIdxByExpiry = findIndexAfterDays(prices, entryIdx, cfg.dte);
  if (exitIdxByExpiry < 0) return null;
  const mgmtDaysCalendar = cfg.dte - 21;
  const exitIdxByMgmt = mgmtDaysCalendar > 0
    ? findIndexAfterDays(prices, entryIdx, mgmtDaysCalendar)
    : -1;

  let exitIdx = exitIdxByExpiry;
  let exitReason: BacktestTradeResult["exitReason"] = "expiry";
  let pnl = 0;
  let hitTarget = false;

  for (let i = entryIdx + 1; i < exitIdxByExpiry; i++) {
    const daysRemaining = Math.max(0.5, cfg.dte - (i - entryIdx));
    const Tnow = daysRemaining / 365;
    const sigmaNow = realizedVol(closes, i, 30) ?? sigma;
    const currentValue = creditIronCondor(
      closes[i],
      putShortK,
      putLongK,
      callShortK,
      callLongK,
      sigmaNow,
      Tnow
    );
    if (currentValue <= profitTargetValue) {
      exitIdx = i;
      exitReason = "profit_target";
      pnl = (credit - currentValue) * 100;
      hitTarget = true;
      break;
    }
    if (exitIdxByMgmt > 0 && i >= exitIdxByMgmt) {
      exitIdx = i;
      exitReason = "dte_management";
      pnl = (credit - currentValue) * 100;
      hitTarget = true;
      break;
    }
  }

  if (!hitTarget) {
    pnl = settleIronCondor(
      prices[exitIdx].close,
      putShortK,
      putLongK,
      callShortK,
      callLongK,
      credit
    );
  }

  const regime: BacktestTradeResult["regime"] =
    sigma < volRegimeCutoffs.low
      ? "low_vol"
      : sigma > volRegimeCutoffs.high
        ? "high_vol"
        : "normal_vol";

  return {
    entryDate: entry.date,
    exitDate: prices[exitIdx].date,
    exitReason,
    daysHeld: exitIdx - entryIdx,
    entryPrice: spot,
    exitUnderlyingPrice: prices[exitIdx].close,
    // For iron condor, record the put short strike and call short strike pair.
    // We stash call short in longStrike slot for display convenience.
    shortStrike: putShortK,
    longStrike: callShortK,
    creditReceived: credit,
    maxLoss,
    pnl: Math.round(pnl * 100) / 100,
    pnlPct: Math.round((pnl / (maxLoss * 100)) * 1000) / 10,
    isWin: pnl > 0,
    regime,
    nearEarnings: false,
  };
}

// ============================================================================
// Earnings date lookup (historical). Tries Yahoo quoteSummary earningsHistory.
// Completely isolated — any error returns an empty array so the backtest
// continues without earnings-adjacent tagging.
// ============================================================================

/** Safely convert something into an ISO yyyy-mm-dd string, or null. */
function safeToIsoDate(v: unknown): string | null {
  if (!v) return null;
  try {
    const date = v instanceof Date ? v : new Date(v as string | number);
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;
    return date.toISOString().split("T")[0];
  } catch {
    return null;
  }
}

async function getHistoricalEarningsDates(symbol: string): Promise<string[]> {
  try {
    const mod: any = await import("yahoo-finance2");
    const YahooFinanceCtor: any = mod?.default?.default ?? mod?.default ?? mod;
    const yf: any = new YahooFinanceCtor();
    const qs: any = await yf.quoteSummary(symbol, {
      modules: ["earningsHistory"],
    });
    const history = qs?.earningsHistory?.history || [];
    const dates: string[] = [];
    for (const h of history) {
      const raw = h?.quarter ?? h?.quarterDate ?? null;
      const iso = safeToIsoDate(raw);
      if (iso) dates.push(iso);
    }
    return dates;
  } catch {
    // Yahoo validation errors, schema mismatches, rate limits — all silenced.
    return [];
  }
}

function tradeIsNearEarnings(
  trade: BacktestTradeResult,
  earningsDates: string[],
  windowDays = 7
): boolean {
  if (!earningsDates.length) return false;
  const entry = new Date(trade.entryDate).getTime();
  const exit = new Date(trade.exitDate).getTime();
  const windowMs = windowDays * 24 * 60 * 60 * 1000;
  for (const ds of earningsDates) {
    const d = new Date(ds).getTime();
    // "Near" = earnings falls within the holding window (±window buffer).
    if (d >= entry - windowMs && d <= exit + windowMs) return true;
  }
  return false;
}

// ============================================================================
// Aggregate stats
// ============================================================================

function aggregateStats(
  symbol: string,
  cfg: BacktestConfig,
  trades: BacktestTradeResult[],
  prices: PriceDataPoint[]
): Omit<BacktestSymbolResult, "trades"> {
  const wins = trades.filter((t) => t.isWin);
  const losses = trades.filter((t) => !t.isWin);
  const count = trades.length;

  const totalPnl = trades.reduce((s, t) => s + t.pnl, 0);
  const avgPnl = count ? totalPnl / count : 0;
  const avgWin = wins.length ? wins.reduce((s, t) => s + t.pnl, 0) / wins.length : 0;
  const avgLoss = losses.length ? losses.reduce((s, t) => s + t.pnl, 0) / losses.length : 0;
  const maxWin = wins.length ? Math.max(...wins.map((t) => t.pnl)) : 0;
  const maxLoss = losses.length ? Math.min(...losses.map((t) => t.pnl)) : 0;
  const grossWin = wins.reduce((s, t) => s + t.pnl, 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.pnl, 0));
  const profitFactor = grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? 99 : 0;

  // Sharpe: per-trade PnL normalized, annualized assuming ~12 trades/yr cadence
  // (we don't actually assume that; we scale by sqrt(trades_per_year)).
  let sharpe = 0;
  if (count > 1) {
    const mean = avgPnl;
    const variance =
      trades.reduce((s, t) => s + (t.pnl - mean) ** 2, 0) / (count - 1);
    const std = Math.sqrt(variance);
    // Approx trades per year from the entry-date span
    const span =
      (new Date(trades[count - 1].entryDate).getTime() -
        new Date(trades[0].entryDate).getTime()) /
      (365 * 24 * 60 * 60 * 1000);
    const tradesPerYear = span > 0.1 ? count / span : 12;
    sharpe = std > 0 ? (mean / std) * Math.sqrt(tradesPerYear) : 0;
  }

  // Max drawdown on cumulative P&L
  let cum = 0;
  let peak = 0;
  let maxDD = 0;
  let maxDDpeak = 0;
  for (const t of trades) {
    cum += t.pnl;
    if (cum > peak) peak = cum;
    const dd = peak - cum;
    if (dd > maxDD) {
      maxDD = dd;
      maxDDpeak = peak;
    }
  }
  const maxDrawdownPct = maxDDpeak > 0 ? (maxDD / maxDDpeak) * 100 : 0;

  const earn = trades.filter((t) => t.nearEarnings);
  const nonEarn = trades.filter((t) => !t.nearEarnings);
  const earningsWinRate = earn.length
    ? (earn.filter((t) => t.isWin).length / earn.length) * 100
    : null;
  const nonEarningsWinRate = nonEarn.length
    ? (nonEarn.filter((t) => t.isWin).length / nonEarn.length) * 100
    : 0;

  const highVol = trades.filter((t) => t.regime === "high_vol");
  const lowVol = trades.filter((t) => t.regime === "low_vol");
  const highVolWinRate = highVol.length
    ? (highVol.filter((t) => t.isWin).length / highVol.length) * 100
    : null;
  const lowVolWinRate = lowVol.length
    ? (lowVol.filter((t) => t.isWin).length / lowVol.length) * 100
    : null;

  const winRate = count ? (wins.length / count) * 100 : 0;

  // Benchmark: buy & hold over same window
  const startPrice = prices[0]?.close ?? 0;
  const endPrice = prices[prices.length - 1]?.close ?? 0;
  const buyHoldReturnPct = startPrice > 0 ? ((endPrice - startPrice) / startPrice) * 100 : 0;

  // Historical edge classification
  let historicalEdge: BacktestSymbolResult["historicalEdge"] = "flat";
  if (count < 20) {
    historicalEdge = "flat"; // too few trades to judge
  } else if (winRate >= 75 && profitFactor >= 1.5 && avgPnl > 0) {
    historicalEdge = "strong";
  } else if (winRate >= 60 && profitFactor >= 1.1 && avgPnl > 0) {
    historicalEdge = "positive";
  } else if (winRate < 55 || profitFactor < 0.9 || avgPnl < 0) {
    historicalEdge = "negative";
  }

  return {
    symbol,
    strategy: cfg.strategy,
    strategyName: STRATEGY_NAMES[cfg.strategy],
    tradesCount: count,
    wins: wins.length,
    losses: losses.length,
    winRate: Math.round(winRate * 10) / 10,
    avgPnl: Math.round(avgPnl * 100) / 100,
    totalPnl: Math.round(totalPnl * 100) / 100,
    avgWin: Math.round(avgWin * 100) / 100,
    avgLoss: Math.round(avgLoss * 100) / 100,
    maxWin: Math.round(maxWin * 100) / 100,
    maxLoss: Math.round(maxLoss * 100) / 100,
    profitFactor: Math.round(profitFactor * 100) / 100,
    sharpe: Math.round(sharpe * 100) / 100,
    maxDrawdown: Math.round(maxDD * 100) / 100,
    maxDrawdownPct: Math.round(maxDrawdownPct * 10) / 10,
    earningsWinRate: earningsWinRate !== null ? Math.round(earningsWinRate * 10) / 10 : null,
    earningsTradeCount: earn.length,
    nonEarningsWinRate: Math.round(nonEarningsWinRate * 10) / 10,
    nonEarningsTradeCount: nonEarn.length,
    highVolWinRate: highVolWinRate !== null ? Math.round(highVolWinRate * 10) / 10 : null,
    lowVolWinRate: lowVolWinRate !== null ? Math.round(lowVolWinRate * 10) / 10 : null,
    buyHoldReturnPct: Math.round(buyHoldReturnPct * 10) / 10,
    historicalEdge,
    recommendedConfig: cfg,
    startDate: prices[0]?.date ?? "",
    endDate: prices[prices.length - 1]?.date ?? "",
    priceAtEnd: endPrice,
  };
}

// ============================================================================
// Public API
// ============================================================================

export async function backtestSymbol(
  symbol: string,
  cfg: BacktestConfig,
  years: number
): Promise<BacktestSymbolResult | null> {
  const months = Math.max(12, Math.round(years * 12));
  const prices = await getHistoricalPrices(symbol, months);
  if (prices.length < 60) return null;

  const closes = prices.map((p) => p.close);

  // Determine vol-regime cutoffs from this symbol's own vol distribution (20/80 pctile).
  const vols: number[] = [];
  for (let i = 60; i < closes.length; i++) {
    const v = realizedVol(closes, i, 30);
    if (v) vols.push(v);
  }
  vols.sort((a, b) => a - b);
  const low = vols[Math.floor(vols.length * 0.25)] ?? 0.2;
  const high = vols[Math.floor(vols.length * 0.75)] ?? 0.4;

  // Earnings dates (may be empty)
  const earningsDates = await getHistoricalEarningsDates(symbol);

  const trades: BacktestTradeResult[] = [];
  const minStart = 60; // Need 60 days of history for vol calc + some warmup
  const step = Math.max(1, cfg.entryFrequencyDays);

  for (let i = minStart; i < prices.length - cfg.dte; i += step) {
    let t: BacktestTradeResult | null = null;
    if (cfg.strategy === "put_credit_spread") {
      t = simulatePutCreditSpread(prices, closes, i, cfg, { low, high });
    } else if (cfg.strategy === "call_credit_spread") {
      t = simulateCallCreditSpread(prices, closes, i, cfg, { low, high });
    } else if (cfg.strategy === "iron_condor") {
      t = simulateIronCondor(prices, closes, i, cfg, { low, high });
    }
    if (t) {
      t.nearEarnings = tradeIsNearEarnings(t, earningsDates);
      trades.push(t);
    }
  }

  const stats = aggregateStats(symbol, cfg, trades, prices);

  // Cap stored trades for payload size (keep most recent)
  const maxTrades = 80;
  const trimmed = trades.length > maxTrades ? trades.slice(-maxTrades) : trades;

  return { ...stats, trades: trimmed };
}

/** Run a full backtest across multiple symbols, using limited concurrency. */
export async function backtestSymbols(
  symbols: string[],
  cfg: BacktestConfig,
  years: number,
  concurrency = 4
): Promise<BacktestSymbolResult[]> {
  const results: BacktestSymbolResult[] = [];
  let idx = 0;
  const workers = Array.from({ length: Math.min(concurrency, symbols.length) }, async () => {
    while (true) {
      const i = idx++;
      if (i >= symbols.length) return;
      try {
        const r = await backtestSymbol(symbols[i], cfg, years);
        if (r) results.push(r);
      } catch (err) {
        // Swallow individual errors, continue.
        console.warn(`Backtest failed for ${symbols[i]}:`, (err as Error).message);
      }
    }
  });
  await Promise.all(workers);
  return results;
}

export const DEFAULT_BACKTEST_CONFIG: BacktestConfig = {
  strategy: "put_credit_spread",
  dte: 45,
  targetDelta: 30,
  spreadWidth: 5,
  takeProfitPct: 50,
  stopLossMult: 2,
  entryFrequencyDays: 5, // weekly entries
};

export const METHODOLOGY_NOTES: string[] = [
  "Simulated results — no real historical options prices used. Credits are derived from Black-Scholes + trailing 30-day realized volatility as an IV proxy.",
  "No bid-ask slippage, commissions, or assignment risk modeled. Real-world fills will be worse — haircut results by ~15–30%.",
  "Volatility skew ignored: real short-put IV is typically higher than long-put IV. This overestimates credits in high-vol regimes.",
  "Earnings-adjacent tagging relies on Yahoo's last ~4 reported earnings dates and may miss older events.",
  "Past performance ≠ future results. Top 20 most-actives today ≠ the universe 5 years ago (survivorship bias).",
  "Small sample sizes (<30 trades) are unreliable. Look for ≥50 trades before trusting stats on any individual symbol.",
];
