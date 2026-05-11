import type { Fundamentals } from "./fundamentalsService";
import { computePriceTargets, type PriceTargets } from "./priceTargetService";
import type { MarketCalibration } from "./marketCalibrationService";
import {
  effectiveLeverageCaps,
  mapStrategicBucket,
  type StrategicBucketId,
} from "./strategicBucketService";

export type Tier = "BEST" | "STRONG" | "WATCH" | "AVOID";

export interface QualityDiscountRow {
  rank: number;
  symbol: string;
  name: string;
  roic: number | null;
  fcfMargin: number | null;
  netDebtToEbitda: number | null;
  revenueGrowthYoy: number | null;
  pctOff52WeekHigh: number | null;
  forwardPE: number | null;
  trailingPE: number | null;
  qualityPoints: number;       // 0..80
  discountPoints: number;      // 0..20
  score: number;               // 0..100
  tier: Tier;
  passes: {
    roic15: boolean | null;
    fcfPositive: boolean | null;
    netDebtUnder2x: boolean | null;
    revenueGrowing: boolean | null;
    off52wMin15: boolean | null;
    fwdPELessThanTrailing: boolean | null;
  };
  // Earnings-informed action label (simple rules; not investment advice).
  action: "ENTRY" | "HOLD" | "EXIT";
  actionChecklist: Array<{ label: string; pass: boolean | null; detail?: string | null }>;
  actionWhy: string;
  thesisHook: string;          // long-term role description (curated, stable)
  dynamicHook: string;          // data-derived snapshot built from current fundamentals
  priceTargets: PriceTargets;  // analyst consensus + multiple bands + simple DCF
  currentPrice: number | null;
  insufficientFlags: string[]; // which fields were null
  strategicBucketId: StrategicBucketId;
  strategicBucketLabel: string;
}

const tierFor = (s: number): Tier =>
  s >= 80 ? "BEST" : s >= 65 ? "STRONG" : s >= 50 ? "WATCH" : "AVOID";

