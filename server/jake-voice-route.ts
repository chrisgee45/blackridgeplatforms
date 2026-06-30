/**
 * Jake voice chat. Mirrors the framed-streaming protocol used by Ridge
 * (FRAME_TEXT for the running transcript, FRAME_AUDIO for ElevenLabs TTS
 * bytes, FRAME_DONE with the final message metadata) but with Jake's
 * persona, a separate voice id, and conversation tuning that's
 * deliberately tighter and more back-and-forth than Ridge's CFO mode.
 *
 * Memory: messages persist to jake_voice_messages keyed by conversation.
 * Actions: Claude can emit <jake_action>{...JSON...}</jake_action> tags.
 * The server strips them from the spoken text and executes them after
 * the stream completes.
 */
import type { Express, RequestHandler } from "express";
import { db } from "./db";
import { projects, projectConversations, clients, contacts, companies, tasks, crmEvents } from "@shared/schema";
import { eq, desc, sql } from "drizzle-orm";
import { isPushConfigured, sendPushToAll } from "./push";
import { stripDashes } from "./text-utils";

const FRAME_AUDIO = 0x01;
const FRAME_TEXT = 0x02;
const FRAME_DONE = 0x03;

const JAKE_SYSTEM_VOICE = `You are Jake, Chris Gee's assistant at BlackRidge Platforms — but right now you're talking to Chris directly, by voice, inside the BlackRidge OPS portal.

This is a VOICE conversation. Talk like a real person on a call. Short turns. Natural acknowledgments ("yeah", "got it", "let me check"). React first, then answer. If Chris asks a quick question, give a quick answer — one sentence, maybe two. Expand only when he asks you to.

You handle BlackRidge's day-to-day client communication. You know about every project Chris has activated you on, every client conversation that's gone through your inbox at jake@reply.blackridgeplatforms.com, every open handoff, every check-in you've sent. The context block below has the live data — use it instead of asking Chris to repeat things he already knows.

You remember this entire conversation. Don't ask Chris to repeat himself between turns.

Voice rules:
- No markdown, no bullet points, no asterisks, no numbered lists. Just talk.
- Contractions always. No corporate filler. No em dashes.
- Never say "I hope this finds you well", "circle back", "synergy", "leverage".
- If Chris asks about a specific client, lead with the most recent thing that happened on their account, then offer to dig deeper.
- If you don't know, say so. Don't invent details.
- Stay on the BlackRidge side of the line. You handle client comms, project status, conversation context. Money / accounting / tax questions belong to Ridge (the other AI on this portal).

EXECUTING ACTIONS — important
When Chris asks you to actually do something — add a task to a project, put something on the calendar, set a reminder, send him a report — you DO it in this turn. These all act on Chris's own workspace, so they are safe to fire immediately. Emails to CLIENTS are the exception and follow a strict two-step rule below.

To execute an action, wrap a single JSON object in <jake_action></jake_action> tags. After emitting an action, briefly confirm in plain English what you did so the spoken response sounds natural.

Available actions:

<jake_action>{"type":"create_task","project_id":"<id>","title":"<short task title>","priority":"medium"}</jake_action>
Add a task to a project. Use the project_id from the LIVE STATE block, never invent one. Priority is one of: low / medium / high / urgent. Safe to fire immediately when Chris asks for a task.

<jake_action>{"type":"note_for_chris","reason":"<one-sentence FYI>"}</jake_action>
Fire a push notification to Chris RIGHT NOW. Use this for an immediate flag ("remind me about this", "flag that"). For anything tied to a future date or time, use add_calendar_event instead so it lands on the calendar and reminds him then.

<jake_action>{"type":"add_calendar_event","title":"<short title>","start_at":"<ISO 8601 datetime>","end_at":"<ISO 8601 or omit>","event_type":"meeting","location":"<or omit>","notes":"<or omit>","reminder_minutes":60}</jake_action>
Add an event to the BlackRidge calendar and optionally set a reminder. This is INTERNAL (Chris's own calendar), so it is SAFE to fire immediately the moment he asks. Use it for "put X on my calendar", "schedule a call with so-and-so Tuesday at 2", "remind me to follow up with HeatWave Friday morning". The CURRENT MOMENT header tells you today's date and time in Central — compute start_at from it and emit a full ISO 8601 timestamp (e.g. "2026-07-02T14:00:00-05:00"); never guess a date. event_type is one of meeting / call / demo / follow_up / other (default meeting; use follow_up or other for plain reminders). reminder_minutes, if set, is how many minutes BEFORE the event Chris gets a text and push — it must be one of 15, 30, 60, 120, or 1440 (1440 = one day before); omit it for no reminder. For a plain "remind me to do X at TIME", set start_at to that time and reminder_minutes to 15 so he gets pinged right around then. After firing it, confirm the day and time in plain English.

<jake_action>{"type":"email_report","project_id":"<id or omit>","intent":"<what Chris wants the report to cover, in his words>"}</jake_action>
Build a PDF report and email it to Chris's own inbox. This is INTERNAL — it always goes to Chris, never to a client — so it is SAFE to fire immediately the moment Chris asks for a report. Use it whenever Chris says things like "send me a report on X", "email me what so-and-so asked for", "PDF me everything HeatWave wants done", "put together a report and send it to me". Set project_id from the LIVE STATE block when the report is about one specific client or project (Jake will pull that client's messages, requests, and open tasks). OMIT project_id for a book-wide activity report across every client. Always put what Chris wants covered in "intent". After firing it, just say you're sending it to his inbox.

<jake_action>{"type":"email_client","project_id":"<id>","intent":"<what Chris wants the client to know, in his words>"}</jake_action>
Send an email to the client linked to that project.

<jake_action>{"type":"share_progress","project_id":"<id>","intent":"<short note explaining what you're sending, in Chris's words>"}</jake_action>
Email the client linked to that project with the LATEST progress screenshots attached.

<jake_action>{"type":"send_documents","project_id":"<id>","document_ids":["<doc_id_1>","<doc_id_2>"],"intent":"<short note explaining what you're sending, in Chris's words>"}</jake_action>
Email the client linked to that project with one or more SPECIFIC project documents attached. Pull document_ids from the "Documents available to attach" list in the live state — they appear there with their filename, category, and size. Use this when Chris says things like "send Alan the signed contract", "email the planter mockups to Hometown", "ship the invoice PDF to so-and-so". Up to 10 documents per email; each file is hard-capped at 20MB and the combined email shouldn't exceed ~25MB (Gmail bounces above that).

═══════════════════════════════════════════════════════════════════
CLIENT EMAIL SAFETY RULE — NON-NEGOTIABLE — READ CAREFULLY
═══════════════════════════════════════════════════════════════════
You NEVER, EVER fire email_client, share_progress, or send_documents on your own initiative or because Chris is thinking out loud, brainstorming, asking what he should say, or musing about a client. Chris talking ABOUT a client is not the same as Chris telling you to email a client. This rule exists because a real client (Autumn at Hometown Rock And Landscape) was emailed from an internal voice chat and called Chris confused. Do not let it happen again.

The ONLY time you fire email_client, share_progress, or send_documents is when Chris's MOST RECENT user message contains an unambiguous send instruction — words like "send it", "fire it off", "ship it", "yes send", "go ahead and email", "email it now", "do it", "send the email". And even then, only AFTER you've already shown him a draft or summary in a previous turn and he's confirming THAT specific send.

The flow is ALWAYS two turns minimum:
  Turn 1 (Chris): "Tell Autumn at Hometown the planters are done."
  Turn 1 (you): "I've got a draft — it would say [short summary]. Want me to send it?"
                (NO action fires this turn.)
  Turn 2 (Chris): "Yes, send it."
  Turn 2 (you): emits email_client action AND says "Sent."

If Chris is just chatting, asking a question, brainstorming, or wandering — you do NOT emit email_client, share_progress, or send_documents. If you're not 100% sure he means SEND THIS NOW, you ask. The server will refuse to execute these actions unless Chris's latest message contains an explicit confirmation phrase, so emitting them speculatively will fail anyway. When in doubt, draft a preview and wait.

If an action block fails (you can't find the project, no explicit confirmation, etc.), the server tells you in the next turn and you can adjust. Never speak the JSON aloud — those characters are silently stripped from the TTS feed.`;

