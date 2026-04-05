import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Link } from "wouter";
import {
  DollarSign, TrendingUp, TrendingDown, Receipt, FileText,
  ChevronRight, AlertTriangle, Calculator,
} from "lucide-react";

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

function formatDate(date: Date): string {
  return date.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

interface IncomeStatement {
  revenue: any[];
  expenses: any[];
  totalRevenue: number;
  totalExpenses: number;
  netIncome: number;
}

interface BillDashboard {
  totalOutstanding: number;
  totalOutstandingCount: number;
  dueThisWeek: number;
  dueThisWeekCount: number;
  overdue: number;
  overdueCount: number;
}

export default function Dashboard() {
  const year = new Date().getFullYear();
  const startDate = `${year}-01-01`;
  const endDate = new Date().toISOString().split("T")[0];

  const { data: incomeStatement, isLoading: plLoading } = useQuery<IncomeStatement>({
    queryKey: ["/api/ops/income-statement", { startDate, endDate }],
    queryFn: async () => {
      const res = await fetch(`/api/ops/income-statement?startDate=${startDate}&endDate=${endDate}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
  });

  const { data: billStats, isLoading: billsLoading } = useQuery<BillDashboard>({
    queryKey: ["/api/ops/bills/dashboard/stats"],
  });

  const { data: taxSettings } = useQuery<any>({
    queryKey: ["/api/ops/tax-settings"],
  });

  const isLoading = plLoading || billsLoading;

  const totalRevenue = incomeStatement?.totalRevenue ?? 0;
  const totalExpenses = incomeStatement?.totalExpenses ?? 0;
  const netIncome = incomeStatement?.netIncome ?? 0;

  const federalRate = parseFloat(taxSettings?.federalRate || "22") / 100;
  const stateRate = parseFloat(taxSettings?.stateRate || "0") / 100;
  const seRate = parseFloat(taxSettings?.selfEmploymentRate || "15.3") / 100;
  const estimatedTax = netIncome > 0 ? netIncome * (federalRate + stateRate + seRate * 0.9235) : 0;

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight" data-testid="text-page-title">Financial Dashboard</h1>
        <p className="text-muted-foreground text-sm mt-1" data-testid="text-date">
          {formatDate(new Date())} — Year-to-date overview
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard
          title="Revenue (YTD)"
          value={isLoading ? undefined : formatCurrency(totalRevenue)}
          icon={<DollarSign className="w-4 h-4 text-emerald-500" />}
          loading={isLoading}
          testId="stat-revenue"
        />
        <KPICard
          title="Expenses (YTD)"
          value={isLoading ? undefined : formatCurrency(totalExpenses)}
          icon={<TrendingDown className="w-4 h-4 text-red-500" />}
          loading={isLoading}
          testId="stat-expenses"
        />
        <KPICard
          title="Net Income"
          value={isLoading ? undefined : formatCurrency(netIncome)}
          icon={<TrendingUp className="w-4 h-4 text-primary" />}
          loading={isLoading}
          testId="stat-net-income"
          valueClass={netIncome < 0 ? "text-destructive" : "text-emerald-600"}
        />
        <KPICard
          title="Est. Tax Liability"
          value={isLoading ? undefined : formatCurrency(estimatedTax)}
          icon={<Calculator className="w-4 h-4 text-amber-500" />}
          loading={isLoading}
          testId="stat-tax"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base" data-testid="text-bills-title">Bills Overview</CardTitle>
          </CardHeader>
          <CardContent>
            {billsLoading ? (
              <div className="space-y-3">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center justify-between py-2 px-3 rounded-md bg-muted/30">
                  <div className="flex items-center gap-2">
                    <FileText className="w-4 h-4 text-muted-foreground" />
                    <span className="text-sm">Total Outstanding</span>
                  </div>
                  <span className="text-sm font-semibold" data-testid="stat-outstanding">
                    {formatCurrency(billStats?.totalOutstanding ?? 0)}
                  </span>
                </div>
                <div className="flex items-center justify-between py-2 px-3 rounded-md bg-muted/30">
                  <div className="flex items-center gap-2">
                    <Receipt className="w-4 h-4 text-amber-500" />
                    <span className="text-sm">Due This Week</span>
                  </div>
                  <span className="text-sm font-semibold" data-testid="stat-due-week">
                    {formatCurrency(billStats?.dueThisWeek ?? 0)} ({billStats?.dueThisWeekCount ?? 0})
                  </span>
                </div>
                {(billStats?.overdueCount ?? 0) > 0 && (
                  <div className="flex items-center justify-between py-2 px-3 rounded-md bg-red-50 dark:bg-red-500/5">
                    <div className="flex items-center gap-2">
                      <AlertTriangle className="w-4 h-4 text-red-500" />
                      <span className="text-sm text-red-600 dark:text-red-400">Overdue</span>
                    </div>
                    <span className="text-sm font-semibold text-red-600 dark:text-red-400" data-testid="stat-overdue">
                      {formatCurrency(billStats?.overdue ?? 0)} ({billStats?.overdueCount ?? 0})
                    </span>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base" data-testid="text-quicknav-title">Quick Navigation</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-1">
              {[
                { label: "Expense Tracker", href: "/expenses", icon: Receipt },
                { label: "Chart of Accounts & Ledger", href: "/financials", icon: DollarSign },
                { label: "Tax Center", href: "/tax-center", icon: Calculator },
                { label: "Financial Reports", href: "/reports", icon: FileText },
              ].map((item) => (
                <Link key={item.href} href={item.href}>
                  <div className="flex items-center justify-between py-2.5 px-3 rounded-md hover:bg-muted/50 cursor-pointer group transition-colors" data-testid={`nav-quick-${item.label.toLowerCase().replace(/\s+/g, "-")}`}>
                    <div className="flex items-center gap-2.5">
                      <item.icon className="w-4 h-4 text-muted-foreground" />
                      <span className="text-sm font-medium">{item.label}</span>
                    </div>
                    <ChevronRight className="w-3.5 h-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                  </div>
                </Link>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {!isLoading && incomeStatement && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base" data-testid="text-pl-title">P&L Summary (YTD)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <h3 className="text-sm font-medium text-muted-foreground mb-3">Revenue</h3>
                <div className="space-y-2">
                  {incomeStatement.revenue.length > 0 ? incomeStatement.revenue.map((r: any) => (
                    <div key={r.id || r.account_number} className="flex justify-between text-sm">
                      <span>{r.name}</span>
                      <span className="font-medium tabular-nums">{formatCurrency(r.balance)}</span>
                    </div>
                  )) : (
                    <p className="text-sm text-muted-foreground">No revenue recorded</p>
                  )}
                </div>
              </div>
              <div>
                <h3 className="text-sm font-medium text-muted-foreground mb-3">Expenses</h3>
                <div className="space-y-2">
                  {incomeStatement.expenses.length > 0 ? incomeStatement.expenses.slice(0, 8).map((r: any) => (
                    <div key={r.id || r.account_number} className="flex justify-between text-sm">
                      <span>{r.name}</span>
                      <span className="font-medium tabular-nums">{formatCurrency(r.balance)}</span>
                    </div>
                  )) : (
                    <p className="text-sm text-muted-foreground">No expenses recorded</p>
                  )}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function KPICard({
  title,
  value,
  icon,
  loading,
  testId,
  valueClass = "",
}: {
  title: string;
  value?: string | number;
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
            {value ?? "—"}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
