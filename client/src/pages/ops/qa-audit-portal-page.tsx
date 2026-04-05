import { useState, useEffect, useRef, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import {
  Shield,
  Play,
  Loader2,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Circle,
  Download,
  ChevronDown,
  ChevronRight,
  Copy,
  Target,
  FileText,
  RefreshCw,
  Sparkles,
} from "lucide-react";

const QA_BASE = "/api/ops/qa-audit";

interface Finding {
  id: number;
  agent: string;
  test_name: string;
  testName?: string;
  status: string;
  severity: string;
  title: string;
  description: string;
  evidence: string | null;
  remediation: string | null;
  endpoint: string | null;
  response_code: number | null;
  responseCode?: number | null;
  response_time_ms: number | null;
  responseTimeMs?: number | null;
}

interface AuditRecord {
  id: number;
  project_name: string;
  projectName?: string;
  target_url: string;
  targetUrl?: string;
  status: string;
  score: number | null;
  grade: string | null;
  total_tests: number | null;
  totalTests?: number | null;
  passed: number | null;
  failed: number | null;
  critical_count: number | null;
  high_count: number | null;
  medium_count: number | null;
  low_count: number | null;
  ai_analysis: string | null;
  aiAnalysis?: string | null;
  created_at: string;
  createdAt?: string;
  completed_at: string | null;
  completedAt?: string | null;
  findings: Finding[];
}

function normalize(a: any): AuditRecord {
  return {
    ...a,
    project_name: a.project_name || a.projectName,
    target_url: a.target_url || a.targetUrl,
    total_tests: a.total_tests ?? a.totalTests,
    critical_count: a.critical_count ?? a.criticalCount,
    high_count: a.high_count ?? a.highCount,
    medium_count: a.medium_count ?? a.mediumCount,
    low_count: a.low_count ?? a.lowCount,
    ai_analysis: a.ai_analysis ?? a.aiAnalysis,
    created_at: a.created_at || a.createdAt,
    completed_at: a.completed_at || a.completedAt,
    findings: (a.findings || []).map((f: any) => ({
      ...f,
      test_name: f.test_name || f.testName,
      response_code: f.response_code ?? f.responseCode,
      response_time_ms: f.response_time_ms ?? f.responseTimeMs,
    })),
  };
}

interface AgentStatus {
  status: "pending" | "running" | "done" | "error";
  message?: string;
  passed?: number;
  failed?: number;
}

const SEVERITY_ORDER = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"];
const SEVERITY_COLORS: Record<string, string> = {
  CRITICAL: "bg-red-600 text-white",
  HIGH: "bg-orange-500 text-white",
  MEDIUM: "bg-yellow-500 text-black",
  LOW: "bg-blue-500 text-white",
  INFO: "bg-slate-500 text-white",
};

const GRADE_COLORS: Record<string, string> = {
  "A+": "text-green-500",
  "A": "text-green-500",
  "B+": "text-emerald-500",
  "B": "text-emerald-500",
  "C": "text-yellow-500",
  "D": "text-orange-500",
  "F": "text-red-500",
};

function timeAgo(dateStr: string): string {
  const now = new Date();
  const date = new Date(dateStr);
  const diff = Math.floor((now.getTime() - date.getTime()) / 1000);
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function FindingCard({ finding }: { finding: Finding }) {
  const defaultOpen = finding.status === "FAILED" || finding.status === "WARNING";
  const [open, setOpen] = useState(defaultOpen);
  const { toast } = useToast();

  return (
    <div
      className={`border rounded-lg overflow-hidden transition-colors ${
        finding.status === "PASSED" ? "border-green-200/30 bg-green-50/5" :
        finding.status === "FAILED" ? "border-red-200/30 bg-red-50/5" :
        "border-yellow-200/30 bg-yellow-50/5"
      }`}
      data-testid={`finding-${finding.id}`}
    >
      <button
        className="w-full flex items-center gap-3 p-3 text-left hover:bg-muted/20 transition-colors"
        onClick={() => setOpen(!open)}
        data-testid={`button-toggle-finding-${finding.id}`}
      >
        {finding.status === "PASSED" ? (
          <CheckCircle2 className="w-4 h-4 text-green-500 shrink-0" />
        ) : finding.status === "FAILED" ? (
          <XCircle className="w-4 h-4 text-red-500 shrink-0" />
        ) : (
          <AlertTriangle className="w-4 h-4 text-yellow-500 shrink-0" />
        )}
        <span className="text-sm font-medium flex-1">{finding.title}</span>
        <Badge variant="outline" className="text-[10px] shrink-0">{finding.agent}</Badge>
        <Badge className={`text-[10px] shrink-0 ${SEVERITY_COLORS[finding.severity] || ""}`}>{finding.severity}</Badge>
        {open ? <ChevronDown className="w-4 h-4 shrink-0 text-muted-foreground" /> : <ChevronRight className="w-4 h-4 shrink-0 text-muted-foreground" />}
      </button>
      {open && (
        <div className="px-4 pb-4 space-y-3 border-t border-border/30">
          <p className="text-sm text-muted-foreground mt-3">{finding.description}</p>
          {finding.endpoint && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span>Endpoint:</span>
              <code className="bg-muted/30 px-2 py-0.5 rounded text-xs">{finding.endpoint}</code>
              <Button
                variant="ghost"
                size="sm"
                className="h-5 px-1.5 text-[10px]"
                onClick={(e) => {
                  e.stopPropagation();
                  navigator.clipboard.writeText(finding.endpoint!);
                  toast({ title: "Copied URL" });
                }}
                data-testid={`button-copy-url-${finding.id}`}
              >
                <Copy className="w-3 h-3 mr-1" />Copy URL
              </Button>
            </div>
          )}
          {finding.evidence && (
            <div>
              <span className="text-xs font-medium text-muted-foreground">Evidence:</span>
              <pre className="mt-1 text-xs bg-muted/20 p-2 rounded overflow-x-auto whitespace-pre-wrap">{finding.evidence}</pre>
            </div>
          )}
          {finding.remediation && (
            <div className="bg-amber-500/10 border border-amber-500/20 rounded p-2.5">
              <span className="text-xs font-medium text-amber-600">Remediation:</span>
              <p className="text-xs text-amber-700 mt-0.5">{finding.remediation}</p>
            </div>
          )}
          {finding.response_code && (
            <span className="text-xs text-muted-foreground">Response: {finding.response_code} ({finding.response_time_ms?.toFixed(0)}ms)</span>
          )}
        </div>
      )}
    </div>
  );
}

export default function QaAuditPortalPage() {
  const { toast } = useToast();

  const [projectName, setProjectName] = useState("");
  const [targetUrl, setTargetUrl] = useState("");
  const [authToken, setAuthToken] = useState("");
  const [endpoints, setEndpoints] = useState("");

  const [running, setRunning] = useState(false);
  const [agentStatuses, setAgentStatuses] = useState<Record<string, AgentStatus>>({});
  const [selectedAudit, setSelectedAudit] = useState<AuditRecord | null>(null);
  const [audits, setAudits] = useState<AuditRecord[]>([]);
  const [view, setView] = useState<"empty" | "running" | "complete">("empty");
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadAudits = useCallback(async () => {
    try {
      const r = await fetch(`${QA_BASE}/list`, { credentials: "include" });
      if (r.ok) {
        const d = await r.json();
        setAudits((d.audits || []).map(normalize));
      }
    } catch {}
  }, []);

  useEffect(() => { loadAudits(); }, [loadAudits]);

  const loadReport = async (auditId: number) => {
    try {
      const r = await fetch(`${QA_BASE}/${auditId}`, { credentials: "include" });
      if (r.ok) {
        const d = await r.json();
        setSelectedAudit(normalize(d));
        setView("complete");
      }
    } catch {}
  };

  const startAudit = async () => {
    if (!projectName || !targetUrl) return;
    setRunning(true);
    setView("running");
    setAgentStatuses({
      Security: { status: "pending" },
      Infrastructure: { status: "pending" },
      API: { status: "pending" },
      "Data Flow": { status: "pending" },
    });
    setSelectedAudit(null);

    try {
      const r = await fetch(`${QA_BASE}/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          project_name: projectName,
          target_url: targetUrl,
          auth_token: authToken || null,
          known_endpoints: endpoints ? endpoints.split("\n").map(e => e.trim()).filter(Boolean) : [],
        }),
      });

      if (!r.ok) {
        setRunning(false);
        setView("empty");
        toast({ title: "Failed to start audit", variant: "destructive" });
        return;
      }

      const { audit_id } = await r.json();

      try {
        const streamResp = await fetch(`${QA_BASE}/${audit_id}/stream`, { credentials: "include" });
        if (streamResp.ok && streamResp.body) {
          const reader = streamResp.body.getReader();
          const decoder = new TextDecoder();
          let buffer = "";

          const processStream = async () => {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              buffer += decoder.decode(value, { stream: true });
              const lines = buffer.split("\n");
              buffer = lines.pop() || "";

              for (const line of lines) {
                if (line.startsWith("data: ")) {
                  try {
                    const event = JSON.parse(line.slice(6));
                    if (event.type === "progress") {
                      setAgentStatuses(prev => ({
                        ...prev,
                        [event.agent]: { status: "running", message: event.message },
                      }));
                    } else if (event.type === "agent_complete") {
                      setAgentStatuses(prev => ({
                        ...prev,
                        [event.agent]: { status: "done", passed: event.passed, failed: event.failed },
                      }));
                    } else if (event.type === "complete") {
                      setRunning(false);
                      loadReport(event.audit_id);
                      loadAudits();
                      return;
                    } else if (event.type === "error") {
                      setRunning(false);
                      setView("empty");
                      toast({ title: "Audit failed", description: event.message, variant: "destructive" });
                      return;
                    }
                  } catch {}
                }
              }
            }
            setRunning(false);
            loadReport(audit_id);
            loadAudits();
          };
          processStream();
          return;
        }
      } catch {}

      pollRef.current = setInterval(async () => {
        try {
          const r2 = await fetch(`${QA_BASE}/${audit_id}`, { credentials: "include" });
          if (r2.ok) {
            const d = await r2.json();
            if (d.status === "completed") {
              clearInterval(pollRef.current!);
              setRunning(false);
              setSelectedAudit(normalize(d));
              setView("complete");
              loadAudits();
            } else if (d.status === "failed") {
              clearInterval(pollRef.current!);
              setRunning(false);
              setView("empty");
              toast({ title: "Audit failed", variant: "destructive" });
            }
          }
        } catch {}
      }, 3000);
    } catch {
      setRunning(false);
      setView("empty");
      toast({ title: "Connection error", variant: "destructive" });
    }
  };

  const downloadReport = (auditId: number, format: "json" | "markdown") => {
    const url = `${QA_BASE}/${auditId}/download/${format}`;
    fetch(url, { credentials: "include" })
      .then(r => r.blob())
      .then(blob => {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = `qa-report-${auditId}.${format === "json" ? "json" : "md"}`;
        a.click();
      });
  };

  const agentNames = ["Security", "Infrastructure", "API", "Data Flow"];
  const completedAgents = Object.values(agentStatuses).filter(s => s.status === "done").length;
  const progressPct = running ? (completedAgents / 4) * 100 : 0;

  const groupedFindings: Record<string, Finding[]> = {};
  if (selectedAudit?.findings) {
    for (const sev of SEVERITY_ORDER) {
      const items = selectedAudit.findings.filter(f => f.severity === sev && f.status !== "PASSED");
      if (items.length > 0) groupedFindings[sev] = items;
    }
    const passed = selectedAudit.findings.filter(f => f.status === "PASSED");
    if (passed.length > 0) groupedFindings["PASSED"] = passed;
  }

  const agentBreakdown = selectedAudit?.findings ? (() => {
    const map: Record<string, { total: number; passed: number; failed: number }> = {};
    for (const f of selectedAudit.findings) {
      if (!map[f.agent]) map[f.agent] = { total: 0, passed: 0, failed: 0 };
      map[f.agent].total++;
      if (f.status === "PASSED") map[f.agent].passed++;
      else map[f.agent].failed++;
    }
    return map;
  })() : {};

  return (
    <div className="p-6">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-center">
          <Shield className="w-5 h-5 text-amber-500" />
        </div>
        <div className="flex-1">
          <h1 className="text-2xl font-bold tracking-tight" data-testid="text-qa-portal-title">QA Audit Portal</h1>
          <p className="text-sm text-muted-foreground">Automated quality assurance for every build</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        <div className="lg:col-span-2 space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Target className="w-4 h-4 text-amber-500" />
                Run Audit
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Project Name *</label>
                <Input
                  value={projectName}
                  onChange={e => setProjectName(e.target.value)}
                  placeholder="BlackRidge Ops"
                  data-testid="input-qa-project-name"
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Target URL *</label>
                <Input
                  value={targetUrl}
                  onChange={e => setTargetUrl(e.target.value)}
                  placeholder="https://api.myproject.com"
                  data-testid="input-qa-target-url"
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Auth Token (optional)</label>
                <Input
                  type="password"
                  value={authToken}
                  onChange={e => setAuthToken(e.target.value)}
                  placeholder="JWT token for protected endpoints"
                  data-testid="input-qa-auth-token"
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Known API Endpoints (one per line)</label>
                <Textarea
                  value={endpoints}
                  onChange={e => setEndpoints(e.target.value)}
                  placeholder={"/api/users\n/api/orders"}
                  rows={3}
                  data-testid="input-qa-endpoints"
                />
              </div>
              <Button
                onClick={startAudit}
                disabled={running || !projectName || !targetUrl}
                className="w-full bg-amber-600 hover:bg-amber-700 text-white"
                data-testid="button-run-audit"
              >
                {running ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Play className="w-4 h-4 mr-2" />}
                {running ? "Running..." : "Run QA Audit"}
              </Button>
              <p className="text-[11px] text-muted-foreground text-center">Security · Infrastructure · API · Data Flow</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm">Audit History</CardTitle>
                <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={loadAudits} data-testid="button-refresh-audits">
                  <RefreshCw className="w-3.5 h-3.5" />
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {audits.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-4" data-testid="text-no-audits">No audits yet</p>
              ) : (
                <div className="space-y-1 max-h-80 overflow-y-auto">
                  {audits.map(a => (
                    <button
                      key={a.id}
                      onClick={() => loadReport(a.id)}
                      className={`w-full text-left p-2.5 rounded-md hover:bg-muted/30 transition-colors border ${
                        selectedAudit?.id === a.id ? "border-amber-500/40 bg-amber-500/5" : "border-transparent"
                      }`}
                      data-testid={`audit-history-${a.id}`}
                    >
                      <div className="flex items-center justify-between mb-0.5">
                        <span className="text-sm font-medium truncate flex-1 mr-2">{a.project_name}</span>
                        <div className="flex items-center gap-1.5 shrink-0">
                          {a.score !== null && (
                            <Badge variant="outline" className={`text-[10px] ${
                              a.score >= 80 ? "text-green-600 border-green-300" :
                              a.score >= 60 ? "text-yellow-600 border-yellow-300" :
                              "text-red-600 border-red-300"
                            }`}>{a.score.toFixed(1)}</Badge>
                          )}
                          {a.grade && (
                            <Badge className={`text-[10px] ${
                              a.grade.startsWith("A") ? "bg-green-500/20 text-green-600" :
                              a.grade.startsWith("B") ? "bg-emerald-500/20 text-emerald-600" :
                              a.grade === "C" ? "bg-yellow-500/20 text-yellow-600" :
                              "bg-red-500/20 text-red-600"
                            }`}>{a.grade}</Badge>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] text-muted-foreground truncate mr-2">{a.target_url}</span>
                        <span className="text-[10px] text-muted-foreground shrink-0">{timeAgo(a.created_at)}</span>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="lg:col-span-3">
          {view === "empty" && (
            <Card className="h-full min-h-[400px] flex items-center justify-center">
              <CardContent className="text-center space-y-3">
                <Shield className="w-12 h-12 mx-auto text-muted-foreground/30" />
                <p className="text-sm text-muted-foreground" data-testid="text-qa-empty">Enter a URL and click Run QA Audit to begin</p>
              </CardContent>
            </Card>
          )}

          {view === "running" && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <div className="w-2.5 h-2.5 rounded-full bg-amber-500 animate-pulse" />
                  Audit in progress...
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {agentNames.map(name => {
                  const s = agentStatuses[name] || { status: "pending" };
                  return (
                    <div key={name} className="flex items-center gap-3 py-2" data-testid={`agent-progress-${name.toLowerCase().replace(/\s/g, "-")}`}>
                      <div className={`w-7 h-7 rounded-full flex items-center justify-center ${
                        s.status === "done" ? "bg-green-100 text-green-600" :
                        s.status === "running" ? "bg-amber-100 text-amber-600" :
                        s.status === "error" ? "bg-red-100 text-red-600" :
                        "bg-muted text-muted-foreground"
                      }`}>
                        {s.status === "done" ? <CheckCircle2 className="w-4 h-4" /> :
                         s.status === "running" ? <Loader2 className="w-4 h-4 animate-spin" /> :
                         s.status === "error" ? <XCircle className="w-4 h-4" /> :
                         <Circle className="w-3.5 h-3.5" />}
                      </div>
                      <div className="flex-1">
                        <span className="text-sm font-medium">{name} Agent</span>
                        {s.message && <p className="text-xs text-muted-foreground">{s.message}</p>}
                        {s.status === "done" && <p className="text-xs text-green-600">{s.passed} passed, {s.failed} failed</p>}
                      </div>
                    </div>
                  );
                })}
                <div className="pt-2">
                  <div className="flex justify-between text-xs text-muted-foreground mb-1">
                    <span>Progress</span>
                    <span>{progressPct.toFixed(0)}%</span>
                  </div>
                  <div className="h-2 bg-muted rounded-full overflow-hidden">
                    <div
                      className="h-full bg-amber-500 rounded-full transition-all duration-500"
                      style={{ width: `${progressPct}%` }}
                    />
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {view === "complete" && selectedAudit && (
            <div className="space-y-4">
              <Card>
                <CardContent className="pt-6">
                  <div className="flex items-start gap-6 flex-wrap">
                    <div className="text-center">
                      <div className={`text-5xl font-bold ${GRADE_COLORS[selectedAudit.grade || ""] || "text-foreground"}`}>
                        {selectedAudit.score?.toFixed(1)}
                      </div>
                      <span className="text-sm text-muted-foreground">/100</span>
                      <div className="mt-2">
                        <Badge className={`text-lg px-3 py-0.5 ${
                          (selectedAudit.grade || "").startsWith("A") ? "bg-green-500/20 text-green-600" :
                          (selectedAudit.grade || "").startsWith("B") ? "bg-emerald-500/20 text-emerald-600" :
                          selectedAudit.grade === "C" ? "bg-yellow-500/20 text-yellow-600" :
                          "bg-red-500/20 text-red-600"
                        }`} data-testid="badge-audit-grade">{selectedAudit.grade}</Badge>
                      </div>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
                        <div className="bg-muted/30 rounded-lg p-2.5 text-center">
                          <div className="text-lg font-bold">{selectedAudit.total_tests}</div>
                          <div className="text-[10px] text-muted-foreground">Total Tests</div>
                        </div>
                        <div className="bg-green-500/10 rounded-lg p-2.5 text-center">
                          <div className="text-lg font-bold text-green-600">{selectedAudit.passed}</div>
                          <div className="text-[10px] text-muted-foreground">Passed</div>
                        </div>
                        <div className="bg-red-500/10 rounded-lg p-2.5 text-center">
                          <div className="text-lg font-bold text-red-600">{selectedAudit.failed}</div>
                          <div className="text-[10px] text-muted-foreground">Failed</div>
                        </div>
                        <div className="bg-yellow-500/10 rounded-lg p-2.5 text-center">
                          <div className="text-lg font-bold text-yellow-600">
                            {(selectedAudit.total_tests || 0) - (selectedAudit.passed || 0) - (selectedAudit.failed || 0)}
                          </div>
                          <div className="text-[10px] text-muted-foreground">Warnings</div>
                        </div>
                      </div>
                      <div className="flex gap-3 flex-wrap text-xs">
                        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-600" /> Critical: {selectedAudit.critical_count || 0}</span>
                        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-orange-500" /> High: {selectedAudit.high_count || 0}</span>
                        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-yellow-500" /> Medium: {selectedAudit.medium_count || 0}</span>
                        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-blue-500" /> Low: {selectedAudit.low_count || 0}</span>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {selectedAudit.ai_analysis && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <Sparkles className="w-4 h-4 text-amber-500" />
                      AI Executive Summary
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-sm text-muted-foreground whitespace-pre-line" data-testid="text-ai-analysis">{selectedAudit.ai_analysis}</div>
                  </CardContent>
                </Card>
              )}

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {Object.entries(agentBreakdown).map(([agent, stats]) => (
                  <Card key={agent}>
                    <CardContent className="pt-4 pb-3 text-center">
                      <div className="text-xs font-medium mb-1.5">{agent}</div>
                      <div className="text-lg font-bold">{stats.total}</div>
                      <div className="text-[10px] text-muted-foreground">
                        <span className="text-green-600">{stats.passed}✓</span> · <span className="text-red-600">{stats.failed}✗</span>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>

              {Object.entries(groupedFindings).map(([severity, findings]) => (
                <div key={severity}>
                  <div className="flex items-center gap-2 mb-2">
                    <Badge className={severity === "PASSED" ? "bg-green-500/20 text-green-600" : SEVERITY_COLORS[severity]}>
                      {severity}
                    </Badge>
                    <span className="text-xs text-muted-foreground">{findings.length} finding{findings.length !== 1 ? "s" : ""}</span>
                  </div>
                  <div className="space-y-2">
                    {findings.map(f => <FindingCard key={f.id} finding={f} />)}
                  </div>
                </div>
              ))}

              <div className="flex gap-3">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => downloadReport(selectedAudit.id, "json")}
                  data-testid="button-download-json"
                >
                  <Download className="w-3.5 h-3.5 mr-1.5" />
                  Download JSON
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => downloadReport(selectedAudit.id, "markdown")}
                  data-testid="button-download-markdown"
                >
                  <FileText className="w-3.5 h-3.5 mr-1.5" />
                  Download Markdown
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
