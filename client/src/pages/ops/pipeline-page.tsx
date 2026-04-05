import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  FolderKanban, DollarSign, Clock, AlertTriangle, Building2,
} from "lucide-react";
import type { Project, Company } from "@shared/schema";

const STAGES = [
  "discovery", "proposal", "contract", "kickoff",
  "in_progress", "review", "completed", "archived",
] as const;

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

const STAGE_HEADER_COLORS: Record<string, string> = {
  discovery: "bg-blue-500/20 text-blue-500",
  proposal: "bg-purple-500/20 text-purple-500",
  contract: "bg-amber-500/20 text-amber-500",
  kickoff: "bg-cyan-500/20 text-cyan-500",
  in_progress: "bg-emerald-500/20 text-emerald-500",
  review: "bg-orange-500/20 text-orange-500",
  completed: "bg-green-500/20 text-green-500",
  archived: "bg-muted text-muted-foreground",
};

const STAGE_DOT_COLORS: Record<string, string> = {
  discovery: "bg-blue-500",
  proposal: "bg-purple-500",
  contract: "bg-amber-500",
  kickoff: "bg-cyan-500",
  in_progress: "bg-emerald-500",
  review: "bg-orange-500",
  completed: "bg-green-500",
  archived: "bg-muted-foreground",
};

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

function getDaysInStage(stageChangedAt: string | Date | null): number {
  if (!stageChangedAt) return 0;
  const now = new Date();
  const changed = new Date(stageChangedAt);
  return Math.floor((now.getTime() - changed.getTime()) / (1000 * 60 * 60 * 24));
}

function isStale(stageChangedAt: string | Date | null, stage: string): boolean {
  if (stage === "completed" || stage === "archived") return false;
  return getDaysInStage(stageChangedAt) > 7;
}

