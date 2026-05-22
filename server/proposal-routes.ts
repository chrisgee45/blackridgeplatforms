import type { Express, RequestHandler } from "express";
import Anthropic from "@anthropic-ai/sdk";
import { db } from "./db";
import { proposals, contactSubmissions, leadActivities } from "@shared/schema";
import { eq, desc } from "drizzle-orm";
import { getResendClient, buildEmailSignatureHtml, buildEmailSignatureText } from "./email";

const SYSTEM_PROMPT = `You are a senior proposal writer for BlackRidge Platforms, a web design and development studio that builds high-converting websites, client portals, CRMs and AI systems for small and mid-sized businesses.

Write a complete, client-ready website proposal. It should feel personal, confident and benefit-focused, as if written by an experienced consultant who genuinely understands this client's business. Never generic, never templated.

Format using simple markdown only:
- "## " for section headings
- "**bold**" for emphasis
- "- " for bullet points
- blank lines between paragraphs

Do not use any other markdown. Never use em dashes anywhere; use periods, commas, or the word "to" instead.

Use exactly these sections in this order:
## A warm one-line opener that addresses the client by first name
## Understanding Your Goals
## What We'll Build
## Timeline
## Investment
## Why BlackRidge
## Next Steps

Guidance:
- "Understanding Your Goals": two to four sentences that show you grasp their situation and what they want.
- "What We'll Build": concrete deliverables as a bulleted list.
- "Timeline": a realistic phased timeline (discovery, design, build, launch).
- "Investment": if a budget is provided, base the figure on it; otherwise give a clear price and note it can be tailored to scope.
- "Why BlackRidge": three short, specific reasons.
- "Next Steps": one clear, low-friction call to action.

Keep it concise and skimmable. No filler. Write in second person to the client. Return only the proposal markdown, nothing else.`;

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function inlineMd(s: string): string {
  return escapeHtml(s).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
}

/** Converts the constrained proposal markdown to email-safe HTML. */
function proposalToHtml(md: string): string {
  const lines = md.split("\n");
  const out: string[] = [];
  let inList = false;
  const closeList = () => { if (inList) { out.push("</ul>"); inList = false; } };
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (line.startsWith("## ")) {
      closeList();
      out.push(`<h2 style="font-size:15px;font-weight:bold;color:#bd8b22;margin:22px 0 8px;">${inlineMd(line.slice(3))}</h2>`);
    } else if (line.startsWith("### ")) {
      closeList();
      out.push(`<h3 style="font-size:13px;font-weight:bold;color:#1a1a1a;margin:16px 0 6px;">${inlineMd(line.slice(4))}</h3>`);
    } else if (line.startsWith("- ")) {
      if (!inList) { out.push(`<ul style="margin:6px 0;padding-left:20px;">`); inList = true; }
      out.push(`<li style="margin:3px 0;">${inlineMd(line.slice(2))}</li>`);
    } else if (line.trim() === "") {
      closeList();
    } else {
      closeList();
      out.push(`<p style="margin:8px 0;">${inlineMd(line)}</p>`);
    }
  }
  closeList();
  return out.join("\n");
}

