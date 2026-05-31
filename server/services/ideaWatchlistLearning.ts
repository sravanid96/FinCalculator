import type { OptionsWatchlistRow } from "@shared/schema";
import type {
  TradeIdea,
  WatchlistContextSnapshot,
  WatchlistLearningBucket,
  WatchlistLearningReport,
  WatchlistLearningReadiness,
} from "../../shared/optionsSchema";

export {
  applyWatchlistLearningBoost,
  learnedSignalForIdea,
} from "../../shared/watchlistLearning";

const MIN_BUCKET_SAMPLES = 3;
const CALIBRATED_SETTLED = 40;
const LEARNING_SETTLED = 10;

type SettledRow = {
  isWin: boolean;
  pnl: number;
  strategy: string;
  recommendation: string;
  hasEarningsRisk: boolean;
  historicalEdge: string | null;
  overallFrameworkPct: number | null;
  popBucket: "low" | "mid" | "high";
  fundamentalHigh: boolean | null;
  technicalHigh: boolean | null;
  macroHigh: boolean | null;
  revenueGrowthYoy: number | null;
  roic: number | null;
  grossMarginDeltaPp: number | null;
  epsQoqGrowth: number | null;
  netDebtToEbitda: number | null;
};

function popBucket(pop: number): SettledRow["popBucket"] {
  if (pop >= 75) return "high";
  if (pop >= 60) return "mid";
  return "low";
}

function contextFromIdea(idea: TradeIdea): WatchlistContextSnapshot | null {
  return idea.watchlistContext ?? null;
}

function inferContext(idea: TradeIdea): WatchlistContextSnapshot {
  const ctx = contextFromIdea(idea);
  if (ctx) return ctx;
  return {
    capturedAt: new Date().toISOString(),
    strategy: idea.strategy,
    recommendation: idea.recommendation,
    hasEarningsRisk: idea.hasEarningsRisk,
    earningsDate: idea.earningsDate,
    probabilityOfProfit: idea.probabilityOfProfit,
    daysToExpiration: idea.daysToExpiration,
  };
}

/** Reconstruct the learning context for a stored watchlist row (uses saved snapshot or infers). */
export function contextFromRow(row: OptionsWatchlistRow): WatchlistContextSnapshot {
  return inferContext(row.ideaJson as unknown as TradeIdea);
}

function toSettledRow(row: OptionsWatchlistRow): SettledRow | null {
  const pnl = Number(row.settlementPnl);
  if (!Number.isFinite(pnl)) return null;

  const idea = row.ideaJson as unknown as TradeIdea;
  if (!idea?.legs?.length) return null;

  const ctx = inferContext(idea);
  const overall = ctx.pillarScores?.overall ?? null;
  const f = ctx.fundamentals;

  return {
    isWin: pnl > 0,
    pnl,
    strategy: ctx.strategy ?? row.strategy,
    recommendation: ctx.recommendation ?? idea.recommendation ?? "neutral",
    hasEarningsRisk: ctx.hasEarningsRisk ?? idea.hasEarningsRisk ?? false,
    historicalEdge: ctx.historicalEdge ?? null,
    overallFrameworkPct: overall,
    popBucket: popBucket(ctx.probabilityOfProfit ?? idea.probabilityOfProfit),
    fundamentalHigh:
      ctx.pillarScores != null ? ctx.pillarScores.fundamental.pct >= 60 : null,
    technicalHigh:
      ctx.pillarScores != null ? ctx.pillarScores.technical.pct >= 60 : null,
    macroHigh: ctx.pillarScores != null ? ctx.pillarScores.macro.pct >= 60 : null,
    revenueGrowthYoy: f?.revenueGrowthYoy ?? null,
    roic: f?.roic ?? null,
    grossMarginDeltaPp: f?.grossMarginDeltaPp ?? null,
    epsQoqGrowth: f?.epsQoqGrowth ?? null,
    netDebtToEbitda: f?.netDebtToEbitda ?? null,
  };
}

function readinessFor(n: number): WatchlistLearningReadiness {
  if (n < LEARNING_SETTLED) return "not_enough_data";
  if (n < CALIBRATED_SETTLED) return "learning";
  return "calibrated";
}

