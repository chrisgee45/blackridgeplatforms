import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import {
  Building2, Plus, ExternalLink, MapPin, Briefcase,
  ChevronDown, ChevronUp, Users, FolderKanban, Globe, X, Edit, Trash2,
} from "lucide-react";
import type { Company, Project, ContactPerson } from "@shared/schema";

const SIZE_COLORS: Record<string, string> = {
  "1-10": "bg-muted text-muted-foreground",
  "10-50": "bg-blue-500/15 text-blue-400",
  "50-200": "bg-emerald-500/15 text-emerald-400",
  "200-500": "bg-amber-500/15 text-amber-400",
  "500+": "bg-violet-500/15 text-violet-400",
};

function formatDate(date: string | Date | null | undefined): string {
  if (!date) return "";
  return new Date(date).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

interface CompanyWithContacts extends Company {
  contacts?: ContactPerson[];
}

export default function CompaniesPage() {
  const { toast } = useToast();
  const [showForm, setShowForm] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editingCompanyId, setEditingCompanyId] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    name: "",
    industry: "",
    domain: "",
    notes: "",
    size: "",
  });

  const { data: companies, isLoading: companiesLoading } = useQuery<Company[]>({
    queryKey: ["/api/ops/companies"],
  });

  const { data: projects } = useQuery<Project[]>({
    queryKey: ["/api/ops/projects"],
  });

  const { data: expandedCompany, isLoading: detailLoading } = useQuery<CompanyWithContacts>({
    queryKey: ["/api/ops/companies", expandedId],
    enabled: !!expandedId,
  });

  const projectCountMap = new Map<string, number>();
  (projects ?? []).forEach((p) => {
    if (p.companyId) {
      projectCountMap.set(p.companyId, (projectCountMap.get(p.companyId) ?? 0) + 1);
    }
  });

  const companyProjects = expandedId
    ? (projects ?? []).filter((p) => p.companyId === expandedId)
    : [];

  const createMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      const body: Record<string, string | undefined> = { name: data.name };
      if (data.industry) body.industry = data.industry;
      if (data.domain) body.domain = data.domain;
      if (data.notes) body.notes = data.notes;
      if (data.size) body.size = data.size;
      const res = await apiRequest("POST", "/api/ops/companies", body);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ops/companies"] });
      setShowForm(false);
      setFormData({ name: "", industry: "", domain: "", notes: "", size: "" });
      toast({ title: "Company created", description: "New company has been added." });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (data: typeof formData & { id: string }) => {
      const body: Record<string, string | undefined> = { name: data.name };
      if (data.industry) body.industry = data.industry;
      if (data.domain) body.domain = data.domain;
      if (data.notes) body.notes = data.notes;
      if (data.size) body.size = data.size;
      const res = await apiRequest("PATCH", `/api/ops/companies/${data.id}`, body);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ops/companies"] });
      setShowForm(false);
      setEditingCompanyId(null);
      setFormData({ name: "", industry: "", domain: "", notes: "", size: "" });
      toast({ title: "Company updated", description: "Company has been updated." });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/ops/companies/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ops/companies"] });
      if (expandedId) setExpandedId(null);
      toast({ title: "Company deleted", description: "Company has been removed." });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!formData.name.trim()) {
      toast({ title: "Validation error", description: "Name is required.", variant: "destructive" });
      return;
    }
    if (editingCompanyId) {
      updateMutation.mutate({ ...formData, id: editingCompanyId });
    } else {
      createMutation.mutate(formData);
    }
  }

  function handleEdit(company: Company) {
    setEditingCompanyId(company.id);
    setFormData({
      name: company.name,
      industry: company.industry ?? "",
      domain: company.domain ?? "",
      notes: company.notes ?? "",
      size: company.size ?? "",
    });
    setShowForm(true);
  }

  function handleDelete(company: Company) {
    if (!window.confirm(`Are you sure you want to delete "${company.name}"?`)) return;
    deleteMutation.mutate(company.id);
  }

  function toggleExpand(id: string) {
    setExpandedId((prev) => (prev === id ? null : id));
  }

  return (
    <div className="p-3 sm:p-6 space-y-4 sm:space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight" data-testid="text-page-title">
            Companies
          </h1>
          <p className="text-muted-foreground text-sm mt-1">Manage your client companies</p>
        </div>
        <Button
          data-testid="button-add-company"
          onClick={() => {
            if (showForm) {
              setShowForm(false);
              setEditingCompanyId(null);
              setFormData({ name: "", industry: "", domain: "", notes: "", size: "" });
            } else {
              setEditingCompanyId(null);
              setFormData({ name: "", industry: "", domain: "", notes: "", size: "" });
              setShowForm(true);
            }
          }}
        >
          {showForm ? <X className="w-4 h-4 mr-2" /> : <Plus className="w-4 h-4 mr-2" />}
          {showForm ? "Cancel" : "Add Company"}
        </Button>
      </div>

      {showForm && (
        <Card data-testid="form-add-company">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Building2 className="w-5 h-5" />
              {editingCompanyId ? "Edit Company" : "New Company"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Name *</label>
                  <Input
                    data-testid="input-company-name"
                    placeholder="Company name"
                    value={formData.name}
                    onChange={(e) => setFormData((d) => ({ ...d, name: e.target.value }))}
                    required
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Industry</label>
                  <Input
                    data-testid="input-company-industry"
                    placeholder="e.g. Technology, Finance"
                    value={formData.industry}
                    onChange={(e) => setFormData((d) => ({ ...d, industry: e.target.value }))}
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Website</label>
                  <Input
                    data-testid="input-company-website"
                    placeholder="https://example.com"
                    value={formData.domain}
                    onChange={(e) => setFormData((d) => ({ ...d, domain: e.target.value }))}
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Company Size</label>
                  <Select
                    value={formData.size}
                    onValueChange={(v) => setFormData((d) => ({ ...d, size: v }))}
                  >
                    <SelectTrigger data-testid="select-company-size">
                      <SelectValue placeholder="Select size" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="1-10">1-10 employees</SelectItem>
                      <SelectItem value="10-50">10-50 employees</SelectItem>
                      <SelectItem value="50-200">50-200 employees</SelectItem>
                      <SelectItem value="200-500">200-500 employees</SelectItem>
                      <SelectItem value="500+">500+ employees</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Notes</label>
                <Textarea
                  data-testid="input-company-notes"
                  placeholder="Additional notes..."
                  value={formData.notes}
                  onChange={(e) => setFormData((d) => ({ ...d, notes: e.target.value }))}
                  rows={3}
                />
              </div>
              <div className="flex items-center gap-3 flex-wrap">
                <Button
                  type="submit"
                  data-testid="button-submit-company"
                  disabled={createMutation.isPending || updateMutation.isPending}
                >
                  {editingCompanyId
                    ? (updateMutation.isPending ? "Updating..." : "Update Company")
                    : (createMutation.isPending ? "Creating..." : "Create Company")}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  data-testid="button-cancel-company"
                  onClick={() => {
                    setShowForm(false);
                    setEditingCompanyId(null);
                    setFormData({ name: "", industry: "", domain: "", notes: "", size: "" });
                  }}
                >
                  Cancel
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {companiesLoading ? (
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
      ) : (companies ?? []).length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Building2 className="w-10 h-10 text-muted-foreground/40 mb-3" />
            <p className="text-muted-foreground text-sm" data-testid="text-no-companies">
              No companies yet. Add your first company to get started.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {(companies ?? []).map((company) => {
            const isExpanded = expandedId === company.id;
            const projectCount = projectCountMap.get(company.id) ?? 0;
            const companySize = company.size;

            return (
              <Card
                key={company.id}
                className={`cursor-pointer hover-elevate transition-colors ${isExpanded ? "col-span-1 md:col-span-2 lg:col-span-3" : ""}`}
                data-testid={`card-company-${company.id}`}
                onClick={() => toggleExpand(company.id)}
              >
                <CardContent className="pt-6 space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h3
                        className="font-semibold text-sm truncate"
                        data-testid={`text-company-name-${company.id}`}
                      >
                        {company.name}
                      </h3>
                      {company.industry && (
                        <p className="text-muted-foreground text-xs mt-0.5" data-testid={`text-company-industry-${company.id}`}>
                          {company.industry}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Button
                        size="icon"
                        variant="ghost"
                        data-testid={`button-edit-company-${company.id}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleEdit(company);
                        }}
                      >
                        <Edit className="w-4 h-4" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        data-testid={`button-delete-company-${company.id}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDelete(company);
                        }}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                      {companySize && (
                        <Badge
                          variant="secondary"
                          className={`no-default-hover-elevate no-default-active-elevate text-[10px] ${SIZE_COLORS[companySize] ?? "bg-muted text-muted-foreground"}`}
                          data-testid={`badge-size-${company.id}`}
                        >
                          <Users className="w-3 h-3 mr-1" />
                          {companySize}
                        </Badge>
                      )}
                      {isExpanded ? (
                        <ChevronUp className="w-4 h-4 text-muted-foreground" />
                      ) : (
                        <ChevronDown className="w-4 h-4 text-muted-foreground" />
                      )}
                    </div>
                  </div>

                  {company.domain && (
                    <div className="flex items-center gap-1.5 text-xs">
                      <Globe className="w-3 h-3 text-muted-foreground shrink-0" />
                      <a
                        href={company.domain.startsWith("http") ? company.domain : `https://${company.domain}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary hover:underline truncate"
                        onClick={(e) => e.stopPropagation()}
                        data-testid={`link-website-${company.id}`}
                      >
                        {company.domain}
                        <ExternalLink className="w-3 h-3 inline ml-1" />
                      </a>
                    </div>
                  )}

                  <div className="flex items-center gap-3 flex-wrap text-xs text-muted-foreground">
                    <span className="flex items-center gap-1" data-testid={`text-project-count-${company.id}`}>
                      <FolderKanban className="w-3 h-3" />
                      {projectCount} project{projectCount !== 1 ? "s" : ""}
                    </span>
                    {company.createdAt && (
                      <span data-testid={`text-created-${company.id}`}>
                        Created {formatDate(company.createdAt)}
                      </span>
                    )}
                  </div>

                  {isExpanded && (
                    <div className="pt-2" onClick={(e) => e.stopPropagation()}>
                      <Separator className="mb-4" />

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div>
                          <h4 className="text-sm font-semibold flex items-center gap-1.5 mb-3">
                            <Users className="w-4 h-4" />
                            Contacts
                          </h4>
                          {detailLoading ? (
                            <div className="space-y-2">
                              <Skeleton className="h-4 w-full" />
                              <Skeleton className="h-4 w-3/4" />
                            </div>
                          ) : (expandedCompany?.contacts ?? []).length === 0 ? (
                            <p className="text-muted-foreground text-xs" data-testid="text-no-contacts">
                              No contacts linked
                            </p>
                          ) : (
                            <div className="space-y-2">
                              {(expandedCompany?.contacts ?? []).map((contact) => (
                                <div
                                  key={contact.id}
                                  className="flex items-center justify-between gap-2 text-sm"
                                  data-testid={`contact-${contact.id}`}
                                >
                                  <div className="min-w-0">
                                    <span className="font-medium">{contact.name}</span>
                                    {contact.role && (
                                      <span className="text-muted-foreground text-xs ml-2">{contact.role}</span>
                                    )}
                                  </div>
                                  <div className="flex items-center gap-2 shrink-0">
                                    {contact.email && (
                                      <span className="text-xs text-muted-foreground" data-testid={`text-contact-email-${contact.id}`}>
                                        {contact.email}
                                      </span>
                                    )}
                                    {contact.isPrimary && (
                                      <Badge
                                        variant="secondary"
                                        className="no-default-hover-elevate no-default-active-elevate text-[10px] bg-primary/15 text-primary"
                                      >
                                        Primary
                                      </Badge>
                                    )}
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>

                        <div>
                          <h4 className="text-sm font-semibold flex items-center gap-1.5 mb-3">
                            <FolderKanban className="w-4 h-4" />
                            Projects
                          </h4>
                          {companyProjects.length === 0 ? (
                            <p className="text-muted-foreground text-xs" data-testid="text-no-linked-projects">
                              No projects linked
                            </p>
                          ) : (
                            <div className="space-y-2">
                              {companyProjects.map((project) => (
                                <div
                                  key={project.id}
                                  className="flex items-center justify-between gap-2 text-sm"
                                  data-testid={`project-${project.id}`}
                                >
                                  <span className="font-medium truncate">{project.name}</span>
                                  <Badge
                                    variant="secondary"
                                    className="no-default-hover-elevate no-default-active-elevate text-[10px] shrink-0"
                                    data-testid={`badge-project-stage-${project.id}`}
                                  >
                                    {project.stage.replace("_", " ")}
                                  </Badge>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>

                      {company.notes && (
                        <div className="mt-4">
                          <h4 className="text-sm font-semibold mb-1">Notes</h4>
                          <p className="text-muted-foreground text-xs" data-testid={`text-notes-${company.id}`}>
                            {company.notes}
                          </p>
                        </div>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
