import jsPDF from "jspdf";

const BRAND_GOLD: [number, number, number] = [200, 170, 60];
const PRIMARY_TEXT: [number, number, number] = [20, 20, 30];
const MUTED_TEXT: [number, number, number] = [100, 100, 110];
const HEADER_BG: [number, number, number] = [240, 240, 245];
const BORDER_COLOR: [number, number, number] = [180, 180, 190];
const FORM_BG: [number, number, number] = [252, 252, 255];

const IRS_MAILING_ADDRESSES: Record<string, string> = {
  AL: "Internal Revenue Service\nP.O. Box 931100\nLouisville, KY 40293-1100",
  AK: "Internal Revenue Service\nP.O. Box 802502\nCincinnati, OH 45280-2502",
  AZ: "Internal Revenue Service\nP.O. Box 802502\nCincinnati, OH 45280-2502",
  AR: "Internal Revenue Service\nP.O. Box 931100\nLouisville, KY 40293-1100",
  CA: "Internal Revenue Service\nP.O. Box 802502\nCincinnati, OH 45280-2502",
  CO: "Internal Revenue Service\nP.O. Box 802502\nCincinnati, OH 45280-2502",
  CT: "Internal Revenue Service\nP.O. Box 931100\nLouisville, KY 40293-1100",
  DE: "Internal Revenue Service\nP.O. Box 931100\nLouisville, KY 40293-1100",
  DC: "Internal Revenue Service\nP.O. Box 931100\nLouisville, KY 40293-1100",
  FL: "Internal Revenue Service\nP.O. Box 931100\nLouisville, KY 40293-1100",
  GA: "Internal Revenue Service\nP.O. Box 931100\nLouisville, KY 40293-1100",
  HI: "Internal Revenue Service\nP.O. Box 802502\nCincinnati, OH 45280-2502",
  ID: "Internal Revenue Service\nP.O. Box 802502\nCincinnati, OH 45280-2502",
  IL: "Internal Revenue Service\nP.O. Box 802502\nCincinnati, OH 45280-2502",
  IN: "Internal Revenue Service\nP.O. Box 802502\nCincinnati, OH 45280-2502",
  IA: "Internal Revenue Service\nP.O. Box 802502\nCincinnati, OH 45280-2502",
  KS: "Internal Revenue Service\nP.O. Box 802502\nCincinnati, OH 45280-2502",
  KY: "Internal Revenue Service\nP.O. Box 931100\nLouisville, KY 40293-1100",
  LA: "Internal Revenue Service\nP.O. Box 931100\nLouisville, KY 40293-1100",
  ME: "Internal Revenue Service\nP.O. Box 931100\nLouisville, KY 40293-1100",
  MD: "Internal Revenue Service\nP.O. Box 931100\nLouisville, KY 40293-1100",
  MA: "Internal Revenue Service\nP.O. Box 931100\nLouisville, KY 40293-1100",
  MI: "Internal Revenue Service\nP.O. Box 802502\nCincinnati, OH 45280-2502",
  MN: "Internal Revenue Service\nP.O. Box 802502\nCincinnati, OH 45280-2502",
  MS: "Internal Revenue Service\nP.O. Box 931100\nLouisville, KY 40293-1100",
  MO: "Internal Revenue Service\nP.O. Box 802502\nCincinnati, OH 45280-2502",
  MT: "Internal Revenue Service\nP.O. Box 802502\nCincinnati, OH 45280-2502",
  NE: "Internal Revenue Service\nP.O. Box 802502\nCincinnati, OH 45280-2502",
  NV: "Internal Revenue Service\nP.O. Box 802502\nCincinnati, OH 45280-2502",
  NH: "Internal Revenue Service\nP.O. Box 931100\nLouisville, KY 40293-1100",
  NJ: "Internal Revenue Service\nP.O. Box 931100\nLouisville, KY 40293-1100",
  NM: "Internal Revenue Service\nP.O. Box 802502\nCincinnati, OH 45280-2502",
  NY: "Internal Revenue Service\nP.O. Box 931100\nLouisville, KY 40293-1100",
  NC: "Internal Revenue Service\nP.O. Box 931100\nLouisville, KY 40293-1100",
  ND: "Internal Revenue Service\nP.O. Box 802502\nCincinnati, OH 45280-2502",
  OH: "Internal Revenue Service\nP.O. Box 802502\nCincinnati, OH 45280-2502",
  OK: "Internal Revenue Service\nP.O. Box 802502\nCincinnati, OH 45280-2502",
  OR: "Internal Revenue Service\nP.O. Box 802502\nCincinnati, OH 45280-2502",
  PA: "Internal Revenue Service\nP.O. Box 931100\nLouisville, KY 40293-1100",
  RI: "Internal Revenue Service\nP.O. Box 931100\nLouisville, KY 40293-1100",
  SC: "Internal Revenue Service\nP.O. Box 931100\nLouisville, KY 40293-1100",
  SD: "Internal Revenue Service\nP.O. Box 802502\nCincinnati, OH 45280-2502",
  TN: "Internal Revenue Service\nP.O. Box 931100\nLouisville, KY 40293-1100",
  TX: "Internal Revenue Service\nP.O. Box 802502\nCincinnati, OH 45280-2502",
  UT: "Internal Revenue Service\nP.O. Box 802502\nCincinnati, OH 45280-2502",
  VT: "Internal Revenue Service\nP.O. Box 931100\nLouisville, KY 40293-1100",
  VA: "Internal Revenue Service\nP.O. Box 931100\nLouisville, KY 40293-1100",
  WA: "Internal Revenue Service\nP.O. Box 802502\nCincinnati, OH 45280-2502",
  WV: "Internal Revenue Service\nP.O. Box 931100\nLouisville, KY 40293-1100",
  WI: "Internal Revenue Service\nP.O. Box 802502\nCincinnati, OH 45280-2502",
  WY: "Internal Revenue Service\nP.O. Box 802502\nCincinnati, OH 45280-2502",
};

