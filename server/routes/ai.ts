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

      // Concatenate all text blocks (Claude can return multiple) and strip
      // any code fences the model added even when asked for raw JSON.
      const rawText = response.content
        .map(b => (b.type === "text" ? b.text : ""))
        .join("")
        .trim();
      const raw = rawText.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();

      let aiAnalysis: Record<string, unknown> | null = null;
      let parseError: string | null = null;
      try {
        const parsed = JSON.parse(raw);
        // Minimal schema validation — accept partial reports but require a
        // summary block so the front-end always has something to render.
        if (parsed && typeof parsed === "object" && parsed.summary && typeof parsed.summary === "object") {
          aiAnalysis = parsed;
        } else {
          parseError = "AI response is missing a summary block";
        }
      } catch (e: any) {
        parseError = e?.message ?? "AI response was not valid JSON";
      }

      // On parse failure, carry forward the previous report's score and
      // overview so the dashboard does not silently report 0/100. The new
      // report is still saved (with the raw payload) so we can debug drift.
      if (!aiAnalysis) {
        console.error("AI report parse failed:", parseError);
        console.error("Raw AI payload (first 2000 chars):", rawText.slice(0, 2000));
        const previous = await opsStorage.getAiReports("weekly_ops").then(r => r[0]).catch(() => undefined);
        const prevAi = (previous?.payload as any)?.ai;
        aiAnalysis = {
          summary: {
            health_score: prevAi?.summary?.health_score ?? null,
            overview: `AI response could not be parsed (${parseError}). Last known score retained from ${previous?.generatedAt ?? "previous report"}.`,
          },
          risk_items: prevAi?.risk_items ?? [],
          recommended_actions: prevAi?.recommended_actions ?? [],
          highlights: prevAi?.highlights ?? [],
          parse_error: parseError,
          raw_excerpt: rawText.slice(0, 500),
        };
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
