import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertTriangle, TrendingUp, TrendingDown, Activity, Target, Shield, Info } from "lucide-react";
import type { BacktestSymbolResult } from "@shared/optionsSchema";
import { STRATEGY_NAMES } from "@shared/optionsSchema";

interface BacktestSummaryProps {
  symbol: string;
  currentStrategy?: string;
}

// Calculate a composite tradeability score (0-100)
function calculateTradeabilityScore(result: BacktestSymbolResult): number {
  const winRateWeight = 0.4;
  const profitFactorWeight = 0.3;
  const sharpeWeight = 0.2;
  const drawdownWeight = 0.1;

  const winRateScore = Math.min(result.winRate, 100);
  const profitFactorScore = Math.min((result.profitFactor / 2) * 100, 100);
  const sharpeScore = Math.min(((result.sharpe + 1) / 3) * 100, 100);
  const drawdownScore = Math.max(0, 100 - Math.abs(result.maxDrawdownPct));

  return Math.round(
    winRateScore * winRateWeight +
      profitFactorScore * profitFactorWeight +
      sharpeScore * sharpeWeight +
      drawdownScore * drawdownWeight
  );
}

function getScoreColor(score: number): string {
  if (score >= 70) return "bg-emerald-500";
  if (score >= 50) return "bg-yellow-500";
  return "bg-red-500";
}

function getScoreLabel(score: number): string {
  if (score >= 70) return "Strong Edge";
  if (score >= 50) return "Moderate";
  if (score >= 30) return "Weak";
  return "Avoid";
}

function getEdgeColor(edge: BacktestSymbolResult["historicalEdge"]): string {
  switch (edge) {
    case "strong":
      return "bg-emerald-500";
    case "positive":
      return "bg-blue-500";
    case "flat":
      return "bg-yellow-500";
    case "negative":
      return "bg-red-500";
    default:
      return "bg-gray-500";
  }
}

function StatRow({
  label,
  value,
  suffix = "",
  isPositive,
}: {
  label: string;
  value: string | number;
  suffix?: string;
  isPositive?: boolean;
}) {
  return (
    <div className="flex justify-between items-center py-1">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span
        className={`text-sm font-medium ${
          isPositive === true ? "text-emerald-600" : isPositive === false ? "text-red-600" : ""
        }`}
      >
        {value}
        {suffix}
      </span>
    </div>
  );
}

