/**
 * Finnhub snapshot fallback.
 *
 * Why:
 * - Yahoo blocks cloud IPs (429/crumb) frequently.
 * - FMP free tier has moved many endpoints behind premium gates.
 * - Finnhub free tier is generous for low-volume use and exposes
 *   current price and basic financial metrics (incl. 52w high/low, PE TTM).
 */
import type { Fundamentals } from "./fundamentalsService";

const FINNHUB_KEY = (process.env.FINNHUB_API_KEY || "").trim();

const TTL_MS = 30 * 60 * 1000; // 30m — similar to fundamentals cache; avoids rate bursts
const cache = new Map<string, { ts: number; data: Partial<Fundamentals>; error: string | null }>();

function cacheGet(key: string): { data: Partial<Fundamentals>; error: string | null } | null {
  const c = cache.get(key);
  if (c && Date.now() - c.ts < TTL_MS) return { data: c.data, error: c.error };
  return null;
}
function cacheSet(key: string, data: Partial<Fundamentals>, error: string | null) {
  cache.set(key, { ts: Date.now(), data, error });
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

function n(v: any): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  const asNum = Number(v);
  return Number.isFinite(asNum) ? asNum : null;
}

function errFrom(payload: any): string | null {
  if (!payload) return null;
  const status = typeof payload.__httpStatus === "number" ? `HTTP ${payload.__httpStatus}: ` : "";
  const msg = payload.error ?? payload.message ?? payload["Error Message"];
  if (typeof msg === "string" && msg.trim()) return `${status}${msg.trim()}`.slice(0, 220);
  if (payload.__httpError && status) return `${status}Finnhub error`.slice(0, 220);
  return null;
}

/**
 * Uses:
 * - /quote for current price
 * - /stock/metric?metric=all for 52w high/low, PE TTM, market cap, shares
 */
export async function getFinnhubSnapshot(symbol: string): Promise<
  { fundamentals: Partial<Fundamentals>; error: string | null } | null
> {
  const sym = symbol.toUpperCase();
  if (!FINNHUB_KEY) return null;
  const cacheKey = `finn:v2:${sym}`;
  const hit = cacheGet(cacheKey);
  if (hit) return { fundamentals: hit.data, error: hit.error };

  const quoteUrl = `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(sym)}&token=${encodeURIComponent(FINNHUB_KEY)}`;
  const metricUrl = `https://finnhub.io/api/v1/stock/metric?symbol=${encodeURIComponent(sym)}&metric=all&token=${encodeURIComponent(FINNHUB_KEY)}`;
  const profileUrl = `https://finnhub.io/api/v1/stock/profile2?symbol=${encodeURIComponent(sym)}&token=${encodeURIComponent(FINNHUB_KEY)}`;

  const [q, m, prof] = await Promise.all([
    fetchJson(quoteUrl),
    fetchJson(metricUrl),
    fetchJson(profileUrl),
  ]);
  const error = errFrom(q) ?? errFrom(m) ?? errFrom(prof);

  const out: Partial<Fundamentals> = {};

  // Quote: { c: current, h: high of day, l: low of day, o: open, pc: prev close }
  const price = n(q?.c);
  if (price !== null) out.price = price;

  if (typeof prof?.name === "string" && prof.name.trim()) out.name = prof.name.trim();

  const metric = m?.metric ?? {};
  // Finnhub uses mixed key styles across versions; try all.
  const high52 = n(
    metric.week52High ??
      metric["52WeekHigh"] ??
      metric.fiftyTwoWeekHigh ??
      metric["fiftyTwoWeekHigh"]
  );
  if (high52 !== null) out.high52Week = high52;

  const peTtm = n(
    metric.peTTM ??
      metric.peBasicExclExtraTTM ??
      metric.peNormalizedAnnual ??
      metric.peAnnual
  );
  if (peTtm !== null) out.trailingPE = peTtm;

  // Profile2: marketCapitalization is typically full USD for US listings.
  const profMcap = n(prof?.marketCapitalization);
  if (profMcap !== null) out.marketCap = profMcap;

  const metricMcap = n(metric.marketCapitalization);
  if (metricMcap !== null && out.marketCap == null) {
    out.marketCap = metricMcap * 1e6;
  }

  const profShares = n(prof?.shareOutstanding);
  if (profShares !== null) out.sharesOutstanding = profShares;

  const metricShares = n(metric.shareOutstanding);
  if (metricShares !== null && out.sharesOutstanding == null) {
    out.sharesOutstanding = metricShares * 1e6;
  }

  // Derived pct off 52w high
  if (out.price != null && out.high52Week != null && out.high52Week > 0) {
    out.pctOff52WeekHigh = (out.price - out.high52Week) / out.high52Week;
  }

  const anyValue = out.price != null || out.high52Week != null || out.trailingPE != null || out.marketCap != null;
  if (!anyValue) {
    cacheSet(cacheKey, {}, error ?? "Finnhub returned no usable snapshot fields.");
    return { fundamentals: {}, error: error ?? "Finnhub returned no usable snapshot fields." };
  }

  cacheSet(cacheKey, out, error);
  return { fundamentals: out, error };
}

export function finnhubStatus() {
  return { configured: !!FINNHUB_KEY, cacheTtlMinutes: TTL_MS / 60000 };
}

