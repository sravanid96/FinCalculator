import YahooFinance from "yahoo-finance2";
import type {
  StockQuote,
  PriceDataPoint,
  OptionsChain,
  OptionsExpiration,
  OptionContract,
} from "../../shared/optionsSchema";

// Initialize Yahoo Finance client
const yahooFinance = new YahooFinance();

// Yahoo Finance returns complex types, we use any to simplify
type YFQuote = any;
type YFChart = any;
type YFOptions = any;
type YFSearch = any;
type YFScreener = any;

// Cache for API responses
const cache = new Map<string, { data: any; timestamp: number }>();
const CACHE_TTL = 60 * 1000; // 1 minute cache for real-time data
const HISTORICAL_CACHE_TTL = 5 * 60 * 1000; // 5 minutes for historical

function getCached<T>(key: string, ttl: number = CACHE_TTL): T | null {
  const cached = cache.get(key);
  if (cached && Date.now() - cached.timestamp < ttl) {
    return cached.data as T;
  }
  return null;
}

function setCache(key: string, data: any): void {
  cache.set(key, { data, timestamp: Date.now() });
}

export async function getStockQuote(symbol: string): Promise<StockQuote> {
  const cacheKey = `quote:${symbol}`;
  const cached = getCached<StockQuote>(cacheKey);
  if (cached) return cached;

  try {
    const quote: YFQuote = await yahooFinance.quote(symbol);

    const result: StockQuote = {
      symbol: quote.symbol,
      name: quote.shortName || quote.longName || symbol,
      price: quote.regularMarketPrice || 0,
      change: quote.regularMarketChange || 0,
      changePercent: quote.regularMarketChangePercent || 0,
      volume: quote.regularMarketVolume || 0,
      marketCap: quote.marketCap,
      high52Week: quote.fiftyTwoWeekHigh,
      low52Week: quote.fiftyTwoWeekLow,
      avgVolume: quote.averageDailyVolume10Day,
      pe: quote.trailingPE,
      dividend: quote.dividendRate,
      dividendYield: quote.dividendYield,
    };

    setCache(cacheKey, result);
    return result;
  } catch (error) {
    console.error(`Error fetching quote for ${symbol}:`, error);
    throw new Error(`Failed to fetch quote for ${symbol}`);
  }
}

export async function getHistoricalPrices(
  symbol: string,
  months: number = 6
): Promise<PriceDataPoint[]> {
  const cacheKey = `historical:${symbol}:${months}`;
  const cached = getCached<PriceDataPoint[]>(cacheKey, HISTORICAL_CACHE_TTL);
  if (cached) return cached;

  try {
    const endDate = new Date();
    const startDate = new Date();
    startDate.setMonth(startDate.getMonth() - months);

    const historical: YFChart = await yahooFinance.chart(symbol, {
      period1: startDate,
      period2: endDate,
      interval: "1d",
    });

    const result: PriceDataPoint[] =
      historical.quotes?.map((q: any) => ({
        date: q.date?.toISOString().split("T")[0] || "",
        open: q.open || 0,
        high: q.high || 0,
        low: q.low || 0,
        close: q.close || 0,
        volume: q.volume || 0,
      })) || [];

    setCache(cacheKey, result);
    return result;
  } catch (error) {
    console.error(`Error fetching historical data for ${symbol}:`, error);
    throw new Error(`Failed to fetch historical data for ${symbol}`);
  }
}

