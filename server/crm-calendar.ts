import type { Express, RequestHandler } from "express";
import { db } from "./db";
import { crmEvents } from "@shared/schema";
import { eq, asc, sql, and, isNull, isNotNull, gte } from "drizzle-orm";
import { isSmsConfigured, sendSms, getReminderPhone } from "./sms";

const REMINDER_TZ = "America/Chicago";
const ALLOWED_REMINDERS = [15, 30, 60, 120, 1440];

function normalizeReminder(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return ALLOWED_REMINDERS.includes(n) ? n : null;
}

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
      reminder_minutes integer,
      reminder_sent_at timestamptz,
      created_by text DEFAULT 'admin',
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  await db.execute(sql`ALTER TABLE contact_submissions ADD COLUMN IF NOT EXISTS website text`);
  await db.execute(sql`ALTER TABLE crm_events ADD COLUMN IF NOT EXISTS reminder_minutes integer`);
  await db.execute(sql`ALTER TABLE crm_events ADD COLUMN IF NOT EXISTS reminder_sent_at timestamptz`);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS proposals (
      id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
      lead_id varchar NOT NULL REFERENCES contact_submissions(id) ON DELETE CASCADE,
      title text NOT NULL,
      content text NOT NULL,
      amount integer,
      status text NOT NULL DEFAULT 'draft',
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      sent_at timestamptz
    )
  `);
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

  app.post("/api/crm/test-sms", isAuthenticated, async (_req, res) => {
    try {
      if (!isSmsConfigured()) {
        return res.status(400).json({
          message: "SMS is not configured. Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER and REMINDER_PHONE in Railway.",
        });
      }
      const phone = getReminderPhone()!;
      await sendSms(phone, "BlackRidge CRM: this is a test message. Your SMS reminders are working.");
      res.json({ success: true, to: phone });
    } catch (error: any) {
      console.error("Test SMS error:", error);
      res.status(500).json({ message: error?.message || "Failed to send test SMS" });
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
        reminderMinutes: normalizeReminder(req.body?.reminderMinutes),
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
        updates.reminderSentAt = null;
      }
      if (req.body?.endAt !== undefined) updates.endAt = parseDate(req.body.endAt);
      if (req.body?.leadId !== undefined) updates.leadId = req.body.leadId || null;
      if (req.body?.location !== undefined) {
        updates.location = typeof req.body.location === "string" ? req.body.location.trim() || null : null;
      }
      if (req.body?.notes !== undefined) {
        updates.notes = typeof req.body.notes === "string" ? req.body.notes.trim() || null : null;
      }
      if (req.body?.reminderMinutes !== undefined) {
        updates.reminderMinutes = normalizeReminder(req.body.reminderMinutes);
        updates.reminderSentAt = null;
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

/**
 * Background runner that texts a reminder before calendar events that have
 * a reminder set. Idempotent: each event is reminded at most once
 * (reminder_sent_at), and rescheduling re-arms it.
 */
export function startEventReminderRunner() {
  async function tick() {
    try {
      if (!isSmsConfigured()) return;
      const phone = getReminderPhone();
      if (!phone) return;
      const now = new Date();
      const due = await db
        .select()
        .from(crmEvents)
        .where(
          and(
            isNotNull(crmEvents.reminderMinutes),
            isNull(crmEvents.reminderSentAt),
            eq(crmEvents.status, "scheduled"),
            gte(crmEvents.startAt, now),
          ),
        );
      for (const ev of due) {
        const fireAt = new Date(new Date(ev.startAt).getTime() - (ev.reminderMinutes ?? 0) * 60000);
        if (now < fireAt) continue;
        const when = new Date(ev.startAt).toLocaleString("en-US", {
          timeZone: REMINDER_TZ,
          weekday: "short",
          hour: "numeric",
          minute: "2-digit",
        });
        const parts = [`Reminder: ${ev.title}`, `at ${when}`];
        if (ev.location) parts.push(ev.location);
        try {
          await sendSms(phone, parts.join(" • "));
          await db.update(crmEvents).set({ reminderSentAt: new Date() }).where(eq(crmEvents.id, ev.id));
          console.log(`Sent SMS reminder for event ${ev.id}`);
        } catch (err: any) {
          console.error(`SMS reminder failed for event ${ev.id}:`, err?.message);
        }
      }
    } catch (error) {
      console.error("Event reminder runner error:", error);
    }
  }
  setInterval(tick, 60 * 1000);
  tick();
  console.log("Event reminder runner started (60s interval)");
}
