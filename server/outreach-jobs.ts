import Anthropic from "@anthropic-ai/sdk";
import { Resend } from "resend";
import { outreachStorage } from "./outreach-storage";
import { discoverAndVerifyEmail } from "./email-discovery";
import { stripDashes } from "./text-utils";

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

// Resend integration via RESEND_API_KEY env var.
// Kept async + locally-named so existing dynamic imports continue to work.
export async function getResendClientForOutreach(): Promise<{ client: Resend; fromEmail: string } | null> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return null;
  // Outreach campaigns are Travis's responsibility. The From header
  // shows his name so cold replies route to him, not to Chris.
  const address = process.env.TRAVIS_FROM_EMAIL
    || process.env.OUTREACH_FROM_EMAIL
    || "travis@blackridgeplatforms.com";
  const name = process.env.TRAVIS_FROM_NAME || "Travis at BlackRidge";
  return {
    client: new Resend(apiKey),
    fromEmail: `${name} <${address}>`,
  };
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
  if (!lead) {
    console.log(`Skipping analyze for missing lead ${payload.lead_id}`);
    return;
  }

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
      .map(b => (b.type === "text" ? b.text : ""))
      .join("");
    const cleaned = rawText.replace(/```(?:json)?\s*/g, "").replace(/```/g, "");
    // Claude sometimes prefixes the JSON with a paragraph of prose
    // ("All the research…", "Here is the analysis…", "Research customer…")
    // when it uses web_search. Extract the first balanced JSON object
    // instead of strict-parsing the whole response.
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error("Claude response had no JSON object");
    }
    const analysis = JSON.parse(jsonMatch[0]);

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

    // Three-stage email discovery: verify Claude's guess (if any),
    // scrape the site, then try Hunter.io. ZeroBounce verifies each
    // candidate. Replaces the old "trust whatever Claude said" path.
    if (!lead.email && lead.websiteUrl) {
      const claudeCandidate = typeof analysis.discovered_email === "string"
        && EMAIL_REGEX.test(analysis.discovered_email.trim())
          ? analysis.discovered_email.trim().toLowerCase()
          : null;
      const discovery = await discoverAndVerifyEmail({
        websiteUrl: lead.websiteUrl,
        businessName: lead.businessName,
        claudeEmail: claudeCandidate,
      });
      if (discovery.email) {
        updateData.email = discovery.email;
        updateData.status = discovery.verified === "valid" ? "new" : "needs_review";
        console.log(`Email discovery for ${lead.businessName}: ${discovery.email} (source=${discovery.source}, verified=${discovery.verified})`);
      } else {
        updateData.status = "email_invalid";
        console.log(`Email discovery failed for ${lead.businessName}: no deliverable address found`);
      }
    }

    await outreachStorage.updateLead(lead.id, updateData);

    // Only auto-enroll when we ended up with an email AND the
    // verifier didn't say "invalid". This is the gate that protects
    // sender reputation.
    const finalEmail = (updateData.email ?? lead.email) as string | undefined;
    const finalStatus = (updateData.status ?? lead.status) as string | undefined;
    if (finalEmail && finalStatus !== "email_invalid" && !lead.email) {
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
            console.log(`Auto-enrolled ${lead.businessName} in campaign after email discovery`);
          }
        }
      }
    }

    console.log(`AI analysis complete for lead: ${lead.businessName}`);
  } catch (error) {
    console.error(`AI analysis failed for lead ${lead.id}:`, error);
    const fallback: Record<string, any> = {
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
    };

    // Even when Claude's analysis crashed, still try to find an email
    // so the lead can be enrolled in the campaign instead of getting
    // stranded with no email forever.
    if (!lead.email && lead.websiteUrl) {
      try {
        const discovery = await discoverAndVerifyEmail({
          websiteUrl: lead.websiteUrl,
          businessName: lead.businessName,
        });
        if (discovery.email) {
          fallback.email = discovery.email;
          fallback.status = discovery.verified === "valid" ? "new" : "needs_review";
          console.log(`Email discovery (catch branch) for ${lead.businessName}: ${discovery.email} (source=${discovery.source}, verified=${discovery.verified})`);
        } else {
          fallback.status = "email_invalid";
          console.log(`Email discovery (catch branch) failed for ${lead.businessName}: no deliverable address found`);
        }
      } catch (discoveryErr) {
        console.error(`Catch-branch discovery failed for ${lead.businessName}:`, discoveryErr);
      }
    }

    await outreachStorage.updateLead(lead.id, fallback);

    if (fallback.email && fallback.status !== "email_invalid" && !lead.email) {
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
            console.log(`Auto-enrolled ${lead.businessName} from catch-branch discovery`);
          }
        }
      }
    }
  }
}

