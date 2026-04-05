import { useState, useEffect, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { HelpTooltip, HELP_CONTENT } from "@/components/help-tooltip";
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
  Calculator,
  Save,
  DollarSign,
  FileText,
  CalendarDays,
  CheckCircle2,
  AlertTriangle,
  Clock,
  FileDown,
  Loader2,
} from "lucide-react";
import { generate1040ESPdf } from "@/lib/form-1040es-pdf";

interface TaxSettings {
  federalRate: string;
  stateRate: string;
  stateName: string;
  filingType: string;
  selfEmploymentRate: string;
  qbiDeduction: boolean;
  taxpayerName: string | null;
  taxpayerSSN: string | null;
  spouseName: string | null;
  spouseSSN: string | null;
  address: string | null;
  city: string | null;
  taxState: string | null;
  zip: string | null;
  principalBusiness: string | null;
  businessCode: string | null;
}

interface IncomeStatement {
  totalRevenue: number;
  totalExpenses: number;
  netIncome: number;
  expenses: { schedule_c_line: string | null; name: string; balance: number }[];
}

interface QuarterlyPayment {
  year: number;
  quarter: number;
  dueDate: string;
  estimatedAmount: string | number;
  paidAmount: string | number;
  paidDate: string | null;
  notes: string | null;
}

const SCHEDULE_C_LINES: Record<string, string> = {
  "8": "Advertising",
  "9": "Car/Truck Expenses",
  "10": "Commissions and Fees",
  "11": "Contract Labor",
  "13": "Depreciation",
  "15": "Insurance",
  "16b": "Interest (Other)",
  "17": "Legal/Professional",
  "18": "Office Expense",
  "20b": "Rent (Other Business Property)",
  "22": "Supplies",
  "24a": "Travel",
  "24b": "Meals (50% Deductible)",
  "25": "Utilities",
  "26": "Wages",
  "27a": "Other Expenses",
};

const QUARTER_DUE_DATES = [
  { quarter: 1, label: "Q1", month: 3, day: 15 },
  { quarter: 2, label: "Q2", month: 5, day: 15 },
  { quarter: 3, label: "Q3", month: 8, day: 15 },
  { quarter: 4, label: "Q4", month: 0, day: 15, nextYear: true },
];

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function formatPercent(value: number): string {
  return `${value.toFixed(1)}%`;
}

