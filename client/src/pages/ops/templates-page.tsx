import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  FileText, ChevronDown, ChevronUp, DollarSign, Clock,
  CheckCircle2, ListChecks, Flag, Lock, Loader2, Rocket,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type {
  ProjectTemplate, TemplateStage, TemplateGate,
  TemplateMilestone, TemplateTask, Company, Project,
} from "@shared/schema";

interface TemplateDetail extends ProjectTemplate {
  stages: TemplateStage[];
  gates: TemplateGate[];
  milestones: TemplateMilestone[];
  tasks: TemplateTask[];
}

const PRIORITY_COLORS: Record<string, string> = {
  low: "bg-muted text-muted-foreground",
  medium: "bg-blue-500/15 text-blue-400",
  high: "bg-amber-500/15 text-amber-400",
  urgent: "bg-red-500/15 text-red-400",
};

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

export default function TemplatesPage() {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showGenerateDialog, setShowGenerateDialog] = useState(false);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [projectName, setProjectName] = useState("");
  const [companyId, setCompanyId] = useState<string>("");
  const [startDate, setStartDate] = useState("");
  const [nameError, setNameError] = useState("");
  const [, navigate] = useLocation();
  const { toast } = useToast();

  const { data: templates, isLoading } = useQuery<ProjectTemplate[]>({
    queryKey: ["/api/ops/templates"],
  });

  const { data: templateDetail, isLoading: detailLoading } = useQuery<TemplateDetail>({
    queryKey: ["/api/ops/templates", expandedId],
    enabled: !!expandedId,
  });

  const { data: companies } = useQuery<Company[]>({
    queryKey: ["/api/ops/companies"],
  });

  const generateMutation = useMutation({
    mutationFn: async (data: { templateId: string; projectName: string; companyId?: string; startDate?: string }) => {
      const res = await apiRequest("POST", `/api/ops/templates/${data.templateId}/generate`, {
        projectName: data.projectName,
        companyId: data.companyId || undefined,
        startDate: data.startDate || undefined,
      });
      return res.json() as Promise<Project>;
    },
    onSuccess: (project) => {
      queryClient.invalidateQueries({ queryKey: ["/api/ops/projects"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ops/templates"] });
      toast({ title: "Project created from template" });
      setShowGenerateDialog(false);
      resetForm();
      navigate(`/admin/ops/projects/${project.id}`);
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const resetForm = () => {
    setProjectName("");
    setCompanyId("");
    setStartDate("");
    setNameError("");
    setSelectedTemplateId(null);
  };

  const openGenerateDialog = (templateId: string) => {
    setSelectedTemplateId(templateId);
    setShowGenerateDialog(true);
    setNameError("");
  };

  const handleGenerate = () => {
    if (!projectName.trim()) {
      setNameError("Project name is required");
      return;
    }
    if (!selectedTemplateId) return;
    generateMutation.mutate({
      templateId: selectedTemplateId,
      projectName: projectName.trim(),
      companyId: companyId || undefined,
      startDate: startDate || undefined,
    });
  };

  const toggleExpand = (id: string) => {
    setExpandedId((prev) => (prev === id ? null : id));
  };

  if (isLoading) {
    return (
      <div className="p-6 space-y-6" data-testid="templates-loading">
        <div>
          <Skeleton className="h-8 w-48 mb-2" />
          <Skeleton className="h-4 w-64" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-48 rounded-md" />
          ))}
        </div>
      </div>
    );
  }

  if (!templates || templates.length === 0) {
    return (
      <div className="p-6" data-testid="templates-empty">
        <h1 className="text-2xl font-bold tracking-tight" data-testid="text-page-title">Templates</h1>
        <p className="text-muted-foreground text-sm mt-1">Project templates for quick setup</p>
        <Card className="mt-6">
          <CardContent className="flex flex-col items-center justify-center py-12">
            <FileText className="h-12 w-12 text-muted-foreground/50 mb-4" />
            <p className="text-muted-foreground text-sm" data-testid="text-empty-message">
              No templates available yet
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const stagesByOrder = templateDetail
    ? [...templateDetail.stages].sort((a, b) => a.stageOrder - b.stageOrder)
    : [];

  const selectedTemplateName = templates.find((t) => t.id === selectedTemplateId)?.name || "Template";

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight" data-testid="text-page-title">Templates</h1>
        <p className="text-muted-foreground text-sm mt-1">Project templates for quick setup</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4" data-testid="templates-grid">
        {templates.map((template) => {
          const isExpanded = expandedId === template.id;
          const tmpl = template as any;

          return (
            <Card
              key={template.id}
              className={`hover-elevate ${isExpanded ? "md:col-span-2" : ""}`}
              data-testid={`card-template-${template.id}`}
            >
              <CardHeader className="flex flex-row items-start justify-between gap-2 space-y-0 pb-3">
                <div className="flex-1 min-w-0">
                  <CardTitle className="text-base" data-testid={`text-template-name-${template.id}`}>
                    {template.name}
                  </CardTitle>
                  {template.description && (
                    <p
                      className="text-muted-foreground text-sm mt-1 line-clamp-2"
                      data-testid={`text-template-description-${template.id}`}
                    >
                      {template.description}
                    </p>
                  )}
                </div>
                {tmpl.category && (
                  <Badge
                    variant="secondary"
                    className="no-default-hover-elevate no-default-active-elevate shrink-0"
                    data-testid={`badge-template-category-${template.id}`}
                  >
                    {tmpl.category}
                  </Badge>
                )}
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center gap-4 flex-wrap text-sm text-muted-foreground">
                  {tmpl.defaultBudget != null && (
                    <span className="flex items-center gap-1" data-testid={`text-template-budget-${template.id}`}>
                      <DollarSign className="h-3.5 w-3.5" />
                      {formatCurrency(tmpl.defaultBudget)}
                    </span>
                  )}
                  {tmpl.defaultHours != null && (
                    <span className="flex items-center gap-1" data-testid={`text-template-hours-${template.id}`}>
                      <Clock className="h-3.5 w-3.5" />
                      {tmpl.defaultHours}h
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-2 flex-wrap">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => toggleExpand(template.id)}
                    data-testid={`button-view-details-${template.id}`}
                  >
                    {isExpanded ? (
                      <>
                        <ChevronUp className="h-4 w-4 mr-1" />
                        Hide Details
                      </>
                    ) : (
                      <>
                        <ChevronDown className="h-4 w-4 mr-1" />
                        View Details
                      </>
                    )}
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => openGenerateDialog(template.id)}
                    data-testid={`button-use-template-${template.id}`}
                  >
                    <Rocket className="h-4 w-4 mr-1" />
                    Use Template
                  </Button>
                </div>

                {isExpanded && (
                  <div className="space-y-4 pt-2">
                    <Separator />

                    {detailLoading ? (
                      <div className="space-y-3" data-testid="template-detail-loading">
                        <Skeleton className="h-5 w-32" />
                        <Skeleton className="h-20 w-full" />
                        <Skeleton className="h-5 w-32" />
                        <Skeleton className="h-16 w-full" />
                      </div>
                    ) : templateDetail ? (
                      <>
                        {stagesByOrder.length > 0 && (
                          <div data-testid={`section-stages-${template.id}`}>
                            <h3 className="text-sm font-semibold flex items-center gap-1.5 mb-2">
                              <Flag className="h-4 w-4" />
                              Stages
                            </h3>
                            <div className="space-y-2">
                              {stagesByOrder.map((stage) => {
                                const stageGates = templateDetail.gates.filter(
                                  (g) => g.templateStageId === stage.id
                                );
                                return (
                                  <div
                                    key={stage.id}
                                    className="rounded-md border p-3"
                                    data-testid={`stage-${stage.id}`}
                                  >
                                    <div className="flex items-center gap-2 flex-wrap">
                                      <span className="text-sm font-medium" data-testid={`text-stage-name-${stage.id}`}>
                                        {stage.stageName.replace(/_/g, " ")}
                                      </span>
                                      <Badge
                                        variant="outline"
                                        className="no-default-hover-elevate no-default-active-elevate text-xs"
                                        data-testid={`badge-stage-order-${stage.id}`}
                                      >
                                        #{stage.stageOrder}
                                      </Badge>
                                    </div>
                                    {stageGates.length > 0 && (
                                      <div className="mt-2 space-y-1 pl-4">
                                        {stageGates.map((gate) => (
                                          <div
                                            key={gate.id}
                                            className="flex items-center gap-1.5 text-sm text-muted-foreground"
                                            data-testid={`gate-${gate.id}`}
                                          >
                                            <Lock className="h-3 w-3 shrink-0" />
                                            <span data-testid={`text-gate-title-${gate.id}`}>{gate.title}</span>
                                          </div>
                                        ))}
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        )}

                        {templateDetail.milestones.length > 0 && (
                          <div data-testid={`section-milestones-${template.id}`}>
                            <h3 className="text-sm font-semibold flex items-center gap-1.5 mb-2">
                              <CheckCircle2 className="h-4 w-4" />
                              Milestones
                            </h3>
                            <div className="space-y-1">
                              {templateDetail.milestones.map((ms) => (
                                <div
                                  key={ms.id}
                                  className="flex items-center justify-between gap-2 text-sm py-1"
                                  data-testid={`milestone-${ms.id}`}
                                >
                                  <span data-testid={`text-milestone-title-${ms.id}`}>{ms.title}</span>
                                  {ms.defaultDaysOffset > 0 && (
                                    <span className="text-muted-foreground text-xs" data-testid={`text-milestone-offset-${ms.id}`}>
                                      +{ms.defaultDaysOffset}d
                                    </span>
                                  )}
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {templateDetail.tasks.length > 0 && (
                          <div data-testid={`section-tasks-${template.id}`}>
                            <h3 className="text-sm font-semibold flex items-center gap-1.5 mb-2">
                              <ListChecks className="h-4 w-4" />
                              Tasks
                            </h3>
                            <div className="space-y-1">
                              {templateDetail.tasks.map((task) => (
                                <div
                                  key={task.id}
                                  className="flex items-center justify-between gap-2 text-sm py-1"
                                  data-testid={`task-${task.id}`}
                                >
                                  <span data-testid={`text-task-title-${task.id}`}>{task.title}</span>
                                  {task.priority && (
                                    <Badge
                                      variant="secondary"
                                      className={`no-default-hover-elevate no-default-active-elevate text-xs ${PRIORITY_COLORS[task.priority] || ""}`}
                                      data-testid={`badge-task-priority-${task.id}`}
                                    >
                                      {task.priority}
                                    </Badge>
                                  )}
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </>
                    ) : null}
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Dialog open={showGenerateDialog} onOpenChange={(open) => {
        if (!open) {
          setShowGenerateDialog(false);
          resetForm();
        }
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Project from "{selectedTemplateName}"</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="project-name">Project Name *</Label>
              <Input
                id="project-name"
                placeholder="e.g. Acme Corp Website Redesign"
                value={projectName}
                onChange={(e) => {
                  setProjectName(e.target.value);
                  if (e.target.value.trim()) setNameError("");
                }}
                data-testid="input-project-name"
              />
              {nameError && (
                <p className="text-sm text-destructive" data-testid="text-name-error">{nameError}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="company-select">Company (optional)</Label>
              <Select value={companyId} onValueChange={setCompanyId}>
                <SelectTrigger id="company-select" data-testid="select-company">
                  <SelectValue placeholder="Select a company" />
                </SelectTrigger>
                <SelectContent>
                  {companies?.map((company) => (
                    <SelectItem
                      key={company.id}
                      value={company.id}
                      data-testid={`option-company-${company.id}`}
                    >
                      {company.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="start-date">Start Date (optional)</Label>
              <Input
                id="start-date"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                data-testid="input-start-date"
              />
              <p className="text-xs text-muted-foreground">
                Milestone and task due dates will be calculated from this date. Defaults to today.
              </p>
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setShowGenerateDialog(false);
                resetForm();
              }}
              data-testid="button-cancel-generate"
            >
              Cancel
            </Button>
            <Button
              onClick={handleGenerate}
              disabled={generateMutation.isPending}
              data-testid="button-confirm-generate"
            >
              {generateMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                  Creating...
                </>
              ) : (
                <>
                  <Rocket className="h-4 w-4 mr-1" />
                  Create Project
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
