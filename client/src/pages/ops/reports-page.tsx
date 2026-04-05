import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, RefreshCw, Trash2, FileBarChart, AlertTriangle, AlertCircle, TrendingUp, Users, FolderKanban, DollarSign, CheckSquare, Clock, Brain, Sparkles, ShieldAlert, Lightbulb, Star } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { generateWeeklyOps } from "@/lib/ai";
import type { AiReport } from "@shared/schema";
import ARAgingReport from "./ar-aging-report";

type WeeklyOpsPayload = {
  generatedAt: string;
  leads: {
    totalLeads: number;
    newLeadsLast7Days: number;
    leadsInPipeline: number;
    leadsWon: number;
    leadsLost: number;
    pipelineValue: number;
    weightedForecast: number;
    staleLeads: number;
    overdueFollowups: number;
    bySource: Array<{ source: string; count: number; value: number }>;
    byStatus: Array<{ status: string; count: number }>;
  };
  projects: {
    totalProjects: number;
    activeProjects: number;
    completedProjects: number;
    totalContractValue: number;
    activeContractValue: number;
    waitingOnClient: number;
    stalledProjects: number;
    byStage: Array<{ stage: string; count: number; value: number }>;
  };
  revenue: {
    totalCollected: number;
    collectedLast30Days: number;
    pendingPayments: number;
    overduePayments: number;
    overdueAmount: number;
    upcomingDue7Days: number;
    upcomingDueAmount: number;
  };
  tasks: {
    totalOpen: number;
    overdueTasks: number;
    completedLast7Days: number;
    blockedTasks: number;
    waitingOnClientTasks: number;
    byPriority: Array<{ priority: string; count: number }>;
  };
  time: {
    totalMinutesLast7Days: number;
    billableMinutesLast7Days: number;
    billableRatio: number;
    topProjects: Array<{ projectName: string; minutes: number }>;
  };
  alerts: Array<{
    type: string;
    severity: "warning" | "critical";
    title: string;
    detail: string;
    entityId: string;
  }>;
  ai?: {
    summary?: {
      health_score: number;
      overview: string;
    };
    risk_items?: Array<{
      entity_type: string;
      entity_id?: string;
      title: string;
      reason: string;
      urgency: "low" | "medium" | "high";
      recommended_action: string;
    }>;
    recommended_actions?: Array<{
      title: string;
      detail: string;
      impact: "low" | "medium" | "high";
    }>;
    highlights?: string[];
  };
};