export function scoreQualityDiscount(f: Fundamentals): Omit<QualityDiscountRow, "rank" | "thesisHook" | "dynamicHook" | "priceTargets" | "currentPrice"> {
  const insufficientFlags: string[] = [];

  const passes = {
    roic15: f.roic === null ? null : f.roic >= 0.15,
    fcfPositive: f.fcf === null ? null : f.fcf > 0,
    netDebtUnder2x: f.netDebtToEbitda === null ? null : f.netDebtToEbitda < 2,
    revenueGrowing: f.revenueGrowthYoy === null ? null : f.revenueGrowthYoy > 0,
    off52wMin15: f.pctOff52WeekHigh === null ? null : f.pctOff52WeekHigh <= -0.15,
    fwdPELessThanTrailing:
      f.forwardPE === null || f.trailingPE === null
        ? null
        : f.forwardPE < f.trailingPE && f.forwardPE > 0,
  };

  const flag = (k: string, v: boolean | null) => {
    if (v === null) insufficientFlags.push(k);
  };
  flag("roic", passes.roic15);
  flag("fcf", passes.fcfPositive);
  flag("netDebt", passes.netDebtUnder2x);
  flag("revGrowth", passes.revenueGrowing);
  flag("offHigh", passes.off52wMin15);
  flag("forwardPE", passes.fwdPELessThanTrailing);

  const qualityPoints =
    (passes.roic15 ? 20 : 0) +
    (passes.fcfPositive ? 20 : 0) +
    (passes.netDebtUnder2x ? 20 : 0) +
    (passes.revenueGrowing ? 20 : 0);

  const discountPoints =
    (passes.off52wMin15 ? 10 : 0) + (passes.fwdPELessThanTrailing ? 10 : 0);

  const score = qualityPoints + discountPoints;

  // ───────────────────────────────────────────────────────────────────────────
  // Earnings action (ENTRY/HOLD/EXIT)
  // Rule: use latest reported EPS beat + QoQ EPS/revenue momentum.
  // - ENTRY: good tier (BEST/STRONG), EPS beat, and (EPS up QoQ OR revenue up QoQ)
  // - EXIT: EPS miss AND (EPS down QoQ OR revenue down QoQ) OR leverage red flag (netDebt/EBITDA >= 4)
  // - HOLD: everything else / insufficient data
  // Note: We intentionally avoid “guidance” since Yahoo quoteSummary doesn’t provide it reliably.
  const bucket = mapStrategicBucket(f);
  const { entryMaxLeverage, exitLeverage, maintenanceApplied, capexToEbitda } = effectiveLeverageCaps(f, bucket);

  const epsSurprise = f.earnings?.eps?.latest?.surprisePct ?? null;
  const epsQoq = f.earnings?.epsQoqGrowth ?? null;
  const revQoq = f.earnings?.revenue?.qoqGrowth ?? null;
  const grossDeltaPp = f.earnings?.margins?.grossMarginDeltaPp ?? null;

  // Thresholds (noise-filter):
  // ENTRY: EPS surprise >= +5%, EPS QoQ >= +10%, revenue QoQ >= +10%, and leverage below entry cap
  // EXIT: EPS surprise <= -3% AND revenue QoQ < 0 (double-miss proxy) OR gross margin down >200 bps QoQ OR leverage above exit cap
  const epsBeat5 = epsSurprise === null ? null : epsSurprise >= 0.05;
  const epsMiss3 = epsSurprise === null ? null : epsSurprise <= -0.03;
  const epsGrow10 = epsQoq === null ? null : epsQoq >= 0.10;
  const revGrow10 = revQoq === null ? null : revQoq >= 0.10;
  const revNegative = revQoq === null ? null : revQoq < 0;
  const grossMarginDown200bp = grossDeltaPp === null ? null : grossDeltaPp <= -2.0;
  const leverageOkForEntry = f.netDebtToEbitda === null ? null : f.netDebtToEbitda < entryMaxLeverage;
  const leverageExit = f.netDebtToEbitda === null ? null : f.netDebtToEbitda >= exitLeverage;

  // Valuation cutoff: forward P/E > 20% above its 5y average => don't ENTRY (at most HOLD).
  const fpeOver20Pct = f.forwardPE === null || f.forwardPe5yAvg === null
    ? null
    : f.forwardPe5yAvg > 0 && f.forwardPE > 1.2 * f.forwardPe5yAvg;

  // Stress tests (best-effort proxies) — thresholds from strategic bucket.
  const fcfConv = f.fcfConversion;
  const fcfFloor = bucket.fcfConversionEntryMin;
  const fcfConvOkForEntry =
    fcfFloor === null ? null : fcfConv === null ? null : fcfConv >= fcfFloor;
  const dscr = f.dscrApprox;
  const dscrFloor = bucket.dscrFloor;
  const dscrOk = dscr === null ? null : dscr >= dscrFloor;
  const payback = f.impliedPaybackYears;
  const paybackMax = bucket.paybackMaxYears;
  const paybackOk =
    paybackMax === null ? null : payback === null ? null : payback <= paybackMax;
  const tier = tierFor(score);
  const tierOk = tier === "BEST" || tier === "STRONG";

  let action: QualityDiscountRow["action"] = "HOLD";
  const hardExit =
    leverageExit === true ||
    grossMarginDown200bp === true ||
    (epsMiss3 === true && revNegative === true); // double miss proxy
  const entryOk =
    tierOk &&
    leverageOkForEntry === true &&
    epsBeat5 === true &&
    epsGrow10 === true &&
    revGrow10 === true &&
    fpeOver20Pct !== true &&
    (fcfConvOkForEntry !== false) &&
    dscrOk !== false &&
    paybackOk !== false;
  if (hardExit) action = "EXIT";
  else if (entryOk) action = "ENTRY";

  const actionChecklist: QualityDiscountRow["actionChecklist"] = [
    { label: "Tier is BEST/STRONG", pass: tierOk, detail: tier },
    {
      label: "EPS surprise ≥ +5%",
      pass: epsBeat5,
      detail: epsSurprise === null ? null : `${(epsSurprise * 100).toFixed(1)}% (${f.earnings?.eps?.latest?.quarterEnd ?? ""})`,
    },
    {
      label: "EPS QoQ growth ≥ +10%",
      pass: epsGrow10,
      detail: epsQoq === null ? null : `${(epsQoq * 100).toFixed(1)}%`,
    },
    {
      label: "Revenue QoQ growth ≥ +10%",
      pass: revGrow10,
      detail: revQoq === null ? null : `${(revQoq * 100).toFixed(1)}%`,
    },
    {
      label: "Forward P/E not >20% above 5y avg",
      pass: fpeOver20Pct === null ? null : !fpeOver20Pct,
      detail:
        f.forwardPE === null || f.forwardPe5yAvg === null
          ? null
          : `Fwd ${f.forwardPE.toFixed(1)} vs 5y avg ${f.forwardPe5yAvg.toFixed(1)}`,
    },
    {
      label: `NetDebt/EBITDA < ${entryMaxLeverage.toFixed(1)}x (bucket entry cap)`,
      pass: leverageOkForEntry,
      detail:
        f.netDebtToEbitda === null
          ? null
          : `${f.netDebtToEbitda.toFixed(2)}x · exit red-flag ≥${exitLeverage.toFixed(1)}x · ${bucket.label}${
              maintenanceApplied && capexToEbitda != null
                ? ` · high CapEx/EBITDA (${(capexToEbitda * 100).toFixed(0)}%) tightened cap`
                : ""
            }`,
    },
    {
      label: `DSCR proxy (FCF/Interest) ≥ ${dscrFloor.toFixed(1)}x`,
      pass: dscrOk,
      detail: dscr === null ? null : `${dscr.toFixed(2)}x`,
    },
    {
      label:
        fcfFloor === null
          ? "FCF/EBITDA entry floor (not required for this bucket)"
          : `FCF/EBITDA ≥ ${(fcfFloor * 100).toFixed(0)}% (${bucket.label})`,
      pass: fcfConvOkForEntry,
      detail: fcfConv === null ? null : `${(fcfConv * 100).toFixed(0)}%`,
    },
    {
      label:
        paybackMax === null
          ? "Debt/FCF payback cap (not required for this bucket)"
          : `Debt/FCF payback ≤ ${paybackMax}y (${bucket.label})`,
      pass: paybackOk,
      detail: payback === null ? null : `${payback.toFixed(1)}y`,
    },
    {
      label: "Gross margin not down >200 bps QoQ",
      pass: grossMarginDown200bp === null ? null : !grossMarginDown200bp,
      detail: grossDeltaPp === null ? null : `${grossDeltaPp.toFixed(2)} pp`,
    },
  ];

  const fmtPct = (v: number | null, digits = 1) =>
    v === null || Number.isNaN(v) ? null : `${(v * 100).toFixed(digits)}%`;

  let actionWhy = "Mixed/insufficient confirmation vs cutoffs (needs clean beat + QoQ acceleration).";
  if (action === "ENTRY") {
    actionWhy =
      `EPS surprise ${fmtPct(epsSurprise, 1)} (≥5%) · ` +
      `EPS QoQ ${fmtPct(epsQoq, 1)} (≥10%) · ` +
      `Rev QoQ ${fmtPct(revQoq, 1)} (≥10%) · ` +
      `NetDebt/EBITDA ${f.netDebtToEbitda?.toFixed(2) ?? "—"}x (<${entryMaxLeverage.toFixed(1)}x · ${bucket.label})`;
  } else if (action === "EXIT") {
    const bits: string[] = [];
    if (leverageExit === true) bits.push(`Leverage ≥${exitLeverage.toFixed(1)}x (${f.netDebtToEbitda?.toFixed(2)}x)`);
    if (grossMarginDown200bp === true) bits.push(`Gross margin down ${grossDeltaPp?.toFixed(2)}pp`);
    if (epsMiss3 === true && revNegative === true) bits.push(`EPS miss ${fmtPct(epsSurprise, 1)} + Rev QoQ ${fmtPct(revQoq, 1)}`);
    actionWhy = bits.join(" · ") || "Fundamentals deteriorated vs exit cutoffs.";
  } else {
    const bits: string[] = [];
    if (epsSurprise !== null) bits.push(`EPS surprise ${fmtPct(epsSurprise, 1)}`);
    if (epsQoq !== null) bits.push(`EPS QoQ ${fmtPct(epsQoq, 1)}`);
    if (revQoq !== null) bits.push(`Rev QoQ ${fmtPct(revQoq, 1)}`);
    if (grossDeltaPp !== null) bits.push(`GM Δ ${grossDeltaPp.toFixed(2)}pp`);
    if (f.netDebtToEbitda !== null) bits.push(`ND/EBITDA ${f.netDebtToEbitda.toFixed(2)}x`);
    actionWhy = bits.join(" · ") || actionWhy;
  }

  return {
    symbol: f.symbol,
    name: f.name,
    roic: f.roic,
    fcfMargin: f.fcfMargin,
    netDebtToEbitda: f.netDebtToEbitda,
    revenueGrowthYoy: f.revenueGrowthYoy,
    pctOff52WeekHigh: f.pctOff52WeekHigh,
    forwardPE: f.forwardPE,
    trailingPE: f.trailingPE,
    qualityPoints,
    discountPoints,
    score,
    tier: tierFor(score),
    passes,
    action,
    actionChecklist,
    actionWhy,
    insufficientFlags,
    strategicBucketId: bucket.id,
    strategicBucketLabel: bucket.label,
  };
}

