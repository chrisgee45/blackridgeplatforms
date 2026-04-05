import type { Express, Request, Response, RequestHandler } from "express";
import { db } from "./db";
import { qaAudits, qaAuditFindings } from "@shared/schema";
import { eq, desc, sql } from "drizzle-orm";
import { SecurityAgent, InfrastructureAgent, APIAgent, DataFlowAgent, type Finding } from "./qa-agents";
import { EventEmitter } from "events";
import { URL } from "url";
import * as net from "net";

const auditEmitters = new Map<number, EventEmitter>();

const BLOCKED_HOSTS = ["localhost", "127.0.0.1", "0.0.0.0", "[::1]", "metadata.google.internal", "169.254.169.254"];

function isPrivateIp(hostname: string): boolean {
  if (BLOCKED_HOSTS.includes(hostname.toLowerCase())) return true;
  if (net.isIPv4(hostname)) {
    const parts = hostname.split(".").map(Number);
    if (parts[0] === 10) return true;
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
    if (parts[0] === 192 && parts[1] === 168) return true;
    if (parts[0] === 169 && parts[1] === 254) return true;
  }
  return false;
}

function validateTargetUrl(urlStr: string): { valid: boolean; error?: string } {
  let parsed: URL;
  try { parsed = new URL(urlStr); } catch { return { valid: false, error: "Invalid URL format" }; }
  if (!["http:", "https:"].includes(parsed.protocol)) return { valid: false, error: "Only http/https URLs are allowed" };
  if (isPrivateIp(parsed.hostname)) return { valid: false, error: "Private/internal URLs are not allowed" };
  return { valid: true };
}

function calculateScore(findings: Finding[]): number {
  let score = 100;
  for (const f of findings) {
    if (f.status === "PASSED" || f.status === "SKIPPED") continue;
    if (f.severity === "CRITICAL") score -= 25;
    else if (f.severity === "HIGH") score -= 10;
    else if (f.severity === "MEDIUM") score -= 5;
    else if (f.severity === "LOW") score -= 2;
  }
  return Math.max(0, Math.round(score * 10) / 10);
}

function scoreToGrade(score: number): string {
  if (score >= 95) return "A+";
  if (score >= 90) return "A";
  if (score >= 85) return "B+";
  if (score >= 80) return "B";
  if (score >= 70) return "C";
  if (score >= 60) return "D";
  return "F";
}

async function generateAiAnalysis(findings: Finding[], score: number, grade: string): Promise<string> {
  const failed = findings.filter(f => f.status === "FAILED" || f.status === "WARNING");
  if (failed.length === 0) {
    return "All tests passed successfully. The target application demonstrates strong security practices, robust infrastructure, well-designed APIs, and reliable data handling. No immediate action is required.";
  }

  const criticalHigh = failed.filter(f => f.severity === "CRITICAL" || f.severity === "HIGH");
  const topIssues = (criticalHigh.length > 0 ? criticalHigh : failed).slice(0, 5);
  let summaryInput = `Score: ${score}/100 (Grade: ${grade})\nTotal findings: ${failed.length} issues found\n\n`;
  for (const f of topIssues) {
    summaryInput += `[${f.severity}] ${f.title}: ${f.description}\n`;
  }

  try {
    const Anthropic = (await import("@anthropic-ai/sdk")).default;
    const client = new Anthropic();
    const response = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 500,
      messages: [{ role: "user", content: `You are a senior QA engineer at BlackRidge Platforms. Write a concise 3-paragraph executive summary for a website/API quality audit. Paragraph 1: Overall risk level. Paragraph 2: Top 3 most critical issues and their business impact. Paragraph 3: Recommended immediate actions.\n\n${summaryInput}` }],
    });
    const textBlock = response.content.find((b: any) => b.type === "text");
    if (textBlock && "text" in textBlock) return textBlock.text;
  } catch (e) {
    console.log("AI analysis fallback to rule-based:", e);
  }

  return ruleBasedSummary(findings, score, grade);
}

