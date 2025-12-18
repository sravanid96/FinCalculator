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
    queryKey: ["/api/accounts"],
  });

  const createManualMutation = useMutation({
    mutationFn: async (data: typeof manualForm) => {
      await apiRequest("POST", "/api/accounts/manual", {
        ...data,
        currentBalance: parseFloat(data.currentBalance) || 0,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/accounts"] });
      setIsManualOpen(false);
      setManualForm({
        institutionName: "",
        accountName: "",
        accountType: "checking",
        currentBalance: "",
      });
      toast({ title: "Account added successfully" });
    },
    onError: () => {
      toast({ title: "Failed to add account", variant: "destructive" });
    },
  });

  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append("file", file);
      const response = await fetch("/api/transactions/upload", {
        method: "POST",
        body: formData,
        credentials: "include",
      });
      if (!response.ok) {
        throw new Error("Upload failed");
      }
      return response.json();
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["/api/transactions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/accounts"] });
      setIsUploadOpen(false);
      setCsvFile(null);
      toast({
        title: "Transactions imported",
        description: `${result.imported} transactions imported successfully.`,
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
      await apiRequest("DELETE", `/api/accounts/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/accounts"] });
      setDeletingAccount(null);
      toast({ title: "Account removed" });
    },
    onError: () => {
      toast({ title: "Failed to remove account", variant: "destructive" });
    },
  });

  const handleConnectPlaid = useCallback(() => {
    toast({
      title: "Plaid Integration",
      description:
        "To connect bank accounts, you'll need to set up Plaid API keys. Check the settings page for more information.",
    });
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
                Upload CSV
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Upload Transactions</DialogTitle>
                <DialogDescription>
                  Import transactions from a CSV file exported from your bank.
                </DialogDescription>
              </DialogHeader>
              <div className="grid gap-4 py-4">
                <div className="grid gap-2">
                  <Label htmlFor="csvFile">CSV File</Label>
                  <Input
                    id="csvFile"
                    type="file"
                    accept=".csv"
                    onChange={(e) => setCsvFile(e.target.files?.[0] || null)}
                    data-testid="input-csv-file"
                  />
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
                  onClick={() => csvFile && uploadMutation.mutate(csvFile)}
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
