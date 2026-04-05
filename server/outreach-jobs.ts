import Anthropic from "@anthropic-ai/sdk";
import { Resend } from "resend";
import { outreachStorage } from "./outreach-storage";

const STOP_STATUSES = ["replied", "converted", "unsubscribed", "bounced"];

function cleanBusinessName(raw: string): string {
  if (!raw) return "your business";
  let name = raw.split("|")[0].trim();
  name = name.split(" - ")[0].trim();
  name = name.split(",")[0].trim();
  name = name.replace(/\s{2,}/g, " ").trim();
  return name || "your business";
}

function getGreetingName(lead: any): string {
  if (lead.contactName) {
    const firstName = lead.contactName.trim().split(/\s+/)[0];
    if (firstName) return firstName;
  }
  return cleanBusinessName(lead.businessName);
}

function getDomain(url: string): string {
  if (!url) return "";
  try {
    const u = new URL(url.startsWith("http") ? url : `https://${url}`);
    return u.hostname.replace(/^www\./, "");
  } catch {
    return url.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0];
  }
}

function renderTemplate(template: string, lead: any): string {
  const cleanName = cleanBusinessName(lead.businessName);
  const greeting = getGreetingName(lead);
  const firstName = lead.contactName ? lead.contactName.trim().split(/\s+/)[0] : "there";
  const domain = getDomain(lead.websiteUrl || "");
  return template
    .replace(/\{\{business_name\}\}/g, cleanName)
    .replace(/\{\{business_domain\}\}/g, domain)
    .replace(/\{\{first_name\}\}/g, firstName)
    .replace(/\{\{website_url\}\}/g, lead.websiteUrl || "")
    .replace(/\{\{contact_name\}\}/g, lead.contactName || "")
    .replace(/\{\{contact_name_or_there\}\}/g, greeting)
    .replace(/\{\{greeting\}\}/g, greeting)
    .replace(/\{\{email\}\}/g, lead.email || "")
    .replace(/\{\{industry\}\}/g, lead.industry || "your industry")
    .replace(/\{\{opening_line\}\}/g, lead.openingLine || "")
    .replace(/\{\{pitch_angle\}\}/g, lead.pitchAngle || "")
    .replace(/\{\{ai_audit_summary\}\}/g, lead.aiAuditSummary || "")
    .replace(/\{\{ai_bullets_1\}\}/g, lead.aiBullets?.[0] || "")
    .replace(/\{\{ai_bullets_2\}\}/g, lead.aiBullets?.[1] || "")
    .replace(/\{\{ai_bullets_3\}\}/g, lead.aiBullets?.[2] || "");
}

// Resend integration via Replit connector (tokens expire — never cache)
export async function getResendClientForOutreach(): Promise<{ client: Resend; fromEmail: string } | null> {
  try {
    const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
    const xReplitToken = process.env.REPL_IDENTITY
      ? "repl " + process.env.REPL_IDENTITY
      : process.env.WEB_REPL_RENEWAL
        ? "depl " + process.env.WEB_REPL_RENEWAL
        : null;

    if (!hostname || !xReplitToken) {
      // Fallback to env var for local/manual config
      const apiKey = process.env.RESEND_API_KEY;
      if (!apiKey) return null;
      return {
        client: new Resend(apiKey),
        fromEmail: process.env.RESEND_FROM_EMAIL || "chris@blackridgeplatforms.com",
      };
    }

    const connRes = await fetch(
      `https://${hostname}/api/v2/connection?include_secrets=true&connector_names=resend`,
      { headers: { Accept: "application/json", X_REPLIT_TOKEN: xReplitToken } }
    );
    const connData = await connRes.json();
    const settings = connData.items?.[0]?.settings;
    if (!settings?.api_key) return null;

    return {
      client: new Resend(settings.api_key),
      fromEmail: settings.from_email || "chris@blackridgeplatforms.com",
    };
  } catch (err) {
    console.error("Failed to get Resend client:", err);
    return null;
  }
}

