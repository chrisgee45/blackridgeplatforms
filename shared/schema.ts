import { sql } from "drizzle-orm";
import { pgTable, text, varchar, timestamp, integer, boolean, jsonb, pgEnum, numeric, index, uniqueIndex, serial, real } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export * from "./models/auth";
export * from "./models/chat";

export const contactSubmissions = pgTable("contact_submissions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  email: text("email").notNull(),
  company: text("company"),
  projectType: text("project_type"),
  budget: text("budget"),
  message: text("message").notNull(),
  status: text("status").notNull().default("new"),
  priority: text("priority").notNull().default("medium"),
  notes: text("notes"),
  assignedTo: text("assigned_to"),
  projectedValue: integer("projected_value"),
  closeProbability: integer("close_probability"),
  leadSource: text("lead_source"),
  followUpDate: timestamp("follow_up_date"),
  lastContactedAt: timestamp("last_contacted_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertContactSchema = createInsertSchema(contactSubmissions).omit({
  id: true,
  status: true,
  priority: true,
  notes: true,
  assignedTo: true,
  projectedValue: true,
  closeProbability: true,
  leadSource: true,
  followUpDate: true,
  lastContactedAt: true,
  createdAt: true,
  updatedAt: true,
});

export const createLeadSchema = z.object({
  name: z.string().min(2, "Name is required"),
  email: z.string().email("Valid email required"),
  company: z.string().optional(),
  projectType: z.string().optional(),
  budget: z.string().optional(),
  message: z.string().min(1, "Message is required"),
  status: z.enum(["new", "contacted", "qualified", "proposal", "negotiation", "won", "lost"]).optional(),
  priority: z.enum(["low", "medium", "high", "urgent"]).optional(),
  projectedValue: z.number().int().min(0).optional(),
  closeProbability: z.number().int().min(0).max(100).optional(),
  leadSource: z.string().optional(),
  followUpDate: z.string().optional(),
});

export const updateLeadSchema = z.object({
  name: z.string().min(2).optional(),
  email: z.string().email().optional(),
  company: z.string().nullable().optional(),
  projectType: z.string().nullable().optional(),
  budget: z.string().nullable().optional(),
  message: z.string().min(1).optional(),
  status: z.enum(["new", "contacted", "qualified", "proposal", "negotiation", "won", "lost"]).optional(),
  priority: z.enum(["low", "medium", "high", "urgent"]).optional(),
  notes: z.string().optional(),
  assignedTo: z.string().optional(),
  projectedValue: z.number().int().min(0).nullable().optional(),
  closeProbability: z.number().int().min(0).max(100).nullable().optional(),
  leadSource: z.string().nullable().optional(),
  followUpDate: z.string().nullable().optional(),
  lastContactedAt: z.string().nullable().optional(),
});

export type InsertContact = z.infer<typeof insertContactSchema>;
export type CreateLead = z.infer<typeof createLeadSchema>;
export type UpdateLead = z.infer<typeof updateLeadSchema>;
export type ContactSubmission = typeof contactSubmissions.$inferSelect;

export const projectStageEnum = pgEnum("project_stage", [
  "discovery", "proposal", "contract", "kickoff",
  "in_progress", "review", "completed", "archived"
]);

export const projectStageZod = z.enum([
  "discovery", "proposal", "contract", "kickoff",
  "in_progress", "review", "completed", "archived"
]);
export type ProjectStage = z.infer<typeof projectStageZod>;

