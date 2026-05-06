import { useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, RefreshCcw, Info, AlertTriangle, Search } from "lucide-react";
import { fetchApi } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

type Tier = "BEST" | "STRONG" | "WATCH" | "AVOID";

/** Hover explanations — FinCal screener definitions (Yahoo-sourced data + our rules). */
const H = {
  roic:
    "Return on invested capital: after-tax operating profit divided by capital tied up in the business (debt + equity − cash, or Yahoo invested capital). ≥15% passes the quality gate here. Not the same as ROE.",
  fcfMargin:
    "Free cash flow margin: trailing free cash flow divided by revenue. Shows how much of each sales dollar becomes cash after operations and capex. The quality gate requires positive FCF (not margin).",
  netDebtEbitda:
    "Net debt ÷ EBITDA: (total debt − cash) divided by trailing EBITDA. Roughly how many years of EBITDA would repay net debt if nothing else changed. <2× passes the quality gate.",
  revYoy:
    "Revenue growth year-over-year from Yahoo (reported growth or two annual revenue figures). >0% passes the quality gate. Does not forecast future demand.",
  off52w:
    "Distance from the current price to the 52-week high (negative = below the high). ≤−15% passes the discount gate (at least 15% off the high).",
  fwdPe:
    "Forward P/E: price divided by consensus next-twelve-months EPS. Compare to trailing P/E on the live line. Forward < trailing often implies expected EPS growth (rough read only).",
  score:
    "Quality at a Discount score out of 100: up to 80 from four gates (ROIC ≥15%, positive FCF, net debt/EBITDA <2×, revenue YoY >0) and up to 20 from two discount gates (≥15% off 52w high, forward P/E below trailing P/E).",
  tier:
    "Tier from score: BEST 80–100, STRONG 65–79, WATCH 50–64, AVOID <50. Labels are relative to this screen, not a buy/sell recommendation.",
  priceCol:
    "Price & valuation stack: Now = last price. Analyst = Yahoo consensus mean target (n = analyst count). Bear/Base/Bull = forward EPS × 12 / 20 / 30 (rule-of-thumb anchors). Simple DCF = one-stage FCF model with fixed discount rate (sanity check only). Blended = average of available methods. Hover each row label for detail.",
  thesisCol:
    "Curated long-term role (stable) plus a Live line built from the same fundamentals as the table. Verify the role after major corporate events. Live updates every refresh.",
  liveLabel:
    "Live snapshot: auto-generated from current Yahoo fundamentals (ROIC, margins, growth, leverage, drawdown, P/E). Not news or management commentary.",
  liveNetCash:
    "Net cash: on this snapshot, cash and near-cash exceed gross debt in Yahoo’s fields (net debt negative). Strong liquidity; still verify restricted cash, leases, and other obligations.",
  liveFwdVsTrail:
    "Forward P/E vs trailing P/E: forward uses consensus next-twelve-month EPS; trailing uses reported last-twelve-month EPS. When forward is below trailing, the “Es expanding” % approximates how much cheaper the market prices the forward year vs the trailing year (expected EPS growth heuristic, not a forecast).",
  ptNow: "Last traded price from Yahoo. Anchor for upside % vs targets and blended value.",
  ptAnalyst:
    "Mean price target from Yahoo’s sell-side consensus. n = number of analysts. The % is (mean − Now) ÷ Now. Consensus often lags big moves; thin coverage (low n) is noisier.",
  ptRec:
    "Analyst recommendation mapped from Yahoo’s 1–5 mean (roughly Strong Buy → Sell). Sentiment only, not a quality score.",
  ptBands:
    "Bear / Base / Bull = forward EPS (or trailing if missing) × P/E multiples that re-calibrate with the 10-year Treasury (^TNX) and your theme (semis-style lists get a small bull tilt). Anchors only — not analyst scenarios.",
  ptDcf:
    "Simple one-stage model: TTM free cash flow grown at capped revenue YoY, discounted at 9%, per share. Rule-of-thumb; not a full DCF with forecasts.",
  ptBlended:
    "Equal average of analyst mean, base multiple band, and simple DCF when each is available. The % is vs Now. Large disagreement with price means “dig deeper,” not automatic buy/sell.",
  ptAsOf: "When this row’s targets were computed (your refresh time + Yahoo snapshot). Not each analyst’s report date.",
  cyclicalSignal:
    "Cyclical trough signal: EARLY = high trough score (deep drawdown, compressed multiples/margins, weak revenue); WATCH = moderate; NOT YET = low score; LIKELY MISSED = price near highs with strong revenue growth. Different playbook from quality compounders.",
  cyclicalScore:
    "Trough score 0–100 from drawdown, P/B, EV/Sales, EBITDA margin compression, and revenue contraction. Higher = looks more like a cycle bottom on price/fundamentals (not proof of a bottom).",
  pb: "Price-to-book: market cap ÷ book equity (Yahoo). Low P/B in cyclicals can mean distress or a trough; context matters.",
  evSales: "Enterprise value ÷ revenue (Yahoo). Lower often means cheaper vs sales; compare within sector.",
  ebitdaMgn: "EBITDA ÷ revenue (trailing, Yahoo). Compression can signal a margin cycle low; very high margins reduce trough score in this screen.",
} as const;

