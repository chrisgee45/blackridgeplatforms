import { useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { isUnauthorizedError } from "@/lib/auth-utils";
import { MfaSettingsDialog } from "@/components/MfaSettings";
import type { ContactSubmission, UpdateLead, CreateLead, ProjectTemplate, Project, LeadActivity } from "@shared/schema";
import { createLeadSchema } from "@shared/schema";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Mountain,
  LogOut,
  Search,
  Filter,
  Users,
  TrendingUp,
  DollarSign,
  Mail,
  Building2,
  Calendar,
  ChevronRight,
  Trash2,
  Loader2,
  Inbox,
  Lock,
  Eye,
  EyeOff,
  Rocket,
  FileText,
  Plus,
  Download,
  AlertTriangle,
  Clock,
  Target,
  CalendarDays,
  Percent,
  Zap,
  Pencil,
  Save,
  X,
  Flame,
  Phone,
  MessageSquare,
  Activity,
  Shield,
} from "lucide-react";

const STATUS_LABELS: Record<string, string> = {
  new: "New",
  contacted: "Contacted",
  qualified: "Qualified",
  proposal: "Proposal",
  negotiation: "Negotiation",
  won: "Won",
  lost: "Lost",
};

const STATUS_COLORS: Record<string, string> = {
  new: "bg-blue-500/15 text-blue-400 border-blue-500/20",
  contacted: "bg-amber-500/15 text-amber-400 border-amber-500/20",
  qualified: "bg-cyan-500/15 text-cyan-400 border-cyan-500/20",
  proposal: "bg-purple-500/15 text-purple-400 border-purple-500/20",
  negotiation: "bg-orange-500/15 text-orange-400 border-orange-500/20",
  won: "bg-green-500/15 text-green-400 border-green-500/20",
  lost: "bg-red-500/15 text-red-400 border-red-500/20",
};

const PRIORITY_COLORS: Record<string, string> = {
  low: "bg-muted text-muted-foreground",
  medium: "bg-blue-500/15 text-blue-400 border-blue-500/20",
  high: "bg-amber-500/15 text-amber-400 border-amber-500/20",
  urgent: "bg-red-500/15 text-red-400 border-red-500/20",
};

const LEAD_SOURCES = ["Referral", "Cold DM", "Facebook", "SEO", "Word of Mouth", "Website Form", "Other"];

const BUDGET_OPTIONS = ["1k-2.5k", "2.5k-5k", "5k-15k", "15k-30k", "30k-75k", "75k-150k", "150k+"];

const PROJECT_TYPES = ["web-design", "web-development", "ecommerce", "branding", "seo", "consulting", "other"];

