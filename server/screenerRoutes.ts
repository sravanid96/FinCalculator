import { Router, Request, Response } from "express";
import { getFundamentals, getFundamentalsBatch } from "./services/fundamentalsService";
import {
  scoreQualityDiscount,
  rankQualityDiscount,
  scoreCyclicalTrough,
  rankCyclicalTrough,
} from "./services/screenerEngine";
import { UNIVERSES, listUniverses } from "./services/screenerUniverses";
import { getTreasury10YieldPercent, getEtfValuationSnapshot } from "./services/yahooFinance";
import { buildMarketCalibration, getAnchorEtfForUniverse } from "./services/marketCalibrationService";
import {
  getCompareData,
  intersectPeers,
  compareDataSourceStatus,
} from "./services/compareDataService";
import { computePriceTargets } from "./services/priceTargetService";

const router = Router();

const cache = new Map<string, { data: any; timestamp: number }>();
const TTL = 15 * 60 * 1000; // 15 min — screener picks up market moves faster (still not tick-by-tick)

function cached<T>(key: string): T | null {
  const c = cache.get(key);
  if (c && Date.now() - c.timestamp < TTL) return c.data as T;
  return null;
}
function setCache(key: string, data: any) {
  cache.set(key, { data, timestamp: Date.now() });
}

router.get("/universes", (_req, res) => {
  res.json(listUniverses());
});

router.get("/universe/:id", (req, res) => {
  const id = req.params.id.toUpperCase();
  const u = UNIVERSES[id];
  if (!u) return res.status(404).json({ error: "Universe not found" });
  res.json({
    id: u.id,
    label: u.label,
    description: u.description,
    tickers: u.tickers,
    thesisHooks: u.thesisHooks,
    notes: u.notes ?? [],
  });
});

function resolveTickers(req: Request): { tickers: string[]; universeMeta: { id: string; label: string; thesisHooks: Record<string, string>; notes: string[] } | null } {
  const universeId = (req.query.universe as string)?.toUpperCase();
  const customParam = (req.query.symbols as string)?.trim();

  if (customParam) {
    const tickers = customParam
      .split(",")
      .map((s) => s.trim().toUpperCase())
      .filter((s) => /^[A-Z][A-Z0-9.\-]{0,9}$/.test(s))
      .slice(0, 50);
    return { tickers, universeMeta: null };
  }

  if (universeId && UNIVERSES[universeId]) {
    const u = UNIVERSES[universeId];
    return {
      tickers: u.tickers,
      universeMeta: {
        id: u.id,
        label: u.label,
        thesisHooks: u.thesisHooks,
        notes: u.notes ?? [],
      },
    };
  }

  // Default
  const u = UNIVERSES.AI_INFRA;
  return {
    tickers: u.tickers,
    universeMeta: { id: u.id, label: u.label, thesisHooks: u.thesisHooks, notes: u.notes ?? [] },
  };
}

