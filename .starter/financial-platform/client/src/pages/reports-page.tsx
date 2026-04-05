import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
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
  FileBarChart,
  DollarSign,
  TrendingUp,
  TrendingDown,
  Download,
  BarChart3,
  PieChart,
  Receipt,
  Calculator,
} from "lucide-react";
import type { Account, Expense } from "@shared/schema";
import ARAgingReport from "./ar-aging-report";

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

export default function ReportsPage() {
  const [activeTab, setActiveTab] = useState<"overview" | "pnl" | "aging">("overview");

  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth();
  const yearStart = new Date(currentYear, 0, 1).toISOString().slice(0, 10);
  const yearEnd = new Date(currentYear, 11, 31).toISOString().slice(0, 10);

  const { data: expenses, isLoading: expensesLoading } = useQuery<Expense[]>({
    queryKey: ["/api/ops/expenses", `?startDate=${yearStart}&endDate=${yearEnd}`],
  });

  const { data: accounts } = useQuery<Account[]>({
    queryKey: ["/api/ops/accounts"],
  });

  const accountMap = useMemo(
    () => new Map((accounts ?? []).map((a) => [a.id, a])),
    [accounts],
  );

  const expenseAccounts = useMemo(
    () => (accounts ?? []).filter((a) => a.type === "expense"),
    [accounts],
  );

  const totalExpensesYTD = useMemo(() => {
    if (!expenses) return 0;
    return expenses.reduce((sum, e) => sum + Number(e.amount), 0);
  }, [expenses]);

  const totalThisMonth = useMemo(() => {
    if (!expenses) return 0;
    const monthStart = new Date(currentYear, currentMonth, 1);
    return expenses
      .filter((e) => new Date(e.date) >= monthStart)
      .reduce((sum, e) => sum + Number(e.amount), 0);
  }, [expenses, currentYear, currentMonth]);

  const lastMonthTotal = useMemo(() => {
    if (!expenses) return 0;
    const lastStart = new Date(currentYear, currentMonth - 1, 1);
    const lastEnd = new Date(currentYear, currentMonth, 0);
    return expenses
      .filter((e) => {
        const d = new Date(e.date);
        return d >= lastStart && d <= lastEnd;
      })
      .reduce((sum, e) => sum + Number(e.amount), 0);
  }, [expenses, currentYear, currentMonth]);

  const monthOverMonth = lastMonthTotal > 0
    ? ((totalThisMonth - lastMonthTotal) / lastMonthTotal) * 100
    : 0;

  const categoryBreakdown = useMemo(() => {
    if (!expenses) return [];
    const map = new Map<number, { name: string; scheduleC: string | null; total: number; count: number }>();
    for (const e of expenses) {
      const acct = accountMap.get(e.accountId);
      const existing = map.get(e.accountId);
      if (existing) {
        existing.total += Number(e.amount);
        existing.count += 1;
      } else {
        map.set(e.accountId, {
          name: acct?.name ?? "Unknown",
          scheduleC: acct?.scheduleCLine ?? null,
          total: Number(e.amount),
          count: 1,
        });
      }
    }
    return Array.from(map.values()).sort((a, b) => b.total - a.total);
  }, [expenses, accountMap]);

  const monthlyTotals = useMemo(() => {
    if (!expenses) return [];
    const months: { month: string; total: number }[] = [];
    for (let m = 0; m <= currentMonth; m++) {
      const start = new Date(currentYear, m, 1);
      const end = new Date(currentYear, m + 1, 0);
      const total = expenses
        .filter((e) => {
          const d = new Date(e.date);
          return d >= start && d <= end;
        })
        .reduce((sum, e) => sum + Number(e.amount), 0);
      months.push({
        month: start.toLocaleDateString("en-US", { month: "short" }),
        total,
      });
    }
    return months;
  }, [expenses, currentYear, currentMonth]);

  const taxDeductibleTotal = useMemo(() => {
    if (!expenses) return 0;
    return expenses
      .filter((e) => e.taxDeductible)
      .reduce((sum, e) => sum + Number(e.amount), 0);
  }, [expenses]);

  const tabs = [
    { id: "overview" as const, label: "Financial Overview", icon: BarChart3 },
    { id: "pnl" as const, label: "Expense Breakdown", icon: PieChart },
    { id: "aging" as const, label: "AR Aging", icon: Receipt },
  ];

  return (
    <div className="space-y-6" data-testid="reports-page">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-reports-title">Financial Reports</h1>
          <p className="text-muted-foreground mt-1">
            {currentYear} financial overview and expense analysis
          </p>
        </div>
      </div>

      <div className="flex gap-2 border-b pb-2">
        {tabs.map((tab) => (
          <Button
            key={tab.id}
            variant={activeTab === tab.id ? "default" : "ghost"}
            size="sm"
            onClick={() => setActiveTab(tab.id)}
            data-testid={`tab-${tab.id}`}
          >
            <tab.icon className="w-4 h-4 mr-1.5" />
            {tab.label}
          </Button>
        ))}
      </div>

      {activeTab === "overview" && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <Card data-testid="card-ytd-expenses">
              <CardContent className="pt-6">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-red-50 text-red-600">
                    <DollarSign className="w-5 h-5" />
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">YTD Expenses</p>
                    <p className="text-2xl font-bold tabular-nums">
                      {expensesLoading ? <Skeleton className="h-8 w-24" /> : formatCurrency(totalExpensesYTD)}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card data-testid="card-this-month">
              <CardContent className="pt-6">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-blue-50 text-blue-600">
                    <Receipt className="w-5 h-5" />
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">This Month</p>
                    <p className="text-2xl font-bold tabular-nums">
                      {expensesLoading ? <Skeleton className="h-8 w-24" /> : formatCurrency(totalThisMonth)}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card data-testid="card-mom-change">
              <CardContent className="pt-6">
                <div className="flex items-center gap-3">
                  <div className={`p-2 rounded-lg ${monthOverMonth >= 0 ? "bg-red-50 text-red-600" : "bg-green-50 text-green-600"}`}>
                    {monthOverMonth >= 0 ? <TrendingUp className="w-5 h-5" /> : <TrendingDown className="w-5 h-5" />}
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">vs Last Month</p>
                    <p className="text-2xl font-bold tabular-nums">
                      {expensesLoading ? <Skeleton className="h-8 w-24" /> : `${monthOverMonth >= 0 ? "+" : ""}${monthOverMonth.toFixed(1)}%`}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card data-testid="card-tax-deductible">
              <CardContent className="pt-6">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-green-50 text-green-600">
                    <Calculator className="w-5 h-5" />
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Tax Deductible</p>
                    <p className="text-2xl font-bold tabular-nums">
                      {expensesLoading ? <Skeleton className="h-8 w-24" /> : formatCurrency(taxDeductibleTotal)}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          <Card data-testid="card-monthly-trend">
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <BarChart3 className="w-4 h-4" />
                Monthly Expense Trend
              </CardTitle>
            </CardHeader>
            <CardContent>
              {expensesLoading ? (
                <Skeleton className="h-48 w-full" />
              ) : (
                <div className="flex items-end gap-2 h-48">
                  {monthlyTotals.map((m, i) => {
                    const max = Math.max(...monthlyTotals.map((t) => t.total), 1);
                    const height = (m.total / max) * 100;
                    return (
                      <div key={i} className="flex-1 flex flex-col items-center gap-1">
                        <span className="text-xs text-muted-foreground tabular-nums">
                          {m.total > 0 ? formatCurrency(m.total) : ""}
                        </span>
                        <div
                          className="w-full bg-primary/80 rounded-t transition-all"
                          style={{ height: `${Math.max(height, 2)}%` }}
                        />
                        <span className="text-xs text-muted-foreground">{m.month}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {activeTab === "pnl" && (
        <Card data-testid="card-expense-breakdown">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <PieChart className="w-4 h-4" />
              Expense Breakdown by Category (YTD)
            </CardTitle>
          </CardHeader>
          <CardContent>
            {expensesLoading ? (
              <Skeleton className="h-64 w-full" />
            ) : categoryBreakdown.length === 0 ? (
              <p className="text-center text-muted-foreground py-12">No expenses recorded yet</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Category</TableHead>
                    <TableHead>Schedule C Line</TableHead>
                    <TableHead className="text-center">Transactions</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead className="text-right">% of Total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {categoryBreakdown.map((cat, i) => (
                    <TableRow key={i} data-testid={`row-category-${i}`}>
                      <TableCell className="font-medium">{cat.name}</TableCell>
                      <TableCell>
                        {cat.scheduleC ? (
                          <Badge variant="secondary" className="text-xs">{cat.scheduleC}</Badge>
                        ) : (
                          <span className="text-muted-foreground text-xs">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-center tabular-nums">{cat.count}</TableCell>
                      <TableCell className="text-right font-medium tabular-nums">
                        {formatCurrency(cat.total)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {totalExpensesYTD > 0 ? ((cat.total / totalExpensesYTD) * 100).toFixed(1) : "0.0"}%
                      </TableCell>
                    </TableRow>
                  ))}
                  <TableRow className="font-bold border-t-2">
                    <TableCell>Total</TableCell>
                    <TableCell />
                    <TableCell className="text-center tabular-nums">
                      {categoryBreakdown.reduce((s, c) => s + c.count, 0)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatCurrency(totalExpensesYTD)}
                    </TableCell>
                    <TableCell className="text-right">100%</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}

      {activeTab === "aging" && <ARAgingReport />}
    </div>
  );
}
