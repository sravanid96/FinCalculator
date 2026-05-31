import type {
  LearnedSignal,
  TradeIdea,
  WatchlistContextSnapshot,
  WatchlistLearningBucket,
  WatchlistLearningReport,
} from "./optionsSchema";

/** Bucket definitions shared by the compute engine (filters on settled rows) and the
 *  client/server boost (matches on a saved context). Keep keys in sync between the two. */
export const LEARNING_BUCKET_LABELS: Record<string, string> = {
  "rec:avoid": "Recommendation: avoid",
  "rec:buy+": "Recommendation: buy or strong_buy",
  "earnings:risk": "Earnings within hold window",
  "earnings:clear": "No earnings risk flag",
  "edge:strong+": "Backtest edge: strong or positive",
  "edge:negative": "Backtest edge: negative",
  "framework:high": "Framework score ≥ 70%",
  "framework:low": "Framework score < 50%",
  "pop:high": "POP ≥ 75%",
  "pop:low": "POP < 60%",
  "growth:high": "Revenue growth ≥ 15% YoY",
  "growth:negative": "Revenue shrinking YoY",
  "moat:high": "High ROIC (moat ≥ 15%)",
  "margins:improving": "Gross margin improving",
  "profit:growing": "EPS growing QoQ",
  "leverage:high": "High leverage (net debt/EBITDA ≥ 3)",
};

/** True when a saved idea's context falls into the given learning bucket. */
export function contextMatchesBucketKey(
  key: string,
  ctx: WatchlistContextSnapshot,
): boolean {
  const f = ctx.fundamentals;
  if (key.startsWith("strategy:")) return key === `strategy:${ctx.strategy}`;

  switch (key) {
    case "rec:avoid":
      return ctx.recommendation === "avoid";
    case "rec:buy+":
      return ctx.recommendation === "buy" || ctx.recommendation === "strong_buy";
    case "earnings:risk":
      return !!ctx.hasEarningsRisk;
    case "earnings:clear":
      return !ctx.hasEarningsRisk;
    case "edge:strong+":
      return ctx.historicalEdge === "strong" || ctx.historicalEdge === "positive";
    case "edge:negative":
      return ctx.historicalEdge === "negative";
    case "framework:high":
      return ctx.pillarScores != null && ctx.pillarScores.overall >= 70;
    case "framework:low":
      return ctx.pillarScores != null && ctx.pillarScores.overall < 50;
    case "pop:high":
      return (ctx.probabilityOfProfit ?? 0) >= 75;
    case "pop:low":
      return (ctx.probabilityOfProfit ?? 100) < 60;
    case "growth:high":
      return f?.revenueGrowthYoy != null && f.revenueGrowthYoy >= 0.15;
    case "growth:negative":
      return f?.revenueGrowthYoy != null && f.revenueGrowthYoy < 0;
    case "moat:high":
      return f?.roic != null && f.roic >= 0.15;
    case "margins:improving":
      return f?.grossMarginDeltaPp != null && f.grossMarginDeltaPp > 0;
    case "profit:growing":
      return f?.epsQoqGrowth != null && f.epsQoqGrowth > 0;
    case "leverage:high":
      return f?.netDebtToEbitda != null && f.netDebtToEbitda >= 3;
    default:
      return false;
  }
}

const MULT_FLOOR = 0.82;
const MULT_CEIL = 1.18;

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

/** Apply learned bucket multipliers to a 0–100 score when context matches top buckets. */
export function applyWatchlistLearningBoost(
  baseScore: number,
  context: WatchlistContextSnapshot,
  report: WatchlistLearningReport,
): number {
  const mult = combinedMultiplier(context, report).multiplier;
  if (mult === 1) return baseScore;
  return Math.round(clamp(baseScore * mult, 0, 100));
}

/** Clamped multiplier (0.82–1.18) a saved-context idea earns from the user's history.
 *  Use this for ranking when the base value isn't a 0–100 score. */
