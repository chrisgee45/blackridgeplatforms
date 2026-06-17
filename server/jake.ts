/**
 * Jake — Chris's AI assistant for active project clients.
 *
 * Activates per-project. On enable, Jake sends an intro email and starts
 * monitoring the dedicated jake@ inbox. Inbound replies are stored against
 * the project (and surfaced under the project's client too), then a
 * generate_jake_reply job runs Claude to produce + send a response.
 *
 * Handoff: when the conversation hits any sensitive topic (pricing,
 * contract, scope, complaint, deadline change), Jake stops replying,
 * flags the project, and pushes Chris a notification.
 */
import Anthropic from "@anthropic-ai/sdk";
import { Resend } from "resend";
import { db } from "./db";
import { projects, projectConversations, projectDocuments, clients, contacts, companies, outreachJobs, tasks, milestones } from "@shared/schema";
import { eq, desc, asc, gte } from "drizzle-orm";
import { isPushConfigured, sendPushToAll } from "./push";
import { ObjectStorageService } from "./object-storage";

const JAKE_FROM_EMAIL = process.env.JAKE_FROM_EMAIL || "jake@blackridgeplatforms.com";
const JAKE_FROM_NAME = process.env.JAKE_FROM_NAME || "Jake at BlackRidge";

export const JAKE_SYSTEM_PROMPT = `You are Jake, Chris Gee's personal assistant at BlackRidge Platforms.
You handle email correspondence on Chris's behalf with both active project
clients (during a build) and recurring clients (hosting / monthly
maintenance after launch).
You are NOT Chris. You are his assistant. Your title is "Client Relations
Specialist". Every email MUST end with this exact four-line signature,
no variations:

Sincerely,
Jake
Client Relations Specialist
BlackRidge Platforms

ABOUT BLACKRIDGE
BlackRidge Platforms is Chris's company. We build custom websites, client portals, CRM systems, project management tools, accounting/invoicing platforms, and AI tools — all hand-built for the specific business. No WordPress, no Wix, no templates. The client owns what we build.

ABOUT CHRIS
Former law enforcement turned tech entrepreneur. Direct, no-nonsense, takes full ownership of every client's digital infrastructure. He builds what he wished he could buy.

THE TECH WE USE (only mention if a client asks)
React + TypeScript on the front-end, Express + Node + Postgres on the back-end, Drizzle for the schema, Tailwind for styling, Stripe for payments, Resend for email, AWS S3 for file storage, Anthropic for AI features. Hosted on Railway with daily encrypted backups. Mobile-responsive, accessibility-aware (WCAG AA), SEO-ready (schema.org, sitemap, meta) — all baked in, not bolted on.

QUALITY BAR
Every site we ship runs through a 50+ item QA checklist covering accessibility, forms, UI/UX, legal, mobile, performance, SEO, and security. Lighthouse scores 90+ across the board. Page loads under 2 seconds.

YOUR VOICE AS JAKE
- Warm but efficient. Service-oriented, not salesy.
- Direct sentences. No fluff. No corporate speak.
- Never say "I hope this finds you well," "circle back," "synergy," "leverage," or "value proposition."
- No em dashes (use commas or periods instead).
- First person as Jake. Treat the client as a peer.
- Acknowledge first, answer second, set the next step third, close warmly fourth.

WHAT YOU CAN HANDLE YOURSELF
- Status questions ("how's it coming," "when can I see X")
- General questions about how the build works, what stage we're in
- Acknowledging requests / change ideas (then queue them up for Chris)
- Friendly check-ins, scheduling small things
- Sharing what tech / approach we're using if asked
- Reassurance, expectation-setting, pointing them to the next milestone

USING THE PROJECT BRIEF
The user message includes a PROJECT BRIEF section with description / notes / contract terms for THIS specific project. Treat the brief as authoritative. If the client asks about something the brief covers (pricing structure, what's included, upfront vs. subscription, scope), answer directly using the brief. Do NOT hand off just because the topic is sensitive — only hand off when the brief does NOT cover the question.

THREE WAYS TO RESPOND — pick exactly one per inbound

A) REPLY ALONE — the default. You answer the client directly. Use this when you can fully address their message yourself, even on sensitive topics that the project brief covers.

B) REPLY + NOTIFY CHRIS — you still reply to the client, AND set notifyChris true with notifyReason. Use this whenever the client is asking Chris to DO something (add a feature, add content, change copy, send something over, make a call, schedule a meeting), or relaying anything Chris should know about even though it isn't urgent. You acknowledge the request in your reply ("I'll let Chris know — he'll handle it from here"), and a push notification goes to Chris with your notifyReason summarizing what's needed. This is the default for client requests.

C) HANDOFF — set handoff true, leave reply empty. ONLY use this when you genuinely cannot or should not answer. Examples that warrant a true handoff:
- Complaints, anger, frustration, or anything that hints at the client being unhappy
- A renegotiation of terms the brief explicitly states (client asks for a discount on a price the brief locks in)
- Money / scope questions the brief does NOT cover at all
- The client's message is empty, unreadable, or you cannot tell what they're asking
- Anything you genuinely don't know with confidence

Default behavior: pick (B) — REPLY + NOTIFY CHRIS — whenever the client is asking Chris to do something. Reserve (C) handoff for the short list above. Most messages will be (A) or (B), few will be (C).

CRITICAL RULES
- Read the client's MOST RECENT message carefully and respond to what they actually said. Never send a generic "checking in" or follow-up unless the client explicitly asked for a status check.
- Do NOT send a reply that ignores the client's question.
- Do NOT invent details that aren't in the project brief. If the brief says "no upfront, subscription only", say exactly that — don't add caveats Chris didn't authorize.
- When notifying Chris, write notifyReason as a short one-liner Chris can act on without re-reading the thread — e.g. "Wants to add a contact form to the homepage" or "Asking for a Zoom this Friday".

OUTPUT
Call the respond_to_client tool. Put the email body in 'reply' with real
newlines for paragraph breaks. End every reply with the four-line signature
above (unless handing off, in which case leave reply empty).`;

function getResendClient(): { client: Resend; fromEmail: string; fromName: string } | null {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return null;
  return {
    client: new Resend(apiKey),
    fromEmail: JAKE_FROM_EMAIL,
    fromName: JAKE_FROM_NAME,
  };
}

interface ClientContext {
  project: typeof projects.$inferSelect;
  contactName: string | null;
  contactEmail: string | null;
  companyName: string | null;
  clientName: string | null;
  clientNotes: string | null;
}

interface TimelineSnapshot {
  recentlyCompleted: { title: string; completedAt: string | null }[];
  inProgress: { title: string }[];
  upNext: { title: string; dueDate: string | null }[];
  milestones: { title: string; status: string | null; dueDate: string | null }[];
}

