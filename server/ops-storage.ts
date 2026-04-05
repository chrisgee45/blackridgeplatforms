import {
  companies, contacts, projects, stageGates, milestones, tasks,
  timeEntries, activityLogs, projectTemplates, templateStages,
  templateGates, templateMilestones, templateTasks, scheduledFollowups,
  projectPayments, aiReports, projectDocuments,
  clients, deals, subscriptions, stripePayments, stripeEvents, paymentLinks, expenses,
  qaTemplates, qaChecklists, qaAuditLog, invoiceCounter,
  type InsertCompany, type Company,
  type InsertContactPerson, type ContactPerson,
  type InsertProject, type Project,
  type InsertStageGate, type StageGate,
  type InsertMilestone, type Milestone,
  type InsertTask, type Task,
  type InsertTimeEntry, type TimeEntry,
  type InsertActivityLog, type ActivityLog,
  type InsertProjectTemplate, type ProjectTemplate,
  type TemplateStage, type TemplateGate, type TemplateMilestone, type TemplateTask,
  type InsertScheduledFollowup, type ScheduledFollowup,
  type InsertProjectPayment, type ProjectPayment,
  type InsertAiReport, type AiReport,
  type InsertProjectDocument, type ProjectDocument,
  type InsertClient, type Client,
  type InsertDeal, type Deal,
  type InsertSubscription, type Subscription,
  type InsertStripePayment, type StripePayment,
  type InsertStripeEvent, type StripeEvent,
  type InsertPaymentLink, type PaymentLink,
  type InsertQaTemplate, type QaTemplate,
  type InsertQaChecklist, type QaChecklist,
  type InsertQaAuditLog, type QaAuditLog,
} from "@shared/schema";
import { db } from "./db";
import { eq, desc, asc, and, sql, inArray } from "drizzle-orm";

export class OpsStorage {
  async getCompanies(): Promise<Company[]> {
    return db.select().from(companies).orderBy(asc(companies.name));
  }

  async getCompany(id: string): Promise<Company | undefined> {
    const [company] = await db.select().from(companies).where(eq(companies.id, id));
    return company;
  }

  async createCompany(data: InsertCompany): Promise<Company> {
    const [company] = await db.insert(companies).values(data).returning();
    return company;
  }

  async updateCompany(id: string, data: Partial<InsertCompany>): Promise<Company | undefined> {
    const [company] = await db.update(companies).set({ ...data, updatedAt: new Date() }).where(eq(companies.id, id)).returning();
    return company;
  }

  async deleteCompany(id: string): Promise<boolean> {
    await db.update(contacts).set({ companyId: null }).where(eq(contacts.companyId, id));
    await db.update(projects).set({ companyId: null }).where(eq(projects.companyId, id));
    await db.update(clients).set({ companyId: null }).where(eq(clients.companyId, id));
    const result = await db.delete(companies).where(eq(companies.id, id)).returning();
    return result.length > 0;
  }

  async getContacts(companyId?: string): Promise<ContactPerson[]> {
    if (companyId) {
      return db.select().from(contacts).where(eq(contacts.companyId, companyId)).orderBy(asc(contacts.name));
    }
    return db.select().from(contacts).orderBy(asc(contacts.name));
  }

  async getContact(id: string): Promise<ContactPerson | undefined> {
    const [contact] = await db.select().from(contacts).where(eq(contacts.id, id));
    return contact;
  }

  async createContact(data: InsertContactPerson): Promise<ContactPerson> {
    const [contact] = await db.insert(contacts).values(data).returning();
    return contact;
  }

  async updateContact(id: string, data: Partial<InsertContactPerson>): Promise<ContactPerson | undefined> {
    const [contact] = await db.update(contacts).set(data).where(eq(contacts.id, id)).returning();
    return contact;
  }

  async deleteContact(id: string): Promise<boolean> {
    const result = await db.delete(contacts).where(eq(contacts.id, id)).returning();
    return result.length > 0;
  }

  async getProjects(): Promise<Project[]> {
    return db.select().from(projects).orderBy(desc(projects.updatedAt));
  }

  async getProject(id: string): Promise<Project | undefined> {
    const [project] = await db.select().from(projects).where(eq(projects.id, id));
    return project;
  }

