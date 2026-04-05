import { Router } from "express";
import { desc, eq } from "drizzle-orm";
import { getWeeklyOpsData } from "../weekly-ops-data";
import { opsStorage } from "../ops-storage";
import { db } from "../db";
import { aiReports } from "@shared/schema";
import type { RequestHandler } from "express";
import Anthropic from "@anthropic-ai/sdk";

export function createAiRouter(isAuthenticated: RequestHandler) {
  const aiRouter = Router();

  aiRouter.get("/reports", isAuthenticated, async (req, res) => {
    try {
      const type = req.query.type as string | undefined;
      const reports = await opsStorage.getAiReports(type);
      res.json(reports);
    } catch (error) {
      console.error("Get AI reports error:", error);
      res.status(500).json({ message: "Failed to fetch AI reports" });
    }
  });

  aiRouter.get("/reports/:id", isAuthenticated, async (req, res) => {
    try {
      const report = await opsStorage.getAiReport(String(req.params.id));
      if (!report) return res.status(404).json({ message: "Report not found" });
      res.json(report);
    } catch (error) {
      console.error("Get AI report error:", error);
      res.status(500).json({ message: "Failed to fetch AI report" });
    }
  });

  aiRouter.post("/reports", isAuthenticated, async (req, res) => {
    try {
      const report = await opsStorage.createAiReport(req.body);
      res.status(201).json(report);
    } catch (error) {
      console.error("Create AI report error:", error);
      res.status(500).json({ message: "Failed to create AI report" });
    }
  });

  async function handleGenerateWeekly(_req: any, res: any) {
    try {
      const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

      const opsData = await getWeeklyOpsData();

      const weeklySystemPrompt = `You are a senior business operations analyst for BlackRidge Platforms, a web development agency. You must return valid JSON only. No commentary outside the JSON.`;

      const userPrompt = `
You are analyzing internal ops metrics for BlackRidge Platforms. Use the provided data only.
Do NOT invent numbers. Base all analysis on the real data provided.

Return JSON matching this exact structure:
{
  "summary": {
    "health_score": number (0-100, where 100 is perfect health),
    "overview": string (2-4 sentence executive summary of the week)
  },
  "risk_items": [
    {
      "entity_type": "lead" | "project" | "payment" | "task",
      "entity_id": string,
      "title": string,
      "reason": string,
      "urgency": "low" | "medium" | "high",
      "recommended_action": string
    }
  ],
  "recommended_actions": [
    {
      "title": string,
      "detail": string,
      "impact": "low" | "medium" | "high"
    }
  ],
  "highlights": [
    string (positive things worth noting, 1-3 items)
  ]
}

Health score guidelines:
- Overdue payments reduce score significantly
- Stale leads and stalled projects reduce score moderately
- High task completion and billable ratio increase score
- Active pipeline with good weighted forecast increases score

DATA:
${JSON.stringify(opsData, null, 2)}
`.trim();

      const response = await anthropic.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 4000,
        system: weeklySystemPrompt,
        messages: [{ role: "user", content: userPrompt }],
      });

      const raw = response.content[0].type === "text" ? response.content[0].text : "{}";
      let aiAnalysis: Record<string, unknown>;
      try {
        aiAnalysis = JSON.parse(raw);
      } catch {
        aiAnalysis = { summary: { health_score: 0, overview: "Failed to parse AI response" }, risk_items: [], recommended_actions: [], highlights: [] };
      }

      const fullPayload = {
        ...opsData,
        ai: aiAnalysis,
      };

      const report = await opsStorage.createAiReport({
        type: "weekly_ops",
        payload: fullPayload,
        createdBy: "system",
      });
      res.status(201).json({ ok: true, report });
    } catch (error: any) {
      console.error("Generate weekly report error:", error);
      res.status(500).json({ ok: false, error: error?.message ?? "Failed to generate weekly report" });
    }
  }

  aiRouter.post("/weekly-ops-report", isAuthenticated, handleGenerateWeekly);
  aiRouter.post("/reports/generate-weekly", isAuthenticated, handleGenerateWeekly);

  aiRouter.get("/latest", isAuthenticated, async (req, res) => {
    try {
      const type = (req.query.type as string) || "weekly_ops";
      const rows = await db
        .select()
        .from(aiReports)
        .where(eq(aiReports.type, type))
        .orderBy(desc(aiReports.generatedAt))
        .limit(1);
      return res.json({ ok: true, report: rows[0] ?? null });
    } catch (err: any) {
      console.error("ai latest error:", err);
      return res.status(500).json({ ok: false, error: err?.message ?? "Unknown error" });
    }
  });

  aiRouter.delete("/reports/:id", isAuthenticated, async (req, res) => {
    try {
      const deleted = await opsStorage.deleteAiReport(String(req.params.id));
      if (!deleted) return res.status(404).json({ message: "Report not found" });
      res.json({ success: true });
    } catch (error) {
      console.error("Delete AI report error:", error);
      res.status(500).json({ message: "Failed to delete AI report" });
    }
  });

  return aiRouter;
}