function isWithinSendWindow(settings: { sendWindowStart: string; sendWindowEnd: string; timezone: string }): boolean {
  const now = new Date();
  const formatter = new Intl.DateTimeFormat("en-US", { timeZone: settings.timezone, hour: "2-digit", minute: "2-digit", hour12: false });
  const parts = formatter.formatToParts(now);
  const h = parseInt(parts.find(p => p.type === "hour")!.value);
  const m = parseInt(parts.find(p => p.type === "minute")!.value);
  const nowMin = h * 60 + m;

  const [sh, sm] = settings.sendWindowStart.split(":").map(Number);
  const [eh, em] = settings.sendWindowEnd.split(":").map(Number);
  const startMin = sh * 60 + sm;
  const endMin = eh * 60 + em;

  if (startMin <= endMin) {
    return nowMin >= startMin && nowMin < endMin;
  }
  return nowMin >= startMin || nowMin < endMin;
}

function getNextWindowStart(settings: { sendWindowStart: string; sendWindowEnd: string; timezone: string }): Date {
  const [sh, sm] = settings.sendWindowStart.split(":").map(Number);
  const now = new Date();
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: settings.timezone,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  });
  const parts = formatter.formatToParts(now);
  const get = (t: string) => parts.find(p => p.type === t)!.value;
  const tzNow = new Date(`${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}:00`);
  const target = new Date(tzNow);
  target.setHours(sh, sm, 0, 0);
  if (target <= tzNow) target.setDate(target.getDate() + 1);
  const diff = target.getTime() - tzNow.getTime();
  const jitter = randomJitterMs();
  const minutesToWait = Math.max(1, (diff + jitter) / 60000);
  return new Date(Date.now() + minutesToWait * 60 * 1000);
}

function randomJitterMs(): number {
  return (2 + Math.random() * 10) * 60 * 1000;
}