  async createProject(data: InsertProject): Promise<Project> {
    const [project] = await db.insert(projects).values({ ...data, stageChangedAt: new Date() }).returning();
    return project;
  }

  async updateProject(id: string, data: Partial<InsertProject> & { updatedAt?: Date }): Promise<Project | undefined> {
    const [project] = await db.update(projects).set({ ...data, updatedAt: new Date() }).where(eq(projects.id, id)).returning();
    return project;
  }

  async deleteProject(id: string): Promise<boolean> {
    await db.delete(timeEntries).where(eq(timeEntries.projectId, id));
    await db.delete(stageGates).where(eq(stageGates.projectId, id));
    await db.delete(milestones).where(eq(milestones.projectId, id));
    await db.delete(tasks).where(eq(tasks.projectId, id));
    await db.delete(activityLogs).where(eq(activityLogs.projectId, id));
    await db.delete(projectPayments).where(eq(projectPayments.projectId, id));
    await db.delete(projectDocuments).where(eq(projectDocuments.projectId, id));
    await db.update(deals).set({ projectId: null }).where(eq(deals.projectId, id));
    await db.update(subscriptions).set({ projectId: null }).where(eq(subscriptions.projectId, id));
    await db.update(stripePayments).set({ projectId: null }).where(eq(stripePayments.projectId, id));
    await db.update(paymentLinks).set({ projectId: null }).where(eq(paymentLinks.projectId, id));
    const result = await db.delete(projects).where(eq(projects.id, id)).returning();
    return result.length > 0;
  }

  async getStageGates(projectId: string, stageName?: string): Promise<StageGate[]> {
    const conditions = [eq(stageGates.projectId, projectId)];
    if (stageName) {
      conditions.push(eq(stageGates.stageName, stageName as any));
    }
    return db.select().from(stageGates).where(and(...conditions)).orderBy(asc(stageGates.sortOrder));
  }

  async createStageGate(data: InsertStageGate): Promise<StageGate> {
    const [gate] = await db.insert(stageGates).values(data).returning();
    return gate;
  }

  async updateStageGate(id: string, data: { isCompleted?: boolean; completedAt?: Date | null }): Promise<StageGate | undefined> {
    const [gate] = await db.update(stageGates).set(data).where(eq(stageGates.id, id)).returning();
    return gate;
  }

  async deleteStageGate(id: string): Promise<boolean> {
    const result = await db.delete(stageGates).where(eq(stageGates.id, id)).returning();
    return result.length > 0;
  }

  async getMilestones(projectId: string): Promise<Milestone[]> {
    return db.select().from(milestones).where(eq(milestones.projectId, projectId)).orderBy(asc(milestones.sortOrder));
  }

  async createMilestone(data: InsertMilestone): Promise<Milestone> {
    const [milestone] = await db.insert(milestones).values(data).returning();
    return milestone;
  }

  async updateMilestone(id: string, data: Partial<InsertMilestone>): Promise<Milestone | undefined> {
    const [milestone] = await db.update(milestones).set(data).where(eq(milestones.id, id)).returning();
    return milestone;
  }

  async deleteMilestone(id: string): Promise<boolean> {
    const result = await db.delete(milestones).where(eq(milestones.id, id)).returning();
    return result.length > 0;
  }

  async getTasks(projectId?: string): Promise<Task[]> {
    if (projectId) {
      return db.select().from(tasks).where(eq(tasks.projectId, projectId)).orderBy(asc(tasks.sortOrder));
    }
    return db.select().from(tasks).orderBy(asc(tasks.sortOrder));
  }

  async getAllTasks(): Promise<Task[]> {
    return db.select().from(tasks).orderBy(sql`${tasks.dueDate} ASC NULLS LAST`);
  }

  async getTask(id: string): Promise<Task | undefined> {
    const [task] = await db.select().from(tasks).where(eq(tasks.id, id));
    return task;
  }

  async createTask(data: InsertTask): Promise<Task> {
    const [task] = await db.insert(tasks).values(data).returning();
    return task;
  }