export function registerProposalRoutes(app: Express, isAuthenticated: RequestHandler) {
  app.get("/api/leads/:id/proposals", isAuthenticated, async (req, res) => {
    try {
      const rows = await db
        .select()
        .from(proposals)
        .where(eq(proposals.leadId, String(req.params.id)))
        .orderBy(desc(proposals.createdAt));
      res.json(rows);
    } catch (error: any) {
      console.error("Fetch proposals error:", error);
      res.status(500).json({ message: "Failed to fetch proposals" });
    }
  });

  app.post("/api/leads/:id/proposal/generate", isAuthenticated, async (req, res) => {
    try {
      const leadId = String(req.params.id);
      const [lead] = await db.select().from(contactSubmissions).where(eq(contactSubmissions.id, leadId)).limit(1);
      if (!lead) return res.status(404).json({ message: "Lead not found" });

      const apiKey = process.env.ANTHROPIC_API_KEY;
      if (!apiKey) return res.status(500).json({ message: "AI is not configured (set ANTHROPIC_API_KEY)" });

      const activities = await db
        .select()
        .from(leadActivities)
        .where(eq(leadActivities.leadId, leadId))
        .orderBy(desc(leadActivities.createdAt))
        .limit(8);

      const activitySummary = activities.length
        ? activities.map((a) => `- ${a.type}: ${a.description}`).join("\n")
        : "None recorded yet.";

      const userPrompt = [
        "Write a website proposal for this prospect.",
        "",
        `Contact name: ${lead.name}`,
        `Company: ${lead.company || "Not provided"}`,
        `Current website: ${lead.website || "None / not provided"}`,
        `Project type: ${lead.projectType || "Website"}`,
        `Stated budget: ${lead.budget || "Not provided"}`,
        `Estimated project value: ${lead.projectedValue != null ? "$" + lead.projectedValue : "Not provided"}`,
        "",
        `What they told us: ${lead.message || "Nothing specific."}`,
        `Internal notes: ${lead.notes || "None."}`,
        "",
        "Recent activity with this lead:",
        activitySummary,
        "",
        `Today's date: ${new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}`,
      ].join("\n");

      const anthropic = new Anthropic({ apiKey });
      const response = await anthropic.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 3000,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: userPrompt }],
      });

      const content = response.content[0]?.type === "text" ? response.content[0].text.trim() : "";
      if (!content) return res.status(502).json({ message: "AI returned an empty proposal. Try again." });

      const [proposal] = await db
        .insert(proposals)
        .values({
          leadId,
          title: `Website Proposal for ${lead.company || lead.name}`,
          content,
          amount: lead.projectedValue ?? null,
          status: "draft",
        })
        .returning();

      res.status(201).json(proposal);
    } catch (error: any) {
      console.error("Generate proposal error:", error);
      res.status(500).json({ message: `Failed to generate proposal: ${error?.message || "unknown error"}` });
    }
  });

  app.patch("/api/proposals/:id", isAuthenticated, async (req, res) => {
    try {
      const updates: Record<string, unknown> = { updatedAt: new Date() };
      if (typeof req.body?.title === "string" && req.body.title.trim()) updates.title = req.body.title.trim();
      if (typeof req.body?.content === "string" && req.body.content.trim()) updates.content = req.body.content;
      if (["draft", "sent", "accepted", "declined"].includes(req.body?.status)) updates.status = req.body.status;
      if (req.body?.amount !== undefined) {
        const n = req.body.amount === null || req.body.amount === "" ? null : Number(req.body.amount);
        updates.amount = n != null && !isNaN(n) ? Math.round(n) : null;
      }
      const [proposal] = await db.update(proposals).set(updates).where(eq(proposals.id, String(req.params.id))).returning();
      if (!proposal) return res.status(404).json({ message: "Proposal not found" });
      res.json(proposal);
    } catch (error: any) {
      console.error("Update proposal error:", error);
      res.status(500).json({ message: `Failed to update proposal: ${error?.message || "unknown error"}` });
    }
  });

  app.delete("/api/proposals/:id", isAuthenticated, async (req, res) => {
    try {
      const [deleted] = await db.delete(proposals).where(eq(proposals.id, String(req.params.id))).returning();
      if (!deleted) return res.status(404).json({ message: "Proposal not found" });
      res.json({ success: true });
    } catch (error: any) {
      console.error("Delete proposal error:", error);
      res.status(500).json({ message: "Failed to delete proposal" });
    }
  });

  app.post("/api/proposals/:id/send", isAuthenticated, async (req, res) => {
    try {
      const [proposal] = await db.select().from(proposals).where(eq(proposals.id, String(req.params.id))).limit(1);
      if (!proposal) return res.status(404).json({ message: "Proposal not found" });
      const [lead] = await db.select().from(contactSubmissions).where(eq(contactSubmissions.id, proposal.leadId)).limit(1);
      if (!lead) return res.status(404).json({ message: "Lead not found" });

      const resend = getResendClient();
      if (!resend) return res.status(500).json({ message: "Email service not configured. Set RESEND_API_KEY." });

      const logoBlock = `<div style="background-color:#0d0d0d;padding:18px 22px;text-align:center;border-radius:8px;">
        <img src="https://www.blackridgeplatforms.com/blackridge-logo.png" alt="BlackRidge Platforms" width="170" style="display:inline-block;border:0;" />
      </div>`;
      const html = `<div style="font-family:-apple-system,Segoe UI,sans-serif;font-size:14px;line-height:1.6;color:#1e293b;max-width:640px;">
        ${logoBlock}
        <div style="padding:8px 4px;">${proposalToHtml(proposal.content)}</div>
        ${buildEmailSignatureHtml()}
      </div>`;

      await resend.client.emails.send({
        from: resend.fromEmail,
        to: [lead.email],
        subject: proposal.title,
        html,
        text: `${proposal.content}\n\n${buildEmailSignatureText()}`,
      });

      const [updated] = await db
        .update(proposals)
        .set({ status: "sent", sentAt: new Date(), updatedAt: new Date() })
        .where(eq(proposals.id, proposal.id))
        .returning();

      res.json(updated);
    } catch (error: any) {
      console.error("Send proposal error:", error);
      res.status(500).json({ message: `Failed to send proposal: ${error?.message || "unknown error"}` });
    }
  });
}
