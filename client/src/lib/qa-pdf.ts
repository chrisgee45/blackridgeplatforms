import { jsPDF } from "jspdf";
import type { QaChecklist } from "@shared/schema";

const MARGIN = 20;
const BRAND_COLOR: [number, number, number] = [200, 170, 60];
const TEXT_PRIMARY: [number, number, number] = [20, 20, 30];
const TEXT_MUTED: [number, number, number] = [100, 100, 110];
const TABLE_HEADER_BG: [number, number, number] = [240, 240, 245];

const STATUS_COLORS: Record<string, [number, number, number]> = {
  pass: [16, 120, 60],
  fail: [180, 30, 30],
  needs_review: [180, 130, 20],
  not_started: [100, 100, 110],
};

function fmtDate(dateStr: string | Date | null | undefined): string {
  if (!dateStr) return "";
  return new Date(dateStr).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function statusLabel(status: string): string {
  if (status === "not_started") return "Not Started";
  if (status === "needs_review") return "Needs Review";
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function addReportHeader(doc: jsPDF, title: string, projectName: string): number {
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

  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(...TEXT_MUTED);
  doc.text(projectName, pageWidth - MARGIN, 28, { align: "right" });

  const now = new Date();
  doc.setFontSize(9);
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

export function generateQaReport(
  projectName: string,
  items: QaChecklist[],
  score: { total: number; passed: number; score: number }
) {
  const doc = new jsPDF();
  const pageWidth = doc.internal.pageSize.getWidth();
  const rightCol = pageWidth - MARGIN;
  let y = addReportHeader(doc, "QA Report", projectName);

  doc.setFillColor(...TABLE_HEADER_BG);
  doc.rect(MARGIN, y - 4, pageWidth - MARGIN * 2, 14, "F");
  doc.setFontSize(10);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(...TEXT_PRIMARY);
  doc.text("Score Summary", MARGIN + 4, y + 2);

  const scoreColor = score.score >= 95 ? [16, 120, 60] as [number, number, number] : score.score >= 90 ? [180, 130, 20] as [number, number, number] : [180, 30, 30] as [number, number, number];
  doc.setTextColor(...scoreColor);
  doc.text(`${score.score.toFixed(1)}%`, rightCol - 40, y + 2);
  doc.setTextColor(...TEXT_MUTED);
  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  doc.text(`(${score.passed}/${score.total} passed)`, rightCol, y + 2, { align: "right" });
  y += 18;

  const grouped: Record<string, QaChecklist[]> = {};
  items.forEach((item) => {
    if (!grouped[item.category]) grouped[item.category] = [];
    grouped[item.category].push(item);
  });
  const categories = Object.keys(grouped).sort();

  for (const category of categories) {
    const catItems = grouped[category];
    const catPassed = catItems.filter((i) => i.status === "pass").length;

    y = checkPageBreak(doc, y, 20);

    doc.setFontSize(11);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...TEXT_PRIMARY);
    doc.text(category, MARGIN, y);

    doc.setFontSize(9);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...TEXT_MUTED);
    doc.text(`${catPassed}/${catItems.length} passed`, rightCol, y, { align: "right" });
    y += 3;
    doc.setDrawColor(...BRAND_COLOR);
    doc.setLineWidth(0.4);
    doc.line(MARGIN, y, rightCol, y);
    y += 6;

    doc.setFontSize(8);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...TEXT_MUTED);
    doc.text("ITEM", MARGIN + 2, y);
    doc.text("STATUS", rightCol - 60, y);
    doc.text("ASSIGNEE", rightCol - 20, y, { align: "right" });
    y += 5;

    doc.setFont("helvetica", "normal");
    for (const item of catItems) {
      y = checkPageBreak(doc, y, 14);

      doc.setTextColor(...TEXT_PRIMARY);
      const desc = item.itemDescription.length > 65 ? item.itemDescription.substring(0, 62) + "..." : item.itemDescription;
      doc.text(desc, MARGIN + 2, y);

      const sColor = STATUS_COLORS[item.status] || TEXT_MUTED;
      doc.setTextColor(...sColor);
      doc.text(statusLabel(item.status), rightCol - 60, y);

      doc.setTextColor(...TEXT_MUTED);
      doc.text(item.assignedTo || "—", rightCol - 20, y, { align: "right" });
      y += 5;

      if (item.notes) {
        y = checkPageBreak(doc, y, 6);
        doc.setFontSize(7);
        doc.setTextColor(...TEXT_MUTED);
        const note = item.notes.length > 80 ? item.notes.substring(0, 77) + "..." : item.notes;
        doc.text(`Note: ${note}`, MARGIN + 6, y);
        doc.setFontSize(8);
        y += 5;
      }

      doc.setDrawColor(230, 230, 230);
      doc.line(MARGIN, y, rightCol, y);
      y += 4;
    }

    y += 4;
  }

  const totalPages = doc.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    addFooter(doc, i, totalPages);
  }

  const safeName = projectName.replace(/[^a-zA-Z0-9]/g, "_");
  doc.save(`QA_Report_${safeName}.pdf`);
}

