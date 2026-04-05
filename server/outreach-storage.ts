import { db } from "./db";
import {
  outreachLeads, outreachCampaigns, campaignSteps,
  leadCampaignEnrollments, emailEvents, outreachJobs, outreachSettings,
  leadConversations, agentInsights, agentChatMessages,
  type OutreachLead, type InsertOutreachLead, type OutreachCampaign,
  type CampaignStep, type LeadCampaignEnrollment, type EmailEvent, type OutreachJob,
  type OutreachSettings, type LeadConversation, type AgentInsight, type AgentChatMessage,
} from "@shared/schema";
import { eq, desc, asc, and, lte, gte, sql, inArray, ne } from "drizzle-orm";

const STOP_STATUSES = ["engaged", "won", "lost", "do_not_contact", "converted"];

const EVENT_PRIORITY: Record<string, number> = {
  queued: 0,
  sent: 1,
  delivered: 2,
  opened: 3,
  clicked: 4,
  bounced: 5,
  failed: 6,
};

export const outreachStorage = {
  async getLeads(): Promise<OutreachLead[]> {
    return db.select().from(outreachLeads).orderBy(desc(outreachLeads.createdAt));
  },

  async getLead(id: string): Promise<OutreachLead | undefined> {
    const [lead] = await db.select().from(outreachLeads).where(eq(outreachLeads.id, id));
    return lead;
  },

  async findLeadByEmail(email: string): Promise<OutreachLead | undefined> {
    const [lead] = await db
      .select()
      .from(outreachLeads)
      .where(sql`lower(${outreachLeads.email}) = lower(${email})`)
      .limit(1);
    return lead;
  },

  async findLeadByWebsite(websiteUrl: string): Promise<OutreachLead | undefined> {
    const normalized = websiteUrl
      .replace(/^https?:\/\//, "")
      .replace(/^www\./, "")
      .split(/[?#]/)[0]
      .replace(/\/+$/, "")
      .toLowerCase();
    const [lead] = await db
      .select()
      .from(outreachLeads)
      .where(sql`lower(regexp_replace(regexp_replace(regexp_replace(${outreachLeads.websiteUrl}, '^https?://', ''), '^www\.', ''), '[?#].*$|/+$', '')) = ${normalized}`)
      .limit(1);
    return lead;
  },

  async createLead(data: InsertOutreachLead): Promise<OutreachLead> {
    const [lead] = await db.insert(outreachLeads).values(data).returning();
    return lead;
  },

  async updateLead(id: string, data: Partial<OutreachLead>): Promise<OutreachLead | undefined> {
    const [lead] = await db.update(outreachLeads).set(data).where(eq(outreachLeads.id, id)).returning();
    return lead;
  },

  async getLeadByCrmId(crmLeadId: string): Promise<OutreachLead | undefined> {
    const [lead] = await db.select().from(outreachLeads).where(eq(outreachLeads.crmLeadId, crmLeadId));
    return lead;
  },

  async deleteLead(id: string): Promise<boolean> {
    const result = await db.delete(outreachLeads).where(eq(outreachLeads.id, id)).returning();
    return result.length > 0;
  },

  async getCampaigns(): Promise<OutreachCampaign[]> {
    return db.select().from(outreachCampaigns).orderBy(desc(outreachCampaigns.createdAt));
  },

  async getActiveCampaign(): Promise<OutreachCampaign | undefined> {
    const [campaign] = await db
      .select()
      .from(outreachCampaigns)
      .where(eq(outreachCampaigns.isActive, true))
      .orderBy(desc(outreachCampaigns.createdAt))
      .limit(1);
    return campaign;
  },

  async getCampaignSteps(campaignId: string): Promise<CampaignStep[]> {
    return db
      .select()
      .from(campaignSteps)
      .where(eq(campaignSteps.campaignId, campaignId))
      .orderBy(asc(campaignSteps.stepNumber));
  },

  async getCampaignStep(campaignId: string, stepNumber: number): Promise<CampaignStep | undefined> {
    const [step] = await db
      .select()
      .from(campaignSteps)
      .where(and(eq(campaignSteps.campaignId, campaignId), eq(campaignSteps.stepNumber, stepNumber)));
    return step;
  },

  async createEnrollment(leadId: string, campaignId: string): Promise<LeadCampaignEnrollment> {
    const [enrollment] = await db
      .insert(leadCampaignEnrollments)
      .values({ leadId, campaignId })
      .returning();
    return enrollment;
  },

  async getEnrollment(id: string): Promise<LeadCampaignEnrollment | undefined> {
    const [enrollment] = await db
      .select()
      .from(leadCampaignEnrollments)
      .where(eq(leadCampaignEnrollments.id, id));
    return enrollment;
  },

  async getEnrollmentByLead(leadId: string): Promise<LeadCampaignEnrollment | undefined> {
    const [enrollment] = await db
      .select()
      .from(leadCampaignEnrollments)
      .where(eq(leadCampaignEnrollments.leadId, leadId))
      .orderBy(desc(leadCampaignEnrollments.enrolledAt))
      .limit(1);
    return enrollment;
  },

  async updateEnrollment(id: string, data: Partial<LeadCampaignEnrollment>): Promise<LeadCampaignEnrollment | undefined> {
    const [enrollment] = await db
      .update(leadCampaignEnrollments)
      .set(data)
      .where(eq(leadCampaignEnrollments.id, id))
      .returning();
    return enrollment;
  },

  async createEmailEvent(data: {
    leadId: string; campaignId: string; stepNumber: number;
    resendMessageId?: string; toEmail: string; subject: string;
    body: string; status: string; sentAt?: Date;
  }): Promise<EmailEvent> {
    const [event] = await db.insert(emailEvents).values(data).returning();
    return event;
  },

  async getEmailEventsByLead(leadId: string): Promise<EmailEvent[]> {
    return db
      .select()
      .from(emailEvents)
      .where(eq(emailEvents.leadId, leadId))
      .orderBy(desc(emailEvents.createdAt));
  },

  async getEmailEventByResendId(resendMessageId: string): Promise<EmailEvent | undefined> {
    const [event] = await db
      .select()
      .from(emailEvents)
      .where(eq(emailEvents.resendMessageId, resendMessageId));
    return event;
  },

  async updateEmailEventByResendId(resendMessageId: string, newStatus: string): Promise<EmailEvent | undefined> {
    const existing = await this.getEmailEventByResendId(resendMessageId);
    if (!existing) return undefined;

    const currentPriority = EVENT_PRIORITY[existing.status] ?? 0;
    const newPriority = EVENT_PRIORITY[newStatus] ?? 0;

    if (newStatus === "bounced" || newStatus === "failed") {
      const [event] = await db
        .update(emailEvents)
        .set({ status: newStatus, lastEventAt: new Date() })
        .where(eq(emailEvents.resendMessageId, resendMessageId))
        .returning();
      return event;
    }

    if (newPriority <= currentPriority) {
      return existing;
    }

    const [event] = await db
      .update(emailEvents)
      .set({ status: newStatus, lastEventAt: new Date() })
      .where(eq(emailEvents.resendMessageId, resendMessageId))
      .returning();
    return event;
  },

  async updateLatestEmailEventByEmail(email: string, newStatus: string): Promise<EmailEvent | undefined> {
    const [latest] = await db
      .select()
      .from(emailEvents)
      .where(eq(emailEvents.toEmail, email))
      .orderBy(desc(emailEvents.createdAt))
      .limit(1);
    if (!latest) return undefined;

    const currentPriority = EVENT_PRIORITY[latest.status] ?? 0;
    const newPriority = EVENT_PRIORITY[newStatus] ?? 0;

    if (newStatus === "bounced" || newStatus === "failed" || newPriority > currentPriority) {
      const [event] = await db
        .update(emailEvents)
        .set({ status: newStatus, lastEventAt: new Date() })
        .where(eq(emailEvents.id, latest.id))
        .returning();
      return event;
    }
    return latest;
  },

  async createJob(data: { type: string; payload: Record<string, unknown>; runAt: Date }): Promise<OutreachJob> {
    const [job] = await db.insert(outreachJobs).values(data).returning();
    return job;
  },

  async getQueuedJobs(): Promise<OutreachJob[]> {
    return db
      .select()
      .from(outreachJobs)
      .where(and(eq(outreachJobs.status, "queued"), lte(outreachJobs.runAt, new Date())))
      .orderBy(asc(outreachJobs.runAt))
      .limit(10);
  },

  async atomicPickupJob(jobId: string): Promise<OutreachJob | undefined> {
    const [job] = await db
      .update(outreachJobs)
      .set({ status: "running" })
      .where(and(eq(outreachJobs.id, jobId), eq(outreachJobs.status, "queued")))
      .returning();
    return job;
  },

  async updateJob(id: string, data: Partial<OutreachJob>): Promise<OutreachJob | undefined> {
    const [job] = await db.update(outreachJobs).set(data).where(eq(outreachJobs.id, id)).returning();
    return job;
  },

  async skipQueuedJobsForLead(leadId: string): Promise<number> {
    const allQueued = await db
      .select()
      .from(outreachJobs)
      .where(and(
        eq(outreachJobs.status, "queued"),
        eq(outreachJobs.type, "send_campaign_step"),
      ));

    const toSkip = allQueued.filter(j => (j.payload as any)?.lead_id === leadId);
    let count = 0;
    for (const job of toSkip) {
      await db.update(outreachJobs)
        .set({ status: "skipped", error: "Lead campaign stopped" })
        .where(and(eq(outreachJobs.id, job.id), eq(outreachJobs.status, "queued")));
      count++;
    }
    return count;
  },

  async getFailedJobs(): Promise<OutreachJob[]> {
    return db
      .select()
      .from(outreachJobs)
      .where(eq(outreachJobs.status, "failed"))
      .orderBy(desc(outreachJobs.createdAt))
      .limit(50);
  },

  async requeueJob(jobId: string): Promise<OutreachJob | undefined> {
    const [job] = await db
      .update(outreachJobs)
      .set({ status: "queued", error: null, runAt: new Date() })
      .where(and(eq(outreachJobs.id, jobId), eq(outreachJobs.status, "failed")))
      .returning();
    return job;
  },

  async getNextJobForLead(leadId: string): Promise<OutreachJob | undefined> {
    const jobs = await db
      .select()
      .from(outreachJobs)
      .where(and(eq(outreachJobs.status, "queued"), eq(outreachJobs.type, "send_campaign_step")))
      .orderBy(asc(outreachJobs.runAt))
      .limit(50);
    return jobs.find(j => (j.payload as any)?.lead_id === leadId);
  },

  async getLeadWithCampaignInfo(leadId: string) {
    const lead = await this.getLead(leadId);
    if (!lead) return null;
    const enrollment = await this.getEnrollmentByLead(leadId);
    const events = await this.getEmailEventsByLead(leadId);
    let nextJob: OutreachJob | undefined;
    const isStopStatus = STOP_STATUSES.includes(lead.status);
    if (enrollment && !enrollment.stoppedAt && !enrollment.completedAt && !isStopStatus) {
      nextJob = await this.getNextJobForLead(leadId);
    }
    return { lead, enrollment, events, nextJob };
  },

  async getEmailStats() {
    const allEvents = await db.select().from(emailEvents);
    const sent = allEvents.length;
    const delivered = allEvents.filter(e => ["delivered", "opened", "clicked"].includes(e.status)).length;
    const opened = allEvents.filter(e => ["opened", "clicked"].includes(e.status)).length;
    const clicked = allEvents.filter(e => e.status === "clicked").length;
    const bounced = allEvents.filter(e => e.status === "bounced").length;
    const engagements = opened + clicked;
    const bounceRate7d = await this.getBounceRate7d();
    const settings = await this.getSettings();
    const sentToday = await this.getEmailsSentToday(settings.timezone);

    const responded = await db.execute(sql`
      SELECT COUNT(DISTINCT lead_id)::int as count FROM lead_conversations WHERE direction = 'inbound'
    `);
    const respondedCount = (responded.rows?.[0] as any)?.count ?? 0;

    return {
      sent,
      delivered,
      opened,
      clicked,
      bounced,
      responded: respondedCount,
      openRate: sent > 0 ? Math.round((opened / sent) * 100) : 0,
      clickRate: sent > 0 ? Math.round((clicked / sent) * 100) : 0,
      bounceRate: sent > 0 ? parseFloat(((bounced / sent) * 100).toFixed(1)) : 0,
      engagementRate: sent > 0 ? parseFloat((engagements / sent * 100).toFixed(1)) : 0,
      responseRate: sent > 0 ? parseFloat(((respondedCount / sent) * 100).toFixed(1)) : 0,
      bounceRate7d: parseFloat(bounceRate7d.toFixed(1)),
      sentToday,
      dailySendCap: settings.dailySendCap,
      enrollmentsPaused: settings.enrollmentsPaused,
      enrollmentsPausedReason: settings.enrollmentsPausedReason,
    };
  },

  async getSettings(): Promise<OutreachSettings> {
    const [existing] = await db.select().from(outreachSettings).where(eq(outreachSettings.id, "default"));
    if (existing) return existing;
    const [created] = await db.insert(outreachSettings).values({ id: "default" }).returning();
    return created;
  },

  async updateSettings(data: Partial<OutreachSettings>): Promise<OutreachSettings> {
    await this.getSettings();
    const [updated] = await db
      .update(outreachSettings)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(outreachSettings.id, "default"))
      .returning();
    return updated;
  },

  async getEmailsSentToday(timezone: string): Promise<number> {
    const result = await db.execute(sql`
      SELECT COUNT(*)::int as count FROM email_events
      WHERE status IN ('sent', 'delivered', 'opened', 'clicked')
      AND sent_at >= (NOW() AT TIME ZONE ${timezone})::date AT TIME ZONE ${timezone}
    `);
    return (result as any)?.[0]?.count || 0;
  },

  async getBounceRate7d(): Promise<number> {
    const sevenDaysAgo = new Date(Date.now() - 7 * 86400000);
    const events = await db
      .select()
      .from(emailEvents)
      .where(gte(emailEvents.createdAt, sevenDaysAgo));
    const sent = events.filter(e => ["sent", "delivered", "opened", "clicked", "bounced"].includes(e.status)).length;
    const bounced = events.filter(e => e.status === "bounced").length;
    return sent > 0 ? (bounced / sent) * 100 : 0;
  },

  async getLeadsWithCampaignSummary() {
    const leads = await this.getLeads();
    const enrollments = await db.select().from(leadCampaignEnrollments);
    const latestEvents = await db.select().from(emailEvents).orderBy(desc(emailEvents.createdAt));
    const queuedJobs = await db
      .select()
      .from(outreachJobs)
      .where(and(eq(outreachJobs.status, "queued"), eq(outreachJobs.type, "send_campaign_step")))
      .orderBy(asc(outreachJobs.runAt));

    return leads.map(lead => {
      const enrollment = enrollments.find(e => e.leadId === lead.id);
      const leadEvents = latestEvents.filter(e => e.leadId === lead.id);
      const lastEvent = leadEvents[0];
      const isStopStatus = STOP_STATUSES.includes(lead.status);
      const isStopped = !!enrollment?.stoppedAt || !!enrollment?.completedAt || isStopStatus;
      const nextJob = isStopped ? undefined : queuedJobs.find(j => (j.payload as any)?.lead_id === lead.id);

      const lastActivity = lastEvent?.lastEventAt || lastEvent?.sentAt || lastEvent?.createdAt;

      return {
        ...lead,
        currentStep: enrollment?.currentStep ?? 0,
        enrolledAt: enrollment?.enrolledAt,
        campaignCompleted: !!enrollment?.completedAt,
        campaignStopped: !!enrollment?.stoppedAt,
        stopReason: enrollment?.stopReason,
        lastEmailStatus: lastEvent?.status,
        lastEmailAt: lastActivity,
        nextScheduledAt: nextJob?.runAt,
      };
    });
  },

  async createConversation(data: {
    leadId: string;
    direction: string;
    subject?: string;
    body: string;
    aiGenerated?: boolean;
    sentiment?: string;
    intent?: string;
    resendMessageId?: string;
    inReplyToMessageId?: string;
    campaignStep?: number;
  }): Promise<LeadConversation> {
    const [conv] = await db.insert(leadConversations).values(data).returning();
    return conv;
  },

  async getConversationsByLead(leadId: string): Promise<LeadConversation[]> {
    return db
      .select()
      .from(leadConversations)
      .where(eq(leadConversations.leadId, leadId))
      .orderBy(asc(leadConversations.createdAt));
  },

  async getLatestOutboundMessageId(leadId: string): Promise<string | undefined> {
    const [msg] = await db
      .select()
      .from(leadConversations)
      .where(and(
        eq(leadConversations.leadId, leadId),
        eq(leadConversations.direction, "outbound"),
      ))
      .orderBy(desc(leadConversations.createdAt))
      .limit(1);
    return msg?.resendMessageId ?? undefined;
  },

  async createInsight(data: {
    type: string;
    insight: string;
    metrics?: Record<string, unknown>;
  }): Promise<AgentInsight> {
    const [insight] = await db.insert(agentInsights).values(data).returning();
    return insight;
  },

  async getRecentInsights(limit = 10): Promise<AgentInsight[]> {
    return db
      .select()
      .from(agentInsights)
      .orderBy(desc(agentInsights.createdAt))
      .limit(limit);
  },

  async getActiveInsightsSummary(): Promise<string> {
    const insights = await this.getRecentInsights(20);
    if (insights.length === 0) return "";
    return insights.map(i => `[${i.type}] ${i.insight}`).join("\n");
  },

  async getConversationCount(leadId: string): Promise<number> {
    const result = await db.execute(
      sql`SELECT COUNT(*)::int as count FROM lead_conversations WHERE lead_id = ${leadId}`
    );
    return (result as any)?.[0]?.count || 0;
  },

  async getAllConversations(limit = 100): Promise<LeadConversation[]> {
    return db
      .select()
      .from(leadConversations)
      .orderBy(desc(leadConversations.createdAt))
      .limit(limit);
  },

  async getConversationStats(): Promise<{
    totalMessages: number;
    inboundMessages: number;
    outboundMessages: number;
    aiGeneratedMessages: number;
    leadsWithConversations: number;
  }> {
    const allConvos = await db.select().from(leadConversations);
    const uniqueLeads = new Set(allConvos.map(c => c.leadId));
    return {
      totalMessages: allConvos.length,
      inboundMessages: allConvos.filter(c => c.direction === "inbound").length,
      outboundMessages: allConvos.filter(c => c.direction === "outbound").length,
      aiGeneratedMessages: allConvos.filter(c => c.aiGenerated).length,
      leadsWithConversations: uniqueLeads.size,
    };
  },

  async getAllLeadsWithReplies(): Promise<OutreachLead[]> {
    const leadsWithInbound = await db
      .select({ leadId: leadConversations.leadId })
      .from(leadConversations)
      .where(eq(leadConversations.direction, "inbound"))
      .groupBy(leadConversations.leadId);

    if (leadsWithInbound.length === 0) return [];
    const leadIds = leadsWithInbound.map(l => l.leadId);
    return db
      .select()
      .from(outreachLeads)
      .where(inArray(outreachLeads.id, leadIds));
  },

  async getChatMessages(limit = 50): Promise<AgentChatMessage[]> {
    return db
      .select()
      .from(agentChatMessages)
      .orderBy(desc(agentChatMessages.createdAt))
      .limit(limit);
  },

  async createChatMessage(data: { role: string; content: string; metadata?: any }): Promise<AgentChatMessage> {
    const [msg] = await db.insert(agentChatMessages).values(data).returning();
    return msg;
  },

  async getLeadsSummary(): Promise<{ total: number; byStatus: Record<string, number>; topLeads: any[] }> {
    const [countResult] = await db.select({ count: sql<number>`count(*)::int` }).from(outreachLeads);
    const statusRows = await db.select({
      status: outreachLeads.status,
      count: sql<number>`count(*)::int`,
    }).from(outreachLeads).groupBy(outreachLeads.status);
    const byStatus: Record<string, number> = {};
    for (const row of statusRows) {
      byStatus[row.status] = row.count;
    }
    const topLeads = await db.select().from(outreachLeads).orderBy(desc(outreachLeads.aiScore)).limit(20);
    return {
      total: countResult.count,
      byStatus,
      topLeads: topLeads.map(l => ({
        id: l.id,
        businessName: l.businessName,
        industry: l.industry,
        email: l.email,
        contactName: l.contactName,
        status: l.status,
        aiScore: l.aiScore,
        valueEstimate: l.valueEstimate,
        notes: l.notes,
        pitchAngle: l.pitchAngle,
      })),
    };
  },

  async searchLeads(query: string): Promise<any[]> {
    const q = query.toLowerCase();
    const words = q.split(/\s+/).filter(w => w.length >= 2);
    if (words.length === 0) return [];

    const stopWords = new Set(["the", "about", "tell", "me", "what", "how", "can", "you", "are", "for", "this", "that", "with", "from", "have", "has", "our", "their", "them", "they", "been", "being", "will", "would", "could", "should", "into", "more", "some", "than", "any", "all", "each", "every", "status", "update", "lead", "leads", "review", "check", "look", "give", "get", "show", "find", "on", "is", "it", "of", "at", "to", "in", "do", "my", "an"]);
    const searchWords = words.filter(w => !stopWords.has(w));
    if (searchWords.length === 0) return [];

    const relevanceExpr = sql`(
      CASE WHEN LOWER(business_name) LIKE ${'%' + searchWords.join(' ') + '%'} THEN 100 ELSE 0 END +
      CASE WHEN LOWER(COALESCE(contact_name,'')) LIKE ${'%' + searchWords.join(' ') + '%'} THEN 80 ELSE 0 END +
      CASE WHEN LOWER(COALESCE(email,'')) LIKE ${'%' + searchWords.join(' ') + '%'} THEN 80 ELSE 0 END +
      ${sql.join(searchWords.map(word => sql`(
        CASE WHEN LOWER(business_name) LIKE ${'%' + word + '%'} THEN 10 ELSE 0 END +
        CASE WHEN LOWER(COALESCE(contact_name,'')) LIKE ${'%' + word + '%'} THEN 8 ELSE 0 END +
        CASE WHEN LOWER(COALESCE(email,'')) LIKE ${'%' + word + '%'} THEN 8 ELSE 0 END +
        CASE WHEN LOWER(COALESCE(website_url,'')) LIKE ${'%' + word + '%'} THEN 5 ELSE 0 END +
        CASE WHEN LOWER(COALESCE(industry,'')) LIKE ${'%' + word + '%'} THEN 3 ELSE 0 END
      )`), sql` + `)}
    )`;

    const conditions = searchWords.map(word =>
      sql`(LOWER(business_name) LIKE ${'%' + word + '%'} OR LOWER(COALESCE(contact_name,'')) LIKE ${'%' + word + '%'} OR LOWER(COALESCE(email,'')) LIKE ${'%' + word + '%'} OR LOWER(COALESCE(website_url,'')) LIKE ${'%' + word + '%'} OR LOWER(COALESCE(industry,'')) LIKE ${'%' + word + '%'})`
    );

    const results = await db.select({
      lead: outreachLeads,
      relevance: relevanceExpr,
    }).from(outreachLeads)
      .where(sql`${sql.join(conditions, sql` OR `)}`)
      .orderBy(desc(relevanceExpr))
      .limit(5);

    return results.map(r => ({
      id: r.lead.id,
      businessName: r.lead.businessName,
      websiteUrl: r.lead.websiteUrl,
      industry: r.lead.industry,
      contactName: r.lead.contactName,
      email: r.lead.email,
      phone: r.lead.phone,
      location: r.lead.location,
      notes: r.lead.notes,
      status: r.lead.status,
      aiScore: r.lead.aiScore,
      valueEstimate: r.lead.valueEstimate,
      pitchAngle: r.lead.pitchAngle,
      openingLine: r.lead.openingLine,
      aiAuditSummary: r.lead.aiAuditSummary,
      createdAt: r.lead.createdAt,
    }));
  },
};
