import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Loader2,
  Trash2,
  Calculator,
  TrendingUp,
  TrendingDown,
  Minus,
  RefreshCw,
  Pencil,
} from "lucide-react";
import type {
  TradeIdea,
  WatchlistContextSnapshot,
  WatchlistLearningReport,
  WatchlistEvaluationReport,
} from "@shared/optionsSchema";
import type { OptionsWatchlistRow } from "@shared/schema";
import { apiRequest, fetchApi } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Label } from "@/components/ui/label";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";

/** Readable text/placeholder in dark table cells (default muted placeholder was too faint). */
const watchlistInputClass =
  "h-8 bg-background text-right text-xs tabular-nums text-foreground caret-foreground placeholder:text-muted-foreground/80";

export async function addIdeaToWatchlist(
  symbol: string,
  idea: TradeIdea,
  context?: WatchlistContextSnapshot,
) {
  if (!Number.isFinite(idea.underlyingPrice) || idea.underlyingPrice <= 0) {
    throw new Error(
      "This idea has an invalid underlying price. Refresh or re-run analysis, then add again.",
    );
  }
  const res = await apiRequest("POST", "/api/options/watchlist", {
    symbol,
    idea,
    ...(context ? { context } : {}),
  });
  return res.json() as Promise<{ item: OptionsWatchlistRow }>;
}

function WatchlistCreditCell({
  rowId,
  entryPrice,
  settled,
}: {
  rowId: string;
  entryPrice: number;
  settled: boolean;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(entryPrice.toFixed(2));

  const patchMut = useMutation({
    mutationFn: async (price: number) => {
      const res = await apiRequest("PATCH", `/api/options/watchlist/${rowId}`, {
        entryPrice: price,
      });
      return res.json() as Promise<{ item: OptionsWatchlistRow }>;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/options/watchlist"] });
      toast({ title: "Entry credit updated", description: "P/L uses your fill from here on." });
      setOpen(false);
    },
    onError: (e: Error) => {
      toast({ title: "Could not update", description: e.message, variant: "destructive" });
    },
  });

  if (settled) {
    return (
      <div className="text-right tabular-nums">
        <span className="text-foreground">${entryPrice.toFixed(2)}</span>
        <span className="ml-0.5 text-muted-foreground">/sh</span>
      </div>
    );
  }

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) setDraft(entryPrice.toFixed(2));
      }}
    >
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-auto gap-1 px-2 py-1 font-normal text-foreground hover:bg-muted/80"
        >
          <span className="tabular-nums">${entryPrice.toFixed(2)}</span>
          <span className="text-muted-foreground">/sh</span>
          <Pencil className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72" align="end">
        <p className="mb-3 text-xs text-muted-foreground">
          Pulled from Analysis / Trade ideas when you saved this row. Change it to the{" "}
          <strong className="font-medium text-foreground">net premium per share</strong> you
          actually received (same sign as in the idea — credit spreads are usually positive).
        </p>
        <Label htmlFor={`credit-${rowId}`} className="text-xs">
          Net $/share
        </Label>
        <div className="mt-1 flex gap-2">
          <Input
            id={`credit-${rowId}`}
            inputMode="decimal"
            className={watchlistInputClass}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
          <Button
            size="sm"
            disabled={patchMut.isPending}
            onClick={() => {
              const v = parseFloat(draft.replace(/,/g, ""));
              if (!Number.isFinite(v)) {
                toast({ title: "Enter a valid number", variant: "destructive" });
                return;
              }
              patchMut.mutate(v);
            }}
          >
            Save
          </Button>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          Per contract ≈ $
          {(
            (Number.isFinite(parseFloat(draft.replace(/,/g, "")))
              ? parseFloat(draft.replace(/,/g, ""))
              : entryPrice) * 100
          ).toFixed(0)}
        </p>
      </PopoverContent>
    </Popover>
  );
}

interface WatchlistStats {
  total: number;
  settledCount: number;
  openCount: number;
  wins: number;
  losses: number;
  breakevens: number;
  winRatePct: number | null;
  lossRatePct: number | null;
  totalSettlementPnl: number;
}

