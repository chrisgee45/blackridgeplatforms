import type { Express, RequestHandler } from "express";
import { db } from "./db";
import {
  proposalAssets,
  contactSubmissions,
  leadActivities,
  outreachLeads,
  type ProposalAsset,
} from "@shared/schema";
import { eq, desc } from "drizzle-orm";
import { getResendClient, buildEmailSignatureHtml, buildEmailSignatureText } from "./email";
import { ObjectStorageService, ObjectNotFoundError } from "./object-storage";

const objectStorage = new ObjectStorageService();

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Render a short, optional cover note (plain text) as email-safe paragraphs. */
function coverNoteToHtml(note: string): string {
  return note
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:8px 0;">${escapeHtml(p).replace(/\n/g, "<br>")}</p>`)
    .join("\n");
}

export interface SendProposalAssetResult {
  toEmail: string;
  fileName: string;
  resendMessageId?: string;
}

/**
 * Email an uploaded proposal asset to a recipient with the file attached.
 * Shared by the manual "Send" routes (CRM + outreach) and the outreach AI
 * agent's SEND_PROPOSAL action. Throws on any failure so callers can
 * surface a clear message.
 */
export async function sendProposalAssetEmail(
  asset: ProposalAsset,
  opts: { toEmail: string; toName?: string | null; subject?: string; message?: string },
): Promise<SendProposalAssetResult> {
  const toEmail = (opts.toEmail || "").trim();
  if (!toEmail) throw new Error("Recipient has no email address on file");

  const resend = getResendClient();
  if (!resend) throw new Error("Email service not configured. Set RESEND_API_KEY.");

  let buffer: Buffer;
  try {
    buffer = await objectStorage.readObjectBuffer(asset.storageKey);
  } catch (err) {
    if (err instanceof ObjectNotFoundError) {
      throw new Error("The uploaded proposal file is missing from storage. Re-upload it and try again.");
    }
    throw err;
  }

  const firstName = (opts.toName || "").trim().split(/\s+/)[0] || "there";
  const subject = (opts.subject || "").trim() || asset.name || "Your proposal from BlackRidge Platforms";
  const defaultNote = `Hi ${firstName},\n\nPlease find your proposal attached. I'd love to hear your thoughts, and I'm happy to jump on a quick call to walk through it.`;
  const note = (opts.message || "").trim() || defaultNote;

  const logoBlock = `<div style="background-color:#0d0d0d;padding:18px 22px;text-align:center;border-radius:8px;">
    <img src="https://www.blackridgeplatforms.com/blackridge-logo.png" alt="BlackRidge Platforms" width="170" style="display:inline-block;border:0;" />
  </div>`;
  const html = `<div style="font-family:-apple-system,Segoe UI,sans-serif;font-size:14px;line-height:1.6;color:#1e293b;max-width:640px;">
    ${logoBlock}
    <div style="padding:8px 4px;">${coverNoteToHtml(note)}</div>
    ${buildEmailSignatureHtml()}
  </div>`;

  const { data, error } = await resend.client.emails.send({
    from: resend.fromEmail,
    to: [toEmail],
    subject,
    html,
    text: `${note}\n\n${buildEmailSignatureText()}`,
    attachments: [{ filename: asset.fileName, content: buffer.toString("base64") }],
  });

  if (error) throw new Error(error.message || "Email provider rejected the message");

  return { toEmail, fileName: asset.fileName, resendMessageId: (data as any)?.id };
}