// Words that unambiguously mean "send the email I just proposed." We require
// one of these in Chris's most recent user message before email_client or
// share_progress will execute. Anything less is treated as brainstorming
// and refused — see CLIENT EMAIL SAFETY RULE in the prompt above.
const CLIENT_EMAIL_CONFIRM_PATTERN = /\b(send (it|that|them|the email|the message|now)|fire (it|that) off|ship it|go ahead( and (send|email))?|yes,?\s*(send|do it|fire)|do it|email (it|that|her|him|them|now)|email it now|confirmed|approved)\b/i;

async function buildJakeSnapshot(): Promise<string> {
  const lines: string[] = [];
  const enabledProjects = await db
    .select()
    .from(projects)
    .where(eq(projects.jakeEnabled, true))
    .orderBy(desc(projects.jakeStartedAt));

  // Pull every project (not just Jake-enabled) so Chris can ask Jake to
  // create tasks on any project, not just the ones he's emailing through.
  const allProjects = await db.select().from(projects).orderBy(desc(projects.updatedAt));

  if (allProjects.length === 0) {
    lines.push("No projects exist yet.");
  } else {
    lines.push(`All projects (use project_id when executing actions):`);
    for (const p of allProjects.slice(0, 40)) {
      let label = p.name;
      if (p.clientId) {
        const [cl] = await db.select().from(clients).where(eq(clients.id, p.clientId));
        if (cl?.name) label += ` (${cl.name})`;
      } else if (p.companyId) {
        const [co] = await db.select().from(companies).where(eq(companies.id, p.companyId));
        if (co?.name) label += ` (${co.name})`;
      }
      lines.push(`- ${p.id} · ${label} · ${p.stage}${p.jakeEnabled ? " · JAKE ACTIVE" : ""}`);
    }
  }

  // Jake's open handoffs and recent conversation activity (last 7 days).
  if (enabledProjects.length > 0) {
    const openHandoffs = enabledProjects.filter(p => p.jakeAwaitingHandoff);
    if (openHandoffs.length > 0) {
      lines.push("");
      lines.push(`OPEN HANDOFFS REQUIRING CHRIS (${openHandoffs.length}):`);
      for (const p of openHandoffs) {
        lines.push(`- ${p.name}: ${p.jakeHandoffReason ?? "Needs answer"}`);
      }
    }

    const since = new Date(Date.now() - 7 * 86400000);
    const recent = await db
      .select()
      .from(projectConversations)
      .where(sql`${projectConversations.createdAt} >= ${since}`)
      .orderBy(desc(projectConversations.createdAt))
      .limit(30);
    if (recent.length > 0) {
      lines.push("");
      lines.push(`Last 7 days of Jake conversation (${recent.length} entries):`);
      const projNames = new Map<string, string>();
      for (const p of allProjects) projNames.set(p.id, p.name);
      for (const c of recent.slice(0, 25)) {
        const proj = projNames.get(c.projectId) ?? "Unknown";
        const who = c.direction === "inbound" ? "CLIENT" : (c.classification === "HANDOFF_RELAY" ? "Chris-via-Jake" : "Jake");
        const snippet = (c.body ?? "").replace(/\s+/g, " ").slice(0, 180);
        lines.push(`  ${new Date(c.createdAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} · ${proj} · ${who}: ${snippet}`);
      }
    }
  }

  // Per-project documents Jake can attach via send_documents. We list
  // ALL active projects' documents (not just Jake-enabled) so Chris
  // can ask Jake to grab anything on any project.
  const enabledProjectIds = new Set(allProjects.slice(0, 40).map(p => p.id));
  if (enabledProjectIds.size > 0) {
    const { projectDocuments } = await import("@shared/schema");
    const docs = await db
      .select()
      .from(projectDocuments)
      .orderBy(desc(projectDocuments.createdAt))
      .limit(120);
    const projNames = new Map<string, string>();
    for (const p of allProjects) projNames.set(p.id, p.name);
    const visible = docs.filter(d => enabledProjectIds.has(d.projectId));
    if (visible.length > 0) {
      lines.push("");
      lines.push(`Documents available to attach via send_documents (use the document_id):`);
      for (const d of visible.slice(0, 60)) {
        const proj = projNames.get(d.projectId) ?? "?";
        const size = d.fileSize ? `${Math.round((d.fileSize ?? 0) / 1024)}KB` : "";
        lines.push(`- ${d.id} · ${proj} · [${d.category}] ${d.filename}${size ? ` (${size})` : ""}`);
      }
    }
  }

  // Upcoming calendar so Jake can answer "what's on my calendar" and avoid
  // double-booking when Chris asks him to schedule something.
  try {
    const now = new Date();
    const horizon = new Date(now.getTime() + 30 * 86400000);
    const upcoming = await db
      .select()
      .from(crmEvents)
      .where(sql`${crmEvents.startAt} >= ${now} AND ${crmEvents.startAt} <= ${horizon}`)
      .orderBy(crmEvents.startAt)
      .limit(20);
    if (upcoming.length > 0) {
      lines.push("");
      lines.push(`Upcoming calendar events (next 30 days):`);
      for (const ev of upcoming) {
        const when = new Date(ev.startAt).toLocaleString("en-US", {
          timeZone: "America/Chicago",
          weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
        });
        const rem = ev.reminderMinutes ? ` · reminder ${ev.reminderMinutes >= 1440 ? "1d" : ev.reminderMinutes + "m"} before` : "";
        lines.push(`- ${when} CT · ${ev.title}${ev.location ? ` @ ${ev.location}` : ""} [${ev.type}]${rem}`);
      }
    }
  } catch (err) {
    console.warn("Jake calendar snapshot load failed:", err);
  }

  return lines.join("\n");
}