/**
 * Travis personalizes a cold-outreach campaign email body from the
 * lead's research. The campaign template is passed in as the baseline
 * — the model should use the same general structure (length, tone,
 * CTA) but rewrite specifics so the lead feels like a real person
 * read their situation. Returns null on parse failure; caller falls
 * back to the static template.
 */
async function personalizeCampaignEmail(opts: {
  lead: any;
  stepNumber: number;
  templateSubject: string;
  templateBody: string;
}): Promise<{ subject: string; body: string } | null> {
  const { lead, stepNumber, templateSubject, templateBody } = opts;
  const truncate = (s: string | null | undefined, n: number) =>
    (s ?? "").length > n ? (s ?? "").slice(0, n - 1) + "…" : (s ?? "");
  const researchLines: string[] = [];
  researchLines.push(`Business: ${lead.businessName}${lead.contactName ? ` (contact: ${lead.contactName})` : ""}`);
  if (lead.industry) researchLines.push(`Industry: ${lead.industry}`);
  if (lead.location) researchLines.push(`Location: ${lead.location}`);
  if (lead.websiteUrl) researchLines.push(`Website: ${lead.websiteUrl}`);
  if (lead.sourceType) researchLines.push(`Source: ${lead.sourceType}`);
  if (lead.notes) researchLines.push(`Notes for AI (Chris's): ${truncate(lead.notes, 1000)}`);
  if (lead.pitchAngle) researchLines.push(`Pitch angle: ${truncate(lead.pitchAngle, 400)}`);
  if (lead.openingLine) researchLines.push(`Suggested opening: ${truncate(lead.openingLine, 400)}`);
  if (lead.aiAuditSummary) researchLines.push(`Site audit: ${truncate(lead.aiAuditSummary, 800)}`);
  const tp = Array.isArray(lead.topProblems) ? (lead.topProblems as unknown[]) : [];
  if (tp.length > 0) researchLines.push(`Top problems on their site:\n${tp.slice(0, 5).map(p => `  - ${truncate(String(p), 240)}`).join("\n")}`);
  const ab = Array.isArray(lead.aiBullets) ? (lead.aiBullets as unknown[]) : [];
  if (ab.length > 0) researchLines.push(`Site bullets:\n${ab.slice(0, 5).map(b => `  - ${truncate(String(b), 240)}`).join("\n")}`);
  if (lead.visualStyleAssessment) researchLines.push(`Visual assessment: ${truncate(lead.visualStyleAssessment, 320)}`);
  if (lead.conversionAssessment) researchLines.push(`Conversion assessment: ${truncate(lead.conversionAssessment, 320)}`);
  const researchBlock = researchLines.join("\n");

  const system = `You are Travis, the cold-outreach lead at BlackRidge Platforms in Edmond, Oklahoma. You write personal first-touch outreach emails. You are NOT Chris and you are NOT a marketer.

Personalize this campaign email so the lead feels like a real person who actually looked at their business is writing. The template body is given to you as a structural baseline (length, tone, CTA structure) — you should rewrite the specifics so they tie to THIS lead's research, not the generic version.

USE THE RESEARCH SPECIFICALLY
Reference something concrete from the Notes for AI, the site audit, top problems, or pitch angle. Make at least one sentence feel like a real observation about THIS business. If the only research is a generic note, write a curiosity-driven opening instead of inventing details.

═══════════════════════════════════════════════════════════════
PHANTOM CLAIMS — NON-NEGOTIABLE
═══════════════════════════════════════════════════════════════
If the LEAD RESEARCH below does NOT include a "Site audit", "Top problems", "Visual assessment", "Conversion assessment", or "Site bullets" field, you have NOT looked at this prospect's website. Do not pretend you did. Specifically:
- Do NOT write "I came across [business] and spent a few minutes on your site"
- Do NOT write "I took a look at your site"
- Do NOT write "I noticed [anything] on your site"
- Do NOT reference any visual or content detail about their site
- Do NOT invent screenshots, page names, or hero images
- Do NOT pretend to have read their About page, services page, blog, or reviews

When there is no site research, open with one of:
(a) An honest "saw [business] on [source]" — only if Source is in the research
(b) A business or industry observation tied to "Notes for AI" or "Industry"
(c) A curiosity question about how they're handling something common to their industry
(d) A direct, non-deceptive intro: "I'm Travis at BlackRidge Platforms, we build [thing] for [industry]…"

ONLY when the research DOES contain a site audit / problems / visual / conversion field may you reference what's on their website — and even then, only reference things actually stated in the research. Don't extrapolate.

HARD RULE — NEVER OPEN BY BASHING THEIR SITE
Even when you DID look at the site (audit present), never start the email by telling the prospect their website is bad, broken, outdated, slow, hard to read, ugly, or any variation of "your site sucks." Your opening line is a business observation, a curiosity question, or a genuine point of connection. Improvements come up later — and only when wrapped in possibility, not criticism.

VOICE
Direct. Conversational. Contractions always. Short sentences. NO em dashes (—) and NO en dashes (–) — use commas or periods. No corporate filler. No "I hope this finds you well", no "leverage", no "synergy", no "value proposition", no "circle back".

LENGTH
Match the template's length within a paragraph or two. Cold outreach is short — three to five short paragraphs max.

SIGNATURE
End with exactly:
Travis
Outreach Lead
BlackRidge Platforms

OUTPUT
Return ONLY valid JSON. No prose before or after.
{
  "subject": "subject line — short, lowercase, no template variables",
  "body": "full email body with \\n for line breaks. Ends with the three-line signature."
}`;

  const userPrompt = `LEAD RESEARCH:
${researchBlock}

CAMPAIGN STEP: ${stepNumber}
TEMPLATE SUBJECT (use as structural baseline): ${templateSubject}
TEMPLATE BODY (use as structural baseline):
${templateBody}

Now write the personalized version for THIS lead.`;

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const resp = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 1200,
    system,
    messages: [{ role: "user", content: userPrompt }],
  });
  const raw = resp.content.map(b => (b.type === "text" ? b.text : "")).join("").trim();
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;
  const parsed = JSON.parse(jsonMatch[0]) as { subject?: string; body?: string };
  if (!parsed.subject || !parsed.body) return null;
  return { subject: parsed.subject.trim(), body: parsed.body.trim() };
}

