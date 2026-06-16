/**
 * Jake voice chat. Mirrors the framed-streaming protocol used by Ridge
 * (FRAME_TEXT for the running transcript, FRAME_AUDIO for ElevenLabs TTS
 * bytes, FRAME_DONE with the final message metadata) but with Jake's
 * persona, a separate voice id, and conversation tuning that's
 * deliberately tighter and more back-and-forth than Ridge's CFO mode.
 */
import type { Express, RequestHandler } from "express";
import Anthropic from "@anthropic-ai/sdk";
import { db } from "./db";
import { projects, projectConversations, clients, contacts, companies } from "@shared/schema";
import { eq, desc, and, sql } from "drizzle-orm";

const FRAME_AUDIO = 0x01;
const FRAME_TEXT = 0x02;
const FRAME_DONE = 0x03;

const JAKE_SYSTEM_VOICE = `You are Jake, Chris Gee's assistant at BlackRidge Platforms — but right now you're talking to Chris directly, by voice, inside the BlackRidge OPS portal.

This is a VOICE conversation. Talk like a real person on a call. Short turns. Natural acknowledgments ("yeah", "got it", "let me check"). React first, then answer. If Chris asks a quick question, give a quick answer — one sentence, maybe two. Expand only when he asks you to.

You handle BlackRidge's day-to-day client communication. You know about every project Chris has activated you on, every client conversation that's gone through your inbox at jake@reply.blackridgeplatforms.com, every open handoff, every check-in you've sent. The context block below has the live data — use it instead of asking Chris to repeat things he already knows.

Voice rules:
- No markdown, no bullet points, no asterisks, no numbered lists. Just talk.
- Contractions always. No corporate filler. No em dashes.
- Never say "I hope this finds you well", "circle back", "synergy", "leverage".
- If Chris asks about a specific client, lead with the most recent thing that happened on their account, then offer to dig deeper.
- If you don't know, say so. Don't invent details.
- When Chris asks you to email/send/follow up on something, acknowledge it as a task. (Future: actually queue the action — for now, just confirm you'd handle it.)
- Stay on the BlackRidge side of the line. You handle client comms, project status, conversation context. Money / accounting / tax questions belong to Ridge (the other AI on this portal).`;

async function buildJakeSnapshot(): Promise<string> {
  // Pull a tight summary of Jake-relevant state. Verbose enough that Jake
  // can answer "what did Hometown say last week" without re-querying.
  const lines: string[] = [];

  const enabledProjects = await db
    .select()
    .from(projects)
    .where(eq(projects.jakeEnabled, true))
    .orderBy(desc(projects.jakeStartedAt));

  if (enabledProjects.length === 0) {
    lines.push("No projects currently have Jake enabled.");
  } else {
    lines.push(`Active projects under Jake's care (${enabledProjects.length}):`);
    for (const p of enabledProjects.slice(0, 20)) {
      let label = p.name;
      if (p.clientId) {
        const [cl] = await db.select().from(clients).where(eq(clients.id, p.clientId));
        if (cl?.name) label += ` (${cl.name})`;
      } else if (p.companyId) {
        const [co] = await db.select().from(companies).where(eq(companies.id, p.companyId));
        if (co?.name) label += ` (${co.name})`;
      }
      const flag = p.jakeAwaitingHandoff
        ? ` — AWAITING YOUR ANSWER: ${p.jakeHandoffReason ?? "needs Chris"}`
        : "";
      lines.push(`- ${label} [${p.stage}]${flag}`);
    }
  }

  // Recent conversation activity, last 7 days.
  const since = new Date(Date.now() - 7 * 86400000);
  const recent = await db
    .select()
    .from(projectConversations)
    .where(sql`${projectConversations.createdAt} >= ${since}`)
    .orderBy(desc(projectConversations.createdAt))
    .limit(40);

  if (recent.length > 0) {
    lines.push("");
    lines.push(`Last 7 days of Jake conversation (${recent.length} entries):`);
    const projectNames = new Map<string, string>();
    for (const p of enabledProjects) projectNames.set(p.id, p.name);
    for (const c of recent.slice(0, 30)) {
      const proj = projectNames.get(c.projectId) ?? "Unknown project";
      const who = c.direction === "inbound" ? "CLIENT" : (c.classification === "HANDOFF_RELAY" ? "Chris-via-Jake" : "Jake");
      const snippet = (c.body ?? "").replace(/\s+/g, " ").slice(0, 200);
      lines.push(`  ${new Date(c.createdAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} · ${proj} · ${who}: ${snippet}`);
    }
  }

  // Open handoffs surfaced explicitly at the top of Jake's awareness.
  const openHandoffs = enabledProjects.filter(p => p.jakeAwaitingHandoff);
  if (openHandoffs.length > 0) {
    lines.push("");
    lines.push(`OPEN HANDOFFS REQUIRING CHRIS (${openHandoffs.length}):`);
    for (const p of openHandoffs) {
      lines.push(`- ${p.name}: ${p.jakeHandoffReason ?? "Needs answer"}`);
    }
  }

  return lines.join("\n");
}

