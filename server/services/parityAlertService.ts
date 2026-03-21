/**
 * Parity Alert Service
 * Tracks parity violations and generates alerts when they exceed user threshold
 */

import type { ParityMetrics } from "../../shared/optionsSchema";

export interface ParityViolationAlert {
  id: string;
  ticker: string;
  strike: number;
  timestamp: number;
  violation: number; // C + PV(X) - P - S
  arbitrageProfitPercent: number;
  direction: "call_expensive" | "put_expensive";
  threshold: number; // User's threshold that triggered this alert
}

// In-memory storage of recent alerts (last 24 hours)
const recentAlerts: ParityViolationAlert[] = [];
const alertListeners: Set<(alert: ParityViolationAlert) => void> = new Set();

const ALERT_RETENTION_MS = 24 * 60 * 60 * 1000; // 24 hours
const ALERT_DEDUP_WINDOW_MS = 60 * 1000; // Don't repeat same alert within 60 seconds

/**
 * Check if a parity violation should trigger an alert
 * Returns alert if violation exceeds threshold, null otherwise
 */
export function checkParityViolation(
  ticker: string,
  strike: number,
  parityMetrics: ParityMetrics,
  userThreshold: number
): ParityViolationAlert | null {
  const maxDeviation = Math.max(
    Math.abs(parityMetrics.callPriceDeviation),
    Math.abs(parityMetrics.putPriceDeviation)
  );

  // Check if violation exceeds user's threshold
  if (maxDeviation <= userThreshold) {
    return null;
  }

  // Determine if this is "call_expensive" or "put_expensive"
  let direction: "call_expensive" | "put_expensive" = "call_expensive";
  if (
    Math.abs(parityMetrics.callPriceDeviation) <
    Math.abs(parityMetrics.putPriceDeviation)
  ) {
    direction = "put_expensive";
  }

  // Check if we already alerted on this recently (avoid spam)
  const alertKey = `${ticker}-${strike}-${direction}`;
  const recentSame = recentAlerts.find(
    (a) =>
      a.ticker === ticker &&
      a.strike === strike &&
      a.direction === direction &&
      Date.now() - a.timestamp < ALERT_DEDUP_WINDOW_MS
  );

  if (recentSame) {
    return null; // Already alerted recently, skip
  }

  const alert: ParityViolationAlert = {
    id: `alert-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    ticker,
    strike,
    timestamp: Date.now(),
    violation: parityMetrics.purityViolation,
    arbitrageProfitPercent: parityMetrics.arbitrageProfitPercent,
    direction,
    threshold: userThreshold,
  };

  return alert;
}

/**
 * Record an alert in memory
 */
export function recordAlert(alert: ParityViolationAlert): void {
  recentAlerts.push(alert);

  // Clean up old alerts
  const now = Date.now();
  while (recentAlerts.length > 0 && now - recentAlerts[0].timestamp > ALERT_RETENTION_MS) {
    recentAlerts.shift();
  }

  // Notify all listeners
  alertListeners.forEach((listener) => listener(alert));

  console.log(
    `🚨 Parity Alert: ${alert.ticker} ${alert.direction} | ${alert.arbitrageProfitPercent.toFixed(2)}% profit`
  );
}

/**
 * Subscribe to alert events
 * Returns unsubscribe function
 */
export function onParityAlert(callback: (alert: ParityViolationAlert) => void): () => void {
  alertListeners.add(callback);
  return () => alertListeners.delete(callback);
}

/**
 * Get recent alerts
 */
export function getRecentAlerts(
  ticker?: string,
  hoursBack: number = 24
): ParityViolationAlert[] {
  const cutoffTime = Date.now() - hoursBack * 60 * 60 * 1000;
  let alerts = recentAlerts.filter((a) => a.timestamp > cutoffTime);

  if (ticker) {
    alerts = alerts.filter((a) => a.ticker.toUpperCase() === ticker.toUpperCase());
  }

  return alerts.sort((a, b) => b.timestamp - a.timestamp);
}

/**
 * Clear all alerts
 */
export function clearAlerts(): void {
  recentAlerts.length = 0;
}