export function generateQaCertificate(
  projectName: string,
  score: number,
  date: string
) {
  const doc = new jsPDF({ orientation: "landscape" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const centerX = pageWidth / 2;
  const centerY = pageHeight / 2;

  doc.setDrawColor(...BRAND_COLOR);
  doc.setLineWidth(3);
  doc.rect(12, 12, pageWidth - 24, pageHeight - 24);
  doc.setLineWidth(1);
  doc.rect(16, 16, pageWidth - 32, pageHeight - 32);

  let y = 40;

  doc.setDrawColor(...BRAND_COLOR);
  doc.setLineWidth(0.8);
  doc.line(centerX - 50, y, centerX + 50, y);
  y += 8;

  doc.setFontSize(12);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(...TEXT_MUTED);
  doc.text("BLACKRIDGE PLATFORMS", centerX, y, { align: "center" });
  y += 20;

  doc.setFontSize(32);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(...BRAND_COLOR);
  doc.text("QA CERTIFICATION", centerX, y, { align: "center" });
  y += 8;

  doc.setDrawColor(...BRAND_COLOR);
  doc.setLineWidth(0.8);
  doc.line(centerX - 60, y, centerX + 60, y);
  y += 18;

  doc.setFontSize(12);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(...TEXT_MUTED);
  doc.text("This certifies that the project", centerX, y, { align: "center" });
  y += 14;

  doc.setFontSize(22);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(...TEXT_PRIMARY);
  doc.text(projectName, centerX, y, { align: "center" });
  y += 10;

  doc.setDrawColor(200, 200, 200);
  doc.setLineWidth(0.3);
  doc.line(centerX - 80, y, centerX + 80, y);
  y += 14;

  doc.setFontSize(12);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(...TEXT_MUTED);
  doc.text("has successfully completed Quality Assurance review with a score of", centerX, y, { align: "center" });
  y += 16;

  doc.setFontSize(36);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(16, 120, 60);
  doc.text(`${score.toFixed(1)}%`, centerX, y, { align: "center" });
  y += 16;

  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(...TEXT_MUTED);
  doc.text(`Certified on ${fmtDate(date)}`, centerX, y, { align: "center" });
  y += 20;

  doc.setDrawColor(...BRAND_COLOR);
  doc.setLineWidth(0.8);
  doc.line(centerX - 50, y, centerX + 50, y);
  y += 10;

  doc.setFontSize(10);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(...BRAND_COLOR);
  doc.text("Certified by BlackRidge Platforms", centerX, y, { align: "center" });

  const safeName = projectName.replace(/[^a-zA-Z0-9]/g, "_");
  doc.save(`QA_Certificate_${safeName}.pdf`);
}

export function exportQaCsv(
  projectName: string,
  items: QaChecklist[]
) {
  const headers = ["Category", "Description", "Status", "Assigned To", "Notes", "Completed At", "Completed By"];
  const rows = items.map((item) => [
    item.category,
    item.itemDescription,
    statusLabel(item.status),
    item.assignedTo || "",
    (item.notes || "").replace(/"/g, '""'),
    item.completedAt ? fmtDate(item.completedAt) : "",
    item.completedBy || "",
  ]);

  const csvContent = [
    headers.join(","),
    ...rows.map((row) => row.map((cell) => `"${cell}"`).join(",")),
  ].join("\n");

  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  const safeName = projectName.replace(/[^a-zA-Z0-9]/g, "_");
  link.href = url;
  link.download = `QA_Checklist_${safeName}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}
