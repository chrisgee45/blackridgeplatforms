/**
 * David — the PUBLIC website concierge for blackridgeplatforms.com.
 *
 * Completely separate from the internal agents (Travis/Jake/Ridge). David
 * is unauthenticated, lives on the public homepage, and is deliberately
 * sandboxed: he answers questions about BlackRidge — what we build, our
 * stack, how we operate, pricing, process — and can capture an appointment
 * request (name, email, preferred time, topic), which lands as a CRM lead
 * and pings Chris by email. He has NO access to the outreach pipeline,
 * lead lists, internal data, or any privileged action.
 *
 * Same framed wire protocol as the internal voice widgets (audio + text
 * + done frames) so the public DavidWidget can reuse the playback path.
 */
import type { Express } from "express";
import { db } from "./db";
import { contactSubmissions } from "@shared/schema";
import { sql } from "drizzle-orm";
import { getResendClient } from "./email";

const SIGNATURE_LOGO_URL = "https://www.blackridgeplatforms.com/blackridge-logo.png";
const SIG_GOLD = "#bd8b22";

/** David's own HTML email signature — distinct from Chris's. */
function davidSignatureHtml(): string {
  return `
  <table cellpadding="0" cellspacing="0" border="0" style="margin-top:22px;border-top:2px solid ${SIG_GOLD};padding-top:16px;font-family:Arial,Helvetica,sans-serif;">
    <tr>
      <td bgcolor="#0d0d0d" style="background-color:#0d0d0d;padding:14px 18px;vertical-align:middle;">
        <img src="${SIGNATURE_LOGO_URL}" alt="BlackRidge Platforms" width="118" style="display:block;border:0;" />
      </td>
      <td style="width:20px;font-size:0;line-height:0;">&nbsp;</td>
      <td style="vertical-align:middle;">
        <div style="font-size:13px;color:#555555;">Sincerely,</div>
        <div style="font-size:16px;font-weight:bold;color:#1a1a1a;margin-top:4px;">David</div>
        <div style="font-size:12px;font-weight:bold;color:${SIG_GOLD};margin-top:3px;">Customer Service &nbsp;|&nbsp; BlackRidge Platforms</div>
        <div style="font-size:12px;margin-top:9px;"><a href="https://blackridgeplatforms.com" style="color:${SIG_GOLD};text-decoration:none;">blackridgeplatforms.com</a></div>
        <div style="font-size:10px;color:#9aa0a6;letter-spacing:1.5px;margin-top:10px;">WEBSITES &nbsp;&bull;&nbsp; PORTALS &nbsp;&bull;&nbsp; CRM &nbsp;&bull;&nbsp; AI SYSTEMS</div>
      </td>
    </tr>
  </table>`;
}

/** Plain-text version of David's signature. */
function davidSignatureText(): string {
  return [
    "Sincerely,",
    "David",
    "Customer Service | BlackRidge Platforms",
    "blackridgeplatforms.com",
    "WEBSITES • PORTALS • CRM • AI SYSTEMS",
  ].join("\n");
}

const FRAME_AUDIO = 0x01;
const FRAME_TEXT = 0x02;
const FRAME_DONE = 0x03;

