import { db } from "./db";
import {
  companies, contacts, projects, stageGates, milestones, tasks,
  timeEntries, activityLogs, projectTemplates, templateStages,
  templateGates, templateMilestones, templateTasks, scheduledFollowups
} from "@shared/schema";

const now = new Date();
const day = (offset: number) => new Date(now.getTime() + offset * 24 * 60 * 60 * 1000);

const companyId1 = "c0000001-0000-0000-0000-000000000001";
const companyId2 = "c0000002-0000-0000-0000-000000000002";
const companyId3 = "c0000003-0000-0000-0000-000000000003";

const contactId1 = "d0000001-0000-0000-0000-000000000001";
const contactId2 = "d0000002-0000-0000-0000-000000000002";
const contactId3 = "d0000003-0000-0000-0000-000000000003";
const contactId4 = "d0000004-0000-0000-0000-000000000004";
const contactId5 = "d0000005-0000-0000-0000-000000000005";

const projectId1 = "e0000001-0000-0000-0000-000000000001";
const projectId2 = "e0000002-0000-0000-0000-000000000002";
const projectId3 = "e0000003-0000-0000-0000-000000000003";
const projectId4 = "e0000004-0000-0000-0000-000000000004";

const templateId1 = "f0000001-0000-0000-0000-000000000001";

