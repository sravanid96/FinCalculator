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

  /** EPS actually used to compute multiple bands (mid-cycle adjusted when needed). */
  epsUsedForBands: number | null;
  /** "forward" | "trailing" | "midCycle" — which EPS basis the bands used. */
  epsBasis: "forward" | "trailing" | "midCycle" | "none";
  /** True when forward and trailing EPS diverge enough to suggest cycle peak/trough. */
  cyclicalEarningsDetected: boolean;
  /** True when the multiple-bands method shouldn't be trusted at all. */
  multipleBandsReliable: boolean;

  asOf: string;
  methodNotes: string[];
  warnings: string[];
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

/**
 * Pick the EPS basis honestly. Cyclicals (memory, semis equipment) routinely show
 * forward EPS 3-10× trailing at cycle peaks, and 0.1-0.3× trailing at cycle troughs.
 * Applying ANY normal multiple to a peak or trough number gives garbage. So:
 *   - If forward and trailing EPS are within reasonable range → use forward.
 *   - If they diverge significantly → blend toward mid-cycle (geometric mean clamped).
 *   - If both are non-positive → no bands at all.
 */
function selectEpsForBands(f: Fundamentals): {
  eps: number | null;
  basis: "forward" | "trailing" | "midCycle" | "none";
  isCyclical: boolean;
  reliable: boolean;
  note: string | null;
} {
  const fwd = f.forwardEps;
  const ttm = f.trailingEps;

  const fwdValid = fwd !== null && fwd > 0 && Number.isFinite(fwd);
  const ttmValid = ttm !== null && ttm > 0 && Number.isFinite(ttm);

  if (!fwdValid && !ttmValid) {
    return { eps: null, basis: "none", isCyclical: false, reliable: false, note: null };
  }

  if (fwdValid && !ttmValid) {
    return {
      eps: fwd!,
      basis: "forward",
      isCyclical: false,
      reliable: true,
      note: "Trailing EPS unavailable or non-positive; forward EPS used as-is.",
    };
  }

  if (!fwdValid && ttmValid) {
    return {
      eps: ttm!,
      basis: "trailing",
      isCyclical: false,
      reliable: true,
      note: "Forward EPS unavailable; trailing EPS used (less responsive to cycle turns).",
    };
  }

  // Both valid — check divergence.
  const ratio = fwd! / ttm!;
  // Within 0.7×–1.6× counts as "stable" — normal growth/contraction, forward is fine.
  if (ratio >= 0.7 && ratio <= 1.6) {
    return { eps: fwd!, basis: "forward", isCyclical: false, reliable: true, note: null };
  }

  // Cyclical regime: blend toward mid-cycle. Geometric mean is the textbook
  // choice for normalizing series that swing multiplicatively.
  const mid = Math.sqrt(fwd! * ttm!);
  // If divergence is extreme (>4× either way), bands are still ~not meaningful even with mid-cycle EPS.
  const extreme = ratio > 4 || ratio < 0.25;

  let direction = ratio > 1 ? "above" : "below";
  return {
    eps: mid,
    basis: "midCycle",
    isCyclical: true,
    reliable: !extreme,
    note: `Cyclical earnings detected: forward EPS ${ratio.toFixed(2)}× trailing (${direction} TTM). Bands now use mid-cycle EPS = √(fwd × ttm) = ${mid.toFixed(2)} to avoid pricing peak/trough as steady state.${extreme ? " Divergence is extreme — bands still low-confidence." : ""}`,
  };
}

function multipleBandFairValue(eps: number, multiple: number): number {
  return eps * multiple;
}