function ruleBasedSummary(findings: Finding[], score: number, grade: string): string {
  const failed = findings.filter(f => f.status === "FAILED" || f.status === "WARNING");
  const critical = failed.filter(f => f.severity === "CRITICAL");
  const high = failed.filter(f => f.severity === "HIGH");
  const risk = score >= 80 ? "LOW" : score >= 60 ? "MODERATE" : score >= 40 ? "HIGH" : "CRITICAL";
  let summary = `Overall Risk Level: ${risk}. The target scored ${score}/100 (Grade: ${grade}) with ${failed.length} issues identified across security, infrastructure, API quality, and data flow testing.\n\n`;
  if (critical.length > 0 || high.length > 0) {
    const top = [...critical, ...high].slice(0, 3);
    summary += "Top Issues:\n";
    for (const f of top) summary += `• [${f.severity}] ${f.title}: ${f.description}\n`;
    summary += "\n";
  }
  summary += "Recommended Actions: ";
  if (critical.length > 0) summary += "Address all CRITICAL findings immediately as they pose significant security or reliability risks. ";
  if (high.length > 0) summary += "Resolve HIGH severity issues within the current sprint. ";
  summary += "Review MEDIUM and LOW findings during regular maintenance cycles.";
  return summary;
}

function generateMarkdownReport(findings: Finding[], score: number, grade: string, aiAnalysis: string, targetUrl: string): string {
  let report = `# BlackRidge QA Audit Report\n\n`;
  report += `**Target:** ${targetUrl}\n`;
  report += `**Date:** ${new Date().toISOString().replace("T", " ").split(".")[0]} UTC\n`;
  report += `**Score:** ${score}/100 (Grade: ${grade})\n\n`;
  const total = findings.length;
  const passed = findings.filter(f => f.status === "PASSED").length;
  const failedCount = findings.filter(f => f.status === "FAILED").length;
  report += `## Summary\n\n| Metric | Value |\n|---|---|\n| Total Tests | ${total} |\n| Passed | ${passed} |\n| Failed | ${failedCount} |\n\n`;
  report += `## AI Executive Summary\n\n${aiAnalysis}\n\n`;
  report += `## Findings\n\n`;
  for (const severity of ["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"]) {
    const sevFindings = findings.filter(f => f.severity === severity && f.status !== "PASSED");
    if (sevFindings.length > 0) {
      report += `### ${severity} (${sevFindings.length})\n\n`;
      for (const f of sevFindings) {
        report += `#### ${f.title}\n\n- **Agent:** ${f.agent}\n- **Status:** ${f.status}\n- **Description:** ${f.description}\n`;
        if (f.evidence) report += `- **Evidence:** \`${f.evidence.substring(0, 200)}\`\n`;
        if (f.remediation) report += `- **Remediation:** ${f.remediation}\n`;
        report += "\n";
      }
    }
  }
  return report;
}

