import { useState, useMemo, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Tabs, TabsContent, TabsList, TabsTrigger,
} from "@/components/ui/tabs";
import {
  DollarSign, TrendingDown, TrendingUp, Save, FileDown, Loader2, BarChart3,
} from "lucide-react";

const currencyFmt = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

type Account = {
  id: string;
  accountNumber: string;
  name: string;
  type: string;
  isActive: boolean;
};

type BudgetRow = {
  accountId: string;
  accountNumber: string;
  accountName: string;
  budgeted: number;
  actual: number;
  variance: number;
  percentUsed: number;
  status: "over" | "under";
};

type ReportData = {
  report: BudgetRow[];
  totals: { budgeted: number; actual: number; variance: number; percentUsed: number };
  period: string;
  year: number;
  month: number | null;
  quarter: number | null;
};

export default function BudgetTab() {
  const { toast } = useToast();
  const currentYear = new Date().getFullYear();
  const [budgetYear, setBudgetYear] = useState(currentYear);
  const [budgetAmounts, setBudgetAmounts] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);

  const [reportYear, setReportYear] = useState(currentYear);
  const [reportPeriod, setReportPeriod] = useState("year");
  const [reportMonth, setReportMonth] = useState(new Date().getMonth() + 1);
  const [reportQuarter, setReportQuarter] = useState(Math.ceil((new Date().getMonth() + 1) / 3));

  const { data: expenseAccounts, isLoading: accountsLoading } = useQuery<Account[]>({
    queryKey: ["/api/ops/accounts"],
  });

  const filteredAccounts = useMemo(
    () => (expenseAccounts || []).filter(a => a.type === "expense" && a.isActive),
    [expenseAccounts]
  );

  const { data: existingBudgets, isLoading: budgetsLoading } = useQuery<any[]>({
    queryKey: [`/api/ops/budgets?year=${budgetYear}`],
  });

  useEffect(() => {
    if (existingBudgets && filteredAccounts.length > 0) {
      const map: Record<string, string> = {};
      for (const b of existingBudgets) {
        if (b.month == null) {
          map[b.accountId] = String(Number(b.amount));
        }
      }
      setBudgetAmounts(map);
      setDirty(false);
    }
  }, [existingBudgets, filteredAccounts]);

  const reportQueryStr = useMemo(() => {
    let qs = `year=${reportYear}&period=${reportPeriod}`;
    if (reportPeriod === "month") qs += `&month=${reportMonth}`;
    if (reportPeriod === "quarter") qs += `&quarter=${reportQuarter}`;
    return qs;
  }, [reportYear, reportPeriod, reportMonth, reportQuarter]);

  const { data: reportData, isLoading: reportLoading } = useQuery<ReportData>({
    queryKey: [`/api/ops/budget-vs-actual?${reportQueryStr}`],
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      const items = filteredAccounts
        .filter(a => budgetAmounts[a.id] !== undefined && budgetAmounts[a.id] !== "")
        .map(a => ({
          accountId: a.id,
          amount: Number(budgetAmounts[a.id]) || 0,
          month: null,
        }));
      return apiRequest("POST", "/api/ops/budgets/bulk", { budgets: items, year: budgetYear });
    },
    onSuccess: () => {
      toast({ title: "Budgets Saved", description: `Annual budgets for ${budgetYear} saved successfully.` });
      setDirty(false);
      queryClient.invalidateQueries({ queryKey: [`/api/ops/budgets?year=${budgetYear}`] });
      queryClient.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith("/api/ops/budget-vs-actual") });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to save budgets.", variant: "destructive" });
    },
  });

  function handleAmountChange(accountId: string, value: string) {
    const cleaned = value.replace(/[^0-9.]/g, "");
    setBudgetAmounts(prev => ({ ...prev, [accountId]: cleaned }));
    setDirty(true);
  }

  function exportCsv() {
    if (!reportData?.report) return;
    const header = "Account Number,Account Name,Budgeted,Actual,Variance,% Used,Status";
    const rows = reportData.report.map(r =>
      `${r.accountNumber},"${r.accountName}",${r.budgeted.toFixed(2)},${r.actual.toFixed(2)},${r.variance.toFixed(2)},${r.percentUsed.toFixed(1)}%,${r.status}`
    );
    const totals = reportData.totals;
    rows.push(`,"TOTALS",${totals.budgeted.toFixed(2)},${totals.actual.toFixed(2)},${totals.variance.toFixed(2)},${totals.percentUsed.toFixed(1)}%,`);
    const csv = [header, ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const periodLabel = reportPeriod === "month" ? `${MONTHS[reportMonth - 1]}_${reportYear}`
      : reportPeriod === "quarter" ? `Q${reportQuarter}_${reportYear}`
      : String(reportYear);
    a.download = `budget_vs_actual_${periodLabel}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const totalBudgeted = filteredAccounts.reduce((s, a) => s + (Number(budgetAmounts[a.id]) || 0), 0);

  return (
    <Tabs defaultValue="setup">
      <TabsList data-testid="tabs-budget">
        <TabsTrigger value="setup" data-testid="tab-budget-setup">Budget Setup</TabsTrigger>
        <TabsTrigger value="report" data-testid="tab-budget-report">Budget vs. Actual</TabsTrigger>
      </TabsList>

      <TabsContent value="setup" className="mt-4 space-y-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2">
            <div className="flex items-center gap-3">
              <CardTitle className="text-base">Annual Budget by Category</CardTitle>
              <Select value={String(budgetYear)} onValueChange={v => setBudgetYear(Number(v))}>
                <SelectTrigger className="w-28 h-8" data-testid="select-budget-year">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[currentYear - 1, currentYear, currentYear + 1].map(y => (
                    <SelectItem key={y} value={String(y)}>{y}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button
              size="sm"
              onClick={() => saveMutation.mutate()}
              disabled={saveMutation.isPending || !dirty}
              data-testid="button-save-budgets"
            >
              {saveMutation.isPending ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Save className="w-4 h-4 mr-1" />}
              Save Budgets
            </Button>
          </CardHeader>
          <CardContent>
            {accountsLoading || budgetsLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
              </div>
            ) : filteredAccounts.length === 0 ? (
              <p className="text-muted-foreground text-sm py-4">No expense accounts found. Add expense categories in the Chart of Accounts first.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-24">Acct #</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead className="w-40 text-right">Annual Budget</TableHead>
                    <TableHead className="w-32 text-right text-muted-foreground">Monthly Avg</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredAccounts.map(a => {
                    const amt = Number(budgetAmounts[a.id]) || 0;
                    return (
                      <TableRow key={a.id} data-testid={`budget-row-${a.accountNumber}`}>
                        <TableCell className="text-muted-foreground text-xs font-mono">{a.accountNumber}</TableCell>
                        <TableCell className="font-medium">{a.name}</TableCell>
                        <TableCell className="text-right">
                          <Input
                            type="text"
                            inputMode="decimal"
                            className="w-32 text-right ml-auto h-8"
                            placeholder="0.00"
                            value={budgetAmounts[a.id] || ""}
                            onChange={e => handleAmountChange(a.id, e.target.value)}
                            data-testid={`input-budget-${a.accountNumber}`}
                          />
                        </TableCell>
                        <TableCell className="text-right text-muted-foreground text-sm tabular-nums">
                          {amt > 0 ? currencyFmt.format(amt / 12) : "—"}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  <TableRow className="border-t-2 font-semibold">
                    <TableCell />
                    <TableCell>Total Budget</TableCell>
                    <TableCell className="text-right" data-testid="text-total-budget">
                      {currencyFmt.format(totalBudgeted)}
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground">
                      {currencyFmt.format(totalBudgeted / 12)}
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="report" className="mt-4 space-y-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 flex-wrap">
            <CardTitle className="text-base flex items-center gap-2">
              <BarChart3 className="w-5 h-5 text-blue-500" />
              Budget vs. Actual
            </CardTitle>
            <div className="flex items-center gap-2 flex-wrap">
              <Select value={String(reportYear)} onValueChange={v => setReportYear(Number(v))}>
                <SelectTrigger className="w-24 h-8" data-testid="select-report-year">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[currentYear - 1, currentYear, currentYear + 1].map(y => (
                    <SelectItem key={y} value={String(y)}>{y}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={reportPeriod} onValueChange={v => setReportPeriod(v)}>
                <SelectTrigger className="w-28 h-8" data-testid="select-report-period">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="month">Month</SelectItem>
                  <SelectItem value="quarter">Quarter</SelectItem>
                  <SelectItem value="year">Full Year</SelectItem>
                </SelectContent>
              </Select>
              {reportPeriod === "month" && (
                <Select value={String(reportMonth)} onValueChange={v => setReportMonth(Number(v))}>
                  <SelectTrigger className="w-24 h-8" data-testid="select-report-month">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {MONTHS.map((m, i) => (
                      <SelectItem key={i} value={String(i + 1)}>{m}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              {reportPeriod === "quarter" && (
                <Select value={String(reportQuarter)} onValueChange={v => setReportQuarter(Number(v))}>
                  <SelectTrigger className="w-20 h-8" data-testid="select-report-quarter">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {[1, 2, 3, 4].map(q => (
                      <SelectItem key={q} value={String(q)}>Q{q}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              <Button variant="outline" size="sm" onClick={exportCsv} disabled={!reportData?.report?.length} data-testid="button-export-budget-csv">
                <FileDown className="w-4 h-4 mr-1" /> CSV
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {reportLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
              </div>
            ) : !reportData?.report?.length ? (
              <p className="text-muted-foreground text-sm py-6 text-center">No budget or expense data found for this period. Set budgets in the Budget Setup tab first.</p>
            ) : (
              <>
                <div className="grid grid-cols-3 gap-4 mb-6">
                  <SummaryCard
                    label="Total Budgeted"
                    value={reportData.totals.budgeted}
                    icon={<DollarSign className="w-4 h-4 text-blue-500" />}
                    testId="stat-total-budgeted"
                  />
                  <SummaryCard
                    label="Total Actual"
                    value={reportData.totals.actual}
                    icon={reportData.totals.actual > reportData.totals.budgeted
                      ? <TrendingUp className="w-4 h-4 text-red-500" />
                      : <TrendingDown className="w-4 h-4 text-emerald-500" />}
                    testId="stat-total-actual"
                    valueClass={reportData.totals.actual > reportData.totals.budgeted ? "text-red-500" : "text-emerald-500"}
                  />
                  <SummaryCard
                    label="Variance"
                    value={reportData.totals.variance}
                    icon={reportData.totals.variance < 0
                      ? <TrendingUp className="w-4 h-4 text-red-500" />
                      : <TrendingDown className="w-4 h-4 text-emerald-500" />}
                    testId="stat-total-variance"
                    valueClass={reportData.totals.variance < 0 ? "text-red-500" : "text-emerald-500"}
                  />
                </div>

                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-20">Acct #</TableHead>
                      <TableHead>Category</TableHead>
                      <TableHead className="text-right w-28">Budgeted</TableHead>
                      <TableHead className="text-right w-28">Actual</TableHead>
                      <TableHead className="text-right w-28">Variance</TableHead>
                      <TableHead className="w-48">Progress</TableHead>
                      <TableHead className="text-right w-20">% Used</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {reportData.report.map(row => {
                      const isOver = row.status === "over";
                      const pct = Math.min(row.percentUsed, 100);
                      const overPct = row.percentUsed > 100 ? Math.min(row.percentUsed - 100, 100) : 0;
                      return (
                        <TableRow key={row.accountId} data-testid={`report-row-${row.accountNumber}`}>
                          <TableCell className="text-muted-foreground text-xs font-mono">{row.accountNumber}</TableCell>
                          <TableCell className="font-medium">{row.accountName}</TableCell>
                          <TableCell className="text-right tabular-nums">{currencyFmt.format(row.budgeted)}</TableCell>
                          <TableCell className={`text-right tabular-nums font-medium ${isOver ? "text-red-500" : "text-emerald-600"}`}>
                            {currencyFmt.format(row.actual)}
                          </TableCell>
                          <TableCell className={`text-right tabular-nums ${row.variance < 0 ? "text-red-500" : "text-emerald-600"}`}>
                            {row.variance < 0 ? "-" : "+"}{currencyFmt.format(Math.abs(row.variance))}
                          </TableCell>
                          <TableCell>
                            <div className="w-full bg-gray-100 rounded-full h-3 overflow-hidden relative" data-testid={`progress-${row.accountNumber}`}>
                              <div
                                className={`h-full rounded-full transition-all ${isOver ? "bg-red-400" : pct > 80 ? "bg-amber-400" : "bg-emerald-400"}`}
                                style={{ width: `${Math.min(pct, 100)}%` }}
                              />
                              {overPct > 0 && (
                                <div
                                  className="absolute top-0 h-full bg-red-500/30 rounded-r-full"
                                  style={{ left: "100%", width: `${overPct}%`, maxWidth: "100%" }}
                                />
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="text-right">
                            <Badge
                              variant="outline"
                              className={`text-xs tabular-nums ${isOver ? "bg-red-50 text-red-600 border-red-200" : row.percentUsed > 80 ? "bg-amber-50 text-amber-600 border-amber-200" : "bg-emerald-50 text-emerald-600 border-emerald-200"}`}
                              data-testid={`badge-pct-${row.accountNumber}`}
                            >
                              {row.percentUsed.toFixed(1)}%
                            </Badge>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                    <TableRow className="border-t-2 font-semibold bg-muted/30">
                      <TableCell />
                      <TableCell>TOTALS</TableCell>
                      <TableCell className="text-right tabular-nums">{currencyFmt.format(reportData.totals.budgeted)}</TableCell>
                      <TableCell className={`text-right tabular-nums ${reportData.totals.actual > reportData.totals.budgeted ? "text-red-500" : "text-emerald-600"}`}>
                        {currencyFmt.format(reportData.totals.actual)}
                      </TableCell>
                      <TableCell className={`text-right tabular-nums ${reportData.totals.variance < 0 ? "text-red-500" : "text-emerald-600"}`}>
                        {reportData.totals.variance < 0 ? "-" : "+"}{currencyFmt.format(Math.abs(reportData.totals.variance))}
                      </TableCell>
                      <TableCell>
                        <div className="w-full bg-gray-100 rounded-full h-3 overflow-hidden">
                          <div
                            className={`h-full rounded-full ${reportData.totals.percentUsed > 100 ? "bg-red-400" : reportData.totals.percentUsed > 80 ? "bg-amber-400" : "bg-emerald-400"}`}
                            style={{ width: `${Math.min(reportData.totals.percentUsed, 100)}%` }}
                          />
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <Badge
                          variant="outline"
                          className={`text-xs tabular-nums ${reportData.totals.percentUsed > 100 ? "bg-red-50 text-red-600 border-red-200" : "bg-emerald-50 text-emerald-600 border-emerald-200"}`}
                          data-testid="badge-pct-total"
                        >
                          {reportData.totals.percentUsed.toFixed(1)}%
                        </Badge>
                      </TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </>
            )}
          </CardContent>
        </Card>
      </TabsContent>
    </Tabs>
  );
}

function SummaryCard({ label, value, icon, testId, valueClass = "" }: {
  label: string;
  value: number;
  icon: React.ReactNode;
  testId: string;
  valueClass?: string;
}) {
  return (
    <div className="rounded-lg border p-4">
      <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
        {icon}
        {label}
      </div>
      <div className={`text-xl font-bold tabular-nums ${valueClass}`} data-testid={testId}>
        {currencyFmt.format(value)}
      </div>
    </div>
  );
}
