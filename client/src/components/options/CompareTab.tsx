import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Loader2,
  AlertTriangle,
  ExternalLink,
  Info,
  ArrowLeftRight,
  CheckCircle2,
  XCircle,
} from "lucide-react";
import { fetchApi } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

// Minimal types — server is source of truth, this is just for rendering shape.
interface PriceTargets {
  analystMean: number | null;
  analystCount: number | null;
  analystImpliedUpsidePct: number | null;
  recommendationLabel: string | null;
  bearFairValue: number | null;
  baseFairValue: number | null;
  bullFairValue: number | null;
  dcfFairValue: number | null;
  blendedFairValue: number | null;
  blendedImpliedUpsidePct: number | null;
}

interface ScoreSlice {
  score: number;
  tier: "BEST" | "STRONG" | "WATCH" | "AVOID";
  passes: {
    roic15: boolean | null;
    fcfPositive: boolean | null;
    netDebtUnder2x: boolean | null;
    revenueGrowing: boolean | null;
    off52wMin15: boolean | null;
    fwdPELessThanTrailing: boolean | null;
  };
}

interface Fundamentals {
  symbol: string;
  name: string;
  price: number | null;
  marketCap: number | null;
  high52Week: number | null;
  pctOff52WeekHigh: number | null;
  roic: number | null;
  fcfMargin: number | null;
  netDebtToEbitda: number | null;
  revenueGrowthYoy: number | null;
  trailingPE: number | null;
  forwardPE: number | null;
  ttmRevenue: number | null;
  ebitdaMargin: number | null;
}

interface CompareSlice {
  yahoo: {
    description: string | null;
    sector: string | null;
    industry: string | null;
    fullTimeEmployees: number | null;
    website: string | null;
    similarSymbols: string[];
    revenueEstimateFy1: { mean: number | null; growth: number | null; period: string } | null;
    revenueEstimateFy2: { mean: number | null; growth: number | null; period: string } | null;
    segmentHint: string[] | null;
  };
  fmp: {
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
  };
  finnhub: {
    source: "finnhub" | "unavailable";
    reason?: string;
    peers: string[];
    recentNews: Array<{ datetime: string; headline: string; source: string; url: string }>;
  };
  edgar: {
    source: "edgar" | "unavailable";
    reason?: string;
    cik: string | null;
    filingDate: string | null;
    filingUrl: string | null;
    businessSummary: string | null;
  };
}

interface CompareResponse {
  generatedAt: string;
  cacheTtlSeconds: number;
  sources: { fmpConfigured: boolean; finnhubConfigured: boolean; edgarUserAgent: string };
  tickers: Array<{
    symbol: string;
    fundamentals: Fundamentals;
    score: ScoreSlice;
    priceTargets: PriceTargets;
    compare: CompareSlice;
  }>;
  peers: { consensusPeers: string[]; byTicker: Record<string, string[]> };
  methodology: string[];
}

const fmtPct = (v: number | null, d = 1) =>
  v === null || v === undefined || Number.isNaN(v) ? "—" : `${(v * 100).toFixed(d)}%`;
const fmtUsd = (v: number | null) =>
  v === null || v === undefined || Number.isNaN(v) ? "—" : `$${v.toFixed(2)}`;