/** Map each bullet in the Live line to the right glossary entry (split on " • "). */
function liveSegmentHint(segment: string): string {
  const s = segment.trim();
  if (s.startsWith("ROIC")) return H.roic;
  if (s.startsWith("FCF")) return H.fcfMargin;
  if (s.startsWith("Revenue")) return H.revYoy;
  if (s.startsWith("Net cash")) return H.liveNetCash;
  if (s.startsWith("Net debt/EBITDA")) return H.netDebtEbitda;
  if (s.startsWith("At/near") || s.includes("52w high")) return H.off52w;
  if (s.startsWith("Fwd P/E")) return H.liveFwdVsTrail;
  return H.liveLabel;
}

/** Renders the Live dynamic hook with a tooltip on each " • " segment. */
function DynamicHookSegments({ text }: { text: string }) {
  const parts = text.split(" • ").map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) return null;
  return (
    <span className="inline leading-relaxed">
      {parts.map((p, i) => (
        <span key={`${i}-${p.slice(0, 24)}`}>
          {i > 0 && <span className="text-muted-foreground/40"> • </span>}
          <Hint content={liveSegmentHint(p)} className="decoration-muted-foreground/60">
            {p}
          </Hint>
        </span>
      ))}
    </span>
  );
}

function Hint({
  content,
  children,
  className,
  side = "top",
}: {
  content: string;
  children: ReactNode;
  className?: string;
  side?: "top" | "bottom" | "left" | "right";
}) {
  return (
    <Tooltip delayDuration={250}>
      <TooltipTrigger asChild>
        <span
          className={cn(
            "cursor-help underline decoration-dotted decoration-muted-foreground/50 underline-offset-2",
            className
          )}
        >
          {children}
        </span>
      </TooltipTrigger>
      <TooltipContent side={side} className="max-w-[min(320px,85vw)] text-xs leading-snug px-3 py-2">
        {content}
      </TooltipContent>
    </Tooltip>
  );
}

function HintBlock({ content, children }: { content: string; children: ReactNode }) {
  return (
    <Tooltip delayDuration={250}>
      <TooltipTrigger asChild>
        <span className="cursor-help border-b border-dotted border-muted-foreground/40">{children}</span>
      </TooltipTrigger>
      <TooltipContent side="left" className="max-w-[min(320px,85vw)] text-xs leading-snug px-3 py-2">
        {content}
      </TooltipContent>
    </Tooltip>
  );
}

/** Tooltip without underline — for badges / blocks. */
function HintWrap({ content, children }: { content: string; children: ReactNode }) {
  return (
    <Tooltip delayDuration={250}>
      <TooltipTrigger asChild>
        <span className="cursor-help inline-flex">{children}</span>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-[min(320px,85vw)] text-xs leading-snug px-3 py-2">
        {content}
      </TooltipContent>
    </Tooltip>
  );
}

interface PriceTargets {
  analystMean: number | null;
  analystHigh: number | null;
  analystLow: number | null;
  analystMedian: number | null;
  analystCount: number | null;
  analystImpliedUpsidePct: number | null;
  recommendationMean: number | null;
  recommendationLabel: string | null;
  bearFairValue: number | null;
  baseFairValue: number | null;
  bullFairValue: number | null;
  dcfFairValue: number | null;
  blendedFairValue: number | null;
  blendedImpliedUpsidePct: number | null;
  asOf: string;
  methodNotes: string[];
  calibration?: {
    treasury10yPct: number | null;
    treasury10yEffectivePct: number;
    treasurySource: string;
    dcfDiscountRate: number;
    equityRiskPremium: number;
    multiples: { bear: number; base: number; bull: number };
    sectorPremium: string;
    notes: string[];
    sectorEtf?: string | null;
    sectorForwardPE?: number | null;
    sectorTrailingPE?: number | null;
    baseFromYield?: number;
    baseFromSector?: number | null;
  };
}