/** Build a one-line, data-derived hook from live fundamentals — the
 * "what does the snapshot say RIGHT NOW" companion to the long-term role hook. */
export function buildDynamicHook(f: import("./fundamentalsService").Fundamentals): string {
  const parts: string[] = [];
  const pct = (v: number | null, d = 0) =>
    v === null ? null : `${(v * 100).toFixed(d)}%`;

  // Quality character
  if (f.roic !== null) {
    if (f.roic >= 0.3) parts.push(`ROIC ${pct(f.roic)} (elite)`);
    else if (f.roic >= 0.15) parts.push(`ROIC ${pct(f.roic)}`);
    else if (f.roic >= 0.05) parts.push(`ROIC ${pct(f.roic)} (sub-cost-of-capital)`);
    else parts.push(`ROIC ${pct(f.roic)} (destroying value)`);
  }

  if (f.fcfMargin !== null) {
    if (f.fcfMargin >= 0.25) parts.push(`FCF margin ${pct(f.fcfMargin)} (cash machine)`);
    else if (f.fcfMargin >= 0.1) parts.push(`FCF margin ${pct(f.fcfMargin)}`);
    else if (f.fcfMargin > 0) parts.push(`FCF margin ${pct(f.fcfMargin)} (thin)`);
    else parts.push(`FCF negative`);
  }

  if (f.revenueGrowthYoy !== null) {
    if (f.revenueGrowthYoy >= 0.4) parts.push(`Revenue +${pct(f.revenueGrowthYoy)} YoY (hyper-growth)`);
    else if (f.revenueGrowthYoy >= 0.15) parts.push(`Revenue +${pct(f.revenueGrowthYoy)} YoY`);
    else if (f.revenueGrowthYoy > 0) parts.push(`Revenue +${pct(f.revenueGrowthYoy)} YoY (decelerating)`);
    else if (f.revenueGrowthYoy > -0.1) parts.push(`Revenue ${pct(f.revenueGrowthYoy)} YoY (flat-to-down)`);
    else parts.push(`Revenue ${pct(f.revenueGrowthYoy)} YoY (contracting)`);
  }

  // Balance sheet character
  if (f.netDebtToEbitda !== null) {
    if (f.netDebtToEbitda < 0) parts.push(`Net cash`);
    else if (f.netDebtToEbitda < 1) parts.push(`Net debt/EBITDA ${f.netDebtToEbitda.toFixed(1)}x (clean)`);
    else if (f.netDebtToEbitda < 2) parts.push(`Net debt/EBITDA ${f.netDebtToEbitda.toFixed(1)}x`);
    else if (f.netDebtToEbitda < 4) parts.push(`Net debt/EBITDA ${f.netDebtToEbitda.toFixed(1)}x (levered)`);
    else parts.push(`Net debt/EBITDA ${f.netDebtToEbitda.toFixed(1)}x (over-levered)`);
  }

  // Valuation / discount character
  if (f.pctOff52WeekHigh !== null) {
    const off = f.pctOff52WeekHigh; // negative
    if (off <= -0.4) parts.push(`${pct(off)} off 52w high (deep drawdown)`);
    else if (off <= -0.2) parts.push(`${pct(off)} off 52w high`);
    else if (off <= -0.05) parts.push(`${pct(off)} off 52w high`);
    else parts.push(`At/near 52w high`);
  }

  if (f.forwardPE !== null && f.trailingPE !== null) {
    if (f.forwardPE > 0 && f.forwardPE < f.trailingPE) {
      const compression = ((f.trailingPE - f.forwardPE) / f.trailingPE) * 100;
      parts.push(`Fwd P/E ${f.forwardPE.toFixed(0)} vs trailing ${f.trailingPE.toFixed(0)} (Es expanding ${compression.toFixed(0)}%)`);
    } else if (f.forwardPE > f.trailingPE) {
      parts.push(`Fwd P/E ${f.forwardPE.toFixed(0)} > trailing ${f.trailingPE.toFixed(0)} (Es contracting — be careful)`);
    }
  } else if (f.forwardPE !== null && f.forwardPE > 0) {
    parts.push(`Fwd P/E ${f.forwardPE.toFixed(0)}`);
  }

  return parts.join(" • ");
}

