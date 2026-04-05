import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DollarSign,
  Plus,
  Trash2,
  CalendarDays,
  TrendingUp,
  Receipt,
  UserPlus,
  Repeat,
  Pencil,
  Paperclip,
  X,
  FileText,
  Image as ImageIcon,
} from "lucide-react";
import { ObjectUploader } from "@/components/ObjectUploader";
import type { Account, Vendor, Expense } from "@shared/schema";



function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function formatDate(d: string | Date): string {
  return new Date(d).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

const PAYMENT_METHODS = [
  { value: "cash", label: "Cash" },
  { value: "check", label: "Check" },
  { value: "card", label: "Card" },
  { value: "transfer", label: "Transfer" },
  { value: "other", label: "Other" },
];

const FUNDING_SOURCES = [
  { value: "business_checking", label: "Business Checking" },
  { value: "personal", label: "Personal Account" },
  { value: "business_credit_card", label: "Business Credit Card" },
  { value: "business_savings", label: "Business Savings" },
  { value: "other", label: "Other" },
];

export default function ExpensesPage() {
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const yearStart = new Date(now.getFullYear(), 0, 1);

  const [filterStartDate, setFilterStartDate] = useState("");
  const [filterEndDate, setFilterEndDate] = useState("");
  const [filterAccountId, setFilterAccountId] = useState("");
  const [filterVendorId, setFilterVendorId] = useState("");

  const [formVendorId, setFormVendorId] = useState("");
  const [formAccountId, setFormAccountId] = useState("");
  const [formDescription, setFormDescription] = useState("");
  const [formAmount, setFormAmount] = useState("");
  const [formDate, setFormDate] = useState(now.toISOString().slice(0, 10));
  const [formPaymentMethod, setFormPaymentMethod] = useState("card");
  const [formCheckNumber, setFormCheckNumber] = useState("");
  const [formReceiptNotes, setFormReceiptNotes] = useState("");
  const [formTaxDeductible, setFormTaxDeductible] = useState(true);
  const [formIsRecurring, setFormIsRecurring] = useState(false);
  const [formRecurringFrequency, setFormRecurringFrequency] = useState("monthly");
  const [formReceiptStorageKey, setFormReceiptStorageKey] = useState("");
  const [formReceiptFilename, setFormReceiptFilename] = useState("");
  const [formFundingSource, setFormFundingSource] = useState("business_checking");

  const [receiptPreview, setReceiptPreview] = useState<{ url: string; filename: string } | null>(null);

  const [editingExpense, setEditingExpense] = useState<Expense | null>(null);
  const [editDescription, setEditDescription] = useState("");
  const [editAmount, setEditAmount] = useState("");
  const [editDate, setEditDate] = useState("");
  const [editAccountId, setEditAccountId] = useState("");
  const [editVendorId, setEditVendorId] = useState("");
  const [editPaymentMethod, setEditPaymentMethod] = useState("card");
  const [editReceiptNotes, setEditReceiptNotes] = useState("");
  const [editFundingSource, setEditFundingSource] = useState("business_checking");
  const [editTaxDeductible, setEditTaxDeductible] = useState(true);
  const [editCheckNumber, setEditCheckNumber] = useState("");
  const [editReceiptStorageKey, setEditReceiptStorageKey] = useState("");
  const [editReceiptFilename, setEditReceiptFilename] = useState("");

  const [newVendorName, setNewVendorName] = useState("");
  const [newVendorEmail, setNewVendorEmail] = useState("");
  const [newVendorPhone, setNewVendorPhone] = useState("");
  const [newVendorAddress, setNewVendorAddress] = useState("");
  const [newVendorTaxId, setNewVendorTaxId] = useState("");
  const [newVendorIs1099, setNewVendorIs1099] = useState(false);
  const [editingVendor, setEditingVendor] = useState<Vendor | null>(null);
  const [editVendorName, setEditVendorName] = useState("");
  const [editVendorEmail, setEditVendorEmail] = useState("");
  const [editVendorPhone, setEditVendorPhone] = useState("");
  const [editVendorAddress, setEditVendorAddress] = useState("");
  const [editVendorTaxId, setEditVendorTaxId] = useState("");
  const [editVendorIs1099, setEditVendorIs1099] = useState(false);
  const [vendorMgmtDialogOpen, setVendorMgmtDialogOpen] = useState(false);

  const queryParams = useMemo(() => {
    const params = new URLSearchParams();
    if (filterStartDate) params.set("startDate", filterStartDate);
    if (filterEndDate) params.set("endDate", filterEndDate);
    if (filterAccountId) params.set("accountId", filterAccountId);
    if (filterVendorId) params.set("vendorId", filterVendorId);
    return params.toString();
  }, [filterStartDate, filterEndDate, filterAccountId, filterVendorId]);

  const { data: expenses, isLoading: expensesLoading } = useQuery<Expense[]>({
    queryKey: ["/api/ops/expenses", queryParams ? `?${queryParams}` : ""],
  });

  const { data: accounts } = useQuery<Account[]>({
    queryKey: ["/api/ops/accounts"],
  });

  const { data: vendors } = useQuery<Vendor[]>({
    queryKey: ["/api/ops/vendors"],
  });

  const expenseAccounts = useMemo(
    () => (accounts ?? []).filter((a) => a.type === "expense" && a.isActive),
    [accounts],
  );

  const accountMap = useMemo(
    () => new Map((accounts ?? []).map((a) => [a.id, a])),
    [accounts],
  );

  const vendorMap = useMemo(
    () => new Map((vendors ?? []).map((v) => [v.id, v])),
    [vendors],
  );

  );

  const totalThisMonth = useMemo(() => {
    if (!expenses) return 0;
    return expenses
      .filter((e) => new Date(e.date) >= monthStart)
      .reduce((sum, e) => sum + Number(e.amount), 0);
  }, [expenses, monthStart]);

  const totalYTD = useMemo(() => {
    if (!expenses) return 0;
    return expenses
      .filter((e) => new Date(e.date) >= yearStart)
      .reduce((sum, e) => sum + Number(e.amount), 0);
  }, [expenses, yearStart]);

  const topCategories = useMemo(() => {
    if (!expenses) return [];
    const map = new Map<string, number>();
    for (const e of expenses) {
      const acct = accountMap.get(e.accountId);
      const name = acct?.name ?? "Unknown";
      map.set(name, (map.get(name) ?? 0) + Number(e.amount));
    }
    return Array.from(map.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3);
  }, [expenses, accountMap]);

  const createExpenseMutation = useMutation({
    mutationFn: async (data: Record<string, unknown>) => {
      const res = await apiRequest("POST", "/api/ops/expenses", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ops/expenses"] });
      toast({ title: "Expense added" });
      setDialogOpen(false);
      resetForm();
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const deleteExpenseMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/ops/expenses/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ops/expenses"] });
      toast({ title: "Expense deleted" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const createVendorMutation = useMutation({
    mutationFn: async (data: Record<string, unknown>) => {
      const res = await apiRequest("POST", "/api/ops/vendors", data);
      return res.json();
    },
    onSuccess: (vendor: Vendor) => {
      queryClient.invalidateQueries({ queryKey: ["/api/ops/vendors"] });
      setFormVendorId(vendor.id);
      setVendorMgmtDialogOpen(false);
      setNewVendorName("");
      setNewVendorEmail("");
      setNewVendorPhone("");
      setNewVendorAddress("");
      setNewVendorTaxId("");
      setNewVendorIs1099(false);
      toast({ title: "Vendor created" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const updateExpenseMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Record<string, unknown> }) => {
      const res = await apiRequest("PATCH", `/api/ops/expenses/${id}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ops/expenses"] });
      toast({ title: "Expense updated" });
      setEditingExpense(null);
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  function openEditDialog(expense: Expense) {
    setEditingExpense(expense);
    setEditDescription(expense.description);
    setEditAmount(String(expense.amount));
    setEditDate(new Date(expense.date).toISOString().slice(0, 10));
    setEditAccountId(expense.accountId);
    setEditVendorId(expense.vendorId ?? "");
    setEditPaymentMethod(expense.paymentMethod ?? "card");
    setEditReceiptNotes(expense.receiptNotes ?? "");
    setEditTaxDeductible(expense.taxDeductible ?? true);
    setEditCheckNumber(expense.checkNumber ?? "");
    setEditReceiptStorageKey(expense.receiptStorageKey ?? "");
    setEditReceiptFilename(expense.receiptFilename ?? "");
    setEditFundingSource(expense.fundingSource ?? "business_checking");
  }

  function handleUpdateExpense() {
    if (!editingExpense || !editAccountId || !editDescription || !editAmount || !editDate) {
      toast({ title: "Missing required fields", variant: "destructive" });
      return;
    }
    const data: Record<string, unknown> = {
      accountId: editAccountId,
      description: editDescription,
      amount: parseFloat(editAmount),
      date: editDate,
      paymentMethod: editPaymentMethod,
      taxDeductible: editTaxDeductible,
      vendorId: editVendorId && editVendorId !== "none" ? editVendorId : null,
      receiptNotes: editReceiptNotes || null,
      checkNumber: editCheckNumber || null,
      receiptStorageKey: editReceiptStorageKey || null,
      receiptFilename: editReceiptFilename || null,
      fundingSource: editFundingSource,
    };
    updateExpenseMutation.mutate({ id: editingExpense.id, data });
  }

  function resetForm() {
    setFormVendorId("");
    setFormAccountId("");
    setFormDescription("");
    setFormAmount("");
    setFormDate(new Date().toISOString().slice(0, 10));
    setFormPaymentMethod("card");
    setFormCheckNumber("");
    setFormReceiptNotes("");
    setFormTaxDeductible(true);
    setFormIsRecurring(false);
    setFormRecurringFrequency("monthly");
    setFormReceiptStorageKey("");
    setFormReceiptFilename("");
    setFormFundingSource("business_checking");
  }

  function handleSubmitExpense() {
    if (!formAccountId || !formDescription || !formAmount || !formDate) {
      toast({ title: "Missing required fields", variant: "destructive" });
      return;
    }
    const data: Record<string, unknown> = {
      accountId: formAccountId,
      description: formDescription,
      amount: parseFloat(formAmount),
      date: formDate,
      paymentMethod: formPaymentMethod,
      fundingSource: formFundingSource,
      taxDeductible: formTaxDeductible,
    };
    if (formVendorId) data.vendorId = formVendorId;
    if (formCheckNumber) data.checkNumber = formCheckNumber;
    if (formReceiptNotes) data.receiptNotes = formReceiptNotes;
    if (formReceiptStorageKey) {
      data.receiptStorageKey = formReceiptStorageKey;
      data.receiptFilename = formReceiptFilename;
    }
    if (formIsRecurring) {
      data.isRecurring = true;
      data.recurringFrequency = formRecurringFrequency;
    }
    createExpenseMutation.mutate(data);
  }

  function handleCreateVendor() {
    if (!newVendorName.trim()) {
      toast({ title: "Vendor name is required", variant: "destructive" });
      return;
    }
    createVendorMutation.mutate({
      name: newVendorName.trim(),
      email: newVendorEmail || null,
      phone: newVendorPhone || null,
      address: newVendorAddress || null,
      taxId: newVendorTaxId || null,
      is1099Contractor: newVendorIs1099,
    });
  }

  function openEditVendor(v: Vendor) {
    setEditingVendor(v);
    setEditVendorName(v.name);
    setEditVendorEmail(v.email || "");
    setEditVendorPhone(v.phone || "");
    setEditVendorAddress(v.address || "");
    setEditVendorTaxId(v.taxId || "");
    setEditVendorIs1099(v.is1099Contractor);
  }

  const updateVendorMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Record<string, unknown> }) => {
      const res = await apiRequest("PATCH", `/api/ops/vendors/${id}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ops/vendors"] });
      setEditingVendor(null);
      toast({ title: "Vendor updated" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  function handleUpdateVendor() {
    if (!editingVendor || !editVendorName.trim()) {
      toast({ title: "Vendor name is required", variant: "destructive" });
      return;
    }
    updateVendorMutation.mutate({
      id: editingVendor.id,
      data: {
        name: editVendorName.trim(),
        email: editVendorEmail || null,
        phone: editVendorPhone || null,
        address: editVendorAddress || null,
        taxId: editVendorTaxId || null,
        is1099Contractor: editVendorIs1099,
      },
    });
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight" data-testid="text-page-title">
            Expenses
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Track and manage business expenses
          </p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button data-testid="button-add-expense">
              <Plus className="w-4 h-4 mr-2" />
              Add Expense
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Add Expense</DialogTitle>
            </DialogHeader>
            <form className="space-y-4 pt-2" onSubmit={(e) => { e.preventDefault(); handleSubmitExpense(); }}>
              <div className="space-y-2">
                <Label>Vendor</Label>
                <div className="flex items-center gap-2">
                  <Select value={formVendorId} onValueChange={setFormVendorId}>
                    <SelectTrigger data-testid="select-vendor" className="flex-1">
                      <SelectValue placeholder="Select vendor" />
                    </SelectTrigger>
                    <SelectContent>
                      {(vendors ?? []).map((v) => (
                        <SelectItem key={v.id} value={v.id}>
                          {v.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button size="icon" variant="outline" onClick={() => setVendorMgmtDialogOpen(true)} data-testid="button-new-vendor">
                    <UserPlus className="w-4 h-4" />
                  </Button>
                </div>
              </div>

              <div className="space-y-2">
                <Label>Category / Account</Label>
                <Select value={formAccountId} onValueChange={setFormAccountId}>
                  <SelectTrigger data-testid="select-account">
                    <SelectValue placeholder="Select expense account" />
                  </SelectTrigger>
                  <SelectContent>
                    {expenseAccounts.map((a) => (
                      <SelectItem key={a.id} value={a.id}>
                        {a.accountNumber} - {a.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Description</Label>
                <Input
                  value={formDescription}
                  onChange={(e) => setFormDescription(e.target.value)}
                  placeholder="What was this expense for?"
                  data-testid="input-description"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Amount ($)</Label>
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    value={formAmount}
                    onChange={(e) => setFormAmount(e.target.value)}
                    placeholder="0.00"
                    data-testid="input-amount"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Date</Label>
                  <Input
                    type="date"
                    value={formDate}
                    onChange={(e) => setFormDate(e.target.value)}
                    data-testid="input-date"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Paid From</Label>
                  <Select value={formFundingSource} onValueChange={setFormFundingSource}>
                    <SelectTrigger data-testid="select-funding-source">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {FUNDING_SOURCES.map((s) => (
                        <SelectItem key={s.value} value={s.value}>
                          {s.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Payment Method</Label>
                  <Select value={formPaymentMethod} onValueChange={setFormPaymentMethod}>
                    <SelectTrigger data-testid="select-payment-method">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {PAYMENT_METHODS.map((m) => (
                        <SelectItem key={m.value} value={m.value}>
                          {m.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              {formFundingSource === "personal" && (
                <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded px-3 py-1.5" data-testid="text-personal-note">
                  This will be recorded as an owner contribution to the business.
                </p>
              )}
              {formPaymentMethod === "check" && (
                <div className="space-y-2">
                  <Label>Check Number</Label>
                  <Input
                    value={formCheckNumber}
                    onChange={(e) => setFormCheckNumber(e.target.value)}
                    data-testid="input-check-number"
                  />
                </div>
              )}

              <div className="space-y-2">
                <Label>Receipt Notes</Label>
                <Input
                  value={formReceiptNotes}
                  onChange={(e) => setFormReceiptNotes(e.target.value)}
                  placeholder="Optional notes about receipt"
                  data-testid="input-receipt-notes"
                />
              </div>

              <div className="flex items-center gap-6">
                <div className="flex items-center gap-2">
                  <Switch
                    checked={formTaxDeductible}
                    onCheckedChange={setFormTaxDeductible}
                    data-testid="switch-tax-deductible"
                  />
                  <Label>Tax Deductible</Label>
                </div>
              </div>

              <div className="space-y-2">
                <Label className="flex items-center gap-1.5">
                  <Paperclip className="w-3.5 h-3.5" />
                  Receipt Attachment
                </Label>
                {formReceiptStorageKey ? (
                  <div className="flex items-center gap-2 rounded-md border border-border/50 px-3 py-2">
                    {formReceiptFilename?.match(/\.(jpg|jpeg|png|gif|webp)$/i) ? (
                      <ImageIcon className="w-4 h-4 text-blue-500 shrink-0" />
                    ) : (
                      <FileText className="w-4 h-4 text-amber-500 shrink-0" />
                    )}
                    <span className="text-sm truncate flex-1" data-testid="text-receipt-filename">{formReceiptFilename}</span>
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="h-6 w-6 shrink-0"
                      onClick={() => { setFormReceiptStorageKey(""); setFormReceiptFilename(""); }}
                      data-testid="button-remove-receipt"
                    >
                      <X className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                ) : (
                  <ObjectUploader
                    maxNumberOfFiles={1}
                    maxFileSize={10485760}
                    onGetUploadParameters={async (file) => {
                      const res = await fetch("/api/uploads/request-url", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ name: file.name, size: file.size, contentType: file.type }),
                      });
                      const data = await res.json();
                      (file as any)._objectPath = data.objectPath;
                      (file as any)._fileName = file.name;
                      return { method: "PUT" as const, url: data.uploadURL };
                    }}
                    onComplete={(result) => {
                      const successful = result.successful || [];
                      if (successful.length > 0) {
                        const file = successful[0];
                        setFormReceiptStorageKey((file as any)._objectPath || "");
                        setFormReceiptFilename(file.name || (file as any)._fileName || "receipt");
                        toast({ title: "Receipt uploaded" });
                      }
                    }}
                    buttonClassName="w-full"
                  >
                    <Paperclip className="w-4 h-4 mr-1" />
                    Attach Receipt
                  </ObjectUploader>
                )}
              </div>

              <div className="rounded-md border border-border/50 p-3 space-y-3">
                <div className="flex items-center gap-2">
                  <Switch
                    checked={formIsRecurring}
                    onCheckedChange={setFormIsRecurring}
                    data-testid="switch-recurring"
                  />
                  <Label className="flex items-center gap-1.5">
                    <Repeat className="w-3.5 h-3.5" />
                    Recurring Expense
                  </Label>
                </div>
                {formIsRecurring && (
                  <div className="space-y-2">
                    <Label className="text-xs text-muted-foreground">Frequency</Label>
                    <Select value={formRecurringFrequency} onValueChange={setFormRecurringFrequency}>
                      <SelectTrigger data-testid="select-recurring-frequency">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="weekly">Weekly</SelectItem>
                        <SelectItem value="monthly">Monthly</SelectItem>
                        <SelectItem value="quarterly">Quarterly</SelectItem>
                        <SelectItem value="annually">Annually</SelectItem>
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">
                      The first expense will be created for the date above, then automatically repeat {formRecurringFrequency}.
                    </p>
                  </div>
                )}
              </div>

              <Button
                type="submit"
                disabled={createExpenseMutation.isPending}
                className="w-full"
                data-testid="button-submit-expense"
              >
                {createExpenseMutation.isPending ? "Saving..." : "Save Expense"}
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">This Month</CardTitle>
            <CalendarDays className="w-4 h-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {expensesLoading ? (
              <Skeleton className="h-8 w-24" />
            ) : (
              <div className="text-2xl font-bold" data-testid="stat-month-total">
                {formatCurrency(totalThisMonth)}
              </div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Year to Date</CardTitle>
            <TrendingUp className="w-4 h-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {expensesLoading ? (
              <Skeleton className="h-8 w-24" />
            ) : (
              <div className="text-2xl font-bold" data-testid="stat-ytd-total">
                {formatCurrency(totalYTD)}
              </div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Expenses</CardTitle>
            <DollarSign className="w-4 h-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {expensesLoading ? (
              <Skeleton className="h-8 w-24" />
            ) : (
              <div className="text-2xl font-bold" data-testid="stat-total-count">
                {expenses?.length ?? 0}
              </div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Top Categories</CardTitle>
            <Receipt className="w-4 h-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {expensesLoading ? (
              <Skeleton className="h-8 w-full" />
            ) : topCategories.length > 0 ? (
              <div className="space-y-1" data-testid="stat-top-categories">
                {topCategories.map(([name, total]) => (
                  <div key={name} className="flex items-center justify-between gap-2 text-sm">
                    <span className="truncate text-muted-foreground">{name}</span>
                    <span className="font-medium tabular-nums shrink-0">
                      {formatCurrency(total)}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No data</p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Filters</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-end gap-4 flex-wrap">
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Start Date</Label>
              <Input
                type="date"
                value={filterStartDate}
                onChange={(e) => setFilterStartDate(e.target.value)}
                data-testid="filter-start-date"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">End Date</Label>
              <Input
                type="date"
                value={filterEndDate}
                onChange={(e) => setFilterEndDate(e.target.value)}
                data-testid="filter-end-date"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Category</Label>
              <Select value={filterAccountId} onValueChange={setFilterAccountId}>
                <SelectTrigger data-testid="filter-account" className="w-[200px]">
                  <SelectValue placeholder="All categories" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All categories</SelectItem>
                  {expenseAccounts.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Vendor</Label>
              <Select value={filterVendorId} onValueChange={setFilterVendorId}>
                <SelectTrigger data-testid="filter-vendor" className="w-[200px]">
                  <SelectValue placeholder="All vendors" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All vendors</SelectItem>
                  {(vendors ?? []).map((v) => (
                    <SelectItem key={v.id} value={v.id}>
                      {v.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button
              variant="outline"
              onClick={() => {
                setFilterStartDate("");
                setFilterEndDate("");
                setFilterAccountId("");
                setFilterVendorId("");
              }}
              data-testid="button-clear-filters"
            >
              Clear
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          {expensesLoading ? (
            <div className="p-6 space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : !expenses || expenses.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16">
              <Receipt className="w-12 h-12 text-muted-foreground/30 mb-4" />
              <p className="text-muted-foreground text-sm" data-testid="text-empty-state">
                No expenses found. Add your first expense to get started.
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Vendor</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Paid From</TableHead>
                  <TableHead>Method</TableHead>
                  <TableHead className="w-8" />
                  <TableHead className="w-12" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {expenses.map((expense) => {
                  const vendor = expense.vendorId
                    ? vendorMap.get(expense.vendorId)
                    : null;
                  const account = accountMap.get(expense.accountId);
                  return (
                    <TableRow key={expense.id} data-testid={`row-expense-${expense.id}`}>
                      <TableCell className="text-sm tabular-nums">
                        {formatDate(expense.date)}
                      </TableCell>
                      <TableCell className="text-sm">
                        {vendor?.name ?? "—"}
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary" className="no-default-hover-elevate no-default-active-elevate text-xs">
                          {account?.name ?? "Unknown"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm max-w-[200px]">
                        <div className="flex items-center gap-1.5">
                          <span className="truncate">{expense.description}</span>
                          {expense.isRecurring && (
                            <Badge variant="outline" className="no-default-hover-elevate no-default-active-elevate text-[10px] shrink-0 gap-0.5 bg-blue-500/10 text-blue-600 border-blue-500/30">
                              <Repeat className="w-2.5 h-2.5" />
                              {expense.recurringFrequency === "weekly" ? "Wk" : expense.recurringFrequency === "monthly" ? "Mo" : expense.recurringFrequency === "quarterly" ? "Qt" : "Yr"}
                            </Badge>
                          )}
                          {expense.recurringParentId && (
                            <Badge variant="outline" className="no-default-hover-elevate no-default-active-elevate text-[10px] shrink-0 bg-slate-500/10 text-slate-500 border-slate-500/30">
                              Auto
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-sm font-medium text-right tabular-nums">
                        {formatCurrency(Number(expense.amount))}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground" data-testid={`text-funding-source-${expense.id}`}>
                        {FUNDING_SOURCES.find(s => s.value === expense.fundingSource)?.label ?? expense.fundingSource ?? "—"}
                      </TableCell>
                      <TableCell className="text-sm capitalize text-muted-foreground" data-testid={`text-payment-method-${expense.id}`}>
                        {expense.paymentMethod ?? "—"}
                      </TableCell>
                      <TableCell>
                        {expense.receiptStorageKey && (
                          <button
                            type="button"
                            className="text-muted-foreground hover:text-foreground transition-colors"
                            title={expense.receiptFilename || "View receipt"}
                            onClick={() => setReceiptPreview({
                              url: expense.receiptStorageKey!,
                              filename: expense.receiptFilename || "receipt",
                            })}
                            data-testid={`button-view-receipt-${expense.id}`}
                          >
                            <Paperclip className="w-4 h-4" />
                          </button>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => openEditDialog(expense)}
                            data-testid={`button-edit-expense-${expense.id}`}
                          >
                            <Pencil className="w-4 h-4 text-muted-foreground" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => deleteExpenseMutation.mutate(expense.id)}
                            disabled={deleteExpenseMutation.isPending}
                            data-testid={`button-delete-expense-${expense.id}`}
                          >
                            <Trash2 className="w-4 h-4 text-destructive" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
      <Dialog open={!!editingExpense} onOpenChange={(open) => { if (!open) setEditingExpense(null); }}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Expense</DialogTitle>
          </DialogHeader>
          <form className="space-y-4 py-2" onSubmit={(e) => { e.preventDefault(); handleUpdateExpense(); }}>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Category</Label>
                <Select value={editAccountId} onValueChange={setEditAccountId}>
                  <SelectTrigger data-testid="edit-select-account">
                    <SelectValue placeholder="Select category" />
                  </SelectTrigger>
                  <SelectContent>
                    {expenseAccounts.map((a) => (
                      <SelectItem key={a.id} value={a.id}>
                        {a.accountNumber} - {a.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Vendor</Label>
                <Select value={editVendorId} onValueChange={setEditVendorId}>
                  <SelectTrigger data-testid="edit-select-vendor">
                    <SelectValue placeholder="None" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    {(vendors ?? []).map((v) => (
                      <SelectItem key={v.id} value={v.id}>
                        {v.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Description</Label>
              <Input
                value={editDescription}
                onChange={(e) => setEditDescription(e.target.value)}
                data-testid="edit-input-description"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Amount ($)</Label>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  value={editAmount}
                  onChange={(e) => setEditAmount(e.target.value)}
                  data-testid="edit-input-amount"
                />
              </div>
              <div className="space-y-2">
                <Label>Date</Label>
                <Input
                  type="date"
                  value={editDate}
                  onChange={(e) => setEditDate(e.target.value)}
                  data-testid="edit-input-date"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Paid From</Label>
                <Select value={editFundingSource} onValueChange={setEditFundingSource}>
                  <SelectTrigger data-testid="edit-select-funding-source">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {FUNDING_SOURCES.map((s) => (
                      <SelectItem key={s.value} value={s.value}>
                        {s.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Payment Method</Label>
                <Select value={editPaymentMethod} onValueChange={setEditPaymentMethod}>
                  <SelectTrigger data-testid="edit-select-payment-method">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PAYMENT_METHODS.map((m) => (
                      <SelectItem key={m.value} value={m.value}>
                        {m.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            {editFundingSource === "personal" && (
              <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded px-3 py-1.5" data-testid="edit-text-personal-note">
                This will be recorded as an owner contribution to the business.
              </p>
            )}
            {editPaymentMethod === "check" && (
              <div className="space-y-2">
                <Label>Check Number</Label>
                <Input
                  value={editCheckNumber}
                  onChange={(e) => setEditCheckNumber(e.target.value)}
                  data-testid="edit-input-check-number"
                />
              </div>
            )}

            <div className="space-y-2">
              <Label className="flex items-center gap-1.5">
                <Paperclip className="w-3.5 h-3.5" />
                Receipt Attachment
              </Label>
              {editReceiptStorageKey ? (
                <div className="flex items-center gap-2 rounded-md border border-border/50 px-3 py-2">
                  {editReceiptFilename?.match(/\.(jpg|jpeg|png|gif|webp)$/i) ? (
                    <ImageIcon className="w-4 h-4 text-blue-500 shrink-0" />
                  ) : (
                    <FileText className="w-4 h-4 text-amber-500 shrink-0" />
                  )}
                  <span className="text-sm truncate flex-1">{editReceiptFilename}</span>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-7 text-xs"
                    onClick={() => setReceiptPreview({
                      url: editReceiptStorageKey,
                      filename: editReceiptFilename || "receipt",
                    })}
                    data-testid="button-view-edit-receipt"
                  >
                    View
                  </Button>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="h-6 w-6 shrink-0"
                    onClick={() => { setEditReceiptStorageKey(""); setEditReceiptFilename(""); }}
                    data-testid="button-remove-edit-receipt"
                  >
                    <X className="w-3.5 h-3.5" />
                  </Button>
                </div>
              ) : (
                <ObjectUploader
                  maxNumberOfFiles={1}
                  maxFileSize={10485760}
                  onGetUploadParameters={async (file) => {
                    const res = await fetch("/api/uploads/request-url", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ name: file.name, size: file.size, contentType: file.type }),
                    });
                    const data = await res.json();
                    (file as any)._objectPath = data.objectPath;
                    (file as any)._fileName = file.name;
                    return { method: "PUT" as const, url: data.uploadURL };
                  }}
                  onComplete={(result) => {
                    const successful = result.successful || [];
                    if (successful.length > 0) {
                      const file = successful[0];
                      setEditReceiptStorageKey((file as any)._objectPath || "");
                      setEditReceiptFilename(file.name || (file as any)._fileName || "receipt");
                      toast({ title: "Receipt uploaded" });
                    }
                  }}
                  buttonClassName="w-full"
                >
                  <Paperclip className="w-4 h-4 mr-1" />
                  Attach Receipt
                </ObjectUploader>
              )}
            </div>

            <div className="space-y-2">
              <Label>Receipt Notes</Label>
              <Input
                value={editReceiptNotes}
                onChange={(e) => setEditReceiptNotes(e.target.value)}
                data-testid="edit-input-receipt-notes"
              />
            </div>

            <div className="flex items-center gap-6">
              <div className="flex items-center gap-2">
                <Switch
                  checked={editTaxDeductible}
                  onCheckedChange={setEditTaxDeductible}
                  data-testid="edit-switch-tax-deductible"
                />
                <Label>Tax Deductible</Label>
              </div>
            </div>

            <Button
              type="submit"
              disabled={updateExpenseMutation.isPending}
              className="w-full"
              data-testid="button-save-edit-expense"
            >
              {updateExpenseMutation.isPending ? "Saving..." : "Save Changes"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base" data-testid="text-vendor-management">Vendor Management</CardTitle>
          <Button size="sm" variant="outline" onClick={() => setVendorMgmtDialogOpen(true)} data-testid="button-add-vendor-mgmt">
            <Plus className="w-4 h-4 mr-1" />
            Add Vendor
          </Button>
        </CardHeader>
        <CardContent>
          {(vendors ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">No vendors yet. Click "Add Vendor" to get started.</p>
          ) : (
            <div className="rounded-md border border-border/50 overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Vendor</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Phone</TableHead>
                    <TableHead>Address</TableHead>
                    <TableHead>Tax ID</TableHead>
                    <TableHead className="text-center">1099</TableHead>
                    <TableHead className="w-16"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(vendors ?? []).map((v) => (
                    <TableRow key={v.id} data-testid={`row-vendor-${v.id}`}>
                      <TableCell className="font-medium text-sm">
                        {v.name}
                        {v.is1099Contractor && (
                          <Badge variant="outline" className="ml-2 text-[10px] bg-violet-500/10 text-violet-600 border-violet-500/30">1099</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">{v.email || "—"}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{v.phone || "—"}</TableCell>
                      <TableCell className="text-sm text-muted-foreground max-w-[200px] truncate">{v.address || "—"}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{v.taxId || "—"}</TableCell>
                      <TableCell className="text-center">
                        <button
                          className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${v.is1099Contractor ? "bg-violet-500" : "bg-muted-foreground/20"}`}
                          onClick={() => updateVendorMutation.mutate({ id: v.id, data: { is1099Contractor: !v.is1099Contractor } })}
                          data-testid={`toggle-1099-${v.id}`}
                        >
                          <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${v.is1099Contractor ? "translate-x-4" : "translate-x-1"}`} />
                        </button>
                      </TableCell>
                      <TableCell>
                        <Button size="icon" variant="ghost" onClick={() => openEditVendor(v)} data-testid={`button-edit-vendor-${v.id}`}>
                          <Pencil className="w-3.5 h-3.5" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={vendorMgmtDialogOpen} onOpenChange={setVendorMgmtDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Vendor</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 pt-2">
            <div className="space-y-1">
              <Label>Name *</Label>
              <Input value={newVendorName} onChange={(e) => setNewVendorName(e.target.value)} data-testid="input-new-vendor-name" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Email</Label>
                <Input value={newVendorEmail} onChange={(e) => setNewVendorEmail(e.target.value)} data-testid="input-new-vendor-email" />
              </div>
              <div className="space-y-1">
                <Label>Phone</Label>
                <Input value={newVendorPhone} onChange={(e) => setNewVendorPhone(e.target.value)} data-testid="input-new-vendor-phone" />
              </div>
            </div>
            <div className="space-y-1">
              <Label>Address</Label>
              <Input value={newVendorAddress} onChange={(e) => setNewVendorAddress(e.target.value)} placeholder="Street, City, State ZIP" data-testid="input-new-vendor-address" />
            </div>
            <div className="space-y-1">
              <Label>Tax ID (EIN/SSN)</Label>
              <Input value={newVendorTaxId} onChange={(e) => setNewVendorTaxId(e.target.value)} placeholder="XX-XXXXXXX" data-testid="input-new-vendor-taxid" />
            </div>
            <label className="flex items-center gap-2 cursor-pointer py-1">
              <input type="checkbox" checked={newVendorIs1099} onChange={(e) => setNewVendorIs1099(e.target.checked)} className="rounded border-border" data-testid="checkbox-new-vendor-1099" />
              <span className="text-sm">1099 Contractor</span>
            </label>
            <Button onClick={handleCreateVendor} disabled={createVendorMutation.isPending} className="w-full" data-testid="button-create-vendor-mgmt">
              {createVendorMutation.isPending ? "Creating..." : "Create Vendor"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!editingVendor} onOpenChange={(open) => { if (!open) setEditingVendor(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Vendor</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 pt-2">
            <div className="space-y-1">
              <Label>Name *</Label>
              <Input value={editVendorName} onChange={(e) => setEditVendorName(e.target.value)} data-testid="input-edit-vendor-name" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Email</Label>
                <Input value={editVendorEmail} onChange={(e) => setEditVendorEmail(e.target.value)} data-testid="input-edit-vendor-email" />
              </div>
              <div className="space-y-1">
                <Label>Phone</Label>
                <Input value={editVendorPhone} onChange={(e) => setEditVendorPhone(e.target.value)} data-testid="input-edit-vendor-phone" />
              </div>
            </div>
            <div className="space-y-1">
              <Label>Address</Label>
              <Input value={editVendorAddress} onChange={(e) => setEditVendorAddress(e.target.value)} placeholder="Street, City, State ZIP" data-testid="input-edit-vendor-address" />
            </div>
            <div className="space-y-1">
              <Label>Tax ID (EIN/SSN)</Label>
              <Input value={editVendorTaxId} onChange={(e) => setEditVendorTaxId(e.target.value)} placeholder="XX-XXXXXXX" data-testid="input-edit-vendor-taxid" />
            </div>
            <label className="flex items-center gap-2 cursor-pointer py-1">
              <input type="checkbox" checked={editVendorIs1099} onChange={(e) => setEditVendorIs1099(e.target.checked)} className="rounded border-border" data-testid="checkbox-edit-vendor-1099" />
              <span className="text-sm">1099 Contractor</span>
            </label>
            <Button onClick={handleUpdateVendor} disabled={updateVendorMutation.isPending} className="w-full" data-testid="button-save-edit-vendor">
              {updateVendorMutation.isPending ? "Saving..." : "Save Changes"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!receiptPreview} onOpenChange={(open) => { if (!open) setReceiptPreview(null); }}>
        <DialogContent className="max-w-2xl max-h-[90vh]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Paperclip className="w-4 h-4" />
              {receiptPreview?.filename || "Receipt"}
            </DialogTitle>
          </DialogHeader>
          {receiptPreview && (
            <div className="flex flex-col items-center gap-4">
              {receiptPreview.filename?.match(/\.(jpg|jpeg|png|gif|webp)$/i) ? (
                <img
                  src={receiptPreview.url}
                  alt={receiptPreview.filename}
                  className="max-w-full max-h-[60vh] rounded-md border border-border/50 object-contain"
                  data-testid="img-receipt-preview"
                />
              ) : receiptPreview.filename?.match(/\.pdf$/i) ? (
                <iframe
                  src={receiptPreview.url}
                  title={receiptPreview.filename}
                  className="w-full h-[60vh] rounded-md border border-border/50"
                  data-testid="iframe-receipt-preview"
                />
              ) : (
                <div className="flex flex-col items-center gap-3 py-8">
                  <FileText className="w-16 h-16 text-muted-foreground/40" />
                  <p className="text-sm text-muted-foreground">Preview not available for this file type</p>
                </div>
              )}
              <a
                href={receiptPreview.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-primary hover:underline"
                data-testid="link-download-receipt"
              >
                Open in new tab
              </a>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
