/**
 * Jake reports to Chris.
 *
 * Chris can ask Jake (by voice or text in the OPS portal) to "send me a
 * report" on a client or across the whole book of business. Jake gathers
 * the relevant data, has Claude write it up, renders it to a branded PDF,
 * and emails it straight to Chris's inbox.
 *
 * This is INTERNAL — the report always goes to Chris, never to a client —
 * so it is not subject to the client-email confirmation guard that gates
 * email_client / share_progress / send_documents. When Chris asks for a
 * report, Jake just makes it.
 */
import PDFDocument from "pdfkit";
import Anthropic from "@anthropic-ai/sdk";
import { Resend } from "resend";
import { db } from "./db";
import { projects, projectConversations, clients, contacts, companies, tasks } from "@shared/schema";
import { eq, asc, desc, sql } from "drizzle-orm";
import { stripDashes } from "./text-utils";
import { buildJakeDailyReport } from "./jake";

const JAKE_FROM_EMAIL = process.env.JAKE_FROM_EMAIL || "jake@blackridgeplatforms.com";
const JAKE_FROM_NAME = process.env.JAKE_FROM_NAME || "Jake at BlackRidge";
// Where Jake's reports land. Defaults to Chris's address; overridable so a
// second owner address can be added without a code change.
const CHRIS_REPORT_EMAIL = process.env.CHRIS_REPORT_EMAIL || "chris@blackridgeplatforms.com";

export interface JakeReportResult {
  ok: boolean;
  message: string;
  subject?: string;
}

// ─────────────────────────────────────────────────────────────────────────
// Data gathering
// ─────────────────────────────────────────────────────────────────────────

async function clientLabelForProject(p: typeof projects.$inferSelect): Promise<string> {
  if (p.clientId) {
    const [cl] = await db.select().from(clients).where(eq(clients.id, p.clientId));
    if (cl?.name) return cl.name;
  }
  if (p.companyId) {
    const [co] = await db.select().from(companies).where(eq(companies.id, p.companyId));
    if (co?.name) return co.name;
  }
  if (p.contactId) {
    const [c] = await db.select().from(contacts).where(eq(contacts.id, p.contactId));
    if (c?.name) return c.name;
  }
  return p.name;
}

/**
 * Build the DATA block for a single-project report. Centred on what the
 * client has asked for and what is still open, since that is the most
 * common report Chris wants ("send me everything Crissy asked for").
 */
async function gatherProjectReportData(projectId: string): Promise<{ heading: string; data: string } | null> {
  const [proj] = await db.select().from(projects).where(eq(projects.id, projectId));
  if (!proj) return null;

  const clientName = await clientLabelForProject(proj);

  const conversations = await db
    .select()
    .from(projectConversations)
    .where(eq(projectConversations.projectId, projectId))
    .orderBy(asc(projectConversations.createdAt));

  const inbound = conversations.filter(c => c.direction === "inbound");
  const fmtDate = (d: Date | string | null) =>
    d ? new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "?";

  const lines: string[] = [];
  lines.push(`Project: ${proj.name}`);
  lines.push(`Client: ${clientName}`);
  lines.push(`Stage: ${proj.stage ?? "unknown"}`);
  if (proj.jakeAwaitingHandoff && proj.jakeHandoffReason) {
    lines.push(`Open handoff to Chris: ${proj.jakeHandoffReason}`);
  }

  lines.push("");
  lines.push("CLIENT MESSAGES (what the client has sent, oldest first):");
  if (inbound.length === 0) {
    lines.push("- (no inbound messages from the client on record)");
  } else {
    for (const c of inbound) {
      const body = (c.body ?? "").replace(/\s+/g, " ").trim();
      lines.push(`- [${fmtDate(c.createdAt)}] ${c.subject ? `${c.subject}: ` : ""}${body.slice(0, 1200)}`);
    }
  }

  const openTasks = await db
    .select()
    .from(tasks)
    .where(eq(tasks.projectId, projectId))
    .orderBy(asc(tasks.sortOrder));
  const open = openTasks.filter(t => t.status !== "done");
  lines.push("");
  lines.push("OPEN TASKS ALREADY LOGGED ON THIS PROJECT:");
  if (open.length === 0) {
    lines.push("- (none logged yet)");
  } else {
    for (const t of open) {
      lines.push(`- ${t.title} [${t.status}${t.priority ? `, ${t.priority}` : ""}]${t.dueDate ? ` (due ${fmtDate(t.dueDate)})` : ""}`);
    }
  }

  return { heading: `${clientName} — Requests & Action Items`, data: lines.join("\n") };
}

