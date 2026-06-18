/**
 * External API surface. Read-only endpoints scoped for the MCP/Claude
 * connector. Authenticated by a static bearer token (env-supplied) so
 * machine clients can reach BlackRidge without holding a session cookie.
 *
 * Endpoints exposed:
 *   GET /api/external/projects             — list all projects
 *   GET /api/external/projects/:id         — one project with related tasks + milestones
 *   GET /api/external/calendar?from&to     — unified calendar feed
 *                                            (project due dates, milestones,
 *                                             scheduled followups, payment dues)
 *
 * Auth: Authorization: Bearer <key>
 *   Accepted keys are the comma-separated values of BLACKRIDGE_API_KEYS,
 *   falling back to a single BLACKRIDGE_API_KEY. If neither is set the
 *   external API is disabled entirely (every request 503s) — fail closed.
 */
import type { Express, Request, Response, NextFunction } from "express";
import { db } from "./db";
import {
  projects, tasks, milestones, scheduledFollowups, projectPayments,
} from "@shared/schema";
import { eq, desc, gte, lte, and, or, isNotNull } from "drizzle-orm";
import { timingSafeEqual } from "node:crypto";

function loadAcceptedKeys(): string[] {
  const list = process.env.BLACKRIDGE_API_KEYS;
  if (list) {
    return list.split(",").map(k => k.trim()).filter(Boolean);
  }
  const single = process.env.BLACKRIDGE_API_KEY;
  return single ? [single.trim()] : [];
}

function constantTimeEquals(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

function externalApiAuth(req: Request, res: Response, next: NextFunction) {
  const accepted = loadAcceptedKeys();
  if (accepted.length === 0) {
    return res.status(503).json({ error: "External API not configured (set BLACKRIDGE_API_KEY)" });
  }
  const header = req.headers.authorization ?? "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) return res.status(401).json({ error: "Missing bearer token" });
  const presented = match[1].trim();
  for (const k of accepted) {
    if (constantTimeEquals(presented, k)) return next();
  }
  return res.status(401).json({ error: "Invalid bearer token" });
}

function parseDateParam(v: unknown, fallback: Date): Date {
  if (typeof v !== "string" || !v) return fallback;
  const d = new Date(v);
  return Number.isFinite(d.getTime()) ? d : fallback;
}

export function registerExternalApiRoutes(app: Express): void {
  // Health probe — doesn't reveal whether the API is configured, just
  // confirms the prefix is mounted. Used by MCP clients during setup.
  app.get("/api/external/health", (_req, res) => {
    res.json({ ok: true, name: "blackridge-external-api", version: "1" });
  });

  app.get("/api/external/projects", externalApiAuth, async (_req, res) => {
    try {
      const rows = await db.select().from(projects).orderBy(desc(projects.updatedAt));
      res.json(rows);
    } catch (err: any) {
      console.error("[external] projects list error:", err);
      res.status(500).json({ error: err?.message ?? "Failed to load projects" });
    }
  });

  app.get("/api/external/projects/:id", externalApiAuth, async (req, res) => {
    try {
      const id = String(req.params.id);
      const [project] = await db.select().from(projects).where(eq(projects.id, id));
      if (!project) return res.status(404).json({ error: "Project not found" });
      const [projectTasks, projectMilestones, payments] = await Promise.all([
        db.select().from(tasks).where(eq(tasks.projectId, id)),
        db.select().from(milestones).where(eq(milestones.projectId, id)),
        db.select().from(projectPayments).where(eq(projectPayments.projectId, id)),
      ]);
      res.json({ project, tasks: projectTasks, milestones: projectMilestones, payments });
    } catch (err: any) {
      console.error("[external] project detail error:", err);
      res.status(500).json({ error: err?.message ?? "Failed to load project" });
    }
  });

  // Unified calendar feed. Pulls every dated thing in the system and
  // returns a flat list of events the MCP can render directly. Optional
  // `from` and `to` ISO dates narrow the window; defaults are 30 days
  // back through 180 days forward.
  app.get("/api/external/calendar", externalApiAuth, async (req, res) => {
    try {
      const now = new Date();
      const defaultFrom = new Date(now.getTime() - 30 * 86400000);
      const defaultTo = new Date(now.getTime() + 180 * 86400000);
      const from = parseDateParam(req.query.from, defaultFrom);
      const to = parseDateParam(req.query.to, defaultTo);

      const milestoneRows = await db
        .select({ id: milestones.id, projectId: milestones.projectId, title: milestones.title, dueDate: milestones.dueDate, completedAt: milestones.completedAt })
        .from(milestones)
        .where(and(
          isNotNull(milestones.dueDate),
          gte(milestones.dueDate, from),
          lte(milestones.dueDate, to),
        ));

      const followupRows = await db
        .select()
        .from(scheduledFollowups)
        .where(and(
          gte(scheduledFollowups.scheduledFor, from),
          lte(scheduledFollowups.scheduledFor, to),
        ));

      const paymentRows = await db
        .select({ id: projectPayments.id, projectId: projectPayments.projectId, label: projectPayments.label, amount: projectPayments.amount, dueDate: projectPayments.dueDate, status: projectPayments.status })
        .from(projectPayments)
        .where(and(
          isNotNull(projectPayments.dueDate),
          gte(projectPayments.dueDate, from),
          lte(projectPayments.dueDate, to),
        ));

      const events: Array<{
        id: string;
        kind: "milestone" | "followup" | "payment_due";
        title: string;
        date: string;
        projectId?: string;
        status?: string;
        meta?: Record<string, unknown>;
      }> = [];

      for (const m of milestoneRows) {
        if (!m.dueDate) continue;
        events.push({
          id: `milestone:${m.id}`,
          kind: "milestone",
          title: m.title,
          date: m.dueDate.toISOString(),
          projectId: m.projectId ?? undefined,
          status: m.completedAt ? "completed" : "open",
        });
      }
      for (const f of followupRows) {
        events.push({
          id: `followup:${f.id}`,
          kind: "followup",
          title: `Follow up: ${f.type}`,
          date: f.scheduledFor.toISOString(),
          status: f.status ?? undefined,
          meta: { entityType: f.entityType, entityId: f.entityId },
        });
      }
      for (const pay of paymentRows) {
        if (!pay.dueDate) continue;
        events.push({
          id: `payment:${pay.id}`,
          kind: "payment_due",
          title: `${pay.label} ($${pay.amount})`,
          date: pay.dueDate.toISOString(),
          projectId: pay.projectId ?? undefined,
          status: pay.status ?? undefined,
        });
      }

      events.sort((a, b) => a.date.localeCompare(b.date));
      res.json({
        from: from.toISOString(),
        to: to.toISOString(),
        events,
      });
    } catch (err: any) {
      console.error("[external] calendar error:", err);
      res.status(500).json({ error: err?.message ?? "Failed to load calendar" });
    }
  });
}
