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
// FMP migrated new/free keys to "stable" endpoints. Legacy /api/v3 endpoints
// can return HTTP 403 ("Legacy Endpoint") unless you're on an older paid plan.
const FMP_BASE = "https://financialmodelingprep.com/stable";

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
    fetch(url, { headers: { Accept: "application/json" } }).then(async (res) => {
      // FMP often returns useful error bodies on non-2xx (e.g. invalid key, quota).
      // Always try to parse the body so we can surface a real error.
      const status = res.status;
      const text = await res.text();
      try {
        const json = JSON.parse(text);
        if (res.ok) return json;
        return { __httpStatus: status, __httpError: true, ...json };
      } catch {
        if (res.ok) return null;
        return { __httpStatus: status, __httpError: true, message: text.slice(0, 220) };
      }
    }),
    ms
  );
  return r ?? null;
}

function extractFmpError(payload: any): string | null {
  if (!payload) return null;
  if (typeof payload === "string") return payload.slice(0, 180);
  // Common FMP error shapes:
  // { "Error Message": "Invalid API KEY." }
  // { "error": "..." } / { "message": "..." }
  const em = payload["Error Message"] ?? payload.error ?? payload.message ?? payload["Error"] ?? payload["errorMessage"];
  if (typeof em === "string" && em.trim()) {
    const status = typeof payload.__httpStatus === "number" ? `HTTP ${payload.__httpStatus}: ` : "";
    return `${status}${em.trim()}`.slice(0, 220);
  }
  // If it looks like an HTTP wrapper but no message, show keys for debugging.
  if (payload.__httpError && typeof payload.__httpStatus === "number") {
    const keys = Object.keys(payload).filter((k) => !k.startsWith("__")).slice(0, 8);
    return `HTTP ${payload.__httpStatus}: Unrecognized FMP error shape (keys: ${keys.join(", ") || "none"})`.slice(0, 220);
  }
  return null;
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

function setIfNonNull<T extends object, K extends keyof T>(obj: T, key: K, value: any) {
  const nv = n(value);
  if (nv !== null) (obj as any)[key] = nv;
}

/**
 * Returns a partial Fundamentals object filled from FMP.
 * Never throws; returns null if no key or data unavailable.
 */
export async function getFmpFundamentals(symbol: string): Promise<
  { fundamentals: Partial<Fundamentals>; error: string | null } | null
> {
  const sym = symbol.toUpperCase();
  if (!FMP_KEY) return null;
  const cacheKey = `fmpFund:v2:${sym}`;
  const hit = cacheGet(cacheKey);
  if (hit) return { fundamentals: hit, error: null };

  // Keep request count low: quote + ratios-ttm + cash-flow-ttm + income-ttm.
  // Stable endpoints use query params (symbol=) instead of path params.
  const quoteUrl = `${FMP_BASE}/quote?symbol=${encodeURIComponent(sym)}&apikey=${encodeURIComponent(FMP_KEY)}`;
  const profileUrl = `${FMP_BASE}/profile?symbol=${encodeURIComponent(sym)}&apikey=${encodeURIComponent(FMP_KEY)}`;
  const ratiosTtmUrl = `${FMP_BASE}/ratios-ttm?symbol=${encodeURIComponent(sym)}&apikey=${encodeURIComponent(FMP_KEY)}`;
  const cashflowTtmUrl = `${FMP_BASE}/cash-flow-statement-ttm?symbol=${encodeURIComponent(sym)}&apikey=${encodeURIComponent(FMP_KEY)}`;
  const incomeTtmUrl = `${FMP_BASE}/income-statement-ttm?symbol=${encodeURIComponent(sym)}&apikey=${encodeURIComponent(FMP_KEY)}`;

  const [quoteResp, profileResp, ratiosResp, cfResp, incResp] = await Promise.all([
    fetchJson(quoteUrl),
    fetchJson(profileUrl),
    fetchJson(ratiosTtmUrl),
    fetchJson(cashflowTtmUrl),
    fetchJson(incomeTtmUrl),
  ]);

  const errs = [
    extractFmpError(quoteResp),
    extractFmpError(profileResp),
    extractFmpError(ratiosResp),
    extractFmpError(cfResp),
    extractFmpError(incResp),
  ].filter((x): x is string => !!x);
  const error = errs.length > 0 ? errs[0] : null;

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
  setIfNonNull(out, "price", pickFirstNumber(quote, ["price", "lastPrice", "regularMarketPrice"]));
  setIfNonNull(out, "marketCap", pickFirstNumber(quote, ["marketCap"]));
  setIfNonNull(out, "high52Week", pickFirstNumber(quote, ["yearHigh", "fiftyTwoWeekHigh", "52WeekHigh"]));

  // P/E + EPS
  setIfNonNull(out, "trailingPE", pickFirstNumber(quote, ["pe", "trailingPE", "priceEarningsRatio"]));
  setIfNonNull(out, "trailingEps", pickFirstNumber(quote, ["eps", "epsTTM", "trailingEps", "epsTrailingTwelveMonths"]));
  // FMP doesn't always give forward EPS/PE for free. If absent, leave null.
  setIfNonNull(out, "forwardPE", pickFirstNumber(quote, ["peForward", "forwardPE", "forwardPe"]));
  setIfNonNull(out, "forwardEps", pickFirstNumber(quote, ["epsForward", "forwardEps"]));

  // Shares outstanding
  setIfNonNull(out, "sharesOutstanding", pickFirstNumber(quote, ["sharesOutstanding"]));

  // Revenue + growth (TTM)
  setIfNonNull(out, "ttmRevenue", pickFirstNumber(inc, ["revenue", "revenueTTM", "totalRevenue"]));
  setIfNonNull(out, "revenueGrowthYoy", pickFirstNumber(ratios, ["revenueGrowthTTM", "revenueGrowth", "revenueGrowthYoy"]));

  // FCF + margins (TTM)
  const fcf = pickFirstNumber(cf, ["freeCashFlow", "freeCashFlowTTM", "freeCashFlowTtm", "freeCashFlowPerShareTTM"]);
  if (fcf !== null) out.fcf = fcf;
  if (out.fcf !== undefined && out.fcf !== null && out.ttmRevenue !== undefined && out.ttmRevenue !== null && out.ttmRevenue > 0) {
    out.fcfMargin = out.fcf / out.ttmRevenue;
  }

  // ROIC (TTM) — field names vary; try common ones.
  setIfNonNull(out, "roic", pickFirstNumber(ratios, [
    "returnOnInvestedCapitalTTM",
    "roicTTM",
    "roic",
    "returnOnCapitalEmployedTTM",
  ]));

  // P/B + EV/Sales + EBITDA margin (TTM)
  setIfNonNull(out, "priceToBook", pickFirstNumber(ratios, ["priceToBookRatioTTM", "priceToBookRatio", "pbRatioTTM", "pbRatio"]));
  setIfNonNull(out, "evToSales", pickFirstNumber(ratios, ["enterpriseValueMultipleTTM", "evToSalesTTM", "enterpriseValueToSales"]));
  const ebitdaMargin = pickFirstNumber(ratios, ["ebitdaMarginTTM", "ebitdaMargin"]);
  if (ebitdaMargin !== null) out.ebitdaMargin = ebitdaMargin;

  // Derived: pct off 52w high
  if (out.price !== undefined && out.high52Week !== undefined && out.price !== null && out.high52Week !== null && out.high52Week > 0) {
    out.pctOff52WeekHigh = (out.price - out.high52Week) / out.high52Week;
  }

  // If we got nothing useful, don't cache empties (allows recovery after quota/key fixes).
  const anyValue =
    out.price != null ||
    out.high52Week != null ||
    out.trailingPE != null ||
    out.marketCap != null ||
    out.ttmRevenue != null;
  if (!anyValue) {
    const shapeHint = `quote=${Array.isArray(quoteResp) ? quoteResp.length : typeof quoteResp}, profile=${Array.isArray(profileResp) ? profileResp.length : typeof profileResp}`;
    return {
      fundamentals: {},
      error: error ?? `FMP returned no usable data (possible quota/key issue). (${shapeHint})`,
    };
  }

  cacheSet(cacheKey, out);
  return { fundamentals: out, error };
}

export function fmpStatus() {
  return {
    configured: !!FMP_KEY,
    cacheTtlHours: TTL_MS / 3600000,
  };
}

