import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  BarChart2,
  Loader2,
  RefreshCcw,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  Info,
} from "lucide-react";
import { fetchApi } from "@/lib/queryClient";
import type { BacktestTop20Response, BacktestSymbolResult } from "@shared/optionsSchema";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const STRATEGY_OPTIONS = [
  { value: "put_credit_spread", label: "Put Credit Spread" },
  { value: "call_credit_spread", label: "Call Credit Spread" },
  { value: "iron_condor", label: "Iron Condor" },
];

const YEARS_OPTIONS = [
  { value: "2", label: "2 years" },
  { value: "3", label: "3 years" },
  { value: "5", label: "5 years" },
];

function edgeBadge(edge: BacktestSymbolResult["historicalEdge"]): JSX.Element {
  const map: Record<
    BacktestSymbolResult["historicalEdge"],
    { label: string; cls: string }
  > = {
    strong: { label: "Strong edge", cls: "border-green-400 bg-green-500/15 text-green-700" },
    positive: { label: "Positive", cls: "border-emerald-300 bg-emerald-500/10 text-emerald-700" },
    flat: { label: "Flat / small sample", cls: "border-slate-300 bg-slate-500/10 text-slate-600" },
    negative: { label: "Negative", cls: "border-red-400 bg-red-500/15 text-red-700" },
  };
  const { label, cls } = map[edge];
  return (
    <Badge variant="outline" className={`text-[10px] ${cls}`}>
      {label}
    </Badge>
  );
}

function fmtUsd(n: number): string {
  const sign = n > 0 ? "+" : "";
  return `${sign}$${n.toFixed(0)}`;
}