const QUARTER_LABELS: Record<number, string> = {
  1: "1st Quarter",
  2: "2nd Quarter",
  3: "3rd Quarter",
  4: "4th Quarter",
};

interface Form1040ESData {
  taxpayerName: string;
  taxpayerSSN: string;
  spouseName?: string | null;
  spouseSSN?: string | null;
  address: string;
  city: string;
  state: string;
  zip: string;
  calendarYear: number;
  quarter: number;
  dueDate: string;
  estimatedPaymentAmount: number;
}

function formatSSN(ssn: string): string {
  const digits = ssn.replace(/\D/g, "");
  if (digits.length === 9) {
    return `${digits.slice(0, 3)}-${digits.slice(3, 5)}-${digits.slice(5)}`;
  }
  return ssn;
}

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  }).format(amount);
}

function drawFormField(
  doc: jsPDF,
  x: number,
  y: number,
  width: number,
  height: number,
  label: string,
  value: string,
  labelSize: number = 6
) {
  doc.setDrawColor(...BORDER_COLOR);
  doc.setFillColor(...FORM_BG);
  doc.rect(x, y, width, height, "FD");

  doc.setFontSize(labelSize);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(...MUTED_TEXT);
  doc.text(label, x + 2, y + 3.5);

  doc.setFontSize(10);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(...PRIMARY_TEXT);
  doc.text(value, x + 2, y + height - 3);
}