export async function processAnalyzeLeadJob(payload: { lead_id: string }) {
  const lead = await outreachStorage.getLead(payload.lead_id);
  if (!lead) throw new Error(`Lead ${payload.lead_id} not found`);

  const needsContactResearch = !lead.email || !lead.contactName;

  function safeHostname(url: string): string {
    try {
      return new URL(url.startsWith("http") ? url : "https://" + url).hostname;
    } catch {
      return url.replace(/^https?:\/\//, "").split("/")[0];
    }
  }

  const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  try {
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const hostname = safeHostname(lead.websiteUrl);
    const contactResearchBlock = needsContactResearch
      ? `
IMPORTANT: This lead is missing contact information. Research the business website and use your knowledge to find or infer:
- The business contact email (look for common patterns like info@domain, contact@domain, or any email visible on the site)
- A contact person name (owner, manager, or primary contact)
- Phone number if available
- The business industry if not provided
- The business location/city if not provided

If you cannot determine the exact email, try common patterns like:
- info@${hostname}
- contact@${hostname}
Only include an email if you have reasonable confidence it's valid. Set to null if you truly cannot determine one.
`
      : "";

    const contactFields = needsContactResearch
      ? `
  "discovered_email": "<email address or null if not found>",
  "discovered_contact_name": "<contact person name or null>",
  "discovered_phone": "<phone number or null>",
  "discovered_industry": "<industry or null>",
  "discovered_location": "<city, state or null>",`
      : "";

    const prompt = `Analyze this business and their website. Research them using the web to find contact information and evaluate their digital presence.
${contactResearchBlock}
Business: ${lead.businessName}
Website: ${lead.websiteUrl}
Industry: ${lead.industry || "Unknown"}
Contact Name: ${lead.contactName || "Unknown"}
Email: ${lead.email || "Unknown"}
Phone: ${lead.phone || "Unknown"}
Internal Notes: ${lead.notes || "None"}

Return ONLY valid JSON matching this exact structure:
{${contactFields}
  "opening_line": "1 sentence showing you researched them specifically — then pivot to what their business could look like with a better digital presence. Do NOT criticize. Do NOT say their site is bad.",
  "ai_audit_summary": "2-3 sentences of internal notes for the sales team (not sent to the lead). List specific issues found. Be direct and factual for internal reference only.",
  "pitch_angle": "One sentence about the biggest opportunity — results first, features second. No generic buzzwords.",
  "ai_score": <number 1-100 representing lead quality/likelihood to convert>,
  "value_estimate": <integer dollar estimate for a potential project>,
  "ai_bullets": ["specific issue 1", "specific issue 2", "specific issue 3"]
}`;

    const systemPrompt = `You are writing cold outreach emails on behalf of Chris Gee, Founder of BlackRidge Platforms.

WHO CHRIS IS:
Former law enforcement turned tech entrepreneur. He builds what he wished he could buy: high-end websites with real backend systems — CRM, project management, client portals, accounting. Not a big agency. Not a freelancer. A builder who takes full ownership of every client's digital infrastructure.

BLACKRIDGE BUILDS:
- High-end custom websites (not templates, not Wix, not WordPress)
- Client portals and dashboards
- Custom CRM systems tailored to the business
- Project management tools
- Accounting and invoicing systems
- Full turnkey business operations platforms

CHRIS'S VOICE:
- Direct. Confident. Not corporate. Not stiff.
- Short sentences. No filler.
- Leads with the prospect's pain, not his pitch.
- Treats the prospect like a peer, not a customer.
- Never uses: "I hope this finds you well", "I wanted to reach out", "leverage", "synergy", "solutions", "value proposition"

For opening_line: One sentence showing he researched them specifically. Slightly provocative but professional.
For ai_audit_summary: Internal notes only (not sent to the lead). Call out what's broken — specific.
For pitch_angle: Paint what their business could look like. Results first, features second.

Return only valid JSON.`;

    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 4000,
      system: systemPrompt,
      messages: [{ role: "user", content: prompt }],
      tools: [{ type: "web_search_20250305", name: "web_search" }],
    });

    const rawText = response.content
      .filter((b): b is { type: "text"; text: string } => b.type === "text")
      .map(b => b.text)
      .join("");
    const raw = rawText.replace(/```(?:json)?\s*/g, "").replace(/```/g, "").trim();
    const analysis = JSON.parse(raw);

    const updateData: Record<string, any> = {
      openingLine: analysis.opening_line || `I noticed a few things we could do to help boost your traffic and turn more visitors into customers.`,
      aiAuditSummary: analysis.ai_audit_summary || "Website review pending. Manual audit recommended.",
      pitchAngle: analysis.pitch_angle || `A few small changes could help drive more calls and walk-ins within the first few weeks.`,
      aiScore: typeof analysis.ai_score === "number" ? analysis.ai_score : 50,
      valueEstimate: typeof analysis.value_estimate === "number" ? analysis.value_estimate : 5000,
      aiBullets: Array.isArray(analysis.ai_bullets) && analysis.ai_bullets.length === 3
        ? analysis.ai_bullets
        : ["No phone number visible above the fold", "No Google reviews or social proof on the site", "Contact form is hard to find"],
    };

    if (needsContactResearch) {
      if (analysis.discovered_email && !lead.email && typeof analysis.discovered_email === "string" && EMAIL_REGEX.test(analysis.discovered_email.trim())) {
        updateData.email = analysis.discovered_email.trim().toLowerCase();
        console.log(`AI discovered email for ${lead.businessName}: ${updateData.email}`);
      }
      if (analysis.discovered_contact_name && !lead.contactName) {
        updateData.contactName = analysis.discovered_contact_name;
      }
      if (analysis.discovered_phone && !lead.phone) {
        updateData.phone = analysis.discovered_phone;
      }
      if (analysis.discovered_industry && !lead.industry) {
        updateData.industry = analysis.discovered_industry;
      }
      if (analysis.discovered_location && !lead.location) {
        updateData.location = analysis.discovered_location;
      }
    }

    await outreachStorage.updateLead(lead.id, updateData);

    if (updateData.email && !lead.email) {
      const settings = await outreachStorage.getSettings();
      if (!settings.enrollmentsPaused) {
        const campaign = await outreachStorage.getActiveCampaign();
        if (campaign) {
          const existingEnrollment = await outreachStorage.getEnrollmentByLead(lead.id);
          if (!existingEnrollment) {
            const enrollment = await outreachStorage.createEnrollment(lead.id, campaign.id);
            await outreachStorage.createJob({
              type: "send_campaign_step",
              payload: {
                lead_id: lead.id,
                enrollment_id: enrollment.id,
                campaign_id: campaign.id,
                step_number: 1,
              },
              runAt: new Date(Date.now() + 10000),
            });
            console.log(`Auto-enrolled ${lead.businessName} in campaign after AI discovered email`);
          }
        }
      }
    }

    console.log(`AI analysis complete for lead: ${lead.businessName}`);
  } catch (error) {
    console.error(`AI analysis failed for lead ${lead.id}:`, error);
    await outreachStorage.updateLead(lead.id, {
      openingLine: `I noticed a few things we could do to help boost your traffic and turn more visitors into customers.`,
      aiAuditSummary: "Automated analysis unavailable. Manual review recommended.",
      pitchAngle: `A few small changes could help drive more calls and walk-ins within the first few weeks.`,
      aiScore: 50,
      valueEstimate: 5000,
      aiBullets: [
        "No phone number visible above the fold",
        "No Google reviews or social proof on the site",
        "Contact form is hard to find",
      ],
    });
  }
}