const fmtBig = (v: number | null) => {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  if (Math.abs(v) >= 1e12) return `$${(v / 1e12).toFixed(2)}T`;
  if (Math.abs(v) >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
  if (Math.abs(v) >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
  return `$${v.toFixed(0)}`;
};

const tierClass = (t: ScoreSlice["tier"]) =>
  t === "BEST"
    ? "border-green-500 bg-green-500/15 text-green-700"
    : t === "STRONG"
    ? "border-emerald-400 bg-emerald-500/10 text-emerald-700"
    : t === "WATCH"
    ? "border-amber-400 bg-amber-500/10 text-amber-700"
    : "border-red-400 bg-red-500/15 text-red-700";

function PassIcon({ v }: { v: boolean | null }) {
  if (v === null) return <span className="text-muted-foreground/60 text-xs">—</span>;
  return v ? (
    <CheckCircle2 className="h-3.5 w-3.5 text-green-600 inline" />
  ) : (
    <XCircle className="h-3.5 w-3.5 text-red-500 inline" />
  );
}

function StatRow({
  label,
  a,
  b,
  hint,
  highlight = "neutral",
}: {
  label: string;
  a: string;
  b: string;
  hint?: string;
  highlight?: "neutral" | "higherBetter" | "lowerBetter";
}) {
  return (
    <tr className="border-b border-border/50">
      <td className="py-1.5 pr-2 text-xs text-muted-foreground">
        {hint ? (
          <Tooltip delayDuration={250}>
            <TooltipTrigger asChild>
              <span className="cursor-help underline decoration-dotted decoration-muted-foreground/50 underline-offset-2">
                {label}
              </span>
            </TooltipTrigger>
            <TooltipContent side="left" className="max-w-[280px] text-xs">
              {hint}
            </TooltipContent>
          </Tooltip>
        ) : (
          label
        )}
      </td>
      <td className="py-1.5 px-2 text-right text-xs tabular-nums">{a}</td>
      <td className="py-1.5 pl-2 text-right text-xs tabular-nums">{b}</td>
    </tr>
  );
}

export function CompareTab() {
  const [aInput, setAInput] = useState("NVDA");
  const [bInput, setBInput] = useState("AMD");
  const [a, setA] = useState("NVDA");
  const [b, setB] = useState("AMD");

  const { data, isLoading, isFetching, error, refetch } = useQuery<CompareResponse>({
    queryKey: ["/api/screener/compare", a, b],
    queryFn: async () => {
      const r = await fetchApi(`/api/screener/compare/${a}/${b}`);
      if (!r.ok) {
        const txt = await r.text();
        throw new Error(txt || "Compare request failed");
      }
      return r.json();
    },
    staleTime: 30 * 60 * 1000,
    enabled: !!a && !!b && a !== b,
  });

  const swap = () => {
    setAInput(b);
    setBInput(a);
    setA(b);
    setB(a);
  };

  const apply = () => {
    const aClean = aInput.trim().toUpperCase();
    const bClean = bInput.trim().toUpperCase();
    if (aClean && bClean && aClean !== bClean) {
      setA(aClean);
      setB(bClean);
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Compare two stocks</CardTitle>
          <p className="text-xs text-muted-foreground mt-1">
            Multi-source: Yahoo + FMP + Finnhub + SEC EDGAR. Same fundamentals, scoring, and macro
            calibration the Screener uses, plus 10-K business descriptions and recent news. Forward
            revenue is analyst consensus, not a forecast.
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-end gap-2">
            <div className="flex-1 min-w-[140px]">
              <label className="text-[10px] uppercase tracking-wide text-muted-foreground">Ticker A</label>
              <Input
                placeholder="NVDA"
                value={aInput}
                onChange={(e) => setAInput(e.target.value.toUpperCase())}
                onKeyDown={(e) => e.key === "Enter" && apply()}
                className="h-9 mt-0.5"
              />
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-9 w-9"
              onClick={swap}
              title="Swap"
            >
              <ArrowLeftRight className="h-4 w-4" />
            </Button>
            <div className="flex-1 min-w-[140px]">
              <label className="text-[10px] uppercase tracking-wide text-muted-foreground">Ticker B</label>
              <Input
                placeholder="AMD"
                value={bInput}
                onChange={(e) => setBInput(e.target.value.toUpperCase())}
                onKeyDown={(e) => e.key === "Enter" && apply()}
                className="h-9 mt-0.5"
              />
            </div>
            <Button onClick={apply} disabled={!aInput || !bInput || aInput === bInput}>
              Compare
            </Button>
            <Button variant="outline" onClick={() => refetch()} disabled={isFetching}>
              {isFetching ? <Loader2 className="h-3 w-3 animate-spin" /> : "Refresh"}
            </Button>
          </div>

          {data?.sources && (
            <div className="flex flex-wrap gap-2 text-[10px]">
              <Badge variant="outline" className={data.sources.fmpConfigured ? "border-green-400 bg-green-500/10 text-green-700" : "border-amber-400 bg-amber-500/10 text-amber-700"}>
                FMP {data.sources.fmpConfigured ? "configured" : "missing key"}
              </Badge>
              <Badge variant="outline" className={data.sources.finnhubConfigured ? "border-green-400 bg-green-500/10 text-green-700" : "border-amber-400 bg-amber-500/10 text-amber-700"}>
                Finnhub {data.sources.finnhubConfigured ? "configured" : "missing key"}
              </Badge>
              <Badge variant="outline" className="border-blue-400 bg-blue-500/10 text-blue-700">
                EDGAR ready
              </Badge>
            </div>
          )}
        </CardContent>
      </Card>

      {isLoading && (
        <div className="flex h-40 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
          <span className="ml-2 text-sm text-muted-foreground">
            Pulling Yahoo + FMP + Finnhub + EDGAR ... (first run can take 20–40s)
          </span>
        </div>
      )}

      {error && (
        <Card className="border-destructive">
          <CardContent className="flex items-center gap-2 py-4 text-destructive text-sm">
            <AlertTriangle className="h-4 w-4" />
            <span>Compare failed: {(error as Error).message}</span>
          </CardContent>
        </Card>
      )}

      {data && data.tickers.length === 2 && !isLoading && (
        <CompareResults data={data} />
      )}
    </div>
  );
}

function CompareResults({ data }: { data: CompareResponse }) {
  const [tA, tB] = data.tickers;
  const a = tA.fundamentals;
  const b = tB.fundamentals;

  return (
    <>
      {/* Header summary */}
      <Card>
        <CardContent className="py-4">
          <div className="grid grid-cols-2 gap-4">
            {[tA, tB].map((t) => (
              <div key={t.symbol} className="space-y-1">
                <div className="flex items-baseline justify-between gap-2">
                  <h3 className="font-mono text-lg font-bold">{t.symbol}</h3>
                  <Badge variant="outline" className={`text-[10px] ${tierClass(t.score.tier)}`}>
                    {t.score.tier} · {t.score.score}/100
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground line-clamp-1">{t.fundamentals.name}</p>
                <p className="text-xs">
                  <span className="font-semibold">{fmtUsd(t.fundamentals.price)}</span>
                  <span className="text-muted-foreground ml-2">
                    {t.compare.yahoo.sector || "—"}
                    {t.compare.yahoo.industry ? ` · ${t.compare.yahoo.industry}` : ""}
                  </span>
                </p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Side-by-side fundamentals */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Fundamentals (Yahoo TTM / latest annual)</CardTitle>
        </CardHeader>
        <CardContent>
          <table className="w-full">
            <thead>
              <tr className="border-b text-[10px] uppercase tracking-wide text-muted-foreground">
                <th className="text-left py-1 pr-2">Metric</th>
                <th className="text-right py-1 px-2 font-mono">{a.symbol}</th>
                <th className="text-right py-1 pl-2 font-mono">{b.symbol}</th>
              </tr>
            </thead>
            <tbody>
              <StatRow
                label="Market cap"
                a={fmtBig(a.marketCap)}
                b={fmtBig(b.marketCap)}
                hint="Shares outstanding × price (Yahoo)."
              />
              <StatRow
                label="TTM revenue"
                a={fmtBig(a.ttmRevenue)}
                b={fmtBig(b.ttmRevenue)}
                hint="Trailing-twelve-months revenue from Yahoo fundamentalsTimeSeries."
              />
              <StatRow
                label="Revenue YoY"
                a={fmtPct(a.revenueGrowthYoy)}
                b={fmtPct(b.revenueGrowthYoy)}
                hint="Most recent reported year-over-year revenue growth (Yahoo)."
              />
              <StatRow
                label="ROIC"
                a={fmtPct(a.roic)}
                b={fmtPct(b.roic)}
                hint="NOPAT ÷ invested capital. Quality gate is ≥15%."
              />
              <StatRow
                label="FCF margin"
                a={fmtPct(a.fcfMargin)}
                b={fmtPct(b.fcfMargin)}
                hint="Free cash flow ÷ revenue (TTM)."
              />
              <StatRow
                label="EBITDA margin"
                a={fmtPct(a.ebitdaMargin)}
                b={fmtPct(b.ebitdaMargin)}
              />
              <StatRow
                label="Net debt / EBITDA"
                a={a.netDebtToEbitda !== null ? `${a.netDebtToEbitda.toFixed(2)}x` : "—"}
                b={b.netDebtToEbitda !== null ? `${b.netDebtToEbitda.toFixed(2)}x` : "—"}
                hint="(Total debt − cash) ÷ EBITDA. <2× passes the quality gate."
              />
              <StatRow
                label="Trailing P/E"
                a={a.trailingPE !== null ? a.trailingPE.toFixed(1) : "—"}
                b={b.trailingPE !== null ? b.trailingPE.toFixed(1) : "—"}
              />
              <StatRow
                label="Forward P/E"
                a={a.forwardPE !== null ? a.forwardPE.toFixed(1) : "—"}
                b={b.forwardPE !== null ? b.forwardPE.toFixed(1) : "—"}
              />
              <StatRow
                label="% off 52w high"
                a={fmtPct(a.pctOff52WeekHigh)}
                b={fmtPct(b.pctOff52WeekHigh)}
              />
            </tbody>
          </table>
        </CardContent>
      </Card>

      {/* Quality gates */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Quality gates</CardTitle>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            Same six checks the Screener uses. ✓ pass · ✗ fail · — insufficient data.
          </p>
        </CardHeader>
        <CardContent>
          <table className="w-full">
            <thead>
              <tr className="border-b text-[10px] uppercase tracking-wide text-muted-foreground">
                <th className="text-left py-1 pr-2">Gate</th>
                <th className="text-center py-1 px-2 font-mono">{a.symbol}</th>
                <th className="text-center py-1 pl-2 font-mono">{b.symbol}</th>
              </tr>
            </thead>
            <tbody>
              {[
                ["ROIC ≥ 15%", "roic15"],
                ["FCF positive", "fcfPositive"],
                ["Net debt/EBITDA < 2×", "netDebtUnder2x"],
                ["Revenue growing YoY", "revenueGrowing"],
                ["≥15% off 52w high", "off52wMin15"],
                ["Fwd P/E < trailing", "fwdPELessThanTrailing"],
              ].map(([label, key]) => (
                <tr key={key} className="border-b border-border/50">
                  <td className="py-1.5 pr-2 text-xs text-muted-foreground">{label}</td>
                  <td className="py-1.5 px-2 text-center">
                    <PassIcon v={tA.score.passes[key as keyof ScoreSlice["passes"]]} />
                  </td>
                  <td className="py-1.5 pl-2 text-center">
                    <PassIcon v={tB.score.passes[key as keyof ScoreSlice["passes"]]} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {/* Price targets */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Price targets · Fair value</CardTitle>
        </CardHeader>
        <CardContent>
          <table className="w-full">
            <thead>
              <tr className="border-b text-[10px] uppercase tracking-wide text-muted-foreground">
                <th className="text-left py-1 pr-2">Method</th>
                <th className="text-right py-1 px-2 font-mono">{a.symbol}</th>
                <th className="text-right py-1 pl-2 font-mono">{b.symbol}</th>
              </tr>
            </thead>
            <tbody>
              <StatRow label="Now" a={fmtUsd(a.price)} b={fmtUsd(b.price)} />
              <StatRow
                label={`Analyst (n=${tA.priceTargets.analystCount ?? "?"} / ${tB.priceTargets.analystCount ?? "?"})`}
                a={fmtUsd(tA.priceTargets.analystMean)}
                b={fmtUsd(tB.priceTargets.analystMean)}
                hint="Yahoo consensus mean target. Lags major moves."
              />
              <StatRow
                label="Analyst implied upside"
                a={fmtPct(tA.priceTargets.analystImpliedUpsidePct, 0)}
                b={fmtPct(tB.priceTargets.analystImpliedUpsidePct, 0)}
              />
              <StatRow
                label="Recommendation"
                a={tA.priceTargets.recommendationLabel ?? "—"}
                b={tB.priceTargets.recommendationLabel ?? "—"}
              />
              <StatRow
                label="Bear / Base / Bull"
                a={`${fmtUsd(tA.priceTargets.bearFairValue)} / ${fmtUsd(tA.priceTargets.baseFairValue)} / ${fmtUsd(tA.priceTargets.bullFairValue)}`}
                b={`${fmtUsd(tB.priceTargets.bearFairValue)} / ${fmtUsd(tB.priceTargets.baseFairValue)} / ${fmtUsd(tB.priceTargets.bullFairValue)}`}
                hint="Forward EPS × calibrated multiples. Anchors only."
              />
              <StatRow
                label="Simple DCF"
                a={fmtUsd(tA.priceTargets.dcfFairValue)}
                b={fmtUsd(tB.priceTargets.dcfFairValue)}
                hint="One-stage FCF perpetuity at the calibrated discount rate. Rule-of-thumb only."
              />
              <StatRow
                label="Blended"
                a={`${fmtUsd(tA.priceTargets.blendedFairValue)} (${fmtPct(tA.priceTargets.blendedImpliedUpsidePct, 0)})`}
                b={`${fmtUsd(tB.priceTargets.blendedFairValue)} (${fmtPct(tB.priceTargets.blendedImpliedUpsidePct, 0)})`}
              />
            </tbody>
          </table>
        </CardContent>
      </Card>

      {/* Forward revenue (consensus) */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Forward revenue (analyst consensus)</CardTitle>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            Yahoo earningsTrend FY1/FY2 + FMP analyst-estimates. Numbers are consensus, not
            forecasts. Treat as "where the herd is."
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            {[tA, tB].map((t) => (
              <div key={t.symbol}>
                <div className="font-mono text-xs font-semibold mb-1">{t.symbol}</div>
                <div className="space-y-1 text-xs">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">
                      Yahoo {t.compare.yahoo.revenueEstimateFy1?.period ?? "FY1"}
                    </span>
                    <span>
                      {fmtBig(t.compare.yahoo.revenueEstimateFy1?.mean ?? null)}{" "}
                      <span className={(t.compare.yahoo.revenueEstimateFy1?.growth ?? 0) >= 0 ? "text-green-600" : "text-red-500"}>
                        {t.compare.yahoo.revenueEstimateFy1?.growth != null
                          ? `(${(t.compare.yahoo.revenueEstimateFy1.growth * 100).toFixed(1)}%)`
                          : ""}
                      </span>
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">
                      Yahoo {t.compare.yahoo.revenueEstimateFy2?.period ?? "FY2"}
                    </span>
                    <span>
                      {fmtBig(t.compare.yahoo.revenueEstimateFy2?.mean ?? null)}{" "}
                      <span className={(t.compare.yahoo.revenueEstimateFy2?.growth ?? 0) >= 0 ? "text-green-600" : "text-red-500"}>
                        {t.compare.yahoo.revenueEstimateFy2?.growth != null
                          ? `(${(t.compare.yahoo.revenueEstimateFy2.growth * 100).toFixed(1)}%)`
                          : ""}
                      </span>
                    </span>
                  </div>

                  {t.compare.fmp.source === "fmp" && t.compare.fmp.analystEstimates.length > 0 ? (
                    <>
                      <div className="mt-2 text-[10px] uppercase tracking-wide text-muted-foreground/80">
                        FMP estimates
                      </div>
                      {t.compare.fmp.analystEstimates.slice(0, 3).map((e, i) => (
                        <div key={i} className="flex justify-between text-[11px]">
                          <span className="text-muted-foreground">{e.date}</span>
                          <span>
                            {fmtBig(e.revenueAvg)}{" "}
                            <span className="text-muted-foreground/70">
                              {e.revenueLow != null && e.revenueHigh != null
                                ? `(${fmtBig(e.revenueLow)}–${fmtBig(e.revenueHigh)})`
                                : ""}
                              {e.numAnalysts != null ? ` · n=${e.numAnalysts}` : ""}
                            </span>
                          </span>
                        </div>
                      ))}
                    </>
                  ) : t.compare.fmp.source === "unavailable" ? (
                    <div className="text-[10px] text-amber-600 mt-1">
                      FMP: {t.compare.fmp.reason || "unavailable"}
                    </div>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Business descriptions (10-K Item 1) */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">What they actually do (SEC 10-K Item 1 + Yahoo)</CardTitle>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            10-K is annual; new product launches between filings won't appear here. Cross-check
            against news headlines below.
          </p>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {[tA, tB].map((t) => (
            <div key={t.symbol} className="space-y-2">
              <div className="font-mono text-xs font-semibold">{t.symbol}</div>
              {t.compare.yahoo.description && (
                <div className="text-xs text-muted-foreground">
                  <span className="font-semibold text-foreground/80">Yahoo summary: </span>
                  {t.compare.yahoo.description.slice(0, 600)}
                  {t.compare.yahoo.description.length > 600 ? "…" : ""}
                </div>
              )}
              {t.compare.edgar.source === "edgar" && t.compare.edgar.businessSummary ? (
                <div className="text-xs">
                  <div className="text-[10px] uppercase tracking-wide text-blue-600 font-semibold">
                    10-K Item 1 (filed {t.compare.edgar.filingDate ?? "?"})
                  </div>
                  <p className="text-muted-foreground mt-0.5 line-clamp-[14] leading-relaxed">
                    {t.compare.edgar.businessSummary}
                  </p>
                  {t.compare.edgar.filingUrl && (
                    <a
                      href={t.compare.edgar.filingUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-[11px] text-blue-600 hover:underline mt-1"
                    >
                      Read full filing <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                </div>
              ) : t.compare.edgar.source === "unavailable" ? (
                <div className="text-[10px] text-amber-600">
                  EDGAR: {t.compare.edgar.reason || "unavailable"}
                </div>
              ) : null}
              {t.compare.yahoo.segmentHint && t.compare.yahoo.segmentHint.length > 0 && (
                <div className="text-[10px]">
                  <span className="text-muted-foreground">Segment hints (Yahoo): </span>
                  {t.compare.yahoo.segmentHint.join(", ")}
                </div>
              )}
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Recent news */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Recent product / tech announcements (Finnhub, last 30 days)</CardTitle>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            Filtered for keywords: announce, launch, release, partnership, chip, GPU, AI, model,
            patent, FDA, trial, contract, deal. Headlines only — verify the source.
          </p>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {[tA, tB].map((t) => (
            <div key={t.symbol} className="space-y-1.5">
              <div className="font-mono text-xs font-semibold">{t.symbol}</div>
              {t.compare.finnhub.source === "finnhub" ? (
                t.compare.finnhub.recentNews.length === 0 ? (
                  <div className="text-[11px] text-muted-foreground italic">
                    No matching headlines in the last 30 days.
                  </div>
                ) : (
                  <ul className="space-y-1">
                    {t.compare.finnhub.recentNews.map((n, i) => (
                      <li key={i} className="text-xs">
                        <a
                          href={n.url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-blue-600 hover:underline"
                        >
                          {n.headline}
                        </a>
                        <div className="text-[10px] text-muted-foreground/80">
                          {n.source} · {n.datetime ? new Date(n.datetime).toLocaleDateString() : ""}
                        </div>
                      </li>
                    ))}
                  </ul>
                )
              ) : (
                <div className="text-[10px] text-amber-600">
                  Finnhub: {t.compare.finnhub.reason || "unavailable"}
                </div>
              )}
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Peers / competitors */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Peers · Competitors</CardTitle>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            Cross-referenced from Yahoo + FMP + Finnhub. "Consensus peers" appear in ≥2 sources —
            stronger signal than any single list.
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          {data.peers.consensusPeers.length > 0 && (
            <div>
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
                Consensus peers (≥2 sources)
              </div>
              <div className="flex flex-wrap gap-1.5">
                {data.peers.consensusPeers.map((p) => (
                  <Badge key={p} variant="outline" className="text-[10px] border-blue-400 bg-blue-500/10 text-blue-700 font-mono">
                    {p}
                  </Badge>
                ))}
              </div>
            </div>
          )}
          <div className="grid grid-cols-2 gap-4">
            {[tA, tB].map((t) => (
              <div key={t.symbol}>
                <div className="font-mono text-xs font-semibold mb-1">{t.symbol} peers (any source)</div>
                <div className="flex flex-wrap gap-1">
                  {(data.peers.byTicker[t.symbol] || []).map((p) => (
                    <Badge key={p} variant="outline" className="text-[10px] font-mono">
                      {p}
                    </Badge>
                  ))}
                  {(data.peers.byTicker[t.symbol] || []).length === 0 && (
                    <span className="text-[10px] text-muted-foreground italic">none returned</span>
                  )}
                </div>
                <div className="mt-1 text-[10px] text-muted-foreground/80 space-x-2">
                  <span>Yahoo: {t.compare.yahoo.similarSymbols.length}</span>
                  <span>
                    FMP:{" "}
                    {t.compare.fmp.source === "fmp"
                      ? t.compare.fmp.peers.length
                      : "off"}
                  </span>
                  <span>
                    Finnhub:{" "}
                    {t.compare.finnhub.source === "finnhub"
                      ? t.compare.finnhub.peers.length
                      : "off"}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Methodology */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-xs flex items-center gap-1">
            <Info className="h-3 w-3" /> Methodology
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="space-y-1 text-xs text-muted-foreground list-disc list-inside">
            {data.methodology.map((m, i) => (
              <li key={i}>{m}</li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </>
  );
}