interface QualityRow {
  rank: number;
  symbol: string;
  name: string;
  roic: number | null;
  fcfMargin: number | null;
  netDebtToEbitda: number | null;
  revenueGrowthYoy: number | null;
  pctOff52WeekHigh: number | null;
  forwardPE: number | null;
  trailingPE: number | null;
  qualityPoints: number;
  discountPoints: number;
  score: number;
  tier: Tier;
  thesisHook: string;
  dynamicHook: string;
  priceTargets?: PriceTargets;
  currentPrice?: number | null;
  insufficientFlags: string[];
}

interface QualityResponse {
  generatedAt: string;
  cacheTtlSeconds?: number;
  fundamentalsTtlSeconds?: number;
  marketCalibration?: PriceTargets["calibration"];
  universe: { id: string; label: string; notes: string[] };
  tickerCount: number;
  tierCounts: Record<Tier, number>;
  methodology: string[];
  rows: QualityRow[];
}

interface CyclicalRow {
  rank: number;
  symbol: string;
  name: string;
  pctOff52WeekHigh: number | null;
  priceToBook: number | null;
  evToSales: number | null;
  ebitdaMargin: number | null;
  netDebtToEbitda: number | null;
  revenueGrowthYoy: number | null;
  troughScore: number;
  signal: "early" | "watch" | "not_yet" | "missed";
  rationale: string[];
  insufficientFlags: string[];
}

interface CyclicalResponse {
  generatedAt: string;
  universe: { id: string; label: string; notes: string[] };
  tickerCount: number;
  methodology: string[];
  rows: CyclicalRow[];
}

interface UniverseListItem {
  id: string;
  label: string;
  tickerCount: number;
}

const fmtPct = (v: number | null, digits = 1): string =>
  v === null || v === undefined || Number.isNaN(v) ? "—" : `${(v * 100).toFixed(digits)}%`;

const fmtNum = (v: number | null, digits = 2): string =>
  v === null || v === undefined || Number.isNaN(v) ? "—" : v.toFixed(digits);

const fmtUsd = (v: number | null): string =>
  v === null || v === undefined || Number.isNaN(v) ? "—" : `$${v.toFixed(2)}`;

const upsideClass = (pct: number | null): string => {
  if (pct === null) return "text-muted-foreground";
  if (pct >= 0.2) return "text-green-600 font-semibold";
  if (pct >= 0.05) return "text-green-600";
  if (pct >= -0.05) return "text-muted-foreground";
  if (pct >= -0.2) return "text-red-500";
  return "text-red-600 font-semibold";
};

function recBadge(label: string | null) {
  if (!label) return null;
  const cls =
    label === "Strong Buy"
      ? "border-green-600 bg-green-500/15 text-green-700"
      : label === "Buy"
      ? "border-emerald-400 bg-emerald-500/10 text-emerald-700"
      : label === "Hold"
      ? "border-amber-400 bg-amber-500/10 text-amber-700"
      : "border-red-400 bg-red-500/10 text-red-700";
  return (
    <Badge variant="outline" className={`text-[9px] ${cls}`}>
      {label}
    </Badge>
  );
}

function tierBadge(t: Tier) {
  const map: Record<Tier, string> = {
    BEST: "border-green-500 bg-green-500/15 text-green-700",
    STRONG: "border-emerald-400 bg-emerald-500/10 text-emerald-700",
    WATCH: "border-amber-400 bg-amber-500/10 text-amber-700",
    AVOID: "border-red-400 bg-red-500/15 text-red-700",
  };
  return (
    <Badge variant="outline" className={`text-[10px] ${map[t]}`}>
      {t}
    </Badge>
  );
}