async function runAudit(auditId: number, targetUrl: string, authToken: string | null, knownEndpoints: string[]) {
  const emitter = new EventEmitter();
  auditEmitters.set(auditId, emitter);

  const agents: Array<{ name: string; agent: { run: () => Promise<Finding[]> } }> = [
    { name: "Security", agent: new SecurityAgent(targetUrl, authToken, knownEndpoints) },
    { name: "Infrastructure", agent: new InfrastructureAgent(targetUrl, authToken, knownEndpoints) },
    { name: "API", agent: new APIAgent(targetUrl, authToken, knownEndpoints) },
    { name: "Data Flow", agent: new DataFlowAgent(targetUrl, authToken, knownEndpoints) },
  ];

  const allFindings: Finding[] = [];

  try {
    for (const { name, agent } of agents) {
      emitter.emit("event", { type: "progress", agent: name, message: `Running ${name} tests...` });
      await db.update(qaAudits).set({ status: "running", currentAgent: name }).where(eq(qaAudits.id, auditId));

      const findings = await agent.run();
      allFindings.push(...findings);

      const passed = findings.filter(f => f.status === "PASSED").length;
      const failed = findings.filter(f => f.status === "FAILED").length;
      emitter.emit("event", { type: "agent_complete", agent: name, passed, failed, total: findings.length });
    }

    const score = calculateScore(allFindings);
    const grade = scoreToGrade(score);
    const total = allFindings.length;
    const passed = allFindings.filter(f => f.status === "PASSED").length;
    const failed = allFindings.filter(f => f.status === "FAILED").length;
    const critical = allFindings.filter(f => f.severity === "CRITICAL" && f.status !== "PASSED").length;
    const high = allFindings.filter(f => f.severity === "HIGH" && f.status !== "PASSED").length;
    const medium = allFindings.filter(f => f.severity === "MEDIUM" && f.status !== "PASSED").length;
    const low = allFindings.filter(f => f.severity === "LOW" && f.status !== "PASSED").length;

    emitter.emit("event", { type: "progress", agent: "AI Analysis", message: "Generating executive summary..." });
    const aiAnalysis = await generateAiAnalysis(allFindings, score, grade);
    const reportMarkdown = generateMarkdownReport(allFindings, score, grade, aiAnalysis, targetUrl);
    const reportJson = JSON.stringify({ findings: allFindings, score, grade, total, passed, failed });

    for (const f of allFindings) {
      await db.insert(qaAuditFindings).values({
        auditId,
        agent: f.agent,
        testName: f.test_name,
        status: f.status,
        severity: f.severity,
        title: f.title,
        description: f.description,
        evidence: f.evidence || null,
        remediation: f.remediation || null,
        endpoint: f.endpoint || null,
        responseCode: f.response_code || null,
        responseTimeMs: f.response_time_ms || null,
      });
    }

    await db.update(qaAudits).set({
      status: "completed",
      score,
      grade,
      totalTests: total,
      passed,
      failed,
      criticalCount: critical,
      highCount: high,
      mediumCount: medium,
      lowCount: low,
      aiAnalysis,
      reportJson,
      reportMarkdown,
      completedAt: new Date(),
      currentAgent: null,
    }).where(eq(qaAudits.id, auditId));

    emitter.emit("event", { type: "complete", score, grade, audit_id: auditId });
  } catch (e: any) {
    await db.update(qaAudits).set({ status: "failed", errorMessage: e.message, currentAgent: null }).where(eq(qaAudits.id, auditId));
    emitter.emit("event", { type: "error", message: e.message });
  }

  setTimeout(() => { auditEmitters.delete(auditId); }, 30000);
}