function fmtDollars(cents: number): string {
  return "$" + (cents / 100).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function fmtHours(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}

function ReportDetail({ report }: { report: AiReport }) {
  const data = report.payload as unknown as WeeklyOpsPayload;
  if (!data) return <p className="text-muted-foreground">No data available</p>;

  const criticalAlerts = data.alerts?.filter(a => a.severity === "critical") ?? [];
  const warningAlerts = data.alerts?.filter(a => a.severity === "warning") ?? [];

  const ai = data.ai;
  const healthScore = ai?.summary?.health_score;

  function getHealthColor(score: number) {
    if (score >= 75) return "text-green-500";
    if (score >= 50) return "text-yellow-500";
    return "text-destructive";
  }

  function getHealthBg(score: number) {
    if (score >= 75) return "bg-green-500/10 border-green-500/30";
    if (score >= 50) return "bg-yellow-500/10 border-yellow-500/30";
    return "bg-destructive/10 border-destructive/30";
  }

  function getUrgencyVariant(urgency: string) {
    if (urgency === "high") return "destructive" as const;
    if (urgency === "medium") return "secondary" as const;
    return "outline" as const;
  }

  function getImpactVariant(impact: string) {
    if (impact === "high") return "destructive" as const;
    if (impact === "medium") return "secondary" as const;
    return "outline" as const;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3 flex-wrap">
        <h3 className="text-lg font-semibold" data-testid="text-report-title">Weekly Ops Report</h3>
        <Badge variant="outline">{fmtDate(data.generatedAt || (report.generatedAt as unknown as string))}</Badge>
        {ai && <Badge variant="secondary" className="gap-1"><Brain className="h-3 w-3" /> AI-Powered</Badge>}
      </div>

      {ai?.summary && (
        <Card className={`border ${healthScore !== undefined ? getHealthBg(healthScore) : ""}`}>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Sparkles className="h-4 w-4" />
              AI Analysis
            </CardTitle>
            {healthScore !== undefined && (
              <div className="flex items-center gap-2" data-testid="text-health-score">
                <span className="text-xs text-muted-foreground uppercase tracking-wider">Health</span>
                <span className={`text-2xl font-bold ${getHealthColor(healthScore)}`}>{healthScore}</span>
                <span className="text-xs text-muted-foreground">/100</span>
              </div>
            )}
          </CardHeader>
          <CardContent>
            <p className="text-sm leading-relaxed" data-testid="text-ai-overview">{ai.summary.overview}</p>
          </CardContent>
        </Card>
      )}

      {ai?.highlights && ai.highlights.length > 0 && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Star className="h-4 w-4 text-yellow-500" />
              Highlights
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2">
              {ai.highlights.map((h, i) => (
                <li key={i} className="flex items-start gap-2 text-sm">
                  <Star className="h-3.5 w-3.5 text-yellow-500 shrink-0 mt-0.5" />
                  <span>{h}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {ai?.risk_items && ai.risk_items.length > 0 && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <ShieldAlert className="h-4 w-4 text-destructive" />
              Risk Items ({ai.risk_items.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {ai.risk_items.map((risk, i) => (
                <div key={i} className="flex items-start gap-3 text-sm p-3 rounded-md bg-muted/50">
                  <div className="shrink-0 mt-0.5">
                    <Badge variant={getUrgencyVariant(risk.urgency)} className="text-xs capitalize">{risk.urgency}</Badge>
                  </div>
                  <div className="min-w-0 space-y-1">
                    <div className="font-medium">{risk.title}</div>
                    <p className="text-muted-foreground">{risk.reason}</p>
                    <div className="flex items-start gap-1.5 text-xs">
                      <Lightbulb className="h-3.5 w-3.5 shrink-0 mt-0.5 text-yellow-500" />
                      <span>{risk.recommended_action}</span>
                    </div>
                    <Badge variant="outline" className="text-xs capitalize">{risk.entity_type}</Badge>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {ai?.recommended_actions && ai.recommended_actions.length > 0 && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Lightbulb className="h-4 w-4 text-yellow-500" />
              Recommended Actions
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {ai.recommended_actions.map((action, i) => (
                <div key={i} className="flex items-start gap-3 text-sm">
                  <Badge variant={getImpactVariant(action.impact)} className="text-xs capitalize shrink-0 mt-0.5">{action.impact}</Badge>
                  <div className="min-w-0">
                    <div className="font-medium">{action.title}</div>
                    <p className="text-muted-foreground">{action.detail}</p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {(criticalAlerts.length > 0 || warningAlerts.length > 0) && (
        <Card className="border-destructive/50">
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-destructive" />
              System Alerts ({data.alerts.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {criticalAlerts.map((a, i) => (
                <div key={`c-${i}`} className="flex items-start gap-2 text-sm">
                  <AlertCircle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
                  <div>
                    <span className="font-medium">{a.title}</span>
                    <span className="text-muted-foreground ml-2">{a.detail}</span>
                  </div>
                </div>
              ))}
              {warningAlerts.map((a, i) => (
                <div key={`w-${i}`} className="flex items-start gap-2 text-sm">
                  <AlertTriangle className="h-4 w-4 text-yellow-500 shrink-0 mt-0.5" />
                  <div>
                    <span className="font-medium">{a.title}</span>
                    <span className="text-muted-foreground ml-2">{a.detail}</span>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Leads</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-leads-total">{data.leads.totalLeads}</div>
            <div className="grid grid-cols-2 gap-2 mt-3 text-sm">
              <div><span className="text-muted-foreground">New (7d):</span> {data.leads.newLeadsLast7Days}</div>
              <div><span className="text-muted-foreground">In pipeline:</span> {data.leads.leadsInPipeline}</div>
              <div><span className="text-muted-foreground">Won:</span> {data.leads.leadsWon}</div>
              <div><span className="text-muted-foreground">Lost:</span> {data.leads.leadsLost}</div>
              <div><span className="text-muted-foreground">Stale:</span> <span className={data.leads.staleLeads > 0 ? "text-yellow-500 font-medium" : ""}>{data.leads.staleLeads}</span></div>
              <div><span className="text-muted-foreground">Overdue F/U:</span> <span className={data.leads.overdueFollowups > 0 ? "text-destructive font-medium" : ""}>{data.leads.overdueFollowups}</span></div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Pipeline Value</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-pipeline-value">{fmtDollars(data.leads.pipelineValue)}</div>
            <p className="text-sm text-muted-foreground mt-1">Weighted: {fmtDollars(data.leads.weightedForecast)}</p>
            {data.leads.bySource.length > 0 && (
              <div className="mt-3 space-y-1">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">By Source</p>
                {data.leads.bySource.slice(0, 5).map(s => (
                  <div key={s.source} className="flex items-center justify-between text-sm">
                    <span className="capitalize">{s.source.replace(/-/g, " ")}</span>
                    <span className="text-muted-foreground">{s.count} leads</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Projects</CardTitle>
            <FolderKanban className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-projects-active">{data.projects.activeProjects} active</div>
            <div className="grid grid-cols-2 gap-2 mt-3 text-sm">
              <div><span className="text-muted-foreground">Total:</span> {data.projects.totalProjects}</div>
              <div><span className="text-muted-foreground">Completed:</span> {data.projects.completedProjects}</div>
              <div><span className="text-muted-foreground">Waiting:</span> <span className={data.projects.waitingOnClient > 0 ? "text-yellow-500 font-medium" : ""}>{data.projects.waitingOnClient}</span></div>
              <div><span className="text-muted-foreground">Stalled:</span> <span className={data.projects.stalledProjects > 0 ? "text-destructive font-medium" : ""}>{data.projects.stalledProjects}</span></div>
            </div>
            <p className="text-sm text-muted-foreground mt-2">Contract value: {fmtDollars(data.projects.totalContractValue)}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Revenue</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-revenue-collected">{fmtDollars(data.revenue.totalCollected)}</div>
            <p className="text-sm text-muted-foreground">collected total</p>
            <div className="grid grid-cols-2 gap-2 mt-3 text-sm">
              <div><span className="text-muted-foreground">Last 30d:</span> {fmtDollars(data.revenue.collectedLast30Days)}</div>
              <div><span className="text-muted-foreground">Pending:</span> {data.revenue.pendingPayments}</div>
              <div><span className="text-muted-foreground">Overdue:</span> <span className={data.revenue.overduePayments > 0 ? "text-destructive font-medium" : ""}>{data.revenue.overduePayments} ({fmtDollars(data.revenue.overdueAmount)})</span></div>
              <div><span className="text-muted-foreground">Due 7d:</span> {data.revenue.upcomingDue7Days} ({fmtDollars(data.revenue.upcomingDueAmount)})</div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Tasks</CardTitle>
            <CheckSquare className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-tasks-open">{data.tasks.totalOpen} open</div>
            <div className="grid grid-cols-2 gap-2 mt-3 text-sm">
              <div><span className="text-muted-foreground">Completed (7d):</span> {data.tasks.completedLast7Days}</div>
              <div><span className="text-muted-foreground">Overdue:</span> <span className={data.tasks.overdueTasks > 0 ? "text-destructive font-medium" : ""}>{data.tasks.overdueTasks}</span></div>
              <div><span className="text-muted-foreground">Blocked:</span> <span className={data.tasks.blockedTasks > 0 ? "text-yellow-500 font-medium" : ""}>{data.tasks.blockedTasks}</span></div>
              <div><span className="text-muted-foreground">Client wait:</span> {data.tasks.waitingOnClientTasks}</div>
            </div>
            {data.tasks.byPriority.length > 0 && (
              <div className="flex gap-2 mt-3 flex-wrap">
                {data.tasks.byPriority.map(p => (
                  <Badge key={p.priority} variant="outline" className="text-xs capitalize">{p.priority}: {p.count}</Badge>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Time (7 days)</CardTitle>
            <Clock className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-time-total">{fmtHours(data.time.totalMinutesLast7Days)}</div>
            <p className="text-sm text-muted-foreground">Billable: {fmtHours(data.time.billableMinutesLast7Days)} ({Math.round(data.time.billableRatio * 100)}%)</p>
            {data.time.topProjects.length > 0 && (
              <div className="mt-3 space-y-1">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Top Projects</p>
                {data.time.topProjects.map(p => (
                  <div key={p.projectName} className="flex items-center justify-between text-sm">
                    <span className="truncate">{p.projectName}</span>
                    <span className="text-muted-foreground shrink-0 ml-2">{fmtHours(p.minutes)}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {data.projects.byStage.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Projects by Stage</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {data.projects.byStage.map(s => (
                <div key={s.stage} className="text-center p-3 rounded-md bg-muted/50">
                  <div className="text-lg font-bold">{s.count}</div>
                  <div className="text-xs text-muted-foreground capitalize">{s.stage.replace(/_/g, " ")}</div>
                  {s.value > 0 && <div className="text-xs text-muted-foreground mt-1">{fmtDollars(s.value)}</div>}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {data.leads.byStatus.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Leads by Status</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex gap-3 flex-wrap">
              {data.leads.byStatus.map(s => (
                <div key={s.status} className="text-center p-3 rounded-md bg-muted/50 min-w-[80px]">
                  <div className="text-lg font-bold">{s.count}</div>
                  <div className="text-xs text-muted-foreground capitalize">{s.status}</div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

export default function ReportsPage() {
  const { toast } = useToast();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const { data: reports, isLoading } = useQuery<AiReport[]>({
    queryKey: ["/api/ai/reports", "weekly_ops"],
    queryFn: async () => {
      const res = await fetch("/api/ai/reports?type=weekly_ops");
      if (!res.ok) throw new Error("Failed to fetch reports");
      return res.json();
    },
  });

  const generateMutation = useMutation({
    mutationFn: generateWeeklyOps,
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/ai/reports"] });
      if (data?.report?.id) setSelectedId(data.report.id);
      toast({ title: "Report generated", description: "Weekly ops report has been created." });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to generate report.", variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/ai/reports/${id}`);
    },
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: ["/api/ai/reports"] });
      if (selectedId === id) setSelectedId(null);
      toast({ title: "Deleted", description: "Report deleted." });
    },
  });

  const selectedReport = reports?.find(r => r.id === selectedId);

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-reports-heading">Weekly Reports</h1>
          <p className="text-sm text-muted-foreground">Generate and view weekly operations snapshots</p>
        </div>
        <Button
          onClick={() => generateMutation.mutate()}
          disabled={generateMutation.isPending}
          data-testid="button-generate-report"
        >
          {generateMutation.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin mr-2" />
          ) : (
            <RefreshCw className="h-4 w-4 mr-2" />
          )}
          Generate AI Report
        </Button>
      </div>

      {isLoading && (
        <div className="flex justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      )}

      {!isLoading && (!reports || reports.length === 0) && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 gap-3">
            <FileBarChart className="h-12 w-12 text-muted-foreground" />
            <p className="text-muted-foreground">No reports generated yet</p>
            <Button
              variant="outline"
              onClick={() => generateMutation.mutate()}
              disabled={generateMutation.isPending}
              data-testid="button-generate-first-report"
            >
              Generate your first report
            </Button>
          </CardContent>
        </Card>
      )}

      {!isLoading && reports && reports.length > 0 && (
        <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider px-1">Report History</p>
            {reports.map(r => {
              const rPayload = r.payload as unknown as WeeklyOpsPayload;
              const rScore = rPayload?.ai?.summary?.health_score;
              return (
                <div
                  key={r.id}
                  className={`flex items-center justify-between gap-2 p-3 rounded-md cursor-pointer transition-colors ${
                    selectedId === r.id ? "bg-accent" : "hover-elevate"
                  }`}
                  onClick={() => setSelectedId(r.id)}
                  data-testid={`report-item-${r.id}`}
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-medium truncate">{fmtDate(r.generatedAt as unknown as string)}</p>
                      {rScore !== undefined && (
                        <Badge variant="outline" className={`text-xs ${rScore >= 75 ? "text-green-500 border-green-500/30" : rScore >= 50 ? "text-yellow-500 border-yellow-500/30" : "text-destructive border-destructive/30"}`}>
                          {rScore}
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">{rPayload?.ai ? "AI-powered" : "by " + (r.createdBy || "system")}</p>
                  </div>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={(e) => { e.stopPropagation(); deleteMutation.mutate(r.id); }}
                    data-testid={`button-delete-report-${r.id}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              );
            })}
          </div>

          <div>
            {selectedReport ? (
              <ReportDetail report={selectedReport} />
            ) : (
              <Card>
                <CardContent className="flex flex-col items-center justify-center py-12 gap-3">
                  <FileBarChart className="h-10 w-10 text-muted-foreground" />
                  <p className="text-muted-foreground">Select a report from the list to view details</p>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      )}

      <ARAgingReport />
    </div>
  );
}