export default function PipelinePage() {
  const { data: projects, isLoading: projLoading } = useQuery<Project[]>({
    queryKey: ["/api/ops/projects"],
  });

  const { data: companies, isLoading: compLoading } = useQuery<Company[]>({
    queryKey: ["/api/ops/companies"],
  });

  const isLoading = projLoading || compLoading;
  const companyMap = new Map(companies?.map((c) => [c.id, c.name]) ?? []);

  const projectsByStage = STAGES.reduce((acc, stage) => {
    acc[stage] = (projects ?? []).filter((p) => p.stage === stage);
    return acc;
  }, {} as Record<string, Project[]>);

  return (
    <div className="p-3 sm:p-6 space-y-4 sm:space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight" data-testid="text-page-title">
          Pipeline
        </h1>
        <p className="text-muted-foreground text-sm mt-1" data-testid="text-page-subtitle">
          Project stage pipeline overview
        </p>
      </div>

      {isLoading ? (
        <div className="flex gap-4 overflow-x-auto pb-4 flex-col md:flex-row">
          {STAGES.map((stage) => (
            <div key={stage} className="min-w-[280px] flex-shrink-0 space-y-3">
              <Skeleton className="h-10 w-full rounded-md" />
              <Skeleton className="h-28 w-full rounded-md" />
              <Skeleton className="h-28 w-full rounded-md" />
            </div>
          ))}
        </div>
      ) : (
        <div
          className="flex gap-4 overflow-x-auto pb-4 flex-col md:flex-row"
          data-testid="pipeline-board"
        >
          {STAGES.map((stage) => {
            const stageProjects = projectsByStage[stage] ?? [];
            const totalValue = stageProjects.reduce(
              (sum, p) => sum + (p.contractValue ?? 0),
              0
            );

            return (
              <div
                key={stage}
                className="min-w-[280px] flex-shrink-0 flex flex-col"
                data-testid={`column-${stage}`}
              >
                <div className={`rounded-md p-3 mb-3 ${STAGE_HEADER_COLORS[stage]}`}>
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="flex items-center gap-2">
                      <span className={`w-2 h-2 rounded-full ${STAGE_DOT_COLORS[stage]}`} />
                      <span className="font-semibold text-sm" data-testid={`text-stage-name-${stage}`}>
                        {STAGE_LABELS[stage]}
                      </span>
                    </div>
                    <Badge
                      variant="secondary"
                      className="no-default-hover-elevate no-default-active-elevate text-[10px]"
                      data-testid={`badge-stage-count-${stage}`}
                    >
                      {stageProjects.length}
                    </Badge>
                  </div>
                  {totalValue > 0 && (
                    <div className="flex items-center gap-1 mt-1.5 text-xs opacity-80">
                      <DollarSign className="w-3 h-3" />
                      <span data-testid={`text-stage-value-${stage}`}>
                        {formatCurrency(totalValue)}
                      </span>
                    </div>
                  )}
                </div>

                <div className="flex-1 space-y-2 min-h-[100px]">
                  {stageProjects.length === 0 ? (
                    <div
                      className="flex flex-col items-center justify-center py-8 text-muted-foreground/50"
                      data-testid={`empty-column-${stage}`}
                    >
                      <FolderKanban className="w-6 h-6 mb-1" />
                      <span className="text-xs">No projects</span>
                    </div>
                  ) : (
                    stageProjects.map((project) => {
                      const days = getDaysInStage(project.stageChangedAt);
                      const stale = isStale(project.stageChangedAt, project.stage);

                      return (
                        <Link
                          key={project.id}
                          href={`/admin/ops/projects/${project.id}`}
                          data-testid={`link-project-${project.id}`}
                        >
                          <Card
                            className="cursor-pointer hover-elevate"
                            data-testid={`card-project-${project.id}`}
                          >
                            <CardContent className="p-3 space-y-2">
                              <div className="flex items-start justify-between gap-2">
                                <span
                                  className="font-semibold text-sm leading-tight"
                                  data-testid={`text-project-name-${project.id}`}
                                >
                                  {project.name}
                                </span>
                                {stale && (
                                  <AlertTriangle
                                    className="w-3.5 h-3.5 text-amber-500 shrink-0 mt-0.5"
                                    data-testid={`icon-stale-${project.id}`}
                                  />
                                )}
                              </div>

                              {project.companyId && companyMap.has(project.companyId) && (
                                <div className="flex items-center gap-1.5 text-muted-foreground text-xs">
                                  <Building2 className="w-3 h-3 shrink-0" />
                                  <span
                                    className="truncate"
                                    data-testid={`text-company-${project.id}`}
                                  >
                                    {companyMap.get(project.companyId)}
                                  </span>
                                </div>
                              )}

                              {project.contractValue != null && project.contractValue > 0 && (
                                <div className="flex items-center gap-1.5 text-xs">
                                  <DollarSign className="w-3 h-3 shrink-0 text-emerald-500" />
                                  <span
                                    className="font-medium"
                                    data-testid={`text-value-${project.id}`}
                                  >
                                    {formatCurrency(project.contractValue)}
                                  </span>
                                </div>
                              )}

                              <div className="flex items-center gap-2 flex-wrap">
                                {project.stageChangedAt && (
                                  <div className="flex items-center gap-1 text-muted-foreground text-xs">
                                    <Clock className="w-3 h-3 shrink-0" />
                                    <span data-testid={`text-days-in-stage-${project.id}`}>
                                      {days} day{days !== 1 ? "s" : ""}
                                    </span>
                                  </div>
                                )}

                                {project.waitingOnClient && (
                                  <Badge
                                    variant="secondary"
                                    className="bg-red-500/10 text-red-400 no-default-hover-elevate no-default-active-elevate text-[10px]"
                                    data-testid={`badge-waiting-${project.id}`}
                                  >
                                    Waiting on Client
                                  </Badge>
                                )}
                              </div>
                            </CardContent>
                          </Card>
                        </Link>
                      );
                    })
                  )}
                </div>

                <div
                  className="mt-3 pt-2 border-t text-xs text-muted-foreground flex items-center justify-between gap-2 flex-wrap"
                  data-testid={`footer-${stage}`}
                >
                  <span data-testid={`text-column-count-${stage}`}>
                    {stageProjects.length} project{stageProjects.length !== 1 ? "s" : ""}
                  </span>
                  <span data-testid={`text-column-value-${stage}`}>
                    {formatCurrency(totalValue)}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