export function registerProposalAssetRoutes(app: Express, isAuthenticated: RequestHandler) {
  // List the proposal library.
  app.get("/api/proposal-assets", isAuthenticated, async (_req, res) => {
    try {
      const rows = await db.select().from(proposalAssets).orderBy(desc(proposalAssets.createdAt));
      res.json(rows);
    } catch (error: any) {
      console.error("Fetch proposal assets error:", error);
      res.status(500).json({ message: "Failed to fetch proposals" });
    }
  });

  // Register an uploaded file as a reusable proposal. The browser uploads
  // the bytes through /api/uploads first, then posts the metadata here.
  app.post("/api/proposal-assets", isAuthenticated, async (req, res) => {
    try {
      const { name, description, fileName, fileType, fileSize } = req.body || {};
      const rawKey = String(req.body?.storageKey || req.body?.uploadURL || "").trim();
      if (!rawKey) return res.status(400).json({ message: "Missing uploaded file reference" });
      if (!fileName) return res.status(400).json({ message: "Missing file name" });

      const storageKey = objectStorage.normalizeObjectEntityPath(rawKey);
      const cleanName = String(name || "").trim() || String(fileName).trim();

      const [asset] = await db
        .insert(proposalAssets)
        .values({
          name: cleanName,
          description: typeof description === "string" && description.trim() ? description.trim() : null,
          storageKey,
          fileName: String(fileName).trim(),
          fileType: typeof fileType === "string" ? fileType : null,
          fileSize: fileSize != null && !isNaN(Number(fileSize)) ? Math.round(Number(fileSize)) : null,
        })
        .returning();

      res.status(201).json(asset);
    } catch (error: any) {
      console.error("Create proposal asset error:", error);
      res.status(500).json({ message: `Failed to save proposal: ${error?.message || "unknown error"}` });
    }
  });

  app.patch("/api/proposal-assets/:id", isAuthenticated, async (req, res) => {
    try {
      const updates: Record<string, unknown> = { updatedAt: new Date() };
      if (typeof req.body?.name === "string" && req.body.name.trim()) updates.name = req.body.name.trim();
      if (typeof req.body?.description === "string") {
        updates.description = req.body.description.trim() || null;
      }
      const [asset] = await db
        .update(proposalAssets)
        .set(updates)
        .where(eq(proposalAssets.id, String(req.params.id)))
        .returning();
      if (!asset) return res.status(404).json({ message: "Proposal not found" });
      res.json(asset);
    } catch (error: any) {
      console.error("Update proposal asset error:", error);
      res.status(500).json({ message: `Failed to update proposal: ${error?.message || "unknown error"}` });
    }
  });

  app.delete("/api/proposal-assets/:id", isAuthenticated, async (req, res) => {
    try {
      const [deleted] = await db
        .delete(proposalAssets)
        .where(eq(proposalAssets.id, String(req.params.id)))
        .returning();
      if (!deleted) return res.status(404).json({ message: "Proposal not found" });
      res.json({ success: true });
    } catch (error: any) {
      console.error("Delete proposal asset error:", error);
      res.status(500).json({ message: "Failed to delete proposal" });
    }
  });

  // Send an uploaded proposal to a lead (CRM or outreach) as an attachment.
  app.post("/api/proposal-assets/:id/send", isAuthenticated, async (req, res) => {
    try {
      const [asset] = await db
        .select()
        .from(proposalAssets)
        .where(eq(proposalAssets.id, String(req.params.id)))
        .limit(1);
      if (!asset) return res.status(404).json({ message: "Proposal not found" });

      const leadType = req.body?.leadType === "outreach" ? "outreach" : "crm";
      const leadId = String(req.body?.leadId || "").trim();
      const subject = typeof req.body?.subject === "string" ? req.body.subject : undefined;
      const message = typeof req.body?.message === "string" ? req.body.message : undefined;

      let toEmail = "";
      let toName: string | null = null;

      if (leadType === "outreach") {
        if (!leadId) return res.status(400).json({ message: "leadId is required" });
        const [lead] = await db.select().from(outreachLeads).where(eq(outreachLeads.id, leadId)).limit(1);
        if (!lead) return res.status(404).json({ message: "Lead not found" });
        toEmail = lead.email || "";
        toName = lead.contactName || lead.businessName || null;
      } else {
        if (!leadId) return res.status(400).json({ message: "leadId is required" });
        const [lead] = await db
          .select()
          .from(contactSubmissions)
          .where(eq(contactSubmissions.id, leadId))
          .limit(1);
        if (!lead) return res.status(404).json({ message: "Lead not found" });
        toEmail = lead.email || "";
        toName = lead.name || null;
      }

      const result = await sendProposalAssetEmail(asset, { toEmail, toName, subject, message });

      // Log the send so it shows up in the lead's history.
      try {
        if (leadType === "outreach") {
          const { outreachStorage } = await import("./outreach-storage");
          await outreachStorage.createConversation({
            leadId,
            direction: "outbound",
            subject: subject || asset.name,
            body: `Sent proposal "${asset.name}" (${asset.fileName}) as an attachment.`,
            resendMessageId: result.resendMessageId,
          });
        } else {
          await db.insert(leadActivities).values({
            leadId,
            type: "proposal_sent",
            description: `Sent proposal "${asset.name}" (${asset.fileName}) to ${result.toEmail}`,
            metadata: { proposalAssetId: asset.id },
          });
        }
      } catch (logErr) {
        console.error("Failed to log proposal send:", logErr);
      }

      res.json({ success: true, ...result });
    } catch (error: any) {
      console.error("Send proposal asset error:", error);
      res.status(500).json({ message: `Failed to send proposal: ${error?.message || "unknown error"}` });
    }
  });
}