export const companies = pgTable("companies", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  domain: text("domain"),
  industry: text("industry"),
  size: text("size"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const contacts = pgTable("contacts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").references(() => companies.id),
  name: text("name").notNull(),
  email: text("email"),
  phone: text("phone"),
  role: text("role"),
  isPrimary: boolean("is_primary").default(false),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const projects = pgTable("projects", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").references(() => companies.id),
  contactId: varchar("contact_id").references(() => contacts.id),
  leadId: varchar("lead_id").references(() => contactSubmissions.id),
  clientId: varchar("client_id"),
  name: text("name").notNull(),
  description: text("description"),
  stage: projectStageEnum("stage").notNull().default("discovery"),
  stageChangedAt: timestamp("stage_changed_at").defaultNow(),
  contractValue: integer("contract_value"),
  hourlyRate: integer("hourly_rate"),
  estimatedHours: integer("estimated_hours"),
  waitingOnClient: boolean("waiting_on_client").default(false),
  blocker: text("blocker"),
  blockerSince: timestamp("blocker_since"),
  templateId: varchar("template_id"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const stageGates = pgTable("stage_gates", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").references(() => projects.id).notNull(),
  stageName: projectStageEnum("stage_name").notNull(),
  title: text("title").notNull(),
  description: text("description"),
  isCompleted: boolean("is_completed").default(false),
  completedAt: timestamp("completed_at"),
  sortOrder: integer("sort_order").default(0),
});

export const milestones = pgTable("milestones", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").references(() => projects.id).notNull(),
  title: text("title").notNull(),
  dueDate: timestamp("due_date"),
  completedAt: timestamp("completed_at"),
  sortOrder: integer("sort_order").default(0),
});

export const tasks = pgTable("tasks", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").references(() => projects.id).notNull(),
  milestoneId: varchar("milestone_id").references(() => milestones.id),
  title: text("title").notNull(),
  description: text("description"),
  status: text("status").notNull().default("todo"),
  priority: text("priority").notNull().default("medium"),
  assignedTo: text("assigned_to"),
  dueDate: timestamp("due_date"),
  completedAt: timestamp("completed_at"),
  sortOrder: integer("sort_order").default(0),
  createdAt: timestamp("created_at").defaultNow(),
});

export const timeEntries = pgTable("time_entries", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").references(() => projects.id).notNull(),
  taskId: varchar("task_id").references(() => tasks.id),
  description: text("description"),
  minutes: integer("minutes").notNull(),
  billable: boolean("billable").default(true),
  date: timestamp("date").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const activityLogs = pgTable("activity_logs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  entityType: text("entity_type").notNull(),
  entityId: varchar("entity_id").notNull(),
  projectId: varchar("project_id").references(() => projects.id),
  action: text("action").notNull(),
  details: jsonb("details"),
  createdBy: text("created_by").default("system"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const projectTemplates = pgTable("project_templates", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  description: text("description"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const templateStages = pgTable("template_stages", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  templateId: varchar("template_id").references(() => projectTemplates.id).notNull(),
  stageName: projectStageEnum("stage_name").notNull(),
  stageOrder: integer("stage_order").notNull(),
});

export const templateGates = pgTable("template_gates", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  templateStageId: varchar("template_stage_id").references(() => templateStages.id).notNull(),
  stageName: projectStageEnum("stage_name").notNull(),
  title: text("title").notNull(),
  description: text("description"),
  sortOrder: integer("sort_order").default(0),
});

export const templateMilestones = pgTable("template_milestones", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  templateId: varchar("template_id").references(() => projectTemplates.id).notNull(),
  title: text("title").notNull(),
  defaultDaysOffset: integer("default_days_offset").notNull().default(0),
  sortOrder: integer("sort_order").default(0),
});

export const templateTasks = pgTable("template_tasks", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  templateId: varchar("template_id").references(() => projectTemplates.id).notNull(),
  templateMilestoneId: varchar("template_milestone_id").references(() => templateMilestones.id),
  title: text("title").notNull(),
  description: text("description"),
  priority: text("priority").default("medium"),
  defaultDaysOffset: integer("default_days_offset").notNull().default(0),
  sortOrder: integer("sort_order").default(0),
});

export const files = pgTable("files", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  entityType: text("entity_type").notNull(),
  entityId: varchar("entity_id").notNull(),
  fileName: text("file_name").notNull(),
  filePath: text("file_path").notNull(),
  fileSize: integer("file_size"),
  uploadedAt: timestamp("uploaded_at").defaultNow(),
});

export const secureNotes = pgTable("secure_notes", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  entityType: text("entity_type").notNull(),
  entityId: varchar("entity_id").notNull(),
  title: text("title").notNull(),
  encryptedContent: text("encrypted_content").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const scheduledFollowups = pgTable("scheduled_followups", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  entityType: text("entity_type").notNull(),
  entityId: varchar("entity_id").notNull(),
  scheduledFor: timestamp("scheduled_for").notNull(),
  type: text("type").notNull(),
  status: text("status").notNull().default("pending"),
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertCompanySchema = createInsertSchema(companies).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertCompany = z.infer<typeof insertCompanySchema>;
export type Company = typeof companies.$inferSelect;

export const insertContactPersonSchema = createInsertSchema(contacts).omit({
  id: true,
  createdAt: true,
});
export type InsertContactPerson = z.infer<typeof insertContactPersonSchema>;
export type ContactPerson = typeof contacts.$inferSelect;

export const insertProjectSchema = createInsertSchema(projects).omit({
  id: true,
  stageChangedAt: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertProject = z.infer<typeof insertProjectSchema>;
export type Project = typeof projects.$inferSelect;

export const insertStageGateSchema = createInsertSchema(stageGates).omit({
  id: true,
  completedAt: true,
});
export type InsertStageGate = z.infer<typeof insertStageGateSchema>;
export type StageGate = typeof stageGates.$inferSelect;

export const insertMilestoneSchema = createInsertSchema(milestones).omit({
  id: true,
  completedAt: true,
});
export type InsertMilestone = z.infer<typeof insertMilestoneSchema>;
export type Milestone = typeof milestones.$inferSelect;

export const insertTaskSchema = createInsertSchema(tasks).omit({
  id: true,
  completedAt: true,
  createdAt: true,
});
export type InsertTask = z.infer<typeof insertTaskSchema>;
export type Task = typeof tasks.$inferSelect;

export const insertTimeEntrySchema = createInsertSchema(timeEntries).omit({
  id: true,
  createdAt: true,
});
export type InsertTimeEntry = z.infer<typeof insertTimeEntrySchema>;
export type TimeEntry = typeof timeEntries.$inferSelect;

export const insertActivityLogSchema = createInsertSchema(activityLogs).omit({
  id: true,
  createdAt: true,
});
export type InsertActivityLog = z.infer<typeof insertActivityLogSchema>;
export type ActivityLog = typeof activityLogs.$inferSelect;

export const insertProjectTemplateSchema = createInsertSchema(projectTemplates).omit({
  id: true,
  createdAt: true,
});
export type InsertProjectTemplate = z.infer<typeof insertProjectTemplateSchema>;
export type ProjectTemplate = typeof projectTemplates.$inferSelect;

export const insertTemplateStageSchema = createInsertSchema(templateStages).omit({
  id: true,
});
export type InsertTemplateStage = z.infer<typeof insertTemplateStageSchema>;
export type TemplateStage = typeof templateStages.$inferSelect;

export const insertTemplateGateSchema = createInsertSchema(templateGates).omit({
  id: true,
});
export type InsertTemplateGate = z.infer<typeof insertTemplateGateSchema>;
export type TemplateGate = typeof templateGates.$inferSelect;

export const insertTemplateMilestoneSchema = createInsertSchema(templateMilestones).omit({
  id: true,
});
export type InsertTemplateMilestone = z.infer<typeof insertTemplateMilestoneSchema>;
export type TemplateMilestone = typeof templateMilestones.$inferSelect;

export const insertTemplateTaskSchema = createInsertSchema(templateTasks).omit({
  id: true,
});
export type InsertTemplateTask = z.infer<typeof insertTemplateTaskSchema>;
export type TemplateTask = typeof templateTasks.$inferSelect;

export const insertFileSchema = createInsertSchema(files).omit({
  id: true,
  uploadedAt: true,
});
export type InsertFile = z.infer<typeof insertFileSchema>;
export type FileRecord = typeof files.$inferSelect;

export const insertSecureNoteSchema = createInsertSchema(secureNotes).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertSecureNote = z.infer<typeof insertSecureNoteSchema>;
export type SecureNote = typeof secureNotes.$inferSelect;

export const insertScheduledFollowupSchema = createInsertSchema(scheduledFollowups).omit({
  id: true,
  completedAt: true,
  createdAt: true,
});
export type InsertScheduledFollowup = z.infer<typeof insertScheduledFollowupSchema>;
export type ScheduledFollowup = typeof scheduledFollowups.$inferSelect;

export const projectPayments = pgTable("project_payments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").references(() => projects.id).notNull(),
  type: text("type").notNull().default("deposit"),
  label: text("label").notNull(),
  amount: integer("amount").notNull(),
  dueDate: timestamp("due_date"),
  receivedDate: timestamp("received_date"),
  status: text("status").notNull().default("pending"),
  paymentMethod: text("payment_method"),
  notes: text("notes"),
  ledgerExcluded: boolean("ledger_excluded").default(false),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertProjectPaymentSchema = createInsertSchema(projectPayments).omit({
  id: true,
  ledgerExcluded: true,
  createdAt: true,
});
export type InsertProjectPayment = z.infer<typeof insertProjectPaymentSchema>;
export type ProjectPayment = typeof projectPayments.$inferSelect;

export const adminRoleEnum = pgEnum("admin_role", ["admin", "bookkeeper"]);

export const adminUsers = pgTable("admin_users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  username: text("username").notNull().unique(),
  role: adminRoleEnum("role").notNull().default("admin"),
  mfaSecret: text("mfa_secret"),
  mfaEnabled: boolean("mfa_enabled").notNull().default(false),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export type AdminUser = typeof adminUsers.$inferSelect;

export const aiReports = pgTable("ai_reports", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  type: text("type").notNull(),
  generatedAt: timestamp("generated_at", { withTimezone: true }).notNull().defaultNow(),
  payload: jsonb("payload").notNull(),
  createdBy: varchar("created_by"),
});

export const insertAiReportSchema = createInsertSchema(aiReports).omit({
  id: true,
  generatedAt: true,
});
export type InsertAiReport = z.infer<typeof insertAiReportSchema>;
export type AiReport = typeof aiReports.$inferSelect;

export const projectDocuments = pgTable("project_documents", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").references(() => projects.id).notNull(),
  filename: text("filename").notNull(),
  storageKey: text("storage_key").notNull(),
  category: text("category").notNull().default("other"),
  fileSize: integer("file_size"),
  contentType: text("content_type"),
  notes: text("notes"),
  uploadedBy: text("uploaded_by"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertProjectDocumentSchema = createInsertSchema(projectDocuments).omit({
  id: true,
  createdAt: true,
});
export type InsertProjectDocument = z.infer<typeof insertProjectDocumentSchema>;
export type ProjectDocument = typeof projectDocuments.$inferSelect;

// === Client Revenue System ===

export const clientStatusEnum = pgEnum("client_status", [
  "active", "churned", "prospect", "paused"
]);

export const clients = pgTable("clients", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  email: text("email"),
  phone: text("phone"),
  website: text("website"),
  companyId: varchar("company_id").references(() => companies.id),
  contactId: varchar("contact_id").references(() => contacts.id),
  stripeCustomerId: varchar("stripe_customer_id"),
  status: clientStatusEnum("status").notNull().default("active"),
  mrr: numeric("mrr", { precision: 12, scale: 2 }).default("0"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertClientSchema = createInsertSchema(clients).omit({
  id: true,
  createdAt: true,
});
export type InsertClient = z.infer<typeof insertClientSchema>;
export type Client = typeof clients.$inferSelect;

export const dealStageEnum = pgEnum("deal_stage", [
  "qualification", "proposal", "negotiation", "closed_won", "closed_lost"
]);

export const deals = pgTable("deals", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  clientId: varchar("client_id").references(() => clients.id).notNull(),
  projectId: varchar("project_id").references(() => projects.id),
  name: text("name").notNull(),
  value: numeric("value", { precision: 12, scale: 2 }).notNull().default("0"),
  stage: dealStageEnum("stage").notNull().default("qualification"),
  closeDate: timestamp("close_date"),
  probability: integer("probability").default(50),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertDealSchema = createInsertSchema(deals).omit({
  id: true,
  createdAt: true,
});
export type InsertDeal = z.infer<typeof insertDealSchema>;
export type Deal = typeof deals.$inferSelect;

export const subscriptionStatusEnum = pgEnum("subscription_status", [
  "active", "past_due", "canceled", "trialing", "paused"
]);

export const billingIntervalEnum = pgEnum("billing_interval", [
  "monthly", "quarterly", "annual"
]);

export const subscriptions = pgTable("subscriptions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  clientId: varchar("client_id").references(() => clients.id).notNull(),
  projectId: varchar("project_id").references(() => projects.id),
  stripeSubscriptionId: varchar("stripe_subscription_id"),
  stripePriceId: varchar("stripe_price_id"),
  stripeProductId: varchar("stripe_product_id"),
  name: text("name").notNull(),
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
  interval: billingIntervalEnum("interval").notNull().default("monthly"),
  status: subscriptionStatusEnum("status").notNull().default("active"),
  currentPeriodStart: timestamp("current_period_start"),
  currentPeriodEnd: timestamp("current_period_end"),
  canceledAt: timestamp("canceled_at"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertSubscriptionSchema = createInsertSchema(subscriptions).omit({
  id: true,
  createdAt: true,
});
export type InsertSubscription = z.infer<typeof insertSubscriptionSchema>;
export type Subscription = typeof subscriptions.$inferSelect;

export const stripePayments = pgTable("stripe_payments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  clientId: varchar("client_id").references(() => clients.id).notNull(),
  subscriptionId: varchar("subscription_id").references(() => subscriptions.id),
  projectId: varchar("project_id").references(() => projects.id),
  stripePaymentIntentId: varchar("stripe_payment_intent_id"),
  stripeInvoiceId: varchar("stripe_invoice_id"),
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
  currency: varchar("currency", { length: 3 }).default("usd"),
  status: varchar("status", { length: 50 }).notNull().default("pending"),
  paymentType: varchar("payment_type", { length: 50 }).default("one_time"),
  paymentMethod: varchar("payment_method", { length: 50 }).default("stripe"),
  description: text("description"),
  paidAt: timestamp("paid_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertStripePaymentSchema = createInsertSchema(stripePayments).omit({
  id: true,
  createdAt: true,
});
export type InsertStripePayment = z.infer<typeof insertStripePaymentSchema>;
export type StripePayment = typeof stripePayments.$inferSelect;

export const stripeEvents = pgTable("stripe_events", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  stripeEventId: varchar("stripe_event_id").notNull().unique(),
  eventType: varchar("event_type", { length: 100 }).notNull(),
  clientId: varchar("client_id").references(() => clients.id),
  data: jsonb("data"),
  processedAt: timestamp("processed_at").defaultNow(),
});

export const insertStripeEventSchema = createInsertSchema(stripeEvents).omit({
  id: true,
  processedAt: true,
});
export type InsertStripeEvent = z.infer<typeof insertStripeEventSchema>;
export type StripeEvent = typeof stripeEvents.$inferSelect;

export const paymentLinks = pgTable("payment_links", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  token: varchar("token", { length: 64 }).notNull().unique(),
  clientId: varchar("client_id").references(() => clients.id).notNull(),
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
  currency: varchar("currency", { length: 3 }).default("usd"),
  description: text("description"),
  clientName: text("client_name"),
  clientEmail: text("client_email"),
  status: varchar("status", { length: 20 }).notNull().default("pending"),
  stripePaymentIntentId: varchar("stripe_payment_intent_id"),
  stripePaymentId: varchar("stripe_payment_id").references(() => stripePayments.id),
  projectId: varchar("project_id").references(() => projects.id),
  paidAt: timestamp("paid_at"),
  expiresAt: timestamp("expires_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertPaymentLinkSchema = createInsertSchema(paymentLinks).omit({
  id: true,
  createdAt: true,
});
export type InsertPaymentLink = z.infer<typeof insertPaymentLinkSchema>;
export type PaymentLink = typeof paymentLinks.$inferSelect;

export const websiteAudits = pgTable("website_audits", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  businessName: text("business_name").notNull(),
  websiteUrl: text("website_url").notNull(),
  industry: text("industry"),
  city: text("city"),
  phone: text("phone"),
  homepageHtml: text("homepage_html"),
  screenshotUrl: text("screenshot_url"),
  ruleScore: integer("rule_score"),
  aiScore: integer("ai_score"),
  badSiteScore: numeric("bad_site_score"),
  redesignWorthy: boolean("redesign_worthy").default(false),
  topProblems: jsonb("top_problems"),
  pitchAngle: text("pitch_angle"),
  openingLine: text("opening_line"),
  visualStyleAssessment: text("visual_style_assessment"),
  conversionAssessment: text("conversion_assessment"),
  status: text("status").notNull().default("pending"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertWebsiteAuditSchema = createInsertSchema(websiteAudits).omit({
  id: true,
  status: true,
  createdAt: true,
});
export type InsertWebsiteAudit = z.infer<typeof insertWebsiteAuditSchema>;
export type WebsiteAudit = typeof websiteAudits.$inferSelect;

export const outreachLeads = pgTable("outreach_leads", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  businessName: text("business_name").notNull(),
  websiteUrl: text("website_url").notNull(),
  industry: text("industry"),
  contactName: text("contact_name"),
  email: text("email"),
  phone: text("phone"),
  location: text("location"),
  notes: text("notes"),
  status: text("status").notNull().default("new"),
  aiScore: integer("ai_score"),
  valueEstimate: integer("value_estimate"),
  pitchAngle: text("pitch_angle"),
  openingLine: text("opening_line"),
  aiAuditSummary: text("ai_audit_summary"),
  aiBullets: jsonb("ai_bullets"),
  crmLeadId: varchar("crm_lead_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  badSiteScore: integer("bad_site_score"),
  redesignWorthy: boolean("redesign_worthy"),
  topProblems: jsonb("top_problems"),
  visualStyleAssessment: text("visual_style_assessment"),
  conversionAssessment: text("conversion_assessment"),
  screenshotUrl: text("screenshot_url"),
  sourceType: text("source_type").default("scan"),
  ruleCheckResults: jsonb("rule_check_results"),
  auditId: varchar("audit_id"),
  source: text("source"),
  conversationThread: jsonb("conversation_thread").default([]),
  awaitingHandoff: boolean("awaiting_handoff").default(false),
  handoffReason: text("handoff_reason"),
  autoReplyEnabled: boolean("auto_reply_enabled").default(true),
});

export const insertOutreachLeadSchema = createInsertSchema(outreachLeads).omit({
  id: true,
  status: true,
  aiScore: true,
  valueEstimate: true,
  pitchAngle: true,
  openingLine: true,
  aiAuditSummary: true,
  aiBullets: true,
  crmLeadId: true,
  createdAt: true,
  badSiteScore: true,
  redesignWorthy: true,
  topProblems: true,
  visualStyleAssessment: true,
  conversionAssessment: true,
  screenshotUrl: true,
  ruleCheckResults: true,
  auditId: true,
  source: true,
  conversationThread: true,
  awaitingHandoff: true,
  handoffReason: true,
  autoReplyEnabled: true,
});
export type InsertOutreachLead = z.infer<typeof insertOutreachLeadSchema>;
export type OutreachLead = typeof outreachLeads.$inferSelect;

export const outreachCampaigns = pgTable("outreach_campaigns", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type OutreachCampaign = typeof outreachCampaigns.$inferSelect;

export const campaignSteps = pgTable("campaign_steps", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  campaignId: varchar("campaign_id").references(() => outreachCampaigns.id, { onDelete: "cascade" }).notNull(),
  stepNumber: integer("step_number").notNull(),
  delayDays: integer("delay_days").notNull(),
  templateSubject: text("template_subject").notNull(),
  templateBody: text("template_body").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type CampaignStep = typeof campaignSteps.$inferSelect;

export const leadCampaignEnrollments = pgTable("lead_campaign_enrollments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  leadId: varchar("lead_id").references(() => outreachLeads.id, { onDelete: "cascade" }).notNull(),
  campaignId: varchar("campaign_id").references(() => outreachCampaigns.id, { onDelete: "cascade" }).notNull(),
  currentStep: integer("current_step").notNull().default(0),
  enrolledAt: timestamp("enrolled_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  stoppedAt: timestamp("stopped_at", { withTimezone: true }),
  stopReason: text("stop_reason"),
});

export type LeadCampaignEnrollment = typeof leadCampaignEnrollments.$inferSelect;

export const emailEvents = pgTable("email_events", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  leadId: varchar("lead_id").references(() => outreachLeads.id, { onDelete: "cascade" }).notNull(),
  campaignId: varchar("campaign_id").references(() => outreachCampaigns.id, { onDelete: "cascade" }).notNull(),
  stepNumber: integer("step_number").notNull(),
  resendMessageId: text("resend_message_id"),
  toEmail: text("to_email").notNull(),
  subject: text("subject").notNull(),
  body: text("body").notNull(),
  status: text("status").notNull(),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  lastEventAt: timestamp("last_event_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type EmailEvent = typeof emailEvents.$inferSelect;

export const outreachJobs = pgTable("outreach_jobs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  type: text("type").notNull(),
  payload: jsonb("payload").notNull(),
  runAt: timestamp("run_at", { withTimezone: true }).notNull(),
  status: text("status").notNull().default("queued"),
  error: text("error"),
  retryCount: integer("retry_count").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type OutreachJob = typeof outreachJobs.$inferSelect;

export const outreachSettings = pgTable("outreach_settings", {
  id: varchar("id").primaryKey().default(sql`'default'`),
  dailySendCap: integer("daily_send_cap").notNull().default(20),
  sendWindowStart: text("send_window_start").notNull().default("09:00"),
  sendWindowEnd: text("send_window_end").notNull().default("16:00"),
  timezone: text("timezone").notNull().default("America/Chicago"),
  enrollmentsPaused: boolean("enrollments_paused").notNull().default(false),
  enrollmentsPausedReason: text("enrollments_paused_reason"),
  agentMode: text("agent_mode").notNull().default("auto_reply"),
  replyToAddress: text("reply_to_address"),
  outreachStartedAt: timestamp("outreach_started_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export type OutreachSettings = typeof outreachSettings.$inferSelect;

export const leadConversations = pgTable("lead_conversations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  leadId: varchar("lead_id").references(() => outreachLeads.id, { onDelete: "cascade" }).notNull(),
  direction: text("direction").notNull(),
  subject: text("subject"),
  body: text("body").notNull(),
  aiGenerated: boolean("ai_generated").notNull().default(false),
  sentiment: text("sentiment"),
  intent: text("intent"),
  resendMessageId: text("resend_message_id"),
  inReplyToMessageId: text("in_reply_to_message_id"),
  campaignStep: integer("campaign_step"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type LeadConversation = typeof leadConversations.$inferSelect;

export const agentInsights = pgTable("agent_insights", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  type: text("type").notNull(),
  insight: text("insight").notNull(),
  metrics: jsonb("metrics"),
  appliedAt: timestamp("applied_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type AgentInsight = typeof agentInsights.$inferSelect;

export const agentChatMessages = pgTable("agent_chat_messages", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  role: text("role").notNull(),
  content: text("content").notNull(),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type AgentChatMessage = typeof agentChatMessages.$inferSelect;

// === Lead Activities (CRM Enhancement) ===

export const leadActivities = pgTable("lead_activities", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  leadId: varchar("lead_id").references(() => contactSubmissions.id, { onDelete: "cascade" }).notNull(),
  type: text("type").notNull(),
  description: text("description").notNull(),
  metadata: jsonb("metadata"),
  createdBy: text("created_by").default("system"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertLeadActivitySchema = createInsertSchema(leadActivities).omit({
  id: true,
  createdAt: true,
});
export type InsertLeadActivity = z.infer<typeof insertLeadActivitySchema>;
export type LeadActivity = typeof leadActivities.$inferSelect;

// === Bookkeeping System ===

export const accountTypeEnum = pgEnum("account_type", [
  "asset", "liability", "equity", "revenue", "expense"
]);

export const normalBalanceEnum = pgEnum("normal_balance", [
  "debit", "credit"
]);

export const accounts = pgTable("accounts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  accountNumber: text("account_number").notNull().unique(),
  name: text("name").notNull(),
  type: accountTypeEnum("type").notNull(),
  subtype: text("subtype"),
  description: text("description"),
  isActive: boolean("is_active").notNull().default(true),
  parentAccountId: varchar("parent_account_id"),
  normalBalance: normalBalanceEnum("normal_balance").notNull(),
  scheduleCLine: text("schedule_c_line"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertAccountSchema = createInsertSchema(accounts).omit({
  id: true,
  createdAt: true,
});
export type InsertAccount = z.infer<typeof insertAccountSchema>;
export type Account = typeof accounts.$inferSelect;

export const journalEntries = pgTable("journal_entries", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  date: timestamp("date").notNull(),
  memo: text("memo"),
  reference: text("reference"),
  sourceType: text("source_type"),
  sourceId: text("source_id"),
  isReconciled: boolean("is_reconciled").notNull().default(false),
  isVoid: boolean("is_void").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow(),
  createdBy: text("created_by").default("system"),
});

export const insertJournalEntrySchema = createInsertSchema(journalEntries).omit({
  id: true,
  createdAt: true,
});
export type InsertJournalEntry = z.infer<typeof insertJournalEntrySchema>;
export type JournalEntry = typeof journalEntries.$inferSelect;

export const journalLines = pgTable("journal_lines", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  journalEntryId: varchar("journal_entry_id").references(() => journalEntries.id, { onDelete: "cascade" }).notNull(),
  accountId: varchar("account_id").references(() => accounts.id).notNull(),
  debit: numeric("debit", { precision: 12, scale: 2 }).notNull().default("0"),
  credit: numeric("credit", { precision: 12, scale: 2 }).notNull().default("0"),
  memo: text("memo"),
});

export const insertJournalLineSchema = createInsertSchema(journalLines).omit({
  id: true,
});
export type InsertJournalLine = z.infer<typeof insertJournalLineSchema>;
export type JournalLine = typeof journalLines.$inferSelect;

export const vendors = pgTable("vendors", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  email: text("email"),
  phone: text("phone"),
  address: text("address"),
  taxId: text("tax_id"),
  notes: text("notes"),
  isActive: boolean("is_active").notNull().default(true),
  is1099Contractor: boolean("is_1099_contractor").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertVendorSchema = createInsertSchema(vendors).omit({
  id: true,
  createdAt: true,
});
export type InsertVendor = z.infer<typeof insertVendorSchema>;
export type Vendor = typeof vendors.$inferSelect;

// === Expenses ===

export const paymentMethodEnum = pgEnum("payment_method_type", [
  "cash", "check", "card", "transfer", "other"
]);

export const expenses = pgTable("expenses", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  vendorId: varchar("vendor_id").references(() => vendors.id),
  accountId: varchar("account_id").references(() => accounts.id).notNull(),
  description: text("description").notNull(),
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
  date: timestamp("date").notNull(),
  projectId: varchar("project_id").references(() => projects.id),
  clientId: varchar("client_id").references(() => clients.id),
  paymentMethod: paymentMethodEnum("payment_method").default("card"),
  checkNumber: text("check_number"),
  receiptNotes: text("receipt_notes"),
  isBillable: boolean("is_billable").default(false),
  taxDeductible: boolean("tax_deductible").default(true),
  scheduleCLine: text("schedule_c_line"),
  journalEntryId: varchar("journal_entry_id").references(() => journalEntries.id),
  isRecurring: boolean("is_recurring").default(false),
  recurringFrequency: varchar("recurring_frequency", { length: 20 }),
  recurringDayOfMonth: integer("recurring_day_of_month"),
  nextDueDate: timestamp("next_due_date"),
  recurringParentId: varchar("recurring_parent_id"),
  fundingSource: varchar("funding_source", { length: 30 }).default("business_checking"),
  receiptStorageKey: text("receipt_storage_key"),
  receiptFilename: text("receipt_filename"),
  isVoid: boolean("is_void").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertExpenseSchema = createInsertSchema(expenses).omit({
  id: true,
  journalEntryId: true,
  createdAt: true,
});
export type InsertExpense = z.infer<typeof insertExpenseSchema>;
export type Expense = typeof expenses.$inferSelect;

// === Bills (Accounts Payable) ===

export const billStatusEnum = pgEnum("bill_status", [
  "pending", "partially_paid", "paid", "overdue", "void"
]);

export const bills = pgTable("bills", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  vendorId: varchar("vendor_id").references(() => vendors.id).notNull(),
  accountId: varchar("account_id").references(() => accounts.id),
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
  paidAmount: numeric("paid_amount", { precision: 12, scale: 2 }).notNull().default("0"),
  dueDate: timestamp("due_date").notNull(),
  paidDate: timestamp("paid_date"),
  status: billStatusEnum("status").notNull().default("pending"),
  description: text("description"),
  reference: text("reference"),
  paymentMethod: varchar("payment_method", { length: 20 }),
  journalEntryId: varchar("journal_entry_id").references(() => journalEntries.id),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertBillSchema = createInsertSchema(bills).omit({
  id: true,
  paidAmount: true,
  paidDate: true,
  journalEntryId: true,
  createdAt: true,
});
export type InsertBill = z.infer<typeof insertBillSchema>;
export type Bill = typeof bills.$inferSelect;

export const billPayments = pgTable("bill_payments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  billId: varchar("bill_id").references(() => bills.id).notNull(),
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
  paymentMethod: varchar("payment_method", { length: 20 }).notNull().default("cash"),
  memo: text("memo"),
  journalEntryId: varchar("journal_entry_id").references(() => journalEntries.id),
  paidAt: timestamp("paid_at").defaultNow(),
});

export const insertBillPaymentSchema = createInsertSchema(billPayments).omit({
  id: true,
  journalEntryId: true,
  paidAt: true,
});
export type InsertBillPayment = z.infer<typeof insertBillPaymentSchema>;
export type BillPayment = typeof billPayments.$inferSelect;

// === Tax System ===

export const taxSettings = pgTable("tax_settings", {
  id: varchar("id").primaryKey().default(sql`'default'`),
  federalRate: numeric("federal_rate", { precision: 5, scale: 2 }).notNull().default("22"),
  stateRate: numeric("state_rate", { precision: 5, scale: 2 }).notNull().default("0"),
  stateName: text("state_name"),
  filingType: text("filing_type").notNull().default("sole_prop"),
  selfEmploymentRate: numeric("self_employment_rate", { precision: 5, scale: 2 }).notNull().default("15.3"),
  qbiDeduction: boolean("qbi_deduction").notNull().default(true),
  taxpayerName: text("taxpayer_name"),
  taxpayerSSN: text("taxpayer_ssn"),
  spouseName: text("spouse_name"),
  spouseSSN: text("spouse_ssn"),
  address: text("address"),
  city: text("city"),
  taxState: text("tax_state"),
  zip: text("zip"),
  principalBusiness: text("principal_business").default("Web Design & Development Services"),
  businessCode: text("business_code").default("541510"),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export type TaxSettings = typeof taxSettings.$inferSelect;

export const quarterlyTaxPayments = pgTable("quarterly_tax_payments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  year: integer("year").notNull(),
  quarter: integer("quarter").notNull(),
  dueDate: timestamp("due_date").notNull(),
  estimatedAmount: numeric("estimated_amount", { precision: 12, scale: 2 }).notNull().default("0"),
  paidAmount: numeric("paid_amount", { precision: 12, scale: 2 }).notNull().default("0"),
  paidDate: timestamp("paid_date"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertQuarterlyTaxPaymentSchema = createInsertSchema(quarterlyTaxPayments).omit({
  id: true,
  createdAt: true,
});
export type InsertQuarterlyTaxPayment = z.infer<typeof insertQuarterlyTaxPaymentSchema>;
export type QuarterlyTaxPayment = typeof quarterlyTaxPayments.$inferSelect;

// === New Accounting System (v2) ===

export const accountTypeEnumV2 = pgEnum("account_type_v2", [
  "asset",
  "liability",
  "equity",
  "revenue",
  "expense",
]);

export const paymentMethodEnumV2 = pgEnum("payment_method_v2", [
  "cash",
  "credit_card",
  "stripe",
  "ach",
  "check",
]);

export const accountsV2 = pgTable(
  "accounts_v2",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    code: varchar("code", { length: 32 }),
    name: text("name").notNull(),
    type: accountTypeEnumV2("type").notNull(),
    isSystem: boolean("is_system").notNull().default(false),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    nameUniq: uniqueIndex("accounts_v2_name_uniq").on(t.name),
    typeIdx: index("accounts_v2_type_idx").on(t.type),
  })
);

export const insertAccountV2Schema = createInsertSchema(accountsV2).omit({
  id: true,
  createdAt: true,
});
export type InsertAccountV2 = z.infer<typeof insertAccountV2Schema>;
export type AccountV2 = typeof accountsV2.$inferSelect;

export const transactionsV2 = pgTable(
  "transactions_v2",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    occurredAt: timestamp("occurred_at").notNull().defaultNow(),
    memo: text("memo"),
    referenceType: varchar("reference_type", { length: 32 }),
    referenceId: varchar("reference_id"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    occurredIdx: index("tx_v2_occurred_idx").on(t.occurredAt),
    refIdx: uniqueIndex("tx_v2_ref_unique_idx").on(t.referenceId).where(sql`reference_id IS NOT NULL`),
  })
);

export const insertTransactionV2Schema = createInsertSchema(transactionsV2).omit({
  id: true,
  createdAt: true,
});
export type InsertTransactionV2 = z.infer<typeof insertTransactionV2Schema>;
export type TransactionV2 = typeof transactionsV2.$inferSelect;

export const transactionLinesV2 = pgTable(
  "transaction_lines_v2",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    transactionId: varchar("transaction_id")
      .notNull()
      .references(() => transactionsV2.id, { onDelete: "cascade" }),
    accountId: varchar("account_id")
      .notNull()
      .references(() => accountsV2.id),
    debit: numeric("debit", { precision: 14, scale: 2 }).notNull().default("0"),
    credit: numeric("credit", { precision: 14, scale: 2 }).notNull().default("0"),
    lineMemo: text("line_memo"),
  },
  (t) => ({
    txIdx: index("lines_v2_tx_idx").on(t.transactionId),
    acctIdx: index("lines_v2_acct_idx").on(t.accountId),
    acctTxIdx: index("lines_v2_acct_tx_idx").on(t.accountId, t.transactionId),
  })
)

export const insertTransactionLineV2Schema = createInsertSchema(transactionLinesV2).omit({
  id: true,
});
export type InsertTransactionLineV2 = z.infer<typeof insertTransactionLineV2Schema>;
export type TransactionLineV2 = typeof transactionLinesV2.$inferSelect;

export const reconciliations = pgTable("reconciliations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  accountId: varchar("account_id").notNull().references(() => accountsV2.id),
  statementDate: timestamp("statement_date").notNull(),
  statementBalance: numeric("statement_balance", { precision: 14, scale: 2 }).notNull(),
  clearedBalance: numeric("cleared_balance", { precision: 14, scale: 2 }).notNull(),
  itemCount: integer("item_count").notNull().default(0),
  completedAt: timestamp("completed_at").notNull().defaultNow(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertReconciliationSchema = createInsertSchema(reconciliations).omit({
  id: true,
  createdAt: true,
});
export type InsertReconciliation = z.infer<typeof insertReconciliationSchema>;
export type Reconciliation = typeof reconciliations.$inferSelect;

export const reconciliationItems = pgTable("reconciliation_items", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  reconciliationId: varchar("reconciliation_id").notNull().references(() => reconciliations.id, { onDelete: "cascade" }),
  transactionLineId: varchar("transaction_line_id").notNull().references(() => transactionLinesV2.id),
});

export type ReconciliationItem = typeof reconciliationItems.$inferSelect;

export const qaProjectTypeEnum = pgEnum("qa_project_type", [
  "marketing_website", "crm_portal", "saas_platform", "ecommerce_site", "internal_tool"
]);

export const qaStatusEnum = pgEnum("qa_status", [
  "not_started", "pass", "fail", "needs_review"
]);

export const qaTemplates = pgTable("qa_templates", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectType: qaProjectTypeEnum("project_type").notNull(),
  category: text("category").notNull(),
  itemDescription: text("item_description").notNull(),
  sortOrder: integer("sort_order").default(0),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertQaTemplateSchema = createInsertSchema(qaTemplates).omit({ id: true, createdAt: true });
export type InsertQaTemplate = z.infer<typeof insertQaTemplateSchema>;
export type QaTemplate = typeof qaTemplates.$inferSelect;

export const qaChecklists = pgTable("qa_checklists", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  projectType: qaProjectTypeEnum("project_type").notNull(),
  category: text("category").notNull(),
  itemDescription: text("item_description").notNull(),
  status: qaStatusEnum("status").notNull().default("not_started"),
  assignedTo: text("assigned_to"),
  notes: text("notes"),
  completedAt: timestamp("completed_at"),
  completedBy: text("completed_by"),
  sortOrder: integer("sort_order").default(0),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (t) => ({
  projectIdx: index("qa_checklists_project_idx").on(t.projectId),
}));

export const insertQaChecklistSchema = createInsertSchema(qaChecklists).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertQaChecklist = z.infer<typeof insertQaChecklistSchema>;
export type QaChecklist = typeof qaChecklists.$inferSelect;

export const qaAuditLog = pgTable("qa_audit_log", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  checklistItemId: varchar("checklist_item_id").references(() => qaChecklists.id, { onDelete: "cascade" }),
  projectId: varchar("project_id").notNull(),
  action: text("action").notNull(),
  previousValue: text("previous_value"),
  newValue: text("new_value"),
  changedBy: text("changed_by").notNull(),
  changedAt: timestamp("changed_at").defaultNow(),
}, (t) => ({
  projectIdx: index("qa_audit_project_idx").on(t.projectId),
  itemIdx: index("qa_audit_item_idx").on(t.checklistItemId),
}))

export const insertQaAuditLogSchema = createInsertSchema(qaAuditLog).omit({ id: true, changedAt: true });
export type InsertQaAuditLog = z.infer<typeof insertQaAuditLogSchema>;
export type QaAuditLog = typeof qaAuditLog.$inferSelect;

export const budgets = pgTable("budgets", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  accountId: varchar("account_id").references(() => accounts.id).notNull(),
  year: integer("year").notNull(),
  month: integer("month"),
  amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (t) => ({
  uniqueBudget: index("budget_account_year_month_idx").on(t.accountId, t.year, t.month),
}));

export const insertBudgetSchema = createInsertSchema(budgets).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertBudget = z.infer<typeof insertBudgetSchema>;
export type Budget = typeof budgets.$inferSelect;

export const auditLogs = pgTable("audit_logs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  action: varchar("action", { length: 20 }).notNull(),
  recordType: varchar("record_type", { length: 40 }).notNull(),
  recordId: varchar("record_id"),
  amount: numeric("amount", { precision: 14, scale: 2 }),
  description: text("description"),
  before: text("before"),
  after: text("after"),
  performedBy: varchar("performed_by", { length: 50 }).default("admin"),
  performedAt: timestamp("performed_at").notNull().defaultNow(),
}, (t) => ({
  performedAtIdx: index("audit_logs_performed_at_idx").on(t.performedAt),
  recordTypeIdx: index("audit_logs_record_type_idx").on(t.recordType),
}));

export const insertAuditLogSchema = createInsertSchema(auditLogs).omit({ id: true, performedAt: true });
export type InsertAuditLog = z.infer<typeof insertAuditLogSchema>;
export type AuditLog = typeof auditLogs.$inferSelect;

export const invoiceCounter = pgTable("invoice_counter", {
  id: integer("id").primaryKey().default(1),
  nextNumber: integer("next_number").notNull().default(302),
});

export const fiscalPeriodStatusEnum = pgEnum("fiscal_period_status", ["open", "closed"]);

export const fiscalPeriods = pgTable("fiscal_periods", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  year: integer("year").notNull(),
  month: integer("month").notNull(),
  status: fiscalPeriodStatusEnum("status").notNull().default("open"),
  closedBy: text("closed_by"),
  closedAt: timestamp("closed_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => ({
  yearMonthIdx: uniqueIndex("fiscal_periods_year_month_idx").on(t.year, t.month),
}));

export const insertFiscalPeriodSchema = createInsertSchema(fiscalPeriods).omit({
  id: true,
  createdAt: true,
});
export type InsertFiscalPeriod = z.infer<typeof insertFiscalPeriodSchema>;
export type FiscalPeriod = typeof fiscalPeriods.$inferSelect;

export const backups = pgTable("backups", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  filename: text("filename").notNull(),
  storagePath: text("storage_path").notNull(),
  sizeBytes: integer("size_bytes"),
  status: text("status").notNull().default("completed"),
  triggerType: text("trigger_type").notNull().default("scheduled"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  completedAt: timestamp("completed_at"),
  errorMessage: text("error_message"),
});
export type Backup = typeof backups.$inferSelect;

export const bankTransactionStatusEnum = pgEnum("bank_transaction_status", ["pending", "matched", "categorized", "ignored"]);

export const plaidConnections = pgTable("plaid_connections", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  institutionId: text("institution_id"),
  institutionName: text("institution_name").notNull(),
  accessToken: text("access_token").notNull(),
  itemId: text("item_id").notNull(),
  cursor: text("cursor"),
  accountId: text("account_id"),
  accountName: text("account_name"),
  accountMask: text("account_mask"),
  accountType: text("account_type"),
  isPersonal: boolean("is_personal").notNull().default(false),
  status: text("status").notNull().default("active"),
  lastSyncedAt: timestamp("last_synced_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertPlaidConnectionSchema = createInsertSchema(plaidConnections).omit({
  id: true,
  createdAt: true,
});
export type InsertPlaidConnection = z.infer<typeof insertPlaidConnectionSchema>;
export type PlaidConnection = typeof plaidConnections.$inferSelect;

export const bankTransactions = pgTable("bank_transactions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  connectionId: varchar("connection_id").notNull(),
  plaidTransactionId: text("plaid_transaction_id").notNull(),
  accountId: text("account_id"),
  date: text("date").notNull(),
  name: text("name").notNull(),
  merchantName: text("merchant_name"),
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
  isoCurrencyCode: text("iso_currency_code").default("USD"),
  category: text("category"),
  categoryDetailed: text("category_detailed"),
  pending: boolean("pending").default(false),
  status: bankTransactionStatusEnum("status").notNull().default("pending"),
  matchedExpenseId: text("matched_expense_id"),
  matchedPaymentId: varchar("matched_payment_id"),
  linkedAccountId: text("linked_account_id"),
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => ({
  plaidTxnIdx: uniqueIndex("bank_txn_plaid_id_idx").on(t.plaidTransactionId),
  connectionIdx: index("bank_txn_connection_idx").on(t.connectionId),
  statusIdx: index("bank_txn_status_idx").on(t.status),
}));

export const insertBankTransactionSchema = createInsertSchema(bankTransactions).omit({
  id: true,
  createdAt: true,
});
export type InsertBankTransaction = z.infer<typeof insertBankTransactionSchema>;
export type BankTransaction = typeof bankTransactions.$inferSelect;

export const policyStatusEnum = pgEnum("policy_status", ["draft", "published", "archived"]);

export const policies = pgTable("policies", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  title: text("title").notNull(),
  category: text("category").notNull().default("general"),
  content: text("content"),
  fileStorageKey: text("file_storage_key"),
  fileName: text("file_name"),
  fileSize: integer("file_size"),
  status: policyStatusEnum("status").notNull().default("draft"),
  version: integer("version").notNull().default(1),
  effectiveDate: timestamp("effective_date"),
  createdBy: text("created_by").notNull().default("admin"),
  lastEmailedAt: timestamp("last_emailed_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertPolicySchema = createInsertSchema(policies).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertPolicy = z.infer<typeof insertPolicySchema>;
export type Policy = typeof policies.$inferSelect;

export const kickoffSubmissions = pgTable("kickoff_submissions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").references(() => projects.id).notNull(),
  clientName: text("client_name").notNull(),
  clientEmail: text("client_email").notNull(),
  companyName: text("company_name"),
  token: varchar("token").notNull().unique(),
  status: text("status").notNull().default("sent"),
  sentAt: timestamp("sent_at").defaultNow(),
  submittedAt: timestamp("submitted_at"),
  responses: jsonb("responses"),
  uploadedFiles: jsonb("uploaded_files"),
  signatureAcknowledged: boolean("signature_acknowledged").default(false),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertKickoffSchema = createInsertSchema(kickoffSubmissions).omit({
  id: true,
  createdAt: true,
});
export type InsertKickoff = z.infer<typeof insertKickoffSchema>;
export type KickoffSubmission = typeof kickoffSubmissions.$inferSelect;

export const welcomeSequences = pgTable("welcome_sequences", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").references(() => projects.id).notNull().unique(),
  clientName: text("client_name").notNull(),
  clientEmail: text("client_email").notNull(),
  companyName: text("company_name"),
  status: text("status").notNull().default("pending"),
  email1SentAt: timestamp("email_1_sent_at"),
  email2SentAt: timestamp("email_2_sent_at"),
  email3SentAt: timestamp("email_3_sent_at"),
  email1Error: text("email_1_error"),
  email2Error: text("email_2_error"),
  email3Error: text("email_3_error"),
  triggeredBy: text("triggered_by").notNull().default("manual"),
  createdAt: timestamp("created_at").defaultNow(),
});

export type WelcomeSequence = typeof welcomeSequences.$inferSelect;

export const qaAudits = pgTable("qa_audits", {
  id: serial("id").primaryKey(),
  projectName: text("project_name").notNull(),
  targetUrl: text("target_url").notNull(),
  authToken: text("auth_token"),
  status: text("status").notNull().default("pending"),
  currentAgent: text("current_agent"),
  score: real("score"),
  grade: text("grade"),
  totalTests: integer("total_tests"),
  passed: integer("passed"),
  failed: integer("failed"),
  criticalCount: integer("critical_count"),
  highCount: integer("high_count"),
  mediumCount: integer("medium_count"),
  lowCount: integer("low_count"),
  aiAnalysis: text("ai_analysis"),
  reportJson: text("report_json"),
  reportMarkdown: text("report_markdown"),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at").defaultNow(),
  completedAt: timestamp("completed_at"),
});

export type QaAudit = typeof qaAudits.$inferSelect;

export const qaAuditFindings = pgTable("qa_audit_findings", {
  id: serial("id").primaryKey(),
  auditId: integer("audit_id").references(() => qaAudits.id).notNull(),
  agent: text("agent").notNull(),
  testName: text("test_name").notNull(),
  status: text("status").notNull(),
  severity: text("severity").notNull(),
  title: text("title").notNull(),
  description: text("description").notNull(),
  evidence: text("evidence"),
  remediation: text("remediation"),
  endpoint: text("endpoint"),
  responseCode: integer("response_code"),
  responseTimeMs: real("response_time_ms"),
});

export type QaAuditFinding = typeof qaAuditFindings.$inferSelect;

export const ridgeConversations = pgTable("ridge_conversations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  title: text("title"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const ridgeMessages = pgTable("ridge_messages", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  conversationId: varchar("conversation_id").notNull().references(() => ridgeConversations.id),
  role: text("role").notNull(),
  content: text("content").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
