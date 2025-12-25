import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  TrendingUp,
  TrendingDown,
  Wallet,
  PiggyBank,
  CreditCard,
  ArrowUpRight,
  ArrowDownRight,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { MetricCard } from "@/components/MetricCard";
import { TransactionRow, TransactionRowSkeleton } from "@/components/TransactionRow";
import { EmptyState } from "@/components/EmptyState";
import { formatCurrency } from "@/lib/formatters";
import { TIME_PERIODS, type TimePeriod } from "@shared/schema";
import {
  PieChart,
  Pie,
  Cell,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { Link } from "wouter";

interface AnalyticsData {
  totalIncome: number;
  totalExpenses: number;
  netCashFlow: number;
  savingsRate: number;
  previousIncome?: number;
  previousExpenses?: number;
  previousNetCashFlow?: number;
  categoryBreakdown: Array<{
    name: string;
    value: number;
    color: string;
  }>;
  cashFlowTrend: Array<{
    date: string;
    income: number;
    expenses: number;
  }>;
}

interface RecentTransactionsData {
  transactions: Array<{
    id: string;
    description: string;
    amount: string;
    date: string;
    isIncome: boolean;
    category?: { name: string; color: string };
    account?: { accountName: string };
  }>;
}

const CHART_COLORS = [
  "#6366f1",
  "#8b5cf6",
  "#ec4899",
  "#f43f5e",
  "#f59e0b",
  "#10b981",
  "#06b6d4",
  "#3b82f6",
];

export default function Dashboard() {
  const [timePeriod, setTimePeriod] = useState<TimePeriod>("current_month");

  const { data: analytics, isLoading: analyticsLoading } = useQuery<AnalyticsData>({
    queryKey: ["/api/analytics", { period: timePeriod, source: "local" }],
    queryFn: async ({ queryKey }) => {
      const params = new URLSearchParams();
      if (queryKey[1] && typeof queryKey[1] === 'object' && 'period' in queryKey[1]) {
        params.append("period", (queryKey[1] as { period: string }).period);
      }
      if (queryKey[1] && typeof queryKey[1] === 'object' && 'source' in queryKey[1]) {
        params.append("source", (queryKey[1] as { source: string }).source);
      }
      const token = localStorage.getItem("auth_token");
      const headers: Record<string, string> = {};
      if (token) {
        headers["Authorization"] = `Bearer ${token}`;
      }
      const res = await fetch(`/api/analytics?${params.toString()}`, {
        credentials: "include",
        headers,
      });
      if (!res.ok) throw new Error("Failed to fetch analytics");
      return res.json();
    },
  });

  const { data: recentData, isLoading: transactionsLoading } = useQuery<RecentTransactionsData>({
    queryKey: ["/api/transactions/recent", { source: "local" }],
    queryFn: async ({ queryKey }) => {
      const params = new URLSearchParams();
      if (queryKey[1] && typeof queryKey[1] === 'object' && 'source' in queryKey[1]) {
        params.append("source", (queryKey[1] as { source: string }).source);
      }
      const token = localStorage.getItem("auth_token");
      const headers: Record<string, string> = {};
      if (token) {
        headers["Authorization"] = `Bearer ${token}`;
      }
      const res = await fetch(`/api/transactions/recent?${params.toString()}`, {
        credentials: "include",
        headers,
      });
      if (!res.ok) throw new Error("Failed to fetch recent transactions");
      return res.json();
    },
  });

  const { data: accountsData } = useQuery<{ totalBalance: number; accountCount: number }>({
    queryKey: ["/api/accounts/summary", { source: "local" }],
    queryFn: async ({ queryKey }) => {
      const params = new URLSearchParams();
      if (queryKey[1] && typeof queryKey[1] === 'object' && 'source' in queryKey[1]) {
        params.append("source", (queryKey[1] as { source: string }).source);
      }
      const token = localStorage.getItem("auth_token");
      const headers: Record<string, string> = {};
      if (token) {
        headers["Authorization"] = `Bearer ${token}`;
      }
      const res = await fetch(`/api/accounts/summary?${params.toString()}`, {
        credentials: "include",
        headers,
      });
      if (!res.ok) throw new Error("Failed to fetch account summary");
      return res.json();
    },
  });

  return (
    <div className="flex-1 space-y-6 overflow-auto p-4 sm:p-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold">Dashboard</h1>
          <p className="text-muted-foreground">
            Your financial overview at a glance
          </p>
        </div>
        <Select
          value={timePeriod}
          onValueChange={(value) => setTimePeriod(value as TimePeriod)}
        >
          <SelectTrigger className="w-[180px]" data-testid="select-time-period">
            <SelectValue placeholder="Select period" />
          </SelectTrigger>
          <SelectContent>
            {TIME_PERIODS.map((period) => (
              <SelectItem key={period.value} value={period.value}>
                {period.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          title="Total Income"
          value={analytics?.totalIncome || 0}
          previousValue={analytics?.previousIncome}
          icon={ArrowUpRight}
          loading={analyticsLoading}
        />
        <MetricCard
          title="Total Expenses"
          value={analytics?.totalExpenses || 0}
          previousValue={analytics?.previousExpenses}
          icon={ArrowDownRight}
          invertColors
          loading={analyticsLoading}
        />
        <MetricCard
          title="Net Cash Flow"
          value={analytics?.netCashFlow || 0}
          previousValue={analytics?.previousNetCashFlow}
          icon={TrendingUp}
          loading={analyticsLoading}
        />
        <MetricCard
          title="Savings Rate"
          value={analytics?.savingsRate || 0}
          icon={PiggyBank}
          format="percent"
          loading={analyticsLoading}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-7">
        <Card className="lg:col-span-4">
          <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
            <CardTitle className="text-lg">Cash Flow Trend</CardTitle>
          </CardHeader>
          <CardContent>
            {analyticsLoading ? (
              <div className="flex h-[300px] items-center justify-center">
                <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
              </div>
            ) : analytics?.cashFlowTrend && analytics.cashFlowTrend.length > 0 ? (
              <ResponsiveContainer width="100%" height={300}>
                <AreaChart data={analytics.cashFlowTrend}>
                  <defs>
                    <linearGradient id="colorIncome" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#22c55e" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#22c55e" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="colorExpenses" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#ef4444" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 12 }}
                    className="text-muted-foreground"
                  />
                  <YAxis
                    tick={{ fontSize: 12 }}
                    tickFormatter={(value) => `$${value / 1000}k`}
                    className="text-muted-foreground"
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "hsl(var(--card))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: "8px",
                    }}
                    formatter={(value: number) => formatCurrency(value)}
                  />
                  <Legend />
                  <Area
                    type="monotone"
                    dataKey="income"
                    stroke="#22c55e"
                    fill="url(#colorIncome)"
                    strokeWidth={2}
                    name="Income"
                  />
                  <Area
                    type="monotone"
                    dataKey="expenses"
                    stroke="#ef4444"
                    fill="url(#colorExpenses)"
                    strokeWidth={2}
                    name="Expenses"
                  />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex h-[300px] items-center justify-center text-muted-foreground">
                No data available for this period
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-3">
          <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
            <CardTitle className="text-lg">Spending by Category</CardTitle>
          </CardHeader>
          <CardContent>
            {analyticsLoading ? (
              <div className="flex h-[300px] items-center justify-center">
                <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
              </div>
            ) : analytics?.categoryBreakdown &&
              analytics.categoryBreakdown.length > 0 ? (
              <ResponsiveContainer width="100%" height={300}>
                <PieChart>
                  <Pie
                    data={analytics.categoryBreakdown}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={100}
                    paddingAngle={2}
                    dataKey="value"
                  >
                    {analytics.categoryBreakdown.map((entry, index) => (
                      <Cell
                        key={entry.name}
                        fill={entry.color || CHART_COLORS[index % CHART_COLORS.length]}
                      />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "hsl(var(--card))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: "8px",
                    }}
                    formatter={(value: number) => formatCurrency(value)}
                  />
                  <Legend
                    layout="vertical"
                    align="right"
                    verticalAlign="middle"
                    formatter={(value) => (
                      <span className="text-sm text-foreground">{value}</span>
                    )}
                  />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex h-[300px] items-center justify-center text-muted-foreground">
                No spending data available
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
            <CardTitle className="text-lg">Recent Transactions</CardTitle>
            <Link href="/transactions">
              <Button variant="ghost" size="sm" data-testid="button-view-all-transactions">
                View all
              </Button>
            </Link>
          </CardHeader>
          <CardContent className="p-0">
            {transactionsLoading ? (
              <div className="divide-y">
                {[...Array(5)].map((_, i) => (
                  <TransactionRowSkeleton key={i} />
                ))}
              </div>
            ) : recentData?.transactions && recentData.transactions.length > 0 ? (
              <div className="divide-y">
                {recentData.transactions.slice(0, 5).map((tx) => (
                  <TransactionRow
                    key={tx.id}
                    transaction={tx as any}
                    category={tx.category as any}
                    account={tx.account as any}
                  />
                ))}
              </div>
            ) : (
              <EmptyState
                icon={CreditCard}
                title="No transactions yet"
                description="Connect an account or upload a CSV to see your transactions here."
                actionLabel="Add Account"
                onAction={() => (window.location.href = "/accounts")}
              />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-lg">Account Summary</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-6">
              <div className="flex items-center gap-4">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
                  <Wallet className="h-6 w-6 text-primary" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Total Balance</p>
                  <p
                    className="text-2xl font-bold tabular-nums"
                    data-testid="text-total-balance"
                  >
                    {formatCurrency(accountsData?.totalBalance || 0)}
                  </p>
                </div>
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Connected Accounts</span>
                  <span className="font-medium" data-testid="text-account-count">
                    {accountsData?.accountCount || 0}
                  </span>
                </div>
              </div>

              <Link href="/accounts">
                <Button variant="outline" className="w-full" data-testid="button-manage-accounts">
                  Manage Accounts
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