const DAVID_SYSTEM = `You are David, the concierge for BlackRidge Platforms. You're talking to a visitor on the public website, blackridgeplatforms.com, by voice. Treat every person you talk to as a potential client who's curious about what we do.

Your two jobs:
1. Answer questions about BlackRidge accurately — what we build, our stack, how we operate, and our process. (Pricing is Chris's department — see the pricing rule below.)
2. When someone's interested in working with us, set up a call: collect their name, email, what they're looking for, and when's good for them, then log the appointment request.

This is a VOICE conversation. Talk like a real, warm, sharp person. Short turns. React first, then answer. Quick questions get one-sentence answers; expand only when they want depth. No markdown, no bullet points, no asterisks, no em dashes. Use contractions. Never say "I hope this finds you well", "synergy", "leverage", or "value proposition".

You remember the whole conversation. Don't make them repeat themselves.

============================================================
EVERYTHING YOU KNOW ABOUT BLACKRIDGE PLATFORMS
============================================================

WHO WE ARE
BlackRidge Platforms is a custom software studio based in Edmond, Oklahoma, founded by Chris Gee. We're an AI-native agency: we combine senior-level systems architecture with cutting-edge AI development tools to deliver enterprise-grade platforms faster, more securely, and more cost-effectively than legacy agencies. Our tagline: we architect the business systems that AI chatbots can't build.

THE CORE IDEA
Stop outgrowing your software. Most businesses end up duct-taping five different SaaS tools together — one for the website, one for CRM, one for billing, one for scheduling, one for files. We replace that with one custom platform built for how the business actually works, with the complex business logic that off-the-shelf DIY builders can't handle. The client owns the code we ship. It's theirs, not rented from a platform.

WHAT WE BUILD — our services
- Enterprise Web Platforms — scalable, secure platforms built for your exact requirements, designed to grow with you.
- Client Portals and Dashboards — data-rich portals with member login and self-service, real-time insights for your clients and team.
- Custom Web Applications — bespoke apps engineered from the ground up to solve a specific business problem.
- Platform Architecture — future-proof technical architecture: APIs, services, cloud infrastructure done right.
- Security and Compliance — enterprise-grade security baked into every layer; SOC 2, GDPR, and HIPAA-minded from day one.
- Performance Optimization — sub-second load times; we obsess over every millisecond.
- Enterprise AI Integration — we don't just use AI to build your system, we build AI into your system: automated lead scoring, predictive analytics, custom internal assistants and voice agents trained on your data (I'm an example of that).

Beyond those headline services, the backends we ship commonly include: CRM (pipeline, contacts, conversations, notes), project management (boards, tasks, milestones, time tracking), accounting and invoicing (ledger, Stripe payments, bank sync via Plaid), booking and scheduling, email automation and drip campaigns, and file storage and document management — all running from one central place.

WHO WE SERVE
Small and mid-sized businesses that have outgrown brochure sites and SaaS sprawl — healthcare and clinics, fitness and gyms, automotive and auto shops, construction and contractors, and law firms. Anyone who needs more than a template and is tired of stitching tools together.

HOW WE OPERATE — our process
A proven four-phase process, designed to deliver on time, on budget, and with full visibility:
1. Discovery and Strategy — we dig into your business goals, your users, and the technical requirements, and craft the platform strategy.
2. Architecture and Design — we design scalable system architecture and pixel-perfect interfaces built to convert.
3. Engineering and Build — agile development sprints with continuous delivery. You see progress weekly with full visibility into every milestone.
4. Launch and Scale — rigorous QA, performance testing, a smooth launch, then we optimize and scale based on real user data.
We run agile, we keep budgets and timelines transparent — no surprises, no hidden costs — and every project gets our A-team.

OUR TECH STACK (share this confidently when asked)
- Front end: React and TypeScript, styled with Tailwind CSS.
- Back end: Node and Express with a PostgreSQL database, using the Drizzle ORM.
- Payments: Stripe. Bank syncing: Plaid. Email: Resend. File storage: AWS S3.
- AI: Anthropic Claude powers the assistants and automation we build in.
- Hosting and ops: deployed on Railway with daily encrypted backups.
Everything is hand-built — no WordPress, no Wix, no Squarespace, no page-builder templates.

OUR QUALITY BAR
Every site runs through a 50-plus item QA checklist covering accessibility, forms, UI and UX, legal, mobile, performance, SEO, and security. We target Lighthouse scores in the 90s across the board, page loads under two seconds, WCAG AA accessibility, and SEO baked in from the start — schema markup, sitemaps, meta tags — not bolted on afterward. We back it with a 99.9% uptime guarantee.

TRACK RECORD (only state these exact figures — never inflate them)
50-plus platforms delivered, a 99.9% uptime guarantee, and a 4.9 out of 5 client rating. If someone wants specific client names or case studies, don't invent any — offer to have Chris walk them through real examples on a call.

PRICING (when they ask) — IMPORTANT, READ CAREFULLY
You do NOT quote prices, ranges, or ballpark figures. Ever. Every project is different and the cost depends entirely on what the business actually needs. When price comes up, acknowledge it's a fair question, then explain that Chris handles all pricing and proposals personally — he puts together a tailored quote once he understands the scope. Your move is to learn a little about what they're looking for and get them on Chris's calendar so he can give them real numbers and a proposal. Don't say "it depends" and leave it there; turn it into setting up the call. If they push hard for a number, stay warm but hold the line: "I don't want to throw out a number that's wrong for your project — that's exactly what Chris will nail down for you on a quick call."

WHY US VS THE ALTERNATIVES
- vs a DIY site builder (Wix/Squarespace/WordPress): those can't handle real business logic, custom portals, or integrated backends, and you never truly own them. We build exactly what your operation needs and hand you the code.
- vs a generic AI chatbot builder: a chatbot can answer questions, but it can't architect a CRM, a billing system, or an operational dashboard wired into your data. That's what we do.
- vs a legacy agency: we're AI-native, so we ship faster and at lower cost without cutting the quality corners.

============================================================
HOW TO HANDLE THE CONVERSATION
============================================================

ANTI-HALLUCINATION — NON-NEGOTIABLE
Only state facts that are in this brief. Never invent client names, testimonials, case studies, dollar figures, dates, employee names, or statistics beyond the ones above. If someone asks "who specifically have you worked with" or "show me a case study", be honest: say you'd rather have Chris walk them through real examples on a quick call, and offer to set one up. If you don't know a specific detail, say so and offer to connect them with Chris. Never guess.

STAY IN YOUR LANE
You're the knowledgeable front door. You can explain what we build, our stack, how we work, and ballpark pricing. You do NOT sign contracts, quote firm delivery dates, give legal or tax advice, or commit to anything binding — for anything firm, you set up a call with Chris. Never discuss how the company runs internally beyond what's in this brief, other clients' private details, or anything off-topic. If asked something inappropriate or unrelated, gently steer back to how BlackRidge can help them.

BOOKING AN APPOINTMENT — this is the goal
When the visitor wants to talk to someone, get a quote or pricing, see what we'd build for them, or "book a call", help them set it up. Collect, conversationally and without interrogating:
- their name
- their email (read it back to confirm you got it right)
- the name of their business or company, if they have one
- one line on what they're looking for
- when's generally good for them (e.g. "weekday mornings", "next week", "this afternoon") — a rough preference is fine; Chris confirms the exact time

Once you have at least a name and a valid email, log the request with this action:

<david_action>{"type":"request_appointment","name":"<their name>","email":"<their email>","phone":"<optional>","company":"<their business name, optional>","preferred_time":"<rough preference>","topic":"<one line on what they want>"}</david_action>

Logging this automatically adds them to the BlackRidge CRM and emails Chris, so always capture the request through this action rather than just telling them to email us.

After it logs, tell them in plain English that you've got it and Chris will reach out to lock in a time. Don't promise an exact time yourself — we confirm by email. Only emit the action once you actually have their name and email; if you're missing one, ask for it first. Never read the action JSON or the angle-bracket tags out loud — those are stripped before you're heard.

If they're not ready to book, that's fine — answer their questions, be genuinely helpful, and let them know they can set up a call whenever they're ready.`;

