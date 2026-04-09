import { useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowUpRight, Loader2, ListPlus, RefreshCcw, Shield } from "lucide-react";
import { addIdeaToWatchlist } from "@/components/options/IdeaWatchlistTab";
import { fetchApi } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { TopOptionTradeIdea } from "@shared/optionsSchema";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

function fmtPct(n: number): string {
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(2)}%`;
}

export function TopTradeIdeasTab({
  onAnalyzeSymbol,
}: Readonly<{
  onAnalyzeSymbol: (symbol: string) => void;
}>) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

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
      if (!contentType.includes("application/json")) {
        const text = await res.text();
        throw new Error(
          `API returned non-JSON (got "${contentType || "unknown"}"). ` +
            `This usually means the server isn't running/restarted. ` +
            `Response starts with: ${text.slice(0, 80)}`
        );
      }
      return res.json();
    },
    staleTime: 60 * 1000,
    refetchInterval: 60 * 1000,
    retry: 1,
  });

  const updatedAt = useMemo(() => {
    const ts = data?.[0]?.updatedAt;
    return ts ? new Date(ts) : null;
  }, [data]);

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
            Ranked from Yahoo Finance “most actives”, then filtered to defined-risk credit trades with POP ≥ 60%
            and decent options liquidity.
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
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[56px]">Rank</TableHead>
                  <TableHead>Symbol</TableHead>
                  <TableHead className="text-right">Price</TableHead>
                  <TableHead>Strategy</TableHead>
                  <TableHead>Setup</TableHead>
                  <TableHead>Earnings</TableHead>
                  <TableHead className="text-right">Score</TableHead>
                  <TableHead className="text-right">POP</TableHead>
                  <TableHead className="text-right">Credit</TableHead>
                  <TableHead className="text-right">Max loss</TableHead>
                  <TableHead className="text-right">DTE</TableHead>
                  <TableHead className="text-right">Chg</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(data || []).map((row, idx) => {
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
          )}
        </CardContent>
      </Card>
    </div>
  );
}