function signalBadge(s: CyclicalRow["signal"]) {
  const map: Record<CyclicalRow["signal"], { label: string; cls: string }> = {
    early: { label: "EARLY ENTRY", cls: "border-green-500 bg-green-500/15 text-green-700" },
    watch: { label: "WATCH", cls: "border-amber-400 bg-amber-500/10 text-amber-700" },
    not_yet: { label: "NOT YET", cls: "border-slate-400 bg-slate-500/10 text-slate-600" },
    missed: { label: "LIKELY MISSED", cls: "border-red-400 bg-red-500/15 text-red-700" },
  };
  const { label, cls } = map[s];
  return (
    <Badge variant="outline" className={`text-[10px] ${cls}`}>
      {label}
    </Badge>
  );
}

export function ScreenerTab() {
  const [mode, setMode] = useState<"quality" | "cyclical">("quality");
  const [universeId, setUniverseId] = useState<string>("AI_INFRA");
  const [customSymbols, setCustomSymbols] = useState<string>("");
  const [useCustom, setUseCustom] = useState<boolean>(false);

  const { data: universes } = useQuery<UniverseListItem[]>({
    queryKey: ["/api/screener/universes"],
    queryFn: async () => {
      const r = await fetchApi("/api/screener/universes");
      if (!r.ok) throw new Error("Failed to load universes");
      return r.json();
    },
    staleTime: 24 * 60 * 60 * 1000,
  });

  const queryString = useMemo(() => {
    if (useCustom && customSymbols.trim()) {
      return `?symbols=${encodeURIComponent(customSymbols.trim())}`;
    }
    return `?universe=${universeId}`;
  }, [useCustom, customSymbols, universeId]);

  const endpoint = mode === "quality" ? "quality-discount" : "cyclical-trough";

  const { data: qualityData, isLoading: qLoading, error: qError, refetch: qRefetch, isFetching: qFetching } = useQuery<QualityResponse>({
    queryKey: ["/api/screener/quality-discount", queryString],
    queryFn: async () => {
      const r = await fetchApi(`/api/screener/quality-discount${queryString}`);
      if (!r.ok) throw new Error("Screener failed");
      return r.json();
    },
    enabled: mode === "quality",
    staleTime: 30 * 60 * 1000,
  });

  const { data: cyclicalData, isLoading: cLoading, error: cError, refetch: cRefetch, isFetching: cFetching } = useQuery<CyclicalResponse>({
    queryKey: ["/api/screener/cyclical-trough", queryString],
    queryFn: async () => {
      const r = await fetchApi(`/api/screener/cyclical-trough${queryString}`);
      if (!r.ok) throw new Error("Screener failed");
      return r.json();
    },
    enabled: mode === "cyclical",
    staleTime: 30 * 60 * 1000,
  });

  const isLoading = mode === "quality" ? qLoading : cLoading;
  const isFetching = mode === "quality" ? qFetching : cFetching;
  const error = mode === "quality" ? qError : cError;
  const refetch = mode === "quality" ? qRefetch : cRefetch;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <CardTitle className="text-base">Thematic Screener</CardTitle>
              <p className="text-xs text-muted-foreground mt-1">
                Quality at a Discount (compounders) or Cyclical Trough (early-entry deep value).
                Live data from Yahoo Finance. Verify before trading.
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => refetch()}
              disabled={isFetching}
            >
              {isFetching ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCcw className="h-3 w-3" />}
              <span className="ml-1">Refresh</span>
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <Button
              variant={mode === "quality" ? "default" : "outline"}
              size="sm"
              onClick={() => setMode("quality")}
            >
              Quality at a Discount
            </Button>
            <Button
              variant={mode === "cyclical" ? "default" : "outline"}
              size="sm"
              onClick={() => setMode("cyclical")}
            >
              Cyclical Trough (early entry)
            </Button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-2">
              <Button
                variant={!useCustom ? "default" : "outline"}
                size="sm"
                onClick={() => setUseCustom(false)}
              >
                Theme
              </Button>
              <Button
                variant={useCustom ? "default" : "outline"}
                size="sm"
                onClick={() => setUseCustom(true)}
              >
                Custom list
              </Button>
            </div>

            {!useCustom ? (
              <Select value={universeId} onValueChange={setUniverseId}>
                <SelectTrigger className="w-[260px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(universes ?? []).map((u) => (
                    <SelectItem key={u.id} value={u.id}>
                      {u.label} ({u.tickerCount})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <div className="flex items-center gap-2 flex-1 min-w-[260px]">
                <Search className="h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="NVDA,AVGO,MU,WDC,..."
                  value={customSymbols}
                  onChange={(e) => setCustomSymbols(e.target.value)}
                  className="h-8"
                />
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {isLoading && (
        <div className="flex h-40 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
          <span className="ml-2 text-sm text-muted-foreground">
            Pulling fundamentals and scoring... (first run can take 30-60s)
          </span>
        </div>
      )}

      {error && (
        <Card className="border-destructive">
          <CardContent className="flex items-center gap-2 py-4 text-destructive">
            <AlertTriangle className="h-5 w-5" />
            <span>Screener failed. Yahoo may be rate-limiting. Try again in a minute.</span>
          </CardContent>
        </Card>
      )}

      {mode === "quality" && qualityData && !isLoading && (
        <QualityResults data={qualityData} />
      )}

      {mode === "cyclical" && cyclicalData && !isLoading && (
        <CyclicalResults data={cyclicalData} />
      )}
    </div>
  );
}

