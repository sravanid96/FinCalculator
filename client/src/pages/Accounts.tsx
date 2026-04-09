import { useState, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  Plus,
  Upload,
  RefreshCw,
  MoreHorizontal,
  Trash2,
  Building2,
  CreditCard,
  PiggyBank,
  TrendingUp,
  Wallet,
  Link2,
  AlertCircle,
  CheckCircle2,
  Download,
  FileText,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/EmptyState";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { FINANCE_API_SOURCE } from "@/lib/financeDataSource";
import { formatCurrency, getRelativeTime } from "@/lib/formatters";
import type { Account } from "@shared/schema";

interface AccountsResponse {
  accounts: Account[];
}

const ACCOUNT_TYPES = [
  { value: "checking", label: "Checking", icon: Wallet },
  { value: "savings", label: "Savings", icon: PiggyBank },
  { value: "credit", label: "Credit Card", icon: CreditCard },
  { value: "investment", label: "Investment", icon: TrendingUp },
];

const getAccountIcon = (type: string) => {
  const accountType = ACCOUNT_TYPES.find((t) => t.value === type);
  return accountType?.icon || Wallet;
};

export default function Accounts() {
  const { toast } = useToast();
  const [isManualOpen, setIsManualOpen] = useState(false);
  const [isUploadOpen, setIsUploadOpen] = useState(false);
  const [deletingAccount, setDeletingAccount] = useState<Account | null>(null);
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [manualForm, setManualForm] = useState({
    institutionName: "",
    accountName: "",
    accountType: "checking",
    currentBalance: "",
  });

  const { data, isLoading } = useQuery<AccountsResponse>({
    queryKey: ["/api/accounts", { source: FINANCE_API_SOURCE }],
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
      const res = await fetch(`/api/accounts?${params.toString()}`, {
        credentials: "include",
        headers,
      });
      if (!res.ok) throw new Error("Failed to fetch accounts");
      return res.json();
    },
  });

  const createManualMutation = useMutation({
    mutationFn: async (data: typeof manualForm) => {
      const balance = data.currentBalance ? parseFloat(data.currentBalance) : 0;
      if (isNaN(balance)) {
        throw new Error("Invalid balance amount");
      }
      const response = await apiRequest("POST", "/api/accounts/manual", {
        institutionName: data.institutionName,
        accountName: data.accountName,
        accountType: data.accountType,
        currentBalance: String(balance),
      });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/accounts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/accounts/summary"] });
      setIsManualOpen(false);
      setManualForm({
        institutionName: "",
        accountName: "",
        accountType: "checking",
        currentBalance: "",
      });
      toast({ title: "Account added successfully" });
    },
    onError: (error: any) => {
      const errorMessage = error?.message || "Failed to add account";
      toast({ 
        title: "Failed to add account", 
        description: errorMessage,
        variant: "destructive" 
      });
    },
  });

  const [uploadDestination, setUploadDestination] = useState<"cloud" | "local" | "both">("cloud");
  const [convertedCsv, setConvertedCsv] = useState<string | null>(null);
  const [convertedFileName, setConvertedFileName] = useState<string | null>(null);
  const [isConverting, setIsConverting] = useState(false);

  const convertPdfMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append("file", file);
      const token = localStorage.getItem("auth_token");
      const headers: Record<string, string> = {};
      if (token) {
        headers["Authorization"] = `Bearer ${token}`;
      }
      const response = await fetch("/api/transactions/convert-pdf", {
        method: "POST",
        headers,
        body: formData,
        credentials: "include",
      });
      if (!response.ok) {
        const error = await response.json().catch(() => ({ message: "Conversion failed" }));
        throw new Error(error.message || "Conversion failed");
      }
      const csvContent = await response.text();
      const contentDisposition = response.headers.get("Content-Disposition");
      let fileName = file.name.replace(/\.pdf$/i, '') + "_converted.csv";
      if (contentDisposition) {
        const match = contentDisposition.match(/filename="?([^"]+)"?/);
        if (match) {
          fileName = match[1];
        }
      }
      return { csvContent, fileName };
    },
    onSuccess: (result) => {
      setConvertedCsv(result.csvContent);
      setConvertedFileName(result.fileName);
      toast({
        title: "PDF converted successfully",
        description: "You can now download the CSV or use it for import.",
      });
    },
    onError: (error: any) => {
      toast({ 
        title: "Failed to convert PDF", 
        description: error.message,
        variant: "destructive" 
      });
    },
  });

  const handleConvertPdf = () => {
    if (csvFile && (csvFile.type === "application/pdf" || csvFile.name.endsWith(".pdf"))) {
      setIsConverting(true);
      convertPdfMutation.mutate(csvFile, {
        onSettled: () => setIsConverting(false),
      });
    } else {
      toast({
        title: "Invalid file",
        description: "Please select a PDF file to convert.",
        variant: "destructive",
      });
    }
  };

  const handleDownloadCsv = () => {
    if (convertedCsv && convertedFileName) {
      const blob = new Blob([convertedCsv], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = convertedFileName;
      a.click();
      URL.revokeObjectURL(url);
      toast({
        title: "CSV downloaded",
        description: `Saved as ${convertedFileName}`,
      });
    }
  };

  const uploadMutation = useMutation({
    mutationFn: async (data: { file: File; destination: "cloud" | "local" | "both"; useConvertedCsv?: boolean }) => {
      const formData = new FormData();
      
      // If we have a converted CSV and user wants to use it, create a File from it
      if (data.useConvertedCsv && convertedCsv && convertedFileName) {
        const csvBlob = new Blob([convertedCsv], { type: "text/csv" });
        const csvFile = new File([csvBlob], convertedFileName, { type: "text/csv" });
        formData.append("file", csvFile);
      } else {
        formData.append("file", data.file);
      }
      
      formData.append("destination", data.destination);
      const token = localStorage.getItem("auth_token");
      const headers: Record<string, string> = {};
      if (token) {
        headers["Authorization"] = `Bearer ${token}`;
      }
      const response = await fetch("/api/transactions/upload", {
        method: "POST",
        headers,
        body: formData,
        credentials: "include",
      });
      if (!response.ok) {
        const error = await response.json().catch(() => ({ message: "Upload failed" }));
        throw new Error(error.message || "Upload failed");
      }
      return response.json();
    },
    onSuccess: async (result) => {
      // Invalidate all transaction-related queries
      await queryClient.invalidateQueries({ 
        predicate: (query) => {
          const key = query.queryKey[0];
          return typeof key === "string" && (
            key === "/api/transactions" ||
            key.startsWith("/api/transactions/") ||
            key.startsWith("/api/analytics") ||
            key === "/api/accounts/summary"
          );
        }
      });
      
      // Force refetch all transaction queries
      await queryClient.refetchQueries({ 
        predicate: (query) => {
          const key = query.queryKey[0];
          return typeof key === "string" && (
            key === "/api/transactions" ||
            key.startsWith("/api/transactions/") ||
            key.startsWith("/api/analytics")
          );
        }
      });
      
      // Invalidate and refetch accounts
      await queryClient.invalidateQueries({ queryKey: ["/api/accounts"] });
      await queryClient.invalidateQueries({ queryKey: ["/api/accounts/summary"] });
      await queryClient.refetchQueries({ queryKey: ["/api/accounts"] });
      await queryClient.refetchQueries({ queryKey: ["/api/accounts/summary"] });
      
      setIsUploadOpen(false);
      setCsvFile(null);
      setUploadDestination("cloud"); // Reset to default
      
      let description = "";
      if (result.destination === "cloud") {
        description = `${result.cloudImported} transactions imported to cloud database.`;
      } else if (result.destination === "local") {
        description = `${result.localImported} transactions imported to local database.`;
      } else {
        description = `${result.cloudImported} to cloud, ${result.localImported} to local database.`;
      }
      
      toast({
        title: "Transactions imported",
        description,
      });
    },
    onError: () => {
      toast({ title: "Failed to import transactions", variant: "destructive" });
    },
  });

  const syncMutation = useMutation({
    mutationFn: async (accountId: string) => {
      await apiRequest("POST", `/api/accounts/${accountId}/sync`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/accounts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/transactions"] });
      toast({ title: "Account synced successfully" });
    },
    onError: () => {
      toast({ title: "Failed to sync account", variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/accounts/${id}?source=${FINANCE_API_SOURCE}`);
    },
    onSuccess: async () => {
      // Invalidate and refetch all related queries
      await queryClient.invalidateQueries({ queryKey: ["/api/accounts"] });
      await queryClient.invalidateQueries({ queryKey: ["/api/accounts/summary"] });
      await queryClient.invalidateQueries({ queryKey: ["/api/transactions"] });
      await queryClient.invalidateQueries({ queryKey: ["/api/analytics"] });
      await queryClient.invalidateQueries({ queryKey: ["/api/reports"] });
      
      // Force refetch
      await queryClient.refetchQueries({ queryKey: ["/api/accounts"] });
      await queryClient.refetchQueries({ queryKey: ["/api/accounts/summary"] });
      await queryClient.refetchQueries({ queryKey: ["/api/transactions"] });
      await queryClient.refetchQueries({ queryKey: ["/api/analytics"] });
      await queryClient.refetchQueries({ queryKey: ["/api/reports"] });
      
      setDeletingAccount(null);
      toast({ title: "Account removed" });
    },
    onError: () => {
      toast({ title: "Failed to remove account", variant: "destructive" });
    },
  });

  const handleConnectPlaid = useCallback(async () => {
    try {
      // Load Plaid Link script if not already loaded
      if (!(window as any).Plaid) {
        const script = document.createElement("script");
        script.src = "https://cdn.plaid.com/link/v2/stable/link-initialize.js";
        script.async = true;
        document.head.appendChild(script);
        
        await new Promise((resolve, reject) => {
          script.onload = resolve;
          script.onerror = reject;
          setTimeout(reject, 10000); // 10 second timeout
        });
      }

      // Get link token from backend
      const token = localStorage.getItem("auth_token");
      const headers: Record<string, string> = {};
      if (token) {
        headers["Authorization"] = `Bearer ${token}`;
      }

      const linkTokenRes = await fetch("/api/plaid/link-token", {
        method: "POST",
        headers,
        credentials: "include",
      });

      if (!linkTokenRes.ok) {
        const error = await linkTokenRes.json().catch(() => ({ message: "Failed to get link token" }));
        throw new Error(error.message || "Failed to get link token");
      }

      const { link_token } = await linkTokenRes.json();

      // Initialize Plaid Link
      const handler = (window as any).Plaid.create({
        token: link_token,
        onSuccess: async (publicToken: string, metadata: any) => {
          try {
            // Exchange public token for access token
            const exchangeRes = await fetch("/api/plaid/exchange-token", {
              method: "POST",
              headers: {
                ...headers,
                "Content-Type": "application/json",
              },
              credentials: "include",
              body: JSON.stringify({ public_token: publicToken }),
            });

            if (!exchangeRes.ok) {
              const error = await exchangeRes.json().catch(() => ({ message: "Failed to connect account" }));
              throw new Error(error.message || "Failed to connect account");
            }

            const result = await exchangeRes.json();

            // Invalidate queries to refresh account list
            queryClient.invalidateQueries({ queryKey: ["/api/accounts"] });
            queryClient.invalidateQueries({ queryKey: ["/api/accounts/summary"] });
            queryClient.invalidateQueries({ queryKey: ["/api/transactions"] });
            queryClient.invalidateQueries({ queryKey: ["/api/analytics"] });

            toast({
              title: "Account connected",
              description: result.message || `Successfully connected ${result.accounts?.length || 0} account(s)`,
            });
          } catch (error: any) {
            toast({
              title: "Failed to connect account",
              description: error.message || "An error occurred",
              variant: "destructive",
            });
          }
        },
        onExit: (err: any, metadata: any) => {
          if (err) {
            toast({
              title: "Connection cancelled",
              description: err.display_message || "The connection was cancelled",
              variant: "destructive",
            });
          }
        },
        onEvent: (eventName: string, metadata: any) => {
          // Optional: handle events for analytics
          console.log("Plaid event:", eventName, metadata);
        },
      });

      handler.open();
    } catch (error: any) {
      toast({
        title: "Failed to connect account",
        description: error.message || "Plaid is not configured. Please set up Plaid API credentials.",
        variant: "destructive",
      });
    }
  }, [toast]);

  const totalBalance = data?.accounts.reduce(
    (sum, acc) => sum + parseFloat(acc.currentBalance || "0"),
    0
  ) || 0;

  return (
    <div className="flex-1 space-y-6 overflow-auto p-4 sm:p-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold">Accounts</h1>
          <p className="text-muted-foreground">
            Connect and manage your financial accounts
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={handleConnectPlaid} className="gap-2" data-testid="button-connect-plaid">
            <Link2 className="h-4 w-4" />
            Connect Bank
          </Button>
          <Dialog open={isManualOpen} onOpenChange={setIsManualOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" className="gap-2" data-testid="button-add-manual">
                <Plus className="h-4 w-4" />
                Add Manual
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Add Manual Account</DialogTitle>
                <DialogDescription>
                  Manually track an account that can't be connected automatically.
                </DialogDescription>
              </DialogHeader>
              <div className="grid gap-4 py-4">
                <div className="grid gap-2">
                  <Label htmlFor="institution">Institution Name</Label>
                  <Input
                    id="institution"
                    value={manualForm.institutionName}
                    onChange={(e) =>
                      setManualForm({ ...manualForm, institutionName: e.target.value })
                    }
                    placeholder="Bank of America"
                    data-testid="input-institution"
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="accountName">Account Name</Label>
                  <Input
                    id="accountName"
                    value={manualForm.accountName}
                    onChange={(e) =>
                      setManualForm({ ...manualForm, accountName: e.target.value })
                    }
                    placeholder="Personal Checking"
                    data-testid="input-account-name"
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="type">Account Type</Label>
                  <Select
                    value={manualForm.accountType}
                    onValueChange={(value) =>
                      setManualForm({ ...manualForm, accountType: value })
                    }
                  >
                    <SelectTrigger data-testid="select-account-type">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ACCOUNT_TYPES.map((type) => (
                        <SelectItem key={type.value} value={type.value}>
                          {type.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="balance">Current Balance</Label>
                  <Input
                    id="balance"
                    type="number"
                    step="0.01"
                    value={manualForm.currentBalance}
                    onChange={(e) =>
                      setManualForm({ ...manualForm, currentBalance: e.target.value })
                    }
                    placeholder="0.00"
                    data-testid="input-balance"
                  />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setIsManualOpen(false)}>
                  Cancel
                </Button>
                <Button
                  onClick={() => createManualMutation.mutate(manualForm)}
                  disabled={
                    !manualForm.institutionName ||
                    !manualForm.accountName ||
                    createManualMutation.isPending
                  }
                  data-testid="button-save-account"
                >
                  {createManualMutation.isPending ? "Adding..." : "Add Account"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          <Dialog open={isUploadOpen} onOpenChange={setIsUploadOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" className="gap-2" data-testid="button-upload-csv">
                <Upload className="h-4 w-4" />
                Upload CSV/PDF
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Upload Transactions</DialogTitle>
                <DialogDescription>
                  Import transactions from a CSV file or PDF statement exported from your bank.
                </DialogDescription>
              </DialogHeader>
              <div className="grid gap-4 py-4">
                <div className="grid gap-2">
                  <Label htmlFor="csvFile">CSV or PDF File</Label>
                  <Input
                    id="csvFile"
                    type="file"
                    accept=".csv,.pdf"
                    onChange={(e) => {
                      const file = e.target.files?.[0] || null;
                      setCsvFile(file);
                      // Reset converted CSV when file changes
                      if (file) {
                        setConvertedCsv(null);
                        setConvertedFileName(null);
                      }
                    }}
                    data-testid="input-csv-file"
                  />
                  {csvFile && (csvFile.type === "application/pdf" || csvFile.name.endsWith(".pdf")) && (
                    <div className="flex gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        onClick={handleConvertPdf}
                        disabled={isConverting || convertPdfMutation.isPending}
                        className="flex-1 gap-2"
                      >
                        <FileText className="h-4 w-4" />
                        {isConverting || convertPdfMutation.isPending ? "Converting..." : "Convert PDF to CSV"}
                      </Button>
                      {convertedCsv && convertedFileName && (
                        <Button
                          type="button"
                          variant="outline"
                          onClick={handleDownloadCsv}
                          className="gap-2"
                        >
                          <Download className="h-4 w-4" />
                          Download CSV
                        </Button>
                      )}
                    </div>
                  )}
                  {convertedCsv && (
                    <div className="rounded-lg bg-green-50 dark:bg-green-950 p-3 border border-green-200 dark:border-green-800">
                      <p className="text-sm text-green-800 dark:text-green-200">
                        ✓ PDF converted successfully! You can download the CSV or proceed with import.
                      </p>
                    </div>
                  )}
                </div>
                <div className="grid gap-3">
                  <Label>Upload Destination</Label>
                  <div className="space-y-2">
                    <label className="flex items-center space-x-2 cursor-pointer">
                      <input
                        type="radio"
                        name="uploadDestination"
                        value="cloud"
                        checked={uploadDestination === "cloud"}
                        onChange={(e) => setUploadDestination(e.target.value as "cloud" | "local" | "both")}
                        className="h-4 w-4"
                      />
                      <div className="flex-1">
                        <span className="text-sm font-medium">Cloud Database Only</span>
                        <p className="text-xs text-muted-foreground">
                          Save to your cloud PostgreSQL database (Neon, Supabase, etc.)
                        </p>
                      </div>
                    </label>
                    <label className="flex items-center space-x-2 cursor-pointer">
                      <input
                        type="radio"
                        name="uploadDestination"
                        value="local"
                        checked={uploadDestination === "local"}
                        onChange={(e) => setUploadDestination(e.target.value as "cloud" | "local" | "both")}
                        className="h-4 w-4"
                      />
                      <div className="flex-1">
                        <span className="text-sm font-medium">Local Database Only</span>
                        <p className="text-xs text-muted-foreground">
                          Save to your local PostgreSQL database (requires LOCAL_DATABASE_URL)
                        </p>
                      </div>
                    </label>
                    <label className="flex items-center space-x-2 cursor-pointer">
                      <input
                        type="radio"
                        name="uploadDestination"
                        value="both"
                        checked={uploadDestination === "both"}
                        onChange={(e) => setUploadDestination(e.target.value as "cloud" | "local" | "both")}
                        className="h-4 w-4"
                      />
                      <div className="flex-1">
                        <span className="text-sm font-medium">Both Databases</span>
                        <p className="text-xs text-muted-foreground">
                          Save to both cloud and local PostgreSQL databases
                        </p>
                      </div>
                    </label>
                  </div>
                </div>
                <div className="rounded-lg bg-muted p-4">
                  <p className="text-sm text-muted-foreground">
                    Your CSV should include columns for date, description, and
                    amount. We'll help you map the columns after upload.
                  </p>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setIsUploadOpen(false)}>
                  Cancel
                </Button>
                <Button
                  onClick={() => {
                    if (csvFile) {
                      // If we have a converted CSV from PDF, use it; otherwise use original file
                      const useConverted = convertedCsv && (csvFile.type === "application/pdf" || csvFile.name.endsWith(".pdf"));
                      uploadMutation.mutate({ 
                        file: csvFile, 
                        destination: uploadDestination,
                        useConvertedCsv: useConverted || false,
                      });
                    }
                  }}
                  disabled={!csvFile || uploadMutation.isPending}
                  data-testid="button-import"
                >
                  {uploadMutation.isPending ? "Importing..." : "Import"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <Card>
        <CardContent className="p-6">
          <div className="flex items-center gap-4">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
              <Wallet className="h-7 w-7 text-primary" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Total Balance</p>
              <p className="text-4xl font-bold tabular-nums" data-testid="text-total-balance">
                {formatCurrency(totalBalance)}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {[...Array(3)].map((_, i) => (
            <Card key={i}>
              <CardContent className="p-6">
                <div className="space-y-4">
                  <div className="flex items-center gap-4">
                    <div className="h-12 w-12 animate-pulse rounded-full bg-muted" />
                    <div className="flex-1 space-y-2">
                      <div className="h-5 w-32 animate-pulse rounded bg-muted" />
                      <div className="h-4 w-24 animate-pulse rounded bg-muted" />
                    </div>
                  </div>
                  <div className="h-8 w-28 animate-pulse rounded bg-muted" />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : data?.accounts && data.accounts.length > 0 ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {data.accounts.map((account) => {
            const Icon = getAccountIcon(account.accountType);
            const balance = parseFloat(account.currentBalance || "0");
            const isCredit = account.accountType === "credit";

            return (
              <Card key={account.id} data-testid={`card-account-${account.id}`}>
                <CardContent className="p-6">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-4">
                      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
                        <Icon className="h-6 w-6 text-muted-foreground" />
                      </div>
                      <div>
                        <h3 className="font-semibold">{account.accountName}</h3>
                        <p className="text-sm text-muted-foreground">
                          {account.institutionName}
                        </p>
                      </div>
                    </div>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" data-testid={`button-account-menu-${account.id}`}>
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        {!account.isManual && (
                          <DropdownMenuItem
                            onClick={() => syncMutation.mutate(account.id)}
                            disabled={syncMutation.isPending}
                          >
                            <RefreshCw className="mr-2 h-4 w-4" />
                            Sync Now
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          onClick={() => setDeletingAccount(account)}
                          className="text-destructive"
                        >
                          <Trash2 className="mr-2 h-4 w-4" />
                          Remove Account
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>

                  <div className="mt-4">
                    <p
                      className={`text-2xl font-bold tabular-nums ${
                        isCredit && balance > 0 ? "text-red-500" : ""
                      }`}
                    >
                      {isCredit && balance > 0 ? "-" : ""}
                      {formatCurrency(Math.abs(balance))}
                    </p>
                    {account.mask && (
                      <p className="text-sm text-muted-foreground">
                        ****{account.mask}
                      </p>
                    )}
                  </div>

                  <div className="mt-4 flex items-center justify-between">
                    <Badge variant={account.isManual ? "secondary" : "outline"}>
                      {account.isManual ? "Manual" : "Connected"}
                    </Badge>
                    {account.lastSynced && (
                      <span className="text-xs text-muted-foreground">
                        {getRelativeTime(account.lastSynced)}
                      </span>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      ) : (
        <EmptyState
          icon={Building2}
          title="No accounts connected"
          description="Connect your bank accounts or add them manually to start tracking your finances."
          actionLabel="Connect Bank"
          onAction={handleConnectPlaid}
        />
      )}

      <AlertDialog
        open={!!deletingAccount}
        onOpenChange={(open) => !open && setDeletingAccount(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove Account</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to remove "{deletingAccount?.accountName}"?
              All associated transactions will also be deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() =>
                deletingAccount && deleteMutation.mutate(deletingAccount.id)
              }
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="button-confirm-delete"
            >
              {deleteMutation.isPending ? "Removing..." : "Remove"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
