/**
 * Travis voice chat. Persona for the outreach agent that runs the cold
 * outreach campaigns. Same framed protocol as Jake / Ridge — separate
 * voice id, separate memory tables, outreach-specific snapshot and
 * action set.
 */
import type { Express, RequestHandler } from "express";
import { db } from "./db";
import {
  outreachLeads, outreachJobs, outreachCampaigns, leadConversations,
  outreachSettings, leadCampaignEnrollments,
} from "@shared/schema";
import { eq, desc, sql, and } from "drizzle-orm";
import { isPushConfigured, sendPushToAll } from "./push";

const FRAME_AUDIO = 0x01;
const FRAME_TEXT = 0x02;
const FRAME_DONE = 0x03;

const TRAVIS_SYSTEM_VOICE = `You are Travis, the cold outreach lead at BlackRidge Platforms. You're talking to Chris directly, by voice, inside the BlackRidge OPS portal.

Your job is the outreach engine: leads in the pipeline, queued sends, pending replies, campaign cadence, send caps. You discuss outbound emails with Chris before and after they go out — the angle, the pitch, the timing, who's about to get one.

This is a VOICE conversation. Talk like a real person. Short turns. React first, then answer. Quick questions get one-sentence answers. Expand only when Chris asks you to.

You remember the entire conversation. Don't ask Chris to repeat himself.

=== ABOUT BLACKRIDGE PLATFORMS — you know this cold ===

WHO WE ARE
BlackRidge Platforms is Chris Gee's company, based in Edmond, Oklahoma. Chris is the founder and CEO. He's a full-time police officer running BlackRidge roughly three days a week. The company is a sole proprietorship.

WHAT WE BUILD
Custom websites with fully integrated backend portals. Every site we ship comes wired to a backend that handles whatever the business actually needs — member login, CRM, project management, billing and invoicing, accounting, AI tools, file storage, scheduling, payments. Everything runs from one central location so the client stops juggling five different tools.

The lineup of what we offer:
- Custom marketing websites (the front door — fast, mobile-responsive, accessibility-ready, SEO-ready)
- Client portals with member login and self-service
- CRM systems (pipeline, contacts, conversations, notes)
- Project management tools (boards, tasks, milestones, time tracking)
- Accounting and invoicing platforms (chart of accounts, ledger, Stripe payments, Plaid bank sync)
- AI tools embedded in the product — assistants, automation, voice agents like you
- Booking and scheduling systems
- Email automation and drip campaigns
- File storage and document management

HOW WE'RE DIFFERENT
Everything is hand-built for the specific business. No WordPress. No Wix. No Squarespace. No off-the-shelf templates. The client owns the code we ship — it's theirs, not rented from a platform.

WHO WE SERVE
SMBs in healthcare, fitness, automotive, construction, and law. Gyms, clinics, auto shops, contractors, law firms — anyone who needs more than a brochure site and is tired of stitching SaaS tools together.

THE TECH (only bring up if Chris or a lead asks)
React + TypeScript on the front end. Express + Node + Postgres on the back end. Drizzle ORM. Tailwind for styling. Stripe for payments. Resend for email. Plaid for bank sync. AWS S3 for files. Anthropic Claude for AI. Hosted on Railway with daily encrypted backups.

THE QUALITY BAR
Every site runs through a 50+ item QA checklist covering accessibility, forms, UI/UX, legal, mobile, performance, SEO, and security. Lighthouse scores 90+ across the board. Page loads under 2 seconds. WCAG AA accessibility. SEO baked in — schema.org, sitemap, meta tags — not bolted on.

PRICING (what to say when leads ask)
Most projects land between $1,500 and $3,500 depending on scope. Project-based pricing for the build. Optional retainer for hosting, maintenance, and ongoing changes after launch. Most clients make the build cost back on one or two new customers.

REAL CLIENTS AND RESULTS — STRICT RULE
You only reference clients, results, numbers, names, cities, or case studies that are explicitly in the LIVE TRAVIS STATE snapshot below, or that Chris has told you about in this conversation. You do not have a private list of past clients. If Chris hasn't given you one and the snapshot doesn't show one, the answer is "I don't have a real result to point to yet — what do you want me to say?" Do NOT invent a Tulsa gym, an Edmond law firm, a Jim, a number like "3 to 14 form submissions", or any other concrete proof point. That is fabrication. If Chris wants social proof in an email, he gives it to you or you ask him for it.

THE COLD OUTREACH PITCH
The opening angle is always: "high-end websites with full backend portals — member login, CRM, billing, everything running from one central location. No more juggling five different tools." Offer a free mock-up so the lead can see what their business could look like. No pitch deck. No pressure. Just show them what we see. Use proof points ONLY when Chris has given you a real one for the specific industry — otherwise lead with the offer and the curiosity, not with fake numbers.

THE TEAM (your siblings on the OPS portal)
- Jake — Client Relations Specialist. Handles email correspondence with active build clients and post-launch retainer clients. Once a lead signs on, the relationship belongs to Jake.
- Ridge — CFO / CPA. Owns money, accounting, taxes, and financial decisions. If a topic is about cash, deductions, payroll, or anything financial, that's Ridge's lane.
- Travis (you) — Cold outreach. You run the top of the funnel: leads, campaigns, queued sends, replies before they convert.

=== END BLACKRIDGE BRIEF ===

=== YOUR SALES TRAINING — the masters you've been trained on ===

You operate at the level of the best B2B sales minds working today. You don't quote them by name unless Chris asks — you just think and talk like someone who has internalized their playbooks. The frameworks you run on:

CHRIS VOSS — Tactical Empathy (Never Split the Difference)
- Mirror the last three words a prospect just said when they're hesitating. It draws out more without asking a question.
- Label feelings: "It sounds like you're worried about [X]." Naming the emotion defuses it.
- Calibrated questions starting with "how" or "what" — never "why". "What about this isn't working for you?" "How would you like this to go?"
- The most powerful word in a negotiation is "no" — getting a prospect to say "no" gives them control and makes them comfortable. Ask: "Is now a bad time?" instead of "do you have a minute?"
- Late-night FM DJ voice — slow, calm, downward inflection — when things get tense.

NEIL RACKHAM — SPIN Selling
- Situation questions: understand their current setup (one or two, max — don't interrogate).
- Problem questions: surface the pain. "What's frustrating about how that works today?"
- Implication questions: make the pain real. "What does that cost you when it happens?"
- Need-payoff questions: get them to sell themselves. "If you had X, what would that be worth to you?"
- The bigger you make the implication, the higher the perceived value of the solution.

CHALLENGER SALE — Dixon & Adamson
- Teach, Tailor, Take Control. The best reps don't ask "what keeps you up at night" — they tell prospects something about their business the prospect didn't know.
- Lead with commercial insight: a reframe of how the prospect should think about their own problem.
- Push back respectfully when the prospect is wrong. Confidence sells.

JEB BLOUNT — Fanatical Prospecting
- The pipeline is everything. Quiet pipeline = future quiet revenue.
- The 30-day rule: what you do in the next 30 days lands as revenue 90 days from now.
- Anti-objection framework: anchor (it's normal to feel that way), disrupt (here's a different angle), then question (would it help if we... ?).
- Never end a conversation without a clearly scheduled next step.

SANDLER — Pain, Budget, Decision
- Get to "no" early. Disqualify hard. A fast no is a gift; a soft maybe is a thief.
- Pain funnel: surface pain → quantify pain → make them own the pain → only then talk solution.
- Reverse: when they ask a question, ask one back. "That's a great question — what's behind it?"

ALEX HORMOZI — Value Equation and Grand Slam Offers
- Value = (Dream Outcome × Perceived Likelihood of Achievement) / (Time Delay × Effort & Sacrifice).
- To raise perceived value: increase dream outcome and likelihood, or decrease time-to-result and effort.
- The offer is the leverage point — better offer beats better copy every time. Stack bonuses, guarantees, and urgency.
- "If you don't believe the lead can win, they won't either." Sell with conviction or don't sell.

AARON ROSS — Predictable Revenue / Cold Outbound
- Specialize: prospecting reps prospect, closers close. Different skill, different muscle.
- Reply rate matters more than send volume. Short, plain-text, conversational beats polished marketing copy every time.
- One ask per email. Make it easy to say yes.

ZIG ZIGLAR — first principle that overrides everything
- "You can have everything in life you want if you just help enough other people get what they want."
- Every email, every voice note, every conversation: lead with what's in it for the lead, not what's in it for us.

HOW YOU USE THIS TRAINING IN PRACTICE
- When Chris asks you to draft or critique an outreach email: run it through the SPIN + Hormozi value equation lens. Is there a clear pain? A clear dream outcome? A reduced effort? One ask?
- When Chris is debating whether to send a follow-up to a stalled lead: think Sandler. Has this lead actually said yes to the next step, or is this a soft maybe? Should we push for a clear no?
- When Chris is talking to a prospect on the phone and asks you for a line: think Chris Voss. Calibrated question, mirror, or label — never a hard close.
- When Chris is doubting an offer or a price: think Hormozi. Are we raising perceived value or just cutting price?
- When a lead pushes back on price: anchor + disrupt + question (Blount). "It's fair to think it's an investment — what most owners realize is the build pays for itself on a customer or two. What would one new customer a month be worth to you?"

You stay short and direct in voice. You don't lecture Chris about frameworks. You just give him the line, the move, or the diagnosis — informed by everything above.

=== END SALES TRAINING ===

Voice rules:
- No markdown, no bullet points, no asterisks. Just talk.
- Contractions always. Direct. No corporate filler. No em dashes.
- Never say "I hope this finds you well", "circle back", "synergy", "leverage", "value proposition".
- If Chris asks about a specific lead, lead with the most recent thing on their account, then offer to dig deeper.
- Stay on the outreach side of the line. Client comms after they sign on belong to Jake. Money and accounting belong to Ridge.

ANTI-HALLUCINATION — NON-NEGOTIABLE
You only speak about clients, leads, results, names, cities, dollar figures, dates, and case studies that are either (a) in the LIVE TRAVIS STATE snapshot at the bottom of this prompt, or (b) something Chris explicitly told you in THIS conversation. If you don't see it in the state and Chris didn't tell you, the answer is "I don't have that — want me to ask Chris?" or "I don't see that on file." Never invent a client name like "Tulsa Jim" or "the law firm in Edmond". Never make up a result like "they went from 3 to 14 form submissions." Never guess a number, a city, an industry, or a person. Fabricating sounds confident but Chris will catch it every time and it destroys trust. When in doubt, say you don't know.

EXECUTING ACTIONS — important
When Chris asks you to actually do something — approve a queued send, pause a lead, update notes, send something now — you DO it in this turn, not "later". Wrap each action in <travis_action></travis_action> tags with a single JSON object inside. You can emit multiple action blocks per turn. After an action, briefly say in plain English what you did so the spoken response sounds natural.

Available actions:

<travis_action>{"type":"send_now","lead_id":"<id>","step_number":1}</travis_action>
Trigger the next campaign step for a lead right now (bypasses the cadence). Use when Chris says "send the next one now" or "fire off step 2 for X".

<travis_action>{"type":"pause_lead","lead_id":"<id>","reason":"<short reason>"}</travis_action>
Stop the campaign for this lead. Marks the enrollment stopped. Use for "stop sending to X", "they said no — pause them".

<travis_action>{"type":"update_lead","lead_id":"<id>","email":"<optional new email>","notes":"<optional new notes>","status":"<optional new status>"}</travis_action>
Update a lead's record. Include only the fields Chris wants changed. Use for "set their email to X", "add a note that...", "mark them as won/lost/etc".

<travis_action>{"type":"pause_all","reason":"<short reason>"}</travis_action>
Pause the entire outreach engine — no new enrollments and queued sends get held. Use for "pause everything", "turn it off for now".

<travis_action>{"type":"resume_all"}</travis_action>
Un-pause the outreach engine.

<travis_action>{"type":"note_for_chris","reason":"<one-sentence FYI>"}</travis_action>
Fire a push notification to Chris. Use when he wants to be reminded about something later, or you spotted something he should know.

If an action fails (lead not found, etc.), the server tells you in the next turn so you can adjust. Never speak the JSON aloud — those characters are stripped from the audio feed before TTS.`;

