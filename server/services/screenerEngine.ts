import type { Fundamentals } from "./fundamentalsService";
import { computePriceTargets, type PriceTargets } from "./priceTargetService";
import type { MarketCalibration } from "./marketCalibrationService";

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
  thesisHook: string;          // long-term role description (curated, stable)
  dynamicHook: string;          // data-derived snapshot built from current fundamentals
  priceTargets: PriceTargets;  // analyst consensus + multiple bands + simple DCF
  currentPrice: number | null;
  insufficientFlags: string[]; // which fields were null
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
    insufficientFlags,
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