export async function processSendCampaignStepJob(payload: {
  lead_id: string; enrollment_id: string; campaign_id: string; step_number: number;
}): Promise<"sent" | "rescheduled" | "skipped"> {
  const lead = await outreachStorage.getLead(payload.lead_id);
  if (!lead) throw new Error(`Lead ${payload.lead_id} not found`);

  if (!lead.email) {
    console.log(`Skipping email for lead ${lead.id}: no email address`);
    return "skipped";
  }

  if (STOP_STATUSES.includes(lead.status)) {
    console.log(`Skipping email for lead ${lead.id}: status is ${lead.status}`);
    return "skipped";
  }

  const enrollment = await outreachStorage.getEnrollment(payload.enrollment_id);
  if (!enrollment) {
    console.log(`Skipping email for lead ${lead.id}: enrollment not found`);
    return "skipped";
  }
  if (enrollment.stoppedAt) {
    console.log(`Skipping email for lead ${lead.id}: enrollment stopped`);
    return "skipped";
  }

  const settings = await outreachStorage.getSettings();

  if (!isWithinSendWindow(settings)) {
    const nextWindow = getNextWindowStart(settings);
    console.log(`Outside send window - rescheduling to ${nextWindow.toISOString()}`);
    return "rescheduled";
  }

  const sentToday = await outreachStorage.getEmailsSentToday(settings.timezone);
  if (sentToday >= settings.dailySendCap) {
    const nextWindow = getNextWindowStart(settings);
    console.log(`Daily cap reached (${sentToday}/${settings.dailySendCap}) - rescheduling to ${nextWindow.toISOString()}`);
    return "rescheduled";
  }

  const step = await outreachStorage.getCampaignStep(payload.campaign_id, payload.step_number);
  if (!step) throw new Error(`Campaign step ${payload.step_number} not found`);

  const subjectOptions = step.templateSubject.split("||").map(s => s.trim());
  const rawSubject = subjectOptions[Math.floor(Math.random() * subjectOptions.length)];
  const subject = renderTemplate(rawSubject, lead);
  const body = renderTemplate(step.templateBody, lead);

  const htmlBody = body.replace(/\n/g, "<br>");

  let resendMessageId: string | undefined;
  let emailStatus = "queued";

  const resend = await getResendClientForOutreach();
  if (resend) {
    try {
      const emailPayload: any = {
        from: resend.fromEmail,
        to: lead.email!,
        subject,
        html: `<div style="font-family: Arial, sans-serif; max-width: 600px; line-height: 1.6;">${htmlBody}</div>`,
        tags: [
          { name: "leadId", value: lead.id },
          { name: "campaignId", value: payload.campaign_id },
        ],
      };
      if (settings.replyToAddress) {
        emailPayload.reply_to = settings.replyToAddress;
      }
      const result = await resend.client.emails.send(emailPayload);
      resendMessageId = (result as any)?.data?.id;
      emailStatus = "sent";
    } catch (err) {
      console.error(`Failed to send email to ${lead.email}:`, err);
      emailStatus = "failed";
    }
  } else {
    console.log(`Resend not configured - simulating email to ${lead.email}`);
    emailStatus = "sent";
  }

  await outreachStorage.createEmailEvent({
    leadId: lead.id,
    campaignId: payload.campaign_id,
    stepNumber: payload.step_number,
    resendMessageId,
    toEmail: lead.email!,
    subject,
    body,
    status: emailStatus,
    sentAt: new Date(),
  });

  await outreachStorage.createConversation({
    leadId: lead.id,
    direction: "outbound",
    subject,
    body,
    aiGenerated: false,
    resendMessageId,
    campaignStep: payload.step_number,
  });

  const thread = Array.isArray(lead.conversationThread) ? lead.conversationThread as any[] : [];
  thread.push({ role: "chris", subject, body, sentAt: new Date().toISOString() });
  await outreachStorage.updateLead(lead.id, { conversationThread: thread });

  await outreachStorage.updateEnrollment(enrollment.id, {
    currentStep: payload.step_number,
  });

  const allSteps = await outreachStorage.getCampaignSteps(payload.campaign_id);
  const nextStep = allSteps.find(s => s.stepNumber === payload.step_number + 1);
  if (nextStep) {
    const delayMs = nextStep.delayDays * 86400000 + randomJitterMs();
    await outreachStorage.createJob({
      type: "send_campaign_step",
      payload: {
        lead_id: lead.id,
        enrollment_id: enrollment.id,
        campaign_id: payload.campaign_id,
        step_number: nextStep.stepNumber,
      },
      runAt: new Date(Date.now() + delayMs),
    });
  } else {
    await outreachStorage.updateEnrollment(enrollment.id, {
      completedAt: new Date(),
    });
    const NON_NURTURE_STATUSES = ["replied", "converted", "unsubscribed", "bounced", "won", "engaged"];
    if (!NON_NURTURE_STATUSES.includes(lead.status)) {
      await outreachStorage.updateLead(lead.id, { status: "nurture" });
      console.log(`Campaign complete — lead ${lead.businessName} moved to nurture`);
    }
  }

  console.log(`Email step ${payload.step_number} ${emailStatus} to ${lead.email} (${lead.businessName})`);
  return emailStatus === "sent" ? "sent" : "skipped";
}