export function IdeaWatchlistTab() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const autoSettleOnce = useRef(false);
  const [simPrice, setSimPrice] = useState<Record<string, string>>({});
  const [settlePrice, setSettlePrice] = useState<Record<string, string>>({});

  const {
    data: watchData,
    isLoading: watchLoading,
    error: watchError,
  } = useQuery<{
    stats: WatchlistStats;
    list: { items: OptionsWatchlistRow[] };
    learning?: WatchlistLearningReport;
    evaluation?: WatchlistEvaluationReport;
  }>({
    queryKey: ["/api/options/watchlist", "bundle"],
    queryFn: async () => {
      // Core data (required). If these fail the tab legitimately can't render.
      const [statsRes, listRes] = await Promise.all([
        apiRequest("GET", "/api/options/watchlist/stats"),
        apiRequest("GET", "/api/options/watchlist"),
      ]);
      const [stats, list] = await Promise.all([statsRes.json(), listRes.json()]);

      // Secondary analytics (optional). Never let a 404/HTML/parse failure here — e.g. an
      // older server instance without these routes — take down the whole watchlist.
      const optionalJson = async <T,>(url: string): Promise<T | undefined> => {
        try {
          const res = await fetchApi(url);
          if (!res.ok) return undefined;
          const ct = res.headers.get("content-type") || "";
          if (!ct.toLowerCase().includes("application/json")) return undefined;
          return (await res.json()) as T;
        } catch {
          return undefined;
        }
      };
      const [learning, evaluation] = await Promise.all([
        optionalJson<WatchlistLearningReport>("/api/options/watchlist/learning"),
        optionalJson<WatchlistEvaluationReport>("/api/options/watchlist/evaluation"),
      ]);

      return { stats, list, learning, evaluation };
    },
  });
  const stats = watchData?.stats;
  const listData = watchData?.list;
  const learning = watchData?.learning;
  const evaluation = watchData?.evaluation;

  const verdictConfig: Record<
    WatchlistEvaluationReport["verdict"],
    { label: string; cls: string }
  > = {
    improving: { label: "Improving accuracy", cls: "border-green-300 bg-green-500/10 text-green-700" },
    degrading: { label: "Hurting accuracy", cls: "border-red-300 bg-red-500/10 text-red-700" },
    no_evidence: { label: "No evidence yet", cls: "border-yellow-300 bg-yellow-500/10 text-yellow-700" },
    not_enough_data: { label: "Collecting data", cls: "border-muted bg-muted text-muted-foreground" },
  };

  const readinessLabel =
    learning?.readiness === "calibrated"
      ? "Calibrated"
      : learning?.readiness === "learning"
        ? "Learning"
        : "Collecting data";

  const autoSettleMut = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/options/watchlist/auto-settle", {});
      return res.json() as Promise<{
        settled: number;
        skipped: number;
        errors: { id: string; reason: string }[];
      }>;
    },
    onSuccess: (data) => {
      if (data.settled > 0) {
        toast({
          title: "Auto-settled expired ideas",
          description: `${data.settled} watchlist row(s) closed at expiry; added to trade log where possible.`,
        });
      }
      qc.invalidateQueries({ queryKey: ["/api/options/watchlist"] });
      qc.invalidateQueries({ queryKey: ["/api/trade-journal"] });
    },
  });

  useEffect(() => {
    if (watchLoading || !listData || autoSettleOnce.current) return;
    const today = new Date().toISOString().slice(0, 10);
    const needsAuto = listData.items.some(
      (r) => r.settlementPnl == null && r.expirationDate < today
    );
    autoSettleOnce.current = true;
    if (!needsAuto) return;
    autoSettleMut.mutate();
  }, [watchLoading, listData]);

  const settleMut = useMutation({
    mutationFn: async ({ id, underlyingPrice }: { id: string; underlyingPrice?: number }) => {
      const body =
        underlyingPrice != null && underlyingPrice > 0 ? { underlyingPrice } : {};
      const res = await apiRequest("POST", `/api/options/watchlist/${id}/settle`, body);
      return res.json();
    },
    onSuccess: (data) => {
      toast({
        title: "Settled at expiry",
        description: `P/L $${Number(data.settlementPnl).toFixed(2)} (${data.outcome})`,
      });
      qc.invalidateQueries({ queryKey: ["/api/options/watchlist"] });
      qc.invalidateQueries({ queryKey: ["/api/trade-journal"] });
    },
    onError: (e: Error) => {
      toast({ title: "Settlement failed", description: e.message, variant: "destructive" });
    },
  });

  const simulateMut = useMutation({
    mutationFn: async ({ id, underlyingPrice }: { id: string; underlyingPrice: number }) => {
      const res = await apiRequest("POST", `/api/options/watchlist/${id}/simulate`, {
        underlyingPrice,
      });
      return res.json() as Promise<{
        underlyingPrice: number;
        pnlAtExpiry: number;
        outcome: string;
      }>;
    },
    onSuccess: (data, vars) => {
      toast({
        title: `If stock @ $${vars.underlyingPrice.toFixed(2)} at expiry`,
        description: `P/L $${data.pnlAtExpiry.toFixed(2)} (${data.outcome})`,
      });
    },
    onError: (e: Error) => {
      toast({ title: "Simulation failed", description: e.message, variant: "destructive" });
    },
  });

  const deleteMut = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/options/watchlist/${id}`);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/options/watchlist"] });
      toast({ title: "Removed from watchlist" });
    },
  });

  const items = listData?.items ?? [];

  if (watchError) {
    return (
      <Card className="border-destructive">
        <CardContent className="whitespace-pre-wrap break-words pt-6 text-sm text-destructive">
          {watchError instanceof Error ? watchError.message : String(watchError)}
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Open ideas</CardTitle>
          </CardHeader>
          <CardContent>
            {watchLoading ? (
              <Loader2 className="h-6 w-6 animate-spin" />
            ) : (
              <p className="text-2xl font-bold">{stats?.openCount ?? 0}</p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Settled (backtest)</CardTitle>
          </CardHeader>
          <CardContent>
            {watchLoading ? (
              <Loader2 className="h-6 w-6 animate-spin" />
            ) : (
              <p className="text-2xl font-bold">{stats?.settledCount ?? 0}</p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Win rate</CardTitle>
          </CardHeader>
          <CardContent>
            {watchLoading ? (
              <Loader2 className="h-6 w-6 animate-spin" />
            ) : (
              <p className="text-2xl font-bold">
                {stats?.winRatePct != null ? `${stats.winRatePct}%` : "—"}
              </p>
            )}
            <p className="text-xs text-muted-foreground">
              Loss rate: {stats?.lossRatePct != null ? `${stats.lossRatePct}%` : "—"}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total settled P/L</CardTitle>
          </CardHeader>
          <CardContent>
            {watchLoading ? (
              <Loader2 className="h-6 w-6 animate-spin" />
            ) : (
              <p
                className={`text-2xl font-bold ${
                  (stats?.totalSettlementPnl ?? 0) >= 0 ? "text-green-600" : "text-red-600"
                }`}
              >
                ${(stats?.totalSettlementPnl ?? 0).toFixed(2)}
              </p>
            )}
            <p className="text-xs text-muted-foreground">
              Wins {stats?.wins ?? 0} · Losses {stats?.losses ?? 0}
              {(stats?.breakevens ?? 0) > 0 ? ` · BE ${stats?.breakevens}` : ""}
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="text-base">Self-improving insights</CardTitle>
            <Badge variant="outline">{readinessLabel}</Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            Learns from your settled watchlist outcomes vs context captured at save time (framework
            pillars, earnings, backtest edge, POP). Not financial advice — use to tighten your own
            rules.
          </p>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {watchLoading && <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />}
          {!watchLoading && learning && (
            <>
              <p className="text-muted-foreground">
                Baseline:{" "}
                <span className="font-medium text-foreground">
                  {learning.baselineWinRatePct}% win
                </span>{" "}
                · avg P/L ${learning.baselineAvgPnl.toFixed(2)} on {learning.settledCount}{" "}
                settlement(s)
              </p>
              {learning.suggestions.length > 0 && (
                <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
                  {learning.suggestions.map((s) => (
                    <li key={s}>{s}</li>
                  ))}
                </ul>
              )}
              {learning.buckets.length > 0 && (
                <div className="overflow-x-auto rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Pattern</TableHead>
                        <TableHead className="text-right">n</TableHead>
                        <TableHead className="text-right">Win %</TableHead>
                        <TableHead className="text-right">vs base</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {learning.buckets.slice(0, 6).map((b) => (
                        <TableRow key={b.key}>
                          <TableCell className="max-w-[200px] text-xs">{b.label}</TableCell>
                          <TableCell className="text-right tabular-nums">{b.sampleSize}</TableCell>
                          <TableCell className="text-right tabular-nums">{b.winRatePct}%</TableCell>
                          <TableCell
                            className={`text-right tabular-nums ${
                              b.deltaWinRatePct > 0
                                ? "text-green-600"
                                : b.deltaWinRatePct < 0
                                  ? "text-red-600"
                                  : ""
                            }`}
                          >
                            {b.deltaWinRatePct > 0 ? "+" : ""}
                            {b.deltaWinRatePct}%
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="text-base">Is the self-improvement actually working?</CardTitle>
            {evaluation && (
              <Badge variant="outline" className={verdictConfig[evaluation.verdict].cls}>
                {verdictConfig[evaluation.verdict].label}
              </Badge>
            )}
          </div>
          <p className="text-sm text-muted-foreground">
            Walk-forward test: each settled trade is predicted using only trades that settled{" "}
            <em>before</em> it, then compared to reality. Brier score = prediction error (lower is
            better); the learned model must beat your plain base win rate to add value.
          </p>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {watchLoading && <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />}
          {!watchLoading && evaluation && !evaluation.ready && (
            <p className="text-muted-foreground">
              {evaluation.notes[0] ??
                `Need ≥ ${evaluation.minRequired} settled win/loss trades to measure accuracy.`}
            </p>
          )}
          {!watchLoading && evaluation && evaluation.ready && (
            <>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <div className="rounded-md border p-3">
                  <p className="text-xs text-muted-foreground">Actual win rate</p>
                  <p className="text-xl font-bold">{evaluation.actualWinRatePct}%</p>
                  <p className="text-xs text-muted-foreground">{evaluation.evaluated} scored</p>
                </div>
                <div className="rounded-md border p-3">
                  <p className="text-xs text-muted-foreground">Predicted (learned)</p>
                  <p className="text-xl font-bold">{evaluation.predictedWinRatePctLearned}%</p>
                  <p className="text-xs text-muted-foreground">
                    miss {Math.abs(evaluation.predictedWinRatePctLearned - evaluation.actualWinRatePct).toFixed(1)} pts
                  </p>
                </div>
                <div className="rounded-md border p-3">
                  <p className="text-xs text-muted-foreground">Brier (learned vs base-rate)</p>
                  <p className="text-xl font-bold tabular-nums">
                    {evaluation.brierLearned}{" "}
                    <span className="text-sm font-normal text-muted-foreground">
                      / {evaluation.brierBaseRate}
                    </span>
                  </p>
                  <p
                    className={`text-xs ${
                      evaluation.brierImprovementVsBaseRate > 0
                        ? "text-green-600"
                        : evaluation.brierImprovementVsBaseRate < 0
                          ? "text-red-600"
                          : "text-muted-foreground"
                    }`}
                  >
                    {evaluation.brierImprovementVsBaseRate > 0 ? "better by " : "worse by "}
                    {Math.abs(evaluation.brierImprovementVsBaseRate)}
                  </p>
                </div>
                <div className="rounded-md border p-3">
                  <p className="text-xs text-muted-foreground">Ranking (AUC)</p>
                  <p className="text-xl font-bold tabular-nums">
                    {evaluation.aucLearned ?? "—"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {evaluation.aucPop != null ? `POP ${evaluation.aucPop}` : "0.5 = coin flip"}
                  </p>
                </div>
              </div>

              {evaluation.notes.length > 0 && (
                <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
                  {evaluation.notes.map((n) => (
                    <li key={n}>{n}</li>
                  ))}
                </ul>
              )}

              {evaluation.history.length >= 2 && (
                <div>
                  <p className="mb-1 text-xs font-medium text-muted-foreground">
                    Accuracy as trades settle — predicted (learned) should converge toward actual win
                    rate
                  </p>
                  <div className="h-56 w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart
                        data={evaluation.history}
                        margin={{ top: 8, right: 12, bottom: 4, left: -8 }}
                      >
                        <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                        <XAxis
                          dataKey="atSettled"
                          tick={{ fontSize: 11 }}
                          label={{ value: "settled trades", position: "insideBottom", offset: -2, fontSize: 10 }}
                        />
                        <YAxis tick={{ fontSize: 11 }} domain={[0, 100]} unit="%" width={44} />
                        <RechartsTooltip
                          contentStyle={{ fontSize: 12 }}
                          formatter={(v: number, name: string) => [`${v}%`, name]}
                          labelFormatter={(l) => `After ${l} settled`}
                        />
                        <Legend wrapperStyle={{ fontSize: 11 }} />
                        <Line
                          type="monotone"
                          dataKey="actualWinRatePct"
                          name="Actual win rate"
                          stroke="#16a34a"
                          strokeWidth={2}
                          dot={false}
                        />
                        <Line
                          type="monotone"
                          dataKey="predictedWinRatePctLearned"
                          name="Predicted (learned)"
                          stroke="#2563eb"
                          strokeWidth={2}
                          strokeDasharray="5 3"
                          dot={false}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Brier improvement now:{" "}
                    <span
                      className={
                        evaluation.brierImprovementVsBaseRate > 0
                          ? "text-green-600"
                          : evaluation.brierImprovementVsBaseRate < 0
                            ? "text-red-600"
                            : ""
                      }
                    >
                      {evaluation.brierImprovementVsBaseRate > 0 ? "+" : ""}
                      {evaluation.brierImprovementVsBaseRate}
                    </span>{" "}
                    vs base-rate (positive = learning helps). Updates automatically each time a trade
                    settles.
                  </p>
                </div>
              )}

              {evaluation.calibration.length > 0 && (
                <div className="overflow-x-auto rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Predicted band</TableHead>
                        <TableHead className="text-right">Avg predicted</TableHead>
                        <TableHead className="text-right">Actual</TableHead>
                        <TableHead className="text-right">n</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {evaluation.calibration.map((c) => (
                        <TableRow key={c.bucket}>
                          <TableCell className="text-xs">{c.bucket}</TableCell>
                          <TableCell className="text-right tabular-nums">{c.predictedPct}%</TableCell>
                          <TableCell className="text-right tabular-nums">{c.actualPct}%</TableCell>
                          <TableCell className="text-right tabular-nums">{c.n}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Saved trade ideas</CardTitle>
          <p className="text-sm text-muted-foreground">
            <strong className="font-medium text-foreground">Credit</strong> comes from the trade idea
            when you add a row — edit it if your real fill differed.{" "}
            <strong className="font-medium text-foreground">Spot</strong> (what-if) is a pretend
            stock price at expiry to preview P/L; it does not save.{" "}
            <strong className="font-medium text-foreground">Settle $</strong> is the real closing
            price of the <em>stock</em> at expiry (or leave blank and use refresh for Yahoo&apos;s
            close). <strong className="font-medium text-foreground">P/L</strong> is each leg&apos;s
            intrinsic value at that stock price minus what you paid/received on the legs (× 100 per
            contract), using your saved (or edited) premiums.
          </p>
        </CardHeader>
        <CardContent>
          {watchLoading && (
            <div className="flex justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          )}
          {!watchLoading && items.length === 0 && (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No ideas yet. Add from Top ideas or Analysis → Trade ideas.
            </p>
          )}
          {!watchLoading && items.length > 0 && (
            <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Symbol</TableHead>
                  <TableHead>Strategy</TableHead>
                  <TableHead>Expiry</TableHead>
                  <TableHead className="text-right">Credit</TableHead>
                  <TableHead className="text-right">Entry spot</TableHead>
                  <TableHead className="text-right">Settlement</TableHead>
                  <TableHead className="text-right">P/L @ expiry</TableHead>
                  <TableHead>Result</TableHead>
                  <TableHead className="text-right">What-if</TableHead>
                  <TableHead className="w-[100px]" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((row) => {
                  const idea = row.ideaJson as unknown as TradeIdea;
                  const settled = row.settlementPnl != null;
                  const pnl = settled ? Number(row.settlementPnl) : null;
                  return (
                    <TableRow key={row.id}>
                      <TableCell className="font-medium">{row.symbol}</TableCell>
                      <TableCell>
                        <Badge variant="secondary">{idea?.strategyName || row.strategy}</Badge>
                      </TableCell>
                      <TableCell className="text-sm">{row.expirationDate}</TableCell>
                      <TableCell className="text-right">
                        <WatchlistCreditCell
                          rowId={row.id}
                          entryPrice={Number(idea?.entryPrice ?? 0)}
                          settled={settled}
                        />
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        ${Number(row.entryUnderlyingPrice).toFixed(2)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {row.settlementUnderlying != null
                          ? `$${Number(row.settlementUnderlying).toFixed(2)}`
                          : "—"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {pnl != null ? (
                          <span className={pnl >= 0 ? "text-green-600" : "text-red-600"}>
                            ${pnl.toFixed(2)}
                          </span>
                        ) : (
                          "—"
                        )}
                      </TableCell>
                      <TableCell>
                        {row.outcome === "win" && (
                          <Badge className="gap-1 bg-green-600">
                            <TrendingUp className="h-3 w-3" /> Win
                          </Badge>
                        )}
                        {row.outcome === "loss" && (
                          <Badge variant="destructive" className="gap-1">
                            <TrendingDown className="h-3 w-3" /> Loss
                          </Badge>
                        )}
                        {row.outcome === "breakeven" && (
                          <Badge variant="secondary" className="gap-1">
                            <Minus className="h-3 w-3" /> BE
                          </Badge>
                        )}
                        {!row.outcome && "—"}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center justify-end gap-1">
                          <Input
                            className={`${watchlistInputClass} w-20`}
                            placeholder="Spot"
                            value={simPrice[row.id] ?? ""}
                            onChange={(e) =>
                              setSimPrice((s) => ({ ...s, [row.id]: e.target.value }))
                            }
                          />
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-8 px-2"
                            disabled={simulateMut.isPending}
                            onClick={() => {
                              const v = parseFloat(simPrice[row.id] || "");
                              if (!v || v <= 0) return;
                              simulateMut.mutate({ id: row.id, underlyingPrice: v });
                            }}
                          >
                            <Calculator className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex flex-wrap justify-end gap-1">
                          {!settled && (
                            <>
                              <Input
                                className={`${watchlistInputClass} w-[4.5rem]`}
                                placeholder="Settle $"
                                value={settlePrice[row.id] ?? ""}
                                onChange={(e) =>
                                  setSettlePrice((s) => ({ ...s, [row.id]: e.target.value }))
                                }
                              />
                              <Button
                                variant="outline"
                                size="sm"
                                disabled={settleMut.isPending}
                                onClick={() => {
                                  const v = parseFloat(settlePrice[row.id] || "");
                                  settleMut.mutate({
                                    id: row.id,
                                    underlyingPrice: v > 0 ? v : undefined,
                                  });
                                }}
                                title="Yahoo close on/before expiry, or use Settle $ if filled"
                              >
                                <RefreshCw className="h-3.5 w-3.5" />
                              </Button>
                            </>
                          )}
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-destructive"
                            onClick={() => deleteMut.mutate(row.id)}
                            disabled={deleteMut.isPending}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
