import { jsPDF } from "jspdf";

const MARGIN = 20;
const BRAND_COLOR: [number, number, number] = [200, 170, 60];
const TEXT_PRIMARY: [number, number, number] = [20, 20, 30];
const TEXT_MUTED: [number, number, number] = [100, 100, 110];
const TABLE_HEADER_BG: [number, number, number] = [240, 240, 245];

function addHeader(doc: jsPDF, title: string, dateRange: string) {
  const pageWidth = doc.internal.pageSize.getWidth();
  let y = 20;

  doc.setFontSize(20);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(...TEXT_PRIMARY);
  doc.text("BLACKRIDGE", MARGIN, y);
  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  doc.text("PLATFORMS", MARGIN + 58, y);
  y += 4;
  doc.setDrawColor(...BRAND_COLOR);
  doc.setLineWidth(0.8);
  doc.line(MARGIN, y, MARGIN + 75, y);

  doc.setFontSize(14);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(...TEXT_PRIMARY);
  doc.text(title, pageWidth - MARGIN, 20, { align: "right" });

  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(...TEXT_MUTED);
  doc.text(dateRange, pageWidth - MARGIN, 28, { align: "right" });

  const now = new Date();
  doc.text(`Generated: ${now.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`, pageWidth - MARGIN, 34, { align: "right" });

  return 46;
}

function addFooter(doc: jsPDF, pageNum: number, totalPages: number) {
  const pageHeight = doc.internal.pageSize.getHeight();
  const pageWidth = doc.internal.pageSize.getWidth();
  doc.setFontSize(7);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(...TEXT_MUTED);
  doc.text("BlackRidge Platforms — Confidential", MARGIN, pageHeight - 10);
  doc.text(`Page ${pageNum} of ${totalPages}`, pageWidth - MARGIN, pageHeight - 10, { align: "right" });
}

function checkPageBreak(doc: jsPDF, y: number, needed: number): number {
  if (y + needed > doc.internal.pageSize.getHeight() - 20) {
    doc.addPage();
    return 20;
  }
  return y;
}

function drawTableHeader(doc: jsPDF, y: number, cols: { label: string; x: number; align?: "left" | "right" }[]): number {
  const pageWidth = doc.internal.pageSize.getWidth();
  doc.setFillColor(...TABLE_HEADER_BG);
  doc.rect(MARGIN, y - 4, pageWidth - MARGIN * 2, 8, "F");
  doc.setFontSize(8);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(...TEXT_MUTED);
  for (const col of cols) {
    doc.text(col.label, col.x, y, { align: col.align || "left" });
  }
  return y + 10;
}

function fmtCurrency(val: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 }).format(val);
}

function fmtDate(dateStr: string | Date): string {
  return new Date(dateStr).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

interface PLData {
  revenue: { accountName: string; amount: number }[];
  expenses: { accountName: string; amount: number }[];
  totalRevenue: number;
  totalExpenses: number;
  netIncome: number;
}

interface BSData {
  assets: { accountName: string; balance: number }[];
  liabilities: { accountName: string; balance: number }[];
  equity: { accountName: string; balance: number }[];
  totalAssets: number;
  totalLiabilities: number;
  totalEquity: number;
}

interface CFData {
  inflows: { description: string; amount: number }[];
  outflows: { description: string; amount: number }[];
  netCashFlow: number;
}

interface TxEntry {
  date: string;
  memo: string;
  source: string;
  clientName?: string | null;
  projectName?: string | null;
  totalDebits: number;
  totalCredits: number;
  lines?: { accountName: string; debit: number; credit: number }[];
}

export function generatePLPdf(data: PLData, startDate: string, endDate: string) {
  const doc = new jsPDF();
  const pageWidth = doc.internal.pageSize.getWidth();
  const rightCol = pageWidth - MARGIN;
  let y = addHeader(doc, "Profit & Loss Statement", `${fmtDate(startDate)} — ${fmtDate(endDate)}`);

  doc.setFontSize(11);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(...TEXT_PRIMARY);
  doc.text("Revenue", MARGIN, y);
  y += 8;

  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  for (const item of data.revenue) {
    y = checkPageBreak(doc, y, 8);
    doc.setTextColor(...TEXT_PRIMARY);
    doc.text(item.accountName, MARGIN + 6, y);
    doc.text(fmtCurrency(item.amount), rightCol, y, { align: "right" });
    y += 7;
  }

  y = checkPageBreak(doc, y, 10);
  doc.setDrawColor(200, 200, 200);
  doc.line(MARGIN, y - 2, rightCol, y - 2);
  doc.setFont("helvetica", "bold");
  doc.text("Total Revenue", MARGIN + 6, y + 3);
  doc.text(fmtCurrency(data.totalRevenue), rightCol, y + 3, { align: "right" });
  y += 14;

  y = checkPageBreak(doc, y, 10);
  doc.setFontSize(11);
  doc.text("Expenses", MARGIN, y);
  y += 8;

  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  for (const item of data.expenses) {
    y = checkPageBreak(doc, y, 8);
    doc.setTextColor(...TEXT_PRIMARY);
    doc.text(item.accountName, MARGIN + 6, y);
    doc.text(fmtCurrency(item.amount), rightCol, y, { align: "right" });
    y += 7;
  }

  y = checkPageBreak(doc, y, 10);
  doc.setDrawColor(200, 200, 200);
  doc.line(MARGIN, y - 2, rightCol, y - 2);
  doc.setFont("helvetica", "bold");
  doc.text("Total Expenses", MARGIN + 6, y + 3);
  doc.text(fmtCurrency(data.totalExpenses), rightCol, y + 3, { align: "right" });
  y += 18;

  y = checkPageBreak(doc, y, 14);
  doc.setDrawColor(...BRAND_COLOR);
  doc.setLineWidth(0.8);
  doc.line(MARGIN, y - 4, rightCol, y - 4);
  doc.setFontSize(12);
  doc.setFont("helvetica", "bold");
  const netColor: [number, number, number] = data.netIncome >= 0 ? [16, 120, 60] : [180, 30, 30];
  doc.setTextColor(...netColor);
  doc.text("Net Income", MARGIN, y + 2);
  doc.text(fmtCurrency(data.netIncome), rightCol, y + 2, { align: "right" });

  const totalPages = doc.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    addFooter(doc, i, totalPages);
  }

  doc.save(`ProfitLoss_${startDate}_to_${endDate}.pdf`);
}