async function gatherTimeline(projectId: string): Promise<TimelineSnapshot> {
  const allTasks = await db.select().from(tasks).where(eq(tasks.projectId, projectId)).orderBy(asc(tasks.sortOrder));
  const allMilestones = await db.select().from(milestones).where(eq(milestones.projectId, projectId)).orderBy(asc(milestones.dueDate));

  const done = allTasks.filter(t => t.status === "done");
  done.sort((a, b) => new Date(b.completedAt ?? 0).getTime() - new Date(a.completedAt ?? 0).getTime());
  const recentlyCompleted = done.slice(0, 8).map(t => ({
    title: t.title,
    completedAt: t.completedAt ? new Date(t.completedAt).toISOString().slice(0, 10) : null,
  }));

  const inProgress = allTasks
    .filter(t => t.status === "in_progress")
    .slice(0, 8)
    .map(t => ({ title: t.title }));

  const upNext = allTasks
    .filter(t => t.status === "todo" || t.status === "waiting_on_client")
    .slice(0, 8)
    .map(t => ({
      title: t.title,
      dueDate: t.dueDate ? new Date(t.dueDate).toISOString().slice(0, 10) : null,
    }));

  const milestonesView = allMilestones.slice(0, 6).map(m => ({
    title: m.title,
    status: m.completedAt ? "completed" : null,
    dueDate: m.dueDate ? new Date(m.dueDate).toISOString().slice(0, 10) : null,
  }));

  return { recentlyCompleted, inProgress, upNext, milestones: milestonesView };
}

function renderTimelineForPrompt(t: TimelineSnapshot): string {
  const sections: string[] = [];
  if (t.milestones.length) {
    sections.push("Milestones:");
    for (const m of t.milestones) {
      sections.push(`- ${m.title}${m.status ? ` [${m.status}]` : ""}${m.dueDate ? ` (due ${m.dueDate})` : ""}`);
    }
  }
  if (t.recentlyCompleted.length) {
    sections.push("\nRecently completed:");
    for (const x of t.recentlyCompleted) sections.push(`- ${x.title}${x.completedAt ? ` (${x.completedAt})` : ""}`);
  }
  if (t.inProgress.length) {
    sections.push("\nIn progress right now:");
    for (const x of t.inProgress) sections.push(`- ${x.title}`);
  }
  if (t.upNext.length) {
    sections.push("\nUp next:");
    for (const x of t.upNext) sections.push(`- ${x.title}${x.dueDate ? ` (due ${x.dueDate})` : ""}`);
  }
  return sections.length ? sections.join("\n") : "No tasks logged yet for this project.";
}

async function gatherContext(projectId: string): Promise<ClientContext | null> {
  const [proj] = await db.select().from(projects).where(eq(projects.id, projectId));
  if (!proj) return null;

  let contactName: string | null = null;
  let contactEmail: string | null = null;
  let companyName: string | null = null;
  let clientName: string | null = null;
  let clientNotes: string | null = null;

  if (proj.contactId) {
    const [c] = await db.select().from(contacts).where(eq(contacts.id, proj.contactId));
    if (c) {
      contactName = c.name ?? null;
      contactEmail = c.email ?? null;
    }
  }
  if (proj.companyId) {
    const [co] = await db.select().from(companies).where(eq(companies.id, proj.companyId));
    if (co) companyName = co.name ?? null;
  }
  if (proj.clientId) {
    const [cl] = await db.select().from(clients).where(eq(clients.id, proj.clientId));
    if (cl) {
      clientName = cl.name ?? null;
      clientNotes = cl.notes ?? null;
      // Use the client's email as a fallback if no project contact exists.
      if (!contactEmail) contactEmail = cl.email ?? null;
    }
  }

  return { project: proj, contactName, contactEmail, companyName, clientName, clientNotes };
}

function firstName(full: string | null | undefined): string {
  if (!full) return "there";
  const first = full.trim().split(/\s+/)[0];
  return first || "there";
}

export async function enableJakeForProject(projectId: string): Promise<{ ok: boolean; message: string }> {
  const ctx = await gatherContext(projectId);
  if (!ctx) return { ok: false, message: "Project not found" };
  if (!ctx.contactEmail) {
    return { ok: false, message: "No client email on file for this project. Add one to the linked client or contact first." };
  }

  await db.update(projects)
    .set({ jakeEnabled: true, jakeStartedAt: new Date(), jakeAwaitingHandoff: false, jakeHandoffReason: null })
    .where(eq(projects.id, projectId));

  const intro = renderIntroEmail(ctx);
  const resend = getResendClient();
  let messageId: string | undefined;
  if (resend) {
    try {
      const result = await resend.client.emails.send({
        from: `${resend.fromName} <${resend.fromEmail}>`,
        to: ctx.contactEmail,
        replyTo: resend.fromEmail,
        subject: intro.subject,
        html: `<div style="font-family: Arial, sans-serif; max-width: 600px; line-height: 1.6;">${intro.body.replace(/\n/g, "<br>")}</div>`,
        tags: [
          { name: "projectId", value: ctx.project.id },
          { name: "agent", value: "jake" },
        ],
      });
      messageId = (result as any)?.data?.id;
    } catch (err: any) {
      console.error("Jake intro email send failed:", err?.message);
      return { ok: false, message: `Couldn't send intro email: ${err?.message ?? "unknown error"}` };
    }
  } else {
    console.log("RESEND_API_KEY not set — Jake intro email simulated.");
  }

  await db.insert(projectConversations).values({
    projectId: ctx.project.id,
    clientId: ctx.project.clientId ?? null,
    direction: "outbound",
    fromEmail: JAKE_FROM_EMAIL,
    toEmail: ctx.contactEmail,
    subject: intro.subject,
    body: intro.body,
    aiGenerated: true,
    resendMessageId: messageId ?? null,
    classification: "INTRO",
  });

  return { ok: true, message: `Jake activated. Intro email sent to ${ctx.contactEmail}.` };
}

export async function disableJakeForProject(projectId: string): Promise<{ ok: boolean }> {
  await db.update(projects)
    .set({ jakeEnabled: false })
    .where(eq(projects.id, projectId));
  return { ok: true };
}

const JAKE_SIGNATURE =
`Sincerely,
Jake
Client Relations Specialist
BlackRidge Platforms`;