function formatDate(date: string | Date | null) {
  if (!date) return "N/A";
  return new Date(date).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatTime(date: string | Date | null) {
  if (!date) return "";
  return new Date(date).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatProjectType(type: string | null) {
  if (!type) return "Not specified";
  return type.split("-").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

function formatBudget(budget: string | null) {
  if (!budget) return "Not specified";
  return budget.replace("k", "K").replace("-", " - $").replace(/^/, "$").replace("$$", "$");
}

function formatCurrency(value: number | null | undefined) {
  if (value == null) return "-";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value);
}

function isStale(lead: ContactSubmission) {
  if (lead.status !== "new") return false;
  if (lead.lastContactedAt) return false;
  if (!lead.createdAt) return false;
  const hoursSince = (Date.now() - new Date(lead.createdAt).getTime()) / (1000 * 60 * 60);
  return hoursSince > 24;
}

function isFollowUpOverdue(lead: ContactSubmission) {
  if (!lead.followUpDate) return false;
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const fud = new Date(lead.followUpDate);
  fud.setHours(0, 0, 0, 0);
  return fud < now;
}

function isFollowUpToday(lead: ContactSubmission) {
  if (!lead.followUpDate) return false;
  const now = new Date();
  const fud = new Date(lead.followUpDate);
  return now.toDateString() === fud.toDateString();
}

function isAtRisk(lead: ContactSubmission) {
  if (lead.status !== "proposal" && lead.status !== "negotiation") return false;
  if (!lead.updatedAt) return false;
  const daysSince = (Date.now() - new Date(lead.updatedAt).getTime()) / (1000 * 60 * 60 * 24);
  return daysSince > 7;
}

function LoginForm() {
  const { login, loginData, loginError, isLoggingIn, resetLogin } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [totpCode, setTotpCode] = useState("");
  const [mfaStep, setMfaStep] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const result = await login({ username, password, totpCode: mfaStep ? totpCode : undefined });
      if (result?.mfaRequired) {
        setMfaStep(true);
        resetLogin();
      }
    } catch {}
  };

  const handleBackToLogin = () => {
    setMfaStep(false);
    setTotpCode("");
    setPassword("");
    resetLogin();
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4">
      <Card className="w-full max-w-sm border-border/50 bg-card/80">
        <CardHeader className="text-center pb-4">
          <div className="flex items-center justify-center gap-2 mb-4">
            <Mountain className="h-6 w-6 text-primary" />
            <span className="font-bold text-lg tracking-tight">
              BlackRidge<span className="text-primary"> CRM</span>
            </span>
          </div>
          <CardTitle className="text-lg">{mfaStep ? "Two-Factor Authentication" : "Admin Login"}</CardTitle>
          <p className="text-sm text-muted-foreground mt-1">
            {mfaStep ? "Enter the code from your authenticator app" : "Sign in to manage your leads"}
          </p>
        </CardHeader>
        <CardContent>
          {mfaStep ? (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="text-xs text-muted-foreground mb-1.5 block">Verification Code</label>
                <Input
                  value={totpCode}
                  onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  placeholder="000000"
                  autoComplete="one-time-code"
                  inputMode="numeric"
                  maxLength={6}
                  className="text-center text-2xl tracking-[0.5em] font-mono"
                  autoFocus
                  required
                  data-testid="input-login-totp"
                />
              </div>
              {loginError && (
                <p className="text-sm text-destructive" data-testid="text-login-error">
                  {loginError.message}
                </p>
              )}
              <Button
                type="submit"
                className="w-full"
                disabled={isLoggingIn || totpCode.length !== 6}
                data-testid="button-verify-totp"
              >
                {isLoggingIn ? (
                  <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Verifying...</>
                ) : (
                  <><Lock className="h-4 w-4 mr-2" />Verify</>
                )}
              </Button>
              <Button
                type="button"
                variant="ghost"
                className="w-full text-sm"
                onClick={handleBackToLogin}
                data-testid="button-back-to-login"
              >
                Back to login
              </Button>
            </form>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="text-xs text-muted-foreground mb-1.5 block">Username</label>
                <Input
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="Enter username"
                  autoComplete="username"
                  required
                  data-testid="input-login-username"
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1.5 block">Password</label>
                <div className="relative">
                  <Input
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Enter password"
                    autoComplete="current-password"
                    required
                    data-testid="input-login-password"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="absolute right-0 top-0"
                    onClick={() => setShowPassword(!showPassword)}
                    data-testid="button-toggle-password"
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </Button>
                </div>
              </div>
              {loginError && (
                <p className="text-sm text-destructive" data-testid="text-login-error">
                  {loginError.message}
                </p>
              )}
              <Button
                type="submit"
                className="w-full"
                disabled={isLoggingIn || !username || !password}
                data-testid="button-login-submit"
              >
                {isLoggingIn ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Signing in...
                  </>
                ) : (
                  <>
                    <Lock className="h-4 w-4 mr-2" />
                    Sign In
                  </>
                )}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function HotLeadsWidget({ onOpenDetail, leads }: { onOpenDetail: (lead: ContactSubmission) => void; leads: ContactSubmission[] }) {
  const { data: hotLeads = [], isLoading } = useQuery<any[]>({
    queryKey: ["/api/leads/hot"],
    queryFn: async () => {
      const res = await fetch("/api/leads/hot", { credentials: "include" });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });

  if (isLoading || hotLeads.length === 0) return null;

  return (
    <Card className="border-border/50 bg-card/50 mb-8" data-testid="card-hot-leads">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <Flame className="h-4 w-4 text-orange-500" />
          Hot Leads
        </CardTitle>
      </CardHeader>
      <CardContent className="p-4 pt-0">
        <div className="space-y-2">
          {hotLeads.map((hl: any) => {
            const matchingLead = leads.find(l => l.id === hl.id);
            return (
              <div
                key={hl.id}
                className="flex items-center justify-between gap-3 p-3 rounded-lg border border-border/30 hover-elevate cursor-pointer"
                onClick={() => matchingLead && onOpenDetail(matchingLead)}
                data-testid={`hot-lead-${hl.id}`}
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{hl.name}</p>
                  <p className="text-xs text-muted-foreground truncate">{hl.company || hl.email}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {hl.ai_score && (
                    <Badge variant="outline" className="text-[10px] bg-purple-500/10 text-purple-500 border-purple-500/20">
                      AI: {hl.ai_score}
                    </Badge>
                  )}
                  {hl.close_probability && (
                    <Badge variant="outline" className="text-[10px] bg-green-500/10 text-green-500 border-green-500/20">
                      {hl.close_probability}%
                    </Badge>
                  )}
                  {hl.projected_value && (
                    <span className="text-xs font-medium text-primary">
                      {formatCurrency(hl.projected_value)}
                    </span>
                  )}
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

function AddLeadDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { toast } = useToast();
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    company: "",
    projectType: "",
    budget: "",
    message: "",
    projectedValue: "",
    closeProbability: "",
    leadSource: "",
    followUpDate: "",
    status: "new",
    priority: "medium",
  });

  const createMutation = useMutation({
    mutationFn: async (data: CreateLead) => {
      const res = await apiRequest("POST", "/api/leads", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/leads"] });
      toast({ title: "Lead created" });
      onOpenChange(false);
      setFormData({
        name: "", email: "", company: "", projectType: "", budget: "",
        message: "", projectedValue: "", closeProbability: "", leadSource: "",
        followUpDate: "", status: "new", priority: "medium",
      });
    },
    onError: (error: Error) => {
      if (isUnauthorizedError(error)) {
        toast({ title: "Session expired", description: "Please log in again.", variant: "destructive" });
        return;
      }
      toast({ title: "Failed to create lead", description: error.message, variant: "destructive" });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const payload: any = {
      name: formData.name,
      email: formData.email,
      message: formData.message,
      status: formData.status,
      priority: formData.priority,
    };
    if (formData.company) payload.company = formData.company;
    if (formData.projectType) payload.projectType = formData.projectType;
    if (formData.budget) payload.budget = formData.budget;
    if (formData.projectedValue) payload.projectedValue = parseInt(formData.projectedValue, 10);
    if (formData.closeProbability) payload.closeProbability = parseInt(formData.closeProbability, 10);
    if (formData.leadSource) payload.leadSource = formData.leadSource;
    if (formData.followUpDate) payload.followUpDate = formData.followUpDate;

    const result = createLeadSchema.safeParse(payload);
    if (!result.success) {
      toast({ title: "Validation error", description: result.error.issues.map(i => i.message).join(", "), variant: "destructive" });
      return;
    }
    createMutation.mutate(result.data);
  };

  const update = (field: string, value: string) => setFormData(prev => ({ ...prev, [field]: value }));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto bg-card border-border/50">
        <DialogHeader>
          <DialogTitle>Add New Lead</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 mt-4">
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-muted-foreground mb-1.5 block">Name *</label>
              <Input value={formData.name} onChange={e => update("name", e.target.value)} required data-testid="input-add-lead-name" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1.5 block">Email *</label>
              <Input type="email" value={formData.email} onChange={e => update("email", e.target.value)} required data-testid="input-add-lead-email" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1.5 block">Company</label>
              <Input value={formData.company} onChange={e => update("company", e.target.value)} data-testid="input-add-lead-company" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1.5 block">Project Type</label>
              <Select value={formData.projectType} onValueChange={v => update("projectType", v)}>
                <SelectTrigger data-testid="select-add-lead-project-type"><SelectValue placeholder="Select type" /></SelectTrigger>
                <SelectContent>
                  {PROJECT_TYPES.map(t => <SelectItem key={t} value={t}>{formatProjectType(t)}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1.5 block">Budget</label>
              <Select value={formData.budget} onValueChange={v => update("budget", v)}>
                <SelectTrigger data-testid="select-add-lead-budget"><SelectValue placeholder="Select budget" /></SelectTrigger>
                <SelectContent>
                  {BUDGET_OPTIONS.map(b => <SelectItem key={b} value={b}>{formatBudget(b)}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1.5 block">Lead Source</label>
              <Select value={formData.leadSource} onValueChange={v => update("leadSource", v)}>
                <SelectTrigger data-testid="select-add-lead-source"><SelectValue placeholder="Select source" /></SelectTrigger>
                <SelectContent>
                  {LEAD_SOURCES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1.5 block">Projected Value ($)</label>
              <Input type="number" min="0" value={formData.projectedValue} onChange={e => update("projectedValue", e.target.value)} data-testid="input-add-lead-projected-value" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1.5 block">Close Probability (%)</label>
              <Input type="number" min="0" max="100" value={formData.closeProbability} onChange={e => update("closeProbability", e.target.value)} data-testid="input-add-lead-close-probability" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1.5 block">Follow-Up Date</label>
              <Input type="date" value={formData.followUpDate} onChange={e => update("followUpDate", e.target.value)} data-testid="input-add-lead-follow-up-date" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1.5 block">Status</label>
              <Select value={formData.status} onValueChange={v => update("status", v)}>
                <SelectTrigger data-testid="select-add-lead-status"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(STATUS_LABELS).map(([k, l]) => <SelectItem key={k} value={k}>{l}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1.5 block">Priority</label>
              <Select value={formData.priority} onValueChange={v => update("priority", v)}>
                <SelectTrigger data-testid="select-add-lead-priority"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">Low</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                  <SelectItem value="urgent">Urgent</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1.5 block">Message / Notes *</label>
            <Textarea value={formData.message} onChange={e => update("message", e.target.value)} required rows={3} data-testid="input-add-lead-message" />
          </div>
          <div className="flex justify-end gap-3">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} data-testid="button-add-lead-cancel">Cancel</Button>
            <Button type="submit" disabled={createMutation.isPending} data-testid="button-add-lead-submit">
              {createMutation.isPending ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Creating...</> : <><Plus className="h-4 w-4 mr-2" />Create Lead</>}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function LeadDetailDialog({
  lead,
  open,
  onOpenChange,
  onLeadUpdate,
}: {
  lead: ContactSubmission | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onLeadUpdate: (lead: ContactSubmission) => void;
}) {
  if (!lead) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <LeadDetailContent
        key={lead.id}
        lead={lead}
        onOpenChange={onOpenChange}
        onLeadUpdate={onLeadUpdate}
      />
    </Dialog>
  );
}

function LeadDetailContent({
  lead,
  onOpenChange,
  onLeadUpdate,
}: {
  lead: ContactSubmission;
  onOpenChange: (open: boolean) => void;
  onLeadUpdate: (lead: ContactSubmission) => void;
}) {
  const { toast } = useToast();
  const [editNotes, setEditNotes] = useState(lead.notes ?? "");
  const [isEditing, setIsEditing] = useState(false);
  const [editForm, setEditForm] = useState({
    name: lead.name,
    email: lead.email,
    company: lead.company || "",
    projectType: lead.projectType || "",
    budget: lead.budget || "",
    message: lead.message,
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: UpdateLead }) => {
      const res = await apiRequest("PATCH", `/api/leads/${id}`, data);
      return res.json();
    },
    onSuccess: (updated) => {
      queryClient.invalidateQueries({ queryKey: ["/api/leads"] });
      onLeadUpdate(updated);
    },
    onError: (error: Error) => {
      if (isUnauthorizedError(error)) {
        toast({ title: "Session expired", description: "Please log in again.", variant: "destructive" });
        return;
      }
      toast({ title: "Update failed", variant: "destructive" });
    },
  });

  const notesMutation = useMutation({
    mutationFn: async ({ id, notes }: { id: string; notes: string }) => {
      const res = await apiRequest("PATCH", `/api/leads/${id}`, { notes });
      return res.json();
    },
    onSuccess: (updated) => {
      queryClient.invalidateQueries({ queryKey: ["/api/leads"] });
      onLeadUpdate(updated);
      setEditNotes(updated.notes ?? "");
      toast({ title: "Notes saved" });
    },
    onError: (error: Error) => {
      if (isUnauthorizedError(error)) {
        toast({ title: "Session expired", description: "Please log in again.", variant: "destructive" });
        return;
      }
      toast({ title: "Save failed", description: error.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/leads/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/leads"] });
      onOpenChange(false);
      toast({ title: "Lead deleted" });
    },
    onError: (error: Error) => {
      if (isUnauthorizedError(error)) {
        toast({ title: "Session expired", description: "Please log in again.", variant: "destructive" });
        return;
      }
      toast({ title: "Delete failed", variant: "destructive" });
    },
  });

  const weightedValue = lead.projectedValue != null && lead.closeProbability != null
    ? Math.round(lead.projectedValue * lead.closeProbability / 100)
    : null;

  return (
    <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto bg-card border-border/50">
      <DialogHeader>
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <DialogTitle className="text-xl" data-testid="text-lead-detail-name">
            {isEditing ? (
              <Input
                value={editForm.name}
                onChange={e => setEditForm(p => ({ ...p, name: e.target.value }))}
                className="text-xl font-semibold h-auto py-1"
                data-testid="input-edit-lead-name"
              />
            ) : lead.name}
          </DialogTitle>
          <div className="flex items-center gap-2">
            {!isEditing ? (
              <Button variant="ghost" size="sm" onClick={() => setIsEditing(true)} data-testid="button-edit-lead">
                <Pencil className="h-4 w-4 mr-1" /> Edit
              </Button>
            ) : (
              <>
                <Button
                  variant="default"
                  size="sm"
                  disabled={updateMutation.isPending || !editForm.name || !editForm.email}
                  onClick={() => {
                    updateMutation.mutate(
                      { id: lead.id, data: {
                        name: editForm.name,
                        email: editForm.email,
                        company: editForm.company || null,
                        projectType: editForm.projectType || null,
                        budget: editForm.budget || null,
                        message: editForm.message,
                      }},
                      { onSuccess: () => { setIsEditing(false); toast({ title: "Lead updated" }); } }
                    );
                  }}
                  data-testid="button-save-edit-lead"
                >
                  {updateMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Save className="h-4 w-4 mr-1" />}
                  Save
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setEditForm({ name: lead.name, email: lead.email, company: lead.company || "", projectType: lead.projectType || "", budget: lead.budget || "", message: lead.message });
                    setIsEditing(false);
                  }}
                  data-testid="button-cancel-edit-lead"
                >
                  <X className="h-4 w-4 mr-1" /> Cancel
                </Button>
              </>
            )}
            <Badge variant="outline" className={`text-xs ${STATUS_COLORS[lead.status]}`}>
              {STATUS_LABELS[lead.status]}
            </Badge>
            <Badge variant="outline" className={`text-xs ${PRIORITY_COLORS[lead.priority]}`}>
              {lead.priority}
            </Badge>
          </div>
        </div>
      </DialogHeader>

      <div className="space-y-6 mt-4">
        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <span className="text-xs text-muted-foreground">Email</span>
            {isEditing ? (
              <Input type="email" value={editForm.email} onChange={e => setEditForm(p => ({ ...p, email: e.target.value }))} data-testid="input-edit-lead-email" />
            ) : (
              <p className="text-sm font-medium" data-testid="text-lead-detail-email">{lead.email}</p>
            )}
          </div>
          <div>
            <span className="text-xs text-muted-foreground">Company</span>
            {isEditing ? (
              <Input value={editForm.company} onChange={e => setEditForm(p => ({ ...p, company: e.target.value }))} data-testid="input-edit-lead-company" />
            ) : (
              <p className="text-sm font-medium">{lead.company || "Not provided"}</p>
            )}
          </div>
          <div>
            <span className="text-xs text-muted-foreground">Project Type</span>
            {isEditing ? (
              <Select value={editForm.projectType} onValueChange={v => setEditForm(p => ({ ...p, projectType: v }))}>
                <SelectTrigger data-testid="select-edit-lead-project-type"><SelectValue placeholder="Select type" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="website">Website</SelectItem>
                  <SelectItem value="ecommerce">E-Commerce</SelectItem>
                  <SelectItem value="web-app">Web Application</SelectItem>
                  <SelectItem value="mobile-app">Mobile App</SelectItem>
                  <SelectItem value="branding">Branding</SelectItem>
                  <SelectItem value="consulting">Consulting</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
            ) : (
              <p className="text-sm font-medium">{formatProjectType(lead.projectType)}</p>
            )}
          </div>
          <div>
            <span className="text-xs text-muted-foreground">Budget</span>
            {isEditing ? (
              <Select value={editForm.budget} onValueChange={v => setEditForm(p => ({ ...p, budget: v }))}>
                <SelectTrigger data-testid="select-edit-lead-budget"><SelectValue placeholder="Select budget" /></SelectTrigger>
                <SelectContent>
                  {BUDGET_OPTIONS.map(b => <SelectItem key={b} value={b}>{b}</SelectItem>)}
                </SelectContent>
              </Select>
            ) : (
              <p className="text-sm font-medium">{formatBudget(lead.budget)}</p>
            )}
          </div>
          <div>
            <span className="text-xs text-muted-foreground">Submitted</span>
            <p className="text-sm font-medium">
              {formatDate(lead.createdAt)} at {formatTime(lead.createdAt)}
            </p>
          </div>
          <div>
            <span className="text-xs text-muted-foreground">Last Updated</span>
            <p className="text-sm font-medium">
              {formatDate(lead.updatedAt)} at {formatTime(lead.updatedAt)}
            </p>
          </div>
        </div>

        <Separator className="border-border/30" />

        <div className="grid sm:grid-cols-3 gap-4">
          <div>
            <span className="text-xs text-muted-foreground">Projected Value</span>
            <p className="text-sm font-medium text-green-400" data-testid="text-lead-detail-projected-value">
              {formatCurrency(lead.projectedValue)}
            </p>
          </div>
          <div>
            <span className="text-xs text-muted-foreground">Close Probability</span>
            <p className="text-sm font-medium" data-testid="text-lead-detail-close-probability">
              {lead.closeProbability != null ? `${lead.closeProbability}%` : "-"}
            </p>
          </div>
          <div>
            <span className="text-xs text-muted-foreground">Weighted Value</span>
            <p className="text-sm font-medium text-primary" data-testid="text-lead-detail-weighted-value">
              {weightedValue != null ? formatCurrency(weightedValue) : "-"}
            </p>
          </div>
        </div>

        <Separator className="border-border/30" />

        <div>
          <span className="text-xs text-muted-foreground mb-2 block">Message</span>
          {isEditing ? (
            <Textarea value={editForm.message} onChange={e => setEditForm(p => ({ ...p, message: e.target.value }))} rows={4} data-testid="input-edit-lead-message" />
          ) : (
            <div className="p-4 rounded-md bg-background/50 border border-border/30">
              <p className="text-sm leading-relaxed whitespace-pre-wrap" data-testid="text-lead-detail-message">
                {lead.message}
              </p>
            </div>
          )}
        </div>

        <Separator className="border-border/30" />

        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <label className="text-xs text-muted-foreground mb-2 block">Status</label>
            <Select
              value={lead.status}
              onValueChange={(value) =>
                updateMutation.mutate({ id: lead.id, data: { status: value as any } })
              }
            >
              <SelectTrigger data-testid="select-lead-status"><SelectValue /></SelectTrigger>
              <SelectContent>
                {Object.entries(STATUS_LABELS).map(([key, label]) => (
                  <SelectItem key={key} value={key}>{label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-2 block">Priority</label>
            <Select
              value={lead.priority}
              onValueChange={(value) =>
                updateMutation.mutate({ id: lead.id, data: { priority: value as any } })
              }
            >
              <SelectTrigger data-testid="select-lead-priority"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="low">Low</SelectItem>
                <SelectItem value="medium">Medium</SelectItem>
                <SelectItem value="high">High</SelectItem>
                <SelectItem value="urgent">Urgent</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-2 block">Projected Value ($)</label>
            <Input
              type="number"
              min="0"
              defaultValue={lead.projectedValue ?? ""}
              onBlur={e => {
                const val = e.target.value ? parseInt(e.target.value, 10) : null;
                updateMutation.mutate({ id: lead.id, data: { projectedValue: val } });
              }}
              data-testid="input-lead-detail-projected-value"
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-2 block">Close Probability (%)</label>
            <Input
              type="number"
              min="0"
              max="100"
              defaultValue={lead.closeProbability ?? ""}
              onBlur={e => {
                const val = e.target.value ? parseInt(e.target.value, 10) : null;
                updateMutation.mutate({ id: lead.id, data: { closeProbability: val } });
              }}
              data-testid="input-lead-detail-close-probability"
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-2 block">Lead Source</label>
            <Select
              value={lead.leadSource ?? ""}
              onValueChange={(value) =>
                updateMutation.mutate({ id: lead.id, data: { leadSource: value || null } })
              }
            >
              <SelectTrigger data-testid="select-lead-detail-source"><SelectValue placeholder="Select source" /></SelectTrigger>
              <SelectContent>
                {LEAD_SOURCES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-2 block">Follow-Up Date</label>
            <Input
              type="date"
              defaultValue={lead.followUpDate ? new Date(lead.followUpDate).toISOString().split("T")[0] : ""}
              onBlur={e => {
                updateMutation.mutate({ id: lead.id, data: { followUpDate: e.target.value || null } });
              }}
              data-testid="input-lead-detail-follow-up-date"
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-2 block">Last Contacted</label>
            <Input
              type="date"
              defaultValue={lead.lastContactedAt ? new Date(lead.lastContactedAt).toISOString().split("T")[0] : ""}
              onBlur={e => {
                updateMutation.mutate({ id: lead.id, data: { lastContactedAt: e.target.value || null } });
              }}
              data-testid="input-lead-detail-last-contacted"
            />
          </div>
        </div>

        <Separator className="border-border/30" />

        <div>
          <label className="text-xs text-muted-foreground mb-2 block">Internal Notes</label>
          <Textarea
            value={editNotes}
            onChange={(e) => setEditNotes(e.target.value)}
            rows={3}
            data-testid="input-lead-detail-notes"
          />
          <Button
            size="sm"
            className="mt-2"
            onClick={() => notesMutation.mutate({ id: lead.id, notes: editNotes })}
            disabled={notesMutation.isPending}
            data-testid="button-save-notes"
          >
            Save Notes
          </Button>
        </div>

        <Separator className="border-border/30" />

        <LeadActivityTimeline leadId={lead.id} />

        <Separator className="border-border/30" />

        <ConvertToProjectSection lead={lead} onOpenChange={onOpenChange} />

        <Separator className="border-border/30" />

        <div className="flex justify-end">
          <Button
            variant="destructive"
            size="sm"
            onClick={() => {
              if (confirm("Delete this lead permanently?")) {
                deleteMutation.mutate(lead.id);
              }
            }}
            disabled={deleteMutation.isPending}
            data-testid="button-delete-lead"
          >
            <Trash2 className="h-4 w-4 mr-2" />
            Delete Lead
          </Button>
        </div>
      </div>
    </DialogContent>
  );
}

const ACTIVITY_ICONS: Record<string, any> = {
  status_change: TrendingUp,
  note: FileText,
  email_sent: Mail,
  email_opened: Mail,
  call: Phone,
  meeting: Users,
  follow_up: CalendarDays,
};

const ACTIVITY_COLORS: Record<string, string> = {
  status_change: "text-blue-500",
  note: "text-muted-foreground",
  email_sent: "text-amber-500",
  email_opened: "text-green-500",
  call: "text-purple-500",
  meeting: "text-cyan-500",
  follow_up: "text-orange-500",
};

function LeadActivityTimeline({ leadId }: { leadId: string }) {
  const { toast } = useToast();
  const [newType, setNewType] = useState("note");
  const [newDescription, setNewDescription] = useState("");

  const { data: activities = [], isLoading } = useQuery<LeadActivity[]>({
    queryKey: ["/api/leads", leadId, "activities"],
    queryFn: async () => {
      const res = await fetch(`/api/leads/${leadId}/activities`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
  });

  const addMutation = useMutation({
    mutationFn: async (data: { type: string; description: string }) => {
      const res = await apiRequest("POST", `/api/leads/${leadId}/activities`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/leads", leadId, "activities"] });
      setNewDescription("");
      toast({ title: "Activity logged" });
    },
  });

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <Activity className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-semibold">Activity Timeline</span>
      </div>

      <div className="flex gap-2 mb-4">
        <Select value={newType} onValueChange={setNewType}>
          <SelectTrigger className="w-[130px]" data-testid="select-activity-type">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="note">Note</SelectItem>
            <SelectItem value="call">Call</SelectItem>
            <SelectItem value="meeting">Meeting</SelectItem>
            <SelectItem value="follow_up">Follow-up</SelectItem>
          </SelectContent>
        </Select>
        <Input
          placeholder="Add activity..."
          value={newDescription}
          onChange={e => setNewDescription(e.target.value)}
          className="flex-1"
          data-testid="input-activity-description"
        />
        <Button
          size="sm"
          onClick={() => addMutation.mutate({ type: newType, description: newDescription })}
          disabled={!newDescription.trim() || addMutation.isPending}
          data-testid="button-add-activity"
        >
          {addMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
        </Button>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-4">
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        </div>
      ) : activities.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-4" data-testid="text-no-activities">No activity yet</p>
      ) : (
        <div className="space-y-3 max-h-60 overflow-y-auto">
          {activities.map((activity) => {
            const Icon = ACTIVITY_ICONS[activity.type] || MessageSquare;
            const color = ACTIVITY_COLORS[activity.type] || "text-muted-foreground";
            return (
              <div key={activity.id} className="flex gap-3 items-start" data-testid={`activity-${activity.id}`}>
                <div className={`mt-0.5 ${color}`}>
                  <Icon className="h-4 w-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm">{activity.description}</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <Badge variant="outline" className="text-[10px]">{activity.type.replace(/_/g, " ")}</Badge>
                    <span className="text-xs text-muted-foreground">
                      {new Date(activity.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })} at{" "}
                      {new Date(activity.createdAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ConvertToProjectSection({
  lead,
  onOpenChange,
}: {
  lead: ContactSubmission;
  onOpenChange: (open: boolean) => void;
}) {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [showConvert, setShowConvert] = useState(false);
  const [projectName, setProjectName] = useState(`${lead.company || lead.name} - Website Project`);
  const [templateId, setTemplateId] = useState("");

  const { data: templates } = useQuery<ProjectTemplate[]>({
    queryKey: ["/api/ops/templates"],
    enabled: showConvert,
  });

  const convertMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/ops/convert-lead", {
        leadId: lead.id,
        projectName: projectName.trim() || undefined,
        templateId: templateId && templateId !== "none" ? templateId : undefined,
      });
      return res.json() as Promise<Project>;
    },
    onSuccess: (project) => {
      queryClient.invalidateQueries({ queryKey: ["/api/leads"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ops/projects"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ops/companies"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ops/contacts"] });
      toast({ title: "Lead converted to project" });
      onOpenChange(false);
      navigate(`/admin/ops/projects/${project.id}`);
    },
    onError: (err: Error) => {
      toast({ title: "Conversion failed", description: err.message, variant: "destructive" });
    },
  });

  if (lead.status === "won") {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Rocket className="w-4 h-4 text-green-400" />
        <span>This lead has been converted</span>
      </div>
    );
  }

  if (!showConvert) {
    return (
      <div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setShowConvert(true)}
          data-testid="button-convert-to-project"
        >
          <Rocket className="h-4 w-4 mr-2" />
          Convert to Project
        </Button>
        <p className="text-xs text-muted-foreground mt-1">
          Creates company, contact, and project in Ops Portal
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3 p-3 border border-primary/20 rounded-md bg-primary/5">
      <p className="text-sm font-medium">Convert to Ops Project</p>
      <div className="space-y-2">
        <Label className="text-xs">Project Name</Label>
        <Input
          value={projectName}
          onChange={(e) => setProjectName(e.target.value)}
          placeholder="Project name"
          data-testid="input-convert-project-name"
        />
      </div>
      <div className="space-y-2">
        <Label className="text-xs">Template (optional)</Label>
        <Select value={templateId} onValueChange={setTemplateId}>
          <SelectTrigger data-testid="select-convert-template">
            <SelectValue placeholder="No template" />
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
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          onClick={() => convertMutation.mutate()}
          disabled={convertMutation.isPending}
          data-testid="button-confirm-convert"
        >
          {convertMutation.isPending && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}
          Convert & Go to Project
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setShowConvert(false)}
          data-testid="button-cancel-convert"
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}

export default function AdminPortal() {
  const { user, isLoading: authLoading, isAuthenticated, logout } = useAuth();
  const { toast } = useToast();
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [priorityFilter, setPriorityFilter] = useState("all");
  const [sourceFilter, setSourceFilter] = useState("all");
  const [selectedLead, setSelectedLead] = useState<ContactSubmission | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [addLeadOpen, setAddLeadOpen] = useState(false);
  const [mfaOpen, setMfaOpen] = useState(false);

  const { data: leads = [], isLoading: leadsLoading } = useQuery<ContactSubmission[]>({
    queryKey: ["/api/leads"],
    enabled: isAuthenticated,
  });

  const filteredLeads = leads.filter((lead) => {
    const matchesSearch =
      searchQuery === "" ||
      lead.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      lead.email.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (lead.company?.toLowerCase().includes(searchQuery.toLowerCase()) ?? false);
    const matchesStatus = statusFilter === "all" || lead.status === statusFilter;
    const matchesPriority = priorityFilter === "all" || lead.priority === priorityFilter;
    const matchesSource = sourceFilter === "all" || lead.leadSource === sourceFilter;
    return matchesSearch && matchesStatus && matchesPriority && matchesSource;
  });

  const activeStatuses = ["new", "contacted", "qualified", "proposal", "negotiation"];
  const pipelineStatuses = ["contacted", "qualified", "proposal", "negotiation"];

  const stats = {
    total: leads.length,
    newLeads: leads.filter(l => l.status === "new").length,
    inPipeline: leads.filter(l => pipelineStatuses.includes(l.status)).length,
    won: leads.filter(l => l.status === "won").length,
    pipelineValue: leads
      .filter(l => activeStatuses.includes(l.status))
      .reduce((sum, l) => sum + (l.projectedValue ?? 0), 0),
    weightedForecast: leads
      .filter(l => activeStatuses.includes(l.status))
      .reduce((sum, l) => {
        if (l.projectedValue != null && l.closeProbability != null) {
          return sum + Math.round(l.projectedValue * l.closeProbability / 100);
        }
        return sum;
      }, 0),
  };

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthlyWonValue = leads
    .filter(l => l.status === "won" && l.projectedValue && l.updatedAt && new Date(l.updatedAt) >= monthStart)
    .reduce((sum, l) => sum + (l.projectedValue ?? 0), 0);
  const monthlyGoal = 25000;
  const goalProgress = Math.min(100, Math.round((monthlyWonValue / monthlyGoal) * 100));

  const sourceBreakdown = leads.reduce<Record<string, { count: number; value: number }>>((acc, lead) => {
    const src = lead.leadSource || "Unknown";
    if (!acc[src]) acc[src] = { count: 0, value: 0 };
    acc[src].count++;
    acc[src].value += lead.projectedValue ?? 0;
    return acc;
  }, {});
  const maxSourceValue = Math.max(1, ...Object.values(sourceBreakdown).map(s => s.value));

  const openDetail = (lead: ContactSubmission) => {
    setSelectedLead(lead);
    setDetailOpen(true);
  };

  const handleExportCSV = async () => {
    try {
      const res = await fetch("/api/leads/export/csv", { credentials: "include" });
      if (!res.ok) throw new Error("Export failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `blackridge-leads-${new Date().toISOString().split("T")[0]}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast({ title: "CSV exported" });
    } catch {
      toast({ title: "Export failed", variant: "destructive" });
    }
  };

  if (authLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return <LoginForm />;
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-50 bg-background/80 backdrop-blur-xl border-b border-border/50">
        <div className="max-w-7xl mx-auto px-6 flex items-center justify-between gap-4 h-16">
          <div className="flex items-center gap-3">
            <Mountain className="h-5 w-5 text-primary" />
            <span className="font-bold tracking-tight text-sm">
              BlackRidge<span className="text-primary"> CRM</span>
            </span>
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            <a href="/admin/ops">
              <Button variant="outline" size="sm" data-testid="button-ops-portal">
                <Zap className="h-4 w-4 mr-1" />
                Ops Portal
              </Button>
            </a>
            <Button size="sm" onClick={() => setAddLeadOpen(true)} data-testid="button-add-lead">
              <Plus className="h-4 w-4 mr-1" />
              Add Lead
            </Button>
            <Button variant="outline" size="sm" onClick={handleExportCSV} data-testid="button-export-csv">
              <Download className="h-4 w-4 mr-1" />
              Export CSV
            </Button>
            {user && (
              <span className="text-sm text-muted-foreground hidden sm:inline" data-testid="text-admin-user">
                {user.firstName}
              </span>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setMfaOpen(true)}
              data-testid="button-mfa-settings"
            >
              <Shield className="h-4 w-4 mr-1" />
              MFA
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => logout()}
              data-testid="button-logout"
            >
              <LogOut className="h-4 w-4 mr-1" />
              Logout
            </Button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8">
        <div className="mb-8">
          <h1 className="text-2xl font-bold mb-1" data-testid="text-crm-title">Lead Management</h1>
          <p className="text-muted-foreground text-sm">Track and manage incoming project inquiries</p>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
          {[
            { label: "Total Leads", value: stats.total, icon: Users, color: "text-foreground", testId: "text-stat-total-leads" },
            { label: "New", value: stats.newLeads, icon: Inbox, color: "text-blue-400", testId: "text-stat-new" },
            { label: "In Pipeline", value: stats.inPipeline, icon: TrendingUp, color: "text-amber-400", testId: "text-stat-in-pipeline" },
            { label: "Won", value: stats.won, icon: DollarSign, color: "text-green-400", testId: "text-stat-won" },
          ].map((stat) => (
            <Card key={stat.label} className="border-border/50 bg-card/50">
              <CardContent className="p-4 pt-4">
                <div className="flex items-center justify-between gap-2 mb-2">
                  <span className="text-xs text-muted-foreground">{stat.label}</span>
                  <stat.icon className={`h-4 w-4 ${stat.color}`} />
                </div>
                <p className={`text-2xl font-bold ${stat.color}`} data-testid={stat.testId}>
                  {leadsLoading ? "-" : stat.value}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
          <Card className="border-border/50 bg-card/50">
            <CardContent className="p-4 pt-4">
              <div className="flex items-center justify-between gap-2 mb-2">
                <span className="text-xs text-muted-foreground">Pipeline Value</span>
                <Target className="h-4 w-4 text-cyan-400" />
              </div>
              <p className="text-2xl font-bold text-cyan-400" data-testid="text-pipeline-total">
                {leadsLoading ? "-" : formatCurrency(stats.pipelineValue)}
              </p>
            </CardContent>
          </Card>
          <Card className="border-border/50 bg-card/50">
            <CardContent className="p-4 pt-4">
              <div className="flex items-center justify-between gap-2 mb-2">
                <span className="text-xs text-muted-foreground">Weighted Forecast</span>
                <Percent className="h-4 w-4 text-purple-400" />
              </div>
              <p className="text-2xl font-bold text-purple-400" data-testid="text-weighted-forecast">
                {leadsLoading ? "-" : formatCurrency(stats.weightedForecast)}
              </p>
            </CardContent>
          </Card>
          <Card className="border-border/50 bg-card/50">
            <CardContent className="p-4 pt-4">
              <div className="flex items-center justify-between gap-2 mb-2">
                <span className="text-xs text-muted-foreground">Monthly Revenue Goal</span>
                <DollarSign className="h-4 w-4 text-green-400" />
              </div>
              <div className="flex items-center justify-between gap-2 mb-1">
                <span className="text-sm font-bold text-green-400" data-testid="text-monthly-revenue">
                  {formatCurrency(monthlyWonValue)}
                </span>
                <span className="text-xs text-muted-foreground">/ {formatCurrency(monthlyGoal)}</span>
              </div>
              <Progress value={goalProgress} className="h-2" data-testid="progress-monthly-goal" />
              <span className="text-xs text-muted-foreground mt-1 block">{goalProgress}% of goal</span>
            </CardContent>
          </Card>
        </div>

        <HotLeadsWidget onOpenDetail={openDetail} leads={leads} />

        {Object.keys(sourceBreakdown).length > 0 && !leadsLoading && (
          <Card className="border-border/50 bg-card/50 mb-8">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold">Lead Source Breakdown</CardTitle>
            </CardHeader>
            <CardContent className="p-4 pt-0">
              <div className="space-y-3">
                {Object.entries(sourceBreakdown)
                  .sort((a, b) => b[1].value - a[1].value)
                  .map(([source, data]) => (
                    <div key={source} data-testid={`row-source-${source.toLowerCase().replace(/\s/g, '-')}`}>
                      <div className="flex items-center justify-between gap-4 mb-1">
                        <span className="text-sm font-medium">{source}</span>
                        <div className="flex items-center gap-3 text-xs text-muted-foreground">
                          <span>{data.count} lead{data.count !== 1 ? "s" : ""}</span>
                          <span className="font-medium text-foreground">{formatCurrency(data.value)}</span>
                        </div>
                      </div>
                      <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                        <div
                          className="h-full rounded-full bg-primary/60"
                          style={{ width: `${Math.round((data.value / maxSourceValue) * 100)}%` }}
                        />
                      </div>
                    </div>
                  ))}
              </div>
            </CardContent>
          </Card>
        )}

        <Card className="border-border/50 bg-card/50 mb-6">
          <CardContent className="p-4 pt-4">
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search leads by name, email, or company..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10"
                  data-testid="input-search-leads"
                />
              </div>
              <div className="flex gap-3 flex-wrap">
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger className="w-[140px]" data-testid="select-status-filter">
                    <Filter className="h-3 w-3 mr-1" />
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Status</SelectItem>
                    {Object.entries(STATUS_LABELS).map(([key, label]) => (
                      <SelectItem key={key} value={key}>{label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={priorityFilter} onValueChange={setPriorityFilter}>
                  <SelectTrigger className="w-[140px]" data-testid="select-priority-filter">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Priority</SelectItem>
                    <SelectItem value="low">Low</SelectItem>
                    <SelectItem value="medium">Medium</SelectItem>
                    <SelectItem value="high">High</SelectItem>
                    <SelectItem value="urgent">Urgent</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={sourceFilter} onValueChange={setSourceFilter}>
                  <SelectTrigger className="w-[150px]" data-testid="select-source-filter">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Sources</SelectItem>
                    {LEAD_SOURCES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardContent>
        </Card>

        {leadsLoading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : filteredLeads.length === 0 ? (
          <Card className="border-border/50 bg-card/50">
            <CardContent className="p-12 pt-12 text-center">
              <Inbox className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-lg font-semibold mb-2">
                {leads.length === 0 ? "No leads yet" : "No matching leads"}
              </h3>
              <p className="text-muted-foreground text-sm">
                {leads.length === 0
                  ? "Leads from the contact form will appear here."
                  : "Try adjusting your search or filters."}
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {filteredLeads.map((lead) => {
              const stale = isStale(lead);
              const overdue = isFollowUpOverdue(lead);
              const todayFollowUp = isFollowUpToday(lead);
              const atRisk = isAtRisk(lead);

              const highlightColor = stale ? "bg-red-500" : (overdue || todayFollowUp) ? "bg-amber-500" : null;

              const weightedVal = lead.projectedValue != null && lead.closeProbability != null
                ? Math.round(lead.projectedValue * lead.closeProbability / 100)
                : null;

              return (
                <Card
                  key={lead.id}
                  className="border-border/50 bg-card/50 hover-elevate cursor-pointer"
                  onClick={() => openDetail(lead)}
                  data-testid={`card-lead-${lead.id}`}
                >
                  <CardContent className="p-4 pt-4 flex gap-0">
                    {highlightColor && (
                      <div className={`w-1 -my-4 -ml-4 mr-4 rounded-l-md ${highlightColor}`} />
                    )}
                    <div className="flex items-start justify-between gap-4 flex-wrap flex-1">
                      <div className="flex items-center gap-4 min-w-0 flex-1">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap mb-1">
                            <span className="font-semibold text-sm truncate" data-testid={`text-lead-name-${lead.id}`}>
                              {lead.name}
                            </span>
                            {lead.company && (
                              <span className="text-xs text-muted-foreground flex items-center gap-1">
                                <Building2 className="h-3 w-3" />
                                {lead.company}
                              </span>
                            )}
                            {stale && <Badge variant="outline" className="text-xs bg-red-500/15 text-red-400 border-red-500/20">Stale</Badge>}
                            {overdue && <Badge variant="outline" className="text-xs bg-red-500/15 text-red-400 border-red-500/20">Overdue</Badge>}
                            {todayFollowUp && !overdue && <Badge variant="outline" className="text-xs bg-amber-500/15 text-amber-400 border-amber-500/20">Follow-Up Today</Badge>}
                            {atRisk && <Badge variant="outline" className="text-xs bg-orange-500/15 text-orange-400 border-orange-500/20"><AlertTriangle className="h-3 w-3 mr-1" />At Risk</Badge>}
                          </div>
                          <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
                            <span className="flex items-center gap-1">
                              <Mail className="h-3 w-3" />
                              {lead.email}
                            </span>
                            <span className="flex items-center gap-1">
                              <Calendar className="h-3 w-3" />
                              {formatDate(lead.createdAt)}
                            </span>
                            {lead.projectType && (
                              <span>{formatProjectType(lead.projectType)}</span>
                            )}
                            {lead.budget && (
                              <span className="flex items-center gap-1">
                                <DollarSign className="h-3 w-3" />
                                {formatBudget(lead.budget)}
                              </span>
                            )}
                            {lead.followUpDate && (
                              <span className="flex items-center gap-1">
                                <CalendarDays className="h-3 w-3" />
                                Follow-up: {formatDate(lead.followUpDate)}
                              </span>
                            )}
                          </div>
                          {(lead.projectedValue != null || lead.leadSource) && (
                            <div className="flex items-center gap-3 text-xs mt-1 flex-wrap">
                              {lead.projectedValue != null && (
                                <span className="text-green-400 font-medium" data-testid={`text-lead-value-${lead.id}`}>
                                  {formatCurrency(lead.projectedValue)}
                                </span>
                              )}
                              {lead.closeProbability != null && (
                                <span className="text-muted-foreground">{lead.closeProbability}% prob</span>
                              )}
                              {weightedVal != null && (
                                <span className="text-primary font-medium" data-testid={`text-lead-weighted-${lead.id}`}>
                                  Wtd: {formatCurrency(weightedVal)}
                                </span>
                              )}
                              {lead.leadSource && (
                                <Badge variant="outline" className="text-xs">{lead.leadSource}</Badge>
                              )}
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className={`text-xs ${PRIORITY_COLORS[lead.priority]}`}>
                          {lead.priority}
                        </Badge>
                        <Badge variant="outline" className={`text-xs ${STATUS_COLORS[lead.status]}`}>
                          {STATUS_LABELS[lead.status] || lead.status}
                        </Badge>
                        <ChevronRight className="h-4 w-4 text-muted-foreground" />
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </main>

      <AddLeadDialog open={addLeadOpen} onOpenChange={setAddLeadOpen} />
      <LeadDetailDialog
        lead={selectedLead}
        open={detailOpen}
        onOpenChange={(open) => {
          setDetailOpen(open);
          if (!open) setSelectedLead(null);
        }}
        onLeadUpdate={setSelectedLead}
      />
      <MfaSettingsDialog open={mfaOpen} onClose={() => setMfaOpen(false)} />
    </div>
  );
}