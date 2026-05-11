import * as YahooFinanceNS from "yahoo-finance2";
import { getFmpFundamentals } from "./fmpFinance";
import { getFinnhubSnapshot } from "./finnhubFinance";
import { getStockAnalysisForwardPe5yAvg } from "./stockAnalysisFinance";

const YahooFinanceCtor: any =
  (YahooFinanceNS as any).default?.default ?? (YahooFinanceNS as any).default ?? YahooFinanceNS;
const yahooFinance: any = new YahooFinanceCtor({ suppressNotices: ["yahooSurvey"] });

const cache = new Map<string, { data: any; timestamp: number }>();
const TTL = 30 * 60 * 1000; // 30m — fresher fundamentals for screener; still avoids hammering Yahoo

export interface Fundamentals {
  symbol: string;
  name: string;
  sector: string | null;
  industry: string | null;
  marketCap: number | null;
  price: number | null;
  high52Week: number | null;
  pctOff52WeekHigh: number | null;

  roic: number | null;
  fcf: number | null;
  fcfMargin: number | null;
  netDebtToEbitda: number | null;
  revenueGrowthYoy: number | null;

  trailingPE: number | null;
  forwardPE: number | null;
  forwardPe5yAvg: number | null;

  priceToBook: number | null;
  evToSales: number | null;
  ebitdaMargin: number | null;

  // Analyst consensus (Yahoo Finance financialData)
  analystTargetMean: number | null;
  analystTargetHigh: number | null;
  analystTargetLow: number | null;
  analystTargetMedian: number | null;
  analystCount: number | null;
  recommendationMean: number | null; // 1=Strong Buy, 5=Sell

  // Inputs needed for fair-value bands and simple DCF
  forwardEps: number | null;
  trailingEps: number | null;
  sharesOutstanding: number | null;
  ttmRevenue: number | null;
  ttmEbitda: number | null;
  ttmOperatingCashFlow: number | null;
  ttmCapex: number | null;
  ttmInterestExpense: number | null;
  totalDebt: number | null;
  cashAndEquivalents: number | null;
  dscrApprox: number | null; // FCF / Interest (proxy; principal not included)
  impliedPaybackYears: number | null; // totalDebt / FCF
  fcfConversion: number | null; // FCF / EBITDA

  // Earnings momentum (latest vs prior reported quarter)
  earnings: {
    eps: {
      latest: { quarterEnd: string; actual: number | null; estimate: number | null; surprisePct: number | null } | null;
      prior: { quarterEnd: string; actual: number | null; estimate: number | null; surprisePct: number | null } | null;
    };
    epsQoqGrowth: number | null;
    revenue: {
      latest: { quarterEnd: string; actual: number | null } | null;
      prior: { quarterEnd: string; actual: number | null } | null;
      qoqGrowth: number | null;
    };
    margins: {
      latest: { quarterEnd: string; grossMargin: number | null; operatingMargin: number | null } | null;
      prior: { quarterEnd: string; grossMargin: number | null; operatingMargin: number | null } | null;
      grossMarginDeltaPp: number | null; // latest - prior, percentage points
      operatingMarginDeltaPp: number | null;
    };
    notes: string[];
  };

  notes: string[];
}

function getCached<T>(key: string): T | null {
  const c = cache.get(key);
  if (c && Date.now() - c.timestamp < TTL) return c.data as T;
  return null;
}
function setCached(key: string, data: any) {
  cache.set(key, { data, timestamp: Date.now() });
}

const num = (v: any): number | null => {
  if (v === null || v === undefined) return null;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "object" && typeof v.raw === "number" && Number.isFinite(v.raw)) return v.raw;
  return null;
};

/** Pull the latest non-null value of a field from the most recent dated entry. */
function latest(rows: any[], key: string): number | null {
  if (!Array.isArray(rows)) return null;
  // Sort by date descending, take first non-null value of the field.
  const sorted = [...rows].sort((a, b) => {
    const ad = a?.date instanceof Date ? a.date.getTime() : new Date(a?.date ?? 0).getTime();
    const bd = b?.date instanceof Date ? b.date.getTime() : new Date(b?.date ?? 0).getTime();
    return bd - ad;
  });
  for (const r of sorted) {
    const v = num(r?.[key]);
    if (v !== null) return v;
  }
  return null;
}

