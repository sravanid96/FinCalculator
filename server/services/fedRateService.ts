/**
 * Federal Reserve Risk-Free Rate Service
 * Provides current risk-free rate for Black-Scholes calculations
 * Fetches from FRED API (Federal Reserve Economic Data) with fallback to hardcoded rate
 */

interface CachedRate {
  rate: number;
  lastUpdated: number;
  source: "fred" | "hardcoded" | "manual";
}

let cachedRate: CachedRate = {
  rate: 0.0525, // Current Fed rate as of March 2026
  lastUpdated: Date.now(),
  source: "hardcoded",
};

const CACHE_DURATION_MS = 24 * 60 * 60 * 1000; // 24 hours
const FRED_API_BASE = "https://api.stlouisfed.org/fred";
const FRED_SERIES_ID = "DFF"; // Effective Federal Funds Rate (daily)

/**
 * Fetch current Federal Funds Rate from FRED API
 * Used to get the latest risk-free rate
 */
async function fetchFromFRED(): Promise<number | null> {
  try {
    // Get API key from environment, or use empty string (public access with rate limits)
    const apiKey = process.env.FRED_API_KEY || "";

    const url = new URL(`${FRED_API_BASE}/series/data`);
    url.searchParams.append("series_id", FRED_SERIES_ID);
    url.searchParams.append("sort_order", "desc");
    url.searchParams.append("limit", "1");
    if (apiKey) {
      url.searchParams.append("api_key", apiKey);
    }

    const response = await fetch(url.toString(), {
      timeout: 5000, // 5 second timeout
    });

    if (!response.ok) {
      console.warn(`FRED API returned ${response.status}: using hardcoded rate`);
      return null;
    }

    const data = (await response.json()) as {
      observations?: Array<{ value: string }>;
    };

    if (!data.observations || data.observations.length === 0) {
      console.warn("FRED API: No observations found");
      return null;
    }

    const latestValue = data.observations[0].value;
    if (latestValue === ".") {
      // FRED returns "." for missing data
      console.warn("FRED API: Latest value is missing");
      return null;
    }

    // Convert from percentage (e.g., 5.25%) to decimal (e.g., 0.0525)
    const ratePercent = parseFloat(latestValue);
    if (isNaN(ratePercent)) {
      console.warn("FRED API: Could not parse rate value");
      return null;
    }

    const rateDecimal = ratePercent / 100;
    console.log(`✅ FRED Rate fetched: ${ratePercent.toFixed(2)}%`);
    return rateDecimal;
  } catch (error) {
    console.warn("FRED API fetch failed:", error, "using hardcoded rate");
    return null;
  }
}

/**
 * Get current risk-free rate for options pricing
 * Tries FRED API first, falls back to cached/hardcoded rate
 */
export async function getRiskFreeRate(): Promise<number> {
  const now = Date.now();
  const isStale = now - cachedRate.lastUpdated > CACHE_DURATION_MS;

  // Return cached rate if still fresh
  if (!isStale && cachedRate.source !== "hardcoded") {
    return cachedRate.rate;
  }

  // Try to fetch fresh rate from FRED
  const fredRate = await fetchFromFRED();
  if (fredRate !== null && fredRate > 0 && fredRate < 1) {
    // Validate rate is reasonable (between 0% and 100%)
    cachedRate = {
      rate: fredRate,
      lastUpdated: now,
      source: "fred",
    };
    return fredRate;
  }

  // If we have a fresh cached rate (even if hardcoded), use it
  if (!isStale) {
    return cachedRate.rate;
  }

  // Return current cache (will update next time cache expires)
  return cachedRate.rate;
}

/**
 * Set risk-free rate manually (for testing or updates)
 */
export function setRiskFreeRate(rate: number): void {
  if (rate < 0 || rate > 1) {
    throw new Error("Risk-free rate must be between 0 and 1 (0% to 100%)");
  }
  cachedRate = {
    rate,
    lastUpdated: Date.now(),
    source: "manual",
  };
}

/**
 * Update hardcoded default rate (for deployments)
 */
export function setDefaultRate(rate: number): void {
  if (rate < 0 || rate > 1) {
    throw new Error("Default rate must be between 0 and 1");
  }
  if (cachedRate.source === "hardcoded" || cachedRate.source === "fred") {
    cachedRate.rate = rate;
    cachedRate.source = "hardcoded";
  }
}

/**
 * Get cache info for debugging
 */
export function getCacheInfo(): CachedRate & { cacheAge: number } {
  return {
    ...cachedRate,
    cacheAge: Date.now() - cachedRate.lastUpdated,
  };
}