  async updateTask(id: string, data: Partial<InsertTask>): Promise<Task | undefined> {
    const [task] = await db.update(tasks).set(data).where(eq(tasks.id, id)).returning();
    return task;
  }

  async deleteTask(id: string): Promise<boolean> {
    const result = await db.delete(tasks).where(eq(tasks.id, id)).returning();
    return result.length > 0;
  }

  async getTimeEntries(projectId: string): Promise<TimeEntry[]> {
    return db.select().from(timeEntries).where(eq(timeEntries.projectId, projectId)).orderBy(desc(timeEntries.date));
  }

  async createTimeEntry(data: InsertTimeEntry): Promise<TimeEntry> {
    const [entry] = await db.insert(timeEntries).values(data).returning();
    return entry;
  }

  async updateTimeEntry(id: string, data: Partial<InsertTimeEntry>): Promise<TimeEntry | undefined> {
    const [entry] = await db.update(timeEntries).set(data).where(eq(timeEntries.id, id)).returning();
    return entry;
  }

  async deleteTimeEntry(id: string): Promise<boolean> {
    const result = await db.delete(timeEntries).where(eq(timeEntries.id, id)).returning();
    return result.length > 0;
  }

  async getActivityLogs(projectId?: string, entityType?: string, entityId?: string, limit?: number): Promise<ActivityLog[]> {
    const conditions: any[] = [];
    if (projectId) conditions.push(eq(activityLogs.projectId, projectId));
    if (entityType) conditions.push(eq(activityLogs.entityType, entityType));
    if (entityId) conditions.push(eq(activityLogs.entityId, entityId));

    const query = conditions.length > 0
      ? db.select().from(activityLogs).where(and(...conditions)).orderBy(desc(activityLogs.createdAt)).limit(limit || 50)
      : db.select().from(activityLogs).orderBy(desc(activityLogs.createdAt)).limit(limit || 50);

    return query;
  }

  async createActivityLog(data: InsertActivityLog): Promise<ActivityLog> {
    const [log] = await db.insert(activityLogs).values(data).returning();
    return log;
  }

  async getTemplates(): Promise<ProjectTemplate[]> {
    return db.select().from(projectTemplates).orderBy(asc(projectTemplates.name));
  }

  async getTemplate(id: string): Promise<ProjectTemplate | undefined> {
    const [template] = await db.select().from(projectTemplates).where(eq(projectTemplates.id, id));
    return template;
  }

  async createTemplate(data: InsertProjectTemplate): Promise<ProjectTemplate> {
    const [template] = await db.insert(projectTemplates).values(data).returning();
    return template;
  }

  async getTemplateStages(templateId: string): Promise<TemplateStage[]> {
    return db.select().from(templateStages).where(eq(templateStages.templateId, templateId)).orderBy(asc(templateStages.stageOrder));
  }

  async getTemplateGates(templateStageId: string): Promise<TemplateGate[]> {
    return db.select().from(templateGates).where(eq(templateGates.templateStageId, templateStageId)).orderBy(asc(templateGates.sortOrder));
  }

  async getTemplateMilestones(templateId: string): Promise<TemplateMilestone[]> {
    return db.select().from(templateMilestones).where(eq(templateMilestones.templateId, templateId)).orderBy(asc(templateMilestones.sortOrder));
  }

  async getTemplateTasks(templateId: string): Promise<TemplateTask[]> {
    return db.select().from(templateTasks).where(eq(templateTasks.templateId, templateId)).orderBy(asc(templateTasks.sortOrder));
  }

  async getAllTemplateGatesForTemplate(templateId: string): Promise<(TemplateGate & { stageName: string })[]> {
    const rows = await db
      .select({
        id: templateGates.id,
        templateStageId: templateGates.templateStageId,
        stageName: templateGates.stageName,
        title: templateGates.title,
        description: templateGates.description,
        sortOrder: templateGates.sortOrder,
      })
      .from(templateGates)
      .innerJoin(templateStages, eq(templateGates.templateStageId, templateStages.id))
      .where(eq(templateStages.templateId, templateId))
      .orderBy(asc(templateStages.stageOrder), asc(templateGates.sortOrder));

    return rows as any;
  }