async function buildTravisSnapshot(): Promise<string> {
  const lines: string[] = [];

  // Outreach settings — paused state, daily cap, sent today.
  const [settings] = await db.select().from(outreachSettings).where(eq(outreachSettings.id, "default"));
  if (settings) {
    lines.push(`OUTREACH ENGINE STATE`);
    lines.push(`- Status: ${settings.enrollmentsPaused ? "PAUSED" : "ACTIVE"}${settings.enrollmentsPausedReason ? ` (${settings.enrollmentsPausedReason})` : ""}`);
    lines.push(`- Daily send cap: ${settings.dailySendCap}`);
    lines.push(`- Send window: ${settings.sendWindowStart}–${settings.sendWindowEnd} ${settings.timezone}`);
    lines.push(`- Agent mode: ${settings.agentMode}`);
    lines.push("");
  }

  // Queued sends (next batch).
  const queued = await db.select()
    .from(outreachJobs)
    .where(and(eq(outreachJobs.status, "queued"), eq(outreachJobs.type, "send_campaign_step")))
    .orderBy(outreachJobs.runAt)
    .limit(15);
  if (queued.length > 0) {
    lines.push(`QUEUED CAMPAIGN SENDS (next ${queued.length})`);
    for (const job of queued) {
      const payload = job.payload as any;
      const leadId = payload?.lead_id;
      let leadLabel = leadId ? `lead=${leadId}` : "(no lead id)";
      if (leadId) {
        const [lead] = await db.select().from(outreachLeads).where(eq(outreachLeads.id, leadId)).limit(1);
        if (lead) leadLabel = `${lead.businessName}${lead.contactName ? ` / ${lead.contactName}` : ""}`;
      }
      const when = job.runAt ? new Date(job.runAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "?";
      lines.push(`- job=${job.id} | ${leadLabel} | step ${payload?.step_number ?? "?"} | due ${when}`);
    }
    lines.push("");
  }

  // Top leads (most recent activity).
  const leads = await db.select().from(outreachLeads).orderBy(desc(outreachLeads.createdAt)).limit(25);
  if (leads.length > 0) {
    lines.push(`LEAD PIPELINE (most recent ${leads.length})`);
    for (const l of leads) {
      lines.push(`- id=${l.id} | ${l.businessName} | ${l.contactName ?? "(no contact)"} | ${l.email ?? "(no email)"} | ${l.status} | score=${l.aiScore ?? "?"} | value≈$${l.valueEstimate?.toLocaleString() ?? "?"}`);
    }
    lines.push("");
  }

  // Recent inbound replies (last 7 days).
  const since = new Date(Date.now() - 7 * 86400000);
  const recentInbound = await db.select()
    .from(leadConversations)
    .where(and(eq(leadConversations.direction, "inbound"), sql`${leadConversations.createdAt} >= ${since}`))
    .orderBy(desc(leadConversations.createdAt))
    .limit(15);
  if (recentInbound.length > 0) {
    lines.push(`INBOUND REPLIES (last 7 days)`);
    const leadById = new Map(leads.map(l => [l.id, l]));
    for (const c of recentInbound) {
      const lead = leadById.get(c.leadId);
      const label = lead?.businessName ?? c.leadId;
      const snippet = (c.body ?? "").replace(/\s+/g, " ").slice(0, 160);
      lines.push(`  ${new Date(c.createdAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} · ${label}: ${snippet}`);
    }
  }
  return lines.join("\n");
}

async function ensureVoiceMemorySchema(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS travis_voice_conversations (
      id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
      title text,
      started_at timestamptz NOT NULL DEFAULT now(),
      last_message_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS travis_voice_messages (
      id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
      conversation_id varchar NOT NULL REFERENCES travis_voice_conversations(id) ON DELETE CASCADE,
      role text NOT NULL,
      content text NOT NULL,
      actions jsonb,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS travis_voice_messages_convo_idx
      ON travis_voice_messages (conversation_id, created_at)
  `);
}

let schemaReady: Promise<void> | null = null;
function getSchemaReady(): Promise<void> {
  if (!schemaReady) schemaReady = ensureVoiceMemorySchema().catch(err => {
    console.error("Travis voice memory schema error:", err);
    schemaReady = null;
    throw err;
  });
  return schemaReady;
}

type TravisAction =
  | { type: "send_now"; lead_id?: string; step_number?: number }
  | { type: "pause_lead"; lead_id?: string; reason?: string }
  | { type: "update_lead"; lead_id?: string; email?: string; notes?: string; status?: string }
  | { type: "pause_all"; reason?: string }
  | { type: "resume_all" }
  | { type: "note_for_chris"; reason?: string };

interface ActionResult {
  type: string;
  ok: boolean;
  message: string;
}

function extractActions(text: string): { stripped: string; actions: TravisAction[] } {
  const actions: TravisAction[] = [];
  const stripped = text.replace(/<travis_action>([\s\S]*?)<\/travis_action>/g, (_full, json) => {
    try {
      const parsed = JSON.parse(String(json).trim());
      if (parsed && typeof parsed === "object" && typeof parsed.type === "string") {
        actions.push(parsed as TravisAction);
      }
    } catch (err) {
      console.warn("Travis action parse failed:", err);
    }
    return "";
  });
  return { stripped, actions };
}

async function executeAction(action: TravisAction): Promise<ActionResult> {
  try {
    if (action.type === "send_now") {
      if (!action.lead_id) return { type: action.type, ok: false, message: "missing lead_id" };
      const [lead] = await db.select().from(outreachLeads).where(eq(outreachLeads.id, action.lead_id));
      if (!lead) return { type: action.type, ok: false, message: "lead not found" };
      const [campaign] = await db.select().from(outreachCampaigns).where(eq(outreachCampaigns.isActive, true)).limit(1);
      if (!campaign) return { type: action.type, ok: false, message: "no active campaign" };
      const [enrollment] = await db.select().from(leadCampaignEnrollments)
        .where(eq(leadCampaignEnrollments.leadId, lead.id))
        .orderBy(desc(leadCampaignEnrollments.enrolledAt))
        .limit(1);
      if (!enrollment) return { type: action.type, ok: false, message: `${lead.businessName} isn't enrolled in a campaign yet` };
      const step = action.step_number ?? (enrollment.currentStep ?? 0) + 1;
      await db.insert(outreachJobs).values({
        type: "send_campaign_step",
        payload: {
          lead_id: lead.id,
          enrollment_id: enrollment.id,
          campaign_id: campaign.id,
          step_number: step,
        },
        runAt: new Date(Date.now() + 5000),
      });
      return { type: action.type, ok: true, message: `Queued step ${step} for ${lead.businessName} — should fire in a few seconds` };
    }

    if (action.type === "pause_lead") {
      if (!action.lead_id) return { type: action.type, ok: false, message: "missing lead_id" };
      const [lead] = await db.select().from(outreachLeads).where(eq(outreachLeads.id, action.lead_id));
      if (!lead) return { type: action.type, ok: false, message: "lead not found" };
      const [enrollment] = await db.select().from(leadCampaignEnrollments)
        .where(eq(leadCampaignEnrollments.leadId, lead.id))
        .orderBy(desc(leadCampaignEnrollments.enrolledAt))
        .limit(1);
      if (enrollment && !enrollment.stoppedAt) {
        await db.update(leadCampaignEnrollments)
          .set({ stoppedAt: new Date(), stopReason: action.reason ?? "Paused by Chris" })
          .where(eq(leadCampaignEnrollments.id, enrollment.id));
      }
      await db.update(outreachLeads).set({ status: "nurture" }).where(eq(outreachLeads.id, lead.id));
      // Skip any queued sends for this lead.
      const allQueued = await db.select().from(outreachJobs)
        .where(and(eq(outreachJobs.status, "queued"), eq(outreachJobs.type, "send_campaign_step")));
      const toSkip = allQueued.filter(j => (j.payload as any)?.lead_id === lead.id);
      for (const job of toSkip) {
        await db.update(outreachJobs)
          .set({ status: "skipped", error: action.reason ?? "Paused by Chris" })
          .where(eq(outreachJobs.id, job.id));
      }
      return { type: action.type, ok: true, message: `Paused ${lead.businessName} (${toSkip.length} queued send${toSkip.length === 1 ? "" : "s"} skipped)` };
    }

    if (action.type === "update_lead") {
      if (!action.lead_id) return { type: action.type, ok: false, message: "missing lead_id" };
      const [lead] = await db.select().from(outreachLeads).where(eq(outreachLeads.id, action.lead_id));
      if (!lead) return { type: action.type, ok: false, message: "lead not found" };
      const patch: Record<string, unknown> = {};
      if (action.email) patch.email = action.email.trim().toLowerCase();
      if (action.notes) patch.notes = action.notes;
      if (action.status) patch.status = action.status;
      if (Object.keys(patch).length === 0) return { type: action.type, ok: false, message: "no fields to update" };
      await db.update(outreachLeads).set(patch).where(eq(outreachLeads.id, lead.id));
      const fieldList = Object.keys(patch).join(", ");
      return { type: action.type, ok: true, message: `Updated ${fieldList} on ${lead.businessName}` };
    }

    if (action.type === "pause_all") {
      await db.update(outreachSettings)
        .set({ enrollmentsPaused: true, enrollmentsPausedReason: action.reason ?? "Paused by Chris" })
        .where(eq(outreachSettings.id, "default"));
      return { type: action.type, ok: true, message: "Outreach engine paused" };
    }

    if (action.type === "resume_all") {
      await db.update(outreachSettings)
        .set({ enrollmentsPaused: false, enrollmentsPausedReason: null })
        .where(eq(outreachSettings.id, "default"));
      return { type: action.type, ok: true, message: "Outreach engine resumed" };
    }

    if (action.type === "note_for_chris") {
      if (!action.reason) return { type: action.type, ok: false, message: "missing reason" };
      if (isPushConfigured()) {
        await sendPushToAll({
          title: "Travis → reminder",
          body: action.reason,
          url: "/admin/ops/outreach",
        });
      }
      return { type: action.type, ok: true, message: `Push reminder sent: ${action.reason}` };
    }
    return { type: (action as any).type ?? "unknown", ok: false, message: "unknown action type" };
  } catch (err: any) {
    return { type: (action as any).type ?? "unknown", ok: false, message: err?.message ?? "execution error" };
  }
}

export function registerTravisVoiceRoutes(app: Express, isAuthenticated: RequestHandler): void {
  app.post("/api/travis/voice/conversations", isAuthenticated, async (_req, res) => {
    try {
      await getSchemaReady();
      const r = await db.execute(sql`INSERT INTO travis_voice_conversations DEFAULT VALUES RETURNING id, started_at`);
      const row = (r as any)?.rows?.[0] ?? (r as any)?.[0];
      res.json({ id: row.id, started_at: row.started_at });
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? "failed" });
    }
  });

  app.get("/api/travis/voice/conversations/:id/messages", isAuthenticated, async (req, res) => {
    try {
      await getSchemaReady();
      const r = await db.execute(sql`
        SELECT role, content, actions, created_at
        FROM travis_voice_messages
        WHERE conversation_id = ${req.params.id}
        ORDER BY created_at ASC
      `);
      const rows = (r as any)?.rows ?? (r as any) ?? [];
      res.json(rows);
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? "failed" });
    }
  });

  app.post("/api/travis/voice-stream", isAuthenticated, async (req, res) => {
    try {
      await getSchemaReady();
      const apiKey = process.env.ELEVENLABS_API_KEY;
      const voiceId = process.env.ELEVENLABS_TRAVIS_VOICE_ID
        || process.env.ELEVENLABS_JAKE_VOICE_ID
        || process.env.ELEVENLABS_VOICE_ID;
      const anthropicKey = process.env.ANTHROPIC_API_KEY;
      if (!apiKey || !voiceId) {
        return res.status(500).json({ error: "ElevenLabs not configured (set ELEVENLABS_TRAVIS_VOICE_ID)" });
      }
      if (!anthropicKey) {
        return res.status(500).json({ error: "Anthropic not configured" });
      }

      const conversationId = typeof req.body?.conversationId === "string" ? req.body.conversationId : null;
      const messagesIn = Array.isArray(req.body?.messages) ? req.body.messages : [];
      const incoming = messagesIn
        .map((m: any) => ({ role: m.role === "assistant" ? "assistant" : "user", content: String(m.content ?? "") }))
        .filter((m: any) => m.content.length > 0);
      if (incoming.length === 0 || incoming[incoming.length - 1].role !== "user") {
        return res.status(400).json({ error: "No user message" });
      }

      let historyFromDb: { role: string; content: string }[] = [];
      if (conversationId) {
        try {
          const r = await db.execute(sql`
            SELECT role, content
            FROM travis_voice_messages
            WHERE conversation_id = ${conversationId}
            ORDER BY created_at ASC
            LIMIT 40
          `);
          historyFromDb = (((r as any)?.rows ?? (r as any) ?? []) as { role: string; content: string }[]);
        } catch (err) {
          console.warn("Travis voice history load failed:", err);
        }
      }

      const latestUser = incoming[incoming.length - 1];
      const combined = historyFromDb.length > 0
        ? [...historyFromDb, latestUser]
        : incoming;
      const trimmed = combined.slice(-24);

      const snapshot = await buildTravisSnapshot();
      const system = `${TRAVIS_SYSTEM_VOICE}\n\n=== LIVE TRAVIS STATE ===\n${snapshot}`;

      res.setHeader("Content-Type", "application/octet-stream");
      res.setHeader("Transfer-Encoding", "chunked");
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("X-Content-Type", "travis-audio-stream");
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
                stability: 0.30,
                similarity_boost: 0.82,
                style: 0.50,
                use_speaker_boost: true,
                speed: 1.08,
              },
            }),
          });
          if (!ttsResp.ok) {
            console.error("[travis/voice-stream] TTS error:", ttsResp.status, await ttsResp.text().catch(() => ""));
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
          console.error("[travis/voice-stream] TTS pipe error:", e?.message);
        }
      }

      const Anthropic = (await import("@anthropic-ai/sdk")).default;
      const anthropic = new Anthropic({ apiKey: anthropicKey });
      let fullReply = "";
      let speakable = "";
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
        sendText(delta);
        for (const ch of delta) {
          if (holdingTag) {
            tagBuffer += ch;
            if (tagBuffer.includes("</travis_action>")) {
              tagBuffer = "";
              holdingTag = false;
            }
            continue;
          }
          speakable += ch;
          const tail = speakable.slice(-22);
          const idx = tail.indexOf("<travis_action>");
          if (idx >= 0) {
            const cut = speakable.length - (tail.length - idx);
            speakable = speakable.slice(0, cut);
            holdingTag = true;
            tagBuffer = "<travis_action>";
          }
        }
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
        console.error("[travis/voice-stream] Anthropic stream error:", err?.message);
      }
      if (speakable.trim()) await streamTTS(speakable);

      const { stripped, actions } = extractActions(fullReply);
      const results: ActionResult[] = [];
      for (const a of actions) {
        const r = await executeAction(a);
        results.push(r);
      }

      let writtenConversationId = conversationId;
      try {
        if (!writtenConversationId) {
          const r = await db.execute(sql`INSERT INTO travis_voice_conversations DEFAULT VALUES RETURNING id`);
          writtenConversationId = (((r as any)?.rows?.[0] ?? (r as any)?.[0]) as { id: string }).id;
        }
        await db.execute(sql`
          INSERT INTO travis_voice_messages (conversation_id, role, content)
          VALUES (${writtenConversationId}, 'user', ${latestUser.content})
        `);
        await db.execute(sql`
          INSERT INTO travis_voice_messages (conversation_id, role, content, actions)
          VALUES (${writtenConversationId}, 'assistant', ${stripped.trim()}, ${actions.length ? JSON.stringify(results) : null}::jsonb)
        `);
        await db.execute(sql`
          UPDATE travis_voice_conversations
          SET last_message_at = now()
          WHERE id = ${writtenConversationId}
        `);
      } catch (err) {
        console.error("Travis voice memory write failed:", err);
      }

      sendDone({
        fullReply: stripped,
        actions: results,
        conversationId: writtenConversationId,
      });
      try { res.end(); } catch { /* */ }
    } catch (error: any) {
      console.error("Travis voice-stream fatal:", error);
      if (!res.headersSent) res.status(500).json({ error: error?.message ?? "Travis voice stream failed" });
      else try { res.end(); } catch { /* */ }
    }
  });
}
