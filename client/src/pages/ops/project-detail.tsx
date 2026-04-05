import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useRoute, useLocation, Link } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Label } from "@/components/ui/label";
import {
  ArrowLeft, CheckCircle2, Circle, Lock, Clock,
  DollarSign, Timer, TrendingUp, AlertTriangle,
  Plus, Loader2, ChevronRight, Activity,
  CalendarDays, Flag, ListChecks, FileText,
  PauseCircle, PlayCircle, Bell, X, AlertCircle, Rocket,
  CreditCard, Trash2, Receipt, Upload, Download, FolderOpen, Send, Copy, Mail, ExternalLink,
  ClipboardCheck, ChevronDown, ChevronUp, History, Undo2, EyeOff,
} from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import type { Project, ProjectTemplate, Task, TimeEntry, Milestone, StageGate, ActivityLog, Company, ScheduledFollowup, ProjectPayment, ProjectDocument, QaChecklist, QaAuditLog, WelcomeSequence } from "@shared/schema";
import { ObjectUploader } from "@/components/ObjectUploader";
import { generateQaReport, generateQaCertificate, exportQaCsv } from "@/lib/qa-pdf";

const STAGES = ["discovery", "proposal", "contract", "kickoff", "in_progress", "review", "completed", "archived"] as const;

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

const STAGE_COLORS: Record<string, string> = {
  discovery: "bg-blue-500/15 text-blue-400 border-blue-500/30",
  proposal: "bg-violet-500/15 text-violet-400 border-violet-500/30",
  contract: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  kickoff: "bg-cyan-500/15 text-cyan-400 border-cyan-500/30",
  in_progress: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  review: "bg-orange-500/15 text-orange-400 border-orange-500/30",
  completed: "bg-green-500/15 text-green-400 border-green-500/30",
  archived: "bg-muted text-muted-foreground border-border",
};

const PRIORITY_COLORS: Record<string, string> = {
  low: "bg-muted text-muted-foreground border-border",
  medium: "bg-blue-500/15 text-blue-400 border-blue-500/30",
  high: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  urgent: "bg-red-500/15 text-red-400 border-red-500/30",
};

const currencyFmt = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

function relativeTime(dateStr: string | Date | null | undefined): string {
  if (!dateStr) return "";
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 30) return `${diffDay}d ago`;
  return date.toLocaleDateString();
}

function isOverdue(dateStr: string | Date | null | undefined): boolean {
  if (!dateStr) return false;
  return new Date(dateStr) < new Date(new Date().toDateString());
}