  async getScheduledFollowups(entityType?: string, entityId?: string, status?: string): Promise<ScheduledFollowup[]> {
    const conditions: any[] = [];
    if (entityType) conditions.push(eq(scheduledFollowups.entityType, entityType));
    if (entityId) conditions.push(eq(scheduledFollowups.entityId, entityId));
    if (status) conditions.push(eq(scheduledFollowups.status, status));

    if (conditions.length > 0) {
      return db.select().from(scheduledFollowups).where(and(...conditions)).orderBy(asc(scheduledFollowups.scheduledFor));
    }
    return db.select().from(scheduledFollowups).orderBy(asc(scheduledFollowups.scheduledFor));
  }

  async createScheduledFollowup(data: InsertScheduledFollowup): Promise<ScheduledFollowup> {
    const [followup] = await db.insert(scheduledFollowups).values(data).returning();
    return followup;
  }

  async updateScheduledFollowup(id: string, data: { status?: string; completedAt?: Date | null }): Promise<ScheduledFollowup | undefined> {
    const [followup] = await db.update(scheduledFollowups).set(data).where(eq(scheduledFollowups.id, id)).returning();
    return followup;
  }

  async cancelPendingFollowupsForEntity(entityType: string, entityId: string): Promise<number> {
    const result = await db.update(scheduledFollowups)
      .set({ status: "cancelled", completedAt: new Date() })
      .where(and(
        eq(scheduledFollowups.entityType, entityType),
        eq(scheduledFollowups.entityId, entityId),
        eq(scheduledFollowups.status, "pending")
      ))
      .returning();
    return result.length;
  }

  async getProjectPayments(projectId: string): Promise<ProjectPayment[]> {
    return db.select().from(projectPayments).where(eq(projectPayments.projectId, projectId)).orderBy(asc(projectPayments.createdAt));
  }

  async createProjectPayment(data: InsertProjectPayment): Promise<ProjectPayment> {
    const [payment] = await db.insert(projectPayments).values(data).returning();
    return payment;
  }

  async updateProjectPayment(id: string, data: Partial<InsertProjectPayment>): Promise<ProjectPayment | undefined> {
    const [payment] = await db.update(projectPayments).set(data).where(eq(projectPayments.id, id)).returning();
    return payment;
  }

  async deleteProjectPayment(id: string): Promise<boolean> {
    const result = await db.delete(projectPayments).where(eq(projectPayments.id, id)).returning();
    return result.length > 0;
  }

  async getOverduePayments(): Promise<ProjectPayment[]> {
    const now = new Date();
    return db.select().from(projectPayments)
      .where(and(
        eq(projectPayments.status, "pending"),
      ))
      .orderBy(asc(projectPayments.dueDate));
  }
  async getAiReports(type?: string): Promise<AiReport[]> {
    if (type) {
      return db.select().from(aiReports).where(eq(aiReports.type, type)).orderBy(desc(aiReports.generatedAt));
    }
    return db.select().from(aiReports).orderBy(desc(aiReports.generatedAt));
  }

  async getAiReport(id: string): Promise<AiReport | undefined> {
    const [report] = await db.select().from(aiReports).where(eq(aiReports.id, id));
    return report;
  }

  async createAiReport(data: InsertAiReport): Promise<AiReport> {
    const [report] = await db.insert(aiReports).values(data).returning();
    return report;
  }

  async deleteAiReport(id: string): Promise<boolean> {
    const result = await db.delete(aiReports).where(eq(aiReports.id, id)).returning();
    return result.length > 0;
  }

  async getProjectDocuments(projectId: string, category?: string): Promise<ProjectDocument[]> {
    if (category) {
      return db.select().from(projectDocuments)
        .where(and(eq(projectDocuments.projectId, projectId), eq(projectDocuments.category, category)))
        .orderBy(desc(projectDocuments.createdAt));
    }
    return db.select().from(projectDocuments)
      .where(eq(projectDocuments.projectId, projectId))
      .orderBy(desc(projectDocuments.createdAt));
  }

  async getProjectDocument(id: string): Promise<ProjectDocument | undefined> {
    const [doc] = await db.select().from(projectDocuments).where(eq(projectDocuments.id, id));
    return doc;
  }