function renderBalanceSheetSection(doc: jsPDF, y: number, title: string, items: { accountName: string; balance: number }[], total: number, totalLabel: string): number {
  const pageWidth = doc.internal.pageSize.getWidth();
  const rightCol = pageWidth - MARGIN;

  y = checkPageBreak(doc, y, 12);
  doc.setFontSize(11);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(...TEXT_PRIMARY);
  doc.text(title, MARGIN, y);
  y += 8;

  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  for (const item of items) {
    y = checkPageBreak(doc, y, 8);
    doc.setTextColor(...TEXT_PRIMARY);
    doc.text(item.accountName, MARGIN + 6, y);
    doc.text(fmtCurrency(item.balance), rightCol, y, { align: "right" });
    y += 7;
  }

  y = checkPageBreak(doc, y, 10);
  doc.setDrawColor(200, 200, 200);
  doc.line(MARGIN, y - 2, rightCol, y - 2);
  doc.setFont("helvetica", "bold");
  doc.text(totalLabel, MARGIN + 6, y + 3);
  doc.text(fmtCurrency(total), rightCol, y + 3, { align: "right" });
  y += 14;

  return y;
}

export function generateFullAccountingPdf(
  pl: PLData,
  bs: BSData,
  cf: CFData,
  transactions: TxEntry[],
  startDate: string,
  endDate: string
) {
  const doc = new jsPDF();
  const pageWidth = doc.internal.pageSize.getWidth();
  const rightCol = pageWidth - MARGIN;

  let y = addHeader(doc, "Complete Financial Report", `${fmtDate(startDate)} — ${fmtDate(endDate)}`);

  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(...TEXT_MUTED);
  doc.text("Prepared for CPA review. Includes Profit & Loss, Balance Sheet, Cash Flow Statement, and General Ledger.", MARGIN, y);
  y += 12;

  // === P&L SECTION ===
  doc.setFontSize(14);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(...TEXT_PRIMARY);
  doc.text("1. Profit & Loss Statement", MARGIN, y);
  y += 3;
  doc.setDrawColor(...BRAND_COLOR);
  doc.setLineWidth(0.5);
  doc.line(MARGIN, y, MARGIN + 60, y);
  y += 8;

  doc.setFontSize(10);
  doc.text("Revenue", MARGIN, y);
  y += 7;
  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  for (const item of pl.revenue) {
    y = checkPageBreak(doc, y, 7);
    doc.setTextColor(...TEXT_PRIMARY);
    doc.text(item.accountName, MARGIN + 6, y);
    doc.text(fmtCurrency(item.amount), rightCol, y, { align: "right" });
    y += 6;
  }
  y = checkPageBreak(doc, y, 8);
  doc.setDrawColor(200, 200, 200);
  doc.line(MARGIN + 6, y - 2, rightCol, y - 2);
  doc.setFont("helvetica", "bold");
  doc.text("Total Revenue", MARGIN + 6, y + 2);
  doc.text(fmtCurrency(pl.totalRevenue), rightCol, y + 2, { align: "right" });
  y += 10;

  doc.setFontSize(10);
  doc.text("Expenses", MARGIN, y);
  y += 7;
  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  for (const item of pl.expenses) {
    y = checkPageBreak(doc, y, 7);
    doc.setTextColor(...TEXT_PRIMARY);
    doc.text(item.accountName, MARGIN + 6, y);
    doc.text(fmtCurrency(item.amount), rightCol, y, { align: "right" });
    y += 6;
  }
  y = checkPageBreak(doc, y, 8);
  doc.setDrawColor(200, 200, 200);
  doc.line(MARGIN + 6, y - 2, rightCol, y - 2);
  doc.setFont("helvetica", "bold");
  doc.text("Total Expenses", MARGIN + 6, y + 2);
  doc.text(fmtCurrency(pl.totalExpenses), rightCol, y + 2, { align: "right" });
  y += 10;

  y = checkPageBreak(doc, y, 12);
  doc.setDrawColor(...BRAND_COLOR);
  doc.setLineWidth(0.8);
  doc.line(MARGIN, y - 2, rightCol, y - 2);
  doc.setFontSize(11);
  const netColor: [number, number, number] = pl.netIncome >= 0 ? [16, 120, 60] : [180, 30, 30];
  doc.setTextColor(...netColor);
  doc.text("Net Income", MARGIN, y + 3);
  doc.text(fmtCurrency(pl.netIncome), rightCol, y + 3, { align: "right" });
  y += 16;

  // === BALANCE SHEET ===
  doc.addPage();
  y = 20;
  doc.setFontSize(14);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(...TEXT_PRIMARY);
  doc.text("2. Balance Sheet", MARGIN, y);
  y += 3;
  doc.setDrawColor(...BRAND_COLOR);
  doc.setLineWidth(0.5);
  doc.line(MARGIN, y, MARGIN + 60, y);
  y += 3;
  doc.setFontSize(8);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(...TEXT_MUTED);
  doc.text(`As of ${fmtDate(endDate)}`, MARGIN, y + 3);
  y += 10;

  y = renderBalanceSheetSection(doc, y, "Assets", bs.assets, bs.totalAssets, "Total Assets");
  y = renderBalanceSheetSection(doc, y, "Liabilities", bs.liabilities, bs.totalLiabilities, "Total Liabilities");
  y = renderBalanceSheetSection(doc, y, "Equity", bs.equity, bs.totalEquity, "Total Equity");

  y = checkPageBreak(doc, y, 12);
  doc.setDrawColor(...BRAND_COLOR);
  doc.setLineWidth(0.8);
  doc.line(MARGIN, y - 4, rightCol, y - 4);
  doc.setFontSize(10);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(...TEXT_PRIMARY);
  doc.text("Liabilities + Equity", MARGIN, y + 2);
  doc.text(fmtCurrency(bs.totalLiabilities + bs.totalEquity), rightCol, y + 2, { align: "right" });
  y += 16;

  // === CASH FLOW ===
  doc.addPage();
  y = 20;
  doc.setFontSize(14);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(...TEXT_PRIMARY);
  doc.text("3. Cash Flow Statement", MARGIN, y);
  y += 3;
  doc.setDrawColor(...BRAND_COLOR);
  doc.setLineWidth(0.5);
  doc.line(MARGIN, y, MARGIN + 60, y);
  y += 10;

  doc.setFontSize(10);
  doc.text("Cash Inflows", MARGIN, y);
  y += 7;
  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  const totalIn = cf.inflows.reduce((s, i) => s + i.amount, 0);
  for (const item of cf.inflows) {
    y = checkPageBreak(doc, y, 7);
    doc.setTextColor(...TEXT_PRIMARY);
    const desc = item.description.length > 60 ? item.description.substring(0, 57) + "..." : item.description;
    doc.text(desc, MARGIN + 6, y);
    doc.text(fmtCurrency(item.amount), rightCol, y, { align: "right" });
    y += 6;
  }
  y = checkPageBreak(doc, y, 8);
  doc.setDrawColor(200, 200, 200);
  doc.line(MARGIN + 6, y - 2, rightCol, y - 2);
  doc.setFont("helvetica", "bold");
  doc.text("Total Inflows", MARGIN + 6, y + 2);
  doc.text(fmtCurrency(totalIn), rightCol, y + 2, { align: "right" });
  y += 12;

  doc.setFontSize(10);
  doc.text("Cash Outflows", MARGIN, y);
  y += 7;
  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  const totalOut = cf.outflows.reduce((s, i) => s + i.amount, 0);
  for (const item of cf.outflows) {
    y = checkPageBreak(doc, y, 7);
    doc.setTextColor(...TEXT_PRIMARY);
    const desc = item.description.length > 60 ? item.description.substring(0, 57) + "..." : item.description;
    doc.text(desc, MARGIN + 6, y);
    doc.text(`(${fmtCurrency(item.amount)})`, rightCol, y, { align: "right" });
    y += 6;
  }
  y = checkPageBreak(doc, y, 8);
  doc.setDrawColor(200, 200, 200);
  doc.line(MARGIN + 6, y - 2, rightCol, y - 2);
  doc.setFont("helvetica", "bold");
  doc.text("Total Outflows", MARGIN + 6, y + 2);
  doc.text(`(${fmtCurrency(totalOut)})`, rightCol, y + 2, { align: "right" });
  y += 12;

  y = checkPageBreak(doc, y, 12);
  doc.setDrawColor(...BRAND_COLOR);
  doc.setLineWidth(0.8);
  doc.line(MARGIN, y - 2, rightCol, y - 2);
  doc.setFontSize(11);
  const cfColor: [number, number, number] = cf.netCashFlow >= 0 ? [16, 120, 60] : [180, 30, 30];
  doc.setTextColor(...cfColor);
  doc.text("Net Cash Flow", MARGIN, y + 3);
  doc.text(fmtCurrency(cf.netCashFlow), rightCol, y + 3, { align: "right" });
  y += 16;

  // === GENERAL LEDGER ===
  doc.addPage();
  y = 20;
  doc.setFontSize(14);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(...TEXT_PRIMARY);
  doc.text("4. General Ledger", MARGIN, y);
  y += 3;
  doc.setDrawColor(...BRAND_COLOR);
  doc.setLineWidth(0.5);
  doc.line(MARGIN, y, MARGIN + 60, y);
  y += 10;

  const ledgerCols = [
    { label: "DATE", x: MARGIN, align: "left" as const },
    { label: "DESCRIPTION", x: MARGIN + 24, align: "left" as const },
    { label: "CLIENT / PROJECT", x: MARGIN + 90, align: "left" as const },
    { label: "DEBIT", x: rightCol - 22, align: "right" as const },
    { label: "CREDIT", x: rightCol, align: "right" as const },
  ];

  function ledgerPageBreak(currentY: number, needed: number): number {
    if (currentY + needed > doc.internal.pageSize.getHeight() - 20) {
      doc.addPage();
      let ny = 20;
      doc.setFontSize(9);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(...TEXT_MUTED);
      doc.text("4. General Ledger (continued)", MARGIN, ny);
      ny += 8;
      ny = drawTableHeader(doc, ny, ledgerCols);
      return ny;
    }
    return currentY;
  }

  y = drawTableHeader(doc, y, ledgerCols);

  doc.setFontSize(8);
  for (const tx of transactions) {
    y = ledgerPageBreak(y, 14);

    doc.setFont("helvetica", "normal");
    doc.setTextColor(...TEXT_PRIMARY);
    doc.text(fmtDate(tx.date), MARGIN, y);

    const memo = tx.memo.length > 35 ? tx.memo.substring(0, 32) + "..." : tx.memo;
    doc.text(memo, MARGIN + 24, y);

    const clientProject = [tx.clientName, tx.projectName].filter(Boolean).join(" / ");
    const cpTrunc = clientProject.length > 28 ? clientProject.substring(0, 25) + "..." : clientProject;
    doc.setTextColor(...TEXT_MUTED);
    doc.text(cpTrunc || "—", MARGIN + 90, y);

    doc.setTextColor(...TEXT_PRIMARY);
    doc.text(fmtCurrency(tx.totalDebits), rightCol - 22, y, { align: "right" });
    doc.text(fmtCurrency(tx.totalCredits), rightCol, y, { align: "right" });
    y += 5;

    if (tx.lines && tx.lines.length > 0) {
      for (const line of tx.lines) {
        y = ledgerPageBreak(y, 6);
        doc.setFontSize(7);
        doc.setTextColor(...TEXT_MUTED);
        doc.text(`  ${line.accountName}`, MARGIN + 28, y);
        if (line.debit > 0) doc.text(fmtCurrency(line.debit), rightCol - 22, y, { align: "right" });
        if (line.credit > 0) doc.text(fmtCurrency(line.credit), rightCol, y, { align: "right" });
        y += 5;
      }
      doc.setFontSize(8);
    }

    doc.setDrawColor(230, 230, 230);
    doc.line(MARGIN, y, rightCol, y);
    y += 4;
  }

  const totalPages = doc.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    addFooter(doc, i, totalPages);
  }

  doc.save(`FullAccountingReport_${startDate}_to_${endDate}.pdf`);
}