/** Get the most recent two annual values (newest first). Used for YoY revenue. */
function latestTwo(rows: any[], key: string): { newest: number | null; prior: number | null } {
  if (!Array.isArray(rows)) return { newest: null, prior: null };
  const sorted = [...rows].sort((a, b) => {
    const ad = a?.date instanceof Date ? a.date.getTime() : new Date(a?.date ?? 0).getTime();
    const bd = b?.date instanceof Date ? b.date.getTime() : new Date(b?.date ?? 0).getTime();
    return bd - ad;
  });
  const vals: number[] = [];
  for (const r of sorted) {
    const v = num(r?.[key]);
    if (v !== null) {
      vals.push(v);
      if (vals.length === 2) break;
    }
  }
  return { newest: vals[0] ?? null, prior: vals[1] ?? null };
}

async function fetchTimeSeries(
  symbol: string,
  type: "annual" | "trailing" | "quarterly",
  module: "financials" | "balance-sheet" | "cash-flow"
): Promise<any[]> {
  // Period1 = 2 years back is enough for YoY + TTM context.
  const period1 = new Date();
  period1.setFullYear(period1.getFullYear() - 2);
  try {
    const r = await yahooFinance.fundamentalsTimeSeries(
      symbol,
      { period1, type, module },
      { validateResult: false }
    );
    return Array.isArray(r) ? r : [];
  } catch {
    return [];
  }
}

