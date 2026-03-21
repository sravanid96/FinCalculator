/**
 * Parity History Service
 * Tracks historical parity metrics for backtesting and analysis
 */

import type { ParityMetrics } from "../../shared/optionsSchema";

export interface ParityHistoryEntry {
  id: string;
  ticker: string;
  strike: number;
  timestamp: number;
  stockPrice: number;
  daysToExpiration: number;
  parityMetrics: ParityMetrics;
  riskFreeRate: number;
}

// In-memory history storage
const parityHistory: ParityHistoryEntry[] = [];

const MAX_HISTORY_SIZE = 10000; // Max entries to keep in memory
const HISTORY_RETENTION_MS = 7 * 24 * 60 * 60 * 1000; // Keep 7 days of history

/**
 * Record a parity data point
 */
export function recordParityDataPoint(
  ticker: string,
  strike: number,
  stockPrice: number,
  daysToExpiration: number,
  parityMetrics: ParityMetrics,
  riskFreeRate: number
): ParityHistoryEntry {
  const entry: ParityHistoryEntry = {
    id: `parity-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    ticker,
    strike,
    timestamp: Date.now(),
    stockPrice,
    daysToExpiration,
    parityMetrics,
    riskFreeRate,
  };

  parityHistory.push(entry);

  // Cleanup: remove old entries if history gets too large
  cleanupHistory();

  return entry;
}

/**
 * Clean up old history entries
 */
function cleanupHistory(): void {
  const now = Date.now();

  // Remove entries older than retention period
  while (parityHistory.length > 0 && now - parityHistory[0].timestamp > HISTORY_RETENTION_MS) {
    parityHistory.shift();
  }

  // If still too large, remove oldest entries
  if (parityHistory.length > MAX_HISTORY_SIZE) {
    const removeCount = parityHistory.length - MAX_HISTORY_SIZE;
    parityHistory.splice(0, removeCount);
  }
}

/**
 * Get historical parity data for a ticker
 */
export function getParityHistory(
  ticker: string,
  options?: {
    strike?: number;
    hoursBack?: number;
  }
): ParityHistoryEntry[] {
  const cutoffTime = Date.now() - ((options?.hoursBack || 24) * 60 * 60 * 1000);

  let entries = parityHistory.filter(
    (e) =>
      e.ticker.toUpperCase() === ticker.toUpperCase() && e.timestamp > cutoffTime
  );

  if (options?.strike !== undefined) {
    entries = entries.filter((e) => e.strike === options.strike);
  }

  return entries.sort((a, b) => a.timestamp - b.timestamp);
}

/**
 * Get statistics for a ticker's parity violations
 */
export function getParityStatistics(
  ticker: string,
  hoursBack: number = 24
): {
  totalDataPoints: number;
  avgArbitrageOpportunity: number;
  maxArbitrageOpportunity: number;
  violationCount: number; // %deviation > 0.5%
  avgViolation: number;
} {
  const history = getParityHistory(ticker, { hoursBack });

  if (history.length === 0) {
    return {
      totalDataPoints: 0,
      avgArbitrageOpportunity: 0,
      maxArbitrageOpportunity: 0,
      violationCount: 0,
      avgViolation: 0,
    };
  }

  const profits = history.map((e) => e.parityMetrics.arbitrageProfitPercent);
  const violations = history.map((e) => e.parityMetrics.purityViolation);

  const maxDevs = history.map((e) =>
    Math.max(
      Math.abs(e.parityMetrics.callPriceDeviation),
      Math.abs(e.parityMetrics.putPriceDeviation)
    )
  );

  return {
    totalDataPoints: history.length,
    avgArbitrageOpportunity: profits.reduce((a, b) => a + b, 0) / profits.length,
    maxArbitrageOpportunity: Math.max(...profits),
    violationCount: maxDevs.filter((d) => d > 0.5).length,
    avgViolation: violations.reduce((a, b) => a + b, 0) / violations.length,
  };
}

/**
 * Export parity history as CSV
 */
export function exportParityHistoryAsCSV(
  ticker: string,
  hoursBack: number = 24
): string {
  const history = getParityHistory(ticker, { hoursBack });

  if (history.length === 0) {
    return "No data available";
  }

  const headers = [
    "Timestamp",
    "Ticker",
    "Strike",
    "Stock Price",
    "Days to Exp",
    "Call Price Dev %",
    "Put Price Dev %",
    "Arbitrage Profit %",
    "Arbitrage Profit $",
    "Direction",
    "Risk-Free Rate %",
  ];

  const rows = history.map((e) => [
    new Date(e.timestamp).toISOString(),
    e.ticker,
    e.strike,
    e.stockPrice.toFixed(2),
    e.daysToExpiration,
    e.parityMetrics.callPriceDeviation.toFixed(3),
    e.parityMetrics.putPriceDeviation.toFixed(3),
    e.parityMetrics.arbitrageProfitPercent.toFixed(3),
    e.parityMetrics.arbitrageProfitDollars.toFixed(2),
    e.parityMetrics.direction,
    (e.riskFreeRate * 100).toFixed(2),
  ]);

  // Build CSV
  const csv = [headers, ...rows]
    .map((row) => row.map((cell) => `"${cell}"`).join(","))
    .join("\n");

  return csv;
}

/**
 * Export statistics as JSON
 */
export function exportParityStatisticsAsJSON(
  ticker: string,
  hoursBack: number = 24
): object {
  const stats = getParityStatistics(ticker, hoursBack);
  const history = getParityHistory(ticker, { hoursBack });

  return {
    ticker,
    period: {
      hoursBack,
      fromDate: new Date(Date.now() - hoursBack * 60 * 60 * 1000).toISOString(),
      toDate: new Date().toISOString(),
    },
    statistics: stats,
    recentEntries: history.slice(-10).map((e) => ({
      timestamp: new Date(e.timestamp).toISOString(),
      stockPrice: e.stockPrice,
      daysToExp: e.daysToExpiration,
      callDev: e.parityMetrics.callPriceDeviation,
      putDev: e.parityMetrics.putPriceDeviation,
      arbitrageProfit: e.parityMetrics.arbitrageProfitPercent,
    })),
  };
}

/**
 * Get memory usage stats
 */
export function getHistoryStats(): { entriesStored: number; memoryApprox: string } {
  const memoryBytes = parityHistory.length * 500; // Rough estimate: ~500 bytes per entry
  let memoryDisplay = "";

  if (memoryBytes < 1024) {
    memoryDisplay = `${memoryBytes} B`;
  } else if (memoryBytes < 1024 * 1024) {
    memoryDisplay = `${(memoryBytes / 1024).toFixed(2)} KB`;
  } else {
    memoryDisplay = `${(memoryBytes / (1024 * 1024)).toFixed(2)} MB`;
  }

  return {
    entriesStored: parityHistory.length,
    memoryApprox: memoryDisplay,
  };
}