import { useState, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { usePlaidLink } from "react-plaid-link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Building2, RefreshCw, Trash2, Search, Loader2, Link2, Unlink, Zap,
  CheckCircle2, Clock, XCircle, Eye, ArrowRightLeft, Plus, Landmark,
} from "lucide-react";

type PlaidConnection = {
  id: string;
  institutionName: string;
  accountName: string | null;
  accountMask: string | null;
  accountType: string | null;
  isPersonal: boolean;
  status: string;
  lastSyncedAt: string | null;
  createdAt: string;
};

type BankTransaction = {
  id: string;
  connectionId: string;
  date: string;
  name: string;
  merchantName: string | null;
  amount: string;
  category: string | null;
  status: "pending" | "matched" | "categorized" | "ignored";
  matchedExpenseId: number | null;
  notes: string | null;
};

type Stats = {
  pending: number;
  matched: number;
  categorized: number;
  ignored: number;
  total: number;
};

function PlaidLinkButton({ onSuccess }: { onSuccess: () => void }) {
  const { toast } = useToast();
  const [linkToken, setLinkToken] = useState<string | null>(null);

  const createLinkToken = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/plaid/create-link-token");
      return res.json();
    },
    onSuccess: (data: any) => {
      setLinkToken(data.link_token);
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error?.message || "Failed to initialize bank connection", variant: "destructive" });
    },
  });

  const exchangeToken = useMutation({
    mutationFn: async (data: { public_token: string; metadata: any }) => {
      const res = await apiRequest("POST", "/api/plaid/exchange-token", data);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Connected", description: "Bank account connected successfully" });
      queryClient.invalidateQueries({ queryKey: ["/api/plaid/connections"] });
      onSuccess();
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to connect bank account", variant: "destructive" });
    },
  });

  const onPlaidSuccess = useCallback((publicToken: string, metadata: any) => {
    exchangeToken.mutate({ public_token: publicToken, metadata });
  }, []);

  const { open, ready } = usePlaidLink({
    token: linkToken,
    onSuccess: onPlaidSuccess,
  });

  if (!linkToken) {
    return (
      <Button
        onClick={() => createLinkToken.mutate()}
        disabled={createLinkToken.isPending}
        data-testid="btn-connect-bank"
      >
        {createLinkToken.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Plus className="h-4 w-4 mr-2" />}
        Connect Bank Account
      </Button>
    );
  }

  return (
    <Button onClick={() => open()} disabled={!ready || exchangeToken.isPending} data-testid="btn-plaid-link">
      {exchangeToken.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Landmark className="h-4 w-4 mr-2" />}
      Select Your Bank
    </Button>
  );
}