/**
 * Build the DATA block for a book-wide report. Uses the same 7-day
 * conversation window Jake's voice snapshot relies on, plus the daily
 * report totals and any open handoffs.
 */
async function gatherPortfolioReportData(): Promise<{ heading: string; data: string }> {
  const daily = await buildJakeDailyReport(24 * 7); // last 7 days
  const lines: string[] = [];
  lines.push(`Window: last 7 days (through ${new Date(daily.windowEnd).toLocaleString("en-US")})`);
  lines.push("");
  lines.push("TOTALS:");
  lines.push(`- Inbound client messages: ${daily.totals.inbound}`);
  lines.push(`- Replies Jake sent: ${daily.totals.replies}`);
  lines.push(`- Welcomes: ${daily.totals.welcomes} · Check-ins: ${daily.totals.checkins}`);
  lines.push(`- Open handoffs needing Chris: ${daily.totals.openHandoffs}`);

  if (daily.projects.length > 0) {
    lines.push("");
    lines.push("BY PROJECT:");
    for (const p of daily.projects) {
      lines.push(
        `- ${p.projectName}${p.clientName ? ` (${p.clientName})` : ""}: ${p.inbound} in / ${p.replies} replies${p.awaitingHandoff ? ` · AWAITING CHRIS: ${p.handoffReason ?? "needs answer"}` : ""}`,
      );
    }
  }

  if (daily.recentHandoffs.length > 0) {
    lines.push("");
    lines.push("OPEN HANDOFFS (need Chris):");
    for (const h of daily.recentHandoffs) {
      lines.push(`- ${h.projectName}: ${h.reason ?? "needs answer"}`);
    }
  }

  // Recent raw activity so Claude can pull specifics if the intent asks.
  const since = new Date(Date.now() - 7 * 86400000);
  const recent = await db
    .select()
    .from(projectConversations)
    .where(sql`${projectConversations.createdAt} >= ${since}`)
    .orderBy(desc(projectConversations.createdAt))
    .limit(40);
  if (recent.length > 0) {
    const allProjects = await db.select().from(projects);
    const names = new Map(allProjects.map(p => [p.id, p.name]));
    lines.push("");
    lines.push("RECENT MESSAGES:");
    for (const c of recent) {
      const who = c.direction === "inbound" ? "CLIENT" : "JAKE";
      const snippet = (c.body ?? "").replace(/\s+/g, " ").slice(0, 300);
      lines.push(`- [${new Date(c.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}] ${names.get(c.projectId) ?? "?"} · ${who}: ${snippet}`);
    }
  }

  return { heading: "BlackRidge — Client Activity Report", data: lines.join("\n") };
}

// ─────────────────────────────────────────────────────────────────────────
// Report composition + PDF rendering
// ─────────────────────────────────────────────────────────────────────────

const JAKE_REPORT_SYSTEM = `You are Jake, Chris Gee's Client Relations Specialist at BlackRidge Platforms. You are writing an INTERNAL report FOR Chris (your boss), not for a client. Chris asked you to pull this together so he can act on it.

Write a clean, scannable report in plain text. Rules:
- Start with a single short title line (no label like "Title:", just the title itself).
- Then the body. Use short section headers in ALL CAPS followed by a colon, and simple "- " bullets under them.
- When the report is about a client's requests, the MOST IMPORTANT section is a numbered list of concrete action items: exactly what Chris needs to do, pulled from what the client actually asked for. Be specific. Do not invent requests the data does not support.
- Lead with what matters. No filler, no "I hope this finds you well", no corporate speak.
- No markdown asterisks or backticks. No em dashes. Plain text only.
- This goes to Chris alone, so speak plainly to him. A short "Prepared by Jake" line at the very end is fine. Do NOT use the client-facing four-line signature.`;

