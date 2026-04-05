import type { Express, RequestHandler } from "express";
import Anthropic from "@anthropic-ai/sdk";
import { outreachStorage } from "./outreach-storage";
import { insertOutreachLeadSchema, emailEvents } from "@shared/schema";
import { db } from "./db";
import { desc, sql } from "drizzle-orm";
import { ZodError } from "zod";
import { fromZodError } from "zod-validation-error";
import { seedCampaignA } from "./outreach-seed";
import { startOutreachJobRunner as startJobRunner } from "./outreach-jobs";
import { storage } from "./storage";

const SCANNER_SYSTEM_PROMPT = `You are an elite website intelligence analyst working for BlackRidge Platforms — a company that builds high-end custom websites, client portals, CRM systems, project management tools, and accounting systems for small to medium businesses.

Your job: Find real businesses in a given location and industry whose websites are UNDERPERFORMING — outdated, broken, unconverting, or embarrassingly behind. These are businesses LOSING clients right now because of their digital presence.

FAILURE SIGNALS (more = higher score):
- Outdated visual design: old fonts, dated color schemes, clip art, early 2010s aesthetics
- Not mobile responsive
- No SSL/HTTPS — still running on http://
- Generic WordPress or Wix template with zero customization
- No clear call-to-action or conversion path
- Missing client portal, booking system, or customer account area
- No testimonials or social proof
- Missing or hard-to-find contact info
- No online payments, invoicing, or scheduling capability
- Broken images, dead links, or error pages
- Last updated years ago (stale copyright dates, old content)
- Desktop-only design from the Flash era

SCORING:
- 9-10: Site is costing them clients TODAY. Embarrassing. Urgent.
- 7-8: Significant problems across multiple areas. High opportunity.
- 5-6: Noticeable issues. Moderate opportunity.
- Below 5: Skip — do not return this business.

Only return businesses scoring 5 or higher. Must be REAL businesses with real websites you have actually visited.

Return ONLY a valid JSON array (no markdown, no explanation):
[
  {
    "company": "Business Name",
    "website": "https://actual-website.com",
    "industry": "specific niche",
    "location": "City, State",
    "score": 8,
    "owner_name": "Owner name if findable, null if not",
    "email": "contact email if findable, null if not",
    "phone": "phone if findable, null if not",
    "pain_points": ["Mobile site is broken", "No SSL certificate", "Last updated 2014"],
    "opportunity": "One sentence: what a BlackRidge build would deliver for this specific business"
  }
]

Find 5-8 real businesses. Return only the JSON array.`;

function extractClaudeText(response: Anthropic.Messages.Message): string {
  const text = response.content
    .filter((b): b is Anthropic.Messages.TextBlock => b.type === "text")
    .map(b => b.text)
    .join("");
  return text.replace(/```(?:json)?\s*/g, "").replace(/```/g, "").trim();
}

export async function sendHandoffNotification(lead: any, thread: any[]) {
  try {
    const { getResendClientForOutreach } = await import("./outreach-jobs");
    const resend = await getResendClientForOutreach();
    if (!resend) {
      console.log("Resend not configured — skipping handoff notification");
      return;
    }

    const threadText = thread.map(m => {
      const role = m.role === "chris" ? "CHRIS" : "PROSPECT";
      return `${role} (${m.sentAt}):\n${m.body}`;
    }).join("\n\n---\n\n");

    await resend.client.emails.send({
      from: resend.fromEmail,
      to: "chris@blackridgeplatforms.com",
      subject: `Action Required — ${lead.businessName} is ready for a proposal`,
      html: `<div style="font-family: Arial, sans-serif; max-width: 600px; line-height: 1.6;">
<h2>${lead.businessName} has agreed to receive a proposal.</h2>
<p><strong>Contact:</strong> ${lead.contactName || "Unknown"}</p>
<p><strong>Email:</strong> ${lead.email}</p>
<p><strong>Website:</strong> ${lead.websiteUrl}</p>
<hr>
<h3>Full Conversation:</h3>
<pre style="white-space: pre-wrap; font-family: inherit; background: #f5f5f5; padding: 16px; border-radius: 8px;">${threadText}</pre>
<hr>
<p>Log in to the portal to take over and send the proposal.</p>
</div>`,
    });

    console.log(`Handoff notification sent for ${lead.businessName}`);
  } catch (err) {
    console.error("Failed to send handoff notification:", err);
  }
}

async function handleInboundEmail(data: any, res: any) {
  const fromEmail = (data?.from || "").replace(/.*</, "").replace(/>.*/, "").trim();
  const subject = data?.subject || "";
  const messageId = data?.message_id || data?.email_id;
  const emailId = data?.email_id;

  let textBody = data?.text || data?.html?.replace(/<[^>]*>/g, " ").trim() || "";

  if (emailId && (!textBody || textBody.length < 5)) {
    try {
      const { getResendClientForOutreach } = await import("./outreach-jobs");
      const resend = await getResendClientForOutreach();
      if (resend) {
        const fullEmail = await resend.client.emails.get(emailId);
        textBody = (fullEmail as any)?.text || (fullEmail as any)?.html?.replace(/<[^>]*>/g, " ").trim() || textBody;
      }
    } catch (err) {
      console.error("Failed to fetch full email content:", err);
    }
  }

  if (!fromEmail) return res.json({ ok: true });

  const lead = await outreachStorage.findLeadByEmail(fromEmail);
  if (!lead) {
    console.log(`Inbound email from unknown address: ${fromEmail}`);
    return res.json({ ok: true });
  }

  if (lead.autoReplyEnabled === false) {
    console.log(`Auto-reply disabled for ${lead.businessName} — logging only`);
    await outreachStorage.createConversation({
      leadId: lead.id,
      direction: "inbound",
      subject,
      body: textBody,
      resendMessageId: messageId,
    });
    const thread = Array.isArray(lead.conversationThread) ? lead.conversationThread as any[] : [];
    thread.push({ role: "prospect", subject, body: textBody, sentAt: new Date().toISOString() });
    await outreachStorage.updateLead(lead.id, { conversationThread: thread });
    return res.json({ ok: true });
  }

  if (lead.awaitingHandoff) {
    console.log(`Lead ${lead.businessName} awaiting handoff — notifying Chris`);
    await outreachStorage.createConversation({
      leadId: lead.id,
      direction: "inbound",
      subject,
      body: textBody,
      resendMessageId: messageId,
    });
    const thread = Array.isArray(lead.conversationThread) ? lead.conversationThread as any[] : [];
    thread.push({ role: "prospect", subject, body: textBody, sentAt: new Date().toISOString() });
    await outreachStorage.updateLead(lead.id, { conversationThread: thread });
    await sendHandoffNotification(lead, thread);
    return res.json({ ok: true });
  }

  const conversation = await outreachStorage.createConversation({
    leadId: lead.id,
    direction: "inbound",
    subject,
    body: textBody,
    resendMessageId: messageId,
  });

  const thread = Array.isArray(lead.conversationThread) ? lead.conversationThread as any[] : [];
  thread.push({ role: "prospect", subject, body: textBody, sentAt: new Date().toISOString() });
  await outreachStorage.updateLead(lead.id, { conversationThread: thread });

  if (!["engaged", "won", "converted"].includes(lead.status)) {
    await outreachStorage.updateLead(lead.id, { status: "engaged" });
  }

  const enrollment = await outreachStorage.getEnrollmentByLead(lead.id);
  if (enrollment && !enrollment.stoppedAt && !enrollment.completedAt) {
    await outreachStorage.updateEnrollment(enrollment.id, {
      stoppedAt: new Date(),
      stopReason: "Prospect replied",
    });
    await outreachStorage.skipQueuedJobsForLead(lead.id);
  }

  await outreachStorage.createJob({
    type: "generate_reply",
    payload: {
      lead_id: lead.id,
      inbound_conversation_id: conversation.id,
    },
    runAt: new Date(Date.now() + 30000),
  });

  console.log(`Inbound email from ${fromEmail} (${lead.businessName}) - queued AI reply`);
  return res.json({ ok: true });
}