  async createProjectDocument(data: InsertProjectDocument): Promise<ProjectDocument> {
    const [doc] = await db.insert(projectDocuments).values(data).returning();
    return doc;
  }

  async updateProjectDocument(id: string, data: Partial<InsertProjectDocument>): Promise<ProjectDocument | undefined> {
    const [doc] = await db.update(projectDocuments).set(data).where(eq(projectDocuments.id, id)).returning();
    return doc;
  }

  async deleteProjectDocument(id: string): Promise<boolean> {
    const result = await db.delete(projectDocuments).where(eq(projectDocuments.id, id)).returning();
    return result.length > 0;
  }

  // === Client Revenue System ===

  async getClients(): Promise<Client[]> {
    return db.select().from(clients).orderBy(desc(clients.createdAt));
  }

  async getClient(id: string): Promise<Client | undefined> {
    const [client] = await db.select().from(clients).where(eq(clients.id, id));
    return client;
  }

  async findClientByCompanyId(companyId: string): Promise<Client | undefined> {
    const [client] = await db.select().from(clients).where(eq(clients.companyId, companyId));
    return client;
  }

  async findClientByName(name: string): Promise<Client | undefined> {
    const [client] = await db.select().from(clients).where(eq(clients.name, name));
    return client;
  }

  async createClient(data: InsertClient): Promise<Client> {
    const [client] = await db.insert(clients).values(data).returning();
    return client;
  }

  async updateClient(id: string, data: Partial<InsertClient>): Promise<Client | undefined> {
    const [client] = await db.update(clients).set(data).where(eq(clients.id, id)).returning();
    return client;
  }

  async deleteClient(id: string): Promise<boolean> {
    await db.delete(paymentLinks).where(eq(paymentLinks.clientId, id));
    await db.delete(stripePayments).where(eq(stripePayments.clientId, id));
    await db.delete(subscriptions).where(eq(subscriptions.clientId, id));
    await db.delete(deals).where(eq(deals.clientId, id));
    await db.update(stripeEvents).set({ clientId: null }).where(eq(stripeEvents.clientId, id));
    await db.update(expenses).set({ clientId: null }).where(eq(expenses.clientId, id));
    await db.update(projects).set({ clientId: null }).where(eq(projects.clientId, id));
    const result = await db.delete(clients).where(eq(clients.id, id)).returning();
    return result.length > 0;
  }

  async getDeals(clientId?: string): Promise<Deal[]> {
    if (clientId) {
      return db.select().from(deals).where(eq(deals.clientId, clientId)).orderBy(desc(deals.createdAt));
    }
    return db.select().from(deals).orderBy(desc(deals.createdAt));
  }

  async getDeal(id: string): Promise<Deal | undefined> {
    const [deal] = await db.select().from(deals).where(eq(deals.id, id));
    return deal;
  }

  async createDeal(data: InsertDeal): Promise<Deal> {
    const [deal] = await db.insert(deals).values(data).returning();
    return deal;
  }

  async updateDeal(id: string, data: Partial<InsertDeal>): Promise<Deal | undefined> {
    const [deal] = await db.update(deals).set(data).where(eq(deals.id, id)).returning();
    return deal;
  }

  async deleteDeal(id: string): Promise<boolean> {
    const result = await db.delete(deals).where(eq(deals.id, id)).returning();
    return result.length > 0;
  }

  async getSubscriptions(clientId?: string): Promise<Subscription[]> {
    if (clientId) {
      return db.select().from(subscriptions).where(eq(subscriptions.clientId, clientId)).orderBy(desc(subscriptions.createdAt));
    }
    return db.select().from(subscriptions).orderBy(desc(subscriptions.createdAt));
  }

  async getSubscription(id: string): Promise<Subscription | undefined> {
    const [sub] = await db.select().from(subscriptions).where(eq(subscriptions.id, id));
    return sub;
  }

  async findSubscriptionByStripeId(stripeSubId: string): Promise<Subscription | undefined> {
    const [sub] = await db.select().from(subscriptions).where(eq(subscriptions.stripeSubscriptionId, stripeSubId));
    return sub;
  }

