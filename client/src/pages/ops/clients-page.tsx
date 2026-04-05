import { useState, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { HelpTooltip, HELP_CONTENT } from "@/components/help-tooltip";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter,
} from "@/components/ui/dialog";
import {
  UserCircle, Plus, DollarSign, TrendingUp, Users, Briefcase,
  ArrowRight, Mail, Phone, Globe, Building2, FileText, Clock,
  ChevronRight, CreditCard, BarChart3, Edit, Trash2, X, AlertTriangle,
  Loader2, Lock, CheckCircle, Link2, Copy, ExternalLink,
} from "lucide-react";
import { loadStripe } from "@stripe/stripe-js";
import { Elements, CardElement, useStripe, useElements } from "@stripe/react-stripe-js";
import type { Client, Deal, Subscription, Project, StripePayment, ContactSubmission } from "@shared/schema";

const stripePromise = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY
  ? loadStripe(import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY)
  : null;

const STATUS_COLORS: Record<string, string> = {
  active: "bg-emerald-500/15 text-emerald-400",
  prospect: "bg-blue-500/15 text-blue-400",
  paused: "bg-amber-500/15 text-amber-400",
  churned: "bg-red-500/15 text-red-400",
};

const DEAL_STAGE_COLORS: Record<string, string> = {
  qualification: "bg-blue-500/15 text-blue-400",
  proposal: "bg-amber-500/15 text-amber-400",
  negotiation: "bg-violet-500/15 text-violet-400",
  closed_won: "bg-emerald-500/15 text-emerald-400",
  closed_lost: "bg-red-500/15 text-red-400",
};

const SUB_STATUS_COLORS: Record<string, string> = {
  active: "bg-emerald-500/15 text-emerald-400",
  past_due: "bg-red-500/15 text-red-400",
  canceled: "bg-muted text-muted-foreground",
  trialing: "bg-blue-500/15 text-blue-400",
  paused: "bg-amber-500/15 text-amber-400",
};

function formatCurrency(amount: string | number | null | undefined): string {
  const num = parseFloat(String(amount || "0"));
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(num);
}

