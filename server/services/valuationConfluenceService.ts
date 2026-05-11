/**
 * Confluence math for screener: Graham + DCF “value”, Keltner-style + anchored VWAP “buy”,
 * RSI + equity PCR “sell” hints. Heuristic / educational — not trading advice.
 */
import type { PriceDataPoint } from "../../shared/optionsSchema";
import type { Fundamentals } from "./fundamentalsService";
import type { PriceTargets } from "./priceTargetService";
import { calculateATR, calculateRSI, calculateSMA } from "./frameworkAnalysis";

const RSI_SELL = 70;
const PCR_COMPLACENCY = 0.5;

/** Graham V = EPS × (8.5 + 2g); g is whole-number growth % (0–12), per common textbook layout. */
export function computeGrahamIntrinsic(
  trailingEps: number | null,
  forwardEps: number | null,
  revenueGrowthYoy: number | null,
): { value: number | null; gPercentUsed: number | null } {
  const eps =
    trailingEps !== null && trailingEps > 0 && Number.isFinite(trailingEps)
      ? trailingEps
      : forwardEps !== null && forwardEps > 0 && Number.isFinite(forwardEps)
        ? forwardEps
        : null;
  if (eps === null) return { value: null, gPercentUsed: null };

  let gPct = 5;
  if (revenueGrowthYoy !== null && Number.isFinite(revenueGrowthYoy)) {
    gPct = Math.round(revenueGrowthYoy * 100);
  }
  gPct = Math.max(0, Math.min(12, gPct));

  const mult = 8.5 + 2 * gPct;
  return { value: eps * mult, gPercentUsed: gPct };
}

export function computeFundamentalValueZone(
  graham: number | null,
  simpleDcfPerShare: number | null,
): { low: number | null; high: number | null } {
  const vals = [graham, simpleDcfPerShare].filter((x): x is number => x != null && x > 0 && Number.isFinite(x));
  if (vals.length === 0) return { low: null, high: null };
  return { low: Math.min(...vals), high: Math.max(...vals) };
}

/** Typical-price VWAP from the highest-high bar in the series through last bar (anchored “swing high”). */
export function computeAnchoredVwapFromHighestBar(data: PriceDataPoint[]): number | null {
  if (data.length < 10) return null;
  const sorted = [...data].sort((a, b) => a.date.localeCompare(b.date));
  let maxIdx = 0;
  let maxHigh = sorted[0].high;
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].high > maxHigh) {
      maxHigh = sorted[i].high;
      maxIdx = i;
    }
  }
  let pv = 0;
  let vol = 0;
  for (let i = maxIdx; i < sorted.length; i++) {
    const b = sorted[i];
    const tp = (b.high + b.low + b.close) / 3;
    const v = b.volume > 0 ? b.volume : 0;
    if (v > 0) {
      pv += tp * v;
      vol += v;
    }
  }
  if (vol > 0) return pv / vol;
  let s = 0;
  let c = 0;
  for (let i = maxIdx; i < sorted.length; i++) {
    const b = sorted[i];
    s += (b.high + b.low + b.close) / 3;
    c++;
  }
  return c > 0 ? s / c : null;
}

/** Typical-price VWAP from the lowest-low bar in the series through last bar (anchored “significant low”). */
export function computeAnchoredVwapFromLowestBar(data: PriceDataPoint[]): number | null {
  if (data.length < 10) return null;
  const sorted = [...data].sort((a, b) => a.date.localeCompare(b.date));
  let minIdx = 0;
  let minLow = sorted[0].low;
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].low < minLow) {
      minLow = sorted[i].low;
      minIdx = i;
    }
  }
  let pv = 0;
  let vol = 0;
  for (let i = minIdx; i < sorted.length; i++) {
    const b = sorted[i];
    const tp = (b.high + b.low + b.close) / 3;
    const v = b.volume > 0 ? b.volume : 0;
    if (v > 0) {
      pv += tp * v;
      vol += v;
    }
  }
  if (vol > 0) return pv / vol;
  let s = 0;
  let c = 0;
  for (let i = minIdx; i < sorted.length; i++) {
    const b = sorted[i];
    s += (b.high + b.low + b.close) / 3;
    c++;
  }
  return c > 0 ? s / c : null;
}

/** Lower Keltner-style band: SMA(20, close) − 2×ATR(14). */
export function computeKeltnerLower(data: PriceDataPoint[]): number | null {
  if (data.length < 22) return null;
  const sorted = [...data].sort((a, b) => a.date.localeCompare(b.date));
  const closes = sorted.map((d) => d.close);
  const sma = calculateSMA(closes, 20);
  const atr = calculateATR(sorted, 14);
  if (sma === null || atr === null) return null;
  return sma - 2 * atr;
}

/** Upper Keltner-style band: SMA(20, close) + 2×ATR(14). */
export function computeKeltnerUpper(data: PriceDataPoint[]): number | null {
  if (data.length < 22) return null;
  const sorted = [...data].sort((a, b) => a.date.localeCompare(b.date));
  const closes = sorted.map((d) => d.close);
  const sma = calculateSMA(closes, 20);
  const atr = calculateATR(sorted, 14);
  if (sma === null || atr === null) return null;
  return sma + 2 * atr;
}

export function enrichPriceTargetsWithConfluence(
  pt: PriceTargets,
  f: Fundamentals,
  historical: PriceDataPoint[],
  putCallRatio: number | null,
): PriceTargets {
  const { value: graham, gPercentUsed } = computeGrahamIntrinsic(
    f.trailingEps,
    f.forwardEps,
    f.revenueGrowthYoy,
  );
  const { low: vfLow, high: vfHigh } = computeFundamentalValueZone(graham, pt.dcfFairValue);

  const keltner = computeKeltnerLower(historical);
  const avwapLow = computeAnchoredVwapFromLowestBar(historical);
  const keltnerUpper = computeKeltnerUpper(historical);
  const avwapHigh = computeAnchoredVwapFromHighestBar(historical);
  const sorted = [...historical].sort((a, b) => a.date.localeCompare(b.date));
  const closes = sorted.map((d) => d.close);
  const rsi = calculateRSI(closes, 14);

  const rsiSellTrigger = rsi !== null && rsi > RSI_SELL;
  const pcrSellTrigger = putCallRatio !== null && putCallRatio > 0 && putCallRatio < PCR_COMPLACENCY;

  return {
    ...pt,
    grahamIntrinsicValue: graham,
    grahamGrowthPercentUsed: gPercentUsed,
    valueZoneFundamentalLow: vfLow,
    valueZoneFundamentalHigh: vfHigh,
    buyZoneKeltnerLower: keltner,
    buyZoneAnchoredVwap: avwapLow,
    sellZoneKeltnerUpper: keltnerUpper,
    sellZoneAnchoredVwap: avwapHigh,
    rsi14: rsi,
    rsiSellTrigger,
    putCallRatio,
    pcrSellTrigger,
  };
}
