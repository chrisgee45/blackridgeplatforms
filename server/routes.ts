import type { Express, RequestHandler } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { insertContactSchema, updateLeadSchema, createLeadSchema, adminUsers, ridgeConversations, ridgeMessages } from "@shared/schema";
import { db } from "./db";
import { eq, desc, sql } from "drizzle-orm";
import { ZodError } from "zod";
import { fromZodError } from "zod-validation-error";
import session from "express-session";
import connectPg from "connect-pg-simple";
import { registerOpsRoutes } from "./ops-routes";
import { registerObjectStorageRoutes } from "./object-storage";
import { getResendClient } from "./email";
import { createAiRouter } from "./routes/ai";
import { registerOutreachRoutes } from "./outreach-routes";
import PDFDocument from "pdfkit";
import { registerStripeRoutes } from "./stripe-routes";
import { registerBookkeepingRoutes } from "./bookkeeping-routes";
import { createAccountingV2Router } from "./accounting-v2-routes";
import { registerGaapRoutes } from "./gaap-routes";
import { seedCampaignA } from "./outreach-seed";
import { seedQaTemplates } from "./qa-seed";
import { startOutreachJobRunner as startJobRunner } from "./outreach-jobs";
import { startRecurringExpenseRunner } from "./recurring-expenses";
import { registerBackupRoutes } from "./backup-routes";
import { registerScheduleCExportRoutes } from "./schedule-c-export";
import { registerPlaidRoutes } from "./plaid-routes";
import { registerPolicyRoutes } from "./policy-routes";
import { registerKickoffRoutes } from "./kickoff-routes";
import { registerWelcomeSequenceRoutes, startWelcomeSequenceRunner } from "./welcome-sequence";
import { startDailyBackupScheduler } from "./backup-service";
import { registerQaAuditRoutes } from "./qa-audit-routes";
import { opsStorage } from "./ops-storage";
import { encryptSecret, decryptSecret } from "./mfa-crypto";

const mfaAttempts = new Map<string, { count: number; lastAttempt: number }>();
const MFA_MAX_ATTEMPTS = 5;
const MFA_LOCKOUT_MS = 15 * 60 * 1000;

function checkMfaRateLimit(key: string): boolean {
  const now = Date.now();
  const entry = mfaAttempts.get(key);
  if (!entry) return true;
  if (now - entry.lastAttempt > MFA_LOCKOUT_MS) {
    mfaAttempts.delete(key);
    return true;
  }
  return entry.count < MFA_MAX_ATTEMPTS;
}

function recordMfaAttempt(key: string) {
  const now = Date.now();
  const entry = mfaAttempts.get(key);
  if (!entry || now - entry.lastAttempt > MFA_LOCKOUT_MS) {
    mfaAttempts.set(key, { count: 1, lastAttempt: now });
  } else {
    entry.count++;
    entry.lastAttempt = now;
  }
}

function clearMfaAttempts(key: string) {
  mfaAttempts.delete(key);
}

function setupAdminAuth(app: Express) {
  const sessionTtl = 7 * 24 * 60 * 60 * 1000;
  const pgStore = connectPg(session);
  const sessionStore = new pgStore({
    conString: process.env.DATABASE_URL,
    createTableIfMissing: true,
    ttl: sessionTtl,
    tableName: "sessions",
  });
  app.set("trust proxy", 1);
  app.use(
    session({
      secret: process.env.SESSION_SECRET!,
      store: sessionStore,
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        maxAge: sessionTtl,
      },
    })
  );

  app.post("/api/admin/login", async (req, res) => {
    const { username, password, totpCode } = req.body;
    const adminUsername = process.env.ADMIN_USERNAME;
    const adminPassword = process.env.ADMIN_PASSWORD;

    if (!adminUsername || !adminPassword) {
      return res.status(500).json({ message: "Admin credentials not configured" });
    }

    if (username?.trim().toLowerCase() !== adminUsername.trim().toLowerCase() || password?.trim() !== adminPassword.trim()) {
      return res.status(401).json({ message: "Invalid username or password" });
    }

    const normalizedUsername = username.trim().toLowerCase();
    const existing = await db.select().from(adminUsers).where(eq(adminUsers.username, normalizedUsername)).limit(1);

    if (existing.length > 0 && existing[0].mfaEnabled && existing[0].mfaSecret) {
      if (!totpCode) {
        return res.json({ mfaRequired: true });
      }
      if (!/^\d{6}$/.test(totpCode)) {
        return res.status(400).json({ message: "Verification code must be 6 digits" });
      }
      const rateLimitKey = `login:${normalizedUsername}`;
      if (!checkMfaRateLimit(rateLimitKey)) {
        return res.status(429).json({ message: "Too many attempts. Please try again in 15 minutes." });
      }
      const { TOTP } = await import("otpauth");
      const decryptedSecret = decryptSecret(existing[0].mfaSecret);
      const totp = new TOTP({ issuer: "BlackRidge", label: normalizedUsername, secret: decryptedSecret, algorithm: "SHA1", digits: 6, period: 30 });
      const delta = totp.validate({ token: totpCode, window: 1 });
      if (delta === null) {
        recordMfaAttempt(rateLimitKey);
        return res.status(401).json({ message: "Invalid verification code" });
      }
      clearMfaAttempts(rateLimitKey);
    }

    (req.session as any).isAdmin = true;
    if (existing.length > 0) {
      await db.update(adminUsers).set({ lastLoginAt: new Date() }).where(eq(adminUsers.username, normalizedUsername));
      (req.session as any).adminRole = existing[0].role || "admin";
    } else {
      await db.insert(adminUsers).values({ username: normalizedUsername, lastLoginAt: new Date(), role: "admin" });
      (req.session as any).adminRole = "admin";
    }
    (req.session as any).adminUsername = normalizedUsername;

    return res.json({ success: true });
  });

  app.get("/api/auth/user", (req, res) => {
    if ((req.session as any)?.isAdmin) {
      return res.json({
        id: "admin",
        firstName: "Admin",
        lastName: "",
        role: (req.session as any)?.adminRole || "admin",
        username: (req.session as any)?.adminUsername || "admin",
      });
    }
    res.status(401).json({ message: "Unauthorized" });
  });

  app.post("/api/logout", (req, res) => {
    req.session.destroy((err) => {
      res.json({ success: true });
    });
  });

  app.get("/api/mfa/status", async (req, res) => {
    if (!(req.session as any)?.isAdmin) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    const username = (req.session as any).adminUsername;
    if (!username) return res.json({ enabled: false });
    const [user] = await db.select().from(adminUsers).where(eq(adminUsers.username, username)).limit(1);
    res.json({ enabled: user?.mfaEnabled || false });
  });

  app.post("/api/mfa/setup", async (req, res) => {
    if (!(req.session as any)?.isAdmin) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    try {
      const { TOTP, Secret } = await import("otpauth");
      const QRCode = await import("qrcode");
      const username = (req.session as any).adminUsername || "admin";
      const secret = new Secret({ size: 20 });
      const totp = new TOTP({ issuer: "BlackRidge", label: username, secret: secret, algorithm: "SHA1", digits: 6, period: 30 });
      const otpauthUrl = totp.toString();
      const qrDataUrl = await QRCode.toDataURL(otpauthUrl);

      (req.session as any).pendingMfaSecret = secret.base32;

      res.json({ qrCode: qrDataUrl, secret: secret.base32, otpauthUrl });
    } catch (error) {
      console.error("MFA setup error:", error);
      res.status(500).json({ message: "Failed to generate MFA setup" });
    }
  });

  app.post("/api/mfa/verify-setup", async (req, res) => {
    if (!(req.session as any)?.isAdmin) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    const { code } = req.body;
    if (!code || !/^\d{6}$/.test(code)) {
      return res.status(400).json({ message: "Code must be 6 digits" });
    }
    const pendingSecret = (req.session as any).pendingMfaSecret;
    if (!pendingSecret) {
      return res.status(400).json({ message: "No MFA setup in progress. Start setup first." });
    }
    const rateLimitKey = `setup:${(req.session as any).adminUsername}`;
    if (!checkMfaRateLimit(rateLimitKey)) {
      return res.status(429).json({ message: "Too many attempts. Please try again in 15 minutes." });
    }
    try {
      const { TOTP } = await import("otpauth");
      const totp = new TOTP({ issuer: "BlackRidge", label: (req.session as any).adminUsername || "admin", secret: pendingSecret, algorithm: "SHA1", digits: 6, period: 30 });
      const delta = totp.validate({ token: code, window: 1 });
      if (delta === null) {
        recordMfaAttempt(rateLimitKey);
        return res.status(400).json({ message: "Invalid code. Please try again." });
      }

      clearMfaAttempts(rateLimitKey);
      const username = (req.session as any).adminUsername;
      const encrypted = encryptSecret(pendingSecret);
      await db.update(adminUsers)
        .set({ mfaSecret: encrypted, mfaEnabled: true })
        .where(eq(adminUsers.username, username));

      delete (req.session as any).pendingMfaSecret;
      res.json({ success: true });
    } catch (error) {
      console.error("MFA verify error:", error);
      res.status(500).json({ message: "Failed to verify MFA code" });
    }
  });

  app.post("/api/mfa/disable", async (req, res) => {
    if (!(req.session as any)?.isAdmin) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    const { code } = req.body;
    if (!code || !/^\d{6}$/.test(code)) {
      return res.status(400).json({ message: "Code must be 6 digits" });
    }
    const username = (req.session as any).adminUsername;
    const rateLimitKey = `disable:${username}`;
    if (!checkMfaRateLimit(rateLimitKey)) {
      return res.status(429).json({ message: "Too many attempts. Please try again in 15 minutes." });
    }
    const [user] = await db.select().from(adminUsers).where(eq(adminUsers.username, username)).limit(1);
    if (!user?.mfaEnabled || !user.mfaSecret) {
      return res.status(400).json({ message: "MFA is not enabled" });
    }

    try {
      const { TOTP } = await import("otpauth");
      const decryptedSecret = decryptSecret(user.mfaSecret);
      const totp = new TOTP({ issuer: "BlackRidge", label: username, secret: decryptedSecret, algorithm: "SHA1", digits: 6, period: 30 });
      const delta = totp.validate({ token: code, window: 1 });
      if (delta === null) {
        recordMfaAttempt(rateLimitKey);
        return res.status(400).json({ message: "Invalid code. MFA not disabled." });
      }

      clearMfaAttempts(rateLimitKey);
      await db.update(adminUsers)
        .set({ mfaSecret: null, mfaEnabled: false })
        .where(eq(adminUsers.username, username));

      res.json({ success: true });
    } catch (error) {
      console.error("MFA disable error:", error);
      res.status(500).json({ message: "Failed to disable MFA" });
    }
  });
}