export function registerQaAuditRoutes(app: Express, isAuthenticated?: RequestHandler) {
  const auth: RequestHandler[] = isAuthenticated ? [isAuthenticated] : [];

  app.post("/api/ops/qa-audit/run", ...auth, async (req: Request, res: Response) => {
    const { project_name, target_url, auth_token, known_endpoints } = req.body;
    if (!project_name || !target_url) {
      return res.status(400).json({ error: "project_name and target_url are required" });
    }

    const urlCheck = validateTargetUrl(target_url);
    if (!urlCheck.valid) {
      return res.status(400).json({ error: urlCheck.error });
    }

    const [audit] = await db.insert(qaAudits).values({
      projectName: project_name,
      targetUrl: target_url,
      authToken: null,
      status: "pending",
    }).returning();

    runAudit(audit.id, target_url, auth_token || null, known_endpoints || []);

    res.json({ audit_id: audit.id });
  });

  app.get("/api/ops/qa-audit/:id/stream", ...auth, async (req: Request, res: Response) => {
    const auditId = parseInt(req.params.id);
    if (isNaN(auditId)) return res.status(400).json({ error: "Invalid audit ID" });

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });

    const emitter = auditEmitters.get(auditId);
    if (!emitter) {
      const [audit] = await db.select().from(qaAudits).where(eq(qaAudits.id, auditId)).limit(1);
      if (audit && audit.status === "completed") {
        res.write(`data: ${JSON.stringify({ type: "complete", score: audit.score, grade: audit.grade, audit_id: auditId })}\n\n`);
      } else if (audit && audit.status === "failed") {
        res.write(`data: ${JSON.stringify({ type: "error", message: audit.errorMessage || "Audit failed" })}\n\n`);
      }
      res.end();
      return;
    }

    const onEvent = (data: any) => {
      try {
        res.write(`data: ${JSON.stringify(data)}\n\n`);
        if (data.type === "complete" || data.type === "error") {
          emitter.removeListener("event", onEvent);
          res.end();
        }
      } catch {}
    };

    emitter.on("event", onEvent);

    req.on("close", () => {
      emitter.removeListener("event", onEvent);
    });
  });

  app.get("/api/ops/qa-audit/list", ...auth, async (_req: Request, res: Response) => {
    const audits = await db.select({
      id: qaAudits.id,
      projectName: qaAudits.projectName,
      targetUrl: qaAudits.targetUrl,
      status: qaAudits.status,
      score: qaAudits.score,
      grade: qaAudits.grade,
      totalTests: qaAudits.totalTests,
      passed: qaAudits.passed,
      failed: qaAudits.failed,
      createdAt: qaAudits.createdAt,
      completedAt: qaAudits.completedAt,
    }).from(qaAudits).orderBy(desc(qaAudits.createdAt)).limit(50);

    res.json({ audits, total: audits.length });
  });

  app.get("/api/ops/qa-audit/:id", ...auth, async (req: Request, res: Response) => {
    const auditId = parseInt(req.params.id);
    if (isNaN(auditId)) return res.status(400).json({ error: "Invalid audit ID" });

    const [audit] = await db.select().from(qaAudits).where(eq(qaAudits.id, auditId)).limit(1);
    if (!audit) return res.status(404).json({ error: "Audit not found" });

    const findings = await db.select().from(qaAuditFindings).where(eq(qaAuditFindings.auditId, auditId));

    const { authToken: _omit, reportJson: _rj, ...safeAudit } = audit;
    res.json({
      ...safeAudit,
      project_name: audit.projectName,
      target_url: audit.targetUrl,
      total_tests: audit.totalTests,
      critical_count: audit.criticalCount,
      high_count: audit.highCount,
      medium_count: audit.mediumCount,
      low_count: audit.lowCount,
      ai_analysis: audit.aiAnalysis,
      created_at: audit.createdAt,
      completed_at: audit.completedAt,
      findings,
    });
  });

  app.get("/api/ops/qa-audit/:id/download/json", ...auth, async (req: Request, res: Response) => {
    const auditId = parseInt(req.params.id);
    const [audit] = await db.select().from(qaAudits).where(eq(qaAudits.id, auditId)).limit(1);
    if (!audit || !audit.reportJson) return res.status(404).json({ error: "Report not found" });
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Content-Disposition", `attachment; filename="qa-report-${auditId}.json"`);
    res.send(audit.reportJson);
  });

  app.get("/api/ops/qa-audit/:id/download/markdown", ...auth, async (req: Request, res: Response) => {
    const auditId = parseInt(req.params.id);
    const [audit] = await db.select().from(qaAudits).where(eq(qaAudits.id, auditId)).limit(1);
    if (!audit || !audit.reportMarkdown) return res.status(404).json({ error: "Report not found" });
    res.setHeader("Content-Type", "text/markdown");
    res.setHeader("Content-Disposition", `attachment; filename="qa-report-${auditId}.md"`);
    res.send(audit.reportMarkdown);
  });
}