const EMPTY_FUNDAMENTALS: import("./fundamentalsService").Fundamentals = {
  symbol: "",
  name: "",
  sector: null,
  industry: null,
  marketCap: null,
  price: null,
  high52Week: null,
  pctOff52WeekHigh: null,
  roic: null,
  fcf: null,
  fcfMargin: null,
  netDebtToEbitda: null,
  revenueGrowthYoy: null,
  trailingPE: null,
  forwardPE: null,
  forwardPe5yAvg: null,
  priceToBook: null,
  evToSales: null,
  ebitdaMargin: null,
  analystTargetMean: null,
  analystTargetHigh: null,
  analystTargetLow: null,
  analystTargetMedian: null,
  analystCount: null,
  recommendationMean: null,
  forwardEps: null,
  trailingEps: null,
  sharesOutstanding: null,
  ttmRevenue: null,
  ttmEbitda: null,
  ttmOperatingCashFlow: null,
  ttmCapex: null,
  ttmInterestExpense: null,
  totalDebt: null,
  cashAndEquivalents: null,
  dscrApprox: null,
  impliedPaybackYears: null,
  fcfConversion: null,
  earnings: {
    eps: { latest: null, prior: null },
    epsQoqGrowth: null,
    revenue: { latest: null, prior: null, qoqGrowth: null },
    margins: { latest: null, prior: null, grossMarginDeltaPp: null, operatingMarginDeltaPp: null },
    notes: [],
  },
  notes: [],
};