function bucketStats(
  rows: SettledRow[],
  key: string,
  label: string,
  filter: (r: SettledRow) => boolean,
  baselineWin: number,
): WatchlistLearningBucket | null {
  const subset = rows.filter(filter);
  if (subset.length < MIN_BUCKET_SAMPLES) return null;

  const wins = subset.filter((r) => r.isWin).length;
  const winRatePct = Math.round((wins / subset.length) * 1000) / 10;
  const avgPnl = Math.round((subset.reduce((s, r) => s + r.pnl, 0) / subset.length) * 100) / 100;
  const deltaWinRatePct = Math.round((winRatePct - baselineWin) * 10) / 10;

  let weightMultiplier = 1;
  if (deltaWinRatePct >= 15) weightMultiplier = 1.12;
  else if (deltaWinRatePct >= 8) weightMultiplier = 1.06;
  else if (deltaWinRatePct <= -15) weightMultiplier = 0.88;
  else if (deltaWinRatePct <= -8) weightMultiplier = 0.94;

  return {
    key,
    label,
    sampleSize: subset.length,
    winRatePct,
    avgPnl,
    deltaWinRatePct,
    weightMultiplier,
  };
}

function pillarInsight(
  rows: SettledRow[],
  pillar: "fundamentalHigh" | "technicalHigh" | "macroHigh",
  label: string,
): WatchlistLearningReport["pillarInsights"][number] {
  const withFlag = rows.filter((r) => r[pillar] !== null);
  const high = withFlag.filter((r) => r[pillar] === true);
  const low = withFlag.filter((r) => r[pillar] === false);

  const rate = (arr: SettledRow[]) =>
    arr.length >= MIN_BUCKET_SAMPLES
      ? Math.round((arr.filter((r) => r.isWin).length / arr.length) * 1000) / 10
      : null;

  return {
    pillar: label,
    highWinRatePct: rate(high),
    lowWinRatePct: rate(low),
    n: withFlag.length,
  };
}

