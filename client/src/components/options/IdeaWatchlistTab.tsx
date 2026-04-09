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
} from "lucide-react";
import type { TradeIdea } from "@shared/optionsSchema";
import type { OptionsWatchlistRow } from "@shared/schema";
import { apiRequest } from "@/lib/queryClient";
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

export async function addIdeaToWatchlist(symbol: string, idea: TradeIdea) {
  if (!Number.isFinite(idea.underlyingPrice) || idea.underlyingPrice <= 0) {
    throw new Error(
      "This idea has an invalid underlying price. Refresh or re-run analysis, then add again.",
    );
  }
  const res = await apiRequest("POST", "/api/options/watchlist", { symbol, idea });
  return res.json() as Promise<{ item: OptionsWatchlistRow }>;
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
  } = useQuery<{ stats: WatchlistStats; list: { items: OptionsWatchlistRow[] } }>({
    queryKey: ["/api/options/watchlist", "bundle"],
    queryFn: async () => {
      const [statsRes, listRes] = await Promise.all([
        apiRequest("GET", "/api/options/watchlist/stats"),
        apiRequest("GET", "/api/options/watchlist"),
      ]);
      const [stats, list] = await Promise.all([statsRes.json(), listRes.json()]);
      return { stats, list };
    },
  });
  const stats = watchData?.stats;
  const listData = watchData?.list;

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
        <CardHeader>
          <CardTitle className="text-base">Saved trade ideas</CardTitle>
          <p className="text-sm text-muted-foreground">
            Settle uses the underlying close on or before expiration from Yahoo (or enter a price).
            P/L is intrinsic value at expiry vs your entry premiums (per contract × 100).
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
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Symbol</TableHead>
                  <TableHead>Strategy</TableHead>
                  <TableHead>Expiry</TableHead>
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
                            className="h-8 w-20 text-right text-xs"
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
                                className="h-8 w-[4.5rem] text-right text-xs"
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
          )}
        </CardContent>
      </Card>
    </div>
  );
}
