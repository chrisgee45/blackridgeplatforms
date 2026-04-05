import type { Express, RequestHandler } from "express";
import { db } from "./db";
import { policies } from "@shared/schema";
import { eq, desc, ilike, or } from "drizzle-orm";
import { Resend } from "resend";
import { z } from "zod";

const VALID_STATUSES = ["draft", "published", "archived"] as const;
const VALID_CATEGORIES = ["general", "hr", "security", "operations", "compliance", "safety", "finance"] as const;

const createPolicySchema = z.object({
  title: z.string().min(1, "Title is required").max(500),
  category: z.enum(VALID_CATEGORIES).default("general"),
  content: z.string().max(100000).nullable().optional(),
  status: z.enum(VALID_STATUSES).default("draft"),
  effectiveDate: z.string().nullable().optional(),
  fileStorageKey: z.string().nullable().optional(),
  fileName: z.string().max(500).nullable().optional(),
  fileSize: z.number().int().positive().nullable().optional(),
});

const emailPolicySchema = z.object({
  recipients: z.array(z.string().email()).min(1, "At least one valid email required"),
  subject: z.string().max(500).optional(),
  message: z.string().max(5000).optional(),
});

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

async function getResendClient() {
  try {
    const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
    const xReplitToken = process.env.REPL_IDENTITY
      ? "repl " + process.env.REPL_IDENTITY
      : process.env.WEB_REPL_RENEWAL
      ? "depl " + process.env.WEB_REPL_RENEWAL
      : null;
    if (!xReplitToken || !hostname) return null;
    const connectionSettings = await fetch(
      "https://" + hostname + "/api/v2/connection?include_secrets=true&connector_names=resend",
      { headers: { Accept: "application/json", X_REPLIT_TOKEN: xReplitToken } }
    ).then((res) => res.json()).then((data) => data.items?.[0]);
    if (!connectionSettings || !connectionSettings.settings?.api_key) return null;
    return {
      client: new Resend(connectionSettings.settings.api_key),
      fromEmail: connectionSettings.settings.from_email,
    };
  } catch {
    return null;
  }
}

