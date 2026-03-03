import type { EarningsEvent } from "../../shared/optionsSchema";

// Cache for earnings data
const earningsCache = new Map<string, { data: EarningsEvent | null; timestamp: number }>();
const CACHE_TTL = 60 * 60 * 1000; // 1 hour cache for earnings

// API Ninjas requires an API key - we'll use a fallback approach
// First try API Ninjas, then fall back to Yahoo Finance earnings data

function getCached(key: string): EarningsEvent | null | undefined {
  const cached = earningsCache.get(key);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data;
  }
  return undefined;
}

function setCache(key: string, data: EarningsEvent | null): void {
  earningsCache.set(key, { data, timestamp: Date.now() });
}

// Fetch earnings from API Ninjas (requires API key in env)
async function fetchFromAPINinjas(symbol: string): Promise<EarningsEvent | null> {
  const apiKey = process.env.API_NINJAS_KEY;
  if (!apiKey) {
    return null;
  }

  try {
    const response = await fetch(
      `https://api.api-ninjas.com/v1/earningscalendar?ticker=${symbol}`,
      {
        headers: {
          "X-Api-Key": apiKey,
        },
      }
    );

    if (!response.ok) {
      console.warn(`API Ninjas returned ${response.status} for ${symbol}`);
      return null;
    }

    const data = await response.json();

    if (!Array.isArray(data) || data.length === 0) {
      return null;
    }

    // Find the next upcoming earnings
    const now = new Date();
    const upcomingEarnings = data
      .filter((e: any) => new Date(e.pricedate) >= now)
      .sort(
        (a: any, b: any) =>
          new Date(a.pricedate).getTime() - new Date(b.pricedate).getTime()
      )[0];

    if (!upcomingEarnings) {
      return null;
    }

    const reportDate = new Date(upcomingEarnings.pricedate);
    const daysUntil = Math.ceil(
      (reportDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
    );

    return {
      symbol: symbol.toUpperCase(),
      companyName: upcomingEarnings.company_name || symbol,
      reportDate: upcomingEarnings.pricedate,
      fiscalQuarter: upcomingEarnings.fiscal_quarter_ending || "Unknown",
      estimatedEPS: upcomingEarnings.eps_estimate,
      actualEPS: upcomingEarnings.eps_actual,
      reportTime: parseReportTime(upcomingEarnings.reporting_time),
      daysUntil,
    };
  } catch (error) {
    console.error(`Error fetching earnings from API Ninjas for ${symbol}:`, error);
    return null;
  }
}

// Fallback: Fetch earnings from Yahoo Finance
async function fetchFromYahoo(symbol: string): Promise<EarningsEvent | null> {
  try {
    // Dynamic import to avoid circular dependency
    const YahooFinance = (await import("yahoo-finance2")).default;
    const yf = new YahooFinance();
    
    // Try to get earnings calendar from quote summary
    const quoteSummary: any = await yf.quoteSummary(symbol, {
      modules: ["calendarEvents", "earnings"],
    });

    const earningsDate = quoteSummary?.calendarEvents?.earnings?.earningsDate?.[0];
    
    if (!earningsDate) {
      return null;
    }

    const reportDate = new Date(earningsDate);
    const now = new Date();
    const daysUntil = Math.ceil(
      (reportDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
    );

    // Skip if earnings are in the past
    if (daysUntil < 0) {
      return null;
    }

    const earnings = quoteSummary?.earnings;
    const currentQuarter = earnings?.earningsChart?.currentQuarterEstimate;

    return {
      symbol: symbol.toUpperCase(),
      companyName: symbol, // Yahoo doesn't provide company name in this endpoint
      reportDate: reportDate.toISOString().split("T")[0],
      fiscalQuarter: earnings?.earningsChart?.currentQuarterEstimateDate || "Unknown",
      estimatedEPS: currentQuarter,
      actualEPS: undefined,
      reportTime: "unknown",
      daysUntil,
    };
  } catch (error) {
    console.error(`Error fetching earnings from Yahoo for ${symbol}:`, error);
    return null;
  }
}

function parseReportTime(
  time: string | undefined
): "before_market" | "after_market" | "unknown" {
  if (!time) return "unknown";
  const lower = time.toLowerCase();
  if (lower.includes("before") || lower.includes("bmo") || lower.includes("pre")) {
    return "before_market";
  }
  if (lower.includes("after") || lower.includes("amc") || lower.includes("post")) {
    return "after_market";
  }
  return "unknown";
}

// Main function to get upcoming earnings for a symbol
export async function getUpcomingEarnings(symbol: string): Promise<EarningsEvent | null> {
  const cacheKey = `earnings:${symbol.toUpperCase()}`;
  const cached = getCached(cacheKey);
  if (cached !== undefined) {
    return cached;
  }

  // Try API Ninjas first (better data if API key is available)
  let earnings = await fetchFromAPINinjas(symbol);

  // Fall back to Yahoo Finance
  if (!earnings) {
    earnings = await fetchFromYahoo(symbol);
  }

  setCache(cacheKey, earnings);
  return earnings;
}

// Check if earnings fall within a trade window
export function hasEarningsWithinWindow(
  earnings: EarningsEvent | null,
  daysToExpiration: number
): boolean {
  if (!earnings) return false;
  return earnings.daysUntil >= 0 && earnings.daysUntil <= daysToExpiration;
}

// Get multiple upcoming earnings (for calendar view)
export async function getEarningsCalendar(
  symbols: string[]
): Promise<EarningsEvent[]> {
  const results: EarningsEvent[] = [];

  // Fetch in parallel but limit concurrency
  const batchSize = 5;
  for (let i = 0; i < symbols.length; i += batchSize) {
    const batch = symbols.slice(i, i + batchSize);
    const batchResults = await Promise.all(
      batch.map((symbol) => getUpcomingEarnings(symbol))
    );
    results.push(...batchResults.filter((e): e is EarningsEvent => e !== null));
  }

  // Sort by date
  return results.sort(
    (a, b) => new Date(a.reportDate).getTime() - new Date(b.reportDate).getTime()
  );
}