// ─────────────────────────────────────────────────────────────────────────
// Memory storage — small idempotent schema so we don't need db:push.
// ─────────────────────────────────────────────────────────────────────────

async function ensureVoiceMemorySchema(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS jake_voice_conversations (
      id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
      title text,
      started_at timestamptz NOT NULL DEFAULT now(),
      last_message_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS jake_voice_messages (
      id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
      conversation_id varchar NOT NULL REFERENCES jake_voice_conversations(id) ON DELETE CASCADE,
      role text NOT NULL,
      content text NOT NULL,
      actions jsonb,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS jake_voice_messages_convo_idx
      ON jake_voice_messages (conversation_id, created_at)
  `);
}

let schemaReady: Promise<void> | null = null;
function getSchemaReady(): Promise<void> {
  if (!schemaReady) schemaReady = ensureVoiceMemorySchema().catch(err => {
    console.error("Jake voice memory schema error:", err);
    schemaReady = null;
    throw err;
  });
  return schemaReady;
}

// ─────────────────────────────────────────────────────────────────────────
// Action execution
// ─────────────────────────────────────────────────────────────────────────

const JAKE_FROM_EMAIL = process.env.JAKE_FROM_EMAIL || "jake@blackridgeplatforms.com";
const JAKE_FROM_NAME = process.env.JAKE_FROM_NAME || "Jake at BlackRidge";

type JakeAction =
  | { type: "create_task"; project_id?: string; title?: string; priority?: string }
  | { type: "email_client"; project_id?: string; intent?: string }
  | { type: "share_progress"; project_id?: string; intent?: string }
  | { type: "send_documents"; project_id?: string; document_ids?: string[]; intent?: string }
  | { type: "email_report"; project_id?: string; intent?: string }
  | { type: "add_calendar_event"; title?: string; start_at?: string; end_at?: string; event_type?: string; location?: string; notes?: string; reminder_minutes?: number }
  | { type: "note_for_chris"; reason?: string };

interface ActionResult {
  type: string;
  ok: boolean;
  message: string;
}

function extractActions(text: string): { stripped: string; actions: JakeAction[] } {
  const actions: JakeAction[] = [];
  const stripped = text.replace(/<jake_action>([\s\S]*?)<\/jake_action>/g, (_full, json) => {
    try {
      const parsed = JSON.parse(String(json).trim());
      if (parsed && typeof parsed === "object" && typeof parsed.type === "string") {
        actions.push(parsed as JakeAction);
      }
    } catch (err) {
      console.warn("Jake action parse failed:", err);
    }
    return "";
  });
  return { stripped, actions };
}

async function executeAction(action: JakeAction): Promise<ActionResult> {
  try {
    if (action.type === "create_task") {
      if (!action.project_id || !action.title) return { type: action.type, ok: false, message: "missing project_id or title" };
      const [proj] = await db.select().from(projects).where(eq(projects.id, action.project_id));
      if (!proj) return { type: action.type, ok: false, message: "project not found" };
      const priority = ["low", "medium", "high", "urgent"].includes((action.priority ?? "").toLowerCase())
        ? (action.priority as string).toLowerCase()
        : "medium";
      await db.insert(tasks).values({
        projectId: proj.id,
        title: action.title,
        status: "todo",
        priority,
        assignedTo: "Chris",
      });
      return { type: action.type, ok: true, message: `Added task "${action.title}" to ${proj.name}` };
    }

    if (action.type === "email_client") {
      if (!action.project_id || !action.intent) return { type: action.type, ok: false, message: "missing project_id or intent" };
      const [proj] = await db.select().from(projects).where(eq(projects.id, action.project_id));
      if (!proj) return { type: action.type, ok: false, message: "project not found" };

      // Find contact email
      let contactEmail: string | null = null;
      let contactName: string | null = null;
      if (proj.contactId) {
        const [c] = await db.select().from(contacts).where(eq(contacts.id, proj.contactId));
        if (c) { contactEmail = c.email ?? null; contactName = c.name ?? null; }
      }
      if (!contactEmail && proj.clientId) {
        const [cl] = await db.select().from(clients).where(eq(clients.id, proj.clientId));
        if (cl?.email) { contactEmail = cl.email; contactName = cl.name ?? null; }
      }
      if (!contactEmail) return { type: action.type, ok: false, message: `no client email on file for ${proj.name}` };

      // Use the existing relay helper to phrase Chris's intent in Jake's
      // voice and send it in any open thread.
      const { relayHandoffAnswer } = await import("./jake");
      // relayHandoffAnswer expects an awaiting handoff but the underlying
      // send logic works the same — for cleaner separation, call the
      // shared email send instead. Lightweight inline send:
      const { Resend } = await import("resend");
      const apiKey = process.env.RESEND_API_KEY;
      if (!apiKey) return { type: action.type, ok: false, message: "RESEND_API_KEY not configured" };
      const resend = new Resend(apiKey);

      // Quick Claude rephrase in Jake's voice (synchronous, cheap call).
      const Anthropic = (await import("@anthropic-ai/sdk")).default;
      const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
      const phrased = await anthropic.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 800,
        system: `You are Jake at BlackRidge Platforms writing a short email to a project client on Chris's behalf. Warm, direct, no fluff. End with this exact four-line signature:\n\nSincerely,\nJake\nClient Relations Specialist\nBlackRidge Platforms\n\nOutput ONLY the email body. No subject line, no preamble.`,
        messages: [{
          role: "user",
          content: `Project: ${proj.name}\nClient contact: ${contactName ?? "the client"}\n\nChris asked you to send this:\n${action.intent}\n\nWrite the email as Jake.`,
        }],
      });
      const body = stripDashes(phrased.content.map(b => (b.type === "text" ? b.text : "")).join("").trim());
      const subject = `Quick note — ${proj.name}`;
      try {
        await resend.emails.send({
          from: `${JAKE_FROM_NAME} <${JAKE_FROM_EMAIL}>`,
          to: contactEmail,
          replyTo: JAKE_FROM_EMAIL,
          subject,
          html: `<div style="font-family: Arial, sans-serif; max-width: 600px; line-height: 1.6;">${body.replace(/\n/g, "<br>")}</div>`,
          tags: [
            { name: "projectId", value: proj.id },
            { name: "agent", value: "jake" },
            { name: "kind", value: "voice_action_email" },
          ],
        });
      } catch (err: any) {
        return { type: action.type, ok: false, message: `send failed: ${err?.message ?? "unknown"}` };
      }

      // Log into project_conversations so it shows up in the Jake tab.
      await db.insert(projectConversations).values({
        projectId: proj.id,
        clientId: proj.clientId ?? null,
        direction: "outbound",
        fromEmail: JAKE_FROM_EMAIL,
        toEmail: contactEmail,
        subject,
        body,
        aiGenerated: true,
        classification: "VOICE_ACTION",
      });
      void relayHandoffAnswer; // imported for parity / future use
      return { type: action.type, ok: true, message: `Emailed ${contactName ?? contactEmail} about ${proj.name}` };
    }

    if (action.type === "share_progress") {
      if (!action.project_id) return { type: action.type, ok: false, message: "missing project_id" };
      const [proj] = await db.select().from(projects).where(eq(projects.id, action.project_id));
      if (!proj) return { type: action.type, ok: false, message: "project not found" };

      let contactEmail: string | null = null;
      let contactName: string | null = null;
      if (proj.contactId) {
        const [c] = await db.select().from(contacts).where(eq(contacts.id, proj.contactId));
        if (c) { contactEmail = c.email ?? null; contactName = c.name ?? null; }
      }
      if (!contactEmail && proj.clientId) {
        const [cl] = await db.select().from(clients).where(eq(clients.id, proj.clientId));
        if (cl?.email) { contactEmail = cl.email; contactName = cl.name ?? null; }
      }
      if (!contactEmail) return { type: action.type, ok: false, message: `no client email on file for ${proj.name}` };

      // Find progress images via the project documents table.
      const { projectDocuments } = await import("@shared/schema");
      const docs = await db.select().from(projectDocuments)
        .where(eq(projectDocuments.projectId, proj.id))
        .orderBy(desc(projectDocuments.createdAt));
      const progress = docs.filter(d => d.category === "progress" && /image\//i.test(d.contentType ?? "")).slice(0, 6);
      if (progress.length === 0) return { type: action.type, ok: false, message: `no progress screenshots uploaded for ${proj.name} yet` };

      // Reuse jake.ts's attachment loader.
      const { loadProgressForVoice } = await import("./jake");
      const attachments = await loadProgressForVoice(progress.map(p => p.id));
      if (attachments.length === 0) return { type: action.type, ok: false, message: "couldn't read the progress images from storage" };

      // Quick Claude rephrase for the email body.
      const Anthropic = (await import("@anthropic-ai/sdk")).default;
      const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
      const phrased = await anthropic.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 600,
        system: `You are Jake at BlackRidge writing a short email to a project client. Warm, direct. Mention you've attached the latest progress images. End with this exact four-line signature:\n\nSincerely,\nJake\nClient Relations Specialist\nBlackRidge Platforms\n\nOutput ONLY the email body.`,
        messages: [{
          role: "user",
          content: `Project: ${proj.name}\nClient contact: ${contactName ?? "the client"}\n\nChris asked you to send the latest progress with this note: ${action.intent ?? "(no extra context)"}`,
        }],
      });
      const body = stripDashes(phrased.content.map(b => (b.type === "text" ? b.text : "")).join("").trim());
      const subject = `Latest progress — ${proj.name}`;

      const { Resend } = await import("resend");
      const apiKey = process.env.RESEND_API_KEY;
      if (!apiKey) return { type: action.type, ok: false, message: "RESEND_API_KEY not configured" };
      try {
        await new Resend(apiKey).emails.send({
          from: `${JAKE_FROM_NAME} <${JAKE_FROM_EMAIL}>`,
          to: contactEmail,
          replyTo: JAKE_FROM_EMAIL,
          subject,
          html: `<div style="font-family: Arial, sans-serif; max-width: 600px; line-height: 1.6;">${body.replace(/\n/g, "<br>")}</div>`,
          attachments,
          tags: [
            { name: "projectId", value: proj.id },
            { name: "agent", value: "jake" },
            { name: "kind", value: "progress_share" },
          ],
        });
      } catch (err: any) {
        return { type: action.type, ok: false, message: `send failed: ${err?.message ?? "unknown"}` };
      }
      await db.insert(projectConversations).values({
        projectId: proj.id,
        clientId: proj.clientId ?? null,
        direction: "outbound",
        fromEmail: JAKE_FROM_EMAIL,
        toEmail: contactEmail,
        subject,
        body: `${body}\n\n[${attachments.length} progress screenshot${attachments.length === 1 ? "" : "s"} attached]`,
        aiGenerated: true,
        classification: "PROGRESS_SHARE",
      });
      return { type: action.type, ok: true, message: `Sent ${attachments.length} progress screenshot${attachments.length === 1 ? "" : "s"} to ${contactName ?? contactEmail}` };
    }

    if (action.type === "send_documents") {
      if (!action.project_id) return { type: action.type, ok: false, message: "missing project_id" };
      if (!Array.isArray(action.document_ids) || action.document_ids.length === 0) {
        return { type: action.type, ok: false, message: "missing document_ids" };
      }
      const [proj] = await db.select().from(projects).where(eq(projects.id, action.project_id));
      if (!proj) return { type: action.type, ok: false, message: "project not found" };

      let contactEmail: string | null = null;
      let contactName: string | null = null;
      if (proj.contactId) {
        const [c] = await db.select().from(contacts).where(eq(contacts.id, proj.contactId));
        if (c) { contactEmail = c.email ?? null; contactName = c.name ?? null; }
      }
      if (!contactEmail && proj.clientId) {
        const [cl] = await db.select().from(clients).where(eq(clients.id, proj.clientId));
        if (cl?.email) { contactEmail = cl.email; contactName = cl.name ?? null; }
      }
      if (!contactEmail) return { type: action.type, ok: false, message: `no client email on file for ${proj.name}` };

      const { loadDocumentsForVoice } = await import("./jake");
      const attachments = await loadDocumentsForVoice(proj.id, action.document_ids);
      if (attachments.length === 0) {
        return { type: action.type, ok: false, message: "couldn't read the requested documents from storage" };
      }

      const Anthropic = (await import("@anthropic-ai/sdk")).default;
      const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
      const fileList = attachments.map(a => a.filename).join(", ");
      const phrased = await anthropic.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 600,
        system: `You are Jake at BlackRidge writing a short email to a project client. Warm, direct. Mention you've attached the requested file(s) by name. End with this exact four-line signature:\n\nSincerely,\nJake\nClient Relations Specialist\nBlackRidge Platforms\n\nOutput ONLY the email body.`,
        messages: [{
          role: "user",
          content: `Project: ${proj.name}\nClient contact: ${contactName ?? "the client"}\nAttachments: ${fileList}\n\nChris asked you to send these with this context: ${action.intent ?? "(no extra context)"}`,
        }],
      });
      const body = stripDashes(phrased.content.map(b => (b.type === "text" ? b.text : "")).join("").trim());
      const subject = attachments.length === 1
        ? `${attachments[0].filename} — ${proj.name}`
        : `${attachments.length} files — ${proj.name}`;

      const { Resend } = await import("resend");
      const apiKey = process.env.RESEND_API_KEY;
      if (!apiKey) return { type: action.type, ok: false, message: "RESEND_API_KEY not configured" };
      try {
        await new Resend(apiKey).emails.send({
          from: `${JAKE_FROM_NAME} <${JAKE_FROM_EMAIL}>`,
          to: contactEmail,
          replyTo: JAKE_FROM_EMAIL,
          subject,
          html: `<div style="font-family: Arial, sans-serif; max-width: 600px; line-height: 1.6;">${body.replace(/\n/g, "<br>")}</div>`,
          attachments: attachments.map(a => ({ filename: a.filename, content: a.content })),
          tags: [
            { name: "projectId", value: proj.id },
            { name: "agent", value: "jake" },
            { name: "kind", value: "documents_send" },
          ],
        });
      } catch (err: any) {
        return { type: action.type, ok: false, message: `send failed: ${err?.message ?? "unknown"}` };
      }
      await db.insert(projectConversations).values({
        projectId: proj.id,
        clientId: proj.clientId ?? null,
        direction: "outbound",
        fromEmail: JAKE_FROM_EMAIL,
        toEmail: contactEmail,
        subject,
        body: `${body}\n\n[${attachments.length} attachment${attachments.length === 1 ? "" : "s"}: ${fileList}]`,
        aiGenerated: true,
        classification: "DOCUMENTS_SEND",
      });
      return { type: action.type, ok: true, message: `Sent ${attachments.length} document${attachments.length === 1 ? "" : "s"} (${fileList}) to ${contactName ?? contactEmail}` };
    }

    if (action.type === "email_report") {
      // Internal report to Chris himself — never goes to a client, so it is
      // not gated by the client-email confirmation rule. If a project_id is
      // given, validate it; otherwise build a book-wide report.
      if (action.project_id) {
        const [proj] = await db.select().from(projects).where(eq(projects.id, action.project_id));
        if (!proj) return { type: action.type, ok: false, message: "project not found" };
      }
      const { buildAndEmailJakeReport } = await import("./jake-report");
      const result = await buildAndEmailJakeReport({
        projectId: action.project_id ?? null,
        intent: action.intent ?? null,
      });
      return { type: action.type, ok: result.ok, message: result.message };
    }

    if (action.type === "add_calendar_event") {
      // Internal — goes on Chris's own BlackRidge calendar, so no client
      // confirmation gate. Mirrors POST /api/crm/events validation.
      const title = typeof action.title === "string" ? action.title.trim() : "";
      if (!title) return { type: action.type, ok: false, message: "missing title" };
      const startAt = action.start_at ? new Date(action.start_at) : null;
      if (!startAt || isNaN(startAt.getTime())) {
        return { type: action.type, ok: false, message: "missing or invalid start_at (need an ISO 8601 datetime)" };
      }
      const endRaw = action.end_at ? new Date(action.end_at) : null;
      const endAt = endRaw && !isNaN(endRaw.getTime()) ? endRaw : null;
      const validTypes = ["meeting", "call", "demo", "follow_up", "other"];
      const type = validTypes.includes((action.event_type ?? "").toLowerCase())
        ? (action.event_type as string).toLowerCase()
        : "meeting";
      const allowedReminders = [15, 30, 60, 120, 1440];
      const reminderMinutes = action.reminder_minutes != null && allowedReminders.includes(Number(action.reminder_minutes))
        ? Number(action.reminder_minutes)
        : null;

      await db.insert(crmEvents).values({
        title: title.slice(0, 200),
        type,
        startAt,
        endAt,
        location: typeof action.location === "string" ? action.location.trim() || null : null,
        notes: typeof action.notes === "string" ? action.notes.trim() || null : null,
        status: "scheduled",
        reminderMinutes,
        createdBy: "jake",
      });

      const whenStr = startAt.toLocaleString("en-US", {
        timeZone: "America/Chicago",
        weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
      });
      const reminderStr = reminderMinutes
        ? ` (reminder ${reminderMinutes >= 1440 ? "1 day" : `${reminderMinutes} min`} before)`
        : "";
      return { type: action.type, ok: true, message: `Added "${title}" to the calendar for ${whenStr} CT${reminderStr}` };
    }

    if (action.type === "note_for_chris") {
      if (!action.reason) return { type: action.type, ok: false, message: "missing reason" };
      if (isPushConfigured()) {
        await sendPushToAll({
          title: "Jake → reminder",
          body: action.reason,
          url: "/admin/ops/jake/report",
        });
      }
      return { type: action.type, ok: true, message: `Push reminder sent: ${action.reason}` };
    }
    return { type: (action as any).type ?? "unknown", ok: false, message: "unknown action type" };
  } catch (err: any) {
    return { type: (action as any).type ?? "unknown", ok: false, message: err?.message ?? "execution error" };
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Routes
// ─────────────────────────────────────────────────────────────────────────

export function registerJakeVoiceRoutes(app: Express, isAuthenticated: RequestHandler): void {
  // Create a new conversation (Chris hits "New chat" or it's the first
  // time on this device).
  app.post("/api/jake/voice/conversations", isAuthenticated, async (_req, res) => {
    try {
      await getSchemaReady();
      const r = await db.execute(sql`
        INSERT INTO jake_voice_conversations DEFAULT VALUES RETURNING id, started_at
      `);
      const row = (r as any)?.rows?.[0] ?? (r as any)?.[0];
      res.json({ id: row.id, started_at: row.started_at });
    } catch (err: any) {
      console.error("Jake voice create conversation error:", err);
      res.status(500).json({ error: err?.message ?? "failed" });
    }
  });

  app.get("/api/jake/voice/conversations/:id/messages", isAuthenticated, async (req, res) => {
    try {
      await getSchemaReady();
      const r = await db.execute(sql`
        SELECT role, content, actions, created_at
        FROM jake_voice_messages
        WHERE conversation_id = ${req.params.id}
        ORDER BY created_at ASC
      `);
      const rows = (r as any)?.rows ?? (r as any) ?? [];
      res.json(rows);
    } catch (err: any) {
      console.error("Jake voice list messages error:", err);
      res.status(500).json({ error: err?.message ?? "failed" });
    }
  });

  app.post("/api/jake/voice-stream", isAuthenticated, async (req, res) => {
    try {
      await getSchemaReady();
      const apiKey = process.env.ELEVENLABS_API_KEY;
      const voiceId = process.env.ELEVENLABS_JAKE_VOICE_ID || process.env.ELEVENLABS_VOICE_ID;
      const anthropicKey = process.env.ANTHROPIC_API_KEY;
      if (!apiKey || !voiceId) {
        return res.status(500).json({ error: "ElevenLabs not configured (set ELEVENLABS_JAKE_VOICE_ID)" });
      }
      if (!anthropicKey) {
        return res.status(500).json({ error: "Anthropic not configured" });
      }

      const conversationId = typeof req.body?.conversationId === "string" ? req.body.conversationId : null;
      const messagesIn = Array.isArray(req.body?.messages) ? req.body.messages : [];
      // When the user typed instead of spoke, the client sets silent=true.
      // We still stream the text frames so the UI updates live, but skip
      // ElevenLabs TTS entirely — no audio sent back, no API call made.
      const silent = req.body?.silent === true;
      const incoming = messagesIn
        .map((m: any) => ({ role: m.role === "assistant" ? "assistant" : "user", content: String(m.content ?? "") }))
        .filter((m: any) => m.content.length > 0);
      if (incoming.length === 0 || incoming[incoming.length - 1].role !== "user") {
        return res.status(400).json({ error: "No user message" });
      }

      // Load persisted history with timestamps. Stamp each row's
      // timestamp into the content so Jake can reason about
      // "yesterday" / "four days ago" against real dates.
      const readRow = (row: any) => ({
        role: row.role,
        content: row.content,
        createdAt: row.created_at
          ? new Date(row.created_at)
          : (row.createdAt ? new Date(row.createdAt) : null),
      });
      let historyFromDb: { role: string; content: string; createdAt: Date | null }[] = [];
      if (conversationId) {
        try {
          const r = await db.execute(sql`
            SELECT role, content, created_at
            FROM jake_voice_messages
            WHERE conversation_id = ${conversationId}
            ORDER BY created_at ASC
            LIMIT 40
          `);
          historyFromDb = (((r as any)?.rows ?? (r as any) ?? []) as any[]).map(readRow);
        } catch (err) {
          console.warn("Jake voice history load failed:", err);
        }
      }
      if (historyFromDb.length === 0) {
        try {
          const r = await db.execute(sql`
            SELECT role, content, created_at
            FROM jake_voice_messages
            ORDER BY created_at DESC
            LIMIT 40
          `);
          const rows = (((r as any)?.rows ?? (r as any) ?? []) as any[]).map(readRow);
          historyFromDb = rows.reverse();
        } catch (err) {
          console.warn("Jake voice global history load failed:", err);
        }
      }
      const stampedHistory = historyFromDb.map(row => ({
        role: row.role,
        content: row.createdAt
          ? `[${row.createdAt.toLocaleString("en-US", { timeZone: "America/Chicago", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" })} CT] ${row.content}`
          : row.content,
      }));

      // Prefer DB history + the latest user message from incoming.
      const latestUser = incoming[incoming.length - 1];
      const combined = stampedHistory.length > 0
        ? [...stampedHistory, latestUser]
        : incoming;
      const trimmed = combined.slice(-24);

      const now = new Date();
      const nowStr = now.toLocaleString("en-US", {
        timeZone: "America/Chicago",
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });
      const timeHeader = `CURRENT MOMENT: ${nowStr} Central Time. Each prior message in this thread is prefixed with its timestamp in square brackets like "[Jun 15, 2026 10:15 AM CT]". Use these to compute how long ago anything was — do NOT guess at relative times.\n\n`;

      const snapshot = await buildJakeSnapshot();
      const system = `${timeHeader}${JAKE_SYSTEM_VOICE}\n\n=== LIVE JAKE STATE ===\n${snapshot}`;

      res.setHeader("Content-Type", "application/octet-stream");
      res.setHeader("Transfer-Encoding", "chunked");
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("X-Content-Type", "jake-audio-stream");
      res.flushHeaders();

      function sendFrame(type: number, payload: Buffer) {
        const header = Buffer.alloc(5);
        header.writeUInt8(type, 0);
        header.writeUInt32BE(payload.length, 1);
        try { res.write(Buffer.concat([header, payload])); } catch { /* socket closed */ }
      }
      const sendText = (t: string) => sendFrame(FRAME_TEXT, Buffer.from(t, "utf-8"));
      const sendDone = (m: object) => sendFrame(FRAME_DONE, Buffer.from(JSON.stringify(m), "utf-8"));

      async function streamTTS(text: string): Promise<void> {
        if (silent) return; // text-mode input → no audio out
        const cleaned = text.replace(/<[^>]*>/g, "").slice(0, 2000);
        if (!cleaned.trim()) return;
        try {
          const ttsResp = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream`, {
            method: "POST",
            headers: { "xi-api-key": apiKey!, "Content-Type": "application/json" },
            body: JSON.stringify({
              text: cleaned,
              model_id: "eleven_turbo_v2_5",
              voice_settings: {
                stability: 0.32,
                similarity_boost: 0.82,
                style: 0.45,
                use_speaker_boost: true,
                speed: 1.05,
              },
            }),
          });
          if (!ttsResp.ok) {
            console.error("[jake/voice-stream] TTS error:", ttsResp.status, await ttsResp.text().catch(() => ""));
            return;
          }
          const reader = ttsResp.body?.getReader();
          if (!reader) return;
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            sendFrame(FRAME_AUDIO, Buffer.from(value));
          }
        } catch (e: any) {
          console.error("[jake/voice-stream] TTS pipe error:", e?.message);
        }
      }

      const Anthropic = (await import("@anthropic-ai/sdk")).default;
      const anthropic = new Anthropic({ apiKey: anthropicKey });
      let fullReply = "";
      let speakable = "";
      // We strip jake_action blocks from anything we send to TTS so the
      // JSON never gets read aloud. State machine: when we see "<j",
      // we hold output until the matching closing tag arrives.
      let holdingTag = false;
      let tagBuffer = "";
      const flushBoundary = /[.!?]\s+/;

      const stream = anthropic.messages.stream({
        model: "claude-sonnet-4-6",
        max_tokens: 1000,
        system,
        messages: trimmed.map((m: { role: string; content: string }) => ({
          role: m.role === "assistant" ? "assistant" : "user",
          content: m.content,
        })) as any,
      });

      stream.on("text", async (delta: string) => {
        fullReply += delta;
        sendText(delta); // raw transcript for the widget — includes the tags

        // Build a "speakable" buffer that excludes <jake_action> blocks.
        for (const ch of delta) {
          if (holdingTag) {
            tagBuffer += ch;
            if (tagBuffer.includes("</jake_action>")) {
              tagBuffer = "";
              holdingTag = false;
            }
            continue;
          }
          speakable += ch;
          // Detect the start of an action tag using a small lookback.
          const tail = speakable.slice(-20);
          const idx = tail.indexOf("<jake_action>");
          if (idx >= 0) {
            const cut = speakable.length - (tail.length - idx);
            speakable = speakable.slice(0, cut);
            holdingTag = true;
            tagBuffer = "<jake_action>";
          }
        }

        // Flush completed sentences to TTS.
        const lastBoundary = speakable.search(flushBoundary);
        if (lastBoundary >= 0) {
          const ready = speakable.slice(0, lastBoundary + 1);
          speakable = speakable.slice(lastBoundary + 1);
          streamTTS(ready).catch(() => { /* */ });
        }
      });

      try {
        await stream.finalMessage();
      } catch (err: any) {
        console.error("[jake/voice-stream] Anthropic stream error:", err?.message);
      }
      if (speakable.trim()) await streamTTS(speakable);

      // Parse and execute any actions, then store the message pair.
      const { stripped, actions } = extractActions(fullReply);
      const results: ActionResult[] = [];
      const latestUserText = latestUser.content ?? "";
      const hasExplicitSendConfirm = CLIENT_EMAIL_CONFIRM_PATTERN.test(latestUserText);
      for (const a of actions) {
        // Hard guard: client-facing email actions require Chris's latest
        // message to contain an explicit send confirmation. This stops
        // Jake from autonomously emailing a real client because Chris
        // was thinking out loud about that account.
        if ((a.type === "email_client" || a.type === "share_progress" || a.type === "send_documents") && !hasExplicitSendConfirm) {
          results.push({
            type: a.type,
            ok: false,
            message: "Refused: Chris's latest message had no explicit send confirmation (\"send it\", \"yes, send\", \"fire it off\", etc.). Draft a preview and wait for him to confirm in the next turn.",
          });
          continue;
        }
        const r = await executeAction(a);
        results.push(r);
      }

      let writtenConversationId = conversationId;
      try {
        if (!writtenConversationId) {
          const r = await db.execute(sql`
            INSERT INTO jake_voice_conversations DEFAULT VALUES RETURNING id
          `);
          writtenConversationId = (((r as any)?.rows?.[0] ?? (r as any)?.[0]) as { id: string }).id;
        }
        await db.execute(sql`
          INSERT INTO jake_voice_messages (conversation_id, role, content)
          VALUES (${writtenConversationId}, 'user', ${latestUser.content})
        `);
        await db.execute(sql`
          INSERT INTO jake_voice_messages (conversation_id, role, content, actions)
          VALUES (${writtenConversationId}, 'assistant', ${stripped.trim()}, ${actions.length ? JSON.stringify(results) : null}::jsonb)
        `);
        await db.execute(sql`
          UPDATE jake_voice_conversations
          SET last_message_at = now()
          WHERE id = ${writtenConversationId}
        `);
      } catch (err) {
        console.error("Jake voice memory write failed:", err);
      }

      sendDone({
        fullReply: stripped,
        actions: results,
        conversationId: writtenConversationId,
      });
      try { res.end(); } catch { /* */ }
    } catch (error: any) {
      console.error("Jake voice-stream fatal:", error);
      if (!res.headersSent) res.status(500).json({ error: error?.message ?? "Jake voice stream failed" });
      else try { res.end(); } catch { /* */ }
    }
  });
}
