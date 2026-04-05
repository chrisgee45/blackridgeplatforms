import type { Express, RequestHandler } from "express";
import { db } from "./db";
import { kickoffSubmissions, projects, contacts, companies } from "@shared/schema";
import { eq } from "drizzle-orm";
import { z } from "zod";
import crypto from "crypto";
import { getResendClient } from "./email";
import { getAppUrl } from "./app-url";

function getBaseUrl(req: any): string {
  const proto = req.headers["x-forwarded-proto"] || req.protocol || "https";
  const host = req.headers["x-forwarded-host"] || req.headers["host"];
  if (host && !host.includes("localhost") && !host.includes("127.0.0.1")) {
    return `${proto}://${host}`;
  }
  return getAppUrl();
}

export function registerKickoffRoutes(app: Express, isAuthenticated: RequestHandler) {
  app.get("/api/ops/projects/:projectId/kickoff", isAuthenticated, async (req, res) => {
    try {
      const rows = await db.select().from(kickoffSubmissions)
        .where(eq(kickoffSubmissions.projectId, req.params.projectId));
      res.json(rows[0] || null);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  const sendKickoffSchema = z.object({
    clientName: z.string().min(1),
    clientEmail: z.string().email(),
    companyName: z.string().optional(),
  });

  app.post("/api/ops/projects/:projectId/kickoff/send", isAuthenticated, async (req, res) => {
    try {
      const body = sendKickoffSchema.parse(req.body);
      const projectId = req.params.projectId;

      const existing = await db.select().from(kickoffSubmissions)
        .where(eq(kickoffSubmissions.projectId, projectId));
      if (existing.length > 0) {
        return res.status(400).json({ error: "Kickoff already sent for this project" });
      }

      const proj = await db.select().from(projects).where(eq(projects.id, projectId));
      if (!proj.length) return res.status(404).json({ error: "Project not found" });

      const token = crypto.randomUUID();
      const baseUrl = getBaseUrl(req);
      const formUrl = `${baseUrl}/kickoff/${token}`;

      const [submission] = await db.insert(kickoffSubmissions).values({
        projectId,
        clientName: body.clientName,
        clientEmail: body.clientEmail,
        companyName: body.companyName || null,
        token,
        status: "sent",
        sentAt: new Date(),
      }).returning();

      let emailSent = false;
      const resend = getResendClient();
      if (resend) {
        try {
          await resend.client.emails.send({
            from: resend.fromEmail || "BlackRidge Platforms <onboarding@resend.dev>",
            to: body.clientEmail,
            subject: "Let's Get Started — Your BlackRidge Kickoff Form",
            html: `
              <div style="font-family: 'Helvetica Neue', Arial, sans-serif; background: #0A0A0A; color: #ffffff; padding: 40px 20px;">
                <div style="max-width: 600px; margin: 0 auto;">
                  <div style="text-align: center; padding: 20px 0; border-bottom: 1px solid #222;">
                    <h1 style="font-size: 24px; font-weight: 700; margin: 0; letter-spacing: 2px;">BLACKRIDGE</h1>
                    <p style="color: #C9A840; font-size: 12px; letter-spacing: 3px; margin: 4px 0 0;">PLATFORMS</p>
                  </div>
                  <div style="padding: 40px 0;">
                    <p style="font-size: 18px; margin-bottom: 20px;">Hey ${body.clientName},</p>
                    <p style="font-size: 16px; line-height: 1.7; color: #ccc;">You're in. Before I start building I need to get inside your world a little — this form covers everything from brand to features to timeline. Takes about 10 minutes. The more detail you give me the better this turns out.</p>
                    <div style="text-align: center; padding: 30px 0;">
                      <a href="${formUrl}" style="background: #C9A840; color: #000; padding: 16px 40px; text-decoration: none; font-weight: 700; font-size: 16px; border-radius: 4px; display: inline-block;">START YOUR KICKOFF FORM</a>
                    </div>
                    <p style="font-size: 14px; color: #888; text-align: center;">This link is unique to your project — do not share it.</p>
                  </div>
                  <div style="border-top: 1px solid #222; padding-top: 20px; text-align: center;">
                    <p style="color: #888; font-size: 14px; margin: 0;">Chris | BlackRidge Platforms</p>
                    <p style="color: #666; font-size: 12px; margin: 4px 0 0;">chris@blackridgeplatforms.com</p>
                  </div>
                </div>
              </div>
            `,
          });
          emailSent = true;
        } catch (emailErr) {
          console.error("Kickoff email send failed:", emailErr);
        }
      }

      res.json({ ...submission, emailSent });
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  app.post("/api/ops/projects/:projectId/kickoff/resend", isAuthenticated, async (req, res) => {
    try {
      const rows = await db.select().from(kickoffSubmissions)
        .where(eq(kickoffSubmissions.projectId, req.params.projectId));
      if (!rows.length) return res.status(404).json({ error: "No kickoff found" });
      const submission = rows[0];
      if (submission.status === "submitted") return res.status(400).json({ error: "Already submitted" });

      const baseUrl = getBaseUrl(req);
      const formUrl = `${baseUrl}/kickoff/${submission.token}`;

      const resend = getResendClient();
      if (resend) {
        await resend.client.emails.send({
          from: resend.fromEmail || "BlackRidge Platforms <onboarding@resend.dev>",
          to: submission.clientEmail,
          subject: "Reminder — Your BlackRidge Kickoff Form",
          html: `
            <div style="font-family: 'Helvetica Neue', Arial, sans-serif; background: #0A0A0A; color: #ffffff; padding: 40px 20px;">
              <div style="max-width: 600px; margin: 0 auto;">
                <div style="text-align: center; padding: 20px 0; border-bottom: 1px solid #222;">
                  <h1 style="font-size: 24px; font-weight: 700; margin: 0; letter-spacing: 2px;">BLACKRIDGE</h1>
                  <p style="color: #C9A840; font-size: 12px; letter-spacing: 3px; margin: 4px 0 0;">PLATFORMS</p>
                </div>
                <div style="padding: 40px 0;">
                  <p style="font-size: 18px; margin-bottom: 20px;">Hey ${submission.clientName},</p>
                  <p style="font-size: 16px; line-height: 1.7; color: #ccc;">Quick follow-up — I still need your kickoff form completed so I can get started on your project. Just click below whenever you're ready.</p>
                  <div style="text-align: center; padding: 30px 0;">
                    <a href="${formUrl}" style="background: #C9A840; color: #000; padding: 16px 40px; text-decoration: none; font-weight: 700; font-size: 16px; border-radius: 4px; display: inline-block;">COMPLETE YOUR KICKOFF FORM</a>
                  </div>
                </div>
                <div style="border-top: 1px solid #222; padding-top: 20px; text-align: center;">
                  <p style="color: #888; font-size: 14px; margin: 0;">Chris | BlackRidge Platforms</p>
                </div>
              </div>
            </div>
          `,
        });
      }

      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.patch("/api/ops/projects/:projectId/kickoff/notes", isAuthenticated, async (req, res) => {
    try {
      const { notes } = req.body;
      const rows = await db.select().from(kickoffSubmissions)
        .where(eq(kickoffSubmissions.projectId, req.params.projectId));
      if (!rows.length) return res.status(404).json({ error: "No kickoff found" });

      const [updated] = await db.update(kickoffSubmissions)
        .set({ notes })
        .where(eq(kickoffSubmissions.id, rows[0].id))
        .returning();
      res.json(updated);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/kickoff/:token", async (req, res) => {
    try {
      const rows = await db.select().from(kickoffSubmissions)
        .where(eq(kickoffSubmissions.token, req.params.token));
      if (!rows.length) return res.status(404).json({ error: "Invalid or expired kickoff link." });
      const submission = rows[0];
      if (submission.status === "submitted") {
        return res.status(400).json({ error: "This kickoff form has already been submitted." });
      }

      if (submission.status === "sent") {
        await db.update(kickoffSubmissions)
          .set({ status: "opened" })
          .where(eq(kickoffSubmissions.id, submission.id));
      }

      const proj = await db.select().from(projects).where(eq(projects.id, submission.projectId));
      res.json({
        clientName: submission.clientName,
        clientEmail: submission.clientEmail,
        companyName: submission.companyName,
        projectName: proj[0]?.name || "Your Project",
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/kickoff/:token/submit", async (req, res) => {
    try {
      const rows = await db.select().from(kickoffSubmissions)
        .where(eq(kickoffSubmissions.token, req.params.token));
      if (!rows.length) return res.status(404).json({ error: "Invalid kickoff link." });
      const submission = rows[0];
      if (submission.status === "submitted") {
        return res.status(400).json({ error: "Already submitted." });
      }

      const { responses, uploadedFiles, acknowledged } = req.body;

      if (!responses || typeof responses !== "object") {
        return res.status(400).json({ error: "Form responses are required." });
      }
      if (acknowledged === false) {
        return res.status(400).json({ error: "You must acknowledge the terms to submit." });
      }

      const [updated] = await db.update(kickoffSubmissions).set({
        responses,
        uploadedFiles: Array.isArray(uploadedFiles) ? uploadedFiles.slice(0, 50) : [],
        signatureAcknowledged: true,
        status: "submitted",
        submittedAt: new Date(),
      }).where(eq(kickoffSubmissions.id, submission.id)).returning();

      const proj = await db.select().from(projects).where(eq(projects.id, submission.projectId));
      const projectName = proj[0]?.name || "Unknown Project";

      const resend = getResendClient();
      if (resend) {
        await resend.client.emails.send({
          from: resend.fromEmail || "BlackRidge Platforms <onboarding@resend.dev>",
          to: submission.clientEmail,
          subject: "Kickoff Form Received — BlackRidge Platforms",
          html: `
            <div style="font-family: 'Helvetica Neue', Arial, sans-serif; background: #0A0A0A; color: #ffffff; padding: 40px 20px;">
              <div style="max-width: 600px; margin: 0 auto;">
                <div style="text-align: center; padding: 20px 0; border-bottom: 1px solid #222;">
                  <h1 style="font-size: 24px; font-weight: 700; margin: 0; letter-spacing: 2px;">BLACKRIDGE</h1>
                  <p style="color: #C9A840; font-size: 12px; letter-spacing: 3px; margin: 4px 0 0;">PLATFORMS</p>
                </div>
                <div style="padding: 40px 0; text-align: center;">
                  <p style="font-size: 20px; font-weight: 600; margin-bottom: 16px;">Got it. You're locked in.</p>
                  <p style="font-size: 16px; line-height: 1.7; color: #ccc;">I'll review everything and reach out within 1 business day with next steps. Let's build something great.</p>
                  <p style="font-size: 16px; color: #C9A840; margin-top: 24px; font-weight: 600;">— Chris, BlackRidge Platforms</p>
                </div>
              </div>
            </div>
          `,
        });

        const baseUrl = getBaseUrl(req);

        await resend.client.emails.send({
          from: resend.fromEmail || "BlackRidge Platforms <onboarding@resend.dev>",
          to: "chris@blackridgeplatforms.com",
          subject: `Kickoff Form Submitted — ${submission.companyName || submission.clientName} | ${projectName}`,
          html: `
            <div style="font-family: Arial, sans-serif; padding: 20px;">
              <h2>Kickoff Form Submitted</h2>
              <p><strong>Client:</strong> ${submission.clientName}</p>
              <p><strong>Company:</strong> ${submission.companyName || "N/A"}</p>
              <p><strong>Email:</strong> ${submission.clientEmail}</p>
              <p><strong>Project:</strong> ${projectName}</p>
              <p><strong>Submitted:</strong> ${new Date().toLocaleString()}</p>
              <p><a href="${baseUrl}/admin/ops/projects/${submission.projectId}" style="background: #C9A840; color: #000; padding: 10px 20px; text-decoration: none; font-weight: 700; border-radius: 4px; display: inline-block; margin-top: 12px;">View in Portal</a></p>
            </div>
          `,
        });
      }

      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/kickoff/:token/upload", async (req, res) => {
    try {
      const rows = await db.select().from(kickoffSubmissions)
        .where(eq(kickoffSubmissions.token, req.params.token));
      if (!rows.length) return res.status(404).json({ error: "Invalid kickoff link." });
      if (rows[0].status === "submitted") return res.status(400).json({ error: "Already submitted." });
      res.json({ token: req.params.token });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });
}
