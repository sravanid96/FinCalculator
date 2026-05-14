"use client";

import { useState, useMemo } from "react";
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
  Bar,
  Brush,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Activity,
  Loader2,
  TrendingUp,
  TrendingDown,
  Minus,
  Eye,
  EyeOff,
} from "lucide-react";
import { fetchApi } from "@/lib/queryClient";
import type { SupportResistanceLevel, PriceDataPoint } from "@shared/optionsSchema";

interface TechnicalIndicatorsChartProps {
  symbol: string;
  currentPrice: number;
  levels: SupportResistanceLevel[];
}

interface ChartDataPoint {
  date: string;
  close: number;
  high: number;
  low: number;
  volume: number;
  sma20?: number;
  sma50?: number;
  sma200?: number;
  rsi?: number;
  macd?: number;
  macdSignal?: number;
  macdHistogram?: number;
  bbUpper?: number;
  bbMiddle?: number;
  bbLower?: number;
}

export function TechnicalIndicatorsChart({
  symbol,
  currentPrice,
  levels,
}: TechnicalIndicatorsChartProps) {
  const [activeIndicators, setActiveIndicators] = useState({
    price: true,
    sma20: true,
    sma50: true,
    sma200: false,
    bollinger: true,
    rsi: true,
    macd: true,
    supportResistance: true,
  });

  const [timeRange, setTimeRange] = useState<"3m" | "6m" | "1y">("6m");

  const { data: historicalData, isLoading, error } = useQuery<PriceDataPoint[]>({
    queryKey: ["/api/options/historical", symbol, timeRange],
    queryFn: async () => {
      const months = timeRange === "3m" ? 3 : timeRange === "6m" ? 6 : 12;
      const res = await fetchApi(`/api/options/historical/${encodeURIComponent(symbol)}?months=${months}`);
      if (!res.ok) throw new Error("Failed to fetch historical data");
      return res.json();
    },
    enabled: !!symbol,
    staleTime: 5 * 60 * 1000,
  });

  // Calculate all technical indicators
  const chartData = useMemo((): ChartDataPoint[] => {
    if (!historicalData || !Array.isArray(historicalData) || historicalData.length === 0) return [];

    const prices = historicalData;
    const data: ChartDataPoint[] = [];

    for (let i = 0; i < prices.length; i++) {
      const price = prices[i];
      const closes = prices.slice(0, i + 1).map((p) => p.close);

      const point: ChartDataPoint = {
        date: price.date,
        close: price.close,
        high: price.high,
        low: price.low,
        volume: price.volume,
      };

      // SMA calculations
      if (closes.length >= 20) {
        point.sma20 = closes.slice(-20).reduce((a, b) => a + b, 0) / 20;
      }
      if (closes.length >= 50) {
        point.sma50 = closes.slice(-50).reduce((a, b) => a + b, 0) / 50;
      }
      if (closes.length >= 200) {
        point.sma200 = closes.slice(-200).reduce((a, b) => a + b, 0) / 200;
      }

      // RSI calculation (14 period)
      if (closes.length >= 15) {
        const changes: number[] = [];
        for (let j = i - 13; j <= i; j++) {
          if (j > 0) changes.push(closes[j] - closes[j - 1]);
        }

        let gains = 0;
        let losses = 0;
        changes.forEach((change) => {
          if (change > 0) gains += change;
          else losses += Math.abs(change);
        });

        const avgGain = gains / 14;
        const avgLoss = losses / 14;

        if (avgLoss === 0) point.rsi = 100;
        else {
          const rs = avgGain / avgLoss;
          point.rsi = 100 - 100 / (1 + rs);
        }
      }

      // Bollinger Bands (20 period, 2 std dev)
      if (closes.length >= 20) {
        const periodCloses = closes.slice(-20);
        const sma20 = periodCloses.reduce((a, b) => a + b, 0) / 20;
        const squaredDiffs = periodCloses.map((c) => Math.pow(c - sma20, 2));
        const variance = squaredDiffs.reduce((a, b) => a + b, 0) / 20;
        const stdDev = Math.sqrt(variance);

        point.bbMiddle = sma20;
        point.bbUpper = sma20 + 2 * stdDev;
        point.bbLower = sma20 - 2 * stdDev;
      }

      // MACD (12, 26, 9)
      if (closes.length >= 26) {
        const ema12 = calculateEMA(closes, 12);
        const ema26 = calculateEMA(closes, 26);

        if (ema12 && ema26) {
          point.macd = ema12 - ema26;

          // Calculate signal line (9-period EMA of MACD)
          const macdValues: number[] = [];
          for (let k = i; k >= Math.max(0, i - 25); k--) {
            const kCloses = prices.slice(0, k + 1).map((p) => p.close);
            if (kCloses.length >= 26) {
              const kEma12 = calculateEMA(kCloses, 12);
              const kEma26 = calculateEMA(kCloses, 26);
              if (kEma12 && kEma26) macdValues.unshift(kEma12 - kEma26);
            }
          }

          if (macdValues.length >= 9) {
            point.macdSignal = calculateEMA(macdValues, 9);
            if (point.macdSignal !== undefined) {
              point.macdHistogram = point.macd - point.macdSignal;
            }
          }
        }
      }

      data.push(point);
    }

    return data;
  }, [historicalData]);

  const supports = levels.filter((l) => l.type === "support");
  const resistances = levels.filter((l) => l.type === "resistance");

  // Calculate current indicator values for badges
  const currentRSI = chartData[chartData.length - 1]?.rsi;
  const currentMACD = chartData[chartData.length - 1]?.macd;
  const currentMACDSignal = chartData[chartData.length - 1]?.macdSignal;

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Activity className="h-5 w-5" />
            Technical Indicators
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

  if (error || !chartData.length) {
    return (
      <Card className="border-yellow-200">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Activity className="h-5 w-5" />
            Technical Indicators
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex h-[200px] items-center justify-center text-sm text-muted-foreground">
            {error ? "Failed to load data. " : "No historical data available. "}
            Try selecting a different time range.
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <Activity className="h-5 w-5" />
              Technical Indicators
            </CardTitle>
            <Tabs value={timeRange} onValueChange={(v) => setTimeRange(v as any)}>
              <TabsList className="h-8">
                <TabsTrigger value="3m" className="text-xs">3M</TabsTrigger>
                <TabsTrigger value="6m" className="text-xs">6M</TabsTrigger>
                <TabsTrigger value="1y" className="text-xs">1Y</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>

          {/* Indicator Toggles */}
          <div className="flex flex-wrap gap-x-4 gap-y-2">
            <IndicatorToggle
              label="Price"
              checked={activeIndicators.price}
              onChange={(v) => setActiveIndicators((p) => ({ ...p, price: v }))}
              color="#3b82f6"
            />
            <IndicatorToggle
              label="SMA 20"
              checked={activeIndicators.sma20}
              onChange={(v) => setActiveIndicators((p) => ({ ...p, sma20: v }))}
              color="#8b5cf6"
            />
            <IndicatorToggle
              label="SMA 50"
              checked={activeIndicators.sma50}
              onChange={(v) => setActiveIndicators((p) => ({ ...p, sma50: v }))}
              color="#10b981"
            />
            <IndicatorToggle
              label="BB"
              checked={activeIndicators.bollinger}
              onChange={(v) => setActiveIndicators((p) => ({ ...p, bollinger: v }))}
              color="#f59e0b"
            />
            <IndicatorToggle
              label="S/R"
              checked={activeIndicators.supportResistance}
              onChange={(v) => setActiveIndicators((p) => ({ ...p, supportResistance: v }))}
              color="#ef4444"
            />
            <IndicatorToggle
              label="RSI"
              checked={activeIndicators.rsi}
              onChange={(v) => setActiveIndicators((p) => ({ ...p, rsi: v }))}
              color="#ec4899"
            />
            <IndicatorToggle
              label="MACD"
              checked={activeIndicators.macd}
              onChange={(v) => setActiveIndicators((p) => ({ ...p, macd: v }))}
              color="#06b6d4"
            />
          </div>

          {/* Current Values */}
          <div className="flex flex-wrap gap-2">
            {currentRSI !== undefined && activeIndicators.rsi && (
              <Badge
                variant="outline"
                className={`text-xs ${
                  currentRSI > 70 ? "border-red-500 text-red-500" : currentRSI < 30 ? "border-green-500 text-green-500" : ""
                }`}
              >
                RSI: {currentRSI.toFixed(1)}
                {currentRSI > 70 ? " (OB)" : currentRSI < 30 ? " (OS)" : ""}
              </Badge>
            )}
            {currentMACD !== undefined && currentMACDSignal !== undefined && activeIndicators.macd && (
              <Badge
                variant="outline"
                className={`text-xs ${
                  currentMACD > currentMACDSignal ? "border-green-500 text-green-500" : "border-red-500 text-red-500"
                }`}
              >
                MACD: {currentMACD > currentMACDSignal ? "Bullish" : "Bearish"}
              </Badge>
            )}
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Main Price Chart */}
        <div className="h-[280px]">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chartData} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="priceGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="bbGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.1} />
                  <stop offset="95%" stopColor="#f59e0b" stopOpacity={0.1} />
                </linearGradient>
              </defs>

              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--muted-foreground)/0.2)" />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 10 }}
                tickFormatter={(value) => {
                  const date = new Date(value);
                  return `${date.getMonth() + 1}/${date.getDate()}`;
                }}
                stroke="hsl(var(--muted-foreground))"
                interval="preserveStartEnd"
              />
              <YAxis
                tick={{ fontSize: 10 }}
                tickFormatter={(value) => `$${value.toFixed(0)}`}
                stroke="hsl(var(--muted-foreground))"
                domain={["auto", "auto"]}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: "hsl(var(--card))",
                  border: "1px solid hsl(var(--border))",
                  borderRadius: "8px",
                  fontSize: "12px",
                }}
                formatter={(value: number, name: string) => {
                  if (name.includes("SMA")) return [`$${value?.toFixed(2)}`, name];
                  if (name === "close") return [`$${value?.toFixed(2)}`, "Close"];
                  return [value?.toFixed(2), name];
                }}
                labelFormatter={(label) => new Date(label).toLocaleDateString()}
              />

              {/* Bollinger Bands Area */}
              {activeIndicators.bollinger && (
                <Area
                  type="monotone"
                  dataKey="bbUpper"
                  stroke="none"
                  fill="url(#bbGradient)"
                />
              )}
              {activeIndicators.bollinger && (
                <Area
                  type="monotone"
                  dataKey="bbLower"
                  stroke="none"
                  fill="white"
                />
              )}

              {/* Price */}
              {activeIndicators.price && (
                <Area
                  type="monotone"
                  dataKey="close"
                  stroke="#3b82f6"
                  fill="url(#priceGradient)"
                  strokeWidth={2}
                  name="Price"
                />
              )}

              {/* SMA Lines */}
              {activeIndicators.sma20 && (
                <Line
                  type="monotone"
                  dataKey="sma20"
                  stroke="#8b5cf6"
                  strokeWidth={1.5}
                  dot={false}
                  name="SMA 20"
                />
              )}
              {activeIndicators.sma50 && (
                <Line
                  type="monotone"
                  dataKey="sma50"
                  stroke="#10b981"
                  strokeWidth={1.5}
                  dot={false}
                  name="SMA 50"
                />
              )}
              {activeIndicators.sma200 && (
                <Line
                  type="monotone"
                  dataKey="sma200"
                  stroke="#f59e0b"
                  strokeWidth={1.5}
                  dot={false}
                  name="SMA 200"
                />
              )}

              {/* Bollinger Band Lines */}
              {activeIndicators.bollinger && (
                <>
                  <Line
                    type="monotone"
                    dataKey="bbUpper"
                    stroke="#f59e0b"
                    strokeWidth={1}
                    strokeDasharray="3 3"
                    dot={false}
                    name="BB Upper"
                  />
                  <Line
                    type="monotone"
                    dataKey="bbMiddle"
                    stroke="#f59e0b"
                    strokeWidth={1}
                    dot={false}
                    name="BB Middle"
                  />
                  <Line
                    type="monotone"
                    dataKey="bbLower"
                    stroke="#f59e0b"
                    strokeWidth={1}
                    strokeDasharray="3 3"
                    dot={false}
                    name="BB Lower"
                  />
                </>
              )}

              {/* Support/Resistance Lines */}
              {activeIndicators.supportResistance && (
                <>
                  {supports.map((level, index) => (
                    <ReferenceLine
                      key={`support-${index}`}
                      y={level.price}
                      stroke="#22c55e"
                      strokeDasharray="5 5"
                      strokeWidth={1}
                      label={{
                        value: `S${index + 1}`,
                        position: "insideLeft",
                        fill: "#22c55e",
                        fontSize: 10,
                      }}
                    />
                  ))}
                  {resistances.map((level, index) => (
                    <ReferenceLine
                      key={`resistance-${index}`}
                      y={level.price}
                      stroke="#ef4444"
                      strokeDasharray="5 5"
                      strokeWidth={1}
                      label={{
                        value: `R${index + 1}`,
                        position: "insideRight",
                        fill: "#ef4444",
                        fontSize: 10,
                      }}
                    />
                  ))}
                </>
              )}

              <Brush dataKey="date" height={20} stroke="#3b82f6" />
            </ComposedChart>
          </ResponsiveContainer>
        </div>

        {/* RSI Chart */}
        {activeIndicators.rsi && (
          <div className="h-[80px] border-t pt-2">
            <div className="mb-1 flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">RSI (14)</span>
              <div className="flex gap-2 text-[10px] text-muted-foreground">
                <span className="text-red-500">70 (OB)</span>
                <span className="text-green-500">30 (OS)</span>
              </div>
            </div>
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chartData} margin={{ top: 0, right: 30, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--muted-foreground)/0.1)" />
                <XAxis dataKey="date" hide />
                <YAxis tick={{ fontSize: 9 }} domain={[0, 100]} stroke="hsl(var(--muted-foreground))" />
                <ReferenceLine y={70} stroke="#ef4444" strokeDasharray="2 2" />
                <ReferenceLine y={30} stroke="#22c55e" strokeDasharray="2 2" />
                <ReferenceLine y={50} stroke="hsl(var(--muted-foreground))" strokeDasharray="2 2" opacity={0.5} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "hsl(var(--card))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: "4px",
                    fontSize: "11px",
                  }}
                  formatter={(value: number) => [value?.toFixed(1), "RSI"]}
                />
                <Area
                  type="monotone"
                  dataKey="rsi"
                  stroke="#ec4899"
                  fill="#ec4899"
                  fillOpacity={0.2}
                  strokeWidth={1.5}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* MACD Chart */}
        {activeIndicators.macd && (
          <div className="h-[80px] border-t pt-2">
            <div className="mb-1 text-xs font-medium text-muted-foreground">MACD (12, 26, 9)</div>
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chartData} margin={{ top: 0, right: 30, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--muted-foreground)/0.1)" />
                <XAxis dataKey="date" hide />
                <YAxis tick={{ fontSize: 9 }} stroke="hsl(var(--muted-foreground))" />
                <ReferenceLine y={0} stroke="hsl(var(--muted-foreground))" />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "hsl(var(--card))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: "4px",
                    fontSize: "11px",
                  }}
                  formatter={(value: number, name: string) => [value?.toFixed(3), name]}
                />
                <Bar
                  dataKey="macdHistogram"
                  fill="#06b6d4"
                  opacity={0.5}
                  name="Histogram"
                />
                <Line
                  type="monotone"
                  dataKey="macd"
                  stroke="#06b6d4"
                  strokeWidth={1.5}
                  dot={false}
                  name="MACD"
                />
                <Line
                  type="monotone"
                  dataKey="macdSignal"
                  stroke="#f97316"
                  strokeWidth={1.5}
                  strokeDasharray="3 3"
                  dot={false}
                  name="Signal"
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function IndicatorToggle({
  label,
  checked,
  onChange,
  color,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  color: string;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <div
        className="h-3 w-3 rounded-sm"
        style={{ backgroundColor: checked ? color : "transparent", border: `1px solid ${color}` }}
      />
      <Switch
        id={`toggle-${label}`}
        checked={checked}
        onCheckedChange={onChange}
        // Use default switch sizing; shrinking width without adjusting thumb translate clips label text.
        className="scale-75 origin-left data-[state=checked]:bg-primary"
      />
      <Label htmlFor={`toggle-${label}`} className="cursor-pointer text-xs font-normal">
        {label}
      </Label>
    </div>
  );
}

// Helper function to calculate EMA
function calculateEMA(values: number[], period: number): number | undefined {
  if (values.length < period) return undefined;

  const multiplier = 2 / (period + 1);
  let ema = values.slice(0, period).reduce((a, b) => a + b, 0) / period;

  for (let i = period; i < values.length; i++) {
    ema = (values[i] - ema) * multiplier + ema;
  }

  return ema;
}
