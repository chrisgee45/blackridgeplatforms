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
import { projects, projectConversations, clients, contacts, companies, outreachJobs, tasks, milestones } from "@shared/schema";
import { eq, desc, asc } from "drizzle-orm";
import { isPushConfigured, sendPushToAll } from "./push";

const JAKE_FROM_EMAIL = process.env.JAKE_FROM_EMAIL || "jake@blackridgeplatforms.com";
const JAKE_FROM_NAME = process.env.JAKE_FROM_NAME || "Jake at BlackRidge";

export const JAKE_SYSTEM_PROMPT = `You are Jake, Chris Gee's personal assistant at BlackRidge Platforms.
You handle email correspondence with active project clients on Chris's behalf.
You are NOT Chris. You are his assistant. Always sign emails as "Jake".

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

WHAT YOU MUST HAND OFF TO CHRIS (set handoff: true, do NOT reply yourself)
- Anything about money: price, fees, invoices, billing, payment
- Anything about the contract, scope, or what's included
- Timeline shifts or deadline negotiations
- Complaints, frustration, anger, or anything that hints at unhappiness
- Requests for a call or meeting with Chris specifically
- Anything you don't know with confidence

WHEN HANDING OFF
Do not draft a reply. Just set handoff: true and write a short handoffReason explaining what the client needs. Chris will take over.

OUTPUT FORMAT
Return ONLY valid JSON, no commentary:
{
  "classification": "STATUS_QUESTION|GENERAL_QUESTION|REQUEST|SCHEDULING|REASSURANCE|HANDOFF",
  "reply": "<the email body to send, using \\n for paragraph breaks, signed 'Jake'>",
  "handoff": false,
  "handoffReason": null
}

If handoff is true:
{
  "classification": "HANDOFF",
  "reply": "",
  "handoff": true,
  "handoffReason": "<one sentence: what does Chris need to address>"
}`;

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
      // Use the client's email as a fallback if no project contact exists.
      if (!contactEmail) contactEmail = cl.email ?? null;
    }
  }

  return { project: proj, contactName, contactEmail, companyName, clientName };
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

function renderIntroEmail(ctx: ClientContext): { subject: string; body: string } {
  const greeting = firstName(ctx.contactName ?? ctx.clientName);
  const projectLabel = ctx.project.name;
  const subject = `Quick hello — ${projectLabel}`;
  const body =
`Hey ${greeting},

Jake here, Chris's assistant at BlackRidge. Wanted to say thanks for putting your trust in us on the ${projectLabel} build, we're glad you're here.

Chris is heads-down on the work, so I'll be your day-to-day point of contact. If you ever have a question, a comment, an idea, or just want a status check, hit reply on this thread and you'll hear back from me fast. No question is too small.

Anything you'd love to see in the final build that we haven't talked about yet, send it over. Easier to bake it in now than bolt it on later.

Talk soon,
Jake
BlackRidge Platforms`;
  return { subject, body };
}

// ─────────────────────────────────────────────────────────────────────────
// Inbound webhook handler — called by /api/jake/inbound
// ─────────────────────────────────────────────────────────────────────────

export async function handleJakeInbound(data: any): Promise<{ ok: boolean }> {
  const fromEmail = (data?.from || "").replace(/.*</, "").replace(/>.*/, "").trim().toLowerCase();
  const toEmail = Array.isArray(data?.to) ? data.to[0] : (data?.to || "");
  const subject = data?.subject || "";
  const messageId = data?.message_id || data?.email_id || null;
  let textBody = data?.text || data?.html?.replace(/<[^>]*>/g, " ").trim() || "";

  if (!fromEmail) return { ok: true };

  // Match this email to an active Jake-enabled project by client/contact email.
  const project = await findActiveProjectForEmail(fromEmail);
  if (!project) {
    console.log(`Jake: inbound from ${fromEmail} matched no active Jake project — ignoring`);
    return { ok: true };
  }

  await db.insert(projectConversations).values({
    projectId: project.id,
    clientId: project.clientId ?? null,
    direction: "inbound",
    fromEmail,
    toEmail: toEmail || JAKE_FROM_EMAIL,
    subject,
    body: textBody,
    aiGenerated: false,
    resendMessageId: messageId,
  });

  if (project.jakeAwaitingHandoff) {
    console.log(`Jake: project ${project.id} already awaiting handoff — notifying Chris`);
    await notifyHandoff(project.id, "Client replied while awaiting handoff");
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
  const projectContext = `Project: ${ctx.project.name}
Current stage: ${stageLabel}
Client: ${ctx.clientName ?? ctx.companyName ?? "the client"}
Contact: ${ctx.contactName ?? "the client"}

PROJECT TIMELINE (use this to give accurate status updates — only mention specifics if the client asks or it's directly relevant)
${renderTimelineForPrompt(timeline)}`;

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 2000,
    system: JAKE_SYSTEM_PROMPT,
    messages: [{
      role: "user",
      content: `${projectContext}\n\nConversation so far:\n\n${threadText}\n\nThe client's most recent message is at the bottom. Respond to it as Jake.`,
    }],
  });

  const raw = response.content.map(b => (b.type === "text" ? b.text : "")).join("").trim();
  const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();

  let parsed: { classification?: string; reply?: string; handoff?: boolean; handoffReason?: string } = {};
  try {
    parsed = JSON.parse(cleaned);
  } catch (err) {
    console.error("Jake reply parse failed:", err);
    // Belt-and-suspenders: treat unparseable output as a handoff so we never
    // send garbage to a paying client.
    parsed = { handoff: true, handoffReason: "Jake's response could not be parsed; needs human review." };
  }

  if (parsed.handoff) {
    await db.update(projects)
      .set({ jakeAwaitingHandoff: true, jakeHandoffReason: parsed.handoffReason || "Needs Chris" })
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
    await notifyHandoff(projectId, parsed.handoffReason ?? "Jake flagged a handoff");
    return;
  }

  const replyBody = parsed.reply?.trim();
  if (!replyBody) return;

  // Pull the latest inbound to thread the reply.
  const lastInbound = history.filter(c => c.direction === "inbound").slice(-1)[0];
  const replySubject = lastInbound?.subject
    ? lastInbound.subject.startsWith("Re:") ? lastInbound.subject : `Re: ${lastInbound.subject}`
    : `Re: ${ctx.project.name}`;

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