function ConnectionCard({ conn, onSync }: { conn: PlaidConnection; onSync: () => void }) {
  const { toast } = useToast();

  const togglePersonalMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("PATCH", `/api/plaid/connections/${conn.id}`, { isPersonal: !conn.isPersonal });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: conn.isPersonal ? "Set as Business" : "Set as Personal", description: "Account type updated" });
      queryClient.invalidateQueries({ queryKey: ["/api/plaid/connections"] });
    },
  });

  const syncMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/plaid/sync/${conn.id}`);
      return res.json();
    },
    onSuccess: (data: any) => {
      toast({ title: "Synced", description: `${data.added} new, ${data.updated} updated, ${data.removed} removed` });
      queryClient.invalidateQueries({ queryKey: ["/api/plaid/transactions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/plaid/transactions/stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/plaid/connections"] });
      onSync();
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to sync transactions", variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("DELETE", `/api/plaid/connections/${conn.id}`);
    },
    onSuccess: () => {
      toast({ title: "Disconnected", description: "Bank account removed" });
      queryClient.invalidateQueries({ queryKey: ["/api/plaid/connections"] });
      queryClient.invalidateQueries({ queryKey: ["/api/plaid/transactions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/plaid/transactions/stats"] });
    },
  });

  const autoMatchMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/plaid/auto-match/${conn.id}`);
      return res.json();
    },
    onSuccess: (data: any) => {
      toast({ title: "Auto-Match Complete", description: `Matched ${data.matched} of ${data.total} pending transactions` });
      queryClient.invalidateQueries({ queryKey: ["/api/plaid/transactions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/plaid/transactions/stats"] });
    },
    onError: () => {
      toast({ title: "Error", description: "Auto-match failed", variant: "destructive" });
    },
  });

  return (
    <Card data-testid={`connection-card-${conn.id}`}>
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-blue-50 flex items-center justify-center">
              <Building2 className="h-5 w-5 text-blue-600" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <p className="font-medium" data-testid={`conn-name-${conn.id}`}>{conn.institutionName}</p>
                {conn.isPersonal && (
                  <Badge className="bg-amber-100 text-amber-800 border-0 text-xs">Personal</Badge>
                )}
              </div>
              <p className="text-sm text-muted-foreground">
                {conn.accountName || "Account"} {conn.accountMask ? `•••${conn.accountMask}` : ""} · {conn.accountType || "checking"}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">
              {conn.lastSyncedAt ? `Synced ${new Date(conn.lastSyncedAt).toLocaleDateString()}` : "Never synced"}
            </span>
            <Button
              size="sm"
              variant={conn.isPersonal ? "default" : "outline"}
              className={conn.isPersonal ? "bg-amber-500 hover:bg-amber-600 text-white h-7 text-xs" : "h-7 text-xs"}
              onClick={() => togglePersonalMutation.mutate()}
              disabled={togglePersonalMutation.isPending}
              data-testid={`btn-toggle-personal-${conn.id}`}
            >
              {conn.isPersonal ? "Personal" : "Business"}
            </Button>
            <Button size="sm" variant="outline" onClick={() => autoMatchMutation.mutate()} disabled={autoMatchMutation.isPending} data-testid={`btn-auto-match-${conn.id}`}>
              {autoMatchMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />}
            </Button>
            <Button size="sm" variant="outline" onClick={() => syncMutation.mutate()} disabled={syncMutation.isPending} data-testid={`btn-sync-${conn.id}`}>
              {syncMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            </Button>
            <Button size="sm" variant="outline" className="text-red-500 hover:text-red-600" onClick={() => deleteMutation.mutate()} disabled={deleteMutation.isPending} data-testid={`btn-disconnect-${conn.id}`}>
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function CategorizeDialog({
  txn,
  open,
  onClose,
  isPersonalAccount,
}: {
  txn: BankTransaction | null;
  open: boolean;
  onClose: () => void;
  isPersonalAccount?: boolean;
}) {
  const { toast } = useToast();
  const [transactionType, setTransactionType] = useState(isPersonalAccount ? "owner_contribution" : "expense");
  const [accountId, setAccountId] = useState("");
  const [description, setDescription] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("card");

  const { data: accounts } = useQuery<any[]>({
    queryKey: ["/api/ops/accounts"],
  });

  const categorizeMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/plaid/transactions/${txn?.id}/categorize`, {
        accountId,
        description: description || undefined,
        paymentMethod,
        taxDeductible: true,
        transactionType,
      });
      return res.json();
    },
    onSuccess: () => {
      const labels: Record<string, string> = {
        expense: "Expense recorded",
        income: "Income recorded",
        refund: "Refund recorded",
        transfer: "Transfer recorded",
        owner_contribution: "Owner contribution recorded",
      };
      toast({ title: "Categorized", description: labels[transactionType] || "Transaction recorded" });
      queryClient.invalidateQueries({ queryKey: ["/api/plaid/transactions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/plaid/transactions/stats"] });
      setTransactionType("expense");
      setAccountId("");
      setDescription("");
      setPaymentMethod("card");
      onClose();
    },
    onError: (err: any) => {
      console.error("Categorize failed:", err);
      const msg = err?.message || err?.error || "Failed to categorize";
      toast({ title: "Error", description: String(msg).slice(0, 300), variant: "destructive" });
    },
  });

  const filteredAccounts = (accounts || []).filter((a: any) => {
    if (transactionType === "income" || transactionType === "refund") return a.type === "revenue";
    if (transactionType === "transfer") return a.type === "asset" || a.type === "liability";
    if (transactionType === "owner_contribution") return a.type === "expense" || a.type === "asset";
    return a.type === "expense";
  });

  const accountLabel = transactionType === "income" || transactionType === "refund"
    ? "Revenue Account"
    : transactionType === "transfer"
      ? "Destination Account"
      : transactionType === "owner_contribution"
        ? "What did the owner pay for?"
        : "Expense Account";

  const submitLabel: Record<string, string> = {
    income: "Record Income",
    refund: "Record Refund",
    transfer: "Record Transfer",
    owner_contribution: "Record as Owner Contribution",
    expense: "Record Expense",
  };

  const amount = txn ? Math.abs(parseFloat(txn.amount)) : 0;
  const isCredit = txn ? parseFloat(txn.amount) < 0 : false;

  return (
    <Dialog open={open} onOpenChange={() => onClose()}>
      <DialogContent data-testid="dialog-categorize">
        <DialogHeader>
          <DialogTitle>Categorize Transaction</DialogTitle>
        </DialogHeader>
        {txn && (
          <div className="space-y-4">
            <div className="p-3 bg-muted rounded-lg">
              <div className="flex items-center justify-between">
                <p className="font-medium">{txn.merchantName || txn.name}</p>
                <Badge className={isCredit ? "bg-emerald-100 text-emerald-800 border-0" : "bg-red-100 text-red-800 border-0"}>
                  {isCredit ? "Credit" : "Debit"} · ${amount.toFixed(2)}
                </Badge>
              </div>
              <p className="text-sm text-muted-foreground mt-1">{txn.date}</p>
            </div>

            <div>
              <label className="text-sm font-medium mb-1 block">Transaction Type</label>
              <Select value={transactionType} onValueChange={(v) => { setTransactionType(v); setAccountId(""); }} data-testid="select-txn-type">
                <SelectTrigger data-testid="select-txn-type-trigger">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="expense">Expense (money out)</SelectItem>
                  <SelectItem value="income">Income / Deposit (money in)</SelectItem>
                  <SelectItem value="refund">Refund (money back)</SelectItem>
                  <SelectItem value="transfer">Transfer (between accounts)</SelectItem>
                  <SelectItem value="owner_contribution">Owner Contribution (personal funds used for business)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <label className="text-sm font-medium mb-1 block">{accountLabel}</label>
              <Select value={accountId} onValueChange={setAccountId} data-testid="select-account">
                <SelectTrigger data-testid="select-account-trigger">
                  <SelectValue placeholder="Select account..." />
                </SelectTrigger>
                <SelectContent>
                  {filteredAccounts.map((a: any) => (
                    <SelectItem key={a.id} value={String(a.id)} data-testid={`account-option-${a.id}`}>
                      {a.accountNumber} - {a.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <label className="text-sm font-medium mb-1 block">Description (optional)</label>
              <Input
                value={description}
                onChange={e => setDescription(e.target.value)}
                placeholder={txn.merchantName || txn.name}
                data-testid="input-description"
              />
            </div>

            <div>
              <label className="text-sm font-medium mb-1 block">Payment Method</label>
              <Select value={paymentMethod} onValueChange={setPaymentMethod}>
                <SelectTrigger data-testid="select-payment-method">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="card">Card</SelectItem>
                  <SelectItem value="ach">ACH</SelectItem>
                  <SelectItem value="check">Check</SelectItem>
                  <SelectItem value="cash">Cash</SelectItem>
                  <SelectItem value="wire">Wire</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <Button
              className="w-full"
              onClick={() => categorizeMutation.mutate()}
              disabled={!accountId || categorizeMutation.isPending}
              data-testid="btn-submit-categorize"
            >
              {categorizeMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <CheckCircle2 className="h-4 w-4 mr-2" />}
              {submitLabel[transactionType] || "Record"}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function MatchDialog({
  txn,
  open,
  onClose,
}: {
  txn: BankTransaction | null;
  open: boolean;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const [search, setSearch] = useState("");

  const { data: expensesList = [] } = useQuery<any[]>({
    queryKey: ["/api/ops/expenses"],
    enabled: open,
  });

  const matchMutation = useMutation({
    mutationFn: async (expenseId: string) => {
      const res = await apiRequest("POST", `/api/plaid/transactions/${txn?.id}/match`, { expenseId });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Matched", description: "Transaction matched to expense" });
      queryClient.invalidateQueries({ queryKey: ["/api/plaid/transactions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/plaid/transactions/stats"] });
      onClose();
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to match transaction", variant: "destructive" });
    },
  });

  const txnAmount = txn ? Math.abs(parseFloat(txn.amount)) : 0;

  const filtered = expensesList
    .filter((e: any) => !e.isVoid)
    .filter((e: any) => {
      if (!search) return true;
      const s = search.toLowerCase();
      return (e.description || "").toLowerCase().includes(s) ||
        String(e.amount).includes(s);
    })
    .sort((a: any, b: any) => {
      const aDiff = Math.abs(Math.abs(parseFloat(a.amount)) - txnAmount);
      const bDiff = Math.abs(Math.abs(parseFloat(b.amount)) - txnAmount);
      return aDiff - bDiff;
    })
    .slice(0, 20);

  return (
    <Dialog open={open} onOpenChange={() => onClose()}>
      <DialogContent className="max-w-lg" data-testid="dialog-match">
        <DialogHeader>
          <DialogTitle>Match to Existing Expense</DialogTitle>
        </DialogHeader>
        {txn && (
          <div className="rounded-lg bg-muted/50 p-3 mb-3">
            <p className="text-sm font-medium">{txn.merchantName || txn.name}</p>
            <p className="text-sm text-muted-foreground">{txn.date} · ${txnAmount.toFixed(2)}</p>
          </div>
        )}
        <Input
          placeholder="Search expenses by description or amount..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          data-testid="input-match-search"
        />
        <div className="max-h-[300px] overflow-y-auto space-y-1 mt-2">
          {filtered.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-4">No matching expenses found</p>
          )}
          {filtered.map((exp: any) => {
            const expAmount = Math.abs(parseFloat(exp.amount));
            const isExactMatch = Math.abs(expAmount - txnAmount) < 0.01;
            return (
              <div
                key={exp.id}
                className={`flex items-center justify-between p-2 rounded-lg border cursor-pointer hover:bg-muted/50 ${isExactMatch ? "border-emerald-300 bg-emerald-50/50" : ""}`}
                onClick={() => matchMutation.mutate(exp.id)}
                data-testid={`match-expense-${exp.id}`}
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate">{exp.description || "No description"}</p>
                  <p className="text-xs text-muted-foreground">
                    {exp.date ? new Date(exp.date).toLocaleDateString() : "No date"}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className={`text-sm font-mono ${isExactMatch ? "text-emerald-600 font-semibold" : ""}`}>
                    ${expAmount.toFixed(2)}
                  </span>
                  {isExactMatch && <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />}
                </div>
              </div>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}

const STATUS_CONFIG = {
  pending: { label: "Pending", color: "bg-yellow-100 text-yellow-800", icon: Clock },
  matched: { label: "Matched", color: "bg-blue-100 text-blue-800", icon: Link2 },
  categorized: { label: "Categorized", color: "bg-emerald-100 text-emerald-800", icon: CheckCircle2 },
  ignored: { label: "Ignored", color: "bg-gray-100 text-gray-600", icon: XCircle },
};

export default function BankSyncTab() {
  const { toast } = useToast();
  const [statusFilter, setStatusFilter] = useState("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [categorizeTxn, setCategorizeTxn] = useState<BankTransaction | null>(null);
  const [matchTxn, setMatchTxn] = useState<BankTransaction | null>(null);

  const { data: connections = [], isLoading: connLoading } = useQuery<PlaidConnection[]>({
    queryKey: ["/api/plaid/connections"],
  });

  const { data: statsData, isLoading: statsLoading } = useQuery<Stats>({
    queryKey: ["/api/plaid/transactions/stats"],
  });

  const { data: txnData, isLoading: txnLoading } = useQuery<{ transactions: BankTransaction[]; total: number }>({
    queryKey: ["/api/plaid/transactions", statusFilter, searchTerm],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (statusFilter !== "all") params.set("status", statusFilter);
      if (searchTerm) params.set("search", searchTerm);
      params.set("limit", "100");
      const res = await fetch(`/api/plaid/transactions?${params}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
  });

  const ignoreMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("PATCH", `/api/plaid/transactions/${id}/status`, { status: "ignored" });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/plaid/transactions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/plaid/transactions/stats"] });
    },
  });

  const unmatchMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("PATCH", `/api/plaid/transactions/${id}/status`, { status: "pending" });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/plaid/transactions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/plaid/transactions/stats"] });
    },
  });

  const stats = statsData || { pending: 0, matched: 0, categorized: 0, ignored: 0, total: 0 };
  const transactions = txnData?.transactions || [];

  return (
    <div className="space-y-6" data-testid="bank-sync-tab">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">Bank Sync</h3>
          <p className="text-sm text-muted-foreground">Connect your bank accounts via Plaid and auto-match transactions</p>
        </div>
        <PlaidLinkButton onSuccess={() => {
          queryClient.invalidateQueries({ queryKey: ["/api/plaid/connections"] });
        }} />
      </div>

      {connLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-16 w-full" />
        </div>
      ) : connections.length > 0 ? (
        <div className="space-y-2">
          {connections.map(conn => (
            <ConnectionCard key={conn.id} conn={conn} onSync={() => {}} />
          ))}
        </div>
      ) : (
        <Card>
          <CardContent className="p-8 text-center">
            <Landmark className="h-12 w-12 text-muted-foreground mx-auto mb-3" />
            <p className="text-muted-foreground">No bank accounts connected yet</p>
            <p className="text-sm text-muted-foreground mt-1">Connect an account to start syncing transactions</p>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-4 gap-3">
        {(["pending", "matched", "categorized", "ignored"] as const).map(status => {
          const config = STATUS_CONFIG[status];
          const Icon = config.icon;
          return (
            <Card
              key={status}
              className={`cursor-pointer transition-all ${statusFilter === status ? "ring-2 ring-primary" : ""}`}
              onClick={() => setStatusFilter(statusFilter === status ? "all" : status)}
              data-testid={`stat-card-${status}`}
            >
              <CardContent className="p-3 flex items-center gap-3">
                <div className={`h-8 w-8 rounded-md flex items-center justify-center ${config.color}`}>
                  <Icon className="h-4 w-4" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">{config.label}</p>
                  <p className="text-lg font-semibold" data-testid={`stat-count-${status}`}>
                    {statsLoading ? "—" : stats[status]}
                  </p>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search transactions..."
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            className="pl-9"
            data-testid="input-search-txn"
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[160px]" data-testid="select-status-filter">
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="matched">Matched</SelectItem>
            <SelectItem value="categorized">Categorized</SelectItem>
            <SelectItem value="ignored">Ignored</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {txnLoading ? (
        <div className="space-y-2">
          {[1, 2, 3, 4, 5].map(i => <Skeleton key={i} className="h-12 w-full" />)}
        </div>
      ) : transactions.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center">
            <ArrowRightLeft className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
            <p className="text-muted-foreground">
              {connections.length === 0 ? "Connect a bank account to see transactions" : "No transactions found"}
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Description</TableHead>
                <TableHead>Category</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {transactions.map(txn => {
                const config = STATUS_CONFIG[txn.status];
                const amount = parseFloat(txn.amount);
                const isDebit = amount > 0;
                return (
                  <TableRow key={txn.id} data-testid={`txn-row-${txn.id}`}>
                    <TableCell className="text-sm">{txn.date}</TableCell>
                    <TableCell>
                      <p className="font-medium text-sm">{txn.merchantName || txn.name}</p>
                      {txn.merchantName && txn.name !== txn.merchantName && (
                        <p className="text-xs text-muted-foreground">{txn.name}</p>
                      )}
                    </TableCell>
                    <TableCell>
                      {txn.category ? (
                        <Badge variant="outline" className="text-xs">{txn.category}</Badge>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className={`text-right font-mono text-sm ${isDebit ? "text-red-600" : "text-emerald-600"}`}>
                      {isDebit ? "-" : "+"}${Math.abs(amount).toFixed(2)}
                    </TableCell>
                    <TableCell>
                      <Badge className={`${config.color} border-0 text-xs`} data-testid={`txn-status-${txn.id}`}>
                        {config.label}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        {txn.status === "pending" && (
                          <>
                            <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => setCategorizeTxn(txn)} data-testid={`btn-categorize-${txn.id}`}>
                              <Plus className="h-3.5 w-3.5 mr-1" /> Categorize
                            </Button>
                            <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => setMatchTxn(txn)} data-testid={`btn-match-${txn.id}`}>
                              <Link2 className="h-3.5 w-3.5 mr-1" /> Match
                            </Button>
                            <Button size="sm" variant="ghost" className="h-7 px-2 text-muted-foreground" onClick={() => ignoreMutation.mutate(txn.id)} data-testid={`btn-ignore-${txn.id}`}>
                              <XCircle className="h-3.5 w-3.5" />
                            </Button>
                          </>
                        )}
                        {(txn.status === "matched" || txn.status === "categorized" || txn.status === "ignored") && (
                          <Button size="sm" variant="ghost" className="h-7 px-2 text-muted-foreground" onClick={() => unmatchMutation.mutate(txn.id)} data-testid={`btn-unmatch-${txn.id}`}>
                            <Unlink className="h-3.5 w-3.5 mr-1" /> Reset
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Card>
      )}

      <CategorizeDialog
        txn={categorizeTxn}
        open={!!categorizeTxn}
        onClose={() => setCategorizeTxn(null)}
        isPersonalAccount={categorizeTxn ? connections.some(c => c.id === categorizeTxn.connectionId && c.isPersonal) : false}
      />

      <MatchDialog
        txn={matchTxn}
        open={!!matchTxn}
        onClose={() => setMatchTxn(null)}
      />
    </div>
  );
}