function QualityResults({ data }: { data: QualityResponse }) {
  return (
    <>
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">
            {data.universe.label} — {data.tickerCount} names
          </CardTitle>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            Data as of {new Date(data.generatedAt).toLocaleString()} · Live snapshots recomputed each refresh from Yahoo fundamentals
          </p>
          {data.marketCalibration && (
            <div className="mt-2 space-y-1 rounded-md border bg-muted/30 px-2 py-1.5 text-[11px] leading-snug text-muted-foreground">
              <div>
                <span className="font-medium text-foreground/80">Macro calibration: </span>
                10Y {data.marketCalibration.treasury10yPct != null ? `${data.marketCalibration.treasury10yPct.toFixed(2)}%` : "n/a"}{" "}
                (effective {data.marketCalibration.treasury10yEffectivePct.toFixed(2)}%, {data.marketCalibration.treasurySource}) · DCF
                discount {(data.marketCalibration.dcfDiscountRate * 100).toFixed(2)}% · EPS bands{" "}
                {data.marketCalibration.multiples.bear}× / {data.marketCalibration.multiples.base}× /{" "}
                {data.marketCalibration.multiples.bull}×
              </div>
              <div className="text-[10px]">{data.marketCalibration.sectorPremium}</div>
              {data.marketCalibration.sectorEtf && (
                <div className="text-[10px] text-muted-foreground/90">
                  Anchor ETF {data.marketCalibration.sectorEtf}
                  {data.marketCalibration.sectorForwardPE != null &&
                    ` · Fwd P/E ${data.marketCalibration.sectorForwardPE.toFixed(1)}`}
                  {data.marketCalibration.sectorTrailingPE != null &&
                    ` · Trail P/E ${data.marketCalibration.sectorTrailingPE.toFixed(1)}`}
                  {data.marketCalibration.baseFromYield != null &&
                    data.marketCalibration.baseFromSector != null && (
                    <span>
                      {" "}
                      · Yield-base {data.marketCalibration.baseFromYield}× + sector-base{" "}
                      {data.marketCalibration.baseFromSector}× → final {data.marketCalibration.multiples.base}×
                    </span>
                  )}
                </div>
              )}
              {(data.cacheTtlSeconds != null || data.fundamentalsTtlSeconds != null) && (
                <div className="text-[10px] text-muted-foreground/80">
                  TTL: screener {data.cacheTtlSeconds != null ? `${Math.round(data.cacheTtlSeconds / 60)}m` : "—"} · fundamentals{" "}
                  {data.fundamentalsTtlSeconds != null ? `${Math.round(data.fundamentalsTtlSeconds / 60)}m` : "—"} · ^TNX 5m
                </div>
              )}
            </div>
          )}
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2 text-xs">
            <Badge variant="outline" className="border-green-500 bg-green-500/10 text-green-700">
              BEST: {data.tierCounts.BEST}
            </Badge>
            <Badge variant="outline" className="border-emerald-400 bg-emerald-500/10 text-emerald-700">
              STRONG: {data.tierCounts.STRONG}
            </Badge>
            <Badge variant="outline" className="border-amber-400 bg-amber-500/10 text-amber-700">
              WATCH: {data.tierCounts.WATCH}
            </Badge>
            <Badge variant="outline" className="border-red-400 bg-red-500/10 text-red-700">
              AVOID: {data.tierCounts.AVOID}
            </Badge>
          </div>
          {data.universe.notes?.length > 0 && (
            <div className="mt-3 space-y-1">
              {data.universe.notes.map((n, i) => (
                <div key={i} className="flex items-start gap-2 text-xs text-muted-foreground">
                  <Info className="h-3 w-3 mt-0.5" /> <span>{n}</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <p className="px-4 pt-3 pb-1 text-[11px] text-muted-foreground">
            Hover dotted underlines on column headers, numbers, and price-stack labels for definitions.
          </p>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12">#</TableHead>
                <TableHead>Ticker</TableHead>
                <TableHead className="text-right">
                  <Hint content={H.roic}>ROIC</Hint>
                </TableHead>
                <TableHead className="text-right">
                  <Hint content={H.fcfMargin}>FCF Margin</Hint>
                </TableHead>
                <TableHead className="text-right">
                  <Hint content={H.netDebtEbitda}>NetDebt/EBITDA</Hint>
                </TableHead>
                <TableHead className="text-right">
                  <Hint content={H.revYoy}>Rev YoY</Hint>
                </TableHead>
                <TableHead className="text-right">
                  <Hint content={H.off52w}>Off 52w Hi</Hint>
                </TableHead>
                <TableHead className="text-right">
                  <Hint content={H.fwdPe}>Fwd P/E</Hint>
                </TableHead>
                <TableHead className="text-right">
                  <Hint content={H.score}>Score</Hint>
                </TableHead>
                <TableHead>
                  <Hint content={H.tier}>Tier</Hint>
                </TableHead>
                <TableHead className="min-w-[200px]">
                  <Hint content={H.priceCol}>Price · Targets · Fair Value</Hint>
                </TableHead>
                <TableHead className="min-w-[320px]">
                  <Hint content={H.thesisCol}>Long-term role + Live snapshot</Hint>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.rows.map((r) => (
                <TableRow key={r.symbol}>
                  <TableCell className="text-xs">{r.rank}</TableCell>
                  <TableCell className="font-mono text-xs font-semibold">{r.symbol}</TableCell>
                  <TableCell className="text-right text-xs">
                    <Hint content={H.roic} className="tabular-nums">
                      {fmtPct(r.roic, 1)}
                    </Hint>
                  </TableCell>
                  <TableCell className="text-right text-xs">
                    <Hint content={H.fcfMargin} className="tabular-nums">
                      {fmtPct(r.fcfMargin, 1)}
                    </Hint>
                  </TableCell>
                  <TableCell className="text-right text-xs">
                    <Hint content={H.netDebtEbitda} className="tabular-nums">
                      {fmtNum(r.netDebtToEbitda, 2)}x
                    </Hint>
                  </TableCell>
                  <TableCell className="text-right text-xs">
                    <Hint content={H.revYoy} className="tabular-nums">
                      {fmtPct(r.revenueGrowthYoy, 1)}
                    </Hint>
                  </TableCell>
                  <TableCell className="text-right text-xs">
                    <Hint content={H.off52w} className="tabular-nums">
                      {fmtPct(r.pctOff52WeekHigh, 1)}
                    </Hint>
                  </TableCell>
                  <TableCell className="text-right text-xs">
                    <Hint content={H.fwdPe} className="tabular-nums">
                      {fmtNum(r.forwardPE, 1)}
                    </Hint>
                  </TableCell>
                  <TableCell className="text-right text-xs font-semibold">
                    <Hint content={H.score} className="tabular-nums">
                      {r.score}
                    </Hint>
                  </TableCell>
                  <TableCell>
                    <HintWrap content={H.tier}>{tierBadge(r.tier)}</HintWrap>
                  </TableCell>
                  <TableCell className="text-[11px] leading-tight">
                    <PriceTargetCell row={r} />
                  </TableCell>
                  <TableCell className="text-xs">
                    {r.thesisHook ? (
                      <div className="text-muted-foreground">{r.thesisHook}</div>
                    ) : (
                      <div className="italic text-muted-foreground/70">— no curated role —</div>
                    )}
                    {r.dynamicHook && (
                      <div className="mt-1 text-[11px] text-foreground/80">
                        <Hint content={H.liveLabel} className="text-[10px] font-semibold uppercase tracking-wide text-blue-600">
                          Live:
                        </Hint>{" "}
                        <DynamicHookSegments text={r.dynamicHook} />
                      </div>
                    )}
                    {r.insufficientFlags.length > 0 && (
                      <div className="mt-0.5 text-[10px] text-amber-600">
                        Missing: {r.insufficientFlags.join(", ")}
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <MethodologyCard items={data.methodology} />
    </>
  );
}

function CyclicalResults({ data }: { data: CyclicalResponse }) {
  return (
    <>
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">
            {data.universe.label} — Cyclical Trough Scan ({data.tickerCount} names)
          </CardTitle>
          <p className="text-xs text-muted-foreground mt-1">
            Looking for businesses that look temporarily broken. Different from quality screen — INVERTED logic.
            Cannot verify destocking / capex cuts from Yahoo alone — verify externally.
          </p>
        </CardHeader>
      </Card>

      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <p className="px-4 pt-3 pb-1 text-[11px] text-muted-foreground">
            Hover dotted underlines on headers and values for definitions.
          </p>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12">#</TableHead>
                <TableHead>Ticker</TableHead>
                <TableHead>
                  <Hint content={H.cyclicalSignal}>Signal</Hint>
                </TableHead>
                <TableHead className="text-right">
                  <Hint content={H.cyclicalScore}>Score</Hint>
                </TableHead>
                <TableHead className="text-right">
                  <Hint content={H.off52w}>Off 52w Hi</Hint>
                </TableHead>
                <TableHead className="text-right">
                  <Hint content={H.pb}>P/B</Hint>
                </TableHead>
                <TableHead className="text-right">
                  <Hint content={H.evSales}>EV/Sales</Hint>
                </TableHead>
                <TableHead className="text-right">
                  <Hint content={H.ebitdaMgn}>EBITDA mgn</Hint>
                </TableHead>
                <TableHead className="text-right">
                  <Hint content={H.revYoy}>Rev YoY</Hint>
                </TableHead>
                <TableHead className="min-w-[260px]">Rationale</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.rows.map((r) => (
                <TableRow key={r.symbol}>
                  <TableCell className="text-xs">{r.rank}</TableCell>
                  <TableCell className="font-mono text-xs font-semibold">{r.symbol}</TableCell>
                  <TableCell>
                    <HintWrap content={H.cyclicalSignal}>{signalBadge(r.signal)}</HintWrap>
                  </TableCell>
                  <TableCell className="text-right text-xs font-semibold">
                    <Hint content={H.cyclicalScore} className="tabular-nums">
                      {r.troughScore}
                    </Hint>
                  </TableCell>
                  <TableCell className="text-right text-xs">
                    <Hint content={H.off52w} className="tabular-nums">
                      {fmtPct(r.pctOff52WeekHigh, 1)}
                    </Hint>
                  </TableCell>
                  <TableCell className="text-right text-xs">
                    <Hint content={H.pb} className="tabular-nums">
                      {fmtNum(r.priceToBook, 2)}
                    </Hint>
                  </TableCell>
                  <TableCell className="text-right text-xs">
                    <Hint content={H.evSales} className="tabular-nums">
                      {fmtNum(r.evToSales, 2)}
                    </Hint>
                  </TableCell>
                  <TableCell className="text-right text-xs">
                    <Hint content={H.ebitdaMgn} className="tabular-nums">
                      {fmtPct(r.ebitdaMargin, 1)}
                    </Hint>
                  </TableCell>
                  <TableCell className="text-right text-xs">
                    <Hint content={H.revYoy} className="tabular-nums">
                      {fmtPct(r.revenueGrowthYoy, 1)}
                    </Hint>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {r.rationale.length === 0 ? <span className="italic">no signal</span> : (
                      <ul className="list-disc list-inside space-y-0.5">
                        {r.rationale.map((rat, i) => (<li key={i}>{rat}</li>))}
                      </ul>
                    )}
                    {r.insufficientFlags.length > 0 && (
                      <div className="mt-0.5 text-[10px] text-amber-600">
                        Missing: {r.insufficientFlags.join(", ")}
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <MethodologyCard items={data.methodology} />
    </>
  );
}

function PriceTargetCell({ row }: { row: QualityRow }) {
  const price = row.currentPrice ?? null;
  const pt = row.priceTargets;

  if (!pt) {
    return (
      <div className="space-y-0.5">
        <div className="flex items-center justify-between gap-2">
          <HintBlock content={H.ptNow}>
            <span className="text-muted-foreground">Now</span>
          </HintBlock>
          <span className="font-semibold">{fmtUsd(price)}</span>
        </div>
        <div className="text-[10px] text-muted-foreground/70 italic">
          No target data (refresh to recompute)
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-0.5">
      <div className="flex items-center justify-between gap-2">
        <HintBlock content={H.ptNow}>
          <span className="text-muted-foreground">Now</span>
        </HintBlock>
        <HintWrap content={H.ptNow}>
          <span className="font-semibold">{fmtUsd(price)}</span>
        </HintWrap>
      </div>

      {pt.analystMean !== null ? (
        <div className="flex items-center justify-between gap-2">
          <HintBlock content={H.ptAnalyst}>
            <span className="text-muted-foreground">
              Analyst{" "}
              {pt.analystCount !== null && (
                <span className="text-[9px]">(n={pt.analystCount})</span>
              )}
            </span>
          </HintBlock>
          <HintWrap content={H.ptAnalyst}>
            <span className="flex items-center gap-1">
              <span>{fmtUsd(pt.analystMean)}</span>
              <span className={`text-[10px] ${upsideClass(pt.analystImpliedUpsidePct)}`}>
                {pt.analystImpliedUpsidePct === null
                  ? ""
                  : `${pt.analystImpliedUpsidePct >= 0 ? "+" : ""}${(pt.analystImpliedUpsidePct * 100).toFixed(0)}%`}
              </span>
            </span>
          </HintWrap>
        </div>
      ) : (
        <div className="flex justify-between gap-2 text-muted-foreground/70">
          <HintBlock content={H.ptAnalyst}>
            <span>Analyst</span>
          </HintBlock>
          <span>—</span>
        </div>
      )}

      {pt.recommendationLabel && (
        <div className="flex items-center justify-between gap-2">
          <HintBlock content={H.ptRec}>
            <span className="text-muted-foreground text-[10px]">Rec</span>
          </HintBlock>
          <HintWrap content={H.ptRec}>{recBadge(pt.recommendationLabel)}</HintWrap>
        </div>
      )}

      {(pt.bearFairValue !== null || pt.baseFairValue !== null || pt.bullFairValue !== null) && (
        <div className="mt-1 border-t pt-1">
          <div className="flex items-center justify-between gap-2">
            <HintBlock content={H.ptBands}>
              <span className="text-muted-foreground text-[10px]">Bear / Base / Bull</span>
            </HintBlock>
            <HintWrap content={H.ptBands}>
              <span className="text-[10px]">
                {fmtUsd(pt.bearFairValue)} / <span className="font-semibold">{fmtUsd(pt.baseFairValue)}</span> /{" "}
                {fmtUsd(pt.bullFairValue)}
              </span>
            </HintWrap>
          </div>
          {pt.dcfFairValue !== null && (
            <div className="flex items-center justify-between gap-2">
              <HintBlock content={H.ptDcf}>
                <span className="text-muted-foreground text-[10px]">Simple DCF</span>
              </HintBlock>
              <HintWrap content={H.ptDcf}>
                <span className="text-[10px]">{fmtUsd(pt.dcfFairValue)}</span>
              </HintWrap>
            </div>
          )}
          {pt.blendedFairValue !== null && (
            <div className="flex items-center justify-between gap-2">
              <HintBlock content={H.ptBlended}>
                <span className="text-[10px] font-semibold">Blended</span>
              </HintBlock>
              <HintWrap content={H.ptBlended}>
                <span className="flex items-center gap-1 text-[10px] font-semibold">
                  {fmtUsd(pt.blendedFairValue)}
                  <span className={upsideClass(pt.blendedImpliedUpsidePct)}>
                    {pt.blendedImpliedUpsidePct === null
                      ? ""
                      : `${pt.blendedImpliedUpsidePct >= 0 ? "+" : ""}${(pt.blendedImpliedUpsidePct * 100).toFixed(0)}%`}
                  </span>
                </span>
              </HintWrap>
            </div>
          )}
        </div>
      )}

      <div className="text-[9px] text-muted-foreground/60 mt-0.5">
        <HintBlock content={H.ptAsOf}>
          <span>
            as of {pt.asOf ? new Date(pt.asOf).toLocaleDateString() : "—"}
          </span>
        </HintBlock>
      </div>
    </div>
  );
}

function MethodologyCard({ items }: { items: string[] }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-xs flex items-center gap-1">
          <Info className="h-3 w-3" /> Methodology
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="space-y-1 text-xs text-muted-foreground list-disc list-inside">
          {items.map((m, i) => (
            <li key={i}>{m}</li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