router.get("/quality-discount", async (req: Request, res: Response) => {
  const { tickers, universeMeta } = resolveTickers(req);
  if (tickers.length === 0) {
    return res.status(400).json({ error: "No tickers resolved. Provide ?universe=AI_INFRA or ?symbols=AAPL,MSFT" });
  }

  const tnx = await getTreasury10YieldPercent();
  const anchorEtf = getAnchorEtfForUniverse(universeMeta?.id ?? null);
  const etfSnap = anchorEtf ? await getEtfValuationSnapshot(anchorEtf) : null;
  const sectorSnap =
    anchorEtf && etfSnap
      ? { etf: anchorEtf, forwardPE: etfSnap.forwardPE, trailingPE: etfSnap.trailingPE }
      : null;
  const calibration = buildMarketCalibration(universeMeta?.id ?? null, tnx, sectorSnap);
  const fpeKey = sectorSnap?.forwardPE != null ? sectorSnap.forwardPE.toFixed(1) : "na";
  const cacheKey = `qd:v8:${universeMeta?.id ?? "CUST"}:${tnx?.toFixed(2) ?? "na"}:${fpeKey}:${tickers.join(",")}`;
  const hit = cached<any>(cacheKey);
  if (hit) return res.json(hit);

  try {
    const fundamentals = await getFundamentalsBatch(tickers);
    const fundamentalsBySymbol: Record<string, typeof fundamentals[number]> = {};
    for (const f of fundamentals) fundamentalsBySymbol[f.symbol] = f;
    const scored = fundamentals.map(scoreQualityDiscount);
    const ranked = rankQualityDiscount(
      scored,
      universeMeta?.thesisHooks ?? {},
      fundamentalsBySymbol,
      calibration
    );

    const summary = {
      generatedAt: new Date().toISOString(),
      cacheTtlSeconds: TTL / 1000,
      fundamentalsTtlSeconds: 30 * 60,
      marketCalibration: calibration,
      universe: universeMeta
        ? { id: universeMeta.id, label: universeMeta.label, notes: universeMeta.notes }
        : { id: "CUSTOM", label: "Custom list", notes: [] },
      tickerCount: tickers.length,
      tierCounts: {
        BEST: ranked.filter((r) => r.tier === "BEST").length,
        STRONG: ranked.filter((r) => r.tier === "STRONG").length,
        WATCH: ranked.filter((r) => r.tier === "WATCH").length,
        AVOID: ranked.filter((r) => r.tier === "AVOID").length,
      },
      methodology: [
        `Screener response cache: ${TTL / 1000 / 60} minutes. Per-ticker fundamentals cache: 30 minutes. ^TNX (10Y) cache: 5 minutes.`,
        `Data as of ${new Date().toISOString().slice(0, 10)}. Verify against the latest 10-Q/10-K before any trade.`,
        "Macro calibration: multiples blend (1) 10Y yield (^TNX) and (2) sector ETF forward P/E from Yahoo quoteSummary — SMH for semis/AI-infra (iShares SOXX would behave similarly), IGV software, XLI industrials, ITA defense, XLF financials, XLV health. Base multiple = 38% yield-implied + 62% sector-forward-P/E anchor when ETF forward P/E is in range; else semis themes use a small manual band tilt. DCF = 10Y + ERP (clamped).",
        "Long-term hook = curated role description (stable). Live snapshot = data-derived from current Yahoo fundamentals (changes every refresh).",
        "Price target column: (1) Analyst consensus (Yahoo). (2) Multiple bands on forward EPS using calibrated multiples. (3) Simple DCF with 10Y-linked discount + capped growth. If methods disagree wildly, dig deeper.",
        "Quality (max 80): +20 each — ROIC ≥ 15%, FCF positive, NetDebt/EBITDA < 2x, Revenue YoY > 0.",
        "Discount (max 20): +10 each — ≥15% off 52w high, Forward P/E < Trailing P/E.",
        "Tiers: BEST 80-100, STRONG 65-79, WATCH 50-64, AVOID <50.",
        "Data source: Yahoo Finance quoteSummary + fundamentalsTimeSeries (TTM income/cashflow, latest annual balance sheet).",
        "ROIC computed as NOPAT / Invested Capital. Yahoo's `investedCapital` field used when available; else Debt + Equity − Cash.",
        "Where any field is null, that gate cannot pass and the row's score is reduced. Don't trade on a row with multiple Missing flags without manual verification.",
      ],
      rows: ranked,
    };

    setCache(cacheKey, summary);
    res.json(summary);
  } catch (e) {
    console.error("quality-discount screener error:", e);
    res.status(500).json({ error: "Screener failed", message: (e as Error).message });
  }
});

router.get("/cyclical-trough", async (req: Request, res: Response) => {
  const { tickers, universeMeta } = resolveTickers(req);
  if (tickers.length === 0) {
    return res.status(400).json({ error: "No tickers resolved. Provide ?universe=MEMORY or ?symbols=MU,WDC" });
  }

  const cacheKey = `ct:v2:${tickers.join(",")}`;
  const hit = cached<any>(cacheKey);
  if (hit) return res.json(hit);

  try {
    const fundamentals = await getFundamentalsBatch(tickers);
    const scored = fundamentals.map(scoreCyclicalTrough);
    const ranked = rankCyclicalTrough(scored);

    const summary = {
      generatedAt: new Date().toISOString(),
      universe: universeMeta
        ? { id: universeMeta.id, label: universeMeta.label, notes: universeMeta.notes }
        : { id: "CUSTOM", label: "Custom list", notes: [] },
      tickerCount: tickers.length,
      methodology: [
        `Data as of ${new Date().toISOString().slice(0,10)}. Verify against the latest 10-Q/10-K before any trade.`,
        "Different game from Quality at a Discount. Looking for businesses that look temporarily broken.",
        "+30 if ≥40% off 52w high; +20 if ≥30% off; +10 if ≥20% off.",
        "+25 if P/B < 1.5; +15 if < 2.5.",
        "+15 if EV/Sales < 1.5; +8 if < 3.",
        "+15 if EBITDA margin < 5% (margin trough); −10 if > 30% (already healthy, not a trough).",
        "+15 if revenue YoY < −10% (deep contraction = bottom forming); −10 if YoY > 20% (cycle already turned).",
        "Signals: early ≥60, watch ≥40, missed if revenue already accelerating and stock near highs.",
        "Limitation: cannot verify industry capex cuts or customer destocking from Yahoo alone — verify those externally.",
      ],
      rows: ranked,
    };

    setCache(cacheKey, summary);
    res.json(summary);
  } catch (e) {
    console.error("cyclical-trough screener error:", e);
    res.status(500).json({ error: "Screener failed", message: (e as Error).message });
  }
});

