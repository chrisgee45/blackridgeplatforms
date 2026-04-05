// Ops routes - registered from server/routes.ts via registerOpsRoutes()
import type { Express, RequestHandler } from "express";
import {
  insertProjectSchema, insertCompanySchema, insertContactPersonSchema,
  insertStageGateSchema, insertMilestoneSchema, insertTaskSchema,
  insertTimeEntrySchema, projectStageZod, insertProjectPaymentSchema,
  insertClientSchema, insertDealSchema, insertSubscriptionSchema,
} from "@shared/schema";
import { opsStorage } from "./ops-storage";
import { storage } from "./storage";
import { outreachStorage } from "./outreach-storage";
import { bookkeepingStorage } from "./bookkeeping-storage";
import { triggerWelcomeSequence } from "./welcome-sequence";
import { ZodError } from "zod";
import { fromZodError } from "zod-validation-error";
import { jsPDF } from "jspdf";

function param(req: any, key: string): string {
  const v = req.params?.[key];
  if (Array.isArray(v)) return v[0];
  return String(v ?? "");
}
import { ObjectStorageService, objectStorageClient } from "./replit_integrations/object_storage/objectStorage";
import { randomUUID } from "crypto";

export function registerOpsRoutes(app: Express, isAuthenticated: RequestHandler) {

  // === Projects ===

  app.get("/api/ops/projects", isAuthenticated, async (_req, res) => {
    try {
      const projects = await opsStorage.getProjects();
      res.json(projects);
    } catch (error) {
      console.error("Get projects error:", error);
      res.status(500).json({ message: "Failed to fetch projects" });
    }
  });

  app.post("/api/ops/projects", isAuthenticated, async (req, res) => {
    try {
      const validated = insertProjectSchema.parse(req.body);
      const project = await opsStorage.createProject(validated);
      await opsStorage.createActivityLog({
        entityType: "project",
        entityId: project.id,
        projectId: project.id,
        action: "created",
        details: { name: project.name },
        createdBy: "admin",
      });
      res.status(201).json(project);
    } catch (error) {
      if (error instanceof ZodError) {
        res.status(400).json({ message: fromZodError(error).message });
      } else {
        console.error("Create project error:", error);
        res.status(500).json({ message: "Failed to create project" });
      }
    }
  });

  app.get("/api/ops/projects/:id", isAuthenticated, async (req, res) => {
    try {
      const project = await opsStorage.getProject(String(req.params.id));
      if (!project) return res.status(404).json({ message: "Project not found" });
      res.json(project);
    } catch (error) {
      console.error("Get project error:", error);
      res.status(500).json({ message: "Failed to fetch project" });
    }
  });

  app.patch("/api/ops/projects/:id", isAuthenticated, async (req, res) => {
    try {
      const project = await opsStorage.updateProject(String(req.params.id), req.body);
      if (!project) return res.status(404).json({ message: "Project not found" });
      await opsStorage.createActivityLog({
        entityType: "project",
        entityId: project.id,
        projectId: project.id,
        action: "updated",
        details: req.body,
        createdBy: "admin",
      });
      res.json(project);
    } catch (error) {
      console.error("Update project error:", error);
      res.status(500).json({ message: "Failed to update project" });
    }
  });

  app.delete("/api/ops/projects/:id", isAuthenticated, async (req, res) => {
    try {
      const projectId = String(req.params.id);
      const project = await opsStorage.getProject(projectId);
      if (!project) return res.status(404).json({ message: "Project not found" });
      const reason = typeof req.body?.reason === "string" ? req.body.reason.trim() : "";
      if (!reason) return res.status(400).json({ message: "A reason for deletion is required" });
      const deleted = await opsStorage.deleteProject(projectId);
      if (!deleted) return res.status(404).json({ message: "Project not found" });
      await opsStorage.createActivityLog({
        entityType: "project",
        entityId: projectId,
        projectId: projectId,
        action: "deleted",
        details: { projectName: project.name, reason: reason || "No reason provided" },
        createdBy: "admin",
      });
      res.json({ success: true });
    } catch (error) {
      console.error("Delete project error:", error);
      res.status(500).json({ message: "Failed to delete project" });
    }
  });

  // === Stage Advance ===

  app.post("/api/ops/projects/:id/stage", isAuthenticated, async (req, res) => {
    try {
      const project = await opsStorage.getProject(String(req.params.id));
      if (!project) return res.status(404).json({ message: "Project not found" });

      const { stage } = req.body;
      const validStage = projectStageZod.safeParse(stage);
      if (!validStage.success) return res.status(400).json({ message: "Invalid stage" });

      const gates = await opsStorage.getStageGates(String(req.params.id), stage);
      const incompleteGates = gates.filter(g => !g.isCompleted);

      if (incompleteGates.length > 0) {
        return res.status(409).json({
          message: "Stage gates incomplete",
          blockedGates: incompleteGates.map(g => g.title),
        });
      }

      if (stage === "completed") {
        const qaItems = await opsStorage.getQaChecklist(String(req.params.id));
        if (qaItems.length > 0) {
          const qaScore = await opsStorage.getQaScore(String(req.params.id));
          if (qaScore.score < 95) {
            return res.status(409).json({
              message: `QA score must be 95% or above to mark project as completed. Current score: ${qaScore.score}%`,
              qaScore: qaScore,
            });
          }
        }
      }

      const oldStage = project.stage;
      const updated = await opsStorage.updateProject(String(req.params.id), {
        stage: stage,
        stageChangedAt: new Date(),
      } as any);

      await opsStorage.createActivityLog({
        entityType: "project",
        entityId: String(req.params.id),
        projectId: String(req.params.id),
        action: "stage_changed",
        details: { from: oldStage, to: stage },
        createdBy: "admin",
      });

      if (stage === "in_progress" && oldStage !== "in_progress") {
        triggerWelcomeSequence(String(req.params.id), "auto").catch(err =>
          console.error("Auto welcome sequence error:", err)
        );
      }

      res.json(updated);
    } catch (error) {
      console.error("Stage advance error:", error);
      res.status(500).json({ message: "Failed to advance stage" });
    }
  });

  // === Stage Gates ===

  app.get("/api/ops/projects/:id/gates", isAuthenticated, async (req, res) => {
    try {
      const gates = await opsStorage.getStageGates(String(req.params.id));
      res.json(gates);
    } catch (error) {
      console.error("Get gates error:", error);
      res.status(500).json({ message: "Failed to fetch gates" });
    }
  });

  app.post("/api/ops/projects/:id/gates", isAuthenticated, async (req, res) => {
    try {
      const data = { ...req.body, projectId: String(req.params.id) };
      const validated = insertStageGateSchema.parse(data);
      const gate = await opsStorage.createStageGate(validated);
      await opsStorage.createActivityLog({
        entityType: "gate",
        entityId: gate.id,
        projectId: String(req.params.id),
        action: "created",
        details: { title: gate.title, stageName: gate.stageName },
        createdBy: "admin",
      });
      res.status(201).json(gate);
    } catch (error) {
      if (error instanceof ZodError) {
        res.status(400).json({ message: fromZodError(error).message });
      } else {
        console.error("Create gate error:", error);
        res.status(500).json({ message: "Failed to create gate" });
      }
    }
  });

  app.patch("/api/ops/gates/:id", isAuthenticated, async (req, res) => {
    try {
      const updateData: any = { ...req.body };
      if (updateData.isCompleted === true) {
        updateData.completedAt = new Date();
      }
      const gate = await opsStorage.updateStageGate(String(req.params.id), updateData);
      if (!gate) return res.status(404).json({ message: "Gate not found" });
      await opsStorage.createActivityLog({
        entityType: "gate",
        entityId: gate.id,
        projectId: gate.projectId,
        action: updateData.isCompleted ? "completed" : "updated",
        details: updateData,
        createdBy: "admin",
      });
      res.json(gate);
    } catch (error) {
      console.error("Update gate error:", error);
      res.status(500).json({ message: "Failed to update gate" });
    }
  });

  // === Milestones ===

  app.get("/api/ops/projects/:id/milestones", isAuthenticated, async (req, res) => {
    try {
      const milestones = await opsStorage.getMilestones(String(req.params.id));
      res.json(milestones);
    } catch (error) {
      console.error("Get milestones error:", error);
      res.status(500).json({ message: "Failed to fetch milestones" });
    }
  });

  app.post("/api/ops/projects/:id/milestones", isAuthenticated, async (req, res) => {
    try {
      const data = { ...req.body, projectId: String(req.params.id) };
      const validated = insertMilestoneSchema.parse(data);
      const milestone = await opsStorage.createMilestone(validated);
      await opsStorage.createActivityLog({
        entityType: "milestone",
        entityId: milestone.id,
        projectId: String(req.params.id),
        action: "created",
        details: { title: milestone.title },
        createdBy: "admin",
      });
      res.status(201).json(milestone);
    } catch (error) {
      if (error instanceof ZodError) {
        res.status(400).json({ message: fromZodError(error).message });
      } else {
        console.error("Create milestone error:", error);
        res.status(500).json({ message: "Failed to create milestone" });
      }
    }
  });

  app.patch("/api/ops/milestones/:id", isAuthenticated, async (req, res) => {
    try {
      const milestone = await opsStorage.updateMilestone(String(req.params.id), req.body);
      if (!milestone) return res.status(404).json({ message: "Milestone not found" });
      await opsStorage.createActivityLog({
        entityType: "milestone",
        entityId: milestone.id,
        projectId: milestone.projectId,
        action: "updated",
        details: req.body,
        createdBy: "admin",
      });
      res.json(milestone);
    } catch (error) {
      console.error("Update milestone error:", error);
      res.status(500).json({ message: "Failed to update milestone" });
    }
  });

  // === Tasks ===

  app.get("/api/ops/tasks", isAuthenticated, async (_req, res) => {
    try {
      const allTasks = await opsStorage.getAllTasks();
      res.json(allTasks);
    } catch (error) {
      console.error("Get all tasks error:", error);
      res.status(500).json({ message: "Failed to fetch tasks" });
    }
  });

  app.get("/api/ops/projects/:id/tasks", isAuthenticated, async (req, res) => {
    try {
      const projectTasks = await opsStorage.getTasks(String(req.params.id));
      res.json(projectTasks);
    } catch (error) {
      console.error("Get tasks error:", error);
      res.status(500).json({ message: "Failed to fetch tasks" });
    }
  });

  app.post("/api/ops/projects/:id/tasks", isAuthenticated, async (req, res) => {
    try {
      const data = { ...req.body, projectId: String(req.params.id) };
      if (data.dueDate && typeof data.dueDate === "string") {
        data.dueDate = new Date(data.dueDate);
      }
      const validated = insertTaskSchema.parse(data);
      const task = await opsStorage.createTask(validated);
      await opsStorage.createActivityLog({
        entityType: "task",
        entityId: task.id,
        projectId: String(req.params.id),
        action: "created",
        details: { title: task.title },
        createdBy: "admin",
      });
      res.status(201).json(task);
    } catch (error) {
      if (error instanceof ZodError) {
        res.status(400).json({ message: fromZodError(error).message });
      } else {
        console.error("Create task error:", error);
        res.status(500).json({ message: "Failed to create task" });
      }
    }
  });

  app.patch("/api/ops/tasks/:id", isAuthenticated, async (req, res) => {
    try {
      const updateData: any = { ...req.body };
      if (updateData.dueDate && typeof updateData.dueDate === "string") {
        updateData.dueDate = new Date(updateData.dueDate);
      }
      if (updateData.status === "done") {
        updateData.completedAt = new Date();
      }
      const task = await opsStorage.updateTask(String(req.params.id), updateData);
      if (!task) return res.status(404).json({ message: "Task not found" });
      await opsStorage.createActivityLog({
        entityType: "task",
        entityId: task.id,
        projectId: task.projectId,
        action: updateData.status === "done" ? "completed" : "updated",
        details: updateData,
        createdBy: "admin",
      });
      res.json(task);
    } catch (error) {
      console.error("Update task error:", error);
      res.status(500).json({ message: "Failed to update task" });
    }
  });

  app.delete("/api/ops/tasks/:id", isAuthenticated, async (req, res) => {
    try {
      const task = await opsStorage.getTask(String(req.params.id));
      if (!task) return res.status(404).json({ message: "Task not found" });
      await opsStorage.deleteTask(String(req.params.id));
      await opsStorage.createActivityLog({
        entityType: "task",
        entityId: String(req.params.id),
        projectId: task.projectId,
        action: "deleted",
        details: { title: task.title },
        createdBy: "admin",
      });
      res.json({ success: true });
    } catch (error) {
      console.error("Delete task error:", error);
      res.status(500).json({ message: "Failed to delete task" });
    }
  });

  // === Time Entries ===

  app.get("/api/ops/projects/:id/time", isAuthenticated, async (req, res) => {
    try {
      const entries = await opsStorage.getTimeEntries(String(req.params.id));
      res.json(entries);
    } catch (error) {
      console.error("Get time entries error:", error);
      res.status(500).json({ message: "Failed to fetch time entries" });
    }
  });

  app.post("/api/ops/projects/:id/time", isAuthenticated, async (req, res) => {
    try {
      const data = {
        ...req.body,
        projectId: String(req.params.id),
        date: req.body.date ? new Date(req.body.date) : undefined,
        minutes: typeof req.body.minutes === "string" ? parseInt(req.body.minutes, 10) : req.body.minutes,
      };
      const validated = insertTimeEntrySchema.parse(data);
      const entry = await opsStorage.createTimeEntry(validated);
      await opsStorage.createActivityLog({
        entityType: "time_entry",
        entityId: entry.id,
        projectId: String(req.params.id),
        action: "created",
        details: { minutes: entry.minutes, description: entry.description },
        createdBy: "admin",
      });
      res.status(201).json(entry);
    } catch (error) {
      if (error instanceof ZodError) {
        res.status(400).json({ message: fromZodError(error).message });
      } else {
        console.error("Create time entry error:", error);
        res.status(500).json({ message: "Failed to create time entry" });
      }
    }
  });

  app.patch("/api/ops/time/:id", isAuthenticated, async (req, res) => {
    try {
      const entry = await opsStorage.updateTimeEntry(String(req.params.id), req.body);
      if (!entry) return res.status(404).json({ message: "Time entry not found" });
      await opsStorage.createActivityLog({
        entityType: "time_entry",
        entityId: entry.id,
        projectId: entry.projectId,
        action: "updated",
        details: req.body,
        createdBy: "admin",
      });
      res.json(entry);
    } catch (error) {
      console.error("Update time entry error:", error);
      res.status(500).json({ message: "Failed to update time entry" });
    }
  });

  app.delete("/api/ops/time/:id", isAuthenticated, async (req, res) => {
    try {
      const deleted = await opsStorage.deleteTimeEntry(String(req.params.id));
      if (!deleted) return res.status(404).json({ message: "Time entry not found" });
      await opsStorage.createActivityLog({
        entityType: "time_entry",
        entityId: String(req.params.id),
        projectId: null,
        action: "deleted",
        details: {},
        createdBy: "admin",
      });
      res.json({ success: true });
    } catch (error) {
      console.error("Delete time entry error:", error);
      res.status(500).json({ message: "Failed to delete time entry" });
    }
  });

  // === Activity Logs ===

  app.get("/api/ops/projects/:id/activity", isAuthenticated, async (req, res) => {
    try {
      const logs = await opsStorage.getActivityLogs(String(req.params.id));
      res.json(logs);
    } catch (error) {
      console.error("Get activity logs error:", error);
      res.status(500).json({ message: "Failed to fetch activity logs" });
    }
  });

  app.get("/api/ops/activity", isAuthenticated, async (req, res) => {
    try {
      const { entityType, entityId, limit } = req.query;
      const logs = await opsStorage.getActivityLogs(
        undefined,
        entityType as string | undefined,
        entityId as string | undefined,
        limit ? parseInt(limit as string) : undefined,
      );
      res.json(logs);
    } catch (error) {
      console.error("Get activity logs error:", error);
      res.status(500).json({ message: "Failed to fetch activity logs" });
    }
  });

  // === Companies ===

  app.get("/api/ops/companies", isAuthenticated, async (_req, res) => {
    try {
      const companiesList = await opsStorage.getCompanies();
      res.json(companiesList);
    } catch (error) {
      console.error("Get companies error:", error);
      res.status(500).json({ message: "Failed to fetch companies" });
    }
  });

  app.post("/api/ops/companies", isAuthenticated, async (req, res) => {
    try {
      const validated = insertCompanySchema.parse(req.body);
      const company = await opsStorage.createCompany(validated);
      await opsStorage.createActivityLog({
        entityType: "company",
        entityId: company.id,
        projectId: null,
        action: "created",
        details: { name: company.name },
        createdBy: "admin",
      });
      res.status(201).json(company);
    } catch (error) {
      if (error instanceof ZodError) {
        res.status(400).json({ message: fromZodError(error).message });
      } else {
        console.error("Create company error:", error);
        res.status(500).json({ message: "Failed to create company" });
      }
    }
  });

  app.get("/api/ops/companies/:id", isAuthenticated, async (req, res) => {
    try {
      const company = await opsStorage.getCompany(String(req.params.id));
      if (!company) return res.status(404).json({ message: "Company not found" });
      const companyContacts = await opsStorage.getContacts(String(req.params.id));
      res.json({ ...company, contacts: companyContacts });
    } catch (error) {
      console.error("Get company error:", error);
      res.status(500).json({ message: "Failed to fetch company" });
    }
  });

  app.patch("/api/ops/companies/:id", isAuthenticated, async (req, res) => {
    try {
      const company = await opsStorage.updateCompany(String(req.params.id), req.body);
      if (!company) return res.status(404).json({ message: "Company not found" });
      await opsStorage.createActivityLog({
        entityType: "company",
        entityId: company.id,
        projectId: null,
        action: "updated",
        details: req.body,
        createdBy: "admin",
      });
      res.json(company);
    } catch (error) {
      console.error("Update company error:", error);
      res.status(500).json({ message: "Failed to update company" });
    }
  });

  app.delete("/api/ops/companies/:id", isAuthenticated, async (req, res) => {
    try {
      const deleted = await opsStorage.deleteCompany(String(req.params.id));
      if (!deleted) return res.status(404).json({ message: "Company not found" });
      await opsStorage.createActivityLog({
        entityType: "company",
        entityId: String(req.params.id),
        projectId: null,
        action: "deleted",
        details: {},
        createdBy: "admin",
      });
      res.json({ success: true });
    } catch (error) {
      console.error("Delete company error:", error);
      res.status(500).json({ message: "Failed to delete company" });
    }
  });

  // === Contacts ===

  app.get("/api/ops/contacts", isAuthenticated, async (req, res) => {
    try {
      const { companyId } = req.query;
      const contactsList = await opsStorage.getContacts(companyId as string | undefined);
      res.json(contactsList);
    } catch (error) {
      console.error("Get contacts error:", error);
      res.status(500).json({ message: "Failed to fetch contacts" });
    }
  });

  app.post("/api/ops/contacts", isAuthenticated, async (req, res) => {
    try {
      const validated = insertContactPersonSchema.parse(req.body);
      const contact = await opsStorage.createContact(validated);
      await opsStorage.createActivityLog({
        entityType: "contact",
        entityId: contact.id,
        projectId: null,
        action: "created",
        details: { name: contact.name },
        createdBy: "admin",
      });
      res.status(201).json(contact);
    } catch (error) {
      if (error instanceof ZodError) {
        res.status(400).json({ message: fromZodError(error).message });
      } else {
        console.error("Create contact error:", error);
        res.status(500).json({ message: "Failed to create contact" });
      }
    }
  });

  app.patch("/api/ops/contacts/:id", isAuthenticated, async (req, res) => {
    try {
      const contact = await opsStorage.updateContact(String(req.params.id), req.body);
      if (!contact) return res.status(404).json({ message: "Contact not found" });
      await opsStorage.createActivityLog({
        entityType: "contact",
        entityId: contact.id,
        projectId: null,
        action: "updated",
        details: req.body,
        createdBy: "admin",
      });
      res.json(contact);
    } catch (error) {
      console.error("Update contact error:", error);
      res.status(500).json({ message: "Failed to update contact" });
    }
  });

  app.delete("/api/ops/contacts/:id", isAuthenticated, async (req, res) => {
    try {
      const deleted = await opsStorage.deleteContact(String(req.params.id));
      if (!deleted) return res.status(404).json({ message: "Contact not found" });
      await opsStorage.createActivityLog({
        entityType: "contact",
        entityId: String(req.params.id),
        projectId: null,
        action: "deleted",
        details: {},
        createdBy: "admin",
      });
      res.json({ success: true });
    } catch (error) {
      console.error("Delete contact error:", error);
      res.status(500).json({ message: "Failed to delete contact" });
    }
  });

  // === Templates ===

  app.get("/api/ops/templates", isAuthenticated, async (_req, res) => {
    try {
      const templates = await opsStorage.getTemplates();
      res.json(templates);
    } catch (error) {
      console.error("Get templates error:", error);
      res.status(500).json({ message: "Failed to fetch templates" });
    }
  });

  app.get("/api/ops/templates/:id", isAuthenticated, async (req, res) => {
    try {
      const template = await opsStorage.getTemplate(String(req.params.id));
      if (!template) return res.status(404).json({ message: "Template not found" });
      const [stages, gates, milestonesList, tasksList] = await Promise.all([
        opsStorage.getTemplateStages(String(req.params.id)),
        opsStorage.getAllTemplateGatesForTemplate(String(req.params.id)),
        opsStorage.getTemplateMilestones(String(req.params.id)),
        opsStorage.getTemplateTasks(String(req.params.id)),
      ]);
      res.json({ ...template, stages, gates, milestones: milestonesList, tasks: tasksList });
    } catch (error) {
      console.error("Get template error:", error);
      res.status(500).json({ message: "Failed to fetch template" });
    }
  });

  // === Generate Project from Template ===

  app.post("/api/ops/templates/:id/generate", isAuthenticated, async (req, res) => {
    try {
      const templateId = String(req.params.id);
      const { projectName, companyId, startDate } = req.body as {
        projectName: string;
        companyId?: string;
        startDate?: string;
      };

      if (!projectName || !projectName.trim()) {
        return res.status(400).json({ message: "Project name is required" });
      }

      const template = await opsStorage.getTemplate(templateId);
      if (!template) return res.status(404).json({ message: "Template not found" });

      const [stages, gates, milestonesList, tasksList] = await Promise.all([
        opsStorage.getTemplateStages(templateId),
        opsStorage.getAllTemplateGatesForTemplate(templateId),
        opsStorage.getTemplateMilestones(templateId),
        opsStorage.getTemplateTasks(templateId),
      ]);

      const baseDate = startDate ? new Date(startDate) : new Date();
      const firstStage = stages.length > 0 ? stages[0].stageName : "discovery";

      const project = await opsStorage.createProject({
        name: projectName.trim(),
        companyId: companyId || null,
        stage: firstStage,
        templateId,
      });

      for (const stage of stages) {
        const stageGatesList = gates.filter((g) => g.stageName === stage.stageName);
        for (const gate of stageGatesList) {
          await opsStorage.createStageGate({
            projectId: project.id,
            stageName: stage.stageName,
            title: gate.title,
            description: gate.description ?? undefined,
            isCompleted: false,
            sortOrder: gate.sortOrder ?? 0,
          });
        }
      }

      const milestoneIdMap = new Map<string, string>();
      for (const ms of milestonesList) {
        const dueDate = new Date(baseDate);
        dueDate.setDate(dueDate.getDate() + (ms.defaultDaysOffset ?? 0));
        const created = await opsStorage.createMilestone({
          projectId: project.id,
          title: ms.title,
          dueDate: dueDate,
          sortOrder: ms.sortOrder ?? 0,
        });
        milestoneIdMap.set(ms.id, created.id);
      }

      for (const task of tasksList) {
        const dueDate = new Date(baseDate);
        dueDate.setDate(dueDate.getDate() + (task.defaultDaysOffset ?? 0));
        await opsStorage.createTask({
          projectId: project.id,
          milestoneId: task.templateMilestoneId ? milestoneIdMap.get(task.templateMilestoneId) ?? null : null,
          title: task.title,
          description: task.description ?? undefined,
          priority: task.priority ?? "medium",
          status: "todo",
          dueDate: dueDate,
          sortOrder: task.sortOrder ?? 0,
        });
      }

      await opsStorage.createActivityLog({
        entityType: "project",
        entityId: project.id,
        projectId: project.id,
        action: "created_from_template",
        details: { templateName: template.name, templateId, projectName: project.name },
        createdBy: "admin",
      });

      res.status(201).json(project);
    } catch (error) {
      console.error("Generate project from template error:", error);
      res.status(500).json({ message: "Failed to generate project from template" });
    }
  });

  // === Apply Template to Existing Project ===

  app.post("/api/ops/projects/:id/apply-template", isAuthenticated, async (req, res) => {
    try {
      const projectId = String(req.params.id);
      const { templateId, startDate } = req.body as {
        templateId: string;
        startDate?: string;
      };

      if (!templateId) {
        return res.status(400).json({ message: "Template ID is required" });
      }

      const project = await opsStorage.getProject(projectId);
      if (!project) return res.status(404).json({ message: "Project not found" });

      if (project.templateId) {
        return res.status(409).json({ message: "This project already has a template applied" });
      }

      const template = await opsStorage.getTemplate(templateId);
      if (!template) return res.status(404).json({ message: "Template not found" });

      const [stages, gates, milestonesList, tasksList] = await Promise.all([
        opsStorage.getTemplateStages(templateId),
        opsStorage.getAllTemplateGatesForTemplate(templateId),
        opsStorage.getTemplateMilestones(templateId),
        opsStorage.getTemplateTasks(templateId),
      ]);

      const baseDate = startDate ? new Date(startDate) : new Date();

      for (const stage of stages) {
        const stageGatesList = gates.filter((g) => g.stageName === stage.stageName);
        for (const gate of stageGatesList) {
          await opsStorage.createStageGate({
            projectId,
            stageName: stage.stageName,
            title: gate.title,
            description: gate.description ?? undefined,
            isCompleted: false,
            sortOrder: gate.sortOrder ?? 0,
          });
        }
      }

      const milestoneIdMap = new Map<string, string>();
      for (const ms of milestonesList) {
        const dueDate = new Date(baseDate);
        dueDate.setDate(dueDate.getDate() + (ms.defaultDaysOffset ?? 0));
        const created = await opsStorage.createMilestone({
          projectId,
          title: ms.title,
          dueDate: dueDate,
          sortOrder: ms.sortOrder ?? 0,
        });
        milestoneIdMap.set(ms.id, created.id);
      }

      for (const task of tasksList) {
        const dueDate = new Date(baseDate);
        dueDate.setDate(dueDate.getDate() + (task.defaultDaysOffset ?? 0));
        await opsStorage.createTask({
          projectId,
          milestoneId: task.templateMilestoneId ? milestoneIdMap.get(task.templateMilestoneId) ?? null : null,
          title: task.title,
          description: task.description ?? undefined,
          priority: task.priority ?? "medium",
          status: "todo",
          dueDate: dueDate,
          sortOrder: task.sortOrder ?? 0,
        });
      }

      await opsStorage.updateProject(projectId, { templateId });

      await opsStorage.createActivityLog({
        entityType: "project",
        entityId: projectId,
        projectId,
        action: "template_applied",
        details: { templateName: template.name, templateId },
        createdBy: "admin",
      });

      const updated = await opsStorage.getProject(projectId);
      res.json(updated);
    } catch (error) {
      console.error("Apply template to project error:", error);
      res.status(500).json({ message: "Failed to apply template to project" });
    }
  });

  // === Convert Lead to Project ===

  app.post("/api/ops/convert-lead", isAuthenticated, async (req, res) => {
    try {
      const { leadId, projectName, templateId, companyId, contactId } = req.body as {
        leadId: string;
        projectName?: string;
        templateId?: string;
        companyId?: string;
        contactId?: string;
      };

      if (!leadId) return res.status(400).json({ message: "leadId is required" });

      const lead = await storage.getContactSubmission(leadId);
      if (!lead) return res.status(404).json({ message: "Lead not found" });

      let finalCompanyId = companyId || null;
      let finalContactId = contactId || null;

      if (!finalCompanyId && lead.company) {
        const existingCompanies = await opsStorage.getCompanies();
        const match = existingCompanies.find(
          (c) => c.name.toLowerCase() === lead.company!.toLowerCase()
        );
        if (match) {
          finalCompanyId = match.id;
        } else {
          const newCompany = await opsStorage.createCompany({ name: lead.company });
          finalCompanyId = newCompany.id;
          await opsStorage.createActivityLog({
            entityType: "company",
            entityId: newCompany.id,
            action: "created",
            details: { name: newCompany.name, source: "lead_conversion", leadId },
            createdBy: "admin",
          });
        }
      }

      if (!finalContactId && lead.name) {
        const existingContacts = await opsStorage.getContacts();
        const match = existingContacts.find(
          (c) => c.email?.toLowerCase() === lead.email.toLowerCase()
        );
        if (match) {
          finalContactId = match.id;
        } else {
          const newContact = await opsStorage.createContact({
            name: lead.name,
            email: lead.email,
            companyId: finalCompanyId,
            isPrimary: true,
          });
          finalContactId = newContact.id;
          await opsStorage.createActivityLog({
            entityType: "contact",
            entityId: newContact.id,
            action: "created",
            details: { name: newContact.name, source: "lead_conversion", leadId },
            createdBy: "admin",
          });
        }
      }

      const name = projectName?.trim() || `${lead.company || lead.name} - Website Project`;

      const budgetMap: Record<string, number> = {
        "$1,000-$2,500": 1750,
        "$2,500-$5,000": 3750,
        "$5K-$15K": 10000,
        "$15K-$30K": 22500,
        "$30K-$75K": 52500,
        "$75K-$150K": 112500,
        "$150K+": 150000,
      };
      const contractValue = lead.projectedValue || (lead.budget ? budgetMap[lead.budget] : null) || null;

      let project;

      if (templateId) {
        const template = await opsStorage.getTemplate(templateId);
        if (!template) return res.status(404).json({ message: "Template not found" });

        const [stages, gates, milestonesList, tasksList] = await Promise.all([
          opsStorage.getTemplateStages(templateId),
          opsStorage.getAllTemplateGatesForTemplate(templateId),
          opsStorage.getTemplateMilestones(templateId),
          opsStorage.getTemplateTasks(templateId),
        ]);

        const firstStage = stages.length > 0 ? stages[0].stageName : "discovery";

        project = await opsStorage.createProject({
          name,
          companyId: finalCompanyId,
          contactId: finalContactId,
          leadId,
          stage: firstStage,
          contractValue,
          templateId,
        });

        for (const stage of stages) {
          const stageGatesList = gates.filter((g) => g.stageName === stage.stageName);
          for (const gate of stageGatesList) {
            await opsStorage.createStageGate({
              projectId: project.id,
              stageName: stage.stageName,
              title: gate.title,
              description: gate.description ?? undefined,
              isCompleted: false,
              sortOrder: gate.sortOrder ?? 0,
            });
          }
        }

        const milestoneIdMap = new Map<string, string>();
        const baseDate = new Date();
        for (const ms of milestonesList) {
          const dueDate = new Date(baseDate);
          dueDate.setDate(dueDate.getDate() + (ms.defaultDaysOffset ?? 0));
          const created = await opsStorage.createMilestone({
            projectId: project.id,
            title: ms.title,
            dueDate,
            sortOrder: ms.sortOrder ?? 0,
          });
          milestoneIdMap.set(ms.id, created.id);
        }

        for (const task of tasksList) {
          const dueDate = new Date(baseDate);
          dueDate.setDate(dueDate.getDate() + (task.defaultDaysOffset ?? 0));
          await opsStorage.createTask({
            projectId: project.id,
            milestoneId: task.templateMilestoneId ? milestoneIdMap.get(task.templateMilestoneId) ?? null : null,
            title: task.title,
            description: task.description ?? undefined,
            priority: task.priority ?? "medium",
            status: "todo",
            dueDate,
            sortOrder: task.sortOrder ?? 0,
          });
        }
      } else {
        project = await opsStorage.createProject({
          name,
          companyId: finalCompanyId,
          contactId: finalContactId,
          leadId,
          stage: "discovery",
          contractValue,
        });
      }

      let client = await opsStorage.findClientByName(lead.company || lead.name);
      if (!client) {
        client = await opsStorage.createClient({
          name: lead.company || lead.name,
          email: lead.email,
          phone: (lead as any).phone || undefined,
          companyId: finalCompanyId || undefined,
          contactId: finalContactId || undefined,
          status: "active",
        });
      }

      await opsStorage.updateProject(project.id, { clientId: client.id });

      const dealValue = lead.projectedValue ? String(lead.projectedValue) : (contractValue ? String(contractValue) : "0");
      await opsStorage.createDeal({
        clientId: client.id,
        projectId: project.id,
        name: `${lead.company || lead.name} - ${name}`,
        value: dealValue,
        stage: "closed_won",
        probability: 100,
        closeDate: new Date(),
        notes: `Auto-created from lead-to-project conversion`,
      });

      await storage.updateContactSubmission(leadId, { status: "won", followUpDate: null });

      await opsStorage.cancelPendingFollowupsForEntity("lead", leadId);

      try {
        const outreachLead = await outreachStorage.getLeadByCrmId(leadId);
        if (outreachLead) {
          await outreachStorage.updateLead(outreachLead.id, { status: "won" });
          const enrollment = await outreachStorage.getEnrollmentByLead(outreachLead.id);
          if (enrollment && !enrollment.stoppedAt) {
            await outreachStorage.updateEnrollment(enrollment.id, {
              stoppedAt: new Date(),
              stopReason: "CRM lead converted to project (won)",
            });
          }
          await outreachStorage.skipQueuedJobsForLead(outreachLead.id);
        }
      } catch (e) {
        console.error("Failed to update linked outreach lead:", e);
      }

      await opsStorage.createActivityLog({
        entityType: "project",
        entityId: project.id,
        projectId: project.id,
        action: "created_from_lead",
        details: { leadId, leadName: lead.name, leadCompany: lead.company, clientId: client.id },
        createdBy: "admin",
      });

      res.status(201).json(project);
    } catch (error) {
      console.error("Convert lead to project error:", error);
      res.status(500).json({ message: "Failed to convert lead to project" });
    }
  });

  // === CRM Leads Search (for ops frontend) ===

  app.get("/api/ops/leads", isAuthenticated, async (_req, res) => {
    try {
      const leads = await storage.getContactSubmissions();
      const activeLeads = leads.filter(l => l.status !== "lost");
      res.json(activeLeads.map(l => ({
        id: l.id,
        name: l.name,
        email: l.email,
        company: l.company,
        projectType: l.projectType,
        budget: l.budget,
        status: l.status,
        projectedValue: l.projectedValue,
      })));
    } catch (error) {
      console.error("Get ops leads error:", error);
      res.status(500).json({ message: "Failed to fetch leads" });
    }
  });

  // === Global Search ===

  app.get("/api/ops/search", isAuthenticated, async (req, res) => {
    try {
      const q = String(req.query.q || "").trim().toLowerCase();
      if (!q || q.length < 2) {
        return res.json({ projects: [], companies: [], contacts: [], tasks: [], templates: [] });
      }

      const [allProjects, allCompanies, allContacts, allTasks, allTemplates] = await Promise.all([
        opsStorage.getProjects(),
        opsStorage.getCompanies(),
        opsStorage.getContacts(),
        opsStorage.getAllTasks(),
        opsStorage.getTemplates(),
      ]);

      const matchProjects = allProjects.filter(p =>
        p.name.toLowerCase().includes(q) || (p.description?.toLowerCase().includes(q))
      ).slice(0, 5);

      const matchCompanies = allCompanies.filter(c =>
        c.name.toLowerCase().includes(q) || (c.domain?.toLowerCase().includes(q))
      ).slice(0, 5);

      const matchContacts = allContacts.filter(c =>
        c.name.toLowerCase().includes(q) || (c.email?.toLowerCase().includes(q)) || (c.role?.toLowerCase().includes(q))
      ).slice(0, 5);

      const matchTasks = allTasks.filter(t =>
        t.title.toLowerCase().includes(q) || (t.description?.toLowerCase().includes(q))
      ).slice(0, 5);

      const matchTemplates = allTemplates.filter(t =>
        t.name.toLowerCase().includes(q) || (t.description?.toLowerCase().includes(q))
      ).slice(0, 3);

      res.json({
        projects: matchProjects,
        companies: matchCompanies,
        contacts: matchContacts,
        tasks: matchTasks,
        templates: matchTemplates,
      });
    } catch (error) {
      console.error("Search error:", error);
      res.status(500).json({ message: "Search failed" });
    }
  });

  // === Cockpit ===

  app.get("/api/ops/cockpit", isAuthenticated, async (_req, res) => {
    try {
      const [allTasks, allProjects] = await Promise.all([
        opsStorage.getAllTasks(),
        opsStorage.getProjects(),
      ]);

      const now = new Date();
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const todayEnd = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000);

      const incompleteTasks = allTasks.filter(t => t.status !== "done");
      const overdueTasks = incompleteTasks.filter(t => t.dueDate && new Date(t.dueDate) < todayStart);
      const dueTodayTasks = incompleteTasks.filter(t => {
        if (!t.dueDate) return false;
        const d = new Date(t.dueDate);
        return d >= todayStart && d < todayEnd;
      });

      const waitingOnClient = allProjects.filter(p => p.waitingOnClient);
      const revenueUnlockers = allProjects.filter(
        p => (p.stage === "review" || p.stage === "completed") && p.contractValue && p.contractValue > 0
      );

      res.json({ overdueTasks, dueTodayTasks, waitingOnClient, revenueUnlockers });
    } catch (error) {
      console.error("Get cockpit error:", error);
      res.status(500).json({ message: "Failed to fetch cockpit data" });
    }
  });

  // === Dashboard Stats ===

  app.get("/api/ops/dashboard", isAuthenticated, async (_req, res) => {
    try {
      const allProjects = await opsStorage.getProjects();

      const totalProjects = allProjects.length;
      const activeProjects = allProjects.filter(p => p.stage !== "archived" && p.stage !== "completed").length;
      const completedProjects = allProjects.filter(p => p.stage === "completed");

      const totalPipelineValue = allProjects
        .filter(p => p.stage !== "archived" && p.stage !== "completed")
        .reduce((sum, p) => sum + (p.contractValue || 0), 0);

      const totalRevenue = completedProjects.reduce((sum, p) => sum + (p.contractValue || 0), 0);

      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const stalledProjects = allProjects.filter(
        p => p.stage !== "completed" && p.stage !== "archived" && p.stageChangedAt && new Date(p.stageChangedAt) < sevenDaysAgo
      ).length;

      const stageMap = new Map<string, { count: number; value: number }>();
      for (const p of allProjects) {
        const entry = stageMap.get(p.stage) || { count: 0, value: 0 };
        entry.count++;
        entry.value += p.contractValue || 0;
        stageMap.set(p.stage, entry);
      }
      const projectsByStage = Array.from(stageMap.entries()).map(([stage, data]) => ({
        stage,
        count: data.count,
        value: data.value,
      }));

      const profitLeaderboard: { projectId: string; projectName: string; effectiveRate: number; totalHours: number }[] = [];
      for (const p of allProjects) {
        if (!p.contractValue) continue;
        const entries = await opsStorage.getTimeEntries(p.id);
        const totalMinutes = entries.reduce((sum, e) => sum + e.minutes, 0);
        if (totalMinutes === 0) continue;
        const totalHours = totalMinutes / 60;
        const effectiveRate = p.contractValue / totalHours;
        profitLeaderboard.push({
          projectId: p.id,
          projectName: p.name,
          effectiveRate: Math.round(effectiveRate * 100) / 100,
          totalHours: Math.round(totalHours * 100) / 100,
        });
      }
      profitLeaderboard.sort((a, b) => b.effectiveRate - a.effectiveRate);

      res.json({
        totalProjects,
        activeProjects,
        totalPipelineValue,
        totalRevenue,
        stalledProjects,
        projectsByStage,
        profitLeaderboard,
      });
    } catch (error) {
      console.error("Get dashboard error:", error);
      res.status(500).json({ message: "Failed to fetch dashboard data" });
    }
  });

  app.post("/api/ops/projects/:id/waiting", isAuthenticated, async (req, res) => {
    try {
      const id = String(req.params.id);
      const project = await opsStorage.getProject(id);
      if (!project) return res.status(404).json({ message: "Project not found" });

      const { enabled, blocker } = req.body as { enabled: boolean; blocker?: string };

      if (enabled) {
        if (!blocker || !blocker.trim()) {
          return res.status(400).json({ message: "Blocker description is required when marking as waiting on client" });
        }
        const now = new Date();
        const updated = await opsStorage.updateProject(id, {
          waitingOnClient: true,
          blocker: blocker.trim(),
          blockerSince: now,
        });

        const offsets = [
          { hours: 24, type: "24h follow-up" },
          { hours: 72, type: "72h follow-up" },
          { hours: 168, type: "7d escalation" },
        ];
        for (const offset of offsets) {
          const scheduledFor = new Date(now.getTime() + offset.hours * 60 * 60 * 1000);
          await opsStorage.createScheduledFollowup({
            entityType: "project",
            entityId: id,
            scheduledFor,
            type: offset.type,
            status: "pending",
          });
        }

        await opsStorage.createActivityLog({
          entityType: "project",
          entityId: id,
          projectId: id,
          action: "waiting_on_client",
          details: { blocker: blocker.trim() },
          createdBy: "admin",
        });

        res.json(updated);
      } else {
        const updated = await opsStorage.updateProject(id, {
          waitingOnClient: false,
          blocker: null,
          blockerSince: null,
        });

        const pending = await opsStorage.getScheduledFollowups("project", id, "pending");
        for (const f of pending) {
          await opsStorage.updateScheduledFollowup(f.id, { status: "cancelled" });
        }

        await opsStorage.createActivityLog({
          entityType: "project",
          entityId: id,
          projectId: id,
          action: "resumed",
          details: { message: "No longer waiting on client" },
          createdBy: "admin",
        });

        res.json(updated);
      }
    } catch (error) {
      console.error("Toggle waiting error:", error);
      res.status(500).json({ message: "Failed to update waiting status" });
    }
  });

  app.get("/api/ops/projects/:id/followups", isAuthenticated, async (req, res) => {
    try {
      const id = String(req.params.id);
      const followups = await opsStorage.getScheduledFollowups("project", id);
      res.json(followups);
    } catch (error) {
      console.error("Get followups error:", error);
      res.status(500).json({ message: "Failed to fetch followups" });
    }
  });

  app.patch("/api/ops/followups/:id", isAuthenticated, async (req, res) => {
    try {
      const id = String(req.params.id);
      const { status } = req.body as { status: string };
      const allowedStatuses = ["pending", "completed", "cancelled"];
      if (!status || !allowedStatuses.includes(status)) {
        return res.status(400).json({ message: `Invalid status. Allowed: ${allowedStatuses.join(", ")}` });
      }
      const updated = await opsStorage.updateScheduledFollowup(id, {
        status,
        completedAt: status === "completed" ? new Date() : null,
      });
      if (!updated) return res.status(404).json({ message: "Followup not found" });
      res.json(updated);
    } catch (error) {
      console.error("Update followup error:", error);
      res.status(500).json({ message: "Failed to update followup" });
    }
  });

  // === Project Payments ===

  app.get("/api/ops/projects/:id/payments", isAuthenticated, async (req, res) => {
    try {
      const payments = await opsStorage.getProjectPayments(String(req.params.id));
      res.json(payments);
    } catch (error) {
      console.error("Get payments error:", error);
      res.status(500).json({ message: "Failed to fetch payments" });
    }
  });

  app.post("/api/ops/projects/:id/payments", isAuthenticated, async (req, res) => {
    try {
      const data = {
        ...req.body,
        projectId: String(req.params.id),
        amount: typeof req.body.amount === "string" ? parseInt(req.body.amount, 10) : req.body.amount,
        dueDate: req.body.dueDate ? new Date(req.body.dueDate) : undefined,
        receivedDate: req.body.receivedDate ? new Date(req.body.receivedDate) : undefined,
      };
      const validated = insertProjectPaymentSchema.parse(data);
      const payment = await opsStorage.createProjectPayment(validated);
      await opsStorage.createActivityLog({
        entityType: "payment",
        entityId: payment.id,
        projectId: String(req.params.id),
        action: "created",
        details: { label: payment.label, amount: payment.amount, type: payment.type },
        createdBy: "admin",
      });

      if (payment.dueDate && payment.status === "pending") {
        await opsStorage.createScheduledFollowup({
          entityType: "payment",
          entityId: payment.id,
          scheduledFor: payment.dueDate,
          type: `Payment due: ${payment.label} (${new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(payment.amount)})`,
          status: "pending",
        });
      }

      res.status(201).json(payment);
    } catch (error) {
      if (error instanceof ZodError) {
        res.status(400).json({ message: fromZodError(error).message });
      } else {
        console.error("Create payment error:", error);
        res.status(500).json({ message: "Failed to create payment" });
      }
    }
  });

  app.patch("/api/ops/payments/:id", isAuthenticated, async (req, res) => {
    try {
      const updateData: any = { ...req.body };
      if (updateData.amount && typeof updateData.amount === "string") {
        updateData.amount = parseInt(updateData.amount, 10);
      }
      if (updateData.dueDate) updateData.dueDate = new Date(updateData.dueDate);
      if (updateData.receivedDate) updateData.receivedDate = new Date(updateData.receivedDate);

      const payment = await opsStorage.updateProjectPayment(String(req.params.id), updateData);
      if (!payment) return res.status(404).json({ message: "Payment not found" });

      const methodLabels: Record<string, string> = { stripe: "Stripe", cashapp: "Cash App", venmo: "Venmo", cash: "Cash", check: "Check" };
      const methodLabel = payment.paymentMethod ? methodLabels[payment.paymentMethod] || payment.paymentMethod : null;

      await opsStorage.createActivityLog({
        entityType: "payment",
        entityId: payment.id,
        projectId: payment.projectId,
        action: payment.status === "received" ? "payment_received" : "updated",
        details: { label: payment.label, amount: payment.amount, status: payment.status, paymentMethod: payment.paymentMethod },
        createdBy: "admin",
      });

      if (payment.status === "received") {
        const pending = await opsStorage.getScheduledFollowups("payment", payment.id, "pending");
        for (const f of pending) {
          await opsStorage.updateScheduledFollowup(f.id, { status: "completed", completedAt: new Date() });
        }
        const ledgerDesc = methodLabel
          ? `Project payment (${methodLabel}): ${payment.label}`
          : `Project payment: ${payment.label}`;
        try {
          await bookkeepingStorage.postPaymentToLedger(
            String(payment.amount),
            ledgerDesc,
            "project_payment",
            payment.id,
            true
          );
        } catch (e) {
          console.error("Auto-post project payment to ledger failed:", e);
        }
        try {
          const { recordRevenue, getAccountIdByCode } = await import("./accounting-v2");
          const revenueAcctId = await getAccountIdByCode("4000");
          const v2Method = (payment.paymentMethod === "stripe") ? "stripe" as const : "cash" as const;
          await recordRevenue({
            amount: payment.amount,
            revenueAccountId: revenueAcctId,
            paymentMethod: v2Method,
            occurredAt: payment.receivedDate ?? new Date(),
            memo: `Project payment: ${payment.label} ($${payment.amount})`,
            referenceType: "project_payment",
            referenceId: `project_payment_${payment.id}`,
          });
        } catch (e) {
          console.error("Auto-post project payment to v2 ledger failed:", e);
        }
      }

      res.json(payment);
    } catch (error) {
      console.error("Update payment error:", error);
      res.status(500).json({ message: "Failed to update payment" });
    }
  });

  app.delete("/api/ops/payments/:id", isAuthenticated, async (req, res) => {
    try {
      const deleted = await opsStorage.deleteProjectPayment(String(req.params.id));
      if (!deleted) return res.status(404).json({ message: "Payment not found" });
      await opsStorage.createActivityLog({
        entityType: "payment",
        entityId: String(req.params.id),
        projectId: null,
        action: "deleted",
        details: {},
        createdBy: "admin",
      });
      res.json({ success: true });
    } catch (error) {
      console.error("Delete payment error:", error);
      res.status(500).json({ message: "Failed to delete payment" });
    }
  });

  app.patch("/api/ops/payments/:id/uncollect", isAuthenticated, async (req, res) => {
    try {
      const paymentId = String(req.params.id);
      const payment = await opsStorage.updateProjectPayment(paymentId, {
        status: "pending",
        receivedDate: null,
        paymentMethod: null,
      });
      if (!payment) return res.status(404).json({ message: "Payment not found" });

      try {
        const { journalEntries, journalLines } = await import("@shared/schema");
        const { eq, and } = await import("drizzle-orm");
        const { db } = await import("./db");
        const entries = await db.select().from(journalEntries)
          .where(and(eq(journalEntries.sourceType, "project_payment"), eq(journalEntries.sourceId, paymentId)));
        for (const entry of entries) {
          await db.delete(journalLines).where(eq(journalLines.journalEntryId, entry.id));
          await db.delete(journalEntries).where(eq(journalEntries.id, entry.id));
        }
      } catch (e) {
        console.error("Failed to delete v1 journal for uncollected payment:", e);
      }

      try {
        const { transactionsV2, transactionLinesV2 } = await import("@shared/schema");
        const { eq } = await import("drizzle-orm");
        const { db } = await import("./db");
        const refId = `project_payment_${paymentId}`;
        const txns = await db.select().from(transactionsV2).where(eq(transactionsV2.referenceId, refId));
        for (const tx of txns) {
          await db.delete(transactionLinesV2).where(eq(transactionLinesV2.transactionId, tx.id));
          await db.delete(transactionsV2).where(eq(transactionsV2.id, tx.id));
        }
      } catch (e) {
        console.error("Failed to delete v2 transaction for uncollected payment:", e);
      }

      await opsStorage.createActivityLog({
        entityType: "payment",
        entityId: paymentId,
        projectId: payment.projectId,
        action: "payment_uncollected",
        details: { label: payment.label, amount: payment.amount },
        createdBy: "admin",
      });

      res.json(payment);
    } catch (error) {
      console.error("Uncollect payment error:", error);
      res.status(500).json({ message: "Failed to uncollect payment" });
    }
  });

  app.patch("/api/ops/payments/:id/exclude-ledger", isAuthenticated, async (req, res) => {
    try {
      const paymentId = String(req.params.id);
      const payment = await opsStorage.updateProjectPayment(paymentId, { ledgerExcluded: true } as any);
      if (!payment) return res.status(404).json({ message: "Payment not found" });

      try {
        const { journalEntries, journalLines } = await import("@shared/schema");
        const { eq, and } = await import("drizzle-orm");
        const { db } = await import("./db");
        const entries = await db.select().from(journalEntries)
          .where(and(eq(journalEntries.sourceType, "project_payment"), eq(journalEntries.sourceId, paymentId)));
        for (const entry of entries) {
          await db.delete(journalLines).where(eq(journalLines.journalEntryId, entry.id));
          await db.delete(journalEntries).where(eq(journalEntries.id, entry.id));
        }
      } catch (e) {
        console.error("Failed to delete v1 journal for excluded payment:", e);
      }

      try {
        const { transactionsV2, transactionLinesV2 } = await import("@shared/schema");
        const { eq } = await import("drizzle-orm");
        const { db } = await import("./db");
        const refId = `project_payment_${paymentId}`;
        const txns = await db.select().from(transactionsV2).where(eq(transactionsV2.referenceId, refId));
        for (const tx of txns) {
          await db.delete(transactionLinesV2).where(eq(transactionLinesV2.transactionId, tx.id));
          await db.delete(transactionsV2).where(eq(transactionsV2.id, tx.id));
        }
      } catch (e) {
        console.error("Failed to delete v2 transaction for excluded payment:", e);
      }

      await opsStorage.createActivityLog({
        entityType: "payment",
        entityId: paymentId,
        projectId: payment.projectId,
        action: "payment_excluded_from_ledger",
        details: { label: payment.label, amount: payment.amount },
        createdBy: "admin",
      });

      res.json({ success: true });
    } catch (error) {
      console.error("Exclude payment from ledger error:", error);
      res.status(500).json({ message: "Failed to exclude payment from ledger" });
    }
  });

  app.get("/api/ops/overdue-payments", isAuthenticated, async (_req, res) => {
    try {
      const payments = await opsStorage.getOverduePayments();
      res.json(payments);
    } catch (error) {
      console.error("Get overdue payments error:", error);
      res.status(500).json({ message: "Failed to fetch overdue payments" });
    }
  });

  // AI report routes moved to server/routes/ai.ts, mounted at /api/ai

  app.get("/api/ops/projects/:id/documents", isAuthenticated, async (req, res) => {
    try {
      const category = req.query.category as string | undefined;
      const docs = await opsStorage.getProjectDocuments(String(req.params.id), category);
      res.json(docs);
    } catch (error) {
      console.error("Get documents error:", error);
      res.status(500).json({ message: "Failed to fetch documents" });
    }
  });

  app.post("/api/ops/projects/:id/documents", isAuthenticated, async (req, res) => {
    try {
      const doc = await opsStorage.createProjectDocument({
        ...req.body,
        projectId: String(req.params.id),
      });
      await opsStorage.createActivityLog({
        entityType: "document",
        entityId: doc.id,
        projectId: String(req.params.id),
        action: "uploaded",
        details: { filename: doc.filename, category: doc.category },
        createdBy: "admin",
      });
      res.status(201).json(doc);
    } catch (error) {
      console.error("Create document error:", error);
      res.status(500).json({ message: "Failed to create document record" });
    }
  });

  app.patch("/api/ops/documents/:id", isAuthenticated, async (req, res) => {
    try {
      const doc = await opsStorage.updateProjectDocument(String(req.params.id), req.body);
      if (!doc) return res.status(404).json({ message: "Document not found" });
      res.json(doc);
    } catch (error) {
      console.error("Update document error:", error);
      res.status(500).json({ message: "Failed to update document" });
    }
  });

  app.delete("/api/ops/documents/:id", isAuthenticated, async (req, res) => {
    try {
      const deleted = await opsStorage.deleteProjectDocument(String(req.params.id));
      if (!deleted) return res.status(404).json({ message: "Document not found" });
      res.json({ success: true });
    } catch (error) {
      console.error("Delete document error:", error);
      res.status(500).json({ message: "Failed to delete document" });
    }
  });

  app.post("/api/ops/projects/:id/generate-invoice", isAuthenticated, async (req, res) => {
    try {
      const projectId = String(req.params.id);
      const project = await opsStorage.getProject(projectId);
      if (!project) return res.status(404).json({ message: "Project not found" });

      let company = null;
      if (project.companyId) {
        company = await opsStorage.getCompany(project.companyId);
      }
      let contact = null;
      if (project.contactId) {
        contact = await opsStorage.getContact(project.contactId);
      }

      const payments = await opsStorage.getProjectPayments(projectId);
      const { items, notes, dueDate } = req.body;

      const invNum = await opsStorage.getNextInvoiceNumber();

      const doc = new jsPDF();
      const pageWidth = doc.internal.pageSize.getWidth();
      const margin = 20;
      let y = 25;

      doc.setFontSize(24);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(20, 20, 30);
      doc.text("BLACKRIDGE", margin, y);
      doc.setFontSize(10);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(120, 120, 130);
      doc.text("PLATFORMS", margin + doc.getTextWidth("BLACKRIDGE ") * 2.4, y);
      y += 4;
      doc.setDrawColor(200, 170, 60);
      doc.setLineWidth(0.5);
      doc.line(margin, y, margin + 60, y);
      y += 12;

      doc.setFontSize(28);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(30, 30, 40);
      doc.text("INVOICE", pageWidth - margin, 30, { align: "right" });
      doc.setFontSize(10);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(100, 100, 110);
      doc.text(`Invoice #: ${invNum}`, pageWidth - margin, 40, { align: "right" });
      doc.text(`Date: ${new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}`, pageWidth - margin, 46, { align: "right" });
      if (dueDate) {
        doc.text(`Due Date: ${new Date(dueDate).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}`, pageWidth - margin, 52, { align: "right" });
      }

      doc.setFontSize(9);
      doc.setTextColor(100, 100, 110);
      doc.text("FROM", margin, y);
      y += 6;
      doc.setFontSize(11);
      doc.setTextColor(30, 30, 40);
      doc.setFont("helvetica", "bold");
      doc.text("BlackRidge Platforms", margin, y);
      y += 5;
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      doc.setTextColor(80, 80, 90);
      doc.text("chris@blackridgeplatforms.com", margin, y);
      y += 4;
      doc.text("Edmond, OK", margin, y);
      y += 10;

      doc.setFontSize(9);
      doc.setTextColor(100, 100, 110);
      doc.text("BILL TO", margin, y);
      y += 6;
      doc.setFontSize(11);
      doc.setTextColor(30, 30, 40);
      doc.setFont("helvetica", "bold");
      doc.text(company?.name || "Client", margin, y);
      y += 5;
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      doc.setTextColor(80, 80, 90);
      if (contact?.name) { doc.text(contact.name, margin, y); y += 4; }
      if (contact?.email) { doc.text(contact.email, margin, y); y += 4; }
      y += 6;

      doc.setFontSize(9);
      doc.setTextColor(100, 100, 110);
      doc.text("PROJECT", margin, y);
      y += 6;
      doc.setFontSize(10);
      doc.setTextColor(30, 30, 40);
      doc.text(project.name, margin, y);
      y += 12;

      const colX = [margin, margin + 80, pageWidth - margin - 60, pageWidth - margin - 20, pageWidth - margin];
      doc.setFillColor(240, 240, 245);
      doc.rect(margin, y - 4, pageWidth - margin * 2, 8, "F");
      doc.setFontSize(8);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(80, 80, 90);
      doc.text("DESCRIPTION", colX[0] + 3, y);
      doc.text("TYPE", colX[1], y);
      doc.text("AMOUNT", colX[2] + 20, y, { align: "right" });
      doc.text("STATUS", colX[4], y, { align: "right" });
      y += 8;

      const lineItems: Array<{ description: string; type: string; amount: number; status?: string }> = items && items.length > 0
        ? items
        : payments.map((p: any) => ({ description: p.label, type: p.type, amount: p.amount, status: p.status }));

      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      let totalAmount = 0;
      let paidAmount = 0;
      for (const item of lineItems) {
        const amt = Number(item.amount);
        const isPaid = item.status === "received";
        doc.setTextColor(30, 30, 40);
        doc.text(item.description, colX[0] + 3, y);
        doc.setTextColor(100, 100, 110);
        const typeLabel = item.type === "deposit" ? "Deposit" : item.type === "milestone" ? "Milestone" : item.type === "final" ? "Final" : "Other";
        doc.text(typeLabel, colX[1], y);
        doc.setTextColor(30, 30, 40);
        doc.text(`$${amt.toLocaleString("en-US", { minimumFractionDigits: 2 })}`, colX[2] + 20, y, { align: "right" });
        if (isPaid) {
          doc.setFont("helvetica", "bold");
          doc.setTextColor(34, 139, 34);
          doc.text("PAID", colX[4], y, { align: "right" });
        } else {
          doc.setFont("helvetica", "bold");
          doc.setTextColor(180, 80, 40);
          doc.text("DUE", colX[4], y, { align: "right" });
        }
        doc.setFont("helvetica", "normal");
        totalAmount += amt;
        if (isPaid) paidAmount += amt;
        y += 7;
      }

      const amountDue = totalAmount - paidAmount;

      y += 4;
      doc.setDrawColor(200, 200, 210);
      doc.line(margin, y, pageWidth - margin, y);
      y += 8;

      doc.setFontSize(9);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(80, 80, 90);
      doc.text("Total", colX[1], y);
      doc.text(`$${totalAmount.toLocaleString("en-US", { minimumFractionDigits: 2 })}`, colX[2] + 20, y, { align: "right" });
      y += 6;

      if (paidAmount > 0) {
        doc.setTextColor(34, 139, 34);
        doc.text("Paid", colX[1], y);
        doc.text(`-$${paidAmount.toLocaleString("en-US", { minimumFractionDigits: 2 })}`, colX[2] + 20, y, { align: "right" });
        y += 6;
      }

      doc.setDrawColor(200, 200, 210);
      doc.line(colX[1], y, colX[2] + 20, y);
      y += 6;

      doc.setFont("helvetica", "bold");
      doc.setFontSize(12);
      doc.setTextColor(30, 30, 40);
      doc.text("AMOUNT DUE", colX[1], y);
      doc.text(`$${amountDue.toLocaleString("en-US", { minimumFractionDigits: 2 })}`, colX[2] + 20, y, { align: "right" });
      y += 16;

      if (notes) {
        doc.setFontSize(9);
        doc.setTextColor(100, 100, 110);
        doc.text("NOTES", margin, y);
        y += 6;
        doc.setFont("helvetica", "normal");
        doc.setTextColor(60, 60, 70);
        const noteLines = doc.splitTextToSize(notes, pageWidth - margin * 2);
        doc.text(noteLines, margin, y);
        y += noteLines.length * 4 + 8;
      }

      let createdPaymentLink: any = null;
      let payUrl: string | null = null;
      if (project.clientId && amountDue > 0) {
        try {
          const client = await opsStorage.getClient(project.clientId);
          if (client) {
            const crypto = await import("crypto");
            const token = crypto.randomBytes(32).toString("hex");
            createdPaymentLink = await opsStorage.createPaymentLink({
              token,
              clientId: client.id,
              amount: String(amountDue),
              description: `${invNum} — ${project.name}`,
              clientName: client.name,
              clientEmail: client.email,
              status: "pending",
              projectId,
            });
            payUrl = `${req.protocol}://${req.get("host")}/pay/${token}`;
          }
        } catch (e) {
          console.error("Failed to create payment link for invoice:", e);
        }
      }

      if (amountDue <= 0) {
        doc.setFont("helvetica", "bold");
        doc.setFontSize(11);
        doc.setTextColor(34, 139, 34);
        doc.text("PAID IN FULL", margin, y);
        y += 10;
      } else if (payUrl) {
        doc.setFontSize(9);
        doc.setTextColor(100, 100, 110);
        doc.text("PAY ONLINE", margin, y);
        y += 6;
        doc.setFont("helvetica", "normal");
        doc.setTextColor(40, 80, 180);
        doc.text(payUrl, margin, y);
        y += 10;
      }

      doc.setDrawColor(200, 170, 60);
      doc.setLineWidth(0.5);
      doc.line(margin, doc.internal.pageSize.getHeight() - 20, pageWidth - margin, doc.internal.pageSize.getHeight() - 20);
      doc.setFontSize(8);
      doc.setTextColor(140, 140, 150);
      doc.text("BlackRidge Platforms  |  chris@blackridgeplatforms.com  |  Edmond, OK", pageWidth / 2, doc.internal.pageSize.getHeight() - 14, { align: "center" });

      const pdfBuffer = Buffer.from(doc.output("arraybuffer"));

      const objectService = new ObjectStorageService();
      const privateDir = objectService.getPrivateObjectDir();
      const fileId = randomUUID();
      const objectName = `${privateDir}/uploads/${fileId}`.replace(/^\//, "");
      const parts = objectName.split("/");
      const bucketName = parts[0];
      const filePath = parts.slice(1).join("/");

      const bucket = objectStorageClient.bucket(bucketName);
      const file = bucket.file(filePath);
      await file.save(pdfBuffer, { contentType: "application/pdf" });

      const storageKey = `/objects/uploads/${fileId}`;
      const filename = `${invNum}_${project.name.replace(/[^a-zA-Z0-9]/g, "_")}.pdf`;

      const document = await opsStorage.createProjectDocument({
        projectId,
        filename,
        storageKey,
        category: "invoice",
        fileSize: pdfBuffer.length,
        contentType: "application/pdf",
        uploadedBy: "admin",
        notes: `Auto-generated invoice ${invNum}`,
      });

      await opsStorage.createActivityLog({
        entityType: "document",
        entityId: document.id,
        projectId,
        action: "created",
        details: { filename, category: "invoice", invoiceNumber: invNum },
        createdBy: "admin",
      });

      res.status(201).json({
        document,
        invoiceNumber: invNum,
        paymentLink: createdPaymentLink ? { url: payUrl, token: createdPaymentLink.token, id: createdPaymentLink.id } : null,
      });
    } catch (error) {
      console.error("Generate invoice error:", error);
      res.status(500).json({ message: "Failed to generate invoice" });
    }
  });

  // === Client Revenue System Routes ===

  app.get("/api/ops/clients", isAuthenticated, async (_req, res) => {
    try {
      const allClients = await opsStorage.getClients();
      res.json(allClients);
    } catch (error) {
      console.error("Get clients error:", error);
      res.status(500).json({ message: "Failed to get clients" });
    }
  });

  app.get("/api/ops/clients/:id", isAuthenticated, async (req, res) => {
    try {
      const client = await opsStorage.getClient(param(req, "id"));
      if (!client) return res.status(404).json({ message: "Client not found" });
      res.json(client);
    } catch (error) {
      console.error("Get client error:", error);
      res.status(500).json({ message: "Failed to get client" });
    }
  });

  app.post("/api/ops/clients", isAuthenticated, async (req, res) => {
    try {
      const data = insertClientSchema.parse(req.body);
      const client = await opsStorage.createClient(data);

      await opsStorage.createActivityLog({
        entityType: "client",
        entityId: client.id,
        action: "created",
        details: { name: client.name },
        createdBy: "admin",
      });

      res.status(201).json(client);
    } catch (error) {
      if (error instanceof ZodError) {
        return res.status(400).json({ message: fromZodError(error).message });
      }
      console.error("Create client error:", error);
      res.status(500).json({ message: "Failed to create client" });
    }
  });

  app.patch("/api/ops/clients/:id", isAuthenticated, async (req, res) => {
    try {
      const client = await opsStorage.updateClient(param(req, "id"), req.body);
      if (!client) return res.status(404).json({ message: "Client not found" });
      res.json(client);
    } catch (error) {
      console.error("Update client error:", error);
      res.status(500).json({ message: "Failed to update client" });
    }
  });

  app.delete("/api/ops/clients/:id", isAuthenticated, async (req, res) => {
    try {
      const deleted = await opsStorage.deleteClient(param(req, "id"));
      if (!deleted) return res.status(404).json({ message: "Client not found" });
      res.json({ success: true });
    } catch (error) {
      console.error("Delete client error:", error);
      res.status(500).json({ message: "Failed to delete client" });
    }
  });

  app.get("/api/ops/clients/:id/projects", isAuthenticated, async (req, res) => {
    try {
      const clientProjects = await opsStorage.getClientProjects(param(req, "id"));
      res.json(clientProjects);
    } catch (error) {
      console.error("Get client projects error:", error);
      res.status(500).json({ message: "Failed to get client projects" });
    }
  });

  app.get("/api/ops/clients/:id/deals", isAuthenticated, async (req, res) => {
    try {
      const clientDeals = await opsStorage.getDeals(param(req, "id"));
      res.json(clientDeals);
    } catch (error) {
      console.error("Get client deals error:", error);
      res.status(500).json({ message: "Failed to get client deals" });
    }
  });

  app.get("/api/ops/clients/:id/subscriptions", isAuthenticated, async (req, res) => {
    try {
      const clientSubs = await opsStorage.getSubscriptions(param(req, "id"));
      res.json(clientSubs);
    } catch (error) {
      console.error("Get client subscriptions error:", error);
      res.status(500).json({ message: "Failed to get client subscriptions" });
    }
  });

  app.get("/api/ops/clients/:id/payments", isAuthenticated, async (req, res) => {
    try {
      const clientPayments = await opsStorage.getStripePayments(param(req, "id"));
      res.json(clientPayments);
    } catch (error) {
      console.error("Get client payments error:", error);
      res.status(500).json({ message: "Failed to get client payments" });
    }
  });

  // === Deals Routes ===

  app.get("/api/ops/deals", isAuthenticated, async (req, res) => {
    try {
      const clientId = req.query.clientId as string | undefined;
      const allDeals = await opsStorage.getDeals(clientId);
      res.json(allDeals);
    } catch (error) {
      console.error("Get deals error:", error);
      res.status(500).json({ message: "Failed to get deals" });
    }
  });

  app.post("/api/ops/deals", isAuthenticated, async (req, res) => {
    try {
      const data = insertDealSchema.parse(req.body);
      const deal = await opsStorage.createDeal(data);

      await opsStorage.createActivityLog({
        entityType: "deal",
        entityId: deal.id,
        action: "created",
        details: { name: deal.name, value: deal.value, stage: deal.stage },
        createdBy: "admin",
      });

      res.status(201).json(deal);
    } catch (error) {
      if (error instanceof ZodError) {
        return res.status(400).json({ message: fromZodError(error).message });
      }
      console.error("Create deal error:", error);
      res.status(500).json({ message: "Failed to create deal" });
    }
  });

  app.patch("/api/ops/deals/:id", isAuthenticated, async (req, res) => {
    try {
      const deal = await opsStorage.updateDeal(param(req, "id"), req.body);
      if (!deal) return res.status(404).json({ message: "Deal not found" });
      res.json(deal);
    } catch (error) {
      console.error("Update deal error:", error);
      res.status(500).json({ message: "Failed to update deal" });
    }
  });

  app.delete("/api/ops/deals/:id", isAuthenticated, async (req, res) => {
    try {
      const deleted = await opsStorage.deleteDeal(param(req, "id"));
      if (!deleted) return res.status(404).json({ message: "Deal not found" });
      res.json({ success: true });
    } catch (error) {
      console.error("Delete deal error:", error);
      res.status(500).json({ message: "Failed to delete deal" });
    }
  });

  // === Subscriptions Routes ===

  app.get("/api/ops/subscriptions", isAuthenticated, async (req, res) => {
    try {
      const clientId = req.query.clientId as string | undefined;
      const allSubs = await opsStorage.getSubscriptions(clientId);
      res.json(allSubs);
    } catch (error) {
      console.error("Get subscriptions error:", error);
      res.status(500).json({ message: "Failed to get subscriptions" });
    }
  });

  app.post("/api/ops/subscriptions", isAuthenticated, async (req, res) => {
    try {
      const data = insertSubscriptionSchema.parse(req.body);
      const sub = await opsStorage.createSubscription(data);

      await opsStorage.recalculateClientMrr(sub.clientId);

      await opsStorage.createActivityLog({
        entityType: "subscription",
        entityId: sub.id,
        action: "created",
        details: { name: sub.name, amount: sub.amount, interval: sub.interval },
        createdBy: "admin",
      });

      res.status(201).json(sub);
    } catch (error) {
      if (error instanceof ZodError) {
        return res.status(400).json({ message: fromZodError(error).message });
      }
      console.error("Create subscription error:", error);
      res.status(500).json({ message: "Failed to create subscription" });
    }
  });

  app.patch("/api/ops/subscriptions/:id", isAuthenticated, async (req, res) => {
    try {
      const sub = await opsStorage.updateSubscription(param(req, "id"), req.body);
      if (!sub) return res.status(404).json({ message: "Subscription not found" });

      await opsStorage.recalculateClientMrr(sub.clientId);

      res.json(sub);
    } catch (error) {
      console.error("Update subscription error:", error);
      res.status(500).json({ message: "Failed to update subscription" });
    }
  });

  app.delete("/api/ops/subscriptions/:id", isAuthenticated, async (req, res) => {
    try {
      const sub = await opsStorage.getSubscription(param(req, "id"));
      if (!sub) return res.status(404).json({ message: "Subscription not found" });

      const deleted = await opsStorage.deleteSubscription(param(req, "id"));
      if (!deleted) return res.status(404).json({ message: "Subscription not found" });

      await opsStorage.recalculateClientMrr(sub.clientId);

      res.json({ success: true });
    } catch (error) {
      console.error("Delete subscription error:", error);
      res.status(500).json({ message: "Failed to delete subscription" });
    }
  });

  // === Revenue Summary ===

  app.get("/api/ops/revenue/summary", isAuthenticated, async (_req, res) => {
    try {
      const allClients = await opsStorage.getClients();
      const allDeals = await opsStorage.getDeals();
      const allSubs = await opsStorage.getSubscriptions();
      const allPayments = await opsStorage.getStripePayments();

      const totalMrr = allClients.reduce((sum, c) => sum + parseFloat(c.mrr || "0"), 0);
      const totalArr = totalMrr * 12;
      const activeClients = allClients.filter(c => c.status === "active").length;
      const activeSubscriptions = allSubs.filter(s => s.status === "active").length;

      const wonDeals = allDeals.filter(d => d.stage === "closed_won");
      const pipelineValue = allDeals
        .filter(d => !["closed_won", "closed_lost"].includes(d.stage))
        .reduce((sum, d) => sum + parseFloat(d.value), 0);
      const wonValue = wonDeals.reduce((sum, d) => sum + parseFloat(d.value), 0);

      const totalCollected = allPayments
        .filter(p => p.status === "succeeded")
        .reduce((sum, p) => sum + parseFloat(p.amount), 0);

      res.json({
        totalMrr,
        totalArr,
        activeClients,
        totalClients: allClients.length,
        activeSubscriptions,
        pipelineValue,
        wonValue,
        totalCollected,
        wonDeals: wonDeals.length,
        openDeals: allDeals.filter(d => !["closed_won", "closed_lost"].includes(d.stage)).length,
      });
    } catch (error) {
      console.error("Revenue summary error:", error);
      res.status(500).json({ message: "Failed to get revenue summary" });
    }
  });

  // === Project to Client Conversion ===

  app.post("/api/ops/projects/:id/convert-to-client", isAuthenticated, async (req, res) => {
    try {
      const projectId = param(req, "id");
      const project = await opsStorage.getProject(projectId);
      if (!project) return res.status(404).json({ message: "Project not found" });

      if (project.clientId) {
        const existingClient = await opsStorage.getClient(project.clientId);
        if (existingClient) return res.status(400).json({ message: "Project is already linked to a client" });
      }

      let client = await opsStorage.findClientByName(project.name);

      if (!client) {
        client = await opsStorage.createClient({
          name: project.name,
          status: "active",
          companyId: project.companyId || undefined,
          contactId: project.contactId || undefined,
        });

        await opsStorage.createActivityLog({
          entityType: "client",
          entityId: client.id,
          action: "created_from_project",
          details: { projectId, projectName: project.name },
          createdBy: "admin",
        });
      }

      await opsStorage.updateProject(projectId, { clientId: client.id });

      await opsStorage.createActivityLog({
        entityType: "project",
        entityId: projectId,
        action: "linked_to_client",
        details: { clientId: client.id, clientName: client.name },
        createdBy: "admin",
      });

      res.status(201).json({ client });
    } catch (error) {
      console.error("Convert project to client error:", error);
      res.status(500).json({ message: "Failed to convert project to client" });
    }
  });

  // === Lead to Client Conversion ===

  app.post("/api/ops/leads/:id/convert-to-client", isAuthenticated, async (req, res) => {
    try {
      const leadId = param(req, "id");
      const lead = await storage.getContactSubmission(leadId);
      if (!lead) return res.status(404).json({ message: "Lead not found" });

      let client = await opsStorage.findClientByName(lead.company || lead.name);

      if (!client) {
        client = await opsStorage.createClient({
          name: lead.company || lead.name,
          email: lead.email,
          phone: (lead as any).phone || undefined,
          website: undefined,
          companyId: undefined,
          contactId: undefined,
          status: "active",
        });

        await opsStorage.createActivityLog({
          entityType: "client",
          entityId: client.id,
          action: "created_from_lead",
          details: { leadId, leadName: lead.name, leadCompany: lead.company },
          createdBy: "admin",
        });
      }

      const dealValue = lead.projectedValue ? String(lead.projectedValue) : "0";
      const deal = await opsStorage.createDeal({
        clientId: client.id,
        name: `${lead.company || lead.name} - ${(lead as any).service || lead.projectType || "General"}`,
        value: dealValue,
        stage: "closed_won",
        probability: 100,
        closeDate: new Date(),
        notes: `Converted from CRM lead: ${lead.name}`,
      });

      await storage.updateContactSubmission(leadId, { status: "won", followUpDate: null });

      await opsStorage.cancelPendingFollowupsForEntity("lead", leadId);

      await opsStorage.createActivityLog({
        entityType: "deal",
        entityId: deal.id,
        action: "created_from_lead",
        details: { leadId, clientId: client.id, value: dealValue },
        createdBy: "admin",
      });

      res.status(201).json({ client, deal });
    } catch (error) {
      console.error("Convert lead to client error:", error);
      res.status(500).json({ message: "Failed to convert lead to client" });
    }
  });

  // === QA Templates ===

  app.get("/api/ops/qa/templates", isAuthenticated, async (req, res) => {
    try {
      const projectType = req.query.projectType as string | undefined;
      const templates = await opsStorage.getQaTemplates(projectType);
      res.json(templates);
    } catch (error) {
      console.error("Get QA templates error:", error);
      res.status(500).json({ message: "Failed to get QA templates" });
    }
  });

  app.post("/api/ops/qa/templates", isAuthenticated, async (req, res) => {
    try {
      const template = await opsStorage.createQaTemplate(req.body);
      res.status(201).json(template);
    } catch (error) {
      console.error("Create QA template error:", error);
      res.status(500).json({ message: "Failed to create QA template" });
    }
  });

  app.patch("/api/ops/qa/templates/:id", isAuthenticated, async (req, res) => {
    try {
      const template = await opsStorage.updateQaTemplate(String(req.params.id), req.body);
      if (!template) return res.status(404).json({ message: "Template not found" });
      res.json(template);
    } catch (error) {
      console.error("Update QA template error:", error);
      res.status(500).json({ message: "Failed to update QA template" });
    }
  });

  app.delete("/api/ops/qa/templates/:id", isAuthenticated, async (req, res) => {
    try {
      const deleted = await opsStorage.deleteQaTemplate(String(req.params.id));
      if (!deleted) return res.status(404).json({ message: "Template not found" });
      res.json({ ok: true });
    } catch (error) {
      console.error("Delete QA template error:", error);
      res.status(500).json({ message: "Failed to delete QA template" });
    }
  });

  // === Project QA Checklists ===

  app.post("/api/ops/projects/:id/qa/initialize", isAuthenticated, async (req, res) => {
    try {
      const { projectType } = req.body;
      if (!projectType) return res.status(400).json({ message: "projectType is required" });
      const items = await opsStorage.initializeQaChecklist(String(req.params.id), projectType);
      const score = await opsStorage.getQaScore(String(req.params.id));
      await opsStorage.createActivityLog({
        entityType: "project",
        entityId: String(req.params.id),
        action: "qa_initialized",
        details: { projectType, itemCount: items.length },
        createdBy: "admin",
      });
      res.status(201).json({ items, score });
    } catch (error) {
      console.error("Initialize QA checklist error:", error);
      res.status(500).json({ message: "Failed to initialize QA checklist" });
    }
  });

  app.get("/api/ops/projects/:id/qa", isAuthenticated, async (req, res) => {
    try {
      const items = await opsStorage.getQaChecklist(String(req.params.id));
      const score = await opsStorage.getQaScore(String(req.params.id));
      res.json({ items, score });
    } catch (error) {
      console.error("Get QA checklist error:", error);
      res.status(500).json({ message: "Failed to get QA checklist" });
    }
  });

  app.patch("/api/ops/projects/:id/qa/:itemId", isAuthenticated, async (req, res) => {
    try {
      const itemId = String(req.params.itemId);
      const projectId = String(req.params.id);
      const existing = await opsStorage.getQaChecklistItem(itemId);
      if (!existing || existing.projectId !== projectId) return res.status(404).json({ message: "Checklist item not found" });

      const { status, notes, assignedTo } = req.body;
      const updates: any = {};
      if (status !== undefined) updates.status = status;
      if (notes !== undefined) updates.notes = notes;
      if (assignedTo !== undefined) updates.assignedTo = assignedTo;
      if (updates.status === "pass" && existing.status !== "pass") {
        updates.completedAt = new Date();
        updates.completedBy = "admin";
      } else if (updates.status && updates.status !== "pass") {
        updates.completedAt = null;
        updates.completedBy = null;
      }

      if (updates.status && updates.status !== existing.status) {
        await opsStorage.createQaAuditEntry({
          checklistItemId: itemId,
          projectId: String(req.params.id),
          action: "status_change",
          previousValue: existing.status,
          newValue: updates.status,
          changedBy: "admin",
        });
      }
      if (updates.notes !== undefined && updates.notes !== existing.notes) {
        await opsStorage.createQaAuditEntry({
          checklistItemId: itemId,
          projectId: String(req.params.id),
          action: "note_update",
          previousValue: existing.notes || "",
          newValue: updates.notes || "",
          changedBy: "admin",
        });
      }
      if (updates.assignedTo !== undefined && updates.assignedTo !== existing.assignedTo) {
        await opsStorage.createQaAuditEntry({
          checklistItemId: itemId,
          projectId: String(req.params.id),
          action: "assignment_change",
          previousValue: existing.assignedTo || "",
          newValue: updates.assignedTo || "",
          changedBy: "admin",
        });
      }

      const updated = await opsStorage.updateQaChecklistItem(itemId, updates);
      const score = await opsStorage.getQaScore(String(req.params.id));
      res.json({ item: updated, score });
    } catch (error) {
      console.error("Update QA item error:", error);
      res.status(500).json({ message: "Failed to update QA item" });
    }
  });

  app.delete("/api/ops/projects/:id/qa/:itemId", isAuthenticated, async (req, res) => {
    try {
      const itemId = String(req.params.itemId);
      const projectId = String(req.params.id);
      const existing = await opsStorage.getQaChecklistItem(itemId);
      if (!existing || existing.projectId !== projectId) return res.status(404).json({ message: "Checklist item not found" });
      if (existing) {
        await opsStorage.createQaAuditEntry({
          checklistItemId: itemId,
          projectId: String(req.params.id),
          action: "item_removed",
          previousValue: existing.itemDescription,
          newValue: null,
          changedBy: "admin",
        });
      }
      const deleted = await opsStorage.deleteQaChecklistItem(itemId);
      if (!deleted) return res.status(404).json({ message: "Checklist item not found" });
      const score = await opsStorage.getQaScore(String(req.params.id));
      res.json({ ok: true, score });
    } catch (error) {
      console.error("Delete QA item error:", error);
      res.status(500).json({ message: "Failed to delete QA item" });
    }
  });

  app.post("/api/ops/projects/:id/qa/items", isAuthenticated, async (req, res) => {
    try {
      const projectId = String(req.params.id);
      const item = await opsStorage.addQaChecklistItem({
        ...req.body,
        projectId,
      });
      await opsStorage.createQaAuditEntry({
        checklistItemId: item.id,
        projectId,
        action: "item_added",
        previousValue: null,
        newValue: item.itemDescription,
        changedBy: "admin",
      });
      const score = await opsStorage.getQaScore(projectId);
      res.status(201).json({ item, score });
    } catch (error) {
      console.error("Add QA item error:", error);
      res.status(500).json({ message: "Failed to add QA item" });
    }
  });

  app.get("/api/ops/projects/:id/qa/audit", isAuthenticated, async (req, res) => {
    try {
      const log = await opsStorage.getQaAuditLog(String(req.params.id));
      res.json(log);
    } catch (error) {
      console.error("Get QA audit log error:", error);
      res.status(500).json({ message: "Failed to get QA audit log" });
    }
  });

  app.get("/api/ops/projects/:id/qa/score", isAuthenticated, async (req, res) => {
    try {
      const score = await opsStorage.getQaScore(String(req.params.id));
      res.json(score);
    } catch (error) {
      console.error("Get QA score error:", error);
      res.status(500).json({ message: "Failed to get QA score" });
    }
  });
}