export async function getOptionsChain(symbol: string): Promise<OptionsChain> {
  const cacheKey = `options:${symbol}`;
  const cached = getCached<OptionsChain>(cacheKey);
  if (cached) return cached;

  try {
    // First get the available expiration dates
    const optionsSummary: YFOptions = await yahooFinance.options(symbol);

    // Get the underlying price
    const quote = await getStockQuote(symbol);
    const underlyingPrice = quote.price;

    // Fetch options for each expiration (limit to next 4 expirations for performance)
    const expirationDates = optionsSummary.expirationDates?.slice(0, 4) || [];
    const expirations: OptionsExpiration[] = [];

    for (const expDate of expirationDates) {
      try {
        const chainData: YFOptions = await yahooFinance.options(symbol, {
          date: expDate,
        });

        const expDateStr =
          expDate instanceof Date
            ? expDate.toISOString().split("T")[0]
            : new Date(expDate * 1000).toISOString().split("T")[0];

        const daysToExp = Math.ceil(
          (new Date(expDateStr).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
        );

        const calls: OptionContract[] =
          chainData.options?.[0]?.calls?.map((c: any) =>
            mapOptionContract(c, "call", expDateStr, daysToExp, underlyingPrice)
          ) || [];

        const puts: OptionContract[] =
          chainData.options?.[0]?.puts?.map((p: any) =>
            mapOptionContract(p, "put", expDateStr, daysToExp, underlyingPrice)
          ) || [];

        expirations.push({
          expirationDate: expDateStr,
          daysToExpiration: daysToExp,
          calls,
          puts,
        });
      } catch (err) {
        console.warn(`Failed to fetch options for ${symbol} exp ${expDate}`);
      }
    }

    const result: OptionsChain = {
      symbol,
      underlyingPrice,
      expirations,
    };

    setCache(cacheKey, result);
    return result;
  } catch (error) {
    console.error(`Error fetching options chain for ${symbol}:`, error);
    throw new Error(`Failed to fetch options chain for ${symbol}`);
  }
}

function toExpirationDateString(expDate: any): string {
  return expDate instanceof Date
    ? expDate.toISOString().split("T")[0]
    : new Date(expDate * 1000).toISOString().split("T")[0];
}

function daysUntil(expirationDate: string): number {
  return Math.ceil((new Date(expirationDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
}

export async function getOptionsChainTargeted(
  symbol: string,
  targetDTE: number = 45,
  extraExpirations: number = 1
): Promise<OptionsChain> {
  const cacheKey = `optionsTargeted:${symbol}:${targetDTE}:${extraExpirations}`;
  const cached = getCached<OptionsChain>(cacheKey);
  if (cached) return cached;

  try {
    const optionsSummary: any = await yahooFinance.options(symbol);
    const quote = await getStockQuote(symbol);
    const underlyingPrice = quote.price;

    const rawDates: any[] = optionsSummary.expirationDates || [];
    if (!rawDates.length) {
      const empty: OptionsChain = { symbol, underlyingPrice, expirations: [] };
      setCache(cacheKey, empty);
      return empty;
    }

    const scored = rawDates
      .map((d) => {
        const exp = toExpirationDateString(d);
        const dte = daysUntil(exp);
        return { d, exp, dte, diff: Math.abs(dte - targetDTE) };
      })
      .sort((a, b) => a.diff - b.diff);

    const picks = scored.slice(0, Math.max(1, 1 + extraExpirations));
    const expirations: OptionsExpiration[] = [];

    for (const pick of picks) {
      try {
        const chainData: any = await yahooFinance.options(symbol, { date: pick.d });
        const calls: OptionContract[] =
          chainData.options?.[0]?.calls?.map((c: any) =>
            mapOptionContract(c, "call", pick.exp, pick.dte, underlyingPrice)
          ) || [];
        const puts: OptionContract[] =
          chainData.options?.[0]?.puts?.map((p: any) =>
            mapOptionContract(p, "put", pick.exp, pick.dte, underlyingPrice)
          ) || [];

        expirations.push({
          expirationDate: pick.exp,
          daysToExpiration: pick.dte,
          calls,
          puts,
        });
      } catch (err) {
        console.warn(`Failed to fetch targeted options for ${symbol} exp ${pick.exp}`);
      }
    }

    const result: OptionsChain = { symbol, underlyingPrice, expirations };
    setCache(cacheKey, result);
    return result;
  } catch (error) {
    console.error(`Error fetching targeted options chain for ${symbol}:`, error);
    throw new Error(`Failed to fetch options chain for ${symbol}`);
  }
}

function mapOptionContract(
  option: any,
  type: "call" | "put",
  expiration: string,
  daysToExp: number,
  underlyingPrice: number
): OptionContract {
  const strike = option.strike || 0;
  const inTheMoney =
    type === "call" ? underlyingPrice > strike : underlyingPrice < strike;

  return {
    contractSymbol: option.contractSymbol || "",
    strike,
    expiration,
    daysToExpiration: daysToExp,
    type,
    bid: option.bid || 0,
    ask: option.ask || 0,
    lastPrice: option.lastPrice || 0,
    volume: option.volume || 0,
    openInterest: option.openInterest || 0,
    impliedVolatility: (option.impliedVolatility || 0) * 100,
    delta: estimateDelta(type, strike, underlyingPrice, option.impliedVolatility || 0.3, daysToExp),
    gamma: undefined,
    theta: undefined,
    vega: undefined,
    rho: undefined,
    inTheMoney,
  };
}

// Simple delta estimation using Black-Scholes approximation
function estimateDelta(
  type: "call" | "put",
  strike: number,
  spotPrice: number,
  iv: number,
  daysToExp: number
): number {
  if (daysToExp <= 0) {
    return type === "call"
      ? spotPrice > strike
        ? 1
        : 0
      : spotPrice < strike
        ? -1
        : 0;
  }

  const T = daysToExp / 365;
  const r = 0.05; // Assume 5% risk-free rate
  const sigma = iv || 0.3;

  // Standard normal CDF approximation
  const d1 =
    (Math.log(spotPrice / strike) + (r + (sigma * sigma) / 2) * T) /
    (sigma * Math.sqrt(T));

  // Normal CDF approximation
  const normCDF = (x: number): number => {
    const a1 = 0.254829592;
    const a2 = -0.284496736;
    const a3 = 1.421413741;
    const a4 = -1.453152027;
    const a5 = 1.061405429;
    const p = 0.3275911;

    const sign = x < 0 ? -1 : 1;
    x = Math.abs(x) / Math.sqrt(2);

    const t = 1.0 / (1.0 + p * x);
    const y =
      1.0 -
      ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);

    return 0.5 * (1.0 + sign * y);
  };

  const callDelta = normCDF(d1);
  return type === "call" ? callDelta : callDelta - 1;
}

export async function searchTickers(query: string): Promise<{ symbol: string; name: string }[]> {
  if (!query || query.length < 1) return [];

  const cacheKey = `search:${query}`;
  const cached = getCached<{ symbol: string; name: string }[]>(cacheKey, HISTORICAL_CACHE_TTL);
  if (cached) return cached;

  try {
    const results: YFSearch = await yahooFinance.search(query, { newsCount: 0 });

    const quotes =
      results.quotes
        ?.filter((q: any) => q.quoteType === "EQUITY" && q.symbol)
        .slice(0, 10)
        .map((q: any) => ({
          symbol: q.symbol,
          name: q.shortname || q.longname || q.symbol,
        })) || [];

    setCache(cacheKey, quotes);
    return quotes;
  } catch (error) {
    console.error(`Error searching tickers for "${query}":`, error);
    return [];
  }
}

export async function getMostActiveTickers(
  limit: number = 50
): Promise<{ symbol: string; name: string; volume?: number; changePercent?: number; price?: number }[]> {
  const cacheKey = `screener:most_actives:${limit}`;
  const cached = getCached<
    { symbol: string; name: string; volume?: number; changePercent?: number; price?: number }[]
  >(cacheKey, CACHE_TTL);
  if (cached) return cached;

  try {
    const result: YFScreener = await (yahooFinance as any).screener("most_actives", { count: limit });
    const quotes =
      result?.quotes
        ?.filter((q: any) => q?.quoteType === "EQUITY" && q?.symbol)
        .slice(0, limit)
        .map((q: any) => ({
          symbol: String(q.symbol),
          name: q.shortName || q.longName || String(q.symbol),
          volume: q.regularMarketVolume,
          changePercent: q.regularMarketChangePercent,
          price: q.regularMarketPrice,
        })) || [];

    setCache(cacheKey, quotes);
    return quotes;
  } catch (error) {
    console.error("Error fetching most active tickers:", error);
    return [];
  }
}