  async createSubscription(data: InsertSubscription): Promise<Subscription> {
    const [sub] = await db.insert(subscriptions).values(data).returning();
    return sub;
  }

  async updateSubscription(id: string, data: Partial<InsertSubscription>): Promise<Subscription | undefined> {
    const [sub] = await db.update(subscriptions).set(data).where(eq(subscriptions.id, id)).returning();
    return sub;
  }

  async deleteSubscription(id: string): Promise<boolean> {
    const result = await db.delete(subscriptions).where(eq(subscriptions.id, id)).returning();
    return result.length > 0;
  }

  async getStripePayments(clientId?: string): Promise<StripePayment[]> {
    if (clientId) {
      return db.select().from(stripePayments).where(eq(stripePayments.clientId, clientId)).orderBy(desc(stripePayments.createdAt));
    }
    return db.select().from(stripePayments).orderBy(desc(stripePayments.createdAt));
  }

  async createStripePayment(data: InsertStripePayment): Promise<StripePayment> {
    const [payment] = await db.insert(stripePayments).values(data).returning();
    return payment;
  }

  async getStripeEvents(clientId?: string): Promise<StripeEvent[]> {
    if (clientId) {
      return db.select().from(stripeEvents).where(eq(stripeEvents.clientId, clientId)).orderBy(desc(stripeEvents.processedAt));
    }
    return db.select().from(stripeEvents).orderBy(desc(stripeEvents.processedAt));
  }

  async findStripeEvent(stripeEventId: string): Promise<StripeEvent | undefined> {
    const [event] = await db.select().from(stripeEvents).where(eq(stripeEvents.stripeEventId, stripeEventId));
    return event;
  }

  async createStripeEvent(data: InsertStripeEvent): Promise<StripeEvent> {
    const [event] = await db.insert(stripeEvents).values(data).returning();
    return event;
  }

  async getClientProjects(clientId: string): Promise<Project[]> {
    return db.select().from(projects).where(eq(projects.clientId, clientId)).orderBy(desc(projects.updatedAt));
  }

  async recalculateClientMrr(clientId: string): Promise<Client | undefined> {
    const activeSubs = await db.select().from(subscriptions)
      .where(and(eq(subscriptions.clientId, clientId), eq(subscriptions.status, "active")));

    let totalMrr = 0;
    for (const sub of activeSubs) {
      const amount = parseFloat(sub.amount);
      if (sub.interval === "monthly") totalMrr += amount;
      else if (sub.interval === "quarterly") totalMrr += amount / 3;
      else if (sub.interval === "annual") totalMrr += amount / 12;
    }

    return this.updateClient(clientId, { mrr: totalMrr.toFixed(2) });
  }

  async createPaymentLink(data: InsertPaymentLink): Promise<PaymentLink> {
    const [link] = await db.insert(paymentLinks).values(data).returning();
    return link;
  }

  async getPaymentLinkByToken(token: string): Promise<PaymentLink | undefined> {
    const [link] = await db.select().from(paymentLinks).where(eq(paymentLinks.token, token));
    return link;
  }

  async updatePaymentLink(id: string, data: Partial<InsertPaymentLink>): Promise<PaymentLink | undefined> {
    const [link] = await db.update(paymentLinks).set(data).where(eq(paymentLinks.id, id)).returning();
    return link;
  }

  async claimPaymentLink(id: string, paymentId: string): Promise<PaymentLink | undefined> {
    const result = await db.update(paymentLinks)
      .set({ status: "paid", paidAt: new Date(), stripePaymentId: paymentId })
      .where(and(eq(paymentLinks.id, id), eq(paymentLinks.status, "pending")))
      .returning();
    return result[0];
  }

  async getClientPaymentLinks(clientId: string): Promise<PaymentLink[]> {
    return db.select().from(paymentLinks).where(eq(paymentLinks.clientId, clientId)).orderBy(desc(paymentLinks.createdAt));
  }

  async getQaTemplates(projectType?: string): Promise<QaTemplate[]> {
    if (projectType) {
      return db.select().from(qaTemplates)
        .where(eq(qaTemplates.projectType, projectType as any))
        .orderBy(asc(qaTemplates.sortOrder));
    }
    return db.select().from(qaTemplates).orderBy(asc(qaTemplates.projectType), asc(qaTemplates.sortOrder));
  }