// =============================================================================
// Compare endpoint — side-by-side, multi-source for two tickers.
// =============================================================================
// Reuses the screener's fundamentals + price-target + market calibration so the
// comparison stays consistent with what the user sees on the Screener tab.

router.get("/compare/sources", (_req: Request, res: Response) => {
  res.json(compareDataSourceStatus());
});

router.get("/compare/:a/:b", async (req: Request, res: Response) => {
  const a = req.params.a.toUpperCase();
  const b = req.params.b.toUpperCase();
  if (!/^[A-Z][A-Z0-9.\-]{0,9}$/.test(a) || !/^[A-Z][A-Z0-9.\-]{0,9}$/.test(b)) {
    return res.status(400).json({ error: "Invalid ticker format" });
  }
  if (a === b) {
    return res.status(400).json({ error: "Pick two different tickers." });
  }

  const cacheKey = `compare:v2:${a}:${b}`;
  const hit = cached<any>(cacheKey);
  if (hit) return res.json(hit);

  try {
    // Macro calibration for the price-target stack (custom universe = no sector ETF anchor)
    const tnx = await getTreasury10YieldPercent();
    const calibration = buildMarketCalibration(null, tnx, null);

    // Pull all tickers' multi-source data + screener-style fundamentals in parallel
    const [aCompare, bCompare, aFund, bFund] = await Promise.all([
      getCompareData(a),
      getCompareData(b),
      getFundamentals(a),
      getFundamentals(b),
    ]);

    const aScored = scoreQualityDiscount(aFund);
    const bScored = scoreQualityDiscount(bFund);
    const aTargets = computePriceTargets(aFund, calibration);
    const bTargets = computePriceTargets(bFund, calibration);

    const peers = intersectPeers([aCompare, bCompare]);

    const payload = {
      generatedAt: new Date().toISOString(),
      cacheTtlSeconds: TTL / 1000,
      sources: compareDataSourceStatus(),
      calibration,
      tickers: [
        {
          symbol: a,
          fundamentals: aFund,
          score: aScored,
          priceTargets: aTargets,
          compare: aCompare,
        },
        {
          symbol: b,
          fundamentals: bFund,
          score: bScored,
          priceTargets: bTargets,
          compare: bCompare,
        },
      ],
      peers,
      methodology: [
        "Multi-source comparison: Yahoo (always on) + FMP (forward revenue + peers) + Finnhub (peers + filtered news) + SEC EDGAR (10-K Item 1 Business excerpt).",
        "Each source is wrapped with a timeout and falls back to null/`unavailable` independently — partial answers are normal.",
        "Forward revenue numbers are ANALYST CONSENSUS, not forecasts. They lag big strategic shifts (new products, contract wins) by months.",
        "Peer lists from FMP/Finnhub/Yahoo are heuristics — peers shown in ≥2 sources surface as 'consensus peers' (real overlap).",
        "10-K Item 1 is annual; product launches between filings won't appear there. Cross-check against Finnhub news headlines.",
        "If FMP/Finnhub keys are not configured, those sections show 'unavailable' with a note — sign up free at financialmodelingprep.com / finnhub.io and add FMP_API_KEY / FINNHUB_API_KEY to your environment.",
      ],
    };

    setCache(cacheKey, payload);
    res.json(payload);
  } catch (e) {
    console.error("compare endpoint error:", e);
    res.status(500).json({ error: "Compare failed", message: (e as Error).message });
  }
});

export default router;
