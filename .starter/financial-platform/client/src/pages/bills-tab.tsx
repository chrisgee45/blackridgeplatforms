import { useState, Fragment } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  DollarSign, Plus, Loader2, Trash2, Clock, AlertTriangle, FileDown,
  CreditCard, Receipt, ChevronDown, ChevronRight,
} from "lucide-react";
import { jsPDF } from "jspdf";
import type { Bill, Vendor, Account, BillPayment } from "@shared/schema";

const currencyFmt = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const dateFmt = (d: string | Date) => new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

interface DashboardStats {
  totalOutstanding: number;
  totalOutstandingCount: number;
  dueThisWeek: number;
  dueThisWeekCount: number;
  overdue: number;
  overdueCount: number;
}

interface APAgingRow {
  id: string;
  vendorName: string;
  description: string | null;
  reference: string | null;
  dueDate: string;
  totalAmount: number;
  amountPaid: number;
  balanceDue: number;
  daysPastDue: number;
  bucket: "current" | "1-30" | "31-60" | "61-90" | "90+";
}

interface APAgingData {
  rows: APAgingRow[];
  summary: { current: number; "1-30": number; "31-60": number; "61-90": number; "90+": number; total: number };
}

const BUCKET_COLORS: Record<string, { bg: string; text: string; border: string; label: string }> = {
  current: { bg: "bg-emerald-500/10", text: "text-emerald-600", border: "border-emerald-500/30", label: "Current" },
  "1-30": { bg: "bg-yellow-500/10", text: "text-yellow-600", border: "border-yellow-500/30", label: "1-30 Days" },
  "31-60": { bg: "bg-orange-500/10", text: "text-orange-600", border: "border-orange-500/30", label: "31-60 Days" },
  "61-90": { bg: "bg-red-400/10", text: "text-red-500", border: "border-red-400/30", label: "61-90 Days" },
  "90+": { bg: "bg-red-600/10", text: "text-red-700", border: "border-red-600/30", label: "90+ Days" },
};

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    pending: "bg-amber-500/10 text-amber-600 border-amber-500/30",
    partially_paid: "bg-blue-500/10 text-blue-600 border-blue-500/30",
    paid: "bg-emerald-500/10 text-emerald-600 border-emerald-500/30",
    overdue: "bg-red-500/10 text-red-600 border-red-500/30",
    void: "bg-muted text-muted-foreground border-border",
  };
  const labels: Record<string, string> = {
    pending: "Unpaid",
    partially_paid: "Partial",
    paid: "Paid",
    overdue: "Overdue",
    void: "Void",
  };
  return (
    <Badge variant="outline" className={`text-[10px] ${styles[status] || ""}`} data-testid={`badge-bill-status-${status}`}>
      {labels[status] || status}
    </Badge>
  );
}

