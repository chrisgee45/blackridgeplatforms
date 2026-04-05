import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { Link } from "wouter";
import {
  FolderKanban, DollarSign, TrendingUp, AlertTriangle, Clock,
  CheckCircle2, AlertCircle, Timer, Building2, ChevronRight,
} from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
} from "recharts";
import type { Project, Task } from "@shared/schema";

const STAGE_COLORS: Record<string, string> = {
  discovery: "#3b82f6",
  proposal: "#a855f7",
  contract: "#f59e0b",
  kickoff: "#10b981",
  in_progress: "#0ea5e9",
  review: "#f97316",
  completed: "#22c55e",
  archived: "#6b7280",
};

const STAGE_LABELS: Record<string, string> = {
  discovery: "Discovery",
  proposal: "Proposal",
  contract: "Contract",
  kickoff: "Kickoff",
  in_progress: "In Progress",
  review: "Review",
  completed: "Completed",
  archived: "Archived",
};

interface CockpitData {
  overdueTasks: Task[];
  dueTodayTasks: Task[];
  waitingOnClient: Project[];
  revenueUnlockers: Project[];
}

interface DashboardData {
  totalProjects: number;
  activeProjects: number;
  totalPipelineValue: number;
  totalRevenue: number;
  stalledProjects: number;
  projectsByStage: { stage: string; count: number; value: number }[];
  profitLeaderboard: { projectId: string; projectName: string; effectiveRate: number; totalHours: number }[];
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

function formatCurrencyCompact(value: number): string {
  if (value >= 1000) {
    return `$${Math.round(value / 1000)}k`;
  }
  return formatCurrency(value);
}

function formatDate(date: Date): string {
  return date.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function getDaysOverdue(dueDate: string | Date): number {
  const now = new Date();
  const due = new Date(dueDate);
  return Math.floor((now.getTime() - due.getTime()) / (1000 * 60 * 60 * 24));
}

function getDaysWaiting(blockerSince: string | Date | null): number {
  if (!blockerSince) return 0;
  const now = new Date();
  const since = new Date(blockerSince);
  return Math.floor((now.getTime() - since.getTime()) / (1000 * 60 * 60 * 24));
}

export default function Dashboard() {
  const { data: cockpit, isLoading: cockpitLoading } = useQuery<CockpitData>({
    queryKey: ["/api/ops/cockpit"],
  });

  const { data: dashboard, isLoading: dashLoading } = useQuery<DashboardData>({
    queryKey: ["/api/ops/dashboard"],
  });

  const { data: projects, isLoading: projLoading } = useQuery<Project[]>({
    queryKey: ["/api/ops/projects"],
  });

  const isLoading = cockpitLoading || dashLoading || projLoading;

  const projectMap = new Map((projects ?? []).map(p => [p.id, p]));

  const avgRate = dashboard?.profitLeaderboard && dashboard.profitLeaderboard.length > 0
    ? dashboard.profitLeaderboard.reduce((sum, p) => sum + p.effectiveRate, 0) / dashboard.profitLeaderboard.length
    : 0;

  const hasNoData = !isLoading && (!projects || projects.length === 0);

  if (hasNoData) {
    return (
      <div className="p-3 sm:p-6 space-y-4 sm:space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight" data-testid="text-page-title">Today's Cockpit</h1>
          <p className="text-muted-foreground text-sm mt-1">{formatDate(new Date())}</p>
        </div>
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16">
            <FolderKanban className="w-12 h-12 text-muted-foreground/30 mb-4" />
            <p className="text-muted-foreground text-sm" data-testid="text-empty-state">
              No projects yet. Create your first project to get started.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const overdueTasks = cockpit?.overdueTasks ?? [];
  const dueTodayTasks = cockpit?.dueTodayTasks ?? [];
  const waitingOnClient = cockpit?.waitingOnClient ?? [];
  const revenueUnlockers = cockpit?.revenueUnlockers ?? [];
  const hasActionItems = overdueTasks.length > 0 || dueTodayTasks.length > 0 || waitingOnClient.length > 0 || revenueUnlockers.length > 0;

  const chartData = (dashboard?.projectsByStage ?? [])
    .filter(s => s.stage !== "archived")
    .map(s => ({
      stage: STAGE_LABELS[s.stage] ?? s.stage,
      count: s.count,
      fill: STAGE_COLORS[s.stage] ?? "#6b7280",
    }));

  return (
    <div className="p-3 sm:p-6 space-y-4 sm:space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight" data-testid="text-page-title">Today's Cockpit</h1>
        <p className="text-muted-foreground text-sm mt-1" data-testid="text-date">
          {formatDate(new Date())} — Your operational command center
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        <KPICard
          title="Active Projects"
          value={dashboard?.activeProjects}
          icon={<FolderKanban className="w-4 h-4 text-primary" />}
          loading={dashLoading}
          testId="stat-active-projects"
        />
        <KPICard
          title="Pipeline Value"
          value={dashboard?.totalPipelineValue != null ? formatCurrencyCompact(dashboard.totalPipelineValue) : undefined}
          icon={<DollarSign className="w-4 h-4 text-emerald-500" />}
          loading={dashLoading}
          testId="stat-pipeline-value"
        />
        <KPICard
          title="Revenue Earned"
          value={dashboard?.totalRevenue != null ? formatCurrencyCompact(dashboard.totalRevenue) : undefined}
          icon={<TrendingUp className="w-4 h-4 text-primary" />}
          loading={dashLoading}
          testId="stat-revenue"
        />
        <KPICard
          title="Stalled Projects"
          value={dashboard?.stalledProjects}
          icon={<AlertTriangle className="w-4 h-4 text-destructive" />}
          loading={dashLoading}
          testId="stat-stalled"
          valueClass={dashboard?.stalledProjects && dashboard.stalledProjects > 0 ? "text-destructive" : ""}
        />
        <KPICard
          title="Effective Avg Rate"
          value={avgRate > 0 ? `$${Math.round(avgRate)}/hr` : "—"}
          icon={<Clock className="w-4 h-4 text-amber-500" />}
          loading={dashLoading}
          testId="stat-avg-rate"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        <div className="lg:col-span-3 space-y-4">
          {isLoading ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Action Items</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="h-12 w-full" />
                ))}
              </CardContent>
            </Card>
          ) : hasActionItems ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base" data-testid="text-action-items-title">Action Items</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {overdueTasks.length > 0 && (
                  <ActionSection
                    title="Overdue Tasks"
                    count={overdueTasks.length}
                    accentClass="text-red-400"
                    testId="section-overdue"
                  >
                    {overdueTasks.map(task => {
                      const project = projectMap.get(task.projectId);
                      const days = task.dueDate ? getDaysOverdue(task.dueDate) : 0;
                      return (
                        <Link key={task.id} href={`/admin/ops/projects/${task.projectId}`}>
                          <div
                            className="flex items-center justify-between gap-2 py-2 px-3 rounded-md hover-elevate cursor-pointer group"
                            data-testid={`action-overdue-${task.id}`}
                          >
                            <div className="flex items-center gap-2 min-w-0">
                              <AlertCircle className="w-3.5 h-3.5 text-red-400 shrink-0" />
                              <div className="min-w-0">
                                <p className="text-sm font-medium truncate">{task.title}</p>
                                {project && (
                                  <p className="text-xs text-muted-foreground truncate">{project.name}</p>
                                )}
                              </div>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              <Badge variant="secondary" className="no-default-hover-elevate no-default-active-elevate text-[10px] bg-red-500/10 text-red-400">
                                {days}d overdue
                              </Badge>
                              <ChevronRight className="w-3.5 h-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                            </div>
                          </div>
                        </Link>
                      );
                    })}
                  </ActionSection>
                )}