export function computeWatchlistLearning(rows: OptionsWatchlistRow[]): WatchlistLearningReport {
  const settled = rows.map(toSettledRow).filter((r): r is SettledRow => r != null);
  const n = settled.length;

  if (n === 0) {
    return {
      readiness: "not_enough_data",
      settledCount: 0,
      baselineWinRatePct: 0,
      baselineAvgPnl: 0,
      buckets: [],
      suggestions: [
        "Save ideas to the watchlist with context (from Analysis or Top ideas), let them expire, then auto-settle. Learning starts after ~10 settled trades.",
      ],
      pillarInsights: [],
    };
  }

  const baselineWins = settled.filter((r) => r.isWin).length;
  const baselineWinRatePct = Math.round((baselineWins / n) * 1000) / 10;
  const baselineAvgPnl = Math.round((settled.reduce((s, r) => s + r.pnl, 0) / n) * 100) / 100;

  const bucketDefs: Array<{
    key: string;
    label: string;
    filter: (r: SettledRow) => boolean;
  }> = [
    ...["put_credit_spread", "call_credit_spread", "iron_condor"].map((s) => ({
      key: `strategy:${s}`,
      label: `Strategy: ${s.replace(/_/g, " ")}`,
      filter: (r: SettledRow) => r.strategy === s,
    })),
    {
      key: "rec:avoid",
      label: "Recommendation: avoid",
      filter: (r) => r.recommendation === "avoid",
    },
    {
      key: "rec:buy+",
      label: "Recommendation: buy or strong_buy",
      filter: (r) => r.recommendation === "buy" || r.recommendation === "strong_buy",
    },
    {
      key: "earnings:risk",
      label: "Earnings within hold window",
      filter: (r) => r.hasEarningsRisk,
    },
    {
      key: "earnings:clear",
      label: "No earnings risk flag",
      filter: (r) => !r.hasEarningsRisk,
    },
    {
      key: "edge:strong+",
      label: "Backtest edge: strong or positive",
      filter: (r) => r.historicalEdge === "strong" || r.historicalEdge === "positive",
    },
    {
      key: "edge:negative",
      label: "Backtest edge: negative",
      filter: (r) => r.historicalEdge === "negative",
    },
    {
      key: "framework:high",
      label: "Framework score ≥ 70%",
      filter: (r) => r.overallFrameworkPct != null && r.overallFrameworkPct >= 70,
    },
    {
      key: "framework:low",
      label: "Framework score < 50%",
      filter: (r) => r.overallFrameworkPct != null && r.overallFrameworkPct < 50,
    },
    {
      key: "pop:high",
      label: "POP ≥ 75%",
      filter: (r) => r.popBucket === "high",
    },
    {
      key: "pop:low",
      label: "POP < 60%",
      filter: (r) => r.popBucket === "low",
    },
    {
      key: "growth:high",
      label: "Revenue growth ≥ 15% YoY",
      filter: (r) => r.revenueGrowthYoy != null && r.revenueGrowthYoy >= 0.15,
    },
    {
      key: "growth:negative",
      label: "Revenue shrinking YoY",
      filter: (r) => r.revenueGrowthYoy != null && r.revenueGrowthYoy < 0,
    },
    {
      key: "moat:high",
      label: "High ROIC (moat ≥ 15%)",
      filter: (r) => r.roic != null && r.roic >= 0.15,
    },
    {
      key: "margins:improving",
      label: "Gross margin improving",
      filter: (r) => r.grossMarginDeltaPp != null && r.grossMarginDeltaPp > 0,
    },
    {
      key: "profit:growing",
      label: "EPS growing QoQ",
      filter: (r) => r.epsQoqGrowth != null && r.epsQoqGrowth > 0,
    },
    {
      key: "leverage:high",
      label: "High leverage (net debt/EBITDA ≥ 3)",
      filter: (r) => r.netDebtToEbitda != null && r.netDebtToEbitda >= 3,
    },
  ];

  const buckets = bucketDefs
    .map((d) => bucketStats(settled, d.key, d.label, d.filter, baselineWinRatePct))
    .filter((b): b is WatchlistLearningBucket => b != null)
    .sort((a, b) => Math.abs(b.deltaWinRatePct) - Math.abs(a.deltaWinRatePct));

  const suggestions: string[] = [];

  if (n < LEARNING_SETTLED) {
    suggestions.push(
      `${n} settled idea(s) so far — need at least ${LEARNING_SETTLED} before pattern weights are reliable.`,
    );
  }

  const best = buckets.find((b) => b.deltaWinRatePct >= 10 && b.sampleSize >= 5);
  const worst = buckets.find((b) => b.deltaWinRatePct <= -10 && b.sampleSize >= 5);

  if (best) {
    suggestions.push(
      `Favor setups like “${best.label}”: ${best.winRatePct}% win rate (n=${best.sampleSize}), ${best.deltaWinRatePct >= 0 ? "+" : ""}${best.deltaWinRatePct}% vs your baseline.`,
    );
  }
  if (worst) {
    suggestions.push(
      `Be cautious on “${worst.label}”: ${worst.winRatePct}% win rate (n=${worst.sampleSize}), ${worst.deltaWinRatePct}% vs baseline — size down or skip until more data.`,
    );
  }

  const earnRisk = buckets.find((b) => b.key === "earnings:risk");
  const earnClear = buckets.find((b) => b.key === "earnings:clear");
  if (earnRisk && earnClear && earnRisk.sampleSize >= MIN_BUCKET_SAMPLES && earnClear.sampleSize >= MIN_BUCKET_SAMPLES) {
    if (earnRisk.winRatePct < earnClear.winRatePct - 12) {
      suggestions.push(
        "Earnings-risk ideas underperform your no-earnings-risk bucket — align with framework: avoid new risk through earnings unless thesis is explicit.",
      );
    }
  }

  const pillarInsights = [
    pillarInsight(settled, "fundamentalHigh", "Fundamental pillar"),
    pillarInsight(settled, "technicalHigh", "Technical pillar"),
    pillarInsight(settled, "macroHigh", "Macro / vol pillar"),
  ].filter((p) => p.n > 0);

  for (const p of pillarInsights) {
    if (
      p.highWinRatePct != null &&
      p.lowWinRatePct != null &&
      p.highWinRatePct - p.lowWinRatePct >= 15
    ) {
      suggestions.push(
        `${p.pillar}: high framework pass rate correlates with better outcomes (${p.highWinRatePct}% vs ${p.lowWinRatePct}% win rate).`,
      );
    }
  }

  if (suggestions.length === 0 && n >= LEARNING_SETTLED) {
    suggestions.push(
      `Baseline ${baselineWinRatePct}% win rate on ${n} settlements — no strong bucket edge yet; keep logging context on new ideas.`,
    );
  }

  return {
    readiness: readinessFor(n),
    settledCount: n,
    baselineWinRatePct,
    baselineAvgPnl,
    buckets: buckets.slice(0, 12),
    suggestions,
    pillarInsights,
  };
}