export async function getFundamentals(symbol: string): Promise<Fundamentals> {
  const key = `fund:v4:${symbol}`;
  const cached = getCached<Fundamentals>(key);
  if (cached) return cached;

  const notes: string[] = [];
  const out: Fundamentals = {
    symbol,
    name: symbol,
    sector: null,
    industry: null,
    marketCap: null,
    price: null,
    high52Week: null,
    pctOff52WeekHigh: null,
    roic: null,
    fcf: null,
    fcfMargin: null,
    netDebtToEbitda: null,
    revenueGrowthYoy: null,
    trailingPE: null,
    forwardPE: null,
    forwardPe5yAvg: null,
    priceToBook: null,
    evToSales: null,
    ebitdaMargin: null,
    analystTargetMean: null,
    analystTargetHigh: null,
    analystTargetLow: null,
    analystTargetMedian: null,
    analystCount: null,
    recommendationMean: null,
    forwardEps: null,
    trailingEps: null,
    sharesOutstanding: null,
    ttmRevenue: null,
    ttmEbitda: null,
    ttmOperatingCashFlow: null,
    ttmCapex: null,
    ttmInterestExpense: null,
    totalDebt: null,
    cashAndEquivalents: null,
    dscrApprox: null,
    impliedPaybackYears: null,
    fcfConversion: null,
    earnings: {
      eps: { latest: null, prior: null },
      epsQoqGrowth: null,
      revenue: { latest: null, prior: null, qoqGrowth: null },
      margins: {
        latest: null,
        prior: null,
        grossMarginDeltaPp: null,
        operatingMarginDeltaPp: null,
      },
      notes: [],
    },
    notes,
  };

  // 1) quoteSummary for current snapshot fields (price, 52w, PE, P/B, EV/Sales).
  let summary: any = null;
  try {
    summary = await yahooFinance.quoteSummary(
      symbol,
      { modules: ["price", "summaryDetail", "defaultKeyStatistics", "financialData", "earningsHistory", "assetProfile"] },
      { validateResult: false }
    );
  } catch (e) {
    notes.push(`quoteSummary failed: ${(e as Error).message}`);
  }

  if (summary) {
    const price = summary?.price ?? {};
    const summaryDetail = summary?.summaryDetail ?? {};
    const keyStats = summary?.defaultKeyStatistics ?? {};
    const fd = summary?.financialData ?? {};
    const eh = summary?.earningsHistory ?? {};
    const ap = summary?.assetProfile ?? {};

    out.name = price.longName || price.shortName || symbol;
    out.sector = typeof ap.sector === "string" ? ap.sector : null;
    out.industry = typeof ap.industry === "string" ? ap.industry : null;
    out.marketCap = num(price.marketCap) ?? num(summaryDetail.marketCap);
    out.price = num(price.regularMarketPrice);
    out.high52Week = num(summaryDetail.fiftyTwoWeekHigh);
    if (out.price !== null && out.high52Week !== null && out.high52Week > 0) {
      out.pctOff52WeekHigh = (out.price - out.high52Week) / out.high52Week;
    }
    out.trailingPE = num(summaryDetail.trailingPE) ?? num(keyStats.trailingPE);
    out.forwardPE = num(summaryDetail.forwardPE) ?? num(keyStats.forwardPE);
    out.priceToBook = num(keyStats.priceToBook);
    out.evToSales = num(keyStats.enterpriseToRevenue);

    // Analyst consensus (Wall St — trailing indicator, sanity check only)
    out.analystTargetMean = num(fd.targetMeanPrice);
    out.analystTargetHigh = num(fd.targetHighPrice);
    out.analystTargetLow = num(fd.targetLowPrice);
    out.analystTargetMedian = num(fd.targetMedianPrice);
    out.analystCount = num(fd.numberOfAnalystOpinions);
    out.recommendationMean = num(fd.recommendationMean);

    // EPS + share count for fair value bands and simple DCF
    out.forwardEps = num(keyStats.forwardEps);
    out.trailingEps = num(keyStats.trailingEps);
    out.sharesOutstanding = num(keyStats.sharesOutstanding) ?? num(price.sharesOutstanding);

    // Quick path for revenueGrowth / FCF / EBITDA margin / netDebt — financialData is fresh & TTM-ish.
    const revGrowthFD = num(fd.revenueGrowth);
    if (revGrowthFD !== null) out.revenueGrowthYoy = revGrowthFD;

    const fdEbitda = num(fd.ebitda);
    const fdRevenue = num(fd.totalRevenue);
    if (fdEbitda !== null && fdRevenue && fdRevenue > 0) {
      out.ebitdaMargin = fdEbitda / fdRevenue;
    }
    if (fdEbitda !== null) out.ttmEbitda = fdEbitda;

    const fdDebt = num(fd.totalDebt);
    const fdCash = num(fd.totalCash);
    if (fdDebt !== null) out.totalDebt = fdDebt;
    if (fdCash !== null) out.cashAndEquivalents = fdCash;
    if (fdDebt !== null && fdCash !== null && fdEbitda && fdEbitda > 0) {
      out.netDebtToEbitda = (fdDebt - fdCash) / fdEbitda;
    }

    const fdFcf = num(fd.freeCashflow);
    if (fdFcf !== null) {
      out.fcf = fdFcf;
      if (fdRevenue && fdRevenue > 0) out.fcfMargin = fdFcf / fdRevenue;
    }

    // Earnings history (EPS actual vs estimate) — most recent 2 reported quarters.
    const hist = Array.isArray(eh?.history) ? eh.history : [];
    if (hist.length > 0) {
      const parsed = hist
        .map((h: any) => ({
          quarterEnd:
            h?.quarter instanceof Date
              ? h.quarter.toISOString().slice(0, 10)
              : typeof h?.quarter === "string"
                ? String(h.quarter).slice(0, 10)
                : null,
          actual: num(h?.epsActual),
          estimate: num(h?.epsEstimate),
          surprisePct: num(h?.surprisePercent),
          ts: h?.quarter instanceof Date ? h.quarter.getTime() : new Date(h?.quarter ?? 0).getTime(),
        }))
        .filter((x: any) => x.quarterEnd)
        .sort((a: any, b: any) => b.ts - a.ts);

      const latestEps = parsed[0] ?? null;
      const priorEps = parsed[1] ?? null;
      if (latestEps) {
        out.earnings.eps.latest = {
          quarterEnd: latestEps.quarterEnd,
          actual: latestEps.actual,
          estimate: latestEps.estimate,
          surprisePct: latestEps.surprisePct,
        };
      }
      if (priorEps) {
        out.earnings.eps.prior = {
          quarterEnd: priorEps.quarterEnd,
          actual: priorEps.actual,
          estimate: priorEps.estimate,
          surprisePct: priorEps.surprisePct,
        };
      }

      if (latestEps?.actual != null && priorEps?.actual != null && priorEps.actual !== 0) {
        out.earnings.epsQoqGrowth = (latestEps.actual - priorEps.actual) / Math.abs(priorEps.actual);
      }
    } else {
      out.earnings.notes.push("earningsHistory missing (EPS actual/estimate unavailable).");
    }
  }

  // If Yahoo is blocked (common on Render), key fields come back null. Fall back to FMP.
  // We only call FMP when at least 2 critical snapshot fields are missing.
  const missingCritical =
    (out.price === null ? 1 : 0) +
    (out.high52Week === null ? 1 : 0) +
    (out.forwardPE === null ? 1 : 0) +
    (out.trailingPE === null ? 1 : 0) +
    (out.marketCap === null ? 1 : 0);

  if (missingCritical >= 2) {
    const fmpResp = await getFmpFundamentals(symbol);
    const fmp = fmpResp?.fundamentals ?? null;
    if (fmpResp && fmp) {
      notes.push(
        `Yahoo snapshot missing fields — filled from FMP where available.${fmpResp.error ? ` (FMP note: ${fmpResp.error})` : ""}`
      );
      // Merge-only-when-null: prefer Yahoo when present.
      out.name = out.name || fmp.name || out.name;
      out.marketCap = out.marketCap ?? fmp.marketCap ?? null;
      out.price = out.price ?? fmp.price ?? null;
      out.high52Week = out.high52Week ?? fmp.high52Week ?? null;
      if (out.pctOff52WeekHigh === null) out.pctOff52WeekHigh = fmp.pctOff52WeekHigh ?? null;

      out.trailingPE = out.trailingPE ?? fmp.trailingPE ?? null;
      out.forwardPE = out.forwardPE ?? fmp.forwardPE ?? null;
      out.trailingEps = out.trailingEps ?? fmp.trailingEps ?? null;
      out.forwardEps = out.forwardEps ?? fmp.forwardEps ?? null;
      out.sharesOutstanding = out.sharesOutstanding ?? fmp.sharesOutstanding ?? null;

      out.ttmRevenue = out.ttmRevenue ?? fmp.ttmRevenue ?? null;
      out.revenueGrowthYoy = out.revenueGrowthYoy ?? fmp.revenueGrowthYoy ?? null;
      out.fcf = out.fcf ?? fmp.fcf ?? null;
      out.fcfMargin = out.fcfMargin ?? fmp.fcfMargin ?? null;
      out.roic = out.roic ?? fmp.roic ?? null;
      out.priceToBook = out.priceToBook ?? fmp.priceToBook ?? null;
      out.evToSales = out.evToSales ?? fmp.evToSales ?? null;
      out.ebitdaMargin = out.ebitdaMargin ?? fmp.ebitdaMargin ?? null;

      // Recompute derived pctOff52w if we now have price + high.
      if (out.pctOff52WeekHigh === null && out.price !== null && out.high52Week !== null && out.high52Week > 0) {
        out.pctOff52WeekHigh = (out.price - out.high52Week) / out.high52Week;
      }
    } else {
      notes.push(
        `Yahoo snapshot missing fields; FMP fallback unavailable.${fmpResp?.error ? ` (FMP error: ${fmpResp.error})` : " (missing key or API error)."}`
      );
    }
  }

  // Finnhub: fills quote snapshot fields when Yahoo is blocked and FMP is premium-gated.
  const snapshotHole =
    out.price === null ||
    out.high52Week === null ||
    out.marketCap === null ||
    out.trailingPE === null;

  if (snapshotHole) {
    const fin = await getFinnhubSnapshot(symbol);
    if (fin === null) {
      notes.push(
        "Snapshot fallback skipped: FINNHUB_API_KEY not set on the server (Render env var)."
      );
    } else {
      notes.push(
        `Snapshot fallback (Finnhub): merged where non-null.${fin.error ? ` (Finnhub note: ${fin.error})` : ""}`
      );
      const ff = fin.fundamentals;
      out.marketCap = out.marketCap ?? ff.marketCap ?? null;
      out.price = out.price ?? ff.price ?? null;
      out.high52Week = out.high52Week ?? ff.high52Week ?? null;
      out.trailingPE = out.trailingPE ?? ff.trailingPE ?? null;
      out.sharesOutstanding = out.sharesOutstanding ?? ff.sharesOutstanding ?? null;
      if (typeof ff.name === "string" && ff.name.trim() && (!out.name || out.name === symbol)) {
        out.name = ff.name.trim();
      }
      if (out.pctOff52WeekHigh === null) out.pctOff52WeekHigh = ff.pctOff52WeekHigh ?? null;
      if (
        out.pctOff52WeekHigh === null &&
        out.price !== null &&
        out.high52Week !== null &&
        out.high52Week > 0
      ) {
        out.pctOff52WeekHigh = (out.price - out.high52Week) / out.high52Week;
      }
    }
  }
  // 2) fundamentalsTimeSeries for ROIC components + fallbacks.
  // Use 'trailing' for income / cash-flow (TTM), 'annual' for balance sheet (latest fiscal year).
  const [ttmFin, annualFin, annualBs, ttmCf, qFin] = await Promise.all([
    fetchTimeSeries(symbol, "trailing", "financials"),
    fetchTimeSeries(symbol, "annual", "financials"),
    fetchTimeSeries(symbol, "annual", "balance-sheet"),
    fetchTimeSeries(symbol, "trailing", "cash-flow"),
    fetchTimeSeries(symbol, "quarterly", "financials"),
  ]);

  // Revenue (TTM) — fallback if financialData didn't give it.
  const ttmRevenue = latest(ttmFin, "totalRevenue") ?? latest(annualFin, "totalRevenue");
  out.ttmRevenue = ttmRevenue;
  // EBIT TTM (for ROIC). Prefer EBIT, fall back to operatingIncome.
  const ttmEbit = latest(ttmFin, "EBIT") ?? latest(ttmFin, "operatingIncome") ?? latest(annualFin, "EBIT") ?? latest(annualFin, "operatingIncome");
  const ttmEbitda = latest(ttmFin, "EBITDA") ?? latest(annualFin, "EBITDA");
  const ttmPretax = latest(ttmFin, "pretaxIncome") ?? latest(annualFin, "pretaxIncome");
  const ttmTaxProv = latest(ttmFin, "taxProvision") ?? latest(annualFin, "taxProvision");
  const ttmTaxRateField = latest(ttmFin, "taxRateForCalcs") ?? latest(annualFin, "taxRateForCalcs");

  // Balance sheet
  const bsEquity =
    latest(annualBs, "stockholdersEquity") ??
    latest(annualBs, "commonStockEquity") ??
    latest(annualBs, "totalEquityGrossMinorityInterest");
  const bsDebt = latest(annualBs, "totalDebt") ?? latest(annualBs, "longTermDebt");
  const bsCash =
    latest(annualBs, "cashAndCashEquivalents") ??
    latest(annualBs, "cashCashEquivalentsAndShortTermInvestments") ??
    latest(annualBs, "cashFinancial");
  const bsInvestedCapital = latest(annualBs, "investedCapital");

  // Cash flow fallbacks
  const ttmFcfAlt = latest(ttmCf, "freeCashFlow");
  if (out.fcf === null && ttmFcfAlt !== null) {
    out.fcf = ttmFcfAlt;
    if (ttmRevenue && ttmRevenue > 0) out.fcfMargin = ttmFcfAlt / ttmRevenue;
  }

  const ttmOCF = latest(ttmCf, "operatingCashFlow");
  if (ttmOCF !== null) out.ttmOperatingCashFlow = ttmOCF;
  const ttmCapex = latest(ttmCf, "capitalExpenditure");
  if (ttmCapex !== null) out.ttmCapex = ttmCapex; // typically negative

  // Interest expense (TTM) — used for DSCR proxy.
  const ttmInterest = latest(ttmFin, "interestExpense") ?? latest(annualFin, "interestExpense");
  if (ttmInterest !== null) out.ttmInterestExpense = Math.abs(ttmInterest);

  // EBITDA margin fallback
  if (out.ebitdaMargin === null && ttmEbitda !== null && ttmRevenue && ttmRevenue > 0) {
    out.ebitdaMargin = ttmEbitda / ttmRevenue;
  }

  // NetDebt/EBITDA fallback (using BS + TTM EBITDA)
  if (out.netDebtToEbitda === null && bsDebt !== null && bsCash !== null && ttmEbitda && ttmEbitda > 0) {
    out.netDebtToEbitda = (bsDebt - bsCash) / ttmEbitda;
  }

  if (out.ttmEbitda === null && ttmEbitda !== null) out.ttmEbitda = ttmEbitda;
  if (out.totalDebt === null && bsDebt !== null) out.totalDebt = bsDebt;
  if (out.cashAndEquivalents === null && bsCash !== null) out.cashAndEquivalents = bsCash;

  // Derived sanity checks (only when inputs exist)
  if (out.fcf !== null && out.ttmEbitda !== null && out.ttmEbitda !== 0) {
    out.fcfConversion = out.fcf / Math.abs(out.ttmEbitda);
  }
  if (out.fcf !== null && out.ttmInterestExpense !== null && out.ttmInterestExpense > 0) {
    out.dscrApprox = out.fcf / out.ttmInterestExpense;
  }
  if (out.fcf !== null && out.totalDebt !== null && out.fcf > 0) {
    out.impliedPaybackYears = out.totalDebt / out.fcf;
  }

  // Revenue growth YoY fallback — use annual financials (newest vs prior).
  if (out.revenueGrowthYoy === null) {
    const { newest, prior } = latestTwo(annualFin, "totalRevenue");
    if (newest !== null && prior && prior > 0) {
      out.revenueGrowthYoy = (newest - prior) / prior;
    } else {
      notes.push("revenueGrowth: not in financialData and annual history < 2 years");
    }
  }

  // Earnings revenue momentum — latest vs prior quarter reported revenue.
  // Yahoo's earningsHistory doesn't include revenue in our payload; pull from quarterly financials instead.
  const qSorted = Array.isArray(qFin)
    ? [...qFin].sort((a, b) => {
        const ad = a?.date instanceof Date ? a.date.getTime() : new Date(a?.date ?? 0).getTime();
        const bd = b?.date instanceof Date ? b.date.getTime() : new Date(b?.date ?? 0).getTime();
        return bd - ad;
      })
    : [];
  const q0 = qSorted[0] ?? null;
  const q1 = qSorted[1] ?? null;
  const q0Date =
    q0?.date instanceof Date ? q0.date.toISOString().slice(0, 10) : q0?.date ? String(q0.date).slice(0, 10) : null;
  const q1Date =
    q1?.date instanceof Date ? q1.date.toISOString().slice(0, 10) : q1?.date ? String(q1.date).slice(0, 10) : null;
  const q0Rev = q0 ? num(q0.totalRevenue) : null;
  const q1Rev = q1 ? num(q1.totalRevenue) : null;
  if (q0Date) out.earnings.revenue.latest = { quarterEnd: q0Date, actual: q0Rev };
  if (q1Date) out.earnings.revenue.prior = { quarterEnd: q1Date, actual: q1Rev };
  if (q0Rev !== null && q1Rev !== null && q1Rev !== 0) {
    out.earnings.revenue.qoqGrowth = (q0Rev - q1Rev) / Math.abs(q1Rev);
  }

  // Margins momentum — gross + operating margin latest vs prior quarter.
  const q0GrossProfit = q0 ? num(q0.grossProfit) : null;
  const q1GrossProfit = q1 ? num(q1.grossProfit) : null;
  const q0OpInc = q0 ? num(q0.operatingIncome) : null;
  const q1OpInc = q1 ? num(q1.operatingIncome) : null;
  const q0GrossMargin = q0GrossProfit !== null && q0Rev && q0Rev !== 0 ? q0GrossProfit / q0Rev : null;
  const q1GrossMargin = q1GrossProfit !== null && q1Rev && q1Rev !== 0 ? q1GrossProfit / q1Rev : null;
  const q0OpMargin = q0OpInc !== null && q0Rev && q0Rev !== 0 ? q0OpInc / q0Rev : null;
  const q1OpMargin = q1OpInc !== null && q1Rev && q1Rev !== 0 ? q1OpInc / q1Rev : null;
  if (q0Date) out.earnings.margins.latest = { quarterEnd: q0Date, grossMargin: q0GrossMargin, operatingMargin: q0OpMargin };
  if (q1Date) out.earnings.margins.prior = { quarterEnd: q1Date, grossMargin: q1GrossMargin, operatingMargin: q1OpMargin };
  if (q0GrossMargin !== null && q1GrossMargin !== null) {
    out.earnings.margins.grossMarginDeltaPp = (q0GrossMargin - q1GrossMargin) * 100;
  }
  if (q0OpMargin !== null && q1OpMargin !== null) {
    out.earnings.margins.operatingMarginDeltaPp = (q0OpMargin - q1OpMargin) * 100;
  }

  // ROIC = NOPAT / InvestedCapital
  // Prefer Yahoo's investedCapital field if present; otherwise compute = Debt + Equity − Cash.
  let investedCapital: number | null = bsInvestedCapital;
  if (investedCapital === null && bsDebt !== null && bsEquity !== null && bsCash !== null) {
    investedCapital = bsDebt + bsEquity - bsCash;
  }

  let taxRate = 0.21;
  if (ttmTaxRateField !== null && ttmTaxRateField >= 0 && ttmTaxRateField <= 0.5) {
    taxRate = ttmTaxRateField;
  } else if (ttmPretax && ttmPretax > 0 && ttmTaxProv !== null) {
    const r = ttmTaxProv / ttmPretax;
    if (r >= 0 && r <= 0.5) taxRate = r;
  }

  if (ttmEbit !== null && investedCapital !== null && investedCapital > 0) {
    const nopat = ttmEbit * (1 - taxRate);
    out.roic = nopat / investedCapital;
  } else {
    if (ttmEbit === null) notes.push("ROIC: no EBIT/operatingIncome available");
    if (investedCapital === null) notes.push("ROIC: no investedCapital (debt/equity/cash missing)");
    else if (investedCapital <= 0) notes.push("ROIC: invested capital ≤ 0");
  }

  // Extra valuation fetch: 5y average forward P/E (StockAnalysis scrape).
  // Best-effort; keep null on failure.
  try {
    const sa = await getStockAnalysisForwardPe5yAvg(symbol);
    if (sa.source === "stockanalysis" && typeof sa.forwardPe5yAvg === "number") {
      out.forwardPe5yAvg = sa.forwardPe5yAvg;
    }
  } catch {
    // ignore
  }

  setCached(key, out);
  return out;
}

