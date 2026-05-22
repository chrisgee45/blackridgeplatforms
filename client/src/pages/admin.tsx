import { useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { isUnauthorizedError } from "@/lib/auth-utils";
import { MfaSettingsDialog } from "@/components/MfaSettings";
import CrmCalendar, { EventDialog, styleFor } from "@/components/crm/crm-calendar";
import { format } from "date-fns";
import type { ContactSubmission, UpdateLead, CreateLead, ProjectTemplate, Project, LeadActivity, CrmEvent, Proposal } from "@shared/schema";
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
  DialogFooter,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  LogOut,
  Search,
  Filter,
  Users,
  TrendingUp,
  DollarSign,
  Mail,
  Send,
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
  Sparkles,
  Menu,
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
          <div className="flex items-center justify-center gap-3 mb-4">
            <div className="bg-neutral-950 rounded-lg px-4 py-3 flex items-center">
              <img src="/blackridge-logo.png" alt="BlackRidge Platforms" className="h-12 w-auto" />
            </div>
            <span className="font-semibold text-xs tracking-[0.2em] uppercase text-primary">CRM</span>
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
    <Card className="border-border/50 bg-card/50" data-testid="card-hot-leads">
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
    website: "",
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
        name: "", email: "", company: "", website: "", projectType: "", budget: "",
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
    if (formData.website) payload.website = formData.website;
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
              <label className="text-xs text-muted-foreground mb-1.5 block">Current Website</label>
              <Input value={formData.website} onChange={e => update("website", e.target.value)} placeholder="example.com" data-testid="input-add-lead-website" />
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

type ScriptItem = { label?: string; say?: string; note?: string };
const CALL_SCRIPTS: { section: string; items: ScriptItem[] }[] = [
  {
    section: "Get past the gatekeeper",
    items: [
      { label: "If you have the owner's name", say: "Hi, this is Chris with BlackRidge Platforms. Is [Owner] in today?" },
      { label: "If they ask what it's about", say: "I looked at [Business]'s website and had two specific ideas for them. Two minutes, tops. Are they around?" },
      { label: "If you don't have a name", say: "Quick question, who's the best person to talk to about the company website? ... And are they in right now?" },
      { note: "Always get the gatekeeper's name and thank them by it. They decide if you get through." },
    ],
  },
  {
    section: "Opener (decision maker)",
    items: [
      { label: "Lead with honesty, it disarms them", say: "Hi [Name], this is Chris with BlackRidge Platforms. I'll be straight with you, this is a cold call. You can hang up, or give me 30 seconds and then decide. Fair enough?" },
      { label: "Then", say: "I build websites for businesses in [area]. Before I called I looked at [Business]'s site, and the reason I'm calling you specifically is [specific observation]. I won't pitch you over the phone. I'd just show you what I'd change on a quick 15-minute call. Worst case you get free ideas. Worth a look?" },
      { note: "Observations that work: hard to use on a phone / no clear way to call or book from the homepage / loads slow enough that visitors leave." },
    ],
  },
  {
    section: "Objections",
    items: [
      { label: "We already have a website", say: "Most businesses do. The question isn't whether you have one, it's whether it turns visitors into phone calls. That's exactly what I'd look at with you." },
      { label: "Not interested", say: "Totally fair. Quick question so I don't bug you again, is the timing just off, or is the website not really a priority right now?" },
      { label: "Just send me an email", say: "Happy to. So I send something useful, what's the one thing you'd want a new site to do, more calls, more bookings, or look more credible? ... Best email for you?" },
      { label: "How much does it cost", say: "Fair question. Honestly it depends what you need, and any number now would be a guess. That's why I do a short call first, so I give you a real number, not a sales number. Most projects land between [range]. Can we grab 15 minutes?" },
      { label: "We're too busy right now", say: "I hear you, and that's the point. You're busy running the business. The website should be working for you in the background. Let's just put 15 minutes on the calendar for next week." },
    ],
  },
  {
    section: "Close (book the call)",
    items: [
      { say: "Great. I make it easy, I'll text you a link to grab a time, takes ten seconds. Or I pencil you in now, mornings or afternoons generally? ... Tuesday or Thursday?" },
      { note: "Then send your booking link. They pick a slot and it lands on your calendar automatically." },
    ],
  },
  {
    section: "Voicemail (keep it under 20 seconds)",
    items: [
      { say: "Hi [Name], this is Chris with BlackRidge Platforms, my number is [number]. I looked at [Business]'s website and noticed one quick thing that's probably costing you customers. Nothing to buy, I just want to point it out. Call me back at [number], or I'll try you again. Thanks [Name]." },
    ],
  },
  {
    section: "Tips",
    items: [
      { note: "Best call windows: 8 to 9 am and 4 to 5:30 pm." },
      { note: "Tone: calm and unhurried. Confidence pulls, desperation repels." },
      { note: "Stand up and smile when you dial. It changes your voice." },
      { note: "Log every call here as an activity and set a follow-up date before you hang up." },
      { note: "The goal of the call is the booking, not the sale. If they book, the call worked." },
    ],
  },
];

function CallScriptsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto" data-testid="dialog-call-scripts">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Phone className="h-5 w-5 text-primary" /> Cold Call Playbook
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-5">
          {CALL_SCRIPTS.map((sec) => (
            <div key={sec.section}>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-primary mb-2">{sec.section}</h3>
              <div className="space-y-2.5">
                {sec.items.map((item, i) => (
                  <div key={i}>
                    {item.label && <p className="text-xs text-muted-foreground mb-1">{item.label}</p>}
                    {item.say && (
                      <p className="text-sm bg-muted/50 border-l-2 border-primary/60 rounded-r px-3 py-2 leading-relaxed">
                        {item.say}
                      </p>
                    )}
                    {item.note && <p className="text-xs text-muted-foreground leading-relaxed">{item.note}</p>}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </DialogContent>
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
  const [scriptsOpen, setScriptsOpen] = useState(false);
  const [editForm, setEditForm] = useState({
    name: lead.name,
    email: lead.email,
    company: lead.company || "",
    website: lead.website || "",
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
            <Button variant="outline" size="sm" onClick={() => setScriptsOpen(true)} data-testid="button-call-scripts">
              <Phone className="h-4 w-4 mr-1" /> Call Script
            </Button>
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
                        website: editForm.website || null,
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
                    setEditForm({ name: lead.name, email: lead.email, company: lead.company || "", website: lead.website || "", projectType: lead.projectType || "", budget: lead.budget || "", message: lead.message });
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
            <span className="text-xs text-muted-foreground">Current Website</span>
            {isEditing ? (
              <Input value={editForm.website} onChange={e => setEditForm(p => ({ ...p, website: e.target.value }))} placeholder="example.com" data-testid="input-edit-lead-website" />
            ) : lead.website ? (
              <p className="text-sm font-medium">
                <a
                  href={lead.website.startsWith("http") ? lead.website : `https://${lead.website}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline"
                  data-testid="link-lead-website"
                >
                  {lead.website}
                </a>
              </p>
            ) : (
              <p className="text-sm font-medium">Not provided</p>
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

        <LeadEmailComposer lead={lead} />

        <Separator className="border-border/30" />

        <LeadEventsSection lead={lead} />

        <Separator className="border-border/30" />

        <LeadProposalsSection lead={lead} />

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
      <CallScriptsDialog open={scriptsOpen} onOpenChange={setScriptsOpen} />
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

const EMAIL_TEMPLATES: { label: string; subject: string; body: string }[] = [
  {
    label: "Cold intro (site observation)",
    subject: "an idea for {{company}}'s site",
    body: "Hi {{name}},\n\nI was looking at {{company}}'s website and a couple of things stood out. Small changes that could turn more of your visitors into actual calls and customers.\n\nBuilding sites that sell (not just sit there) is what I do, and I'd be glad to walk you through what I'd change. No charge, no pitch.\n\nWorth 15 minutes? I'll show you exactly what I mean.\n\nBest,",
  },
  {
    label: "Gentle bump",
    subject: "bad timing, {{name}}?",
    body: "Hi {{name}},\n\nI know inboxes are brutal, so I'll keep this short.\n\nQuick yes or no: is improving {{company}}'s website something you'd want to look at this quarter, or should I reach back out later in the year?\n\nEither answer is completely fine. I just don't want to chase if the timing's off.\n\nBest,",
  },
  {
    label: "Value-first idea",
    subject: "a 5-minute fix for {{company}}",
    body: "Hi {{name}},\n\nNo pitch here, just one idea.\n\nMost small-business sites lose visitors in the first five seconds because it isn't instantly clear what to do next. The fix is usually one strong headline and one obvious button.\n\nIf you'd like, I'll record a quick 3-minute video showing exactly how I'd do that for {{company}}. It's free, and yours to keep whether we ever work together or not.\n\nWant me to send it over?\n\nBest,",
  },
  {
    label: "After a call",
    subject: "great talking today, {{name}}",
    body: "Hi {{name}},\n\nReally enjoyed our conversation, and thanks for the time.\n\nWhat I heard: you want a site that looks sharp and actually brings in business, without a months-long process. That's exactly what I do.\n\nI'll put together a clear scope and price for {{company}} and send it your way. Anything specific you want me to be sure to include?\n\nBest,",
  },
  {
    label: "Proposal sent",
    subject: "your plan for {{company}}'s new site",
    body: "Hi {{name}},\n\nHere's the plan for {{company}}'s new website. Everything we'll build, the timeline, and the investment, all in one place.\n\nI kept it straightforward: no jargon, no surprises. If anything looks off or you'd adjust the scope, just say the word.\n\nHappy to hop on a quick call and walk through it together. When works for you?\n\nBest,",
  },
  {
    label: "Re-engage (breakup)",
    subject: "should I close your file, {{name}}?",
    body: "Hi {{name}},\n\nI've reached out a few times about {{company}}'s website and haven't heard back, which usually means one of two things: it's not a priority right now, or my timing has been off.\n\nNo hard feelings either way. If it isn't the right time, I'll close this out and stop landing in your inbox.\n\nBut if a website that actually pulls in customers is still on your list, just reply \"still interested\" and I'll take it from there.\n\nBest,",
  },
];

function LeadEmailComposer({ lead }: { lead: ContactSubmission }) {
  const { toast } = useToast();
  const [expanded, setExpanded] = useState(false);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");

  const fill = (text: string) =>
    text
      .replace(/\{\{name\}\}/g, lead.name || "there")
      .replace(/\{\{company\}\}/g, lead.company || "your business");

  const applyTemplate = (label: string) => {
    const tpl = EMAIL_TEMPLATES.find((t) => t.label === label);
    if (!tpl) return;
    setSubject(fill(tpl.subject));
    setBody(fill(tpl.body));
  };

  const sendMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/leads/${lead.id}/email`, { subject, body });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/leads", lead.id, "activities"] });
      queryClient.invalidateQueries({ queryKey: ["/api/leads"] });
      toast({ title: "Email sent", description: `Sent to ${lead.email}` });
      setSubject("");
      setBody("");
      setExpanded(false);
    },
    onError: (error: any) => {
      let description = "Failed to send email";
      const match = String(error?.message || "").match(/^\d+:\s*([\s\S]*)$/);
      if (match) {
        try {
          description = JSON.parse(match[1])?.message || match[1] || description;
        } catch {
          description = match[1] || description;
        }
      }
      toast({ title: "Error", description, variant: "destructive" });
    },
  });

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Mail className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-semibold">Email</span>
        </div>
        {!expanded && (
          <Button size="sm" variant="outline" onClick={() => setExpanded(true)} data-testid="button-compose-email">
            <Mail className="h-4 w-4 mr-1" /> Compose Email
          </Button>
        )}
      </div>
      {expanded && (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">To: {lead.email}</p>
          <Select onValueChange={applyTemplate}>
            <SelectTrigger className="w-full" data-testid="select-email-template">
              <SelectValue placeholder="Start from a template (optional)" />
            </SelectTrigger>
            <SelectContent>
              {EMAIL_TEMPLATES.map((t) => (
                <SelectItem key={t.label} value={t.label}>{t.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            placeholder="Subject"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            data-testid="input-email-subject"
          />
          <Textarea
            placeholder="Write your message..."
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={8}
            data-testid="input-email-body"
          />
          <div className="rounded-lg border border-border/50 bg-muted/30 p-3" data-testid="email-signature-preview">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">
              Signature (added automatically)
            </p>
            <div className="flex items-center gap-3">
              <div className="bg-neutral-950 rounded-md px-3 py-2 flex items-center shrink-0">
                <img src="/blackridge-logo.png" alt="BlackRidge Platforms" className="h-9 w-auto" />
              </div>
              <div className="border-l-2 border-primary/70 pl-3">
                <div className="text-sm font-bold leading-tight">Chris Gee</div>
                <div className="text-xs font-semibold text-primary leading-tight">Founder &amp; CEO | BlackRidge Platforms</div>
                <div className="text-xs text-muted-foreground mt-1 leading-tight">(405) 201-5869</div>
                <div className="text-xs text-muted-foreground leading-tight">blackridgeplatforms.com</div>
                <div className="text-xs text-muted-foreground leading-tight">chris@blackridgeplatforms.com</div>
              </div>
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => { setExpanded(false); setSubject(""); setBody(""); }}
              data-testid="button-cancel-email"
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={() => sendMutation.mutate()}
              disabled={!subject.trim() || !body.trim() || sendMutation.isPending}
              data-testid="button-send-email"
            >
              {sendMutation.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Send className="h-4 w-4 mr-1" />}
              Send Email
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function LeadEventsSection({ lead }: { lead: ContactSubmission }) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<CrmEvent | null>(null);

  const { data: events = [], isLoading } = useQuery<CrmEvent[]>({
    queryKey: ["/api/crm/events", lead.id],
    queryFn: async () => {
      const res = await fetch(`/api/crm/events?leadId=${lead.id}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch events");
      return res.json();
    },
  });

  const sorted = [...events].sort(
    (a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime(),
  );

  const openNew = () => { setEditing(null); setDialogOpen(true); };
  const openEdit = (ev: CrmEvent) => { setEditing(ev); setDialogOpen(true); };

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <CalendarDays className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-semibold">Meetings &amp; Calls</span>
        </div>
        <Button size="sm" variant="outline" onClick={openNew} data-testid="button-schedule-lead-event">
          <Plus className="h-4 w-4 mr-1" /> Schedule
        </Button>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-4">
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        </div>
      ) : sorted.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-4" data-testid="text-no-lead-events">
          Nothing scheduled with this lead yet.
        </p>
      ) : (
        <div className="space-y-2">
          {sorted.map((ev) => {
            const st = styleFor(ev.type);
            const Icon = st.icon;
            const cancelled = ev.status === "cancelled" || ev.status === "no_show";
            return (
              <button
                key={ev.id}
                onClick={() => openEdit(ev)}
                className={`w-full flex items-center gap-3 p-2.5 rounded-lg border border-border/50 hover-elevate transition-colors text-left ${cancelled ? "opacity-60" : ""}`}
                data-testid={`lead-event-${ev.id}`}
              >
                <div className={`h-8 w-8 rounded-md flex items-center justify-center shrink-0 ${st.soft}`}>
                  <Icon className="h-4 w-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className={`text-sm font-medium truncate ${cancelled ? "line-through" : ""}`}>{ev.title}</div>
                  <div className="text-xs text-muted-foreground truncate">
                    {format(new Date(ev.startAt), "EEE, MMM d · h:mm a")}
                    {ev.location ? ` · ${ev.location}` : ""}
                  </div>
                </div>
                <Badge variant="outline" className="text-[10px] shrink-0 capitalize">
                  {ev.status === "no_show" ? "no-show" : ev.status}
                </Badge>
              </button>
            );
          })}
        </div>
      )}

      <EventDialog
        key={dialogOpen ? (editing?.id ?? "new") : "closed"}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        event={editing}
        presetDate={null}
        presetLeadId={lead.id}
        leads={[lead]}
      />
    </div>
  );
}

function renderProposalInline(text: string): React.ReactNode {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith("**") && part.endsWith("**")
      ? <strong key={i}>{part.slice(2, -2)}</strong>
      : <span key={i}>{part}</span>,
  );
}

function ProposalContent({ content }: { content: string }) {
  const blocks: React.ReactNode[] = [];
  let listItems: string[] = [];
  let key = 0;
  const flushList = () => {
    if (listItems.length) {
      const items = [...listItems];
      blocks.push(
        <ul key={key++} className="list-disc pl-5 space-y-1 my-2 text-sm">
          {items.map((it, i) => <li key={i}>{renderProposalInline(it)}</li>)}
        </ul>,
      );
      listItems = [];
    }
  };
  for (const raw of content.split("\n")) {
    const line = raw.trimEnd();
    if (line.startsWith("## ")) {
      flushList();
      blocks.push(<h2 key={key++} className="text-base font-bold text-primary mt-5 mb-1.5 first:mt-0">{renderProposalInline(line.slice(3))}</h2>);
    } else if (line.startsWith("### ")) {
      flushList();
      blocks.push(<h3 key={key++} className="text-sm font-bold mt-3 mb-1">{renderProposalInline(line.slice(4))}</h3>);
    } else if (line.startsWith("- ")) {
      listItems.push(line.slice(2));
    } else if (line.trim() === "") {
      flushList();
    } else {
      flushList();
      blocks.push(<p key={key++} className="text-sm leading-relaxed my-1.5">{renderProposalInline(line)}</p>);
    }
  }
  flushList();
  return <div data-testid="proposal-rendered">{blocks}</div>;
}

const PROPOSAL_STATUS: Record<string, string> = {
  draft: "bg-slate-500/15 text-muted-foreground border-slate-500/30",
  sent: "bg-blue-500/15 text-blue-600 border-blue-500/30",
  accepted: "bg-green-500/15 text-green-600 border-green-500/30",
  declined: "bg-red-500/15 text-red-600 border-red-500/30",
};

function LeadProposalsSection({ lead }: { lead: ContactSubmission }) {
  const { toast } = useToast();
  const [selected, setSelected] = useState<Proposal | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  const { data: proposals = [], isLoading } = useQuery<Proposal[]>({
    queryKey: ["/api/leads", lead.id, "proposals"],
    queryFn: async () => {
      const res = await fetch(`/api/leads/${lead.id}/proposals`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch proposals");
      return res.json();
    },
  });

  const errorText = (error: any) => {
    const m = String(error?.message || "").match(/^\d+:\s*([\s\S]*)$/);
    if (m) { try { return JSON.parse(m[1])?.message || m[1]; } catch { return m[1]; } }
    return error?.message || "Something went wrong";
  };

  const generateMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/leads/${lead.id}/proposal/generate`, {});
      return res.json();
    },
    onSuccess: (proposal: Proposal) => {
      queryClient.invalidateQueries({ queryKey: ["/api/leads", lead.id, "proposals"] });
      setSelected(proposal);
      setDialogOpen(true);
      toast({ title: "Proposal generated", description: "Review and edit before sending." });
    },
    onError: (e) => toast({ title: "Could not generate", description: errorText(e), variant: "destructive" }),
  });

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <FileText className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-semibold">Proposals</span>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => generateMutation.mutate()}
          disabled={generateMutation.isPending}
          data-testid="button-generate-proposal"
        >
          {generateMutation.isPending
            ? <Loader2 className="h-4 w-4 mr-1 animate-spin" />
            : <Sparkles className="h-4 w-4 mr-1" />}
          {generateMutation.isPending ? "Writing..." : "Generate with AI"}
        </Button>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-4">
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        </div>
      ) : proposals.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-4" data-testid="text-no-proposals">
          No proposals yet. Generate one and Claude will draft it from this lead's details.
        </p>
      ) : (
        <div className="space-y-2">
          {proposals.map((p) => (
            <button
              key={p.id}
              onClick={() => { setSelected(p); setDialogOpen(true); }}
              className="w-full flex items-center gap-3 p-2.5 rounded-lg border border-border/50 hover-elevate transition-colors text-left"
              data-testid={`proposal-${p.id}`}
            >
              <div className="h-8 w-8 rounded-md flex items-center justify-center shrink-0 bg-primary/10">
                <FileText className="h-4 w-4 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">{p.title}</div>
                <div className="text-xs text-muted-foreground">
                  {p.amount != null ? `$${p.amount.toLocaleString()} · ` : ""}
                  {new Date(p.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                </div>
              </div>
              <Badge variant="outline" className={`text-[10px] shrink-0 capitalize ${PROPOSAL_STATUS[p.status] ?? ""}`}>
                {p.status}
              </Badge>
            </button>
          ))}
        </div>
      )}

      {selected && (
        <ProposalDialog
          key={selected.id}
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          proposal={selected}
          lead={lead}
        />
      )}
    </div>
  );
}

function ProposalDialog({
  open, onOpenChange, proposal, lead,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  proposal: Proposal;
  lead: ContactSubmission;
}) {
  const { toast } = useToast();
  const [mode, setMode] = useState<"view" | "edit">("view");
  const [title, setTitle] = useState(proposal.title);
  const [content, setContent] = useState(proposal.content);
  const [amount, setAmount] = useState(proposal.amount != null ? String(proposal.amount) : "");
  const [status, setStatus] = useState(proposal.status);

  const errorText = (error: any) => {
    const m = String(error?.message || "").match(/^\d+:\s*([\s\S]*)$/);
    if (m) { try { return JSON.parse(m[1])?.message || m[1]; } catch { return m[1]; } }
    return error?.message || "Something went wrong";
  };
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["/api/leads", lead.id, "proposals"] });

  const saveMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("PATCH", `/api/proposals/${proposal.id}`, { title, content, amount, status });
    },
    onSuccess: () => { toast({ title: "Proposal saved" }); refresh(); setMode("view"); },
    onError: (e) => toast({ title: "Error", description: errorText(e), variant: "destructive" }),
  });

  const sendMutation = useMutation({
    mutationFn: async () => { await apiRequest("POST", `/api/proposals/${proposal.id}/send`, {}); },
    onSuccess: () => { toast({ title: "Proposal sent", description: `Emailed to ${lead.email}` }); refresh(); onOpenChange(false); },
    onError: (e) => toast({ title: "Error", description: errorText(e), variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async () => { await apiRequest("DELETE", `/api/proposals/${proposal.id}`); },
    onSuccess: () => { toast({ title: "Proposal deleted" }); refresh(); onOpenChange(false); },
    onError: (e) => toast({ title: "Error", description: errorText(e), variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto" data-testid="dialog-proposal">
        <DialogHeader>
          <div className="bg-neutral-950 rounded-lg px-4 py-3 flex items-center justify-center mb-2">
            <img src="/blackridge-logo.png" alt="BlackRidge Platforms" className="h-10 w-auto" />
          </div>
          <DialogTitle className="sr-only">Proposal</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          {mode === "edit" ? (
            <Input value={title} onChange={(e) => setTitle(e.target.value)} className="font-semibold" data-testid="input-proposal-title" />
          ) : (
            <h2 className="text-lg font-bold">{title}</h2>
          )}

          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex items-center rounded-md border border-border/60 p-0.5">
              <button
                onClick={() => setMode("view")}
                className={`px-2.5 py-1 rounded text-xs font-medium ${mode === "view" ? "bg-primary/15 text-primary" : "text-muted-foreground"}`}
                data-testid="button-proposal-view"
              >
                Preview
              </button>
              <button
                onClick={() => setMode("edit")}
                className={`px-2.5 py-1 rounded text-xs font-medium ${mode === "edit" ? "bg-primary/15 text-primary" : "text-muted-foreground"}`}
                data-testid="button-proposal-edit"
              >
                Edit
              </button>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-muted-foreground">$</span>
              <Input
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="Amount"
                className="h-8 w-28"
                data-testid="input-proposal-amount"
              />
            </div>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger className="h-8 w-32" data-testid="select-proposal-status"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="draft">Draft</SelectItem>
                <SelectItem value="sent">Sent</SelectItem>
                <SelectItem value="accepted">Accepted</SelectItem>
                <SelectItem value="declined">Declined</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {mode === "edit" ? (
            <Textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={20}
              className="font-mono text-xs"
              data-testid="input-proposal-content"
            />
          ) : (
            <div className="rounded-lg border border-border/50 bg-card p-5">
              <ProposalContent content={content} />
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button
            variant="destructive"
            size="sm"
            className="mr-auto"
            onClick={() => { if (confirm("Delete this proposal?")) deleteMutation.mutate(); }}
            disabled={deleteMutation.isPending}
            data-testid="button-delete-proposal"
          >
            <Trash2 className="h-4 w-4 mr-1" /> Delete
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending}
            data-testid="button-save-proposal"
          >
            {saveMutation.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Save className="h-4 w-4 mr-1" />}
            Save
          </Button>
          <Button
            size="sm"
            onClick={() => { if (confirm(`Email this proposal to ${lead.email}?`)) sendMutation.mutate(); }}
            disabled={sendMutation.isPending}
            data-testid="button-send-proposal"
          >
            {sendMutation.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Send className="h-4 w-4 mr-1" />}
            Send to Client
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

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
  const [view, setView] = useState<"leads" | "calendar">("leads");

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
    const matchesStatus =
      statusFilter === "all" ? lead.status !== "won" : lead.status === statusFilter;
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
        <div className="max-w-7xl mx-auto px-4 sm:px-6 flex items-center justify-between gap-3 h-14 sm:h-16">
          <div className="flex items-center gap-3 sm:gap-4 min-w-0">
            <div className="flex items-center gap-2 shrink-0">
              <div className="bg-neutral-950 rounded-md px-2.5 py-1.5 flex items-center">
                <img src="/blackridge-logo.png" alt="BlackRidge Platforms" className="h-6 sm:h-7 w-auto" />
              </div>
              <span className="font-semibold text-[10px] tracking-[0.2em] uppercase text-primary border-l border-border/40 pl-2">CRM</span>
            </div>
            <div className="hidden sm:flex items-center rounded-md border border-border/60 p-0.5">
              <button
                onClick={() => setView("leads")}
                className={`flex items-center gap-1.5 px-3 py-1 rounded text-xs font-medium transition-colors ${view === "leads" ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground"}`}
                data-testid="button-view-leads"
              >
                <Users className="h-3.5 w-3.5" /> Leads
              </button>
              <button
                onClick={() => setView("calendar")}
                className={`flex items-center gap-1.5 px-3 py-1 rounded text-xs font-medium transition-colors ${view === "calendar" ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground"}`}
                data-testid="button-view-calendar"
              >
                <CalendarDays className="h-3.5 w-3.5" /> Calendar
              </button>
            </div>
          </div>

          {/* Desktop actions */}
          <div className="hidden sm:flex items-center gap-2">
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
              <span className="text-sm text-muted-foreground" data-testid="text-admin-user">
                {user.firstName}
              </span>
            )}
            <Button variant="ghost" size="sm" onClick={() => setMfaOpen(true)} data-testid="button-mfa-settings">
              <Shield className="h-4 w-4 mr-1" />
              MFA
            </Button>
            <Button variant="ghost" size="sm" onClick={() => logout()} data-testid="button-logout">
              <LogOut className="h-4 w-4 mr-1" />
              Logout
            </Button>
          </div>

          {/* Mobile menu */}
          <div className="sm:hidden">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="icon" data-testid="button-mobile-menu">
                  <Menu className="h-5 w-5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52">
                <DropdownMenuItem onClick={() => setView("leads")} data-testid="menu-view-leads">
                  <Users className="h-4 w-4 mr-2" /> Leads
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setView("calendar")} data-testid="menu-view-calendar">
                  <CalendarDays className="h-4 w-4 mr-2" /> Calendar
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setAddLeadOpen(true)} data-testid="menu-add-lead">
                  <Plus className="h-4 w-4 mr-2" /> Add Lead
                </DropdownMenuItem>
                <DropdownMenuItem onClick={handleExportCSV} data-testid="menu-export-csv">
                  <Download className="h-4 w-4 mr-2" /> Export CSV
                </DropdownMenuItem>
                <DropdownMenuItem asChild data-testid="menu-ops-portal">
                  <a href="/admin/ops"><Zap className="h-4 w-4 mr-2" /> Ops Portal</a>
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setMfaOpen(true)} data-testid="menu-mfa">
                  <Shield className="h-4 w-4 mr-2" /> MFA Settings
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => logout()} data-testid="menu-logout">
                  <LogOut className="h-4 w-4 mr-2" /> Logout
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8">
        {view === "calendar" ? (
          <CrmCalendar leads={leads} />
        ) : (
        <>
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
              <CardContent className="p-4">
                <div className="flex items-center justify-between gap-2 mb-2.5">
                  <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{stat.label}</span>
                  <stat.icon className={`h-4 w-4 ${stat.color}`} />
                </div>
                <p className={`text-3xl font-semibold tabular-nums tracking-tight ${stat.color}`} data-testid={stat.testId}>
                  {leadsLoading ? "-" : stat.value}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
          <Card className="border-border/50 bg-card/50">
            <CardContent className="p-4">
              <div className="flex items-center justify-between gap-2 mb-2.5">
                <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Pipeline Value</span>
                <Target className="h-4 w-4 text-cyan-400" />
              </div>
              <p className="text-3xl font-semibold tabular-nums tracking-tight text-cyan-400" data-testid="text-pipeline-total">
                {leadsLoading ? "-" : formatCurrency(stats.pipelineValue)}
              </p>
              <p className="text-xs text-muted-foreground mt-1.5">Total value of open leads in play</p>
            </CardContent>
          </Card>
          <Card className="border-border/50 bg-card/50">
            <CardContent className="p-4">
              <div className="flex items-center justify-between gap-2 mb-2.5">
                <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Weighted Forecast</span>
                <Percent className="h-4 w-4 text-purple-400" />
              </div>
              <p className="text-3xl font-semibold tabular-nums tracking-tight text-purple-400" data-testid="text-weighted-forecast">
                {leadsLoading ? "-" : formatCurrency(stats.weightedForecast)}
              </p>
              <p className="text-xs text-muted-foreground mt-1.5">Pipeline adjusted for close probability</p>
            </CardContent>
          </Card>
          <Card className="border-border/50 bg-card/50">
            <CardContent className="p-4">
              <div className="flex items-center justify-between gap-2 mb-2.5">
                <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Monthly Revenue Goal</span>
                <DollarSign className="h-4 w-4 text-green-400" />
              </div>
              <div className="flex items-baseline justify-between gap-2 mb-2">
                <span className="text-3xl font-semibold tabular-nums tracking-tight text-green-400" data-testid="text-monthly-revenue">
                  {formatCurrency(monthlyWonValue)}
                </span>
                <span className="text-xs text-muted-foreground tabular-nums">/ {formatCurrency(monthlyGoal)}</span>
              </div>
              <Progress value={goalProgress} className="h-2" data-testid="progress-monthly-goal" />
              <span className="text-xs text-muted-foreground mt-1.5 block">{goalProgress}% of goal</span>
            </CardContent>
          </Card>
        </div>

        <div className={`grid gap-4 mb-8 items-start ${Object.keys(sourceBreakdown).length > 0 && !leadsLoading ? "lg:grid-cols-2" : ""}`}>
          <HotLeadsWidget onOpenDetail={openDetail} leads={leads} />

          {Object.keys(sourceBreakdown).length > 0 && !leadsLoading && (
            <Card className="border-border/50 bg-card/50">
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
                            <span className="font-medium text-foreground tabular-nums">{formatCurrency(data.value)}</span>
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
        </div>

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
        </>
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