export function computePriceTargets(f: Fundamentals, cal: MarketCalibration): PriceTargets {
  const notes: string[] = [...cal.notes];
  const warnings: string[] = [];
  const price = f.price;

  const analystMean = f.analystTargetMean;
  const analystImpliedUpsidePct =
    price && price > 0 && analystMean ? (analystMean - price) / price : null;

  if (analystMean === null) notes.push("No analyst consensus available from Yahoo.");
  else if (f.analystCount !== null && f.analystCount < 5) {
    notes.push(`Thin analyst coverage (n=${f.analystCount}); consensus less reliable.`);
  }

  // ── Multiple bands ───────────────────────────────────────────────────────
  // Pick honest EPS (mid-cycle for cyclicals) and tighten multiples for cyclical regimes.
  const sel = selectEpsForBands(f);
  if (sel.note) notes.push(sel.note);

  // For cyclicals, compress the multiple range — peak/trough EPS deserves a
  // tighter band, not a heroic 9–27× spread. Memory/semis cyclicals historically
  // trade 8–18× mid-cycle EPS, not 27× peak EPS.
  let m = cal.multiples;
  if (sel.isCyclical) {
    const tighterBase = Math.min(m.base, 14);
    m = {
      bear: Math.max(7, tighterBase - 4),
      base: tighterBase,
      bull: Math.min(20, tighterBase + 5),
    };
    notes.push(
      `Cyclical multiple compression applied: bands now ${m.bear}× / ${m.base}× / ${m.bull}× (was ${cal.multiples.bear}× / ${cal.multiples.base}× / ${cal.multiples.bull}×) — peak/trough EPS rarely sustains secular-style multiples.`,
    );
  }

  let bear: number | null = null;
  let base: number | null = null;
  let bull: number | null = null;

  if (sel.eps !== null) {
    bear = multipleBandFairValue(sel.eps, m.bear);
    base = multipleBandFairValue(sel.eps, m.base);
    bull = multipleBandFairValue(sel.eps, m.bull);
    notes.push(
      `Multiple bands: ${sel.basis} EPS (${sel.eps.toFixed(2)}) × ${m.bear}× / ${m.base}× / ${m.bull}×. Anchors only.`,
    );
  } else {
    if (f.forwardEps === null && f.trailingEps === null) {
      notes.push("No EPS available — multiple bands skipped.");
    } else {
      notes.push("EPS ≤ 0 (loss-making) — multiple-based fair value not meaningful.");
    }
  }

  if (sel.isCyclical) {
    warnings.push(
      sel.reliable
        ? "Cyclical earnings detected (forward vs trailing EPS diverge). Bands use mid-cycle EPS, but treat as low-confidence."
        : "EXTREME cycle divergence — multiple-band fair values are unreliable. Lean on analyst consensus and your view of where the cycle is.",
    );
  }

  // ── DCF ─────────────────────────────────────────────────────────────────
  const dcf = simpleDcfFairValue(f, cal.dcfDiscountRate);
  if (dcf === null) {
    if (f.fcf === null || f.fcf <= 0) {
      notes.push("DCF skipped: no positive TTM FCF (common for cyclicals near trough or heavy capex names).");
    } else if (!f.sharesOutstanding) {
      notes.push("DCF skipped: no shares outstanding.");
    }
  } else {
    notes.push(
      `Simple DCF: discount ${(cal.dcfDiscountRate * 100).toFixed(2)}% (10Y-linked), growth = capped revenue YoY (max 6%). Rule-of-thumb only.`,
    );
  }

  // Sanity check: if DCF differs from base by >5×, something is off (TTM FCF noise
  // or cyclical mismatch). Don't silently feed it into the blend.
  let dcfForBlend: number | null = dcf;
  if (dcf !== null && base !== null && (dcf > base * 5 || dcf < base / 5)) {
    notes.push(
      `DCF (${dcf.toFixed(0)}) differs from base multiple (${base.toFixed(0)}) by >5×; DCF excluded from blend.`,
    );
    dcfForBlend = null;
  }

  // ── Blended fair value ─────────────────────────────────────────────────
  // Weight analyst consensus heaviest for cyclicals (analysts price in cycles);
  // weight base multiple heaviest for stable names; downweight a sketchy DCF.
  let blended: number | null = null;
  const weighted: Array<{ v: number; w: number; label: string }> = [];

  if (analystMean !== null && analystMean > 0) {
    weighted.push({ v: analystMean, w: sel.isCyclical ? 0.6 : 0.45, label: "analyst" });
  }
  if (base !== null && base > 0) {
    weighted.push({ v: base, w: sel.isCyclical ? 0.25 : 0.4, label: "base" });
  }
  if (dcfForBlend !== null && dcfForBlend > 0) {
    weighted.push({ v: dcfForBlend, w: sel.isCyclical ? 0.15 : 0.15, label: "dcf" });
  }

  if (weighted.length > 0) {
    const totalW = weighted.reduce((a, x) => a + x.w, 0);
    blended = weighted.reduce((a, x) => a + x.v * x.w, 0) / totalW;

    // Cap blended fair value at 3× current price — anything beyond that is
    // either wrong or a bet on something the model can't see.
    if (price && price > 0 && blended > price * 3) {
      notes.push(
        `Blended (${blended.toFixed(0)}) capped at 3× current price (${(price * 3).toFixed(0)}); raw value reflects peak-EPS distortion.`,
      );
      blended = price * 3;
    }
  }

  const blendedImpliedUpsidePct = price && price > 0 && blended ? (blended - price) / price : null;

  if (weighted.length < 2) {
    notes.push(
      `Blended target uses only ${weighted.length} method(s). Treat as low-confidence.`,
    );
  } else {
    notes.push(
      `Blended weights (${sel.isCyclical ? "cyclical" : "stable"}): ${weighted
        .map((x) => `${x.label} ${(x.w * 100).toFixed(0)}%`)
        .join(", ")}.`,
    );
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
    epsUsedForBands: sel.eps,
    epsBasis: sel.basis,
    cyclicalEarningsDetected: sel.isCyclical,
    multipleBandsReliable: sel.reliable,
    asOf: new Date().toISOString(),
    methodNotes: notes,
    warnings,
    calibration: cal,
  };
}
