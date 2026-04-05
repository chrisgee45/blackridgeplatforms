import { db } from "./db";
import {
  websiteAudits, outreachLeads,
  type WebsiteAudit, type InsertWebsiteAudit, type OutreachLead,
} from "@shared/schema";
import { eq, desc } from "drizzle-orm";
import { outreachStorage } from "./outreach-storage";

export const websiteAuditStorage = {
  async createWebsiteAudit(data: InsertWebsiteAudit): Promise<WebsiteAudit> {
    const [audit] = await db.insert(websiteAudits).values(data).returning();
    return audit;
  },

  async updateWebsiteAudit(id: string, data: Partial<WebsiteAudit>): Promise<WebsiteAudit | undefined> {
    const [audit] = await db
      .update(websiteAudits)
      .set(data)
      .where(eq(websiteAudits.id, id))
      .returning();
    return audit;
  },

  async getWebsiteAuditById(id: string): Promise<WebsiteAudit | undefined> {
    const [audit] = await db
      .select()
      .from(websiteAudits)
      .where(eq(websiteAudits.id, id));
    return audit;
  },

  async listWebsiteAudits(): Promise<WebsiteAudit[]> {
    return db
      .select()
      .from(websiteAudits)
      .orderBy(desc(websiteAudits.createdAt));
  },

  async importAuditToLead(auditId: string): Promise<OutreachLead | undefined> {
    const audit = await this.getWebsiteAuditById(auditId);
    if (!audit) return undefined;
    if (audit.status === "imported") return undefined;

    const [lead] = await db
      .insert(outreachLeads)
      .values({
        businessName: audit.businessName,
        websiteUrl: audit.websiteUrl,
        industry: audit.industry,
        phone: audit.phone,
        location: audit.city,
        sourceType: "bad_site_finder",
        source: "bad_website_finder",
        auditId: audit.id,
        pitchAngle: audit.pitchAngle,
        openingLine: audit.openingLine,
        badSiteScore: audit.badSiteScore != null ? Math.round(Number(audit.badSiteScore)) : null,
        redesignWorthy: audit.redesignWorthy,
        topProblems: audit.topProblems,
        visualStyleAssessment: audit.visualStyleAssessment,
        conversionAssessment: audit.conversionAssessment,
        screenshotUrl: audit.screenshotUrl,
      })
      .returning();

    await this.updateWebsiteAudit(auditId, { status: "imported" });

    await outreachStorage.createJob({
      type: "analyze_lead",
      payload: { lead_id: lead.id },
      runAt: new Date(),
    });

    const settings = await outreachStorage.getSettings();
    if (!settings.enrollmentsPaused && lead.email) {
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
            runAt: new Date(Date.now() + 5000),
          });
        }
      }
    }

    return lead;
  },

  async rejectAudit(auditId: string): Promise<WebsiteAudit | undefined> {
    const audit = await this.getWebsiteAuditById(auditId);
    if (!audit) return undefined;
    if (audit.status !== "pending") return undefined;
    return this.updateWebsiteAudit(auditId, { status: "rejected" });
  },
};