export async function processSendCampaignStepJob(payload: {
  lead_id: string; enrollment_id: string; campaign_id: string; step_number: number;
}): Promise<"sent" | "rescheduled" | "skipped"> {
  const lead = await outreachStorage.getLead(payload.lead_id);
  if (!lead) {
    // Lead was deleted between enqueue and run. Treat as a no-op and let the
    // runner mark the job completed instead of retrying it three times and
    // then failing forever (root cause of the 50 "Lead ... not found"
    // failed jobs surfaced in the audit).
    console.log(`Skipping campaign step for missing lead ${payload.lead_id}`);
    return "skipped";
  }

  if (!lead.email) {
    console.log(`Skipping email for lead ${lead.id}: no email address`);
    return "skipped";
  }

  if (STOP_STATUSES.includes(lead.status)) {
    console.log(`Skipping email for lead ${lead.id}: status is ${lead.status}`);
    return "skipped";
  }

  // Cadence runs ONLY for bad_site_finder cold leads. Manually-added
  // leads, CRM-converts, etc. wait on Chris to direct Travis on what
  // to send and when. Defense in depth in case an enrollment slipped
  // through the gates in the create-lead routes.
  if (lead.sourceType !== "bad_site_finder") {
    console.log(`Skipping campaign step for ${lead.businessName}: sourceType=${lead.sourceType} (not a cold lead)`);
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

  // Step 1 needs Chris's approval before it goes out. Two gates:
  //   1. Notes for AI must be present — Travis can't draft a first
  //      email without research notes to base it on.
  //   2. Even with notes, the draft just sits as pending until Chris
  //      approves it via the outreach UI.
  // Steps 2+ continue to auto-send on cadence once the lead's been
  // confirmed once.
  if (payload.step_number === 1) {
    const anyLead = lead as any;
    if (anyLead.step1Status === "sent") {
      console.log(`Step 1 already sent for ${lead.businessName} — skipping`);
      return "skipped";
    }
    if (anyLead.step1Status === "drafted") {
      console.log(`Step 1 drafted but awaiting Chris's approval for ${lead.businessName} — re-queueing for tomorrow`);
      return "rescheduled";
    }
    const notes = (lead.notes ?? "").trim();
    if (notes.length < 8) {
      // No notes → don't draft. Flag the lead so it surfaces in the
      // pending-drafts UI as "needs notes" and push-notify Chris once.
      await outreachStorage.updateLead(lead.id, { step1Status: "needs_notes" });
      try {
        const { isPushConfigured, sendPushToAll } = await import("./push");
        if (isPushConfigured()) {
          await sendPushToAll({
            title: `${lead.businessName}: add Notes for AI`,
            body: `Travis needs your notes before he can draft the first email.`,
            url: "/admin/ops/outreach",
          });
        }
      } catch { /* */ }
      console.log(`Step 1 blocked for ${lead.businessName}: Notes for AI missing`);
      return "skipped";
    }
    // Generate the draft (will throw to fall back to template if AI
    // fails), store it, push-notify, but DO NOT SEND.
    try {
      const step = await outreachStorage.getCampaignStep(payload.campaign_id, payload.step_number);
      if (!step) throw new Error("Campaign step not found");
      const subjectOptions = step.templateSubject.split("||").map(s => s.trim());
      const rawSubject = subjectOptions[Math.floor(Math.random() * subjectOptions.length)];
      const templateSubject = renderTemplate(rawSubject, lead);
      const templateBody = renderTemplate(step.templateBody, lead);
      let subject = templateSubject;
      let body = templateBody;
      if (process.env.ANTHROPIC_API_KEY) {
        try {
          const personalized = await personalizeCampaignEmail({
            lead,
            stepNumber: 1,
            templateSubject,
            templateBody,
          });
          if (personalized?.subject && personalized?.body) {
            subject = personalized.subject;
            body = personalized.body;
          }
        } catch (err: any) {
          console.warn(`[outreach] step1 personalization failed for ${lead.businessName}: ${err?.message}`);
        }
      }
      subject = stripDashes(subject);
      body = stripDashes(body);
      await outreachStorage.updateLead(lead.id, {
        step1DraftSubject: subject,
        step1DraftBody: body,
        step1Status: "drafted",
        step1DraftedAt: new Date(),
      });
      try {
        const { isPushConfigured, sendPushToAll } = await import("./push");
        if (isPushConfigured()) {
          await sendPushToAll({
            title: `Approve email to ${lead.businessName}`,
            body: subject.slice(0, 120),
            url: "/admin/ops/outreach",
          });
        }
      } catch { /* */ }
      console.log(`Step 1 drafted for ${lead.businessName} — awaiting Chris's approval`);
      return "skipped";
    } catch (err: any) {
      console.error(`Step 1 drafting failed for ${lead.businessName}:`, err?.message);
      return "skipped";
    }
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
  let subject = renderTemplate(rawSubject, lead);
  let body = renderTemplate(step.templateBody, lead);

  // Travis personalizes the email from the lead's research instead of
  // shipping the bare template. Falls back to the template render
  // above if Claude errors or produces something obviously wrong. The
  // template stays as the inspiration / fallback baseline.
  const hasResearch = !!(lead.notes || lead.aiAuditSummary || lead.pitchAngle
    || (Array.isArray(lead.topProblems) && lead.topProblems.length > 0)
    || (Array.isArray(lead.aiBullets) && lead.aiBullets.length > 0));
  if (hasResearch && process.env.ANTHROPIC_API_KEY) {
    try {
      const personalized = await personalizeCampaignEmail({
        lead,
        stepNumber: payload.step_number,
        templateSubject: subject,
        templateBody: body,
      });
      if (personalized?.subject && personalized?.body) {
        subject = personalized.subject;
        body = personalized.body;
      }
    } catch (err: any) {
      console.warn(`[outreach] personalization failed for ${lead.businessName}, falling back to template: ${err?.message}`);
    }
  }

  // Strip em/en dashes regardless of source — template or Claude.
  subject = stripDashes(subject);
  body = stripDashes(body);

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
      } else if (job.type === "generate_jake_reply") {
        const { processJakeReplyJob } = await import("./jake");
        await processJakeReplyJob(job.payload as any);
      } else if (job.type === "generate_jake_checkin") {
        const { processJakeCheckinJob } = await import("./jake");
        await processJakeCheckinJob(job.payload as any);
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

const AUTO_REPLY_SYSTEM_PROMPT = `You are Travis, the cold-outreach lead at BlackRidge Platforms in Edmond, Oklahoma. You handle every inbound prospect reply in first person as Travis. You are NOT Chris and you are NOT pretending to be Chris. You're the rep who reached out to them under your own name.

BLACKRIDGE BUILDS: custom websites, client portals, CRM, project management, accounting, invoicing, AI tools — all built custom for that specific business. Not a template. Not WordPress. Not a platform someone else controls. The client owns what we build.

USE THE LEAD'S RESEARCH
You're given the lead's record in the user message — including the "Notes for AI" Chris wrote, plus AUDIT / PROBLEMS / VISUAL / CONVERSION / PITCH / OPENING fields from the automated website review. Reference SPECIFIC observations from these when you reply. Don't write generic-sounding responses; the goal is for the prospect to feel like a real person read their situation.

HARD RULE — NEVER OPEN BY BASHING THEIR SITE
You never start a reply by telling the prospect their website is bad, broken, outdated, slow, hard to read, lacking, ugly, or any variation of "your site sucks." The first line is always a genuine business observation or curiosity question. Specific improvements come up later in the email only if the prospect asks what you'd actually do.

WHAT YOU NEVER BRING UP IN EMAIL
- Pricing, monthly fees, retainers, or cost of any kind
- Contracts or terms
- Timelines or how long a build takes
- Technical implementation details (React, Postgres, etc.)
Those conversations happen in a proposal or a call. Not email.

VOICE
Direct. Conversational. Short sentences. No em dashes. No filler words. Contractions always. Write like a real person, not a marketer. Match the energy and length of what the prospect wrote — if they wrote two sentences you write two or three. Never an essay. End with the signature block exactly:
Travis
Outreach Lead
BlackRidge Platforms

GOAL
Move the conversation toward them saying yes to a quick preview, mock-up, or short call. Once they're warm, flag the lead for handoff so Chris takes over the proposal stage.

HANDOFF TRIGGERS — set handoff to true when:
- They say yes to seeing a preview or proposal
- They ask to get on a call or schedule something
- They want to talk pricing seriously
- They're clearly ready to move forward

HOW TO HANDLE EACH REPLY TYPE

INTERESTED — excited or clearly want more
Reply with brief genuine energy. Ask one specific question that ties to their business (NOT their site). End by confirming you'll put a preview together. Set handoff=true.

QUESTION — asking how it works, what's included, process questions
Answer directly in one or two sentences. Don't over-explain. Redirect to the preview as the place to see everything. Example phrasing: "I can lay all of that out in a quick mock-up if you want to take a look."

SOFT INTEREST — positive but not committing
Mention ONE specific thing you noticed about their BUSINESS (from the research). Ask one question to keep them talking. No pitch.

NOT NOW — too busy or bad timing
Respect it completely. Zero pushback. Ask if you can follow up in 30 days. That's it.

NOT INTERESTED — clear no
Thank them genuinely. Something like "Appreciate you taking the time to respond — most people don't. If anything changes, you know where to find me." Leave the door open. No guilt.

PRICE ASK — they ask what it costs
Never give a number. Say something like "Every build is different — let me put something quick together based on what you actually need and you can tell me what you think." Stay grounded; no defensiveness.

Return ONLY valid JSON:
{
  "classification": "INTERESTED|QUESTION|SOFT_INTEREST|NOT_NOW|NOT_INTERESTED|PRICE_ASK",
  "reply": "reply body with \\n for line breaks — must end with the Travis signature block",
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
  if (!lead) {
    console.log(`Skipping reply for missing lead ${payload.lead_id}`);
    return;
  }
  if (!lead.email) {
    console.log(`Skipping reply for lead ${payload.lead_id} (no email)`);
    return;
  }

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
    const role = c.direction === "outbound" ? "TRAVIS" : "PROSPECT";
    const timestamp = new Date(c.createdAt).toISOString();
    return `${role} (${timestamp}):\n${c.body}`;
  }).join("\n\n---\n\n");

  const latestInbound = conversations.find(c => c.id === payload.inbound_conversation_id);
  if (!latestInbound) throw new Error("Inbound conversation not found");

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  // Hand Claude the full research block so the reply can reference
  // specific observations from Chris's notes + the automated audit.
  const truncate = (s: string | null | undefined, n: number) =>
    (s ?? "").length > n ? (s ?? "").slice(0, n - 1) + "…" : (s ?? "");
  const researchLines: string[] = [];
  researchLines.push(`Lead: ${lead.businessName}${lead.contactName ? ` (${lead.contactName})` : ""}`);
  if (lead.industry) researchLines.push(`Industry: ${lead.industry}`);
  if (lead.location) researchLines.push(`Location: ${lead.location}`);
  if (lead.websiteUrl) researchLines.push(`Website: ${lead.websiteUrl}`);
  if (lead.sourceType) researchLines.push(`Source: ${lead.sourceType}`);
  if (lead.notes) researchLines.push(`Notes for AI (Chris's): ${truncate(lead.notes, 800)}`);
  if (lead.pitchAngle) researchLines.push(`Pitch angle: ${truncate(lead.pitchAngle, 400)}`);
  if (lead.openingLine) researchLines.push(`Opening line we'd use: ${truncate(lead.openingLine, 400)}`);
  if (lead.aiAuditSummary) researchLines.push(`Site audit: ${truncate(lead.aiAuditSummary, 600)}`);
  const tp = Array.isArray(lead.topProblems) ? (lead.topProblems as unknown[]) : [];
  if (tp.length > 0) researchLines.push(`Top problems on their site:\n${tp.slice(0, 5).map(p => `  - ${truncate(String(p), 240)}`).join("\n")}`);
  const ab = Array.isArray(lead.aiBullets) ? (lead.aiBullets as unknown[]) : [];
  if (ab.length > 0) researchLines.push(`AI bullets:\n${ab.slice(0, 5).map(b => `  - ${truncate(String(b), 240)}`).join("\n")}`);
  if (lead.visualStyleAssessment) researchLines.push(`Visual assessment: ${truncate(lead.visualStyleAssessment, 320)}`);
  if (lead.conversionAssessment) researchLines.push(`Conversion assessment: ${truncate(lead.conversionAssessment, 320)}`);
  const researchBlock = researchLines.join("\n");

  const userPrompt = `LEAD RESEARCH:\n${researchBlock}\n\nFULL THREAD SO FAR:\n${threadHistory}\n\nHandle the prospect's latest reply. Use the research above so the response feels personal, but DO NOT open the email by criticizing their website.`;

  const replyResponse = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 4000,
    system: AUTO_REPLY_SYSTEM_PROMPT,
    messages: [{ role: "user", content: userPrompt }],
  });

  const replyRawText = replyResponse.content
    .map(b => (b.type === "text" ? b.text : ""))
    .join("");
  const replyRaw = replyRawText.replace(/```(?:json)?\s*/g, "").replace(/```/g, "").trim();
  const reply = JSON.parse(replyRaw);

  const replyBody = stripDashes(reply.reply || reply.body || "");
  const replySubject = stripDashes(reply.subject || `Re: ${latestInbound.subject || "Your website"}`);

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
    thread.push({ role: "travis", subject: replySubject, body: replyBody, sentAt: new Date().toISOString() });
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
    thread.push({ role: "travis", subject: replySubject, body: replyBody, sentAt: new Date().toISOString() });
    await outreachStorage.updateLead(lead.id, { conversationThread: thread });
  }

  // Notify Chris that Travis sent something — separate from the earlier
  // inbound-arrived notification so Chris can see what went out
  // without opening OPS.
  try {
    const { isPushConfigured, sendPushToAll } = await import("./push");
    if (isPushConfigured()) {
      const snippet = replyBody.replace(/\s+/g, " ").slice(0, 160);
      await sendPushToAll({
        title: `Travis replied to ${lead.businessName}`,
        body: `${reply.classification ?? ""}${reply.handoff ? " · HANDOFF" : ""} — ${snippet}`,
        url: "/admin/ops/outreach",
      });
    }
  } catch (err: any) {
    console.warn("Failed to send Travis-reply push:", err?.message);
  }

  console.log(`Travis reply sent to ${lead.email} (${lead.businessName}) — classification: ${reply.classification}, handoff: ${reply.handoff}`);
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

/**
 * Find every lead currently without a deliverable email and enqueue
 * a fresh analyze_lead job for it. Skips leads that already have a
 * pending analyze_lead job so this is safe to call repeatedly.
 * Returns the number of jobs newly enqueued.
 */
export async function backfillEmaillessLeads(): Promise<number> {
  const leads = await outreachStorage.getLeads();
  const targets = leads.filter(l =>
    !!l.websiteUrl
    && (!l.email || l.email.trim().length === 0 || l.status === "email_invalid")
    && l.status !== "unsubscribed"
    && l.status !== "bounced"
  );
  if (targets.length === 0) return 0;

  const pendingJobs = await outreachStorage.getQueuedJobs();
  const pendingLeadIds = new Set(
    pendingJobs
      .filter(j => j.type === "analyze_lead")
      .map(j => (j.payload as any)?.lead_id)
      .filter(Boolean)
  );

  let enqueued = 0;
  for (const lead of targets) {
    if (pendingLeadIds.has(lead.id)) continue;
    await outreachStorage.createJob({
      type: "analyze_lead",
      payload: { lead_id: lead.id },
      // Stagger 5s apart so we don't slam Anthropic or third-party
      // APIs all at once when there's a big backlog.
      runAt: new Date(Date.now() + enqueued * 5000),
    });
    enqueued++;
  }
  return enqueued;
}

async function ensureStep1DraftColumns(): Promise<void> {
  const { db } = await import("./db");
  const { sql } = await import("drizzle-orm");
  try {
    await db.execute(sql`
      ALTER TABLE outreach_leads
        ADD COLUMN IF NOT EXISTS step1_draft_subject text,
        ADD COLUMN IF NOT EXISTS step1_draft_body text,
        ADD COLUMN IF NOT EXISTS step1_status text,
        ADD COLUMN IF NOT EXISTS step1_drafted_at timestamptz,
        ADD COLUMN IF NOT EXISTS step1_approved_at timestamptz
    `);
  } catch (err: any) {
    console.error("[outreach] failed to ensure step1 draft columns:", err?.message);
  }
}

export function startOutreachJobRunner() {
  console.log("Outreach job runner started (30s interval)");
  ensureStep1DraftColumns().catch(err => console.error("Step1 columns migration error:", err));
  outreachStorage.cleanupOrphanedJobs()
    .then(n => { if (n > 0) console.log(`Outreach: cleaned up ${n} orphaned job(s) on startup`); })
    .catch(err => console.error("Initial orphan-job cleanup error:", err));

  // One-shot backfill: re-run email discovery on every lead currently
  // without a deliverable address. Idempotent — skips leads that
  // already have a pending analyze_lead job.
  backfillEmaillessLeads()
    .then(n => { if (n > 0) console.log(`Outreach: queued email-discovery backfill for ${n} lead(s)`); })
    .catch(err => console.error("Email-discovery backfill error:", err));

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
