import type { OptionsWatchlistRow } from "@shared/schema";
import type {
  TradeIdea,
  WatchlistEvaluationPoint,
  WatchlistEvaluationReport,
} from "../../shared/optionsSchema";
import { watchlistLearningMultiplier } from "../../shared/watchlistLearning";
import { computeWatchlistLearning, contextFromRow } from "./ideaWatchlistLearning";

const MIN_EVAL = 8; // below this we refuse to draw any conclusion
const VERDICT_MIN = 12; // need this many before declaring improving/degrading
const MIN_ADJUSTED = 6; // learned must have actually moved >= this many predictions
const BRIER_MARGIN = 0.01; // ignore differences smaller than this (noise)

const clampProb = (p: number) => Math.max(0.02, Math.min(0.98, p));

function settleTime(row: OptionsWatchlistRow): number {
  const d = row.settledAt ?? row.updatedAt ?? row.createdAt;
  return d ? new Date(d).getTime() : 0;
}

/** Area under ROC curve via rank statistic (Mann-Whitney U). null if only one class. */
function auc(scores: number[], labels: number[]): number | null {
  const pos = labels.reduce((s, y) => s + y, 0);
  const neg = labels.length - pos;
  if (pos === 0 || neg === 0) return null;

  const idx = scores.map((s, i) => ({ s, y: labels[i] })).sort((a, b) => a.s - b.s);
  let rankSumPos = 0;
  let i = 0;
  while (i < idx.length) {
    let j = i;
    while (j < idx.length && idx[j].s === idx[i].s) j++;
    const avgRank = (i + j - 1) / 2 + 1; // 1-based average rank for ties
    for (let k = i; k < j; k++) if (idx[k].y === 1) rankSumPos += avgRank;
    i = j;
  }
  return (rankSumPos - (pos * (pos + 1)) / 2) / (pos * neg);
}

