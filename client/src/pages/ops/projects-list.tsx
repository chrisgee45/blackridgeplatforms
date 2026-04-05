import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  FolderKanban, Search, Plus, DollarSign, Clock,
  AlertTriangle, Building2, Loader2, UserPlus, FileText, Trash2,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { Project, Company, ProjectTemplate, ContactSubmission } from "@shared/schema";

const STAGE_COLORS: Record<string, string> = {
  discovery: "bg-blue-500/10 text-blue-400",
  proposal: "bg-purple-500/10 text-purple-400",
  contract: "bg-amber-500/10 text-amber-400",
  kickoff: "bg-emerald-500/10 text-emerald-400",
  in_progress: "bg-sky-500/10 text-sky-400",
  review: "bg-orange-500/10 text-orange-400",
  completed: "bg-green-500/10 text-green-400",
  archived: "bg-muted text-muted-foreground",
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

function formatTimeAgo(date: string | Date): string {
  const now = new Date();
  const then = new Date(date);
  const diffMs = now.getTime() - then.getTime();
  const diffMinutes = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  const diffWeeks = Math.floor(diffDays / 7);
  const diffMonths = Math.floor(diffDays / 30);

  if (diffMinutes < 60) return `${diffMinutes}m`;
  if (diffHours < 24) return `${diffHours}h`;
  if (diffDays < 7) return `${diffDays} day${diffDays !== 1 ? "s" : ""}`;
  if (diffWeeks < 5) return `${diffWeeks} week${diffWeeks !== 1 ? "s" : ""}`;
  return `${diffMonths} month${diffMonths !== 1 ? "s" : ""}`;
}

interface DashboardStats {
  totalProjects: number;
  activeProjects: number;
  totalPipelineValue: number;
  totalRevenue: number;
  stalledProjects: number;
}

interface LeadSummary {
  id: string;
  name: string;
  email: string;
  company: string | null;
  projectType: string | null;
  budget: string | null;
  status: string;
  projectedValue: number | null;
}

function NewProjectDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [mode, setMode] = useState<"blank" | "lead">("blank");
  const [projectName, setProjectName] = useState("");
  const [companyId, setCompanyId] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [contractValue, setContractValue] = useState("");
  const [description, setDescription] = useState("");
  const [selectedLeadId, setSelectedLeadId] = useState("");
  const [leadSearch, setLeadSearch] = useState("");

  const { data: companies } = useQuery<Company[]>({
    queryKey: ["/api/ops/companies"],
  });

  const { data: templates } = useQuery<ProjectTemplate[]>({
    queryKey: ["/api/ops/templates"],
  });

  const { data: leads } = useQuery<LeadSummary[]>({
    queryKey: ["/api/ops/leads"],
    enabled: open,
  });

  const selectedLead = leads?.find((l) => l.id === selectedLeadId);

  const filteredLeads = (leads ?? []).filter((l) => {
    if (!leadSearch) return true;
    const q = leadSearch.toLowerCase();
    return (
      l.name.toLowerCase().includes(q) ||
      l.email.toLowerCase().includes(q) ||
      (l.company?.toLowerCase().includes(q) ?? false)
    );
  });

  const createMutation = useMutation({
    mutationFn: async (data: any) => {
      if (mode === "lead" && selectedLeadId) {
        const res = await apiRequest("POST", "/api/ops/convert-lead", {
          leadId: selectedLeadId,
          projectName: data.name || undefined,
          templateId: data.templateId || undefined,
          companyId: data.companyId || undefined,
        });
        return res.json() as Promise<Project>;
      }
      const res = await apiRequest("POST", "/api/ops/projects", data);
      return res.json() as Promise<Project>;
    },
    onSuccess: (project) => {
      queryClient.invalidateQueries({ queryKey: ["/api/ops/projects"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ops/dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ops/companies"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ops/contacts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/leads"] });
      toast({ title: "Project created" });
      onOpenChange(false);
      resetForm();
      navigate(`/admin/ops/projects/${project.id}`);
    },
    onError: (err: Error) => {
      toast({ title: "Failed to create project", description: err.message, variant: "destructive" });
    },
  });

  const resetForm = () => {
    setMode("blank");
    setProjectName("");
    setCompanyId("");
    setTemplateId("");
    setContractValue("");
    setDescription("");
    setSelectedLeadId("");
    setLeadSearch("");
  };

  const cleanId = (val: string) => (val && val !== "none" ? val : undefined);

  const handleSubmit = () => {
    if (mode === "lead") {
      if (!selectedLeadId) {
        toast({ title: "Please select a lead", variant: "destructive" });
        return;
      }
      createMutation.mutate({
        name: projectName || undefined,
        templateId: cleanId(templateId),
        companyId: cleanId(companyId),
      });
    } else {
      if (!projectName.trim()) {
        toast({ title: "Project name is required", variant: "destructive" });
        return;
      }
      createMutation.mutate({
        name: projectName.trim(),
        companyId: cleanId(companyId) || null,
        templateId: cleanId(templateId) || null,
        contractValue: contractValue ? parseInt(contractValue) : null,
        description: description || null,
        stage: "discovery",
      });
    }
  };

  const selectLead = (lead: LeadSummary) => {
    setSelectedLeadId(lead.id);
    setProjectName(`${lead.company || lead.name} - Website Project`);
    setLeadSearch("");
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) resetForm(); onOpenChange(v); }}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto bg-card border-border/50">
        <DialogHeader>
          <DialogTitle data-testid="text-new-project-title">New Project</DialogTitle>
        </DialogHeader>

        <div className="flex gap-2 mt-2">
          <Button
            variant={mode === "blank" ? "default" : "outline"}
            size="sm"
            onClick={() => { setMode("blank"); setSelectedLeadId(""); }}
            data-testid="button-mode-blank"
          >
            <Plus className="w-4 h-4 mr-1" />
            Blank Project
          </Button>
          <Button
            variant={mode === "lead" ? "default" : "outline"}
            size="sm"
            onClick={() => setMode("lead")}
            data-testid="button-mode-lead"
          >
            <UserPlus className="w-4 h-4 mr-1" />
            From CRM Lead
          </Button>
        </div>

        <div className="space-y-4 mt-4">
          {mode === "lead" && (
            <div className="space-y-3">
              <Label>Select Lead</Label>
              {selectedLead ? (
                <Card className="border-primary/30">
                  <CardContent className="p-3">
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <p className="font-medium text-sm" data-testid="text-selected-lead-name">
                          {selectedLead.name}
                        </p>
                        <p className="text-xs text-muted-foreground">{selectedLead.email}</p>
                        {selectedLead.company && (
                          <p className="text-xs text-muted-foreground">{selectedLead.company}</p>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        {selectedLead.projectedValue && (
                          <Badge variant="secondary" className="text-[10px] no-default-hover-elevate no-default-active-elevate">
                            {formatCurrency(selectedLead.projectedValue)}
                          </Badge>
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setSelectedLeadId("")}
                          data-testid="button-clear-lead"
                        >
                          Change
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ) : (
                <div className="space-y-2">
                  <Input
                    placeholder="Search leads by name, email, or company..."
                    value={leadSearch}
                    onChange={(e) => setLeadSearch(e.target.value)}
                    data-testid="input-lead-search"
                  />
                  <div className="max-h-40 overflow-y-auto border border-border/30 rounded-md">
                    {filteredLeads.length === 0 ? (
                      <p className="text-sm text-muted-foreground p-3 text-center">
                        No leads found
                      </p>
                    ) : (
                      filteredLeads.map((lead) => (
                        <div
                          key={lead.id}
                          className="p-2 hover-elevate cursor-pointer flex items-center justify-between gap-2 border-b border-border/20 last:border-0"
                          onClick={() => selectLead(lead)}
                          data-testid={`lead-option-${lead.id}`}
                        >
                          <div className="min-w-0">
                            <p className="text-sm font-medium truncate">{lead.name}</p>
                            <p className="text-xs text-muted-foreground truncate">
                              {lead.company ? `${lead.company} — ` : ""}{lead.email}
                            </p>
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            <Badge variant="secondary" className="text-[10px] no-default-hover-elevate no-default-active-elevate">
                              {lead.status}
                            </Badge>
                            {lead.budget && (
                              <Badge variant="secondary" className="text-[10px] no-default-hover-elevate no-default-active-elevate">
                                {lead.budget}
                              </Badge>
                            )}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}
              <Separator />
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="projectName">Project Name</Label>
            <Input
              id="projectName"
              placeholder={mode === "lead" ? "Auto-generated from lead (optional override)" : "Enter project name"}
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
              data-testid="input-project-name"
            />
          </div>

          <div className="space-y-2">
            <Label>Company</Label>
            <Select value={companyId} onValueChange={setCompanyId}>
              <SelectTrigger data-testid="select-company">
                <SelectValue placeholder={mode === "lead" ? "Auto-created from lead" : "Select company (optional)"} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">None</SelectItem>
                {(companies ?? []).map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Template</Label>
            <Select value={templateId} onValueChange={setTemplateId}>
              <SelectTrigger data-testid="select-template">
                <SelectValue placeholder="No template (blank project)" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No Template</SelectItem>
                {(templates ?? []).map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    <div className="flex items-center gap-2">
                      <FileText className="w-3 h-3" />
                      {t.name}
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {mode === "blank" && (
            <>
              <div className="space-y-2">
                <Label htmlFor="contractValue">Contract Value ($)</Label>
                <Input
                  id="contractValue"
                  type="number"
                  placeholder="0"
                  value={contractValue}
                  onChange={(e) => setContractValue(e.target.value)}
                  data-testid="input-contract-value"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="description">Description</Label>
                <Textarea
                  id="description"
                  placeholder="Project description (optional)"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="resize-none"
                  rows={3}
                  data-testid="input-description"
                />
              </div>
            </>
          )}
        </div>

        <DialogFooter className="mt-4 gap-2">
          <Button
            variant="outline"
            onClick={() => { resetForm(); onOpenChange(false); }}
            data-testid="button-cancel-project"
          >
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={createMutation.isPending || (mode === "blank" && !projectName.trim()) || (mode === "lead" && !selectedLeadId)}
            data-testid="button-submit-project"
          >
            {createMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            {mode === "lead" ? "Convert & Create" : "Create Project"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function ProjectsList() {
  const [, navigate] = useLocation();
  const [search, setSearch] = useState("");
  const [stageFilter, setStageFilter] = useState("all");
  const [showNewProject, setShowNewProject] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Project | null>(null);
  const [deleteReason, setDeleteReason] = useState("");

  const { data: dashboard, isLoading: dashLoading } = useQuery<DashboardStats>({
    queryKey: ["/api/ops/dashboard"],
  });

  const { data: projects, isLoading: projLoading } = useQuery<Project[]>({
    queryKey: ["/api/ops/projects"],
  });

  const { data: companies } = useQuery<Company[]>({
    queryKey: ["/api/ops/companies"],
  });

  const companyMap = new Map(companies?.map((c) => [c.id, c.name]) ?? []);
  const { toast } = useToast();

  const deleteProjectMutation = useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason: string }) => {
      await apiRequest("DELETE", `/api/ops/projects/${id}`, { reason });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ops/projects"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ops/dashboard"] });
      toast({ title: "Project deleted" });
      setDeleteTarget(null);
      setDeleteReason("");
    },
    onError: () => {
      toast({ title: "Failed to delete project", variant: "destructive" });
    },
  });

  const filtered = (projects ?? []).filter((p) => {
    if (search && !p.name.toLowerCase().includes(search.toLowerCase())) return false;
    if (stageFilter !== "all" && p.stage !== stageFilter) return false;
    return true;
  });

  return (
    <div className="p-3 sm:p-6 space-y-4 sm:space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight" data-testid="text-page-title">Projects</h1>
          <p className="text-muted-foreground text-sm mt-1">Manage your active projects</p>
        </div>
        <Button onClick={() => setShowNewProject(true)} data-testid="button-new-project">
          <Plus className="w-4 h-4 mr-2" />
          New Project
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <span className="text-sm font-medium text-muted-foreground">Active Projects</span>
            <FolderKanban className="w-4 h-4 text-primary" />
          </CardHeader>
          <CardContent>
            {dashLoading ? (
              <Skeleton className="h-8 w-16" />
            ) : (
              <div className="text-2xl font-bold" data-testid="stat-active-projects">
                {dashboard?.activeProjects ?? 0}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <span className="text-sm font-medium text-muted-foreground">Pipeline Value</span>
            <DollarSign className="w-4 h-4 text-emerald-500" />
          </CardHeader>
          <CardContent>
            {dashLoading ? (
              <Skeleton className="h-8 w-20" />
            ) : (
              <div className="text-2xl font-bold" data-testid="stat-pipeline-value">
                {formatCurrencyCompact(dashboard?.totalPipelineValue ?? 0)}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <span className="text-sm font-medium text-muted-foreground">Revenue Earned</span>
            <DollarSign className="w-4 h-4 text-primary" />
          </CardHeader>
          <CardContent>
            {dashLoading ? (
              <Skeleton className="h-8 w-20" />
            ) : (
              <div className="text-2xl font-bold" data-testid="stat-revenue-earned">
                {formatCurrencyCompact(dashboard?.totalRevenue ?? 0)}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <span className="text-sm font-medium text-muted-foreground">Stalled Projects</span>
            <AlertTriangle className="w-4 h-4 text-destructive" />
          </CardHeader>
          <CardContent>
            {dashLoading ? (
              <Skeleton className="h-8 w-16" />
            ) : (
              <div className="text-2xl font-bold" data-testid="stat-stalled-projects">
                {dashboard?.stalledProjects ?? 0}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            data-testid="input-search-projects"
            placeholder="Search projects..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={stageFilter} onValueChange={setStageFilter}>
          <SelectTrigger className="w-[160px]" data-testid="select-stage-filter">
            <SelectValue placeholder="Filter by stage" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Stages</SelectItem>
            {Object.entries(STAGE_LABELS).map(([key, label]) => (
              <SelectItem key={key} value={key}>{label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {projLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <Card key={i}>
              <CardContent className="pt-6 space-y-3">
                <Skeleton className="h-5 w-3/4" />
                <Skeleton className="h-4 w-1/2" />
                <div className="flex items-center gap-2">
                  <Skeleton className="h-5 w-20" />
                  <Skeleton className="h-5 w-16" />
                </div>
                <Skeleton className="h-4 w-1/3" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <FolderKanban className="w-10 h-10 text-muted-foreground/40 mb-3" />
            <p className="text-muted-foreground text-sm" data-testid="text-no-projects">
              {search || stageFilter !== "all" ? "No projects match your filters" : "No projects yet"}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((project) => (
            <Card
              key={project.id}
              className="cursor-pointer hover-elevate transition-colors"
              onClick={() => navigate(`/admin/ops/projects/${project.id}`)}
              data-testid={`card-project-${project.id}`}
            >
              <CardContent className="pt-6 space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h3
                      className="font-semibold text-sm truncate"
                      data-testid={`text-project-name-${project.id}`}
                    >
                      {project.name}
                    </h3>
                    {project.companyId && companyMap.has(project.companyId) && (
                      <div className="flex items-center gap-1.5 mt-1 text-muted-foreground text-xs">
                        <Building2 className="w-3 h-3 shrink-0" />
                        <span className="truncate" data-testid={`text-company-${project.id}`}>
                          {companyMap.get(project.companyId)}
                        </span>
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Badge
                      variant="secondary"
                      className={`no-default-hover-elevate no-default-active-elevate text-[10px] ${STAGE_COLORS[project.stage] ?? ""}`}
                      data-testid={`badge-stage-${project.id}`}
                    >
                      {STAGE_LABELS[project.stage] ?? project.stage}
                    </Badge>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-muted-foreground"
                      data-testid={`button-delete-project-${project.id}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        setDeleteTarget(project);
                        setDeleteReason("");
                      }}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>

                <div className="flex items-center gap-3 flex-wrap">
                  {project.contractValue != null && project.contractValue > 0 && (
                    <span className="text-sm font-medium" data-testid={`text-value-${project.id}`}>
                      {formatCurrency(project.contractValue)}
                    </span>
                  )}
                  {project.waitingOnClient && (
                    <Badge
                      variant="secondary"
                      className="bg-red-500/10 text-red-400 no-default-hover-elevate no-default-active-elevate text-[10px]"
                      data-testid={`badge-blocked-${project.id}`}
                    >
                      Blocked
                    </Badge>
                  )}
                </div>

                {project.stageChangedAt && (
                  <div className="flex items-center gap-1.5 text-muted-foreground text-xs">
                    <Clock className="w-3 h-3 shrink-0" />
                    <span data-testid={`text-time-in-stage-${project.id}`}>
                      {formatTimeAgo(project.stageChangedAt)} in stage
                    </span>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <NewProjectDialog open={showNewProject} onOpenChange={setShowNewProject} />

      <Dialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) { setDeleteTarget(null); setDeleteReason(""); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Project</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Are you sure you want to delete <span className="font-semibold text-foreground">{deleteTarget?.name}</span>? This cannot be undone.
          </p>
          <div className="space-y-2">
            <Label htmlFor="delete-reason">Reason for deletion <span className="text-red-400">*</span></Label>
            <Textarea
              id="delete-reason"
              data-testid="input-delete-reason"
              placeholder="e.g. Client cancelled, duplicate project, created in error..."
              value={deleteReason}
              onChange={(e) => setDeleteReason(e.target.value)}
              rows={3}
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => { setDeleteTarget(null); setDeleteReason(""); }}
              data-testid="button-cancel-delete"
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={!deleteReason.trim() || deleteProjectMutation.isPending}
              data-testid="button-confirm-delete"
              onClick={() => {
                if (deleteTarget) {
                  deleteProjectMutation.mutate({ id: deleteTarget.id, reason: deleteReason.trim() });
                }
              }}
            >
              {deleteProjectMutation.isPending ? (
                <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Deleting...</>
              ) : "Delete Project"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
