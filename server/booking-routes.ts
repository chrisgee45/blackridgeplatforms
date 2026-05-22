import type { Express } from "express";
import { db } from "./db";
import { crmEvents, contactSubmissions } from "@shared/schema";
import { and, gte, lt, eq } from "drizzle-orm";
import { getResendClient, buildEmailSignatureHtml, buildEmailSignatureText } from "./email";

const SLOT_MINUTES = 30;

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function registerBookingRoutes(app: Express) {
  // Public: events already booked on a given day, so the booking page can
  // gray out taken slots. Returns start/end only — no titles or details.
  app.get("/api/book/availability", async (req, res) => {
    try {
      const dateStr = typeof req.query.date === "string" ? req.query.date : "";
      const day = new Date(`${dateStr}T00:00:00`);
      if (isNaN(day.getTime())) {
        return res.status(400).json({ message: "Invalid date" });
      }
      const next = new Date(day);
      next.setDate(next.getDate() + 1);
      const events = await db
        .select({ startAt: crmEvents.startAt, endAt: crmEvents.endAt })
        .from(crmEvents)
        .where(and(gte(crmEvents.startAt, day), lt(crmEvents.startAt, next)));
      res.json({ booked: events });
    } catch (error: any) {
      console.error("Booking availability error:", error);
      res.status(500).json({ message: "Failed to load availability" });
    }
  });

  // Public: book a discovery call. Creates (or reuses) a lead and a
  // calendar event, then emails a confirmation.
  app.post("/api/book", async (req, res) => {
    try {
      const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
      const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
      const company = typeof req.body?.company === "string" ? req.body.company.trim() : "";
      const website = typeof req.body?.website === "string" ? req.body.website.trim() : "";
      const notes = typeof req.body?.notes === "string" ? req.body.notes.trim() : "";
      const startAt = new Date(typeof req.body?.startAt === "string" ? req.body.startAt : "");

      if (!name || !email || !email.includes("@")) {
        return res.status(400).json({ message: "Name and a valid email are required" });
      }
      if (isNaN(startAt.getTime())) {
        return res.status(400).json({ message: "Please choose a time slot" });
      }
      if (startAt.getTime() < Date.now()) {
        return res.status(400).json({ message: "That time has already passed. Please pick another." });
      }
      const sixtyDays = Date.now() + 60 * 24 * 60 * 60 * 1000;
      if (startAt.getTime() > sixtyDays) {
        return res.status(400).json({ message: "Please pick a time within the next 60 days." });
      }
      const endAt = new Date(startAt.getTime() + SLOT_MINUTES * 60000);

      const clash = await db
        .select({ id: crmEvents.id })
        .from(crmEvents)
        .where(and(gte(crmEvents.startAt, startAt), lt(crmEvents.startAt, endAt)));
      if (clash.length > 0) {
        return res.status(409).json({ message: "Sorry, that slot was just booked. Please pick another time." });
      }

      const existing = await db
        .select()
        .from(contactSubmissions)
        .where(eq(contactSubmissions.email, email))
        .limit(1);

      let leadId: string;
      if (existing.length > 0) {
        leadId = existing[0].id;
        const patch: Record<string, unknown> = {};
        if (company && !existing[0].company) patch.company = company;
        if (website && !existing[0].website) patch.website = website;
        if (Object.keys(patch).length > 0) {
          await db.update(contactSubmissions).set(patch).where(eq(contactSubmissions.id, leadId));
        }
      } else {
        const [lead] = await db
          .insert(contactSubmissions)
          .values({
            name,
            email,
            company: company || null,
            website: website || null,
            message: notes || "Booked a discovery call via the website.",
            status: "new",
            priority: "high",
            leadSource: "Booking Link",
          })
          .returning();
        leadId = lead.id;
      }

      const [event] = await db
        .insert(crmEvents)
        .values({
          leadId,
          title: `Discovery call with ${name}`,
          type: "meeting",
          startAt,
          endAt,
          location: "Phone / Video call",
          notes: notes || null,
          status: "scheduled",
          createdBy: "booking",
        })
        .returning();

      const resend = getResendClient();
      if (resend) {
        const when = startAt.toLocaleString("en-US", {
          weekday: "long", month: "long", day: "numeric",
          hour: "numeric", minute: "2-digit",
        });
        resend.client.emails
          .send({
            from: resend.fromEmail,
            to: [email],
            subject: "Your call with BlackRidge Platforms is booked",
            html: `<div style="font-family:-apple-system,Segoe UI,sans-serif;font-size:14px;line-height:1.6;color:#1e293b;">Hi ${escapeHtml(name)},<br/><br/>You're all set. Your discovery call is booked for:<br/><br/><b style="font-size:15px;">${escapeHtml(when)}</b><br/><br/>It's a relaxed 30-minute call about your website. Come with questions, and I'll come with ideas.<br/><br/>If you need to change the time, just reply to this email.<br/><br/>Looking forward to it.<br/><br/>Best,${buildEmailSignatureHtml()}</div>`,
            text: `Hi ${name},\n\nYou're all set. Your discovery call is booked for:\n\n${when}\n\nIt's a relaxed 30-minute call about your website. If you need to change the time, just reply to this email.\n\nLooking forward to it.\n\nBest,\n\n${buildEmailSignatureText()}`,
          })
          .catch((err) => console.error("Booking confirmation email failed:", err));

        resend.client.emails
          .send({
            from: resend.fromEmail,
            to: [resend.fromEmail],
            subject: `New booking: ${name} on ${when}`,
            html: `<div style="font-family:-apple-system,Segoe UI,sans-serif;font-size:14px;line-height:1.6;color:#1e293b;"><b>New discovery call booked</b><br/><br/><b>${escapeHtml(name)}</b><br/>${escapeHtml(email)}<br/>${company ? escapeHtml(company) + "<br/>" : ""}${website ? escapeHtml(website) + "<br/>" : ""}<br/><b>${escapeHtml(when)}</b><br/><br/>${notes ? "Notes: " + escapeHtml(notes) : "No notes."}</div>`,
            text: `New discovery call booked.\n\n${name}\n${email}\n${company}\n${website}\n\n${when}\n\n${notes ? "Notes: " + notes : "No notes."}`,
          })
          .catch((err) => console.error("Booking notification email failed:", err));
      }

      res.status(201).json({ success: true, startAt: event.startAt });
    } catch (error: any) {
      console.error("Booking error:", error);
      res.status(500).json({ message: `Failed to book: ${error?.message || "unknown error"}` });
    }
  });
}