export default function BillsTab() {
  const { toast } = useToast();
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showPayDialog, setShowPayDialog] = useState<Bill | null>(null);
  const [expandedBillId, setExpandedBillId] = useState<string | null>(null);
  const [showAgingReport, setShowAgingReport] = useState(false);
  const [filter, setFilter] = useState<string>("all");

  const [formVendor, setFormVendor] = useState("");
  const [formAmount, setFormAmount] = useState("");
  const [formDueDate, setFormDueDate] = useState("");
  const [formDescription, setFormDescription] = useState("");
  const [formReference, setFormReference] = useState("");
  const [formAccountId, setFormAccountId] = useState("");

  const [payAmount, setPayAmount] = useState("");
  const [payMethod, setPayMethod] = useState("cash");
  const [payMemo, setPayMemo] = useState("");

  const { data: bills = [], isLoading: billsLoading } = useQuery<Bill[]>({
    queryKey: ["/api/ops/bills"],
  });

  const { data: stats } = useQuery<DashboardStats>({
    queryKey: ["/api/ops/bills/dashboard/stats"],
  });

  const { data: vendors = [] } = useQuery<Vendor[]>({
    queryKey: ["/api/ops/vendors"],
  });

  const { data: expenseAccounts = [] } = useQuery<Account[]>({
    queryKey: ["/api/ops/accounts"],
  });

  const { data: apAgingData } = useQuery<APAgingData>({
    queryKey: ["/api/accounting/ap-aging"],
    enabled: showAgingReport,
  });

  const createMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest("POST", "/api/ops/bills", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ops/bills"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ops/bills/dashboard/stats"] });
      setShowCreateDialog(false);
      resetForm();
      toast({ title: "Bill Created", description: "New bill has been recorded." });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message || "Failed to create bill", variant: "destructive" });
    },
  });

  const payMutation = useMutation({
    mutationFn: async ({ billId, amount, paymentMethod, memo }: { billId: string; amount: number; paymentMethod: string; memo?: string }) => {
      const res = await apiRequest("POST", `/api/ops/bills/${billId}/pay`, { amount, paymentMethod, memo });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ops/bills"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ops/bills/dashboard/stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/accounting/ap-aging"] });
      setShowPayDialog(null);
      setPayAmount("");
      setPayMethod("cash");
      setPayMemo("");
      toast({ title: "Payment Recorded", description: "Bill payment has been posted to the ledger." });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message || "Failed to record payment", variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/ops/bills/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ops/bills"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ops/bills/dashboard/stats"] });
      toast({ title: "Deleted", description: "Bill removed." });
    },
  });

  function resetForm() {
    setFormVendor("");
    setFormAmount("");
    setFormDueDate("");
    setFormDescription("");
    setFormReference("");
    setFormAccountId("");
  }

  const filteredBills = filter === "all" ? bills : bills.filter(b => {
    if (filter === "unpaid") return b.status === "pending" || b.status === "partially_paid" || b.status === "overdue";
    return b.status === filter;
  });

  const expenseAccountsFiltered = expenseAccounts.filter((a: any) => a.type === "expense" || a.subtype === "accounts_payable");

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h2 className="text-lg font-semibold" data-testid="text-bills-heading">Bills / Accounts Payable</h2>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setShowAgingReport(!showAgingReport)} data-testid="button-toggle-ap-aging">
            <Clock className="w-4 h-4 mr-1" />
            AP Aging
          </Button>
          <Button size="sm" onClick={() => setShowCreateDialog(true)} data-testid="button-new-bill">
            <Plus className="w-4 h-4 mr-1" />
            New Bill
          </Button>
        </div>
      </div>

      {stats && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Card data-testid="card-total-outstanding">
            <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Total Outstanding</CardTitle>
              <DollarSign className="w-4 h-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold tabular-nums" data-testid="text-total-outstanding">
                {currencyFmt.format(stats.totalOutstanding)}
              </p>
              <p className="text-xs text-muted-foreground">{stats.totalOutstandingCount} unpaid bill{stats.totalOutstandingCount !== 1 ? "s" : ""}</p>
            </CardContent>
          </Card>
          <Card data-testid="card-due-this-week">
            <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Due This Week</CardTitle>
              <Clock className="w-4 h-4 text-amber-500" />
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold tabular-nums text-amber-600" data-testid="text-due-this-week">
                {currencyFmt.format(stats.dueThisWeek)}
              </p>
              <p className="text-xs text-muted-foreground">{stats.dueThisWeekCount} bill{stats.dueThisWeekCount !== 1 ? "s" : ""}</p>
            </CardContent>
          </Card>
          <Card data-testid="card-overdue">
            <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Overdue</CardTitle>
              <AlertTriangle className="w-4 h-4 text-red-500" />
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold tabular-nums text-red-600" data-testid="text-overdue">
                {currencyFmt.format(stats.overdue)}
              </p>
              <p className="text-xs text-muted-foreground">{stats.overdueCount} bill{stats.overdueCount !== 1 ? "s" : ""}</p>
            </CardContent>
          </Card>
        </div>
      )}

      {showAgingReport && apAgingData && <APAgingSection data={apAgingData} />}

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between flex-wrap gap-2">
            <CardTitle className="text-base">Bills</CardTitle>
            <Select value={filter} onValueChange={setFilter}>
              <SelectTrigger className="w-36 h-8 text-xs" data-testid="select-bill-filter">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Bills</SelectItem>
                <SelectItem value="unpaid">Unpaid</SelectItem>
                <SelectItem value="paid">Paid</SelectItem>
                <SelectItem value="void">Void</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          {billsLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
            </div>
          ) : filteredBills.length === 0 ? (
            <div className="flex flex-col items-center py-12">
              <Receipt className="w-10 h-10 text-muted-foreground/30 mb-3" />
              <p className="text-muted-foreground text-sm" data-testid="text-no-bills">No bills found</p>
            </div>
          ) : (
            <div className="rounded-md border border-border/50 overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8" />
                    <TableHead>Vendor</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead>Due Date</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead className="text-right">Paid</TableHead>
                    <TableHead className="text-right">Balance</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="w-28" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredBills.map((bill) => {
                    const vendor = vendors.find(v => v.id === bill.vendorId);
                    const balance = Number(bill.amount) - Number(bill.paidAmount);
                    const isOverdue = (bill.status === "pending" || bill.status === "partially_paid") && new Date(bill.dueDate) < new Date();
                    const expanded = expandedBillId === bill.id;
                    return (
                      <Fragment key={bill.id}>
                        <TableRow
                          className={isOverdue ? "bg-red-500/5" : ""}
                          data-testid={`row-bill-${bill.id}`}
                        >
                          <TableCell>
                            <button
                              className="p-0.5 hover:bg-muted rounded"
                              onClick={() => setExpandedBillId(expanded ? null : bill.id)}
                              data-testid={`button-expand-bill-${bill.id}`}
                            >
                              {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                            </button>
                          </TableCell>
                          <TableCell className="font-medium text-sm">{vendor?.name || "Unknown"}</TableCell>
                          <TableCell className="text-sm text-muted-foreground truncate max-w-[200px]">{bill.description || "—"}</TableCell>
                          <TableCell className="text-sm tabular-nums">{dateFmt(bill.dueDate)}</TableCell>
                          <TableCell className="text-right text-sm tabular-nums">{currencyFmt.format(Number(bill.amount))}</TableCell>
                          <TableCell className="text-right text-sm tabular-nums text-muted-foreground">{currencyFmt.format(Number(bill.paidAmount))}</TableCell>
                          <TableCell className="text-right text-sm tabular-nums font-semibold">{currencyFmt.format(balance)}</TableCell>
                          <TableCell><StatusBadge status={isOverdue && bill.status !== "paid" ? "overdue" : bill.status} /></TableCell>
                          <TableCell>
                            <div className="flex gap-1">
                              {bill.status !== "paid" && bill.status !== "void" && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-7 text-xs"
                                  onClick={() => {
                                    setShowPayDialog(bill);
                                    setPayAmount(String(balance.toFixed(2)));
                                  }}
                                  data-testid={`button-pay-bill-${bill.id}`}
                                >
                                  <CreditCard className="w-3 h-3 mr-1" />
                                  Pay
                                </Button>
                              )}
                              {bill.status !== "paid" && (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-7 w-7 p-0 text-destructive"
                                  onClick={() => {
                                    if (confirm("Delete this bill?")) deleteMutation.mutate(bill.id);
                                  }}
                                  data-testid={`button-delete-bill-${bill.id}`}
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </Button>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                        {expanded && (
                          <TableRow>
                            <TableCell colSpan={9} className="bg-muted/20 p-3">
                              <BillPaymentHistory billId={bill.id} />
                            </TableCell>
                          </TableRow>
                        )}
                      </Fragment>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>New Bill</DialogTitle>
            <DialogDescription>Record a new bill from a vendor.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Vendor *</Label>
              <Select value={formVendor} onValueChange={setFormVendor}>
                <SelectTrigger data-testid="select-bill-vendor">
                  <SelectValue placeholder="Select vendor" />
                </SelectTrigger>
                <SelectContent>
                  {vendors.map(v => (
                    <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Amount *</Label>
                <Input
                  type="number"
                  step="0.01"
                  min="0.01"
                  value={formAmount}
                  onChange={e => setFormAmount(e.target.value)}
                  placeholder="0.00"
                  data-testid="input-bill-amount"
                />
              </div>
              <div className="space-y-2">
                <Label>Due Date *</Label>
                <Input
                  type="date"
                  value={formDueDate}
                  onChange={e => setFormDueDate(e.target.value)}
                  data-testid="input-bill-due-date"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Category</Label>
              <Select value={formAccountId} onValueChange={setFormAccountId}>
                <SelectTrigger data-testid="select-bill-category">
                  <SelectValue placeholder="Select category" />
                </SelectTrigger>
                <SelectContent>
                  {expenseAccountsFiltered.map(a => (
                    <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Description</Label>
              <Textarea
                value={formDescription}
                onChange={e => setFormDescription(e.target.value)}
                placeholder="What is this bill for?"
                data-testid="input-bill-description"
              />
            </div>
            <div className="space-y-2">
              <Label>Reference / Invoice #</Label>
              <Input
                value={formReference}
                onChange={e => setFormReference(e.target.value)}
                placeholder="Vendor invoice number"
                data-testid="input-bill-reference"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowCreateDialog(false); resetForm(); }} data-testid="button-cancel-bill">
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (!formVendor || !formAmount || !formDueDate) {
                  toast({ title: "Missing fields", description: "Vendor, amount, and due date are required.", variant: "destructive" });
                  return;
                }
                createMutation.mutate({
                  vendorId: formVendor,
                  amount: Number(formAmount),
                  dueDate: formDueDate,
                  description: formDescription || undefined,
                  reference: formReference || undefined,
                  accountId: formAccountId || undefined,
                });
              }}
              disabled={createMutation.isPending}
              data-testid="button-save-bill"
            >
              {createMutation.isPending && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}
              Create Bill
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!showPayDialog} onOpenChange={(open) => { if (!open) setShowPayDialog(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Record Payment</DialogTitle>
            <DialogDescription>
              {showPayDialog && (
                <>Pay bill: {showPayDialog.description || "Bill"} — Balance: {currencyFmt.format(Number(showPayDialog.amount) - Number(showPayDialog.paidAmount))}</>
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Payment Amount *</Label>
              <Input
                type="number"
                step="0.01"
                min="0.01"
                value={payAmount}
                onChange={e => setPayAmount(e.target.value)}
                data-testid="input-pay-amount"
              />
            </div>
            <div className="space-y-2">
              <Label>Payment Method</Label>
              <Select value={payMethod} onValueChange={setPayMethod}>
                <SelectTrigger data-testid="select-pay-method">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="cash">Cash / Check</SelectItem>
                  <SelectItem value="card">Credit Card</SelectItem>
                  <SelectItem value="transfer">Bank Transfer</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Memo (optional)</Label>
              <Input
                value={payMemo}
                onChange={e => setPayMemo(e.target.value)}
                placeholder="Payment note"
                data-testid="input-pay-memo"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowPayDialog(null)}>Cancel</Button>
            <Button
              onClick={() => {
                if (!showPayDialog || !payAmount) return;
                payMutation.mutate({
                  billId: showPayDialog.id,
                  amount: Number(payAmount),
                  paymentMethod: payMethod,
                  memo: payMemo || undefined,
                });
              }}
              disabled={payMutation.isPending}
              data-testid="button-confirm-payment"
            >
              {payMutation.isPending && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}
              Record Payment
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function BillPaymentHistory({ billId }: { billId: string }) {
  const { data: payments = [], isLoading } = useQuery<BillPayment[]>({
    queryKey: ["/api/ops/bills", billId, "payments"],
    queryFn: async () => {
      const res = await fetch(`/api/ops/bills/${billId}/payments`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });

  if (isLoading) return <Skeleton className="h-8 w-full" />;
  if (payments.length === 0) return <p className="text-xs text-muted-foreground">No payments recorded yet.</p>;

  return (
    <div className="space-y-1">
      <p className="text-xs font-medium text-muted-foreground mb-2">Payment History</p>
      {payments.map(p => (
        <div key={p.id} className="flex items-center justify-between text-xs py-1 border-b border-border/30 last:border-0" data-testid={`payment-history-${p.id}`}>
          <span className="text-muted-foreground">{p.paidAt ? dateFmt(p.paidAt) : "—"}</span>
          <span className="text-muted-foreground">{p.paymentMethod}</span>
          {p.memo && <span className="text-muted-foreground truncate max-w-[150px]">{p.memo}</span>}
          <span className="font-medium tabular-nums">{currencyFmt.format(Number(p.amount))}</span>
        </div>
      ))}
    </div>
  );
}

function APAgingSection({ data }: { data: APAgingData }) {
  const { rows, summary } = data;

  function exportAPAgingPdf() {
    const doc = new jsPDF({ orientation: "landscape" });
    const pageWidth = doc.internal.pageSize.getWidth();
    const margin = 15;
    let y = 20;

    doc.setFontSize(20);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(20, 20, 30);
    doc.text("BLACKRIDGE PLATFORMS", margin, y);
    y += 8;
    doc.setFontSize(14);
    doc.setTextColor(80, 80, 90);
    doc.text("Accounts Payable Aging Report", margin, y);
    y += 6;
    doc.setFontSize(9);
    doc.setTextColor(120, 120, 130);
    doc.text(`Generated: ${new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}`, margin, y);
    y += 10;

    doc.setDrawColor(200, 170, 60);
    doc.setLineWidth(0.5);
    doc.line(margin, y, margin + 80, y);
    y += 10;

    const colX = [margin, margin + 50, margin + 100, margin + 135, margin + 165, margin + 195, margin + 225];
    const colHeaders = ["Vendor", "Description", "Due Date", "Total", "Paid", "Balance Due", "Aging"];

    doc.setFillColor(240, 240, 245);
    doc.rect(margin, y - 4, pageWidth - margin * 2, 7, "F");
    doc.setFontSize(7);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(80, 80, 90);
    colHeaders.forEach((h, i) => doc.text(h, colX[i], y));
    y += 8;

    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);

    for (const row of rows) {
      if (y > doc.internal.pageSize.getHeight() - 30) { doc.addPage(); y = 20; }

      if (row.bucket === "90+") doc.setTextColor(180, 30, 30);
      else if (row.bucket === "61-90") doc.setTextColor(200, 60, 60);
      else if (row.bucket === "31-60") doc.setTextColor(200, 120, 40);
      else if (row.bucket === "1-30") doc.setTextColor(180, 160, 30);
      else doc.setTextColor(30, 30, 40);

      const vendor = row.vendorName.length > 25 ? row.vendorName.slice(0, 25) + "..." : row.vendorName;
      const desc = (row.description || "—").length > 25 ? (row.description || "").slice(0, 25) + "..." : (row.description || "—");

      doc.text(vendor, colX[0], y);
      doc.text(desc, colX[1], y);
      doc.text(dateFmt(row.dueDate), colX[2], y);
      doc.text(currencyFmt.format(row.totalAmount), colX[3], y);
      doc.text(currencyFmt.format(row.amountPaid), colX[4], y);
      doc.text(currencyFmt.format(row.balanceDue), colX[5], y);
      doc.text(BUCKET_COLORS[row.bucket]?.label || row.bucket, colX[6], y);
      y += 6;
    }

    y += 4;
    doc.setDrawColor(200, 200, 210);
    doc.line(margin, y, pageWidth - margin, y);
    y += 8;

    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(30, 30, 40);
    doc.text("AGING SUMMARY", margin, y);
    y += 8;

    doc.setFontSize(8);
    for (const [label, amt] of [
      ["Current", summary.current],
      ["1-30 Days", summary["1-30"]],
      ["31-60 Days", summary["31-60"]],
      ["61-90 Days", summary["61-90"]],
      ["90+ Days", summary["90+"]],
    ] as [string, number][]) {
      doc.setFont("helvetica", "normal");
      doc.setTextColor(80, 80, 90);
      doc.text(label, margin + 10, y);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(30, 30, 40);
      doc.text(currencyFmt.format(amt), margin + 60, y);
      y += 6;
    }

    y += 2;
    doc.setDrawColor(200, 200, 210);
    doc.line(margin + 10, y, margin + 100, y);
    y += 6;
    doc.setFontSize(10);
    doc.text("TOTAL OUTSTANDING", margin + 10, y);
    doc.text(currencyFmt.format(summary.total), margin + 60, y);

    doc.save("AP_Aging_Report.pdf");
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Clock className="w-4 h-4" />
            AP Aging Report
          </CardTitle>
          {rows.length > 0 && (
            <Button variant="outline" size="sm" onClick={exportAPAgingPdf} data-testid="button-export-ap-pdf">
              <FileDown className="w-4 h-4 mr-1" />
              Export PDF
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-6" data-testid="text-no-ap-aging">No outstanding payables</p>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
              {(["current", "1-30", "31-60", "61-90", "90+"] as const).map(bucket => {
                const colors = BUCKET_COLORS[bucket];
                return (
                  <div key={bucket} className={`rounded-md border p-3 ${colors.bg} ${colors.border}`} data-testid={`card-ap-bucket-${bucket}`}>
                    <p className="text-xs text-muted-foreground">{colors.label}</p>
                    <p className={`text-lg font-bold tabular-nums ${colors.text}`}>{currencyFmt.format(summary[bucket])}</p>
                  </div>
                );
              })}
              <div className="rounded-md border border-border/50 p-3 bg-muted/20" data-testid="card-ap-bucket-total">
                <p className="text-xs text-muted-foreground">Total Outstanding</p>
                <p className="text-lg font-bold tabular-nums">{currencyFmt.format(summary.total)}</p>
              </div>
            </div>

            <div className="rounded-md border border-border/50 overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Vendor</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead>Due Date</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead className="text-right">Paid</TableHead>
                    <TableHead className="text-right">Balance</TableHead>
                    <TableHead>Aging</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map(row => {
                    const colors = BUCKET_COLORS[row.bucket];
                    const rowBg = row.bucket === "90+" ? "bg-red-600/10" : row.bucket === "61-90" ? "bg-red-400/5" : row.bucket === "31-60" ? "bg-orange-500/5" : row.bucket === "1-30" ? "bg-yellow-500/5" : "";
                    return (
                      <TableRow key={row.id} className={rowBg} data-testid={`row-ap-${row.id}`}>
                        <TableCell className="text-sm font-medium">{row.vendorName}</TableCell>
                        <TableCell className="text-sm text-muted-foreground truncate max-w-[180px]">{row.description || "—"}</TableCell>
                        <TableCell className="text-sm tabular-nums">{dateFmt(row.dueDate)}</TableCell>
                        <TableCell className="text-right text-sm tabular-nums">{currencyFmt.format(row.totalAmount)}</TableCell>
                        <TableCell className="text-right text-sm tabular-nums text-muted-foreground">{currencyFmt.format(row.amountPaid)}</TableCell>
                        <TableCell className="text-right text-sm tabular-nums font-semibold">{currencyFmt.format(row.balanceDue)}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className={`text-[10px] ${colors.bg} ${colors.text} ${colors.border}`}>
                            {colors.label}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  <TableRow className="bg-muted/30 font-semibold border-t-2">
                    <TableCell colSpan={3} className="text-sm">TOTALS ({rows.length} bills)</TableCell>
                    <TableCell className="text-right text-sm tabular-nums">{currencyFmt.format(rows.reduce((s, r) => s + r.totalAmount, 0))}</TableCell>
                    <TableCell className="text-right text-sm tabular-nums text-muted-foreground">{currencyFmt.format(rows.reduce((s, r) => s + r.amountPaid, 0))}</TableCell>
                    <TableCell className="text-right text-sm tabular-nums">{currencyFmt.format(summary.total)}</TableCell>
                    <TableCell />
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
