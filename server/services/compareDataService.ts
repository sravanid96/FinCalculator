/**
 * Compare data service — orchestrates Yahoo + FMP + Finnhub + SEC EDGAR
 * to build a side-by-side comparison payload for two tickers.
 *
 * Design rules:
 *  - Every external call is wrapped, time-budgeted, and falls back to null.
 *  - If no API key is configured for FMP / Finnhub, those sections return
 *    a `source: "unavailable"` flag so the UI can show an honest gap.
 *  - SEC EDGAR is keyless but requires a User-Agent header per SEC policy.
 *  - All results are cached for COMPARE_TTL minutes.
 */

import * as YahooFinanceNS from "yahoo-finance2";

const YahooFinanceCtor: any =
  (YahooFinanceNS as any).default?.default ?? (YahooFinanceNS as any).default ?? YahooFinanceNS;
const yahooFinance: any = new YahooFinanceCtor({ suppressNotices: ["yahooSurvey"] });

const FMP_KEY = process.env.FMP_API_KEY || "";
const FINNHUB_KEY = process.env.FINNHUB_API_KEY || "";
// SEC requires a contact email per their fair-access policy.
const EDGAR_UA = process.env.EDGAR_USER_AGENT || "FinCal Research compare-tab contact@example.com";

const COMPARE_TTL_MS = 60 * 60 * 1000; // 1 hour — these inputs don't change tick-to-tick
const cache = new Map<string, { data: any; ts: number }>();

function cacheGet<T>(key: string): T | null {
  const c = cache.get(key);
  if (c && Date.now() - c.ts < COMPARE_TTL_MS) return c.data as T;
  return null;
}
function cacheSet(key: string, data: any) {
  cache.set(key, { data, ts: Date.now() });
}