function mean(xs: number[]): number {
  return xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/**
 * Walk-forward (out-of-sample) test of the self-improving model.
 *
 * For each settled trade in time order, we predict its win probability using ONLY the
 * trades that settled before it — never the trade itself. This is the only honest way to
 * ask "is the learning improving accuracy" rather than overfitting to its own history.
 *
 * Predictions compared:
 *   - baseRate: rolling win rate of prior trades (no-skill but knows the base rate)
 *   - learned:  baseRate × the learned context multiplier (what the app actually applies)
 *   - pop:      the platform's stated probability of profit (if captured)
 *
 * Accuracy is scored with the Brier score (mean squared error of probability vs outcome);
 * lower is better. Learned must beat baseRate to justify the self-improvement.
 */
export function evaluateWatchlistModel(
  rows: OptionsWatchlistRow[],
): WatchlistEvaluationReport {
  // Only settled, binary outcomes; breakevens can't be scored as win/loss.
  const settled = rows
    .filter((r) => Number.isFinite(Number(r.settlementPnl)))
    .sort((a, b) => settleTime(a) - settleTime(b));

  const breakevensExcluded = settled.filter(
    (r) => Math.abs(Number(r.settlementPnl)) < 0.01,
  ).length;

  const ordered = settled.filter((r) => Math.abs(Number(r.settlementPnl)) >= 0.01);

  const ys: number[] = [];
  const pBaseRate: number[] = [];
  const pLearned: number[] = [];
  const pPop: number[] = [];
  const popMask: boolean[] = [];
  const dates: string[] = [];
  let adjustedCount = 0;

  for (let i = 0; i < ordered.length; i++) {
    const prior = ordered.slice(0, i);
    const row = ordered[i];
    const idea = row.ideaJson as unknown as TradeIdea;
    const y = Number(row.settlementPnl) > 0 ? 1 : 0;
    dates.push(new Date(settleTime(row)).toISOString().slice(0, 10));

    // Rolling base rate from prior outcomes (0.5 prior when no history yet).
    const priorWins = prior.filter((r) => Number(r.settlementPnl) > 0).length;
    const baseRate = prior.length > 0 ? priorWins / prior.length : 0.5;

    const priorReport = computeWatchlistLearning(prior);
    const mult = watchlistLearningMultiplier(contextFromRow(row), priorReport);
    if (mult !== 1) adjustedCount++;
    const learned = clampProb(baseRate * mult);

    const popRaw = idea?.probabilityOfProfit;
    const hasPop = Number.isFinite(popRaw) && popRaw > 0 && popRaw < 100;

    ys.push(y);
    pBaseRate.push(baseRate);
    pLearned.push(learned);
    popMask.push(hasPop);
    pPop.push(hasPop ? clampProb(popRaw / 100) : 0.5);
  }

  const evaluated = ys.length;
  const notes: string[] = [];

  if (evaluated < MIN_EVAL) {
    return {
      evaluated,
      adjustedCount,
      minRequired: MIN_EVAL,
      ready: false,
      breakevensExcluded,
      actualWinRatePct: evaluated ? round1(mean(ys) * 100) : 0,
      predictedWinRatePctPop: null,
      predictedWinRatePctLearned: evaluated ? round1(mean(pLearned) * 100) : 0,
      brierPop: null,
      brierBaseRate: 0,
      brierLearned: 0,
      brierImprovementVsBaseRate: 0,
      brierImprovementVsPop: null,
      aucPop: null,
      aucLearned: null,
      calibration: [],
      lift: { highWinRatePct: null, lowWinRatePct: null, n: 0 },
      history: [],
      verdict: "not_enough_data",
      notes: [
        `Only ${evaluated} settled win/loss trade(s). Need ≥ ${MIN_EVAL} to test accuracy out-of-sample.`,
        breakevensExcluded > 0 ? `${breakevensExcluded} breakeven(s) excluded.` : "",
      ].filter(Boolean),
    };
  }

  const brier = (preds: number[]) => mean(preds.map((p, i) => (p - ys[i]) ** 2));
  const brierBaseRate = round3(brier(pBaseRate));
  const brierLearned = round3(brier(pLearned));

  // Running re-evaluation: cumulative metrics as of each settlement. New settled trades
  // simply extend this series, so the trend updates the moment a trade closes.
  const history: WatchlistEvaluationPoint[] = [];
  let sumY = 0;
  let sumBL = 0;
  let sumBR = 0;
  let sumPL = 0;
  for (let k = 0; k < evaluated; k++) {
    sumY += ys[k];
    sumBL += (pLearned[k] - ys[k]) ** 2;
    sumBR += (pBaseRate[k] - ys[k]) ** 2;
    sumPL += pLearned[k];
    const m = k + 1;
    if (m >= MIN_EVAL) {
      history.push({
        atSettled: m,
        date: dates[k],
        actualWinRatePct: round1((sumY / m) * 100),
        predictedWinRatePctLearned: round1((sumPL / m) * 100),
        brierLearned: round3(sumBL / m),
        brierBaseRate: round3(sumBR / m),
        brierImprovementVsBaseRate: round3((sumBR - sumBL) / m),
      });
    }
  }

  const popIdx = popMask.map((m, i) => (m ? i : -1)).filter((i) => i >= 0);
  const hasPop = popIdx.length >= MIN_EVAL;
  const brierPop = hasPop
    ? round3(mean(popIdx.map((i) => (pPop[i] - ys[i]) ** 2)))
    : null;

  const brierImprovementVsBaseRate = round3(brierBaseRate - brierLearned);
  const brierImprovementVsPop = brierPop != null ? round3(brierPop - brierLearned) : null;

  const aucLearned = auc(pLearned, ys);
  const aucPop = hasPop ? auc(popIdx.map((i) => pPop[i]), popIdx.map((i) => ys[i])) : null;

  // Calibration table on learned predictions.
  const bands: Array<{ bucket: string; lo: number; hi: number }> = [
    { bucket: "<50%", lo: 0, hi: 0.5 },
    { bucket: "50–60%", lo: 0.5, hi: 0.6 },
    { bucket: "60–70%", lo: 0.6, hi: 0.7 },
    { bucket: "70–80%", lo: 0.7, hi: 0.8 },
    { bucket: "≥80%", lo: 0.8, hi: 1.01 },
  ];
  const calibration = bands
    .map((b) => {
      const members = pLearned
        .map((p, i) => ({ p, y: ys[i] }))
        .filter((m) => m.p >= b.lo && m.p < b.hi);
      if (members.length === 0) return null;
      return {
        bucket: b.bucket,
        predictedPct: round1(mean(members.map((m) => m.p)) * 100),
        actualPct: round1(mean(members.map((m) => m.y)) * 100),
        n: members.length,
      };
    })
    .filter((x): x is NonNullable<typeof x> => x != null);

  // Median-split lift on learned predictions.
  const sortedLearned = [...pLearned].sort((a, b) => a - b);
  const median = sortedLearned[Math.floor(sortedLearned.length / 2)];
  const high = pLearned.map((p, i) => ({ p, y: ys[i] })).filter((m) => m.p >= median);
  const low = pLearned.map((p, i) => ({ p, y: ys[i] })).filter((m) => m.p < median);
  const lift = {
    highWinRatePct: high.length ? round1(mean(high.map((m) => m.y)) * 100) : null,
    lowWinRatePct: low.length ? round1(mean(low.map((m) => m.y)) * 100) : null,
    n: pLearned.length,
  };

  // Verdict.
  let verdict: WatchlistEvaluationReport["verdict"] = "no_evidence";
  if (adjustedCount < MIN_ADJUSTED) {
    verdict = "no_evidence";
    notes.push(
      `Learned model only changed ${adjustedCount} prediction(s) — too few to conclude it helps. It defaults to your base win rate until patterns clear the sample gate.`,
    );
  } else if (evaluated >= VERDICT_MIN && brierImprovementVsBaseRate > BRIER_MARGIN) {
    verdict = "improving";
    notes.push(
      `Learned predictions beat the base-rate baseline out-of-sample (Brier ${brierLearned} vs ${brierBaseRate}). The self-improvement is adding real accuracy.`,
    );
  } else if (evaluated >= VERDICT_MIN && brierImprovementVsBaseRate < -BRIER_MARGIN) {
    verdict = "degrading";
    notes.push(
      `Learned predictions are WORSE than just using your base win rate (Brier ${brierLearned} vs ${brierBaseRate}). The adjustment is overfitting — treat its score nudges with skepticism.`,
    );
  } else {
    verdict = "no_evidence";
    notes.push(
      `No statistically meaningful difference yet (Brier learned ${brierLearned} vs base-rate ${brierBaseRate}). Keep settling trades.`,
    );
  }

  if (brierPop != null) {
    const popVerdict =
      brierImprovementVsPop! > BRIER_MARGIN
        ? "more accurate than"
        : brierImprovementVsPop! < -BRIER_MARGIN
          ? "less accurate than"
          : "about as accurate as";
    notes.push(`Learned is ${popVerdict} the stated POP (Brier ${brierLearned} vs ${brierPop}).`);
  }

  if (evaluated < 30) {
    notes.push(
      `Sample is small (${evaluated}); a few trades can flip this verdict. Re-check after ~30 settlements.`,
    );
  }
  if (breakevensExcluded > 0) notes.push(`${breakevensExcluded} breakeven(s) excluded.`);

  return {
    evaluated,
    adjustedCount,
    minRequired: MIN_EVAL,
    ready: true,
    breakevensExcluded,
    actualWinRatePct: round1(mean(ys) * 100),
    predictedWinRatePctPop: hasPop ? round1(mean(popIdx.map((i) => pPop[i])) * 100) : null,
    predictedWinRatePctLearned: round1(mean(pLearned) * 100),
    brierPop,
    brierBaseRate,
    brierLearned,
    brierImprovementVsBaseRate,
    brierImprovementVsPop,
    aucPop: aucPop != null ? round3(aucPop) : null,
    aucLearned: aucLearned != null ? round3(aucLearned) : null,
    calibration,
    lift,
    history,
    verdict,
    notes,
  };
}