export function registerJakeVoiceRoutes(app: Express, isAuthenticated: RequestHandler): void {
  app.post("/api/jake/voice-stream", isAuthenticated, async (req, res) => {
    try {
      const apiKey = process.env.ELEVENLABS_API_KEY;
      const voiceId = process.env.ELEVENLABS_JAKE_VOICE_ID || process.env.ELEVENLABS_VOICE_ID;
      const anthropicKey = process.env.ANTHROPIC_API_KEY;
      if (!apiKey || !voiceId) {
        return res.status(500).json({ error: "ElevenLabs not configured (set ELEVENLABS_JAKE_VOICE_ID)" });
      }
      if (!anthropicKey) {
        return res.status(500).json({ error: "Anthropic not configured" });
      }

      const messagesIn = Array.isArray(req.body?.messages) ? req.body.messages : [];
      const messages = messagesIn
        .map((m: any) => ({ role: m.role === "assistant" ? "assistant" : "user", content: String(m.content ?? "") }))
        .filter((m: any) => m.content.length > 0)
        .slice(-16);
      if (messages.length === 0 || messages[messages.length - 1].role !== "user") {
        return res.status(400).json({ error: "No user message" });
      }

      const snapshot = await buildJakeSnapshot();
      const system = `${JAKE_SYSTEM_VOICE}\n\n=== LIVE JAKE STATE ===\n${snapshot}`;

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
        const cleaned = text.replace(/<[^>]*>/g, "").slice(0, 2000);
        if (!cleaned.trim()) return;
        try {
          const ttsResp = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream`, {
            method: "POST",
            headers: { "xi-api-key": apiKey!, "Content-Type": "application/json" },
            body: JSON.stringify({
              text: cleaned,
              model_id: "eleven_turbo_v2_5",
              // Tuned for back-and-forth conversation, not announce-mode:
              // lower stability = more expressive variation
              // higher style = more personality and inflection
              // normal speed (Ridge runs 1.20 for CFO terseness)
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

      const anthropic = new Anthropic({ apiKey: anthropicKey });
      let fullReply = "";
      let sentenceBuffer = "";
      const flushBoundary = /[.!?]\s+/;

      const stream = anthropic.messages.stream({
        model: "claude-sonnet-4-6",
        max_tokens: 800,
        system,
        messages,
      });

      stream.on("text", async (delta: string) => {
        fullReply += delta;
        sentenceBuffer += delta;
        sendText(delta);
        // Flush to TTS at sentence boundaries so audio starts playing
        // before the whole response is generated.
        const lastBoundary = sentenceBuffer.search(flushBoundary);
        if (lastBoundary >= 0) {
          const ready = sentenceBuffer.slice(0, lastBoundary + 1);
          sentenceBuffer = sentenceBuffer.slice(lastBoundary + 1);
          streamTTS(ready).catch(() => { /* errors already logged */ });
        }
      });

      try {
        await stream.finalMessage();
      } catch (err: any) {
        console.error("[jake/voice-stream] Anthropic stream error:", err?.message);
        sendDone({ fullReply, error: err?.message ?? "stream error" });
        try { res.end(); } catch { /* */ }
        return;
      }

      if (sentenceBuffer.trim()) {
        await streamTTS(sentenceBuffer);
      }
      sendDone({ fullReply });
      try { res.end(); } catch { /* */ }
    } catch (error: any) {
      console.error("Jake voice-stream fatal:", error);
      if (!res.headersSent) res.status(500).json({ error: error?.message ?? "Jake voice stream failed" });
      else try { res.end(); } catch { /* */ }
    }
  });
}
