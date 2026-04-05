import { db } from "./db";
import {
  projectTemplates, templateStages, templateGates,
  templateMilestones, templateTasks,
} from "@shared/schema";

const templateId1 = "f0000001-0000-0000-0000-000000000001";

const tsId = (n: number) => `a1000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const tgId = (n: number) => `a2000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const tmId = (n: number) => `a3000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const ttId = (n: number) => `a4000000-0000-0000-0000-${String(n).padStart(12, "0")}`;

export async function ensureTemplates() {
  try {
    const existing = await db.select().from(projectTemplates).limit(1);
    if (existing.length > 0) return;

    console.log("Seeding default project template...");

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

    console.log("Default template seeded successfully.");
  } catch (err) {
    console.error("Template seeding error (non-fatal):", err);
  }
}