export function rankQualityDiscount(
  rows: Array<Omit<QualityDiscountRow, "rank" | "thesisHook" | "dynamicHook" | "priceTargets" | "currentPrice">>,
  hooks: Record<string, string>,
  fundamentalsBySymbol: Record<string, import("./fundamentalsService").Fundamentals>,
  calibration: MarketCalibration,
): QualityDiscountRow[] {
  const sorted = [...rows].sort((a, b) => b.score - a.score);
  return sorted.map((r, i) => {
    const f = fundamentalsBySymbol[r.symbol];
    const stub = { ...EMPTY_FUNDAMENTALS, symbol: r.symbol, name: r.name };
    return {
      ...r,
      rank: i + 1,
      thesisHook: hooks[r.symbol] || "",
      dynamicHook: f ? buildDynamicHook(f) : "",
      priceTargets: f ? computePriceTargets(f, calibration) : computePriceTargets(stub, calibration),
      currentPrice: f?.price ?? null,
    };
  });
}

// =============================================================================
// Cyclical-trough scoring (the SanDisk/MU/AAOI playbook)
// =============================================================================
// Different game. Deliberately INVERTS some of the quality logic.
// Looking for businesses that look temporarily broken: low P/B vs history,
// stock far off highs, EBITDA margin compressed, debt elevated. We can't
// fully verify "industry capex cut" or "destocking ending" from Yahoo alone —
// flagged in notes.

export interface CyclicalTroughRow {
  rank: number;
  symbol: string;
  name: string;
  pctOff52WeekHigh: number | null;
  priceToBook: number | null;
  evToSales: number | null;
  ebitdaMargin: number | null;
  netDebtToEbitda: number | null;
  revenueGrowthYoy: number | null;
  troughScore: number; // 0..100
  signal: "early" | "watch" | "not_yet" | "missed";
  rationale: string[];
  insufficientFlags: string[];
}