/** Promise with timeout — returns null on timeout/error rather than throwing. */
async function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T | null> {
  try {
    const out = await Promise.race([
      p,
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error(`timeout ${label}`)), ms)),
    ]);
    return out;
  } catch (e) {
    if (process.env.DEBUG_COMPARE) console.warn(`[compare] ${label}:`, (e as Error).message);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Yahoo: company description, peers, forward revenue estimates, segment hints
// ─────────────────────────────────────────────────────────────────────────────

export interface YahooCompareSlice {
  description: string | null;
  sector: string | null;
  industry: string | null;
  fullTimeEmployees: number | null;
  website: string | null;
  similarSymbols: string[];
  // Forward revenue from earningsTrend
  revenueEstimateFy1: { mean: number | null; growth: number | null; period: string } | null;
  revenueEstimateFy2: { mean: number | null; growth: number | null; period: string } | null;
  // Segment hint from annual fundamentalsTimeSeries (often null — that's fine, label honestly)
  segmentHint: string[] | null;
}

async function fetchYahooSlice(symbol: string): Promise<YahooCompareSlice> {
  const empty: YahooCompareSlice = {
    description: null,
    sector: null,
    industry: null,
    fullTimeEmployees: null,
    website: null,
    similarSymbols: [],
    revenueEstimateFy1: null,
    revenueEstimateFy2: null,
    segmentHint: null,
  };

  const summary: any = await withTimeout(
    yahooFinance.quoteSummary(
      symbol,
      { modules: ["assetProfile", "earningsTrend", "recommendationTrend"] },
      { validateResult: false }
    ),
    8000,
    `yahoo.quoteSummary(${symbol})`
  );

  if (summary) {
    const ap = summary.assetProfile ?? {};
    empty.description = ap.longBusinessSummary || null;
    empty.sector = ap.sector || null;
    empty.industry = ap.industry || null;
    empty.fullTimeEmployees = typeof ap.fullTimeEmployees === "number" ? ap.fullTimeEmployees : null;
    empty.website = ap.website || null;

    // Yahoo's "similar symbols" sometimes ships under recommendationTrend.similarSymbols
    // in older payloads; modern responses move it to a top-level `recommendation` block.
    const sims = (summary.recommendationTrend?.similarSymbols as string[]) || [];
    if (Array.isArray(sims)) empty.similarSymbols = sims.slice(0, 8);

    // Forward revenue: earningsTrend.trend has period codes 0q, +1q, 0y, +1y
    const trend: any[] = summary.earningsTrend?.trend || [];
    const fy1 = trend.find((t) => t?.period === "+1y") || trend.find((t) => t?.period === "0y");
    const fy2 = trend.find((t) => t?.period === "+2y");
    const num = (v: any) =>
      v == null ? null : typeof v === "number" ? v : typeof v.raw === "number" ? v.raw : null;
    if (fy1) {
      empty.revenueEstimateFy1 = {
        mean: num(fy1.revenueEstimate?.avg),
        growth: num(fy1.revenueEstimate?.growth),
        period: fy1.period || "FY1",
      };
    }
    if (fy2) {
      empty.revenueEstimateFy2 = {
        mean: num(fy2.revenueEstimate?.avg),
        growth: num(fy2.revenueEstimate?.growth),
        period: fy2.period || "FY2",
      };
    }
  }

  // Segment hint via fundamentalsTimeSeries — annual financials sometimes carry
  // operating segment lines; we expose distinct non-null fields as a hint, not truth.
  const period1 = new Date();
  period1.setFullYear(period1.getFullYear() - 2);
  const annualFin: any[] | null = await withTimeout(
    yahooFinance.fundamentalsTimeSeries(
      symbol,
      { period1, type: "annual", module: "financials" },
      { validateResult: false }
    ),
    8000,
    `yahoo.fundamentalsTimeSeries(${symbol})`
  );

  if (Array.isArray(annualFin) && annualFin.length > 0) {
    // Take the most recent row, list any keys that look segment-y and are not null.
    const sorted = [...annualFin].sort((a, b) => {
      const ad = a?.date instanceof Date ? a.date.getTime() : new Date(a?.date ?? 0).getTime();
      const bd = b?.date instanceof Date ? b.date.getTime() : new Date(b?.date ?? 0).getTime();
      return bd - ad;
    });
    const latest = sorted[0] || {};
    const keys = Object.keys(latest).filter(
      (k) =>
        /segment|product|service|gaming|datacenter|automotive|cloud/i.test(k) &&
        latest[k] != null &&
        latest[k] !== 0
    );
    if (keys.length > 0) {
      empty.segmentHint = keys.slice(0, 6);
    }
  }

  return empty;
}

// ─────────────────────────────────────────────────────────────────────────────
// FMP: peer list + analyst estimates (forward revenue) + key metrics
// ─────────────────────────────────────────────────────────────────────────────

export interface FmpCompareSlice {
  source: "fmp" | "unavailable";
  reason?: string;
  peers: string[];
  analystEstimates: Array<{
    date: string;
    revenueAvg: number | null;
    revenueLow: number | null;
    revenueHigh: number | null;
    epsAvg: number | null;
    numAnalysts: number | null;
  }>;
}

async function fetchFmpSlice(symbol: string): Promise<FmpCompareSlice> {
  if (!FMP_KEY) {
    return {
      source: "unavailable",
      reason: "FMP_API_KEY not set. Sign up at financialmodelingprep.com (free) and add to .env.",
      peers: [],
      analystEstimates: [],
    };
  }

  const peersUrl = `https://financialmodelingprep.com/api/v4/stock_peers?symbol=${encodeURIComponent(symbol)}&apikey=${FMP_KEY}`;
  const estUrl = `https://financialmodelingprep.com/api/v3/analyst-estimates/${encodeURIComponent(symbol)}?limit=4&apikey=${FMP_KEY}`;

  const [peersResp, estResp] = await Promise.all([
    withTimeout(fetch(peersUrl).then((r) => r.json()), 8000, `fmp.peers(${symbol})`),
    withTimeout(fetch(estUrl).then((r) => r.json()), 8000, `fmp.estimates(${symbol})`),
  ]);

  // FMP returns peers either as [{symbol, peersList}] OR an error-shape object.
  const peersList: string[] = Array.isArray(peersResp)
    ? (peersResp[0]?.peersList || []).slice(0, 10)
    : [];

  const ests = Array.isArray(estResp) ? estResp.slice(0, 4) : [];
  const analystEstimates = ests.map((e: any) => ({
    date: String(e?.date ?? ""),
    revenueAvg: typeof e?.estimatedRevenueAvg === "number" ? e.estimatedRevenueAvg : null,
    revenueLow: typeof e?.estimatedRevenueLow === "number" ? e.estimatedRevenueLow : null,
    revenueHigh: typeof e?.estimatedRevenueHigh === "number" ? e.estimatedRevenueHigh : null,
    epsAvg: typeof e?.estimatedEpsAvg === "number" ? e.estimatedEpsAvg : null,
    numAnalysts: typeof e?.numberAnalystEstimatedRevenue === "number" ? e.numberAnalystEstimatedRevenue : null,
  }));

  return {
    source: "fmp",
    peers: peersList,
    analystEstimates,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Finnhub: peers + recent company news (signal for "what they're working on")
// ─────────────────────────────────────────────────────────────────────────────

export interface FinnhubCompareSlice {
  source: "finnhub" | "unavailable";
  reason?: string;
  peers: string[];
  recentNews: Array<{ datetime: string; headline: string; source: string; url: string }>;
}

async function fetchFinnhubSlice(symbol: string): Promise<FinnhubCompareSlice> {
  if (!FINNHUB_KEY) {
    return {
      source: "unavailable",
      reason: "FINNHUB_API_KEY not set. Sign up at finnhub.io (free) and add to .env.",
      peers: [],
      recentNews: [],
    };
  }

  const peersUrl = `https://finnhub.io/api/v1/stock/peers?symbol=${encodeURIComponent(symbol)}&token=${FINNHUB_KEY}`;
  const today = new Date();
  const past = new Date();
  past.setDate(past.getDate() - 30);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  const newsUrl = `https://finnhub.io/api/v1/company-news?symbol=${encodeURIComponent(symbol)}&from=${fmt(past)}&to=${fmt(today)}&token=${FINNHUB_KEY}`;

  const [peersResp, newsResp] = await Promise.all([
    withTimeout(fetch(peersUrl).then((r) => r.json()), 8000, `finnhub.peers(${symbol})`),
    withTimeout(fetch(newsUrl).then((r) => r.json()), 8000, `finnhub.news(${symbol})`),
  ]);

  const peers: string[] = Array.isArray(peersResp) ? peersResp.slice(0, 10) : [];
  const newsArr = Array.isArray(newsResp) ? newsResp : [];
  // Filter to anything that mentions a tech/product keyword, take latest 6.
  const techRx = /(announce|launch|release|unveil|partnership|chip|gpu|ai\b|model|product|patent|fda|trial|contract|wins|deal)/i;
  const recentNews = newsArr
    .filter((n: any) => n?.headline && (techRx.test(n.headline) || techRx.test(n.summary || "")))
    .sort((a: any, b: any) => (b.datetime || 0) - (a.datetime || 0))
    .slice(0, 6)
    .map((n: any) => ({
      datetime: n.datetime ? new Date(n.datetime * 1000).toISOString() : "",
      headline: String(n.headline || ""),
      source: String(n.source || ""),
      url: String(n.url || ""),
    }));

  return { source: "finnhub", peers, recentNews };
}

// ─────────────────────────────────────────────────────────────────────────────
// SEC EDGAR: 10-K Item 1 "Business Overview" excerpt
// ─────────────────────────────────────────────────────────────────────────────

export interface EdgarCompareSlice {
  source: "edgar" | "unavailable";
  reason?: string;
  cik: string | null;
  filingDate: string | null;
  filingUrl: string | null;
  businessSummary: string | null; // first ~2000 chars of Item 1, plain text
}

async function fetchEdgarTickerToCik(symbol: string): Promise<string | null> {
  // SEC ships company_tickers.json; we cache that map for the whole process.
  const mapKey = "edgar:tickerMap";
  const cached = cacheGet<Record<string, string>>(mapKey);
  if (cached) return cached[symbol.toUpperCase()] ?? null;

  const resp: any = await withTimeout(
    fetch("https://www.sec.gov/files/company_tickers.json", {
      headers: { "User-Agent": EDGAR_UA, Accept: "application/json" },
    }).then((r) => (r.ok ? r.json() : null)),
    8000,
    "edgar.tickerMap"
  );
  if (!resp || typeof resp !== "object") return null;

  const map: Record<string, string> = {};
  for (const k of Object.keys(resp)) {
    const e = resp[k];
    if (e?.ticker && e?.cik_str) {
      map[String(e.ticker).toUpperCase()] = String(e.cik_str).padStart(10, "0");
    }
  }
  cacheSet(mapKey, map);
  return map[symbol.toUpperCase()] ?? null;
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&[a-z]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractItem1(text: string): string | null {
  // Find "Item 1" header and slice until "Item 1A" or "Item 2".
  // SEC filings are unstructured; this is best-effort.
  const start = text.search(/item\s*1\s*\.?\s*business/i);
  if (start < 0) return null;
  const tail = text.slice(start);
  const stop = tail.search(/item\s*1a\s*\.?\s*risk\s*factors/i);
  const sliced = stop > 0 ? tail.slice(0, stop) : tail.slice(0, 4000);
  return sliced.slice(0, 2200);
}

async function fetchEdgarSlice(symbol: string): Promise<EdgarCompareSlice> {
  const empty: EdgarCompareSlice = {
    source: "edgar",
    cik: null,
    filingDate: null,
    filingUrl: null,
    businessSummary: null,
  };

  const cik = await fetchEdgarTickerToCik(symbol);
  if (!cik) {
    return { ...empty, source: "unavailable", reason: `CIK not found for ${symbol} (foreign filer or new listing).` };
  }
  empty.cik = cik;

  const subUrl = `https://data.sec.gov/submissions/CIK${cik}.json`;
  const sub: any = await withTimeout(
    fetch(subUrl, { headers: { "User-Agent": EDGAR_UA, Accept: "application/json" } }).then((r) =>
      r.ok ? r.json() : null
    ),
    8000,
    `edgar.submissions(${symbol})`
  );
  if (!sub) return { ...empty, source: "unavailable", reason: "EDGAR submissions endpoint failed." };

  const recent = sub?.filings?.recent;
  if (!recent || !Array.isArray(recent.form)) {
    return { ...empty, source: "unavailable", reason: "No recent filings index in EDGAR response." };
  }

  // Find latest 10-K
  const idx = recent.form.findIndex((f: string) => f === "10-K");
  if (idx < 0) {
    return { ...empty, source: "unavailable", reason: "No 10-K found in last submissions window." };
  }

  const accession = String(recent.accessionNumber[idx] || "").replace(/-/g, "");
  const primaryDoc = String(recent.primaryDocument[idx] || "");
  const filingDate = String(recent.filingDate[idx] || "");
  if (!accession || !primaryDoc) {
    return { ...empty, source: "unavailable", reason: "10-K accession/document missing." };
  }

  const cikNum = String(parseInt(cik, 10));
  const filingUrl = `https://www.sec.gov/Archives/edgar/data/${cikNum}/${accession}/${primaryDoc}`;
  empty.filingUrl = filingUrl;
  empty.filingDate = filingDate;

  // Pull the doc, strip HTML, extract Item 1.
  const html: string | null = await withTimeout(
    fetch(filingUrl, { headers: { "User-Agent": EDGAR_UA } }).then((r) => (r.ok ? r.text() : null)),
    20000,
    `edgar.10K(${symbol})`
  );
  if (!html) {
    return { ...empty, source: "unavailable", reason: "Failed to fetch 10-K document." };
  }

  const text = stripHtml(html);
  empty.businessSummary = extractItem1(text);
  if (!empty.businessSummary) {
    // Fall back to first 2000 chars after the company name — better than nothing.
    empty.businessSummary = text.slice(0, 2000);
  }

  return empty;
}

// ─────────────────────────────────────────────────────────────────────────────
// Composite payload
// ─────────────────────────────────────────────────────────────────────────────

export interface CompareTickerPayload {
  symbol: string;
  yahoo: YahooCompareSlice;
  fmp: FmpCompareSlice;
  finnhub: FinnhubCompareSlice;
  edgar: EdgarCompareSlice;
}

/** Cross-reference peer lists to find true overlap competitors. */
export function intersectPeers(payloads: CompareTickerPayload[]): {
  consensusPeers: string[];
  byTicker: Record<string, string[]>;
} {
  const byTicker: Record<string, string[]> = {};
  const counts = new Map<string, number>();

  for (const p of payloads) {
    const merged = new Set<string>();
    for (const s of p.yahoo.similarSymbols) merged.add(s.toUpperCase());
    for (const s of p.fmp.peers) merged.add(s.toUpperCase());
    for (const s of p.finnhub.peers) merged.add(s.toUpperCase());
    merged.delete(p.symbol.toUpperCase());
    byTicker[p.symbol] = Array.from(merged).slice(0, 12);
    merged.forEach((s) => counts.set(s, (counts.get(s) || 0) + 1));
  }

  const consensusPeers = Array.from(counts.entries())
    .filter(([, n]) => n >= 2)
    .sort((a, b) => b[1] - a[1])
    .map(([s]) => s)
    .slice(0, 8);

  return { consensusPeers, byTicker };
}

export async function getCompareData(symbol: string): Promise<CompareTickerPayload> {
  const sym = symbol.toUpperCase();
  const key = `compare:v1:${sym}`;
  const hit = cacheGet<CompareTickerPayload>(key);
  if (hit) return hit;

  const [yahoo, fmp, finnhub, edgar] = await Promise.all([
    fetchYahooSlice(sym),
    fetchFmpSlice(sym),
    fetchFinnhubSlice(sym),
    fetchEdgarSlice(sym),
  ]);

  const out: CompareTickerPayload = { symbol: sym, yahoo, fmp, finnhub, edgar };
  cacheSet(key, out);
  return out;
}

export function compareDataSourceStatus() {
  return {
    fmpConfigured: !!FMP_KEY,
    finnhubConfigured: !!FINNHUB_KEY,
    edgarUserAgent: EDGAR_UA,
    cacheTtlMinutes: COMPARE_TTL_MS / 60000,
  };
}