const tsId = (n: number) => `a1000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const tgId = (n: number) => `a2000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const tmId = (n: number) => `a3000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const ttId = (n: number) => `a4000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const sgId = (n: number) => `b0000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const msId = (n: number) => `b1000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const tkId = (n: number) => `b2000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const teId = (n: number) => `b3000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const alId = (n: number) => `b4000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const sfId = (n: number) => `b5000000-0000-0000-0000-${String(n).padStart(12, "0")}`;

async function seed() {
  console.log("Cleaning existing ops data...");

  await db.delete(scheduledFollowups);
  await db.delete(activityLogs);
  await db.delete(timeEntries);
  await db.delete(tasks);
  await db.delete(milestones);
  await db.delete(stageGates);
  await db.delete(templateTasks);
  await db.delete(templateMilestones);
  await db.delete(templateGates);
  await db.delete(templateStages);
  await db.delete(projectTemplates);
  await db.delete(projects);
  await db.delete(contacts);
  await db.delete(companies);

  console.log("Inserting companies...");
  await db.insert(companies).values([
    { id: companyId1, name: "Meridian Health Systems", domain: "meridianhealthsys.com", industry: "Healthcare", size: "50-200" },
    { id: companyId2, name: "Apex Ventures Capital", domain: "apexventures.co", industry: "Finance", size: "10-50" },
    { id: companyId3, name: "TerraForm Construction", domain: "terraformbuilds.com", industry: "Construction", size: "200-500" },
  ]);

  console.log("Inserting contacts...");
  await db.insert(contacts).values([
    { id: contactId1, companyId: companyId1, name: "Sarah Chen", email: "sarah@meridianhealthsys.com", role: "COO", isPrimary: true },
    { id: contactId2, companyId: companyId1, name: "Dr. James Miller", email: "jmiller@meridianhealthsys.com", role: "CTO", isPrimary: false },
    { id: contactId3, companyId: companyId2, name: "Marcus Thompson", email: "marcus@apexventures.co", role: "Managing Partner", isPrimary: true },
    { id: contactId4, companyId: companyId3, name: "Elena Rodriguez", email: "elena@terraformbuilds.com", role: "VP Digital", isPrimary: true },
    { id: contactId5, companyId: companyId3, name: "Kevin Park", email: "kevin@terraformbuilds.com", role: "Project Manager", isPrimary: false },
  ]);

  console.log("Inserting projects...");
  await db.insert(projects).values([
    {
      id: projectId1, companyId: companyId1, contactId: contactId1, name: "Patient Portal Redesign",
      stage: "in_progress", contractValue: 45000, hourlyRate: 150, estimatedHours: 300,
      description: "Complete redesign of patient-facing portal with appointment scheduling, medical records access, and telehealth integration.",
    },
    {
      id: projectId2, companyId: companyId2, contactId: contactId3, name: "Investment Dashboard",
      stage: "proposal", contractValue: 28000, hourlyRate: 175, estimatedHours: 160,
      description: "Real-time portfolio analytics dashboard for fund managers with performance tracking and reporting.",
    },
    {
      id: projectId3, companyId: companyId3, contactId: contactId4, name: "Fleet Management App",
      stage: "kickoff", contractValue: 62000, hourlyRate: 150, estimatedHours: 415,
      description: "Mobile-first fleet tracking application with GPS monitoring, maintenance scheduling, and driver management.",
    },
    {
      id: projectId4, companyId: companyId2, contactId: contactId3, name: "Brand Refresh & Marketing Site",
      stage: "review", contractValue: 15000, hourlyRate: 150, estimatedHours: 100,
      waitingOnClient: true, blocker: "Awaiting final brand guidelines and logo files from client design team",
      blockerSince: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
      description: "Complete brand identity refresh and new marketing website with investor-focused messaging.",
    },
  ]);

  console.log("Inserting stage gates...");
  let sgN = 1;
  const completedGate = (pid: string, stage: any, title: string, order: number) =>
    ({ id: sgId(sgN++), projectId: pid, stageName: stage, title, isCompleted: true, completedAt: day(-15), sortOrder: order });
  const openGate = (pid: string, stage: any, title: string, order: number) =>
    ({ id: sgId(sgN++), projectId: pid, stageName: stage, title, isCompleted: false, sortOrder: order });

  await db.insert(stageGates).values([
    completedGate(projectId1, "discovery", "Requirements gathered", 0),
    completedGate(projectId1, "discovery", "Stakeholder interviews complete", 1),
    completedGate(projectId1, "proposal", "Proposal sent", 0),
    completedGate(projectId1, "proposal", "Proposal approved", 1),
    completedGate(projectId1, "contract", "SOW signed", 0),
    completedGate(projectId1, "contract", "Deposit received", 1),
    completedGate(projectId1, "kickoff", "Kickoff meeting held", 0),
    completedGate(projectId1, "kickoff", "Access credentials received", 1),
    completedGate(projectId1, "in_progress", "Design mockups approved", 0),
    openGate(projectId1, "in_progress", "Backend API complete", 1),
    openGate(projectId1, "in_progress", "Frontend integration complete", 2),

    completedGate(projectId2, "discovery", "Requirements gathered", 0),
    completedGate(projectId2, "discovery", "Competitive analysis done", 1),
    openGate(projectId2, "proposal", "Proposal drafted", 0),
    completedGate(projectId2, "proposal", "Pricing approved internally", 1),

    completedGate(projectId3, "discovery", "Requirements gathered", 0),
    completedGate(projectId3, "discovery", "Site survey complete", 1),
    completedGate(projectId3, "proposal", "Proposal sent", 0),
    completedGate(projectId3, "proposal", "Proposal approved", 1),
    completedGate(projectId3, "contract", "SOW signed", 0),
    completedGate(projectId3, "contract", "Deposit received", 1),
    openGate(projectId3, "kickoff", "Team assigned", 0),
    openGate(projectId3, "kickoff", "Dev environment ready", 1),

    completedGate(projectId4, "discovery", "Requirements gathered", 0),
    completedGate(projectId4, "discovery", "Stakeholder interviews complete", 1),
    completedGate(projectId4, "proposal", "Proposal sent", 0),
    completedGate(projectId4, "proposal", "Proposal approved", 1),
    completedGate(projectId4, "contract", "SOW signed", 0),
    completedGate(projectId4, "contract", "Deposit received", 1),
    completedGate(projectId4, "kickoff", "Kickoff meeting held", 0),
    completedGate(projectId4, "kickoff", "Access credentials received", 1),
    completedGate(projectId4, "in_progress", "Design mockups approved", 0),
    completedGate(projectId4, "in_progress", "Development complete", 1),
    completedGate(projectId4, "review", "Client review scheduled", 0),
    openGate(projectId4, "review", "Revision list finalized", 1),
  ]);

  console.log("Inserting milestones...");
  await db.insert(milestones).values([
    { id: msId(1), projectId: projectId1, title: "Design Phase Complete", dueDate: day(-10), completedAt: day(-12), sortOrder: 0 },
    { id: msId(2), projectId: projectId1, title: "Backend Sprint 1", dueDate: day(-3), sortOrder: 1 },
    { id: msId(3), projectId: projectId1, title: "Beta Launch", dueDate: day(14), sortOrder: 2 },
    { id: msId(4), projectId: projectId1, title: "Final Delivery", dueDate: day(30), sortOrder: 3 },
    { id: msId(5), projectId: projectId2, title: "Proposal Delivery", dueDate: day(2), sortOrder: 0 },
    { id: msId(6), projectId: projectId2, title: "Contract Signing", dueDate: day(10), sortOrder: 1 },
    { id: msId(7), projectId: projectId3, title: "Kickoff Complete", dueDate: day(5), sortOrder: 0 },
    { id: msId(8), projectId: projectId3, title: "MVP Release", dueDate: day(45), sortOrder: 1 },
    { id: msId(9), projectId: projectId3, title: "Final Launch", dueDate: day(75), sortOrder: 2 },
    { id: msId(10), projectId: projectId4, title: "Client Review", dueDate: day(-1), sortOrder: 0 },
    { id: msId(11), projectId: projectId4, title: "Final Delivery", dueDate: day(7), sortOrder: 1 },
  ]);

  console.log("Inserting tasks...");
  await db.insert(tasks).values([
    { id: tkId(1), projectId: projectId1, title: "Finalize patient dashboard wireframes", status: "done", priority: "high", completedAt: day(-5), sortOrder: 0 },
    { id: tkId(2), projectId: projectId1, title: "Implement appointment booking API", status: "in_progress", priority: "high", dueDate: day(0), sortOrder: 1 },
    { id: tkId(3), projectId: projectId1, title: "Build telehealth video integration", status: "todo", priority: "high", dueDate: day(7), sortOrder: 2 },
    { id: tkId(4), projectId: projectId1, title: "Design email notification templates", status: "done", priority: "medium", completedAt: day(-3), sortOrder: 3 },
    { id: tkId(5), projectId: projectId1, title: "Set up HIPAA-compliant hosting", status: "done", priority: "urgent", completedAt: day(-8), sortOrder: 4 },
    { id: tkId(6), projectId: projectId1, title: "Implement medical records viewer", status: "in_progress", priority: "high", dueDate: day(3), sortOrder: 5 },
    { id: tkId(7), projectId: projectId1, title: "Write API documentation", status: "todo", priority: "low", dueDate: day(20), sortOrder: 6 },
    { id: tkId(8), projectId: projectId1, title: "QA testing sprint 1", status: "blocked", priority: "medium", dueDate: day(-2), sortOrder: 7 },

    { id: tkId(9), projectId: projectId2, title: "Gather portfolio data requirements", status: "done", priority: "high", completedAt: day(-4), sortOrder: 0 },
    { id: tkId(10), projectId: projectId2, title: "Create UI mockups", status: "in_progress", priority: "high", dueDate: day(3), sortOrder: 1 },
    { id: tkId(11), projectId: projectId2, title: "Draft technical proposal", status: "todo", priority: "urgent", dueDate: day(1), sortOrder: 2 },
    { id: tkId(12), projectId: projectId2, title: "Research charting libraries", status: "done", priority: "medium", completedAt: day(-2), sortOrder: 3 },

    { id: tkId(13), projectId: projectId3, title: "Define GPS tracking requirements", status: "done", priority: "high", completedAt: day(-1), sortOrder: 0 },
    { id: tkId(14), projectId: projectId3, title: "Set up project repository", status: "todo", priority: "medium", dueDate: day(3), sortOrder: 1 },
    { id: tkId(15), projectId: projectId3, title: "Create database schema", status: "todo", priority: "high", dueDate: day(5), sortOrder: 2 },
    { id: tkId(16), projectId: projectId3, title: "Design mobile app screens", status: "todo", priority: "high", dueDate: day(7), sortOrder: 3 },
    { id: tkId(17), projectId: projectId3, title: "Research fleet APIs", status: "in_progress", priority: "medium", dueDate: day(4), sortOrder: 4 },

    { id: tkId(18), projectId: projectId4, title: "Design homepage mockup", status: "done", priority: "high", completedAt: day(-10), sortOrder: 0 },
    { id: tkId(19), projectId: projectId4, title: "Build responsive layout", status: "done", priority: "high", completedAt: day(-5), sortOrder: 1 },
    { id: tkId(20), projectId: projectId4, title: "Implement contact forms", status: "done", priority: "medium", completedAt: day(-3), sortOrder: 2 },
    { id: tkId(21), projectId: projectId4, title: "Client review presentation", status: "in_progress", priority: "urgent", dueDate: day(-1), sortOrder: 3 },
    { id: tkId(22), projectId: projectId4, title: "Apply revision feedback", status: "todo", priority: "high", dueDate: day(5), sortOrder: 4 },
  ]);

  console.log("Inserting time entries...");
  await db.insert(timeEntries).values([
    { id: teId(1), projectId: projectId1, description: "Discovery sessions and requirements gathering", minutes: 480, billable: true, date: day(-28) },
    { id: teId(2), projectId: projectId1, description: "Wireframe creation and design iteration", minutes: 720, billable: true, date: day(-22) },
    { id: teId(3), projectId: projectId1, description: "HIPAA compliance research and hosting setup", minutes: 360, billable: true, date: day(-18) },
    { id: teId(4), projectId: projectId1, description: "Backend API architecture and initial endpoints", minutes: 960, billable: true, date: day(-14) },
    { id: teId(5), projectId: projectId1, description: "Frontend component library setup", minutes: 600, billable: true, date: day(-10) },
    { id: teId(6), projectId: projectId1, description: "Appointment booking module development", minutes: 1440, billable: true, date: day(-6) },
    { id: teId(7), projectId: projectId1, description: "Internal team sync and planning", minutes: 240, billable: false, date: day(-3) },
    { id: teId(8), projectId: projectId1, description: "Medical records viewer implementation", minutes: 5300, billable: true, date: day(-1) },

    { id: teId(9), projectId: projectId2, description: "Initial discovery call and requirements", minutes: 180, billable: true, date: day(-7) },
    { id: teId(10), projectId: projectId2, description: "Competitive analysis and research", minutes: 420, billable: true, date: day(-5) },
    { id: teId(11), projectId: projectId2, description: "UI mockup exploration", minutes: 480, billable: true, date: day(-2) },

    { id: teId(12), projectId: projectId3, description: "Requirements gathering workshop", minutes: 240, billable: true, date: day(-3) },
    { id: teId(13), projectId: projectId3, description: "Fleet API research and evaluation", minutes: 240, billable: true, date: day(-1) },

    { id: teId(14), projectId: projectId4, description: "Brand discovery and moodboard creation", minutes: 480, billable: true, date: day(-25) },
    { id: teId(15), projectId: projectId4, description: "Homepage design and iteration", minutes: 720, billable: true, date: day(-18) },
    { id: teId(16), projectId: projectId4, description: "Responsive layout development", minutes: 960, billable: true, date: day(-12) },
    { id: teId(17), projectId: projectId4, description: "Contact forms and CMS integration", minutes: 540, billable: true, date: day(-7) },
    { id: teId(18), projectId: projectId4, description: "Review prep and client presentation materials", minutes: 180, billable: false, date: day(-2) },
  ]);

  console.log("Inserting activity logs...");
  await db.insert(activityLogs).values([
    { id: alId(1), entityType: "project", entityId: projectId1, projectId: projectId1, action: "stage_changed", details: { from: "kickoff", to: "in_progress" }, createdBy: "admin", createdAt: day(-14) },
    { id: alId(2), entityType: "task", entityId: tkId(5), projectId: projectId1, action: "task_completed", details: { title: "Set up HIPAA-compliant hosting" }, createdBy: "admin", createdAt: day(-8) },
    { id: alId(3), entityType: "project", entityId: projectId1, projectId: projectId1, action: "time_logged", details: { minutes: 960, description: "Backend API architecture" }, createdBy: "admin", createdAt: day(-14) },
    { id: alId(4), entityType: "task", entityId: tkId(1), projectId: projectId1, action: "task_completed", details: { title: "Finalize patient dashboard wireframes" }, createdBy: "admin", createdAt: day(-5) },
    { id: alId(5), entityType: "project", entityId: projectId2, projectId: projectId2, action: "stage_changed", details: { from: "discovery", to: "proposal" }, createdBy: "admin", createdAt: day(-6) },
    { id: alId(6), entityType: "gate", entityId: sgId(12), projectId: projectId2, action: "gate_completed", details: { title: "Competitive analysis done" }, createdBy: "admin", createdAt: day(-6) },
    { id: alId(7), entityType: "project", entityId: projectId3, projectId: projectId3, action: "stage_changed", details: { from: "contract", to: "kickoff" }, createdBy: "admin", createdAt: day(-2) },
    { id: alId(8), entityType: "task", entityId: tkId(13), projectId: projectId3, action: "task_completed", details: { title: "Define GPS tracking requirements" }, createdBy: "admin", createdAt: day(-1) },
    { id: alId(9), entityType: "project", entityId: projectId4, projectId: projectId4, action: "note_added", details: { note: "Client needs extra time for brand guidelines review" }, createdBy: "admin", createdAt: day(-3) },
    { id: alId(10), entityType: "project", entityId: projectId4, projectId: projectId4, action: "stage_changed", details: { from: "in_progress", to: "review" }, createdBy: "admin", createdAt: day(-4) },
    { id: alId(11), entityType: "task", entityId: tkId(4), projectId: projectId1, action: "task_completed", details: { title: "Design email notification templates" }, createdBy: "admin", createdAt: day(-3) },
    { id: alId(12), entityType: "task", entityId: tkId(18), projectId: projectId4, action: "task_completed", details: { title: "Design homepage mockup" }, createdBy: "admin", createdAt: day(-10) },
    { id: alId(13), entityType: "project", entityId: projectId1, projectId: projectId1, action: "gate_completed", details: { title: "Design mockups approved" }, createdBy: "admin", createdAt: day(-7) },
  ]);

  console.log("Inserting project template...");
  await db.insert(projectTemplates).values([
    { id: templateId1, name: "Standard Web Project", description: "Complete web project template with all standard stages, gates, and milestones." },
  ]);

  const stageOrder: [string, number][] = [
    ["discovery", 0], ["proposal", 1], ["contract", 2], ["kickoff", 3],
    ["in_progress", 4], ["review", 5], ["completed", 6],
  ];

  let tsN = 1;
  await db.insert(templateStages).values(
    stageOrder.map(([stage, order]) => ({
      id: tsId(tsN++),
      templateId: templateId1,
      stageName: stage as any,
      stageOrder: order,
    }))
  );

  let tgN = 1;
  const tGates: { stageIdx: number; title: string }[] = [
    { stageIdx: 0, title: "Requirements doc complete" },
    { stageIdx: 0, title: "Stakeholder sign-off" },
    { stageIdx: 1, title: "Proposal sent to client" },
    { stageIdx: 1, title: "Pricing approved" },
    { stageIdx: 2, title: "SOW executed" },
    { stageIdx: 2, title: "Deposit received" },
    { stageIdx: 3, title: "Kickoff meeting complete" },
    { stageIdx: 3, title: "Environment setup" },
    { stageIdx: 4, title: "Design approved" },
    { stageIdx: 4, title: "Development complete" },
    { stageIdx: 4, title: "Content loaded" },
    { stageIdx: 5, title: "QA complete" },
    { stageIdx: 5, title: "Client review done" },
    { stageIdx: 6, title: "Final invoice sent" },
    { stageIdx: 6, title: "Project retrospective" },
  ];

  await db.insert(templateGates).values(
    tGates.map((g, i) => ({
      id: tgId(tgN++),
      templateStageId: tsId(g.stageIdx + 1),
      stageName: stageOrder[g.stageIdx][0] as any,
      title: g.title,
      sortOrder: i,
    }))
  );

  let tmN = 1;
  const tMilestones = [
    { title: "Discovery Complete", days: 0 },
    { title: "Design Phase", days: 14 },
    { title: "Development Sprint 1", days: 28 },
    { title: "Development Sprint 2", days: 42 },
    { title: "QA & Testing", days: 56 },
    { title: "Launch", days: 70 },
  ];

  await db.insert(templateMilestones).values(
    tMilestones.map((m, i) => ({
      id: tmId(tmN++),
      templateId: templateId1,
      title: m.title,
      defaultDaysOffset: m.days,
      sortOrder: i,
    }))
  );

  let ttN = 1;
  const tTasks = [
    { title: "Stakeholder interviews", days: 0, priority: "high" },
    { title: "Requirements documentation", days: 3, priority: "high" },
    { title: "Wireframe creation", days: 14, priority: "high" },
    { title: "Design mockups", days: 17, priority: "high" },
    { title: "Frontend development", days: 28, priority: "high" },
    { title: "Backend API development", days: 28, priority: "high" },
    { title: "Database setup", days: 28, priority: "medium" },
    { title: "Integration testing", days: 49, priority: "high" },
    { title: "Bug fixes", days: 56, priority: "urgent" },
    { title: "Client training", days: 63, priority: "medium" },
    { title: "Launch checklist", days: 68, priority: "urgent" },
  ];

  await db.insert(templateTasks).values(
    tTasks.map((t, i) => ({
      id: ttId(ttN++),
      templateId: templateId1,
      title: t.title,
      priority: t.priority,
      defaultDaysOffset: t.days,
      sortOrder: i,
    }))
  );

  console.log("Inserting scheduled followups...");
  await db.insert(scheduledFollowups).values([
    { id: sfId(1), entityType: "project", entityId: projectId4, scheduledFor: day(1), type: "24h", status: "pending" },
    { id: sfId(2), entityType: "project", entityId: projectId2, scheduledFor: day(2), type: "proposal_followup", status: "pending" },
  ]);

  console.log("Seed complete");
  process.exit(0);
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
