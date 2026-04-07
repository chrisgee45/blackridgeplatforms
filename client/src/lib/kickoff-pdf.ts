import { jsPDF } from "jspdf";

const MARGIN = 20;
const BRAND_COLOR: [number, number, number] = [200, 170, 60];
const TEXT_PRIMARY: [number, number, number] = [20, 20, 30];
const TEXT_MUTED: [number, number, number] = [100, 100, 110];
const SECTION_BG: [number, number, number] = [245, 243, 235];

function fmtDate(dateStr: string | Date | null | undefined): string {
  if (!dateStr) return "";
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function addHeader(doc: jsPDF, projectName: string, companyName: string): number {
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
  doc.text("Client Kickoff Summary", pageWidth - MARGIN, 20, { align: "right" });

  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(...TEXT_MUTED);
  doc.text(companyName || projectName, pageWidth - MARGIN, 28, { align: "right" });

  const now = new Date();
  doc.setFontSize(9);
  doc.text(
    `Generated: ${now.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`,
    pageWidth - MARGIN,
    34,
    { align: "right" },
  );

  return 48;
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
  if (y + needed > doc.internal.pageSize.getHeight() - 25) {
    doc.addPage();
    return 20;
  }
  return y;
}

/** Wraps text and returns lines + height consumed */
function wrapText(doc: jsPDF, text: string, maxWidth: number): string[] {
  return doc.splitTextToSize(text, maxWidth);
}

interface KickoffData {
  clientName: string;
  clientEmail: string;
  companyName?: string;
  submittedAt?: string | Date | null;
  sentAt?: string | Date | null;
  signatureAcknowledged?: boolean;
  responses: Record<string, any>;
  uploadedFiles?: { name: string; size?: number; type?: string }[];
}

const LABEL_MAP: Record<string, string> = {
  businessName: "Business Name",
  businessDescription: "About the Business",
  idealCustomer: "Ideal Customer",
  differentiator: "What Sets Them Apart",
  hasWebsite: "Has Existing Website",
  existingUrl: "Current URL",
  websiteChanges: "Keep / Change / Remove",
  existingBrand: "Brand Status",
  brandColors: "Brand Colors",
  fonts: "Fonts",
  brandPersonality: "Brand Personality",
  brandPersonalityOther: "Other Personality",
  pagesNeeded: "Pages Needed",
  pagesCustom: "Custom Pages",
  homepageGoal: "Homepage Goal",
  inspirationSites: "Inspiration Sites",
  sitesToAvoid: "Sites to Avoid",
  copyWriter: "Who Writes Copy",
  hasProfessionalPhotos: "Professional Photos",
  needsStockPhotography: "Needs Stock Photos",
  hasVideoContent: "Video Content",
  videoLinks: "Video Links",
  featuresNeeded: "Features",
  featuresCustom: "Custom Features",
  thirdPartyIntegrations: "Integrations",
  lockedInTools: "Locked-in Tools",
  ownsDomain: "Owns Domain",
  domainRegistrar: "Registrar",
  existingHosting: "Hosting",
  loginsToShare: "Logins to Share",
  socialPlatforms: "Social Platforms",
  socialHandles: "Social Handles",
  pointOfContact: "Point of Contact",
  preferredContact: "Preferred Contact",
  bestTimes: "Best Times",
  hasDeadline: "Has Deadline",
  deadlineDetails: "Deadline Details",
  nervousAbout: "Concerns",
  anythingElse: "Additional Notes",
};

const SECTIONS = [
  { title: "Your Business", keys: ["businessName", "businessDescription", "idealCustomer", "differentiator", "hasWebsite", "existingUrl", "websiteChanges"] },
  { title: "Brand Identity", keys: ["existingBrand", "brandColors", "fonts", "brandPersonality", "brandPersonalityOther"] },
  { title: "Website & Pages", keys: ["pagesNeeded", "pagesCustom", "homepageGoal", "inspirationSites", "sitesToAvoid"] },
  { title: "Content & Copy", keys: ["copyWriter", "hasProfessionalPhotos", "needsStockPhotography", "hasVideoContent", "videoLinks"] },
  { title: "Features & Functionality", keys: ["featuresNeeded", "featuresCustom", "thirdPartyIntegrations", "lockedInTools"] },
  { title: "Access & Accounts", keys: ["ownsDomain", "domainRegistrar", "existingHosting", "loginsToShare", "socialPlatforms", "socialHandles"] },
  { title: "Communication & Timeline", keys: ["pointOfContact", "preferredContact", "bestTimes", "hasDeadline", "deadlineDetails", "nervousAbout", "anythingElse"] },
];

export function generateKickoffPdf(projectName: string, data: KickoffData) {
  const doc = new jsPDF();
  const pageWidth = doc.internal.pageSize.getWidth();
  const contentWidth = pageWidth - MARGIN * 2;
  let y = addHeader(doc, projectName, data.companyName || projectName);

  // Client info summary box
  doc.setFillColor(...SECTION_BG);
  doc.roundedRect(MARGIN, y - 4, contentWidth, 32, 2, 2, "F");

  doc.setFontSize(10);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(...TEXT_PRIMARY);
  doc.text("Client:", MARGIN + 6, y + 4);
  doc.setFont("helvetica", "normal");
  doc.text(data.clientName, MARGIN + 30, y + 4);

  doc.setFont("helvetica", "bold");
  doc.text("Email:", MARGIN + 6, y + 12);
  doc.setFont("helvetica", "normal");
  doc.text(data.clientEmail, MARGIN + 30, y + 12);

  doc.setFont("helvetica", "bold");
  doc.text("Submitted:", MARGIN + 6, y + 20);
  doc.setFont("helvetica", "normal");
  doc.text(fmtDate(data.submittedAt), MARGIN + 38, y + 20);

  if (data.signatureAcknowledged) {
    doc.setTextColor(16, 120, 60);
    doc.setFont("helvetica", "bold");
    doc.text("Signature Acknowledged", pageWidth - MARGIN - 6, y + 20, { align: "right" });
  }

  y += 38;

  // Sections
  const r = data.responses;
  for (const section of SECTIONS) {
    const hasData = section.keys.some((k) => {
      const v = r[k];
      return v !== undefined && v !== null && v !== "" && !(Array.isArray(v) && v.length === 0);
    });
    if (!hasData) continue;

    y = checkPageBreak(doc, y, 30);

    // Section header
    doc.setFillColor(...BRAND_COLOR);
    doc.rect(MARGIN, y, contentWidth, 9, "F");
    doc.setFontSize(10);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(255, 255, 255);
    doc.text(section.title.toUpperCase(), MARGIN + 4, y + 6.5);
    y += 14;

    // Fields
    for (const key of section.keys) {
      const val = r[key];
      if (val === undefined || val === null || val === "" || (Array.isArray(val) && val.length === 0)) continue;

      const displayVal = Array.isArray(val) ? val.join(", ") : String(val);
      const label = LABEL_MAP[key] || key;

      // Calculate how much space this field needs
      const wrappedValue = wrapText(doc, displayVal, contentWidth - 8);
      const fieldHeight = 8 + wrappedValue.length * 5;
      y = checkPageBreak(doc, y, fieldHeight + 4);

      // Label
      doc.setFontSize(8);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(...TEXT_MUTED);
      doc.text(label.toUpperCase(), MARGIN + 4, y);
      y += 4;

      // Value
      doc.setFontSize(10);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(...TEXT_PRIMARY);
      for (const line of wrappedValue) {
        y = checkPageBreak(doc, y, 6);
        doc.text(line, MARGIN + 4, y);
        y += 5;
      }

      // Thin separator line
      y += 2;
      doc.setDrawColor(220, 220, 225);
      doc.setLineWidth(0.3);
      doc.line(MARGIN + 4, y, pageWidth - MARGIN - 4, y);
      y += 5;
    }

    y += 4;
  }

  // Uploaded files section
  if (data.uploadedFiles && data.uploadedFiles.length > 0) {
    y = checkPageBreak(doc, y, 30);

    doc.setFillColor(...BRAND_COLOR);
    doc.rect(MARGIN, y, contentWidth, 9, "F");
    doc.setFontSize(10);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(255, 255, 255);
    doc.text("UPLOADED FILES", MARGIN + 4, y + 6.5);
    y += 14;

    for (const file of data.uploadedFiles) {
      y = checkPageBreak(doc, y, 10);
      doc.setFontSize(9);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(...TEXT_PRIMARY);
      const sizeStr = file.size ? ` (${(file.size / 1024).toFixed(1)} KB)` : "";
      doc.text(`\u2022  ${file.name}${sizeStr}`, MARGIN + 4, y);
      y += 6;
    }
  }

  // Add page numbers
  const totalPages = doc.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    addFooter(doc, i, totalPages);
  }

  // Save
  const filename = `${(data.companyName || projectName).replace(/[^a-zA-Z0-9]/g, "_")}_Kickoff_Summary.pdf`;
  doc.save(filename);
}
