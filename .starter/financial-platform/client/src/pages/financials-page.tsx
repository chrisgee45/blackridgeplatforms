import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  DollarSign, TrendingUp, TrendingDown, Wallet, ChevronDown, ChevronRight, Search, Plus, Loader2, Trash2, ArrowUpRight, FileDown, FileText,
} from "lucide-react";
import { generatePLPdf, generateFullAccountingPdf } from "@/lib/financial-pdf";
import ReconciliationTab from "./reconciliation-tab";
import BillsTab from "./bills-tab";
import OpeningBalancesTab from "./opening-balances-tab";
import BudgetTab from "./budget-tab";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, LineChart, Line, CartesianGrid, Legend,
} from "recharts";

type DatePreset = "this_month" | "this_quarter" | "this_year" | "last_year";

function getDateRange(preset: DatePreset): { startDate: string; endDate: string } {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  switch (preset) {
    case "this_month":
      return {
        startDate: new Date(y, m, 1).toISOString().split("T")[0],
        endDate: new Date(y, m + 1, 0).toISOString().split("T")[0],
      };
    case "this_quarter": {
      const qStart = Math.floor(m / 3) * 3;
      return {
        startDate: new Date(y, qStart, 1).toISOString().split("T")[0],
        endDate: new Date(y, qStart + 3, 0).toISOString().split("T")[0],
      };
    }
    case "this_year":
      return {
        startDate: `${y}-01-01`,
        endDate: `${y}-12-31`,
      };
    case "last_year":
      return {
        startDate: `${y - 1}-01-01`,
        endDate: `${y - 1}-12-31`,
      };
  }
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function formatDate(dateStr: string | Date): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

interface IncomeStatementData {
  revenue: { accountName: string; amount: number }[];
  expenses: { accountName: string; amount: number }[];
  totalRevenue: number;
  totalExpenses: number;
  netIncome: number;
}

interface BalanceSheetData {
  assets: { accountName: string; balance: number }[];
  liabilities: { accountName: string; balance: number }[];
  equity: { accountName: string; balance: number }[];
  totalAssets: number;
  totalLiabilities: number;
  totalEquity: number;
}

interface CashFlowData {
  inflows: { description: string; amount: number }[];
  outflows: { description: string; amount: number }[];
  netCashFlow: number;
}

interface JournalEntry {
  id: string;
  date: string;
  memo: string;
  source: string;
  status: string;
  totalDebits?: number;
  totalCredits?: number;
  paymentLabel?: string | null;
  lines?: { accountName: string; debit: number; credit: number }[];
}

interface JournalEntryDetail extends JournalEntry {
  lines: { accountName: string; debit: number; credit: number }[];
}

const PRESET_LABELS: Record<DatePreset, string> = {
  this_month: "This Month",
  this_quarter: "This Quarter",
  this_year: "This Year",
  last_year: "Last Year",
};

const CHART_TOOLTIP_STYLE = {
  backgroundColor: "hsl(var(--card))",
  border: "1px solid hsl(var(--border))",
  borderRadius: "6px",
  color: "hsl(var(--foreground))",
};

export default function FinancialsPage() {
  const [preset, setPreset] = useState<DatePreset>("this_year");
  const [activeTab, setActiveTab] = useState("income-statement");
  const { startDate, endDate } = getDateRange(preset);

  const { data: incomeData, isLoading: incomeLoading } = useQuery<IncomeStatementData>({
    queryKey: ["/api/accounting/income-statement", startDate, endDate],
    queryFn: async () => {
      const res = await fetch(`/api/accounting/income-statement?start=${startDate}&end=${endDate}`);
      const json = await res.json();
      const d = json.data || json;
      return {
        revenue: (d.revenue || []).map((r: any) => ({ accountName: r.name, amount: Number(r.amount) })),
        expenses: (d.expenses || []).map((r: any) => ({ accountName: r.name, amount: Number(r.amount) })),
        totalRevenue: Number(d.totalRevenue ?? 0),
        totalExpenses: Number(d.totalExpenses ?? 0),
        netIncome: Number(d.netIncome ?? 0),
      };
    },
  });

  const { data: balanceData, isLoading: balanceLoading } = useQuery<BalanceSheetData>({
    queryKey: ["/api/accounting/balance-sheet", endDate],
    queryFn: async () => {
      const res = await fetch(`/api/accounting/balance-sheet?asOf=${endDate}`);
      const json = await res.json();
      const d = json.data || json;
      return {
        assets: (d.assets || []).map((r: any) => ({ accountName: r.name, balance: Number(r.amount) })),
        liabilities: (d.liabilities || []).map((r: any) => ({ accountName: r.name, balance: Number(r.amount) })),
        equity: (d.equity || []).map((r: any) => ({ accountName: r.name, balance: Number(r.amount) })),
        totalAssets: Number(d.totalAssets ?? 0),
        totalLiabilities: Number(d.totalLiabilities ?? 0),
        totalEquity: Number(d.totalEquity ?? 0),
      };
    },
  });

  const { data: cashFlowData, isLoading: cashFlowLoading } = useQuery<CashFlowData>({
    queryKey: ["/api/accounting/cash-flow", startDate, endDate],
    queryFn: async () => {
      const res = await fetch(`/api/accounting/cash-flow?start=${startDate}&end=${endDate}`);
      const json = await res.json();
      const d = json.data || json;
      return {
        inflows: d.inflows || [],
        outflows: d.outflows || [],
        netCashFlow: Number(d.netCashFlow ?? 0),
      };
    },
  });

  const { data: journalEntries, isLoading: journalLoading } = useQuery<JournalEntry[]>({
    queryKey: ["/api/accounting/transactions", startDate, endDate],
    queryFn: async () => {
      const res = await fetch(`/api/accounting/transactions?start=${startDate}&end=${endDate}`);
      const json = await res.json();
      return (json.data || json || []).map((tx: any) => ({
        id: tx.id,
        date: tx.date,
        memo: tx.memo || "",
        source: tx.source || "",
        status: tx.status || "posted",
        totalDebits: Number(tx.totalDebits ?? 0),
        totalCredits: Number(tx.totalCredits ?? 0),
        paymentLabel: tx.paymentLabel || null,
        lines: (tx.lines || []).map((l: any) => ({
          accountName: l.accountName,
          debit: Number(l.debit ?? 0),
          credit: Number(l.credit ?? 0),
        })),
      }));
    },
  });

  const totalRevenue = incomeData?.totalRevenue ?? 0;
  const totalExpenses = incomeData?.totalExpenses ?? 0;
  const netIncome = incomeData?.netIncome ?? 0;
  const cashBalance = cashFlowData?.netCashFlow ?? 0;

  const { toast } = useToast();

  const { data: v2Accounts } = useQuery<{ ok: boolean; data: { id: string; code: string; name: string; type: string }[] }>({
    queryKey: ["/api/accounting/accounts"],
    queryFn: () => fetch("/api/accounting/accounts").then(r => r.json()),
  });
  const revenueAccounts = v2Accounts?.data?.filter(a => a.type === "revenue") ?? [];
  const expenseAccounts = v2Accounts?.data?.filter(a => a.type === "expense") ?? [];

  const [revenueDialogOpen, setRevenueDialogOpen] = useState(false);
  const [revAmount, setRevAmount] = useState("");
  const [revAccountId, setRevAccountId] = useState("");
  const [revPaymentMethod, setRevPaymentMethod] = useState("cash");
  const [revTaxAmount, setRevTaxAmount] = useState("");
  const [revIsDeposit, setRevIsDeposit] = useState(false);
  const [revMemo, setRevMemo] = useState("");

  const [expenseDialogOpen, setExpenseDialogOpen] = useState(false);
  const [expAmount, setExpAmount] = useState("");
  const [expAccountId, setExpAccountId] = useState("");
  const [expPaymentMethod, setExpPaymentMethod] = useState("cash");
  const [expMemo, setExpMemo] = useState("");

  const [drawDialogOpen, setDrawDialogOpen] = useState(false);
  const [drawAmount, setDrawAmount] = useState("");
  const [drawMemo, setDrawMemo] = useState("");

  function invalidateAll() {
    queryClient.invalidateQueries({ queryKey: ["/api/accounting/income-statement"] });
    queryClient.invalidateQueries({ queryKey: ["/api/accounting/balance-sheet"] });
    queryClient.invalidateQueries({ queryKey: ["/api/accounting/cash-flow"] });
    queryClient.invalidateQueries({ queryKey: ["/api/accounting/transactions"] });
    queryClient.invalidateQueries({ queryKey: ["/api/accounting/activity"] });
  }

  const revenueMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/accounting/revenue", {
      amount: parseFloat(revAmount),
      revenueAccountId: revAccountId,
      paymentMethod: revPaymentMethod,
      salesTaxAmount: revTaxAmount ? parseFloat(revTaxAmount) : undefined,
      isDeposit: revIsDeposit,
      memo: revMemo,
    }),
    onSuccess: () => {
      toast({ title: "Revenue recorded", description: `$${parseFloat(revAmount).toLocaleString()} posted to ledger` });
      invalidateAll();
      setRevenueDialogOpen(false);
      setRevAmount(""); setRevAccountId(""); setRevPaymentMethod("cash");
      setRevTaxAmount(""); setRevIsDeposit(false); setRevMemo("");
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err?.message || "Failed to record revenue", variant: "destructive" });
    },
  });

  const expenseMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/accounting/expense", {
      amount: parseFloat(expAmount),
      expenseAccountId: expAccountId,
      paymentMethod: expPaymentMethod,
      memo: expMemo,
    }),
    onSuccess: () => {
      toast({ title: "Expense recorded", description: `$${parseFloat(expAmount).toLocaleString()} posted to ledger` });
      invalidateAll();
      setExpenseDialogOpen(false);
      setExpAmount(""); setExpAccountId(""); setExpPaymentMethod("cash"); setExpMemo("");
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err?.message || "Failed to record expense", variant: "destructive" });
    },
  });

  const drawMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/accounting/owner-draw", {
      amount: parseFloat(drawAmount),
      memo: drawMemo || undefined,
    }),
    onSuccess: () => {
      toast({ title: "Owner's draw recorded", description: `$${parseFloat(drawAmount).toLocaleString()} withdrawn` });
      invalidateAll();
      setDrawDialogOpen(false);
      setDrawAmount(""); setDrawMemo("");
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err?.message || "Failed to record draw", variant: "destructive" });
    },
  });

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight" data-testid="text-page-title">Financials</h1>
          <p className="text-muted-foreground text-sm mt-1" data-testid="text-date-range">
            {formatDate(startDate)} - {formatDate(endDate)}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {(Object.keys(PRESET_LABELS) as DatePreset[]).map((p) => (
            <Button
              key={p}
              variant={preset === p ? "default" : "outline"}
              size="sm"
              onClick={() => setPreset(p)}
              data-testid={`button-preset-${p}`}
            >
              {PRESET_LABELS[p]}
            </Button>
          ))}

          <Dialog open={revenueDialogOpen} onOpenChange={setRevenueDialogOpen}>
            <DialogTrigger asChild>
              <Button size="sm" data-testid="button-record-revenue">
                <Plus className="w-4 h-4 mr-1" /> Record Revenue
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Record Revenue</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 pt-2">
                <div>
                  <label className="text-sm font-medium">Amount ($)</label>
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    placeholder="0.00"
                    value={revAmount}
                    onChange={(e) => setRevAmount(e.target.value)}
                    data-testid="input-revenue-amount"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium">Revenue Category</label>
                  <Select value={revAccountId} onValueChange={setRevAccountId}>
                    <SelectTrigger data-testid="select-revenue-category">
                      <SelectValue placeholder="Select category" />
                    </SelectTrigger>
                    <SelectContent>
                      {revenueAccounts.map((a) => (
                        <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-sm font-medium">Payment Method</label>
                  <Select value={revPaymentMethod} onValueChange={setRevPaymentMethod}>
                    <SelectTrigger data-testid="select-revenue-payment-method">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="cash">Cash</SelectItem>
                      <SelectItem value="stripe">Stripe</SelectItem>
                      <SelectItem value="ach">ACH</SelectItem>
                      <SelectItem value="check">Check</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-sm font-medium">Sales Tax Included (optional)</label>
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    placeholder="0.00"
                    value={revTaxAmount}
                    onChange={(e) => setRevTaxAmount(e.target.value)}
                    data-testid="input-revenue-tax"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="rev-deposit"
                    checked={revIsDeposit}
                    onChange={(e) => setRevIsDeposit(e.target.checked)}
                    className="h-4 w-4 rounded border-border"
                    data-testid="checkbox-revenue-deposit"
                  />
                  <label htmlFor="rev-deposit" className="text-sm">This is a deposit (unearned revenue)</label>
                </div>
                <div>
                  <label className="text-sm font-medium">Memo</label>
                  <Textarea
                    placeholder="e.g. Payment from Acme Corp for website build"
                    value={revMemo}
                    onChange={(e) => setRevMemo(e.target.value)}
                    data-testid="input-revenue-memo"
                  />
                </div>
                <Button
                  className="w-full"
                  disabled={!revAmount || !revAccountId || revenueMutation.isPending}
                  onClick={() => revenueMutation.mutate()}
                  data-testid="button-submit-revenue"
                >
                  {revenueMutation.isPending ? (
                    <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Posting...</>
                  ) : (
                    <>Post to Ledger</>
                  )}
                </Button>
              </div>
            </DialogContent>
          </Dialog>

          <Dialog open={expenseDialogOpen} onOpenChange={setExpenseDialogOpen}>
            <DialogTrigger asChild>
              <Button size="sm" variant="outline" data-testid="button-record-expense">
                <Plus className="w-4 h-4 mr-1" /> Record Expense
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Record Expense</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 pt-2">
                <div>
                  <label className="text-sm font-medium">Amount ($)</label>
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    placeholder="0.00"
                    value={expAmount}
                    onChange={(e) => setExpAmount(e.target.value)}
                    data-testid="input-expense-amount"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium">Expense Category</label>
                  <Select value={expAccountId} onValueChange={setExpAccountId}>
                    <SelectTrigger data-testid="select-expense-category">
                      <SelectValue placeholder="Select category" />
                    </SelectTrigger>
                    <SelectContent>
                      {expenseAccounts.map((a) => (
                        <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-sm font-medium">Payment Method</label>
                  <Select value={expPaymentMethod} onValueChange={setExpPaymentMethod}>
                    <SelectTrigger data-testid="select-expense-payment-method">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="cash">Cash / Debit</SelectItem>
                      <SelectItem value="credit_card">Credit Card</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-sm font-medium">Memo</label>
                  <Textarea
                    placeholder="e.g. Monthly hosting bill"
                    value={expMemo}
                    onChange={(e) => setExpMemo(e.target.value)}
                    data-testid="input-expense-memo"
                  />
                </div>
                <Button
                  className="w-full"
                  disabled={!expAmount || !expAccountId || expenseMutation.isPending}
                  onClick={() => expenseMutation.mutate()}
                  data-testid="button-submit-expense"
                >
                  {expenseMutation.isPending ? (
                    <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Posting...</>
                  ) : (
                    <>Post to Ledger</>
                  )}
                </Button>
              </div>
            </DialogContent>
          </Dialog>

          <Dialog open={drawDialogOpen} onOpenChange={setDrawDialogOpen}>
            <DialogTrigger asChild>
              <Button size="sm" variant="outline" data-testid="button-owner-draw">
                <ArrowUpRight className="w-4 h-4 mr-1" /> Owner's Draw
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Owner's Draw</DialogTitle>
              </DialogHeader>
              <p className="text-sm text-muted-foreground">
                Record a personal withdrawal. This reduces Cash and Equity — it does not affect your P&L.
              </p>
              <div className="space-y-4 pt-2">
                <div>
                  <label className="text-sm font-medium">Amount ($)</label>
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    placeholder="0.00"
                    value={drawAmount}
                    onChange={(e) => setDrawAmount(e.target.value)}
                    data-testid="input-draw-amount"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium">Memo (optional)</label>
                  <Textarea
                    placeholder="e.g. Transfer to personal checking"
                    value={drawMemo}
                    onChange={(e) => setDrawMemo(e.target.value)}
                    data-testid="input-draw-memo"
                  />
                </div>
                <Button
                  className="w-full"
                  disabled={!drawAmount || isNaN(parseFloat(drawAmount)) || parseFloat(drawAmount) <= 0 || drawMutation.isPending}
                  onClick={() => drawMutation.mutate()}
                  data-testid="button-submit-draw"
                >
                  {drawMutation.isPending ? (
                    <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Posting...</>
                  ) : (
                    <>Post to Ledger</>
                  )}
                </Button>
              </div>
            </DialogContent>
          </Dialog>

          <Button
            size="sm"
            variant="outline"
            disabled={incomeLoading || !incomeData}
            onClick={() => {
              if (incomeData) generatePLPdf(incomeData, startDate, endDate);
            }}
            data-testid="button-export-pl"
          >
            <FileDown className="w-4 h-4 mr-1" /> P&L PDF
          </Button>

          <Button
            size="sm"
            variant="outline"
            disabled={incomeLoading || balanceLoading || cashFlowLoading || journalLoading || !incomeData || !balanceData || !cashFlowData}
            onClick={() => {
              if (incomeData && balanceData && cashFlowData) {
                generateFullAccountingPdf(incomeData, balanceData, cashFlowData, journalEntries ?? [], startDate, endDate);
              }
            }}
            data-testid="button-export-full"
          >
            <FileText className="w-4 h-4 mr-1" /> Full Report for CPA
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <SummaryCard
          title="Total Revenue"
          value={totalRevenue}
          icon={<DollarSign className="w-4 h-4 text-emerald-500" />}
          loading={incomeLoading}
          testId="stat-total-revenue"
          valueClass="text-emerald-500"
        />
        <SummaryCard
          title="Total Expenses"
          value={totalExpenses}
          icon={<TrendingDown className="w-4 h-4 text-red-400" />}
          loading={incomeLoading}
          testId="stat-total-expenses"
          valueClass="text-red-400"
        />
        <SummaryCard
          title="Net Income"
          value={netIncome}
          icon={<TrendingUp className="w-4 h-4 text-primary" />}
          loading={incomeLoading}
          testId="stat-net-income"
          valueClass={netIncome >= 0 ? "text-emerald-500" : "text-red-400"}
        />
        <SummaryCard
          title="Cash Balance"
          value={cashBalance}
          icon={<Wallet className="w-4 h-4 text-blue-500" />}
          loading={cashFlowLoading}
          testId="stat-cash-balance"
          valueClass={cashBalance >= 0 ? "text-emerald-500" : "text-red-400"}
        />
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList data-testid="tabs-financials">
          <TabsTrigger value="income-statement" data-testid="tab-income-statement">Income Statement</TabsTrigger>
          <TabsTrigger value="balance-sheet" data-testid="tab-balance-sheet">Balance Sheet</TabsTrigger>
          <TabsTrigger value="cash-flow" data-testid="tab-cash-flow">Cash Flow</TabsTrigger>
          <TabsTrigger value="general-ledger" data-testid="tab-general-ledger">General Ledger</TabsTrigger>
          <TabsTrigger value="reconciliation" data-testid="tab-reconciliation">Reconciliation</TabsTrigger>
          <TabsTrigger value="bills" data-testid="tab-bills">Bills / AP</TabsTrigger>
          <TabsTrigger value="opening-balances" data-testid="tab-opening-balances">Opening Balances</TabsTrigger>
          <TabsTrigger value="budget" data-testid="tab-budget">Budget</TabsTrigger>
        </TabsList>

        <TabsContent value="income-statement" className="mt-4 space-y-4">
          <IncomeStatementTab data={incomeData} loading={incomeLoading} />
        </TabsContent>

        <TabsContent value="balance-sheet" className="mt-4 space-y-4">
          <BalanceSheetTab data={balanceData} loading={balanceLoading} />
        </TabsContent>

        <TabsContent value="cash-flow" className="mt-4 space-y-4">
          <CashFlowTab data={cashFlowData} loading={cashFlowLoading} />
        </TabsContent>

        <TabsContent value="general-ledger" className="mt-4 space-y-4">
          <GeneralLedgerTab entries={journalEntries ?? []} loading={journalLoading} />
        </TabsContent>

        <TabsContent value="reconciliation" className="mt-4 space-y-4">
          <ReconciliationTab />
        </TabsContent>

        <TabsContent value="bills" className="mt-4 space-y-4">
          <BillsTab />
        </TabsContent>

        <TabsContent value="opening-balances" className="mt-4 space-y-4">
          <OpeningBalancesTab />
        </TabsContent>

        <TabsContent value="budget" className="mt-4 space-y-4">
          <BudgetTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function SummaryCard({
  title, value, icon, loading, testId, valueClass = "",
}: {
  title: string;
  value: number;
  icon: React.ReactNode;
  loading: boolean;
  testId: string;
  valueClass?: string;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
        {icon}
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-8 w-24" />
        ) : (
          <div className={`text-2xl font-bold ${valueClass}`} data-testid={testId}>
            {formatCurrency(value)}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function IncomeStatementTab({ data, loading }: { data?: IncomeStatementData; loading: boolean }) {
  if (loading) {
    return (
      <Card>
        <CardContent className="p-6 space-y-3">
          {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}
        </CardContent>
      </Card>
    );
  }

  const revenue = data?.revenue ?? [];
  const expenses = data?.expenses ?? [];

  const chartData = useMemo(() => {
    const categories: { name: string; revenue: number; expenses: number }[] = [];
    if (revenue.length > 0 || expenses.length > 0) {
      categories.push({
        name: "Revenue",
        revenue: data?.totalRevenue ?? 0,
        expenses: 0,
      });
      categories.push({
        name: "Expenses",
        revenue: 0,
        expenses: data?.totalExpenses ?? 0,
      });
      categories.push({
        name: "Net Income",
        revenue: Math.max(0, data?.netIncome ?? 0),
        expenses: Math.max(0, -(data?.netIncome ?? 0)),
      });
    }
    return categories;
  }, [data]);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle className="text-base" data-testid="text-income-statement-title">
            Profit & Loss Statement
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Account</TableHead>
                <TableHead className="text-right">Amount</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow>
                <TableCell colSpan={2} className="font-semibold text-emerald-500">Revenue</TableCell>
              </TableRow>
              {revenue.map((item, i) => (
                <TableRow key={i} data-testid={`row-revenue-${i}`}>
                  <TableCell className="pl-8">{item.accountName}</TableCell>
                  <TableCell className="text-right">{formatCurrency(Number(item.amount))}</TableCell>
                </TableRow>
              ))}
              <TableRow className="border-t-2">
                <TableCell className="font-semibold">Total Revenue</TableCell>
                <TableCell className="text-right font-semibold text-emerald-500" data-testid="text-total-revenue">
                  {formatCurrency(data?.totalRevenue ?? 0)}
                </TableCell>
              </TableRow>

              <TableRow>
                <TableCell colSpan={2} className="font-semibold text-red-400 pt-6">Expenses</TableCell>
              </TableRow>
              {expenses.map((item, i) => (
                <TableRow key={i} data-testid={`row-expense-${i}`}>
                  <TableCell className="pl-8">{item.accountName}</TableCell>
                  <TableCell className="text-right">{formatCurrency(Number(item.amount))}</TableCell>
                </TableRow>
              ))}
              <TableRow className="border-t-2">
                <TableCell className="font-semibold">Total Expenses</TableCell>
                <TableCell className="text-right font-semibold text-red-400" data-testid="text-total-expenses">
                  {formatCurrency(data?.totalExpenses ?? 0)}
                </TableCell>
              </TableRow>

              <TableRow className="border-t-4">
                <TableCell className="font-bold text-lg">Net Income</TableCell>
                <TableCell
                  className={`text-right font-bold text-lg ${(data?.netIncome ?? 0) >= 0 ? "text-emerald-500" : "text-red-400"}`}
                  data-testid="text-net-income"
                >
                  {formatCurrency(data?.netIncome ?? 0)}
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">P&L Summary</CardTitle>
        </CardHeader>
        <CardContent>
          {chartData.length > 0 ? (
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={chartData}>
                <XAxis dataKey="name" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }} />
                <YAxis tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }} />
                <Tooltip contentStyle={CHART_TOOLTIP_STYLE} />
                <Bar dataKey="revenue" fill="#10b981" name="Revenue" radius={[4, 4, 0, 0]} />
                <Bar dataKey="expenses" fill="#ef4444" name="Expenses" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex items-center justify-center h-[300px] text-muted-foreground text-sm">
              No data available
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function BalanceSheetTab({ data, loading }: { data?: BalanceSheetData; loading: boolean }) {
  if (loading) {
    return (
      <Card>
        <CardContent className="p-6 space-y-3">
          {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}
        </CardContent>
      </Card>
    );
  }

  const assets = data?.assets ?? [];
  const liabilities = data?.liabilities ?? [];
  const equity = data?.equity ?? [];

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-6">
          <div className="flex items-center justify-center gap-4 flex-wrap text-sm">
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">Assets</span>
              <span className="font-bold text-lg" data-testid="text-equation-assets">
                {formatCurrency(data?.totalAssets ?? 0)}
              </span>
            </div>
            <span className="text-muted-foreground text-lg">=</span>
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">Liabilities</span>
              <span className="font-bold text-lg" data-testid="text-equation-liabilities">
                {formatCurrency(data?.totalLiabilities ?? 0)}
              </span>
            </div>
            <span className="text-muted-foreground text-lg">+</span>
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">Equity</span>
              <span className="font-bold text-lg" data-testid="text-equation-equity">
                {formatCurrency(data?.totalEquity ?? 0)}
              </span>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <BalanceSection title="Assets" items={assets} total={data?.totalAssets ?? 0} color="text-emerald-500" testId="section-assets" />
        <BalanceSection title="Liabilities" items={liabilities} total={data?.totalLiabilities ?? 0} color="text-red-400" testId="section-liabilities" />
        <BalanceSection title="Equity" items={equity} total={data?.totalEquity ?? 0} color="text-blue-500" testId="section-equity" />
      </div>
    </div>
  );
}

function BalanceSection({
  title, items, total, color, testId,
}: {
  title: string;
  items: { accountName: string; balance: number }[];
  total: number;
  color: string;
  testId: string;
}) {
  return (
    <Card data-testid={testId}>
      <CardHeader>
        <CardTitle className={`text-base ${color}`}>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Account</TableHead>
              <TableHead className="text-right">Balance</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.length === 0 ? (
              <TableRow>
                <TableCell colSpan={2} className="text-center text-muted-foreground text-sm">
                  No {title.toLowerCase()} recorded
                </TableCell>
              </TableRow>
            ) : (
              items.map((item, i) => (
                <TableRow key={i} data-testid={`row-${testId}-${i}`}>
                  <TableCell>{item.accountName}</TableCell>
                  <TableCell className="text-right">{formatCurrency(Number(item.balance))}</TableCell>
                </TableRow>
              ))
            )}
            <TableRow className="border-t-2">
              <TableCell className="font-semibold">Total {title}</TableCell>
              <TableCell className={`text-right font-semibold ${color}`}>
                {formatCurrency(total)}
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function CashFlowTab({ data, loading }: { data?: CashFlowData; loading: boolean }) {
  if (loading) {
    return (
      <Card>
        <CardContent className="p-6 space-y-3">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}
        </CardContent>
      </Card>
    );
  }

  const inflows = data?.inflows ?? [];
  const outflows = data?.outflows ?? [];
  const totalInflows = inflows.reduce((s, i) => s + Number(i.amount), 0);
  const totalOutflows = outflows.reduce((s, i) => s + Number(i.amount), 0);

  const chartData = useMemo(() => {
    const items = [];
    if (inflows.length > 0 || outflows.length > 0) {
      items.push({ name: "Inflows", value: totalInflows });
      items.push({ name: "Outflows", value: -totalOutflows });
      items.push({ name: "Net", value: data?.netCashFlow ?? 0 });
    }
    return items;
  }, [data]);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <div className="lg:col-span-2 space-y-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base text-emerald-500" data-testid="text-inflows-title">Cash Inflows</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Description</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {inflows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={2} className="text-center text-muted-foreground text-sm">No inflows</TableCell>
                  </TableRow>
                ) : (
                  inflows.map((item, i) => (
                    <TableRow key={i} data-testid={`row-inflow-${i}`}>
                      <TableCell>{item.description}</TableCell>
                      <TableCell className="text-right text-emerald-500">{formatCurrency(Number(item.amount))}</TableCell>
                    </TableRow>
                  ))
                )}
                <TableRow className="border-t-2">
                  <TableCell className="font-semibold">Total Inflows</TableCell>
                  <TableCell className="text-right font-semibold text-emerald-500" data-testid="text-total-inflows">
                    {formatCurrency(totalInflows)}
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base text-red-400" data-testid="text-outflows-title">Cash Outflows</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Description</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {outflows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={2} className="text-center text-muted-foreground text-sm">No outflows</TableCell>
                  </TableRow>
                ) : (
                  outflows.map((item, i) => (
                    <TableRow key={i} data-testid={`row-outflow-${i}`}>
                      <TableCell>{item.description}</TableCell>
                      <TableCell className="text-right text-red-400">{formatCurrency(Number(item.amount))}</TableCell>
                    </TableRow>
                  ))
                )}
                <TableRow className="border-t-2">
                  <TableCell className="font-semibold">Total Outflows</TableCell>
                  <TableCell className="text-right font-semibold text-red-400" data-testid="text-total-outflows">
                    {formatCurrency(totalOutflows)}
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between gap-4">
              <span className="text-lg font-bold">Net Cash Flow</span>
              <span
                className={`text-2xl font-bold ${(data?.netCashFlow ?? 0) >= 0 ? "text-emerald-500" : "text-red-400"}`}
                data-testid="text-net-cash-flow"
              >
                {formatCurrency(data?.netCashFlow ?? 0)}
              </span>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Cash Flow Trend</CardTitle>
        </CardHeader>
        <CardContent>
          {chartData.length > 0 ? (
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="name" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }} />
                <YAxis tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }} />
                <Tooltip contentStyle={CHART_TOOLTIP_STYLE} />
                <Legend />
                <Line type="monotone" dataKey="value" stroke="#3b82f6" strokeWidth={2} name="Amount" dot={{ r: 4 }} />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex items-center justify-center h-[300px] text-muted-foreground text-sm">
              No data available
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function GeneralLedgerTab({ entries, loading }: { entries: JournalEntry[]; loading: boolean }) {
  const [searchTerm, setSearchTerm] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const { toast } = useToast();

  const filtered = useMemo(() => {
    if (!searchTerm) return entries;
    const lower = searchTerm.toLowerCase();
    return entries.filter(
      (e) =>
        (e.memo ?? "").toLowerCase().includes(lower) ||
        (e.source ?? "").toLowerCase().includes(lower) ||
        (e.paymentLabel ?? "").toLowerCase().includes(lower)
    );
  }, [entries, searchTerm]);

  const { data: expandedEntry } = useQuery<JournalEntryDetail>({
    queryKey: ["/api/accounting/transactions", expandedId],
    enabled: !!expandedId,
    queryFn: () => {
      const entry = entries.find(e => e.id === expandedId);
      if (entry?.lines && entry.lines.length > 0) {
        return Promise.resolve(entry as JournalEntryDetail);
      }
      return Promise.resolve(null as any);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/accounting/transactions/${id}`),
    onSuccess: () => {
      toast({ title: "Entry deleted", description: "Journal entry removed from ledger" });
      queryClient.invalidateQueries({ queryKey: ["/api/accounting/income-statement"] });
      queryClient.invalidateQueries({ queryKey: ["/api/accounting/balance-sheet"] });
      queryClient.invalidateQueries({ queryKey: ["/api/accounting/cash-flow"] });
      queryClient.invalidateQueries({ queryKey: ["/api/accounting/transactions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/accounting/activity"] });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to delete entry", variant: "destructive" });
    },
  });

  if (loading) {
    return (
      <Card>
        <CardContent className="p-6 space-y-3">
          {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-4 flex-wrap">
        <CardTitle className="text-base" data-testid="text-general-ledger-title">Journal Entries</CardTitle>
        <div className="relative w-full max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search entries..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-9"
            data-testid="input-search-journal"
          />
        </div>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8"></TableHead>
              <TableHead>Date</TableHead>
              <TableHead>Memo</TableHead>
              <TableHead>Source</TableHead>
              <TableHead className="text-right">Debits</TableHead>
              <TableHead className="text-right">Credits</TableHead>
              <TableHead className="w-10"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={9} className="text-center text-muted-foreground text-sm py-8">
                  No journal entries found
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((entry) => {
                const isExpanded = expandedId === entry.id;
                return (
                  <JournalRow
                    key={entry.id}
                    entry={entry}
                    isExpanded={isExpanded}
                    expandedEntry={isExpanded ? expandedEntry : undefined}
                    onToggle={() => setExpandedId(isExpanded ? null : entry.id)}
                    onDelete={(id) => {
                      if (window.confirm("Delete this journal entry? This will reverse its effect on all accounts.")) {
                        deleteMutation.mutate(id);
                      }
                    }}
                    deleting={deleteMutation.isPending}
                  />
                );
              })
            )}
          </TableBody>
        </Table>
        <div className="mt-3 text-xs text-muted-foreground" data-testid="text-journal-count">
          {filtered.length} {filtered.length === 1 ? "entry" : "entries"}
        </div>
      </CardContent>
    </Card>
  );
}

function JournalRow({
  entry, isExpanded, expandedEntry, onToggle, onDelete, deleting,
}: {
  entry: JournalEntry;
  isExpanded: boolean;
  expandedEntry?: JournalEntryDetail;
  onToggle: () => void;
  onDelete: (id: string) => void;
  deleting: boolean;
}) {
  return (
    <>
      <TableRow
        className="cursor-pointer hover-elevate"
        onClick={onToggle}
        data-testid={`row-journal-${entry.id}`}
      >
        <TableCell>
          {isExpanded ? (
            <ChevronDown className="w-4 h-4 text-muted-foreground" />
          ) : (
            <ChevronRight className="w-4 h-4 text-muted-foreground" />
          )}
        </TableCell>
        <TableCell className="whitespace-nowrap">{formatDate(entry.date)}</TableCell>
        <TableCell className="max-w-[200px] truncate">{entry.memo || "—"}</TableCell>
        <TableCell>
          {entry.source ? (
            <Badge variant="secondary" className="no-default-hover-elevate no-default-active-elevate text-xs">
              {entry.source}
            </Badge>
          ) : "—"}
        </TableCell>
        <TableCell className="text-right tabular-nums">
          {formatCurrency(Number(entry.totalDebits ?? 0))}
        </TableCell>
        <TableCell className="text-right tabular-nums">
          {formatCurrency(Number(entry.totalCredits ?? 0))}
        </TableCell>
        <TableCell className="text-right">
          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0 text-red-400 hover:text-red-600 hover:bg-red-50"
            disabled={deleting}
            onClick={(e) => { e.stopPropagation(); onDelete(entry.id); }}
            data-testid={`button-delete-journal-${entry.id}`}
          >
            <Trash2 className="w-4 h-4" />
          </Button>
        </TableCell>
      </TableRow>
      {isExpanded && expandedEntry?.lines && (
        <TableRow data-testid={`row-journal-lines-${entry.id}`}>
          <TableCell colSpan={9} className="bg-muted/30 p-0">
            <div className="p-4 space-y-3">
              {entry.paymentLabel && (
                <div className="flex flex-wrap gap-4 text-sm pb-2 border-b border-border/50">
                  <div data-testid={`detail-payment-${entry.id}`}>
                    <span className="text-muted-foreground">Payment:</span>{" "}
                    <span className="font-medium">{entry.paymentLabel}</span>
                  </div>
                </div>
              )}
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Account</TableHead>
                    <TableHead className="text-right">Debit</TableHead>
                    <TableHead className="text-right">Credit</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {expandedEntry.lines.map((line, i) => (
                    <TableRow key={i} data-testid={`row-journal-line-${entry.id}-${i}`}>
                      <TableCell>{line.accountName}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {Number(line.debit) > 0 ? formatCurrency(Number(line.debit)) : ""}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {Number(line.credit) > 0 ? formatCurrency(Number(line.credit)) : ""}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </TableCell>
        </TableRow>
      )}
    </>
  );
}
