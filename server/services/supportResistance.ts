import type { PriceDataPoint, SupportResistanceLevel } from "../../shared/optionsSchema";

interface PricePivot {
  price: number;
  date: string;
  type: "high" | "low";
  index: number;
}

// Find local highs and lows in price data
function findPivotPoints(prices: PriceDataPoint[], lookback: number = 5): PricePivot[] {
  const pivots: PricePivot[] = [];

  for (let i = lookback; i < prices.length - lookback; i++) {
    const current = prices[i];
    let isLocalHigh = true;
    let isLocalLow = true;

    // Check if current point is higher/lower than surrounding points
    for (let j = i - lookback; j <= i + lookback; j++) {
      if (j === i) continue;
      if (prices[j].high >= current.high) isLocalHigh = false;
      if (prices[j].low <= current.low) isLocalLow = false;
    }

    if (isLocalHigh) {
      pivots.push({
        price: current.high,
        date: current.date,
        type: "high",
        index: i,
      });
    }

    if (isLocalLow) {
      pivots.push({
        price: current.low,
        date: current.date,
        type: "low",
        index: i,
      });
    }
  }

  return pivots;
}

// Cluster nearby price levels
function clusterPriceLevels(
  pivots: PricePivot[],
  tolerance: number // Percentage tolerance for clustering
): Map<number, PricePivot[]> {
  const clusters = new Map<number, PricePivot[]>();

  pivots.forEach((pivot) => {
    let foundCluster = false;

    // Check if this pivot belongs to an existing cluster
    const entries = Array.from(clusters.entries());
    for (const [clusterPrice, clusterPivots] of entries) {
      const percentDiff = Math.abs(pivot.price - clusterPrice) / clusterPrice;
      if (percentDiff <= tolerance) {
        clusterPivots.push(pivot);
        foundCluster = true;
        break;
      }
    }

    // Create new cluster if not found
    if (!foundCluster) {
      clusters.set(pivot.price, [pivot]);
    }
  });

  return clusters;
}

// Calculate level strength based on touches and recency
function calculateStrength(
  pivots: PricePivot[],
  totalDataPoints: number,
  latestIndex: number
): number {
  // Base strength from number of touches (max 3 points)
  const touchScore = Math.min(pivots.length, 5) * 0.6;

  // Recency score (max 2 points)
  const mostRecentIndex = Math.max(...pivots.map((p) => p.index));
  const recencyRatio = mostRecentIndex / latestIndex;
  const recencyScore = recencyRatio * 2;

  // Total strength (1-5 scale)
  return Math.min(5, Math.max(1, Math.round(touchScore + recencyScore)));
}

// Determine if a cluster represents support or resistance
function determineType(
  pivots: PricePivot[],
  currentPrice: number,
  clusterPrice: number
): "support" | "resistance" {
  // If price is above cluster, it's support; if below, it's resistance
  if (currentPrice > clusterPrice) {
    return "support";
  }
  return "resistance";
}

// Calculate support and resistance levels from historical price data
export function calculateSupportResistance(
  historicalPrices: PriceDataPoint[],
  currentPrice: number,
  options?: {
    lookback?: number; // Pivot point lookback window
    tolerance?: number; // Clustering tolerance (percentage)
    maxLevels?: number; // Maximum levels to return
  }
): SupportResistanceLevel[] {
  const {
    lookback = 5,
    tolerance = 0.015, // 1.5% tolerance
    maxLevels = 6,
  } = options || {};

  if (historicalPrices.length < lookback * 2 + 1) {
    return [];
  }

  // Find pivot points
  const pivots = findPivotPoints(historicalPrices, lookback);

  if (pivots.length === 0) {
    return [];
  }

  // Cluster nearby price levels
  const clusters = clusterPriceLevels(pivots, tolerance);

  // Convert clusters to S/R levels
  const levels: SupportResistanceLevel[] = [];
  const latestIndex = historicalPrices.length - 1;

  const clusterEntries = Array.from(clusters.entries());
  for (const [clusterPrice, clusterPivots] of clusterEntries) {
    // Skip clusters with only 1 touch (weak levels)
    if (clusterPivots.length < 2) continue;

    // Calculate average price for the cluster
    const avgPrice =
      clusterPivots.reduce((sum: number, p: PricePivot) => sum + p.price, 0) / clusterPivots.length;

    // Get the most recent touch
    const sortedByDate = [...clusterPivots].sort(
      (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
    );

    levels.push({
      price: Math.round(avgPrice * 100) / 100,
      type: determineType(clusterPivots, currentPrice, avgPrice),
      strength: calculateStrength(clusterPivots, historicalPrices.length, latestIndex),
      touches: clusterPivots.length,
      lastTouchDate: sortedByDate[0].date,
    });
  }

  // Sort by distance from current price and take top levels
  const supports = levels
    .filter((l) => l.type === "support")
    .sort((a, b) => b.price - a.price) // Closest support first
    .slice(0, Math.ceil(maxLevels / 2));

  const resistances = levels
    .filter((l) => l.type === "resistance")
    .sort((a, b) => a.price - b.price) // Closest resistance first
    .slice(0, Math.floor(maxLevels / 2));

  // Combine and sort by strength
  return [...supports, ...resistances].sort((a, b) => b.strength - a.strength);
}

// Get price ranges for the chart based on S/R levels
export function getSRPriceRange(
  levels: SupportResistanceLevel[],
  currentPrice: number
): { min: number; max: number } {
  if (levels.length === 0) {
    return {
      min: currentPrice * 0.9,
      max: currentPrice * 1.1,
    };
  }

  const allPrices = [...levels.map((l) => l.price), currentPrice];
  const minPrice = Math.min(...allPrices);
  const maxPrice = Math.max(...allPrices);

  // Add 5% padding
  return {
    min: minPrice * 0.95,
    max: maxPrice * 1.05,
  };
}
