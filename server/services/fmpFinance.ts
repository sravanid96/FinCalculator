/**
 * Minimal FMP (Financial Modeling Prep) fundamentals fallback.
 *
 * Why this exists:
 * - Yahoo endpoints are frequently blocked/throttled from cloud IPs (Render/AWS/GCP).
 * - FMP provides a free tier (limited) that can fill key fields reliably.
 *
 * Design goals:
 * - Defensive parsing: FMP field names can vary by endpoint/version.
 * - Low request count + caching: avoid burning the free 250/day quota.
 */
import type { Fundamentals } from "./fundamentalsService";

const FMP_KEY = (process.env.FMP_API_KEY || "").trim();
const FMP_BASE = "https://financialmodelingprep.com/api";

const TTL_MS = 6 * 60 * 60 * 1000; // 6h — fundamentals are not tick-by-tick
const cache = new Map<string, { ts: number; data: Partial<Fundamentals> }>();

function cacheGet(key: string): Partial<Fundamentals> | null {
  const c = cache.get(key);
  if (c && Date.now() - c.ts < TTL_MS) return c.data;
  return null;
}
function cacheSet(key: string, data: Partial<Fundamentals>) {
  cache.set(key, { ts: Date.now(), data });
}

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  try {
    return await Promise.race([
      p,
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error("timeout")), ms)),
    ]);
  } catch {
    return null;
  }
}

async function fetchJson(url: string, ms = 8000): Promise<any | null> {
  const r = await withTimeout(
    fetch(url, { headers: { Accept: "application/json" } }).then((res) =>
      res.ok ? res.json() : null
    ),
    ms
  );
  return r ?? null;
}

function n(v: any): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  const asNum = Number(v);
  if (Number.isFinite(asNum)) return asNum;
  return null;
}

function pickFirstNumber(obj: any, keys: string[]): number | null {
  for (const k of keys) {
    const v = n(obj?.[k]);
    if (v !== null) return v;
  }
  return null;
}

/**
 * Returns a partial Fundamentals object filled from FMP.
 * Never throws; returns null if no key or data unavailable.
 */
export async function getFmpFundamentals(symbol: string): Promise<Partial<Fundamentals> | null> {
  const sym = symbol.toUpperCase();
  if (!FMP_KEY) return null;
  const cacheKey = `fmpFund:v1:${sym}`;
  const hit = cacheGet(cacheKey);
  if (hit) return hit;

  // Keep request count low: quote + ratios-ttm + cash-flow-ttm are usually enough.
  const quoteUrl = `${FMP_BASE}/v3/quote/${encodeURIComponent(sym)}?apikey=${encodeURIComponent(FMP_KEY)}`;
  const profileUrl = `${FMP_BASE}/v3/profile/${encodeURIComponent(sym)}?apikey=${encodeURIComponent(FMP_KEY)}`;
  const ratiosTtmUrl = `${FMP_BASE}/v3/ratios-ttm/${encodeURIComponent(sym)}?apikey=${encodeURIComponent(FMP_KEY)}`;
  const cashflowTtmUrl = `${FMP_BASE}/v3/cash-flow-statement-ttm/${encodeURIComponent(sym)}?apikey=${encodeURIComponent(FMP_KEY)}`;
  const incomeTtmUrl = `${FMP_BASE}/v3/income-statement-ttm/${encodeURIComponent(sym)}?apikey=${encodeURIComponent(FMP_KEY)}`;

  const [quoteResp, profileResp, ratiosResp, cfResp, incResp] = await Promise.all([
    fetchJson(quoteUrl),
    fetchJson(profileUrl),
    fetchJson(ratiosTtmUrl),
    fetchJson(cashflowTtmUrl),
    fetchJson(incomeTtmUrl),
  ]);

  const quote = Array.isArray(quoteResp) ? quoteResp[0] : null;
  const profile = Array.isArray(profileResp) ? profileResp[0] : null;
  const ratios = Array.isArray(ratiosResp) ? ratiosResp[0] : null;
  const cf = Array.isArray(cfResp) ? cfResp[0] : null;
  const inc = Array.isArray(incResp) ? incResp[0] : null;

  const out: Partial<Fundamentals> = {};

  // Identity
  const name = (profile?.companyName || profile?.companyName?.trim?.() || quote?.name) ?? null;
  if (typeof name === "string" && name.trim()) out.name = name.trim();

  // Price / market cap / 52w high
  out.price = pickFirstNumber(quote, ["price", "lastPrice", "regularMarketPrice"]);
  out.marketCap = pickFirstNumber(quote, ["marketCap"]);
  out.high52Week = pickFirstNumber(quote, ["yearHigh", "fiftyTwoWeekHigh", "52WeekHigh"]);

  // P/E + EPS
  out.trailingPE = pickFirstNumber(quote, ["pe", "trailingPE", "priceEarningsRatio"]);
  out.trailingEps = pickFirstNumber(quote, ["eps", "epsTTM", "trailingEps", "epsTrailingTwelveMonths"]);
  // FMP doesn't always give forward EPS/PE for free. If absent, leave null.
  out.forwardPE = pickFirstNumber(quote, ["peForward", "forwardPE", "forwardPe"]);
  out.forwardEps = pickFirstNumber(quote, ["epsForward", "forwardEps"]);

  // Shares outstanding
  out.sharesOutstanding = pickFirstNumber(quote, ["sharesOutstanding"]);

  // Revenue + growth (TTM)
  out.ttmRevenue = pickFirstNumber(inc, ["revenue", "revenueTTM", "totalRevenue"]);
  out.revenueGrowthYoy = pickFirstNumber(ratios, ["revenueGrowthTTM", "revenueGrowth", "revenueGrowthYoy"]);

  // FCF + margins (TTM)
  const fcf = pickFirstNumber(cf, ["freeCashFlow", "freeCashFlowTTM", "freeCashFlowTtm", "freeCashFlowPerShareTTM"]);
  if (fcf !== null) out.fcf = fcf;
  if (out.fcf !== undefined && out.fcf !== null && out.ttmRevenue && out.ttmRevenue > 0) {
    out.fcfMargin = out.fcf / out.ttmRevenue;
  }

  // ROIC (TTM) — field names vary; try common ones.
  out.roic = pickFirstNumber(ratios, [
    "returnOnInvestedCapitalTTM",
    "roicTTM",
    "roic",
    "returnOnCapitalEmployedTTM",
  ]);

  // P/B + EV/Sales + EBITDA margin (TTM)
  out.priceToBook = pickFirstNumber(ratios, ["priceToBookRatioTTM", "priceToBookRatio", "pbRatioTTM", "pbRatio"]);
  out.evToSales = pickFirstNumber(ratios, ["enterpriseValueMultipleTTM", "evToSalesTTM", "enterpriseValueToSales"]);
  const ebitdaMargin = pickFirstNumber(ratios, ["ebitdaMarginTTM", "ebitdaMargin"]);
  if (ebitdaMargin !== null) out.ebitdaMargin = ebitdaMargin;

  // Derived: pct off 52w high
  if (out.price !== null && out.high52Week !== null && out.high52Week > 0) {
    out.pctOff52WeekHigh = (out.price - out.high52Week) / out.high52Week;
  }

  cacheSet(cacheKey, out);
  return out;
}

export function fmpStatus() {
  return {
    configured: !!FMP_KEY,
    cacheTtlHours: TTL_MS / 3600000,
  };
}

