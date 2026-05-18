import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ArrowUpRight,
  Loader2,
  ListPlus,
  RefreshCcw,
  Shield,
  Activity,
  AlertTriangle,
  TrendingDown,
  TrendingUp,
  Filter,
} from "lucide-react";
import { addIdeaToWatchlist } from "@/components/options/IdeaWatchlistTab";
import { fetchApi } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { TopOptionTradeIdea, BacktestSymbolResult } from "@shared/optionsSchema";
import { STRATEGY_NAMES } from "@shared/optionsSchema";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

function fmtPct(n: number): string {
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(2)}%`;
}

// Calculate expected value based on historical performance
function calculateExpectedValue(backtest: BacktestSymbolResult | undefined): number | null {
  if (!backtest) return null;
  return (backtest.winRate / 100) * backtest.avgWin + (1 - backtest.winRate / 100) * backtest.avgLoss;
}

// Calculate tradeability score (0-100)
function calculateTradeabilityScore(backtest: BacktestSymbolResult | undefined): number | null {
  if (!backtest) return null;
  const winRateWeight = 0.4;
  const profitFactorWeight = 0.3;
  const sharpeWeight = 0.2;
  const drawdownWeight = 0.1;

  const winRateScore = Math.min(backtest.winRate, 100);
  const profitFactorScore = Math.min((backtest.profitFactor / 2) * 100, 100);
  const sharpeScore = Math.min(((backtest.sharpe + 1) / 3) * 100, 100);
  const drawdownScore = Math.max(0, 100 - Math.abs(backtest.maxDrawdownPct));

  return Math.round(
    winRateScore * winRateWeight +
      profitFactorScore * profitFactorWeight +
      sharpeScore * sharpeWeight +
      drawdownScore * drawdownWeight,
  );
}

// Get position sizing recommendation based on historical drawdown
function getPositionSize(backtest: BacktestSymbolResult | undefined): number {
  if (!backtest) return 1;
  if (backtest.maxDrawdownPct < -30) return 0.5;
  if (backtest.maxDrawdownPct < -20) return 0.75;
  return 1;
}

export function TopTradeIdeasTab({
  onAnalyzeSymbol,
}: Readonly<{
  onAnalyzeSymbol: (symbol: string) => void;
}>) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [filterByEdge, setFilterByEdge] = useState(true);
  const [hideNegativeEdge, setHideNegativeEdge] = useState(true);

  const addWatchMut = useMutation({
    mutationFn: async (row: TopOptionTradeIdea) => addIdeaToWatchlist(row.symbol, row.idea),
    onSuccess: () => {
      toast({ title: "Added to watchlist" });
      queryClient.invalidateQueries({ queryKey: ["/api/options/watchlist"] });
    },
    onError: (e: Error) => {
      toast({
        title: "Could not add",
        description: e.message,
        variant: "destructive",
      });
    },
  });

  const { data, isLoading, error, refetch, isFetching } = useQuery<TopOptionTradeIdea[]>({
    queryKey: ["/api/options/top-ideas", 20],
    queryFn: async () => {
      const res = await fetchApi(
        `/api/options/top-ideas?limit=20&universe=120&minPop=55&minLiq=15&allowEarnings=true`,
      );
      const contentType = res.headers.get("content-type") || "";
      if (!res.ok) throw new Error("Failed to fetch top ideas");
      if (!contentType.toLowerCase().includes("application/json")) {
        const text = await res.text();
        throw new Error(
          `API returned non-JSON (got "${contentType || "unknown"}"). ` +
            `This usually means the server isn't running/restarted. ` +
            `Response starts with: ${text.slice(0, 80)}`
        );
      }
      const body = await res.json();
      return Array.isArray(body) ? body : [];
    },
    staleTime: 60 * 1000,
    refetchInterval: 60 * 1000,
    retry: 1,
  });

  // Defense in depth if cache ever holds a non-array.
  const ideasList = useMemo(() => (Array.isArray(data) ? data : []), [data]);

  // Fetch backtest data for the exact symbols shown in the ideas list
  const symbols = useMemo(() => ideasList.map((d) => d.symbol.toUpperCase()), [ideasList]);
  const symbolsKey = useMemo(() => symbols.slice().sort().join(","), [symbols]);

  const { data: backtestData, isLoading: backtestLoading } = useQuery<BacktestSymbolResult[]>({
    queryKey: ["/api/options/backtest/top20", symbolsKey],
    queryFn: async () => {
      if (symbols.length === 0) return [];
      const params = new URLSearchParams({
        symbols: symbols.join(","), // Pass the exact symbols we need
        strategy: "put_credit_spread",
        years: "2",
        delta: "30",
        width: "5",
        tp: "50",
        freq: "5",
      });
      const res = await fetchApi(`/api/options/backtest/top20?${params.toString()}`);
      if (!res.ok) {
        // If backtest fails, return empty array so we can still show ideas
        return [];
      }
      const json = await res.json();
      return Array.isArray(json?.results) ? (json.results as BacktestSymbolResult[]) : [];
    },
    enabled: symbols.length > 0,
    staleTime: 24 * 60 * 60 * 1000, // Cache for 24 hours
    retry: 0,
  });

  // Create a lookup map for backtest data
  const backtestMap = useMemo(() => {
    const map = new Map<string, BacktestSymbolResult>();
    backtestData?.forEach((result) => {
      map.set(result.symbol.toUpperCase(), result);
    });
    return map;
  }, [backtestData]);

  // Sort/filter data based on backtest results
  const processedData = useMemo(() => {
    if (!ideasList.length) return [];

    // First, filter out only the explicitly bad ones if that toggle is on
    let filtered = ideasList.filter((row) => {
      const backtest = backtestMap.get(row.symbol.toUpperCase());
      // Only hide if we have data showing it's a historical loser
      if (hideNegativeEdge && backtest?.historicalEdge === "negative") return false;
      return true;
    });

    // Then, sort by edge quality if prioritization is on
    if (filterByEdge) {
      filtered = [...filtered].sort((a, b) => {
        const backtestA = backtestMap.get(a.symbol.toUpperCase());
        const backtestB = backtestMap.get(b.symbol.toUpperCase());

        const edgeOrder: Record<string, number> = { strong: 0, positive: 1, flat: 2, negative: 3 };
        const edgeA = backtestA?.historicalEdge != null ? (edgeOrder[backtestA.historicalEdge] ?? 4) : 4;
        const edgeB = backtestB?.historicalEdge != null ? (edgeOrder[backtestB.historicalEdge] ?? 4) : 4;

        // If edges are equal, sort by tradeability score
        if (edgeA === edgeB) {
          const scoreA = calculateTradeabilityScore(backtestA) || 0;
          const scoreB = calculateTradeabilityScore(backtestB) || 0;
          return scoreB - scoreA;
        }

        return edgeA - edgeB;
      });
    }

    return filtered;
  }, [ideasList, backtestMap, filterByEdge, hideNegativeEdge]);

  const updatedAt = useMemo(() => {
    const ts = ideasList[0]?.updatedAt;
    return ts ? new Date(ts) : null;
  }, [ideasList]);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Shield className="h-4 w-4 text-primary" />
              Top credit ideas (most active)
            </CardTitle>
            <div className="flex items-center gap-2">
              {updatedAt && (
                <span className="text-xs text-muted-foreground">
                  Updated {updatedAt.toLocaleTimeString()}
                </span>
              )}
              <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
                {isFetching ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCcw className="mr-2 h-4 w-4" />
                )}
                Refresh
              </Button>
            </div>
          </div>
          <div className="text-xs text-muted-foreground">
            Ranked from Yahoo Finance "most actives", then filtered to defined-risk credit trades with POP ≥ 60%
            and decent options liquidity. <strong>Historical edge filtering</strong> prioritizes symbols with proven
            backtest performance.
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-4 rounded-lg bg-muted p-3">
            <div className="flex items-center gap-2">
              <Filter className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium">Filters:</span>
            </div>
            <div className="flex items-center gap-2">
              <Switch
                id="filter-edge"
                checked={filterByEdge}
                onCheckedChange={setFilterByEdge}
              />
              <Label htmlFor="filter-edge" className="text-sm cursor-pointer">
                Prioritize proven edge
              </Label>
            </div>
            <div className="flex items-center gap-2">
              <Switch
                id="hide-negative"
                checked={hideNegativeEdge}
                onCheckedChange={setHideNegativeEdge}
              />
              <Label htmlFor="hide-negative" className="text-sm cursor-pointer">
                Hide historical losers
              </Label>
            </div>
            <div className="ml-auto flex items-center gap-2">
              {backtestLoading && (
                <Badge variant="outline" className="flex items-center gap-1">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Loading history...
                </Badge>
              )}
              {!backtestLoading && backtestData && backtestData.length > 0 && (
                <Badge variant="outline" className="text-emerald-600 border-emerald-300">
                  {backtestData.length} with backtest
                </Badge>
              )}
              {hideNegativeEdge && processedData.length < ideasList.length && (
                <Badge variant="secondary">
                  {processedData.length} of {ideasList.length}
                </Badge>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading && (
            <div className="flex h-48 items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
              <span className="ml-2 text-sm text-muted-foreground">Building ideas…</span>
            </div>
          )}

          {error && (
            <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
              Failed to load ideas. Try refresh.
            </div>
          )}

          {!isLoading && !error && (
            <div
              className="w-full max-w-full overflow-x-auto overscroll-x-contain rounded-md"
              style={{ WebkitOverflowScrolling: "touch" }}
            >
              <Table className="min-w-[1400px] whitespace-nowrap">
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[56px]">Rank</TableHead>
                    <TableHead>Symbol</TableHead>
                    <TableHead className="text-right">Price</TableHead>
                    <TableHead>Strategy</TableHead>
                    <TableHead>Setup</TableHead>
                    <TableHead className="text-right">Hist Win%</TableHead>
                    <TableHead className="text-right">Exp Value</TableHead>
                    <TableHead>Edge</TableHead>
                    <TableHead>RSI</TableHead>
                    <TableHead>Earnings</TableHead>
                    <TableHead className="text-right">Score</TableHead>
                    <TableHead className="text-right">POP</TableHead>
                    <TableHead className="text-right">Credit</TableHead>
                    <TableHead className="text-right">Max loss</TableHead>
                    <TableHead className="text-right">Chg</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {processedData.map((row, idx) => {
                    const idea = row.idea;
                    const credit = idea.entryPrice * 100;
                    const earningsText = idea.earningsDate ? idea.earningsDate : "—";
                    const setup =
                      idea.strategy === "iron_condor"
                        ? `${idea.legs.find((l) => l.type === "put" && l.action === "sell")?.strike} / ${
                            idea.legs.find((l) => l.type === "call" && l.action === "sell")?.strike
                          }`
                        : `${idea.legs.find((l) => l.action === "sell")?.strike} - ${
                            idea.legs.find((l) => l.action === "buy")?.strike
                          }`;
                    const backtest = backtestMap.get(row.symbol.toUpperCase());
                    const expectedValue = calculateExpectedValue(backtest);
                    const tradeabilityScore = calculateTradeabilityScore(backtest);
                    const positionSize = getPositionSize(backtest);

                    return (
                      <TableRow key={`${row.symbol}-${idea.id}`}>
                        <TableCell className="text-muted-foreground">{idx + 1}</TableCell>
                        <TableCell>
                          <div className="flex flex-col">
                            <div className="flex items-center gap-2">
                              <span className="font-semibold">{row.symbol}</span>
                              <Badge variant="secondary" className="text-[10px]">
                                Liq {row.liquidityScore}
                              </Badge>
                              {positionSize < 1 && (
                                <TooltipProvider>
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <AlertTriangle className="h-3.5 w-3.5 text-yellow-500" />
                                    </TooltipTrigger>
                                    <TooltipContent>
                                      <p className="max-w-xs text-xs">
                                        High historical drawdown ({backtest?.maxDrawdownPct.toFixed(0)}%).
                                        Consider {positionSize === 0.5 ? "half" : "reduced"} position size.
                                      </p>
                                    </TooltipContent>
                                  </Tooltip>
                                </TooltipProvider>
                              )}
                            </div>
                            <span className="truncate text-xs text-muted-foreground">{row.name}</span>
                          </div>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">${row.price.toFixed(2)}</TableCell>
                        <TableCell>
                          <Badge variant={idea.recommendation === "strong_buy" ? "default" : "secondary"}>
                            {idea.strategyName}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">{setup}</TableCell>
                        <TableCell className="text-right">
                          {backtest ? (
                            <div className="flex flex-col items-end">
                              <span
                                className={backtest.winRate >= 55 ? "text-emerald-600 font-medium" : ""}
                              >
                                {backtest.winRate.toFixed(0)}%
                              </span>
                              <span className="text-[10px] text-muted-foreground">
                                {backtest.tradesCount} trades
                              </span>
                            </div>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          {expectedValue !== null ? (
                            <span className={expectedValue > 0 ? "text-emerald-600" : "text-red-600"}>
                              ${expectedValue.toFixed(0)}
                            </span>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell>
                          {backtest ? (
                            <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Badge
                                    variant="outline"
                                    className={`text-[10px] cursor-help ${
                                      backtest.historicalEdge === "strong"
                                        ? "border-emerald-400 text-emerald-600"
                                        : backtest.historicalEdge === "positive"
                                          ? "border-blue-400 text-blue-600"
                                          : backtest.historicalEdge === "negative"
                                            ? "border-red-400 text-red-600"
                                            : "border-yellow-400 text-yellow-600"
                                    }`}
                                  >
                                    {tradeabilityScore || "—"}
                                  </Badge>
                                </TooltipTrigger>
                                <TooltipContent side="top" className="max-w-xs">
                                  <div className="space-y-1 text-xs">
                                    <p className="font-medium">
                                      Historical Edge: {backtest.historicalEdge.replace("_", " ")}
                                    </p>
                                    <p>Win Rate: {backtest.winRate.toFixed(1)}%</p>
                                    <p>Profit Factor: {backtest.profitFactor.toFixed(2)}</p>
                                    <p>Sharpe: {backtest.sharpe.toFixed(2)}</p>
                                    <p>Max DD: {backtest.maxDrawdownPct.toFixed(1)}%</p>
                                  </div>
                                </TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell>
                          {idea.rsiAnalysis ? (
                            <div className="flex items-center gap-1">
                              <Activity
                                className={`h-3 w-3 ${
                                  idea.rsiAnalysis.zone === "oversold"
                                    ? "text-green-500"
                                    : idea.rsiAnalysis.zone === "overbought"
                                      ? "text-red-500"
                                      : "text-blue-500"
                                }`}
                              />
                              <span className="text-sm font-medium">{idea.rsiAnalysis.value.toFixed(0)}</span>
                              {idea.rsiAnalysis.zone !== "neutral" && (
                                <Badge
                                  variant="outline"
                                  className={`text-[10px] ${
                                    idea.rsiAnalysis.zone === "oversold"
                                      ? "border-green-400 text-green-600"
                                      : "border-red-400 text-red-600"
                                  }`}
                                >
                                  {idea.rsiAnalysis.zone === "oversold" ? "Oversold" : "Overbought"}
                                </Badge>
                              )}
                              {idea.rsiAnalysis.confidenceBoost > 0 && (
                                <span className="text-[10px] font-semibold text-green-600">
                                  +{idea.rsiAnalysis.confidenceBoost}%
                                </span>
                              )}
                            </div>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <span className="text-sm text-muted-foreground">{earningsText}</span>
                            {idea.hasEarningsRisk && (
                              <Badge
                                variant="secondary"
                                className="border border-yellow-300 bg-yellow-500/10 text-yellow-700"
                              >
                                Risk
                              </Badge>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-right">
                          <span className="font-semibold">{row.score}</span>
                        </TableCell>
                        <TableCell className="text-right">{idea.probabilityOfProfit.toFixed(0)}%</TableCell>
                        <TableCell className="text-right">${credit.toFixed(0)}</TableCell>
                        <TableCell className="text-right">${idea.maxLoss.toFixed(0)}</TableCell>
                        <TableCell className="text-right">{idea.daysToExpiration}</TableCell>
                        <TableCell
                          className={`text-right ${row.changePercent >= 0 ? "text-green-600" : "text-red-600"}`}
                        >
                          {fmtPct(row.changePercent)}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex flex-wrap justify-end gap-2">
                            <Button
                              type="button"
                              variant="secondary"
                              size="sm"
                              disabled={addWatchMut.isPending}
                              onClick={() => addWatchMut.mutate(row)}
                            >
                              <ListPlus className="mr-1 h-3.5 w-3.5" />
                              Watchlist
                            </Button>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => onAnalyzeSymbol(row.symbol)}
                            >
                              Analyze
                            </Button>
                            <Button asChild variant="ghost" size="icon" className="h-9 w-9">
                              <a
                                href={`https://finance.yahoo.com/quote/${row.symbol}/options`}
                                target="_blank"
                                rel="noreferrer"
                                aria-label="Open on Yahoo Finance"
                              >
                                <ArrowUpRight className="h-4 w-4" />
                              </a>
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

      {/* Email subscription card */}
      <DigestSubscribeCard />
    </div>
  );
}

function DigestSubscribeCard() {
  const { toast } = useToast();
  const [email, setEmail] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSubscribed, setIsSubscribed] = useState(false);

  const handleSubscribe = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;

    setIsSubmitting(true);
    try {
      const res = await fetchApi("/api/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), digestType: "weekly_market" }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: "Failed to subscribe" }));
        throw new Error(err.message);
      }

      setIsSubscribed(true);
      toast({ title: "Subscribed!", description: "You'll receive weekly market updates." });
    } catch (err) {
      toast({
        title: "Could not subscribe",
        description: (err as Error).message,
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isSubscribed) {
    return (
      <Card className="border-green-200 bg-green-50 dark:border-green-900 dark:bg-green-950/30">
        <CardContent className="flex items-center gap-3 py-4">
          <div className="rounded-full bg-green-100 p-2 dark:bg-green-900">
            <Shield className="h-5 w-5 text-green-600 dark:text-green-400" />
          </div>
          <div>
            <p className="font-medium text-green-800 dark:text-green-200">You're subscribed!</p>
            <p className="text-sm text-green-600 dark:text-green-400">
              Weekly digest will be sent to {email}
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Activity className="h-4 w-4 text-primary" />
          Weekly Market Digest
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="mb-4 text-sm text-muted-foreground">
          Get high-conviction backtested ideas + market snapshot delivered to your inbox every Sunday.
        </p>
        <form onSubmit={handleSubscribe} className="flex gap-2">
          <input
            type="email"
            placeholder="Enter your email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            required
          />
          <Button type="submit" disabled={isSubmitting || !email.trim()}>
            {isSubmitting ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : null}
            Subscribe
          </Button>
        </form>
        <p className="mt-2 text-xs text-muted-foreground">
          No spam. Unsubscribe anytime.
        </p>
      </CardContent>
    </Card>
  );
}

