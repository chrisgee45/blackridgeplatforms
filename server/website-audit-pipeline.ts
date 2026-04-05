import { fetchHomepage } from "./website-fetcher";
import { scoreWebsite } from "./website-rule-scorer";
import { websiteAuditStorage } from "./website-audit-storage";
import { evaluateWithAi } from "./website-ai-scorer";
import { captureScreenshot } from "./website-screenshot";
import type { WebsiteAudit } from "@shared/schema";

export interface AuditInput {
  businessName: string;
  websiteUrl: string;
  industry?: string;
  city?: string;
  phone?: string;
}

export interface AuditPipelineResult {
  success: boolean;
  audit: WebsiteAudit | null;
  fetchStatus: "ok" | "error" | "rejected";
  fetchError: string | null;
}

function computeFinalScore(ruleScore: number, aiScore: number): { badSiteScore: number; redesignWorthy: boolean } {
  const badSiteScore = Math.round(ruleScore * 0.4 + aiScore * 0.6);
  return {
    badSiteScore: Math.max(0, Math.min(100, badSiteScore)),
    redesignWorthy: badSiteScore >= 60,
  };
}

export async function runWebsiteAudit(input: AuditInput): Promise<AuditPipelineResult> {
  const fetchResult = await fetchHomepage(input.websiteUrl);

  if (fetchResult.fetchStatus !== "ok" || !fetchResult.homepageHtml || !fetchResult.visibleText) {
    return {
      success: false,
      audit: null,
      fetchStatus: fetchResult.fetchStatus,
      fetchError: fetchResult.fetchError,
    };
  }

  const { ruleScore, matchedRules } = scoreWebsite(
    fetchResult.normalizedUrl,
    fetchResult.homepageHtml,
    fetchResult.visibleText,
  );

  let audit = await websiteAuditStorage.createWebsiteAudit({
    businessName: input.businessName,
    websiteUrl: fetchResult.normalizedUrl,
    industry: input.industry ?? null,
    city: input.city ?? null,
    phone: input.phone ?? null,
    homepageHtml: fetchResult.homepageHtml,
    ruleScore,
    topProblems: matchedRules,
  });

  const screenshotPromise = captureScreenshot(fetchResult.normalizedUrl)
    .then(async (screenshotUrl) => {
      if (screenshotUrl) {
        await websiteAuditStorage.updateWebsiteAudit(audit.id, { screenshotUrl });
      }
      return screenshotUrl;
    })
    .catch((err) => {
      console.warn(`Screenshot failed for ${audit.id}: ${err.message}`);
      return null;
    });

  try {
    const [aiResult, screenshotUrl] = await Promise.all([
      evaluateWithAi(audit, fetchResult.visibleText),
      screenshotPromise,
    ]);

    const { badSiteScore, redesignWorthy } = computeFinalScore(ruleScore, aiResult.aiScore);

    const finalUpdate: Partial<WebsiteAudit> = {
      badSiteScore: String(badSiteScore),
      redesignWorthy,
    };
    if (screenshotUrl) finalUpdate.screenshotUrl = screenshotUrl;

    audit = (await websiteAuditStorage.updateWebsiteAudit(audit.id, finalUpdate)) ?? audit;
  } catch (err: any) {
    console.error(`AI evaluation failed for ${audit.id}: ${err.message}`);
    const fallbackScore = Math.max(0, Math.min(100, ruleScore));
    const fallbackUpdate: Partial<WebsiteAudit> = {
      badSiteScore: String(fallbackScore),
      redesignWorthy: fallbackScore >= 60,
    };
    const screenshotUrl = await screenshotPromise;
    if (screenshotUrl) fallbackUpdate.screenshotUrl = screenshotUrl;
    audit = (await websiteAuditStorage.updateWebsiteAudit(audit.id, fallbackUpdate)) ?? audit;
  }

  return {
    success: true,
    audit,
    fetchStatus: "ok",
    fetchError: null,
  };
}
