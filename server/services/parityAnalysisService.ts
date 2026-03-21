/**
 * Parity Analysis Service
 * Calculates put-call parity for ALL call-put pairs in the options chain
 * (not just trade idea pairs)
 */

import type { OptionsChain, OptionContract } from "../../shared/optionsSchema";
import { calculateParityMetrics, type ParityMetrics } from "./optionsCalculator";

export interface ParityPair {
  strike: number;
  expiration: string;
  daysToExpiration: number;
  callSymbol: string;
  putSymbol: string;
  callPrice: number;
  putPrice: number;
  callBid: number;
  callAsk: number;
  putBid: number;
  putAsk: number;
  parityMetrics: ParityMetrics;
}

/**
 * Calculate parity for all call-put combinations in the chain
 * Returns one entry per strike per expiration
 */
export function calculateAllParityPairs(
  chain: OptionsChain,
  riskFreeRate: number
): ParityPair[] {
  const pairs: ParityPair[] = [];

  // For each expiration date
  for (const exp of chain.expirations) {
    // Group calls and puts by strike
    const callsByStrike = new Map<number, OptionContract>();
    const putsByStrike = new Map<number, OptionContract>();

    // Index calls by strike
    for (const call of exp.calls) {
      callsByStrike.set(call.strike, call);
    }

    // Index puts by strike
    for (const put of exp.puts) {
      putsByStrike.set(put.strike, put);
    }

    // Find matching strike pairs (call and put at same strike)
    const strikes = new Set([...callsByStrike.keys(), ...putsByStrike.keys()]);

    for (const strike of strikes) {
      const call = callsByStrike.get(strike);
      const put = putsByStrike.get(strike);

      // Only include if we have both call AND put at this strike
      if (!call || !put) {
        continue;
      }

      // Use mid-price for more accurate parity
      const callMid = (call.bid + call.ask) / 2;
      const putMid = (put.bid + put.ask) / 2;

      const metrics = calculateParityMetrics(
        callMid,
        putMid,
        strike,
        chain.underlyingPrice,
        exp.daysToExpiration,
        riskFreeRate
      );

      pairs.push({
        strike,
        expiration: exp.expirationDate,
        daysToExpiration: exp.daysToExpiration,
        callSymbol: call.contractSymbol,
        putSymbol: put.contractSymbol,
        callPrice: callMid,
        putPrice: putMid,
        callBid: call.bid,
        callAsk: call.ask,
        putBid: put.bid,
        putAsk: put.ask,
        parityMetrics: metrics,
      });
    }
  }

  // Sort by parity violation (highest first)
  pairs.sort((a, b) => {
    const aViolation = Math.abs(a.parityMetrics.purityViolation);
    const bViolation = Math.abs(b.parityMetrics.purityViolation);
    return bViolation - aViolation;
  });

  return pairs;
}

/**
 * Filter parity pairs by deviation threshold
 */
export function filterParityPairsByThreshold(
  pairs: ParityPair[],
  threshold: number
): ParityPair[] {
  return pairs.filter((pair) => {
    const maxDeviation = Math.max(
      Math.abs(pair.parityMetrics.callPriceDeviation),
      Math.abs(pair.parityMetrics.putPriceDeviation)
    );
    return maxDeviation > threshold;
  });
}

/**
 * Get top N parity opportunities
 */
export function getTopParityOpportunities(
  pairs: ParityPair[],
  limit: number = 10
): ParityPair[] {
  return pairs.slice(0, limit);
}

/**
 * Calculate statistics across all pairs
 */
export function calculateParityStatistics(pairs: ParityPair[]): {
  totalPairs: number;
  avgArbitragePercent: number;
  maxArbitragePercent: number;
  violationsAbove05Percent: number;
  violationsAbove10Percent: number;
  mostExpensiveOption: "calls" | "puts" | "balanced";
  strikeRange: { min: number; max: number };
} {
  if (pairs.length === 0) {
    return {
      totalPairs: 0,
      avgArbitragePercent: 0,
      maxArbitragePercent: 0,
      violationsAbove05Percent: 0,
      violationsAbove10Percent: 0,
      mostExpensiveOption: "balanced",
      strikeRange: { min: 0, max: 0 },
    };
  }

  const arbitrages = pairs.map((p) => p.parityMetrics.arbitrageProfitPercent);
  const deviations = pairs.map((p) =>
    Math.max(
      Math.abs(p.parityMetrics.callPriceDeviation),
      Math.abs(p.parityMetrics.putPriceDeviation)
    )
  );

  const callDeviationsPos = pairs.filter(
    (p) => p.parityMetrics.callPriceDeviation > 0
  ).length;
  const putDeviationsPos = pairs.filter(
    (p) => p.parityMetrics.putPriceDeviation > 0
  ).length;

  return {
    totalPairs: pairs.length,
    avgArbitragePercent:
      arbitrages.reduce((a, b) => a + b, 0) / arbitrages.length,
    maxArbitragePercent: Math.max(...arbitrages),
    violationsAbove05Percent: deviations.filter((d) => d > 0.5).length,
    violationsAbove10Percent: deviations.filter((d) => d > 1.0).length,
    mostExpensiveOption:
      callDeviationsPos > putDeviationsPos ? "calls" : "puts",
    strikeRange: {
      min: Math.min(...pairs.map((p) => p.strike)),
      max: Math.max(...pairs.map((p) => p.strike)),
    },
  };
}