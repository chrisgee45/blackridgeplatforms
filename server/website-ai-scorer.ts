import Anthropic from "@anthropic-ai/sdk";
import { websiteAuditStorage } from "./website-audit-storage";
import type { WebsiteAudit } from "@shared/schema";

export interface AiEvaluation {
  aiScore: number;
  redesignWorthy: boolean;
  topProblems: string[];
  pitchAngle: string;
  openingLine: string;
  visualStyleAssessment: string;
  conversionAssessment: string;
}

const SYSTEM_PROMPT = `You are a senior web strategist who evaluates small business websites for conversion potential. Your job is to assess whether a business website could benefit from a professional redesign that would help them convert more visitors into customers.

Rules:
- Never insult or mock the website. Be respectful and professional.
- Focus on conversion opportunities, clarity, trust signals, and visitor-to-customer improvement.
- If the website is polished, modern, well-structured, and clearly effective, give it a LOW score (under 30). Only flag websites that genuinely have room for improvement.
- The opening_line must be usable in a cold outreach email. It should feel natural, helpful, and observational. Never sound negative or critical. Frame it around opportunity, not problems.
- Never use em dashes in any text you generate. Use commas, periods, or semicolons instead.
- top_problems should be exactly 3 short strings (under 15 words each) describing the biggest conversion gaps.
- ai_score ranges from 0 to 100 where higher means the site needs more help. A score above 60 means a redesign would meaningfully improve their business.
- redesign_worthy should be true only if ai_score is 60 or above.

Respond with valid JSON only. No markdown, no code fences, no explanation.`;

function buildUserPrompt(input: {
  url: string;
  businessName: string;
  industry?: string | null;
  city?: string | null;
  visibleText: string;
  htmlSnippet: string;
}): string {
  const lines = [
    `Business: ${input.businessName}`,
  ];
  if (input.industry) lines.push(`Industry: ${input.industry}`);
  if (input.city) lines.push(`Location: ${input.city}`);
  lines.push(`Website: ${input.url}`);
  lines.push("");
  lines.push("=== VISIBLE TEXT (first 3000 chars) ===");
  lines.push(input.visibleText.slice(0, 3000));
  lines.push("");
  lines.push("=== HTML STRUCTURE (first 5000 chars) ===");
  lines.push(input.htmlSnippet.slice(0, 5000));

  return lines.join("\n");
}

const JSON_SCHEMA = {
  name: "website_evaluation",
  strict: true,
  schema: {
    type: "object" as const,
    properties: {
      ai_score: { type: "number" as const, description: "0-100 score where higher means the site needs more help" },
      redesign_worthy: { type: "boolean" as const, description: "True if ai_score >= 60" },
      top_problems: {
        type: "array" as const,
        items: { type: "string" as const },
        description: "Exactly 3 short conversion gap descriptions (under 15 words each)",
      },
      pitch_angle: { type: "string" as const, description: "One sentence pitch angle for why a redesign would help this business" },
      opening_line: { type: "string" as const, description: "A natural, non-negative cold email opening line about their website" },
      visual_style_assessment: { type: "string" as const, description: "2-3 sentence assessment of visual design, layout, and branding" },
      conversion_assessment: { type: "string" as const, description: "2-3 sentence assessment of conversion elements, CTAs, and trust signals" },
    },
    required: [
      "ai_score",
      "redesign_worthy",
      "top_problems",
      "pitch_angle",
      "opening_line",
      "visual_style_assessment",
      "conversion_assessment",
    ],
    additionalProperties: false,
  },
};

export async function evaluateWithAi(audit: WebsiteAudit, visibleText: string): Promise<AiEvaluation> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("Anthropic API key not configured");

  const anthropic = new Anthropic({ apiKey });

  const userPrompt = buildUserPrompt({
    url: audit.websiteUrl,
    businessName: audit.businessName,
    industry: audit.industry,
    city: audit.city,
    visibleText,
    htmlSnippet: audit.homepageHtml || "",
  });

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 4000,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: userPrompt }],
  });

  const raw = response.content[0].type === "text" ? response.content[0].text : null;
  if (!raw) throw new Error("Empty response from Anthropic");

  const parsed = JSON.parse(raw) as {
    ai_score: number;
    redesign_worthy: boolean;
    top_problems: string[];
    pitch_angle: string;
    opening_line: string;
    visual_style_assessment: string;
    conversion_assessment: string;
  };

  const evaluation: AiEvaluation = {
    aiScore: Math.round(Math.max(0, Math.min(100, parsed.ai_score))),
    redesignWorthy: parsed.redesign_worthy,
    topProblems: parsed.top_problems.slice(0, 3),
    pitchAngle: parsed.pitch_angle,
    openingLine: parsed.opening_line,
    visualStyleAssessment: parsed.visual_style_assessment,
    conversionAssessment: parsed.conversion_assessment,
  };

  await websiteAuditStorage.updateWebsiteAudit(audit.id, {
    aiScore: evaluation.aiScore,
    redesignWorthy: evaluation.redesignWorthy,
    topProblems: evaluation.topProblems,
    pitchAngle: evaluation.pitchAngle,
    openingLine: evaluation.openingLine,
    visualStyleAssessment: evaluation.visualStyleAssessment,
    conversionAssessment: evaluation.conversionAssessment,
  });

  return evaluation;
}