export async function runOutreachJobs() {
  const jobs = await outreachStorage.getQueuedJobs();
  if (jobs.length === 0) return;

  for (const job of jobs) {
    const picked = await outreachStorage.atomicPickupJob(job.id);
    if (!picked) continue;

    try {
      if (job.type === "analyze_lead") {
        await processAnalyzeLeadJob(job.payload as any);
      } else if (job.type === "generate_reply") {
        await processGenerateReplyJob(job.payload as any);
      } else if (job.type === "send_campaign_step") {
        const result = await processSendCampaignStepJob(job.payload as any);
        if (result === "rescheduled") {
          const settings = await outreachStorage.getSettings();
          const nextWindow = getNextWindowStart(settings);
          await outreachStorage.updateJob(job.id, {
            status: "queued",
            runAt: nextWindow,
          });
          continue;
        }
      }

      await outreachStorage.updateJob(job.id, { status: "completed" });
    } catch (error: any) {
      console.error(`Job ${job.id} failed:`, error);
      const maxAttempts = 3;
      if (job.retryCount + 1 >= maxAttempts) {
        await outreachStorage.updateJob(job.id, {
          status: "failed",
          error: error?.message || "Unknown error",
        });
      } else {
        const backoffMs = Math.pow(2, job.retryCount) * 60000 + randomJitterMs();
        await outreachStorage.updateJob(job.id, {
          status: "queued",
          retryCount: job.retryCount + 1,
          runAt: new Date(Date.now() + backoffMs),
          error: error?.message || "Unknown error",
        });
      }
    }
  }
}