function renderIntroEmail(ctx: ClientContext): { subject: string; body: string } {
  const greeting = firstName(ctx.contactName ?? ctx.clientName);
  const projectLabel = ctx.project.name;
  const stage = ctx.project.stage ?? "";
  const isMaintenance = stage === "completed" || stage === "archived";

  if (isMaintenance) {
    // Recurring / hosting client — the build is done. Introduce Jake as a
    // new addition to the BlackRidge team who'll be handling ongoing
    // client comms going forward.
    const subject = `Quick intro from BlackRidge — ${projectLabel}`;
    const body =
`Hey ${greeting},

Jake here, a new addition to the BlackRidge team. Chris brought me on to handle the day-to-day with our clients, and that includes you. Wanted to introduce myself so the name and address are familiar the next time you need something.

A few quick things:

1. Save this address: ${JAKE_FROM_EMAIL}. Any time you want to make a change, add something to your site, ask a question, or just check in, hit reply on this thread. You'll hear back from me fast.

2. If you ever bring up something Chris needs to handle personally, I'll loop him in right away so nothing gets dropped.

3. I'll also be checking in periodically just to make sure your site is humming along the way you want it to.

Thanks for sticking with us. We're glad you're still here, and I'm looking forward to getting to know you.

${JAKE_SIGNATURE}`;
    return { subject, body };
  }

  // Active build — the original intro for in-flight projects.
  const subject = `Quick hello — ${projectLabel}`;
  const body =
`Hey ${greeting},

Jake here, Chris's assistant at BlackRidge. Wanted to say thanks for putting your trust in us on the ${projectLabel} build, we're glad you're here.

Chris is heads-down on the work, so I'll be your day-to-day point of contact. If you ever have a question, a comment, an idea, or just want a status check, hit reply on this thread and you'll hear back from me fast. No question is too small.

Anything you'd love to see in the final build that we haven't talked about yet, send it over. Easier to bake it in now than bolt it on later.

${JAKE_SIGNATURE}`;
  return { subject, body };
}

function renderCheckinEmail(ctx: ClientContext): { subject: string; body: string } {
  const greeting = firstName(ctx.contactName ?? ctx.clientName);
  const projectLabel = ctx.project.name;
  const subject = `Quick check-in — ${projectLabel}`;
  const body =
`Hey ${greeting},

Jake here, just a quick check-in. Everything running smoothly on your end? Any small changes you've been meaning to ask about, content updates, or anything that's been on your mind?

If yes, hit reply with whatever it is and I'll take care of it (or loop Chris in if it needs his hands). If everything's good, no need to reply, I'll touch base again in a couple weeks.

${JAKE_SIGNATURE}`;
  return { subject, body };
}

// ─────────────────────────────────────────────────────────────────────────
// Inbound webhook handler — called by /api/jake/inbound
// ─────────────────────────────────────────────────────────────────────────

interface InboundAttachment {
  filename?: string;
  content_type?: string;
  content_disposition?: string;
  url?: string;
  content?: string; // base64-encoded
  size?: number;
}

const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024; // 25 MB per file
const MIN_ATTACHMENT_BYTES = 1024;             // skip tracking pixels / signature dots

/**
 * Download every attachment on an inbound email, push the bytes into
 * object storage, and create a project_documents row tagged
 * "client_upload" so the file shows up in the project's Documents tab
 * right next to Chris's own uploads.
 */
async function persistClientAttachments(
  projectId: string,
  fromEmail: string,
  attachments: InboundAttachment[],
): Promise<string[]> {
  if (!Array.isArray(attachments) || attachments.length === 0) return [];
  const service = new ObjectStorageService();
  const savedFilenames: string[] = [];

  for (const att of attachments) {
    try {
      if ((att.content_disposition ?? "").toLowerCase() === "inline") continue;

      let buf: Buffer | null = null;
      if (att.url) {
        const resp = await fetch(att.url);
        if (resp.ok) buf = Buffer.from(await resp.arrayBuffer());
      } else if (att.content) {
        buf = Buffer.from(att.content, "base64");
      }
      if (!buf || buf.length < MIN_ATTACHMENT_BYTES) continue;
      if (buf.length > MAX_ATTACHMENT_BYTES) {
        console.warn(`Jake: skipping oversized attachment ${att.filename} (${buf.length} bytes)`);
        continue;
      }

      const filename = (att.filename || "attachment").trim().slice(0, 200) || "attachment";
      const contentType = att.content_type || "application/octet-stream";
      const { storageKey } = await service.saveBuffer(buf, contentType);

      await db.insert(projectDocuments).values({
        projectId,
        filename,
        storageKey,
        category: "client_upload",
        fileSize: buf.length,
        contentType,
        uploadedBy: fromEmail || "client",
      });
      savedFilenames.push(filename);
    } catch (err: any) {
      console.error(`Jake: failed to persist attachment ${att?.filename}:`, err?.message);
    }
  }
  return savedFilenames;
}

export async function handleJakeInbound(data: any): Promise<{ ok: boolean }> {
  const fromEmail = (data?.from || data?.from_address || data?.sender || "").replace(/.*</, "").replace(/>.*/, "").trim().toLowerCase();
  const toRaw = data?.to ?? data?.to_address ?? data?.recipient ?? "";
  const toEmail = Array.isArray(toRaw) ? toRaw[0] : toRaw;
  const subject = data?.subject || "";
  const messageId = data?.message_id || data?.email_id || data?.id || null;
  const emailId = data?.email_id || data?.id || null;

  // Resend's email.received webhook intentionally ships metadata only —
  // body, headers, and attachments are excluded by design. Fetch the body
  // from the Received Emails API by email_id. (SDK v4 doesn't expose
  // emails.receiving yet, so we hit REST directly.)
  let textBody = "";
  let inboundAttachments: InboundAttachment[] = [];
  if (emailId) {
    const apiKey = process.env.RESEND_API_KEY;
    if (apiKey) {
      try {
        const res = await fetch(`https://api.resend.com/emails/receiving/${emailId}`, {
          headers: { Authorization: `Bearer ${apiKey}` },
        });
        if (res.ok) {
          const payload = await res.json() as { text?: string; html?: string; attachments?: InboundAttachment[] };
          const text = payload.text?.trim() || "";
          const htmlStripped = payload.html
            ? payload.html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim()
            : "";
          textBody = text || htmlStripped;
          if (Array.isArray(payload.attachments)) inboundAttachments = payload.attachments;
        } else {
          console.error(`Jake receiving fetch ${emailId} → ${res.status}`);
        }
      } catch (err: any) {
        console.error(`Jake receiving fetch ${emailId} threw:`, err?.message);
      }
    }
  }

  console.log(`Jake inbound: from=${fromEmail} subject="${subject}" bodyLen=${textBody.length} emailId=${emailId}`);

  if (!fromEmail) return { ok: true };

  // Match this email to an active Jake-enabled project by client/contact email.
  const project = await findActiveProjectForEmail(fromEmail);
  if (!project) {
    console.log(`Jake: inbound from ${fromEmail} matched no active Jake project — ignoring`);
    return { ok: true };
  }

  // Save any attachments into the project's Documents tab so Chris sees
  // them right next to his own uploads. Done before logging the
  // conversation so the body can mention what arrived.
  const savedAttachments = await persistClientAttachments(project.id, fromEmail, inboundAttachments);
  if (savedAttachments.length > 0) {
    console.log(`Jake: saved ${savedAttachments.length} attachment(s) for project ${project.id}: ${savedAttachments.join(", ")}`);
  }

  const attachmentFooter = savedAttachments.length > 0
    ? `\n\n[${savedAttachments.length} attachment${savedAttachments.length === 1 ? "" : "s"} saved to project documents: ${savedAttachments.join(", ")}]`
    : "";

  await db.insert(projectConversations).values({
    projectId: project.id,
    clientId: project.clientId ?? null,
    direction: "inbound",
    fromEmail,
    toEmail: toEmail || JAKE_FROM_EMAIL,
    subject,
    body: (textBody || "(empty)") + attachmentFooter,
    aiGenerated: false,
    resendMessageId: messageId,
  });

  if (project.jakeAwaitingHandoff) {
    console.log(`Jake: project ${project.id} already awaiting handoff — notifying Chris`);
    await notifyHandoff(project.id, "Client replied while awaiting handoff");
    return { ok: true };
  }

  // If we still couldn't get a body, hand off rather than have Jake
  // respond to nothing.
  if (!textBody || textBody.trim().length < 5) {
    await db.update(projects)
      .set({ jakeAwaitingHandoff: true, jakeHandoffReason: "Client replied but the email body was empty. Open the email directly to read it." })
      .where(eq(projects.id, project.id));
    await notifyHandoff(project.id, "Client replied with an empty/unreadable body");
    return { ok: true };
  }

  // Queue an AI reply via the existing outreach jobs runner.
  await db.insert(outreachJobs).values({
    type: "generate_jake_reply",
    payload: { project_id: project.id },
    runAt: new Date(Date.now() + 5000),
  });

  console.log(`Jake: queued reply for project ${project.id} (from ${fromEmail})`);
  return { ok: true };
}

