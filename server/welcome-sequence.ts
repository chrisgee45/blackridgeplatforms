import type { Express, RequestHandler } from "express";
import { db } from "./db";
import { welcomeSequences, kickoffSubmissions, projects, contacts, companies } from "@shared/schema";
import { eq, and, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { Resend } from "resend";
import crypto from "crypto";

const startSequenceSchema = z.object({
  clientName: z.string().min(1).trim(),
  clientEmail: z.string().email().trim(),
  companyName: z.string().optional(),
});

async function getResendClient() {
  try {
    const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
    const xReplitToken = process.env.REPL_IDENTITY
      ? "repl " + process.env.REPL_IDENTITY
      : process.env.WEB_REPL_RENEWAL
      ? "depl " + process.env.WEB_REPL_RENEWAL
      : null;
    if (!xReplitToken || !hostname) return null;
    const connectionSettings = await fetch(
      "https://" + hostname + "/api/v2/connection?include_secrets=true&connector_names=resend",
      { headers: { Accept: "application/json", X_REPLIT_TOKEN: xReplitToken } }
    ).then((res) => res.json()).then((data) => data.items?.[0]);
    if (!connectionSettings || !connectionSettings.settings?.api_key) return null;
    return {
      client: new Resend(connectionSettings.settings.api_key),
      fromEmail: connectionSettings.settings.from_email,
    };
  } catch {
    return null;
  }
}

function getBaseUrl() {
  if (process.env.REPLIT_DEPLOYMENT_URL) return `https://${process.env.REPLIT_DEPLOYMENT_URL}`;
  const domains = process.env.REPLIT_DOMAINS;
  if (domains) {
    const first = domains.split(",")[0].trim();
    if (first) return `https://${first}`;
  }
  if (process.env.REPLIT_DEV_DOMAIN) return `https://${process.env.REPLIT_DEV_DOMAIN}`;
  return "https://blackridgeplatforms.com";
}

function emailWrapper(bodyHtml: string) {
  return `
    <div style="font-family: 'Helvetica Neue', Arial, sans-serif; background: #0A0A0A; color: #ffffff; padding: 40px 20px;">
      <div style="max-width: 600px; margin: 0 auto;">
        <div style="text-align: center; padding: 20px 0 30px; border-bottom: 1px solid #222;">
          <h1 style="font-size: 22px; font-weight: 700; margin: 0; letter-spacing: 2px;">BLACKRIDGE</h1>
          <p style="color: #C9A840; font-size: 11px; letter-spacing: 3px; margin: 4px 0 0;">PLATFORMS</p>
        </div>
        <div style="padding: 36px 0; line-height: 1.8; font-size: 15px; color: #ddd;">
          ${bodyHtml}
        </div>
        <div style="border-top: 1px solid #222; padding-top: 20px; text-align: center;">
          <p style="color: #555; font-size: 12px; margin: 0;">BlackRidge Platforms | Edmond, Oklahoma</p>
        </div>
      </div>
    </div>
  `;
}

function buildEmail1(firstName: string) {
  return {
    subject: "You made a good call.",
    html: emailWrapper(`
      <p style="margin: 0 0 20px;">Hey ${firstName},</p>
      <p style="margin: 0 0 16px;">Welcome to BlackRidge.</p>
      <p style="margin: 0 0 16px;">I don't take on every client. I take on the right ones. So the fact that you're here means I already believe in what you're building and I'm ready to go all in on it.</p>
      <p style="margin: 0 0 16px;">Here's what the next few days look like.</p>
      <p style="margin: 0 0 16px;">I'm going to send you a kickoff form. It's not busy work. Every question in it is something I actually need to build this thing right. The more you give me, the better this turns out.</p>
      <p style="margin: 0 0 16px;">Once I have that back I'll review everything, map out the build, and reach out with a clear plan and timeline before anything starts.</p>
      <p style="margin: 0 0 16px;">No surprises. No guessing. Just clean execution.</p>
      <p style="margin: 0 0 16px;">Talk soon.</p>
      <p style="margin: 0 0 4px; font-weight: 600;">Chris</p>
      <p style="margin: 0; color: #888; font-size: 13px;">Founder, BlackRidge Platforms</p>
    `),
  };
}

function buildEmail2(firstName: string) {
  return {
    subject: "Before we build — a few things worth knowing.",
    html: emailWrapper(`
      <p style="margin: 0 0 20px;">Hey ${firstName},</p>
      <p style="margin: 0 0 16px;">Before the kickoff form hits your inbox, I want to give you a heads up so you're not scrambling when it arrives.</p>
      <p style="margin: 0 0 8px; font-weight: 600; color: #C9A840;">Start pulling these together now:</p>
      <p style="margin: 0 0 12px;"><strong>Your logo files.</strong> Find the highest quality version — ideally SVG or PNG with a transparent background. If you don't have them, no problem, we'll talk about it.</p>
      <p style="margin: 0 0 12px;"><strong>Photos.</strong> Professional photos of your team, your space, your work. If you have them, start a folder. If you don't, we'll figure out a plan.</p>
      <p style="margin: 0 0 12px;"><strong>Websites you love.</strong> Pull up two or three sites that catch your eye and bookmark them. Doesn't have to be your industry. Just things that feel right.</p>
      <p style="margin: 0 0 16px;"><strong>Logins.</strong> Think about what platforms and accounts are tied to your business online. Domain registrar, social media, existing website, Google Business. You don't need to share passwords yet — just know where they live.</p>
      <p style="margin: 0 0 16px; font-weight: 600; color: #C9A840;">One thing I want you to know:</p>
      <p style="margin: 0 0 16px;">This build is a collaboration. The answers you give me on that form are the foundation everything gets built on. Take your time with it. Be specific. The clients who fill it out thoroughly always end up with something they're proud of.</p>
      <p style="margin: 0 0 16px;">The form is coming in a couple hours.</p>
      <p style="margin: 0 0 4px; font-weight: 600;">Chris</p>
      <p style="margin: 0; color: #888; font-size: 13px;">Founder, BlackRidge Platforms</p>
    `),
  };
}

function buildEmail3(firstName: string, kickoffUrl: string) {
  return {
    subject: "Let's get started — your kickoff form is ready.",
    html: emailWrapper(`
      <p style="margin: 0 0 20px;">Hey ${firstName},</p>
      <p style="margin: 0 0 16px;">This is it. The form that kicks everything off.</p>
      <p style="margin: 0 0 16px;">It covers your brand, your pages, your content, your features, your timeline, and everything in between. Takes most people about 10 to 15 minutes if they've got their thoughts together.</p>
      <p style="margin: 0 0 8px; font-weight: 600; color: #C9A840;">A couple things before you dive in:</p>
      <p style="margin: 0 0 12px;"><strong>Be specific.</strong> "I want it to look clean and professional" tells me nothing. "I want it to feel like a luxury brand but approachable, like a high-end gym rather than a law firm" tells me everything. The more specific you are the less we go back and forth.</p>
      <p style="margin: 0 0 12px;"><strong>Upload what you have.</strong> Even if it's rough. Logos, photos, old brand files, screenshots of things you like. Throw it all in. I'd rather have too much than too little.</p>
      <p style="margin: 0 0 20px;">If you get stuck on something, skip it and come back. Nothing is permanent. But do your best to fill it out completely before you submit.</p>
      <div style="text-align: center; padding: 20px 0 24px;">
        <a href="${kickoffUrl}" style="background: #C9A840; color: #000; padding: 16px 40px; text-decoration: none; font-weight: 700; font-size: 15px; border-radius: 4px; display: inline-block; letter-spacing: 1px;">FILL OUT YOUR KICKOFF FORM →</a>
      </div>
      <p style="margin: 0 0 16px;">Once I have this back I'll be in touch within one business day with next steps.</p>
      <p style="margin: 0 0 16px;">Let's build something great.</p>
      <p style="margin: 0 0 4px; font-weight: 600;">Chris</p>
      <p style="margin: 0; color: #888; font-size: 13px;">Founder, BlackRidge Platforms</p>
    `),
  };
}

async function getOrCreateKickoffToken(projectId: string, clientName: string, clientEmail: string, companyName: string | null): Promise<string> {
  const existing = await db.select().from(kickoffSubmissions).where(eq(kickoffSubmissions.projectId, projectId));
  if (existing.length > 0 && existing[0].status !== "submitted") {
    return existing[0].token;
  }
  if (existing.length > 0 && existing[0].status === "submitted") {
    return existing[0].token;
  }
  const token = crypto.randomUUID();
  await db.insert(kickoffSubmissions).values({
    projectId,
    clientName,
    clientEmail,
    companyName,
    token,
    status: "sent",
    sentAt: new Date(),
  });
  return token;
}

const sendingLocks = new Set<string>();

async function sendSequenceEmail(sequenceId: string, emailNum: 1 | 2 | 3, forceResend = false) {
  const lockKey = `${sequenceId}-${emailNum}`;
  if (sendingLocks.has(lockKey)) return;
  sendingLocks.add(lockKey);
  try {
    await _sendSequenceEmail(sequenceId, emailNum, forceResend);
  } finally {
    sendingLocks.delete(lockKey);
  }
}

async function _sendSequenceEmail(sequenceId: string, emailNum: 1 | 2 | 3, forceResend: boolean) {
  const rows = await db.select().from(welcomeSequences).where(eq(welcomeSequences.id, sequenceId));
  if (!rows.length) return;
  const seq = rows[0];

  if (seq.status === "cancelled") return;

  const sentField = emailNum === 1 ? "email1SentAt" : emailNum === 2 ? "email2SentAt" : "email3SentAt";
  const errorField = emailNum === 1 ? "email1Error" : emailNum === 2 ? "email2Error" : "email3Error";

  if (seq[sentField] && !forceResend) return;

  const firstName = seq.clientName.split(" ")[0];
  let emailData: { subject: string; html: string };

  if (emailNum === 3) {
    const token = await getOrCreateKickoffToken(seq.projectId, seq.clientName, seq.clientEmail, seq.companyName);
    const kickoffUrl = `${getBaseUrl()}/kickoff/${token}`;
    emailData = buildEmail3(firstName, kickoffUrl);
  } else if (emailNum === 2) {
    emailData = buildEmail2(firstName);
  } else {
    emailData = buildEmail1(firstName);
  }

  const resend = await getResendClient();
  if (!resend) {
    await db.update(welcomeSequences).set({ [errorField]: "Resend client unavailable" }).where(eq(welcomeSequences.id, sequenceId));
    return;
  }

  try {
    await resend.client.emails.send({
      from: resend.fromEmail || "BlackRidge Platforms <onboarding@resend.dev>",
      to: seq.clientEmail,
      subject: emailData.subject,
      html: emailData.html,
    });
    const updates: any = { [sentField]: new Date(), [errorField]: null };
    if (emailNum === 3) updates.status = "completed";
    else if (emailNum === 1) updates.status = "running";
    await db.update(welcomeSequences).set(updates).where(eq(welcomeSequences.id, sequenceId));
    console.log(`Welcome sequence ${sequenceId}: Email ${emailNum} sent to ${seq.clientEmail}`);
  } catch (err: any) {
    await db.update(welcomeSequences).set({ [errorField]: err.message || "Send failed" }).where(eq(welcomeSequences.id, sequenceId));
    console.error(`Welcome sequence ${sequenceId}: Email ${emailNum} failed:`, err.message);
  }
}

export async function triggerWelcomeSequence(projectId: string, triggeredBy: "auto" | "manual", clientName?: string, clientEmail?: string, companyName?: string): Promise<{ created: boolean; sequence?: any; message?: string }> {
  const existing = await db.select().from(welcomeSequences).where(eq(welcomeSequences.projectId, projectId));
  if (existing.length > 0 && (existing[0].status === "running" || existing[0].status === "completed")) {
    return { created: false, message: "Sequence already exists", sequence: existing[0] };
  }

  if (existing.length > 0 && existing[0].status === "cancelled") {
    await db.delete(welcomeSequences).where(eq(welcomeSequences.id, existing[0].id));
  }

  let name = clientName || "";
  let email = clientEmail || "";
  let company = companyName || "";

  if (!name || !email) {
    const proj = await db.select().from(projects).where(eq(projects.id, projectId));
    if (!proj.length) return { created: false, message: "Project not found" };
    if (proj[0].contactId) {
      const c = await db.select().from(contacts).where(eq(contacts.id, proj[0].contactId));
      if (c.length) { name = name || c[0].name; email = email || c[0].email || ""; }
    }
    if (proj[0].companyId) {
      const co = await db.select().from(companies).where(eq(companies.id, proj[0].companyId));
      if (co.length) company = company || co[0].name;
    }
  }

  if (!name || !email) {
    return { created: false, message: "Client name and email are required" };
  }

  const [seq] = await db.insert(welcomeSequences).values({
    projectId,
    clientName: name,
    clientEmail: email,
    companyName: company || null,
    status: "pending",
    triggeredBy,
  }).returning();

  sendSequenceEmail(seq.id, 1).catch(err => console.error("Email 1 send error:", err));

  return { created: true, sequence: seq };
}

const EMAIL_DELAY_MS = 2 * 60 * 60 * 1000;

export function startWelcomeSequenceRunner() {
  setInterval(async () => {
    try {
      const running = await db.select().from(welcomeSequences).where(eq(welcomeSequences.status, "running"));
      const now = Date.now();

      for (const seq of running) {
        if (seq.email1SentAt && !seq.email2SentAt && !seq.email2Error) {
          const email1Time = new Date(seq.email1SentAt).getTime();
          if (now - email1Time >= EMAIL_DELAY_MS) {
            await sendSequenceEmail(seq.id, 2);
          }
        }

        if (seq.email2SentAt && !seq.email3SentAt && !seq.email3Error) {
          const email2Time = new Date(seq.email2SentAt).getTime();
          if (now - email2Time >= EMAIL_DELAY_MS) {
            await sendSequenceEmail(seq.id, 3);
          }
        }
      }
    } catch (err) {
      console.error("Welcome sequence runner error:", err);
    }
  }, 60_000);
  console.log("Welcome sequence runner started (60s interval)");
}

export function registerWelcomeSequenceRoutes(app: Express, isAuthenticated: RequestHandler) {
  app.get("/api/ops/projects/:projectId/sequence", isAuthenticated, async (req, res) => {
    try {
      const rows = await db.select().from(welcomeSequences)
        .where(eq(welcomeSequences.projectId, req.params.projectId));
      res.json(rows[0] || null);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/ops/projects/:projectId/sequence/start", isAuthenticated, async (req, res) => {
    try {
      const parsed = startSequenceSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: "Valid client name and email are required" });
      const { clientName, clientEmail, companyName } = parsed.data;
      const result = await triggerWelcomeSequence(
        req.params.projectId, "manual", clientName, clientEmail, companyName
      );
      if (!result.created) {
        return res.status(400).json({ error: result.message });
      }
      res.json(result.sequence);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/ops/projects/:projectId/sequence/cancel", isAuthenticated, async (req, res) => {
    try {
      const rows = await db.select().from(welcomeSequences)
        .where(eq(welcomeSequences.projectId, req.params.projectId));
      if (!rows.length) return res.status(404).json({ error: "No sequence found" });
      if (rows[0].status === "cancelled") return res.json({ success: true });

      await db.update(welcomeSequences).set({ status: "cancelled" }).where(eq(welcomeSequences.id, rows[0].id));
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/ops/projects/:projectId/sequence/restart", isAuthenticated, async (req, res) => {
    try {
      const rows = await db.select().from(welcomeSequences)
        .where(eq(welcomeSequences.projectId, req.params.projectId));
      if (rows.length) {
        await db.delete(welcomeSequences).where(eq(welcomeSequences.id, rows[0].id));
      }
      const parsed = startSequenceSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: "Valid client name and email are required" });
      const { clientName, clientEmail, companyName } = parsed.data;
      const result = await triggerWelcomeSequence(
        req.params.projectId, "manual", clientName, clientEmail, companyName
      );
      if (!result.created) {
        return res.status(400).json({ error: result.message });
      }
      res.json(result.sequence);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/ops/projects/:projectId/sequence/resend/:emailNum", isAuthenticated, async (req, res) => {
    try {
      const emailNum = parseInt(req.params.emailNum) as 1 | 2 | 3;
      if (![1, 2, 3].includes(emailNum)) return res.status(400).json({ error: "Invalid email number" });

      const rows = await db.select().from(welcomeSequences)
        .where(eq(welcomeSequences.projectId, req.params.projectId));
      if (!rows.length) return res.status(404).json({ error: "No sequence found" });

      await sendSequenceEmail(rows[0].id, emailNum, true);

      const updated = await db.select().from(welcomeSequences).where(eq(welcomeSequences.id, rows[0].id));
      res.json(updated[0]);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });
}