const AUTO_REPLY_SYSTEM_PROMPT = `You are Chris Gee, Founder of BlackRidge Platforms in Edmond, Oklahoma.
You handle all email replies in first person as Chris. You are not an assistant. You are Chris.

BLACKRIDGE BUILDS: custom websites, client portals, CRM, project management, accounting, invoicing, AI tools — all built custom for that specific business. Not a template. Not WordPress. Not a platform someone else controls. The client owns what we build.

WHAT YOU NEVER BRING UP IN EMAIL:
- Pricing, monthly fees, retainers, or cost of any kind
- Contracts or terms
- Timelines or how long a build takes
- Technical details about how it is built
Those conversations happen in a proposal. Never in email.

VOICE: Direct. Conversational. Short sentences. No em dashes. No filler words. Write like a real person not a marketer. First person as Chris. Match the energy and length of what the prospect wrote. If they wrote two sentences you write two or three sentences. Never write an essay.

GOAL: Move the conversation toward them saying yes to receiving a preview or proposal. That is the only goal. Once they say yes flag for handoff so Chris can take over and send the actual proposal.

HANDOFF TRIGGERS — set handoff to true when:
- They say yes to seeing a preview or proposal
- They ask to get on a call or schedule something
- They are clearly ready to move forward

HOW TO HANDLE EACH REPLY TYPE:

INTERESTED — excited or clearly want to know more
Reply with brief genuine energy. Ask one specific question about their business to make the proposal more targeted. End with confirming you will put something together for them.

QUESTION — asking how it works, what it includes, process questions
Answer directly in one or two sentences. Do not over explain. Redirect to the proposal as the place where they will see everything.
"I can lay all of that out in a quick preview if you want to take a look."

SOFT INTEREST — positive but not committing
Give them one specific thing about their business you noticed. Ask one question to keep them talking.

NOT NOW — too busy or bad timing
Completely respect it. Zero pushback. Ask if you can follow up in 30 days. That is it.

NOT INTERESTED — clear no
Thank them and mean it. Something like "Appreciate you taking the time to respond, most people do not. If anything changes you know where to find me." Leave the door open permanently. No guilt.

PRICE ASK — they ask what it costs
Never give a number. Say something like "Every build is different so I would rather understand what you actually need first. Let me put something quick together and you can tell me what you think."

Return ONLY valid JSON:
{
  "classification": "INTERESTED|QUESTION|SOFT_INTEREST|NOT_NOW|NOT_INTERESTED|PRICE_ASK",
  "reply": "reply body with \\n for line breaks",
  "handoff": true or false,
  "handoffReason": "why Chris needs to take over, or null",
  "pipelineStatus": "Contacted|Reply Received|Proposal Requested|Not Interested|Paused"
}`;

const PIPELINE_STATUS_MAP: Record<string, string> = {
  "Contacted": "enrolled",
  "Reply Received": "engaged",
  "Proposal Requested": "won",
  "Not Interested": "lost",
  "Paused": "nurture",
};