function formatDate(dateStr: string | Date | null | undefined): string {
  if (!dateStr) return "—";
  return new Date(dateStr).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export default function ProjectDetail() {
  const [, params] = useRoute("/admin/ops/projects/:id");
  const projectId = params?.id;
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState<"tasks" | "time" | "milestones" | "payments" | "documents" | "activity" | "qa" | "kickoff" | "sequence">("tasks");

  const [showQaInitDialog, setShowQaInitDialog] = useState(false);
  const [qaInitProjectType, setQaInitProjectType] = useState("marketing_website");
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());
  const [expandedAuditItems, setExpandedAuditItems] = useState<Set<string>>(new Set());
  const [qaCustomCategory, setQaCustomCategory] = useState("");
  const [qaCustomDescription, setQaCustomDescription] = useState("");

  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [newTaskPriority, setNewTaskPriority] = useState("medium");
  const [newTaskDue, setNewTaskDue] = useState("");

  const [newTimeDesc, setNewTimeDesc] = useState("");
  const [newTimeHours, setNewTimeHours] = useState("");
  const [newTimeDate, setNewTimeDate] = useState("");
  const [newTimeBillable, setNewTimeBillable] = useState(true);

  const [showBlockerDialog, setShowBlockerDialog] = useState(false);
  const [blockerText, setBlockerText] = useState("");
  const [blockerError, setBlockerError] = useState("");

  const [showApplyTemplateDialog, setShowApplyTemplateDialog] = useState(false);
  const [applyTemplateId, setApplyTemplateId] = useState("");
  const [applyTemplateStartDate, setApplyTemplateStartDate] = useState("");

  const [showTimeLogDialog, setShowTimeLogDialog] = useState(false);
  const [completingTaskId, setCompletingTaskId] = useState<string | null>(null);
  const [completingTaskTitle, setCompletingTaskTitle] = useState("");
  const [logTimeMinutes, setLogTimeMinutes] = useState("");
  const [logTimeNote, setLogTimeNote] = useState("");
  const [logTimeBillable, setLogTimeBillable] = useState(true);
  const [isCompletingTask, setIsCompletingTask] = useState(false);

  const [showDepositDialog, setShowDepositDialog] = useState(false);
  const [depositGateId, setDepositGateId] = useState<string | null>(null);
  const [depositAmount, setDepositAmount] = useState("");
  const [depositNotes, setDepositNotes] = useState("");

  const [showAddPaymentDialog, setShowAddPaymentDialog] = useState(false);
  const [newPaymentLabel, setNewPaymentLabel] = useState("");
  const [newPaymentAmount, setNewPaymentAmount] = useState("");
  const [newPaymentType, setNewPaymentType] = useState("milestone");
  const [newPaymentDueDate, setNewPaymentDueDate] = useState("");
  const [newPaymentNotes, setNewPaymentNotes] = useState("");
  const [uploadCategory, setUploadCategory] = useState("other");
  const [showInvoiceDialog, setShowInvoiceDialog] = useState(false);
  const [invoiceDueDate, setInvoiceDueDate] = useState("");
  const [invoiceNotes, setInvoiceNotes] = useState("");

  const { data: project, isLoading: projectLoading } = useQuery<Project>({
    queryKey: ["/api/ops/projects", projectId],
    enabled: !!projectId,
  });

  const { data: company } = useQuery<Company>({
    queryKey: ["/api/ops/companies", project?.companyId],
    enabled: !!project?.companyId,
  });

  const { data: gates = [] } = useQuery<StageGate[]>({
    queryKey: ["/api/ops/projects", projectId, "gates"],
    enabled: !!projectId,
  });

  const { data: tasks = [] } = useQuery<Task[]>({
    queryKey: ["/api/ops/projects", projectId, "tasks"],
    enabled: !!projectId,
  });

  const { data: timeEntries = [] } = useQuery<TimeEntry[]>({
    queryKey: ["/api/ops/projects", projectId, "time"],
    enabled: !!projectId,
  });

  const { data: milestones = [] } = useQuery<Milestone[]>({
    queryKey: ["/api/ops/projects", projectId, "milestones"],
    enabled: !!projectId,
  });

  const { data: activityLogs = [] } = useQuery<ActivityLog[]>({
    queryKey: ["/api/ops/projects", projectId, "activity"],
    enabled: !!projectId,
  });

  const { data: followups = [] } = useQuery<ScheduledFollowup[]>({
    queryKey: ["/api/ops/projects", projectId, "followups"],
    enabled: !!projectId,
  });

  const { data: templates = [] } = useQuery<ProjectTemplate[]>({
    queryKey: ["/api/ops/templates"],
  });

  const { data: payments = [] } = useQuery<ProjectPayment[]>({
    queryKey: ["/api/ops/projects", projectId, "payments"],
    enabled: !!projectId,
  });

  const { data: documents = [] } = useQuery<ProjectDocument[]>({
    queryKey: ["/api/ops/projects", projectId, "documents"],
    enabled: !!projectId,
  });

  const { data: qaData } = useQuery<{ items: QaChecklist[]; score: { total: number; passed: number; score: number } }>({
    queryKey: ["/api/ops/projects", projectId, "qa"],
    enabled: !!projectId,
  });

  const { data: qaAuditLogs = [] } = useQuery<QaAuditLog[]>({
    queryKey: ["/api/ops/projects", projectId, "qa", "audit"],
    enabled: !!projectId && activeTab === "qa",
  });

  const { data: kickoff, isLoading: kickoffLoading } = useQuery<any>({
    queryKey: ["/api/ops/projects", projectId, "kickoff"],
    enabled: !!projectId,
  });

  const { data: welcomeSeq, isLoading: seqLoading } = useQuery<WelcomeSequence | null>({
    queryKey: ["/api/ops/projects", projectId, "sequence"],
    enabled: !!projectId,
    refetchInterval: (query) => {
      const data = query.state.data;
      return data && (data as any)?.status === "running" ? 15000 : false;
    },
  });

  const [showSeqDialog, setShowSeqDialog] = useState(false);
  const [seqClientName, setSeqClientName] = useState("");
  const [seqClientEmail, setSeqClientEmail] = useState("");
  const [seqCompanyName, setSeqCompanyName] = useState("");

  const [showKickoffDialog, setShowKickoffDialog] = useState(false);
  const [kickoffClientName, setKickoffClientName] = useState("");
  const [kickoffClientEmail, setKickoffClientEmail] = useState("");
  const [kickoffCompanyName, setKickoffCompanyName] = useState("");
  const [kickoffNotes, setKickoffNotes] = useState("");

  const qaItems = qaData?.items || [];
  const qaScore = qaData?.score || { total: 0, passed: 0, score: 0 };
  const qaHasChecklist = qaItems.length > 0;

  const qaInitializeMutation = useMutation({
    mutationFn: async (projectType: string) => {
      const res = await apiRequest("POST", `/api/ops/projects/${projectId}/qa/initialize`, { projectType });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ops/projects", projectId, "qa"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ops/projects", projectId, "qa", "audit"] });
      setShowQaInitDialog(false);
      toast({ title: "QA checklist initialized" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const qaUpdateItemMutation = useMutation({
    mutationFn: async ({ itemId, data }: { itemId: string; data: Record<string, unknown> }) => {
      const res = await apiRequest("PATCH", `/api/ops/projects/${projectId}/qa/${itemId}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ops/projects", projectId, "qa"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ops/projects", projectId, "qa", "audit"] });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const qaDeleteItemMutation = useMutation({
    mutationFn: async (itemId: string) => {
      const res = await apiRequest("DELETE", `/api/ops/projects/${projectId}/qa/${itemId}`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ops/projects", projectId, "qa"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ops/projects", projectId, "qa", "audit"] });
      toast({ title: "QA item removed" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const qaAddItemMutation = useMutation({
    mutationFn: async (data: { category: string; itemDescription: string; projectType?: string }) => {
      const res = await apiRequest("POST", `/api/ops/projects/${projectId}/qa/items`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ops/projects", projectId, "qa"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ops/projects", projectId, "qa", "audit"] });
      setQaCustomCategory("");
      setQaCustomDescription("");
      toast({ title: "QA item added" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const addPaymentMutation = useMutation({
    mutationFn: async (data: { label: string; amount: number; type: string; dueDate?: string; receivedDate?: string; status: string; notes?: string }) => {
      const res = await apiRequest("POST", `/api/ops/projects/${projectId}/payments`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ops/projects", projectId, "payments"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ops/projects", projectId, "activity"] });
      toast({ title: "Payment recorded" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const [collectPaymentId, setCollectPaymentId] = useState<string | null>(null);
  const [collectMethod, setCollectMethod] = useState("stripe");

  const markPaymentReceivedMutation = useMutation({
    mutationFn: async ({ paymentId, paymentMethod }: { paymentId: string; paymentMethod: string }) => {
      const res = await apiRequest("PATCH", `/api/ops/payments/${paymentId}`, {
        status: "received",
        receivedDate: new Date().toISOString(),
        paymentMethod,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ops/projects", projectId, "payments"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ops/projects", projectId, "activity"] });
      setCollectPaymentId(null);
      const methodLabels: Record<string, string> = { stripe: "Stripe", cashapp: "Cash App", venmo: "Venmo", cash: "Cash", check: "Check" };
      toast({ title: "Payment collected", description: `Recorded via ${methodLabels[collectMethod] || collectMethod}` });
    },
  });

  const deletePaymentMutation = useMutation({
    mutationFn: async (paymentId: string) => {
      const res = await apiRequest("DELETE", `/api/ops/payments/${paymentId}`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ops/projects", projectId, "payments"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ops/projects", projectId, "activity"] });
      toast({ title: "Payment deleted" });
    },
  });

  const excludeFromLedgerMutation = useMutation({
    mutationFn: async (paymentId: string) => {
      const res = await apiRequest("PATCH", `/api/ops/payments/${paymentId}/exclude-ledger`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ops/projects", projectId, "payments"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ops/projects", projectId, "activity"] });
      toast({ title: "Payment excluded from ledger", description: "Journal entries removed" });
    },
  });

  const uncollectPaymentMutation = useMutation({
    mutationFn: async (paymentId: string) => {
      const res = await apiRequest("PATCH", `/api/ops/payments/${paymentId}/uncollect`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ops/projects", projectId, "payments"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ops/projects", projectId, "activity"] });
      toast({ title: "Payment uncollected", description: "Reverted to pending status" });
    },
  });

  const deleteDocumentMutation = useMutation({
    mutationFn: async (docId: string) => {
      const res = await apiRequest("DELETE", `/api/ops/documents/${docId}`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ops/projects", projectId, "documents"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ops/projects", projectId, "activity"] });
      toast({ title: "Document deleted" });
    },
  });

  const generateInvoiceMutation = useMutation({
    mutationFn: async (data: { notes?: string; dueDate?: string }) => {
      const res = await apiRequest("POST", `/api/ops/projects/${projectId}/generate-invoice`, data);
      return res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/ops/projects", projectId, "documents"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ops/projects", projectId, "activity"] });
      if (project?.clientId) {
        queryClient.invalidateQueries({ queryKey: ["/api/ops/clients", project.clientId, "payment-links"] });
      }
      setShowInvoiceDialog(false);
      setInvoiceDueDate("");
      setInvoiceNotes("");
      const desc = data.paymentLink?.url
        ? `${data.invoiceNumber} created with pay link: ${data.paymentLink.url}`
        : `${data.invoiceNumber} created and saved to Documents`;
      toast({ title: "Invoice Generated", description: desc });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const toggleWaitingMutation = useMutation({
    mutationFn: async (data: { enabled: boolean; blocker?: string }) => {
      const res = await apiRequest("POST", `/api/ops/projects/${projectId}/waiting`, data);
      return { ...(await res.json()), _wasEnabled: data.enabled };
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/ops/projects", projectId] });
      queryClient.invalidateQueries({ queryKey: ["/api/ops/projects", projectId, "followups"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ops/projects", projectId, "activity"] });
      setShowBlockerDialog(false);
      setBlockerText("");
      setBlockerError("");
      toast({
        title: variables.enabled ? "Marked as waiting on client" : "Project resumed",
      });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const completeFollowupMutation = useMutation({
    mutationFn: async (followupId: string) => {
      const res = await apiRequest("PATCH", `/api/ops/followups/${followupId}`, { status: "completed" });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ops/projects", projectId, "followups"] });
      toast({ title: "Follow-up completed" });
    },
  });

  const applyTemplateMutation = useMutation({
    mutationFn: async (data: { templateId: string; startDate?: string }) => {
      const res = await apiRequest("POST", `/api/ops/projects/${projectId}/apply-template`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ops/projects", projectId] });
      queryClient.invalidateQueries({ queryKey: ["/api/ops/projects", projectId, "gates"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ops/projects", projectId, "tasks"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ops/projects", projectId, "milestones"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ops/projects", projectId, "activity"] });
      setShowApplyTemplateDialog(false);
      setApplyTemplateId("");
      setApplyTemplateStartDate("");
      toast({ title: "Template applied", description: "Gates, milestones, and tasks have been added to this project." });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const completeGateMutation = useMutation({
    mutationFn: async (gateId: string) => {
      const res = await apiRequest("PATCH", `/api/ops/gates/${gateId}`, {
        isCompleted: true,
        completedAt: new Date().toISOString(),
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ops/projects", projectId, "gates"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ops/projects", projectId, "activity"] });
    },
  });

  const handleGateCheck = (gate: StageGate) => {
    const isDepositGate = gate.title.toLowerCase().includes("deposit");
    if (isDepositGate) {
      setDepositGateId(gate.id);
      setDepositAmount("");
      setDepositNotes("");
      setShowDepositDialog(true);
    } else {
      completeGateMutation.mutate(gate.id);
    }
  };

  const advanceStageMutation = useMutation({
    mutationFn: async (nextStage: string) => {
      const res = await fetch(`/api/ops/projects/${projectId}/stage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stage: nextStage }),
        credentials: "include",
      });
      if (res.status === 409) {
        const data = await res.json();
        throw new Error(`BLOCKED:${JSON.stringify(data.blockedGates || [])}`);
      }
      if (!res.ok) throw new Error("Failed to advance stage");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ops/projects", projectId] });
      queryClient.invalidateQueries({ queryKey: ["/api/ops/projects", projectId, "activity"] });
      toast({ title: "Stage advanced" });
    },
    onError: (error: Error) => {
      if (error.message.startsWith("BLOCKED:")) {
        const blockedGates = JSON.parse(error.message.replace("BLOCKED:", ""));
        toast({
          title: "Cannot advance stage",
          description: `Incomplete gates: ${blockedGates.join(", ")}`,
          variant: "destructive",
        });
      } else {
        toast({ title: "Error", description: error.message, variant: "destructive" });
      }
    },
  });

  const completeTaskMutation = useMutation({
    mutationFn: async (taskId: string) => {
      const res = await apiRequest("PATCH", `/api/ops/tasks/${taskId}`, { status: "done" });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ops/projects", projectId, "tasks"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ops/projects", projectId, "activity"] });
      toast({ title: "Task completed" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to complete task", description: error.message, variant: "destructive" });
    },
  });

  const addTaskMutation = useMutation({
    mutationFn: async (data: { title: string; priority: string; dueDate?: string }) => {
      const body: Record<string, unknown> = { title: data.title, priority: data.priority };
      if (data.dueDate) body.dueDate = new Date(data.dueDate).toISOString();
      const res = await apiRequest("POST", `/api/ops/projects/${projectId}/tasks`, body);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ops/projects", projectId, "tasks"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ops/projects", projectId, "activity"] });
      setNewTaskTitle("");
      setNewTaskPriority("medium");
      setNewTaskDue("");
      toast({ title: "Task added" });
    },
  });

  const addTimeMutation = useMutation({
    mutationFn: async (data: { description: string; minutes: number; date: string; billable: boolean; taskId?: string }) => {
      const res = await apiRequest("POST", `/api/ops/projects/${projectId}/time`, {
        description: data.description,
        minutes: data.minutes,
        date: new Date(data.date).toISOString(),
        billable: data.billable,
        ...(data.taskId ? { taskId: data.taskId } : {}),
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ops/projects", projectId, "time"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ops/projects", projectId, "activity"] });
      setNewTimeDesc("");
      setNewTimeHours("");
      setNewTimeDate("");
      setNewTimeBillable(true);
      toast({ title: "Time logged" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to log time", description: error.message, variant: "destructive" });
    },
  });

  const completeMilestoneMutation = useMutation({
    mutationFn: async (milestoneId: string) => {
      const res = await apiRequest("PATCH", `/api/ops/milestones/${milestoneId}`, {
        completedAt: new Date().toISOString(),
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ops/projects", projectId, "milestones"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ops/projects", projectId, "activity"] });
    },
  });

  if (projectLoading) {
    return (
      <div className="p-3 sm:p-6 space-y-4 sm:space-y-6">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!project) {
    return (
      <div className="p-3 sm:p-6 space-y-4">
        <p className="text-muted-foreground">Project not found.</p>
        <Button variant="outline" onClick={() => navigate("/admin/ops/projects")} data-testid="button-back-not-found">
          <ArrowLeft className="w-4 h-4 mr-2" /> Back to Projects
        </Button>
      </div>
    );
  }

  const currentStageIdx = STAGES.indexOf(project.stage as typeof STAGES[number]);
  const nextStage = currentStageIdx < STAGES.length - 1 ? STAGES[currentStageIdx + 1] : null;

  const blockerDays = project.waitingOnClient && project.blockerSince
    ? Math.floor((Date.now() - new Date(project.blockerSince).getTime()) / (1000 * 60 * 60 * 24))
    : 0;
  const isEscalated = project.waitingOnClient && blockerDays >= 7;

  const gatesByStage: Record<string, StageGate[]> = {};
  gates.forEach((g) => {
    if (!gatesByStage[g.stageName]) gatesByStage[g.stageName] = [];
    gatesByStage[g.stageName].push(g);
  });

  const currentStageGates = gatesByStage[project.stage] || [];
  const currentGatesComplete = currentStageGates.length === 0 || currentStageGates.every((g) => g.isCompleted);

  const totalMinutes = timeEntries.reduce((sum, e) => sum + e.minutes, 0);
  const totalHours = totalMinutes / 60;
  const estimatedHours = project.estimatedHours || 0;
  const scopeCreep = estimatedHours > 0 ? ((totalHours - estimatedHours) / estimatedHours) * 100 : 0;
  const effectiveRate = totalHours > 0 && project.contractValue ? project.contractValue / totalHours : 0;

  const totalCollected = payments.filter(p => p.status === "received").reduce((sum, p) => sum + p.amount, 0);
  const totalPending = payments.filter(p => p.status === "pending").reduce((sum, p) => sum + p.amount, 0);
  const remainingBalance = (project.contractValue || 0) - totalCollected;
  const overduePayments = payments.filter(p => p.status === "pending" && p.dueDate && new Date(p.dueDate) < new Date(new Date().toDateString()));

  const tabs = [
    { key: "tasks" as const, label: "Tasks", icon: ListChecks, count: tasks.filter((t) => t.status !== "done").length },
    { key: "time" as const, label: "Time Log", icon: Timer },
    { key: "milestones" as const, label: "Milestones", icon: Flag },
    { key: "payments" as const, label: "Payments", icon: CreditCard, count: overduePayments.length > 0 ? overduePayments.length : undefined },
    { key: "documents" as const, label: "Documents", icon: FolderOpen, count: documents.length > 0 ? documents.length : undefined },
    { key: "qa" as const, label: "QA", icon: ClipboardCheck, count: qaHasChecklist && qaScore.score < 95 ? Math.round(qaScore.score) : undefined },
    { key: "kickoff" as const, label: "Kickoff", icon: Rocket, count: kickoff?.status === "submitted" ? undefined : kickoff ? 1 : undefined },
    { key: "sequence" as const, label: "Sequence", icon: Mail, count: welcomeSeq?.status === "running" ? undefined : undefined },
    { key: "activity" as const, label: "Activity", icon: Activity },
  ];

  return (
    <div className="p-6 space-y-6 max-w-6xl">
      <div className="flex items-start gap-4 flex-wrap">
        <Link href="/admin/ops/projects">
          <Button variant="ghost" size="icon" data-testid="button-back">
            <ArrowLeft className="w-4 h-4" />
          </Button>
        </Link>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-2xl font-bold tracking-tight" data-testid="text-project-name">{project.name}</h1>
            <Badge className={STAGE_COLORS[project.stage] || ""} data-testid="badge-stage">
              {STAGE_LABELS[project.stage] || project.stage}
            </Badge>
            {project.waitingOnClient && (
              <Badge variant="outline" className="bg-amber-500/10 text-amber-400 border-amber-500/30 no-default-hover-elevate no-default-active-elevate" data-testid="badge-waiting">
                <PauseCircle className="w-3 h-3 mr-1" />
                Waiting on Client
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-4 mt-1 flex-wrap">
            {company && (
              <span className="text-sm text-muted-foreground" data-testid="text-company">{company.name}</span>
            )}
            {project.contractValue != null && (
              <span className="text-sm font-medium text-emerald-400" data-testid="text-contract-value">
                {currencyFmt.format(project.contractValue)}
              </span>
            )}
            {project.stage !== "completed" && project.stage !== "archived" && (
              project.waitingOnClient ? (
                <Button
                  variant="outline"
                  size="sm"
                  data-testid="button-resume-project"
                  disabled={toggleWaitingMutation.isPending}
                  onClick={() => toggleWaitingMutation.mutate({ enabled: false })}
                >
                  {toggleWaitingMutation.isPending ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <PlayCircle className="w-4 h-4 mr-2" />
                  )}
                  Resume Project
                </Button>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  className="text-amber-400 border-amber-500/30"
                  data-testid="button-mark-waiting"
                  onClick={() => {
                    setBlockerText("");
                    setBlockerError("");
                    setShowBlockerDialog(true);
                  }}
                >
                  <PauseCircle className="w-4 h-4 mr-2" />
                  Mark as Waiting on Client
                </Button>
              )
            )}
            {!project.templateId && templates.length > 0 && (
              <Button
                variant="outline"
                size="sm"
                data-testid="button-apply-template"
                onClick={() => {
                  setApplyTemplateId("");
                  setApplyTemplateStartDate("");
                  setShowApplyTemplateDialog(true);
                }}
              >
                <Rocket className="w-4 h-4 mr-2" />
                Apply Template
              </Button>
            )}
          </div>
        </div>
      </div>

      {project.waitingOnClient && (
        <Card className={isEscalated ? "border-red-500/40" : "border-amber-500/30"} data-testid="card-waiting-details">
          <CardContent className="pt-5 space-y-4">
            <div className="flex items-start gap-3">
              {isEscalated ? (
                <AlertCircle className="w-5 h-5 text-red-400 mt-0.5 shrink-0" />
              ) : (
                <AlertTriangle className="w-5 h-5 text-amber-400 mt-0.5 shrink-0" />
              )}
              <div className="flex-1 min-w-0 space-y-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className={`text-sm font-medium ${isEscalated ? "text-red-400" : "text-amber-400"}`} data-testid="text-blocker-label">
                    {isEscalated ? "ESCALATION — Waiting on Client" : "Blocked — Waiting on Client"}
                  </p>
                  {isEscalated && (
                    <Badge variant="secondary" className="no-default-hover-elevate no-default-active-elevate bg-red-500/15 text-red-400 text-xs" data-testid="badge-escalation">
                      {blockerDays}d overdue
                    </Badge>
                  )}
                </div>
                <p className="text-sm text-muted-foreground" data-testid="text-blocker-reason">{project.blocker}</p>
                {project.blockerSince && (
                  <p className={`text-xs ${isEscalated ? "text-red-400/70" : "text-muted-foreground/70"}`} data-testid="text-blocker-since">
                    Since {formatDate(project.blockerSince)} ({relativeTime(project.blockerSince)})
                  </p>
                )}
              </div>
            </div>

            {followups.length > 0 && (
              <>
                <Separator />
                <div className="space-y-2">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-2">
                    <Bell className="w-3 h-3" />
                    Scheduled Follow-ups
                  </p>
                  <div className="space-y-1.5">
                    {followups.map((f) => {
                      const isOverdueFollowup = f.status === "pending" && new Date(f.scheduledFor) < new Date();
                      const isDone = f.status === "completed";
                      const isCancelled = f.status === "cancelled";
                      return (
                        <div
                          key={f.id}
                          className="flex items-center gap-3 text-sm py-1.5"
                          data-testid={`followup-row-${f.id}`}
                        >
                          {isDone ? (
                            <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                          ) : isCancelled ? (
                            <X className="w-4 h-4 text-muted-foreground/40 shrink-0" />
                          ) : isOverdueFollowup ? (
                            <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
                          ) : (
                            <Clock className="w-4 h-4 text-muted-foreground shrink-0" />
                          )}
                          <span className={`flex-1 ${isDone ? "line-through text-muted-foreground" : isCancelled ? "line-through text-muted-foreground/40" : isOverdueFollowup ? "text-red-400" : ""}`}>
                            {f.type}
                          </span>
                          <span className={`text-xs ${isOverdueFollowup ? "text-red-400" : "text-muted-foreground"}`}>
                            {formatDate(f.scheduledFor)}
                          </span>
                          {f.status === "pending" && (
                            <Button
                              variant="ghost"
                              size="sm"
                              data-testid={`button-complete-followup-${f.id}`}
                              disabled={completeFollowupMutation.isPending}
                              onClick={() => completeFollowupMutation.mutate(f.id)}
                            >
                              {completeFollowupMutation.isPending ? (
                                <Loader2 className="w-3 h-3 animate-spin" />
                              ) : (
                                "Done"
                              )}
                            </Button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      )}

      <Dialog open={showBlockerDialog} onOpenChange={setShowBlockerDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Mark as Waiting on Client</DialogTitle>
            <DialogDescription>
              Describe what you are waiting on from the client. Follow-up reminders will be scheduled at 24h, 72h, and 7 days.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <Textarea
              data-testid="input-blocker-text"
              placeholder="What are you waiting on? (required)"
              value={blockerText}
              onChange={(e) => {
                setBlockerText(e.target.value);
                if (e.target.value.trim()) setBlockerError("");
              }}
              rows={3}
            />
            {blockerError && (
              <p className="text-xs text-red-400" data-testid="text-blocker-error">{blockerError}</p>
            )}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setShowBlockerDialog(false)} data-testid="button-cancel-blocker">
              Cancel
            </Button>
            <Button
              data-testid="button-submit-blocker"
              disabled={toggleWaitingMutation.isPending}
              onClick={() => {
                if (!blockerText.trim()) {
                  setBlockerError("Blocker description is required");
                  return;
                }
                toggleWaitingMutation.mutate({ enabled: true, blocker: blockerText.trim() });
              }}
            >
              {toggleWaitingMutation.isPending ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <PauseCircle className="w-4 h-4 mr-2" />
              )}
              Confirm
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showApplyTemplateDialog} onOpenChange={setShowApplyTemplateDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Apply Template</DialogTitle>
            <DialogDescription>
              Add gates, milestones, and tasks from a template to this project.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Template *</Label>
              <Select value={applyTemplateId} onValueChange={setApplyTemplateId}>
                <SelectTrigger data-testid="select-apply-template">
                  <SelectValue placeholder="Select a template" />
                </SelectTrigger>
                <SelectContent>
                  {templates.map((t) => (
                    <SelectItem key={t.id} value={t.id} data-testid={`option-template-${t.id}`}>
                      {t.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Start Date (optional)</Label>
              <Input
                type="date"
                value={applyTemplateStartDate}
                onChange={(e) => setApplyTemplateStartDate(e.target.value)}
                data-testid="input-apply-template-start-date"
              />
              <p className="text-xs text-muted-foreground">
                Milestone and task due dates will be calculated from this date. Defaults to today.
              </p>
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button
              variant="ghost"
              onClick={() => setShowApplyTemplateDialog(false)}
              data-testid="button-cancel-apply-template"
            >
              Cancel
            </Button>
            <Button
              disabled={!applyTemplateId || applyTemplateMutation.isPending}
              onClick={() => {
                applyTemplateMutation.mutate({
                  templateId: applyTemplateId,
                  startDate: applyTemplateStartDate || undefined,
                });
              }}
              data-testid="button-confirm-apply-template"
            >
              {applyTemplateMutation.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                  Applying...
                </>
              ) : (
                <>
                  <Rocket className="w-4 h-4 mr-1" />
                  Apply Template
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showDepositDialog} onOpenChange={setShowDepositDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Record Deposit</DialogTitle>
            <DialogDescription>
              Enter the deposit amount collected. This will check the gate and record the payment.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Amount *</Label>
              <div className="relative">
                <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  type="number"
                  min="0"
                  step="100"
                  className="pl-9"
                  placeholder="e.g. 5000"
                  value={depositAmount}
                  onChange={(e) => setDepositAmount(e.target.value)}
                  data-testid="input-deposit-amount"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Notes (optional)</Label>
              <Input
                placeholder="e.g. Via check #1234"
                value={depositNotes}
                onChange={(e) => setDepositNotes(e.target.value)}
                data-testid="input-deposit-notes"
              />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="ghost" onClick={() => setShowDepositDialog(false)} data-testid="button-cancel-deposit">
              Cancel
            </Button>
            <Button
              disabled={!depositAmount || parseInt(depositAmount) <= 0 || addPaymentMutation.isPending || completeGateMutation.isPending}
              onClick={async () => {
                if (!depositGateId || !depositAmount) return;
                try {
                  await apiRequest("PATCH", `/api/ops/gates/${depositGateId}`, {
                    isCompleted: true,
                    completedAt: new Date().toISOString(),
                  });
                  queryClient.invalidateQueries({ queryKey: ["/api/ops/projects", projectId, "gates"] });
                  queryClient.invalidateQueries({ queryKey: ["/api/ops/projects", projectId, "activity"] });
                } catch (err: any) {
                  toast({ title: "Failed to complete gate", description: err.message, variant: "destructive" });
                  return;
                }
                addPaymentMutation.mutate({
                  label: "Deposit",
                  amount: parseInt(depositAmount, 10),
                  type: "deposit",
                  status: "received",
                  receivedDate: new Date().toISOString(),
                  notes: depositNotes || undefined,
                });
                setShowDepositDialog(false);
              }}
              data-testid="button-confirm-deposit"
            >
              {(addPaymentMutation.isPending || completeGateMutation.isPending) && (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              )}
              <CreditCard className="w-4 h-4 mr-1" />
              Record Deposit
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showAddPaymentDialog} onOpenChange={setShowAddPaymentDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Payment</DialogTitle>
            <DialogDescription>
              Schedule or record a payment for this project.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Label *</Label>
              <Input
                placeholder="e.g. Final payment, Milestone 2"
                value={newPaymentLabel}
                onChange={(e) => setNewPaymentLabel(e.target.value)}
                data-testid="input-payment-label"
              />
            </div>
            <div className="space-y-2">
              <Label>Amount *</Label>
              <div className="relative">
                <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  type="number"
                  min="0"
                  step="100"
                  className="pl-9"
                  placeholder="e.g. 5000"
                  value={newPaymentAmount}
                  onChange={(e) => setNewPaymentAmount(e.target.value)}
                  data-testid="input-payment-amount"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Type</Label>
              <Select value={newPaymentType} onValueChange={setNewPaymentType}>
                <SelectTrigger data-testid="select-payment-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="deposit">Deposit</SelectItem>
                  <SelectItem value="milestone">Milestone Payment</SelectItem>
                  <SelectItem value="final">Final Payment</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Due Date (optional)</Label>
              <Input
                type="date"
                value={newPaymentDueDate}
                onChange={(e) => setNewPaymentDueDate(e.target.value)}
                data-testid="input-payment-due-date"
              />
              <p className="text-xs text-muted-foreground">
                A collection reminder will be created when a due date is set.
              </p>
            </div>
            <div className="space-y-2">
              <Label>Notes (optional)</Label>
              <Input
                placeholder="Payment notes..."
                value={newPaymentNotes}
                onChange={(e) => setNewPaymentNotes(e.target.value)}
                data-testid="input-payment-notes"
              />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="ghost" onClick={() => setShowAddPaymentDialog(false)} data-testid="button-cancel-payment">
              Cancel
            </Button>
            <Button
              disabled={!newPaymentLabel.trim() || !newPaymentAmount || parseInt(newPaymentAmount) <= 0 || addPaymentMutation.isPending}
              onClick={() => {
                addPaymentMutation.mutate({
                  label: newPaymentLabel.trim(),
                  amount: parseInt(newPaymentAmount, 10),
                  type: newPaymentType,
                  status: "pending",
                  dueDate: newPaymentDueDate ? new Date(newPaymentDueDate).toISOString() : undefined,
                  notes: newPaymentNotes || undefined,
                });
                setShowAddPaymentDialog(false);
                setNewPaymentLabel("");
                setNewPaymentAmount("");
                setNewPaymentType("milestone");
                setNewPaymentDueDate("");
                setNewPaymentNotes("");
              }}
              data-testid="button-confirm-payment"
            >
              {addPaymentMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              <Plus className="w-4 h-4 mr-1" />
              Add Payment
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showTimeLogDialog} onOpenChange={setShowTimeLogDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Complete Task</DialogTitle>
            <DialogDescription>
              Mark "{completingTaskTitle}" as done. Optionally log time spent.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Minutes spent (optional)</label>
              <Input
                type="number"
                min="0"
                step="5"
                placeholder="e.g. 30"
                value={logTimeMinutes}
                onChange={(e) => setLogTimeMinutes(e.target.value)}
                data-testid="input-log-time-minutes"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Note (optional)</label>
              <Input
                placeholder="What did you work on?"
                value={logTimeNote}
                onChange={(e) => setLogTimeNote(e.target.value)}
                data-testid="input-log-time-note"
              />
            </div>
            <label className="flex items-center gap-2 cursor-pointer">
              <Checkbox
                checked={logTimeBillable}
                onCheckedChange={(v) => setLogTimeBillable(!!v)}
                data-testid="checkbox-log-time-billable"
              />
              <span className="text-xs text-muted-foreground">Billable</span>
            </label>
          </div>
          <DialogFooter className="gap-2">
            <Button
              variant="ghost"
              disabled={isCompletingTask}
              onClick={async () => {
                if (!completingTaskId) return;
                setIsCompletingTask(true);
                try {
                  const res = await apiRequest("PATCH", `/api/ops/tasks/${completingTaskId}`, { status: "done" });
                  await res.json();
                  queryClient.invalidateQueries({ queryKey: ["/api/ops/projects", projectId, "tasks"] });
                  queryClient.invalidateQueries({ queryKey: ["/api/ops/projects", projectId, "activity"] });
                  toast({ title: "Task completed" });
                  setShowTimeLogDialog(false);
                } catch (err: any) {
                  toast({ title: "Failed to complete task", description: err.message, variant: "destructive" });
                } finally {
                  setIsCompletingTask(false);
                }
              }}
              data-testid="button-complete-skip-time"
            >
              {isCompletingTask && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Skip & Complete
            </Button>
            <Button
              disabled={!logTimeMinutes || parseInt(logTimeMinutes) <= 0 || isCompletingTask}
              onClick={async () => {
                if (!completingTaskId) return;
                setIsCompletingTask(true);
                try {
                  const res = await apiRequest("PATCH", `/api/ops/tasks/${completingTaskId}`, { status: "done" });
                  await res.json();
                  queryClient.invalidateQueries({ queryKey: ["/api/ops/projects", projectId, "tasks"] });
                  queryClient.invalidateQueries({ queryKey: ["/api/ops/projects", projectId, "activity"] });
                  toast({ title: "Task completed" });

                  addTimeMutation.mutate({
                    description: logTimeNote || `Task: ${completingTaskTitle}`,
                    minutes: parseInt(logTimeMinutes, 10),
                    date: new Date().toISOString().split("T")[0],
                    billable: logTimeBillable,
                    taskId: completingTaskId,
                  });
                  setShowTimeLogDialog(false);
                } catch (err: any) {
                  toast({ title: "Failed to complete task", description: err.message, variant: "destructive" });
                } finally {
                  setIsCompletingTask(false);
                }
              }}
              data-testid="button-complete-log-time"
            >
              {isCompletingTask && (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              )}
              <Clock className="w-4 h-4 mr-1" />
              Log Time & Complete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Card>
        <CardContent className="pt-6 pb-4">
          <div className="flex items-center justify-between gap-1 overflow-x-auto">
            {STAGES.map((stage, idx) => {
              const isCurrent = idx === currentStageIdx;
              const isComplete = idx < currentStageIdx;
              const isFuture = idx > currentStageIdx;
              const stageGatesForThis = gatesByStage[stage] || [];
              const incompleteGateCount = stageGatesForThis.filter((g) => !g.isCompleted).length;
              const hasIncompleteGates = incompleteGateCount > 0;

              return (
                <div key={stage} className="flex items-center flex-1 min-w-0" data-testid={`stage-step-${stage}`}>
                  <div className="flex flex-col items-center gap-1.5 flex-1">
                    {isComplete && !hasIncompleteGates && (
                      <CheckCircle2 className="w-5 h-5 text-emerald-500" />
                    )}
                    {isComplete && hasIncompleteGates && (
                      <div className="relative" title={`${incompleteGateCount} gates required`}>
                        <Lock className="w-5 h-5 text-amber-500" />
                      </div>
                    )}
                    {isCurrent && !hasIncompleteGates && (
                      <div className="w-5 h-5 rounded-full border-2 border-primary animate-pulse flex items-center justify-center">
                        <div className="w-2 h-2 rounded-full bg-primary" />
                      </div>
                    )}
                    {isCurrent && hasIncompleteGates && (
                      <div className="relative" title={`${incompleteGateCount} gates required`}>
                        <Lock className="w-5 h-5 text-amber-500" />
                      </div>
                    )}
                    {isFuture && !hasIncompleteGates && (
                      <Circle className="w-5 h-5 text-muted-foreground/40" />
                    )}
                    {isFuture && hasIncompleteGates && (
                      <div className="relative" title={`${incompleteGateCount} gates required`}>
                        <Lock className="w-5 h-5 text-muted-foreground/40" />
                      </div>
                    )}
                    <span className={`text-[10px] font-medium tracking-wide uppercase whitespace-nowrap ${isCurrent ? "text-primary" : isComplete ? "text-emerald-500" : "text-muted-foreground/50"}`}>
                      {STAGE_LABELS[stage]}
                    </span>
                  </div>
                  {idx < STAGES.length - 1 && (
                    <ChevronRight className={`w-3.5 h-3.5 shrink-0 mx-0.5 ${isComplete ? "text-emerald-500/50" : "text-muted-foreground/20"}`} />
                  )}
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {Object.keys(gatesByStage).length > 0 && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-3">
            <CardTitle className="text-base">Stage Gates</CardTitle>
            {nextStage && (
              <Button
                size="sm"
                disabled={!currentGatesComplete || advanceStageMutation.isPending}
                onClick={() => advanceStageMutation.mutate(nextStage)}
                data-testid="button-advance-stage"
              >
                {advanceStageMutation.isPending && <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />}
                Advance to {STAGE_LABELS[nextStage]}
              </Button>
            )}
          </CardHeader>
          <CardContent className="space-y-4">
            {STAGES.map((stage) => {
              const stageGates = gatesByStage[stage];
              if (!stageGates || stageGates.length === 0) return null;
              const isCurrent = stage === project.stage;
              return (
                <div key={stage}>
                  <div className="flex items-center gap-2 mb-2">
                    <span className={`text-xs font-medium uppercase tracking-wider ${isCurrent ? "text-primary" : "text-muted-foreground/60"}`}>
                      {STAGE_LABELS[stage]}
                    </span>
                    {isCurrent && <Badge variant="outline" className="text-[10px]">Current</Badge>}
                  </div>
                  <div className="space-y-1.5">
                    {stageGates.map((gate) => (
                      <label
                        key={gate.id}
                        className="flex items-center gap-3 py-1.5 px-2 rounded-md hover-elevate cursor-pointer"
                        data-testid={`gate-${gate.id}`}
                      >
                        <Checkbox
                          checked={!!gate.isCompleted}
                          disabled={!!gate.isCompleted || completeGateMutation.isPending}
                          onCheckedChange={() => handleGateCheck(gate)}
                          data-testid={`checkbox-gate-${gate.id}`}
                        />
                        <span className={`text-sm ${gate.isCompleted ? "line-through text-muted-foreground" : ""}`}>
                          {gate.title}
                        </span>
                        {gate.description && (
                          <span className="text-xs text-muted-foreground/60 ml-auto hidden sm:inline">{gate.description}</span>
                        )}
                      </label>
                    ))}
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      <div>
        <div className="flex items-center gap-1 border-b border-border/40 mb-4">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${activeTab === tab.key ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover-elevate"}`}
              data-testid={`tab-${tab.key}`}
            >
              <tab.icon className="w-4 h-4" />
              {tab.label}
              {tab.count != null && tab.count > 0 && (
                <Badge variant="secondary" className="text-[10px] ml-1">{tab.count}</Badge>
              )}
            </button>
          ))}
        </div>

        {activeTab === "tasks" && (
          <div className="space-y-3">
            {tasks.length === 0 && (
              <p className="text-muted-foreground text-sm py-8 text-center">No tasks yet</p>
            )}
            {tasks.map((task) => (
              <div
                key={task.id}
                className="flex items-center gap-3 py-2 px-3 rounded-md border border-border/30 hover-elevate"
                data-testid={`task-${task.id}`}
              >
                <Checkbox
                  checked={task.status === "done"}
                  disabled={task.status === "done" || completeTaskMutation.isPending}
                  onCheckedChange={() => {
                    setCompletingTaskId(task.id);
                    setCompletingTaskTitle(task.title);
                    setLogTimeMinutes("");
                    setLogTimeNote("");
                    setLogTimeBillable(true);
                    setShowTimeLogDialog(true);
                  }}
                  data-testid={`checkbox-task-${task.id}`}
                />
                <span className={`flex-1 text-sm ${task.status === "done" ? "line-through text-muted-foreground" : ""}`} data-testid={`text-task-title-${task.id}`}>
                  {task.title}
                </span>
                <Badge className={PRIORITY_COLORS[task.priority] || ""} data-testid={`badge-priority-${task.id}`}>
                  {task.priority}
                </Badge>
                {task.dueDate && (
                  <span className={`text-xs ${isOverdue(task.dueDate) && task.status !== "done" ? "text-red-400" : "text-muted-foreground"}`} data-testid={`text-task-due-${task.id}`}>
                    {formatDate(task.dueDate)}
                  </span>
                )}
                <Badge variant="outline" className="text-[10px]" data-testid={`badge-status-${task.id}`}>
                  {task.status}
                </Badge>
              </div>
            ))}

            <Separator className="my-4" />
            <div className="flex items-end gap-3 flex-wrap">
              <div className="flex-1 min-w-[200px]">
                <label className="text-xs text-muted-foreground mb-1 block">Title</label>
                <Input
                  value={newTaskTitle}
                  onChange={(e) => setNewTaskTitle(e.target.value)}
                  placeholder="New task..."
                  data-testid="input-new-task-title"
                />
              </div>
              <div className="w-32">
                <label className="text-xs text-muted-foreground mb-1 block">Priority</label>
                <Select value={newTaskPriority} onValueChange={setNewTaskPriority}>
                  <SelectTrigger data-testid="select-new-task-priority">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="low">Low</SelectItem>
                    <SelectItem value="medium">Medium</SelectItem>
                    <SelectItem value="high">High</SelectItem>
                    <SelectItem value="urgent">Urgent</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="w-40">
                <label className="text-xs text-muted-foreground mb-1 block">Due Date</label>
                <Input
                  type="date"
                  value={newTaskDue}
                  onChange={(e) => setNewTaskDue(e.target.value)}
                  data-testid="input-new-task-due"
                />
              </div>
              <Button
                disabled={!newTaskTitle.trim() || addTaskMutation.isPending}
                onClick={() => addTaskMutation.mutate({ title: newTaskTitle.trim(), priority: newTaskPriority, dueDate: newTaskDue || undefined })}
                data-testid="button-add-task"
              >
                {addTaskMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4 mr-1" />}
                Add Task
              </Button>
            </div>
          </div>
        )}

        {activeTab === "time" && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <Card>
                <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">Total Hours</CardTitle>
                  <Clock className="w-4 h-4 text-primary" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold" data-testid="text-total-hours">{totalHours.toFixed(1)}</div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">Estimated</CardTitle>
                  <Timer className="w-4 h-4 text-blue-400" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold" data-testid="text-estimated-hours">{estimatedHours || "—"}</div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">Scope Creep</CardTitle>
                  <TrendingUp className={`w-4 h-4 ${scopeCreep > 0 ? "text-red-400" : "text-emerald-400"}`} />
                </CardHeader>
                <CardContent>
                  <div className={`text-2xl font-bold ${scopeCreep > 0 ? "text-red-400" : ""}`} data-testid="text-scope-creep">
                    {estimatedHours > 0 ? `${scopeCreep.toFixed(0)}%` : "—"}
                  </div>
                  {estimatedHours > 0 && (
                    <Progress value={Math.min(Math.abs(scopeCreep), 100)} className={`mt-2 h-1.5 ${scopeCreep > 0 ? "[&>div]:bg-red-500" : "[&>div]:bg-emerald-500"}`} />
                  )}
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">Effective Rate</CardTitle>
                  <DollarSign className="w-4 h-4 text-emerald-400" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold" data-testid="text-effective-rate">
                    {effectiveRate > 0 ? `$${effectiveRate.toFixed(0)}/hr` : "—"}
                  </div>
                </CardContent>
              </Card>
            </div>

            {timeEntries.length === 0 && (
              <p className="text-muted-foreground text-sm py-6 text-center">No time entries yet</p>
            )}
            {timeEntries.map((entry) => (
              <div
                key={entry.id}
                className="flex items-center gap-3 py-2 px-3 rounded-md border border-border/30 hover-elevate"
                data-testid={`time-entry-${entry.id}`}
              >
                <Clock className="w-4 h-4 text-muted-foreground shrink-0" />
                <span className="flex-1 text-sm" data-testid={`text-time-desc-${entry.id}`}>{entry.description || "No description"}</span>
                <span className="text-sm font-medium" data-testid={`text-time-hours-${entry.id}`}>{(entry.minutes / 60).toFixed(1)}h</span>
                <span className="text-xs text-muted-foreground">{formatDate(entry.date)}</span>
                {entry.billable && <Badge variant="outline" className="text-[10px] bg-emerald-500/10 text-emerald-400 border-emerald-500/30">Billable</Badge>}
              </div>
            ))}

            <Separator className="my-4" />
            <div className="flex items-end gap-3 flex-wrap">
              <div className="flex-1 min-w-[200px]">
                <label className="text-xs text-muted-foreground mb-1 block">Description</label>
                <Input
                  value={newTimeDesc}
                  onChange={(e) => setNewTimeDesc(e.target.value)}
                  placeholder="What did you work on?"
                  data-testid="input-time-description"
                />
              </div>
              <div className="w-24">
                <label className="text-xs text-muted-foreground mb-1 block">Hours</label>
                <Input
                  type="number"
                  step="0.25"
                  min="0"
                  value={newTimeHours}
                  onChange={(e) => setNewTimeHours(e.target.value)}
                  placeholder="0"
                  data-testid="input-time-hours"
                />
              </div>
              <div className="w-40">
                <label className="text-xs text-muted-foreground mb-1 block">Date</label>
                <Input
                  type="date"
                  value={newTimeDate}
                  onChange={(e) => setNewTimeDate(e.target.value)}
                  data-testid="input-time-date"
                />
              </div>
              <label className="flex items-center gap-2 pb-2.5 cursor-pointer">
                <Checkbox
                  checked={newTimeBillable}
                  onCheckedChange={(v) => setNewTimeBillable(!!v)}
                  data-testid="checkbox-time-billable"
                />
                <span className="text-xs text-muted-foreground">Billable</span>
              </label>
              <Button
                disabled={!newTimeHours || !newTimeDate || addTimeMutation.isPending}
                onClick={() =>
                  addTimeMutation.mutate({
                    description: newTimeDesc,
                    minutes: Math.round(parseFloat(newTimeHours) * 60),
                    date: newTimeDate,
                    billable: newTimeBillable,
                  })
                }
                data-testid="button-log-time"
              >
                {addTimeMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4 mr-1" />}
                Log Time
              </Button>
            </div>
          </div>
        )}

        {activeTab === "milestones" && (
          <div className="space-y-3">
            {milestones.length === 0 && (
              <p className="text-muted-foreground text-sm py-8 text-center">No milestones yet</p>
            )}
            {milestones.map((ms) => (
              <div
                key={ms.id}
                className="flex items-center gap-3 py-2 px-3 rounded-md border border-border/30 hover-elevate cursor-pointer"
                onClick={() => {
                  if (!ms.completedAt) completeMilestoneMutation.mutate(ms.id);
                }}
                data-testid={`milestone-${ms.id}`}
              >
                {ms.completedAt ? (
                  <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0" />
                ) : (
                  <Circle className="w-5 h-5 text-muted-foreground/40 shrink-0" />
                )}
                <span className={`flex-1 text-sm ${ms.completedAt ? "line-through text-muted-foreground" : ""}`} data-testid={`text-milestone-title-${ms.id}`}>
                  {ms.title}
                </span>
                {ms.dueDate && (
                  <span className={`text-xs ${isOverdue(ms.dueDate) && !ms.completedAt ? "text-red-400" : "text-muted-foreground"}`} data-testid={`text-milestone-due-${ms.id}`}>
                    {formatDate(ms.dueDate)}
                  </span>
                )}
                {ms.completedAt && (
                  <Badge variant="outline" className="text-[10px] bg-emerald-500/10 text-emerald-400 border-emerald-500/30" data-testid={`badge-milestone-done-${ms.id}`}>
                    Completed
                  </Badge>
                )}
              </div>
            ))}
          </div>
        )}

        {activeTab === "payments" && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <Card>
                <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">Contract Value</CardTitle>
                  <DollarSign className="w-4 h-4 text-primary" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold" data-testid="text-contract-total">
                    {project.contractValue ? currencyFmt.format(project.contractValue) : "—"}
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">Collected</CardTitle>
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold text-emerald-400" data-testid="text-collected">
                    {currencyFmt.format(totalCollected)}
                  </div>
                  {project.contractValue && project.contractValue > 0 && (
                    <Progress value={Math.min((totalCollected / project.contractValue) * 100, 100)} className="mt-2 h-1.5 [&>div]:bg-emerald-500" />
                  )}
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">Remaining</CardTitle>
                  <Receipt className="w-4 h-4 text-amber-400" />
                </CardHeader>
                <CardContent>
                  <div className={`text-2xl font-bold ${remainingBalance > 0 ? "text-amber-400" : "text-emerald-400"}`} data-testid="text-remaining">
                    {currencyFmt.format(remainingBalance)}
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">Overdue</CardTitle>
                  <AlertCircle className={`w-4 h-4 ${overduePayments.length > 0 ? "text-red-400" : "text-muted-foreground"}`} />
                </CardHeader>
                <CardContent>
                  <div className={`text-2xl font-bold ${overduePayments.length > 0 ? "text-red-400" : ""}`} data-testid="text-overdue-count">
                    {overduePayments.length}
                  </div>
                  {overduePayments.length > 0 && (
                    <p className="text-xs text-red-400/70 mt-1">
                      {currencyFmt.format(overduePayments.reduce((s, p) => s + p.amount, 0))} overdue
                    </p>
                  )}
                </CardContent>
              </Card>
            </div>

            {overduePayments.length > 0 && (
              <Card className="border-red-500/30">
                <CardContent className="pt-5">
                  <div className="flex items-center gap-2 mb-3">
                    <AlertCircle className="w-4 h-4 text-red-400" />
                    <span className="text-sm font-medium text-red-400">Collection Reminders</span>
                  </div>
                  <div className="space-y-2">
                    {overduePayments.map((p) => (
                      <div
                        key={p.id}
                        className="flex items-center gap-3 text-sm py-1.5"
                        data-testid={`overdue-payment-${p.id}`}
                      >
                        <Bell className="w-4 h-4 text-red-400 shrink-0" />
                        <span className="flex-1 text-red-400">
                          {p.label} — {currencyFmt.format(p.amount)}
                        </span>
                        <span className="text-xs text-red-400/70">
                          Due {formatDate(p.dueDate)}
                        </span>
                        <Button
                          variant="ghost"
                          size="sm"
                          data-testid={`button-collect-overdue-${p.id}`}
                          disabled={markPaymentReceivedMutation.isPending}
                          onClick={() => { setCollectMethod("stripe"); setCollectPaymentId(p.id); }}
                        >
                          Mark Collected
                        </Button>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {payments.length === 0 && (
              <p className="text-muted-foreground text-sm py-6 text-center">No payments recorded yet</p>
            )}

            {payments.map((payment) => {
              const isReceived = payment.status === "received";
              const isPaymentOverdue = payment.status === "pending" && payment.dueDate && new Date(payment.dueDate) < new Date(new Date().toDateString());
              const typeLabels: Record<string, string> = { deposit: "Deposit", milestone: "Milestone", final: "Final", other: "Other" };

              return (
                <div
                  key={payment.id}
                  className={`flex items-center gap-3 py-2.5 px-3 rounded-md border hover-elevate ${isPaymentOverdue ? "border-red-500/40" : "border-border/30"}`}
                  data-testid={`payment-${payment.id}`}
                >
                  {isReceived ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                  ) : isPaymentOverdue ? (
                    <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
                  ) : (
                    <Clock className="w-4 h-4 text-muted-foreground shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`text-sm font-medium ${isReceived ? "text-muted-foreground" : isPaymentOverdue ? "text-red-400" : ""}`} data-testid={`text-payment-label-${payment.id}`}>
                        {payment.label}
                      </span>
                      <Badge variant="outline" className="text-[10px]" data-testid={`badge-payment-type-${payment.id}`}>
                        {typeLabels[payment.type] || payment.type}
                      </Badge>
                    </div>
                    {payment.notes && (
                      <p className="text-xs text-muted-foreground/70 mt-0.5">{payment.notes}</p>
                    )}
                  </div>
                  <span className={`text-sm font-semibold tabular-nums ${isReceived ? "text-emerald-400" : isPaymentOverdue ? "text-red-400" : ""}`} data-testid={`text-payment-amount-${payment.id}`}>
                    {currencyFmt.format(payment.amount)}
                  </span>
                  {payment.dueDate && !isReceived && (
                    <span className={`text-xs ${isPaymentOverdue ? "text-red-400" : "text-muted-foreground"}`} data-testid={`text-payment-due-${payment.id}`}>
                      Due {formatDate(payment.dueDate)}
                    </span>
                  )}
                  {isReceived && payment.receivedDate && (
                    <span className="text-xs text-muted-foreground" data-testid={`text-payment-received-${payment.id}`}>
                      Received {formatDate(payment.receivedDate)}
                    </span>
                  )}
                  {isReceived ? (
                    <>
                      <Badge variant="outline" className="text-[10px] bg-emerald-500/10 text-emerald-400 border-emerald-500/30" data-testid={`badge-payment-status-${payment.id}`}>
                        {payment.paymentMethod ? ({ stripe: "Stripe", cashapp: "Cash App", venmo: "Venmo", cash: "Cash", check: "Check" } as Record<string, string>)[payment.paymentMethod] || "Collected" : "Collected"}
                      </Badge>
                      <Button
                        variant="ghost"
                        size="icon"
                        title="Mark as Unpaid"
                        disabled={uncollectPaymentMutation.isPending}
                        onClick={() => {
                          if (window.confirm(`Revert "${payment.label}" to pending? This will remove its journal entries from both ledgers.`)) {
                            uncollectPaymentMutation.mutate(payment.id);
                          }
                        }}
                        data-testid={`button-uncollect-${payment.id}`}
                      >
                        <Undo2 className="w-3.5 h-3.5 text-muted-foreground" />
                      </Button>
                      {!payment.ledgerExcluded && (
                        <Button
                          variant="ghost"
                          size="icon"
                          title="Exclude from Ledger"
                          disabled={excludeFromLedgerMutation.isPending}
                          onClick={() => {
                            if (window.confirm(`Exclude "${payment.label}" from the ledger? Journal entries will be removed.`)) {
                              excludeFromLedgerMutation.mutate(payment.id);
                            }
                          }}
                          data-testid={`button-exclude-ledger-${payment.id}`}
                        >
                          <EyeOff className="w-3.5 h-3.5 text-muted-foreground" />
                        </Button>
                      )}
                      {payment.ledgerExcluded && (
                        <Badge variant="outline" className="text-[10px] bg-amber-500/10 text-amber-500 border-amber-500/30" data-testid={`badge-excluded-${payment.id}`}>
                          Excluded
                        </Badge>
                      )}
                    </>
                  ) : (
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={markPaymentReceivedMutation.isPending}
                      onClick={() => { setCollectMethod("stripe"); setCollectPaymentId(payment.id); }}
                      data-testid={`button-collect-${payment.id}`}
                    >
                      Collect
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => deletePaymentMutation.mutate(payment.id)}
                    disabled={deletePaymentMutation.isPending}
                    data-testid={`button-delete-payment-${payment.id}`}
                  >
                    <Trash2 className="w-3.5 h-3.5 text-muted-foreground" />
                  </Button>
                </div>
              );
            })}

            <Separator className="my-4" />
            <div className="flex justify-end gap-2 flex-wrap">
              <Button
                variant="outline"
                onClick={() => {
                  setInvoiceDueDate("");
                  setInvoiceNotes("");
                  setShowInvoiceDialog(true);
                }}
                data-testid="button-generate-invoice"
              >
                <Receipt className="w-4 h-4 mr-1" />
                Generate Invoice
              </Button>
              <Button
                onClick={() => {
                  setNewPaymentLabel("");
                  setNewPaymentAmount("");
                  setNewPaymentType("milestone");
                  setNewPaymentDueDate("");
                  setNewPaymentNotes("");
                  setShowAddPaymentDialog(true);
                }}
                data-testid="button-add-payment"
              >
                <Plus className="w-4 h-4 mr-1" />
                Add Payment
              </Button>
            </div>
          </div>
        )}

        {activeTab === "documents" && (
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <div className="flex items-center gap-2 flex-wrap">
                <Select value={uploadCategory} onValueChange={setUploadCategory}>
                  <SelectTrigger className="w-[160px]" data-testid="select-doc-category">
                    <SelectValue placeholder="Category" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="contract">Contract</SelectItem>
                    <SelectItem value="invoice">Invoice</SelectItem>
                    <SelectItem value="proposal">Proposal</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <ObjectUploader
                maxNumberOfFiles={5}
                maxFileSize={20971520}
                onGetUploadParameters={async (file) => {
                  const res = await fetch("/api/uploads/request-url", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      name: file.name,
                      size: file.size,
                      contentType: file.type,
                    }),
                  });
                  const data = await res.json();
                  (file as any)._objectPath = data.objectPath;
                  return { method: "PUT" as const, url: data.uploadURL };
                }}
                onComplete={async (result) => {
                  const successful = result.successful || [];
                  let savedCount = 0;
                  for (const file of successful) {
                    const objectPath = (file as any)._objectPath;
                    if (objectPath) {
                      try {
                        await apiRequest("POST", `/api/ops/projects/${projectId}/documents`, {
                          filename: file.name,
                          storageKey: objectPath,
                          category: uploadCategory,
                          fileSize: file.size,
                          contentType: file.type,
                          uploadedBy: "admin",
                        });
                        savedCount++;
                      } catch (err) {
                        toast({ title: "Upload error", description: `Failed to save record for ${file.name}`, variant: "destructive" });
                      }
                    }
                  }
                  queryClient.invalidateQueries({ queryKey: ["/api/ops/projects", projectId, "documents"] });
                  queryClient.invalidateQueries({ queryKey: ["/api/ops/projects", projectId, "activity"] });
                  if (savedCount > 0) {
                    toast({ title: `${savedCount} file(s) uploaded` });
                  }
                }}
              >
                <Upload className="w-4 h-4 mr-1" />
                Upload Files
              </ObjectUploader>
            </div>

            {documents.length === 0 && (
              <p className="text-muted-foreground text-sm py-8 text-center">No documents uploaded yet</p>
            )}

            {["contract", "invoice", "proposal", "other"].map((cat) => {
              const catDocs = documents.filter((d) => d.category === cat);
              if (catDocs.length === 0) return null;
              const catLabels: Record<string, string> = { contract: "Contracts", invoice: "Invoices", proposal: "Proposals", other: "Other" };
              return (
                <div key={cat}>
                  <h4 className="text-sm font-medium text-muted-foreground mb-2" data-testid={`text-doc-section-${cat}`}>{catLabels[cat]}</h4>
                  <div className="space-y-1">
                    {catDocs.map((doc) => (
                      <div
                        key={doc.id}
                        className="flex items-center gap-3 py-2 px-3 rounded-md border border-border/30 hover-elevate"
                        data-testid={`doc-${doc.id}`}
                      >
                        <FileText className="w-4 h-4 text-muted-foreground shrink-0" />
                        <div className="flex-1 min-w-0">
                          <span className="text-sm font-medium truncate block" data-testid={`text-doc-name-${doc.id}`}>{doc.filename}</span>
                          <span className="text-xs text-muted-foreground">
                            {doc.fileSize ? `${(doc.fileSize / 1024).toFixed(1)} KB` : ""} {doc.createdAt ? `· ${formatDate(doc.createdAt)}` : ""}
                          </span>
                        </div>
                        {doc.notes && (
                          <span className="text-xs text-muted-foreground/70 max-w-[200px] truncate">{doc.notes}</span>
                        )}
                        <a
                          href={doc.storageKey}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="shrink-0"
                        >
                          <Button variant="ghost" size="icon" data-testid={`button-download-doc-${doc.id}`}>
                            <Download className="w-3.5 h-3.5" />
                          </Button>
                        </a>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => deleteDocumentMutation.mutate(doc.id)}
                          disabled={deleteDocumentMutation.isPending}
                          data-testid={`button-delete-doc-${doc.id}`}
                        >
                          <Trash2 className="w-3.5 h-3.5 text-muted-foreground" />
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {activeTab === "qa" && (
          <div className="space-y-4">
            {!qaHasChecklist ? (
              <div className="text-center py-12 space-y-4">
                <ClipboardCheck className="w-12 h-12 mx-auto text-muted-foreground/40" />
                <div>
                  <p className="text-sm text-muted-foreground mb-2">No QA checklist has been initialized for this project.</p>
                  <Button
                    onClick={() => setShowQaInitDialog(true)}
                    data-testid="button-initialize-qa"
                  >
                    <ClipboardCheck className="w-4 h-4 mr-2" />
                    Initialize QA Checklist
                  </Button>
                </div>
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between gap-4 flex-wrap">
                  <div className="flex items-center gap-3 flex-wrap">
                    <Badge
                      className={`text-sm px-3 py-1 no-default-hover-elevate no-default-active-elevate ${
                        qaScore.score >= 95
                          ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30"
                          : qaScore.score >= 90
                          ? "bg-amber-500/15 text-amber-400 border-amber-500/30"
                          : "bg-red-500/15 text-red-400 border-red-500/30"
                      }`}
                      data-testid="badge-qa-score"
                    >
                      QA Score: {qaScore.score.toFixed(1)}%
                    </Badge>
                    <span className="text-sm text-muted-foreground" data-testid="text-qa-pass-count">
                      {qaScore.passed} / {qaScore.total} passed
                    </span>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => generateQaReport(project.name, qaItems, qaScore)}
                      disabled={qaItems.length === 0}
                      data-testid="button-qa-report-pdf"
                    >
                      <Download className="w-3.5 h-3.5 mr-1.5" />
                      QA Report PDF
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => generateQaCertificate(project.name, qaScore.score, new Date().toISOString())}
                      disabled={qaScore.score < 95}
                      data-testid="button-qa-certificate"
                    >
                      <Download className="w-3.5 h-3.5 mr-1.5" />
                      QA Certificate
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => exportQaCsv(project.name, qaItems)}
                      disabled={qaItems.length === 0}
                      data-testid="button-qa-export-csv"
                    >
                      <Download className="w-3.5 h-3.5 mr-1.5" />
                      Export CSV
                    </Button>
                  </div>
                </div>

                <Progress
                  value={qaScore.total > 0 ? (qaScore.passed / qaScore.total) * 100 : 0}
                  className={`h-2 ${
                    qaScore.score >= 95
                      ? "[&>div]:bg-emerald-500"
                      : qaScore.score >= 90
                      ? "[&>div]:bg-amber-500"
                      : "[&>div]:bg-red-500"
                  }`}
                  data-testid="progress-qa-score"
                />

                {qaScore.score < 95 && qaScore.total > 0 && (
                  <Card className="border-amber-500/30">
                    <CardContent className="pt-4 pb-3">
                      <div className="flex items-center gap-2">
                        <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
                        <p className="text-sm text-amber-400" data-testid="text-qa-warning">
                          QA score must be 95% or above to mark project as completed
                        </p>
                      </div>
                    </CardContent>
                  </Card>
                )}

                {(() => {
                  const grouped: Record<string, QaChecklist[]> = {};
                  qaItems.forEach((item) => {
                    if (!grouped[item.category]) grouped[item.category] = [];
                    grouped[item.category].push(item);
                  });
                  const categories = Object.keys(grouped).sort();

                  return (
                    <div className="space-y-2">
                      {categories.map((category) => {
                        const items = grouped[category];
                        const passedInCat = items.filter((i) => i.status === "pass").length;
                        const isExpanded = expandedCategories.has(category);

                        return (
                          <Card key={category} data-testid={`qa-category-${category}`}>
                            <Collapsible
                              open={isExpanded}
                              onOpenChange={(open) => {
                                setExpandedCategories((prev) => {
                                  const next = new Set(prev);
                                  if (open) next.add(category);
                                  else next.delete(category);
                                  return next;
                                });
                              }}
                            >
                              <CollapsibleTrigger asChild>
                                <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2 cursor-pointer hover-elevate rounded-md">
                                  <div className="flex items-center gap-3 flex-wrap">
                                    <CardTitle className="text-sm font-medium">{category}</CardTitle>
                                    <Badge variant="secondary" className="text-[10px]">
                                      {passedInCat}/{items.length}
                                    </Badge>
                                  </div>
                                  {isExpanded ? (
                                    <ChevronUp className="w-4 h-4 text-muted-foreground shrink-0" />
                                  ) : (
                                    <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />
                                  )}
                                </CardHeader>
                              </CollapsibleTrigger>
                              <CollapsibleContent>
                                <CardContent className="space-y-2 pt-0">
                                  {items.sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0)).map((item) => {
                                    const statusColors: Record<string, string> = {
                                      not_started: "bg-muted text-muted-foreground border-border",
                                      pass: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
                                      fail: "bg-red-500/15 text-red-400 border-red-500/30",
                                      needs_review: "bg-amber-500/15 text-amber-400 border-amber-500/30",
                                    };
                                    const itemAuditLogs = qaAuditLogs.filter((l) => l.checklistItemId === item.id);
                                    const auditExpanded = expandedAuditItems.has(item.id);

                                    return (
                                      <div key={item.id} className="border border-border/30 rounded-md p-3 space-y-2" data-testid={`qa-item-${item.id}`}>
                                        <div className="flex items-start gap-3 flex-wrap">
                                          <p className="flex-1 text-sm min-w-[200px]" data-testid={`text-qa-desc-${item.id}`}>{item.itemDescription}</p>
                                          <Select
                                            value={item.status}
                                            onValueChange={(val) =>
                                              qaUpdateItemMutation.mutate({
                                                itemId: item.id,
                                                data: {
                                                  status: val,
                                                  ...(val === "pass" ? { completedAt: new Date().toISOString(), completedBy: "admin" } : {}),
                                                },
                                              })
                                            }
                                          >
                                            <SelectTrigger className="w-36" data-testid={`select-qa-status-${item.id}`}>
                                              <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent>
                                              <SelectItem value="not_started">Not Started</SelectItem>
                                              <SelectItem value="pass">Pass</SelectItem>
                                              <SelectItem value="fail">Fail</SelectItem>
                                              <SelectItem value="needs_review">Needs Review</SelectItem>
                                            </SelectContent>
                                          </Select>
                                          <Badge className={statusColors[item.status] || ""} data-testid={`badge-qa-status-${item.id}`}>
                                            {item.status === "not_started" ? "Not Started" : item.status === "needs_review" ? "Needs Review" : item.status.charAt(0).toUpperCase() + item.status.slice(1)}
                                          </Badge>
                                          <Button
                                            variant="ghost"
                                            size="icon"
                                            onClick={() => qaDeleteItemMutation.mutate(item.id)}
                                            disabled={qaDeleteItemMutation.isPending}
                                            data-testid={`button-delete-qa-${item.id}`}
                                          >
                                            <Trash2 className="w-3.5 h-3.5 text-muted-foreground" />
                                          </Button>
                                        </div>
                                        <div className="flex items-end gap-3 flex-wrap">
                                          <div className="flex-1 min-w-[150px]">
                                            <label className="text-xs text-muted-foreground mb-1 block">Assignee</label>
                                            <Input
                                              defaultValue={item.assignedTo || ""}
                                              placeholder="Assign to..."
                                              onBlur={(e) => {
                                                if (e.target.value !== (item.assignedTo || "")) {
                                                  qaUpdateItemMutation.mutate({ itemId: item.id, data: { assignedTo: e.target.value || null } });
                                                }
                                              }}
                                              data-testid={`input-qa-assignee-${item.id}`}
                                            />
                                          </div>
                                          <div className="flex-1 min-w-[200px]">
                                            <label className="text-xs text-muted-foreground mb-1 block">Notes</label>
                                            <Textarea
                                              defaultValue={item.notes || ""}
                                              placeholder="Notes..."
                                              rows={1}
                                              onBlur={(e) => {
                                                if (e.target.value !== (item.notes || "")) {
                                                  qaUpdateItemMutation.mutate({ itemId: item.id, data: { notes: e.target.value || null } });
                                                }
                                              }}
                                              data-testid={`textarea-qa-notes-${item.id}`}
                                            />
                                          </div>
                                          {item.completedAt && (
                                            <span className="text-xs text-muted-foreground pb-2.5" data-testid={`text-qa-completed-${item.id}`}>
                                              Completed {formatDate(item.completedAt)}
                                              {item.completedBy && ` by ${item.completedBy}`}
                                            </span>
                                          )}
                                        </div>
                                        {itemAuditLogs.length > 0 && (
                                          <div>
                                            <button
                                              className="flex items-center gap-1 text-xs text-muted-foreground hover-elevate rounded px-1 py-0.5"
                                              onClick={() => {
                                                setExpandedAuditItems((prev) => {
                                                  const next = new Set(prev);
                                                  if (auditExpanded) next.delete(item.id);
                                                  else next.add(item.id);
                                                  return next;
                                                });
                                              }}
                                              data-testid={`button-toggle-audit-${item.id}`}
                                            >
                                              <History className="w-3 h-3" />
                                              {itemAuditLogs.length} change{itemAuditLogs.length !== 1 ? "s" : ""}
                                              {auditExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                                            </button>
                                            {auditExpanded && (
                                              <div className="mt-1 space-y-1 pl-4 border-l border-border/40">
                                                {itemAuditLogs.map((log) => (
                                                  <div key={log.id} className="text-xs text-muted-foreground" data-testid={`audit-log-${log.id}`}>
                                                    <span className="font-medium">{log.changedBy}</span>
                                                    {" "}{log.action}
                                                    {log.previousValue && log.newValue && (
                                                      <span>: {log.previousValue} → {log.newValue}</span>
                                                    )}
                                                    <span className="ml-2 text-muted-foreground/60">{relativeTime(log.changedAt)}</span>
                                                  </div>
                                                ))}
                                              </div>
                                            )}
                                          </div>
                                        )}
                                      </div>
                                    );
                                  })}
                                </CardContent>
                              </CollapsibleContent>
                            </Collapsible>
                          </Card>
                        );
                      })}

                      <Separator className="my-4" />
                      <div className="flex items-end gap-3 flex-wrap">
                        <div className="w-48">
                          <label className="text-xs text-muted-foreground mb-1 block">Category</label>
                          <Input
                            value={qaCustomCategory}
                            onChange={(e) => setQaCustomCategory(e.target.value)}
                            placeholder="Category name..."
                            data-testid="input-qa-custom-category"
                          />
                        </div>
                        <div className="flex-1 min-w-[200px]">
                          <label className="text-xs text-muted-foreground mb-1 block">Description</label>
                          <Input
                            value={qaCustomDescription}
                            onChange={(e) => setQaCustomDescription(e.target.value)}
                            placeholder="Checklist item description..."
                            data-testid="input-qa-custom-description"
                          />
                        </div>
                        <Button
                          disabled={!qaCustomCategory.trim() || !qaCustomDescription.trim() || qaAddItemMutation.isPending}
                          onClick={() => {
                            const firstItem = qaItems[0];
                            qaAddItemMutation.mutate({
                              category: qaCustomCategory.trim(),
                              itemDescription: qaCustomDescription.trim(),
                              projectType: firstItem?.projectType,
                            });
                          }}
                          data-testid="button-add-qa-item"
                        >
                          {qaAddItemMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4 mr-1" />}
                          Add Item
                        </Button>
                      </div>
                    </div>
                  );
                })()}
              </>
            )}
          </div>
        )}

        {activeTab === "kickoff" && (
          <div className="space-y-4" data-testid="kickoff-tab">
            {kickoffLoading ? (
              <div className="py-8 text-center"><Loader2 className="w-5 h-5 animate-spin mx-auto text-muted-foreground" /></div>
            ) : !kickoff ? (
              <Card className="border-dashed">
                <CardContent className="py-12 text-center space-y-4">
                  <Rocket className="w-10 h-10 mx-auto text-muted-foreground/50" />
                  <div>
                    <p className="text-sm font-medium" data-testid="text-kickoff-empty">Send your client the kickoff form to collect everything you need before the build starts.</p>
                    <p className="text-xs text-muted-foreground mt-1">Covers business info, brand, pages, features, timeline, and more.</p>
                  </div>
                  <Button
                    className="bg-amber-600 hover:bg-amber-700 text-white"
                    onClick={() => {
                      const contactQuery = project?.contactId;
                      setKickoffClientName(company?.name ? "" : "");
                      setKickoffClientEmail("");
                      setKickoffCompanyName(company?.name || "");
                      if (project?.contactId) {
                        fetch(`/api/ops/contacts/${project.contactId}`, { credentials: "include" })
                          .then(r => r.json())
                          .then(c => {
                            setKickoffClientName(c.name || "");
                            setKickoffClientEmail(c.email || "");
                          })
                          .catch(() => {});
                      }
                      setShowKickoffDialog(true);
                    }}
                    data-testid="button-send-kickoff"
                  >
                    <Send className="w-4 h-4 mr-2" />
                    Send Kickoff Form
                  </Button>
                </CardContent>
              </Card>
            ) : kickoff.status !== "submitted" ? (
              <div className="space-y-4">
                <Card>
                  <CardContent className="py-5">
                    <div className="flex items-center justify-between flex-wrap gap-3">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium" data-testid="text-kickoff-client">{kickoff.clientName}</span>
                          <Badge variant={kickoff.status === "opened" ? "default" : "secondary"} className={kickoff.status === "opened" ? "bg-yellow-500/20 text-yellow-700 border-yellow-300" : ""} data-testid="badge-kickoff-status">
                            {kickoff.status === "opened" ? "Opened" : "Sent"}
                          </Badge>
                        </div>
                        <p className="text-xs text-muted-foreground" data-testid="text-kickoff-email">{kickoff.clientEmail}</p>
                        {kickoff.companyName && <p className="text-xs text-muted-foreground">{kickoff.companyName}</p>}
                        <p className="text-xs text-muted-foreground">Sent {new Date(kickoff.sentAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" })}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            const baseUrl = window.location.origin;
                            navigator.clipboard.writeText(`${baseUrl}/kickoff/${kickoff.token}`);
                            toast({ title: "Link copied to clipboard" });
                          }}
                          data-testid="button-copy-kickoff-link"
                        >
                          <Copy className="w-3.5 h-3.5 mr-1" />
                          Copy Link
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={async () => {
                            try {
                              await apiRequest("POST", `/api/ops/projects/${projectId}/kickoff/resend`);
                              toast({ title: "Kickoff form resent", description: `Email sent to ${kickoff.clientEmail}` });
                            } catch {
                              toast({ title: "Failed to resend", variant: "destructive" });
                            }
                          }}
                          data-testid="button-resend-kickoff"
                        >
                          <Mail className="w-3.5 h-3.5 mr-1" />
                          Resend
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>
            ) : (
              <div className="space-y-4">
                <Card>
                  <CardContent className="py-5">
                    <div className="flex items-center justify-between flex-wrap gap-3">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium" data-testid="text-kickoff-client">{kickoff.clientName}</span>
                          <Badge className="bg-green-500/20 text-green-700 border-green-300" data-testid="badge-kickoff-status">Submitted</Badge>
                        </div>
                        <p className="text-xs text-muted-foreground">{kickoff.clientEmail}</p>
                        {kickoff.companyName && <p className="text-xs text-muted-foreground">{kickoff.companyName}</p>}
                        <p className="text-xs text-muted-foreground">
                          Submitted {kickoff.submittedAt ? new Date(kickoff.submittedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }) : ""}
                        </p>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {kickoff.responses && (() => {
                  const r = kickoff.responses as Record<string, any>;
                  const sections = [
                    { title: "Your Business", keys: ["businessName", "businessDescription", "idealCustomer", "differentiator", "hasWebsite", "existingUrl", "websiteChanges"] },
                    { title: "Brand Identity", keys: ["existingBrand", "brandColors", "fonts", "brandPersonality", "brandPersonalityOther"] },
                    { title: "Website & Pages", keys: ["pagesNeeded", "pagesCustom", "homepageGoal", "inspirationSites", "sitesToAvoid"] },
                    { title: "Content & Copy", keys: ["copyWriter", "hasProfessionalPhotos", "needsStockPhotography", "hasVideoContent", "videoLinks"] },
                    { title: "Features & Functionality", keys: ["featuresNeeded", "featuresCustom", "thirdPartyIntegrations", "lockedInTools"] },
                    { title: "Access & Accounts", keys: ["ownsDomain", "domainRegistrar", "existingHosting", "loginsToShare", "socialPlatforms", "socialHandles"] },
                    { title: "Communication & Timeline", keys: ["pointOfContact", "preferredContact", "bestTimes", "hasDeadline", "deadlineDetails", "nervousAbout", "anythingElse"] },
                  ];
                  const labelMap: Record<string, string> = {
                    businessName: "Business Name", businessDescription: "About the Business", idealCustomer: "Ideal Customer",
                    differentiator: "What Sets Them Apart", hasWebsite: "Has Existing Website", existingUrl: "Current URL",
                    websiteChanges: "Keep/Change/Remove", existingBrand: "Brand Status", brandColors: "Brand Colors",
                    fonts: "Fonts", brandPersonality: "Brand Personality", brandPersonalityOther: "Other Personality",
                    pagesNeeded: "Pages Needed", pagesCustom: "Custom Pages", homepageGoal: "Homepage Goal",
                    inspirationSites: "Inspiration Sites", sitesToAvoid: "Sites to Avoid", copyWriter: "Who Writes Copy",
                    hasProfessionalPhotos: "Professional Photos", needsStockPhotography: "Needs Stock Photos",
                    hasVideoContent: "Video Content", videoLinks: "Video Links",
                    featuresNeeded: "Features", featuresCustom: "Custom Features", thirdPartyIntegrations: "Integrations",
                    lockedInTools: "Locked-in Tools", ownsDomain: "Owns Domain", domainRegistrar: "Registrar",
                    existingHosting: "Hosting", loginsToShare: "Logins to Share", socialPlatforms: "Social Platforms",
                    socialHandles: "Social Handles", pointOfContact: "Point of Contact", preferredContact: "Preferred Contact",
                    bestTimes: "Best Times", hasDeadline: "Has Deadline", deadlineDetails: "Deadline Details",
                    nervousAbout: "Concerns", anythingElse: "Additional Notes",
                  };
                  return (
                    <div className="space-y-4">
                      {sections.map(section => {
                        const hasData = section.keys.some(k => {
                          const v = r[k];
                          return v !== undefined && v !== null && v !== "" && !(Array.isArray(v) && v.length === 0);
                        });
                        if (!hasData) return null;
                        return (
                          <Card key={section.title}>
                            <CardHeader className="pb-2">
                              <CardTitle className="text-sm font-semibold text-amber-700 uppercase tracking-wide">{section.title}</CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-3">
                              {section.keys.map(k => {
                                const v = r[k];
                                if (v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0)) return null;
                                const displayVal = Array.isArray(v) ? v.join(", ") : String(v);
                                return (
                                  <div key={k}>
                                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{labelMap[k] || k}</p>
                                    <p className="text-sm mt-0.5 whitespace-pre-wrap" data-testid={`text-kickoff-${k}`}>{displayVal}</p>
                                  </div>
                                );
                              })}
                            </CardContent>
                          </Card>
                        );
                      })}
                    </div>
                  );
                })()}

                {kickoff.uploadedFiles && (kickoff.uploadedFiles as any[]).length > 0 && (
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm font-semibold text-amber-700 uppercase tracking-wide">Uploaded Files</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2">
                      {(kickoff.uploadedFiles as any[]).map((f: any, i: number) => (
                        <div key={i} className="flex items-center gap-3 py-2 px-3 rounded-md border border-border/30">
                          <FileText className="w-4 h-4 text-muted-foreground shrink-0" />
                          <div className="flex-1 min-w-0">
                            <span className="text-sm font-medium truncate block">{f.name}</span>
                            <span className="text-xs text-muted-foreground">{f.size ? `${(f.size / 1024).toFixed(1)} KB` : ""} · {f.type || "file"}</span>
                          </div>
                          <a href={f.url} target="_blank" rel="noopener noreferrer">
                            <Button variant="ghost" size="icon" data-testid={`button-download-kickoff-file-${i}`}>
                              <Download className="w-3.5 h-3.5" />
                            </Button>
                          </a>
                        </div>
                      ))}
                    </CardContent>
                  </Card>
                )}

                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-semibold">Internal Notes</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <Textarea
                      placeholder="Add your notes about this kickoff submission..."
                      value={kickoffNotes || kickoff.notes || ""}
                      onChange={(e) => setKickoffNotes(e.target.value)}
                      className="min-h-[100px]"
                      data-testid="textarea-kickoff-notes"
                    />
                    <Button
                      size="sm"
                      className="mt-2"
                      onClick={async () => {
                        try {
                          await apiRequest("PATCH", `/api/ops/projects/${projectId}/kickoff/notes`, { notes: kickoffNotes || kickoff.notes || "" });
                          queryClient.invalidateQueries({ queryKey: ["/api/ops/projects", projectId, "kickoff"] });
                          toast({ title: "Notes saved" });
                        } catch {
                          toast({ title: "Failed to save notes", variant: "destructive" });
                        }
                      }}
                      data-testid="button-save-kickoff-notes"
                    >
                      Save Notes
                    </Button>
                  </CardContent>
                </Card>

                <Button variant="outline" disabled className="opacity-50" data-testid="button-build-proposal">
                  <FileText className="w-4 h-4 mr-2" />
                  Build Proposal (Coming Soon)
                </Button>
              </div>
            )}
          </div>
        )}

        {activeTab === "sequence" && (
          <div className="space-y-4" data-testid="sequence-tab">
            {seqLoading ? (
              <div className="py-8 text-center"><Loader2 className="w-5 h-5 animate-spin mx-auto text-muted-foreground" /></div>
            ) : !welcomeSeq || welcomeSeq.status === "cancelled" ? (
              <Card className="border-dashed">
                <CardContent className="py-12 text-center space-y-4">
                  <Mail className="w-10 h-10 mx-auto text-muted-foreground/50" />
                  <div>
                    <p className="text-sm font-medium" data-testid="text-seq-empty">Start the welcome sequence to begin onboarding this client.</p>
                    <p className="text-xs text-muted-foreground mt-1">A 3-email series introducing your process and delivering the kickoff form.</p>
                  </div>
                  <Button
                    className="bg-amber-600 hover:bg-amber-700 text-white"
                    onClick={() => {
                      setSeqClientName("");
                      setSeqClientEmail("");
                      setSeqCompanyName(company?.name || "");
                      if (project?.contactId) {
                        fetch(`/api/ops/contacts/${project.contactId}`, { credentials: "include" })
                          .then(r => r.json())
                          .then(c => {
                            setSeqClientName(c.name || "");
                            setSeqClientEmail(c.email || "");
                          })
                          .catch(() => {});
                      }
                      setShowSeqDialog(true);
                    }}
                    data-testid="button-start-sequence"
                  >
                    <Send className="w-4 h-4 mr-2" />
                    Start Welcome Sequence
                  </Button>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-4">
                <Card>
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-base">Welcome Sequence</CardTitle>
                      <div className="flex items-center gap-2">
                        <Badge variant={
                          welcomeSeq.status === "completed" ? "default" :
                          welcomeSeq.status === "running" ? "secondary" : "outline"
                        } className={
                          welcomeSeq.status === "completed" ? "bg-green-500/20 text-green-700 border-green-300" :
                          welcomeSeq.status === "running" ? "bg-amber-500/20 text-amber-700 border-amber-300" : ""
                        } data-testid="badge-seq-status">
                          {welcomeSeq.status === "completed" ? "Completed" :
                           welcomeSeq.status === "running" ? "Running" :
                           welcomeSeq.status === "pending" ? "Pending" : welcomeSeq.status}
                        </Badge>
                        <Badge variant="outline" className="text-xs" data-testid="badge-seq-trigger">
                          {welcomeSeq.triggeredBy === "auto" ? "Auto-triggered" : "Manual"}
                        </Badge>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-1">
                    <p className="text-xs text-muted-foreground">
                      Client: {welcomeSeq.clientName} ({welcomeSeq.clientEmail})
                      {welcomeSeq.companyName && ` · ${welcomeSeq.companyName}`}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Started {welcomeSeq.createdAt ? new Date(welcomeSeq.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }) : "—"}
                    </p>
                  </CardContent>
                </Card>

                {[
                  { num: 1 as const, subject: "You made a good call.", sentAt: welcomeSeq.email1SentAt, error: welcomeSeq.email1Error },
                  { num: 2 as const, subject: "Before we build — a few things worth knowing.", sentAt: welcomeSeq.email2SentAt, error: welcomeSeq.email2Error },
                  { num: 3 as const, subject: "Let's get started — your kickoff form is ready.", sentAt: welcomeSeq.email3SentAt, error: welcomeSeq.email3Error },
                ].map((email, idx) => {
                  const isSent = !!email.sentAt;
                  const isError = !!email.error;
                  const isPending = !isSent && !isError && welcomeSeq.status === "running";
                  const prevSent = idx === 0 ? true : idx === 1 ? !!welcomeSeq.email1SentAt : !!welcomeSeq.email2SentAt;
                  const isNext = !isSent && !isError && prevSent && welcomeSeq.status === "running";

                  return (
                    <Card key={email.num} className={`transition-all ${isSent ? "border-green-200 bg-green-50/30" : isError ? "border-red-200 bg-red-50/30" : isNext ? "border-amber-200 bg-amber-50/20" : "opacity-60"}`} data-testid={`card-email-${email.num}`}>
                      <CardContent className="py-4">
                        <div className="flex items-start gap-3">
                          <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 mt-0.5 ${
                            isSent ? "bg-green-100 text-green-600" :
                            isError ? "bg-red-100 text-red-600" :
                            isNext ? "bg-amber-100 text-amber-600" : "bg-muted text-muted-foreground"
                          }`}>
                            {isSent ? (
                              <CheckCircle2 className="w-4 h-4" />
                            ) : isError ? (
                              <AlertCircle className="w-4 h-4" />
                            ) : isNext ? (
                              <div className="w-2.5 h-2.5 rounded-full bg-amber-500 animate-pulse" />
                            ) : (
                              <Circle className="w-4 h-4" />
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-medium text-muted-foreground">Email {email.num}</span>
                              {isSent && <Badge variant="outline" className="text-xs bg-green-50 text-green-700 border-green-200">Sent</Badge>}
                              {isError && <Badge variant="outline" className="text-xs bg-red-50 text-red-700 border-red-200">Failed</Badge>}
                              {isNext && <Badge variant="outline" className="text-xs bg-amber-50 text-amber-700 border-amber-200">Scheduled</Badge>}
                            </div>
                            <p className="text-sm font-medium mt-0.5" data-testid={`text-email-subject-${email.num}`}>{email.subject}</p>
                            {isSent && email.sentAt && (
                              <p className="text-xs text-muted-foreground mt-1">
                                Sent {new Date(email.sentAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" })}
                              </p>
                            )}
                            {isError && (
                              <p className="text-xs text-red-600 mt-1">Error: {email.error}</p>
                            )}
                            {isNext && !isSent && idx > 0 && (
                              <p className="text-xs text-muted-foreground mt-1">Sends ~2 hours after Email {idx}</p>
                            )}
                          </div>
                          {(isSent || isError) && welcomeSeq.status !== "cancelled" && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-xs"
                              onClick={async () => {
                                try {
                                  await apiRequest("POST", `/api/ops/projects/${projectId}/sequence/resend/${email.num}`);
                                  queryClient.invalidateQueries({ queryKey: ["/api/ops/projects", projectId, "sequence"] });
                                  toast({ title: `Email ${email.num} resent`, description: `Sent to ${welcomeSeq.clientEmail}` });
                                } catch {
                                  toast({ title: "Failed to resend", variant: "destructive" });
                                }
                              }}
                              data-testid={`button-resend-email-${email.num}`}
                            >
                              <Send className="w-3 h-3 mr-1" />
                              Resend
                            </Button>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}

                <div className="flex gap-2 pt-2">
                  {welcomeSeq.status === "running" && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-red-600 border-red-200 hover:bg-red-50"
                      onClick={async () => {
                        if (!confirm("Cancel the remaining emails in this sequence?")) return;
                        try {
                          await apiRequest("POST", `/api/ops/projects/${projectId}/sequence/cancel`);
                          queryClient.invalidateQueries({ queryKey: ["/api/ops/projects", projectId, "sequence"] });
                          toast({ title: "Sequence cancelled" });
                        } catch {
                          toast({ title: "Failed to cancel", variant: "destructive" });
                        }
                      }}
                      data-testid="button-cancel-sequence"
                    >
                      <X className="w-3.5 h-3.5 mr-1" />
                      Cancel Sequence
                    </Button>
                  )}
                  {(welcomeSeq.status === "completed" || welcomeSeq.status === "cancelled") && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setSeqClientName(welcomeSeq.clientName);
                        setSeqClientEmail(welcomeSeq.clientEmail);
                        setSeqCompanyName(welcomeSeq.companyName || "");
                        setShowSeqDialog(true);
                      }}
                      data-testid="button-restart-sequence"
                    >
                      <Send className="w-3.5 h-3.5 mr-1" />
                      Restart Sequence
                    </Button>
                  )}
                </div>

                {welcomeSeq.status === "completed" && (
                  <Card className="border-green-200 bg-green-50/30">
                    <CardContent className="py-4">
                      <div className="flex items-center gap-2 text-green-700">
                        <CheckCircle2 className="w-4 h-4" />
                        <span className="text-sm font-medium">Sequence completed</span>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">
                        Kickoff form sent as part of Email 3. View responses in the Kickoff tab.
                      </p>
                    </CardContent>
                  </Card>
                )}
              </div>
            )}
          </div>
        )}

        {activeTab === "activity" && (
          <div className="space-y-1">
            {activityLogs.length === 0 && (
              <p className="text-muted-foreground text-sm py-8 text-center">No activity yet</p>
            )}
            {activityLogs.map((log) => {
              const iconMap: Record<string, typeof Activity> = {
                created: Plus,
                updated: FileText,
                deleted: AlertTriangle,
                completed: CheckCircle2,
                stage_changed: ChevronRight,
              };
              const Icon = iconMap[log.action] || Activity;
              const details = log.details as Record<string, unknown> | null;
              let desc = `${log.entityType} ${log.action}`;
              if (log.action === "stage_changed" && details) {
                desc = `Stage changed from ${STAGE_LABELS[details.from as string] || details.from} to ${STAGE_LABELS[details.to as string] || details.to}`;
              } else if (details && typeof details === "object") {
                if ("title" in details) desc = `${log.action === "created" ? "Added" : log.action === "completed" ? "Completed" : "Updated"} ${log.entityType}: ${details.title}`;
                else if ("name" in details) desc = `${log.action} ${log.entityType}: ${details.name}`;
              }

              return (
                <div
                  key={log.id}
                  className="flex items-start gap-3 py-2.5 px-3 rounded-md"
                  data-testid={`activity-${log.id}`}
                >
                  <div className="w-7 h-7 rounded-full bg-muted/50 flex items-center justify-center shrink-0 mt-0.5">
                    <Icon className="w-3.5 h-3.5 text-muted-foreground" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm" data-testid={`text-activity-desc-${log.id}`}>{desc}</p>
                    <span className="text-xs text-muted-foreground" data-testid={`text-activity-time-${log.id}`}>
                      {relativeTime(log.createdAt)}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <Dialog open={showQaInitDialog} onOpenChange={setShowQaInitDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Initialize QA Checklist</DialogTitle>
            <DialogDescription>
              Select a project type to populate the QA checklist with the appropriate template items.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Project Type *</Label>
              <Select value={qaInitProjectType} onValueChange={setQaInitProjectType}>
                <SelectTrigger data-testid="select-qa-project-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="marketing_website">Marketing Website</SelectItem>
                  <SelectItem value="crm_portal">CRM Portal</SelectItem>
                  <SelectItem value="saas_platform">SaaS Platform</SelectItem>
                  <SelectItem value="ecommerce_site">E-Commerce Site</SelectItem>
                  <SelectItem value="internal_tool">Internal Tool</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="ghost" onClick={() => setShowQaInitDialog(false)} data-testid="button-cancel-qa-init">
              Cancel
            </Button>
            <Button
              disabled={!qaInitProjectType || qaInitializeMutation.isPending}
              onClick={() => qaInitializeMutation.mutate(qaInitProjectType)}
              data-testid="button-confirm-qa-init"
            >
              {qaInitializeMutation.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                  Initializing...
                </>
              ) : (
                <>
                  <ClipboardCheck className="w-4 h-4 mr-1" />
                  Initialize
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showInvoiceDialog} onOpenChange={setShowInvoiceDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Generate Invoice</DialogTitle>
            <DialogDescription>
              Create a branded PDF invoice from this project's payments. The invoice will be saved to the Documents tab automatically.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {payments.length > 0 && (() => {
              const total = payments.reduce((s, p) => s + p.amount, 0);
              const paid = payments.filter(p => p.status === "received").reduce((s, p) => s + p.amount, 0);
              const due = total - paid;
              const typeLabels: Record<string, string> = { deposit: "Deposit", milestone: "Milestone", final: "Final", other: "Other" };
              return (
                <div className="rounded-md border border-border/50 overflow-hidden" data-testid="invoice-preview">
                  <div className="bg-muted/30 px-3 py-1.5 border-b border-border/50">
                    <span className="text-xs font-medium text-muted-foreground">Invoice Line Items</span>
                  </div>
                  <div className="divide-y divide-border/30">
                    {payments.map((p) => (
                      <div key={p.id} className="flex items-center gap-2 px-3 py-1.5 text-sm" data-testid={`invoice-preview-item-${p.id}`}>
                        <span className="flex-1 truncate">{p.label}</span>
                        <span className="text-xs text-muted-foreground">{typeLabels[p.type] || p.type}</span>
                        <span className="tabular-nums font-medium w-20 text-right">{currencyFmt.format(p.amount)}</span>
                        {p.status === "received" ? (
                          <Badge variant="outline" className="text-[10px] bg-emerald-500/10 text-emerald-500 border-emerald-500/30 w-12 justify-center">Paid</Badge>
                        ) : (
                          <Badge variant="outline" className="text-[10px] bg-amber-500/10 text-amber-600 border-amber-500/30 w-12 justify-center">Due</Badge>
                        )}
                      </div>
                    ))}
                  </div>
                  <div className="border-t border-border/50 px-3 py-2 space-y-1">
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>Total</span>
                      <span className="tabular-nums">{currencyFmt.format(total)}</span>
                    </div>
                    {paid > 0 && (
                      <div className="flex justify-between text-xs text-emerald-500">
                        <span>Paid</span>
                        <span className="tabular-nums">-{currencyFmt.format(paid)}</span>
                      </div>
                    )}
                    <div className="flex justify-between text-sm font-semibold pt-1 border-t border-border/30">
                      <span>Amount Due</span>
                      <span className="tabular-nums" data-testid="text-invoice-amount-due">{currencyFmt.format(due)}</span>
                    </div>
                    {due <= 0 && (
                      <p className="text-xs text-emerald-500 font-medium pt-1" data-testid="text-invoice-paid-in-full">All payments received — invoice will be marked "Paid in Full"</p>
                    )}
                  </div>
                </div>
              );
            })()}
            <div className="space-y-2">
              <Label>Due Date (optional)</Label>
              <Input
                type="date"
                value={invoiceDueDate}
                onChange={(e) => setInvoiceDueDate(e.target.value)}
                data-testid="input-invoice-due-date"
              />
            </div>
            <div className="space-y-2">
              <Label>Notes (optional)</Label>
              <Textarea
                placeholder="Payment terms, thank you message, etc."
                value={invoiceNotes}
                onChange={(e) => setInvoiceNotes(e.target.value)}
                data-testid="input-invoice-notes"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowInvoiceDialog(false)} data-testid="button-cancel-invoice">
              Cancel
            </Button>
            <Button
              onClick={() => generateInvoiceMutation.mutate({
                notes: invoiceNotes || undefined,
                dueDate: invoiceDueDate || undefined,
              })}
              disabled={generateInvoiceMutation.isPending}
              data-testid="button-confirm-invoice"
            >
              {generateInvoiceMutation.isPending && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}
              Generate Invoice
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!collectPaymentId} onOpenChange={(open) => { if (!open) setCollectPaymentId(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Collect Payment</DialogTitle>
            <DialogDescription>
              {(() => {
                const p = payments.find(p => p.id === collectPaymentId);
                return p ? `${p.label} — ${currencyFmt.format(p.amount)}` : "";
              })()}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <Label>How was this payment received?</Label>
            <Select value={collectMethod} onValueChange={setCollectMethod}>
              <SelectTrigger data-testid="select-payment-method">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="stripe" data-testid="option-stripe">Stripe</SelectItem>
                <SelectItem value="cashapp" data-testid="option-cashapp">Cash App</SelectItem>
                <SelectItem value="venmo" data-testid="option-venmo">Venmo</SelectItem>
                <SelectItem value="cash" data-testid="option-cash">Cash</SelectItem>
                <SelectItem value="check" data-testid="option-check">Check</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCollectPaymentId(null)} data-testid="button-cancel-collect">
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (collectPaymentId) {
                  markPaymentReceivedMutation.mutate({ paymentId: collectPaymentId, paymentMethod: collectMethod });
                }
              }}
              disabled={markPaymentReceivedMutation.isPending}
              data-testid="button-confirm-collect"
            >
              {markPaymentReceivedMutation.isPending && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}
              Mark Collected
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showKickoffDialog} onOpenChange={setShowKickoffDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Send Kickoff Form</DialogTitle>
            <DialogDescription>Confirm the client details and send the kickoff discovery form.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <Label className="text-xs">Client Name</Label>
              <Input value={kickoffClientName} onChange={(e) => setKickoffClientName(e.target.value)} placeholder="Client name" data-testid="input-kickoff-name" />
            </div>
            <div>
              <Label className="text-xs">Client Email</Label>
              <Input value={kickoffClientEmail} onChange={(e) => setKickoffClientEmail(e.target.value)} placeholder="client@example.com" type="email" data-testid="input-kickoff-email" />
            </div>
            <div>
              <Label className="text-xs">Company Name</Label>
              <Input value={kickoffCompanyName} onChange={(e) => setKickoffCompanyName(e.target.value)} placeholder="Company name (optional)" data-testid="input-kickoff-company" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowKickoffDialog(false)}>Cancel</Button>
            <Button
              className="bg-amber-600 hover:bg-amber-700 text-white"
              disabled={!kickoffClientName || !kickoffClientEmail}
              onClick={async () => {
                try {
                  await apiRequest("POST", `/api/ops/projects/${projectId}/kickoff/send`, {
                    clientName: kickoffClientName,
                    clientEmail: kickoffClientEmail,
                    companyName: kickoffCompanyName || undefined,
                  });
                  queryClient.invalidateQueries({ queryKey: ["/api/ops/projects", projectId, "kickoff"] });
                  setShowKickoffDialog(false);
                  toast({ title: "Kickoff form sent", description: `Email sent to ${kickoffClientEmail}` });
                } catch (e: any) {
                  toast({ title: "Failed to send", description: e.message, variant: "destructive" });
                }
              }}
              data-testid="button-confirm-send-kickoff"
            >
              <Send className="w-4 h-4 mr-2" />
              Send Form
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showSeqDialog} onOpenChange={setShowSeqDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{welcomeSeq && welcomeSeq.status !== "cancelled" ? "Restart Welcome Sequence" : "Start Welcome Sequence"}</DialogTitle>
            <DialogDescription>
              {welcomeSeq && welcomeSeq.status !== "cancelled"
                ? "This will restart the 3-email onboarding sequence from the beginning."
                : "Send a 3-email onboarding sequence introducing your process and delivering the kickoff form."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Client Name *</Label>
              <Input value={seqClientName} onChange={e => setSeqClientName(e.target.value)} placeholder="John Smith" data-testid="input-seq-name" />
            </div>
            <div className="space-y-2">
              <Label>Client Email *</Label>
              <Input value={seqClientEmail} onChange={e => setSeqClientEmail(e.target.value)} placeholder="john@example.com" type="email" data-testid="input-seq-email" />
            </div>
            <div className="space-y-2">
              <Label>Company Name</Label>
              <Input value={seqCompanyName} onChange={e => setSeqCompanyName(e.target.value)} placeholder="Optional" data-testid="input-seq-company" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowSeqDialog(false)} data-testid="button-cancel-seq">Cancel</Button>
            <Button
              className="bg-amber-600 hover:bg-amber-700 text-white"
              disabled={!seqClientName || !seqClientEmail}
              onClick={async () => {
                try {
                  const endpoint = welcomeSeq && welcomeSeq.status !== "cancelled"
                    ? `/api/ops/projects/${projectId}/sequence/restart`
                    : `/api/ops/projects/${projectId}/sequence/start`;
                  await apiRequest("POST", endpoint, {
                    clientName: seqClientName,
                    clientEmail: seqClientEmail,
                    companyName: seqCompanyName || undefined,
                  });
                  queryClient.invalidateQueries({ queryKey: ["/api/ops/projects", projectId, "sequence"] });
                  setShowSeqDialog(false);
                  toast({
                    title: "Welcome sequence started",
                    description: `Email 1 sent to ${seqClientEmail}`,
                  });
                } catch (e: any) {
                  toast({ title: "Failed to start sequence", description: e.message, variant: "destructive" });
                }
              }}
              data-testid="button-confirm-seq"
            >
              <Send className="w-4 h-4 mr-2" />
              {welcomeSeq && welcomeSeq.status !== "cancelled" ? "Restart Sequence" : "Start Sequence"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