                {overdueTasks.length > 0 && dueTodayTasks.length > 0 && <Separator />}

                {dueTodayTasks.length > 0 && (
                  <ActionSection
                    title="Due Today"
                    count={dueTodayTasks.length}
                    accentClass="text-amber-400"
                    testId="section-due-today"
                  >
                    {dueTodayTasks.map(task => {
                      const project = projectMap.get(task.projectId);
                      return (
                        <Link key={task.id} href={`/admin/ops/projects/${task.projectId}`}>
                          <div
                            className="flex items-center justify-between gap-2 py-2 px-3 rounded-md hover-elevate cursor-pointer group"
                            data-testid={`action-today-${task.id}`}
                          >
                            <div className="flex items-center gap-2 min-w-0">
                              <Timer className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                              <div className="min-w-0">
                                <p className="text-sm font-medium truncate">{task.title}</p>
                                {project && (
                                  <p className="text-xs text-muted-foreground truncate">{project.name}</p>
                                )}
                              </div>
                            </div>
                            <ChevronRight className="w-3.5 h-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                          </div>
                        </Link>
                      );
                    })}
                  </ActionSection>
                )}

                {(overdueTasks.length > 0 || dueTodayTasks.length > 0) && waitingOnClient.length > 0 && <Separator />}

                {waitingOnClient.length > 0 && (
                  <ActionSection
                    title="Waiting on Client"
                    count={waitingOnClient.length}
                    accentClass="text-orange-400"
                    testId="section-waiting"
                  >
                    {waitingOnClient.map(proj => {
                      const days = getDaysWaiting(proj.blockerSince);
                      return (
                        <Link key={proj.id} href={`/admin/ops/projects/${proj.id}`}>
                          <div
                            className="flex items-center justify-between gap-2 py-2 px-3 rounded-md hover-elevate cursor-pointer group"
                            data-testid={`action-waiting-${proj.id}`}
                          >
                            <div className="flex items-center gap-2 min-w-0">
                              <Building2 className="w-3.5 h-3.5 text-orange-400 shrink-0" />
                              <div className="min-w-0">
                                <p className="text-sm font-medium truncate">{proj.name}</p>
                                {proj.blocker && (
                                  <p className="text-xs text-muted-foreground truncate">{proj.blocker}</p>
                                )}
                              </div>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              {days > 0 && (
                                <Badge variant="secondary" className="no-default-hover-elevate no-default-active-elevate text-[10px] bg-orange-500/10 text-orange-400">
                                  {days}d waiting
                                </Badge>
                              )}
                              <ChevronRight className="w-3.5 h-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                            </div>
                          </div>
                        </Link>
                      );
                    })}
                  </ActionSection>
                )}