export async function processGenerateReplyJob(payload: { lead_id: string; inbound_conversation_id: string }) {
  const lead = await outreachStorage.getLead(payload.lead_id);
  if (!lead) throw new Error(`Lead ${payload.lead_id} not found`);
  if (!lead.email) throw new Error(`Lead ${payload.lead_id} has no email`);

  const settings = await outreachStorage.getSettings();

  if (settings.agentMode === "paused") {
    console.log(`Agent mode is paused - skipping reply for lead ${lead.id}`);
    return;
  }

  if (lead.autoReplyEnabled === false) {
    console.log(`Auto-reply disabled for ${lead.businessName} — skipping`);
    return;
  }

  if (lead.awaitingHandoff) {
    console.log(`Lead ${lead.businessName} awaiting handoff — skipping auto-reply`);
    return;
  }

  const conversations = await outreachStorage.getConversationsByLead(lead.id);

  const threadHistory = conversations.map(c => {
    const role = c.direction === "outbound" ? "CHRIS" : "PROSPECT";
    const timestamp = new Date(c.createdAt).toISOString();
    return `${role} (${timestamp}):\n${c.body}`;
  }).join("\n\n---\n\n");

  const latestInbound = conversations.find(c => c.id === payload.inbound_conversation_id);
  if (!latestInbound) throw new Error("Inbound conversation not found");

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const userPrompt = `Here is the full conversation so far:\n\n${threadHistory}\n\nNow handle the prospect's latest reply and write the next response.`;

  const replyResponse = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 4000,
    system: AUTO_REPLY_SYSTEM_PROMPT,
    messages: [{ role: "user", content: userPrompt }],
  });

  const replyRawText = replyResponse.content
    .filter((b): b is { type: "text"; text: string } => b.type === "text")
    .map(b => b.text)
    .join("");
  const replyRaw = replyRawText.replace(/```(?:json)?\s*/g, "").replace(/```/g, "").trim();
  const reply = JSON.parse(replyRaw);

  const replyBody = reply.reply || reply.body || "";
  const replySubject = reply.subject || `Re: ${latestInbound.subject || "Your website"}`;

  const mappedStatus = PIPELINE_STATUS_MAP[reply.pipelineStatus] || "engaged";

  if (reply.classification === "NOT_INTERESTED") {
    const enrollment = await outreachStorage.getEnrollmentByLead(lead.id);
    if (enrollment && !enrollment.stoppedAt) {
      await outreachStorage.updateEnrollment(enrollment.id, {
        stoppedAt: new Date(),
        stopReason: "Prospect not interested",
      });
      await outreachStorage.skipQueuedJobsForLead(lead.id);
    }
  }

  await outreachStorage.updateLead(lead.id, { status: mappedStatus });

  if (reply.handoff) {
    const thread = Array.isArray(lead.conversationThread) ? lead.conversationThread as any[] : [];
    thread.push({ role: "chris", subject: replySubject, body: replyBody, sentAt: new Date().toISOString() });
    await outreachStorage.updateLead(lead.id, {
      awaitingHandoff: true,
      autoReplyEnabled: false,
      handoffReason: reply.handoffReason || "Prospect ready for proposal",
      conversationThread: thread,
    });

    const { sendHandoffNotification } = await import("./outreach-routes");
    await sendHandoffNotification(lead, thread);
  }

  if (settings.agentMode === "draft") {
    await outreachStorage.createConversation({
      leadId: lead.id,
      direction: "outbound",
      subject: replySubject,
      body: replyBody,
      aiGenerated: true,
      sentiment: reply.classification?.toLowerCase() || "draft",
    });
    console.log(`Draft reply generated for ${lead.businessName} (draft mode)`);
    return;
  }

  const replyToMessageId = await outreachStorage.getLatestOutboundMessageId(lead.id);

  let resendMessageId: string | undefined;
  const resend = await getResendClientForOutreach();
  if (resend) {
    try {
      const htmlBody = replyBody.replace(/\n/g, "<br>");
      const emailPayload: any = {
        from: resend.fromEmail,
        to: lead.email,
        subject: replySubject,
        html: `<div style="font-family: Arial, sans-serif; max-width: 600px; line-height: 1.6;">${htmlBody}</div>`,
        tags: [
          { name: "leadId", value: lead.id },
        ],
      };
      if (settings.replyToAddress) {
        emailPayload.reply_to = settings.replyToAddress;
      }
      if (replyToMessageId) {
        emailPayload.headers = { "In-Reply-To": replyToMessageId };
      }
      const result = await resend.client.emails.send(emailPayload);
      resendMessageId = (result as any)?.data?.id;
    } catch (err) {
      console.error(`Failed to send reply to ${lead.email}:`, err);
      throw err;
    }
  } else {
    console.log(`Resend not configured - simulating reply to ${lead.email}`);
  }

  await outreachStorage.createConversation({
    leadId: lead.id,
    direction: "outbound",
    subject: replySubject,
    body: replyBody,
    aiGenerated: true,
    resendMessageId,
    inReplyToMessageId: latestInbound.resendMessageId ?? undefined,
    sentiment: reply.classification?.toLowerCase(),
  });

  if (!reply.handoff) {
    const updatedLead = await outreachStorage.getLead(lead.id);
    const thread = Array.isArray(updatedLead?.conversationThread) ? updatedLead.conversationThread as any[] : [];
    thread.push({ role: "chris", subject: replySubject, body: replyBody, sentAt: new Date().toISOString() });
    await outreachStorage.updateLead(lead.id, { conversationThread: thread });
  }

  console.log(`AI reply sent to ${lead.email} (${lead.businessName}) - classification: ${reply.classification}, handoff: ${reply.handoff}`);
}

