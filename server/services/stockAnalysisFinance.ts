/**
 * StockAnalysis.com scrape helpers (HTML parsing).
 *
 * Why:
 * - Yahoo doesn't expose a clean "5y average forward P/E".
 * - We use StockAnalysis ratios table to compute a simple trailing 5-FY average
 *   of the *Forward PE* row (FY columns, excluding "Current").
 *
 * Notes:
 * - Best-effort parsing; returns null on any failure.
 * - Cached in-memory per process (TTL).
 */
import { setTimeout as delay } from "node:timers/promises";

const TTL_MS = 30 * 60 * 1000;
const cache = new Map<string, { ts: number; data: any }>();

function cacheGet<T>(key: string): T | null {
  const c = cache.get(key);
  if (c && Date.now() - c.ts < TTL_MS) return c.data as T;
  return null;
}
function cacheSet(key: string, data: any) {
  cache.set(key, { ts: Date.now(), data });
}

async function fetchText(url: string, ms = 12000): Promise<string | null> {
  try {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), ms);
    const res = await fetch(url, {
      headers: {
        "User-Agent": "FinCal Research (personal use) contact@example.com",
        Accept: "text/html",
      },
      signal: ac.signal,
    });
    clearTimeout(t);
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

function parseForwardPeHistoryFromRatiosHtml(html: string): number[] | null {
  // We parse the "Forward PE" row from the main ratios table.
  // The page is a Svelte app but server-rendered enough for a plain HTML scrape.
  // Strategy: find the row that starts with ">Forward PE<" and then parse the subsequent numeric cells.
  const rxRow = /<tr[^>]*>\s*<th[^>]*>\s*Forward PE\s*<\/th>([\s\S]*?)<\/tr>/i;
  const m = html.match(rxRow);
  if (!m) return null;
  const rowHtml = m[1];
  // Extract all <td>..</td> text values
  const tds = Array.from(rowHtml.matchAll(/<td[^>]*>\s*([^<]*)\s*<\/td>/gi)).map((x) =>
    String(x[1] ?? "").replace(/,/g, "").trim()
  );
  if (tds.length === 0) return null;
  const nums = tds
    .map((s) => {
      const n = Number(s);
      return Number.isFinite(n) ? n : null;
    })
    .filter((x): x is number => x !== null);
  return nums.length ? nums : null;
}

export async function getStockAnalysisForwardPe5yAvg(symbol: string): Promise<{
  source: "stockanalysis" | "unavailable";
  forwardPe5yAvg: number | null;
  usedValues: number[]; // FY forward PE values used
  url: string;
  error?: string;
}> {
  const sym = symbol.toUpperCase();
  const key = `sa:fpe5y:${sym}`;
  const hit = cacheGet<any>(key);
  if (hit) return hit;

  const url = `https://stockanalysis.com/stocks/${encodeURIComponent(sym.toLowerCase())}/financials/ratios/`;
  const html = await fetchText(url);
  if (!html) {
    const out = { source: "unavailable" as const, forwardPe5yAvg: null, usedValues: [], url, error: "fetch failed" };
    cacheSet(key, out);
    return out;
  }

  const hist = parseForwardPeHistoryFromRatiosHtml(html);
  if (!hist || hist.length < 2) {
    const out = {
      source: "unavailable" as const,
      forwardPe5yAvg: null,
      usedValues: [],
      url,
      error: "Forward PE history parse failed",
    };
    cacheSet(key, out);
    return out;
  }

  // StockAnalysis table order is: Current, FYxxxx, FYxxxx... but our regex row only captured td's,
  // which include Current first. We want the last 5 FY values, excluding "Current".
  const fy = hist.slice(1); // drop current
  const last5 = fy.slice(0, 5); // most recent FYs first
  const avg = last5.length ? last5.reduce((a, b) => a + b, 0) / last5.length : null;

  const out = {
    source: "stockanalysis" as const,
    forwardPe5yAvg: avg,
    usedValues: last5,
    url,
  };
  cacheSet(key, out);

  // Gentle politeness (avoid hammering the host in bursts)
  await delay(150);
  return out;
}

export function stockAnalysisStatus() {
  return { cacheTtlMinutes: TTL_MS / 60000 };
}