function formatDate(date: string | Date | null | undefined): string {
  if (!date) return "";
  return new Date(date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

interface RevenueSummary {
  totalMrr: number;
  totalArr: number;
  activeClients: number;
  totalClients: number;
  activeSubscriptions: number;
  pipelineValue: number;
  wonValue: number;
  totalCollected: number;
  wonDeals: number;
  openDeals: number;
}

function InlinePaymentForm({ subForm, clientId, clientSecret, onSuccess, onBack }: {
  subForm: { name: string; amount: string; interval: string; notes: string; startDate: string };
  clientId: string;
  clientSecret: string;
  onSuccess: () => void;
  onBack: () => void;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const { toast } = useToast();
  const [processing, setProcessing] = useState(false);
  const [cardComplete, setCardComplete] = useState(false);
  const [cardError, setCardError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = async () => {
    if (!stripe || !elements || submitted) return;
    setProcessing(true);
    setSubmitted(true);

    try {
      const cardElement = elements.getElement(CardElement);
      if (!cardElement) throw new Error("Card element not found");

      const { error, setupIntent } = await stripe.confirmCardSetup(clientSecret, {
        payment_method: { card: cardElement },
      });

      if (error) {
        toast({ title: error.message || "Payment failed", variant: "destructive" });
        setProcessing(false);
        setSubmitted(false);
        return;
      }

      if (!setupIntent) {
        toast({ title: "Setup failed", variant: "destructive" });
        setProcessing(false);
        setSubmitted(false);
        return;
      }

      if (setupIntent.status === "requires_action") {
        toast({ title: "Additional authentication required. Please complete verification.", variant: "destructive" });
        setProcessing(false);
        setSubmitted(false);
        return;
      }

      if (setupIntent.status !== "succeeded") {
        toast({ title: `Setup status: ${setupIntent.status}. Please try again.`, variant: "destructive" });
        setProcessing(false);
        setSubmitted(false);
        return;
      }

      if (!setupIntent.payment_method) {
        toast({ title: "No payment method returned", variant: "destructive" });
        setProcessing(false);
        setSubmitted(false);
        return;
      }

      const paymentMethodId = typeof setupIntent.payment_method === "string"
        ? setupIntent.payment_method
        : setupIntent.payment_method.id;

      const res = await apiRequest("POST", `/api/ops/clients/${clientId}/subscriptions/create`, {
        name: subForm.name,
        amount: subForm.amount,
        interval: subForm.interval,
        paymentMethodId,
        notes: subForm.notes || undefined,
        startDate: subForm.startDate || undefined,
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || "Failed to create subscription");
      }

      const result = await res.json();

      if (result.requiresAction && result.paymentIntentClientSecret) {
        const { error: confirmError } = await stripe.confirmCardPayment(result.paymentIntentClientSecret);
        if (confirmError) {
          toast({ title: confirmError.message || "Payment authentication failed", variant: "destructive" });
          setSubmitted(false);
          setProcessing(false);
          return;
        }
      }

      onSuccess();
    } catch (err: any) {
      toast({ title: err.message || "Failed to process payment", variant: "destructive" });
      setSubmitted(false);
    } finally {
      setProcessing(false);
    }
  };

  return (
    <div className="space-y-4">
      <Card className="bg-card/30 border-border/40">
        <CardContent className="pt-4">
          <div className="flex justify-between items-center mb-1">
            <span className="text-sm text-muted-foreground">Subscription</span>
            <span className="font-medium">{subForm.name}</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-sm text-muted-foreground">Amount</span>
            <span className="font-mono font-bold text-lg text-emerald-400">
              {formatCurrency(subForm.amount)}/{subForm.interval === "monthly" ? "mo" : subForm.interval === "quarterly" ? "qtr" : "yr"}
            </span>
          </div>
        </CardContent>
      </Card>

      <div>
        <label className="text-sm font-medium mb-2 block">Card Details</label>
        <div className={`border rounded-lg p-3 bg-background/50 ${cardError ? "border-red-500/50" : "border-border/50"}`}>
          <CardElement
            options={{
              style: {
                base: {
                  fontSize: "16px",
                  color: "#e0e0e0",
                  "::placeholder": { color: "#666" },
                  fontFamily: "Inter, system-ui, sans-serif",
                },
                invalid: { color: "#ef4444" },
              },
            }}
            onChange={(e) => {
              setCardComplete(e.complete);
              setCardError(e.error?.message || null);
            }}
          />
        </div>
        {cardError && <p className="text-xs text-red-400 mt-1" data-testid="text-card-error">{cardError}</p>}
      </div>

      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Lock className="h-3 w-3" />
        <span>Payments are securely processed. Card data never touches our servers.</span>
      </div>

      <div className="flex gap-2 justify-end pt-2">
        <Button variant="ghost" onClick={onBack} disabled={processing} data-testid="btn-back-details">
          Back
        </Button>
        <Button
          onClick={handleSubmit}
          disabled={!stripe || !cardComplete || processing || submitted}
          data-testid="btn-confirm-subscription"
        >
          {processing ? (
            <><Loader2 className="h-4 w-4 mr-1 animate-spin" /> Processing...</>
          ) : (
            <><CreditCard className="h-4 w-4 mr-1" /> Subscribe {formatCurrency(subForm.amount)}/{subForm.interval === "monthly" ? "mo" : "yr"}</>
          )}
        </Button>
      </div>
    </div>
  );
}

function InlineOneTimePayment({ clientId, clientSecret, paymentIntentId, description, amount, onSuccess, onBack }: {
  clientId: string;
  clientSecret: string;
  paymentIntentId: string;
  description: string;
  amount: string;
  onSuccess: () => void;
  onBack: () => void;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const { toast } = useToast();
  const [processing, setProcessing] = useState(false);
  const [cardComplete, setCardComplete] = useState(false);
  const [cardError, setCardError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = async () => {
    if (!stripe || !elements || submitted) return;
    setProcessing(true);
    setSubmitted(true);

    try {
      const cardElement = elements.getElement(CardElement);
      if (!cardElement) throw new Error("Card element not found");

      const { error, paymentIntent } = await stripe.confirmCardPayment(clientSecret, {
        payment_method: { card: cardElement },
      });

      if (error) {
        toast({ title: error.message || "Payment failed", variant: "destructive" });
        setProcessing(false);
        setSubmitted(false);
        return;
      }

      if (!paymentIntent || paymentIntent.status !== "succeeded") {
        toast({ title: "Payment not completed. Please try again.", variant: "destructive" });
        setProcessing(false);
        setSubmitted(false);
        return;
      }

      const res = await apiRequest("POST", `/api/ops/clients/${clientId}/payments/confirm`, {
        paymentIntentId,
        description,
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || "Failed to record payment");
      }

      onSuccess();
    } catch (err: any) {
      toast({ title: err.message || "Payment failed", variant: "destructive" });
      setSubmitted(false);
    } finally {
      setProcessing(false);
    }
  };

  return (
    <div className="space-y-4">
      <Card className="bg-card/30 border-border/40">
        <CardContent className="pt-4">
          <div className="flex justify-between items-center mb-1">
            <span className="text-sm text-muted-foreground">Description</span>
            <span className="font-medium">{description}</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-sm text-muted-foreground">Amount</span>
            <span className="font-mono font-bold text-lg text-emerald-400">{formatCurrency(amount)}</span>
          </div>
        </CardContent>
      </Card>

      <div>
        <label className="text-sm font-medium mb-2 block">Card Details</label>
        <div className={`border rounded-lg p-3 bg-background/50 ${cardError ? "border-red-500/50" : "border-border/50"}`}>
          <CardElement
            options={{
              style: {
                base: { fontSize: "16px", color: "#e0e0e0", "::placeholder": { color: "#666" }, fontFamily: "Inter, system-ui, sans-serif" },
                invalid: { color: "#ef4444" },
              },
            }}
            onChange={(e) => { setCardComplete(e.complete); setCardError(e.error?.message || null); }}
          />
        </div>
        {cardError && <p className="text-xs text-red-400 mt-1" data-testid="text-pay-card-error">{cardError}</p>}
      </div>

      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Lock className="h-3 w-3" />
        <span>Payments are securely processed. Card data never touches our servers.</span>
      </div>

      <div className="flex gap-2 justify-end pt-2">
        <Button variant="ghost" onClick={onBack} disabled={processing} data-testid="btn-pay-back">Back</Button>
        <Button onClick={handleSubmit} disabled={!stripe || !cardComplete || processing || submitted} data-testid="btn-confirm-payment">
          {processing ? <><Loader2 className="h-4 w-4 mr-1 animate-spin" /> Processing...</> : <><CreditCard className="h-4 w-4 mr-1" /> Pay {formatCurrency(amount)}</>}
        </Button>
      </div>
    </div>
  );
}

export default function ClientsPage() {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);
  const [showCreateClient, setShowCreateClient] = useState(false);
  const [createMode, setCreateMode] = useState<"choose" | "manual" | "crm" | "projects">("choose");
  const [showCreateDeal, setShowCreateDeal] = useState(false);
  const [showCreateSub, setShowCreateSub] = useState(false);
  const [showEditSub, setShowEditSub] = useState(false);
  const [editingSub, setEditingSub] = useState<Subscription | null>(null);
  const [editSubForm, setEditSubForm] = useState({ name: "", amount: "", interval: "monthly", status: "active", notes: "" });
  const [formData, setFormData] = useState({ name: "", email: "", phone: "", website: "", status: "active", notes: "" });
  const [dealForm, setDealForm] = useState({ name: "", value: "", stage: "qualification", probability: "50", notes: "" });
  const [subForm, setSubForm] = useState({ name: "", amount: "", interval: "monthly", notes: "", startDate: "" });
  const [showCollectPayment, setShowCollectPayment] = useState(false);
  const [payStep, setPayStep] = useState<"details" | "card" | "success">("details");
  const [payForm, setPayForm] = useState({ amount: "", description: "" });
  const [payClientSecret, setPayClientSecret] = useState<string | null>(null);
  const [payIntentId, setPayIntentId] = useState<string | null>(null);

  const resetSubDialog = useCallback(() => {
    setSubStep("details");
    setSetupClientSecret(null);
    setSubForm({ name: "", amount: "", interval: "monthly", notes: "", startDate: "" });
  }, []);

  const resetPayDialog = useCallback(() => {
    setPayStep("details");
    setPayForm({ amount: "", description: "" });
    setPayClientSecret(null);
    setPayIntentId(null);
  }, []);

  const createPayIntentMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/ops/clients/${selectedClientId}/payments/create-intent`, {
        amount: payForm.amount,
        description: payForm.description || "One-time payment",
      });
      return res.json();
    },
    onSuccess: (data: { clientSecret: string; paymentIntentId: string }) => {
      setPayClientSecret(data.clientSecret);
      setPayIntentId(data.paymentIntentId);
      setPayStep("card");
    },
    onError: (error: any) => {
      toast({ title: error?.message || "Failed to initialize payment", variant: "destructive" });
    },
  });

  const [showPayLink, setShowPayLink] = useState(false);
  const [payLinkForm, setPayLinkForm] = useState({ amount: "", description: "" });
  const [generatedPayLink, setGeneratedPayLink] = useState<string | null>(null);
  const [payLinkCopied, setPayLinkCopied] = useState(false);

  const createPayLinkMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/ops/clients/${selectedClientId}/payment-links`, {
        amount: payLinkForm.amount,
        description: payLinkForm.description || "Payment",
      });
      return res.json();
    },
    onSuccess: (data: { link: any; url: string }) => {
      setGeneratedPayLink(data.url);
    },
    onError: (error: any) => {
      toast({ title: error?.message || "Failed to create payment link", variant: "destructive" });
    },
  });

  const resetPayLinkDialog = useCallback(() => {
    setPayLinkForm({ amount: "", description: "" });
    setGeneratedPayLink(null);
    setPayLinkCopied(false);
  }, []);

  const { data: clientsList, isLoading } = useQuery<Client[]>({ queryKey: ["/api/ops/clients"] });
  const { data: summary } = useQuery<RevenueSummary>({ queryKey: ["/api/ops/revenue/summary"] });
  const { data: selectedClient } = useQuery<Client>({
    queryKey: ["/api/ops/clients", selectedClientId],
    enabled: !!selectedClientId,
  });
  const { data: clientDeals } = useQuery<Deal[]>({
    queryKey: ["/api/ops/clients", selectedClientId, "deals"],
    enabled: !!selectedClientId,
  });
  const { data: clientSubs } = useQuery<Subscription[]>({
    queryKey: ["/api/ops/clients", selectedClientId, "subscriptions"],
    enabled: !!selectedClientId,
  });
  const { data: clientProjects } = useQuery<Project[]>({
    queryKey: ["/api/ops/clients", selectedClientId, "projects"],
    enabled: !!selectedClientId,
  });
  const { data: clientPayments } = useQuery<StripePayment[]>({
    queryKey: ["/api/ops/clients", selectedClientId, "payments"],
    enabled: !!selectedClientId,
  });

  const { data: crmLeads } = useQuery<ContactSubmission[]>({
    queryKey: ["/api/leads"],
    enabled: showCreateClient && createMode === "crm",
  });
  const { data: allProjects } = useQuery<Project[]>({
    queryKey: ["/api/ops/projects"],
    enabled: showCreateClient && createMode === "projects",
  });

  const createClientMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      const body: Record<string, string | undefined> = { name: data.name, status: data.status };
      if (data.email) body.email = data.email;
      if (data.phone) body.phone = data.phone;
      if (data.website) body.website = data.website;
      if (data.notes) body.notes = data.notes;
      const res = await apiRequest("POST", "/api/ops/clients", body);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ops/clients"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ops/revenue/summary"] });
      setShowCreateClient(false);
      setFormData({ name: "", email: "", phone: "", website: "", status: "active", notes: "" });
      toast({ title: "Client created" });
    },
    onError: () => { toast({ title: "Failed to create client", variant: "destructive" }); },
  });

  const createDealMutation = useMutation({
    mutationFn: async (data: typeof dealForm) => {
      const res = await apiRequest("POST", "/api/ops/deals", {
        clientId: selectedClientId,
        name: data.name,
        value: data.value || "0",
        stage: data.stage,
        probability: parseInt(data.probability) || 50,
        notes: data.notes || undefined,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ops/clients", selectedClientId, "deals"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ops/revenue/summary"] });
      setShowCreateDeal(false);
      setDealForm({ name: "", value: "", stage: "qualification", probability: "50", notes: "" });
      toast({ title: "Deal created" });
    },
    onError: () => { toast({ title: "Failed to create deal", variant: "destructive" }); },
  });

  const [subStep, setSubStep] = useState<"details" | "payment" | "success">("details");
  const [setupClientSecret, setSetupClientSecret] = useState<string | null>(null);

  const setupIntentMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/ops/clients/${selectedClientId}/subscriptions/setup-intent`);
      return res.json();
    },
    onSuccess: (data: { clientSecret: string }) => {
      setSetupClientSecret(data.clientSecret);
      setSubStep("payment");
    },
    onError: (error: any) => {
      const msg = error?.message || "Failed to initialize payment";
      toast({ title: msg.includes("Stripe is not configured") ? "Stripe is not configured. Add your STRIPE_SECRET_KEY." : msg, variant: "destructive" });
    },
  });

  const deleteClientMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/ops/clients/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ops/clients"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ops/revenue/summary"] });
      setSelectedClientId(null);
      toast({ title: "Client deleted" });
    },
    onError: () => { toast({ title: "Failed to delete client", variant: "destructive" }); },
  });

  const importFromCrmMutation = useMutation({
    mutationFn: async (lead: ContactSubmission) => {
      const res = await apiRequest("POST", `/api/ops/leads/${lead.id}/convert-to-client`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ops/clients"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ops/revenue/summary"] });
      queryClient.invalidateQueries({ queryKey: ["/api/leads"] });
      setShowCreateClient(false);
      setCreateMode("choose");
      toast({ title: "Lead converted to client with deal" });
    },
    onError: () => { toast({ title: "Failed to convert lead to client", variant: "destructive" }); },
  });

  const importFromProjectMutation = useMutation({
    mutationFn: async (project: Project) => {
      const res = await apiRequest("POST", `/api/ops/projects/${project.id}/convert-to-client`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ops/clients"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ops/revenue/summary"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ops/projects"] });
      setShowCreateClient(false);
      setCreateMode("choose");
      toast({ title: "Client created and linked to project" });
    },
    onError: () => { toast({ title: "Failed to create client from project", variant: "destructive" }); },
  });

  const updateSubMutation = useMutation({
    mutationFn: async (data: { id: string; updates: Record<string, any> }) => {
      const res = await apiRequest("PATCH", `/api/ops/subscriptions/${data.id}`, data.updates);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ops/clients", selectedClientId, "subscriptions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ops/revenue/summary"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ops/clients"] });
      setShowEditSub(false);
      setEditingSub(null);
      toast({ title: "Subscription updated" });
    },
    onError: () => { toast({ title: "Failed to update subscription", variant: "destructive" }); },
  });

  const deleteSubMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/ops/subscriptions/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ops/clients", selectedClientId, "subscriptions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ops/revenue/summary"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ops/clients"] });
      toast({ title: "Subscription deleted" });
    },
    onError: () => { toast({ title: "Failed to delete subscription", variant: "destructive" }); },
  });

  if (selectedClientId && selectedClient) {
    return (
      <div className="p-3 sm:p-6 space-y-4 sm:space-y-6">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => setSelectedClientId(null)} data-testid="btn-back-clients">
            <ChevronRight className="h-4 w-4 rotate-180" /> Back
          </Button>
          <div className="flex-1">
            <h1 className="text-2xl font-bold tracking-tight" data-testid="text-client-name">{selectedClient.name}</h1>
            <div className="flex items-center gap-3 mt-1 text-sm text-muted-foreground">
              {selectedClient.email && <span className="flex items-center gap-1"><Mail className="h-3.5 w-3.5" />{selectedClient.email}</span>}
              {selectedClient.phone && <span className="flex items-center gap-1"><Phone className="h-3.5 w-3.5" />{selectedClient.phone}</span>}
              {selectedClient.website && <span className="flex items-center gap-1"><Globe className="h-3.5 w-3.5" />{selectedClient.website}</span>}
            </div>
          </div>
          <Badge className={STATUS_COLORS[selectedClient.status]} data-testid="badge-client-status">{selectedClient.status}</Badge>
          <Button variant="destructive" size="sm" onClick={() => { if (confirm("Delete this client?")) deleteClientMutation.mutate(selectedClient.id); }} data-testid="btn-delete-client">
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>

        {(clientSubs ?? []).some(s => s.status === "past_due") && (
          <Card className="border-red-500/50 bg-red-500/10" data-testid="alert-past-due">
            <CardContent className="py-3 flex items-center gap-3">
              <AlertTriangle className="h-5 w-5 text-red-400" />
              <div>
                <div className="font-medium text-red-400">Payment Failed</div>
                <div className="text-sm text-muted-foreground">One or more subscriptions have overdue payments. Please check the Subscriptions tab.</div>
              </div>
            </CardContent>
          </Card>
        )}

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card className="bg-card/60 border-border/40">
            <CardContent className="pt-4">
              <div className="text-xs text-muted-foreground">Monthly Revenue</div>
              <div className="text-xl font-bold text-emerald-400" data-testid="text-client-mrr">{formatCurrency(selectedClient.mrr)}</div>
            </CardContent>
          </Card>
          <Card className="bg-card/60 border-border/40">
            <CardContent className="pt-4">
              <div className="text-xs text-muted-foreground">Annual Revenue</div>
              <div className="text-xl font-bold" data-testid="text-client-arr">{formatCurrency(parseFloat(selectedClient.mrr || "0") * 12)}</div>
            </CardContent>
          </Card>
          <Card className="bg-card/60 border-border/40">
            <CardContent className="pt-4">
              <div className="text-xs text-muted-foreground">Active Subscriptions</div>
              <div className="text-xl font-bold">{(clientSubs ?? []).filter(s => s.status === "active").length}</div>
            </CardContent>
          </Card>
          <Card className="bg-card/60 border-border/40">
            <CardContent className="pt-4">
              <div className="text-xs text-muted-foreground">Total Deal Value</div>
              <div className="text-xl font-bold">{formatCurrency((clientDeals ?? []).reduce((s, d) => s + parseFloat(d.value), 0))}</div>
            </CardContent>
          </Card>
        </div>

        <Tabs defaultValue="deals">
          <TabsList className="bg-muted/30">
            <TabsTrigger value="deals" data-testid="tab-deals">Deals ({(clientDeals ?? []).length})</TabsTrigger>
            <TabsTrigger value="subscriptions" data-testid="tab-subscriptions">Subscriptions ({(clientSubs ?? []).length})</TabsTrigger>
            <TabsTrigger value="projects" data-testid="tab-projects">Projects ({(clientProjects ?? []).length})</TabsTrigger>
            <TabsTrigger value="payments" data-testid="tab-payments">Payments ({(clientPayments ?? []).length})</TabsTrigger>
          </TabsList>

          <TabsContent value="deals" className="space-y-3 mt-4">
            <div className="flex justify-between items-center">
              <h3 className="font-semibold">Deals</h3>
              <Dialog open={showCreateDeal} onOpenChange={setShowCreateDeal}>
                <DialogTrigger asChild>
                  <Button size="sm" data-testid="btn-add-deal"><Plus className="h-4 w-4 mr-1" /> Add Deal</Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader><DialogTitle>Create Deal</DialogTitle></DialogHeader>
                  <div className="space-y-3">
                    <Input placeholder="Deal name" value={dealForm.name} onChange={e => setDealForm(p => ({ ...p, name: e.target.value }))} data-testid="input-deal-name" />
                    <Input placeholder="Value ($)" type="number" value={dealForm.value} onChange={e => setDealForm(p => ({ ...p, value: e.target.value }))} data-testid="input-deal-value" />
                    <Select value={dealForm.stage} onValueChange={v => setDealForm(p => ({ ...p, stage: v }))}>
                      <SelectTrigger data-testid="select-deal-stage"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="qualification">Qualification</SelectItem>
                        <SelectItem value="proposal">Proposal</SelectItem>
                        <SelectItem value="negotiation">Negotiation</SelectItem>
                        <SelectItem value="closed_won">Closed Won</SelectItem>
                        <SelectItem value="closed_lost">Closed Lost</SelectItem>
                      </SelectContent>
                    </Select>
                    <Input placeholder="Probability (%)" type="number" value={dealForm.probability} onChange={e => setDealForm(p => ({ ...p, probability: e.target.value }))} data-testid="input-deal-probability" />
                    <Textarea placeholder="Notes" value={dealForm.notes} onChange={e => setDealForm(p => ({ ...p, notes: e.target.value }))} />
                  </div>
                  <DialogFooter>
                    <Button onClick={() => createDealMutation.mutate(dealForm)} disabled={!dealForm.name || createDealMutation.isPending} data-testid="btn-submit-deal">
                      {createDealMutation.isPending ? "Creating..." : "Create Deal"}
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </div>
            {(clientDeals ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground py-4">No deals yet</p>
            ) : (
              (clientDeals ?? []).map(deal => (
                <Card key={deal.id} className="bg-card/40 border-border/30" data-testid={`card-deal-${deal.id}`}>
                  <CardContent className="py-3 flex items-center justify-between">
                    <div>
                      <div className="font-medium">{deal.name}</div>
                      <div className="text-sm text-muted-foreground">{formatDate(deal.createdAt)}</div>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-mono font-medium">{formatCurrency(deal.value)}</span>
                      <Badge className={DEAL_STAGE_COLORS[deal.stage]}>{deal.stage.replace("_", " ")}</Badge>
                      <span className="text-xs text-muted-foreground">{deal.probability}%</span>
                    </div>
                  </CardContent>
                </Card>
              ))
            )}
          </TabsContent>

          <TabsContent value="subscriptions" className="space-y-3 mt-4">
            <div className="flex justify-between items-center">
              <h3 className="font-semibold">Subscriptions</h3>
              <Dialog open={showCreateSub} onOpenChange={(open) => { setShowCreateSub(open); if (!open) resetSubDialog(); }}>
                <DialogTrigger asChild>
                  <Button size="sm" data-testid="btn-add-subscription"><Plus className="h-4 w-4 mr-1" /> Add Subscription</Button>
                </DialogTrigger>
                <DialogContent className="max-w-md">
                  <DialogHeader>
                    <DialogTitle>{subStep === "success" ? "Subscription Created" : "Add Subscription"}</DialogTitle>
                  </DialogHeader>
                  {subStep === "details" ? (
                    <>
                      <div className="space-y-3">
                        <Input placeholder="Subscription name *" value={subForm.name} onChange={e => setSubForm(p => ({ ...p, name: e.target.value }))} data-testid="input-sub-name" />
                        <Input placeholder="Amount ($) *" type="number" value={subForm.amount} onChange={e => setSubForm(p => ({ ...p, amount: e.target.value }))} data-testid="input-sub-amount" />
                        <Select value={subForm.interval} onValueChange={v => setSubForm(p => ({ ...p, interval: v }))}>
                          <SelectTrigger data-testid="select-sub-interval"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="monthly">Monthly</SelectItem>
                            <SelectItem value="quarterly">Quarterly</SelectItem>
                            <SelectItem value="annual">Annual</SelectItem>
                          </SelectContent>
                        </Select>
                        <div>
                          <label className="text-sm font-medium text-muted-foreground">Start Date</label>
                          <Input type="date" value={subForm.startDate} onChange={e => setSubForm(p => ({ ...p, startDate: e.target.value }))} data-testid="input-sub-start-date" />
                        </div>
                        <Textarea placeholder="Notes (optional)" value={subForm.notes} onChange={e => setSubForm(p => ({ ...p, notes: e.target.value }))} data-testid="input-sub-notes" />
                      </div>
                      <DialogFooter>
                        <Button
                          onClick={() => setupIntentMutation.mutate()}
                          disabled={!subForm.name || !subForm.amount || setupIntentMutation.isPending}
                          data-testid="btn-next-payment"
                        >
                          {setupIntentMutation.isPending ? <><Loader2 className="h-4 w-4 mr-1 animate-spin" /> Initializing...</> : <>Continue to Payment <ArrowRight className="h-4 w-4 ml-1" /></>}
                        </Button>
                      </DialogFooter>
                    </>
                  ) : subStep === "payment" && setupClientSecret && stripePromise ? (
                    <Elements stripe={stripePromise} options={{ clientSecret: setupClientSecret, appearance: { theme: "night", variables: { colorPrimary: "#d4a017", colorBackground: "#1a1a2e", colorText: "#e0e0e0", borderRadius: "8px", fontFamily: "Inter, system-ui, sans-serif" } } }}>
                      <InlinePaymentForm
                        subForm={subForm}
                        clientId={selectedClientId!}
                        clientSecret={setupClientSecret!}
                        onSuccess={() => {
                          setSubStep("success");
                          queryClient.invalidateQueries({ queryKey: ["/api/ops/clients", selectedClientId, "subscriptions"] });
                          queryClient.invalidateQueries({ queryKey: ["/api/ops/revenue/summary"] });
                          queryClient.invalidateQueries({ queryKey: ["/api/ops/clients"] });
                        }}
                        onBack={() => setSubStep("details")}
                      />
                    </Elements>
                  ) : subStep === "success" ? (
                    <div className="py-6 text-center space-y-3">
                      <CheckCircle className="h-12 w-12 text-emerald-400 mx-auto" />
                      <div className="font-medium text-lg">Subscription Active</div>
                      <p className="text-sm text-muted-foreground">
                        {subForm.name} — {formatCurrency(subForm.amount)}/{subForm.interval === "monthly" ? "mo" : subForm.interval === "quarterly" ? "qtr" : "yr"}
                      </p>
                      <Button onClick={() => { setShowCreateSub(false); resetSubDialog(); }} data-testid="btn-close-success">Done</Button>
                    </div>
                  ) : (
                    <div className="py-6 text-center text-muted-foreground">
                      <p>Stripe is not configured. Please add your publishable key.</p>
                    </div>
                  )}
                </DialogContent>
              </Dialog>
            </div>
            {(clientSubs ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground py-4">No subscriptions yet</p>
            ) : (
              (clientSubs ?? []).map(sub => (
                <Card key={sub.id} className={`bg-card/40 border-border/30 ${sub.status === "past_due" ? "border-red-500/50" : ""}`} data-testid={`card-sub-${sub.id}`}>
                  <CardContent className="py-3 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      {sub.status === "past_due" && <AlertTriangle className="h-4 w-4 text-red-400" data-testid={`icon-past-due-${sub.id}`} />}
                      <div>
                        <div className="font-medium">{sub.name}</div>
                        <div className="text-sm text-muted-foreground">
                          {sub.interval}
                          {sub.stripeSubscriptionId && <span className="ml-2 text-xs opacity-60">Stripe</span>}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-mono font-medium">{formatCurrency(sub.amount)}/{sub.interval === "monthly" ? "mo" : sub.interval === "quarterly" ? "qtr" : "yr"}</span>
                      <Badge className={SUB_STATUS_COLORS[sub.status]} data-testid={`badge-sub-status-${sub.id}`}>
                        {sub.status === "past_due" ? "Payment Failed" : sub.status}
                      </Badge>
                      <Button variant="ghost" size="icon" className="h-7 w-7" data-testid={`btn-edit-sub-${sub.id}`} onClick={() => {
                        setEditingSub(sub);
                        setEditSubForm({ name: sub.name, amount: String(sub.amount), interval: sub.interval, status: sub.status, notes: sub.notes || "" });
                        setShowEditSub(true);
                      }}>
                        <Edit className="h-3.5 w-3.5" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-red-400 hover:text-red-300" data-testid={`btn-delete-sub-${sub.id}`} onClick={() => {
                        if (confirm("Delete this subscription? This cannot be undone.")) deleteSubMutation.mutate(sub.id);
                      }}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))
            )}
            <Dialog open={showEditSub} onOpenChange={(open) => { setShowEditSub(open); if (!open) setEditingSub(null); }}>
              <DialogContent>
                <DialogHeader><DialogTitle>Edit Subscription</DialogTitle></DialogHeader>
                <div className="space-y-3">
                  <Input placeholder="Subscription name" value={editSubForm.name} onChange={e => setEditSubForm(p => ({ ...p, name: e.target.value }))} data-testid="input-edit-sub-name" />
                  <Input placeholder="Amount ($)" type="number" value={editSubForm.amount} onChange={e => setEditSubForm(p => ({ ...p, amount: e.target.value }))} data-testid="input-edit-sub-amount" />
                  <Select value={editSubForm.interval} onValueChange={v => setEditSubForm(p => ({ ...p, interval: v }))}>
                    <SelectTrigger data-testid="select-edit-sub-interval"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="monthly">Monthly</SelectItem>
                      <SelectItem value="quarterly">Quarterly</SelectItem>
                      <SelectItem value="annual">Annual</SelectItem>
                    </SelectContent>
                  </Select>
                  <Select value={editSubForm.status} onValueChange={v => setEditSubForm(p => ({ ...p, status: v }))}>
                    <SelectTrigger data-testid="select-edit-sub-status"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="active">Active</SelectItem>
                      <SelectItem value="trialing">Trialing</SelectItem>
                      <SelectItem value="past_due">Past Due</SelectItem>
                      <SelectItem value="paused">Paused</SelectItem>
                      <SelectItem value="canceled">Canceled</SelectItem>
                    </SelectContent>
                  </Select>
                  <Textarea placeholder="Notes" value={editSubForm.notes} onChange={e => setEditSubForm(p => ({ ...p, notes: e.target.value }))} data-testid="input-edit-sub-notes" />
                </div>
                <DialogFooter>
                  <Button onClick={() => { if (editingSub) updateSubMutation.mutate({ id: editingSub.id, updates: { name: editSubForm.name, amount: editSubForm.amount, interval: editSubForm.interval, status: editSubForm.status, notes: editSubForm.notes || undefined } }); }} disabled={!editSubForm.name || !editSubForm.amount || updateSubMutation.isPending} data-testid="btn-submit-edit-sub">
                    {updateSubMutation.isPending ? "Saving..." : "Save Changes"}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </TabsContent>

          <TabsContent value="projects" className="space-y-3 mt-4">
            <h3 className="font-semibold">Projects</h3>
            {(clientProjects ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground py-4">No projects linked</p>
            ) : (
              (clientProjects ?? []).map(proj => (
                <Card key={proj.id} className="bg-card/40 border-border/30 cursor-pointer hover:bg-card/60 transition-colors" onClick={() => navigate(`/admin/ops/projects/${proj.id}`)} data-testid={`card-project-${proj.id}`}>
                  <CardContent className="py-3 flex items-center justify-between">
                    <div>
                      <div className="font-medium">{proj.name}</div>
                      <div className="text-sm text-muted-foreground">{formatDate(proj.createdAt)}</div>
                    </div>
                    <div className="flex items-center gap-3">
                      {proj.contractValue && <span className="text-sm font-mono">{formatCurrency(proj.contractValue)}</span>}
                      <Badge className="bg-blue-500/15 text-blue-400">{proj.stage}</Badge>
                      <ArrowRight className="h-4 w-4 text-muted-foreground" />
                    </div>
                  </CardContent>
                </Card>
              ))
            )}
          </TabsContent>

          <TabsContent value="payments" className="space-y-3 mt-4">
            <div className="flex justify-between items-center">
              <h3 className="font-semibold">Payments</h3>
              <div className="flex gap-2">
              <Dialog open={showPayLink} onOpenChange={(open) => { setShowPayLink(open); if (!open) resetPayLinkDialog(); }}>
                <DialogTrigger asChild>
                  <Button size="sm" variant="outline" data-testid="btn-payment-link"><Link2 className="h-4 w-4 mr-1" /> Payment Link</Button>
                </DialogTrigger>
                <DialogContent className="max-w-md">
                  <DialogHeader>
                    <DialogTitle>{generatedPayLink ? "Payment Link Ready" : "Generate Payment Link"}</DialogTitle>
                  </DialogHeader>
                  {!generatedPayLink ? (
                    <>
                      <div className="space-y-3">
                        <Input placeholder="Amount ($) *" type="number" value={payLinkForm.amount} onChange={e => setPayLinkForm(p => ({ ...p, amount: e.target.value }))} data-testid="input-link-amount" />
                        <Input placeholder="Description (e.g. Invoice #1234, Website deposit)" value={payLinkForm.description} onChange={e => setPayLinkForm(p => ({ ...p, description: e.target.value }))} data-testid="input-link-description" />
                      </div>
                      <DialogFooter>
                        <Button
                          onClick={() => createPayLinkMutation.mutate()}
                          disabled={!payLinkForm.amount || parseFloat(payLinkForm.amount) <= 0 || createPayLinkMutation.isPending}
                          data-testid="btn-generate-link"
                        >
                          {createPayLinkMutation.isPending ? <><Loader2 className="h-4 w-4 mr-1 animate-spin" /> Generating...</> : <><Link2 className="h-4 w-4 mr-1" /> Generate Link</>}
                        </Button>
                      </DialogFooter>
                    </>
                  ) : (
                    <div className="space-y-4">
                      <p className="text-sm text-muted-foreground">Share this link with your client to collect payment:</p>
                      <div className="flex items-center gap-2">
                        <Input value={generatedPayLink} readOnly className="text-xs font-mono" data-testid="input-generated-link" />
                        <Button
                          size="icon"
                          variant="outline"
                          onClick={() => {
                            navigator.clipboard.writeText(generatedPayLink);
                            setPayLinkCopied(true);
                            toast({ title: "Link copied to clipboard" });
                            setTimeout(() => setPayLinkCopied(false), 2000);
                          }}
                          data-testid="btn-copy-link"
                        >
                          {payLinkCopied ? <CheckCircle className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
                        </Button>
                        <Button
                          size="icon"
                          variant="outline"
                          onClick={() => window.open(generatedPayLink, "_blank")}
                          data-testid="btn-open-link"
                        >
                          <ExternalLink className="h-4 w-4" />
                        </Button>
                      </div>
                      <DialogFooter>
                        <Button variant="outline" onClick={() => { setShowPayLink(false); resetPayLinkDialog(); }} data-testid="btn-done-link">Done</Button>
                      </DialogFooter>
                    </div>
                  )}
                </DialogContent>
              </Dialog>
              <Dialog open={showCollectPayment} onOpenChange={(open) => { setShowCollectPayment(open); if (!open) resetPayDialog(); }}>
                <DialogTrigger asChild>
                  <Button size="sm" data-testid="btn-collect-payment"><DollarSign className="h-4 w-4 mr-1" /> Collect Payment</Button>
                </DialogTrigger>
                <DialogContent className="max-w-md">
                  <DialogHeader>
                    <DialogTitle>{payStep === "success" ? "Payment Complete" : "Collect Payment"}</DialogTitle>
                  </DialogHeader>
                  {payStep === "details" ? (
                    <>
                      <div className="space-y-3">
                        <Input placeholder="Amount ($) *" type="number" value={payForm.amount} onChange={e => setPayForm(p => ({ ...p, amount: e.target.value }))} data-testid="input-pay-amount" />
                        <Input placeholder="Description (e.g. Website deposit, Invoice #1234)" value={payForm.description} onChange={e => setPayForm(p => ({ ...p, description: e.target.value }))} data-testid="input-pay-description" />
                      </div>
                      <DialogFooter>
                        <Button
                          onClick={() => createPayIntentMutation.mutate()}
                          disabled={!payForm.amount || parseFloat(payForm.amount) <= 0 || createPayIntentMutation.isPending}
                          data-testid="btn-next-card"
                        >
                          {createPayIntentMutation.isPending ? <><Loader2 className="h-4 w-4 mr-1 animate-spin" /> Initializing...</> : <>Continue to Payment <ArrowRight className="h-4 w-4 ml-1" /></>}
                        </Button>
                      </DialogFooter>
                    </>
                  ) : payStep === "card" && payClientSecret && payIntentId && stripePromise ? (
                    <Elements stripe={stripePromise} options={{ clientSecret: payClientSecret, appearance: { theme: "night", variables: { colorPrimary: "#d4a017", colorBackground: "#1a1a2e", colorText: "#e0e0e0", borderRadius: "8px", fontFamily: "Inter, system-ui, sans-serif" } } }}>
                      <InlineOneTimePayment
                        clientId={selectedClientId!}
                        clientSecret={payClientSecret}
                        paymentIntentId={payIntentId}
                        description={payForm.description || "One-time payment"}
                        amount={payForm.amount}
                        onSuccess={() => {
                          setPayStep("success");
                          queryClient.invalidateQueries({ queryKey: ["/api/ops/clients", selectedClientId, "payments"] });
                          queryClient.invalidateQueries({ queryKey: ["/api/ops/revenue/summary"] });
                        }}
                        onBack={() => setPayStep("details")}
                      />
                    </Elements>
                  ) : payStep === "success" ? (
                    <div className="py-6 text-center space-y-3">
                      <CheckCircle className="h-12 w-12 text-emerald-400 mx-auto" />
                      <div className="font-medium text-lg">Payment Received</div>
                      <p className="text-sm text-muted-foreground">
                        {formatCurrency(payForm.amount)} — {payForm.description || "One-time payment"}
                      </p>
                      <Button onClick={() => { setShowCollectPayment(false); resetPayDialog(); }} data-testid="btn-close-pay-success">Done</Button>
                    </div>
                  ) : (
                    <div className="py-6 text-center text-muted-foreground">
                      <p>Stripe is not configured. Please add your publishable key.</p>
                    </div>
                  )}
                </DialogContent>
              </Dialog>
              </div>
            </div>
            {(clientPayments ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground py-4">No payments recorded</p>
            ) : (
              (clientPayments ?? []).map(payment => (
                <Card key={payment.id} className="bg-card/40 border-border/30" data-testid={`card-payment-${payment.id}`}>
                  <CardContent className="py-3 flex items-center justify-between">
                    <div>
                      <div className="font-medium">{payment.description || "Payment"}</div>
                      <div className="text-sm text-muted-foreground">{formatDate(payment.paidAt || payment.createdAt)}</div>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-mono font-medium">{formatCurrency(payment.amount)}</span>
                      <Badge className={payment.status === "succeeded" ? "bg-emerald-500/15 text-emerald-400" : "bg-amber-500/15 text-amber-400"}>{payment.status}</Badge>
                    </div>
                  </CardContent>
                </Card>
              ))
            )}
          </TabsContent>
        </Tabs>

        {selectedClient.notes && (
          <Card className="bg-card/40 border-border/30">
            <CardContent className="pt-4">
              <div className="text-xs text-muted-foreground mb-1">Notes</div>
              <p className="text-sm">{selectedClient.notes}</p>
            </CardContent>
          </Card>
        )}
      </div>
    );
  }

  return (
    <div className="p-3 sm:p-6 space-y-4 sm:space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2" data-testid="text-page-title">Clients & Revenue <HelpTooltip {...HELP_CONTENT.clients} size="md" /></h1>
          <p className="text-muted-foreground text-sm mt-1">Manage clients, deals, subscriptions, and revenue tracking</p>
        </div>
        <Dialog open={showCreateClient} onOpenChange={(open) => { setShowCreateClient(open); if (!open) setCreateMode("choose"); }}>
          <DialogTrigger asChild>
            <Button data-testid="btn-add-client"><Plus className="h-4 w-4 mr-1" /> Add Client</Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader><DialogTitle>{createMode === "choose" ? "Add Client" : createMode === "manual" ? "Create Client" : createMode === "crm" ? "Import from CRM" : "Import from Projects"}</DialogTitle></DialogHeader>
            {createMode === "choose" ? (
              <div className="space-y-3 py-2">
                <Card className="bg-card/40 border-border/30 cursor-pointer hover:bg-card/60 transition-colors" onClick={() => setCreateMode("manual")} data-testid="btn-create-manual">
                  <CardContent className="py-4 flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center"><Plus className="h-5 w-5 text-primary" /></div>
                    <div className="flex-1">
                      <div className="font-medium">Create Manually</div>
                      <div className="text-sm text-muted-foreground">Enter client details from scratch</div>
                    </div>
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  </CardContent>
                </Card>
                <Card className="bg-card/40 border-border/30 cursor-pointer hover:bg-card/60 transition-colors" onClick={() => setCreateMode("crm")} data-testid="btn-import-crm">
                  <CardContent className="py-4 flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-amber-500/10 flex items-center justify-center"><UserCircle className="h-5 w-5 text-amber-400" /></div>
                    <div className="flex-1">
                      <div className="font-medium">Import from CRM</div>
                      <div className="text-sm text-muted-foreground">Convert an existing CRM lead into a client</div>
                    </div>
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  </CardContent>
                </Card>
                <Card className="bg-card/40 border-border/30 cursor-pointer hover:bg-card/60 transition-colors" onClick={() => setCreateMode("projects")} data-testid="btn-import-projects">
                  <CardContent className="py-4 flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-blue-500/10 flex items-center justify-center"><Briefcase className="h-5 w-5 text-blue-400" /></div>
                    <div className="flex-1">
                      <div className="font-medium">Import from Projects</div>
                      <div className="text-sm text-muted-foreground">Create a client from an existing project</div>
                    </div>
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  </CardContent>
                </Card>
              </div>
            ) : createMode === "manual" ? (
              <>
                <div className="space-y-3">
                  <Input placeholder="Client / Company name *" value={formData.name} onChange={e => setFormData(p => ({ ...p, name: e.target.value }))} data-testid="input-client-name" />
                  <Input placeholder="Email" value={formData.email} onChange={e => setFormData(p => ({ ...p, email: e.target.value }))} data-testid="input-client-email" />
                  <Input placeholder="Phone" value={formData.phone} onChange={e => setFormData(p => ({ ...p, phone: e.target.value }))} data-testid="input-client-phone" />
                  <Input placeholder="Website" value={formData.website} onChange={e => setFormData(p => ({ ...p, website: e.target.value }))} data-testid="input-client-website" />
                  <Select value={formData.status} onValueChange={v => setFormData(p => ({ ...p, status: v }))}>
                    <SelectTrigger data-testid="select-client-status"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="active">Active</SelectItem>
                      <SelectItem value="prospect">Prospect</SelectItem>
                      <SelectItem value="paused">Paused</SelectItem>
                      <SelectItem value="churned">Churned</SelectItem>
                    </SelectContent>
                  </Select>
                  <Textarea placeholder="Notes" value={formData.notes} onChange={e => setFormData(p => ({ ...p, notes: e.target.value }))} />
                </div>
                <DialogFooter className="flex gap-2">
                  <Button variant="ghost" onClick={() => setCreateMode("choose")} data-testid="btn-back-choose">Back</Button>
                  <Button onClick={() => createClientMutation.mutate(formData)} disabled={!formData.name || createClientMutation.isPending} data-testid="btn-submit-client">
                    {createClientMutation.isPending ? "Creating..." : "Create Client"}
                  </Button>
                </DialogFooter>
              </>
            ) : createMode === "crm" ? (
              <>
                <div className="space-y-2 max-h-80 overflow-y-auto">
                  {!crmLeads ? (
                    <div className="space-y-2">{[1,2,3].map(i => <Skeleton key={i} className="h-14 w-full rounded-lg" />)}</div>
                  ) : crmLeads.length === 0 ? (
                    <p className="text-sm text-muted-foreground py-4 text-center">No CRM leads found</p>
                  ) : (
                    crmLeads.map(lead => (
                      <Card key={lead.id} className={`bg-card/40 border-border/30 cursor-pointer hover:bg-card/60 transition-colors ${importFromCrmMutation.isPending ? "opacity-50 pointer-events-none" : ""}`} onClick={() => importFromCrmMutation.mutate(lead)} data-testid={`btn-import-lead-${lead.id}`}>
                        <CardContent className="py-3 flex items-center justify-between">
                          <div>
                            <div className="font-medium">{lead.company || lead.name}</div>
                            <div className="text-sm text-muted-foreground">{lead.email} · {lead.status}</div>
                          </div>
                          <div className="flex items-center gap-2">
                            {lead.projectedValue && <span className="text-xs font-mono text-emerald-400">{formatCurrency(lead.projectedValue)}</span>}
                            <ArrowRight className="h-4 w-4 text-muted-foreground" />
                          </div>
                        </CardContent>
                      </Card>
                    ))
                  )}
                </div>
                <DialogFooter>
                  <Button variant="ghost" onClick={() => setCreateMode("choose")} data-testid="btn-back-choose-crm">Back</Button>
                </DialogFooter>
              </>
            ) : (
              <>
                <div className="space-y-2 max-h-80 overflow-y-auto">
                  {!allProjects ? (
                    <div className="space-y-2">{[1,2,3].map(i => <Skeleton key={i} className="h-14 w-full rounded-lg" />)}</div>
                  ) : allProjects.length === 0 ? (
                    <p className="text-sm text-muted-foreground py-4 text-center">No projects found</p>
                  ) : (
                    allProjects.map(proj => (
                      <Card key={proj.id} className={`bg-card/40 border-border/30 cursor-pointer hover:bg-card/60 transition-colors ${importFromProjectMutation.isPending ? "opacity-50 pointer-events-none" : ""}`} onClick={() => importFromProjectMutation.mutate(proj)} data-testid={`btn-import-project-${proj.id}`}>
                        <CardContent className="py-3 flex items-center justify-between">
                          <div>
                            <div className="font-medium">{proj.name}</div>
                            <div className="text-sm text-muted-foreground">{proj.stage} · {formatDate(proj.createdAt)}</div>
                          </div>
                          <div className="flex items-center gap-2">
                            {proj.contractValue && <span className="text-xs font-mono text-emerald-400">{formatCurrency(proj.contractValue)}</span>}
                            <ArrowRight className="h-4 w-4 text-muted-foreground" />
                          </div>
                        </CardContent>
                      </Card>
                    ))
                  )}
                </div>
                <DialogFooter>
                  <Button variant="ghost" onClick={() => setCreateMode("choose")} data-testid="btn-back-choose-projects">Back</Button>
                </DialogFooter>
              </>
            )}
          </DialogContent>
        </Dialog>
      </div>

      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <Card className="bg-card/60 border-border/40">
            <CardContent className="pt-4">
              <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1"><DollarSign className="h-3.5 w-3.5" /> MRR</div>
              <div className="text-xl font-bold text-emerald-400" data-testid="text-total-mrr">{formatCurrency(summary.totalMrr)}</div>
            </CardContent>
          </Card>
          <Card className="bg-card/60 border-border/40">
            <CardContent className="pt-4">
              <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1"><TrendingUp className="h-3.5 w-3.5" /> ARR</div>
              <div className="text-xl font-bold" data-testid="text-total-arr">{formatCurrency(summary.totalArr)}</div>
            </CardContent>
          </Card>
          <Card className="bg-card/60 border-border/40">
            <CardContent className="pt-4">
              <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1"><Users className="h-3.5 w-3.5" /> Active Clients</div>
              <div className="text-xl font-bold" data-testid="text-active-clients">{summary.activeClients}</div>
            </CardContent>
          </Card>
          <Card className="bg-card/60 border-border/40">
            <CardContent className="pt-4">
              <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1"><Briefcase className="h-3.5 w-3.5" /> Pipeline</div>
              <div className="text-xl font-bold text-amber-400" data-testid="text-pipeline-value">{formatCurrency(summary.pipelineValue)}</div>
            </CardContent>
          </Card>
          <Card className="bg-card/60 border-border/40">
            <CardContent className="pt-4">
              <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1"><CreditCard className="h-3.5 w-3.5" /> Collected</div>
              <div className="text-xl font-bold" data-testid="text-total-collected">{formatCurrency(summary.totalCollected)}</div>
            </CardContent>
          </Card>
        </div>
      )}

      <Separator />

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map(i => <Skeleton key={i} className="h-20 w-full rounded-lg" />)}
        </div>
      ) : (clientsList ?? []).length === 0 ? (
        <div className="text-center py-12">
          <UserCircle className="h-12 w-12 mx-auto text-muted-foreground/50 mb-3" />
          <p className="text-muted-foreground">No clients yet. Create your first client or convert a CRM lead.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {(clientsList ?? []).map(client => (
            <Card
              key={client.id}
              className="bg-card/40 border-border/30 cursor-pointer hover:bg-card/60 transition-colors"
              onClick={() => setSelectedClientId(client.id)}
              data-testid={`card-client-${client.id}`}
            >
              <CardContent className="py-3 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center">
                    <UserCircle className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <div className="font-medium" data-testid={`text-client-name-${client.id}`}>{client.name}</div>
                    <div className="text-sm text-muted-foreground">
                      {client.email || "No email"}
                      {client.website && <span className="ml-2">· {client.website}</span>}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <div className="text-right">
                    <div className="text-sm font-mono font-medium text-emerald-400">{formatCurrency(client.mrr)}/mo</div>
                    <div className="text-xs text-muted-foreground">{formatDate(client.createdAt)}</div>
                  </div>
                  <Badge className={STATUS_COLORS[client.status]}>{client.status}</Badge>
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