export function watchlistLearningMultiplier(
  context: WatchlistContextSnapshot,
  report: WatchlistLearningReport,
): number {
  return combinedMultiplier(context, report).multiplier;
}

/** Find a specific learned bucket (e.g. `strategy:put_credit_spread`) if it cleared the sample gate. */
export function findLearningBucket(
  report: WatchlistLearningReport,
  key: string,
): WatchlistLearningBucket | undefined {
  return report.buckets.find((b) => b.key === key);
}

function combinedMultiplier(
  context: WatchlistContextSnapshot,
  report: WatchlistLearningReport,
): { multiplier: number; matched: WatchlistLearningBucket[] } {
  if (report.readiness === "not_enough_data" || report.buckets.length === 0) {
    return { multiplier: 1, matched: [] };
  }

  const matched: WatchlistLearningBucket[] = [];
  let mult = 1;
  // Only the strongest few buckets drive the adjustment to avoid double-counting noise.
  for (const b of report.buckets.slice(0, 6)) {
    if (contextMatchesBucketKey(b.key, context)) {
      matched.push(b);
      mult *= b.weightMultiplier;
    }
  }
  return { multiplier: clamp(mult, MULT_FLOOR, MULT_CEIL), matched };
}

/** Human-facing learned signal for a single idea, based on the user's settled history. */
export function learnedSignalForIdea(
  context: WatchlistContextSnapshot,
  report: WatchlistLearningReport,
  currentRecommendation?: TradeIdea["recommendation"],
): LearnedSignal {
  if (report.readiness === "not_enough_data") {
    return {
      multiplier: 1,
      deltaWinRatePct: null,
      direction: "neutral",
      matched: [],
      note: `Not enough settled history yet (${report.settledCount}). Learning starts after ~10 settlements.`,
    };
  }

  const { multiplier, matched } = combinedMultiplier(context, report);
  // Surface only buckets with a meaningful edge and enough samples.
  const meaningful = matched
    .filter((b) => Math.abs(b.deltaWinRatePct) >= 8 && b.sampleSize >= 3)
    .sort((a, b) => Math.abs(b.deltaWinRatePct) - Math.abs(a.deltaWinRatePct));

  const top = meaningful[0] ?? null;
  const deltaWinRatePct = top ? top.deltaWinRatePct : null;

  let direction: LearnedSignal["direction"] = "neutral";
  if (multiplier >= 1.03) direction = "favor";
  else if (multiplier <= 0.97) direction = "caution";

  let note: string;
  if (meaningful.length === 0) {
    note = `Neutral vs your ${report.baselineWinRatePct}% baseline — no strong pattern match.`;
  } else {
    const parts = meaningful
      .slice(0, 2)
      .map((b) => `${b.label} ${b.winRatePct}% (${b.deltaWinRatePct >= 0 ? "+" : ""}${b.deltaWinRatePct})`);
    const verb = direction === "favor" ? "Favored" : direction === "caution" ? "Caution" : "Mixed";
    note = `${verb} by your history: ${parts.join("; ")} vs ${report.baselineWinRatePct}% baseline.`;
  }

  // Conservative recommendation nudge: only one notch, only on a clear, calibrated signal.
  let suggestedRecommendation: TradeIdea["recommendation"] | undefined;
  if (currentRecommendation && report.readiness === "calibrated" && top) {
    const order: TradeIdea["recommendation"][] = ["avoid", "neutral", "buy", "strong_buy"];
    const idx = order.indexOf(currentRecommendation);
    if (direction === "caution" && multiplier <= 0.9 && idx > 0) {
      suggestedRecommendation = order[idx - 1];
    } else if (direction === "favor" && multiplier >= 1.1 && idx < order.length - 1) {
      suggestedRecommendation = order[idx + 1];
    }
  }

  return {
    multiplier: Math.round(multiplier * 100) / 100,
    deltaWinRatePct,
    direction,
    matched: meaningful.map((b) => b.label),
    note,
    suggestedRecommendation,
  };
}
