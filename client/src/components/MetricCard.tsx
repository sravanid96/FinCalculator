import { LucideIcon, TrendingUp, TrendingDown, Minus } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { formatCurrency, formatPercent } from "@/lib/formatters";
import { cn } from "@/lib/utils";

interface MetricCardProps {
  title: string;
  value: number;
  previousValue?: number;
  icon?: LucideIcon;
  format?: "currency" | "percent" | "number";
  invertColors?: boolean;
  loading?: boolean;
}

export function MetricCard({
  title,
  value,
  previousValue,
  icon: Icon,
  format = "currency",
  invertColors = false,
  loading = false,
}: MetricCardProps) {
  const percentChange = previousValue
    ? ((value - previousValue) / Math.abs(previousValue)) * 100
    : undefined;

  const isPositive = percentChange !== undefined ? percentChange > 0 : undefined;
  const isNeutral = percentChange !== undefined ? percentChange === 0 : undefined;

  const formattedValue =
    format === "currency"
      ? formatCurrency(value)
      : format === "percent"
      ? `${value.toFixed(1)}%`
      : value.toLocaleString();

  const trendColor = invertColors
    ? isPositive
      ? "text-red-500"
      : isNeutral
      ? "text-muted-foreground"
      : "text-green-500"
    : isPositive
    ? "text-green-500"
    : isNeutral
    ? "text-muted-foreground"
    : "text-red-500";

  const TrendIcon = isPositive ? TrendingUp : isNeutral ? Minus : TrendingDown;

  if (loading) {
    return (
      <Card>
        <CardContent className="p-6">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1 space-y-3">
              <div className="h-4 w-24 animate-pulse rounded bg-muted" />
              <div className="h-8 w-32 animate-pulse rounded bg-muted" />
              <div className="h-3 w-20 animate-pulse rounded bg-muted" />
            </div>
            <div className="h-10 w-10 animate-pulse rounded-lg bg-muted" />
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="p-6">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 space-y-1">
            <p className="text-sm font-medium text-muted-foreground">{title}</p>
            <p className="text-3xl font-bold tabular-nums" data-testid={`metric-${title.toLowerCase().replace(/\s+/g, "-")}`}>
              {formattedValue}
            </p>
            {percentChange !== undefined && (
              <div className={cn("flex items-center gap-1 text-sm", trendColor)}>
                <TrendIcon className="h-3.5 w-3.5" />
                <span className="tabular-nums">{formatPercent(percentChange)}</span>
                <span className="text-muted-foreground">vs last period</span>
              </div>
            )}
          </div>
          {Icon && (
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
              <Icon className="h-5 w-5 text-muted-foreground" />
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
