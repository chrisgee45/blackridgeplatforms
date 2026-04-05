import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { FileDown, DollarSign, Clock } from "lucide-react";
import { jsPDF } from "jspdf";

interface AgingRow {
  id: string;
  clientName: string;
  projectName: string | null;
  invoiceNumber: string;
  invoiceDate: string;
  dueDate: string;
  totalAmount: number;
  amountPaid: number;
  balanceDue: number;
  daysPastDue: number;
  bucket: "current" | "1-30" | "31-60" | "61-90" | "90+";
}

interface AgingSummary {
  current: number;
  "1-30": number;
  "31-60": number;
  "61-90": number;
  "90+": number;
  total: number;
}

interface AgingData {
  rows: AgingRow[];
  summary: AgingSummary;
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  }).format(value);
}

function formatDate(d: string | Date): string {
  return new Date(d).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

const BUCKET_COLORS: Record<string, { bg: string; text: string; border: string; label: string }> = {
  current: { bg: "bg-emerald-500/10", text: "text-emerald-600", border: "border-emerald-500/30", label: "Current" },
  "1-30": { bg: "bg-yellow-500/10", text: "text-yellow-600", border: "border-yellow-500/30", label: "1-30 Days" },
  "31-60": { bg: "bg-orange-500/10", text: "text-orange-600", border: "border-orange-500/30", label: "31-60 Days" },
  "61-90": { bg: "bg-red-400/10", text: "text-red-500", border: "border-red-400/30", label: "61-90 Days" },
  "90+": { bg: "bg-red-600/10", text: "text-red-700", border: "border-red-600/30", label: "90+ Days" },
};

function getRowClass(bucket: string): string {
  switch (bucket) {
    case "current": return "";
    case "1-30": return "bg-yellow-500/5";
    case "31-60": return "bg-orange-500/5";
    case "61-90": return "bg-red-400/5";
    case "90+": return "bg-red-600/10";
    default: return "";
  }
}

function exportAgingPdf(data: AgingData) {
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
  doc.text("Accounts Receivable Aging Report", margin, y);
  y += 6;
  doc.setFontSize(9);
  doc.setTextColor(120, 120, 130);
  doc.text(`Generated: ${new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}`, margin, y);
  y += 10;

  doc.setDrawColor(200, 170, 60);
  doc.setLineWidth(0.5);
  doc.line(margin, y, margin + 80, y);
  y += 10;

  const colX = [margin, margin + 45, margin + 80, margin + 105, margin + 135, margin + 162, margin + 189, margin + 216];
  const colHeaders = ["Client", "Invoice #", "Invoice Date", "Due Date", "Total", "Paid", "Balance Due", "Aging"];

  doc.setFillColor(240, 240, 245);
  doc.rect(margin, y - 4, pageWidth - margin * 2, 7, "F");
  doc.setFontSize(7);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(80, 80, 90);
  colHeaders.forEach((h, i) => {
    doc.text(h, colX[i], y);
  });
  y += 8;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);

  for (const row of data.rows) {
    if (y > doc.internal.pageSize.getHeight() - 30) {
      doc.addPage();
      y = 20;
    }

    if (row.bucket === "90+") doc.setTextColor(180, 30, 30);
    else if (row.bucket === "61-90") doc.setTextColor(200, 60, 60);
    else if (row.bucket === "31-60") doc.setTextColor(200, 120, 40);
    else if (row.bucket === "1-30") doc.setTextColor(180, 160, 30);
    else doc.setTextColor(30, 30, 40);

    const clientLabel = row.clientName.length > 22 ? row.clientName.slice(0, 22) + "…" : row.clientName;
    doc.text(clientLabel, colX[0], y);
    doc.text(row.invoiceNumber, colX[1], y);
    doc.text(formatDate(row.invoiceDate), colX[2], y);
    doc.text(formatDate(row.dueDate), colX[3], y);
    doc.text(`$${row.totalAmount.toLocaleString("en-US", { minimumFractionDigits: 2 })}`, colX[4], y);
    doc.text(`$${row.amountPaid.toLocaleString("en-US", { minimumFractionDigits: 2 })}`, colX[5], y);
    doc.text(`$${row.balanceDue.toLocaleString("en-US", { minimumFractionDigits: 2 })}`, colX[6], y);

    const bucketLabel = BUCKET_COLORS[row.bucket]?.label || row.bucket;
    doc.text(bucketLabel, colX[7], y);
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
  const buckets: Array<[string, string]> = [
    ["Current", formatCurrency(data.summary.current)],
    ["1-30 Days", formatCurrency(data.summary["1-30"])],
    ["31-60 Days", formatCurrency(data.summary["31-60"])],
    ["61-90 Days", formatCurrency(data.summary["61-90"])],
    ["90+ Days", formatCurrency(data.summary["90+"])],
  ];

  for (const [label, amount] of buckets) {
    doc.setFont("helvetica", "normal");
    doc.setTextColor(80, 80, 90);
    doc.text(label, margin + 10, y);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(30, 30, 40);
    doc.text(amount, margin + 60, y);
    y += 6;
  }

  y += 2;
  doc.setDrawColor(200, 200, 210);
  doc.line(margin + 10, y, margin + 100, y);
  y += 6;
  doc.setFontSize(10);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(30, 30, 40);
  doc.text("TOTAL OUTSTANDING", margin + 10, y);
  doc.text(formatCurrency(data.summary.total), margin + 60, y);

  doc.save("AR_Aging_Report.pdf");
}

export default function ARAgingReport() {
  const { data, isLoading } = useQuery<AgingData>({
    queryKey: ["/api/accounting/ar-aging"],
  });

  const rows = data?.rows ?? [];
  const summary = data?.summary ?? { current: 0, "1-30": 0, "31-60": 0, "61-90": 0, "90+": 0, total: 0 };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between flex-wrap gap-3">
          <CardTitle className="flex items-center gap-2" data-testid="title-ar-aging">
            <DollarSign className="w-5 h-5" />
            Accounts Receivable Aging Report
          </CardTitle>
          {rows.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => data && exportAgingPdf(data)}
              data-testid="button-export-ar-pdf"
            >
              <FileDown className="w-4 h-4 mr-1" />
              Export PDF
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center py-12">
            <Clock className="w-10 h-10 text-muted-foreground/30 mb-3" />
            <p className="text-muted-foreground text-sm" data-testid="text-no-ar">
              No outstanding receivables
            </p>
          </div>
        ) : (
          <div className="space-y-6">
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
              {(["current", "1-30", "31-60", "61-90", "90+"] as const).map((bucket) => {
                const colors = BUCKET_COLORS[bucket];
                return (
                  <div key={bucket} className={`rounded-md border p-3 ${colors.bg} ${colors.border}`} data-testid={`card-bucket-${bucket}`}>
                    <p className="text-xs text-muted-foreground">{colors.label}</p>
                    <p className={`text-lg font-bold tabular-nums ${colors.text}`}>
                      {formatCurrency(summary[bucket])}
                    </p>
                  </div>
                );
              })}
              <div className="rounded-md border border-border/50 p-3 bg-muted/20" data-testid="card-bucket-total">
                <p className="text-xs text-muted-foreground">Total Outstanding</p>
                <p className="text-lg font-bold tabular-nums">
                  {formatCurrency(summary.total)}
                </p>
              </div>
            </div>

            <div className="rounded-md border border-border/50 overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Client</TableHead>
                    <TableHead>Invoice #</TableHead>
                    <TableHead>Invoice Date</TableHead>
                    <TableHead>Due Date</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead className="text-right">Paid</TableHead>
                    <TableHead className="text-right">Balance Due</TableHead>
                    <TableHead>Aging</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => {
                    const colors = BUCKET_COLORS[row.bucket];
                    return (
                      <TableRow key={row.id} className={getRowClass(row.bucket)} data-testid={`row-ar-${row.id}`}>
                        <TableCell className="text-sm font-medium">
                          <div>
                            {row.clientName}
                            {row.projectName && (
                              <p className="text-xs text-muted-foreground truncate max-w-[180px]">{row.projectName}</p>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-sm font-mono">{row.invoiceNumber}</TableCell>
                        <TableCell className="text-sm tabular-nums">{formatDate(row.invoiceDate)}</TableCell>
                        <TableCell className="text-sm tabular-nums">{formatDate(row.dueDate)}</TableCell>
                        <TableCell className="text-right text-sm tabular-nums">{formatCurrency(row.totalAmount)}</TableCell>
                        <TableCell className="text-right text-sm tabular-nums text-muted-foreground">{formatCurrency(row.amountPaid)}</TableCell>
                        <TableCell className="text-right text-sm tabular-nums font-semibold">{formatCurrency(row.balanceDue)}</TableCell>
                        <TableCell>
                          <Badge
                            variant="outline"
                            className={`text-[10px] ${colors.bg} ${colors.text} ${colors.border}`}
                            data-testid={`badge-aging-${row.id}`}
                          >
                            {colors.label}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  <TableRow className="bg-muted/30 font-semibold border-t-2">
                    <TableCell colSpan={4} className="text-sm">
                      TOTALS ({rows.length} invoices)
                    </TableCell>
                    <TableCell className="text-right text-sm tabular-nums" data-testid="text-total-amount">
                      {formatCurrency(rows.reduce((s, r) => s + r.totalAmount, 0))}
                    </TableCell>
                    <TableCell className="text-right text-sm tabular-nums text-muted-foreground" data-testid="text-total-paid">
                      {formatCurrency(rows.reduce((s, r) => s + r.amountPaid, 0))}
                    </TableCell>
                    <TableCell className="text-right text-sm tabular-nums" data-testid="text-total-balance">
                      {formatCurrency(summary.total)}
                    </TableCell>
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
