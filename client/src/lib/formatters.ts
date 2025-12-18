export function formatCurrency(
  amount: number | string,
  currency: string = "USD",
  options?: Intl.NumberFormatOptions
): string {
  const numAmount = typeof amount === "string" ? parseFloat(amount) : amount;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
    ...options,
  }).format(numAmount);
}

export function formatCompactCurrency(amount: number | string, currency: string = "USD"): string {
  const numAmount = typeof amount === "string" ? parseFloat(amount) : amount;
  const absAmount = Math.abs(numAmount);
  
  if (absAmount >= 1000000) {
    return formatCurrency(numAmount / 1000000, currency, { maximumFractionDigits: 1 }).replace(/\.0$/, "") + "M";
  }
  if (absAmount >= 1000) {
    return formatCurrency(numAmount / 1000, currency, { maximumFractionDigits: 1 }).replace(/\.0$/, "") + "K";
  }
  return formatCurrency(numAmount, currency);
}

export function formatPercent(value: number, decimals: number = 1): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(decimals)}%`;
}

export function formatDate(date: Date | string, format: "short" | "medium" | "long" = "medium"): string {
  const d = typeof date === "string" ? new Date(date) : date;
  
  switch (format) {
    case "short":
      return d.toLocaleDateString("en-US", { month: "numeric", day: "numeric" });
    case "long":
      return d.toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
    default:
      return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
  }
}

export function formatDateRange(start: Date, end: Date): string {
  const startMonth = start.toLocaleDateString("en-US", { month: "short" });
  const endMonth = end.toLocaleDateString("en-US", { month: "short", year: "numeric" });
  return `${startMonth} - ${endMonth}`;
}

export function getRelativeTime(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return formatDate(d, "short");
}
