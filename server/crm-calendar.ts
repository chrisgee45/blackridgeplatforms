import type { Express, RequestHandler } from "express";
import { db } from "./db";
import { crmEvents } from "@shared/schema";
import { eq, asc, sql } from "drizzle-orm";

/**
 * Ensures CRM schema additions exist. The app has no migration runner —
 * schema is otherwise managed with drizzle-kit push — so these idempotent
 * statements run on startup alongside the other seed routines.
 */
export async function ensureCrmSchema(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS crm_events (
      id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
      lead_id varchar REFERENCES contact_submissions(id) ON DELETE SET NULL,
      title text NOT NULL,
      type text NOT NULL DEFAULT 'meeting',
      start_at timestamptz NOT NULL,
      end_at timestamptz,
      location text,
      notes text,
      status text NOT NULL DEFAULT 'scheduled',
      created_by text DEFAULT 'admin',
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  await db.execute(sql`ALTER TABLE contact_submissions ADD COLUMN IF NOT EXISTS website text`);
}

const VALID_TYPES = ["meeting", "call", "demo", "follow_up", "other"];
const VALID_STATUSES = ["scheduled", "completed", "cancelled", "no_show"];

function parseDate(value: unknown): Date | null {
  if (typeof value !== "string" || !value) return null;
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d;
}

export function registerCrmCalendarRoutes(app: Express, isAuthenticated: RequestHandler) {
  app.get("/api/crm/events", isAuthenticated, async (req, res) => {
    try {
      const leadId = typeof req.query.leadId === "string" && req.query.leadId ? req.query.leadId : null;
      const events = leadId
        ? await db.select().from(crmEvents).where(eq(crmEvents.leadId, leadId)).orderBy(asc(crmEvents.startAt))
        : await db.select().from(crmEvents).orderBy(asc(crmEvents.startAt));
      res.json(events);
    } catch (error: any) {
      console.error("Fetch CRM events error:", error);
      res.status(500).json({ message: "Failed to fetch events" });
    }
  });

  app.post("/api/crm/events", isAuthenticated, async (req, res) => {
    try {
      const title = typeof req.body?.title === "string" ? req.body.title.trim() : "";
      const startAt = parseDate(req.body?.startAt);
      if (!title) return res.status(400).json({ message: "Title is required" });
      if (!startAt) return res.status(400).json({ message: "A valid start date/time is required" });

      const type = VALID_TYPES.includes(req.body?.type) ? req.body.type : "meeting";
      const endAt = parseDate(req.body?.endAt);
      const status = VALID_STATUSES.includes(req.body?.status) ? req.body.status : "scheduled";

      const [event] = await db.insert(crmEvents).values({
        title,
        type,
        startAt,
        endAt: endAt ?? null,
        leadId: req.body?.leadId || null,
        location: typeof req.body?.location === "string" ? req.body.location.trim() || null : null,
        notes: typeof req.body?.notes === "string" ? req.body.notes.trim() || null : null,
        status,
        createdBy: "admin",
      }).returning();

      res.status(201).json(event);
    } catch (error: any) {
      console.error("Create CRM event error:", error);
      res.status(500).json({ message: `Failed to create event: ${error?.message || "unknown error"}` });
    }
  });

  app.patch("/api/crm/events/:id", isAuthenticated, async (req, res) => {
    try {
      const id = String(req.params.id);
      const updates: Record<string, unknown> = {};

      if (typeof req.body?.title === "string" && req.body.title.trim()) updates.title = req.body.title.trim();
      if (VALID_TYPES.includes(req.body?.type)) updates.type = req.body.type;
      if (VALID_STATUSES.includes(req.body?.status)) updates.status = req.body.status;
      if (req.body?.startAt !== undefined) {
        const d = parseDate(req.body.startAt);
        if (!d) return res.status(400).json({ message: "Invalid start date/time" });
        updates.startAt = d;
      }
      if (req.body?.endAt !== undefined) updates.endAt = parseDate(req.body.endAt);
      if (req.body?.leadId !== undefined) updates.leadId = req.body.leadId || null;
      if (req.body?.location !== undefined) {
        updates.location = typeof req.body.location === "string" ? req.body.location.trim() || null : null;
      }
      if (req.body?.notes !== undefined) {
        updates.notes = typeof req.body.notes === "string" ? req.body.notes.trim() || null : null;
      }

      if (Object.keys(updates).length === 0) {
        return res.status(400).json({ message: "No valid fields to update" });
      }

      const [event] = await db.update(crmEvents).set(updates).where(eq(crmEvents.id, id)).returning();
      if (!event) return res.status(404).json({ message: "Event not found" });
      res.json(event);
    } catch (error: any) {
      console.error("Update CRM event error:", error);
      res.status(500).json({ message: `Failed to update event: ${error?.message || "unknown error"}` });
    }
  });

  app.delete("/api/crm/events/:id", isAuthenticated, async (req, res) => {
    try {
      const [deleted] = await db.delete(crmEvents).where(eq(crmEvents.id, String(req.params.id))).returning();
      if (!deleted) return res.status(404).json({ message: "Event not found" });
      res.json({ success: true });
    } catch (error: any) {
      console.error("Delete CRM event error:", error);
      res.status(500).json({ message: "Failed to delete event" });
    }
  });
}
