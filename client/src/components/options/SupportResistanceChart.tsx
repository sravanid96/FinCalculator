import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ComposedChart,
  Area,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { BarChart3, Loader2, ArrowUp, ArrowDown } from "lucide-react";
import { fetchApi } from "@/lib/queryClient";
import type { SupportResistanceLevel, PriceDataPoint } from "@shared/optionsSchema";

interface SupportResistanceChartProps {
  levels: SupportResistanceLevel[];
  currentPrice: number;
  symbol: string;
}

export function SupportResistanceChart({
  levels,
  currentPrice,
  symbol,
}: SupportResistanceChartProps) {
  const { data: historicalData, isLoading } = useQuery<{
    levels: SupportResistanceLevel[];
    currentPrice: number;
    historicalPrices: PriceDataPoint[];
  }>({
    queryKey: ["/api/options/support-resistance", symbol],
    queryFn: async () => {
      const res = await fetchApi(`/api/options/support-resistance/${encodeURIComponent(symbol)}`);
      if (!res.ok) throw new Error("Failed to fetch historical data");
      return res.json();
    },
    enabled: !!symbol,
    staleTime: 5 * 60 * 1000,
  });

  const chartData = useMemo(() => {
    if (!historicalData?.historicalPrices) return [];

    return historicalData.historicalPrices.slice(-90).map((price) => ({
      date: price.date,
      close: price.close,
      high: price.high,
      low: price.low,
    }));
  }, [historicalData]);

  const supports = levels.filter((l) => l.type === "support");
  const resistances = levels.filter((l) => l.type === "resistance");

  const strengthLabel = (strength: number) => {
    if (strength >= 4) return "Strong";
    if (strength >= 3) return "Moderate";
    return "Weak";
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BarChart3 className="h-5 w-5" />
            Support & Resistance Levels
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
            <BarChart3 className="h-5 w-5" />
            Support & Resistance
          </CardTitle>
          <div className="flex gap-2">
            <Badge variant="outline" className="flex items-center gap-1 text-green-600 border-green-600/50">
              <ArrowDown className="h-3 w-3" />
              {supports.length} Support
            </Badge>
            <Badge variant="outline" className="flex items-center gap-1 text-red-600 border-red-600/50">
              <ArrowUp className="h-3 w-3" />
              {resistances.length} Resistance
            </Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {/* Price Chart with S/R Lines */}
        <ResponsiveContainer width="100%" height={300}>
          <ComposedChart data={chartData} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="priceGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
            <XAxis
              dataKey="date"
              tick={{ fontSize: 10 }}
              tickFormatter={(value) => {
                const date = new Date(value);
                return `${date.getMonth() + 1}/${date.getDate()}`;
              }}
              className="text-muted-foreground"
              interval="preserveStartEnd"
            />
            <YAxis
              tick={{ fontSize: 12 }}
              tickFormatter={(value) => `$${value.toFixed(0)}`}
              className="text-muted-foreground"
              domain={["auto", "auto"]}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: "hsl(var(--card))",
                border: "1px solid hsl(var(--border))",
                borderRadius: "8px",
              }}
              formatter={(value: number, name: string) => [
                `$${value.toFixed(2)}`,
                name === "close" ? "Close" : name,
              ]}
              labelFormatter={(label) => new Date(label).toLocaleDateString()}
            />

            {/* Support Lines */}
            {supports.map((level, index) => (
              <ReferenceLine
                key={`support-${index}`}
                y={level.price}
                stroke="#22c55e"
                strokeDasharray={level.strength >= 3 ? "none" : "5 5"}
                strokeWidth={level.strength >= 4 ? 2 : 1}
                label={{
                  value: `S: $${level.price.toFixed(0)}`,
                  position: "insideLeft",
                  fill: "#22c55e",
                  fontSize: 10,
                }}
              />
            ))}

            {/* Resistance Lines */}
            {resistances.map((level, index) => (
              <ReferenceLine
                key={`resistance-${index}`}
                y={level.price}
                stroke="#ef4444"
                strokeDasharray={level.strength >= 3 ? "none" : "5 5"}
                strokeWidth={level.strength >= 4 ? 2 : 1}
                label={{
                  value: `R: $${level.price.toFixed(0)}`,
                  position: "insideRight",
                  fill: "#ef4444",
                  fontSize: 10,
                }}
              />
            ))}

            {/* Current Price Line */}
            <ReferenceLine
              y={currentPrice}
              stroke="#3b82f6"
              strokeWidth={2}
              label={{
                value: `Current: $${currentPrice.toFixed(2)}`,
                position: "insideTopRight",
                fill: "#3b82f6",
                fontSize: 11,
              }}
            />

            {/* Price Area */}
            <Area
              type="monotone"
              dataKey="close"
              stroke="#3b82f6"
              fill="url(#priceGradient)"
              strokeWidth={2}
            />
          </ComposedChart>
        </ResponsiveContainer>

        {/* Level Details */}
        <div className="mt-4 grid grid-cols-2 gap-4">
          {/* Support Levels */}
          <div>
            <h4 className="mb-2 flex items-center gap-1 text-sm font-medium text-green-600">
              <ArrowDown className="h-4 w-4" />
              Support Levels
            </h4>
            <div className="space-y-1">
              {supports.length > 0 ? (
                supports.map((level, index) => (
                  <div
                    key={index}
                    className="flex items-center justify-between rounded-md bg-green-500/10 px-2 py-1 text-sm"
                  >
                    <span className="font-medium">${level.price.toFixed(2)}</span>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span>{level.touches} touches</span>
                      <Badge variant="outline" className="text-xs py-0 h-5">
                        {strengthLabel(level.strength)}
                      </Badge>
                    </div>
                  </div>
                ))
              ) : (
                <p className="text-sm text-muted-foreground">No support levels found</p>
              )}
            </div>
          </div>

          {/* Resistance Levels */}
          <div>
            <h4 className="mb-2 flex items-center gap-1 text-sm font-medium text-red-600">
              <ArrowUp className="h-4 w-4" />
              Resistance Levels
            </h4>
            <div className="space-y-1">
              {resistances.length > 0 ? (
                resistances.map((level, index) => (
                  <div
                    key={index}
                    className="flex items-center justify-between rounded-md bg-red-500/10 px-2 py-1 text-sm"
                  >
                    <span className="font-medium">${level.price.toFixed(2)}</span>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span>{level.touches} touches</span>
                      <Badge variant="outline" className="text-xs py-0 h-5">
                        {strengthLabel(level.strength)}
                      </Badge>
                    </div>
                  </div>
                ))
              ) : (
                <p className="text-sm text-muted-foreground">No resistance levels found</p>
              )}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
