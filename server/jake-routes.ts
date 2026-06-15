import type { Express, RequestHandler } from "express";
import { db } from "./db";
import { sql } from "drizzle-orm";
import {
  enableJakeForProject,
  disableJakeForProject,
  handleJakeInbound,
  getProjectConversations,
  getClientJakeConversations,
  resolveHandoff,
} from "./jake";

/**
 * Idempotent schema additions so /api/jake/* can be deployed without
 * needing drizzle-kit push on the production DB.
 */
export async function ensureJakeSchema(): Promise<void> {
  await db.execute(sql`ALTER TABLE projects ADD COLUMN IF NOT EXISTS jake_enabled boolean NOT NULL DEFAULT false`);
  await db.execute(sql`ALTER TABLE projects ADD COLUMN IF NOT EXISTS jake_started_at timestamptz`);
  await db.execute(sql`ALTER TABLE projects ADD COLUMN IF NOT EXISTS jake_awaiting_handoff boolean NOT NULL DEFAULT false`);
  await db.execute(sql`ALTER TABLE projects ADD COLUMN IF NOT EXISTS jake_handoff_reason text`);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS project_conversations (
      id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
      project_id varchar NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      client_id varchar,
      direction text NOT NULL,
      from_email text,
      to_email text,
      subject text,
      body text NOT NULL,
      ai_generated boolean NOT NULL DEFAULT false,
      resend_message_id text,
      in_reply_to_message_id text,
      classification text,
      handoff_triggered boolean NOT NULL DEFAULT false,
      handoff_reason text,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS project_conversations_project_id_idx ON project_conversations (project_id)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS project_conversations_client_id_idx ON project_conversations (client_id)`);
}

export function registerJakeRoutes(app: Express, isAuthenticated: RequestHandler): void {
  app.post("/api/ops/projects/:id/jake/enable", isAuthenticated, async (req, res) => {
    try {
      const result = await enableJakeForProject(String(req.params.id));
      if (!result.ok) return res.status(400).json({ message: result.message });
      res.json({ ok: true, message: result.message });
    } catch (error: any) {
      console.error("Jake enable error:", error);
      res.status(500).json({ message: error?.message || "Failed to enable Jake" });
    }
  });

  app.post("/api/ops/projects/:id/jake/disable", isAuthenticated, async (req, res) => {
    try {
      await disableJakeForProject(String(req.params.id));
      res.json({ ok: true });
    } catch (error: any) {
      console.error("Jake disable error:", error);
      res.status(500).json({ message: error?.message || "Failed to disable Jake" });
    }
  });

  app.get("/api/ops/projects/:id/jake/conversations", isAuthenticated, async (req, res) => {
    try {
      const convs = await getProjectConversations(String(req.params.id));
      res.json(convs);
    } catch (error: any) {
      console.error("Get project conversations error:", error);
      res.status(500).json({ message: "Failed to fetch conversations" });
    }
  });

  app.get("/api/ops/clients/:id/jake/conversations", isAuthenticated, async (req, res) => {
    try {
      const convs = await getClientJakeConversations(String(req.params.id));
      res.json(convs);
    } catch (error: any) {
      console.error("Get client Jake conversations error:", error);
      res.status(500).json({ message: "Failed to fetch conversations" });
    }
  });

  app.post("/api/ops/projects/:id/jake/resolve-handoff", isAuthenticated, async (req, res) => {
    try {
      await resolveHandoff(String(req.params.id));
      res.json({ ok: true });
    } catch (error: any) {
      console.error("Jake resolve-handoff error:", error);
      res.status(500).json({ message: error?.message || "Failed to clear handoff" });
    }
  });

  // Public inbound webhook: Resend forwards email sent to jake@ here.
  // Uses a Jake-specific signing secret so it can coexist with the
  // outreach webhook (which has its own secret in RESEND_WEBHOOK_SECRET).
  // Falls back to RESEND_WEBHOOK_SECRET only when JAKE_RESEND_WEBHOOK_SECRET
  // isn't set, which is fine for dev environments where only one Resend
  // webhook exists.
  app.post("/api/jake/inbound", async (req, res) => {
    try {
      const webhookSecret = process.env.JAKE_RESEND_WEBHOOK_SECRET || process.env.RESEND_WEBHOOK_SECRET;
      if (webhookSecret) {
        const svixId = req.headers["svix-id"] as string;
        const svixTimestamp = req.headers["svix-timestamp"] as string;
        const svixSignature = req.headers["svix-signature"] as string;
        if (svixId && svixTimestamp && svixSignature) {
          try {
            const { Webhook } = await import("svix");
            const wh = new Webhook(webhookSecret);
            const rawBody = (req as any).rawBody;
            const bodyStr = rawBody
              ? (typeof rawBody === "string" ? rawBody : Buffer.isBuffer(rawBody) ? rawBody.toString("utf8") : JSON.stringify(req.body))
              : JSON.stringify(req.body);
            wh.verify(bodyStr, { "svix-id": svixId, "svix-timestamp": svixTimestamp, "svix-signature": svixSignature });
          } catch (verifyErr) {
            console.warn("Jake inbound webhook signature verification failed:", verifyErr);
            return res.status(401).json({ ok: false, message: "Invalid signature" });
          }
        }
      }
      // Resend webhook payloads wrap the message in either `data` or send
      // it at the top level depending on the event type. Accept both.
      const data = req.body?.data ?? req.body;
      const result = await handleJakeInbound(data);
      res.json(result);
    } catch (error: any) {
      console.error("Jake inbound error:", error);
      res.status(500).json({ ok: false });
    }
  });
}