export function registerOutreachRoutes(app: Express, isAuthenticated: RequestHandler) {

  app.get("/api/outreach/leads", isAuthenticated, async (_req, res) => {
    try {
      const leads = await outreachStorage.getLeadsWithCampaignSummary();
      res.json(leads);
    } catch (error) {
      console.error("Get outreach leads error:", error);
      res.status(500).json({ message: "Failed to fetch outreach leads" });
    }
  });

  app.get("/api/outreach/leads/:id", isAuthenticated, async (req, res) => {
    try {
      const data = await outreachStorage.getLeadWithCampaignInfo(String(req.params.id));
      if (!data) return res.status(404).json({ message: "Lead not found" });
      res.json(data);
    } catch (error) {
      console.error("Get outreach lead error:", error);
      res.status(500).json({ message: "Failed to fetch lead" });
    }
  });

  app.post("/api/outreach/leads", isAuthenticated, async (req, res) => {
    try {
      const validated = insertOutreachLeadSchema.parse(req.body);

      if (validated.email) {
        const existing = await outreachStorage.findLeadByEmail(validated.email);
        if (existing) {
          return res.status(409).json({ message: `A lead with email "${validated.email}" already exists (${existing.businessName}).` });
        }
      } else if (validated.websiteUrl) {
        const existingByUrl = await outreachStorage.findLeadByWebsite(validated.websiteUrl);
        if (existingByUrl) {
          return res.status(409).json({ message: `A lead with website "${validated.websiteUrl}" already exists (${existingByUrl.businessName}).` });
        }
      }

      const lead = await outreachStorage.createLead(validated);

      await outreachStorage.createJob({
        type: "analyze_lead",
        payload: { lead_id: lead.id },
        runAt: new Date(),
      });

      const settings = await outreachStorage.getSettings();
      if (!settings.enrollmentsPaused && validated.email) {
        const campaign = await outreachStorage.getActiveCampaign();
        if (campaign) {
          const enrollment = await outreachStorage.createEnrollment(lead.id, campaign.id);
          await outreachStorage.createJob({
            type: "send_campaign_step",
            payload: {
              lead_id: lead.id,
              enrollment_id: enrollment.id,
              campaign_id: campaign.id,
              step_number: 1,
            },
            runAt: new Date(Date.now() + 5000),
          });
        }
      }

      res.status(201).json(lead);
    } catch (error) {
      if (error instanceof ZodError) {
        res.status(400).json({ message: fromZodError(error).message });
      } else {
        console.error("Create outreach lead error:", error);
        res.status(500).json({ message: "Failed to create outreach lead" });
      }
    }
  });

  app.post("/api/outreach/leads/import-from-crm", isAuthenticated, async (req, res) => {
    try {
      const { crmLeadId } = req.body;
      if (!crmLeadId) return res.status(400).json({ message: "crmLeadId is required" });

      const crmLead = await storage.getContactSubmission(crmLeadId);
      if (!crmLead) return res.status(404).json({ message: "CRM lead not found" });

      if (crmLead.email) {
        const existing = await outreachStorage.findLeadByEmail(crmLead.email);
        if (existing) {
          return res.status(409).json({ message: `Lead with email "${crmLead.email}" already exists in Outreach (${existing.businessName}).` });
        }
      }

      const lead = await outreachStorage.createLead({
        businessName: crmLead.company || crmLead.name,
        websiteUrl: "",
        industry: null,
        contactName: crmLead.name,
        email: crmLead.email || null,
        phone: null,
        location: null,
        notes: `Imported from CRM. Project type: ${crmLead.projectType || "N/A"}. Budget: ${crmLead.budget || "N/A"}. Message: ${crmLead.message || "N/A"}`,
      });

      await outreachStorage.updateLead(lead.id, { crmLeadId: crmLead.id });

      await outreachStorage.createJob({
        type: "analyze_lead",
        payload: { lead_id: lead.id },
        runAt: new Date(),
      });

      const settings = await outreachStorage.getSettings();
      if (!settings.enrollmentsPaused && lead.email) {
        const campaign = await outreachStorage.getActiveCampaign();
        if (campaign) {
          const enrollment = await outreachStorage.createEnrollment(lead.id, campaign.id);
          await outreachStorage.createJob({
            type: "send_campaign_step",
            payload: {
              lead_id: lead.id,
              enrollment_id: enrollment.id,
              campaign_id: campaign.id,
              step_number: 1,
            },
            runAt: new Date(Date.now() + 5000),
          });
        }
      }

      res.status(201).json(lead);
    } catch (error) {
      console.error("Import CRM lead error:", error);
      res.status(500).json({ message: "Failed to import CRM lead" });
    }
  });

  app.post("/api/outreach/leads/:id/send-to-crm", isAuthenticated, async (req, res) => {
    try {
      const leadId = req.params.id as string;
      const lead = await outreachStorage.getLead(leadId);
      if (!lead) {
        return res.status(404).json({ message: "Outreach lead not found" });
      }

      if (lead.crmLeadId) {
        return res.status(409).json({ message: "This lead is already in the CRM", crmLeadId: lead.crmLeadId });
      }

      const name = lead.contactName || lead.businessName || "Unknown";
      const messageParts = ["Outreach lead imported from prospecting.", `Website: ${lead.websiteUrl}`];
      if (lead.industry) messageParts.push(`Industry: ${lead.industry}`);
      if (lead.phone) messageParts.push(`Phone: ${lead.phone}`);
      if (lead.location) messageParts.push(`Location: ${lead.location}`);
      if (lead.pitchAngle) messageParts.push(`Pitch Angle: ${lead.pitchAngle}`);
      if (lead.aiAuditSummary) messageParts.push(`AI Summary: ${lead.aiAuditSummary}`);

      const { contactSubmissions } = await import("@shared/schema");
      const { db } = await import("./db");
      const [crmLead] = await db.insert(contactSubmissions).values({
        name,
        email: lead.email || "",
        company: lead.businessName,
        message: messageParts.join("\n"),
        status: "new",
        priority: "medium",
        projectedValue: lead.valueEstimate ?? null,
        leadSource: "outreach",
      }).returning();

      await outreachStorage.updateLead(lead.id, { crmLeadId: crmLead.id });

      res.json({ message: "Lead added to CRM", crmLeadId: crmLead.id });
    } catch (error) {
      console.error("Send to CRM error:", error);
      res.status(500).json({ message: "Failed to send lead to CRM" });
    }
  });

  app.post("/api/outreach/leads/csv", isAuthenticated, async (req, res) => {
    try {
      const { rows } = req.body;
      if (!Array.isArray(rows) || rows.length === 0) {
        return res.status(400).json({ message: "No rows provided" });
      }

      const results: { created: number; duplicates: number; errors: string[] } = { created: 0, duplicates: 0, errors: [] };

      for (let i = 0; i < rows.length; i++) {
        try {
          const row = rows[i];
          const data = {
            businessName: row.business_name || row.businessName,
            websiteUrl: row.website_url || row.websiteUrl,
            industry: row.industry || null,
            contactName: row.contact_name || row.contactName || null,
            email: row.email,
            phone: row.phone || null,
            location: row.location || null,
            notes: row.notes || null,
          };

          const validated = insertOutreachLeadSchema.parse(data);

          if (validated.email) {
            const existing = await outreachStorage.findLeadByEmail(validated.email);
            if (existing) {
              results.duplicates++;
              results.errors.push(`Row ${i + 1}: Duplicate email "${validated.email}" (already exists as "${existing.businessName}")`);
              continue;
            }
          } else if (validated.websiteUrl) {
            const existingByUrl = await outreachStorage.findLeadByWebsite(validated.websiteUrl);
            if (existingByUrl) {
              results.duplicates++;
              results.errors.push(`Row ${i + 1}: Duplicate website "${validated.websiteUrl}" (already exists as "${existingByUrl.businessName}")`);
              continue;
            }
          }

          const lead = await outreachStorage.createLead(validated);

          await outreachStorage.createJob({
            type: "analyze_lead",
            payload: { lead_id: lead.id },
            runAt: new Date(),
          });

          const csvSettings = await outreachStorage.getSettings();
          if (!csvSettings.enrollmentsPaused && validated.email) {
            const campaign = await outreachStorage.getActiveCampaign();
            if (campaign) {
              const enrollment = await outreachStorage.createEnrollment(lead.id, campaign.id);
              await outreachStorage.createJob({
                type: "send_campaign_step",
                payload: {
                  lead_id: lead.id,
                  enrollment_id: enrollment.id,
                  campaign_id: campaign.id,
                  step_number: 1,
                },
                runAt: new Date(Date.now() + 5000 + i * 2000),
              });
            }
          }

          results.created++;
        } catch (err: any) {
          results.errors.push(`Row ${i + 1}: ${err?.message || "Invalid data"}`);
        }
      }

      res.json(results);
    } catch (error) {
      console.error("CSV upload error:", error);
      res.status(500).json({ message: "Failed to process CSV" });
    }
  });

  app.patch("/api/outreach/leads/:id", isAuthenticated, async (req, res) => {
    try {
      const lead = await outreachStorage.updateLead(String(req.params.id), req.body);
      if (!lead) return res.status(404).json({ message: "Lead not found" });

      const stopStatuses = ["engaged", "won", "lost", "do_not_contact", "converted"];
      if (stopStatuses.includes(lead.status)) {
        const enrollment = await outreachStorage.getEnrollmentByLead(lead.id);
        if (enrollment && !enrollment.stoppedAt) {
          await outreachStorage.updateEnrollment(enrollment.id, {
            stoppedAt: new Date(),
            stopReason: `Lead status changed to ${lead.status}`,
          });
        }
        await outreachStorage.skipQueuedJobsForLead(lead.id);
      }

      res.json(lead);
    } catch (error) {
      console.error("Update outreach lead error:", error);
      res.status(500).json({ message: "Failed to update lead" });
    }
  });

  app.delete("/api/outreach/leads/:id", isAuthenticated, async (req, res) => {
    try {
      const deleted = await outreachStorage.deleteLead(String(req.params.id));
      if (!deleted) return res.status(404).json({ message: "Lead not found" });
      res.json({ success: true });
    } catch (error) {
      console.error("Delete outreach lead error:", error);
      res.status(500).json({ message: "Failed to delete lead" });
    }
  });

  app.post("/api/outreach/leads/bulk-delete", isAuthenticated, async (req, res) => {
    try {
      const { ids } = req.body;
      if (!Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ message: "No lead IDs provided" });
      }
      let deleted = 0;
      for (const id of ids) {
        const result = await outreachStorage.deleteLead(String(id));
        if (result) deleted++;
      }
      res.json({ deleted, total: ids.length });
    } catch (error) {
      console.error("Bulk delete leads error:", error);
      res.status(500).json({ message: "Failed to bulk delete leads" });
    }
  });

  app.post("/api/outreach/leads/:id/stop-campaign", isAuthenticated, async (req, res) => {
    try {
      const leadId = String(req.params.id);
      const enrollment = await outreachStorage.getEnrollmentByLead(leadId);
      if (!enrollment) return res.status(404).json({ message: "No enrollment found" });
      if (enrollment.stoppedAt) return res.json({ message: "Already stopped" });

      await outreachStorage.updateEnrollment(enrollment.id, {
        stoppedAt: new Date(),
        stopReason: req.body.reason || "Manually stopped",
      });
      await outreachStorage.skipQueuedJobsForLead(leadId);
      res.json({ success: true });
    } catch (error) {
      console.error("Stop campaign error:", error);
      res.status(500).json({ message: "Failed to stop campaign" });
    }
  });

  app.post("/api/outreach/leads/:id/start-campaign", isAuthenticated, async (req, res) => {
    try {
      const leadId = String(req.params.id);
      const { campaignId } = req.body;
      const lead = await outreachStorage.getLead(leadId);
      if (!lead) return res.status(404).json({ message: "Lead not found" });

      if (!lead.email) {
        return res.status(400).json({ message: "Lead must have an email address before enrolling in a campaign" });
      }

      const existingEnrollment = await outreachStorage.getEnrollmentByLead(leadId);
      if (existingEnrollment && !existingEnrollment.stoppedAt && !existingEnrollment.completedAt) {
        return res.status(409).json({ message: "Lead is already enrolled in an active campaign" });
      }

      let campaign;
      if (campaignId) {
        const campaigns = await outreachStorage.getCampaigns();
        campaign = campaigns.find(c => c.id === campaignId);
      } else {
        campaign = await outreachStorage.getActiveCampaign();
      }
      if (!campaign) return res.status(404).json({ message: "Campaign not found" });

      const enrollment = await outreachStorage.createEnrollment(lead.id, campaign.id);
      await outreachStorage.updateLead(lead.id, { status: "enrolled" });

      await outreachStorage.createJob({
        type: "send_campaign_step",
        payload: {
          lead_id: lead.id,
          enrollment_id: enrollment.id,
          campaign_id: campaign.id,
          step_number: 1,
        },
        runAt: new Date(Date.now() + 5000),
      });

      res.json({ success: true, enrollment });
    } catch (error) {
      console.error("Start campaign error:", error);
      res.status(500).json({ message: "Failed to start campaign" });
    }
  });

  app.post("/api/outreach/leads/:id/pause-campaign", isAuthenticated, async (req, res) => {
    try {
      const leadId = String(req.params.id);
      const enrollment = await outreachStorage.getEnrollmentByLead(leadId);
      if (!enrollment) return res.status(404).json({ message: "No enrollment found" });
      if (enrollment.stoppedAt) return res.status(400).json({ message: "Campaign is already stopped or paused" });
      if (enrollment.completedAt) return res.status(400).json({ message: "Campaign is already completed" });

      await outreachStorage.updateEnrollment(enrollment.id, {
        stoppedAt: new Date(),
        stopReason: "Paused",
      });
      res.json({ success: true });
    } catch (error) {
      console.error("Pause campaign error:", error);
      res.status(500).json({ message: "Failed to pause campaign" });
    }
  });

  app.post("/api/outreach/leads/:id/resume-campaign", isAuthenticated, async (req, res) => {
    try {
      const leadId = String(req.params.id);
      const enrollment = await outreachStorage.getEnrollmentByLead(leadId);
      if (!enrollment) return res.status(404).json({ message: "No enrollment found" });
      if (!enrollment.stoppedAt || enrollment.stopReason !== "Paused") {
        return res.status(400).json({ message: "Campaign is not paused" });
      }

      await outreachStorage.updateEnrollment(enrollment.id, {
        stoppedAt: null as any,
        stopReason: null as any,
      });
      res.json({ success: true });
    } catch (error) {
      console.error("Resume campaign error:", error);
      res.status(500).json({ message: "Failed to resume campaign" });
    }
  });

  app.post("/api/outreach/leads/bulk-enroll", isAuthenticated, async (req, res) => {
    try {
      const { leadIds, campaignId } = req.body;
      if (!Array.isArray(leadIds) || leadIds.length === 0) {
        return res.status(400).json({ message: "No leads selected" });
      }

      let campaign;
      if (campaignId) {
        const campaigns = await outreachStorage.getCampaigns();
        campaign = campaigns.find(c => c.id === campaignId);
      } else {
        campaign = await outreachStorage.getActiveCampaign();
      }
      if (!campaign) return res.status(404).json({ message: "Campaign not found" });

      let enrolled = 0;
      let skipped = 0;
      const errors: string[] = [];

      for (const leadId of leadIds) {
        try {
          const lead = await outreachStorage.getLead(leadId);
          if (!lead) { skipped++; continue; }
          if (!lead.email) { skipped++; errors.push(`${lead.businessName}: no email`); continue; }

          const existingEnrollment = await outreachStorage.getEnrollmentByLead(leadId);
          if (existingEnrollment && !existingEnrollment.stoppedAt && !existingEnrollment.completedAt) {
            skipped++;
            errors.push(`${lead.businessName}: already enrolled`);
            continue;
          }

          const enrollment = await outreachStorage.createEnrollment(lead.id, campaign.id);
          await outreachStorage.updateLead(lead.id, { status: "enrolled" });

          await outreachStorage.createJob({
            type: "send_campaign_step",
            payload: {
              lead_id: lead.id,
              enrollment_id: enrollment.id,
              campaign_id: campaign.id,
              step_number: 1,
            },
            runAt: new Date(Date.now() + 5000 + enrolled * 2000),
          });
          enrolled++;
        } catch (err: any) {
          skipped++;
          errors.push(`Lead ${leadId}: ${err.message}`);
        }
      }

      res.json({ success: true, enrolled, skipped, errors });
    } catch (error) {
      console.error("Bulk enroll error:", error);
      res.status(500).json({ message: "Failed to bulk enroll leads" });
    }
  });

  app.post("/api/outreach/leads/:id/convert", isAuthenticated, async (req, res) => {
    try {
      const leadData = await outreachStorage.getLeadWithCampaignInfo(String(req.params.id));
      if (!leadData) return res.status(404).json({ message: "Lead not found" });

      const { lead, enrollment } = leadData;

      await outreachStorage.updateLead(lead.id, { status: "converted" });

      if (enrollment && !enrollment.stoppedAt) {
        await outreachStorage.updateEnrollment(enrollment.id, {
          stoppedAt: new Date(),
          stopReason: "Converted to project",
        });
      }

      await outreachStorage.skipQueuedJobsForLead(lead.id);

      res.json({ success: true, lead: { ...lead, status: "converted" } });
    } catch (error) {
      console.error("Convert lead error:", error);
      res.status(500).json({ message: "Failed to convert lead" });
    }
  });

  app.get("/api/outreach/stats", isAuthenticated, async (_req, res) => {
    try {
      const emailStats = await outreachStorage.getEmailStats();
      res.json(emailStats);
    } catch (error) {
      console.error("Get outreach stats error:", error);
      res.status(500).json({ message: "Failed to fetch stats" });
    }
  });

  app.get("/api/outreach/campaigns", isAuthenticated, async (_req, res) => {
    try {
      const campaigns = await outreachStorage.getCampaigns();
      res.json(campaigns);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch campaigns" });
    }
  });

  app.get("/api/outreach/campaigns/:id/steps", isAuthenticated, async (req, res) => {
    try {
      const steps = await outreachStorage.getCampaignSteps(String(req.params.id));
      res.json(steps);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch campaign steps" });
    }
  });

  app.get("/api/outreach/jobs/failed", isAuthenticated, async (_req, res) => {
    try {
      const jobs = await outreachStorage.getFailedJobs();
      res.json(jobs);
    } catch (error) {
      console.error("Get failed jobs error:", error);
      res.status(500).json({ message: "Failed to fetch failed jobs" });
    }
  });

  app.post("/api/outreach/jobs/:id/retry", isAuthenticated, async (req, res) => {
    try {
      const job = await outreachStorage.requeueJob(String(req.params.id));
      if (!job) return res.status(404).json({ message: "Job not found or not in failed state" });
      res.json({ success: true, job });
    } catch (error) {
      console.error("Retry job error:", error);
      res.status(500).json({ message: "Failed to retry job" });
    }
  });

  app.post("/api/outreach/process-jobs", isAuthenticated, async (_req, res) => {
    try {
      const { processAnalyzeLeadJob, processSendCampaignStepJob, processGenerateReplyJob } = await import("./outreach-jobs");
      const jobs = await outreachStorage.getQueuedJobs();
      let processed = 0;

      for (const job of jobs) {
        const picked = await outreachStorage.atomicPickupJob(job.id);
        if (!picked) continue;

        try {
          if (job.type === "analyze_lead") {
            await processAnalyzeLeadJob(job.payload as { lead_id: string });
          } else if (job.type === "generate_reply") {
            await processGenerateReplyJob(job.payload as any);
          } else if (job.type === "send_campaign_step") {
            await processSendCampaignStepJob(job.payload as any);
          }
          await outreachStorage.updateJob(job.id, { status: "done" });
          processed++;
        } catch (err: any) {
          await outreachStorage.updateJob(job.id, { status: "failed", error: err?.message });
        }
      }

      res.json({ processed, total: jobs.length });
    } catch (error) {
      res.status(500).json({ message: "Failed to process jobs" });
    }
  });

  app.get("/api/outreach/settings", isAuthenticated, async (_req, res) => {
    try {
      const settings = await outreachStorage.getSettings();
      res.json(settings);
    } catch (error) {
      console.error("Get outreach settings error:", error);
      res.status(500).json({ message: "Failed to fetch settings" });
    }
  });

  app.patch("/api/outreach/settings", isAuthenticated, async (req, res) => {
    try {
      const { dailySendCap, sendWindowStart, sendWindowEnd, timezone, enrollmentsPaused, outreachStartedAt, agentMode, replyToAddress } = req.body;
      const updates: Record<string, any> = {};
      const timeRegex = /^\d{2}:\d{2}$/;

      if (dailySendCap !== undefined) {
        const cap = Number(dailySendCap);
        if (isNaN(cap)) return res.status(400).json({ message: "dailySendCap must be a number" });
        updates.dailySendCap = Math.max(1, Math.min(200, cap));
      }
      if (sendWindowStart !== undefined) {
        if (!timeRegex.test(String(sendWindowStart))) return res.status(400).json({ message: "sendWindowStart must be HH:MM format" });
        updates.sendWindowStart = String(sendWindowStart);
      }
      if (sendWindowEnd !== undefined) {
        if (!timeRegex.test(String(sendWindowEnd))) return res.status(400).json({ message: "sendWindowEnd must be HH:MM format" });
        updates.sendWindowEnd = String(sendWindowEnd);
      }
      if (timezone !== undefined) {
        try {
          Intl.DateTimeFormat("en-US", { timeZone: String(timezone) });
          updates.timezone = String(timezone);
        } catch {
          return res.status(400).json({ message: "Invalid timezone identifier" });
        }
      }
      if (enrollmentsPaused !== undefined) {
        updates.enrollmentsPaused = Boolean(enrollmentsPaused);
        if (!enrollmentsPaused) updates.enrollmentsPausedReason = null;
      }
      if (agentMode !== undefined) {
        if (!["auto_reply", "draft", "paused"].includes(String(agentMode))) {
          return res.status(400).json({ message: "agentMode must be auto_reply, draft, or paused" });
        }
        updates.agentMode = String(agentMode);
      }
      if (outreachStartedAt !== undefined) updates.outreachStartedAt = outreachStartedAt ? new Date(outreachStartedAt) : null;
      if (replyToAddress !== undefined) {
        if (replyToAddress) {
          const addr = String(replyToAddress).trim();
          if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(addr)) {
            return res.status(400).json({ message: "replyToAddress must be a valid email address" });
          }
          updates.replyToAddress = addr;
        } else {
          updates.replyToAddress = null;
        }
      }
      const settings = await outreachStorage.updateSettings(updates);
      res.json(settings);
    } catch (error) {
      console.error("Update outreach settings error:", error);
      res.status(500).json({ message: "Failed to update settings" });
    }
  });

  app.get("/api/outreach/conversations", isAuthenticated, async (_req, res) => {
    try {
      const conversations = await outreachStorage.getAllConversations(500);
      const leads = await outreachStorage.getLeads();
      const leadMap = new Map(leads.map(l => [l.id, l]));
      const enriched = conversations.map(c => ({
        ...c,
        lead: leadMap.get(c.leadId) ? {
          id: leadMap.get(c.leadId)!.id,
          businessName: leadMap.get(c.leadId)!.businessName,
          email: leadMap.get(c.leadId)!.email,
          contactName: leadMap.get(c.leadId)!.contactName,
          status: leadMap.get(c.leadId)!.status,
          awaitingHandoff: leadMap.get(c.leadId)!.awaitingHandoff,
        } : null,
      }));
      res.json(enriched);
    } catch (error) {
      console.error("Get all conversations error:", error);
      res.status(500).json({ message: "Failed to fetch conversations" });
    }
  });

  app.get("/api/outreach/leads/:id/conversations", isAuthenticated, async (req, res) => {
    try {
      const conversations = await outreachStorage.getConversationsByLead(String(req.params.id));
      res.json(conversations);
    } catch (error) {
      console.error("Get conversations error:", error);
      res.status(500).json({ message: "Failed to fetch conversations" });
    }
  });

  app.get("/api/outreach/insights", isAuthenticated, async (_req, res) => {
    try {
      const insights = await outreachStorage.getRecentInsights(50);
      res.json(insights);
    } catch (error) {
      console.error("Get insights error:", error);
      res.status(500).json({ message: "Failed to fetch insights" });
    }
  });

  app.post("/api/outreach/learning/run", isAuthenticated, async (_req, res) => {
    try {
      const { processDailyLearningJob } = await import("./outreach-jobs");
      await processDailyLearningJob();
      res.json({ success: true });
    } catch (error) {
      console.error("Manual learning run error:", error);
      res.status(500).json({ message: "Failed to run learning job" });
    }
  });

  app.get("/api/outreach/agent-report", isAuthenticated, async (_req, res) => {
    try {
      const [convStats, conversations, insights, leadsWithReplies, allLeads] = await Promise.all([
        outreachStorage.getConversationStats(),
        outreachStorage.getAllConversations(200),
        outreachStorage.getRecentInsights(50),
        outreachStorage.getAllLeadsWithReplies(),
        outreachStorage.getLeads(),
      ]);

      const leadsMap = new Map<string, any>();
      for (const lead of allLeads) {
        leadsMap.set(lead.id, lead);
      }

      const conversationsByLead: Record<string, { lead: any; messages: any[] }> = {};
      for (const conv of conversations) {
        if (!conversationsByLead[conv.leadId]) {
          const lead = leadsMap.get(conv.leadId);
          conversationsByLead[conv.leadId] = {
            lead: lead || { id: conv.leadId, businessName: "Unknown" },
            messages: [],
          };
        }
        conversationsByLead[conv.leadId].messages.push(conv);
      }

      const activeThreads = Object.values(conversationsByLead)
        .filter(t => t.messages.some(m => m.direction === "inbound"))
        .sort((a, b) => {
          const aLatest = new Date(a.messages[0].createdAt).getTime();
          const bLatest = new Date(b.messages[0].createdAt).getTime();
          return bLatest - aLatest;
        });

      const campaignOnlyThreads = Object.values(conversationsByLead)
        .filter(t => !t.messages.some(m => m.direction === "inbound"))
        .sort((a, b) => {
          const aLatest = new Date(a.messages[0].createdAt).getTime();
          const bLatest = new Date(b.messages[0].createdAt).getTime();
          return bLatest - aLatest;
        });

      const settings = await outreachStorage.getSettings();

      res.json({
        stats: convStats,
        activeThreads,
        campaignOnlyThreads,
        insights,
        leadsEngaged: leadsWithReplies.length,
        totalLeads: allLeads.length,
        agentMode: settings.agentMode,
      });
    } catch (error) {
      console.error("Agent report error:", error);
      res.status(500).json({ message: "Failed to generate agent report" });
    }
  });

  app.get("/api/outreach/webhook-status", isAuthenticated, async (_req, res) => {
    try {
      const recentEvents = await db
        .select({
          id: emailEvents.id,
          toEmail: emailEvents.toEmail,
          status: emailEvents.status,
          resendMessageId: emailEvents.resendMessageId,
          lastEventAt: emailEvents.lastEventAt,
          sentAt: emailEvents.sentAt,
          createdAt: emailEvents.createdAt,
        })
        .from(emailEvents)
        .orderBy(desc(emailEvents.lastEventAt), desc(emailEvents.createdAt))
        .limit(20);
      const statusBreakdown = await db.execute(sql`
        SELECT status, COUNT(*)::int as count FROM email_events GROUP BY status ORDER BY count DESC
      `);
      res.json({
        recentEvents,
        statusBreakdown: statusBreakdown.rows,
        webhookSecretConfigured: !!process.env.RESEND_WEBHOOK_SECRET,
      });
    } catch (error) {
      console.error("Webhook status error:", error);
      res.status(500).json({ message: "Failed to fetch webhook status" });
    }
  });

  // To enable inbound email replies:
  // 1. Go to resend.com and enable Inbound Email
  // 2. Set the inbound webhook URL to: https://[your-replit-url]/api/outreach/inbound-reply
  // 3. Configure your MX records as Resend instructs
  // 4. Resend will forward all replies to chris@blackridgeplatforms.com to this endpoint
  // 5. Optionally set RESEND_WEBHOOK_SECRET for signature verification on this endpoint
  app.post("/api/outreach/inbound-reply", async (req, res) => {
    try {
      const webhookSecret = process.env.RESEND_WEBHOOK_SECRET;
      if (webhookSecret) {
        const svixId = req.headers["svix-id"] as string;
        const svixTimestamp = req.headers["svix-timestamp"] as string;
        const svixSignature = req.headers["svix-signature"] as string;
        if (svixId && svixTimestamp && svixSignature) {
          try {
            const { Webhook } = await import("svix");
            const wh = new Webhook(webhookSecret);
            const rawBody = (req as any).rawBody;
            const bodyStr = rawBody ? (typeof rawBody === "string" ? rawBody : Buffer.isBuffer(rawBody) ? rawBody.toString("utf8") : JSON.stringify(req.body)) : JSON.stringify(req.body);
            wh.verify(bodyStr, { "svix-id": svixId, "svix-timestamp": svixTimestamp, "svix-signature": svixSignature });
          } catch (verifyErr) {
            console.warn("Inbound webhook signature verification failed:", verifyErr);
            return res.status(401).json({ ok: false, message: "Invalid signature" });
          }
        }
      }

      const fromEmail = (req.body?.from || "").replace(/.*</, "").replace(/>.*/, "").trim();
      const subject = req.body?.subject || "";
      const textBody = req.body?.text || req.body?.html?.replace(/<[^>]*>/g, " ").trim() || "";

      if (!fromEmail) return res.json({ ok: true });

      return handleInboundEmail({ from: fromEmail, subject, text: textBody, message_id: req.body?.message_id, email_id: req.body?.email_id }, res);
    } catch (error) {
      console.error("Inbound reply error:", error);
      res.status(500).json({ ok: false });
    }
  });

  app.post("/api/webhooks/resend", async (req, res) => {
    try {
      console.log(`Resend webhook POST received: type=${req.body?.type}`);
      const webhookSecret = process.env.RESEND_WEBHOOK_SECRET;
      if (webhookSecret) {
        const svixId = req.headers["svix-id"] as string;
        const svixTimestamp = req.headers["svix-timestamp"] as string;
        const svixSignature = req.headers["svix-signature"] as string;

        if (!svixId || !svixTimestamp || !svixSignature) {
          console.warn("Webhook missing Svix headers — rejected");
          return res.status(400).json({ ok: false, message: "Missing signature headers" });
        }

        try {
          const { Webhook } = await import("svix");
          const wh = new Webhook(webhookSecret);
          const rawBody = (req as any).rawBody;
          const bodyStr = rawBody ? (typeof rawBody === "string" ? rawBody : Buffer.isBuffer(rawBody) ? rawBody.toString("utf8") : JSON.stringify(req.body)) : JSON.stringify(req.body);
          wh.verify(bodyStr, {
            "svix-id": svixId,
            "svix-timestamp": svixTimestamp,
            "svix-signature": svixSignature,
          });
        } catch (verifyErr) {
          console.warn("Webhook signature verification failed:", verifyErr);
          console.warn("Webhook type was:", req.body?.type, "email_id:", req.body?.data?.email_id);
          return res.status(401).json({ ok: false, message: "Invalid signature" });
        }
      }

      const { type, data } = req.body;

      if (type === "email.received") {
        return handleInboundEmail(data, res);
      }

      const resendEmailId = data?.email_id || data?.message_id;
      console.log(`Resend webhook received: type=${type}, email_id=${data?.email_id}, message_id=${data?.message_id}`);

      if (!resendEmailId) {
        console.log("Resend webhook: no email_id or message_id found, skipping");
        return res.json({ ok: true });
      }

      const statusMap: Record<string, string> = {
        "email.sent": "sent",
        "email.delivered": "delivered",
        "email.opened": "opened",
        "email.clicked": "clicked",
        "email.bounced": "bounced",
        "email.complained": "bounced",
      };

      const newStatus = statusMap[type];
      if (newStatus) {
        let updatedEvent = await outreachStorage.updateEmailEventByResendId(resendEmailId, newStatus);

        if (!updatedEvent && data?.email_id && data?.message_id && data.email_id !== data.message_id) {
          updatedEvent = await outreachStorage.updateEmailEventByResendId(data.message_id, newStatus);
          if (!updatedEvent) {
            updatedEvent = await outreachStorage.updateEmailEventByResendId(data.email_id, newStatus);
          }
        }

        if (!updatedEvent) {
          const recipientEmail = Array.isArray(data.to) ? data.to[0] : data.to;
          if (recipientEmail) {
            updatedEvent = await outreachStorage.updateLatestEmailEventByEmail(recipientEmail, newStatus);
            if (updatedEvent) {
              console.log(`Resend webhook: matched by recipient email ${recipientEmail} -> event ${updatedEvent.id}`);
            }
          }
        }

        if (!updatedEvent) {
          console.log(`Resend webhook: no matching email_event for resendId=${resendEmailId}, type=${type}`);
        } else {
          console.log(`Resend webhook: updated event ${updatedEvent.id} to status=${newStatus}`);
        }

        let leadId = data.tags?.find((t: any) => t.name === "leadId")?.value
          ?? updatedEvent?.leadId;

        if (!leadId) {
          const recipientEmail = Array.isArray(data.to) ? data.to[0] : data.to;
          if (recipientEmail) {
            const lead = await outreachStorage.findLeadByEmail(recipientEmail);
            if (lead) leadId = lead.id;
          }
        }

        if (leadId) {
          const lead = await outreachStorage.getLead(leadId);
          if (lead) {
            if (type === "email.opened" || type === "email.clicked") {
              if (!["engaged", "won", "converted", "bounced"].includes(lead.status)) {
                await outreachStorage.updateLead(leadId, { status: "engaged" });
              }
            }

            if (type === "email.bounced" || type === "email.complained") {
              await outreachStorage.updateLead(leadId, {
                status: "bounced",
                notes: `Email bounced on ${new Date().toISOString().split("T")[0]}`,
              });
              const enrollment = await outreachStorage.getEnrollmentByLead(leadId);
              if (enrollment && !enrollment.stoppedAt) {
                await outreachStorage.updateEnrollment(enrollment.id, {
                  stoppedAt: new Date(),
                  stopReason: type === "email.complained" ? "Recipient marked as spam" : "Email bounced",
                });
                await outreachStorage.skipQueuedJobsForLead(leadId);
              }
            }
          }
        }
      }

      res.json({ ok: true });
    } catch (error) {
      console.error("Resend webhook error:", error);
      res.status(500).json({ ok: false });
    }
  });

  app.get("/api/outreach/agent-chat", isAuthenticated, async (_req, res) => {
    try {
      const messages = await outreachStorage.getChatMessages(100);
      res.json(messages.reverse());
    } catch (error) {
      console.error("Error fetching chat:", error);
      res.status(500).json({ message: "Failed to fetch chat" });
    }
  });

  app.post("/api/outreach/agent-chat", isAuthenticated, async (req, res) => {
    try {
      const { message } = req.body;
      if (!message || typeof message !== "string") {
        return res.status(400).json({ message: "Message is required" });
      }

      await outreachStorage.createChatMessage({ role: "admin", content: message });

      const [leadsSummary, insights, settings, recentConvos, stats, searchedLeads] = await Promise.all([
        outreachStorage.getLeadsSummary(),
        outreachStorage.getRecentInsights(10),
        outreachStorage.getSettings(),
        outreachStorage.getAllConversations(30),
        outreachStorage.getConversationStats(),
        outreachStorage.searchLeads(message),
      ]);

      const chatHistory = await outreachStorage.getChatMessages(20);
      const historyForAI = chatHistory.reverse().map(m => ({
        role: m.role === "admin" ? "user" as const : "assistant" as const,
        content: m.content,
      }));

      let searchedLeadDetails = "";
      if (searchedLeads.length > 0) {
        const topLeadIds = new Set(leadsSummary.topLeads.map((l: any) => l.id));
        const extraLeads = searchedLeads.filter((l: any) => !topLeadIds.has(l.id));
        
        const allMatchedLeads = [
          ...searchedLeads.filter((l: any) => topLeadIds.has(l.id)),
          ...extraLeads,
        ];

        const leadConvoPromises = allMatchedLeads.slice(0, 3).map(async (lead: any) => {
          const convos = await outreachStorage.getConversationsByLead(lead.id);
          const enrollment = await outreachStorage.getEnrollmentByLead(lead.id);
          return { lead, convos: convos.slice(0, 5), enrollment };
        });
        const leadDetails = await Promise.all(leadConvoPromises);
        
        searchedLeadDetails = `\n\nSPECIFIC LEADS MATCHING THIS QUERY (searched from full database):
${leadDetails.map(({ lead, convos, enrollment }: any) => {
  let detail = `\n--- ${lead.businessName} ---
ID: ${lead.id}
Website: ${lead.websiteUrl || "none"}
Contact: ${lead.contactName || "none"} | Email: ${lead.email || "none"} | Phone: ${lead.phone || "none"}
Industry: ${lead.industry || "unknown"} | Location: ${lead.location || "unknown"}
Status: ${lead.status} | AI Score: ${lead.aiScore || "not scored"}/100 | Est. Value: $${lead.valueEstimate || "unknown"}
Pitch Angle: ${lead.pitchAngle || "none"}
Opening Line: ${lead.openingLine || "none"}
AI Audit Summary: ${lead.aiAuditSummary || "none"}
Admin Notes: ${lead.notes || "none"}
Created: ${lead.createdAt}
Campaign Status: ${enrollment ? `Enrolled (step ${enrollment.currentStep}, ${enrollment.stopped ? "stopped: " + enrollment.stopReason : "active"})` : "Not enrolled"}`;
  if (convos.length > 0) {
    detail += `\nEmail Thread (${convos.length} messages):
${convos.map((c: any) => `  [${c.direction}] ${new Date(c.createdAt).toLocaleDateString()}: ${c.subject ? c.subject + " — " : ""}${c.body?.slice(0, 200)}`).join("\n")}`;
  } else {
    detail += "\nNo email conversations yet.";
  }
  return detail;
}).join("\n")}`;
      }

      const recentConvoSummary = recentConvos.slice(0, 10).map((c: any) => {
        const lead = leadsSummary.topLeads.find((l: any) => l.id === c.leadId);
        return `[${c.direction}] ${lead?.businessName || "Unknown"}: ${c.body?.slice(0, 100)}...`;
      }).join("\n");

      const insightsSummary = insights.slice(0, 5).map((i: any) => `- [${i.type}] ${i.insight}`).join("\n");

      const contextBlock = `CURRENT SYSTEM STATE:
Total leads: ${leadsSummary.total}
Lead statuses: ${JSON.stringify(leadsSummary.byStatus)}
Agent mode: ${settings.agentMode}
Daily send cap: ${settings.dailySendCap}
Send window: ${settings.sendWindowStart}:00 - ${settings.sendWindowEnd}:00 ${settings.timezone}
Total messages exchanged: ${stats.totalMessages} (${stats.inboundMessages} inbound, ${stats.outboundMessages} outbound)
AI-generated replies: ${stats.aiGeneratedMessages}

TOP LEADS (by AI score, ${leadsSummary.total} total in database):
${leadsSummary.topLeads.map((l: any) => `- ${l.businessName} (${l.industry || "?"}) | Score: ${l.aiScore || "?"}/100 | Value: $${l.valueEstimate || "?"} | Status: ${l.status} | Email: ${l.email || "none"} | Notes: ${l.notes || "none"}`).join("\n")}
${searchedLeadDetails}

RECENT INSIGHTS:
${insightsSummary || "No insights yet."}

RECENT CONVERSATIONS:
${recentConvoSummary || "No conversations yet."}`;

      const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

      const agentSystemPrompt = `You are the AI Outreach Agent for BlackRidge Platforms. You are having a direct conversation with Chris, the business owner and your boss. He manages you and gives you direction.

YOUR ROLE:
- You manage outbound lead prospecting, email campaigns, and prospect conversations
- You have full visibility into all leads, campaigns, conversations, and your own learning insights
- Chris can ask you questions, give you feedback, or request changes
- Be direct, professional, and conversational — like a top sales team member reporting to the CEO
- When Chris asks about specific leads, reference them by name and give real data from the SPECIFIC LEADS section below
- You can see ALL lead names in the database, and when Chris mentions a lead, the system searches and provides full details including email threads
- When he gives you feedback or instructions, acknowledge clearly and explain how you'll apply it
- Keep responses concise but thorough — no fluff
- If a lead name appears in the "SPECIFIC LEADS MATCHING THIS QUERY" section, use that detailed data — it was found specifically because Chris asked about it

WHAT YOU CAN DO:
- Answer questions about lead status, campaign performance, conversations
- Provide analysis and recommendations
- Explain your reasoning and approach
- Accept feedback and direction from Chris
- Suggest next steps or strategies
- EMAIL CHRIS directly when he asks you to send him something (a plan, summary, report, etc.)

EMAIL CAPABILITY:
When Chris asks you to email him something (e.g. "email me a plan", "send that to my inbox", "draft X and email it"), you MUST format your response using this EXACT structure:

EMAIL_ACTION_START
SUBJECT: [A clear, professional subject line]
BODY:
[The full email content here. Write it as a proper email — professional, well-structured, with paragraphs. Use plain text, no markdown. Address it to Chris. Sign off as "BlackRidge AI Agent".]
EMAIL_ACTION_END

After the EMAIL_ACTION block, add a brief chat confirmation like "Done — just sent that to your inbox." or similar.

IMPORTANT: Only use EMAIL_ACTION when Chris explicitly asks you to email/send something. For normal chat responses, just reply normally without EMAIL_ACTION tags.

WHAT YOU CANNOT DO (be honest about these):
- You cannot directly modify lead data or trigger campaign actions in this chat — those changes need to be made through the leads interface
- If Chris asks you to do something that requires a system action, clearly tell him what to do in the interface

TONE:
- Professional but personable — you're his trusted right hand
- Confident in your analysis, transparent about limitations
- Reference real lead names and numbers, not vague generalities

${contextBlock}`;

      const agentResponse = await anthropic.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 2000,
        system: agentSystemPrompt,
        messages: historyForAI.map((m: any) => ({ role: m.role as "user" | "assistant", content: m.content })),
      });

      let reply = extractClaudeText(agentResponse) || "I'm having trouble processing that right now. Can you try again?";

      const emailMatch = reply.match(/EMAIL_ACTION_START\s*\n\s*SUBJECT:\s*(.+?)\n\s*BODY:\s*\n?([\s\S]*?)\s*EMAIL_ACTION_END/);
      let emailSent = false;
      if (emailMatch) {
        const emailSubject = emailMatch[1].trim();
        const emailBody = emailMatch[2].trim();
        const chatText = reply.replace(/EMAIL_ACTION_START[\s\S]*?EMAIL_ACTION_END\s*/, "").trim();

        try {
          const { getResendClientForOutreach } = await import("./outreach-jobs");
          const resend = await getResendClientForOutreach();
          if (resend) {
            const htmlBody = emailBody.replace(/\n\n/g, "</p><p>").replace(/\n/g, "<br>");
            await resend.client.emails.send({
              from: resend.fromEmail,
              to: "chris@blackridgeplatforms.com",
              subject: emailSubject,
              html: `<div style="font-family: Arial, sans-serif; max-width: 700px; line-height: 1.7; color: #222;"><p>${htmlBody}</p></div>`,
            });
            emailSent = true;
          } else {
            console.log("Resend not configured — skipping agent email send");
          }
        } catch (err) {
          console.error("Failed to send agent email:", err);
        }

        if (emailSent) {
          reply = chatText || "Done — I just sent that to your inbox at chris@blackridgeplatforms.com.";
          if (!reply.toLowerCase().includes("sent") && !reply.toLowerCase().includes("inbox") && !reply.toLowerCase().includes("email")) {
            reply += "\n\nEmail sent to chris@blackridgeplatforms.com.";
          }
        } else {
          reply = `Here's what I drafted for you:\n\nSubject: ${emailSubject}\n\n${emailBody}\n\n---\n${chatText || ""}\n\n(Email delivery is not available right now — you can copy the above content.)`.trim();
        }
      }

      const agentMsg = await outreachStorage.createChatMessage({ role: "agent", content: reply });

      res.json(agentMsg);
    } catch (error) {
      console.error("Error in agent chat:", error);
      res.status(500).json({ message: "Failed to process message" });
    }
  });

  app.post("/api/outreach/leads/scan", isAuthenticated, async (req, res) => {
    try {
      const { businessType, location } = req.body;
      if (!businessType || !location) {
        return res.status(400).json({ message: "Business type and location are required" });
      }

      const apiKey = process.env.ANTHROPIC_API_KEY;
      if (!apiKey) {
        return res.status(500).json({ message: "Anthropic API key not configured" });
      }

      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });

      const send = (event: string, data: any) => {
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      };

      send("status", { message: `Searching for ${businessType} businesses in ${location}...`, phase: "searching" });

      const anthropic = new Anthropic({ apiKey });

      const response = await anthropic.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 6000,
        system: SCANNER_SYSTEM_PROMPT,
        messages: [{ role: "user", content: `Find ${businessType} businesses in ${location} with bad websites that need a redesign. Search the web, visit their actual websites, and evaluate them.` }],
        tools: [{ type: "web_search_20250305", name: "web_search" }],
      });

      const fullText = extractClaudeText(response);
      const match = fullText.match(/\[[\s\S]*\]/);
      const businesses: any[] = match ? JSON.parse(match[0]) : [];

      send("status", { message: `Found ${businesses.length} businesses with website issues. Creating leads...`, phase: "analyzing", total: businesses.length });

      let created = 0;
      let skipped = 0;
      let emailsFound = 0;

      for (let i = 0; i < businesses.length; i++) {
        const biz = businesses[i];
        try {
          const bizUrl = biz.website;
          if (!bizUrl) {
            send("result", { index: i, total: businesses.length, status: "skipped", reason: "No website URL", business: biz.company, url: "" });
            skipped++;
            continue;
          }

          const existing = await outreachStorage.findLeadByWebsite(bizUrl);
          if (existing) {
            send("result", { index: i, total: businesses.length, status: "skipped", reason: "Already in database", business: biz.company, url: bizUrl });
            skipped++;
            continue;
          }

          const score = Number(biz.score) || 5;
          const discoveredEmail = biz.email || null;
          const discoveredContactName = biz.owner_name || null;
          const leadStatus = discoveredEmail ? "new" : "needs_review";

          const noteLines = [`Auto-discovered via lead scanner. Website score: ${score}/10.`];
          if (discoveredEmail) {
            noteLines.push(`Email found via: web search`);
            emailsFound++;
          } else {
            noteLines.push("Email not found — requires manual research");
          }
          if (biz.pain_points?.length > 0) {
            noteLines.push(`Issues: ${biz.pain_points.join("; ")}`);
          }

          const lead = await outreachStorage.createLead({
            businessName: biz.company,
            websiteUrl: bizUrl,
            industry: biz.industry || businessType,
            location: biz.location || location,
            email: discoveredEmail,
            contactName: discoveredContactName,
            phone: biz.phone || null,
            notes: noteLines.join("\n"),
          });

          await outreachStorage.updateLead(lead.id, {
            status: leadStatus,
            aiScore: Math.max(1, Math.min(100, score * 10)),
            valueEstimate: 5000,
            pitchAngle: biz.opportunity || null,
            openingLine: biz.pain_points?.[0] || null,
            aiAuditSummary: biz.pain_points?.join(". ") || null,
            aiBullets: biz.pain_points || [],
          });

          await outreachStorage.createJob({
            type: "analyze_lead",
            payload: { lead_id: lead.id },
            runAt: new Date(Date.now() + 5000 + created * 2000),
          });

          send("result", {
            index: i,
            total: businesses.length,
            status: "created",
            business: biz.company,
            url: bizUrl,
            websiteScore: score,
            scoreReasons: biz.pain_points || [],
            pitchAngle: biz.opportunity,
            leadId: lead.id,
            emailFound: !!discoveredEmail,
            email: discoveredEmail || null,
            contactName: discoveredContactName || null,
            emailMethod: discoveredEmail ? "web-search" : "none",
          });
          created++;
        } catch (err: any) {
          console.error(`Error processing ${biz.company}:`, err);
          send("result", { index: i, total: businesses.length, status: "error", business: biz.company, url: biz.website, error: err.message });
        }
      }

      send("complete", { created, skipped, emailsFound, total: businesses.length });
      res.end();
    } catch (error: any) {
      console.error("Lead scan error:", error);
      if (!res.headersSent) {
        res.status(500).json({ message: "Failed to scan for leads" });
      } else {
        res.write(`event: error\ndata: ${JSON.stringify({ message: error.message })}\n\n`);
        res.end();
      }
    }
  });

  app.post("/api/outreach/leads/bad-site-scan", isAuthenticated, async (req, res) => {
    try {
      const { keyword, city, state, threshold = 60 } = req.body;
      if (!keyword || !city) {
        return res.status(400).json({ message: "keyword and city are required" });
      }

      const apiKey = process.env.ANTHROPIC_API_KEY;
      if (!apiKey) {
        return res.status(500).json({ message: "Anthropic API key not configured" });
      }

      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });

      const send = (event: string, data: any) => {
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      };

      const locationStr = state ? `${city}, ${state}` : city;
      send("status", { message: `Searching for "${keyword}" businesses in ${locationStr}...`, phase: "searching" });

      const anthropic = new Anthropic({ apiKey });

      const response = await anthropic.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 6000,
        system: SCANNER_SYSTEM_PROMPT,
        messages: [{ role: "user", content: `Find ${keyword} businesses in ${locationStr} with bad websites that need a redesign. Search the web, visit their actual websites, and evaluate them thoroughly.` }],
        tools: [{ type: "web_search_20250305", name: "web_search" }],
      });

      const fullText = extractClaudeText(response);
      const match = fullText.match(/\[[\s\S]*\]/);
      const businesses: any[] = match ? JSON.parse(match[0]) : [];

      send("status", { message: `Found ${businesses.length} businesses. Scoring...`, phase: "analyzing", total: businesses.length });

      const results: any[] = [];

      for (let i = 0; i < businesses.length; i++) {
        const biz = businesses[i];
        try {
          const score = Number(biz.score) || 5;
          const badSiteScore = Math.max(0, Math.min(100, score * 10));
          const redesignWorthy = badSiteScore >= (threshold || 60);

          const resultData = {
            index: i,
            total: businesses.length,
            status: "analyzed",
            businessName: biz.company || "Unknown",
            url: biz.website || "",
            badSiteScore,
            redesignWorthy,
            topProblems: biz.pain_points || [],
            visualStyleAssessment: biz.pain_points?.join(". ") || "",
            conversionAssessment: biz.opportunity || "",
            pitchAngle: biz.opportunity || "",
            openingLine: biz.pain_points?.[0] || "",
            contactName: biz.owner_name || null,
            phone: biz.phone || null,
            ruleCheckResults: null,
          };

          results.push(resultData);
          send("result", resultData);
        } catch (err: any) {
          console.error(`Error processing ${biz.company}:`, err);
          send("result", { index: i, total: businesses.length, status: "error", businessName: biz.company, url: biz.website, error: err.message });
        }
      }

      send("complete", { total: businesses.length, analyzed: results.length, aboveThreshold: results.filter(r => r.badSiteScore >= threshold).length });
      res.end();
    } catch (error: any) {
      console.error("Bad site scan error:", error);
      if (!res.headersSent) {
        res.status(500).json({ message: "Failed to scan for bad websites" });
      } else {
        res.write(`event: error\ndata: ${JSON.stringify({ message: error.message })}\n\n`);
        res.end();
      }
    }
  });

  app.post("/api/outreach/leads/bad-site-import", isAuthenticated, async (req, res) => {
    try {
      const { leads: leadsToImport, threshold = 60 } = req.body;
      if (!Array.isArray(leadsToImport) || leadsToImport.length === 0) {
        return res.status(400).json({ message: "No leads provided" });
      }

      const LEAD_ENRICHMENT_PROMPT = `You are a lead research specialist for BlackRidge Platforms. Given a business website URL, find and return all available contact and business information.

Search the website and any publicly available sources to find:
- Owner or decision maker name
- Direct email address
- Phone number
- Physical address
- Industry/niche
- Number of employees if findable
- LinkedIn profile of owner if findable
- Any signals about their current tech stack (what platform their site is on)

Return ONLY valid JSON:
{
  "owner_name": "name or null",
  "email": "email or null",
  "phone": "phone or null",
  "address": "address or null",
  "industry": "specific industry niche",
  "employee_count": "estimate or null",
  "linkedin": "url or null",
  "tech_stack": "WordPress/Wix/Squarespace/Custom/Unknown"
}`;

      const discoverEmailForImport = async (bizUrl: string, businessName: string): Promise<{ email: string | null; contactName: string | null; method: string }> => {
        const apiKey = process.env.ANTHROPIC_API_KEY;
        if (!apiKey) return { email: null, contactName: null, method: "none" };

        try {
          const anthropic = new Anthropic({ apiKey });
          const enrichResponse = await anthropic.messages.create({
            model: "claude-sonnet-4-6",
            max_tokens: 2000,
            system: LEAD_ENRICHMENT_PROMPT,
            messages: [{ role: "user", content: `Find contact information for "${businessName}" at ${bizUrl}` }],
            tools: [{ type: "web_search_20250305", name: "web_search" }],
          });

          const enrichText = extractClaudeText(enrichResponse);
          const jsonMatch = enrichText.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            const data = JSON.parse(jsonMatch[0]);
            const email = data.email && data.email !== "null" ? data.email : null;
            const contactName = data.owner_name && data.owner_name !== "null" ? data.owner_name : null;
            return { email, contactName, method: email ? "ai-web-search" : "none" };
          }
        } catch (err) {
          console.error(`Email discovery failed for ${businessName}:`, err);
        }

        let domain: string;
        try {
          domain = new URL(bizUrl.startsWith("http") ? bizUrl : `https://${bizUrl}`).hostname.replace(/^www\./, "");
        } catch {
          return { email: null, contactName: null, method: "none" };
        }
        return { email: `info@${domain}`, contactName: null, method: "pattern (info@)" };
      };

      let created = 0;
      let skipped = 0;
      const errors: string[] = [];

      for (const leadData of leadsToImport) {
        try {
          if ((leadData.badSiteScore ?? 0) < threshold) {
            skipped++;
            continue;
          }

          const bizName = leadData.businessName || leadData.business || "Unknown";
          const existing = await outreachStorage.findLeadByWebsite(leadData.url);
          if (existing) {
            skipped++;
            errors.push(`${bizName}: Already exists in database`);
            continue;
          }

          const emailResult = await discoverEmailForImport(leadData.url, bizName);
          const discoveredEmail = emailResult.email;
          const leadStatus = discoveredEmail ? "new" : "needs_review";

          const noteLines = [`Bad Website Finder scan. Bad Site Score: ${leadData.badSiteScore}/100.`];
          if (discoveredEmail) {
            noteLines.push(`Email found via: ${emailResult.method}`);
          } else {
            noteLines.push("Email not found — requires manual research");
          }
          if (leadData.topProblems?.length > 0) {
            noteLines.push(`Top problems: ${leadData.topProblems.join("; ")}`);
          }

          const lead = await outreachStorage.createLead({
            businessName: bizName,
            websiteUrl: leadData.url,
            industry: null,
            location: null,
            email: discoveredEmail,
            contactName: leadData.contactName || emailResult.contactName || null,
            phone: leadData.phone || null,
            notes: noteLines.join("\n"),
          });

          await outreachStorage.updateLead(lead.id, {
            status: leadStatus,
            badSiteScore: leadData.badSiteScore,
            redesignWorthy: leadData.redesignWorthy ?? false,
            topProblems: leadData.topProblems || [],
            visualStyleAssessment: leadData.visualStyleAssessment || null,
            conversionAssessment: leadData.conversionAssessment || null,
            sourceType: "bad_site_finder",
            ruleCheckResults: leadData.ruleCheckResults || null,
            pitchAngle: leadData.pitchAngle || null,
            openingLine: leadData.openingLine || null,
          });

          await outreachStorage.createJob({
            type: "analyze_lead",
            payload: { lead_id: lead.id },
            runAt: new Date(),
          });

          const settings = await outreachStorage.getSettings();
          if (!settings.enrollmentsPaused && discoveredEmail) {
            const campaign = await outreachStorage.getActiveCampaign();
            if (campaign) {
              const enrollment = await outreachStorage.createEnrollment(lead.id, campaign.id);
              await outreachStorage.createJob({
                type: "send_campaign_step",
                payload: {
                  lead_id: lead.id,
                  enrollment_id: enrollment.id,
                  campaign_id: campaign.id,
                  step_number: 1,
                },
                runAt: new Date(Date.now() + 5000 + created * 2000),
              });
            }
          }

          created++;
        } catch (err: any) {
          skipped++;
          errors.push(`${leadData.business || "Unknown"}: ${err.message}`);
        }
      }

      res.json({ created, skipped, errors });
    } catch (error) {
      console.error("Bad site import error:", error);
      res.status(500).json({ message: "Failed to import leads" });
    }
  });

  app.get("/api/outreach/audits", isAuthenticated, async (req, res) => {
    try {
      const { websiteAuditStorage } = await import("./website-audit-storage");
      const audits = await websiteAuditStorage.listWebsiteAudits();
      res.json(audits);
    } catch (err: any) {
      console.error("List audits error:", err);
      res.status(500).json({ message: err.message || "Failed to list audits" });
    }
  });

  app.post("/api/outreach/audits/:id/import", isAuthenticated, async (req, res) => {
    try {
      const { websiteAuditStorage } = await import("./website-audit-storage");
      const lead = await websiteAuditStorage.importAuditToLead(req.params.id);
      if (!lead) {
        return res.status(400).json({ message: "Audit not found or already imported" });
      }
      res.json({ lead });
    } catch (err: any) {
      console.error("Import audit error:", err);
      res.status(500).json({ message: err.message || "Failed to import audit" });
    }
  });

  app.post("/api/outreach/audits/:id/reject", isAuthenticated, async (req, res) => {
    try {
      const { websiteAuditStorage } = await import("./website-audit-storage");
      const audit = await websiteAuditStorage.rejectAudit(req.params.id);
      if (!audit) {
        return res.status(404).json({ message: "Audit not found" });
      }
      res.json({ audit });
    } catch (err: any) {
      console.error("Reject audit error:", err);
      res.status(500).json({ message: err.message || "Failed to reject audit" });
    }
  });

  app.post("/api/outreach/audits/bulk-import", isAuthenticated, async (req, res) => {
    try {
      const { ids } = req.body;
      if (!Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ message: "No audit IDs provided" });
      }
      const { websiteAuditStorage } = await import("./website-audit-storage");
      let imported = 0;
      let skipped = 0;
      for (const id of ids) {
        const lead = await websiteAuditStorage.importAuditToLead(id);
        if (lead) imported++;
        else skipped++;
      }
      res.json({ imported, skipped, total: ids.length });
    } catch (err: any) {
      console.error("Bulk import error:", err);
      res.status(500).json({ message: err.message || "Bulk import failed" });
    }
  });

  app.post("/api/outreach/audits/bulk-reject", isAuthenticated, async (req, res) => {
    try {
      const { ids } = req.body;
      if (!Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ message: "No audit IDs provided" });
      }
      const { websiteAuditStorage } = await import("./website-audit-storage");
      let rejected = 0;
      for (const id of ids) {
        const audit = await websiteAuditStorage.rejectAudit(id);
        if (audit) rejected++;
      }
      res.json({ rejected, total: ids.length });
    } catch (err: any) {
      console.error("Bulk reject error:", err);
      res.status(500).json({ message: err.message || "Bulk reject failed" });
    }
  });

  app.post("/api/outreach/audits/run", isAuthenticated, async (req, res) => {
    try {
      const { businessName, websiteUrl, industry, city, phone } = req.body;
      if (!businessName || !websiteUrl) {
        return res.status(400).json({ message: "businessName and websiteUrl are required" });
      }
      const { runWebsiteAudit } = await import("./website-audit-pipeline");
      const result = await runWebsiteAudit({ businessName, websiteUrl, industry, city, phone });
      res.json(result);
    } catch (err: any) {
      console.error("Audit run error:", err);
      res.status(500).json({ message: err.message || "Audit failed" });
    }
  });

  seedCampaignA().catch(console.error);
  startJobRunner();
}