// ---- light per-IP rate limit so a public AI endpoint can't be drained ----
const RATE_WINDOW_MS = 10 * 60 * 1000;
const RATE_MAX = 40;
const rateHits = new Map<string, number[]>();
function rateLimited(ip: string): boolean {
  const now = Date.now();
  const hits = (rateHits.get(ip) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  hits.push(now);
  rateHits.set(ip, hits);
  if (rateHits.size > 5000) {
    for (const key of rateHits.keys()) {
      rateHits.delete(key);
      if (rateHits.size <= 2500) break;
    }
  }
  return hits.length > RATE_MAX;
}

type DavidAction = {
  type: "request_appointment";
  name?: string;
  email?: string;
  phone?: string;
  company?: string;
  preferred_time?: string;
  topic?: string;
};

interface ActionResult {
  type: string;
  ok: boolean;
  message: string;
}

function extractActions(text: string): { stripped: string; actions: DavidAction[] } {
  const actions: DavidAction[] = [];
  const stripped = text.replace(/<david_action>([\s\S]*?)<\/david_action>/g, (_full, json) => {
    try {
      const parsed = JSON.parse(String(json).trim());
      if (parsed && typeof parsed === "object" && typeof parsed.type === "string") {
        actions.push(parsed as DavidAction);
      }
    } catch (err) {
      console.warn("David action parse failed:", err);
    }
    return "";
  });
  return { stripped, actions };
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

async function executeAppointment(action: DavidAction): Promise<ActionResult> {
  const name = (action.name ?? "").trim();
  const email = (action.email ?? "").trim().toLowerCase();
  const phone = (action.phone ?? "").trim();
  const company = (action.company ?? "").trim();
  const preferred = (action.preferred_time ?? "").trim();
  const topic = (action.topic ?? "").trim();

  if (!name) return { type: action.type, ok: false, message: "I still need your name before I can set this up." };
  if (!email || !email.includes("@")) {
    return { type: action.type, ok: false, message: "I need a valid email so Chris can reach you." };
  }

  const messageParts = [
    "Appointment request captured by David (website assistant).",
    topic ? `Looking for: ${topic}` : null,
    preferred ? `Preferred time: ${preferred}` : null,
    phone ? `Phone: ${phone}` : null,
  ].filter(Boolean) as string[];
  const message = messageParts.join("\n");
  const notesParts = [
    preferred ? `Preferred time: ${preferred}` : null,
    phone ? `Phone: ${phone}` : null,
  ].filter(Boolean) as string[];

  let leadId: string;
  try {
    const [lead] = await db
      .insert(contactSubmissions)
      .values({
        name,
        email,
        company: company || null,
        message,
        status: "new",
        priority: "high",
        leadSource: "Website Assistant (David)",
        notes: notesParts.length ? notesParts.join(" · ") : null,
      })
      .returning();
    leadId = lead.id;
  } catch (err: any) {
    console.error("David appointment insert failed:", err?.message);
    return { type: action.type, ok: false, message: "Something went wrong saving that — give it another try in a moment." };
  }

  // Fire-and-forget notifications: a copy to Chris, a confirmation to the visitor.
  const resend = getResendClient();
  if (resend) {
    resend.client.emails
      .send({
        from: resend.fromEmail,
        to: [resend.fromEmail],
        subject: `New appointment request: ${name}`,
        html: `<div style="font-family:-apple-system,Segoe UI,sans-serif;font-size:14px;line-height:1.6;color:#1e293b;"><b>New appointment request via David</b><br/><br/><b>${escapeHtml(name)}</b><br/>${escapeHtml(email)}<br/>${phone ? escapeHtml(phone) + "<br/>" : ""}<br/>${preferred ? "<b>Preferred time:</b> " + escapeHtml(preferred) + "<br/>" : ""}${topic ? "<b>Looking for:</b> " + escapeHtml(topic) + "<br/>" : ""}<br/>Reach out to confirm a time.</div>`,
        text: `New appointment request via David.\n\n${name}\n${email}\n${phone}\n\nPreferred time: ${preferred || "(none given)"}\nLooking for: ${topic || "(not specified)"}`,
      })
      .catch((e) => console.error("David owner notify failed:", e?.message));

    resend.client.emails
      .send({
        from: resend.fromEmail,
        to: [email],
        subject: "Thanks for reaching out to BlackRidge Platforms",
        html: `<div style="font-family:-apple-system,Segoe UI,sans-serif;font-size:14px;line-height:1.6;color:#1e293b;">Hi ${escapeHtml(name)},<br/><br/>Thanks for reaching out to BlackRidge Platforms. I've passed your request along to Chris and he'll get back to you personally to lock in a time that works — and to walk you through pricing and a proposal tailored to what you need.<br/><br/>${topic ? "You mentioned you're looking for: " + escapeHtml(topic) + "<br/><br/>" : ""}Talk soon.${davidSignatureHtml()}</div>`,
        text: `Hi ${name},\n\nThanks for reaching out to BlackRidge Platforms. I've passed your request along to Chris and he'll get back to you personally to lock in a time that works — and to walk you through pricing and a proposal tailored to what you need.\n\n${topic ? "You mentioned you're looking for: " + topic + "\n\n" : ""}Talk soon.\n\n${davidSignatureText()}`,
      })
      .catch((e) => console.error("David visitor confirm failed:", e?.message));
  }

  return {
    type: action.type,
    ok: true,
    message: `Got it, ${name} — Chris will reach out to ${email} to set up a time.`,
  };
}

async function ensureDavidSchema(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS david_public_conversations (
      id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
      started_at timestamptz NOT NULL DEFAULT now(),
      last_message_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS david_public_messages (
      id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
      conversation_id varchar NOT NULL REFERENCES david_public_conversations(id) ON DELETE CASCADE,
      role text NOT NULL,
      content text NOT NULL,
      actions jsonb,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS david_public_messages_convo_idx
      ON david_public_messages (conversation_id, created_at)
  `);
}

let schemaReady: Promise<void> | null = null;
function getSchemaReady(): Promise<void> {
  if (!schemaReady) schemaReady = ensureDavidSchema().catch((err) => {
    console.error("David schema error:", err);
    schemaReady = null;
    throw err;
  });
  return schemaReady;
}

export function registerDavidPublicRoutes(app: Express): void {
  app.get("/api/david/conversations/:id/messages", async (req, res) => {
    try {
      await getSchemaReady();
      const r = await db.execute(sql`
        SELECT role, content, actions, created_at
        FROM david_public_messages
        WHERE conversation_id = ${req.params.id}
        ORDER BY created_at ASC
        LIMIT 100
      `);
      const rows = (r as any)?.rows ?? (r as any) ?? [];
      res.json(rows);
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? "failed" });
    }
  });

  app.post("/api/david/voice-stream", async (req, res) => {
    try {
      const ip = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() || req.ip || "unknown";
      if (rateLimited(ip)) {
        return res.status(429).json({ error: "Too many messages — give it a minute." });
      }

      await getSchemaReady();
      const apiKey = process.env.ELEVENLABS_API_KEY;
      const voiceId = process.env.ELEVENLABS_DAVID_VOICE_ID
        || process.env.ELEVENLABS_TRAVIS_VOICE_ID
        || process.env.ELEVENLABS_JAKE_VOICE_ID
        || process.env.ELEVENLABS_VOICE_ID;
      const anthropicKey = process.env.ANTHROPIC_API_KEY;
      if (!anthropicKey) {
        return res.status(500).json({ error: "Assistant not configured" });
      }

      const conversationId = typeof req.body?.conversationId === "string" ? req.body.conversationId : null;
      const messagesIn = Array.isArray(req.body?.messages) ? req.body.messages : [];
      const silent = req.body?.silent === true;
      const incoming = messagesIn
        .map((m: any) => ({ role: m.role === "assistant" ? "assistant" : "user", content: String(m.content ?? "").slice(0, 4000) }))
        .filter((m: { role: string; content: string }) => m.content.length > 0);
      if (incoming.length === 0 || incoming[incoming.length - 1].role !== "user") {
        return res.status(400).json({ error: "No user message" });
      }

      // Pull recent history for continuity within a session.
      let history: { role: string; content: string }[] = [];
      if (conversationId) {
        try {
          const r = await db.execute(sql`
            SELECT role, content
            FROM david_public_messages
            WHERE conversation_id = ${conversationId}
            ORDER BY created_at ASC
            LIMIT 30
          `);
          history = (((r as any)?.rows ?? (r as any) ?? []) as any[]).map((row) => ({
            role: row.role === "assistant" ? "assistant" : "user",
            content: String(row.content ?? ""),
          }));
        } catch (err) {
          console.warn("David history load failed:", err);
        }
      }

      const latestUser = incoming[incoming.length - 1];
      const combined = history.length > 0 ? [...history, latestUser] : incoming;
      const trimmed = combined.slice(-24);

      res.setHeader("Content-Type", "application/octet-stream");
      res.setHeader("Transfer-Encoding", "chunked");
      res.setHeader("Cache-Control", "no-store");
      res.flushHeaders();

      function sendFrame(type: number, payload: Buffer) {
        const header = Buffer.alloc(5);
        header.writeUInt8(type, 0);
        header.writeUInt32BE(payload.length, 1);
        try { res.write(Buffer.concat([header, payload])); } catch { /* socket closed */ }
      }
      const sendText = (t: string) => sendFrame(FRAME_TEXT, Buffer.from(t, "utf-8"));
      const sendDone = (m: object) => sendFrame(FRAME_DONE, Buffer.from(JSON.stringify(m), "utf-8"));

      const canSpeak = !!apiKey && !!voiceId && !silent;
      async function streamTTS(text: string): Promise<void> {
        if (!canSpeak) return;
        const cleaned = text.replace(/<[^>]*>/g, "").slice(0, 2000);
        if (!cleaned.trim()) return;
        try {
          const ttsResp = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream`, {
            method: "POST",
            headers: { "xi-api-key": apiKey!, "Content-Type": "application/json" },
            body: JSON.stringify({
              text: cleaned,
              model_id: "eleven_turbo_v2_5",
              voice_settings: { stability: 0.32, similarity_boost: 0.8, style: 0.45, use_speaker_boost: true, speed: 1.05 },
            }),
          });
          if (!ttsResp.ok) {
            console.error("[david/voice-stream] TTS error:", ttsResp.status);
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
          console.error("[david/voice-stream] TTS pipe error:", e?.message);
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
        max_tokens: 900,
        system: DAVID_SYSTEM,
        messages: trimmed.map((m: { role: string; content: string }) => ({
          role: m.role === "assistant" ? "assistant" : "user",
          content: m.content,
        })) as any,
      });

      stream.on("text", (delta: string) => {
        fullReply += delta;
        sendText(delta);
        for (const ch of delta) {
          if (holdingTag) {
            tagBuffer += ch;
            if (tagBuffer.includes("</david_action>")) { tagBuffer = ""; holdingTag = false; }
            continue;
          }
          speakable += ch;
          const tail = speakable.slice(-20);
          const idx = tail.indexOf("<david_action>");
          if (idx >= 0) {
            const cut = speakable.length - (tail.length - idx);
            speakable = speakable.slice(0, cut);
            holdingTag = true;
            tagBuffer = "<david_action>";
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
        console.error("[david/voice-stream] Anthropic stream error:", err?.message);
      }
      if (speakable.trim()) await streamTTS(speakable);

      const { stripped, actions } = extractActions(fullReply);
      const results: ActionResult[] = [];
      for (const a of actions) {
        if (a.type === "request_appointment") {
          results.push(await executeAppointment(a));
        }
      }

      let writtenConversationId = conversationId;
      try {
        if (!writtenConversationId) {
          const r = await db.execute(sql`INSERT INTO david_public_conversations DEFAULT VALUES RETURNING id`);
          writtenConversationId = (((r as any)?.rows?.[0] ?? (r as any)?.[0]) as { id: string }).id;
        }
        await db.execute(sql`
          INSERT INTO david_public_messages (conversation_id, role, content)
          VALUES (${writtenConversationId}, 'user', ${latestUser.content})
        `);
        await db.execute(sql`
          INSERT INTO david_public_messages (conversation_id, role, content, actions)
          VALUES (${writtenConversationId}, 'assistant', ${stripped.trim()}, ${actions.length ? JSON.stringify(results) : null}::jsonb)
        `);
        await db.execute(sql`
          UPDATE david_public_conversations SET last_message_at = now() WHERE id = ${writtenConversationId}
        `);
      } catch (err) {
        console.error("David memory write failed:", err);
      }

      sendDone({ fullReply: stripped, actions: results, conversationId: writtenConversationId });
      try { res.end(); } catch { /* */ }
    } catch (error: any) {
      console.error("David voice-stream fatal:", error);
      if (!res.headersSent) res.status(500).json({ error: error?.message ?? "David stream failed" });
      else try { res.end(); } catch { /* */ }
    }
  });
}