  async createQaTemplate(data: InsertQaTemplate): Promise<QaTemplate> {
    const [t] = await db.insert(qaTemplates).values(data).returning();
    return t;
  }

  async updateQaTemplate(id: string, data: Partial<InsertQaTemplate>): Promise<QaTemplate | undefined> {
    const [t] = await db.update(qaTemplates).set(data).where(eq(qaTemplates.id, id)).returning();
    return t;
  }

  async deleteQaTemplate(id: string): Promise<boolean> {
    const result = await db.delete(qaTemplates).where(eq(qaTemplates.id, id)).returning();
    return result.length > 0;
  }

  async initializeQaChecklist(projectId: string, projectType: string): Promise<QaChecklist[]> {
    const templates = await this.getQaTemplates(projectType);
    if (templates.length === 0) return [];
    const existing = await db.select().from(qaChecklists).where(eq(qaChecklists.projectId, projectId)).limit(1);
    if (existing.length > 0) return this.getQaChecklist(projectId);
    const rows = templates.map(t => ({
      projectId,
      projectType: t.projectType,
      category: t.category,
      itemDescription: t.itemDescription,
      sortOrder: t.sortOrder ?? 0,
    }));
    const inserted = await db.insert(qaChecklists).values(rows).returning();
    return inserted;
  }

  async getQaChecklist(projectId: string): Promise<QaChecklist[]> {
    return db.select().from(qaChecklists)
      .where(eq(qaChecklists.projectId, projectId))
      .orderBy(asc(qaChecklists.sortOrder), asc(qaChecklists.createdAt));
  }

  async updateQaChecklistItem(id: string, data: Partial<InsertQaChecklist>): Promise<QaChecklist | undefined> {
    const [item] = await db.update(qaChecklists)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(qaChecklists.id, id))
      .returning();
    return item;
  }

  async deleteQaChecklistItem(id: string): Promise<boolean> {
    const result = await db.delete(qaChecklists).where(eq(qaChecklists.id, id)).returning();
    return result.length > 0;
  }

  async addQaChecklistItem(data: InsertQaChecklist): Promise<QaChecklist> {
    const [item] = await db.insert(qaChecklists).values(data).returning();
    return item;
  }

  async getQaScore(projectId: string): Promise<{ total: number; passed: number; score: number }> {
    const items = await db.select({ status: qaChecklists.status })
      .from(qaChecklists)
      .where(eq(qaChecklists.projectId, projectId));
    const total = items.length;
    const passed = items.filter(i => i.status === "pass").length;
    const score = total > 0 ? Math.floor((passed / total) * 10000) / 100 : 0;
    return { total, passed, score };
  }

  async createQaAuditEntry(data: InsertQaAuditLog): Promise<QaAuditLog> {
    const [entry] = await db.insert(qaAuditLog).values(data).returning();
    return entry;
  }

  async getQaAuditLog(projectId: string): Promise<QaAuditLog[]> {
    return db.select().from(qaAuditLog)
      .where(eq(qaAuditLog.projectId, projectId))
      .orderBy(desc(qaAuditLog.changedAt));
  }

  async getQaChecklistItem(id: string): Promise<QaChecklist | undefined> {
    const [item] = await db.select().from(qaChecklists).where(eq(qaChecklists.id, id));
    return item;
  }
  async getNextInvoiceNumber(): Promise<string> {
    const result = await db.execute(
      sql`UPDATE invoice_counter SET next_number = next_number + 1 WHERE id = 1 RETURNING next_number - 1 AS current_number`
    );
    const rows = result.rows as any[];
    if (rows.length === 0) {
      await db.insert(invoiceCounter).values({ id: 1, nextNumber: 303 });
      return "INV-302";
    }
    return `INV-${rows[0].current_number}`;
  }

  async ensureInvoiceCounter(): Promise<void> {
    const existing = await db.select().from(invoiceCounter).limit(1);
    if (existing.length === 0) {
      await db.insert(invoiceCounter).values({ id: 1, nextNumber: 302 });
    }
  }
}

export const opsStorage = new OpsStorage();