async function findActiveProjectForEmail(fromEmail: string): Promise<typeof projects.$inferSelect | null> {
  // Pull all jake_enabled projects whose linked contact OR client email
  // matches the sender. Most recent jakeStartedAt wins when the same
  // person is on multiple builds (last-touched project takes precedence).
  const allActive = await db
    .select()
    .from(projects)
    .where(eq(projects.jakeEnabled, true))
    .orderBy(desc(projects.jakeStartedAt));

  for (const p of allActive) {
    if (p.contactId) {
      const [c] = await db.select().from(contacts).where(eq(contacts.id, p.contactId));
      if (c?.email && c.email.trim().toLowerCase() === fromEmail) return p;
    }
    if (p.clientId) {
      const [cl] = await db.select().from(clients).where(eq(clients.id, p.clientId));
      if (cl?.email && cl.email.trim().toLowerCase() === fromEmail) return p;
    }
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────
// Reply generation — invoked by the outreach jobs runner for
// `generate_jake_reply` jobs.
// ─────────────────────────────────────────────────────────────────────────

export async function processJakeReplyJob(payload: { project_id: string }): Promise<void> {
  const projectId = payload.project_id;
  const ctx = await gatherContext(projectId);
  if (!ctx || !ctx.project.jakeEnabled) return;
  if (ctx.project.jakeAwaitingHandoff) return;
  if (!ctx.contactEmail) return;

  const history = await db
    .select()
    .from(projectConversations)
    .where(eq(projectConversations.projectId, projectId))
    .orderBy(projectConversations.createdAt);

  const threadText = history.map(c => {
    const who = c.direction === "outbound" ? "JAKE" : "CLIENT";
    return `${who} (${new Date(c.createdAt).toISOString()}):\n${c.body}`;
  }).join("\n\n---\n\n");

  const stageLabel = ctx.project.stage?.replace(/_/g, " ") ?? "in progress";
  const timeline = await gatherTimeline(projectId);

  // Pricing / scope / billing answers come from this section. Jake is told
  // to treat it as the source of truth — answer directly when it covers
  // the client's question, hand off only when it doesn't.
  const projectBriefSections: string[] = [];
  if (ctx.project.description?.trim()) {
    projectBriefSections.push(`Project description / notes:\n${ctx.project.description.trim()}`);
  }
  if (ctx.clientNotes?.trim()) {
    projectBriefSections.push(`Client-level notes:\n${ctx.clientNotes.trim()}`);
  }
  if (ctx.project.contractValue != null) {
    projectBriefSections.push(`Contract value on record: $${ctx.project.contractValue.toLocaleString()}`);
  }
  if (ctx.project.hourlyRate != null) {
    projectBriefSections.push(`Hourly rate on record: $${ctx.project.hourlyRate}/hr`);
  }
  const projectBrief = projectBriefSections.length
    ? projectBriefSections.join("\n\n")
    : "(no project-specific notes are recorded)";

  // Progress screenshots — Chris uploads to the Documents tab under the
  // "progress" category. When the client asks for an update / pictures /
  // designs, Jake can choose to attach them in his reply.
  const progressDocs = await db
    .select()
    .from(projectDocuments)
    .where(eq(projectDocuments.projectId, projectId))
    .orderBy(desc(projectDocuments.createdAt));
  const availableProgress = progressDocs.filter(d => d.category === "progress" && /image\//i.test(d.contentType ?? ""));
  const progressList = availableProgress.length === 0
    ? "(no progress screenshots have been uploaded for this project yet)"
    : availableProgress.slice(0, 8).map(d =>
        `- id=${d.id} | filename=${d.filename}${d.notes ? ` | note: ${d.notes}` : ""} | uploaded ${d.createdAt ? new Date(d.createdAt).toISOString().slice(0, 10) : "?"}`
      ).join("\n");

  const projectContext = `Project: ${ctx.project.name}
Current stage: ${stageLabel}
Client: ${ctx.clientName ?? ctx.companyName ?? "the client"}
Contact: ${ctx.contactName ?? "the client"}

PROJECT BRIEF (treat this as authoritative for this project — when it answers the client's question, answer using it; only hand off if it does NOT cover the question)
${projectBrief}

PROJECT TIMELINE (use to give accurate status updates — only mention specifics if the client asks or it's directly relevant)
${renderTimelineForPrompt(timeline)}

AVAILABLE PROGRESS SCREENSHOTS (only mention if the client asks for an update / progress / sneak peek / designs)
${progressList}

If the client requests visual progress AND screenshots are available, set attachProgress to true and list the progress doc ids in attachProgressIds. Jake's email will go out with those images attached — you don't need to embed links yourself.`;

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 2000,
    system: JAKE_SYSTEM_PROMPT,
    // Force a tool call with a typed schema. This sidesteps the
    // JSON-in-text fragility (Claude occasionally emits raw newlines
    // inside strings, breaking JSON.parse and triggering the safety
    // handoff). With a tool, the SDK returns input as a real object.
    tools: [{
      name: "respond_to_client",
      description: "Produce Jake's reply to the client. Optionally notify Chris (he gets a push) while still replying. Reserve handoff for cases Jake genuinely can't answer.",
      input_schema: {
        type: "object",
        properties: {
          classification: {
            type: "string",
            enum: ["STATUS_QUESTION", "GENERAL_QUESTION", "REQUEST", "SCHEDULING", "REASSURANCE", "HANDOFF"],
            description: "Category of the client's latest message.",
          },
          reply: {
            type: "string",
            description: "The email body Jake will send. Use actual newlines for paragraph breaks. End with the four-line signature (Sincerely / Jake / Client Relations Specialist / BlackRidge Platforms). Leave empty ONLY when handoff is true.",
          },
          notifyChris: {
            type: "boolean",
            description: "True when Chris needs to know something but Jake is still replying. Use whenever the client requests something for Chris to do (add a feature, schedule a call, send something, change copy). Jake's reply still goes out; Chris gets a push with notifyReason.",
          },
          notifyReason: {
            type: "string",
            description: "Required when notifyChris is true. One short sentence Chris can act on without re-reading the thread (e.g. 'Wants a contact form on the homepage', 'Asking for a Zoom Friday').",
          },
          handoff: {
            type: "boolean",
            description: "True ONLY for complaints, frustration, renegotiation of brief terms, messages Jake can't read, or topics he genuinely doesn't know. When true, leave reply empty.",
          },
          handoffReason: {
            type: "string",
            description: "Required when handoff is true. One sentence explaining what Chris needs to address.",
          },
          attachProgress: {
            type: "boolean",
            description: "True when the client asked for an update / progress / sneak peek / designs AND progress screenshots are available in the AVAILABLE PROGRESS SCREENSHOTS list. Jake's email will include those images as attachments.",
          },
          attachProgressIds: {
            type: "array",
            items: { type: "string" },
            description: "Required when attachProgress is true. List of document IDs from AVAILABLE PROGRESS SCREENSHOTS to attach (pick the most recent + relevant, up to 6).",
          },
        },
        required: ["classification", "reply", "handoff"],
      },
    }],
    tool_choice: { type: "tool", name: "respond_to_client" },
    messages: [{
      role: "user",
      content: `${projectContext}\n\nConversation so far:\n\n${threadText}\n\nThe client's most recent message is at the bottom. Respond to it as Jake.`,
    }],
  });

  const toolBlock = response.content.find(b => b.type === "tool_use") as
    | { type: "tool_use"; name: string; input: Record<string, unknown> }
    | undefined;

  let parsed: {
    classification?: string;
    reply?: string;
    handoff?: boolean;
    handoffReason?: string;
    notifyChris?: boolean;
    notifyReason?: string;
    attachProgress?: boolean;
    attachProgressIds?: string[];
  };
  if (toolBlock && typeof toolBlock.input === "object") {
    parsed = {
      classification: typeof toolBlock.input.classification === "string" ? toolBlock.input.classification : undefined,
      reply: typeof toolBlock.input.reply === "string" ? toolBlock.input.reply : undefined,
      handoff: !!toolBlock.input.handoff,
      handoffReason: typeof toolBlock.input.handoffReason === "string" ? toolBlock.input.handoffReason : undefined,
      notifyChris: !!toolBlock.input.notifyChris,
      notifyReason: typeof toolBlock.input.notifyReason === "string" ? toolBlock.input.notifyReason : undefined,
      attachProgress: !!toolBlock.input.attachProgress,
      attachProgressIds: Array.isArray(toolBlock.input.attachProgressIds)
        ? toolBlock.input.attachProgressIds.filter((id: unknown) => typeof id === "string") as string[]
        : undefined,
    };
  } else {
    // Refusal or malformed tool use — fall back to a handoff so we never
    // ship something we couldn't verify.
    console.error("Jake reply tool-use missing:", JSON.stringify(response.content).slice(0, 1000));
    parsed = { handoff: true, handoffReason: "Jake didn't return a usable response; needs human review." };
  }

  if (parsed.handoff) {
    // Jake doesn't know the answer. Push Chris IMMEDIATELY so he can type
    // a response in the OPS portal; Jake will relay it back to the client
    // when Chris submits it.
    const lastInboundForHandoff = history.filter(c => c.direction === "inbound").slice(-1)[0];
    const clientQuestion = lastInboundForHandoff?.body?.slice(0, 220) ?? "";
    await db.update(projects)
      .set({
        jakeAwaitingHandoff: true,
        jakeHandoffReason: parsed.handoffReason || "Jake needs your answer to relay back to the client.",
      })
      .where(eq(projects.id, projectId));
    await db.insert(projectConversations).values({
      projectId,
      clientId: ctx.project.clientId ?? null,
      direction: "outbound",
      fromEmail: JAKE_FROM_EMAIL,
      toEmail: ctx.contactEmail,
      subject: null,
      body: parsed.handoffReason ?? "Handoff to Chris.",
      aiGenerated: true,
      classification: "HANDOFF",
      handoffTriggered: true,
      handoffReason: parsed.handoffReason ?? null,
    });
    await notifyHandoff(
      projectId,
      `${parsed.handoffReason ?? "Needs your answer"}${clientQuestion ? ` — they asked: "${clientQuestion}"` : ""}`,
    );
    return;
  }

  let replyBody = parsed.reply?.trim();
  if (!replyBody) return;
  // Belt-and-suspenders: even though the system prompt mandates the
  // signature, append it if the model forgot or shortened it. Skip when
  // the title line is already present so we don't double-stamp.
  if (!/client\s+relations\s+specialist/i.test(replyBody)) {
    replyBody = `${replyBody.replace(/\s+$/, "")}\n\n${JAKE_SIGNATURE}`;
  }

  // Pull the latest inbound to thread the reply.
  const lastInbound = history.filter(c => c.direction === "inbound").slice(-1)[0];
  const replySubject = lastInbound?.subject
    ? lastInbound.subject.startsWith("Re:") ? lastInbound.subject : `Re: ${lastInbound.subject}`
    : `Re: ${ctx.project.name}`;

  // Build attachments when Jake chose to share progress screenshots.
  let attachments: { filename: string; content: string }[] | undefined;
  if (parsed.attachProgress && parsed.attachProgressIds?.length) {
    attachments = await loadProgressAttachments(parsed.attachProgressIds);
  }

  let messageId: string | undefined;
  const resend = getResendClient();
  if (resend) {
    try {
      const emailPayload: any = {
        from: `${resend.fromName} <${resend.fromEmail}>`,
        to: ctx.contactEmail,
        replyTo: resend.fromEmail,
        subject: replySubject,
        html: `<div style="font-family: Arial, sans-serif; max-width: 600px; line-height: 1.6;">${replyBody.replace(/\n/g, "<br>")}</div>`,
        tags: [
          { name: "projectId", value: projectId },
          { name: "agent", value: "jake" },
        ],
      };
      if (attachments && attachments.length > 0) {
        emailPayload.attachments = attachments;
      }
      if (lastInbound?.resendMessageId) {
        emailPayload.headers = { "In-Reply-To": lastInbound.resendMessageId };
      }
      const result = await resend.client.emails.send(emailPayload);
      messageId = (result as any)?.data?.id;
    } catch (err: any) {
      console.error("Jake reply send failed:", err?.message);
      return;
    }
  } else {
    console.log(`RESEND_API_KEY not set — simulating Jake reply to ${ctx.contactEmail}`);
  }

  await db.insert(projectConversations).values({
    projectId,
    clientId: ctx.project.clientId ?? null,
    direction: "outbound",
    fromEmail: JAKE_FROM_EMAIL,
    toEmail: ctx.contactEmail,
    subject: replySubject,
    body: replyBody,
    aiGenerated: true,
    resendMessageId: messageId ?? null,
    inReplyToMessageId: lastInbound?.resendMessageId ?? null,
    classification: parsed.classification ?? null,
  });

  console.log(`Jake replied to ${ctx.contactEmail} re: ${ctx.project.name}`);

  // FYI push — client asked for something Chris needs to do. Jake already
  // sent the reply; this just makes sure Chris doesn't have to hunt for it.
  if (parsed.notifyChris) {
    await notifyChris(
      projectId,
      parsed.notifyReason ?? "Client request worth your attention",
      ctx.clientName ?? ctx.companyName,
    );
  }
}

async function notifyChris(projectId: string, reason: string, clientLabel?: string | null): Promise<void> {
  if (!isPushConfigured()) return;
  try {
    const [p] = await db.select().from(projects).where(eq(projects.id, projectId));
    const label = clientLabel ? `${clientLabel} via Jake` : `Jake — ${p?.name ?? "client request"}`;
    await sendPushToAll({
      title: label,
      body: reason,
      url: `/admin/ops/projects/${projectId}`,
    });
  } catch (err) {
    console.error("Jake notify-chris push failed:", err);
  }
}

async function notifyHandoff(projectId: string, reason: string): Promise<void> {
  if (!isPushConfigured()) return;
  try {
    const [p] = await db.select().from(projects).where(eq(projects.id, projectId));
    await sendPushToAll({
      title: `Jake → handoff on ${p?.name ?? "a project"}`,
      body: reason,
      url: `/admin/ops/projects/${projectId}`,
    });
  } catch (err) {
    console.error("Jake handoff push failed:", err);
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Reads used by the API routes
// ─────────────────────────────────────────────────────────────────────────

export async function getProjectConversations(projectId: string) {
  return db.select().from(projectConversations).where(eq(projectConversations.projectId, projectId)).orderBy(projectConversations.createdAt);
}

export async function getClientJakeConversations(clientId: string) {
  return db
    .select()
    .from(projectConversations)
    .where(eq(projectConversations.clientId, clientId))
    .orderBy(desc(projectConversations.createdAt));
}

export async function resolveHandoff(projectId: string) {
  await db.update(projects)
    .set({ jakeAwaitingHandoff: false, jakeHandoffReason: null })
    .where(eq(projects.id, projectId));
}

// Chris typed an answer in the handoff banner. Jake wraps it in his voice
// and sends it to the client in the existing thread, then clears the
// handoff so the next inbound flows normally.
export async function relayHandoffAnswer(projectId: string, chrisAnswer: string): Promise<{ ok: boolean; message?: string }> {
  const ctx = await gatherContext(projectId);
  if (!ctx) return { ok: false, message: "Project not found" };
  if (!ctx.contactEmail) return { ok: false, message: "No client email on file" };

  const history = await db
    .select()
    .from(projectConversations)
    .where(eq(projectConversations.projectId, projectId))
    .orderBy(projectConversations.createdAt);
  const lastInbound = history.filter(c => c.direction === "inbound").slice(-1)[0];
  const threadText = history.slice(-6).map(c => {
    const who = c.direction === "outbound" ? "JAKE" : "CLIENT";
    return `${who}:\n${c.body}`;
  }).join("\n\n---\n\n");

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 1500,
    system: `You are Jake, ${JAKE_FROM_NAME}, relaying Chris's answer back to a client. You are NOT Chris — you're his assistant translating his shorthand into a warm, polished email in Jake's voice.

Voice rules: warm but efficient, direct sentences, no corporate filler, no em dashes, no "I hope this finds you well". End with the exact four-line signature:

${JAKE_SIGNATURE}

Output ONLY the email body. No JSON, no preamble. Use real newlines.`,
    messages: [{
      role: "user",
      content: `Recent thread on the ${ctx.project.name} project with ${ctx.contactName ?? ctx.clientName ?? "the client"}:\n\n${threadText}\n\n---\n\nChris just sent you this answer for you to pass along to the client. Translate Chris's shorthand into a complete, polished email in Jake's voice. Don't add caveats Chris didn't authorize. Don't claim authority Jake doesn't have — phrase it as Chris's response that Jake is sharing.\n\nChris's answer:\n${chrisAnswer.trim()}`,
    }],
  });

  let body = response.content.map(b => (b.type === "text" ? b.text : "")).join("").trim();
  if (!body) {
    return { ok: false, message: "Jake couldn't generate a relay. Try again." };
  }
  if (!/client\s+relations\s+specialist/i.test(body)) {
    body = `${body.replace(/\s+$/, "")}\n\n${JAKE_SIGNATURE}`;
  }

  const subject = lastInbound?.subject
    ? lastInbound.subject.startsWith("Re:") ? lastInbound.subject : `Re: ${lastInbound.subject}`
    : `Re: ${ctx.project.name}`;

  let messageId: string | undefined;
  const resend = getResendClient();
  if (resend) {
    try {
      const payload: any = {
        from: `${resend.fromName} <${resend.fromEmail}>`,
        to: ctx.contactEmail,
        replyTo: resend.fromEmail,
        subject,
        html: `<div style="font-family: Arial, sans-serif; max-width: 600px; line-height: 1.6;">${body.replace(/\n/g, "<br>")}</div>`,
        tags: [
          { name: "projectId", value: projectId },
          { name: "agent", value: "jake" },
          { name: "kind", value: "handoff_relay" },
        ],
      };
      if (lastInbound?.resendMessageId) {
        payload.headers = { "In-Reply-To": lastInbound.resendMessageId };
      }
      const result = await resend.client.emails.send(payload);
      messageId = (result as any)?.data?.id;
    } catch (err: any) {
      return { ok: false, message: `Send failed: ${err?.message ?? "unknown"}` };
    }
  }

  await db.insert(projectConversations).values({
    projectId,
    clientId: ctx.project.clientId ?? null,
    direction: "outbound",
    fromEmail: JAKE_FROM_EMAIL,
    toEmail: ctx.contactEmail,
    subject,
    body,
    aiGenerated: true,
    resendMessageId: messageId ?? null,
    inReplyToMessageId: lastInbound?.resendMessageId ?? null,
    classification: "HANDOFF_RELAY",
  });

  await db.update(projects)
    .set({ jakeAwaitingHandoff: false, jakeHandoffReason: null })
    .where(eq(projects.id, projectId));

  return { ok: true, message: "Relayed via Jake and handoff cleared." };
}

// ─────────────────────────────────────────────────────────────────────────
// Periodic outreach for archived/completed projects
// Target cadence: minimum 3 contacts per month per active maintenance
// client, i.e. one outbound every ~10 days. Welcome lands on enable, then
// check-ins on the cadence.
// ─────────────────────────────────────────────────────────────────────────

const MAINTENANCE_CADENCE_DAYS = 10;

export async function runMaintenanceCadence(): Promise<{ scanned: number; queued: number }> {
  // Every Jake-enabled, completed/archived project gets a check-in if the
  // last outbound from Jake on that project was more than the cadence ago.
  const candidates = await db
    .select()
    .from(projects)
    .where(eq(projects.jakeEnabled, true));

  let scanned = 0;
  let queued = 0;
  const cadenceCutoff = new Date(Date.now() - MAINTENANCE_CADENCE_DAYS * 86400000);

  for (const p of candidates) {
    if (p.stage !== "completed" && p.stage !== "archived") continue;
    if (p.jakeAwaitingHandoff) continue;
    scanned++;

    const [lastOutbound] = await db
      .select()
      .from(projectConversations)
      .where(eq(projectConversations.projectId, p.id))
      .orderBy(desc(projectConversations.createdAt))
      .limit(1);

    const lastTouched = lastOutbound?.createdAt ? new Date(lastOutbound.createdAt) : null;
    if (lastTouched && lastTouched > cadenceCutoff) continue;

    await db.insert(outreachJobs).values({
      type: "generate_jake_checkin",
      payload: { project_id: p.id },
      runAt: new Date(Date.now() + 30000),
    });
    queued++;
  }
  if (queued > 0) console.log(`Jake maintenance cadence: scanned ${scanned}, queued ${queued} check-in(s)`);
  return { scanned, queued };
}

export async function processJakeCheckinJob(payload: { project_id: string }): Promise<void> {
  const ctx = await gatherContext(payload.project_id);
  if (!ctx || !ctx.project.jakeEnabled) return;
  if (ctx.project.jakeAwaitingHandoff) return;
  if (!ctx.contactEmail) return;
  if (ctx.project.stage !== "completed" && ctx.project.stage !== "archived") return;

  // Re-check cadence in case multiple jobs got queued for the same project.
  const [lastOutbound] = await db
    .select()
    .from(projectConversations)
    .where(eq(projectConversations.projectId, payload.project_id))
    .orderBy(desc(projectConversations.createdAt))
    .limit(1);
  const cadenceCutoff = new Date(Date.now() - MAINTENANCE_CADENCE_DAYS * 86400000);
  if (lastOutbound?.createdAt && new Date(lastOutbound.createdAt) > cadenceCutoff) return;

  const hasPriorContact = !!lastOutbound;
  const email = hasPriorContact ? renderCheckinEmail(ctx) : renderIntroEmail(ctx);

  let messageId: string | undefined;
  const resend = getResendClient();
  if (resend) {
    try {
      const result = await resend.client.emails.send({
        from: `${resend.fromName} <${resend.fromEmail}>`,
        to: ctx.contactEmail,
        replyTo: resend.fromEmail,
        subject: email.subject,
        html: `<div style="font-family: Arial, sans-serif; max-width: 600px; line-height: 1.6;">${email.body.replace(/\n/g, "<br>")}</div>`,
        tags: [
          { name: "projectId", value: ctx.project.id },
          { name: "agent", value: "jake" },
          { name: "kind", value: hasPriorContact ? "checkin" : "welcome" },
        ],
      });
      messageId = (result as any)?.data?.id;
    } catch (err: any) {
      console.error(`Jake check-in send failed for ${ctx.project.id}:`, err?.message);
      return;
    }
  }

  await db.insert(projectConversations).values({
    projectId: ctx.project.id,
    clientId: ctx.project.clientId ?? null,
    direction: "outbound",
    fromEmail: JAKE_FROM_EMAIL,
    toEmail: ctx.contactEmail,
    subject: email.subject,
    body: email.body,
    aiGenerated: true,
    resendMessageId: messageId ?? null,
    classification: hasPriorContact ? "CHECKIN" : "WELCOME",
  });
  console.log(`Jake ${hasPriorContact ? "check-in" : "welcome"} sent for ${ctx.project.name} (${ctx.contactEmail})`);
}

// ─────────────────────────────────────────────────────────────────────────
// Daily report — runs at 8am, summarises Jake's last 24h activity, sends
// Chris a single push digest, and exposes the data for the in-app page.
// ─────────────────────────────────────────────────────────────────────────

export interface JakeDailyReport {
  windowStart: string;
  windowEnd: string;
  totals: {
    inbound: number;
    replies: number;
    welcomes: number;
    checkins: number;
    notifies: number;
    openHandoffs: number;
  };
  projects: {
    projectId: string;
    projectName: string;
    clientName: string | null;
    inbound: number;
    replies: number;
    notifies: number;
    awaitingHandoff: boolean;
    handoffReason: string | null;
  }[];
  recentHandoffs: { projectId: string; projectName: string; reason: string | null }[];
}

export async function buildJakeDailyReport(hoursBack = 24): Promise<JakeDailyReport> {
  const windowEnd = new Date();
  const windowStart = new Date(windowEnd.getTime() - hoursBack * 3600000);

  const recent = await db
    .select()
    .from(projectConversations)
    .where(gte(projectConversations.createdAt, windowStart))
    .orderBy(desc(projectConversations.createdAt));

  const allProjects = await db.select().from(projects);
  const projectMap = new Map(allProjects.map(p => [p.id, p]));

  type PerProject = {
    projectId: string;
    projectName: string;
    clientName: string | null;
    inbound: number;
    replies: number;
    notifies: number;
    awaitingHandoff: boolean;
    handoffReason: string | null;
  };
  const byProject = new Map<string, PerProject>();
  const totals = { inbound: 0, replies: 0, welcomes: 0, checkins: 0, notifies: 0, openHandoffs: 0 };

  for (const c of recent) {
    const proj = projectMap.get(c.projectId);
    if (!proj) continue;
    const row = byProject.get(c.projectId) ?? {
      projectId: c.projectId,
      projectName: proj.name,
      clientName: null,
      inbound: 0,
      replies: 0,
      notifies: 0,
      awaitingHandoff: !!proj.jakeAwaitingHandoff,
      handoffReason: proj.jakeHandoffReason ?? null,
    };
    if (c.direction === "inbound") {
      row.inbound++;
      totals.inbound++;
    } else {
      if (c.classification === "WELCOME") totals.welcomes++;
      else if (c.classification === "CHECKIN") totals.checkins++;
      else if (c.classification === "HANDOFF") { /* a handoff log row */ }
      else if (c.classification === "HANDOFF_RELAY" || c.classification === "INTRO" || /^[A-Z_]+$/.test(c.classification ?? "")) {
        row.replies++;
        totals.replies++;
      } else {
        row.replies++;
        totals.replies++;
      }
    }
    byProject.set(c.projectId, row);
  }

  for (const p of allProjects) {
    if (!p.jakeEnabled) continue;
    if (p.jakeAwaitingHandoff) {
      totals.openHandoffs++;
      const row = byProject.get(p.id) ?? {
        projectId: p.id,
        projectName: p.name,
        clientName: null,
        inbound: 0,
        replies: 0,
        notifies: 0,
        awaitingHandoff: true,
        handoffReason: p.jakeHandoffReason ?? null,
      };
      row.awaitingHandoff = true;
      row.handoffReason = p.jakeHandoffReason ?? row.handoffReason;
      byProject.set(p.id, row);
    }
  }

  // Enrich with client names.
  for (const row of byProject.values()) {
    const proj = projectMap.get(row.projectId);
    if (proj?.clientId) {
      const [cl] = await db.select().from(clients).where(eq(clients.id, proj.clientId)).limit(1);
      if (cl) row.clientName = cl.name ?? null;
    }
  }

  const recentHandoffs = allProjects
    .filter(p => p.jakeEnabled && p.jakeAwaitingHandoff)
    .map(p => ({ projectId: p.id, projectName: p.name, reason: p.jakeHandoffReason ?? null }));

  return {
    windowStart: windowStart.toISOString(),
    windowEnd: windowEnd.toISOString(),
    totals,
    projects: Array.from(byProject.values()).sort((a, b) => (b.inbound + b.replies + (b.awaitingHandoff ? 100 : 0)) - (a.inbound + a.replies + (a.awaitingHandoff ? 100 : 0))),
    recentHandoffs,
  };
}

export async function sendJakeDailyDigest(): Promise<void> {
  const report = await buildJakeDailyReport(24);
  if (!isPushConfigured()) return;
  const parts: string[] = [];
  if (report.totals.inbound) parts.push(`${report.totals.inbound} inbound`);
  if (report.totals.replies) parts.push(`${report.totals.replies} reply${report.totals.replies === 1 ? "" : "s"}`);
  if (report.totals.welcomes) parts.push(`${report.totals.welcomes} welcome${report.totals.welcomes === 1 ? "" : "s"}`);
  if (report.totals.checkins) parts.push(`${report.totals.checkins} check-in${report.totals.checkins === 1 ? "" : "s"}`);
  if (report.totals.openHandoffs) parts.push(`${report.totals.openHandoffs} open handoff${report.totals.openHandoffs === 1 ? "" : "s"}`);
  const summary = parts.length ? parts.join(" · ") : "no Jake activity in the last 24h";
  try {
    await sendPushToAll({
      title: "Jake daily report",
      body: summary,
      url: "/admin/ops/jake/report",
    });
  } catch (err) {
    console.error("Jake daily digest push failed:", err);
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Background runners — schedule the cadence + the daily digest.
// ─────────────────────────────────────────────────────────────────────────

const HOUR_MS = 60 * 60 * 1000;
const DAILY_DIGEST_HOUR = 8;
const DAILY_DIGEST_TZ = "America/Chicago";

let cadenceTimer: NodeJS.Timeout | null = null;
let digestTimer: NodeJS.Timeout | null = null;

export function startJakeRunners(): void {
  if (cadenceTimer) return;
  // Cadence — run every hour. The cutoff inside runMaintenanceCadence
  // keeps it idempotent.
  cadenceTimer = setInterval(() => {
    runMaintenanceCadence().catch(err => console.error("Jake cadence runner error:", err));
  }, HOUR_MS);
  // Initial run shortly after boot.
  setTimeout(() => {
    runMaintenanceCadence().catch(err => console.error("Initial Jake cadence run error:", err));
  }, 60 * 1000);

  // Daily digest — fire at the next 8am America/Chicago, then daily.
  function scheduleNextDigest() {
    const now = new Date();
    const target = new Date(now.toLocaleString("en-US", { timeZone: DAILY_DIGEST_TZ }));
    target.setHours(DAILY_DIGEST_HOUR, 0, 0, 0);
    if (target.getTime() <= now.getTime()) target.setDate(target.getDate() + 1);
    const delay = Math.max(60_000, target.getTime() - now.getTime());
    digestTimer = setTimeout(async () => {
      try {
        await sendJakeDailyDigest();
      } catch (err) {
        console.error("Jake daily digest error:", err);
      } finally {
        scheduleNextDigest();
      }
    }, delay);
    console.log(`Jake daily digest scheduled for ${target.toISOString()} (${Math.round(delay / 60000)} min)`);
  }
  scheduleNextDigest();

  console.log("Jake runners started: maintenance cadence (1h) + daily digest (8am CT)");
}

// ─────────────────────────────────────────────────────────────────────────
// Progress screenshot helpers — fetch from object storage and base64
// encode so Resend can ship them as email attachments.
// ─────────────────────────────────────────────────────────────────────────

export async function loadProgressForVoice(docIds: string[]): Promise<{ filename: string; content: string }[]> {
  return loadProgressAttachments(docIds);
}

async function loadProgressAttachments(docIds: string[]): Promise<{ filename: string; content: string }[]> {
  if (docIds.length === 0) return [];
  const rows = await db
    .select()
    .from(projectDocuments)
    .where(eq(projectDocuments.category, "progress"));
  const byId = new Map(rows.map(r => [r.id, r]));

  const { ObjectStorageService } = await import("./object-storage");
  const service = new ObjectStorageService();
  const out: { filename: string; content: string }[] = [];

  for (const id of docIds.slice(0, 6)) {
    const doc = byId.get(id);
    if (!doc) continue;
    if (!doc.storageKey) continue;
    if (!/image\//i.test(doc.contentType ?? "")) continue;
    try {
      const file = await service.getObjectEntityFile(doc.storageKey);
      // Each backend exposes a download method. We don't have a "read to
      // buffer" helper; pipe to an in-memory writable instead.
      const buffer = await readFileToBuffer(file);
      if (buffer.length === 0 || buffer.length > 10 * 1024 * 1024) continue; // skip oversize
      out.push({ filename: doc.filename, content: buffer.toString("base64") });
    } catch (err: any) {
      console.error(`Jake progress attachment ${id} failed:`, err?.message);
    }
  }
  return out;
}

async function readFileToBuffer(file: any): Promise<Buffer> {
  // Both LocalFile (createReadStream) and S3File (download via the
  // service) shape work — we just need raw bytes. Prefer the read-to-
  // buffer path that doesn't touch res.
  if (typeof file.createReadStream === "function") {
    const stream = file.createReadStream();
    return await new Promise<Buffer>((resolve, reject) => {
      const chunks: Buffer[] = [];
      stream.on("data", (c: Buffer) => chunks.push(c));
      stream.on("end", () => resolve(Buffer.concat(chunks)));
      stream.on("error", reject);
    });
  }
  // S3 fallback: HEAD + GET via SDK if the local-style stream isn't
  // available. Lazy import so the local-disk path stays import-clean.
  const { S3Client, GetObjectCommand } = await import("@aws-sdk/client-s3");
  const region = process.env.AWS_S3_REGION;
  const bucket = process.env.AWS_S3_DOCUMENTS_BUCKET || process.env.AWS_S3_BUCKET;
  if (!region || !bucket) throw new Error("S3 not configured for attachment fetch");
  const client = new S3Client({ region });
  const result = await client.send(new GetObjectCommand({ Bucket: bucket, Key: file.name }));
  const stream = result.Body as any;
  return await new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on("data", (c: Buffer) => chunks.push(c));
    stream.on("end", () => resolve(Buffer.concat(chunks)));
    stream.on("error", reject);
  });
}
