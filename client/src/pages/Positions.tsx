import React, { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Briefcase,
  Coins,
  Loader2,
  Percent,
  PieChart as PieChartIcon,
  Trash2,
  Upload,
  WalletCards,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { formatCurrency, formatPercent } from "@/lib/formatters";
import { resolveApiUrl } from "@/lib/queryClient";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

interface OpenOptionLeg {
  side: "short" | "long";
  type: "call" | "put";
  strike: number;
  expiration: string;
  contracts: number;
  netCashAtOpen: number;
  activityDate: string;
}

interface SymbolSummary {
  symbol: string;
  shares: number;
  avgCost: number;
  currentBasis: number;
  totalBuyCostEver: number;
  stockRealizedPnl: number;
  dividends: number;
  optionPremiumCollectedGross: number;
  optionRealizedPnl: number;
  optionPremiumOpenCredit: number;
  optionOpenDebit: number;
  optionsGainPct: number | null;
  totalRealizedPnl: number;
  totalGainPct: number | null;
  hasOpenStock: boolean;
  hasOpenOptions: boolean;
  openOptionLegs: OpenOptionLeg[];
}

interface PeriodBucket {
  period: string;
  label: string;
  stockBuyAmount: number;
  stockSellProceeds: number;
  stockRealizedPnl: number;
  optionPremiumCollected: number;
  optionRealizedPnl: number;
  dividends: number;
  cashDeposits: number;
  cashWithdrawals: number;
  interest: number;
  netCashFlow: number;
}

interface PortfolioTotals {
  symbols: SymbolSummary[];
  totalCurrentlyInvested: number;
  totalStockBasis: number;
  totalOpenOptionDebit: number;
  totalOpenOptionCredit: number;
  totalRealizedPnl: number;
  totalDividends: number;
  totalOptionRealizedPnl: number;
  totalStockRealizedPnl: number;
  totalOptionPremiumCollectedGross: number;
  rowCount: number;
  lastActivityDate: string | null;
  cashFlow: number;
  byMonth: PeriodBucket[];
  byYear: PeriodBucket[];
}

interface PositionsResponse {
  portfolio: PortfolioTotals;
  totalActivities: number;
}

const PIE_COLORS = [
  "#6366f1",
  "#8b5cf6",
  "#ec4899",
  "#f43f5e",
  "#f59e0b",
  "#10b981",
  "#06b6d4",
  "#3b82f6",
  "#84cc16",
  "#a855f7",
  "#14b8a6",
  "#f97316",
];

function gainClass(value: number): string {
  if (value > 0) return "text-green-600 dark:text-green-400";
  if (value < 0) return "text-red-600 dark:text-red-400";
  return "";
}

function formatPctOrDash(value: number | null): string {
  return value == null ? "--" : formatPercent(value);
}

type SortDir = "asc" | "desc";

function useSort<K extends string>(initialKey: K, initialDir: SortDir = "desc") {
  const [sortKey, setSortKey] = useState<K>(initialKey);
  const [direction, setDirection] = useState<SortDir>(initialDir);
  const toggle = (key: K, defaultDir: SortDir = "desc") => {
    if (key === sortKey) {
      setDirection((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setDirection(defaultDir);
    }
  };
  return { sortKey, direction, toggle };
}

function SortableHead<K extends string>({
  label,
  sortKey,
  activeKey,
  direction,
  onSort,
  align = "left",
  defaultDir = "desc",
}: {
  label: string;
  sortKey: K;
  activeKey: K;
  direction: SortDir;
  onSort: (key: K, defaultDir?: SortDir) => void;
  align?: "left" | "right";
  defaultDir?: SortDir;
}) {
  const active = sortKey === activeKey;
  const Icon = !active ? ArrowUpDown : direction === "asc" ? ArrowUp : ArrowDown;
  return (
    <TableHead className={align === "right" ? "text-right" : ""}>
      <button
        type="button"
        onClick={() => onSort(sortKey, defaultDir)}
        className={`inline-flex items-center gap-1 select-none hover:text-foreground transition-colors ${
          active ? "text-foreground" : "text-muted-foreground"
        } ${align === "right" ? "ml-auto justify-end" : ""}`}
      >
        <span>{label}</span>
        <Icon className="h-3 w-3 opacity-70" />
      </button>
    </TableHead>
  );
}

function compareValues(a: unknown, b: unknown): number {
  if (a == null && b == null) return 0;
  if (a == null) return -1;
  if (b == null) return 1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b));
}

type SymbolSortKey =
  | "symbol"
  | "shares"
  | "invested"
  | "stockRealizedPnl"
  | "optionPremiumCollectedGross"
  | "optionRealizedPnl"
  | "optionsGainPct"
  | "totalRealizedPnl"
  | "totalGainPct";

function getSymbolSortValue(s: SymbolSummary, key: SymbolSortKey): string | number | null {
  switch (key) {
    case "symbol":
      return s.symbol;
    case "shares":
      return s.shares;
    case "invested":
      return s.currentBasis + s.optionOpenDebit;
    case "stockRealizedPnl":
      return s.stockRealizedPnl;
    case "optionPremiumCollectedGross":
      return s.optionPremiumCollectedGross;
    case "optionRealizedPnl":
      return s.optionRealizedPnl;
    case "optionsGainPct":
      return s.optionsGainPct;
    case "totalRealizedPnl":
      return s.totalRealizedPnl;
    case "totalGainPct":
      return s.totalGainPct;
    default:
      return null;
  }
}

type LegSortKey =
  | "symbol"
  | "side"
  | "type"
  | "strike"
  | "expiration"
  | "contracts"
  | "netCashAtOpen"
  | "activityDate";

function getLegSortValue(
  symbol: string,
  leg: OpenOptionLeg,
  key: LegSortKey
): string | number | null {
  switch (key) {
    case "symbol":
      return symbol;
    case "side":
      return leg.side;
    case "type":
      return leg.type;
    case "strike":
      return leg.strike;
    case "expiration":
      return leg.expiration;
    case "contracts":
      return leg.contracts;
    case "netCashAtOpen":
      return leg.netCashAtOpen;
    case "activityDate":
      return leg.activityDate;
    default:
      return null;
  }
}

function renderSliceLabel(props: any): React.ReactNode {
  const { cx, cy, midAngle, innerRadius, outerRadius, percent } = props;
  const pct = (percent ?? 0) * 100;
  // Hide labels on slim slices so the chart stays readable.
  if (pct < 6) return null;
  const RADIAN = Math.PI / 180;
  const radius = innerRadius + (outerRadius - innerRadius) * 0.6;
  const x = cx + radius * Math.cos(-midAngle * RADIAN);
  const y = cy + radius * Math.sin(-midAngle * RADIAN);
  return (
    <text
      x={x}
      y={y}
      fill="#ffffff"
      textAnchor="middle"
      dominantBaseline="central"
      fontSize={12}
      fontWeight={600}
      style={{ pointerEvents: "none" }}
    >
      {`${pct.toFixed(1)}%`}
    </text>
  );
}

function buildAllocationSlices(symbols: SymbolSummary[]): Array<{
  name: string;
  value: number;
  pct: number;
  color: string;
}> {
  const active = symbols
    .map((s) => ({ name: s.symbol, value: s.currentBasis + s.optionOpenDebit }))
    .filter((s) => s.value > 0)
    .sort((a, b) => b.value - a.value);
  const total = active.reduce((acc, x) => acc + x.value, 0);
  if (total === 0) return [];
  const top = active.slice(0, 10);
  const otherTotal = active.slice(10).reduce((acc, x) => acc + x.value, 0);
  const result = top.map((s, idx) => ({
    name: s.name,
    value: s.value,
    pct: (s.value / total) * 100,
    color: PIE_COLORS[idx % PIE_COLORS.length],
  }));
  if (otherTotal > 0) {
    result.push({
      name: "Other",
      value: otherTotal,
      pct: (otherTotal / total) * 100,
      color: "#64748b",
    });
  }
  return result;
}

export default function Positions() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [confirmClearOpen, setConfirmClearOpen] = useState(false);

  const { data, isLoading, error } = useQuery<PositionsResponse>({
    queryKey: ["/api/brokerage/positions"],
  });

  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append("file", file);
      const token = localStorage.getItem("auth_token");
      const headers: Record<string, string> = {};
      if (token) headers["Authorization"] = `Bearer ${token}`;
      const res = await fetch(resolveApiUrl("/api/brokerage/upload"), {
        method: "POST",
        headers,
        body: formData,
        credentials: "include",
      });
      if (!res.ok) {
        const text = await res.text();
        try {
          const parsed = JSON.parse(text);
          throw new Error(parsed.message || parsed.error || text);
        } catch (parseErr) {
          if (parseErr instanceof SyntaxError) throw new Error(text || res.statusText);
          throw parseErr;
        }
      }
      return res.json() as Promise<{
        imported: number;
        skippedAsDuplicates: number;
        duplicatesAgainstExisting: number;
        duplicatesInFile: number;
        deduplicatedExistingRows: number;
        rehashedExistingRows: number;
        totalActivities: number;
      }>;
    },
    onSuccess: (result) => {
      const dupParts = [
        result.duplicatesAgainstExisting
          ? `${result.duplicatesAgainstExisting} already imported`
          : null,
        result.duplicatesInFile
          ? `${result.duplicatesInFile} duplicates in file`
          : null,
      ].filter(Boolean);
      const dupLine = dupParts.length ? ` · ${dupParts.join(" · ")} skipped` : "";
      const housekeeping = result.deduplicatedExistingRows
        ? ` · cleaned ${result.deduplicatedExistingRows} old duplicate row${
            result.deduplicatedExistingRows === 1 ? "" : "s"
          }`
        : "";
      toast({
        title: "Brokerage CSV imported",
        description: `${result.imported} new rows${dupLine}${housekeeping} · ${result.totalActivities} total`,
      });
      qc.invalidateQueries({ queryKey: ["/api/brokerage/positions"] });
      if (fileRef.current) fileRef.current.value = "";
    },
    onError: (err: Error) => {
      toast({ title: "Upload failed", description: err.message, variant: "destructive" });
      if (fileRef.current) fileRef.current.value = "";
    },
  });

  const clearMutation = useMutation({
    mutationFn: async () => {
      const token = localStorage.getItem("auth_token");
      const headers: Record<string, string> = {};
      if (token) headers["Authorization"] = `Bearer ${token}`;
      const res = await fetch(resolveApiUrl("/api/brokerage/activities"), {
        method: "DELETE",
        headers,
        credentials: "include",
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || res.statusText);
      }
      return res.json() as Promise<{ removed: number }>;
    },
    onSuccess: (r) => {
      toast({ title: "Cleared", description: `Removed ${r.removed} activity rows` });
      qc.invalidateQueries({ queryKey: ["/api/brokerage/positions"] });
      setConfirmClearOpen(false);
    },
    onError: (err: Error) => {
      toast({ title: "Failed to clear", description: err.message, variant: "destructive" });
    },
  });

  const portfolio = data?.portfolio;
  const allocation = useMemo(() => buildAllocationSlices(portfolio?.symbols ?? []), [portfolio]);
  const hasData = !!portfolio && portfolio.symbols.length > 0;

  const symbolSort = useSort<SymbolSortKey>("invested", "desc");
  const sortedSymbols = useMemo(() => {
    if (!portfolio) return [];
    const copy = [...portfolio.symbols];
    copy.sort((a, b) => {
      const av = getSymbolSortValue(a, symbolSort.sortKey);
      const bv = getSymbolSortValue(b, symbolSort.sortKey);
      const cmp = compareValues(av, bv);
      return symbolSort.direction === "asc" ? cmp : -cmp;
    });
    return copy;
  }, [portfolio, symbolSort.sortKey, symbolSort.direction]);

  const legSort = useSort<LegSortKey>("expiration", "asc");
  const sortedOpenLegs = useMemo(() => {
    if (!portfolio) return [];
    const flat = portfolio.symbols.flatMap((s) =>
      s.openOptionLegs.map((leg) => ({ symbol: s.symbol, leg }))
    );
    flat.sort((a, b) => {
      const av = getLegSortValue(a.symbol, a.leg, legSort.sortKey);
      const bv = getLegSortValue(b.symbol, b.leg, legSort.sortKey);
      const cmp = compareValues(av, bv);
      return legSort.direction === "asc" ? cmp : -cmp;
    });
    return flat;
  }, [portfolio, legSort.sortKey, legSort.direction]);

  return (
    <div className="flex-1 space-y-6 overflow-auto p-4 sm:p-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold">Positions</h1>
          <p className="text-muted-foreground">
            Aggregated holdings, gains, options, and time-series breakdown from monthly brokerage
            CSVs.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) uploadMutation.mutate(file);
            }}
          />
          <Button
            size="sm"
            onClick={() => fileRef.current?.click()}
            disabled={uploadMutation.isPending}
            data-testid="button-brokerage-upload"
          >
            {uploadMutation.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Upload className="mr-2 h-4 w-4" />
            )}
            Upload CSV
          </Button>
          {(data?.totalActivities ?? 0) > 0 && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setConfirmClearOpen(true)}
              disabled={clearMutation.isPending}
            >
              <Trash2 className="mr-2 h-4 w-4" />
              Clear
            </Button>
          )}
        </div>
      </div>

      {isLoading ? (
        <div className="flex min-h-[280px] items-center justify-center gap-2 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
          Loading positions...
        </div>
      ) : error ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-destructive">
            Could not load brokerage positions.
          </CardContent>
        </Card>
      ) : !hasData ? (
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground">
            Upload a brokerage activity CSV to populate positions, gains, and reports.
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>Currently invested</CardDescription>
                <CardTitle className="flex items-center gap-2 text-2xl">
                  <WalletCards className="h-5 w-5 text-muted-foreground" />
                  {formatCurrency(portfolio!.totalCurrentlyInvested)}
                </CardTitle>
              </CardHeader>
              <CardContent className="text-xs text-muted-foreground">
                Open stock {formatCurrency(portfolio!.totalStockBasis)} + open option debit{" "}
                {formatCurrency(portfolio!.totalOpenOptionDebit)}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>Realized P&amp;L (all-time)</CardDescription>
                <CardTitle
                  className={`flex items-center gap-2 text-2xl ${gainClass(portfolio!.totalRealizedPnl)}`}
                >
                  <Percent className="h-5 w-5" />
                  {formatCurrency(portfolio!.totalRealizedPnl)}
                </CardTitle>
              </CardHeader>
              <CardContent className="text-xs text-muted-foreground">
                Stocks {formatCurrency(portfolio!.totalStockRealizedPnl)} · Options{" "}
                {formatCurrency(portfolio!.totalOptionRealizedPnl)} · Divs{" "}
                {formatCurrency(portfolio!.totalDividends)}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>Option premium (gross)</CardDescription>
                <CardTitle className="flex items-center gap-2 text-2xl">
                  <Coins className="h-5 w-5 text-muted-foreground" />
                  {formatCurrency(portfolio!.totalOptionPremiumCollectedGross)}
                </CardTitle>
              </CardHeader>
              <CardContent className="text-xs text-muted-foreground">
                Still open as credit: {formatCurrency(portfolio!.totalOpenOptionCredit)}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>Positions held</CardDescription>
                <CardTitle className="flex items-center gap-2 text-2xl">
                  <Briefcase className="h-5 w-5 text-muted-foreground" />
                  {portfolio!.symbols.filter((s) => s.hasOpenStock || s.hasOpenOptions).length}
                </CardTitle>
              </CardHeader>
              <CardContent className="text-xs text-muted-foreground">
                Out of {portfolio!.symbols.length} symbols with any activity
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-6 lg:grid-cols-7">
            <Card className="lg:col-span-4">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <PieChartIcon className="h-5 w-5 text-muted-foreground" />
                  Allocation by Stock
                </CardTitle>
                <CardDescription>
                  Share of currently-invested capital (stock cost basis + open long option debit).
                  Top 10 shown, remainder grouped as "Other".
                </CardDescription>
              </CardHeader>
              <CardContent>
                {allocation.length === 0 ? (
                  <div className="flex h-[340px] items-center justify-center text-muted-foreground">
                    No open positions to chart.
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height={360}>
                    <PieChart margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
                      <Pie
                        data={allocation}
                        dataKey="value"
                        nameKey="name"
                        cx="50%"
                        cy="46%"
                        innerRadius="55%"
                        outerRadius="80%"
                        paddingAngle={1.5}
                        stroke="hsl(var(--background))"
                        strokeWidth={2}
                        labelLine={false}
                        label={renderSliceLabel}
                        isAnimationActive={false}
                      >
                        {allocation.map((slice) => (
                          <Cell key={slice.name} fill={slice.color} />
                        ))}
                      </Pie>
                      <Tooltip
                        formatter={(value: number, _name: string, payload: any) => [
                          `${formatCurrency(value)} · ${payload?.payload?.pct?.toFixed(1) ?? "0.0"}%`,
                          payload?.payload?.name ?? "",
                        ]}
                        contentStyle={{
                          backgroundColor: "hsl(var(--card))",
                          border: "1px solid hsl(var(--border))",
                          borderRadius: "8px",
                          color: "#ffffff",
                        }}
                        itemStyle={{ color: "#ffffff" }}
                        labelStyle={{ color: "#ffffff" }}
                      />
                      <Legend
                        verticalAlign="bottom"
                        height={36}
                        wrapperStyle={{ fontSize: 12 }}
                        formatter={(value, entry: any) => {
                          const pct = entry?.payload?.pct;
                          return (
                            <span className="text-foreground">
                              {value}
                              {typeof pct === "number" ? (
                                <span className="ml-1 text-muted-foreground">
                                  {pct.toFixed(1)}%
                                </span>
                              ) : null}
                            </span>
                          );
                        }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>

            <Card className="lg:col-span-3">
              <CardHeader>
                <CardTitle>Top Holdings</CardTitle>
                <CardDescription>By currently-invested capital.</CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Symbol</TableHead>
                      <TableHead className="text-right">Invested</TableHead>
                      <TableHead className="text-right">% of total</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {allocation.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={3} className="py-6 text-center text-muted-foreground">
                          No open positions.
                        </TableCell>
                      </TableRow>
                    ) : (
                      allocation.map((slice) => (
                        <TableRow key={slice.name}>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <span
                                className="h-2 w-2 rounded-full"
                                style={{ backgroundColor: slice.color }}
                              />
                              <span className="font-medium">{slice.name}</span>
                            </div>
                          </TableCell>
                          <TableCell className="text-right">{formatCurrency(slice.value)}</TableCell>
                          <TableCell className="text-right tabular-nums">
                            {slice.pct.toFixed(1)}%
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <CardTitle>Activity by Period</CardTitle>
                <CardDescription>
                  Realized P&amp;L, option premium, dividends, and net cash flow aggregated from
                  CSV rows. Last activity:{" "}
                  {portfolio!.lastActivityDate
                    ? new Date(portfolio!.lastActivityDate).toLocaleDateString()
                    : "--"}
                  .
                </CardDescription>
              </div>
            </CardHeader>
            <CardContent>
              <Tabs defaultValue="monthly" className="space-y-4">
                <TabsList>
                  <TabsTrigger value="monthly">Monthly</TabsTrigger>
                  <TabsTrigger value="yearly">Yearly</TabsTrigger>
                </TabsList>

                <TabsContent value="monthly" className="space-y-4">
                  <PeriodChart buckets={portfolio!.byMonth} />
                  <PeriodTable buckets={portfolio!.byMonth} />
                </TabsContent>

                <TabsContent value="yearly" className="space-y-4">
                  <PeriodChart buckets={portfolio!.byYear} />
                  <PeriodTable buckets={portfolio!.byYear} />
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Per-Stock Performance</CardTitle>
              <CardDescription>
                Stock and option results grouped by symbol. Total gain % uses cumulative capital
                deployed (stock cost + option premium collected + open option debit) as the
                denominator.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <SortableHead
                      label="Stock"
                      sortKey="symbol"
                      activeKey={symbolSort.sortKey}
                      direction={symbolSort.direction}
                      onSort={symbolSort.toggle}
                      defaultDir="asc"
                    />
                    <SortableHead
                      label="Shares"
                      sortKey="shares"
                      activeKey={symbolSort.sortKey}
                      direction={symbolSort.direction}
                      onSort={symbolSort.toggle}
                      align="right"
                    />
                    <SortableHead
                      label="Invested"
                      sortKey="invested"
                      activeKey={symbolSort.sortKey}
                      direction={symbolSort.direction}
                      onSort={symbolSort.toggle}
                      align="right"
                    />
                    <SortableHead
                      label="Stock realized"
                      sortKey="stockRealizedPnl"
                      activeKey={symbolSort.sortKey}
                      direction={symbolSort.direction}
                      onSort={symbolSort.toggle}
                      align="right"
                    />
                    <SortableHead
                      label="Option premium"
                      sortKey="optionPremiumCollectedGross"
                      activeKey={symbolSort.sortKey}
                      direction={symbolSort.direction}
                      onSort={symbolSort.toggle}
                      align="right"
                    />
                    <SortableHead
                      label="Option realized"
                      sortKey="optionRealizedPnl"
                      activeKey={symbolSort.sortKey}
                      direction={symbolSort.direction}
                      onSort={symbolSort.toggle}
                      align="right"
                    />
                    <SortableHead
                      label="Options gain %"
                      sortKey="optionsGainPct"
                      activeKey={symbolSort.sortKey}
                      direction={symbolSort.direction}
                      onSort={symbolSort.toggle}
                      align="right"
                    />
                    <SortableHead
                      label="Total realized"
                      sortKey="totalRealizedPnl"
                      activeKey={symbolSort.sortKey}
                      direction={symbolSort.direction}
                      onSort={symbolSort.toggle}
                      align="right"
                    />
                    <SortableHead
                      label="Total gain %"
                      sortKey="totalGainPct"
                      activeKey={symbolSort.sortKey}
                      direction={symbolSort.direction}
                      onSort={symbolSort.toggle}
                      align="right"
                    />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sortedSymbols.map((row) => (
                    <TableRow key={row.symbol}>
                      <TableCell className="font-medium">
                        <div className="flex items-center gap-2">
                          {row.symbol}
                          {row.hasOpenOptions && (
                            <Badge variant="secondary" className="text-[10px]">
                              {row.openOptionLegs.length} leg
                              {row.openOptionLegs.length === 1 ? "" : "s"}
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {row.shares > 0 ? row.shares.toFixed(4).replace(/\.?0+$/, "") : "--"}
                      </TableCell>
                      <TableCell className="text-right">
                        {formatCurrency(row.currentBasis + row.optionOpenDebit)}
                      </TableCell>
                      <TableCell className={`text-right font-medium ${gainClass(row.stockRealizedPnl)}`}>
                        {formatCurrency(row.stockRealizedPnl)}
                      </TableCell>
                      <TableCell className="text-right">
                        {formatCurrency(row.optionPremiumCollectedGross)}
                      </TableCell>
                      <TableCell className={`text-right font-medium ${gainClass(row.optionRealizedPnl)}`}>
                        {formatCurrency(row.optionRealizedPnl)}
                      </TableCell>
                      <TableCell
                        className={`text-right font-medium ${
                          row.optionsGainPct == null ? "" : gainClass(row.optionsGainPct)
                        }`}
                      >
                        {formatPctOrDash(row.optionsGainPct)}
                      </TableCell>
                      <TableCell className={`text-right font-medium ${gainClass(row.totalRealizedPnl)}`}>
                        {formatCurrency(row.totalRealizedPnl)}
                      </TableCell>
                      <TableCell
                        className={`text-right font-medium ${
                          row.totalGainPct == null ? "" : gainClass(row.totalGainPct)
                        }`}
                      >
                        {formatPctOrDash(row.totalGainPct)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Open Option Legs</CardTitle>
              <CardDescription>
                Open contracts. Short legs show the credit collected; long legs show the debit paid.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <SortableHead
                      label="Symbol"
                      sortKey="symbol"
                      activeKey={legSort.sortKey}
                      direction={legSort.direction}
                      onSort={legSort.toggle}
                      defaultDir="asc"
                    />
                    <SortableHead
                      label="Side"
                      sortKey="side"
                      activeKey={legSort.sortKey}
                      direction={legSort.direction}
                      onSort={legSort.toggle}
                      defaultDir="asc"
                    />
                    <SortableHead
                      label="Type"
                      sortKey="type"
                      activeKey={legSort.sortKey}
                      direction={legSort.direction}
                      onSort={legSort.toggle}
                      defaultDir="asc"
                    />
                    <SortableHead
                      label="Strike"
                      sortKey="strike"
                      activeKey={legSort.sortKey}
                      direction={legSort.direction}
                      onSort={legSort.toggle}
                    />
                    <SortableHead
                      label="Expiration"
                      sortKey="expiration"
                      activeKey={legSort.sortKey}
                      direction={legSort.direction}
                      onSort={legSort.toggle}
                      defaultDir="asc"
                    />
                    <SortableHead
                      label="Contracts"
                      sortKey="contracts"
                      activeKey={legSort.sortKey}
                      direction={legSort.direction}
                      onSort={legSort.toggle}
                      align="right"
                    />
                    <SortableHead
                      label="Net cash at open"
                      sortKey="netCashAtOpen"
                      activeKey={legSort.sortKey}
                      direction={legSort.direction}
                      onSort={legSort.toggle}
                      align="right"
                    />
                    <SortableHead
                      label="Opened"
                      sortKey="activityDate"
                      activeKey={legSort.sortKey}
                      direction={legSort.direction}
                      onSort={legSort.toggle}
                      defaultDir="asc"
                    />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sortedOpenLegs.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={8} className="py-8 text-center text-muted-foreground">
                        No open option positions.
                      </TableCell>
                    </TableRow>
                  ) : (
                    sortedOpenLegs.map(({ symbol, leg }, idx) => (
                      <TableRow key={`${symbol}-${idx}-${leg.type}-${leg.strike}-${leg.expiration}`}>
                        <TableCell className="font-medium">{symbol}</TableCell>
                        <TableCell className="capitalize">{leg.side}</TableCell>
                        <TableCell className="capitalize">{leg.type}</TableCell>
                        <TableCell>{formatCurrency(leg.strike)}</TableCell>
                        <TableCell>{leg.expiration}</TableCell>
                        <TableCell className="text-right tabular-nums">{leg.contracts}</TableCell>
                        <TableCell className={`text-right font-medium ${gainClass(leg.netCashAtOpen)}`}>
                          {formatCurrency(leg.netCashAtOpen)}
                        </TableCell>
                        <TableCell>{leg.activityDate}</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      )}

      <AlertDialog open={confirmClearOpen} onOpenChange={setConfirmClearOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Clear all brokerage activity?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes every imported CSV row for your account. Re-upload the
              monthly CSVs to rebuild.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={clearMutation.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                clearMutation.mutate();
              }}
              disabled={clearMutation.isPending}
            >
              {clearMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Clear
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function PeriodChart({ buckets }: { buckets: PeriodBucket[] }) {
  if (buckets.length === 0) {
    return (
      <div className="flex h-[260px] items-center justify-center text-muted-foreground">
        No activity to plot.
      </div>
    );
  }
  return (
    <ResponsiveContainer width="100%" height={280}>
      <BarChart data={buckets}>
        <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
        <XAxis dataKey="label" tick={{ fontSize: 12 }} />
        <YAxis tick={{ fontSize: 12 }} tickFormatter={(v) => `$${Math.round(v / 1000)}k`} />
        <Tooltip
          formatter={(v: number) => formatCurrency(v)}
          contentStyle={{
            backgroundColor: "hsl(var(--card))",
            border: "1px solid hsl(var(--border))",
            borderRadius: "8px",
            color: "#ffffff",
          }}
          itemStyle={{ color: "#ffffff" }}
          labelStyle={{ color: "#ffffff" }}
        />
        <Legend />
        <Bar dataKey="stockRealizedPnl" stackId="realized" fill="#22c55e" name="Stock realized" />
        <Bar dataKey="optionRealizedPnl" stackId="realized" fill="#6366f1" name="Option realized" />
        <Bar dataKey="dividends" stackId="realized" fill="#f59e0b" name="Dividends" />
        <Bar dataKey="optionPremiumCollected" fill="#06b6d4" name="Premium collected" />
      </BarChart>
    </ResponsiveContainer>
  );
}

type PeriodSortKey =
  | "period"
  | "stockRealizedPnl"
  | "optionPremiumCollected"
  | "optionRealizedPnl"
  | "dividends"
  | "stockBuyAmount"
  | "stockSellProceeds"
  | "netCashFlow";

function PeriodTable({ buckets }: { buckets: PeriodBucket[] }) {
  const { sortKey, direction, toggle } = useSort<PeriodSortKey>("period", "asc");
  const sorted = useMemo(() => {
    const copy = [...buckets];
    copy.sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      const cmp = compareValues(av, bv);
      return direction === "asc" ? cmp : -cmp;
    });
    return copy;
  }, [buckets, sortKey, direction]);

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <SortableHead
            label="Period"
            sortKey="period"
            activeKey={sortKey}
            direction={direction}
            onSort={toggle}
            defaultDir="asc"
          />
          <SortableHead
            label="Stock realized"
            sortKey="stockRealizedPnl"
            activeKey={sortKey}
            direction={direction}
            onSort={toggle}
            align="right"
          />
          <SortableHead
            label="Option premium"
            sortKey="optionPremiumCollected"
            activeKey={sortKey}
            direction={direction}
            onSort={toggle}
            align="right"
          />
          <SortableHead
            label="Option realized"
            sortKey="optionRealizedPnl"
            activeKey={sortKey}
            direction={direction}
            onSort={toggle}
            align="right"
          />
          <SortableHead
            label="Dividends"
            sortKey="dividends"
            activeKey={sortKey}
            direction={direction}
            onSort={toggle}
            align="right"
          />
          <SortableHead
            label="Stock bought"
            sortKey="stockBuyAmount"
            activeKey={sortKey}
            direction={direction}
            onSort={toggle}
            align="right"
          />
          <SortableHead
            label="Stock sold"
            sortKey="stockSellProceeds"
            activeKey={sortKey}
            direction={direction}
            onSort={toggle}
            align="right"
          />
          <SortableHead
            label="Net cash flow"
            sortKey="netCashFlow"
            activeKey={sortKey}
            direction={direction}
            onSort={toggle}
            align="right"
          />
        </TableRow>
      </TableHeader>
      <TableBody>
        {sorted.length === 0 ? (
          <TableRow>
            <TableCell colSpan={8} className="py-6 text-center text-muted-foreground">
              No data.
            </TableCell>
          </TableRow>
        ) : (
          sorted.map((b) => (
            <TableRow key={b.period}>
              <TableCell className="font-medium">{b.label}</TableCell>
              <TableCell className={`text-right font-medium ${gainClass(b.stockRealizedPnl)}`}>
                {formatCurrency(b.stockRealizedPnl)}
              </TableCell>
              <TableCell className="text-right">{formatCurrency(b.optionPremiumCollected)}</TableCell>
              <TableCell className={`text-right font-medium ${gainClass(b.optionRealizedPnl)}`}>
                {formatCurrency(b.optionRealizedPnl)}
              </TableCell>
              <TableCell className="text-right">{formatCurrency(b.dividends)}</TableCell>
              <TableCell className="text-right">{formatCurrency(b.stockBuyAmount)}</TableCell>
              <TableCell className="text-right">{formatCurrency(b.stockSellProceeds)}</TableCell>
              <TableCell className={`text-right font-medium ${gainClass(b.netCashFlow)}`}>
                {formatCurrency(b.netCashFlow)}
              </TableCell>
            </TableRow>
          ))
        )}
      </TableBody>
    </Table>
  );
}
