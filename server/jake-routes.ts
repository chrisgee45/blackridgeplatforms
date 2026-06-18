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
  relayHandoffAnswer,
  buildJakeDailyReport,
  runMaintenanceCadence,
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

  // Chris typed an answer in the handoff banner; Jake relays it to the
  // client in his voice and clears the handoff.
  app.post("/api/ops/projects/:id/jake/relay-handoff", isAuthenticated, async (req, res) => {
    try {
      const answer = typeof req.body?.answer === "string" ? req.body.answer.trim() : "";
      if (!answer) return res.status(400).json({ message: "answer is required" });
      const result = await relayHandoffAnswer(String(req.params.id), answer);
      if (!result.ok) return res.status(400).json({ message: result.message ?? "Relay failed" });
      res.json({ ok: true, message: result.message });
    } catch (error: any) {
      console.error("Jake relay-handoff error:", error);
      res.status(500).json({ message: error?.message || "Failed to relay handoff" });
    }
  });

  app.get("/api/ops/jake/report", isAuthenticated, async (req, res) => {
    try {
      const hours = req.query.hours ? Math.max(1, Math.min(168, Number(req.query.hours))) : 24;
      const report = await buildJakeDailyReport(hours);
      res.json(report);
    } catch (error: any) {
      console.error("Jake report error:", error);
      res.status(500).json({ message: error?.message || "Failed to build report" });
    }
  });

  app.post("/api/ops/jake/run-cadence", isAuthenticated, async (_req, res) => {
    try {
      const result = await runMaintenanceCadence();
      res.json({ ok: true, ...result });
    } catch (error: any) {
      console.error("Jake cadence trigger error:", error);
      res.status(500).json({ message: error?.message || "Failed to run cadence" });
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

  // Replay a past inbound email through the fixed handler. Lets Chris
  // re-process attachments that were silently dropped by older code
  // without asking the client to forward the message again. Pass the
  // original Resend webhook payload body (the `data` object from the
  // email.received event) and Jake's handler runs it as if it just
  // arrived.
  app.post("/api/ops/jake/replay-inbound", isAuthenticated, async (req, res) => {
    try {
      const { handleJakeInbound } = await import("./jake");
      const payload = req.body?.data ?? req.body;
      if (!payload || typeof payload !== "object") {
        return res.status(400).json({ message: "Pass the original webhook payload as the request body" });
      }
      const result = await handleJakeInbound(payload);
      res.json(result);
    } catch (err: any) {
      console.error("Jake replay error:", err);
      res.status(500).json({ message: err?.message ?? "Replay failed" });
    }
  });
}