                {(overdueTasks.length > 0 || dueTodayTasks.length > 0 || waitingOnClient.length > 0) && revenueUnlockers.length > 0 && <Separator />}

                {revenueUnlockers.length > 0 && (
                  <ActionSection
                    title="Revenue Unlockers"
                    count={revenueUnlockers.length}
                    accentClass="text-emerald-400"
                    testId="section-revenue"
                  >
                    {revenueUnlockers.map(proj => (
                      <Link key={proj.id} href={`/admin/ops/projects/${proj.id}`}>
                        <div
                          className="flex items-center justify-between gap-2 py-2 px-3 rounded-md hover-elevate cursor-pointer group"
                          data-testid={`action-revenue-${proj.id}`}
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                            <div className="min-w-0">
                              <p className="text-sm font-medium truncate">{proj.name}</p>
                              <p className="text-xs text-muted-foreground">{STAGE_LABELS[proj.stage] ?? proj.stage}</p>
                            </div>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <span className="text-sm font-medium text-emerald-400">
                              {formatCurrency(proj.contractValue ?? 0)}
                            </span>
                            <ChevronRight className="w-3.5 h-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                          </div>
                        </div>
                      </Link>
                    ))}
                  </ActionSection>
                )}
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle className="text-base" data-testid="text-chart-title">Projects by Stage</CardTitle>
            </CardHeader>
            <CardContent>
              {dashLoading ? (
                <Skeleton className="h-[250px] w-full" />
              ) : chartData.length > 0 ? (
                <ResponsiveContainer width="100%" height={250}>
                  <BarChart data={chartData} layout="vertical" margin={{ left: 20, right: 20, top: 5, bottom: 5 }}>
                    <XAxis type="number" allowDecimals={false} tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }} />
                    <YAxis dataKey="stage" type="category" width={90} tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }} />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: "hsl(var(--card))",
                        border: "1px solid hsl(var(--border))",
                        borderRadius: "6px",
                        color: "hsl(var(--foreground))",
                      }}
                    />
                    <Bar dataKey="count" radius={[0, 4, 4, 0]}>
                      {chartData.map((entry, index) => (
                        <Cell key={index} fill={entry.fill} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex items-center justify-center h-[250px] text-muted-foreground text-sm">
                  No stage data available
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="lg:col-span-2 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base" data-testid="text-leaderboard-title">Profit Leaderboard</CardTitle>
            </CardHeader>
            <CardContent>
              {dashLoading ? (
                <div className="space-y-3">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <Skeleton key={i} className="h-10 w-full" />
                  ))}
                </div>
              ) : dashboard?.profitLeaderboard && dashboard.profitLeaderboard.length > 0 ? (
                <div className="space-y-1">
                  {dashboard.profitLeaderboard.slice(0, 10).map((entry, index) => (
                    <Link key={entry.projectId} href={`/admin/ops/projects/${entry.projectId}`}>
                      <div
                        className="flex items-center justify-between gap-2 py-2 px-3 rounded-md hover-elevate cursor-pointer group"
                        data-testid={`leaderboard-${entry.projectId}`}
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <span className="text-xs text-muted-foreground font-mono w-5 text-right shrink-0">
                            {index + 1}.
                          </span>
                          <span className="text-sm font-medium truncate">{entry.projectName}</span>
                        </div>
                        <div className="flex items-center gap-3 shrink-0">
                          <span
                            className={`text-sm font-semibold tabular-nums ${
                              entry.effectiveRate >= avgRate ? "text-emerald-400" : "text-red-400"
                            }`}
                            data-testid={`leaderboard-rate-${entry.projectId}`}
                          >
                            ${Math.round(entry.effectiveRate)}/hr
                          </span>
                          <span className="text-xs text-muted-foreground tabular-nums" data-testid={`leaderboard-hours-${entry.projectId}`}>
                            {entry.totalHours.toFixed(1)}h
                          </span>
                          <ChevronRight className="w-3.5 h-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                        </div>
                      </div>
                    </Link>
                  ))}
                </div>
              ) : (
                <div className="flex items-center justify-center h-24 text-muted-foreground text-sm">
                  No time entries recorded yet
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base" data-testid="text-quick-stats-title">Quick Stats</CardTitle>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <div className="space-y-3">
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-2 py-2 px-3 rounded-md bg-muted/30">
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 text-primary shrink-0" />
                      <span className="text-sm text-muted-foreground">Total Tasks Needing Action</span>
                    </div>
                    <span className="text-sm font-semibold tabular-nums" data-testid="stat-total-tasks">
                      {overdueTasks.length + dueTodayTasks.length}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-2 py-2 px-3 rounded-md bg-muted/30">
                    <div className="flex items-center gap-2">
                      <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />
                      <span className="text-sm text-muted-foreground">Projects Needing Attention</span>
                    </div>
                    <span className="text-sm font-semibold tabular-nums" data-testid="stat-attention-projects">
                      {(dashboard?.stalledProjects ?? 0) + waitingOnClient.length}
                    </span>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function KPICard({
  title,
  value,
  icon,
  loading,
  testId,
  valueClass = "",
}: {
  title: string;
  value?: string | number;
  icon: React.ReactNode;
  loading: boolean;
  testId: string;
  valueClass?: string;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
        {icon}
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-8 w-16" />
        ) : (
          <div className={`text-2xl font-bold ${valueClass}`} data-testid={testId}>
            {value ?? "—"}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ActionSection({
  title,
  count,
  accentClass,
  testId,
  children,
}: {
  title: string;
  count: number;
  accentClass: string;
  testId: string;
  children: React.ReactNode;
}) {
  return (
    <div data-testid={testId}>
      <div className="flex items-center gap-2 mb-2 flex-wrap">
        <span className={`text-sm font-semibold ${accentClass}`}>{title}</span>
        <Badge variant="secondary" className="no-default-hover-elevate no-default-active-elevate text-[10px]">
          {count}
        </Badge>
      </div>
      <div className="space-y-0.5">
        {children}
      </div>
    </div>
  );
}