export default function TaxCenterPage() {
  const { toast } = useToast();
  const currentYear = new Date().getFullYear();

  const { data: taxSettings, isLoading: settingsLoading } = useQuery<TaxSettings>({
    queryKey: ["/api/ops/tax-settings"],
  });

  const { data: incomeStatement, isLoading: incomeLoading } = useQuery<IncomeStatement>({
    queryKey: ["/api/ops/income-statement"],
  });

  const { data: quarterlyPayments, isLoading: paymentsLoading } = useQuery<QuarterlyPayment[]>({
    queryKey: ["/api/ops/quarterly-payments", String(currentYear)],
  });

  const [scheduleCExporting, setScheduleCExporting] = useState(false);

  const [settings, setSettings] = useState<TaxSettings>({
    federalRate: "22",
    stateRate: "0",
    stateName: "",
    filingType: "sole_prop",
    selfEmploymentRate: "15.3",
    qbiDeduction: true,
    taxpayerName: null,
    taxpayerSSN: null,
    spouseName: null,
    spouseSSN: null,
    address: null,
    city: null,
    taxState: null,
    zip: null,
    principalBusiness: "Web Design & Development Services",
    businessCode: "541510",
  });

  useEffect(() => {
    if (taxSettings) {
      setSettings(taxSettings);
    }
  }, [taxSettings]);

  const saveSettingsMutation = useMutation({
    mutationFn: async (data: TaxSettings) => {
      const res = await apiRequest("PUT", "/api/ops/tax-settings", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ops/tax-settings"] });
      toast({ title: "Tax settings saved" });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to save", description: err.message, variant: "destructive" });
    },
  });

  const savePaymentMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest("PUT", "/api/ops/quarterly-payments", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ops/quarterly-payments", String(currentYear)] });
      toast({ title: "Payment updated" });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to save payment", description: err.message, variant: "destructive" });
    },
  });

  const handleScheduleCExport = async () => {
    setScheduleCExporting(true);
    try {
      const res = await fetch("/api/ops/tax-center/schedule-c/export");
      if (!res.ok) throw new Error("Failed to generate PDF");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `BlackRidge_ScheduleC_${currentYear}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast({ title: "Schedule C downloaded", description: `IRS-ready PDF for ${currentYear}` });
    } catch (err) {
      toast({ title: "Export failed", description: String(err), variant: "destructive" });
    } finally {
      setScheduleCExporting(false);
    }
  };

  const taxCalc = useMemo(() => {
    const grossIncome = incomeStatement?.totalRevenue ?? 0;
    const totalDeductions = incomeStatement?.totalExpenses ?? 0;
    const netProfit = grossIncome - totalDeductions;

    const fedRate = parseFloat(settings.federalRate) / 100 || 0;
    const stRate = parseFloat(settings.stateRate) / 100 || 0;
    const seRate = parseFloat(settings.selfEmploymentRate) / 100 || 0;

    const selfEmploymentTax = netProfit > 0 ? netProfit * 0.9235 * seRate : 0;
    const incomeTaxEstimate = netProfit > 0 ? netProfit * (fedRate + stRate) : 0;
    const qbiDeductionAmount = settings.qbiDeduction && netProfit > 0 ? netProfit * 0.2 : 0;
    const totalTaxLiability = selfEmploymentTax + incomeTaxEstimate - (settings.qbiDeduction ? qbiDeductionAmount * (fedRate + stRate) : 0);
    const effectiveRate = netProfit > 0 ? (totalTaxLiability / netProfit) * 100 : 0;

    return {
      grossIncome,
      totalDeductions,
      netProfit,
      selfEmploymentTax,
      incomeTaxEstimate,
      qbiDeductionAmount,
      totalTaxLiability: Math.max(0, totalTaxLiability),
      effectiveRate: Math.max(0, effectiveRate),
    };
  }, [incomeStatement, settings]);

  const scheduleCData = useMemo(() => {
    const expenses = incomeStatement?.expenses ?? [];
    const lineMap: Record<string, number> = {};

    for (const exp of expenses) {
      if (exp.schedule_c_line && SCHEDULE_C_LINES[exp.schedule_c_line]) {
        lineMap[exp.schedule_c_line] = (lineMap[exp.schedule_c_line] || 0) + Math.abs(exp.balance);
      }
    }

    return Object.entries(SCHEDULE_C_LINES).map(([line, description]) => ({
      line,
      description,
      amount: lineMap[line] || 0,
    }));
  }, [incomeStatement]);

  const isLoading = settingsLoading || incomeLoading;

  return (
    <div className="p-3 sm:p-6 space-y-4 sm:space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2" data-testid="text-page-title">
          Tax Center
          <HelpTooltip {...HELP_CONTENT.taxCenter} size="md" />
        </h1>
        <p className="text-muted-foreground text-sm mt-1" data-testid="text-page-subtitle">
          Tax planning, Schedule C preview, and quarterly estimates
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-4">
            <CardTitle className="text-base flex items-center gap-2 flex-wrap">
              <Calculator className="w-4 h-4 text-primary" />
              Tax Settings
            </CardTitle>
            <Button
              size="sm"
              onClick={() => saveSettingsMutation.mutate(settings)}
              disabled={saveSettingsMutation.isPending}
              data-testid="button-save-settings"
            >
              <Save className="w-3.5 h-3.5 mr-1.5" />
              Save
            </Button>
          </CardHeader>
          <CardContent className="space-y-4">
            {settingsLoading ? (
              <div className="space-y-3">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton key={i} className="h-10 w-full" />
                ))}
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="federalRate" className="text-sm">Federal Rate (%)</Label>
                    <Input
                      id="federalRate"
                      type="number"
                      step="0.1"
                      value={settings.federalRate}
                      onChange={(e) => setSettings({ ...settings, federalRate: e.target.value })}
                      data-testid="input-federal-rate"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="stateRate" className="text-sm">State Rate (%)</Label>
                    <Input
                      id="stateRate"
                      type="number"
                      step="0.1"
                      value={settings.stateRate}
                      onChange={(e) => setSettings({ ...settings, stateRate: e.target.value })}
                      data-testid="input-state-rate"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="stateName" className="text-sm">State Name</Label>
                    <Input
                      id="stateName"
                      value={settings.stateName || ""}
                      onChange={(e) => setSettings({ ...settings, stateName: e.target.value })}
                      placeholder="e.g. California"
                      data-testid="input-state-name"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="filingType" className="text-sm">Filing Type</Label>
                    <Select
                      value={settings.filingType}
                      onValueChange={(val) => setSettings({ ...settings, filingType: val })}
                    >
                      <SelectTrigger data-testid="select-filing-type">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="sole_prop">Sole Proprietor</SelectItem>
                        <SelectItem value="llc">LLC</SelectItem>
                        <SelectItem value="s_corp">S-Corp</SelectItem>
                        <SelectItem value="c_corp">C-Corp</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="seRate" className="text-sm">Self-Employment Tax Rate (%)</Label>
                  <Input
                    id="seRate"
                    type="number"
                    step="0.1"
                    value={settings.selfEmploymentRate}
                    onChange={(e) => setSettings({ ...settings, selfEmploymentRate: e.target.value })}
                    data-testid="input-se-rate"
                  />
                </div>
                <div className="flex items-center justify-between gap-2">
                  <Label htmlFor="qbiDeduction" className="text-sm">QBI Deduction (20%)</Label>
                  <Switch
                    id="qbiDeduction"
                    checked={settings.qbiDeduction}
                    onCheckedChange={(checked) => setSettings({ ...settings, qbiDeduction: checked })}
                    data-testid="switch-qbi-deduction"
                  />
                </div>

                <div className="border-t pt-4 mt-2 space-y-3">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Business Information (for Schedule C)</p>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <Label htmlFor="principalBusiness" className="text-sm">Principal Business</Label>
                      <Input
                        id="principalBusiness"
                        value={settings.principalBusiness || ""}
                        onChange={(e) => setSettings({ ...settings, principalBusiness: e.target.value })}
                        placeholder="Web Design & Development Services"
                        data-testid="input-principal-business"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="businessCode" className="text-sm">Business Code (NAICS)</Label>
                      <Input
                        id="businessCode"
                        value={settings.businessCode || ""}
                        onChange={(e) => setSettings({ ...settings, businessCode: e.target.value })}
                        placeholder="541510"
                        data-testid="input-business-code"
                      />
                    </div>
                  </div>
                </div>

                <div className="border-t pt-4 mt-2 space-y-3">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Taxpayer Information (for 1040-ES)</p>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <Label htmlFor="taxpayerName" className="text-sm">Taxpayer Name</Label>
                      <Input
                        id="taxpayerName"
                        value={settings.taxpayerName || ""}
                        onChange={(e) => setSettings({ ...settings, taxpayerName: e.target.value })}
                        placeholder="Full legal name"
                        data-testid="input-taxpayer-name"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="taxpayerSSN" className="text-sm">SSN</Label>
                      <Input
                        id="taxpayerSSN"
                        value={settings.taxpayerSSN || ""}
                        onChange={(e) => setSettings({ ...settings, taxpayerSSN: e.target.value })}
                        placeholder="XXX-XX-XXXX"
                        data-testid="input-taxpayer-ssn"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <Label htmlFor="spouseName" className="text-sm">Spouse Name</Label>
                      <Input
                        id="spouseName"
                        value={settings.spouseName || ""}
                        onChange={(e) => setSettings({ ...settings, spouseName: e.target.value })}
                        placeholder="If filing jointly"
                        data-testid="input-spouse-name"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="spouseSSN" className="text-sm">Spouse SSN</Label>
                      <Input
                        id="spouseSSN"
                        value={settings.spouseSSN || ""}
                        onChange={(e) => setSettings({ ...settings, spouseSSN: e.target.value })}
                        placeholder="XXX-XX-XXXX"
                        data-testid="input-spouse-ssn"
                      />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="address" className="text-sm">Street Address</Label>
                    <Input
                      id="address"
                      value={settings.address || ""}
                      onChange={(e) => setSettings({ ...settings, address: e.target.value })}
                      placeholder="123 Main St"
                      data-testid="input-address"
                    />
                  </div>
                  <div className="grid grid-cols-3 gap-4">
                    <div className="space-y-1.5">
                      <Label htmlFor="city" className="text-sm">City</Label>
                      <Input
                        id="city"
                        value={settings.city || ""}
                        onChange={(e) => setSettings({ ...settings, city: e.target.value })}
                        data-testid="input-city"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="taxState" className="text-sm">State</Label>
                      <Input
                        id="taxState"
                        value={settings.taxState || ""}
                        onChange={(e) => setSettings({ ...settings, taxState: e.target.value.toUpperCase().slice(0, 2) })}
                        placeholder="CA"
                        maxLength={2}
                        data-testid="input-tax-state"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="zip" className="text-sm">ZIP Code</Label>
                      <Input
                        id="zip"
                        value={settings.zip || ""}
                        onChange={(e) => setSettings({ ...settings, zip: e.target.value })}
                        placeholder="90210"
                        data-testid="input-zip"
                      />
                    </div>
                  </div>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2 flex-wrap">
              <DollarSign className="w-4 h-4 text-emerald-500" />
              Tax Summary ({currentYear})
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="space-y-3">
                {Array.from({ length: 7 }).map((_, i) => (
                  <Skeleton key={i} className="h-6 w-full" />
                ))}
              </div>
            ) : (
              <div className="space-y-3">
                <SummaryRow label="Gross Income" value={formatCurrency(taxCalc.grossIncome)} testId="text-gross-income" />
                <SummaryRow label="Total Deductions" value={`(${formatCurrency(taxCalc.totalDeductions)})`} testId="text-total-deductions" muted />
                <div className="border-t pt-2">
                  <SummaryRow label="Net Profit" value={formatCurrency(taxCalc.netProfit)} testId="text-net-profit" bold />
                </div>
                <div className="border-t pt-2 space-y-2">
                  <SummaryRow label="Self-Employment Tax" value={formatCurrency(taxCalc.selfEmploymentTax)} testId="text-se-tax" />
                  <SummaryRow label="Income Tax Estimate" value={formatCurrency(taxCalc.incomeTaxEstimate)} testId="text-income-tax" />
                  {settings.qbiDeduction && (
                    <SummaryRow label="QBI Deduction (20%)" value={`(${formatCurrency(taxCalc.qbiDeductionAmount)})`} testId="text-qbi-deduction" muted />
                  )}
                </div>
                <div className="border-t pt-2">
                  <SummaryRow label="Total Tax Liability" value={formatCurrency(taxCalc.totalTaxLiability)} testId="text-total-liability" bold />
                  <SummaryRow label="Effective Rate" value={formatPercent(taxCalc.effectiveRate)} testId="text-effective-rate" />
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2 flex-wrap">
            <FileText className="w-4 h-4 text-primary" />
            Schedule C Preview
            <HelpTooltip {...HELP_CONTENT.scheduleC} />
          </CardTitle>
        </CardHeader>
        <CardContent>
          {incomeLoading ? (
            <Skeleton className="h-[300px] w-full" />
          ) : (
            <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-24">Line</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead className="text-right w-36">Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {scheduleCData.map((row) => (
                  <TableRow key={row.line} data-testid={`row-schedule-c-${row.line}`}>
                    <TableCell className="font-mono text-sm text-muted-foreground" data-testid={`text-line-${row.line}`}>
                      Line {row.line}
                    </TableCell>
                    <TableCell data-testid={`text-desc-${row.line}`}>{row.description}</TableCell>
                    <TableCell className="text-right tabular-nums" data-testid={`text-amount-${row.line}`}>
                      {row.amount > 0 ? formatCurrency(row.amount) : "—"}
                    </TableCell>
                  </TableRow>
                ))}
                <TableRow className="font-semibold">
                  <TableCell />
                  <TableCell>Total</TableCell>
                  <TableCell className="text-right tabular-nums" data-testid="text-schedule-c-total">
                    {formatCurrency(scheduleCData.reduce((sum, r) => sum + r.amount, 0))}
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>

            <div className="mt-6 space-y-3">
              <div className="flex items-start gap-2 rounded-md border border-amber-300/50 bg-amber-50 p-3" data-testid="banner-schedule-c-disclaimer">
                <AlertTriangle className="w-4 h-4 text-amber-600 mt-0.5 flex-shrink-0" />
                <p className="text-xs text-amber-800">
                  This Schedule C is generated from your recorded financial data. Review with your CPA before filing.
                </p>
              </div>
              <Button
                onClick={handleScheduleCExport}
                disabled={scheduleCExporting}
                className="w-full sm:w-auto"
                data-testid="button-export-schedule-c"
              >
                {scheduleCExporting ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <FileDown className="w-4 h-4 mr-2" />
                )}
                {scheduleCExporting ? "Generating IRS Form..." : "Download Schedule C (IRS Ready)"}
              </Button>
            </div>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2 flex-wrap">
            <CalendarDays className="w-4 h-4 text-primary" />
            Quarterly Estimated Tax Payments ({currentYear})
            <HelpTooltip {...HELP_CONTENT.quarterlyEstimates} />
          </CardTitle>
        </CardHeader>
        <CardContent>
          {paymentsLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-[200px] w-full" />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {QUARTER_DUE_DATES.map((q) => {
                const dueYear = q.nextYear ? currentYear + 1 : currentYear;
                const dueDate = new Date(dueYear, q.month, q.day);
                const estimatedAmount = taxCalc.totalTaxLiability / 4;

                const existing = (quarterlyPayments ?? []).find(
                  (p) => p.quarter === q.quarter && p.year === currentYear
                );
                const paidAmount = existing ? parseFloat(String(existing.paidAmount)) || 0 : 0;
                const paidDate = existing?.paidDate || null;
                const remaining = Math.max(0, estimatedAmount - paidAmount);
                const isPastDue = new Date() > dueDate;

                let status: "paid" | "partial" | "unpaid" = "unpaid";
                if (paidAmount >= estimatedAmount && estimatedAmount > 0) status = "paid";
                else if (paidAmount > 0) status = "partial";

                const borderClass =
                  status === "paid"
                    ? "border-emerald-500/40"
                    : status === "partial"
                    ? "border-amber-500/40"
                    : isPastDue
                    ? "border-red-500/40"
                    : "";

                const canGenerate1040ES = !!(settings.taxpayerName && settings.taxpayerSSN && settings.address && settings.city && settings.taxState && settings.zip);

                return (
                  <QuarterCard
                    key={q.quarter}
                    quarter={q.quarter}
                    label={q.label}
                    dueDate={dueDate}
                    estimatedAmount={estimatedAmount}
                    paidAmount={paidAmount}
                    paidDate={paidDate}
                    remaining={remaining}
                    status={status}
                    isPastDue={isPastDue}
                    borderClass={borderClass}
                    currentYear={currentYear}
                    onSave={(data) => savePaymentMutation.mutate(data)}
                    saving={savePaymentMutation.isPending}
                    canGenerate1040ES={canGenerate1040ES}
                    onGenerate1040ES={() => {
                      try {
                        const paymentAmount = remaining > 0 ? remaining : estimatedAmount;
                        generate1040ESPdf({
                          taxpayerName: settings.taxpayerName!,
                          taxpayerSSN: settings.taxpayerSSN!,
                          spouseName: settings.spouseName || undefined,
                          spouseSSN: settings.spouseSSN || undefined,
                          address: settings.address!,
                          city: settings.city!,
                          state: settings.taxState!,
                          zip: settings.zip!,
                          calendarYear: currentYear,
                          quarter: q.quarter,
                          dueDate: dueDate.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }),
                          estimatedPaymentAmount: Math.max(0, paymentAmount),
                        });
                        toast({ title: "1040-ES voucher generated", description: `Q${q.quarter} ${currentYear} payment voucher downloaded` });
                      } catch (err) {
                        toast({ title: "Failed to generate PDF", description: String(err), variant: "destructive" });
                      }
                    }}
                  />
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function SummaryRow({
  label,
  value,
  testId,
  bold,
  muted,
}: {
  label: string;
  value: string;
  testId: string;
  bold?: boolean;
  muted?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className={`text-sm ${bold ? "font-semibold" : "text-muted-foreground"}`}>{label}</span>
      <span
        className={`text-sm tabular-nums ${bold ? "font-semibold" : ""} ${muted ? "text-muted-foreground" : ""}`}
        data-testid={testId}
      >
        {value}
      </span>
    </div>
  );
}

function QuarterCard({
  quarter,
  label,
  dueDate,
  estimatedAmount,
  paidAmount,
  paidDate,
  remaining,
  status,
  isPastDue,
  borderClass,
  currentYear,
  onSave,
  saving,
  canGenerate1040ES,
  onGenerate1040ES,
}: {
  quarter: number;
  label: string;
  dueDate: Date;
  estimatedAmount: number;
  paidAmount: number;
  paidDate: string | null;
  remaining: number;
  status: "paid" | "partial" | "unpaid";
  isPastDue: boolean;
  borderClass: string;
  currentYear: number;
  onSave: (data: any) => void;
  saving: boolean;
  canGenerate1040ES: boolean;
  onGenerate1040ES: () => void;
}) {
  const [editPaid, setEditPaid] = useState(String(paidAmount || ""));
  const [editDate, setEditDate] = useState(paidDate || "");

  useEffect(() => {
    setEditPaid(String(paidAmount || ""));
    setEditDate(paidDate || "");
  }, [paidAmount, paidDate]);

  const statusIcon =
    status === "paid" ? (
      <CheckCircle2 className="w-4 h-4 text-emerald-500" />
    ) : status === "partial" ? (
      <Clock className="w-4 h-4 text-amber-500" />
    ) : isPastDue ? (
      <AlertTriangle className="w-4 h-4 text-red-500" />
    ) : (
      <Clock className="w-4 h-4 text-muted-foreground" />
    );

  const statusBadge =
    status === "paid" ? (
      <Badge variant="secondary" className="no-default-hover-elevate no-default-active-elevate bg-emerald-500/10 text-emerald-500">
        Paid
      </Badge>
    ) : status === "partial" ? (
      <Badge variant="secondary" className="no-default-hover-elevate no-default-active-elevate bg-amber-500/10 text-amber-500">
        Partial
      </Badge>
    ) : isPastDue ? (
      <Badge variant="secondary" className="no-default-hover-elevate no-default-active-elevate bg-red-500/10 text-red-500">
        Past Due
      </Badge>
    ) : (
      <Badge variant="secondary" className="no-default-hover-elevate no-default-active-elevate">
        Upcoming
      </Badge>
    );

  return (
    <div
      className={`rounded-md border p-4 space-y-3 ${borderClass}`}
      data-testid={`card-quarter-${quarter}`}
    >
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          {statusIcon}
          <span className="font-semibold text-sm">{label}</span>
        </div>
        {statusBadge}
      </div>

      <div className="space-y-1.5 text-sm">
        <div className="flex items-center justify-between gap-2">
          <span className="text-muted-foreground">Due Date</span>
          <span className="tabular-nums" data-testid={`text-due-date-${quarter}`}>
            {dueDate.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
          </span>
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="text-muted-foreground">Estimated</span>
          <span className="tabular-nums" data-testid={`text-estimated-${quarter}`}>
            {formatCurrency(estimatedAmount)}
          </span>
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="text-muted-foreground">Remaining</span>
          <span className={`tabular-nums font-medium ${remaining > 0 ? "text-amber-500" : "text-emerald-500"}`} data-testid={`text-remaining-${quarter}`}>
            {formatCurrency(remaining)}
          </span>
        </div>
      </div>

      <div className="border-t pt-3 space-y-2">
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Paid Amount</Label>
          <Input
            type="number"
            step="0.01"
            value={editPaid}
            onChange={(e) => setEditPaid(e.target.value)}
            data-testid={`input-paid-${quarter}`}
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Paid Date</Label>
          <Input
            type="date"
            value={editDate}
            onChange={(e) => setEditDate(e.target.value)}
            data-testid={`input-paid-date-${quarter}`}
          />
        </div>
        <Button
          size="sm"
          variant="outline"
          className="w-full"
          disabled={saving}
          onClick={() =>
            onSave({
              year: currentYear,
              quarter,
              dueDate: dueDate.toISOString(),
              estimatedAmount: estimatedAmount.toFixed(2),
              paidAmount: editPaid || "0",
              paidDate: editDate || null,
              notes: null,
            })
          }
          data-testid={`button-save-quarter-${quarter}`}
        >
          <Save className="w-3.5 h-3.5 mr-1.5" />
          Save
        </Button>
        <Button
          size="sm"
          variant="secondary"
          className="w-full"
          disabled={!canGenerate1040ES}
          onClick={onGenerate1040ES}
          title={canGenerate1040ES ? "Generate 1040-ES payment voucher PDF" : "Enter taxpayer info in Tax Settings first"}
          data-testid={`button-generate-1040es-${quarter}`}
        >
          <FileDown className="w-3.5 h-3.5 mr-1.5" />
          Generate 1040-ES
        </Button>
        {!canGenerate1040ES && (
          <p className="text-[10px] text-muted-foreground text-center">Fill in taxpayer info above to enable</p>
        )}
      </div>
    </div>
  );
}
