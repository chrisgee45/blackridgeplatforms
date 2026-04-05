import { useState, useRef, useMemo, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { Slider } from "@/components/ui/slider";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import {
  Search,
  Plus,
  Upload,
  Loader2,
  ExternalLink,
  Brain,
  Mail,
  StopCircle,
  ArrowRight,
  ArrowRightCircle,
  Trash2,
  Target,
  TrendingUp,
  Users,
  MailCheck,
  ArrowUpDown,
  MousePointerClick,
  AlertTriangle,
  Send,
  Eye,
  ChevronDown,
  ChevronUp,
  RefreshCw,
  ShieldAlert,
  Activity,
  Settings,
  PauseCircle,
  PlayCircle,
  FileText,
  Clock,
  ChevronLeft,
  ChevronRight,
  MessageSquare,
  Bot,
  User,
  Lightbulb,
  Sparkles,
  Pencil,
  Check,
  Radio,
  Zap,
  Reply,
  MailOpen,
  CheckCircle2,
  UserPlus,
  Radar,
  Globe,
  MapPin,
  Building2,
  CheckCircle,
  XCircle,
  SkipForward,
  SearchX,
  AlertCircle,
} from "lucide-react";
import type { OutreachLead, EmailEvent, LeadCampaignEnrollment, OutreachJob, OutreachCampaign, CampaignStep, LeadConversation, AgentInsight, ContactSubmission } from "@shared/schema";

type LeadWithCampaign = OutreachLead & {
  currentStep: number;
  enrolledAt?: string;
  campaignCompleted: boolean;
  campaignStopped: boolean;
  stopReason?: string;
  lastEmailStatus?: string;
  lastEmailAt?: string;
  nextScheduledAt?: string;
};

type LeadDetail = {
  lead: OutreachLead;
  enrollment: LeadCampaignEnrollment | null;
  events: EmailEvent[];
  nextJob: OutreachJob | null;
};

type EmailStats = {
  sent: number;
  delivered: number;
  opened: number;
  clicked: number;
  bounced: number;
  responded: number;
  openRate: number;
  clickRate: number;
  bounceRate: number;
  engagementRate: number;
  responseRate: number;
  bounceRate7d: number;
  sentToday: number;
  dailySendCap: number;
  enrollmentsPaused: boolean;
  enrollmentsPausedReason?: string;
};

type SortField = "aiScore" | "valueEstimate" | "createdAt" | "businessName" | "badSiteScore";
type SortDir = "asc" | "desc";

const STATUS_LABELS: Record<string, string> = {
  new: "New",
  enrolled: "Enrolled",
  engaged: "Engaged",
  nurture: "Nurture",
  won: "Won",
  lost: "Lost",
  do_not_contact: "DNC",
  converted: "Converted",
  bounced: "Bounced",
  needs_review: "Needs Review",
};

const STATUS_VARIANTS: Record<string, string> = {
  new: "bg-blue-500/15 text-blue-400 border-blue-500/30",
  enrolled: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  engaged: "bg-green-500/15 text-green-400 border-green-500/30",
  nurture: "bg-indigo-500/15 text-indigo-400 border-indigo-500/30",
  won: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  lost: "bg-red-500/15 text-red-400 border-red-500/30",
  do_not_contact: "bg-muted text-muted-foreground border-border",
  converted: "bg-purple-500/15 text-purple-400 border-purple-500/30",
  bounced: "bg-rose-500/15 text-rose-400 border-rose-500/30",
  needs_review: "bg-yellow-500/15 text-yellow-400 border-yellow-500/30",
};

type ViewTab = "leads" | "conversations" | "agent-report" | "agent-chat";

export default function OutreachPage() {
  const { toast } = useToast();
  const [activeView, setActiveView] = useState<ViewTab>("leads");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [industryFilter, setIndustryFilter] = useState<string>("all");
  const [scoreRange, setScoreRange] = useState<string>("all");
  const [dateRange, setDateRange] = useState<string>("all");
  const [emailActivity, setEmailActivity] = useState<string>("all");
  const [sourceFilter, setSourceFilter] = useState<string>("all");
  const [redesignFilter, setRedesignFilter] = useState<string>("all");
  const [badScoreFilter, setBadScoreFilter] = useState<string>("all");
  const [sortField, setSortField] = useState<SortField>("createdAt");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [showScanDialog, setShowScanDialog] = useState(false);
  const [showBadSiteDialog, setShowBadSiteDialog] = useState(false);
  const [showCsvDialog, setShowCsvDialog] = useState(false);
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);
  const [checkedLeads, setCheckedLeads] = useState<Set<string>>(new Set());
  const [showBulkCampaignPicker, setShowBulkCampaignPicker] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const LEADS_PER_PAGE = 15;
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: leads = [], isLoading } = useQuery<LeadWithCampaign[]>({
    queryKey: ["/api/outreach/leads"],
  });

  const { data: emailStats } = useQuery<EmailStats>({
    queryKey: ["/api/outreach/stats"],
  });

  const { data: leadDetail, isLoading: detailLoading } = useQuery<LeadDetail>({
    queryKey: ["/api/outreach/leads", selectedLeadId],
    enabled: !!selectedLeadId,
  });

  const { data: bulkCampaigns = [] } = useQuery<OutreachCampaign[]>({
    queryKey: ["/api/outreach/campaigns"],
    enabled: showBulkCampaignPicker,
  });

  const resumeEnrollmentsMutation = useMutation({
    mutationFn: () => apiRequest("PATCH", "/api/outreach/settings", { enrollmentsPaused: false }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/outreach/stats"] });
      toast({ title: "Enrollments resumed" });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const bulkEnrollMutation = useMutation({
    mutationFn: ({ leadIds, campaignId }: { leadIds: string[]; campaignId: string }) =>
      apiRequest("POST", "/api/outreach/leads/bulk-enroll", { leadIds, campaignId }),
    onSuccess: async (res: any) => {
      const data = typeof res === "object" ? res : {};
      queryClient.invalidateQueries({ queryKey: ["/api/outreach/leads"] });
      queryClient.invalidateQueries({ queryKey: ["/api/outreach/stats"] });
      setCheckedLeads(new Set());
      setShowBulkCampaignPicker(false);
      toast({
        title: "Bulk enrollment complete",
        description: `Enrolled ${data.enrolled || 0} leads. ${data.skipped || 0} skipped.${data.errors?.length ? " " + data.errors.join("; ") : ""}`,
      });
    },
    onError: (err: any) => toast({ title: "Error", description: String(err?.message || "Bulk enroll failed"), variant: "destructive" }),
  });

  const deleteLeadMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/outreach/leads/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/outreach/leads"] });
      queryClient.invalidateQueries({ queryKey: ["/api/outreach/stats"] });
      toast({ title: "Lead deleted" });
    },
    onError: (err: any) => toast({ title: "Failed to delete lead", description: String(err?.message || ""), variant: "destructive" }),
  });

  const bulkDeleteMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      const res = await apiRequest("POST", "/api/outreach/leads/bulk-delete", { ids });
      return res.json();
    },
    onSuccess: (data) => {
      setCheckedLeads(new Set());
      queryClient.invalidateQueries({ queryKey: ["/api/outreach/leads"] });
      queryClient.invalidateQueries({ queryKey: ["/api/outreach/stats"] });
      toast({ title: "Leads deleted", description: `${data.deleted} lead${data.deleted !== 1 ? "s" : ""} deleted.` });
    },
    onError: (err: any) => toast({ title: "Bulk delete failed", description: String(err?.message || ""), variant: "destructive" }),
  });

  const industries = useMemo(() => {
    const set = new Set<string>();
    leads.forEach(l => { if (l.industry) set.add(l.industry); });
    return Array.from(set).sort();
  }, [leads]);

  const filtered = useMemo(() => {
    const now = new Date();
    const day7 = new Date(now.getTime() - 7 * 86400000);
    const day30 = new Date(now.getTime() - 30 * 86400000);

    let result = leads.filter(l => {
      const matchesSearch = !search ||
        l.businessName.toLowerCase().includes(search.toLowerCase()) ||
        (l.email?.toLowerCase().includes(search.toLowerCase())) ||
        l.contactName?.toLowerCase().includes(search.toLowerCase()) ||
        l.industry?.toLowerCase().includes(search.toLowerCase());
      const matchesStatus = statusFilter === "all" || l.status === statusFilter;
      const matchesIndustry = industryFilter === "all" || l.industry === industryFilter;
      const matchesScore = scoreRange === "all" ||
        (scoreRange === "high" && (l.aiScore ?? 0) >= 70) ||
        (scoreRange === "mid" && (l.aiScore ?? 0) >= 40 && (l.aiScore ?? 0) < 70) ||
        (scoreRange === "low" && (l.aiScore ?? 0) < 40 && l.aiScore !== null);
      const createdAt = new Date(l.createdAt);
      const matchesDate = dateRange === "all" ||
        (dateRange === "7d" && createdAt >= day7) ||
        (dateRange === "30d" && createdAt >= day30);
      const matchesEmailActivity = emailActivity === "all" ||
        (emailActivity === "opened" && (l.lastEmailStatus === "opened" || l.lastEmailStatus === "clicked")) ||
        (emailActivity === "delivered" && l.lastEmailStatus === "delivered") ||
        (emailActivity === "bounced" && l.lastEmailStatus === "bounced") ||
        (emailActivity === "sent" && l.lastEmailStatus === "sent") ||
        (emailActivity === "no_email" && !l.lastEmailStatus);
      const matchesSource = sourceFilter === "all" ||
        (sourceFilter === "bad_site_finder" && l.sourceType === "bad_site_finder") ||
        (sourceFilter === "scan" && (l.sourceType === "scan" || !l.sourceType));
      const matchesRedesign = redesignFilter === "all" ||
        (redesignFilter === "yes" && l.redesignWorthy === true) ||
        (redesignFilter === "no" && l.redesignWorthy === false);
      const matchesBadScore = badScoreFilter === "all" ||
        (badScoreFilter === "high" && (l.badSiteScore ?? 0) >= 70) ||
        (badScoreFilter === "mid" && (l.badSiteScore ?? 0) >= 40 && (l.badSiteScore ?? 0) < 70) ||
        (badScoreFilter === "low" && (l.badSiteScore ?? 0) < 40 && l.badSiteScore !== null);
      return matchesSearch && matchesStatus && matchesIndustry && matchesScore && matchesDate && matchesEmailActivity && matchesSource && matchesRedesign && matchesBadScore;
    });

    result.sort((a, b) => {
      let cmp = 0;
      if (sortField === "aiScore") cmp = (a.aiScore ?? 0) - (b.aiScore ?? 0);
      else if (sortField === "valueEstimate") cmp = (a.valueEstimate ?? 0) - (b.valueEstimate ?? 0);
      else if (sortField === "businessName") cmp = a.businessName.localeCompare(b.businessName);
      else if (sortField === "badSiteScore") cmp = (a.badSiteScore ?? 0) - (b.badSiteScore ?? 0);
      else cmp = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      return sortDir === "desc" ? -cmp : cmp;
    });

    return result;
  }, [leads, search, statusFilter, industryFilter, scoreRange, dateRange, emailActivity, sourceFilter, redesignFilter, badScoreFilter, sortField, sortDir]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / LEADS_PER_PAGE));
  const safePage = Math.min(currentPage, totalPages);
  const paginatedLeads = filtered.slice((safePage - 1) * LEADS_PER_PAGE, safePage * LEADS_PER_PAGE);

  useEffect(() => {
    setCurrentPage(1);
  }, [search, statusFilter, industryFilter, scoreRange, dateRange, emailActivity, sourceFilter, redesignFilter, badScoreFilter]);

  const now = new Date();
  const day7 = new Date(now.getTime() - 7 * 86400000);
  const day30 = new Date(now.getTime() - 30 * 86400000);

  const stats = {
    newLeads7d: leads.filter(l => new Date(l.createdAt) >= day7).length,
    newLeads30d: leads.filter(l => new Date(l.createdAt) >= day30).length,
    enrolled: leads.filter(l => l.status === "enrolled").length,
    engaged: leads.filter(l => l.status === "engaged").length,
    pipelineValue: leads
      .filter(l => ["new", "enrolled", "engaged"].includes(l.status))
      .reduce((sum, l) => sum + (l.valueEstimate || 0), 0),
  };

  function toggleSort(field: SortField) {
    if (sortField === field) {
      setSortDir(d => d === "desc" ? "asc" : "desc");
    } else {
      setSortField(field);
      setSortDir("desc");
    }
  }

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) return <ArrowUpDown className="w-3 h-3 ml-1 opacity-30" />;
    return sortDir === "desc"
      ? <ChevronDown className="w-3 h-3 ml-1" />
      : <ChevronUp className="w-3 h-3 ml-1" />;
  };

  return (
    <div className="p-3 sm:p-6 space-y-4 sm:space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight" data-testid="text-outreach-title">Outreach Engine</h1>
          <p className="text-muted-foreground text-sm mt-1">AI-powered lead intake and email campaign engine</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex rounded-md border overflow-visible">
            <Button
              variant="ghost"
              className={`rounded-none toggle-elevate ${activeView === "leads" ? "toggle-elevated" : ""}`}
              onClick={() => setActiveView("leads")}
              data-testid="button-view-leads"
            >
              <Users className="w-4 h-4 mr-1.5" /> Leads
            </Button>
            <Button
              variant="ghost"
              className={`rounded-none toggle-elevate ${activeView === "conversations" ? "toggle-elevated" : ""}`}
              onClick={() => setActiveView("conversations")}
              data-testid="button-view-conversations"
            >
              <Mail className="w-4 h-4 mr-1.5" /> Conversations
            </Button>
            <Button
              variant="ghost"
              className={`rounded-none toggle-elevate ${activeView === "agent-report" ? "toggle-elevated" : ""}`}
              onClick={() => setActiveView("agent-report")}
              data-testid="button-view-agent-report"
            >
              <Bot className="w-4 h-4 mr-1.5" /> Agent Report
            </Button>
            <Button
              variant="ghost"
              className={`rounded-none toggle-elevate ${activeView === "agent-chat" ? "toggle-elevated" : ""}`}
              onClick={() => setActiveView("agent-chat")}
              data-testid="button-view-agent-chat"
            >
              <MessageSquare className="w-4 h-4 mr-1.5" /> Agent Chat
            </Button>
          </div>
          {activeView === "leads" && (
            <>
              <Button onClick={() => setShowScanDialog(true)} variant="outline" data-testid="button-scan-leads">
                <Radar className="w-4 h-4 mr-2" />
                Scan for Leads
              </Button>
              <Button onClick={() => setShowBadSiteDialog(true)} variant="outline" data-testid="button-bad-site-finder">
                <SearchX className="w-4 h-4 mr-2" />
                Bad Website Finder
              </Button>
              <Button onClick={() => setShowCsvDialog(true)} variant="outline" data-testid="button-csv-upload">
                <Upload className="w-4 h-4 mr-2" />
                CSV Upload
              </Button>
              <Button onClick={() => setShowAddDialog(true)} data-testid="button-add-lead">
                <Plus className="w-4 h-4 mr-2" />
                Add Lead
              </Button>
            </>
          )}
        </div>
      </div>

      {activeView === "agent-report" ? (
        <AgentReportView />
      ) : activeView === "agent-chat" ? (
        <AgentChatView />
      ) : activeView === "conversations" ? (
        <ConversationsInboxView onOpenLead={(id) => { setSelectedLeadId(id); setActiveView("leads"); }} />
      ) : (
      <>

      {emailStats?.enrollmentsPaused && (
        <Card className="border-red-500/30 bg-red-500/5">
          <CardContent className="p-3 flex items-center gap-3">
            <ShieldAlert className="w-5 h-5 text-red-400 shrink-0" />
            <div className="flex-1">
              <p className="text-sm font-medium text-red-400" data-testid="text-enrollment-paused-warning">Enrollments Paused</p>
              <p className="text-xs text-muted-foreground">{emailStats.enrollmentsPausedReason || "New lead campaign enrollments are currently paused."}</p>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => resumeEnrollmentsMutation.mutate()}
              disabled={resumeEnrollmentsMutation.isPending}
              data-testid="button-resume-enrollments"
            >
              <PlayCircle className="w-3.5 h-3.5 mr-1" /> Resume
            </Button>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-12 gap-3">
        <StatCard label="New (7d)" value={stats.newLeads7d} icon={Users} />
        <StatCard label="New (30d)" value={stats.newLeads30d} icon={Users} />
        <StatCard label="Enrolled" value={stats.enrolled} icon={Mail} />
        <StatCard label="Engaged" value={stats.engaged} icon={Target} />
        <StatCard label="Sent Today" value={`${emailStats?.sentToday ?? 0}/${emailStats?.dailySendCap ?? 20}`} icon={Send} />
        <StatCard label="Delivered" value={emailStats?.delivered ?? 0} icon={CheckCircle2} />
        <StatCard label="Opened" value={emailStats?.opened ?? 0} icon={MailOpen} />
        <StatCard label="Open Rate" value={`${emailStats?.openRate ?? 0}%`} icon={Eye} />
        <StatCard label="Responded" value={emailStats?.responded ?? 0} icon={Reply} />
        <StatCard label="Bounced" value={emailStats?.bounced ?? 0} icon={AlertTriangle} highlight={((emailStats?.bounceRate7d ?? 0) > 5) ? "red" : undefined} />
        <StatCard label="Clicked" value={emailStats?.clicked ?? 0} icon={MousePointerClick} />
        <StatCard label="Pipeline" value={`$${stats.pipelineValue.toLocaleString()}`} icon={TrendingUp} />
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search leads..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-9"
            data-testid="input-search-leads"
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-36" data-testid="select-status-filter">
            <SelectValue placeholder="All Statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            {Object.entries(STATUS_LABELS).map(([k, v]) => (
              <SelectItem key={k} value={k}>{v}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={industryFilter} onValueChange={setIndustryFilter}>
          <SelectTrigger className="w-36" data-testid="select-industry-filter">
            <SelectValue placeholder="All Industries" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Industries</SelectItem>
            {industries.map(ind => (
              <SelectItem key={ind} value={ind}>{ind}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={emailActivity} onValueChange={setEmailActivity}>
          <SelectTrigger className="w-40" data-testid="select-email-activity-filter">
            <SelectValue placeholder="Email Activity" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Email Activity</SelectItem>
            <SelectItem value="opened">Opened / Clicked</SelectItem>
            <SelectItem value="delivered">Delivered</SelectItem>
            <SelectItem value="bounced">Bounced</SelectItem>
            <SelectItem value="sent">Sent Only</SelectItem>
            <SelectItem value="no_email">No Email Sent</SelectItem>
          </SelectContent>
        </Select>
        <Select value={scoreRange} onValueChange={setScoreRange}>
          <SelectTrigger className="w-36" data-testid="select-score-filter">
            <SelectValue placeholder="All Scores" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Scores</SelectItem>
            <SelectItem value="high">High (70+)</SelectItem>
            <SelectItem value="mid">Medium (40-69)</SelectItem>
            <SelectItem value="low">Low (&lt;40)</SelectItem>
          </SelectContent>
        </Select>
        <Select value={dateRange} onValueChange={setDateRange}>
          <SelectTrigger className="w-36" data-testid="select-date-filter">
            <SelectValue placeholder="All Time" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Time</SelectItem>
            <SelectItem value="7d">Last 7 Days</SelectItem>
            <SelectItem value="30d">Last 30 Days</SelectItem>
          </SelectContent>
        </Select>
        <Select value={sourceFilter} onValueChange={setSourceFilter}>
          <SelectTrigger className="w-36" data-testid="select-source-filter">
            <SelectValue placeholder="All Sources" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Sources</SelectItem>
            <SelectItem value="scan">Lead Scanner</SelectItem>
            <SelectItem value="bad_site_finder">Bad Site Finder</SelectItem>
          </SelectContent>
        </Select>
        <Select value={badScoreFilter} onValueChange={setBadScoreFilter}>
          <SelectTrigger className="w-40" data-testid="select-bad-score-filter">
            <SelectValue placeholder="Bad Site Score" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Bad Scores</SelectItem>
            <SelectItem value="high">High (70+)</SelectItem>
            <SelectItem value="mid">Medium (40-69)</SelectItem>
            <SelectItem value="low">Low (&lt;40)</SelectItem>
          </SelectContent>
        </Select>
        <Select value={redesignFilter} onValueChange={setRedesignFilter}>
          <SelectTrigger className="w-40" data-testid="select-redesign-filter">
            <SelectValue placeholder="Redesign Worthy" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="yes">Redesign Worthy</SelectItem>
            <SelectItem value="no">Not Redesign Worthy</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {checkedLeads.size > 0 && (
        <Card className="border-amber-500/30 bg-amber-500/5">
          <CardContent className="p-3 flex items-center gap-3 flex-wrap">
            <span className="text-sm font-medium">{checkedLeads.size} lead{checkedLeads.size > 1 ? "s" : ""} selected</span>
            {!showBulkCampaignPicker ? (
              <>
                <Button
                  size="sm"
                  onClick={() => setShowBulkCampaignPicker(true)}
                  data-testid="button-enroll-selected"
                >
                  <PlayCircle className="w-3.5 h-3.5 mr-1" /> Enroll Selected
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="text-red-600 border-red-200 hover:bg-red-50"
                  data-testid="button-bulk-delete"
                  disabled={bulkDeleteMutation.isPending || checkedLeads.size === 0}
                  onClick={() => {
                    if (window.confirm(`Delete ${checkedLeads.size} lead${checkedLeads.size > 1 ? "s" : ""}? This cannot be undone.`)) {
                      bulkDeleteMutation.mutate(Array.from(checkedLeads));
                    }
                  }}
                >
                  {bulkDeleteMutation.isPending ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <Trash2 className="w-3.5 h-3.5 mr-1" />}
                  Delete Selected
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setCheckedLeads(new Set())} data-testid="button-clear-selection">
                  Clear
                </Button>
              </>
            ) : (
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs text-muted-foreground">Select campaign:</span>
                {bulkCampaigns.map(c => (
                  <Button
                    key={c.id}
                    size="sm"
                    variant="outline"
                    onClick={() => bulkEnrollMutation.mutate({ leadIds: Array.from(checkedLeads), campaignId: c.id })}
                    disabled={bulkEnrollMutation.isPending}
                    data-testid={`button-bulk-campaign-${c.id}`}
                  >
                    {bulkEnrollMutation.isPending ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <Mail className="w-3.5 h-3.5 mr-1" />}
                    {c.name}
                  </Button>
                ))}
                <Button size="sm" variant="ghost" onClick={() => setShowBulkCampaignPicker(false)}>Cancel</Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {isLoading ? (
        <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
      ) : filtered.length === 0 ? (
        <Card><CardContent className="py-12 text-center text-muted-foreground">No outreach leads found. Add your first lead or upload a CSV.</CardContent></Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table className="min-w-[1200px]">
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10">
                      <input
                        type="checkbox"
                        checked={paginatedLeads.length > 0 && paginatedLeads.every(l => checkedLeads.has(l.id))}
                        onChange={e => {
                          if (e.target.checked) {
                            setCheckedLeads(new Set(filtered.map(l => l.id)));
                          } else {
                            setCheckedLeads(new Set());
                          }
                        }}
                        className="rounded border-border"
                        data-testid="checkbox-select-all"
                      />
                    </TableHead>
                    <TableHead className="whitespace-nowrap">
                      <button className="flex items-center text-xs font-medium" onClick={() => toggleSort("businessName")} data-testid="sort-business">
                        Business <SortIcon field="businessName" />
                      </button>
                    </TableHead>
                    <TableHead className="whitespace-nowrap">Contact</TableHead>
                    <TableHead className="whitespace-nowrap">Industry</TableHead>
                    <TableHead className="text-center whitespace-nowrap">
                      <button className="flex items-center text-xs font-medium mx-auto" onClick={() => toggleSort("aiScore")} data-testid="sort-score">
                        AI Score <SortIcon field="aiScore" />
                      </button>
                    </TableHead>
                    <TableHead className="text-center whitespace-nowrap">
                      <button className="flex items-center text-xs font-medium mx-auto" onClick={() => toggleSort("badSiteScore")} data-testid="sort-bad-score">
                        Bad Site <SortIcon field="badSiteScore" />
                      </button>
                    </TableHead>
                    <TableHead className="text-right whitespace-nowrap">
                      <button className="flex items-center text-xs font-medium ml-auto" onClick={() => toggleSort("valueEstimate")} data-testid="sort-value">
                        Est. Value <SortIcon field="valueEstimate" />
                      </button>
                    </TableHead>
                    <TableHead className="whitespace-nowrap">Status</TableHead>
                    <TableHead className="text-center whitespace-nowrap">Step</TableHead>
                    <TableHead className="whitespace-nowrap">Last Activity</TableHead>
                    <TableHead className="whitespace-nowrap">Next Send</TableHead>
                    <TableHead className="text-right whitespace-nowrap">
                      <button className="flex items-center text-xs font-medium ml-auto" onClick={() => toggleSort("createdAt")} data-testid="sort-created">
                        Created <SortIcon field="createdAt" />
                      </button>
                    </TableHead>
                    <TableHead className="w-10" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {paginatedLeads.map(lead => (
                    <LeadRow
                      key={lead.id}
                      lead={lead}
                      checked={checkedLeads.has(lead.id)}
                      onCheck={v => {
                        setCheckedLeads(prev => {
                          const next = new Set(prev);
                          if (v) next.add(lead.id); else next.delete(lead.id);
                          return next;
                        });
                      }}
                      onSelect={() => setSelectedLeadId(lead.id)}
                      onDelete={(id) => deleteLeadMutation.mutate(id)}
                      deleteDisabled={deleteLeadMutation.isPending}
                    />
                  ))}
                </TableBody>
              </Table>
            </div>
            {totalPages > 1 && (
              <div className="flex items-center justify-between px-4 py-3 border-t border-border/50">
                <span className="text-xs text-muted-foreground">
                  Showing {(safePage - 1) * LEADS_PER_PAGE + 1}–{Math.min(safePage * LEADS_PER_PAGE, filtered.length)} of {filtered.length} leads
                </span>
                <div className="flex items-center gap-1">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                    disabled={safePage <= 1}
                    data-testid="button-prev-page"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </Button>
                  {Array.from({ length: totalPages }, (_, i) => i + 1)
                    .filter(p => p === 1 || p === totalPages || Math.abs(p - safePage) <= 1)
                    .map((p, idx, arr) => {
                      const prev = arr[idx - 1];
                      const showEllipsis = prev !== undefined && p - prev > 1;
                      return (
                        <span key={p} className="flex items-center">
                          {showEllipsis && <span className="px-1 text-xs text-muted-foreground">...</span>}
                          <Button
                            variant={p === safePage ? "default" : "outline"}
                            size="sm"
                            className="w-8 h-8 p-0"
                            onClick={() => setCurrentPage(p)}
                            data-testid={`button-page-${p}`}
                          >
                            {p}
                          </Button>
                        </span>
                      );
                    })}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                    disabled={safePage >= totalPages}
                    data-testid="button-next-page"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <AgentSettingsSection />
        <AgentInsightsSection />
      </div>

      <FailedJobsSection />

      <CampaignTemplatesSection />
      </>
      )}

      <AddLeadDialog open={showAddDialog} onOpenChange={setShowAddDialog} />
      <CsvUploadDialog open={showCsvDialog} onOpenChange={setShowCsvDialog} fileInputRef={fileInputRef} />
      <ScanLeadsDialog open={showScanDialog} onOpenChange={setShowScanDialog} />
      <BadWebsiteFinderDialog open={showBadSiteDialog} onOpenChange={setShowBadSiteDialog} />
      <LeadDetailDrawer
        leadId={selectedLeadId}
        detail={leadDetail}
        loading={detailLoading}
        onClose={() => setSelectedLeadId(null)}
      />
    </div>
  );
}

function StatCard({ label, value, icon: Icon, highlight }: { label: string; value: string | number; icon: React.ComponentType<{className?: string}>; highlight?: "red" }) {
  return (
    <Card className={highlight === "red" ? "border-red-500/30" : undefined}>
      <CardContent className="p-3">
        <div className="flex items-center gap-1.5 mb-0.5">
          <Icon className={`w-3.5 h-3.5 ${highlight === "red" ? "text-red-400" : "text-muted-foreground"}`} />
          <span className="text-[11px] text-muted-foreground leading-tight">{label}</span>
        </div>
        <p className={`text-lg font-bold ${highlight === "red" ? "text-red-400" : ""}`}>{value}</p>
      </CardContent>
    </Card>
  );
}

function LeadRow({ lead, checked, onCheck, onSelect, onDelete, deleteDisabled }: { lead: LeadWithCampaign; checked: boolean; onCheck: (v: boolean) => void; onSelect: () => void; onDelete: (id: string) => void; deleteDisabled?: boolean }) {
  const lastActivity = lead.lastEmailAt
    ? new Date(lead.lastEmailAt).toLocaleDateString()
    : new Date(lead.createdAt).toLocaleDateString();

  const nextSend = lead.nextScheduledAt && !lead.campaignStopped && !lead.campaignCompleted
    ? new Date(lead.nextScheduledAt).toLocaleDateString()
    : null;

  return (
    <TableRow className="cursor-pointer hover-elevate" onClick={onSelect} data-testid={`row-lead-${lead.id}`}>
      <TableCell onClick={e => e.stopPropagation()}>
        <input
          type="checkbox"
          checked={checked}
          onChange={e => onCheck(e.target.checked)}
          className="rounded border-border"
          data-testid={`checkbox-lead-${lead.id}`}
        />
      </TableCell>
      <TableCell className="whitespace-nowrap">
        <div className="font-medium text-sm">{lead.businessName}</div>
        {lead.websiteUrl && (
          <a
            href={lead.websiteUrl.startsWith("http") ? lead.websiteUrl : `https://${lead.websiteUrl}`}
            target="_blank"
            rel="noopener"
            className="text-xs text-muted-foreground hover:text-primary flex items-center gap-1"
            onClick={e => e.stopPropagation()}
          >
            {lead.websiteUrl} <ExternalLink className="w-3 h-3" />
          </a>
        )}
      </TableCell>
      <TableCell className="whitespace-nowrap">
        <div className="text-sm">{lead.contactName || "-"}</div>
        <div className="text-xs text-muted-foreground">{lead.email || <span className="italic text-amber-400">Email needed</span>}</div>
      </TableCell>
      <TableCell className="text-sm whitespace-nowrap">{lead.industry || "-"}</TableCell>
      <TableCell className="text-center">
        {lead.aiScore !== null && lead.aiScore !== undefined ? (
          <Badge variant="outline" className={lead.aiScore >= 70 ? "border-green-500/50 text-green-400" : lead.aiScore >= 40 ? "border-amber-500/50 text-amber-400" : "border-red-500/50 text-red-400"}>
            {lead.aiScore}
          </Badge>
        ) : (
          <Loader2 className="w-3 h-3 animate-spin mx-auto text-muted-foreground" />
        )}
      </TableCell>
      <TableCell className="text-center">
        {lead.badSiteScore !== null && lead.badSiteScore !== undefined ? (
          <div className="flex flex-col items-center gap-0.5">
            <Badge variant="outline" className={lead.badSiteScore >= 70 ? "border-red-500/50 text-red-400" : lead.badSiteScore >= 40 ? "border-amber-500/50 text-amber-400" : "border-green-500/50 text-green-400"}>
              {lead.badSiteScore}
            </Badge>
            {lead.redesignWorthy && (
              <span className="text-[9px] text-red-400 font-medium">Redesign</span>
            )}
          </div>
        ) : (
          <span className="text-xs text-muted-foreground">-</span>
        )}
      </TableCell>
      <TableCell className="text-right text-sm whitespace-nowrap">
        {lead.valueEstimate ? `$${lead.valueEstimate.toLocaleString()}` : "-"}
      </TableCell>
      <TableCell className="whitespace-nowrap">
        <div className="flex items-center gap-1.5">
          <Badge variant="outline" className={STATUS_VARIANTS[lead.status] || ""}>
            {STATUS_LABELS[lead.status] || lead.status}
          </Badge>
          {(lead as any).awaitingHandoff && (
            <Badge className="bg-amber-500 text-black text-[10px] py-0 px-1.5 font-bold animate-pulse" data-testid={`badge-handoff-${lead.id}`}>
              HANDOFF NEEDED
            </Badge>
          )}
          {lead.crmLeadId && (
            <Badge variant="secondary" className="text-[10px] py-0 px-1.5" data-testid={`badge-crm-${lead.id}`}>
              CRM
            </Badge>
          )}
        </div>
      </TableCell>
      <TableCell className="text-center text-sm whitespace-nowrap">
        {lead.campaignStopped ? (
          <span className="text-muted-foreground">Stopped</span>
        ) : lead.campaignCompleted ? (
          <span className="text-muted-foreground">Done</span>
        ) : lead.currentStep > 0 ? (
          `${lead.currentStep}/5`
        ) : "-"}
      </TableCell>
      <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
        {lead.lastEmailStatus ? (
          <div>
            <span className={`capitalize font-medium ${
              lead.lastEmailStatus === "opened" || lead.lastEmailStatus === "clicked" ? "text-green-400" :
              lead.lastEmailStatus === "delivered" ? "text-blue-400" :
              lead.lastEmailStatus === "bounced" ? "text-red-400" :
              lead.lastEmailStatus === "sent" ? "text-muted-foreground" : ""
            }`}>
              {lead.lastEmailStatus === "opened" ? "Opened" :
               lead.lastEmailStatus === "clicked" ? "Clicked" :
               lead.lastEmailStatus === "bounced" ? "Bounced" :
               lead.lastEmailStatus}
            </span>
            <div className="text-xs">{lastActivity}</div>
          </div>
        ) : (
          <span className="text-xs">{lastActivity}</span>
        )}
      </TableCell>
      <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
        {nextSend || "-"}
      </TableCell>
      <TableCell className="text-right text-xs text-muted-foreground whitespace-nowrap">
        {new Date(lead.createdAt).toLocaleDateString()}
      </TableCell>
      <TableCell onClick={e => e.stopPropagation()}>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-muted-foreground hover:text-red-500"
          disabled={deleteDisabled}
          onClick={() => { if (confirm(`Delete "${lead.businessName}"?`)) onDelete(lead.id); }}
          data-testid={`button-delete-lead-${lead.id}`}
        >
          <Trash2 className="w-3.5 h-3.5" />
        </Button>
      </TableCell>
    </TableRow>
  );
}

function AddLeadDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { toast } = useToast();
  const [tab, setTab] = useState<"manual" | "crm">("manual");
  const [form, setForm] = useState({
    businessName: "", websiteUrl: "", industry: "", contactName: "", email: "", phone: "", location: "", notes: "",
  });
  const [crmSearch, setCrmSearch] = useState("");
  const [selectedCrmLead, setSelectedCrmLead] = useState<ContactSubmission | null>(null);

  const { data: crmLeads } = useQuery<ContactSubmission[]>({
    queryKey: ["/api/leads"],
    enabled: tab === "crm",
  });

  const filteredCrmLeads = useMemo(() => {
    if (!crmLeads) return [];
    const q = crmSearch.toLowerCase();
    return crmLeads.filter(l =>
      l.name.toLowerCase().includes(q) ||
      l.email.toLowerCase().includes(q) ||
      (l.company || "").toLowerCase().includes(q)
    );
  }, [crmLeads, crmSearch]);

  const mutation = useMutation({
    mutationFn: (data: typeof form) => {
      const payload = { ...data };
      if (!payload.businessName && payload.websiteUrl) {
        try {
          const hostname = new URL(payload.websiteUrl.startsWith("http") ? payload.websiteUrl : "https://" + payload.websiteUrl).hostname;
          payload.businessName = hostname.replace(/^www\./, "").split(".")[0].replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase());
        } catch {
          payload.businessName = payload.websiteUrl;
        }
      }
      if (!payload.email) payload.email = null as any;
      return apiRequest("POST", "/api/outreach/leads", payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/outreach/leads"] });
      queryClient.invalidateQueries({ queryKey: ["/api/outreach/stats"] });
      toast({ title: "Lead added", description: "AI analysis and campaign enrollment started." });
      onOpenChange(false);
      setForm({ businessName: "", websiteUrl: "", industry: "", contactName: "", email: "", phone: "", location: "", notes: "" });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const importMutation = useMutation({
    mutationFn: (crmLeadId: string) => apiRequest("POST", "/api/outreach/leads/import-from-crm", { crmLeadId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/outreach/leads"] });
      queryClient.invalidateQueries({ queryKey: ["/api/outreach/stats"] });
      toast({ title: "Lead imported from CRM", description: "AI analysis and campaign enrollment started." });
      onOpenChange(false);
      setSelectedCrmLead(null);
      setCrmSearch("");
    },
    onError: (err: any) => toast({ title: "Import failed", description: err.message, variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) { setTab("manual"); setSelectedCrmLead(null); setCrmSearch(""); } }}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Add Outreach Lead</DialogTitle></DialogHeader>
        <div className="flex gap-1 mb-4 p-1 bg-muted/50 rounded-lg">
          <button
            className={`flex-1 px-3 py-2 text-sm font-medium rounded-md transition-colors ${tab === "manual" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"}`}
            onClick={() => setTab("manual")}
            data-testid="tab-manual-lead"
          >
            <Plus className="w-4 h-4 inline mr-1" /> New Lead
          </button>
          <button
            className={`flex-1 px-3 py-2 text-sm font-medium rounded-md transition-colors ${tab === "crm" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"}`}
            onClick={() => setTab("crm")}
            data-testid="tab-crm-import"
          >
            <UserPlus className="w-4 h-4 inline mr-1" /> From CRM
          </button>
        </div>

        {tab === "manual" && (
          <>
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <Label>Business Name <span className="text-xs text-muted-foreground">(auto-derived from URL if blank)</span></Label>
                <Input value={form.businessName} onChange={e => setForm(p => ({ ...p, businessName: e.target.value }))} data-testid="input-business-name" />
              </div>
              <div className="col-span-2">
                <Label>Website URL *</Label>
                <Input value={form.websiteUrl} onChange={e => setForm(p => ({ ...p, websiteUrl: e.target.value }))} placeholder="example.com" data-testid="input-website-url" />
              </div>
              <div>
                <Label>Contact Name</Label>
                <Input value={form.contactName} onChange={e => setForm(p => ({ ...p, contactName: e.target.value }))} data-testid="input-contact-name" />
              </div>
              <div>
                <Label>Email <span className="text-xs text-muted-foreground">(AI will find if blank)</span></Label>
                <Input type="email" value={form.email} onChange={e => setForm(p => ({ ...p, email: e.target.value }))} placeholder="AI will research" data-testid="input-email" />
              </div>
              <div>
                <Label>Industry</Label>
                <Input value={form.industry} onChange={e => setForm(p => ({ ...p, industry: e.target.value }))} data-testid="input-industry" />
              </div>
              <div>
                <Label>Phone</Label>
                <Input value={form.phone} onChange={e => setForm(p => ({ ...p, phone: e.target.value }))} data-testid="input-phone" />
              </div>
              <div className="col-span-2">
                <Label>Location</Label>
                <Input value={form.location} onChange={e => setForm(p => ({ ...p, location: e.target.value }))} data-testid="input-location" />
              </div>
              <div className="col-span-2">
                <Label>Notes</Label>
                <Textarea value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} data-testid="input-notes" />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button
                onClick={() => mutation.mutate(form)}
                disabled={mutation.isPending || !form.websiteUrl}
                data-testid="button-submit-lead"
              >
                {mutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                Add Lead
              </Button>
            </DialogFooter>
          </>
        )}

        {tab === "crm" && (
          <>
            <div className="space-y-3">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  placeholder="Search CRM leads by name, email, or company..."
                  value={crmSearch}
                  onChange={e => setCrmSearch(e.target.value)}
                  className="pl-9"
                  data-testid="input-crm-search"
                />
              </div>
              <div className="max-h-64 overflow-y-auto border rounded-md divide-y divide-border/30">
                {filteredCrmLeads.length === 0 ? (
                  <p className="text-sm text-muted-foreground p-4 text-center">
                    {crmLeads ? "No matching CRM leads found" : "Loading..."}
                  </p>
                ) : filteredCrmLeads.map(l => (
                  <button
                    key={l.id}
                    className={`w-full text-left p-3 hover:bg-muted/50 transition-colors ${selectedCrmLead?.id === l.id ? "bg-primary/10 border-l-2 border-l-primary" : ""}`}
                    onClick={() => setSelectedCrmLead(l)}
                    data-testid={`crm-lead-${l.id}`}
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium">{l.name}</p>
                        <p className="text-xs text-muted-foreground">{l.email} {l.company ? `- ${l.company}` : ""}</p>
                      </div>
                      <Badge variant="outline" className="text-xs">{l.status}</Badge>
                    </div>
                  </button>
                ))}
              </div>
              {selectedCrmLead && (
                <Card className="bg-muted/30 border-primary/20">
                  <CardContent className="p-3">
                    <p className="text-sm font-medium mb-1">Selected: {selectedCrmLead.name}</p>
                    <p className="text-xs text-muted-foreground">{selectedCrmLead.email} {selectedCrmLead.company ? `- ${selectedCrmLead.company}` : ""}</p>
                    {selectedCrmLead.projectType && <p className="text-xs text-muted-foreground mt-1">Project: {selectedCrmLead.projectType}</p>}
                  </CardContent>
                </Card>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button
                onClick={() => selectedCrmLead && importMutation.mutate(selectedCrmLead.id)}
                disabled={importMutation.isPending || !selectedCrmLead}
                data-testid="button-import-crm-lead"
              >
                {importMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <UserPlus className="w-4 h-4 mr-2" />}
                Import to Outreach
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

const TARGET_FIELDS = [
  { key: "business_name", label: "Business Name", required: false },
  { key: "email", label: "Email", required: false },
  { key: "website_url", label: "Website URL", required: true },
  { key: "industry", label: "Industry", required: false },
  { key: "contact_name", label: "Contact Name", required: false },
  { key: "phone", label: "Phone", required: false },
  { key: "location", label: "Location", required: false },
  { key: "notes", label: "Notes", required: false },
] as const;

const HEADER_HINTS: Record<string, string[]> = {
  business_name: ["business_name", "businessname", "business", "company", "company_name", "companyname", "name", "organization", "org", "firm", "account"],
  email: ["email", "email_address", "emailaddress", "e-mail", "contact_email", "e_mail", "mail"],
  website_url: ["website_url", "websiteurl", "website", "url", "site", "web", "domain", "homepage"],
  industry: ["industry", "sector", "vertical", "category", "type", "niche"],
  contact_name: ["contact_name", "contactname", "contact", "person", "full_name", "fullname", "first_name", "firstname", "contact_person"],
  phone: ["phone", "phone_number", "phonenumber", "tel", "telephone", "mobile", "cell"],
  location: ["location", "city", "address", "region", "state", "country", "area", "zip", "postal"],
  notes: ["notes", "note", "comments", "comment", "description", "info", "details", "remarks"],
};

function guessMapping(csvHeader: string): string {
  const cleaned = csvHeader.toLowerCase().replace(/[^a-z0-9]/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "");
  for (const [field, aliases] of Object.entries(HEADER_HINTS)) {
    if (aliases.includes(cleaned)) return field;
  }
  return "";
}

function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        current += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        result.push(current.trim());
        current = "";
      } else {
        current += ch;
      }
    }
  }
  result.push(current.trim());
  return result;
}

type BadSiteResult = {
  businessName: string;
  url: string;
  badSiteScore: number;
  redesignWorthy: boolean;
  topProblems: string[];
  visualStyleAssessment: string;
  conversionAssessment: string;
  pitchAngle: string;
  openingLine: string;
  ruleCheckResults: Record<string, unknown>;
  industry?: string;
  location?: string;
};

function BadWebsiteFinderDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { toast } = useToast();
  const [keyword, setKeyword] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("OK");
  const [threshold, setThreshold] = useState(60);
  const [scanning, setScanning] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const [phase, setPhase] = useState("");
  const [results, setResults] = useState<BadSiteResult[]>([]);
  const [selectedForImport, setSelectedForImport] = useState<Set<number>>(new Set());
  const [importDone, setImportDone] = useState(false);
  const resultsEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    resultsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [results]);

  const importMutation = useMutation({
    mutationFn: (leads: BadSiteResult[]) =>
      apiRequest("POST", "/api/outreach/leads/bad-site-import", { leads, threshold }),
    onSuccess: async (res: any) => {
      const data = typeof res === "object" ? res : {};
      queryClient.invalidateQueries({ queryKey: ["/api/outreach/leads"] });
      queryClient.invalidateQueries({ queryKey: ["/api/outreach/stats"] });
      setImportDone(true);
      toast({
        title: "Import Complete",
        description: `Created ${data.created || 0} leads. ${data.skipped || 0} skipped.`,
      });
    },
    onError: (err: any) => toast({ title: "Import Error", description: err.message, variant: "destructive" }),
  });

  const startScan = async () => {
    if (!keyword.trim() || !city.trim()) {
      toast({ title: "Missing Info", description: "Please enter both keyword and city.", variant: "destructive" });
      return;
    }
    setScanning(true);
    setResults([]);
    setSelectedForImport(new Set());
    setImportDone(false);
    setPhase("searching");
    setStatusMessage("Starting bad website scan...");

    try {
      const response = await fetch("/api/outreach/leads/bad-site-scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ keyword: keyword.trim(), city: city.trim(), state: state.trim(), threshold }),
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({ message: "Scan failed" }));
        throw new Error(err.message);
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error("No response stream");

      const decoder = new TextDecoder();
      let buffer = "";
      let resultIndex = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        let eventType = "";
        for (const line of lines) {
          if (line.startsWith("event: ")) {
            eventType = line.slice(7).trim();
          } else if (line.startsWith("data: ") && eventType) {
            try {
              const data = JSON.parse(line.slice(6));
              if (eventType === "status") {
                setStatusMessage(data.message);
                if (data.phase) setPhase(data.phase);
              } else if (eventType === "result") {
                const idx = resultIndex++;
                setResults(prev => [...prev, data as BadSiteResult]);
                if ((data as BadSiteResult).badSiteScore >= threshold) {
                  setSelectedForImport(prev => new Set(prev).add(idx));
                }
              } else if (eventType === "complete") {
                setStatusMessage(`Scan complete. Found ${data.total} businesses.`);
              } else if (eventType === "error") {
                throw new Error(data.message);
              }
            } catch (e: any) {
              if (e.message && !e.message.includes("Unexpected")) throw e;
            }
            eventType = "";
          }
        }
      }

      queryClient.invalidateQueries({ queryKey: ["/api/outreach/leads"] });
    } catch (err: any) {
      toast({ title: "Scan Error", description: err.message, variant: "destructive" });
    } finally {
      setScanning(false);
    }
  };

  const handleImport = () => {
    const leadsToImport = results.filter((_, i) => selectedForImport.has(i));
    if (leadsToImport.length === 0) {
      toast({ title: "No leads selected", description: "Select at least one lead to import.", variant: "destructive" });
      return;
    }
    importMutation.mutate(leadsToImport);
  };

  const toggleSelection = (index: number) => {
    setSelectedForImport(prev => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  const resetDialog = () => {
    setResults([]);
    setSelectedForImport(new Set());
    setImportDone(false);
    setKeyword("");
    setCity("");
    setState("OK");
    setThreshold(60);
    setPhase("");
    setStatusMessage("");
  };

  function scoreColor(score: number): string {
    if (score < 40) return "text-green-400 border-green-500/30 bg-green-500/15";
    if (score <= 60) return "text-amber-400 border-amber-500/30 bg-amber-500/15";
    return "text-red-400 border-red-500/30 bg-red-500/15";
  }

  return (
    <Dialog open={open} onOpenChange={v => { if (!scanning && !importMutation.isPending) onOpenChange(v); }}>
      <DialogContent className="max-w-3xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <SearchX className="w-5 h-5 text-red-400" />
            Bad Website Finder
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 flex-1 overflow-hidden flex flex-col">
          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label className="text-xs text-muted-foreground mb-1 block">Keyword</Label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  placeholder="e.g. plumber, dentist, restaurant"
                  value={keyword}
                  onChange={e => setKeyword(e.target.value)}
                  disabled={scanning}
                  className="pl-9"
                  data-testid="input-bad-site-keyword"
                />
              </div>
            </div>
            <div>
              <Label className="text-xs text-muted-foreground mb-1 block">City</Label>
              <div className="relative">
                <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  placeholder="e.g. Oklahoma City"
                  value={city}
                  onChange={e => setCity(e.target.value)}
                  disabled={scanning}
                  className="pl-9"
                  data-testid="input-bad-site-city"
                />
              </div>
            </div>
            <div>
              <Label className="text-xs text-muted-foreground mb-1 block">State</Label>
              <Input
                placeholder="e.g. OK"
                value={state}
                onChange={e => setState(e.target.value)}
                disabled={scanning}
                data-testid="input-bad-site-state"
              />
            </div>
          </div>

          <div>
            <Label className="text-xs text-muted-foreground mb-2 block">
              Score Threshold: {threshold} (import leads scoring {threshold}+)
            </Label>
            <Slider
              min={0}
              max={100}
              step={5}
              value={[threshold]}
              onValueChange={([v]) => setThreshold(v)}
              disabled={scanning}
              data-testid="slider-bad-site-threshold"
            />
            <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
              <span>0 (good site)</span>
              <span>100 (terrible site)</span>
            </div>
          </div>

          {!scanning && results.length === 0 && !importDone && (
            <Button onClick={startScan} className="w-full" data-testid="button-start-bad-site-scan">
              <SearchX className="w-4 h-4 mr-2" />
              Find Bad Websites
            </Button>
          )}

          {(scanning || results.length > 0) && (
            <>
              <div className="flex items-center gap-2 text-sm">
                {scanning && <Loader2 className="w-4 h-4 animate-spin text-red-400" />}
                <span className="text-muted-foreground">{statusMessage}</span>
                {results.length > 0 && (
                  <Badge variant="outline" className="ml-auto">
                    {selectedForImport.size} of {results.length} selected
                  </Badge>
                )}
              </div>

              <div className="flex-1 overflow-y-auto space-y-2 min-h-[200px] max-h-[400px] pr-1">
                {results.map((r, i) => (
                  <div
                    key={i}
                    className={`flex items-start gap-3 p-3 rounded-md border text-sm ${
                      selectedForImport.has(i)
                        ? "border-primary/30 bg-primary/5"
                        : "border-border/50 bg-muted/20"
                    }`}
                    data-testid={`bad-site-result-${i}`}
                  >
                    <div className="mt-0.5">
                      <Checkbox
                        checked={selectedForImport.has(i)}
                        onCheckedChange={() => toggleSelection(i)}
                        data-testid={`checkbox-bad-site-${i}`}
                      />
                    </div>
                    <div className="flex-1 min-w-0 space-y-1.5">
                      <div className="flex items-start gap-2 flex-wrap">
                        <span className="font-medium truncate">{r.businessName}</span>
                        <Badge variant="outline" className={`text-xs ${scoreColor(r.badSiteScore)}`} data-testid={`badge-score-${i}`}>
                          Score: {r.badSiteScore}
                        </Badge>
                        {r.redesignWorthy && (
                          <Badge variant="outline" className="text-xs border-red-500/30 text-red-400 bg-red-500/10" data-testid={`badge-redesign-${i}`}>
                            Redesign Worthy
                          </Badge>
                        )}
                      </div>
                      <a href={r.url} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-400 hover:underline truncate block" data-testid={`link-url-${i}`}>
                        {r.url}
                      </a>
                      {r.topProblems && r.topProblems.length > 0 && (
                        <ul className="text-xs text-muted-foreground space-y-0.5 list-disc list-inside" data-testid={`list-problems-${i}`}>
                          {r.topProblems.slice(0, 3).map((p, j) => (
                            <li key={j}>{p}</li>
                          ))}
                        </ul>
                      )}
                      {r.visualStyleAssessment && (
                        <p className="text-xs text-muted-foreground truncate" data-testid={`text-visual-${i}`}>
                          <span className="font-medium">Visual:</span> {r.visualStyleAssessment}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
                <div ref={resultsEndRef} />
              </div>
            </>
          )}
        </div>

        <DialogFooter className="gap-2">
          {results.length > 0 && !scanning && !importDone && (
            <Button
              onClick={handleImport}
              disabled={importMutation.isPending || selectedForImport.size === 0}
              data-testid="button-import-bad-sites"
            >
              {importMutation.isPending ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Plus className="w-4 h-4 mr-2" />
              )}
              Import {selectedForImport.size} Selected
            </Button>
          )}
          {importDone && (
            <Button
              onClick={() => {
                onOpenChange(false);
                resetDialog();
              }}
              data-testid="button-close-bad-site"
            >
              Done
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type ScanResult = {
  index: number;
  total: number;
  status: "created" | "skipped" | "passed" | "error";
  business: string;
  url: string;
  websiteScore?: number;
  scoreReasons?: string[];
  pitchAngle?: string;
  leadId?: string;
  reason?: string;
  error?: string;
  emailFound?: boolean;
  email?: string | null;
  contactName?: string | null;
  emailMethod?: string;
};

function ScanLeadsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { toast } = useToast();
  const [businessType, setBusinessType] = useState("");
  const [location, setLocation] = useState("");
  const [scanning, setScanning] = useState(false);
  const [phase, setPhase] = useState<string>("");
  const [statusMessage, setStatusMessage] = useState("");
  const [results, setResults] = useState<ScanResult[]>([]);
  const [summary, setSummary] = useState<{ created: number; skipped: number; total: number } | null>(null);
  const resultsEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    resultsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [results]);

  const startScan = async () => {
    if (!businessType.trim() || !location.trim()) {
      toast({ title: "Missing Info", description: "Please enter both business type and location.", variant: "destructive" });
      return;
    }
    setScanning(true);
    setResults([]);
    setSummary(null);
    setPhase("searching");
    setStatusMessage("Starting scan...");

    try {
      const response = await fetch("/api/outreach/leads/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ businessType: businessType.trim(), location: location.trim() }),
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({ message: "Scan failed" }));
        throw new Error(err.message);
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error("No response stream");

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        let eventType = "";
        for (const line of lines) {
          if (line.startsWith("event: ")) {
            eventType = line.slice(7).trim();
          } else if (line.startsWith("data: ") && eventType) {
            try {
              const data = JSON.parse(line.slice(6));
              if (eventType === "status") {
                setStatusMessage(data.message);
                setPhase(data.phase);
              } else if (eventType === "result") {
                setResults(prev => [...prev, data as ScanResult]);
              } else if (eventType === "complete") {
                setSummary(data);
              } else if (eventType === "error") {
                throw new Error(data.message);
              }
            } catch (e: any) {
              if (e.message && !e.message.includes("Unexpected")) throw e;
            }
            eventType = "";
          }
        }
      }

      queryClient.invalidateQueries({ queryKey: ["/api/outreach/leads"] });
    } catch (err: any) {
      toast({ title: "Scan Error", description: err.message, variant: "destructive" });
    } finally {
      setScanning(false);
    }
  };

  const createdCount = results.filter(r => r.status === "created").length;

  return (
    <Dialog open={open} onOpenChange={v => { if (!scanning) onOpenChange(v); }}>
      <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Radar className="w-5 h-5 text-amber-400" />
            Scan for Leads
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 flex-1 overflow-hidden flex flex-col">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs text-muted-foreground mb-1 block">Business Type</Label>
              <div className="relative">
                <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  placeholder="e.g. restaurants, plumbers, dentists"
                  value={businessType}
                  onChange={e => setBusinessType(e.target.value)}
                  disabled={scanning}
                  className="pl-9"
                  data-testid="input-scan-business-type"
                />
              </div>
            </div>
            <div>
              <Label className="text-xs text-muted-foreground mb-1 block">Location</Label>
              <div className="relative">
                <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  placeholder="e.g. Oklahoma City, OK"
                  value={location}
                  onChange={e => setLocation(e.target.value)}
                  disabled={scanning}
                  className="pl-9"
                  data-testid="input-scan-location"
                />
              </div>
            </div>
          </div>

          {!scanning && !summary && (
            <Button onClick={startScan} className="w-full" data-testid="button-start-scan">
              <Radar className="w-4 h-4 mr-2" />
              Start Scan
            </Button>
          )}

          {(scanning || results.length > 0) && (
            <>
              <div className="flex items-center gap-2 text-sm">
                {scanning && <Loader2 className="w-4 h-4 animate-spin text-amber-400" />}
                <span className="text-muted-foreground">{statusMessage}</span>
                {results.length > 0 && (
                  <Badge variant="outline" className="ml-auto">{createdCount} leads created</Badge>
                )}
              </div>

              <div className="flex-1 overflow-y-auto space-y-1.5 min-h-[200px] max-h-[400px] pr-1">
                {results.map((r, i) => (
                  <div
                    key={i}
                    className={`flex items-start gap-3 p-2.5 rounded-lg border text-sm ${
                      r.status === "created"
                        ? r.emailFound
                          ? "border-green-500/30 bg-green-500/5"
                          : "border-amber-500/30 bg-amber-500/5"
                        : r.status === "error"
                        ? "border-red-500/30 bg-red-500/5"
                        : "border-border/50 bg-muted/30"
                    }`}
                    data-testid={`scan-result-${i}`}
                  >
                    <div className="mt-0.5">
                      {r.status === "created" && r.emailFound && <CheckCircle className="w-4 h-4 text-green-400" />}
                      {r.status === "created" && !r.emailFound && <AlertTriangle className="w-4 h-4 text-amber-400" />}
                      {r.status === "skipped" && <SkipForward className="w-4 h-4 text-yellow-400" />}
                      {r.status === "passed" && <XCircle className="w-4 h-4 text-muted-foreground" />}
                      {r.status === "error" && <AlertTriangle className="w-4 h-4 text-red-400" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate">{r.business}</div>
                      <a href={r.url} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-400 hover:underline truncate block">
                        {r.url}
                      </a>
                      {r.status === "created" && (
                        <div className="mt-1 space-y-0.5">
                          <div className="text-xs text-muted-foreground">
                            Score: {r.websiteScore}/10 • {r.pitchAngle}
                          </div>
                          <div className="flex items-center gap-1.5 text-xs">
                            {r.emailFound ? (
                              <>
                                <Mail className="w-3 h-3 text-green-400" />
                                <span className="text-green-400">{r.email}</span>
                                {r.contactName && <span className="text-muted-foreground">({r.contactName})</span>}
                              </>
                            ) : (
                              <>
                                <Mail className="w-3 h-3 text-amber-400" />
                                <span className="text-amber-400">Email needed — requires manual research</span>
                              </>
                            )}
                          </div>
                        </div>
                      )}
                      {r.status === "skipped" && <div className="text-xs text-yellow-400 mt-0.5">{r.reason}</div>}
                      {r.status === "passed" && <div className="text-xs text-muted-foreground mt-0.5">Score: {r.websiteScore}/10 — above threshold</div>}
                      {r.status === "error" && <div className="text-xs text-red-400 mt-0.5">{r.error}</div>}
                    </div>
                  </div>
                ))}
                <div ref={resultsEndRef} />
              </div>
            </>
          )}

          {summary && (
            <Card className="border-amber-500/30 bg-amber-500/5">
              <CardContent className="p-3">
                <div className="flex items-center gap-2 mb-1">
                  <CheckCircle2 className="w-4 h-4 text-amber-400" />
                  <span className="font-medium text-sm">Scan Complete</span>
                </div>
                <p className="text-xs text-muted-foreground">
                  Analyzed {summary.total} businesses • Created {summary.created} new leads • {(summary as any).emailsFound || 0} with email • {summary.created - ((summary as any).emailsFound || 0)} need email research • {summary.skipped} skipped or above threshold
                </p>
              </CardContent>
            </Card>
          )}
        </div>

        <DialogFooter>
          {summary && (
            <Button
              onClick={() => {
                onOpenChange(false);
                setResults([]);
                setSummary(null);
                setBusinessType("");
                setLocation("");
                setPhase("");
                setStatusMessage("");
              }}
              data-testid="button-close-scan"
            >
              Done
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CsvUploadDialog({ open, onOpenChange, fileInputRef }: { open: boolean; onOpenChange: (v: boolean) => void; fileInputRef: React.RefObject<HTMLInputElement> }) {
  const { toast } = useToast();
  const [step, setStep] = useState<"upload" | "map" | "preview">("upload");
  const [fileName, setFileName] = useState("");
  const [rawHeaders, setRawHeaders] = useState<string[]>([]);
  const [rawRows, setRawRows] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [mappedData, setMappedData] = useState<Record<string, string>[]>([]);

  const mutation = useMutation({
    mutationFn: (rows: Record<string, string>[]) => apiRequest("POST", "/api/outreach/leads/csv", { rows }),
    onSuccess: async (res) => {
      const data = await res.json();
      queryClient.invalidateQueries({ queryKey: ["/api/outreach/leads"] });
      queryClient.invalidateQueries({ queryKey: ["/api/outreach/stats"] });
      const dupes = data.duplicates || 0;
      const errs = (data.errors?.length || 0) - dupes;
      let desc = `${data.created} leads created.`;
      if (dupes > 0) desc += ` ${dupes} duplicates skipped.`;
      if (errs > 0) desc += ` ${errs} errors.`;
      toast({ title: "CSV Imported", description: desc });
      resetState();
      onOpenChange(false);
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  function resetState() {
    setStep("upload");
    setFileName("");
    setRawHeaders([]);
    setRawRows([]);
    setMapping({});
    setMappedData([]);
  }

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);

    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = (ev.target?.result as string).replace(/\r\n/g, "\n").replace(/\r/g, "\n");
      const lines = text.trim().split("\n").filter(l => l.trim());
      if (lines.length < 2) {
        toast({ title: "Error", description: "CSV must have a header row and at least one data row.", variant: "destructive" });
        return;
      }

      const headers = parseCsvLine(lines[0]);
      const rows = lines.slice(1).map(parseCsvLine);
      setRawHeaders(headers);
      setRawRows(rows);

      const autoMap: Record<string, string> = {};
      headers.forEach((h) => {
        const guess = guessMapping(h);
        if (guess && !Object.values(autoMap).includes(guess)) {
          autoMap[h] = guess;
        }
      });
      setMapping(autoMap);
      setStep("map");
    };
    reader.readAsText(file);

    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function handleMappingChange(csvCol: string, targetField: string) {
    setMapping(prev => {
      const next = { ...prev };
      if (targetField === "__skip__") {
        delete next[csvCol];
      } else {
        for (const key of Object.keys(next)) {
          if (next[key] === targetField) delete next[key];
        }
        next[csvCol] = targetField;
      }
      return next;
    });
  }

  const requiredFieldsMapped = TARGET_FIELDS
    .filter(f => f.required)
    .every(f => Object.values(mapping).includes(f.key));

  function applyMapping() {
    const invertedMap: Record<string, number> = {};
    for (const [csvCol, targetField] of Object.entries(mapping)) {
      const idx = rawHeaders.indexOf(csvCol);
      if (idx >= 0) invertedMap[targetField] = idx;
    }

    const rows = rawRows.map(values => {
      const row: Record<string, string> = {};
      for (const [field, idx] of Object.entries(invertedMap)) {
        row[field] = values[idx] || "";
      }
      return row;
    }).filter(row => row.website_url).map(row => {
      if (!row.business_name && row.website_url) {
        try {
          const hostname = new URL(row.website_url.startsWith("http") ? row.website_url : "https://" + row.website_url).hostname;
          row.business_name = hostname.replace(/^www\./, "").split(".")[0].replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase());
        } catch {
          row.business_name = row.website_url;
        }
      }
      return row;
    });

    setMappedData(rows);
    if (rows.length === 0) {
      toast({ title: "No valid rows", description: "No rows have a Website URL after mapping. Check your mapping and try again.", variant: "destructive" });
      return;
    }
    setStep("preview");
  }

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) resetState(); onOpenChange(v); }}>
      <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>
            {step === "upload" && "CSV Upload"}
            {step === "map" && "Map Your Columns"}
            {step === "preview" && "Preview Import"}
          </DialogTitle>
        </DialogHeader>

        {step === "upload" && (
          <div className="space-y-4 py-4">
            <p className="text-sm text-muted-foreground">
              Upload any CSV file with at least a Website URL column. AI will research each business and find contact info automatically.
            </p>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv"
              onChange={handleFile}
              className="hidden"
              data-testid="input-csv-file"
            />
            <Button variant="outline" onClick={() => fileInputRef.current?.click()} data-testid="button-select-csv">
              <Upload className="w-4 h-4 mr-2" />
              {fileName || "Select CSV File"}
            </Button>
          </div>
        )}

        {step === "map" && (
          <div className="space-y-4 overflow-y-auto flex-1 min-h-0">
            <p className="text-sm text-muted-foreground">
              Match each column from your CSV to a lead field. Required fields are marked with *.
            </p>
            <div className="space-y-3">
              {rawHeaders.map((header) => (
                <div key={header} className="flex items-center gap-3">
                  <div className="w-1/3 text-sm font-medium truncate" title={header} data-testid={`text-csv-header-${header}`}>
                    {header}
                    <span className="block text-xs text-muted-foreground truncate">
                      e.g. {rawRows[0]?.[rawHeaders.indexOf(header)] || "—"}
                    </span>
                  </div>
                  <ArrowRight className="w-4 h-4 shrink-0 text-muted-foreground" />
                  <div className="w-1/2">
                    <Select
                      value={mapping[header] || "__skip__"}
                      onValueChange={(val) => handleMappingChange(header, val)}
                    >
                      <SelectTrigger data-testid={`select-mapping-${header}`}>
                        <SelectValue placeholder="Skip this column" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__skip__">— Skip this column —</SelectItem>
                        {TARGET_FIELDS.map(f => {
                          const alreadyUsedBy = Object.entries(mapping).find(([, v]) => v === f.key)?.[0];
                          const disabled = !!alreadyUsedBy && alreadyUsedBy !== header;
                          return (
                            <SelectItem key={f.key} value={f.key} disabled={disabled}>
                              {f.label}{f.required ? " *" : ""}{disabled ? ` (used by "${alreadyUsedBy}")` : ""}
                            </SelectItem>
                          );
                        })}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              ))}
            </div>
            {!requiredFieldsMapped && (
              <p className="text-sm text-destructive">
                Please map required fields: {TARGET_FIELDS.filter(f => f.required && !Object.values(mapping).includes(f.key)).map(f => f.label).join(", ")}
              </p>
            )}
            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={() => { resetState(); }} data-testid="button-back-upload">Back</Button>
              <Button
                onClick={applyMapping}
                disabled={!requiredFieldsMapped}
                data-testid="button-apply-mapping"
              >
                Next: Preview ({rawRows.length} rows)
              </Button>
            </DialogFooter>
          </div>
        )}

        {step === "preview" && (
          <div className="space-y-4 overflow-y-auto flex-1 min-h-0">
            <p className="text-sm text-muted-foreground">
              {mappedData.length} valid leads ready to import ({rawRows.length - mappedData.length} rows skipped due to missing required fields).
            </p>
            <div className="max-h-60 overflow-y-auto border rounded-md">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Business</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Website</TableHead>
                    <TableHead>Industry</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {mappedData.slice(0, 20).map((row, i) => (
                    <TableRow key={i}>
                      <TableCell className="text-sm">{row.business_name}</TableCell>
                      <TableCell className="text-sm">{row.email || <span className="text-muted-foreground italic">AI will find</span>}</TableCell>
                      <TableCell className="text-sm">{row.website_url || "-"}</TableCell>
                      <TableCell className="text-sm">{row.industry || "-"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {mappedData.length > 20 && <p className="text-xs text-muted-foreground p-2">...and {mappedData.length - 20} more</p>}
            </div>
            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={() => setStep("map")} data-testid="button-back-mapping">Back</Button>
              <Button
                onClick={() => mutation.mutate(mappedData)}
                disabled={mutation.isPending || mappedData.length === 0}
                data-testid="button-import-csv"
              >
                {mutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                Import {mappedData.length} Leads
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function LeadDetailDrawer({ leadId, detail, loading, onClose }: {
  leadId: string | null;
  detail: LeadDetail | undefined;
  loading: boolean;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const [expandedEmail, setExpandedEmail] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [editData, setEditData] = useState<Record<string, string>>({});

  const startEditing = () => {
    if (!detail?.lead) return;
    const l = detail.lead;
    setEditData({
      businessName: l.businessName || "",
      websiteUrl: l.websiteUrl || "",
      email: l.email || "",
      contactName: l.contactName || "",
      phone: l.phone || "",
      industry: l.industry || "",
      location: l.location || "",
      notes: l.notes || "",
    });
    setEditing(true);
  };

  const cancelEditing = () => {
    setEditing(false);
    setEditData({});
  };

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, unknown> }) =>
      apiRequest("PATCH", `/api/outreach/leads/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/outreach/leads"] });
      queryClient.invalidateQueries({ queryKey: ["/api/outreach/stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/outreach/leads", leadId] });
      toast({ title: "Lead updated" });
      setEditing(false);
    },
  });

  const [showCampaignPicker, setShowCampaignPicker] = useState(false);

  const { data: campaignsForPicker = [] } = useQuery<OutreachCampaign[]>({
    queryKey: ["/api/outreach/campaigns"],
    enabled: showCampaignPicker,
  });

  const stopMutation = useMutation({
    mutationFn: (id: string) => apiRequest("POST", `/api/outreach/leads/${id}/stop-campaign`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/outreach/leads"] });
      queryClient.invalidateQueries({ queryKey: ["/api/outreach/leads", leadId] });
      toast({ title: "Campaign stopped" });
    },
  });

  const startCampaignMutation = useMutation({
    mutationFn: ({ id, campaignId }: { id: string; campaignId?: string }) =>
      apiRequest("POST", `/api/outreach/leads/${id}/start-campaign`, campaignId ? { campaignId } : {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/outreach/leads"] });
      queryClient.invalidateQueries({ queryKey: ["/api/outreach/leads", leadId] });
      setShowCampaignPicker(false);
      toast({ title: "Campaign started", description: "Step 1 will send shortly." });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: String(err?.message || "Failed to start campaign"), variant: "destructive" });
    },
  });

  const pauseCampaignMutation = useMutation({
    mutationFn: (id: string) => apiRequest("POST", `/api/outreach/leads/${id}/pause-campaign`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/outreach/leads"] });
      queryClient.invalidateQueries({ queryKey: ["/api/outreach/leads", leadId] });
      toast({ title: "Campaign paused" });
    },
  });

  const resumeCampaignMutation = useMutation({
    mutationFn: (id: string) => apiRequest("POST", `/api/outreach/leads/${id}/resume-campaign`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/outreach/leads"] });
      queryClient.invalidateQueries({ queryKey: ["/api/outreach/leads", leadId] });
      toast({ title: "Campaign resumed" });
    },
  });

  const convertMutation = useMutation({
    mutationFn: (id: string) => apiRequest("POST", `/api/outreach/leads/${id}/convert`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/outreach/leads"] });
      queryClient.invalidateQueries({ queryKey: ["/api/outreach/stats"] });
      toast({ title: "Lead converted", description: "Campaign stopped and lead marked as converted." });
      onClose();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/outreach/leads/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/outreach/leads"] });
      queryClient.invalidateQueries({ queryKey: ["/api/outreach/stats"] });
      toast({ title: "Lead deleted" });
      onClose();
    },
  });

  const sendToCrmMutation = useMutation({
    mutationFn: (id: string) => apiRequest("POST", `/api/outreach/leads/${id}/send-to-crm`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/outreach/leads"] });
      toast({ title: "Added to CRM", description: "This lead is now in your sales pipeline." });
    },
    onError: (err: any) => {
      const msg = String(err?.message || "");
      if (msg.includes("409") || msg.includes("already")) {
        queryClient.invalidateQueries({ queryKey: ["/api/outreach/leads"] });
        toast({ title: "Already in CRM", description: "This lead was previously added to your CRM." });
      } else {
        toast({ title: "Error", description: "Failed to add lead to CRM.", variant: "destructive" });
      }
    },
  });

  if (!leadId) return null;

  const lead = detail?.lead;
  const enrollment = detail?.enrollment;
  const events = detail?.events || [];

  return (
    <Dialog open={!!leadId} onOpenChange={v => { if (!v) { onClose(); setExpandedEmail(null); setEditing(false); } }}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 flex-wrap">
            {lead?.businessName || "Loading..."}
            {lead && (
              <Badge variant="outline" className={STATUS_VARIANTS[lead.status] || ""}>
                {STATUS_LABELS[lead.status] || lead.status}
              </Badge>
            )}
            {lead?.awaitingHandoff && (
              <Badge className="bg-amber-500 text-black font-bold animate-pulse" data-testid="badge-handoff-detail">
                HANDOFF NEEDED
              </Badge>
            )}
            {lead && !editing && (
              <Button variant="ghost" size="sm" onClick={startEditing} className="ml-auto" data-testid="button-edit-lead">
                <Pencil className="w-3.5 h-3.5 mr-1" /> Edit
              </Button>
            )}
          </DialogTitle>
        </DialogHeader>

        {loading || !lead ? (
          <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
        ) : (
          <div className="space-y-6">
            {lead.awaitingHandoff && lead.handoffReason && (
              <div className="bg-amber-500/10 border border-amber-500/30 rounded-md p-3" data-testid="section-handoff-alert">
                <div className="flex items-center gap-2 text-amber-500 font-medium text-sm mb-1">
                  <AlertCircle className="w-4 h-4" /> Handoff Required
                </div>
                <p className="text-xs text-muted-foreground">{lead.handoffReason}</p>
                <Button
                  size="sm"
                  className="mt-2"
                  onClick={() => {
                    updateMutation.mutate({ id: lead.id, data: { awaitingHandoff: false } });
                  }}
                  data-testid="button-clear-handoff"
                >
                  Mark as Handled
                </Button>
              </div>
            )}

            <div className="flex items-center justify-between border rounded-md p-3" data-testid="section-auto-reply-toggle">
              <div>
                <span className="text-sm font-medium">Auto Reply</span>
                <p className="text-xs text-muted-foreground">AI agent handles all prospect replies automatically</p>
              </div>
              <Switch
                checked={lead.autoReplyEnabled !== false}
                onCheckedChange={(checked) => {
                  updateMutation.mutate({ id: lead.id, data: { autoReplyEnabled: checked } });
                }}
                data-testid="switch-auto-reply"
              />
            </div>
            {editing ? (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 block">Business Name</label>
                    <Input
                      value={editData.businessName}
                      onChange={e => setEditData(d => ({ ...d, businessName: e.target.value }))}
                      data-testid="input-edit-businessName"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 block">Website</label>
                    <Input
                      value={editData.websiteUrl}
                      onChange={e => setEditData(d => ({ ...d, websiteUrl: e.target.value }))}
                      data-testid="input-edit-websiteUrl"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 block">Email</label>
                    <Input
                      value={editData.email}
                      onChange={e => setEditData(d => ({ ...d, email: e.target.value }))}
                      data-testid="input-edit-email"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 block">Contact Name</label>
                    <Input
                      value={editData.contactName}
                      onChange={e => setEditData(d => ({ ...d, contactName: e.target.value }))}
                      data-testid="input-edit-contactName"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 block">Phone</label>
                    <Input
                      value={editData.phone}
                      onChange={e => setEditData(d => ({ ...d, phone: e.target.value }))}
                      data-testid="input-edit-phone"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 block">Industry</label>
                    <Input
                      value={editData.industry}
                      onChange={e => setEditData(d => ({ ...d, industry: e.target.value }))}
                      data-testid="input-edit-industry"
                    />
                  </div>
                  <div className="col-span-2">
                    <label className="text-xs text-muted-foreground mb-1 block">Location</label>
                    <Input
                      value={editData.location}
                      onChange={e => setEditData(d => ({ ...d, location: e.target.value }))}
                      data-testid="input-edit-location"
                    />
                  </div>
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Notes for AI Agent</label>
                  <Textarea
                    value={editData.notes}
                    onChange={e => setEditData(d => ({ ...d, notes: e.target.value }))}
                    placeholder="Add notes the AI agent will use to personalize outreach — e.g. 'Met at conference', 'Interested in e-commerce rebuild', 'Budget around $8k'"
                    className="min-h-[80px]"
                    data-testid="input-edit-notes"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    onClick={() => {
                      const cleaned: Record<string, unknown> = {};
                      for (const [k, v] of Object.entries(editData)) {
                        cleaned[k] = v || null;
                      }
                      if (editData.businessName) cleaned.businessName = editData.businessName;
                      if (editData.websiteUrl) cleaned.websiteUrl = editData.websiteUrl;
                      updateMutation.mutate({ id: lead.id, data: cleaned });
                    }}
                    disabled={updateMutation.isPending}
                    data-testid="button-save-lead"
                  >
                    {updateMutation.isPending ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <Check className="w-3.5 h-3.5 mr-1" />}
                    Save Changes
                  </Button>
                  <Button variant="outline" onClick={cancelEditing} data-testid="button-cancel-edit">
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-4">
                  <InfoField label="Website" value={
                    <a href={lead.websiteUrl.startsWith("http") ? lead.websiteUrl : `https://${lead.websiteUrl}`} target="_blank" rel="noopener" className="text-primary flex items-center gap-1">
                      {lead.websiteUrl} <ExternalLink className="w-3 h-3" />
                    </a>
                  } />
                  <InfoField label="Email" value={lead.email || <span className="text-amber-400 italic">Email needed</span>} />
                  <InfoField label="Contact" value={lead.contactName || "-"} />
                  <InfoField label="Phone" value={lead.phone || "-"} />
                  <InfoField label="Industry" value={lead.industry || "-"} />
                  <InfoField label="Location" value={lead.location || "-"} />
                  <InfoField label="AI Score" value={lead.aiScore !== null && lead.aiScore !== undefined ? `${lead.aiScore}/100` : "Analyzing..."} />
                  <InfoField label="Est. Value" value={lead.valueEstimate ? `$${lead.valueEstimate.toLocaleString()}` : "Analyzing..."} />
                </div>

                {lead.notes && (
                  <Card>
                    <CardContent className="p-4">
                      <div className="flex items-center gap-2 mb-2">
                        <FileText className="w-3.5 h-3.5 text-muted-foreground" />
                        <span className="text-xs font-medium text-muted-foreground">Notes for AI Agent</span>
                      </div>
                      <p className="text-sm whitespace-pre-wrap" data-testid="text-lead-notes">{lead.notes}</p>
                    </CardContent>
                  </Card>
                )}

                {!lead.notes && (
                  <button
                    onClick={startEditing}
                    className="w-full border border-dashed border-border rounded-md p-3 text-sm text-muted-foreground hover-elevate flex items-center justify-center gap-2"
                    data-testid="button-add-notes"
                  >
                    <Plus className="w-3.5 h-3.5" /> Add notes for AI agent
                  </button>
                )}

                {lead.pitchAngle && (
                  <Card>
                    <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Brain className="w-4 h-4" /> AI Analysis</CardTitle></CardHeader>
                    <CardContent className="space-y-3">
                      <div>
                        <span className="text-xs text-muted-foreground">Pitch Angle</span>
                        <p className="text-sm">{lead.pitchAngle}</p>
                      </div>
                      {lead.openingLine && (
                        <div>
                          <span className="text-xs text-muted-foreground">Opening Line</span>
                          <p className="text-sm">{lead.openingLine}</p>
                        </div>
                      )}
                      {lead.aiAuditSummary && (
                        <div>
                          <span className="text-xs text-muted-foreground">Audit Summary</span>
                          <p className="text-sm">{lead.aiAuditSummary}</p>
                        </div>
                      )}
                      {Array.isArray(lead.aiBullets) && lead.aiBullets.length > 0 && (
                        <div>
                          <span className="text-xs text-muted-foreground">Key Improvements</span>
                          <ul className="text-sm list-disc list-inside mt-1 space-y-1">
                            {(lead.aiBullets as string[]).map((b, i) => <li key={i}>{b}</li>)}
                          </ul>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                )}
              </>
            )}

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Mail className="w-4 h-4" /> Campaign Status
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {enrollment ? (
                  <div className="space-y-3">
                    <div className="flex items-center gap-4 flex-wrap text-sm">
                      <span>Step: <strong>{enrollment.currentStep}/5</strong></span>
                      {enrollment.stoppedAt && enrollment.stopReason === "Paused" && (
                        <Badge variant="outline" className="border-amber-500/50 text-amber-400">Paused</Badge>
                      )}
                      {enrollment.stoppedAt && enrollment.stopReason !== "Paused" && (
                        <Badge variant="outline" className="border-red-500/50 text-red-400">Stopped: {enrollment.stopReason}</Badge>
                      )}
                      {enrollment.completedAt && <Badge variant="outline" className="border-green-500/50 text-green-400">Completed</Badge>}
                      {detail?.nextJob && !enrollment.stoppedAt && (
                        <span className="text-muted-foreground">Next send: {new Date(detail.nextJob.runAt).toLocaleDateString()}</span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      {!enrollment.stoppedAt && !enrollment.completedAt && (
                        <>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => pauseCampaignMutation.mutate(lead.id)}
                            disabled={pauseCampaignMutation.isPending}
                            data-testid="button-pause-campaign"
                          >
                            <PauseCircle className="w-3.5 h-3.5 mr-1" /> Pause
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => stopMutation.mutate(lead.id)}
                            disabled={stopMutation.isPending}
                            data-testid="button-stop-campaign"
                          >
                            <StopCircle className="w-3.5 h-3.5 mr-1" /> Stop
                          </Button>
                        </>
                      )}
                      {enrollment.stoppedAt && enrollment.stopReason === "Paused" && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => resumeCampaignMutation.mutate(lead.id)}
                          disabled={resumeCampaignMutation.isPending}
                          data-testid="button-resume-campaign"
                        >
                          <PlayCircle className="w-3.5 h-3.5 mr-1" /> Resume
                        </Button>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <p className="text-sm text-muted-foreground">Not enrolled in any campaign</p>
                    {["new", "needs_review"].includes(lead.status) && lead.email && (
                      <>
                        {!showCampaignPicker ? (
                          <Button
                            size="sm"
                            onClick={() => setShowCampaignPicker(true)}
                            data-testid="button-start-campaign"
                          >
                            <PlayCircle className="w-3.5 h-3.5 mr-1" /> Start Campaign
                          </Button>
                        ) : (
                          <div className="space-y-2 p-3 rounded-lg border bg-muted/30">
                            <p className="text-xs font-medium">Select a campaign:</p>
                            {campaignsForPicker.length === 0 ? (
                              <p className="text-xs text-muted-foreground">Loading campaigns...</p>
                            ) : (
                              <div className="space-y-1.5">
                                {campaignsForPicker.map(c => (
                                  <Button
                                    key={c.id}
                                    variant="outline"
                                    size="sm"
                                    className="w-full justify-start"
                                    onClick={() => startCampaignMutation.mutate({ id: lead.id, campaignId: c.id })}
                                    disabled={startCampaignMutation.isPending}
                                    data-testid={`button-select-campaign-${c.id}`}
                                  >
                                    {startCampaignMutation.isPending ? (
                                      <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                                    ) : (
                                      <Mail className="w-3.5 h-3.5 mr-1.5" />
                                    )}
                                    {c.name}
                                  </Button>
                                ))}
                              </div>
                            )}
                            <Button variant="ghost" size="sm" onClick={() => setShowCampaignPicker(false)} className="text-xs">
                              Cancel
                            </Button>
                          </div>
                        )}
                      </>
                    )}
                    {["new", "needs_review"].includes(lead.status) && !lead.email && (
                      <p className="text-xs text-amber-400">Add an email address to enable campaign enrollment</p>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>

            <ConversationThread leadId={lead.id} />

            {events.length > 0 && (
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm">Email Events</CardTitle></CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {events.map(ev => (
                      <div key={ev.id} className="border-l-2 border-border pl-3 py-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-medium">Step {ev.stepNumber}</span>
                          <Badge variant="outline" className="text-xs capitalize">{ev.status}</Badge>
                          {ev.sentAt && <span className="text-xs text-muted-foreground">{new Date(ev.sentAt).toLocaleString()}</span>}
                          <button
                            className="text-xs text-primary hover:underline ml-auto"
                            onClick={() => setExpandedEmail(expandedEmail === ev.id ? null : ev.id)}
                            data-testid={`button-toggle-email-${ev.id}`}
                          >
                            {expandedEmail === ev.id ? "Hide content" : "Show content"}
                          </button>
                        </div>
                        <p className="text-xs text-muted-foreground mt-1">Subject: {ev.subject}</p>
                        {expandedEmail === ev.id && ev.body && (
                          <div className="mt-2 p-3 rounded-md bg-muted/50 text-xs whitespace-pre-wrap max-h-60 overflow-y-auto" data-testid={`text-email-body-${ev.id}`}>
                            {ev.body}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            <div className="flex items-center gap-2 flex-wrap pt-2 border-t">
              {!["engaged", "won", "lost", "do_not_contact", "converted"].includes(lead.status) && (
                <>
                  <Button
                    variant="outline"
                    onClick={() => updateMutation.mutate({ id: lead.id, data: { status: "engaged" } })}
                    data-testid="button-mark-engaged"
                  >
                    Mark Engaged
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => updateMutation.mutate({ id: lead.id, data: { status: "won" } })}
                    data-testid="button-mark-won"
                  >
                    Mark Won
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => updateMutation.mutate({ id: lead.id, data: { status: "lost" } })}
                    data-testid="button-mark-lost"
                  >
                    Mark Lost
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => updateMutation.mutate({ id: lead.id, data: { status: "do_not_contact" } })}
                    data-testid="button-mark-dnc"
                  >
                    DNC
                  </Button>
                </>
              )}

              {!lead.crmLeadId ? (
                <Button
                  variant="outline"
                  onClick={() => sendToCrmMutation.mutate(lead.id)}
                  disabled={sendToCrmMutation.isPending}
                  data-testid="button-send-to-crm"
                >
                  {sendToCrmMutation.isPending ? (
                    <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                  ) : (
                    <UserPlus className="w-4 h-4 mr-1" />
                  )}
                  Add to CRM
                </Button>
              ) : (
                <Badge variant="secondary" className="py-1.5 px-3" data-testid="badge-in-crm">
                  <CheckCircle2 className="w-3 h-3 mr-1" /> In CRM
                </Badge>
              )}

              {!["converted"].includes(lead.status) && (
                <Button
                  onClick={() => convertMutation.mutate(lead.id)}
                  disabled={convertMutation.isPending}
                  data-testid="button-convert-project"
                >
                  <ArrowRightCircle className="w-4 h-4 mr-1" /> Convert to Project
                </Button>
              )}

              <Button
                variant="ghost"
                className="ml-auto text-red-400"
                onClick={() => { if (confirm("Delete this lead?")) deleteMutation.mutate(lead.id); }}
                data-testid="button-delete-lead"
              >
                <Trash2 className="w-4 h-4" />
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function CampaignTemplatesSection() {
  const [expandedCampaign, setExpandedCampaign] = useState<string | null>(null);
  const [expandedStep, setExpandedStep] = useState<string | null>(null);

  const { data: campaigns = [], isLoading } = useQuery<OutreachCampaign[]>({
    queryKey: ["/api/outreach/campaigns"],
  });

  const { data: steps = [] } = useQuery<CampaignStep[]>({
    queryKey: ["/api/outreach/campaigns", expandedCampaign, "steps"],
    enabled: !!expandedCampaign,
  });

  if (isLoading) return null;

  return (
    <Card data-testid="section-campaign-templates">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <FileText className="w-4 h-4" />
          Campaign Templates ({campaigns.length})
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {campaigns.length === 0 ? (
          <p className="text-sm text-muted-foreground">No campaigns configured yet.</p>
        ) : (
          campaigns.map(campaign => {
            const isExpanded = expandedCampaign === campaign.id;
            const campaignSteps = isExpanded ? steps.sort((a, b) => a.stepNumber - b.stepNumber) : [];

            return (
              <div key={campaign.id} className="border rounded-md" data-testid={`card-campaign-${campaign.id}`}>
                <button
                  className="w-full flex items-center gap-3 p-3 text-left hover-elevate rounded-md"
                  onClick={() => setExpandedCampaign(isExpanded ? null : campaign.id)}
                  data-testid={`button-toggle-campaign-${campaign.id}`}
                >
                  <ChevronRight className={`w-4 h-4 shrink-0 transition-transform ${isExpanded ? "rotate-90" : ""}`} />
                  <div className="flex-1 min-w-0">
                    <span className="font-medium text-sm">{campaign.name}</span>
                  </div>
                  <Badge variant="outline" className={campaign.isActive ? "border-green-500/50 text-green-400" : "border-muted text-muted-foreground"}>
                    {campaign.isActive ? "Active" : "Inactive"}
                  </Badge>
                </button>

                {isExpanded && (
                  <div className="border-t px-3 pb-3 space-y-2 pt-2">
                    {campaignSteps.length === 0 ? (
                      <div className="flex justify-center py-4">
                        <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                      </div>
                    ) : (
                      campaignSteps.map(step => {
                        const stepKey = `${campaign.id}-${step.id}`;
                        const isStepExpanded = expandedStep === stepKey;

                        return (
                          <div key={step.id} className="border rounded-md" data-testid={`card-step-${step.stepNumber}`}>
                            <button
                              className="w-full flex items-center gap-3 p-3 text-left hover-elevate rounded-md"
                              onClick={() => setExpandedStep(isStepExpanded ? null : stepKey)}
                              data-testid={`button-toggle-step-${step.stepNumber}`}
                            >
                              <div className="flex items-center justify-center w-6 h-6 rounded-full bg-primary/10 text-primary text-xs font-bold shrink-0">
                                {step.stepNumber}
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium truncate">{step.templateSubject}</p>
                              </div>
                              <div className="flex items-center gap-1 text-xs text-muted-foreground shrink-0">
                                <Clock className="w-3 h-3" />
                                {step.delayDays === 0 ? "Immediate" : `Day ${step.delayDays}`}
                              </div>
                            </button>

                            {isStepExpanded && (
                              <div className="border-t px-3 pb-3 pt-2">
                                <div className="mb-2">
                                  <span className="text-xs font-medium text-muted-foreground">Subject</span>
                                  <p className="text-sm mt-0.5">{step.templateSubject}</p>
                                </div>
                                <div>
                                  <span className="text-xs font-medium text-muted-foreground">Body</span>
                                  <div className="mt-1 p-3 rounded-md bg-muted/50 text-sm whitespace-pre-wrap max-h-80 overflow-y-auto" data-testid={`text-template-body-step-${step.stepNumber}`}>
                                    {step.templateBody}
                                  </div>
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </CardContent>
    </Card>
  );
}

function FailedJobsSection() {
  const { toast } = useToast();

  const { data: failedJobs = [], isLoading } = useQuery<OutreachJob[]>({
    queryKey: ["/api/outreach/jobs/failed"],
    refetchInterval: 60000,
  });

  const retryMutation = useMutation({
    mutationFn: (jobId: string) => apiRequest("POST", `/api/outreach/jobs/${jobId}/retry`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/outreach/jobs/failed"] });
      queryClient.invalidateQueries({ queryKey: ["/api/outreach/leads"] });
      toast({ title: "Job requeued for retry" });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  if (isLoading || failedJobs.length === 0) return null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-red-400" />
          Failed Jobs ({failedJobs.length})
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Type</TableHead>
                <TableHead>Payload</TableHead>
                <TableHead>Error</TableHead>
                <TableHead>Retries</TableHead>
                <TableHead>Created</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {failedJobs.map(job => (
                <TableRow key={job.id} data-testid={`row-failed-job-${job.id}`}>
                  <TableCell>
                    <Badge variant="outline" className="text-xs">{job.type}</Badge>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground max-w-[200px] truncate">
                    {(() => {
                      const p = job.payload as any;
                      if (p?.lead_id) return `Lead: ${p.lead_id.slice(0, 8)}...`;
                      return JSON.stringify(p).slice(0, 50);
                    })()}
                  </TableCell>
                  <TableCell className="text-xs text-red-400 max-w-[250px] truncate">
                    {job.error || "Unknown error"}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">{job.retryCount}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {new Date(job.createdAt).toLocaleString()}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => retryMutation.mutate(job.id)}
                      disabled={retryMutation.isPending}
                      data-testid={`button-retry-job-${job.id}`}
                    >
                      <RefreshCw className="w-3 h-3 mr-1" /> Retry
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}

type ConversationWithLead = LeadConversation & {
  lead: {
    id: string;
    businessName: string;
    email: string | null;
    contactName: string | null;
    status: string;
    awaitingHandoff: boolean | null;
  } | null;
};

function ConversationsInboxView({ onOpenLead }: { onOpenLead: (id: string) => void }) {
  const [threadFilter, setThreadFilter] = useState<"all" | "inbound" | "outbound" | "ai">("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [expandedThreads, setExpandedThreads] = useState<Set<string>>(new Set());

  const { data: allConversations = [], isLoading } = useQuery<ConversationWithLead[]>({
    queryKey: ["/api/outreach/conversations"],
  });

  const filtered = useMemo(() => {
    let result = allConversations;
    if (threadFilter === "inbound") result = result.filter(c => c.direction === "inbound");
    else if (threadFilter === "outbound") result = result.filter(c => c.direction === "outbound");
    else if (threadFilter === "ai") result = result.filter(c => c.aiGenerated);
    if (searchTerm) {
      const q = searchTerm.toLowerCase();
      result = result.filter(c =>
        c.lead?.businessName?.toLowerCase().includes(q) ||
        c.lead?.email?.toLowerCase().includes(q) ||
        c.body?.toLowerCase().includes(q) ||
        c.subject?.toLowerCase().includes(q)
      );
    }
    return result;
  }, [allConversations, threadFilter, searchTerm]);

  const grouped = useMemo(() => {
    const map = new Map<string, { lead: ConversationWithLead["lead"]; messages: ConversationWithLead[] }>();
    for (const c of filtered) {
      if (!c.leadId) continue;
      if (!map.has(c.leadId)) {
        map.set(c.leadId, { lead: c.lead, messages: [] });
      }
      map.get(c.leadId)!.messages.push(c);
    }
    const entries = Array.from(map.entries());
    entries.sort((a, b) => {
      const aLatest = a[1].messages[0]?.createdAt || "";
      const bLatest = b[1].messages[0]?.createdAt || "";
      return new Date(bLatest).getTime() - new Date(aLatest).getTime();
    });
    return entries;
  }, [filtered]);

  const inboundCount = allConversations.filter(c => c.direction === "inbound").length;
  const outboundCount = allConversations.filter(c => c.direction === "outbound").length;
  const aiCount = allConversations.filter(c => c.aiGenerated).length;
  const handoffCount = allConversations.filter(c => c.lead?.awaitingHandoff).length;

  return (
    <div className="space-y-4" data-testid="section-conversations-inbox">
      <div className="grid grid-cols-4 gap-3">
        <Card>
          <CardContent className="p-3">
            <div className="flex items-center gap-1.5 mb-0.5">
              <Mail className="w-3.5 h-3.5 text-muted-foreground" />
              <span className="text-[11px] text-muted-foreground">Total Messages</span>
            </div>
            <p className="text-lg font-bold" data-testid="text-total-messages">{allConversations.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <div className="flex items-center gap-1.5 mb-0.5">
              <Reply className="w-3.5 h-3.5 text-blue-400" />
              <span className="text-[11px] text-muted-foreground">Inbound Replies</span>
            </div>
            <p className="text-lg font-bold" data-testid="text-inbound-count">{inboundCount}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <div className="flex items-center gap-1.5 mb-0.5">
              <Sparkles className="w-3.5 h-3.5 text-amber-400" />
              <span className="text-[11px] text-muted-foreground">AI Generated</span>
            </div>
            <p className="text-lg font-bold" data-testid="text-ai-count">{aiCount}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <div className="flex items-center gap-1.5 mb-0.5">
              <AlertCircle className="w-3.5 h-3.5 text-amber-500" />
              <span className="text-[11px] text-muted-foreground">Awaiting Handoff</span>
            </div>
            <p className="text-lg font-bold text-amber-500" data-testid="text-handoff-count">{handoffCount}</p>
          </CardContent>
        </Card>
      </div>

      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search conversations..."
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            className="pl-9"
            data-testid="input-search-conversations"
          />
        </div>
        <div className="flex rounded-md border overflow-visible">
          {(["all", "inbound", "outbound", "ai"] as const).map(f => (
            <Button
              key={f}
              variant="ghost"
              size="sm"
              className={`rounded-none text-xs toggle-elevate ${threadFilter === f ? "toggle-elevated" : ""}`}
              onClick={() => setThreadFilter(f)}
              data-testid={`button-filter-${f}`}
            >
              {f === "all" ? "All" : f === "inbound" ? "Inbound" : f === "outbound" ? "Outbound" : "AI Only"}
            </Button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
      ) : grouped.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center">
            <MessageSquare className="w-8 h-8 text-muted-foreground mx-auto mb-3" />
            <p className="text-sm text-muted-foreground">No conversations yet. Messages will appear here once emails are sent or replies received.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {grouped.map(([leadId, { lead, messages }]) => {
            const isExpanded = expandedThreads.has(leadId);
            const latestMsg = messages[0];
            const hasInbound = messages.some(m => m.direction === "inbound");
            const isHandoff = lead?.awaitingHandoff;

            return (
              <Card key={leadId} className={isHandoff ? "border-amber-500/40" : ""} data-testid={`card-thread-${leadId}`}>
                <div
                  className="p-4 cursor-pointer hover-elevate"
                  onClick={() => {
                    const next = new Set(expandedThreads);
                    if (next.has(leadId)) next.delete(leadId); else next.add(leadId);
                    setExpandedThreads(next);
                  }}
                >
                  <div className="flex items-center gap-3">
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${hasInbound ? "bg-blue-500/15" : "bg-primary/10"}`}>
                      {hasInbound ? <Reply className="w-4 h-4 text-blue-400" /> : <Send className="w-4 h-4 text-primary" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-sm">{lead?.businessName || "Unknown"}</span>
                        {lead?.status && (
                          <Badge variant="outline" className={`text-[10px] py-0 ${STATUS_VARIANTS[lead.status] || ""}`}>
                            {STATUS_LABELS[lead.status] || lead.status}
                          </Badge>
                        )}
                        {isHandoff && (
                          <Badge className="bg-amber-500 text-black text-[10px] py-0 px-1.5 font-bold animate-pulse">
                            HANDOFF NEEDED
                          </Badge>
                        )}
                        <span className="text-[10px] text-muted-foreground ml-auto">
                          {messages.length} message{messages.length !== 1 ? "s" : ""}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-xs text-muted-foreground truncate max-w-[400px]">
                          {latestMsg.direction === "inbound" ? `${lead?.contactName || lead?.email || "Prospect"}: ` : latestMsg.aiGenerated ? "AI Agent: " : "Campaign: "}
                          {latestMsg.body?.substring(0, 100)}{(latestMsg.body?.length || 0) > 100 ? "..." : ""}
                        </span>
                        <span className="text-[10px] text-muted-foreground shrink-0">
                          {new Date(latestMsg.createdAt).toLocaleDateString()}
                        </span>
                      </div>
                    </div>
                    <ChevronRight className={`w-4 h-4 text-muted-foreground shrink-0 transition-transform ${isExpanded ? "rotate-90" : ""}`} />
                  </div>
                </div>

                {isExpanded && (
                  <div className="border-t px-4 pb-4 pt-3">
                    <div className="flex items-center justify-between mb-3">
                      <span className="text-xs text-muted-foreground">{lead?.email || "No email"}</span>
                      <Button
                        variant="outline"
                        size="sm"
                        className="text-xs"
                        onClick={() => onOpenLead(leadId)}
                        data-testid={`button-open-lead-${leadId}`}
                      >
                        <ExternalLink className="w-3 h-3 mr-1" /> View Lead
                      </Button>
                    </div>
                    <div className="space-y-3 max-h-96 overflow-y-auto">
                      {[...messages].reverse().map(msg => {
                        const isOut = msg.direction === "outbound";
                        const isAi = msg.aiGenerated;
                        return (
                          <div key={msg.id} className={`flex gap-2 ${isOut ? "justify-end" : "justify-start"}`} data-testid={`msg-inbox-${msg.id}`}>
                            {!isOut && (
                              <div className="w-6 h-6 rounded-full bg-blue-500/15 flex items-center justify-center shrink-0 mt-1">
                                <User className="w-3 h-3 text-blue-400" />
                              </div>
                            )}
                            <div className={`max-w-[80%] rounded-md p-3 ${isOut ? "bg-primary/10 border border-primary/20" : "bg-muted/50 border border-border"}`}>
                              <div className="flex items-center gap-2 mb-1 flex-wrap">
                                <span className="text-[11px] font-medium">
                                  {isOut ? (isAi ? "AI Agent" : "Campaign") : (lead?.contactName || "Prospect")}
                                </span>
                                {isAi && (
                                  <Badge variant="outline" className="text-[10px] py-0 border-amber-500/30 text-amber-400">
                                    <Sparkles className="w-2.5 h-2.5 mr-0.5" /> AI
                                  </Badge>
                                )}
                                {msg.campaignStep && (
                                  <Badge variant="outline" className="text-[10px] py-0">Step {msg.campaignStep}</Badge>
                                )}
                                {msg.sentiment && msg.sentiment !== "draft" && (
                                  <Badge variant="outline" className="text-[10px] py-0">{msg.sentiment}</Badge>
                                )}
                                <span className="text-[10px] text-muted-foreground ml-auto">
                                  {new Date(msg.createdAt).toLocaleString()}
                                </span>
                              </div>
                              {msg.subject && (
                                <p className="text-[11px] text-muted-foreground mb-1">Subject: {msg.subject}</p>
                              )}
                              <p className="text-xs whitespace-pre-wrap leading-relaxed">{msg.body}</p>
                            </div>
                            {isOut && (
                              <div className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 mt-1 ${isAi ? "bg-amber-500/15" : "bg-primary/15"}`}>
                                {isAi ? <Bot className="w-3 h-3 text-amber-400" /> : <Send className="w-3 h-3 text-primary" />}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ConversationThread({ leadId }: { leadId: string }) {
  const { data: conversations = [], isLoading } = useQuery<LeadConversation[]>({
    queryKey: ["/api/outreach/leads", leadId, "conversations"],
  });

  if (isLoading) return null;

  return (
    <Card data-testid="section-conversation-thread">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <MessageSquare className="w-4 h-4" />
          Conversation Thread ({conversations.length})
        </CardTitle>
      </CardHeader>
      <CardContent>
        {conversations.length === 0 ? (
          <p className="text-xs text-muted-foreground">No conversation history yet. Messages will appear here once emails are sent or replies received.</p>
        ) : (
        <div className="space-y-3 max-h-80 overflow-y-auto">
          {conversations.map(msg => {
            const isOutbound = msg.direction === "outbound";
            const isAi = msg.aiGenerated;
            return (
              <div
                key={msg.id}
                className={`flex gap-2 ${isOutbound ? "justify-end" : "justify-start"}`}
                data-testid={`msg-${msg.direction}-${msg.id}`}
              >
                {!isOutbound && (
                  <div className="w-7 h-7 rounded-full bg-blue-500/15 flex items-center justify-center shrink-0 mt-1">
                    <User className="w-3.5 h-3.5 text-blue-400" />
                  </div>
                )}
                <div className={`max-w-[80%] rounded-md p-3 ${isOutbound ? "bg-primary/10 border border-primary/20" : "bg-muted/50 border border-border"}`}>
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <span className="text-[11px] font-medium">
                      {isOutbound ? (isAi ? "AI Agent" : "Campaign") : "Prospect"}
                    </span>
                    {isAi && (
                      <Badge variant="outline" className="text-[10px] py-0 border-amber-500/30 text-amber-400">
                        <Sparkles className="w-2.5 h-2.5 mr-0.5" /> AI
                      </Badge>
                    )}
                    {msg.campaignStep && (
                      <Badge variant="outline" className="text-[10px] py-0">Step {msg.campaignStep}</Badge>
                    )}
                    {msg.sentiment && (
                      <Badge variant="outline" className="text-[10px] py-0">{msg.sentiment}</Badge>
                    )}
                    <span className="text-[10px] text-muted-foreground ml-auto">
                      {new Date(msg.createdAt).toLocaleString()}
                    </span>
                  </div>
                  {msg.subject && (
                    <p className="text-[11px] text-muted-foreground mb-1">Re: {msg.subject}</p>
                  )}
                  <p className="text-xs whitespace-pre-wrap leading-relaxed">{msg.body}</p>
                </div>
                {isOutbound && (
                  <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 mt-1 ${isAi ? "bg-amber-500/15" : "bg-primary/15"}`}>
                    {isAi ? <Bot className="w-3.5 h-3.5 text-amber-400" /> : <Send className="w-3.5 h-3.5 text-primary" />}
                  </div>
                )}
              </div>
            );
          })}
        </div>
        )}
      </CardContent>
    </Card>
  );
}

type OutreachSettings = {
  dailySendCap: number;
  sendWindowStart: string;
  sendWindowEnd: string;
  timezone: string;
  enrollmentsPaused: boolean;
  enrollmentsPausedReason: string | null;
  agentMode: string;
  replyToAddress: string | null;
  outreachStartedAt: string | null;
};

function ReplyToAddressField({ settings, updateMutation }: { settings: OutreachSettings; updateMutation: any }) {
  const [localVal, setLocalVal] = useState(settings.replyToAddress || "");

  useEffect(() => {
    setLocalVal(settings.replyToAddress || "");
  }, [settings.replyToAddress]);

  const save = () => {
    const val = localVal.trim();
    if (val !== (settings.replyToAddress || "")) {
      updateMutation.mutate({ replyToAddress: val || null });
    }
  };

  return (
    <div className="pt-2 border-t space-y-2">
      <Label className="text-xs text-muted-foreground">Reply-To Address</Label>
      <p className="text-[11px] text-muted-foreground">Lead replies go to this address instead of your inbox. Set this to your Resend inbound address so the AI handles replies.</p>
      <div className="flex gap-2">
        <Input
          placeholder="e.g. replies@inbound.yourdomain.com"
          value={localVal}
          onChange={(e) => setLocalVal(e.target.value)}
          data-testid="input-reply-to-address"
          onBlur={save}
          onKeyDown={(e) => { if (e.key === "Enter") save(); }}
        />
      </div>
      {!settings.replyToAddress && (
        <p className="text-[11px] text-amber-400">Not set — lead replies will go to your personal inbox instead of the AI agent</p>
      )}
    </div>
  );
}

function AgentSettingsSection() {
  const { toast } = useToast();
  const { data: settings, isLoading } = useQuery<OutreachSettings>({
    queryKey: ["/api/outreach/settings"],
  });

  const updateMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) =>
      apiRequest("PATCH", "/api/outreach/settings", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/outreach/settings"] });
      queryClient.invalidateQueries({ queryKey: ["/api/outreach/stats"] });
      toast({ title: "Settings updated" });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const learningMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/outreach/learning/run", {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/outreach/insights"] });
      toast({ title: "Learning complete", description: "Agent has analyzed all lead data and updated insights." });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  if (isLoading || !settings) return null;

  const modeConfig: Record<string, { label: string; desc: string; color: string }> = {
    auto_reply: { label: "Auto-Reply", desc: "AI generates and sends replies automatically", color: "border-green-500/50 text-green-400" },
    draft: { label: "Draft Mode", desc: "AI drafts replies for your review before sending", color: "border-amber-500/50 text-amber-400" },
    paused: { label: "Paused", desc: "AI does not generate or send replies", color: "border-red-500/50 text-red-400" },
  };

  return (
    <Card data-testid="section-agent-settings">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Bot className="w-4 h-4" />
          AI Agent Settings
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <Label className="text-xs text-muted-foreground mb-2 block">Agent Reply Mode</Label>
          <div className="flex gap-2 flex-wrap">
            {(["auto_reply", "draft", "paused"] as const).map(mode => {
              const cfg = modeConfig[mode];
              const isActive = settings.agentMode === mode;
              return (
                <Button
                  key={mode}
                  variant="outline"
                  className={`toggle-elevate ${isActive ? `toggle-elevated ${cfg.color}` : ""}`}
                  onClick={() => updateMutation.mutate({ agentMode: mode })}
                  disabled={updateMutation.isPending}
                  data-testid={`button-agent-mode-${mode}`}
                >
                  {mode === "auto_reply" && <Radio className="w-3.5 h-3.5 mr-1.5" />}
                  {mode === "draft" && <FileText className="w-3.5 h-3.5 mr-1.5" />}
                  {mode === "paused" && <PauseCircle className="w-3.5 h-3.5 mr-1.5" />}
                  {cfg.label}
                </Button>
              );
            })}
          </div>
          <p className="text-[11px] text-muted-foreground mt-1.5">
            {modeConfig[settings.agentMode]?.desc}
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className="text-xs text-muted-foreground">Send Window</Label>
            <p className="text-sm font-medium">{settings.sendWindowStart} - {settings.sendWindowEnd}</p>
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Daily Cap</Label>
            <p className="text-sm font-medium">{settings.dailySendCap} emails/day</p>
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Timezone</Label>
            <p className="text-sm font-medium">{settings.timezone}</p>
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Enrollments</Label>
            <Badge variant="outline" className={settings.enrollmentsPaused ? "border-red-500/50 text-red-400" : "border-green-500/50 text-green-400"}>
              {settings.enrollmentsPaused ? "Paused" : "Active"}
            </Badge>
          </div>
        </div>

        <ReplyToAddressField settings={settings} updateMutation={updateMutation} />

        <div className="pt-2 border-t">
          <Button
            variant="outline"
            onClick={() => learningMutation.mutate()}
            disabled={learningMutation.isPending}
            data-testid="button-run-learning"
          >
            {learningMutation.isPending ? (
              <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
            ) : (
              <Brain className="w-3.5 h-3.5 mr-1.5" />
            )}
            Run Learning Now
          </Button>
          <p className="text-[11px] text-muted-foreground mt-1">Analyze all lead data and update agent insights</p>
        </div>
      </CardContent>
    </Card>
  );
}

function AgentInsightsSection() {
  const { data: insights = [], isLoading } = useQuery<AgentInsight[]>({
    queryKey: ["/api/outreach/insights"],
  });

  if (isLoading || insights.length === 0) return null;

  const typeConfig: Record<string, { label: string; icon: typeof Lightbulb; color: string }> = {
    timing: { label: "Timing", icon: Clock, color: "text-blue-400" },
    messaging: { label: "Messaging", icon: MessageSquare, color: "text-purple-400" },
    targeting: { label: "Targeting", icon: Target, color: "text-green-400" },
    conversion: { label: "Conversion", icon: Zap, color: "text-amber-400" },
    general: { label: "General", icon: Lightbulb, color: "text-muted-foreground" },
  };

  return (
    <Card data-testid="section-agent-insights">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Lightbulb className="w-4 h-4" />
          Agent Insights ({insights.length})
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-2.5 max-h-80 overflow-y-auto">
          {insights.map(insight => {
            const cfg = typeConfig[insight.type] || typeConfig.general;
            const InsightIcon = cfg.icon;
            return (
              <div key={insight.id} className="flex gap-2.5 items-start" data-testid={`insight-${insight.id}`}>
                <InsightIcon className={`w-3.5 h-3.5 mt-0.5 shrink-0 ${cfg.color}`} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <Badge variant="outline" className="text-[10px] py-0">{cfg.label}</Badge>
                    <span className="text-[10px] text-muted-foreground">
                      {new Date(insight.createdAt).toLocaleDateString()}
                    </span>
                    {(insight.metrics as any)?.confidence && (
                      <span className="text-[10px] text-muted-foreground ml-auto">
                        {Math.round((insight.metrics as any).confidence * 100)}% conf
                      </span>
                    )}
                  </div>
                  <p className="text-xs mt-0.5 leading-relaxed">{insight.insight}</p>
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

type AgentReport = {
  stats: {
    totalMessages: number;
    inboundMessages: number;
    outboundMessages: number;
    aiGeneratedMessages: number;
    leadsWithConversations: number;
  };
  activeThreads: { lead: any; messages: any[] }[];
  campaignOnlyThreads: { lead: any; messages: any[] }[];
  insights: AgentInsight[];
  leadsEngaged: number;
  totalLeads: number;
  agentMode: string;
};

type ChatMessage = {
  id: number;
  role: "admin" | "agent";
  content: string;
  createdAt: string;
};

function AgentChatView() {
  const { toast } = useToast();
  const [input, setInput] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const { data: messages, isLoading } = useQuery<ChatMessage[]>({
    queryKey: ["/api/outreach/agent-chat"],
    refetchInterval: 10000,
  });

  const sendMutation = useMutation({
    mutationFn: (message: string) =>
      apiRequest("POST", "/api/outreach/agent-chat", { message }).then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/outreach/agent-chat"] });
      setInput("");
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSend = () => {
    const trimmed = input.trim();
    if (!trimmed || sendMutation.isPending) return;
    sendMutation.mutate(trimmed);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const formatTime = (dateStr: string) => {
    const d = new Date(dateStr);
    return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-[calc(100vh-200px)] max-w-4xl mx-auto" data-testid="container-agent-chat">
      <Card className="flex-1 flex flex-col overflow-hidden">
        <CardHeader className="flex flex-row items-center justify-between gap-2 pb-3 border-b shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-amber-500/15 flex items-center justify-center">
              <Bot className="w-5 h-5 text-amber-400" />
            </div>
            <div>
              <CardTitle className="text-base" data-testid="text-agent-chat-title">BlackRidge AI Agent</CardTitle>
              <p className="text-xs text-muted-foreground">Your outreach strategist and advisor</p>
            </div>
          </div>
          <Badge variant="outline" className="text-xs text-green-400 border-green-500/30">
            <Activity className="w-3 h-3 mr-1" /> Online
          </Badge>
        </CardHeader>

        <CardContent className="flex-1 overflow-y-auto p-4 space-y-4" data-testid="container-chat-messages">
          {(!messages || messages.length === 0) && (
            <div className="flex flex-col items-center justify-center h-full text-center py-12 gap-4">
              <div className="w-16 h-16 rounded-full bg-amber-500/10 flex items-center justify-center">
                <Sparkles className="w-8 h-8 text-amber-400" />
              </div>
              <div>
                <h3 className="font-semibold text-lg mb-1" data-testid="text-chat-empty-title">Start a Conversation</h3>
                <p className="text-muted-foreground text-sm max-w-md">
                  Ask me about lead performance, campaign strategy, what to prioritize, 
                  or give me instructions on how to handle outreach. I have full context 
                  on your leads, conversations, and insights.
                </p>
              </div>
              <div className="flex flex-wrap gap-2 mt-2 justify-center">
                {[
                  "How are my campaigns performing?",
                  "Which leads should I focus on?",
                  "What's working in our outreach?",
                  "Suggest a new campaign angle",
                ].map((suggestion) => (
                  <Button
                    key={suggestion}
                    variant="outline"
                    size="sm"
                    onClick={() => { setInput(suggestion); inputRef.current?.focus(); }}
                    data-testid={`button-suggestion-${suggestion.slice(0, 10).replace(/\s/g, "-")}`}
                  >
                    {suggestion}
                  </Button>
                ))}
              </div>
            </div>
          )}

          {messages?.map((msg) => (
            <div
              key={msg.id}
              className={`flex gap-3 ${msg.role === "admin" ? "justify-end" : "justify-start"}`}
              data-testid={`chat-message-${msg.id}`}
            >
              {msg.role === "agent" && (
                <div className="w-8 h-8 rounded-full bg-amber-500/15 flex items-center justify-center shrink-0 mt-1">
                  <Bot className="w-4 h-4 text-amber-400" />
                </div>
              )}
              <div
                className={`max-w-[80%] rounded-lg px-4 py-3 text-sm ${
                  msg.role === "admin"
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted"
                }`}
              >
                <div className="whitespace-pre-wrap leading-relaxed">{msg.content}</div>
                <p className={`text-[10px] mt-2 ${
                  msg.role === "admin" ? "text-primary-foreground/60" : "text-muted-foreground"
                }`}>
                  {formatTime(msg.createdAt)}
                </p>
              </div>
              {msg.role === "admin" && (
                <div className="w-8 h-8 rounded-full bg-primary/15 flex items-center justify-center shrink-0 mt-1">
                  <User className="w-4 h-4 text-primary" />
                </div>
              )}
            </div>
          ))}

          {sendMutation.isPending && (
            <div className="flex gap-3 justify-start">
              <div className="w-8 h-8 rounded-full bg-amber-500/15 flex items-center justify-center shrink-0 mt-1">
                <Bot className="w-4 h-4 text-amber-400" />
              </div>
              <div className="bg-muted rounded-lg px-4 py-3">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Thinking...
                </div>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </CardContent>

        <div className="border-t p-3 shrink-0">
          <div className="flex gap-2 items-end">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask about leads, campaigns, performance, or give instructions..."
              rows={1}
              className="flex-1 resize-none rounded-md border bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring min-h-[40px] max-h-[120px]"
              style={{ height: "auto", overflow: "hidden" }}
              onInput={(e) => {
                const target = e.target as HTMLTextAreaElement;
                target.style.height = "auto";
                target.style.height = Math.min(target.scrollHeight, 120) + "px";
              }}
              data-testid="input-agent-chat"
              disabled={sendMutation.isPending}
            />
            <Button
              onClick={handleSend}
              disabled={!input.trim() || sendMutation.isPending}
              size="icon"
              data-testid="button-send-chat"
            >
              {sendMutation.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Send className="w-4 h-4" />
              )}
            </Button>
          </div>
          <p className="text-[10px] text-muted-foreground mt-1.5 text-center">
            Press Enter to send, Shift+Enter for new line
          </p>
        </div>
      </Card>
    </div>
  );
}

function AgentReportView() {
  const { toast } = useToast();
  const [expandedThread, setExpandedThread] = useState<string | null>(null);
  const [showCampaignThreads, setShowCampaignThreads] = useState(false);

  const { data: report, isLoading } = useQuery<AgentReport>({
    queryKey: ["/api/outreach/agent-report"],
  });

  const learningMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/outreach/learning/run", {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/outreach/agent-report"] });
      queryClient.invalidateQueries({ queryKey: ["/api/outreach/insights"] });
      toast({ title: "Learning complete", description: "Agent analyzed all data and updated its insights." });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!report) return null;

  const modeLabels: Record<string, { label: string; color: string }> = {
    auto_reply: { label: "Auto-Reply", color: "border-green-500/50 text-green-400" },
    draft: { label: "Draft Mode", color: "border-amber-500/50 text-amber-400" },
    paused: { label: "Paused", color: "border-red-500/50 text-red-400" },
  };

  const modeInfo = modeLabels[report.agentMode] || modeLabels.paused;

  const typeConfig: Record<string, { label: string; icon: typeof Lightbulb; color: string }> = {
    timing: { label: "Timing", icon: Clock, color: "text-blue-400" },
    messaging: { label: "Messaging", icon: MessageSquare, color: "text-purple-400" },
    targeting: { label: "Targeting", icon: Target, color: "text-green-400" },
    conversion: { label: "Conversion", icon: Zap, color: "text-amber-400" },
    general: { label: "General", icon: Lightbulb, color: "text-muted-foreground" },
  };

  return (
    <div className="space-y-6" data-testid="section-agent-report">
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-7 gap-3">
        <StatCard label="Total Messages" value={report.stats.totalMessages} icon={MessageSquare} />
        <StatCard label="Inbound" value={report.stats.inboundMessages} icon={Mail} />
        <StatCard label="Outbound" value={report.stats.outboundMessages} icon={Send} />
        <StatCard label="AI Generated" value={report.stats.aiGeneratedMessages} icon={Bot} />
        <StatCard label="Active Threads" value={report.activeThreads.length} icon={MessageSquare} />
        <StatCard label="Leads Engaged" value={`${report.leadsEngaged}/${report.totalLeads}`} icon={Users} />
        <Card>
          <CardContent className="p-3">
            <div className="flex items-center gap-1.5 mb-0.5">
              <Bot className="w-3.5 h-3.5 text-muted-foreground" />
              <span className="text-[11px] text-muted-foreground leading-tight">Agent Mode</span>
            </div>
            <Badge variant="outline" className={modeInfo.color}>{modeInfo.label}</Badge>
          </CardContent>
        </Card>
      </div>

      <Card data-testid="section-agent-learning">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <CardTitle className="text-sm flex items-center gap-2">
              <Brain className="w-4 h-4" />
              What the Agent Has Learned ({report.insights.length} insights)
            </CardTitle>
            <Button
              variant="outline"
              onClick={() => learningMutation.mutate()}
              disabled={learningMutation.isPending}
              data-testid="button-generate-report"
            >
              {learningMutation.isPending ? (
                <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
              ) : (
                <Sparkles className="w-3.5 h-3.5 mr-1.5" />
              )}
              Generate New Report
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {report.insights.length === 0 ? (
            <div className="text-center py-8">
              <Brain className="w-8 h-8 mx-auto text-muted-foreground mb-2" />
              <p className="text-sm text-muted-foreground">No insights yet. Click "Generate New Report" to have the agent analyze all your lead data and learn from patterns.</p>
            </div>
          ) : (
            <div className="space-y-3 max-h-96 overflow-y-auto">
              {report.insights.map(insight => {
                const cfg = typeConfig[insight.type] || typeConfig.general;
                const InsightIcon = cfg.icon;
                return (
                  <div key={insight.id} className="flex gap-3 items-start p-3 rounded-md bg-muted/30" data-testid={`report-insight-${insight.id}`}>
                    <InsightIcon className={`w-4 h-4 mt-0.5 shrink-0 ${cfg.color}`} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <Badge variant="outline" className="text-[10px] py-0">{cfg.label}</Badge>
                        <span className="text-[10px] text-muted-foreground">
                          {new Date(insight.createdAt).toLocaleString()}
                        </span>
                        {(insight.metrics as any)?.confidence && (
                          <span className="text-[10px] text-muted-foreground ml-auto">
                            {Math.round((insight.metrics as any).confidence * 100)}% confidence
                          </span>
                        )}
                      </div>
                      <p className="text-sm leading-relaxed">{insight.insight}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Card data-testid="section-active-conversations">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <MessageSquare className="w-4 h-4" />
            Active Conversations ({report.activeThreads.length} prospects replied)
          </CardTitle>
        </CardHeader>
        <CardContent>
          {report.activeThreads.length === 0 ? (
            <div className="text-center py-8">
              <MessageSquare className="w-8 h-8 mx-auto text-muted-foreground mb-2" />
              <p className="text-sm text-muted-foreground">No prospects have replied yet. Conversations will appear here when prospects respond to your outreach emails.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {report.activeThreads.map(thread => {
                const isExpanded = expandedThread === thread.lead.id;
                const inboundCount = thread.messages.filter((m: any) => m.direction === "inbound").length;
                const outboundCount = thread.messages.filter((m: any) => m.direction === "outbound").length;
                const latestMsg = thread.messages[0];
                const aiReplies = thread.messages.filter((m: any) => m.aiGenerated).length;

                return (
                  <div key={thread.lead.id} className="border rounded-md" data-testid={`thread-${thread.lead.id}`}>
                    <button
                      className="w-full flex items-center gap-3 p-3 text-left hover-elevate rounded-md"
                      onClick={() => setExpandedThread(isExpanded ? null : thread.lead.id)}
                      data-testid={`button-toggle-thread-${thread.lead.id}`}
                    >
                      <ChevronRight className={`w-4 h-4 shrink-0 transition-transform ${isExpanded ? "rotate-90" : ""}`} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium text-sm">{thread.lead.businessName}</span>
                          {thread.lead.status && (
                            <Badge variant="outline" className={`text-[10px] py-0 ${STATUS_VARIANTS[thread.lead.status] || ""}`}>
                              {STATUS_LABELS[thread.lead.status] || thread.lead.status}
                            </Badge>
                          )}
                        </div>
                        <span className="text-xs text-muted-foreground">
                          {thread.lead.contactName || thread.lead.email || "Unknown contact"} &middot; {thread.lead.industry || "Unknown industry"}
                        </span>
                      </div>
                      <div className="flex items-center gap-3 shrink-0 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1"><Mail className="w-3 h-3" />{inboundCount} in</span>
                        <span className="flex items-center gap-1"><Send className="w-3 h-3" />{outboundCount} out</span>
                        {aiReplies > 0 && <span className="flex items-center gap-1"><Bot className="w-3 h-3 text-amber-400" />{aiReplies} AI</span>}
                        <span>{new Date(latestMsg.createdAt).toLocaleDateString()}</span>
                      </div>
                    </button>

                    {isExpanded && (
                      <div className="border-t px-3 pb-3 pt-2">
                        <div className="space-y-3 max-h-96 overflow-y-auto">
                          {[...thread.messages].reverse().map((msg: any) => {
                            const isOutbound = msg.direction === "outbound";
                            const isAi = msg.aiGenerated;
                            return (
                              <div
                                key={msg.id}
                                className={`flex gap-2 ${isOutbound ? "justify-end" : "justify-start"}`}
                              >
                                {!isOutbound && (
                                  <div className="w-6 h-6 rounded-full bg-blue-500/15 flex items-center justify-center shrink-0 mt-1">
                                    <User className="w-3 h-3 text-blue-400" />
                                  </div>
                                )}
                                <div className={`max-w-[85%] rounded-md p-2.5 ${isOutbound ? "bg-primary/10 border border-primary/20" : "bg-muted/50 border border-border"}`}>
                                  <div className="flex items-center gap-1.5 mb-1 flex-wrap">
                                    <span className="text-[10px] font-medium">
                                      {isOutbound ? (isAi ? "AI Agent" : "Campaign") : thread.lead.contactName || "Prospect"}
                                    </span>
                                    {isAi && (
                                      <Badge variant="outline" className="text-[9px] py-0 border-amber-500/30 text-amber-400">
                                        <Sparkles className="w-2 h-2 mr-0.5" /> AI
                                      </Badge>
                                    )}
                                    {msg.sentiment && msg.sentiment !== "draft" && (
                                      <Badge variant="outline" className="text-[9px] py-0">{msg.sentiment}</Badge>
                                    )}
                                    {msg.sentiment === "draft" && (
                                      <Badge variant="outline" className="text-[9px] py-0 border-amber-500/30 text-amber-400">Draft</Badge>
                                    )}
                                    <span className="text-[9px] text-muted-foreground ml-auto">
                                      {new Date(msg.createdAt).toLocaleString()}
                                    </span>
                                  </div>
                                  {msg.subject && (
                                    <p className="text-[10px] text-muted-foreground mb-1">{msg.subject}</p>
                                  )}
                                  <p className="text-xs whitespace-pre-wrap leading-relaxed">{msg.body}</p>
                                </div>
                                {isOutbound && (
                                  <div className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 mt-1 ${isAi ? "bg-amber-500/15" : "bg-primary/15"}`}>
                                    {isAi ? <Bot className="w-3 h-3 text-amber-400" /> : <Send className="w-3 h-3 text-primary" />}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {report.campaignOnlyThreads.length > 0 && (
        <Card data-testid="section-campaign-threads">
          <CardHeader className="pb-2">
            <button
              className="flex items-center gap-2 w-full text-left"
              onClick={() => setShowCampaignThreads(!showCampaignThreads)}
            >
              <ChevronRight className={`w-4 h-4 shrink-0 transition-transform ${showCampaignThreads ? "rotate-90" : ""}`} />
              <CardTitle className="text-sm flex items-center gap-2">
                <Send className="w-4 h-4" />
                Campaign-Only Threads ({report.campaignOnlyThreads.length} leads - no reply yet)
              </CardTitle>
            </button>
          </CardHeader>
          {showCampaignThreads && (
            <CardContent>
              <div className="space-y-2">
                {report.campaignOnlyThreads.map(thread => (
                  <div key={thread.lead.id} className="flex items-center gap-3 p-2 rounded-md bg-muted/20" data-testid={`campaign-thread-${thread.lead.id}`}>
                    <Send className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                    <div className="flex-1 min-w-0">
                      <span className="text-sm font-medium">{thread.lead.businessName}</span>
                      <span className="text-xs text-muted-foreground ml-2">{thread.lead.industry || ""}</span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0 text-xs text-muted-foreground">
                      <span>{thread.messages.length} emails sent</span>
                      <Badge variant="outline" className={`text-[10px] py-0 ${STATUS_VARIANTS[thread.lead.status] || ""}`}>
                        {STATUS_LABELS[thread.lead.status] || thread.lead.status}
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          )}
        </Card>
      )}
    </div>
  );
}

function InfoField({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <span className="text-xs text-muted-foreground">{label}</span>
      <div className="text-sm">{value}</div>
    </div>
  );
}
