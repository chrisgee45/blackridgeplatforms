/**
 * Routes that expose the QA audit agent to the OPS UI.
 *   POST /api/ops/projects/:id/qa-audit/run   — kick off an audit
 *   GET  /api/ops/projects/:id/qa-audit/reports — list past reports
 *   GET  /api/ops/qa-audit/reports/:id          — one full report
 *   DELETE /api/ops/qa-audit/reports/:id        — remove a report
 */
import type { Express, RequestHandler } from "express";
import { db } from "./db";
import { qaAuditReports } from "@shared/schema";
import { eq, desc, sql } from "drizzle-orm";
import { runQaAudit } from "./qa-agent";

let schemaReady: Promise<void> | null = null;
async function ensureQaSchema(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS qa_audit_reports (
      id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
      project_id varchar NOT NULL REFERENCES projects(id),
      url text NOT NULL,
      status text NOT NULL DEFAULT 'queued',
      desktop_scores jsonb,
      mobile_scores jsonb,
      broken_links jsonb,
      security_headers jsonb,
      ai_review text,
      error_message text,
      created_at timestamptz DEFAULT now(),
      completed_at timestamptz
    )
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS qa_audit_reports_project_id_idx
      ON qa_audit_reports (project_id, created_at DESC)
  `);
}
function getSchemaReady(): Promise<void> {
  if (!schemaReady) {
    schemaReady = ensureQaSchema().catch(err => {
      console.error("QA schema error:", err);
      schemaReady = null;
      throw err;
    });
  }
  return schemaReady;
}

function normalizeUrl(raw: string): string | null {
  if (!raw) return null;
  try {
    const u = new URL(raw.startsWith("http") ? raw : `https://${raw}`);
    return u.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

export function registerQaAgentRoutes(app: Express, isAuthenticated: RequestHandler): void {
  app.post("/api/ops/projects/:id/qa-audit/run", isAuthenticated, async (req, res) => {
    try {
      await getSchemaReady();
      const url = normalizeUrl(req.body?.url ?? "");
      if (!url) return res.status(400).json({ message: "Valid url required" });

      const [report] = await db.insert(qaAuditReports).values({
        projectId: String(req.params.id),
        url,
        status: "queued",
      }).returning();

      // Fire and forget — the runner updates the row as it progresses.
      runQaAudit(report.id).catch(err => {
        console.error("[qa-agent] runner crashed:", err);
      });

      res.status(202).json(report);
    } catch (err: any) {
      console.error("QA run error:", err);
      res.status(500).json({ message: err?.message ?? "Failed to start audit" });
    }
  });

  app.get("/api/ops/projects/:id/qa-audit/reports", isAuthenticated, async (req, res) => {
    try {
      await getSchemaReady();
      const rows = await db
        .select()
        .from(qaAuditReports)
        .where(eq(qaAuditReports.projectId, String(req.params.id)))
        .orderBy(desc(qaAuditReports.createdAt));
      res.json(rows);
    } catch (err: any) {
      console.error("QA list error:", err);
      res.status(500).json({ message: err?.message ?? "Failed to load reports" });
    }
  });

  app.get("/api/ops/qa-audit/reports/:id", isAuthenticated, async (req, res) => {
    try {
      await getSchemaReady();
      const [row] = await db.select().from(qaAuditReports).where(eq(qaAuditReports.id, String(req.params.id)));
      if (!row) return res.status(404).json({ message: "Report not found" });
      res.json(row);
    } catch (err: any) {
      console.error("QA get error:", err);
      res.status(500).json({ message: err?.message ?? "Failed to load report" });
    }
  });

  app.delete("/api/ops/qa-audit/reports/:id", isAuthenticated, async (req, res) => {
    try {
      await db.delete(qaAuditReports).where(eq(qaAuditReports.id, String(req.params.id)));
      res.json({ ok: true });
    } catch (err: any) {
      console.error("QA delete error:", err);
      res.status(500).json({ message: err?.message ?? "Failed to delete report" });
    }
  });
}