export async function getFundamentalsBatch(symbols: string[]): Promise<Fundamentals[]> {
  const concurrency = 5;
  const results: Fundamentals[] = [];
  let idx = 0;
  const workers = Array.from({ length: Math.min(concurrency, symbols.length) }, async () => {
    while (true) {
      const i = idx++;
      if (i >= symbols.length) return;
      try {
        results.push(await getFundamentals(symbols[i]));
      } catch (e) {
        results.push({
          symbol: symbols[i],
          name: symbols[i],
          sector: null,
          industry: null,
          marketCap: null,
          price: null,
          high52Week: null,
          pctOff52WeekHigh: null,
          roic: null,
          fcf: null,
          fcfMargin: null,
          netDebtToEbitda: null,
          revenueGrowthYoy: null,
          trailingPE: null,
          forwardPE: null,
          forwardPe5yAvg: null,
          priceToBook: null,
          evToSales: null,
          ebitdaMargin: null,
          analystTargetMean: null,
          analystTargetHigh: null,
          analystTargetLow: null,
          analystTargetMedian: null,
          analystCount: null,
          recommendationMean: null,
          forwardEps: null,
          trailingEps: null,
          sharesOutstanding: null,
          ttmRevenue: null,
          ttmEbitda: null,
          ttmOperatingCashFlow: null,
          ttmCapex: null,
          ttmInterestExpense: null,
          totalDebt: null,
          cashAndEquivalents: null,
          dscrApprox: null,
          impliedPaybackYears: null,
          fcfConversion: null,
          earnings: {
            eps: { latest: null, prior: null },
            epsQoqGrowth: null,
            revenue: { latest: null, prior: null, qoqGrowth: null },
            margins: {
              latest: null,
              prior: null,
              grossMarginDeltaPp: null,
              operatingMarginDeltaPp: null,
            },
            notes: ["fetch failed (earnings unavailable)"],
          },
          notes: [`fetch failed: ${(e as Error).message}`],
        });
      }
    }
  });
  await Promise.all(workers);
  return results;
}
