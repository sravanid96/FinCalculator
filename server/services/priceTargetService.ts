import type { Fundamentals } from "./fundamentalsService";
import type { MarketCalibration } from "./marketCalibrationService";

/**
 * Price target estimation. THREE distinct numbers, never one false-precision target.
 *
 *  1. Analyst consensus  — real Yahoo data, just pulled & shown.
 *  2. Multiple bands     — forwardEPS × yield- and universe-calibrated multiples.
 *  3. Simple DCF         — FCF perpetuity; discount rate tracks 10Y + ERP (clamped).
 */

export interface PriceTargets {
  analystMean: number | null;
  analystHigh: number | null;
  analystLow: number | null;
  analystMedian: number | null;
  analystCount: number | null;
  analystImpliedUpsidePct: number | null;
  recommendationMean: number | null;
  recommendationLabel: string | null;

  bearFairValue: number | null;
  baseFairValue: number | null;
  bullFairValue: number | null;

  dcfFairValue: number | null;

  blendedFairValue: number | null;
  blendedImpliedUpsidePct: number | null;

  asOf: string;
  methodNotes: string[];
  /** Macro + universe inputs used for bands and DCF (Fed/yields/semis tilt). */
  calibration: MarketCalibration;
}

function toRecommendationLabel(rec: number | null): string | null {
  if (rec === null) return null;
  if (rec <= 1.5) return "Strong Buy";
  if (rec <= 2.5) return "Buy";
  if (rec <= 3.5) return "Hold";
  if (rec <= 4.5) return "Underperform";
  return "Sell";
}

function simpleDcfFairValue(f: Fundamentals, discountRate: number): number | null {
  const fcf = f.fcf;
  const shares = f.sharesOutstanding;
  if (fcf === null || fcf <= 0 || !shares || shares <= 0) return null;

  const r = discountRate;
  let g = f.revenueGrowthYoy ?? 0.03;
  if (g > 0.06) g = 0.06;
  if (g < -0.05) g = -0.05;
  if (r - g <= 0.01) return null;

  const enterpriseValue = (fcf * (1 + g)) / (r - g);
  return enterpriseValue / shares;
}

function multipleBandFairValue(f: Fundamentals, multiple: number): number | null {
  const eps = f.forwardEps ?? f.trailingEps;
  if (eps === null || eps <= 0) return null;
  return eps * multiple;
}

export function computePriceTargets(f: Fundamentals, cal: MarketCalibration): PriceTargets {
  const notes: string[] = [...cal.notes];
  const price = f.price;
  const m = cal.multiples;

  const analystMean = f.analystTargetMean;
  const analystImpliedUpsidePct =
    price && price > 0 && analystMean ? (analystMean - price) / price : null;

  if (analystMean === null) notes.push("No analyst consensus available from Yahoo.");
  else if (f.analystCount !== null && f.analystCount < 5) {
    notes.push(`Thin analyst coverage (n=${f.analystCount}); consensus less reliable.`);
  }

  const bear = multipleBandFairValue(f, m.bear);
  const base = multipleBandFairValue(f, m.base);
  const bull = multipleBandFairValue(f, m.bull);

  if (bear === null) {
    if (f.forwardEps === null && f.trailingEps === null) {
      notes.push("No EPS available — multiple bands skipped.");
    } else if ((f.forwardEps ?? f.trailingEps ?? 0) <= 0) {
      notes.push("EPS ≤ 0 (loss-making) — multiple-based fair value not meaningful.");
    }
  } else {
    notes.push(
      `Multiple bands: forward EPS × ${m.bear}× / ${m.base}× / ${m.bull}× (calibrated to 10Y + universe). Anchors only.`,
    );
  }

  const dcf = simpleDcfFairValue(f, cal.dcfDiscountRate);
  if (dcf === null) {
    if (f.fcf === null || f.fcf <= 0) notes.push("DCF skipped: no positive TTM FCF.");
    else if (!f.sharesOutstanding) notes.push("DCF skipped: no shares outstanding.");
  } else {
    notes.push(
      `Simple DCF: discount ${(cal.dcfDiscountRate * 100).toFixed(2)}% (10Y-linked), growth = capped revenue YoY (max 6%). Rule-of-thumb only.`,
    );
  }

  const candidates = [analystMean, base, dcf].filter((v): v is number => v !== null && v > 0);
  const blended = candidates.length > 0 ? candidates.reduce((a, b) => a + b, 0) / candidates.length : null;
  const blendedImpliedUpsidePct = price && price > 0 && blended ? (blended - price) / price : null;

  if (candidates.length < 2) {
    notes.push(`Blended target uses only ${candidates.length} method(s). Treat as low-confidence.`);
  }

  return {
    analystMean,
    analystHigh: f.analystTargetHigh,
    analystLow: f.analystTargetLow,
    analystMedian: f.analystTargetMedian,
    analystCount: f.analystCount,
    analystImpliedUpsidePct,
    recommendationMean: f.recommendationMean,
    recommendationLabel: toRecommendationLabel(f.recommendationMean),
    bearFairValue: bear,
    baseFairValue: base,
    bullFairValue: bull,
    dcfFairValue: dcf,
    blendedFairValue: blended,
    blendedImpliedUpsidePct,
    asOf: new Date().toISOString(),
    methodNotes: notes,
    calibration: cal,
  };
}