async function composeReport(heading: string, data: string, intent: string | null): Promise<{ title: string; body: string }> {
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const intentLine = intent && intent.trim()
    ? `Chris asked for this specifically: "${intent.trim()}". Honor that focus.`
    : `Chris asked for a report on this. Give him the full picture and the action items.`;

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 2000,
    system: JAKE_REPORT_SYSTEM,
    messages: [{
      role: "user",
      content: `Report topic: ${heading}\n\n${intentLine}\n\nHere is the data to base the report on. Use only what is here.\n\n=== DATA ===\n${data}\n\nWrite the report now.`,
    }],
  });

  const text = stripDashes(response.content.map(b => (b.type === "text" ? b.text : "")).join("").trim());
  const firstBreak = text.indexOf("\n");
  const title = (firstBreak === -1 ? text : text.slice(0, firstBreak)).trim().replace(/^#+\s*/, "") || heading;
  const body = (firstBreak === -1 ? "" : text.slice(firstBreak + 1)).trim();
  return { title, body: body || text };
}

function renderReportPdf(title: string, body: string): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({ size: "letter", margin: 60 });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const now = new Date();
    const dateStr = now.toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
    const timeStr = now.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });

    // Header band.
    doc.rect(0, 0, doc.page.width, 70).fill("#0A0A0A");
    doc.font("Helvetica-Bold").fontSize(18).fillColor("#C9A840")
      .text("BLACKRIDGE PLATFORMS", 60, 22, { align: "left" });

    doc.font("Helvetica-Bold").fontSize(14).fillColor("#333333")
      .text(title.slice(0, 120), 60, 90, { width: doc.page.width - 120 });
    doc.font("Helvetica").fontSize(10).fillColor("#888888")
      .text(`Prepared by Jake for Chris  ·  ${dateStr} at ${timeStr}`, 60, doc.y + 4);
    doc.moveTo(60, doc.y + 8).lineTo(doc.page.width - 60, doc.y + 8).strokeColor("#E5E5E5").stroke();

    doc.moveDown(1.5);
    doc.font("Helvetica").fontSize(11).fillColor("#222222")
      .text(body, 60, doc.y, { width: doc.page.width - 120, lineGap: 5 });

    doc.end();
  });
}

// ─────────────────────────────────────────────────────────────────────────
// Public entry point — called by the Jake voice action runner.
// ─────────────────────────────────────────────────────────────────────────

export async function buildAndEmailJakeReport(opts: {
  projectId?: string | null;
  intent?: string | null;
}): Promise<JakeReportResult> {
  try {
    let gathered: { heading: string; data: string } | null;
    if (opts.projectId) {
      gathered = await gatherProjectReportData(opts.projectId);
      if (!gathered) return { ok: false, message: "project not found" };
    } else {
      gathered = await gatherPortfolioReportData();
    }

    const { title, body } = await composeReport(gathered.heading, gathered.data, opts.intent ?? null);
    const pdfBuffer = await renderReportPdf(title, body);

    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
      console.log(`RESEND_API_KEY not set — Jake report "${title}" simulated (would email ${CHRIS_REPORT_EMAIL}).`);
      return { ok: true, message: `Report "${title}" generated (email simulated — RESEND_API_KEY not set)`, subject: title };
    }

    const resend = new Resend(apiKey);
    const safeFile = (title.replace(/[^a-z0-9]+/gi, "_").replace(/^_+|_+$/g, "").slice(0, 60) || "Jake_Report") + ".pdf";
    try {
      await resend.emails.send({
        from: `${JAKE_FROM_NAME} <${JAKE_FROM_EMAIL}>`,
        to: CHRIS_REPORT_EMAIL,
        replyTo: JAKE_FROM_EMAIL,
        subject: `Report: ${title.slice(0, 90)}`,
        html: `<div style="font-family: Arial, sans-serif; max-width: 600px; line-height: 1.6;">Hey Chris,<br><br>The report you asked for is attached: <strong>${title}</strong>.<br><br>Sincerely,<br>Jake</div>`,
        attachments: [{ filename: safeFile, content: pdfBuffer.toString("base64") }],
        tags: [
          { name: "agent", value: "jake" },
          { name: "kind", value: "report_to_chris" },
        ],
      });
    } catch (err: any) {
      return { ok: false, message: `send failed: ${err?.message ?? "unknown"}` };
    }

    console.log(`Jake emailed report "${title}" to ${CHRIS_REPORT_EMAIL}`);
    return { ok: true, message: `Emailed the "${title}" report to your inbox`, subject: title };
  } catch (err: any) {
    console.error("Jake report build failed:", err?.message);
    return { ok: false, message: err?.message ?? "report failed" };
  }
}
