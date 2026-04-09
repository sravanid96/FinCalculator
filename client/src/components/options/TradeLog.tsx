import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import {
  ClipboardList,
  Loader2,
  Plus,
  Pencil,
  DoorOpen,
  Trash2,
  TrendingUp,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import type { TradeJournalEntry } from "@shared/schema";

interface TradeJournalStats {
  closedCount: number;
  openCount: number;
  winCount: number;
  lossCount: number;
  totalRealizedPnl: number;
  winRate: number | null;
  profitFactor: number | "infinite" | null;
}

interface TradeJournalResponse {
  entries: TradeJournalEntry[];
  stats: TradeJournalStats;
}

const defaultForm = {
  symbol: "",
  strategy: "",
  side: "long" as "long" | "short",
  instrumentType: "stock" as "stock" | "option" | "other",
  quantity: 1,
  contractMultiplier: "1",
  entryDate: format(new Date(), "yyyy-MM-dd"),
  entryPrice: "",
  exitDate: "",
  exitPrice: "",
  fees: "0",
  notes: "",
};

function num(s: string | null | undefined) {
  if (s == null || s === "") return NaN;
  return Number(s);
}

function formatMoney(n: number) {
  return new Intl.NumberFormat(undefined, { style: "currency", currency: "USD" }).format(n);
}

function isOpen(entry: TradeJournalEntry) {
  return entry.exitDate == null || entry.exitPrice == null;
}

export function TradeLog() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);
  const [closeOpen, setCloseOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [editEntry, setEditEntry] = useState<TradeJournalEntry | null>(null);
  const [closingEntry, setClosingEntry] = useState<TradeJournalEntry | null>(null);
  const [form, setForm] = useState(defaultForm);
  const [closeForm, setCloseForm] = useState({
    exitDate: format(new Date(), "yyyy-MM-dd"),
    exitPrice: "",
    fees: "",
  });

  const { data, isLoading, error } = useQuery<TradeJournalResponse>({
    queryKey: ["/api/trade-journal"],
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["/api/trade-journal"] });
  };

  const createMutation = useMutation({
    mutationFn: async (body: Record<string, unknown>) => {
      const res = await apiRequest("POST", "/api/trade-journal", body);
      return res.json() as Promise<{ entry: TradeJournalEntry; stats: TradeJournalStats }>;
    },
    onSuccess: () => {
      toast({ title: "Trade saved" });
      setAddOpen(false);
      setForm({ ...defaultForm, entryDate: format(new Date(), "yyyy-MM-dd") });
      invalidate();
    },
    onError: (e: Error) => toast({ title: "Could not save trade", description: e.message, variant: "destructive" }),
  });

  const patchMutation = useMutation({
    mutationFn: async ({ id, body }: { id: string; body: Record<string, unknown> }) => {
      const res = await apiRequest("PATCH", `/api/trade-journal/${id}`, body);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Trade updated" });
      setAddOpen(false);
      setCloseOpen(false);
      setClosingEntry(null);
      setEditEntry(null);
      invalidate();
    },
    onError: (e: Error) => toast({ title: "Update failed", description: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => apiRequest("DELETE", `/api/trade-journal/${id}`),
    onSuccess: () => {
      toast({ title: "Trade removed" });
      setDeleteId(null);
      invalidate();
    },
    onError: (e: Error) => toast({ title: "Delete failed", description: e.message, variant: "destructive" }),
  });

  const handleSubmitAdd = () => {
    const mult =
      form.instrumentType === "option" ? form.contractMultiplier || "100" : form.contractMultiplier || "1";
    const payload: Record<string, unknown> = {
      symbol: form.symbol.trim().toUpperCase(),
      strategy: form.strategy.trim() || null,
      side: form.side,
      instrumentType: form.instrumentType,
      quantity: form.quantity,
      contractMultiplier: mult,
      entryDate: new Date(form.entryDate + "T12:00:00").toISOString(),
      entryPrice: form.entryPrice,
      fees: form.fees || "0",
      notes: form.notes.trim() || null,
    };
    if (form.exitDate && form.exitPrice) {
      payload.exitDate = new Date(form.exitDate + "T12:00:00").toISOString();
      payload.exitPrice = form.exitPrice;
    }
    createMutation.mutate(payload);
  };

  const handleClosePosition = () => {
    if (!closingEntry) return;
    patchMutation.mutate({
      id: closingEntry.id,
      body: {
        exitDate: new Date(closeForm.exitDate + "T12:00:00").toISOString(),
        exitPrice: closeForm.exitPrice,
        ...(closeForm.fees !== "" ? { fees: closeForm.fees } : {}),
      },
    });
  };

  const openEdit = (e: TradeJournalEntry) => {
    setEditEntry(e);
    setForm({
      symbol: e.symbol,
      strategy: e.strategy ?? "",
      side: e.side as "long" | "short",
      instrumentType: e.instrumentType as "stock" | "option" | "other",
      quantity: e.quantity,
      contractMultiplier: String(e.contractMultiplier ?? "1"),
      entryDate: e.entryDate ? format(new Date(e.entryDate), "yyyy-MM-dd") : defaultForm.entryDate,
      entryPrice: String(e.entryPrice),
      exitDate: e.exitDate ? format(new Date(e.exitDate), "yyyy-MM-dd") : "",
      exitPrice: e.exitPrice != null ? String(e.exitPrice) : "",
      fees: String(e.fees ?? "0"),
      notes: e.notes ?? "",
    });
    setAddOpen(true);
  };

  const handleSubmitEdit = () => {
    if (!editEntry) return;
    const mult =
      form.instrumentType === "option" ? form.contractMultiplier || "100" : form.contractMultiplier || "1";
    const body: Record<string, unknown> = {
      symbol: form.symbol.trim().toUpperCase(),
      strategy: form.strategy.trim() || null,
      side: form.side,
      instrumentType: form.instrumentType,
      quantity: form.quantity,
      contractMultiplier: mult,
      entryDate: new Date(form.entryDate + "T12:00:00").toISOString(),
      entryPrice: form.entryPrice,
      fees: form.fees || "0",
      notes: form.notes.trim() || null,
    };
    if (form.exitDate && form.exitPrice) {
      body.exitDate = new Date(form.exitDate + "T12:00:00").toISOString();
      body.exitPrice = form.exitPrice;
    } else {
      body.exitDate = null;
      body.exitPrice = null;
    }
    patchMutation.mutate({ id: editEntry.id, body });
  };

  const stats = data?.stats;

  if (error) {
    return (
      <Card className="border-destructive">
        <CardContent className="whitespace-pre-wrap break-words pt-6 text-sm text-destructive">
          {error instanceof Error ? error.message : String(error)}
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="flex items-center gap-2 text-xl font-semibold">
            <ClipboardList className="h-5 w-5" />
            Trade log
          </h2>
          <p className="text-sm text-muted-foreground">
            Record entries and exits; realized P&amp;L, win rate, and profit factor update when a position
            is closed.
          </p>
        </div>
        <Button
          onClick={() => {
            setEditEntry(null);
            setForm({ ...defaultForm, entryDate: format(new Date(), "yyyy-MM-dd") });
            setAddOpen(true);
          }}
        >
          <Plus className="mr-2 h-4 w-4" />
          Add trade
        </Button>
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
          Loading journal…
        </div>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>Closed trades</CardDescription>
                <CardTitle className="text-2xl">{stats?.closedCount ?? 0}</CardTitle>
              </CardHeader>
              <CardContent className="text-xs text-muted-foreground">Open: {stats?.openCount ?? 0}</CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>Win rate</CardDescription>
                <CardTitle className="text-2xl">
                  {stats?.winRate != null ? `${(stats.winRate * 100).toFixed(1)}%` : "—"}
                </CardTitle>
              </CardHeader>
              <CardContent className="text-xs text-muted-foreground">
                Wins {stats?.winCount ?? 0} / Losses {stats?.lossCount ?? 0}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>Profit factor</CardDescription>
                <CardTitle className="text-2xl flex items-center gap-1">
                  <TrendingUp className="h-5 w-5 text-muted-foreground" />
                  {stats?.profitFactor === "infinite"
                    ? "∞"
                    : stats?.profitFactor != null
                      ? stats.profitFactor.toFixed(2)
                      : "—"}
                </CardTitle>
              </CardHeader>
              <CardContent className="text-xs text-muted-foreground">Gross profits ÷ gross losses</CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>Total realized P&amp;L</CardDescription>
                <CardTitle
                  className={`text-2xl ${
                    (stats?.totalRealizedPnl ?? 0) >= 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"
                  }`}
                >
                  {formatMoney(stats?.totalRealizedPnl ?? 0)}
                </CardTitle>
              </CardHeader>
              <CardContent className="text-xs text-muted-foreground">Sum of closed trades</CardContent>
            </Card>
          </div>

          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Symbol</TableHead>
                    <TableHead>Side</TableHead>
                    <TableHead>Entry</TableHead>
                    <TableHead>Exit</TableHead>
                    <TableHead className="text-right">Realized</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="w-[140px]" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data?.entries?.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={7} className="py-10 text-center text-muted-foreground">
                        No trades yet. Add an open or closed position to start tracking.
                      </TableCell>
                    </TableRow>
                  )}
                  {data?.entries?.map((row) => {
                    const open = isOpen(row);
                    const pnl = num(row.realizedPnl);
                    return (
                      <TableRow key={row.id}>
                        <TableCell className="font-medium">{row.symbol}</TableCell>
                        <TableCell>{row.side}</TableCell>
                        <TableCell className="whitespace-nowrap text-sm">
                          {row.entryDate ? format(new Date(row.entryDate), "MMM d, yyyy") : "—"}
                          <span className="text-muted-foreground">
                            {" "}
                            @ {num(row.entryPrice).toFixed(2)}
                          </span>
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-sm">
                          {open ? (
                            "—"
                          ) : (
                            <>
                              {row.exitDate ? format(new Date(row.exitDate), "MMM d, yyyy") : "—"}
                              <span className="text-muted-foreground">
                                {" "}
                                @ {num(row.exitPrice).toFixed(2)}
                              </span>
                            </>
                          )}
                        </TableCell>
                        <TableCell
                          className={`text-right font-medium ${
                            open ? "text-muted-foreground" : pnl >= 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"
                          }`}
                        >
                          {open ? "—" : formatMoney(pnl)}
                        </TableCell>
                        <TableCell>
                          {open ? (
                            <Badge variant="secondary">Open</Badge>
                          ) : (
                            <Badge variant="outline">Closed</Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1">
                            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(row)}>
                              <Pencil className="h-4 w-4" />
                            </Button>
                            {open && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8"
                                onClick={() => {
                                  setClosingEntry(row);
                                  setCloseForm({
                                    exitDate: format(new Date(), "yyyy-MM-dd"),
                                    exitPrice: "",
                                    fees: String(row.fees ?? "0"),
                                  });
                                  setCloseOpen(true);
                                }}
                              >
                                <DoorOpen className="h-4 w-4" />
                              </Button>
                            )}
                            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setDeleteId(row.id)}>
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      )}

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editEntry ? "Edit trade" : "Add trade"}</DialogTitle>
            <DialogDescription>
              Enter execution details. Leave exit blank for an open position; close it later to roll into
              performance stats.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="sym">Symbol</Label>
                <Input
                  id="sym"
                  value={form.symbol}
                  onChange={(e) => setForm((f) => ({ ...f, symbol: e.target.value }))}
                  placeholder="AAPL"
                />
              </div>
              <div className="space-y-2">
                <Label>Side</Label>
                <Select value={form.side} onValueChange={(v: "long" | "short") => setForm((f) => ({ ...f, side: v }))}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="long">Long</SelectItem>
                    <SelectItem value="short">Short</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Instrument</Label>
                <Select
                  value={form.instrumentType}
                  onValueChange={(v: "stock" | "option" | "other") =>
                    setForm((f) => ({
                      ...f,
                      instrumentType: v,
                      contractMultiplier: v === "option" ? "100" : "1",
                    }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="stock">Stock</SelectItem>
                    <SelectItem value="option">Option</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="qty">Quantity (shares or contracts)</Label>
                <Input
                  id="qty"
                  type="number"
                  min={1}
                  value={form.quantity}
                  onChange={(e) => setForm((f) => ({ ...f, quantity: parseInt(e.target.value, 10) || 1 }))}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="mult">Contract multiplier</Label>
              <Input
                id="mult"
                value={form.contractMultiplier}
                onChange={(e) => setForm((f) => ({ ...f, contractMultiplier: e.target.value }))}
                placeholder="100 for standard equity options"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="ed">Entry date</Label>
                <Input
                  id="ed"
                  type="date"
                  value={form.entryDate}
                  onChange={(e) => setForm((f) => ({ ...f, entryDate: e.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ep">Entry price</Label>
                <Input
                  id="ep"
                  inputMode="decimal"
                  value={form.entryPrice}
                  onChange={(e) => setForm((f) => ({ ...f, entryPrice: e.target.value }))}
                  placeholder="0.00"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="xd">Exit date (optional)</Label>
                <Input
                  id="xd"
                  type="date"
                  value={form.exitDate}
                  onChange={(e) => setForm((f) => ({ ...f, exitDate: e.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="xp">Exit price (optional)</Label>
                <Input
                  id="xp"
                  inputMode="decimal"
                  value={form.exitPrice}
                  onChange={(e) => setForm((f) => ({ ...f, exitPrice: e.target.value }))}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="fees">Fees (round trip, USD)</Label>
              <Input
                id="fees"
                inputMode="decimal"
                value={form.fees}
                onChange={(e) => setForm((f) => ({ ...f, fees: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="notes">Notes</Label>
              <Textarea
                id="notes"
                rows={2}
                value={form.notes}
                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                placeholder="Strategy label, thesis, spread legs…"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={createMutation.isPending || patchMutation.isPending}
              onClick={() => (editEntry ? handleSubmitEdit() : handleSubmitAdd())}
            >
              {(createMutation.isPending || patchMutation.isPending) && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              {editEntry ? "Save changes" : "Save trade"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={closeOpen} onOpenChange={setCloseOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Close position</DialogTitle>
            <DialogDescription>
              {closingEntry?.symbol} — set exit date and price. P&amp;L is computed from entry, exit,
              quantity, multiplier, and fees.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 py-2">
            <div className="space-y-2">
              <Label>Exit date</Label>
              <Input
                type="date"
                value={closeForm.exitDate}
                onChange={(e) => setCloseForm((f) => ({ ...f, exitDate: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label>Exit price</Label>
              <Input
                inputMode="decimal"
                value={closeForm.exitPrice}
                onChange={(e) => setCloseForm((f) => ({ ...f, exitPrice: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label>Fees (optional override)</Label>
              <Input
                inputMode="decimal"
                value={closeForm.fees}
                onChange={(e) => setCloseForm((f) => ({ ...f, fees: e.target.value }))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCloseOpen(false)}>
              Cancel
            </Button>
            <Button disabled={patchMutation.isPending || !closeForm.exitPrice} onClick={handleClosePosition}>
              {patchMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Close &amp; record P&amp;L
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteId != null} onOpenChange={(o) => !o && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this trade?</AlertDialogTitle>
            <AlertDialogDescription>This cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteId && deleteMutation.mutate(deleteId)}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