export function generate1040ESPdf(data: Form1040ESData): void {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "letter" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 20;
  const contentWidth = pageWidth - margin * 2;
  let y = margin;

  doc.setFillColor(...BRAND_GOLD);
  doc.rect(0, 0, pageWidth, 3, "F");

  doc.setFontSize(20);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(...PRIMARY_TEXT);
  doc.text("BLACKRIDGE", margin, y + 10);

  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(...MUTED_TEXT);
  doc.text("Platforms", margin + doc.getTextWidth("BLACKRIDGE") + 2, y + 10);

  doc.setFontSize(8);
  doc.text(`Generated ${new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}`, pageWidth - margin, y + 10, { align: "right" });

  y += 20;

  doc.setDrawColor(...BRAND_GOLD);
  doc.setLineWidth(0.5);
  doc.line(margin, y, pageWidth - margin, y);
  y += 8;

  doc.setFillColor(245, 245, 250);
  doc.roundedRect(margin, y, contentWidth, 24, 2, 2, "F");

  doc.setFontSize(16);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(...PRIMARY_TEXT);
  doc.text("Form 1040-ES", margin + contentWidth / 2, y + 9, { align: "center" });

  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(...MUTED_TEXT);
  doc.text("Estimated Tax Payment Voucher", margin + contentWidth / 2, y + 15, { align: "center" });

  doc.setFontSize(9);
  doc.setTextColor(...BRAND_GOLD);
  doc.setFont("helvetica", "bold");
  doc.text(`${data.calendarYear} — ${QUARTER_LABELS[data.quarter]}`, margin + contentWidth / 2, y + 21, { align: "center" });

  y += 32;

  doc.setFontSize(9);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(...PRIMARY_TEXT);
  doc.text("PAYMENT VOUCHER", margin, y);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(...MUTED_TEXT);
  doc.setFontSize(7);
  doc.text("(Keep a copy for your records — Do not send to the IRS with your tax return)", margin, y + 4);
  y += 10;

  doc.setDrawColor(...BORDER_COLOR);
  doc.setLineWidth(0.3);
  doc.roundedRect(margin, y, contentWidth, 88, 2, 2, "S");
  y += 4;

  const innerMargin = margin + 4;
  const innerWidth = contentWidth - 8;
  const halfWidth = (innerWidth - 4) / 2;

  doc.setFontSize(7);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(...MUTED_TEXT);
  doc.text("Calendar year " + data.calendarYear, innerMargin, y + 2);
  doc.text(`Due: ${data.dueDate}`, innerMargin + innerWidth, y + 2, { align: "right" });
  y += 6;

  drawFormField(doc, innerMargin, y, innerWidth * 0.65, 14, "Your first name and initial, last name", data.taxpayerName);
  drawFormField(doc, innerMargin + innerWidth * 0.65 + 2, y, innerWidth * 0.35 - 2, 14, "Your social security number", formatSSN(data.taxpayerSSN));
  y += 18;

  if (data.spouseName) {
    drawFormField(doc, innerMargin, y, innerWidth * 0.65, 14, "Spouse's first name and initial, last name (if joint)", data.spouseName);
    drawFormField(doc, innerMargin + innerWidth * 0.65 + 2, y, innerWidth * 0.35 - 2, 14, "Spouse's social security number", data.spouseSSN ? formatSSN(data.spouseSSN) : "");
    y += 18;
  } else {
    y += 2;
  }

  drawFormField(doc, innerMargin, y, innerWidth, 14, "Address (number, street, and apt. no.)", data.address);
  y += 18;

  const cityWidth = innerWidth * 0.5;
  const stateWidth = innerWidth * 0.2;
  const zipWidth = innerWidth * 0.3 - 4;
  drawFormField(doc, innerMargin, y, cityWidth, 14, "City", data.city);
  drawFormField(doc, innerMargin + cityWidth + 2, y, stateWidth, 14, "State", data.state);
  drawFormField(doc, innerMargin + cityWidth + stateWidth + 4, y, zipWidth, 14, "ZIP code", data.zip);
  y += 22;

  doc.setFillColor(245, 248, 240);
  doc.setDrawColor(...BRAND_GOLD);
  doc.setLineWidth(0.5);
  doc.roundedRect(margin, y + 4, contentWidth, 22, 2, 2, "FD");

  doc.setFontSize(8);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(...MUTED_TEXT);
  doc.text("Amount of estimated tax payment", margin + 6, y + 12);

  doc.setFontSize(18);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(...PRIMARY_TEXT);
  doc.text(formatCurrency(data.estimatedPaymentAmount), margin + contentWidth - 6, y + 20, { align: "right" });
  y += 34;

  const mailingAddress = (data.state && IRS_MAILING_ADDRESSES[data.state.toUpperCase()])
    ? IRS_MAILING_ADDRESSES[data.state.toUpperCase()]
    : "Internal Revenue Service\nP.O. Box 802502\nCincinnati, OH 45280-2502";

  doc.setFillColor(...HEADER_BG);
  doc.roundedRect(margin, y, contentWidth, 32, 2, 2, "F");

  doc.setFontSize(8);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(...PRIMARY_TEXT);
  doc.text("Mail to:", margin + 4, y + 6);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(...MUTED_TEXT);
  const mailingLines = mailingAddress.split("\n");
  mailingLines.forEach((line, i) => {
    doc.text(line, margin + 4, y + 12 + i * 5);
  });

  doc.setFontSize(7);
  doc.setTextColor(...BRAND_GOLD);
  doc.text("Make check or money order payable to \"United States Treasury\"", margin + contentWidth / 2, y + 28, { align: "center" });

  y += 40;

  doc.setDrawColor(...BRAND_GOLD);
  doc.setLineWidth(0.3);
  doc.line(margin, y, pageWidth - margin, y);
  y += 6;

  doc.setFontSize(7);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(...MUTED_TEXT);
  const notes = [
    "This document is a reference voucher generated by BlackRidge Platforms for your convenience.",
    "It is not an official IRS form. Verify all information before submitting payment.",
    "You may also pay online at www.irs.gov/payments using Direct Pay or EFTPS.",
    `For ${QUARTER_LABELS[data.quarter]} ${data.calendarYear}, payment is due ${data.dueDate}.`,
  ];
  notes.forEach((note, i) => {
    doc.text(`• ${note}`, margin, y + i * 4.5);
  });

  y += notes.length * 4.5 + 8;

  if (y < doc.internal.pageSize.getHeight() - 30) {
    doc.setFillColor(250, 248, 240);
    doc.setDrawColor(...BRAND_GOLD);
    doc.setLineWidth(0.2);
    doc.roundedRect(margin, y, contentWidth, 24, 2, 2, "FD");

    doc.setFontSize(7);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...PRIMARY_TEXT);
    doc.text("Payment Summary", margin + 4, y + 5);

    doc.setFont("helvetica", "normal");
    doc.setTextColor(...MUTED_TEXT);
    doc.text(`Quarter: ${QUARTER_LABELS[data.quarter]}`, margin + 4, y + 10);
    doc.text(`Calendar Year: ${data.calendarYear}`, margin + 4, y + 14);
    doc.text(`Due Date: ${data.dueDate}`, margin + 4, y + 18);
    doc.text(`Amount: ${formatCurrency(data.estimatedPaymentAmount)}`, margin + contentWidth / 2, y + 10);
    doc.text(`Taxpayer: ${data.taxpayerName}`, margin + contentWidth / 2, y + 14);
    doc.text(`SSN: ***-**-${data.taxpayerSSN.replace(/\D/g, "").slice(-4)}`, margin + contentWidth / 2, y + 18);
  }

  const footerY = doc.internal.pageSize.getHeight() - 10;
  doc.setFontSize(7);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(...MUTED_TEXT);
  doc.text("BlackRidge Platforms — Confidential", margin, footerY);
  doc.text("Page 1 of 1", pageWidth - margin, footerY, { align: "right" });

  doc.setFillColor(...BRAND_GOLD);
  doc.rect(0, doc.internal.pageSize.getHeight() - 3, pageWidth, 3, "F");

  doc.save(`1040-ES_${data.calendarYear}_Q${data.quarter}.pdf`);
}