export function scoreCyclicalTrough(f: Fundamentals): Omit<CyclicalTroughRow, "rank"> {
  const rationale: string[] = [];
  const insufficientFlags: string[] = [];
  let pts = 0;

  // 1. Stock 30%+ off 52w high (true trough sign — quality screen used 15%)
  if (f.pctOff52WeekHigh === null) insufficientFlags.push("offHigh");
  else if (f.pctOff52WeekHigh <= -0.4) {
    pts += 30;
    rationale.push(`${(f.pctOff52WeekHigh * 100).toFixed(0)}% off 52w high (deep drawdown)`);
  } else if (f.pctOff52WeekHigh <= -0.3) {
    pts += 20;
    rationale.push(`${(f.pctOff52WeekHigh * 100).toFixed(0)}% off 52w high`);
  } else if (f.pctOff52WeekHigh <= -0.2) {
    pts += 10;
  }

  // 2. P/B compressed — under 2 is generally a sign for hardware/cyclicals
  if (f.priceToBook === null) insufficientFlags.push("priceToBook");
  else if (f.priceToBook < 1.5) {
    pts += 25;
    rationale.push(`P/B ${f.priceToBook.toFixed(2)} (below replacement)`);
  } else if (f.priceToBook < 2.5) {
    pts += 15;
    rationale.push(`P/B ${f.priceToBook.toFixed(2)} (compressed)`);
  } else if (f.priceToBook < 4) {
    pts += 5;
  }

  // 3. EV/Sales depressed
  if (f.evToSales === null) insufficientFlags.push("evToSales");
  else if (f.evToSales < 1.5) {
    pts += 15;
    rationale.push(`EV/Sales ${f.evToSales.toFixed(2)} (cheap on revenue)`);
  } else if (f.evToSales < 3) {
    pts += 8;
  }

  // 4. EBITDA margin compressed (cycle bottom signal)
  if (f.ebitdaMargin === null) insufficientFlags.push("ebitdaMargin");
  else if (f.ebitdaMargin < 0.05) {
    pts += 15;
    rationale.push(`EBITDA margin ${(f.ebitdaMargin * 100).toFixed(1)}% (compressed — cycle low candidate)`);
  } else if (f.ebitdaMargin < 0.15) {
    pts += 8;
  } else if (f.ebitdaMargin > 0.3) {
    pts -= 10; // already too healthy — not a trough
    rationale.push(`EBITDA margin ${(f.ebitdaMargin * 100).toFixed(1)}% — likely not at cycle bottom`);
  }

  // 5. Revenue growth has rolled over (negative or flat) — destocking signal
  if (f.revenueGrowthYoy === null) insufficientFlags.push("revGrowth");
  else if (f.revenueGrowthYoy < -0.1) {
    pts += 15;
    rationale.push(`Revenue ${(f.revenueGrowthYoy * 100).toFixed(0)}% YoY (deep contraction — bottom forming?)`);
  } else if (f.revenueGrowthYoy < 0) {
    pts += 8;
    rationale.push(`Revenue ${(f.revenueGrowthYoy * 100).toFixed(0)}% YoY`);
  } else if (f.revenueGrowthYoy > 0.2) {
    pts -= 10; // already accelerating, the easy money already moved
    rationale.push(`Revenue +${(f.revenueGrowthYoy * 100).toFixed(0)}% YoY — cycle likely not at trough`);
  }

  pts = Math.max(0, Math.min(100, pts));

  let signal: CyclicalTroughRow["signal"] = "not_yet";
  if (pts >= 60) signal = "early";
  else if (pts >= 40) signal = "watch";
  else if (f.pctOff52WeekHigh !== null && f.pctOff52WeekHigh > -0.1 && f.revenueGrowthYoy !== null && f.revenueGrowthYoy > 0.2) {
    signal = "missed";
  }

  return {
    symbol: f.symbol,
    name: f.name,
    pctOff52WeekHigh: f.pctOff52WeekHigh,
    priceToBook: f.priceToBook,
    evToSales: f.evToSales,
    ebitdaMargin: f.ebitdaMargin,
    netDebtToEbitda: f.netDebtToEbitda,
    revenueGrowthYoy: f.revenueGrowthYoy,
    troughScore: pts,
    signal,
    rationale,
    insufficientFlags,
  };
}

export function rankCyclicalTrough(rows: Array<Omit<CyclicalTroughRow, "rank">>): CyclicalTroughRow[] {
  return [...rows]
    .sort((a, b) => b.troughScore - a.troughScore)
    .map((r, i) => ({ ...r, rank: i + 1 }));
}