export function registerPolicyRoutes(app: Express, isAuthenticated: RequestHandler) {

  app.get("/api/policies", isAuthenticated, async (req, res) => {
    try {
      const { search, status, category } = req.query;
      let query = db.select().from(policies).orderBy(desc(policies.updatedAt));

      const conditions: any[] = [];
      if (status && status !== "all") {
        conditions.push(eq(policies.status, status as any));
      }
      if (category && category !== "all") {
        conditions.push(eq(policies.category, String(category)));
      }
      if (search) {
        conditions.push(
          or(
            ilike(policies.title, `%${search}%`),
            ilike(policies.content, `%${search}%`)
          )
        );
      }

      let result;
      if (conditions.length > 0) {
        const { and } = await import("drizzle-orm");
        result = await db.select().from(policies).where(and(...conditions)).orderBy(desc(policies.updatedAt));
      } else {
        result = await db.select().from(policies).orderBy(desc(policies.updatedAt));
      }

      res.json(result);
    } catch (error) {
      console.error("Fetch policies error:", error);
      res.status(500).json({ message: "Failed to fetch policies" });
    }
  });

  app.get("/api/policies/:id", isAuthenticated, async (req, res) => {
    try {
      const [policy] = await db.select().from(policies).where(eq(policies.id, req.params.id));
      if (!policy) return res.status(404).json({ message: "Policy not found" });
      res.json(policy);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch policy" });
    }
  });

  app.post("/api/policies", isAuthenticated, async (req, res) => {
    try {
      const parsed = createPolicySchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: parsed.error.errors[0]?.message || "Invalid input" });
      }
      const { title, category, content, status, effectiveDate, fileStorageKey, fileName, fileSize } = parsed.data;

      const [policy] = await db.insert(policies).values({
        title,
        category: category || "general",
        content: content || null,
        status: status || "draft",
        effectiveDate: effectiveDate ? new Date(effectiveDate) : null,
        fileStorageKey: fileStorageKey || null,
        fileName: fileName || null,
        fileSize: fileSize || null,
        createdBy: "admin",
      }).returning();

      res.status(201).json(policy);
    } catch (error) {
      console.error("Create policy error:", error);
      res.status(500).json({ message: "Failed to create policy" });
    }
  });

  app.patch("/api/policies/:id", isAuthenticated, async (req, res) => {
    try {
      const parsed = createPolicySchema.partial().safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: parsed.error.errors[0]?.message || "Invalid input" });
      }
      const { title, category, content, status, effectiveDate, fileStorageKey, fileName, fileSize } = parsed.data;
      const updates: any = { updatedAt: new Date() };

      if (title !== undefined) updates.title = title;
      if (category !== undefined) updates.category = category;
      if (content !== undefined) updates.content = content;
      if (status !== undefined) updates.status = status;
      if (effectiveDate !== undefined) updates.effectiveDate = effectiveDate ? new Date(effectiveDate) : null;
      if (fileStorageKey !== undefined) updates.fileStorageKey = fileStorageKey;
      if (fileName !== undefined) updates.fileName = fileName;
      if (fileSize !== undefined) updates.fileSize = fileSize;

      if (status === "published") {
        const [existing] = await db.select().from(policies).where(eq(policies.id, req.params.id));
        if (existing && existing.status !== "published") {
          updates.version = (existing.version || 1) + 1;
        }
      }

      const [updated] = await db.update(policies)
        .set(updates)
        .where(eq(policies.id, req.params.id))
        .returning();

      if (!updated) return res.status(404).json({ message: "Policy not found" });
      res.json(updated);
    } catch (error) {
      console.error("Update policy error:", error);
      res.status(500).json({ message: "Failed to update policy" });
    }
  });

  app.delete("/api/policies/:id", isAuthenticated, async (req, res) => {
    try {
      await db.delete(policies).where(eq(policies.id, req.params.id));
      res.json({ message: "Policy deleted" });
    } catch (error) {
      res.status(500).json({ message: "Failed to delete policy" });
    }
  });

  app.post("/api/policies/:id/email", isAuthenticated, async (req, res) => {
    try {
      const parsed = emailPolicySchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: parsed.error.errors[0]?.message || "Invalid input" });
      }
      const { recipients, subject, message } = parsed.data;

      const [policy] = await db.select().from(policies).where(eq(policies.id, req.params.id));
      if (!policy) return res.status(404).json({ message: "Policy not found" });

      const safeTitle = escapeHtml(policy.title);
      const safeCategory = escapeHtml(policy.category.replace(/_/g, " "));
      const safeContent = escapeHtml(policy.content || "");
      const safeMessage = message ? escapeHtml(message) : "";
      const safeFileName = policy.fileName ? escapeHtml(policy.fileName) : "";
      const emailSubject = subject || `Policy Document: ${policy.title}`;

      const htmlBody = `
        <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 680px; margin: 0 auto; background: #ffffff;">
          <div style="background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%); padding: 32px 40px; border-radius: 8px 8px 0 0;">
            <h1 style="color: #d4a843; margin: 0; font-size: 22px; font-weight: 700; letter-spacing: -0.5px;">BlackRidge Platforms</h1>
            <p style="color: #94a3b8; margin: 4px 0 0; font-size: 13px;">Policy &amp; Procedures</p>
          </div>
          <div style="padding: 32px 40px; border: 1px solid #e2e8f0; border-top: none; border-radius: 0 0 8px 8px;">
            ${safeMessage ? `<p style="color: #475569; font-size: 15px; line-height: 1.6; margin: 0 0 24px;">${safeMessage}</p>` : ""}
            <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 24px; margin-bottom: 24px;">
              <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 16px;">
                <span style="background: #0f172a; color: #d4a843; padding: 6px 12px; border-radius: 4px; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;">${safeCategory}</span>
                <span style="color: #94a3b8; font-size: 12px;">v${policy.version}</span>
              </div>
              <h2 style="color: #0f172a; margin: 0 0 12px; font-size: 20px; font-weight: 600;">${safeTitle}</h2>
              ${policy.effectiveDate ? `<p style="color: #64748b; font-size: 13px; margin: 0 0 16px;">Effective: ${new Date(policy.effectiveDate).toLocaleDateString()}</p>` : ""}
              <div style="color: #334155; font-size: 14px; line-height: 1.7; white-space: pre-wrap;">${safeContent}</div>
            </div>
            ${safeFileName ? `<p style="color: #64748b; font-size: 13px; margin: 16px 0 0;">&#128206; Attachment: ${safeFileName}</p>` : ""}
            <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 24px 0;" />
            <p style="color: #94a3b8; font-size: 12px; margin: 0; text-align: center;">
              BlackRidge Platforms &middot; Policy &amp; Procedures<br/>
              This document is confidential and intended for the recipient(s) only.
            </p>
          </div>
        </div>
      `;

      const resendClient = await getResendClient();
      if (!resendClient) {
        return res.status(500).json({ message: "Email service not configured" });
      }

      await resendClient.client.emails.send({
        from: resendClient.fromEmail || "BlackRidge Platforms <onboarding@resend.dev>",
        to: recipients,
        subject: emailSubject,
        html: htmlBody,
      });

      await db.update(policies)
        .set({ lastEmailedAt: new Date() })
        .where(eq(policies.id, req.params.id));

      res.json({ message: "Policy emailed successfully", recipientCount: recipients.length });
    } catch (error) {
      console.error("Email policy error:", error);
      res.status(500).json({ message: "Failed to email policy" });
    }
  });
}
