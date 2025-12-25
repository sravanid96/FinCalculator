import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { format, subDays, startOfMonth, endOfMonth, startOfYear, subYears } from "date-fns";
import { Search, Filter, Download, Plus, Calendar, X } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { TransactionRow, TransactionRowSkeleton } from "@/components/TransactionRow";
import { EmptyState } from "@/components/EmptyState";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import type { Transaction, Category, Account } from "@shared/schema";

interface TransactionsResponse {
  transactions: Array<
    Transaction & {
      category?: Category;
      account?: Account;
    }
  >;
  total: number;
}

interface CategoriesResponse {
  categories: Category[];
}

const DATE_FILTERS = [
  { value: "all", label: "All Time" },
  { value: "today", label: "Today" },
  { value: "7days", label: "Last 7 Days" },
  { value: "30days", label: "Last 30 Days" },
  { value: "thisMonth", label: "This Month" },
  { value: "lastMonth", label: "Last Month" },
  { value: "yearToDate", label: "Year to Date" },
  { value: "1year", label: "Last 1 Year" },
  { value: "lastYear", label: "Last Year" },
];

export default function Transactions() {
  const { toast } = useToast();
  const [searchQuery, setSearchQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [dateFilter, setDateFilter] = useState<string>("30days");
  const [editingTransaction, setEditingTransaction] = useState<Transaction | null>(null);
  const [editForm, setEditForm] = useState({
    description: "",
    categoryId: "",
    notes: "",
    isRecurring: false,
    tags: "",
  });

  const dateRange = useMemo(() => {
    const now = new Date();
    switch (dateFilter) {
      case "today":
        return { start: now, end: now };
      case "7days":
        return { start: subDays(now, 7), end: now };
      case "30days":
        return { start: subDays(now, 30), end: now };
      case "thisMonth":
        return { start: startOfMonth(now), end: endOfMonth(now) };
      case "lastMonth":
        const lastMonth = subDays(startOfMonth(now), 1);
        return { start: startOfMonth(lastMonth), end: endOfMonth(lastMonth) };
      case "yearToDate":
        return { start: startOfYear(now), end: now };
      case "1year":
        return { start: subDays(now, 365), end: now };
      case "lastYear":
        const lastYear = subYears(now, 1);
        return { start: startOfYear(lastYear), end: new Date(lastYear.getFullYear(), 11, 31) };
      default:
        return null;
    }
  }, [dateFilter]);

  const { data, isLoading, refetch } = useQuery<TransactionsResponse>({
    queryKey: [
      "/api/transactions",
      searchQuery || undefined,
      categoryFilter === "all" ? undefined : categoryFilter,
      dateRange?.start?.toISOString(),
      dateRange?.end?.toISOString(),
    ],
    queryFn: async ({ queryKey }) => {
      const baseUrl = queryKey[0] as string;
      const params = new URLSearchParams();
      
      if (queryKey[1]) params.append("search", queryKey[1] as string);
      if (queryKey[2]) params.append("categoryId", queryKey[2] as string);
      if (queryKey[3]) params.append("startDate", queryKey[3] as string);
      if (queryKey[4]) params.append("endDate", queryKey[4] as string);
      // Fetch from local database only for now (can be changed to "both" or "cloud")
      params.append("source", "local");
      
      const token = localStorage.getItem("auth_token");
      const headers: Record<string, string> = {};
      if (token) {
        headers["Authorization"] = `Bearer ${token}`;
      }
      
      const url = `${baseUrl}${params.toString() ? `?${params.toString()}` : ""}`;
      const res = await fetch(url, {
        credentials: "include",
        headers,
      });
      
      if (!res.ok) {
        throw new Error(`Failed to fetch transactions: ${res.statusText}`);
      }
      
      return res.json();
    },
  });

  const { data: categoriesData } = useQuery<CategoriesResponse>({
    queryKey: ["/api/categories"],
  });

  const updateMutation = useMutation({
    mutationFn: async (data: { id: string; updates: Partial<Transaction> }) => {
      // Add source=local parameter for local-only mode
      await apiRequest("PATCH", `/api/transactions/${data.id}?source=local`, data.updates);
    },
    onSuccess: async () => {
      // Invalidate all related queries using predicate to match all variations
      await queryClient.invalidateQueries({ 
        predicate: (query) => {
          const key = query.queryKey[0];
          return typeof key === "string" && (
            key === "/api/transactions" ||
            key.startsWith("/api/transactions/") ||
            key === "/api/analytics" ||
            key === "/api/reports" ||
            key === "/api/accounts/summary" ||
            key === "/api/accounts" ||
            key === "/api/transactions/recent"
          );
        }
      });
      
      // Force refetch all related queries
      await queryClient.refetchQueries({ 
        predicate: (query) => {
          const key = query.queryKey[0];
          return typeof key === "string" && (
            key === "/api/transactions" ||
            key.startsWith("/api/transactions/") ||
            key === "/api/analytics" ||
            key === "/api/reports" ||
            key === "/api/accounts/summary" ||
            key === "/api/transactions/recent"
          );
        }
      });
      
      setEditingTransaction(null);
      toast({ title: "Transaction updated" });
    },
    onError: (error: any) => {
      console.error("Error updating transaction:", error);
      toast({ 
        title: "Failed to update transaction", 
        description: error?.message || "Please try again",
        variant: "destructive" 
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      // Add source=local parameter for local-only mode
      await apiRequest("DELETE", `/api/transactions/${id}?source=local`);
    },
    onSuccess: async () => {
      // Invalidate all related queries using predicate to match all variations
      await queryClient.invalidateQueries({ 
        predicate: (query) => {
          const key = query.queryKey[0];
          return typeof key === "string" && (
            key === "/api/transactions" ||
            key.startsWith("/api/transactions/") ||
            key === "/api/analytics" ||
            key === "/api/reports" ||
            key === "/api/accounts/summary" ||
            key === "/api/accounts" ||
            key === "/api/transactions/recent"
          );
        }
      });
      
      // Force refetch all related queries
      await queryClient.refetchQueries({ 
        predicate: (query) => {
          const key = query.queryKey[0];
          return typeof key === "string" && (
            key === "/api/transactions" ||
            key.startsWith("/api/transactions/") ||
            key === "/api/analytics" ||
            key === "/api/reports" ||
            key === "/api/accounts/summary" ||
            key === "/api/transactions/recent"
          );
        }
      });
      
      toast({ title: "Transaction deleted" });
    },
    onError: () => {
      toast({ title: "Failed to delete transaction", variant: "destructive" });
    },
  });

  const handleEdit = (transaction: Transaction) => {
    setEditingTransaction(transaction);
    setEditForm({
      description: transaction.description,
      categoryId: transaction.categoryId || "",
      notes: transaction.notes || "",
      isRecurring: transaction.isRecurring || false,
      tags: transaction.tags?.join(", ") || "",
    });
  };

  const handleCategoryChange = (transaction: Transaction) => {
    // Open edit dialog with category focused
    handleEdit(transaction);
  };

  const handleSaveEdit = () => {
    if (!editingTransaction) return;
    updateMutation.mutate({
      id: editingTransaction.id,
      updates: {
        description: editForm.description,
        categoryId: editForm.categoryId || null,
        notes: editForm.notes || null,
        isRecurring: editForm.isRecurring,
        tags: editForm.tags
          ? editForm.tags.split(",").map((t) => t.trim())
          : null,
      },
    });
  };

  const handleExport = () => {
    const transactions = data?.transactions || [];
    const csv = [
      ["Date", "Description", "Amount", "Category", "Account", "Notes"].join(","),
      ...transactions.map((t) =>
        [
          format(new Date(t.date), "yyyy-MM-dd"),
          `"${t.description.replace(/"/g, '""')}"`,
          t.amount,
          t.category?.name || "",
          t.account?.accountName || "",
          `"${(t.notes || "").replace(/"/g, '""')}"`,
        ].join(",")
      ),
    ].join("\n");

    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `transactions-${format(new Date(), "yyyy-MM-dd")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const filteredTransactions = useMemo(() => {
    let result = data?.transactions || [];

    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      result = result.filter(
        (t) =>
          t.description.toLowerCase().includes(query) ||
          t.merchantName?.toLowerCase().includes(query) ||
          t.category?.name.toLowerCase().includes(query)
      );
    }

    if (categoryFilter && categoryFilter !== "all") {
      result = result.filter((t) => t.categoryId === categoryFilter);
    }

    return result;
  }, [data?.transactions, searchQuery, categoryFilter]);

  const totalAmount = useMemo(() => {
    return filteredTransactions.reduce(
      (sum, t) => sum + Math.abs(parseFloat(t.amount)),
      0
    );
  }, [filteredTransactions]);

  return (
    <div className="flex-1 space-y-6 overflow-auto p-4 sm:p-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold">Transactions</h1>
          <p className="text-muted-foreground">
            View and manage all your transactions
          </p>
        </div>
        <Button onClick={handleExport} variant="outline" className="gap-2" data-testid="button-export">
          <Download className="h-4 w-4" />
          Export CSV
        </Button>
      </div>

      <Card>
        <CardHeader className="pb-4">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search transactions..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10"
                data-testid="input-search"
              />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Select value={dateFilter} onValueChange={setDateFilter}>
                <SelectTrigger className="w-[140px]" data-testid="select-date-filter">
                  <Calendar className="mr-2 h-4 w-4" />
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DATE_FILTERS.map((filter) => (
                    <SelectItem key={filter.value} value={filter.value}>
                      {filter.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                <SelectTrigger className="w-[160px]" data-testid="select-category-filter">
                  <Filter className="mr-2 h-4 w-4" />
                  <SelectValue placeholder="Category" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Categories</SelectItem>
                  {categoriesData?.categories.map((category) => (
                    <SelectItem key={category.id} value={category.id}>
                      {category.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>

        <CardContent className="p-0">
          {isLoading ? (
            <div className="divide-y">
              {[...Array(10)].map((_, i) => (
                <TransactionRowSkeleton key={i} />
              ))}
            </div>
          ) : filteredTransactions.length > 0 ? (
            <>
              <div className="divide-y">
                {filteredTransactions.map((transaction) => (
                  <TransactionRow
                    key={transaction.id}
                    transaction={transaction}
                    category={transaction.category}
                    account={transaction.account}
                    onEdit={handleEdit}
                    onCategoryChange={handleCategoryChange}
                    onDelete={(t) => deleteMutation.mutate(t.id)}
                  />
                ))}
              </div>
              <div className="flex items-center justify-between border-t px-4 py-3 text-sm text-muted-foreground">
                <span>
                  Showing {filteredTransactions.length} of {data?.total || 0}{" "}
                  transactions
                </span>
                <span className="font-medium">
                  Total: ${totalAmount.toFixed(2)}
                </span>
              </div>
            </>
          ) : (
            <EmptyState
              icon={Search}
              title="No transactions found"
              description={
                searchQuery || categoryFilter !== "all"
                  ? "Try adjusting your search or filters"
                  : "Connect an account or upload a CSV to see your transactions"
              }
            />
          )}
        </CardContent>
      </Card>

      <Dialog
        open={!!editingTransaction}
        onOpenChange={(open) => !open && setEditingTransaction(null)}
      >
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Edit Transaction</DialogTitle>
            <DialogDescription>
              Make changes to your transaction details.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="description">Description</Label>
              <Input
                id="description"
                value={editForm.description}
                onChange={(e) =>
                  setEditForm({ ...editForm, description: e.target.value })
                }
                data-testid="input-edit-description"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="category">Category</Label>
              <Select
                value={editForm.categoryId}
                onValueChange={(value) =>
                  setEditForm({ ...editForm, categoryId: value })
                }
              >
                <SelectTrigger data-testid="select-edit-category">
                  <SelectValue placeholder="Select category" />
                </SelectTrigger>
                <SelectContent>
                  {categoriesData?.categories.map((category) => (
                    <SelectItem key={category.id} value={category.id}>
                      {category.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="notes">Notes</Label>
              <Textarea
                id="notes"
                value={editForm.notes}
                onChange={(e) =>
                  setEditForm({ ...editForm, notes: e.target.value })
                }
                placeholder="Add notes..."
                data-testid="input-edit-notes"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="tags">Tags (comma separated)</Label>
              <Input
                id="tags"
                value={editForm.tags}
                onChange={(e) =>
                  setEditForm({ ...editForm, tags: e.target.value })
                }
                placeholder="vacation, work, personal"
                data-testid="input-edit-tags"
              />
            </div>
            <div className="flex items-center justify-between">
              <Label htmlFor="recurring">Recurring Transaction</Label>
              <Switch
                id="recurring"
                checked={editForm.isRecurring}
                onCheckedChange={(checked) =>
                  setEditForm({ ...editForm, isRecurring: checked })
                }
                data-testid="switch-edit-recurring"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setEditingTransaction(null)}
            >
              Cancel
            </Button>
            <Button
              onClick={handleSaveEdit}
              disabled={updateMutation.isPending}
              data-testid="button-save-edit"
            >
              {updateMutation.isPending ? "Saving..." : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