export async function processDailyLearningJob() {
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const allLeads = await outreachStorage.getLeads();
  const leadsWithReplies = await outreachStorage.getAllLeadsWithReplies();

  const stats = {
    totalLeads: allLeads.length,
    leadsWithReplies: leadsWithReplies.length,
    engagedLeads: allLeads.filter(l => l.status === "engaged").length,
    wonLeads: allLeads.filter(l => l.status === "won").length,
    convertedLeads: allLeads.filter(l => l.status === "converted").length,
    lostLeads: allLeads.filter(l => l.status === "lost").length,
    topIndustries: Object.entries(
      allLeads.reduce((acc: Record<string, number>, l) => {
        if (l.industry) acc[l.industry] = (acc[l.industry] || 0) + 1;
        return acc;
      }, {})
    ).sort((a, b) => b[1] - a[1]).slice(0, 5),
    avgScore: allLeads.filter(l => l.aiScore).reduce((sum, l) => sum + (l.aiScore || 0), 0) / (allLeads.filter(l => l.aiScore).length || 1),
  };

  const repliedLeadDetails = await Promise.all(
    leadsWithReplies.slice(0, 20).map(async lead => {
      const convos = await outreachStorage.getConversationsByLead(lead.id);
      const inboundCount = convos.filter(c => c.direction === "inbound").length;
      const sentiments = convos.filter(c => c.sentiment).map(c => c.sentiment);
      return {
        business: lead.businessName,
        industry: lead.industry,
        score: lead.aiScore,
        status: lead.status,
        pitchAngle: lead.pitchAngle,
        inboundMessages: inboundCount,
        sentiments,
        notes: lead.notes || null,
      };
    })
  );

  const prompt = `You are analyzing outreach campaign performance for BlackRidge Platforms to identify patterns and improve future outreach.

CAMPAIGN METRICS:
${JSON.stringify(stats, null, 2)}

LEADS THAT REPLIED (sample):
${JSON.stringify(repliedLeadDetails, null, 2)}

Based on this data, provide 3-5 specific, actionable insights. Focus on:
1. Which industries or business types respond best
2. What pitch angles or messaging resonates most
3. Timing or approach patterns that work well
4. Any common traits of leads that convert vs those that don't

Return ONLY valid JSON:
{
  "insights": [
    {
      "type": "timing|messaging|targeting|approach|conversion",
      "insight": "Specific, actionable insight that can improve future outreach",
      "confidence": "high|medium|low"
    }
  ],
  "summary": "One paragraph summarizing the key learnings"
}`;

  try {
    const learningResponse = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 4000,
      system: "You are an expert sales analytics consultant. Analyze outreach data and provide specific, actionable insights. Return only valid JSON.",
      messages: [{ role: "user", content: prompt }],
    });

    const raw = learningResponse.content[0].type === "text" ? learningResponse.content[0].text : "{}";
    const result = JSON.parse(raw);

    if (result.insights && Array.isArray(result.insights)) {
      for (const ins of result.insights) {
        await outreachStorage.createInsight({
          type: ins.type || "general",
          insight: ins.insight,
          metrics: { confidence: ins.confidence, ...stats },
        });
      }
    }

    if (result.summary) {
      await outreachStorage.createInsight({
        type: "daily_summary",
        insight: result.summary,
        metrics: stats,
      });
    }

    console.log(`Daily learning job complete: ${result.insights?.length || 0} insights stored`);
  } catch (error) {
    console.error("Daily learning job failed:", error);
    throw error;
  }
}

export function startOutreachJobRunner() {
  console.log("Outreach job runner started (30s interval)");
  setInterval(() => {
    runOutreachJobs().catch(err => console.error("Outreach job runner error:", err));
  }, 30000);
  runOutreachJobs().catch(err => console.error("Initial outreach job run error:", err));

  scheduleDailyLearningJob();
}

function scheduleDailyLearningJob() {
  const runAt2am = () => {
    const now = new Date();
    const next = new Date(now);
    next.setHours(2, 0, 0, 0);
    if (next <= now) next.setDate(next.getDate() + 1);
    return next.getTime() - now.getTime();
  };

  const schedule = () => {
    const delay = runAt2am();
    setTimeout(async () => {
      try {
        await processDailyLearningJob();
      } catch (err) {
        console.error("Daily learning job error:", err);
      }
      schedule();
    }, delay);
  };

  schedule();
  console.log("Daily learning job scheduled for 2:00 AM");
}