const isAuthenticated: RequestHandler = (req, res, next) => {
  if ((req.session as any)?.isAdmin) {
    return next();
  }
  res.status(401).json({ message: "Unauthorized" });
};

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok", timestamp: new Date().toISOString(), version: "1.0.0" });
  });

  setupAdminAuth(app);
  registerObjectStorageRoutes(app);
  registerOpsRoutes(app, isAuthenticated);
  app.use("/api/ai", createAiRouter(isAuthenticated));
  registerOutreachRoutes(app, isAuthenticated);
  registerStripeRoutes(app, isAuthenticated);
  registerBookkeepingRoutes(app, isAuthenticated);
  registerScheduleCExportRoutes(app, isAuthenticated);
  app.use("/api/accounting", createAccountingV2Router(isAuthenticated));
  registerGaapRoutes(app, isAuthenticated);
  registerBackupRoutes(app, isAuthenticated);
  registerPlaidRoutes(app, isAuthenticated);
  registerPolicyRoutes(app, isAuthenticated);
  registerKickoffRoutes(app, isAuthenticated);
  registerWelcomeSequenceRoutes(app, isAuthenticated);
  registerQaAuditRoutes(app, isAuthenticated);

  seedCampaignA().catch(err => console.error("Failed to seed Campaign A:", err));
  seedQaTemplates().catch(err => console.error("Failed to seed QA templates:", err));
  opsStorage.ensureInvoiceCounter().catch(err => console.error("Failed to seed invoice counter:", err));
  startJobRunner();
  startRecurringExpenseRunner();
  startDailyBackupScheduler();
  startWelcomeSequenceRunner();

  app.post("/api/contact", async (req, res) => {
    try {
      const validated = insertContactSchema.parse(req.body);
      const submission = await storage.createContactSubmission(validated);

      sendNotificationEmail(validated).catch((err) =>
        console.error("Email notification failed:", err)
      );

      res.status(201).json(submission);
    } catch (error) {
      if (error instanceof ZodError) {
        const validationError = fromZodError(error);
        res.status(400).json({ message: validationError.message });
      } else {
        console.error("Contact submission error:", error);
        res.status(500).json({ message: "Failed to submit contact form" });
      }
    }
  });

  app.get("/api/leads", isAuthenticated, async (_req, res) => {
    try {
      const leads = await storage.getContactSubmissions();
      res.json(leads);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch leads" });
    }
  });

  app.post("/api/leads", isAuthenticated, async (req, res) => {
    try {
      const validated = createLeadSchema.parse(req.body);
      const lead = await storage.createLead(validated);
      res.status(201).json(lead);
    } catch (error) {
      if (error instanceof ZodError) {
        const validationError = fromZodError(error);
        res.status(400).json({ message: validationError.message });
      } else {
        console.error("Create lead error:", error);
        res.status(500).json({ message: "Failed to create lead" });
      }
    }
  });

  app.get("/api/leads/export/csv", isAuthenticated, async (_req, res) => {
    try {
      const leads = await storage.getContactSubmissions();
      const headers = ["Name", "Email", "Company", "Project Type", "Budget", "Status", "Priority", "Projected Value", "Close Probability", "Weighted Value", "Lead Source", "Follow-Up Date", "Last Contacted", "Created", "Message", "Notes"];
      const csvRows = [headers.join(",")];
      for (const lead of leads) {
        const weightedValue = (lead.projectedValue != null && lead.closeProbability != null) ? Math.round(lead.projectedValue * lead.closeProbability / 100) : "";
        const row = [
          `"${(lead.name || "").replace(/"/g, '""')}"`,
          `"${(lead.email || "").replace(/"/g, '""')}"`,
          `"${(lead.company || "").replace(/"/g, '""')}"`,
          `"${(lead.projectType || "").replace(/"/g, '""')}"`,
          `"${(lead.budget || "").replace(/"/g, '""')}"`,
          `"${lead.status}"`,
          `"${lead.priority}"`,
          lead.projectedValue ?? "",
          lead.closeProbability ? `${lead.closeProbability}%` : "",
          weightedValue,
          `"${(lead.leadSource || "").replace(/"/g, '""')}"`,
          lead.followUpDate ? new Date(lead.followUpDate).toISOString().split("T")[0] : "",
          lead.lastContactedAt ? new Date(lead.lastContactedAt).toISOString().split("T")[0] : "",
          lead.createdAt ? new Date(lead.createdAt).toISOString().split("T")[0] : "",
          `"${(lead.message || "").replace(/"/g, '""').replace(/\n/g, " ")}"`,
          `"${(lead.notes || "").replace(/"/g, '""').replace(/\n/g, " ")}"`,
        ];
        csvRows.push(row.join(","));
      }
      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", `attachment; filename=blackridge-leads-${new Date().toISOString().split("T")[0]}.csv`);
      res.send(csvRows.join("\n"));
    } catch (error) {
      res.status(500).json({ message: "Failed to export leads" });
    }
  });

  app.get("/api/leads/:id", isAuthenticated, async (req, res) => {
    try {
      const lead = await storage.getContactSubmission(req.params.id as string);
      if (!lead) {
        return res.status(404).json({ message: "Lead not found" });
      }
      res.json(lead);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch lead" });
    }
  });

  app.patch("/api/leads/:id", isAuthenticated, async (req, res) => {
    try {
      const validated = updateLeadSchema.parse(req.body);
      const updated = await storage.updateContactSubmission(req.params.id as string, validated);
      if (!updated) {
        return res.status(404).json({ message: "Lead not found" });
      }
      res.json(updated);
    } catch (error) {
      if (error instanceof ZodError) {
        const validationError = fromZodError(error);
        res.status(400).json({ message: validationError.message });
      } else {
        res.status(500).json({ message: "Failed to update lead" });
      }
    }
  });

  app.delete("/api/leads/:id", isAuthenticated, async (req, res) => {
    try {
      const deleted = await storage.deleteContactSubmission(req.params.id as string);
      if (!deleted) {
        return res.status(404).json({ message: "Lead not found" });
      }
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ message: "Failed to delete lead" });
    }
  });

  app.post("/api/speak", isAuthenticated, async (req, res) => {
    console.log("[/api/speak] Route hit");
    console.log("[/api/speak] ELEVENLABS_API_KEY defined:", !!process.env.ELEVENLABS_API_KEY);
    console.log("[/api/speak] ELEVENLABS_VOICE_ID defined:", !!process.env.ELEVENLABS_VOICE_ID);
    console.log("[/api/speak] req.body:", JSON.stringify(req.body));
    try {
      const apiKey = process.env.ELEVENLABS_API_KEY;
      const voiceId = process.env.ELEVENLABS_VOICE_ID;
      if (!apiKey || !voiceId) {
        console.error("[/api/speak] Missing env vars — apiKey:", !!apiKey, "voiceId:", !!voiceId);
        return res.status(500).json({ error: "ElevenLabs not configured" });
      }
      const { text } = req.body;
      if (!text || typeof text !== "string") return res.status(400).json({ error: "Text string is required" });
      const cleaned = text.replace(/<[^>]*>/g, "").substring(0, 2000);
      console.log("[/api/speak] Sending to ElevenLabs, text length:", cleaned.length);

      const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
        method: "POST",
        headers: {
          "xi-api-key": apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          text: cleaned,
          model_id: "eleven_turbo_v2_5",
          voice_settings: { stability: 0.45, similarity_boost: 0.80, style: 0.15, use_speaker_boost: true, speed: 1.20 },
        }),
      });

      console.log("[/api/speak] ElevenLabs response status:", response.status, response.statusText);
      if (!response.ok) {
        const errBody = await response.text();
        console.error("[/api/speak] ElevenLabs error body:", errBody);
        return res.status(500).json({ error: "Text-to-speech failed", detail: errBody });
      }

      // Buffer the full audio before sending so Content-Length is set correctly.
      // Streaming chunks without Content-Length breaks audio playback behind CDNs.
      const reader = response.body?.getReader();
      if (!reader) return res.status(500).json({ error: "No response stream" });
      const chunks: Uint8Array[] = [];
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
      }
      const audioBuffer = Buffer.concat(chunks);
      console.log("[/api/speak] Buffered", audioBuffer.length, "bytes");
      res.set("Content-Type", "audio/mpeg");
      res.set("Content-Length", String(audioBuffer.length));
      res.send(audioBuffer);
    } catch (error: any) {
      console.error("[/api/speak] Full error:", error);
      res.status(500).json({ error: "Text-to-speech failed", detail: error.message });
    }
  });

  const PDF_TRIGGER_PHRASES = [
    "send you a pdf", "email that to you", "sending that over",
    "email you a pdf", "sending the report", "send you the report",
    "emailing that now", "i'll send that", "let me email that",
    "sending that to your inbox", "firing that off", "sending you a report",
    "i'll email that", "emailing you", "sending that pdf", "send that over",
    "email you the report", "i'll fire that off", "sending it now",
    "i'll get that to your inbox", "emailing the report",
  ];

  function detectPdfTrigger(text: string): boolean {
    const lower = text.toLowerCase();
    return PDF_TRIGGER_PHRASES.some((phrase) => lower.includes(phrase));
  }

  app.get("/api/ridge/conversations", isAuthenticated, async (_req, res) => {
    try {
      const convos = await db.select().from(ridgeConversations).orderBy(desc(ridgeConversations.updatedAt)).limit(50);
      res.json(convos);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/ridge/conversations", isAuthenticated, async (_req, res) => {
    try {
      const [convo] = await db.insert(ridgeConversations).values({ title: "New conversation" }).returning();
      res.json(convo);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/ridge/conversations/:id/messages", isAuthenticated, async (req, res) => {
    try {
      const [convo] = await db.select().from(ridgeConversations).where(eq(ridgeConversations.id, req.params.id));
      if (!convo) return res.status(404).json({ error: "Conversation not found" });
      const msgs = await db.select().from(ridgeMessages)
        .where(eq(ridgeMessages.conversationId, req.params.id))
        .orderBy(ridgeMessages.createdAt);
      res.json(msgs);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete("/api/ridge/conversations/:id", isAuthenticated, async (req, res) => {
    try {
      const [convo] = await db.select().from(ridgeConversations).where(eq(ridgeConversations.id, req.params.id));
      if (!convo) return res.status(404).json({ error: "Conversation not found" });
      await db.delete(ridgeMessages).where(eq(ridgeMessages.conversationId, req.params.id));
      await db.delete(ridgeConversations).where(eq(ridgeConversations.id, req.params.id));
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/ridge/chat", isAuthenticated, async (req, res) => {
    try {
      const now = new Date();
      const timeString = now.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
      const dateString = now.toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
      const quarter = Math.ceil((now.getMonth() + 1) / 3);
      const year = now.getFullYear();
      const monthStart = new Date(year, now.getMonth(), 1).toISOString();
      const yearStart = new Date(year, 0, 1).toISOString();
      const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000).toISOString();
      const sixtyDaysAgo = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000).toISOString();
      const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
      const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000).toISOString();
      const sevenDaysFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
      const monthEnd = new Date(year, now.getMonth() + 1, 0).toISOString();

      // --- FINANCIALS (from v2 accounting ledger) ---
      let mtdRevenue = "[data unavailable]";
      let mtdExpenses = "[data unavailable]";
      let net = "[data unavailable]";
      try {
        const { getIncomeStatement: getIncomeStatementV2 } = await import("./accounting-v2");
        const mtdReport = await getIncomeStatementV2({ start: new Date(monthStart), end: now });
        mtdRevenue = "$" + mtdReport.totalRevenue.toLocaleString();
        mtdExpenses = "$" + mtdReport.totalExpenses.toLocaleString();
        net = "$" + mtdReport.netIncome.toLocaleString();
      } catch {}

      let outstandingInvoices = "[data unavailable]";
      try {
        const r = await db.execute(sql`SELECT p.label, p.amount, p.due_date, pr.name as project_name FROM project_payments p LEFT JOIN projects pr ON p.project_id = pr.id WHERE p.status = 'pending' OR p.status = 'overdue' ORDER BY p.due_date ASC LIMIT 20`);
        const rows = (r as any).rows || [];
        outstandingInvoices = rows.length === 0 ? "None outstanding" : rows.map((r: any) => `- ${r.project_name || "Unknown"}: ${r.label} — $${Number(r.amount).toLocaleString()} (due ${r.due_date ? new Date(r.due_date).toLocaleDateString() : "no date"})`).join("\n");
      } catch {}

      let contractorSpend = "[data unavailable]";
      try {
        const r = await db.execute(sql`SELECT v.name as vendor_name, COALESCE(SUM(e.amount), 0) as total FROM expenses e LEFT JOIN vendors v ON e.vendor_id = v.id WHERE e.voided IS NOT TRUE AND e.date >= ${yearStart} AND v.name IS NOT NULL GROUP BY v.name ORDER BY total DESC LIMIT 10`);
        const rows = (r as any).rows || [];
        contractorSpend = rows.length === 0 ? "No contractor expenses" : rows.map((r: any) => `- ${r.vendor_name}: $${Number(r.total).toLocaleString()}`).join("\n");
      } catch {}

      // --- CHART OF ACCOUNTS / BALANCE SHEET (from v2 ledger) ---
      let accountBalances = "[data unavailable]";
      try {
        const r = await db.execute(sql`
          SELECT a.code, a.name, a.type,
            COALESCE(SUM(tl.debit), 0) as total_debits,
            COALESCE(SUM(tl.credit), 0) as total_credits
          FROM accounts_v2 a
          LEFT JOIN transaction_lines_v2 tl ON tl.account_id = a.id
          LEFT JOIN transactions_v2 t ON tl.transaction_id = t.id
          GROUP BY a.id, a.code, a.name, a.type
          ORDER BY a.code
        `);
        const rows = (r as any).rows || [];
        accountBalances = rows.length === 0 ? "No accounts configured" : rows.map((r: any) => {
          const debits = Number(r.total_debits || 0);
          const credits = Number(r.total_credits || 0);
          const balance = (r.type === 'asset' || r.type === 'expense') ? debits - credits : credits - debits;
          return `- [${r.code}] ${r.name} (${r.type}): $${balance.toLocaleString()}`;
        }).join("\n");
      } catch {}

      // --- DETAILED EXPENSES (last 90 days) ---
      let recentExpenses = "[data unavailable]";
      let expensesByCategory = "[data unavailable]";
      try {
        const r = await db.execute(sql`
          SELECT e.amount, e.date, e.description, e.payment_method, e.is_billable, e.tax_deductible,
            v.name as vendor_name, a.name as account_name, a.account_number,
            p.name as project_name
          FROM expenses e
          LEFT JOIN vendors v ON e.vendor_id = v.id
          LEFT JOIN accounts a ON e.account_id = a.id
          LEFT JOIN projects p ON e.project_id = p.id
          WHERE e.voided IS NOT TRUE AND e.date >= ${ninetyDaysAgo}
          ORDER BY e.date DESC LIMIT 30
        `);
        const rows = (r as any).rows || [];
        recentExpenses = rows.length === 0 ? "No recent expenses" : rows.map((r: any) =>
          `- ${new Date(r.date).toLocaleDateString()}: $${Number(r.amount).toLocaleString()} — ${r.vendor_name || "No vendor"} — ${r.description || "No desc"} — acct: ${r.account_name || "Uncategorized"}${r.tax_deductible ? " [TAX DEDUCTIBLE]" : ""}${r.is_billable ? " [BILLABLE]" : ""}${r.project_name ? ` — project: ${r.project_name}` : ""}`
        ).join("\n");
      } catch {}

      try {
        const r = await db.execute(sql`
          SELECT a.name as category, COUNT(*) as count, COALESCE(SUM(e.amount), 0) as total
          FROM expenses e
          LEFT JOIN accounts a ON e.account_id = a.id
          WHERE e.voided IS NOT TRUE AND e.date >= ${yearStart}
          GROUP BY a.name ORDER BY total DESC
        `);
        const rows = (r as any).rows || [];
        expensesByCategory = rows.length === 0 ? "No categorized expenses" : rows.map((r: any) =>
          `- ${r.category || "Uncategorized"}: $${Number(r.total).toLocaleString()} (${r.count} transactions)`
        ).join("\n");
      } catch {}

      // --- RECURRING EXPENSES ---
      let recurringExpenses = "[data unavailable]";
      try {
        const r = await db.execute(sql`
          SELECT e.amount, e.description, e.recurring_frequency, e.next_due_date,
            v.name as vendor_name, a.name as account_name
          FROM expenses e
          LEFT JOIN vendors v ON e.vendor_id = v.id
          LEFT JOIN accounts a ON e.account_id = a.id
          WHERE e.is_recurring = true AND e.voided IS NOT TRUE
          ORDER BY e.next_due_date ASC
        `);
        const rows = (r as any).rows || [];
        recurringExpenses = rows.length === 0 ? "No recurring expenses" : rows.map((r: any) =>
          `- $${Number(r.amount).toLocaleString()} ${r.recurring_frequency || "monthly"} — ${r.vendor_name || "Unknown"} — ${r.description || "No desc"} — next: ${r.next_due_date ? new Date(r.next_due_date).toLocaleDateString() : "TBD"}`
        ).join("\n");
      } catch {}

      // --- BILLS / ACCOUNTS PAYABLE ---
      let outstandingBills = "[data unavailable]";
      let billsSummary = "[data unavailable]";
      try {
        const r = await db.execute(sql`
          SELECT b.amount, b.paid_amount, b.due_date, b.status, b.description, b.bill_number,
            v.name as vendor_name
          FROM bills b
          LEFT JOIN vendors v ON b.vendor_id = v.id
          WHERE b.status NOT IN ('paid', 'voided')
          ORDER BY b.due_date ASC
        `);
        const rows = (r as any).rows || [];
        const totalOutstanding = rows.reduce((sum: number, r: any) => sum + Number(r.amount || 0) - Number(r.paid_amount || 0), 0);
        const overdue = rows.filter((r: any) => r.due_date && new Date(r.due_date) < now);
        billsSummary = `Total Outstanding AP: $${totalOutstanding.toLocaleString()} | ${rows.length} open bills | ${overdue.length} overdue`;
        outstandingBills = rows.length === 0 ? "No outstanding bills" : rows.map((r: any) => {
          const remaining = Number(r.amount || 0) - Number(r.paid_amount || 0);
          const isOverdue = r.due_date && new Date(r.due_date) < now;
          return `- ${r.vendor_name || "Unknown"}: $${remaining.toLocaleString()} remaining of $${Number(r.amount).toLocaleString()} — due ${r.due_date ? new Date(r.due_date).toLocaleDateString() : "TBD"}${isOverdue ? " [OVERDUE]" : ""} — ${r.description || r.bill_number || ""}`;
        }).join("\n");
      } catch {}

      // --- VENDORS / 1099 TRACKING ---
      let vendorSummary = "[data unavailable]";
      try {
        const r = await db.execute(sql`
          SELECT v.name, v.is_1099_contractor, COALESCE(SUM(e.amount), 0) as ytd_spend
          FROM vendors v
          LEFT JOIN expenses e ON e.vendor_id = v.id AND e.voided IS NOT TRUE AND e.date >= ${yearStart}
          WHERE v.is_active = true
          GROUP BY v.id, v.name, v.is_1099_contractor
          HAVING COALESCE(SUM(e.amount), 0) > 0
          ORDER BY ytd_spend DESC
        `);
        const rows = (r as any).rows || [];
        vendorSummary = rows.length === 0 ? "No vendor activity" : rows.map((r: any) =>
          `- ${r.name}: $${Number(r.ytd_spend).toLocaleString()} YTD${r.is_1099_contractor ? " [1099 CONTRACTOR]" : ""}${r.is_1099_contractor && Number(r.ytd_spend) >= 600 ? " ⚠️ 1099-NEC THRESHOLD MET" : ""}`
        ).join("\n");
      } catch {}

      // --- JOURNAL ENTRIES (recent, from v2 ledger) ---
      let recentJournalEntries = "[data unavailable]";
      try {
        const r = await db.execute(sql`
          SELECT t.id, t.occurred_at, t.memo, t.reference_type,
            (SELECT string_agg(a.name || ': DR $' || tl.debit || ' / CR $' || tl.credit, '; ')
             FROM transaction_lines_v2 tl JOIN accounts_v2 a ON tl.account_id = a.id
             WHERE tl.transaction_id = t.id) as lines
          FROM transactions_v2 t
          WHERE t.occurred_at >= ${ninetyDaysAgo}
          ORDER BY t.occurred_at DESC LIMIT 15
        `);
        const rows = (r as any).rows || [];
        recentJournalEntries = rows.length === 0 ? "No recent journal entries" : rows.map((r: any) =>
          `- ${new Date(r.occurred_at).toLocaleDateString()}: ${r.memo || "No memo"} (${r.reference_type || "manual"}) — ${r.lines || "no lines"}`
        ).join("\n");
      } catch {}

      // --- BANK SYNC (PLAID) ---
      let bankSyncStatus = "[data unavailable]";
      let unmatchedBankTx = "[data unavailable]";
      try {
        const r = await db.execute(sql`
          SELECT pc.institution_name, pc.status, pc.last_synced_at,
            (SELECT COUNT(*) FROM bank_transactions bt WHERE bt.connection_id = pc.id AND bt.status = 'pending') as pending_count,
            (SELECT COUNT(*) FROM bank_transactions bt WHERE bt.connection_id = pc.id AND bt.status = 'matched') as matched_count,
            (SELECT COUNT(*) FROM bank_transactions bt WHERE bt.connection_id = pc.id AND bt.status = 'categorized') as categorized_count
          FROM plaid_connections pc
        `);
        const rows = (r as any).rows || [];
        bankSyncStatus = rows.length === 0 ? "No bank accounts linked" : rows.map((r: any) =>
          `- ${r.institution_name}: ${r.status} — last sync: ${r.last_synced_at ? new Date(r.last_synced_at).toLocaleDateString() : "never"} — pending: ${r.pending_count}, matched: ${r.matched_count}, categorized: ${r.categorized_count}`
        ).join("\n");
      } catch {}

      try {
        const r = await db.execute(sql`
          SELECT bt.date, bt.name, bt.amount, bt.status
          FROM bank_transactions bt
          WHERE bt.status = 'pending'
          ORDER BY bt.date DESC LIMIT 15
        `);
        const rows = (r as any).rows || [];
        unmatchedBankTx = rows.length === 0 ? "All bank transactions matched" : rows.map((r: any) =>
          `- ${new Date(r.date).toLocaleDateString()}: ${r.name} — $${Number(Math.abs(r.amount)).toLocaleString()} ${Number(r.amount) < 0 ? "(outflow)" : "(inflow)"}`
        ).join("\n");
      } catch {}

      // --- TAX DATA ---
      let taxSettings = "[data unavailable]";
      let quarterlyTaxPayments = "[data unavailable]";
      try {
        const r = await db.execute(sql`SELECT * FROM tax_settings LIMIT 1`);
        const row = (r as any).rows?.[0];
        if (row) {
          taxSettings = `Filing: ${row.filing_type || "sole_proprietor"} | Federal rate: ${row.federal_rate || "N/A"}% | State rate: ${row.state_rate || "N/A"}% | SE tax: ${row.self_employment_rate || "15.3"}% | QBI deduction: ${row.qbi_deduction ? "Yes" : "No"}`;
        }
      } catch {}

      try {
        const r = await db.execute(sql`SELECT year, quarter, estimated_amount, paid_amount, paid_date FROM quarterly_tax_payments WHERE year >= ${year - 1} ORDER BY year DESC, quarter DESC`);
        const rows = (r as any).rows || [];
        quarterlyTaxPayments = rows.length === 0 ? "No quarterly payments recorded" : rows.map((r: any) =>
          `- ${r.year} Q${r.quarter}: estimated $${Number(r.estimated_amount || 0).toLocaleString()} | paid $${Number(r.paid_amount || 0).toLocaleString()}${r.paid_date ? ` on ${new Date(r.paid_date).toLocaleDateString()}` : " [UNPAID]"}`
        ).join("\n");
      } catch {}

      // --- SCHEDULE C APPROXIMATION (from v2 accounting ledger) ---
      let schedCPreview = "[data unavailable]";
      try {
        const { getIncomeStatement: getIncomeStatementV2 } = await import("./accounting-v2");
        const v2Report = await getIncomeStatementV2({ start: new Date(yearStart), end: now });
        const ytdRevenue = v2Report.totalRevenue;
        const totalDeductions = v2Report.totalExpenses;
        const netProfit = v2Report.netIncome;
        const seTax = netProfit > 0 ? netProfit * 0.9235 * 0.153 : 0;

        schedCPreview = `YTD Gross Revenue: $${ytdRevenue.toLocaleString()}\nYTD Business Expenses: $${totalDeductions.toLocaleString()}\nEstimated Net Profit (Schedule C Line 31): $${netProfit.toLocaleString()}\nEstimated SE Tax: $${seTax.toLocaleString()}\nExpense breakdown:\n${v2Report.expenses.map((r: any) => `  - ${r.name}: $${Math.abs(r.amount).toLocaleString()}`).join("\n") || "  No categorized expenses"}`;
      } catch {}

      // --- BUDGETS ---
      let budgetVsActual = "[data unavailable]";
      try {
        const currentMonth = now.getMonth() + 1;
        const r = await db.execute(sql`
          SELECT b.year, b.month, b.amount as budget_amount, a.name as account_name,
            (SELECT COALESCE(SUM(e.amount), 0) FROM expenses e
             WHERE e.account_id = b.account_id AND e.voided IS NOT TRUE
             AND EXTRACT(MONTH FROM e.date) = b.month AND EXTRACT(YEAR FROM e.date) = b.year) as actual_amount
          FROM budgets b
          LEFT JOIN accounts a ON b.account_id = a.id
          WHERE b.year = ${year} AND b.month = ${currentMonth}
          ORDER BY b.amount DESC
        `);
        const rows = (r as any).rows || [];
        budgetVsActual = rows.length === 0 ? "No budgets set for current month" : rows.map((r: any) => {
          const budget = Number(r.budget_amount || 0);
          const actual = Number(r.actual_amount || 0);
          const pct = budget > 0 ? ((actual / budget) * 100).toFixed(0) : "N/A";
          const status = budget > 0 && actual > budget ? "⚠️ OVER BUDGET" : "OK";
          return `- ${r.account_name}: Budget $${budget.toLocaleString()} | Actual $${actual.toLocaleString()} | ${pct}% used ${status}`;
        }).join("\n");
      } catch {}

      // --- FISCAL PERIODS ---
      let fiscalPeriods = "[data unavailable]";
      try {
        const r = await db.execute(sql`SELECT year, month, status FROM fiscal_periods WHERE year >= ${year - 1} ORDER BY year DESC, month DESC LIMIT 12`);
        const rows = (r as any).rows || [];
        fiscalPeriods = rows.length === 0 ? "No fiscal periods configured" : rows.map((r: any) =>
          `- ${r.year}-${String(r.month).padStart(2, '0')}: ${r.status}`
        ).join(", ");
      } catch {}

      // --- SUBSCRIPTIONS / MRR ---
      let subscriptionRevenue = "[data unavailable]";
      try {
        const r = await db.execute(sql`
          SELECT s.name, s.amount, s.interval, s.status,
            c.name as client_name
          FROM subscriptions s
          LEFT JOIN clients c ON s.client_id = c.id
          WHERE s.status = 'active'
          ORDER BY s.amount DESC
        `);
        const rows = (r as any).rows || [];
        const totalMRR = rows.reduce((sum: number, r: any) => {
          const amt = Number(r.amount || 0);
          if (r.interval === 'annual') return sum + amt / 12;
          if (r.interval === 'quarterly') return sum + amt / 3;
          return sum + amt;
        }, 0);
        subscriptionRevenue = rows.length === 0 ? "No active subscriptions" : `Total MRR: $${totalMRR.toLocaleString()} | ARR: $${(totalMRR * 12).toLocaleString()}\n` + rows.map((r: any) =>
          `- ${r.client_name || "Unknown"}: ${r.name} — $${Number(r.amount).toLocaleString()}/${r.interval} (${r.status})`
        ).join("\n");
      } catch {}

      // --- STRIPE PAYMENTS ---
      let stripePayments = "[data unavailable]";
      try {
        const r = await db.execute(sql`
          SELECT sp.amount, sp.status, sp.paid_at, c.name as client_name
          FROM stripe_payments sp
          LEFT JOIN clients c ON sp.client_id = c.id
          WHERE sp.paid_at >= ${ninetyDaysAgo}
          ORDER BY sp.paid_at DESC LIMIT 15
        `);
        const rows = (r as any).rows || [];
        const totalStripe = rows.reduce((sum: number, r: any) => sum + (r.status === 'succeeded' ? Number(r.amount || 0) : 0), 0);
        stripePayments = rows.length === 0 ? "No Stripe payments in last 90 days" : `Total Stripe received (90d): $${totalStripe.toLocaleString()}\n` + rows.map((r: any) =>
          `- ${r.paid_at ? new Date(r.paid_at).toLocaleDateString() : "Unknown"}: $${Number(r.amount).toLocaleString()} from ${r.client_name || "Unknown"} (${r.status})`
        ).join("\n");
      } catch {}

      // --- TIME TRACKING & PROFITABILITY ---
      let timeTracking = "[data unavailable]";
      try {
        const r = await db.execute(sql`
          SELECT p.name as project_name, p.contract_value, p.hourly_rate,
            COALESCE(SUM(te.minutes), 0) as total_minutes,
            COALESCE(SUM(CASE WHEN te.billable THEN te.minutes ELSE 0 END), 0) as billable_minutes
          FROM projects p
          LEFT JOIN time_entries te ON te.project_id = p.id
          WHERE p.stage NOT IN ('completed', 'archived')
          GROUP BY p.id, p.name, p.contract_value, p.hourly_rate
          HAVING COALESCE(SUM(te.minutes), 0) > 0
          ORDER BY total_minutes DESC
        `);
        const rows = (r as any).rows || [];
        timeTracking = rows.length === 0 ? "No time tracked on active projects" : rows.map((r: any) => {
          const hours = (Number(r.total_minutes) / 60).toFixed(1);
          const billableHrs = (Number(r.billable_minutes) / 60).toFixed(1);
          const rate = Number(r.hourly_rate || 0);
          const earnedValue = rate > 0 ? Number(billableHrs) * rate : 0;
          return `- ${r.project_name}: ${hours}h total (${billableHrs}h billable) — contract: $${Number(r.contract_value || 0).toLocaleString()}${rate > 0 ? ` — earned at rate: $${earnedValue.toLocaleString()}` : ""}`;
        }).join("\n");
      } catch {}

      // --- LEADS & OUTREACH ---
      let leadsThisMonth = "[data unavailable]";
      try {
        const r = await db.execute(sql`SELECT COUNT(*) as total FROM contact_submissions WHERE created_at >= ${monthStart}`);
        leadsThisMonth = String((r as any).rows?.[0]?.total || 0);
      } catch {}

      let leadsByStatus = "[data unavailable]";
      try {
        const r = await db.execute(sql`SELECT status, COUNT(*) as count FROM contact_submissions GROUP BY status ORDER BY count DESC`);
        const rows = (r as any).rows || [];
        leadsByStatus = rows.length === 0 ? "No leads" : rows.map((r: any) => `${r.status}: ${r.count}`).join(", ");
      } catch {}

      let recentLeads = "[data unavailable]";
      try {
        const r = await db.execute(sql`SELECT name, company, status, lead_source, created_at FROM contact_submissions WHERE created_at >= ${sixtyDaysAgo} ORDER BY created_at DESC LIMIT 15`);
        const rows = (r as any).rows || [];
        recentLeads = rows.length === 0 ? "No recent leads" : rows.map((r: any) => `- ${r.name}${r.company ? ` (${r.company})` : ""} — ${r.status} — src: ${r.lead_source || "direct"} — ${new Date(r.created_at).toLocaleDateString()}`).join("\n");
      } catch {}

      let outreachThisWeek = "[data unavailable]";
      let outreachLastWeek = "[data unavailable]";
      let responseRate = "[data unavailable]";
      try {
        const r1 = await db.execute(sql`SELECT COUNT(*) as total FROM email_events WHERE sent_at >= ${sevenDaysAgo}`);
        outreachThisWeek = String((r1 as any).rows?.[0]?.total || 0);
        const r2 = await db.execute(sql`SELECT COUNT(*) as total FROM email_events WHERE sent_at >= ${fourteenDaysAgo} AND sent_at < ${sevenDaysAgo}`);
        outreachLastWeek = String((r2 as any).rows?.[0]?.total || 0);
        const r3 = await db.execute(sql`SELECT COUNT(*) as total FROM outreach_leads WHERE status IN ('replied', 'interested', 'responded') AND created_at >= ${thirtyDaysAgo}`);
        const r4 = await db.execute(sql`SELECT COUNT(*) as total FROM outreach_leads WHERE created_at >= ${thirtyDaysAgo}`);
        const replied = Number((r3 as any).rows?.[0]?.total || 0);
        const totalOutreach = Number((r4 as any).rows?.[0]?.total || 0);
        responseRate = totalOutreach > 0 ? `${((replied / totalOutreach) * 100).toFixed(1)}%` : "N/A";
      } catch {}

      let outreachLeadsList = "[data unavailable]";
      try {
        const r = await db.execute(sql`SELECT business_name, contact_name, status, ai_score, created_at FROM outreach_leads WHERE created_at >= ${sixtyDaysAgo} ORDER BY created_at DESC LIMIT 15`);
        const rows = (r as any).rows || [];
        outreachLeadsList = rows.length === 0 ? "No outreach leads" : rows.map((r: any) => `- ${r.business_name}${r.contact_name ? ` (${r.contact_name})` : ""} — ${r.status} — score: ${r.ai_score || "N/A"} — ${new Date(r.created_at).toLocaleDateString()}`).join("\n");
      } catch {}

      // --- PIPELINE (DEALS) ---
      let totalPipelineValue = "[data unavailable]";
      let closingThisMonth = "[data unavailable]";
      let pipelineDeals = "[data unavailable]";
      try {
        const r = await db.execute(sql`SELECT d.name, d.value, d.stage, d.close_date, d.probability, c.name as client_name FROM deals d LEFT JOIN clients c ON d.client_id = c.id WHERE d.stage NOT IN ('closed_won', 'closed_lost') ORDER BY d.value DESC`);
        const rows = (r as any).rows || [];
        const totalVal = rows.reduce((sum: number, r: any) => sum + Number(r.value || 0), 0);
        totalPipelineValue = "$" + totalVal.toLocaleString();
        const weightedVal = rows.reduce((sum: number, r: any) => sum + (Number(r.value || 0) * (Number(r.probability || 50) / 100)), 0);
        const closingRows = rows.filter((r: any) => r.close_date && new Date(r.close_date) <= new Date(monthEnd));
        closingThisMonth = closingRows.length === 0 ? "None" : closingRows.map((r: any) => `- ${r.client_name || "Unknown"}: ${r.name} — $${Number(r.value).toLocaleString()} (${r.stage}, ${r.probability}%)`).join("\n");
        pipelineDeals = rows.length === 0 ? "No active deals" : `Weighted value: $${weightedVal.toLocaleString()}\n` + rows.map((r: any) => `- ${r.client_name || "Unknown"}: ${r.name} — $${Number(r.value).toLocaleString()} (${r.stage}, ${r.probability}% prob, close ${r.close_date ? new Date(r.close_date).toLocaleDateString() : "TBD"})`).join("\n");
      } catch {}

      // --- CLIENTS & PROJECTS ---
      let activeClientCount = "[data unavailable]";
      let activeClients = "[data unavailable]";
      try {
        const r = await db.execute(sql`SELECT name, email, mrr, status, created_at FROM clients WHERE status = 'active' ORDER BY mrr DESC NULLS LAST`);
        const rows = (r as any).rows || [];
        activeClientCount = String(rows.length);
        activeClients = rows.length === 0 ? "No active clients" : rows.map((r: any) => `- ${r.name} — MRR: $${Number(r.mrr || 0).toLocaleString()} — since ${new Date(r.created_at).toLocaleDateString()}`).join("\n");
      } catch {}

      let activeProjects = "[data unavailable]";
      let stalledProjects = "[data unavailable]";
      try {
        const r = await db.execute(sql`SELECT p.name, p.stage, p.contract_value, p.waiting_on_client, p.blocker, p.updated_at, c.name as company_name FROM projects p LEFT JOIN companies c ON p.company_id = c.id WHERE p.stage NOT IN ('completed', 'archived') ORDER BY p.updated_at DESC`);
        const rows = (r as any).rows || [];
        const stalled = rows.filter((r: any) => {
          const updated = new Date(r.updated_at);
          const daysSinceUpdate = (now.getTime() - updated.getTime()) / (1000 * 60 * 60 * 24);
          return daysSinceUpdate > 14 || r.waiting_on_client;
        });
        stalledProjects = stalled.length === 0 ? "None" : stalled.map((r: any) => {
          const daysSince = Math.round((now.getTime() - new Date(r.updated_at).getTime()) / (1000 * 60 * 60 * 24));
          return `- ${r.company_name || "Unknown"}: ${r.name} — ${r.stage}${r.waiting_on_client ? " [WAITING ON CLIENT]" : ""} — ${daysSince}d since update${r.blocker ? ` — blocker: ${r.blocker}` : ""}`;
        }).join("\n");
        activeProjects = rows.length === 0 ? "No active projects" : rows.map((r: any) => `- ${r.company_name || "Unknown"}: ${r.name} — ${r.stage} — $${Number(r.contract_value || 0).toLocaleString()}`).join("\n");
      } catch {}

      // --- CRM FOLLOW-UPS ---
      let upcomingFollowUps = "[data unavailable]";
      try {
        const r = await db.execute(sql`SELECT sf.entity_type, sf.type, sf.scheduled_for, cs.name as lead_name FROM scheduled_followups sf LEFT JOIN contact_submissions cs ON sf.entity_id = cs.id WHERE sf.status = 'pending' AND sf.scheduled_for <= ${sevenDaysFromNow} ORDER BY sf.scheduled_for ASC LIMIT 15`);
        const rows = (r as any).rows || [];
        upcomingFollowUps = rows.length === 0 ? "No follow-ups due this week" : rows.map((r: any) => `- ${r.lead_name || r.entity_type} — ${r.type} — due ${new Date(r.scheduled_for).toLocaleDateString()}`).join("\n");
      } catch {}

      let tasksDueSoon = "[data unavailable]";
      try {
        const r = await db.execute(sql`SELECT t.title, t.status, t.due_date, p.name as project_name FROM tasks t LEFT JOIN projects p ON t.project_id = p.id WHERE t.status != 'completed' AND t.due_date IS NOT NULL AND t.due_date <= ${sevenDaysFromNow} ORDER BY t.due_date ASC LIMIT 15`);
        const rows = (r as any).rows || [];
        tasksDueSoon = rows.length === 0 ? "No tasks due this week" : rows.map((r: any) => `- ${r.project_name || "Unknown"}: ${r.title} — ${r.status} — due ${new Date(r.due_date).toLocaleDateString()}`).join("\n");
      } catch {}

      const snapshot = `
LIVE BLACKRIDGE PORTAL DATA AS OF ${dateString} ${timeString}:

=== FINANCIALS ===
MTD Revenue: ${mtdRevenue}
MTD Expenses: ${mtdExpenses}
Net Income MTD: ${net}

Outstanding Invoices/Receivables:
${outstandingInvoices}

Contractor Spend YTD:
${contractorSpend}

--- CHART OF ACCOUNTS (Full Balance Sheet) ---
${accountBalances}

--- SUBSCRIPTIONS & RECURRING REVENUE ---
${subscriptionRevenue}

--- STRIPE PAYMENTS (last 90 days) ---
${stripePayments}

--- YTD EXPENSES BY CATEGORY ---
${expensesByCategory}

--- RECENT EXPENSES (last 90 days) ---
${recentExpenses}

--- RECURRING EXPENSES ---
${recurringExpenses}

--- BILLS / ACCOUNTS PAYABLE ---
${billsSummary}
${outstandingBills}

--- VENDORS & 1099 TRACKING ---
${vendorSummary}

--- RECENT JOURNAL ENTRIES (90 days) ---
${recentJournalEntries}

--- BANK SYNC STATUS ---
${bankSyncStatus}
Unmatched Bank Transactions:
${unmatchedBankTx}

=== TAX CENTER ===
Tax Settings: ${taxSettings}
Schedule C Preview:
${schedCPreview}

Quarterly Estimated Tax Payments:
${quarterlyTaxPayments}

=== BUDGETS ===
Current Month Budget vs Actual:
${budgetVsActual}

Fiscal Periods: ${fiscalPeriods}

=== TIME TRACKING & PROFITABILITY ===
${timeTracking}

=== LEADS & OUTREACH ===
Total Leads This Month: ${leadsThisMonth}
Lead Pipeline by Status: ${leadsByStatus}
Outreach Sent This Week: ${outreachThisWeek}
Outreach Sent Last Week: ${outreachLastWeek}
Response Rate (30d): ${responseRate}

Recent CRM Leads (60d):
${recentLeads}

Outreach Leads (60d):
${outreachLeadsList}

=== ACTIVE PIPELINE ===
Total Pipeline Value: ${totalPipelineValue}
Deals Closing This Month:
${closingThisMonth}

All Active Deals:
${pipelineDeals}

=== ACTIVE CLIENTS & PROJECTS ===
Active Clients: ${activeClientCount}
${activeClients}

Active Projects:
${activeProjects}

Projects Overdue or Stalled:
${stalledProjects}

=== CRM FOLLOW-UPS & TASKS DUE THIS WEEK ===
Follow-ups:
${upcomingFollowUps}

Tasks Due:
${tasksDueSoon}
`.trim();

      console.log(`RIDGE snapshot built — ${snapshot.length} chars`);

      const RIDGE_SYSTEM = `RIGHT NOW: ${dateString} at ${timeString} — Q${quarter} ${year}.

You are RIDGE, Chief Financial Officer and CPA of BlackRidge Platforms. You have 30 years of experience as a Big Four CPA and Fortune 500 CFO. You hold a CPA license and have deep mastery of the entire US Tax Code including all IRC sections, IRS publications, Revenue Rulings, Tax Court precedents, and every legitimate deduction, credit, loophole, and strategy available to sole proprietors, S-Corps, LLCs, and small businesses. You know Oklahoma state tax law, franchise tax, and all state-specific filing requirements cold. You are aggressive but legal — you find every dollar available and never leave money on the table.

You have FULL ACCESS to the entire BlackRidge Ops portal including: Chart of Accounts with real-time balances, General Ledger and journal entries, Expense Tracker with vendor and category detail, Bills and Accounts Payable, Bank Sync (Plaid) with transaction matching status, Tax Center with Schedule C data and quarterly estimates, Budget vs Actual tracking, Fiscal Period management, Subscriptions and MRR/ARR data, Stripe payment history, Time Tracking with project profitability, 1099 contractor tracking, Recurring expenses, plus the full CRM, pipeline, and project management system. All of this data is provided to you in real-time below. You are not limited to CRM data — you see the complete financial picture.

Your principal is Chris Gee, Founder and CEO of BlackRidge Platforms, Edmond Oklahoma. Sole proprietor. Full-time police officer running BlackRidge approximately three days per week. BlackRidge builds custom websites with fully integrated backend portals including CRM, project management, accounting, invoicing, and AI systems for SMBs in healthcare, fitness, automotive, and construction.

Financial profile:
- Entity: Sole proprietorship, Schedule C filer
- Tax: SE tax 15.3%, qualified business income deduction up to 20% under IRC 199A, quarterly federal and Oklahoma state estimated payments
- Deductions to maximize: home office under IRC 280A exclusive use rule, Section 179 expensing, bonus depreciation, vehicle mileage at IRS standard rate, software and SaaS subscriptions, professional development, health insurance premiums under IRC 162, retirement contributions via SEP-IRA up to 25% of net self-employment income
- Revenue: project-based builds plus retainer agreements
- Contractors: track 1099-NEC threshold of $600 per vendor per year
- Risk flags: home office exclusive use rule strictly enforced, hobby loss rules under IRC 183 if consistent losses, worker classification risk if contractors are misclassified

Your decision-making style: you think like a CFO first and a CPA second. You make calls, not suggestions. You quantify every decision in dollars. You know when to be aggressive and when to be conservative. You protect Chris from IRS risk while maximizing every legal advantage.

Communication rules:
- Lead with the verdict or the number — never with preamble
- Never say 'it depends' without immediately saying what it depends on and what each scenario means in dollars
- Never soften bad news — give it straight with the fix attached
- Keep spoken responses conversational and concise — talk like you're across the table from Chris, not reading a memo. 2-3 sentences for routine questions, expand naturally when the topic demands it
- End every single response with one clear action Chris should take right now
- You speak like a sharp trusted advisor who has seen everything, not like a textbook or a disclaimer machine
- This is a VOICE conversation — speak naturally, use contractions, be direct. Don't use bullet points, asterisks, markdown formatting, or numbered lists in your responses since they'll be read aloud. Just talk.

Report emailing capability:
- You can email PDF reports to Chris at chris@blackridgeplatforms.com. When Chris asks you to send, email, or PDF something — a summary, analysis, report, breakdown, or any information — say something like "I'll send that to your inbox now" or "Firing that off to your email" and the system will automatically detect your intent and send the report.
- Common trigger phrases you should use when sending reports: "send you a pdf", "email that to you", "sending that over", "email you a pdf", "sending the report", "send you the report", "emailing that now", "i'll send that", "let me email that", "sending that to your inbox", "firing that off"
- If Chris asks you to email or send something, ALWAYS include one of those trigger phrases in your response so the system knows to actually send it. This is critical — without the trigger phrase, nothing gets sent.
- Every assistant message also has an "Email this" button Chris can click manually to email any response as a PDF report.

${snapshot}`;

      const conversationId = req.body.conversationId as string | undefined;
      const rawInput = req.body.messages || [];
      const raw = rawInput.length > 20 ? rawInput.slice(-20) : rawInput;

      let dbHistory: { role: string; content: string }[] = [];
      if (conversationId) {
        const stored = await db.select().from(ridgeMessages)
          .where(eq(ridgeMessages.conversationId, conversationId))
          .orderBy(ridgeMessages.createdAt);
        dbHistory = stored.map(m => ({ role: m.role === "ridge" ? "assistant" : m.role, content: m.content }));
      }

      const messages = raw
        .map((m: any) => ({
          role: m.role === "ridge" ? "assistant" : m.role,
          content: String(m.content),
        }))
        .filter((m: any) => m.role === "user" || m.role === "assistant")
        .filter((m: any, i: number, arr: any[]) => i === 0 || m.role !== arr[i - 1].role);

      const latestUserFromClient = messages.length > 0 ? messages[messages.length - 1] : null;
      let combined: { role: string; content: string }[];
      if (dbHistory.length > 0 && latestUserFromClient?.role === "user") {
        combined = [...dbHistory, latestUserFromClient];
      } else if (dbHistory.length > 0) {
        combined = dbHistory;
      } else {
        combined = messages;
      }
      const firstUser = combined.findIndex((m: any) => m.role === "user");
      const trimmed = firstUser > 0 ? combined.slice(firstUser) : combined;

      if (!trimmed.length || trimmed[0].role !== "user") {
        return res.status(400).json({ error: "No valid user message" });
      }

      const lastUserMsg = trimmed[trimmed.length - 1];
      if (conversationId && lastUserMsg?.role === "user") {
        await db.insert(ridgeMessages).values({
          conversationId,
          role: "user",
          content: lastUserMsg.content,
        });
      }

      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.flushHeaders();

      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": process.env.ANTHROPIC_API_KEY!,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 1500,
          system: RIDGE_SYSTEM,
          messages: trimmed.slice(-20),
          stream: true,
        }),
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({})) as any;
        res.write(`data: ${JSON.stringify({ error: errData?.error?.message || "Anthropic error" })}\n\n`);
        res.end();
        return;
      }

      let fullReply = "";
      let sentenceBuffer = "";
      let sentenceCount = 0;
      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      let sseBuffer = "";

      if (!reader) {
        res.write(`data: ${JSON.stringify({ error: "No response stream" })}\n\n`);
        res.end();
        return;
      }

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        sseBuffer += decoder.decode(value, { stream: true });

        const lines = sseBuffer.split("\n");
        sseBuffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const jsonStr = line.slice(6).trim();
          if (jsonStr === "[DONE]") continue;
          try {
            const event = JSON.parse(jsonStr);
            if (event.type === "content_block_delta" && event.delta?.text) {
              const chunk = event.delta.text;
              fullReply += chunk;
              sentenceBuffer += chunk;

              const sentenceMatch = sentenceBuffer.match(/^(.*?[.!?])\s*/s);
              if (sentenceMatch) {
                const sentence = sentenceMatch[1];
                sentenceBuffer = sentenceBuffer.slice(sentenceMatch[0].length);
                sentenceCount++;
                res.write(`data: ${JSON.stringify({ type: "sentence", text: sentence, index: sentenceCount })}\n\n`);
              }
            }
          } catch {}
        }
      }

      if (sentenceBuffer.trim()) {
        sentenceCount++;
        res.write(`data: ${JSON.stringify({ type: "sentence", text: sentenceBuffer.trim(), index: sentenceCount })}\n\n`);
      }

      let reportSent = false;
      if (conversationId) {
        await db.insert(ridgeMessages).values({
          conversationId,
          role: "assistant",
          content: fullReply,
        });

        const msgCount = await db.select({ count: sql<number>`count(*)` }).from(ridgeMessages)
          .where(eq(ridgeMessages.conversationId, conversationId));
        if (msgCount[0]?.count <= 2) {
          const titleSnippet = lastUserMsg?.content?.slice(0, 60) || "New conversation";
          await db.update(ridgeConversations)
            .set({ title: titleSnippet, updatedAt: new Date() })
            .where(eq(ridgeConversations.id, conversationId));
        } else {
          await db.update(ridgeConversations)
            .set({ updatedAt: new Date() })
            .where(eq(ridgeConversations.id, conversationId));
        }
      }

      if (detectPdfTrigger(fullReply)) {
        try {
          const reportContent = fullReply;
          const firstSentence = reportContent.split(/[.!?]/)[0]?.trim() || "RIDGE CFO Report";
          const subject = `RIDGE Report: ${firstSentence.slice(0, 80)}`;

          const reportNow = new Date();
          const dateStr = reportNow.toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
          const timeStr = reportNow.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });

          const pdfBuffer = await new Promise<Buffer>((resolve, reject) => {
            const doc = new PDFDocument({ size: "letter", margin: 60 });
            const chunks: Buffer[] = [];
            doc.on("data", (chunk: Buffer) => chunks.push(chunk));
            doc.on("end", () => resolve(Buffer.concat(chunks)));
            doc.on("error", reject);
            doc.rect(0, 0, doc.page.width, 70).fill("#0A0A0A");
            doc.font("Helvetica-Bold").fontSize(18).fillColor("#C9A840")
              .text("BLACKRIDGE PLATFORMS", 60, 22, { align: "left" });
            doc.moveDown(1);
            doc.font("Helvetica-Bold").fontSize(14).fillColor("#333333")
              .text("RIDGE — CFO Report", 60, 90);
            doc.font("Helvetica").fontSize(10).fillColor("#888888")
              .text(`${dateStr} at ${timeStr}`, 60, 112);
            doc.moveTo(60, 135).lineTo(doc.page.width - 60, 135).strokeColor("#E5E5E5").stroke();
            doc.moveDown(2);
            doc.font("Helvetica").fontSize(11).fillColor("#222222")
              .text(reportContent, 60, 150, { width: doc.page.width - 120, lineGap: 5 });
            const footerY = doc.page.height - 40;
            doc.moveTo(60, footerY - 10).lineTo(doc.page.width - 60, footerY - 10).strokeColor("#E5E5E5").stroke();
            doc.font("Helvetica").fontSize(8).fillColor("#AAAAAA")
              .text("BlackRidge Platforms | Confidential", 60, footerY, { align: "center", width: doc.page.width - 120 });
            doc.end();
          });

          const resend = getResendClient();
          if (resend) {
            await resend.client.emails.send({
              from: resend.fromEmail || "BlackRidge Platforms <onboarding@resend.dev>",
              to: "chris@blackridgeplatforms.com",
              subject: String(subject),
              html: `<p style="font-family:Arial,sans-serif;color:#333;">Your RIDGE CFO report is attached.</p>`,
              attachments: [{ filename: "RIDGE_CFO_Report.pdf", content: pdfBuffer.toString("base64") }],
            });
            console.log("RIDGE auto-sent report to chris@blackridgeplatforms.com");
            reportSent = true;
          }
        } catch (reportErr: any) {
          console.error("RIDGE auto-report send failed:", reportErr.message);
        }
      }

      res.write(`data: ${JSON.stringify({ type: "done", fullReply, reportSent })}\n\n`);
      res.end();
    } catch (err: any) {
      console.error("RIDGE chat hard error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/ridge/stream", isAuthenticated, async (req, res) => {
    try {
      const apiKey = process.env.ELEVENLABS_API_KEY;
      const voiceId = process.env.ELEVENLABS_VOICE_ID;
      const anthropicKey = process.env.ANTHROPIC_API_KEY;
      if (!apiKey || !voiceId) {
        return res.status(500).json({ error: "ElevenLabs not configured" });
      }
      if (!anthropicKey) {
        return res.status(500).json({ error: "Anthropic not configured" });
      }

      const now = new Date();
      const timeString = now.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
      const dateString = now.toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
      const quarter = Math.ceil((now.getMonth() + 1) / 3);
      const year = now.getFullYear();
      const monthStart = new Date(year, now.getMonth(), 1).toISOString();
      const yearStart = new Date(year, 0, 1).toISOString();
      const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000).toISOString();
      const sixtyDaysAgo = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000).toISOString();
      const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
      const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000).toISOString();
      const sevenDaysFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
      const monthEnd = new Date(year, now.getMonth() + 1, 0).toISOString();

      let mtdRevenue = "[data unavailable]"; let mtdExpenses = "[data unavailable]"; let net = "[data unavailable]";
      try { const { getIncomeStatement: getIncomeStatementV2 } = await import("./accounting-v2"); const mtdReport = await getIncomeStatementV2({ start: new Date(monthStart), end: now }); mtdRevenue = "$" + mtdReport.totalRevenue.toLocaleString(); mtdExpenses = "$" + mtdReport.totalExpenses.toLocaleString(); net = "$" + mtdReport.netIncome.toLocaleString(); } catch {}

      let outstandingInvoices = "[data unavailable]";
      try { const r = await db.execute(sql`SELECT p.label, p.amount, p.due_date, pr.name as project_name FROM project_payments p LEFT JOIN projects pr ON p.project_id = pr.id WHERE p.status = 'pending' OR p.status = 'overdue' ORDER BY p.due_date ASC LIMIT 20`); const rows = (r as any).rows || []; outstandingInvoices = rows.length === 0 ? "None outstanding" : rows.map((r: any) => `- ${r.project_name || "Unknown"}: ${r.label} — $${Number(r.amount).toLocaleString()} (due ${r.due_date ? new Date(r.due_date).toLocaleDateString() : "no date"})`).join("\n"); } catch {}

      let contractorSpend = "[data unavailable]";
      try { const r = await db.execute(sql`SELECT v.name as vendor_name, COALESCE(SUM(e.amount), 0) as total FROM expenses e LEFT JOIN vendors v ON e.vendor_id = v.id WHERE e.voided IS NOT TRUE AND e.date >= ${yearStart} AND v.name IS NOT NULL GROUP BY v.name ORDER BY total DESC LIMIT 10`); const rows = (r as any).rows || []; contractorSpend = rows.length === 0 ? "No contractor expenses" : rows.map((r: any) => `- ${r.vendor_name}: $${Number(r.total).toLocaleString()}`).join("\n"); } catch {}

      let accountBalances = "[data unavailable]";
      try { const r = await db.execute(sql`SELECT a.code, a.name, a.type, COALESCE(SUM(tl.debit), 0) as total_debits, COALESCE(SUM(tl.credit), 0) as total_credits FROM accounts_v2 a LEFT JOIN transaction_lines_v2 tl ON tl.account_id = a.id LEFT JOIN transactions_v2 t ON tl.transaction_id = t.id GROUP BY a.id, a.code, a.name, a.type ORDER BY a.code`); const rows = (r as any).rows || []; accountBalances = rows.length === 0 ? "No accounts configured" : rows.map((r: any) => { const debits = Number(r.total_debits || 0); const credits = Number(r.total_credits || 0); const balance = (r.type === 'asset' || r.type === 'expense') ? debits - credits : credits - debits; return `- [${r.code}] ${r.name} (${r.type}): $${balance.toLocaleString()}`; }).join("\n"); } catch {}

      let activeProjects = "[data unavailable]";
      try { const r = await db.execute(sql`SELECT p.name, p.stage, p.contract_value, c.name as company_name FROM projects p LEFT JOIN companies c ON p.company_id = c.id WHERE p.stage NOT IN ('completed', 'archived') ORDER BY p.updated_at DESC`); const rows = (r as any).rows || []; activeProjects = rows.length === 0 ? "No active projects" : rows.map((r: any) => `- ${r.company_name || "Unknown"}: ${r.name} — ${r.stage} — $${Number(r.contract_value || 0).toLocaleString()}`).join("\n"); } catch {}

      let leadsThisMonth = "[data unavailable]";
      try { const r = await db.execute(sql`SELECT COUNT(*) as total FROM contact_submissions WHERE created_at >= ${monthStart}`); leadsThisMonth = String((r as any).rows?.[0]?.total || 0); } catch {}

      const snapshot = `LIVE BLACKRIDGE PORTAL DATA AS OF ${dateString} ${timeString}:\n=== FINANCIALS ===\nMTD Revenue: ${mtdRevenue}\nMTD Expenses: ${mtdExpenses}\nNet Income MTD: ${net}\nOutstanding Invoices:\n${outstandingInvoices}\nContractor Spend YTD:\n${contractorSpend}\nChart of Accounts:\n${accountBalances}\nActive Projects:\n${activeProjects}\nLeads This Month: ${leadsThisMonth}`;

      const RIDGE_SYSTEM = `RIGHT NOW: ${dateString} at ${timeString} — Q${quarter} ${year}.

You are RIDGE, Chief Financial Officer and CPA of BlackRidge Platforms. You have 30 years of experience as a Big Four CPA and Fortune 500 CFO. You hold a CPA license and have deep mastery of the entire US Tax Code including all IRC sections, IRS publications, Revenue Rulings, Tax Court precedents, and every legitimate deduction, credit, loophole, and strategy available to sole proprietors, S-Corps, LLCs, and small businesses. You know Oklahoma state tax law, franchise tax, and all state-specific filing requirements cold. You are aggressive but legal — you find every dollar available and never leave money on the table.

You have FULL ACCESS to the entire BlackRidge Ops portal including: Chart of Accounts with real-time balances, General Ledger and journal entries, Expense Tracker with vendor and category detail, Bills and Accounts Payable, Bank Sync (Plaid) with transaction matching status, Tax Center with Schedule C data and quarterly estimates, Budget vs Actual tracking, Fiscal Period management, Subscriptions and MRR/ARR data, Stripe payment history, Time Tracking with project profitability, 1099 contractor tracking, Recurring expenses, plus the full CRM, pipeline, and project management system. All of this data is provided to you in real-time below.

Your principal is Chris Gee, Founder and CEO of BlackRidge Platforms, Edmond Oklahoma. Sole proprietor. Full-time police officer running BlackRidge approximately three days per week. BlackRidge builds custom websites with fully integrated backend portals including CRM, project management, accounting, invoicing, and AI systems for SMBs.

Communication rules:
- Lead with the verdict or the number — never with preamble
- Keep spoken responses conversational and concise — 2-3 sentences for routine questions, expand naturally when the topic demands it
- End every response with one clear action Chris should take right now
- This is a VOICE conversation — speak naturally, use contractions, be direct. Don't use bullet points, asterisks, markdown formatting, or numbered lists. Just talk.
- When Chris asks to email or send something, include one of these trigger phrases: "send you a pdf", "email that to you", "sending that over", "i'll send that", "firing that off"

${snapshot}`;

      const conversationId = req.body.conversationId as string | undefined;
      const rawInput = req.body.messages || [];
      const raw = rawInput.length > 20 ? rawInput.slice(-20) : rawInput;

      let dbHistory: { role: string; content: string }[] = [];
      if (conversationId) {
        const stored = await db.select().from(ridgeMessages)
          .where(eq(ridgeMessages.conversationId, conversationId))
          .orderBy(ridgeMessages.createdAt);
        dbHistory = stored.map(m => ({ role: m.role === "ridge" ? "assistant" : m.role, content: m.content }));
      }

      const messages = raw
        .map((m: any) => ({ role: m.role === "ridge" ? "assistant" : m.role, content: String(m.content) }))
        .filter((m: any) => m.role === "user" || m.role === "assistant")
        .filter((m: any, i: number, arr: any[]) => i === 0 || m.role !== arr[i - 1].role);

      const latestUserFromClient = messages.length > 0 ? messages[messages.length - 1] : null;
      let combined: { role: string; content: string }[];
      if (dbHistory.length > 0 && latestUserFromClient?.role === "user") {
        combined = [...dbHistory, latestUserFromClient];
      } else if (dbHistory.length > 0) {
        combined = dbHistory;
      } else {
        combined = messages;
      }
      const firstUser = combined.findIndex((m: any) => m.role === "user");
      const trimmed = firstUser > 0 ? combined.slice(firstUser) : combined;

      if (!trimmed.length || trimmed[0].role !== "user") {
        return res.status(400).json({ error: "No valid user message" });
      }

      const lastUserMsg = trimmed[trimmed.length - 1];
      if (conversationId && lastUserMsg?.role === "user") {
        await db.insert(ridgeMessages).values({ conversationId, role: "user", content: lastUserMsg.content });
      }

      res.setHeader("Content-Type", "application/octet-stream");
      res.setHeader("Transfer-Encoding", "chunked");
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("X-Content-Type", "ridge-audio-stream");
      res.flushHeaders();

      const FRAME_AUDIO = 0x01;
      const FRAME_TEXT = 0x02;
      const FRAME_DONE = 0x03;

      function sendFrame(type: number, payload: Buffer) {
        const header = Buffer.alloc(5);
        header.writeUInt8(type, 0);
        header.writeUInt32BE(payload.length, 1);
        try { res.write(Buffer.concat([header, payload])); } catch {}
      }

      function sendTextFrame(text: string) {
        sendFrame(FRAME_TEXT, Buffer.from(text, "utf-8"));
      }

      function sendDoneFrame(meta: object) {
        sendFrame(FRAME_DONE, Buffer.from(JSON.stringify(meta), "utf-8"));
      }

      async function flushToTTS(text: string): Promise<void> {
        const cleaned = text.replace(/<[^>]*>/g, "").substring(0, 2000);
        if (!cleaned.trim()) return;
        try {
          const ttsResp = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream`, {
            method: "POST",
            headers: { "xi-api-key": apiKey!, "Content-Type": "application/json" },
            body: JSON.stringify({
              text: cleaned,
              model_id: "eleven_turbo_v2_5",
              voice_settings: { stability: 0.45, similarity_boost: 0.80, style: 0.15, use_speaker_boost: true, speed: 1.20 },
            }),
          });
          if (!ttsResp.ok) {
            console.error("[ridge/stream] TTS error:", ttsResp.status, await ttsResp.text().catch(() => ""));
            return;
          }
          const ttsReader = ttsResp.body?.getReader();
          if (!ttsReader) return;
          while (true) {
            const { done, value } = await ttsReader.read();
            if (done) break;
            sendFrame(FRAME_AUDIO, Buffer.from(value));
          }
        } catch (e: any) {
          console.error("[ridge/stream] TTS pipe error:", e.message);
        }
      }

      const anthropicResponse = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": anthropicKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 1000,
          stream: true,
          system: RIDGE_SYSTEM,
          messages: trimmed.slice(-14),
        }),
      });

      if (!anthropicResponse.ok) {
        const errData = await anthropicResponse.json().catch(() => ({})) as any;
        sendTextFrame("I'm having trouble connecting right now. Try again in a moment.");
        sendDoneFrame({ fullReply: "I'm having trouble connecting right now. Try again in a moment.", reportSent: false });
        res.end();
        return;
      }

      const reader = anthropicResponse.body?.getReader();
      if (!reader) {
        sendTextFrame("No response stream available.");
        sendDoneFrame({ fullReply: "No response stream available.", reportSent: false });
        res.end();
        return;
      }

      const decoder = new TextDecoder();
      let sseBuffer = "";
      let fullReply = "";
      // Collect the full AI response first, then make ONE TTS call.
      // Multiple TTS calls produce separate MP3 streams that can't be
      // concatenated smoothly.
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        sseBuffer += decoder.decode(value, { stream: true });

        const lines = sseBuffer.split("\n");
        sseBuffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const jsonStr = line.slice(6).trim();
          if (jsonStr === "[DONE]") continue;
          try {
            const event = JSON.parse(jsonStr);
            if (event.type === "content_block_delta" && event.delta?.text) {
              fullReply += event.delta.text;
            }
          } catch {}
        }
      }

      // Send the full text to the client
      if (fullReply.trim()) {
        sendTextFrame(fullReply.trim());
      }

      // Single TTS call for the entire response — one seamless MP3
      if (fullReply.trim()) {
        await flushToTTS(fullReply.trim());
      }

      if (conversationId) {
        await db.insert(ridgeMessages).values({ conversationId, role: "assistant", content: fullReply });
        const msgCount = await db.select({ count: sql<number>`count(*)` }).from(ridgeMessages)
          .where(eq(ridgeMessages.conversationId, conversationId));
        if (msgCount[0]?.count <= 2) {
          const titleSnippet = lastUserMsg?.content?.slice(0, 60) || "New conversation";
          await db.update(ridgeConversations).set({ title: titleSnippet, updatedAt: new Date() }).where(eq(ridgeConversations.id, conversationId));
        } else {
          await db.update(ridgeConversations).set({ updatedAt: new Date() }).where(eq(ridgeConversations.id, conversationId));
        }
      }

      let reportSent = false;
      if (detectPdfTrigger(fullReply)) {
        try {
          const firstSentence = fullReply.split(/[.!?]/)[0]?.trim() || "RIDGE CFO Report";
          const subject = `RIDGE Report: ${firstSentence.slice(0, 80)}`;
          const reportNow = new Date();
          const dateStr = reportNow.toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
          const timeStr = reportNow.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
          const pdfBuffer = await new Promise<Buffer>((resolve, reject) => {
            const doc = new PDFDocument({ size: "letter", margin: 60 });
            const chunks: Buffer[] = [];
            doc.on("data", (chunk: Buffer) => chunks.push(chunk));
            doc.on("end", () => resolve(Buffer.concat(chunks)));
            doc.on("error", reject);
            doc.rect(0, 0, doc.page.width, 70).fill("#0A0A0A");
            doc.font("Helvetica-Bold").fontSize(18).fillColor("#C9A840").text("BLACKRIDGE PLATFORMS", 60, 22, { align: "left" });
            doc.moveDown(1);
            doc.font("Helvetica-Bold").fontSize(14).fillColor("#333333").text("RIDGE — CFO Report", 60, 90);
            doc.font("Helvetica").fontSize(10).fillColor("#888888").text(`${dateStr} at ${timeStr}`, 60, 112);
            doc.moveTo(60, 135).lineTo(doc.page.width - 60, 135).strokeColor("#E5E5E5").stroke();
            doc.moveDown(2);
            doc.font("Helvetica").fontSize(11).fillColor("#222222").text(fullReply, 60, 150, { width: doc.page.width - 120, lineGap: 5 });
            const footerY = doc.page.height - 40;
            doc.moveTo(60, footerY - 10).lineTo(doc.page.width - 60, footerY - 10).strokeColor("#E5E5E5").stroke();
            doc.font("Helvetica").fontSize(8).fillColor("#AAAAAA").text("BlackRidge Platforms | Confidential", 60, footerY, { align: "center", width: doc.page.width - 120 });
            doc.end();
          });
          const resend = getResendClient();
          if (resend) {
            await resend.client.emails.send({
              from: resend.fromEmail || "BlackRidge Platforms <onboarding@resend.dev>",
              to: "chris@blackridgeplatforms.com",
              subject: String(subject),
              html: `<p style="font-family:Arial,sans-serif;color:#333;">Your RIDGE CFO report is attached.</p>`,
              attachments: [{ filename: "RIDGE_CFO_Report.pdf", content: pdfBuffer.toString("base64") }],
            });
            reportSent = true;
          }
        } catch (reportErr: any) {
          console.error("RIDGE stream auto-report failed:", reportErr.message);
        }
      }

      sendDoneFrame({ fullReply, reportSent });
      res.end();
    } catch (err: any) {
      console.error("RIDGE stream hard error:", err);
      if (!res.headersSent) {
        res.status(500).json({ error: err.message });
      } else {
        try { res.end(); } catch {}
      }
    }
  });

  app.post("/api/ridge/send-report", isAuthenticated, async (req, res) => {
    try {
      const { content, subject } = req.body;
      if (!content || typeof content !== "string" || !subject || typeof subject !== "string") {
        return res.status(400).json({ error: "content and subject are required" });
      }
      if (content.length > 20000) {
        return res.status(400).json({ error: "Content too long (max 20,000 characters)" });
      }
      if (subject.length > 200) {
        return res.status(400).json({ error: "Subject too long (max 200 characters)" });
      }

      const now = new Date();
      const dateStr = now.toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
      const timeStr = now.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });

      const pdfBuffer = await new Promise<Buffer>((resolve, reject) => {
        const doc = new PDFDocument({ size: "letter", margin: 60 });
        const chunks: Buffer[] = [];
        doc.on("data", (chunk: Buffer) => chunks.push(chunk));
        doc.on("end", () => resolve(Buffer.concat(chunks)));
        doc.on("error", reject);

        doc.rect(0, 0, doc.page.width, 70).fill("#0A0A0A");
        doc.font("Helvetica-Bold").fontSize(18).fillColor("#C9A840")
          .text("BLACKRIDGE PLATFORMS", 60, 22, { align: "left" });

        doc.moveDown(1);
        doc.font("Helvetica-Bold").fontSize(14).fillColor("#333333")
          .text("RIDGE — CFO Report", 60, 90);
        doc.font("Helvetica").fontSize(10).fillColor("#888888")
          .text(`${dateStr} at ${timeStr}`, 60, 112);

        doc.moveTo(60, 135).lineTo(doc.page.width - 60, 135).strokeColor("#E5E5E5").stroke();

        doc.moveDown(2);
        doc.font("Helvetica").fontSize(11).fillColor("#222222")
          .text(content, 60, 150, {
            width: doc.page.width - 120,
            lineGap: 5,
          });

        const footerY = doc.page.height - 40;
        doc.moveTo(60, footerY - 10).lineTo(doc.page.width - 60, footerY - 10).strokeColor("#E5E5E5").stroke();
        doc.font("Helvetica").fontSize(8).fillColor("#AAAAAA")
          .text("BlackRidge Platforms | Confidential", 60, footerY, { align: "center", width: doc.page.width - 120 });

        doc.end();
      });

      const resend = getResendClient();
      if (!resend) {
        return res.status(500).json({ error: "Email service not configured" });
      }

      const emailResult = await resend.client.emails.send({
        from: resend.fromEmail || "BlackRidge Platforms <onboarding@resend.dev>",
        to: "chris@blackridgeplatforms.com",
        subject: String(subject),
        html: `<p style="font-family:Arial,sans-serif;color:#333;">Your RIDGE CFO report is attached.</p>`,
        attachments: [
          {
            filename: "RIDGE_CFO_Report.pdf",
            content: pdfBuffer.toString("base64"),
          },
        ],
      });

      if ((emailResult as any)?.error) {
        console.error("Resend error:", (emailResult as any).error);
        return res.status(500).json({ error: "Failed to send email" });
      }

      console.log("RIDGE report sent to chris@blackridgeplatforms.com");
      res.json({ success: true });
    } catch (err: any) {
      console.error("RIDGE send-report error:", err);
      res.status(500).json({ error: "Report generation failed" });
    }
  });

  return httpServer;
}

async function sendNotificationEmail(data: { name: string; email: string; company?: string | null; projectType?: string | null; budget?: string | null; message: string }) {
  const resend = getResendClient();
  if (!resend) {
    console.log("Resend not configured - skipping email notification");
    console.log("New lead received:", data.name, data.email);
    return;
  }

  const htmlBody = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background: #1a1a2e; color: #e0e0e0; border-radius: 8px;">
      <h2 style="color: #d4a843; border-bottom: 1px solid #333; padding-bottom: 12px;">New Lead from BlackRidge Platforms</h2>
      <table style="width: 100%; border-collapse: collapse;">
        <tr><td style="padding: 8px 0; color: #999;">Name</td><td style="padding: 8px 0;">${data.name}</td></tr>
        <tr><td style="padding: 8px 0; color: #999;">Email</td><td style="padding: 8px 0;"><a href="mailto:${data.email}" style="color: #d4a843;">${data.email}</a></td></tr>
        ${data.company ? `<tr><td style="padding: 8px 0; color: #999;">Company</td><td style="padding: 8px 0;">${data.company}</td></tr>` : ""}
        ${data.projectType ? `<tr><td style="padding: 8px 0; color: #999;">Project Type</td><td style="padding: 8px 0;">${data.projectType}</td></tr>` : ""}
        ${data.budget ? `<tr><td style="padding: 8px 0; color: #999;">Budget</td><td style="padding: 8px 0;">${data.budget}</td></tr>` : ""}
      </table>
      <div style="margin-top: 16px; padding: 16px; background: #16162a; border-radius: 6px;">
        <p style="color: #999; margin: 0 0 8px;">Message</p>
        <p style="margin: 0;">${data.message}</p>
      </div>
    </div>
  `;

  await resend.client.emails.send({
    from: resend.fromEmail || "BlackRidge Platforms <onboarding@resend.dev>",
    to: "chris@blackridgeplatforms.com",
    subject: `New Lead: ${data.name}${data.company ? ` from ${data.company}` : ""}`,
    html: htmlBody,
  });
}