function fmtPct(n: number): string {
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(1)}%`;
}

export function BacktestTab({
  onAnalyzeSymbol,
}: Readonly<{
  onAnalyzeSymbol?: (symbol: string) => void;
}>) {
  const [strategy, setStrategy] = useState<string>("put_credit_spread");
  const [years, setYears] = useState<string>("3");

  const { data, isLoading, error, refetch, isFetching } = useQuery<BacktestTop20Response>({
    queryKey: ["/api/options/backtest/top20", strategy, years],
    queryFn: async () => {
      const params = new URLSearchParams({
        strategy,
        years,
        limit: "15",
        delta: "30",
        width: "5",
        tp: "50",
        freq: "5",
      });
      const url = `/api/options/backtest/top20?${params.toString()}`;

      // Abort after 4 minutes — Render's default HTTP timeout is 100s so this
      // is just a client-side safety net to surface a clean error rather than
      // a browser-specific "load failed" message.
      const ctrl = new AbortController();
      const timeoutId = setTimeout(() => ctrl.abort(), 4 * 60 * 1000);

      let res: Response;
      try {
        res = await fetchApi(url, { signal: ctrl.signal });
      } catch (e) {
        clearTimeout(timeoutId);
        if (ctrl.signal.aborted) {
          throw new Error(
            "Backtest took longer than 4 minutes. The server is probably being rate-limited by Yahoo. Wait a minute and retry, or pick a shorter lookback.",
          );
        }
        const msg = e instanceof Error ? e.message : String(e);
        throw new Error(`Network error calling ${url}: ${msg}`);
      }
      clearTimeout(timeoutId);

      const contentType = res.headers.get("content-type") || "";

      // Handle non-OK responses with full diagnostic info so we never surface
      // a bare browser error ("The string did not match the expected pattern" etc).
      if (!res.ok) {
        let bodyText = "";
        try {
          bodyText = await res.text();
        } catch {
          /* ignore */
        }
        const preview = bodyText.slice(0, 240).replace(/\s+/g, " ").trim();
        throw new Error(
          `Backtest endpoint returned HTTP ${res.status} ${res.statusText}` +
            (preview ? ` — ${preview}` : ""),
        );
      }

      // Make sure we got JSON before trying to parse it. Render/Cloudflare
      // timeouts often produce an HTML error page.
      if (!contentType.toLowerCase().includes("application/json")) {
        let bodyText = "";
        try {
          bodyText = await res.text();
        } catch {
          /* ignore */
        }
        const preview = bodyText.slice(0, 160).replace(/\s+/g, " ").trim();
        throw new Error(
          `Server returned non-JSON response (content-type: ${contentType || "unknown"}). ` +
            `This usually means the request was proxied to an error page or the server crashed. ` +
            (preview ? `Body starts with: ${preview}` : ""),
        );
      }

      try {
        return (await res.json()) as BacktestTop20Response;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        throw new Error(`Got 200 OK but response body isn't valid JSON: ${msg}`);
      }
    },
    staleTime: 60 * 60 * 1000,
    retry: 0,
  });

  const [sortKey, setSortKey] = useState<
    "sharpe" | "winRate" | "totalPnl" | "profitFactor" | "avgPnl"
  >("sharpe");

  const sortedResults = useMemo(() => {
    if (!data?.results) return [];
    return [...data.results].sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      return (bv as number) - (av as number);
    });
  }, [data, sortKey]);

  const bestSymbols = useMemo(() => {
    if (!data?.results) return [];
    return [...data.results]
      .filter((r) => r.historicalEdge === "strong" || r.historicalEdge === "positive")
      .sort((a, b) => b.sharpe - a.sharpe)
      .slice(0, 5);
  }, [data]);

  const worstSymbols = useMemo(() => {
    if (!data?.results) return [];
    return [...data.results]
      .filter((r) => r.historicalEdge === "negative")
      .sort((a, b) => a.totalPnl - b.totalPnl)
      .slice(0, 5);
  }, [data]);

  return (
    <div className="space-y-4">
      {/* Controls */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <BarChart2 className="h-4 w-4 text-primary" />
              Historical Backtest — Top 20 Most-Active
            </CardTitle>
            <div className="flex flex-wrap items-center gap-2">
              <Select value={strategy} onValueChange={setStrategy}>
                <SelectTrigger className="h-9 w-[200px]">
                  <SelectValue placeholder="Strategy" />
                </SelectTrigger>
                <SelectContent>
                  {STRATEGY_OPTIONS.map((s) => (
                    <SelectItem key={s.value} value={s.value}>
                      {s.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={years} onValueChange={setYears}>
                <SelectTrigger className="h-9 w-[140px]">
                  <SelectValue placeholder="Lookback" />
                </SelectTrigger>
                <SelectContent>
                  {YEARS_OPTIONS.map((y) => (
                    <SelectItem key={y.value} value={y.value}>
                      {y.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                variant="outline"
                size="sm"
                onClick={() => refetch()}
                disabled={isFetching}
              >
                {isFetching ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCcw className="mr-2 h-4 w-4" />
                )}
                Run
              </Button>
            </div>
          </div>
          <div className="text-xs text-muted-foreground">
            Simulated walk-forward test: 30-delta short, $5-wide spread, 45 DTE, 50% profit target,
            21 DTE management. Weekly entries. Credits priced via Black-Scholes + trailing 30-day
            realized volatility (no real historical options prices).
          </div>
        </CardHeader>
      </Card>

      {/* Caveats */}
      {data?.methodology && (
        <Card className="border-amber-300/60 bg-amber-50/40 dark:bg-amber-900/10">
          <CardContent className="py-3 text-xs text-amber-900 dark:text-amber-100">
            <div className="mb-1 flex items-center gap-1 font-semibold">
              <AlertTriangle className="h-3.5 w-3.5" />
              Read this before trading on these numbers
            </div>
            <ul className="list-disc space-y-0.5 pl-5">
              {data.methodology.map((m, i) => (
                <li key={i}>{m}</li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* Loading */}
      {isLoading && (
        <Card>
          <CardContent className="flex h-48 flex-col items-center justify-center text-center">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <span className="mt-2 text-sm text-muted-foreground">
              Running {years}-year backtest on top 15 symbols... first run can take 30–90 seconds
              while historical data is fetched; subsequent loads are cached for 24h.
            </span>
          </CardContent>
        </Card>
      )}

      {error && (
        <Card className="border-destructive">
          <CardContent className="flex items-start gap-2 py-4 text-destructive">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
            <div className="flex-1 space-y-1.5">
              <div className="font-semibold">Backtest failed to load</div>
              <div className="text-sm">{(error as Error).message}</div>
              <div className="text-xs text-muted-foreground">
                Common causes: (1) Yahoo Finance rate-limiting the server IP — wait ~60s and retry.
                (2) Cold-start timeout on free hosting — first request after idle can time out; retry
                should succeed. (3) If the error keeps happening, try a 2-year lookback first.
              </div>
              <Button size="sm" variant="outline" onClick={() => refetch()} className="mt-1">
                <RefreshCcw className="mr-2 h-3.5 w-3.5" />
                Retry
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Summary */}
      {data && !isLoading && (
        <>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Summary</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
                <StatBlock
                  label="Total trades"
                  value={data.summary.totalTrades.toLocaleString()}
                  hint={`${data.results.length} symbols × ~${Math.round(
                    data.summary.totalTrades / Math.max(1, data.results.length),
                  )} trades avg`}
                />
                <StatBlock
                  label="Aggregate win rate"
                  value={`${data.summary.aggregateWinRate.toFixed(1)}%`}
                  hint={data.summary.aggregateWinRate >= 70 ? "Healthy" : "Watch"}
                  tone={data.summary.aggregateWinRate >= 70 ? "good" : "neutral"}
                />
                <StatBlock
                  label="Avg $ per trade"
                  value={fmtUsd(data.summary.aggregateAvgPnl)}
                  tone={data.summary.aggregateAvgPnl > 0 ? "good" : "bad"}
                />
                <StatBlock
                  label="Total simulated P&L"
                  value={fmtUsd(data.summary.aggregateTotalPnl)}
                  tone={data.summary.aggregateTotalPnl > 0 ? "good" : "bad"}
                />
                <StatBlock
                  label="Symbols with edge"
                  value={`${data.summary.symbolsWithPositiveEdge} / ${data.results.length}`}
                  hint={`${data.summary.symbolsWithNegativeEdge} negative`}
                />
                <StatBlock
                  label="SPY buy & hold"
                  value={
                    data.summary.benchmarkSpyReturnPct !== null
                      ? fmtPct(data.summary.benchmarkSpyReturnPct)
                      : "—"
                  }
                  hint="same window"
                />
              </div>
            </CardContent>
          </Card>

          {/* Best / Worst */}
          <div className="grid gap-4 lg:grid-cols-2">
            <Card className="border-green-400/40">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <TrendingUp className="h-4 w-4 text-green-600" />
                  Top 5 symbols by historical edge
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-1.5">
                {bestSymbols.length === 0 && (
                  <div className="text-xs text-muted-foreground">
                    No symbol has a statistically meaningful positive edge for this strategy/lookback.
                  </div>
                )}
                {bestSymbols.map((r) => (
                  <div
                    key={r.symbol}
                    className="flex items-center justify-between rounded border bg-background/50 px-2 py-1.5"
                  >
                    <div className="flex items-center gap-2">
                      <span className="font-semibold">{r.symbol}</span>
                      {edgeBadge(r.historicalEdge)}
                    </div>
                    <div className="flex items-center gap-4 text-xs tabular-nums">
                      <span>
                        WR <span className="font-semibold">{r.winRate.toFixed(0)}%</span>
                      </span>
                      <span>
                        Sharpe <span className="font-semibold">{r.sharpe.toFixed(2)}</span>
                      </span>
                      <span
                        className={r.totalPnl > 0 ? "text-green-600" : "text-red-600"}
                      >
                        {fmtUsd(r.totalPnl)}
                      </span>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card className="border-red-400/40">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <TrendingDown className="h-4 w-4 text-red-600" />
                  Avoid: symbols with negative historical edge
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-1.5">
                {worstSymbols.length === 0 && (
                  <div className="text-xs text-muted-foreground">
                    No symbols have a clearly negative edge in this setup.
                  </div>
                )}
                {worstSymbols.map((r) => (
                  <div
                    key={r.symbol}
                    className="flex items-center justify-between rounded border bg-background/50 px-2 py-1.5"
                  >
                    <div className="flex items-center gap-2">
                      <span className="font-semibold">{r.symbol}</span>
                      {edgeBadge(r.historicalEdge)}
                    </div>
                    <div className="flex items-center gap-4 text-xs tabular-nums">
                      <span>
                        WR <span className="font-semibold">{r.winRate.toFixed(0)}%</span>
                      </span>
                      <span className="text-red-600">{fmtUsd(r.totalPnl)}</span>
                      <span className="text-red-600">
                        DD {r.maxDrawdownPct.toFixed(0)}%
                      </span>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>

          {/* Full table */}
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm">Per-symbol breakdown</CardTitle>
                <Select value={sortKey} onValueChange={(v) => setSortKey(v as typeof sortKey)}>
                  <SelectTrigger className="h-8 w-[160px]">
                    <SelectValue placeholder="Sort" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="sharpe">Sort: Sharpe</SelectItem>
                    <SelectItem value="winRate">Sort: Win rate</SelectItem>
                    <SelectItem value="totalPnl">Sort: Total P&L</SelectItem>
                    <SelectItem value="avgPnl">Sort: Avg P&L</SelectItem>
                    <SelectItem value="profitFactor">Sort: Profit factor</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardHeader>
            <CardContent>
              <div className="w-full max-w-full overflow-x-auto rounded-md">
                <Table className="min-w-[1100px] whitespace-nowrap">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Symbol</TableHead>
                      <TableHead>Edge</TableHead>
                      <TableHead className="text-right">Trades</TableHead>
                      <TableHead className="text-right">Win %</TableHead>
                      <TableHead className="text-right">Avg $</TableHead>
                      <TableHead className="text-right">Total $</TableHead>
                      <TableHead className="text-right">PF</TableHead>
                      <TableHead className="text-right">Sharpe</TableHead>
                      <TableHead className="text-right">Max DD</TableHead>
                      <TableHead className="text-right">B&H</TableHead>
                      <TableHead>Earnings split</TableHead>
                      <TableHead>Vol regime</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sortedResults.map((r) => (
                      <TableRow key={r.symbol}>
                        <TableCell className="font-semibold">{r.symbol}</TableCell>
                        <TableCell>{edgeBadge(r.historicalEdge)}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {r.tradesCount}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {r.winRate.toFixed(0)}%
                        </TableCell>
                        <TableCell
                          className={`text-right tabular-nums ${
                            r.avgPnl > 0 ? "text-green-600" : "text-red-600"
                          }`}
                        >
                          {fmtUsd(r.avgPnl)}
                        </TableCell>
                        <TableCell
                          className={`text-right tabular-nums ${
                            r.totalPnl > 0 ? "text-green-600" : "text-red-600"
                          }`}
                        >
                          {fmtUsd(r.totalPnl)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {r.profitFactor.toFixed(2)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {r.sharpe.toFixed(2)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-red-600">
                          -{r.maxDrawdownPct.toFixed(0)}%
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-muted-foreground">
                          {fmtPct(r.buyHoldReturnPct)}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {r.earningsTradeCount > 0 && r.earningsWinRate !== null
                            ? `ER ${r.earningsWinRate.toFixed(0)}% (${r.earningsTradeCount}) · non-ER ${r.nonEarningsWinRate.toFixed(0)}%`
                            : `non-ER ${r.nonEarningsWinRate.toFixed(0)}%`}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {r.highVolWinRate !== null
                            ? `HV ${r.highVolWinRate.toFixed(0)}%`
                            : "HV —"}
                          {" / "}
                          {r.lowVolWinRate !== null
                            ? `LV ${r.lowVolWinRate.toFixed(0)}%`
                            : "LV —"}
                        </TableCell>
                        <TableCell className="text-right">
                          {onAnalyzeSymbol && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => onAnalyzeSymbol(r.symbol)}
                            >
                              Analyze
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                    {sortedResults.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={13} className="py-8 text-center text-sm text-muted-foreground">
                          No backtest results. Try a different strategy or timeframe.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>

          {/* Interpretation guide */}
          <Card className="bg-muted/30">
            <CardContent className="py-3 text-xs text-muted-foreground">
              <div className="mb-1 flex items-center gap-1 font-semibold text-foreground">
                <Info className="h-3.5 w-3.5" />
                How to read this
              </div>
              <ul className="list-disc space-y-0.5 pl-5">
                <li>
                  <strong>Edge = Strong</strong>: win rate ≥75%, profit factor ≥1.5, positive avg PnL.
                  These are the symbols worth considering first for this strategy.
                </li>
                <li>
                  <strong>PF (profit factor)</strong> = gross wins / gross losses. ≥1.5 is solid,
                  &lt;1.0 means the strategy loses money on this symbol.
                </li>
                <li>
                  <strong>Sharpe</strong>: higher = more consistent. &gt;1.0 is good, &gt;2.0 is excellent
                  (and suspicious — double-check sample size).
                </li>
                <li>
                  <strong>Earnings split</strong>: if "ER" win rate is much lower than non-ER, avoid
                  holding through earnings on that symbol.
                </li>
                <li>
                  <strong>Small samples lie.</strong> If trades &lt; 30, don't trust any of these numbers
                  for that symbol.
                </li>
                <li>
                  For a $70k account targeting $10k/year safely: if you size at $500 max loss per
                  trade, you need ~20 net wins per year. At a 75% win rate and $100 avg PnL per
                  contract, you need ~130 trades/year (roughly 10–12 open positions at a time).
                </li>
              </ul>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

function StatBlock({
  label,
  value,
  hint,
  tone = "neutral",
}: Readonly<{
  label: string;
  value: string;
  hint?: string;
  tone?: "good" | "bad" | "neutral";
}>) {
  const toneCls =
    tone === "good"
      ? "text-green-600"
      : tone === "bad"
        ? "text-red-600"
        : "text-foreground";
  return (
    <div className="rounded border bg-background/50 p-2.5">
      <div className="text-[10px] uppercase text-muted-foreground">{label}</div>
      <div className={`text-lg font-semibold tabular-nums ${toneCls}`}>{value}</div>
      {hint && <div className="text-[10px] text-muted-foreground">{hint}</div>}
    </div>
  );
}
