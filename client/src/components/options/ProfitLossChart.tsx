import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  Legend,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, DollarSign, TrendingUp, TrendingDown } from "lucide-react";
import type { TradeIdea, PLCalculationResult } from "@shared/optionsSchema";
import { formatCurrency } from "@/lib/formatters";

interface ProfitLossChartProps {
  trade: TradeIdea | null;
  underlyingPrice: number;
}

export function ProfitLossChart({ trade, underlyingPrice }: ProfitLossChartProps) {
  const { data: plData, isLoading } = useQuery<PLCalculationResult>({
    queryKey: ["/api/options/calculate", trade?.id],
    queryFn: async () => {
      if (!trade) throw new Error("No trade selected");

      const res = await fetch("/api/options/calculate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          legs: trade.legs,
          underlyingPrice,
          daysToExpiration: trade.daysToExpiration,
        }),
      });

      if (!res.ok) throw new Error("Failed to calculate P&L");
      return res.json();
    },
    enabled: !!trade,
    staleTime: 30 * 1000,
  });

  const chartData = useMemo(() => {
    if (!plData?.dataPoints) return [];

    return plData.dataPoints.map((point) => ({
      price: point.underlyingPrice,
      profit: point.profit,
      positive: point.profit >= 0 ? point.profit : 0,
      negative: point.profit < 0 ? point.profit : 0,
    }));
  }, [plData]);

  if (!trade) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <DollarSign className="h-5 w-5" />
            Profit/Loss at Expiration
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex h-[300px] items-center justify-center text-muted-foreground">
            Select a trade idea to view P&L chart
          </div>
        </CardContent>
      </Card>
    );
  }

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <DollarSign className="h-5 w-5" />
            Profit/Loss at Expiration
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex h-[300px] items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <DollarSign className="h-5 w-5" />
            {trade.strategyName} P&L
          </CardTitle>
          <div className="flex gap-4 text-sm">
            {plData && (
              <>
                <div className="flex items-center gap-1">
                  <TrendingUp className="h-4 w-4 text-green-500" />
                  <span className="text-muted-foreground">Max:</span>
                  <span className="font-medium text-green-600">
                    ${plData.maxProfit.toFixed(0)}
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  <TrendingDown className="h-4 w-4 text-red-500" />
                  <span className="text-muted-foreground">Max Loss:</span>
                  <span className="font-medium text-red-600">
                    ${Math.abs(plData.maxLoss).toFixed(0)}
                  </span>
                </div>
              </>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={300}>
          <AreaChart data={chartData} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="profitGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#22c55e" stopOpacity={0.4} />
                <stop offset="95%" stopColor="#22c55e" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="lossGradient" x1="0" y1="1" x2="0" y2="0">
                <stop offset="5%" stopColor="#ef4444" stopOpacity={0.4} />
                <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
            <XAxis
              dataKey="price"
              tick={{ fontSize: 12 }}
              tickFormatter={(value) => `$${value.toFixed(0)}`}
              className="text-muted-foreground"
            />
            <YAxis
              tick={{ fontSize: 12 }}
              tickFormatter={(value) => `$${value.toFixed(0)}`}
              className="text-muted-foreground"
            />
            <Tooltip
              contentStyle={{
                backgroundColor: "hsl(var(--card))",
                border: "1px solid hsl(var(--border))",
                borderRadius: "8px",
              }}
              formatter={(value: number) => [`$${value.toFixed(2)}`, "P&L"]}
              labelFormatter={(label) => `Stock at $${label.toFixed(2)}`}
            />
            
            {/* Breakeven lines */}
            {trade.breakeven.map((be, index) => (
              <ReferenceLine
                key={index}
                x={be}
                stroke="#f59e0b"
                strokeDasharray="5 5"
                label={{
                  value: `BE: $${be.toFixed(0)}`,
                  position: "top",
                  fill: "#f59e0b",
                  fontSize: 11,
                }}
              />
            ))}

            {/* Current price line */}
            <ReferenceLine
              x={underlyingPrice}
              stroke="#3b82f6"
              strokeDasharray="3 3"
              label={{
                value: `Current: $${underlyingPrice.toFixed(0)}`,
                position: "insideTopRight",
                fill: "#3b82f6",
                fontSize: 11,
              }}
            />

            {/* Zero line */}
            <ReferenceLine y={0} stroke="hsl(var(--muted-foreground))" />

            {/* Profit area */}
            <Area
              type="monotone"
              dataKey="positive"
              stroke="#22c55e"
              fill="url(#profitGradient)"
              strokeWidth={2}
              name="Profit"
            />

            {/* Loss area */}
            <Area
              type="monotone"
              dataKey="negative"
              stroke="#ef4444"
              fill="url(#lossGradient)"
              strokeWidth={2}
              name="Loss"
            />
          </AreaChart>
        </ResponsiveContainer>

        {/* Greeks Summary */}
        {plData?.greeks && (
          <div className="mt-4 grid grid-cols-4 gap-4 border-t pt-4">
            <div className="text-center">
              <p className="text-xs text-muted-foreground">Delta</p>
              <p className="font-medium">{plData.greeks.delta.toFixed(2)}</p>
            </div>
            <div className="text-center">
              <p className="text-xs text-muted-foreground">Gamma</p>
              <p className="font-medium">{plData.greeks.gamma.toFixed(3)}</p>
            </div>
            <div className="text-center">
              <p className="text-xs text-muted-foreground">Theta</p>
              <p className="font-medium text-red-600">{plData.greeks.theta.toFixed(2)}</p>
            </div>
            <div className="text-center">
              <p className="text-xs text-muted-foreground">Vega</p>
              <p className="font-medium">{plData.greeks.vega.toFixed(2)}</p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