export function BacktestSummary({ symbol, currentStrategy }: BacktestSummaryProps) {
  const { data, isLoading, error } = useQuery<BacktestSymbolResult>({
    queryKey: ["/api/options/backtest", symbol],
    queryFn: async () => {
      const params = new URLSearchParams({
        strategy: currentStrategy || "put_credit_spread",
        years: "2",
        delta: "30",
        width: "5",
        tp: "50",
        freq: "5",
      });
      const res = await fetch(`/api/options/backtest/${symbol}?${params.toString()}`);
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text.slice(0, 200));
      }
      const json = await res.json();
      if (!json.result) throw new Error(json.methodology?.[0] || "No backtest data available");
      return json.result;
    },
    enabled: !!symbol,
    staleTime: 24 * 60 * 60 * 1000, // Cache for 24 hours
    retry: 1,
  });

  if (isLoading) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <Skeleton className="h-5 w-40" />
        </CardHeader>
        <CardContent className="space-y-3">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-3/4" />
        </CardContent>
      </Card>
    );
  }

  if (error || !data) {
    return (
      <Card className="border-yellow-300">
        <CardContent className="flex items-start gap-2 py-4 text-yellow-700">
          <Info className="mt-0.5 h-5 w-5 shrink-0" />
          <div className="text-sm">
            <p className="font-medium">Backtest data unavailable</p>
            <p className="text-muted-foreground">
              {error instanceof Error ? error.message : "Historical performance data not available for this symbol."}
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const score = calculateTradeabilityScore(data);
  const scoreColor = getScoreColor(score);
  const scoreLabel = getScoreLabel(score);

  // Calculate expected value per trade
  const expectedValue = (data.winRate / 100) * data.avgWin + (1 - data.winRate / 100) * data.avgLoss;

  // Position sizing recommendation based on max drawdown
  const positionSize =
    data.maxDrawdownPct < -30 ? 0.5 : data.maxDrawdownPct < -20 ? 0.75 : 1.0;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-base font-semibold">
            <Activity className="h-4 w-4" />
            Historical Performance
          </h3>
          <Badge variant="outline" className="text-xs">
            {STRATEGY_NAMES[data.strategy]}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Tradeability Score */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">Tradeability Score</span>
            <Badge className={`${scoreColor} text-white`}>{scoreLabel}</Badge>
          </div>
          <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
            <div
              className={`h-full ${scoreColor} transition-all`}
              style={{ width: `${Math.max(0, Math.min(100, score))}%` }}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Based on {data.tradesCount} historical trades from {new Date(data.startDate).toLocaleDateString()} to {new Date(data.endDate).toLocaleDateString()}
          </p>
        </div>

        {/* Key Metrics */}
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-lg bg-muted p-3">
            <div className="text-2xl font-bold">{data.winRate.toFixed(1)}%</div>
            <div className="text-xs text-muted-foreground">Win Rate</div>
          </div>
          <div className="rounded-lg bg-muted p-3">
            <div className={`text-2xl font-bold ${data.totalPnl >= 0 ? "text-emerald-600" : "text-red-600"}`}>
              {data.totalPnl >= 0 ? "+" : ""}
              {data.totalPnl.toFixed(0)}
            </div>
            <div className="text-xs text-muted-foreground">Total P&L ($)</div>
          </div>
        </div>

        {/* Detailed Stats */}
        <div className="space-y-1">
          <StatRow label="Profit Factor" value={data.profitFactor.toFixed(2)} />
          <StatRow
            label="Expected Value/Trade"
            value={`$${expectedValue.toFixed(0)}`}
            isPositive={expectedValue > 0}
          />
          <StatRow label="Sharpe Ratio" value={data.sharpe.toFixed(2)} />
          <StatRow
            label="Max Drawdown"
            value={`${data.maxDrawdownPct.toFixed(1)}%`}
            isPositive={false}
          />
          <StatRow label="Avg Win" value={`$${data.avgWin.toFixed(0)}`} isPositive />
          <StatRow label="Avg Loss" value={`$${data.avgLoss.toFixed(0)}`} isPositive={false} />
        </div>

        {/* Regime Analysis */}
        {(data.lowVolWinRate !== null || data.highVolWinRate !== null) && (
          <div className="space-y-2 rounded-lg bg-muted p-3">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Target className="h-4 w-4" />
              Volatility Regime Performance
            </div>
            <div className="grid grid-cols-2 gap-2 text-sm">
              {data.lowVolWinRate !== null && (
                <div>
                  <span className="text-muted-foreground">Low Vol:</span>{" "}
                  <span className={data.lowVolWinRate > 55 ? "text-emerald-600 font-medium" : ""}>
                    {data.lowVolWinRate.toFixed(0)}%
                  </span>
                </div>
              )}
              {data.highVolWinRate !== null && (
                <div>
                  <span className="text-muted-foreground">High Vol:</span>{" "}
                  <span className={data.highVolWinRate > 55 ? "text-emerald-600 font-medium" : ""}>
                    {data.highVolWinRate.toFixed(0)}%
                  </span>
                </div>
              )}
            </div>
            {data.lowVolWinRate !== null &&
              data.lowVolWinRate > data.winRate + 10 && (
                <p className="text-xs text-emerald-700">
                  <TrendingUp className="mr-1 inline h-3 w-3" />
                  Performs significantly better in low-vol environments
                </p>
              )}
            {data.highVolWinRate !== null &&
              data.highVolWinRate > data.winRate + 10 && (
                <p className="text-xs text-emerald-700">
                  <TrendingUp className="mr-1 inline h-3 w-3" />
                  Performs significantly better in high-vol environments
                </p>
              )}
          </div>
        )}

        {/* Earnings Analysis */}
        {data.earningsTradeCount > 0 && (
          <div className="space-y-2 rounded-lg bg-muted p-3">
            <div className="flex items-center gap-2 text-sm font-medium">
              <AlertTriangle className="h-4 w-4" />
              Earnings Period Performance
            </div>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div>
                <span className="text-muted-foreground">Near Earnings:</span>{" "}
                <span className={data.earningsWinRate! > 55 ? "text-emerald-600 font-medium" : ""}>
                  {data.earningsWinRate?.toFixed(0) ?? 0}% ({data.earningsTradeCount} trades)
                </span>
              </div>
              <div>
                <span className="text-muted-foreground">Non-Earnings:</span>{" "}
                <span className={data.nonEarningsWinRate > 55 ? "text-emerald-600 font-medium" : ""}>
                  {data.nonEarningsWinRate.toFixed(0)}% ({data.nonEarningsTradeCount} trades)
                </span>
              </div>
            </div>
            {data.earningsWinRate !== null && data.earningsWinRate < data.nonEarningsWinRate - 15 && (
              <p className="text-xs text-red-700">
                <TrendingDown className="mr-1 inline h-3 w-3" />
                Avoid earnings — historical win rate drops significantly
              </p>
            )}
          </div>
        )}

        {/* Position Sizing Warning */}
        {positionSize < 1 && (
          <div className="flex items-start gap-2 rounded-lg border border-yellow-300 bg-yellow-500/10 p-3 text-yellow-800">
            <Shield className="mt-0.5 h-4 w-4 shrink-0" />
            <div className="text-sm">
              <p className="font-medium">Position Size Warning</p>
              <p className="text-xs">
                This symbol has experienced {Math.abs(data.maxDrawdownPct).toFixed(0)}% drawdowns. Consider{" "}
                {positionSize === 0.5 ? "half" : "reduced"} position sizes.
              </p>
            </div>
          </div>
        )}

        {/* Recommendation */}
        <div className="flex items-center gap-2 rounded-lg bg-muted p-3">
          <div className={`h-3 w-3 rounded-full ${getEdgeColor(data.historicalEdge)}`} />
          <div className="text-sm">
            <span className="font-medium">Historical Edge: </span>
            <span className="capitalize">{data.historicalEdge.replace("_", " ")}</span>
            {data.historicalEdge === "strong" && (
              <span className="text-xs text-muted-foreground block">
                Strong historical performance — good candidate for this strategy
              </span>
            )}
            {data.historicalEdge === "negative" && (
              <span className="text-xs text-muted-foreground block">
                Historical underperformer — consider a different strategy or symbol
              </span>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
