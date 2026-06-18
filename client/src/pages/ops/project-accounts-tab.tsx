/**
 * Service-account vault for a single project. List of third-party
 * accounts (Railway, Resend, Supabase, AWS, GoDaddy, etc.) that BlackRidge
 * set up for this client. Secret fields are encrypted at rest and never
 * appear in the list view — Chris clicks "Reveal" to decrypt one.
 */
import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Plus, Eye, EyeOff, Trash2, Pencil, KeyRound, ExternalLink, Copy } from "lucide-react";

const SERVICE_PRESETS: { value: string; label: string; loginUrl?: string }[] = [
  { value: "railway", label: "Railway", loginUrl: "https://railway.app/" },
  { value: "resend", label: "Resend", loginUrl: "https://resend.com/" },
  { value: "supabase", label: "Supabase", loginUrl: "https://supabase.com/dashboard" },
  { value: "aws", label: "AWS", loginUrl: "https://signin.aws.amazon.com/" },
  { value: "godaddy", label: "GoDaddy", loginUrl: "https://godaddy.com/" },
  { value: "cloudflare", label: "Cloudflare", loginUrl: "https://dash.cloudflare.com/" },
  { value: "vercel", label: "Vercel", loginUrl: "https://vercel.com/" },
  { value: "stripe", label: "Stripe", loginUrl: "https://dashboard.stripe.com/" },
  { value: "anthropic", label: "Anthropic", loginUrl: "https://console.anthropic.com/" },
  { value: "openai", label: "OpenAI", loginUrl: "https://platform.openai.com/" },
  { value: "elevenlabs", label: "ElevenLabs", loginUrl: "https://elevenlabs.io/" },
  { value: "google_workspace", label: "Google Workspace", loginUrl: "https://admin.google.com/" },
  { value: "namecheap", label: "Namecheap", loginUrl: "https://namecheap.com/" },
  { value: "plaid", label: "Plaid", loginUrl: "https://dashboard.plaid.com/" },
  { value: "other", label: "Other" },
];

interface ServiceAccount {
  id: string;
  projectId: string;
  service: string;
  label: string | null;
  accountEmail: string | null;
  accountId: string | null;
  loginUrl: string | null;
  notes: string | null;
  hasSecrets: boolean;
  createdAt: string | null;
  updatedAt: string | null;
}

interface VaultStatus { configured: boolean }

interface EditState {
  id?: string;
  service: string;
  label: string;
  accountEmail: string;
  accountId: string;
  loginUrl: string;
  notes: string;
  secrets: Array<{ key: string; value: string }>;
  hasSecrets: boolean;
}

const EMPTY: EditState = {
  service: "railway",
  label: "",
  accountEmail: "",
  accountId: "",
  loginUrl: "",
  notes: "",
  secrets: [{ key: "", value: "" }],
  hasSecrets: false,
};

function serviceLabel(value: string): string {
  return SERVICE_PRESETS.find(p => p.value === value)?.label ?? value;
}

export default function ProjectAccountsTab({ projectId }: { projectId: string }) {
  const { toast } = useToast();
  const [editing, setEditing] = useState<EditState | null>(null);
  const [revealed, setRevealed] = useState<Record<string, Record<string, unknown>>>({});

  const { data: vaultStatus } = useQuery<VaultStatus>({
    queryKey: ["/api/ops/service-accounts/vault-status"],
  });

  const { data: accounts = [], isLoading } = useQuery<ServiceAccount[]>({
    queryKey: [`/api/ops/projects/${projectId}/service-accounts`],
  });

  const createMutation = useMutation({
    mutationFn: (payload: any) =>
      apiRequest("POST", `/api/ops/projects/${projectId}/service-accounts`, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/ops/projects/${projectId}/service-accounts`] });
      setEditing(null);
      toast({ title: "Account added" });
    },
    onError: (e: any) => toast({ title: "Failed to add", description: e?.message, variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: any }) =>
      apiRequest("PATCH", `/api/ops/service-accounts/${id}`, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/ops/projects/${projectId}/service-accounts`] });
      setEditing(null);
      toast({ title: "Account updated" });
    },
    onError: (e: any) => toast({ title: "Failed to update", description: e?.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/ops/service-accounts/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/ops/projects/${projectId}/service-accounts`] });
      toast({ title: "Account removed" });
    },
    onError: (e: any) => toast({ title: "Failed to delete", description: e?.message, variant: "destructive" }),
  });

  async function handleReveal(accountId: string) {
    if (revealed[accountId]) {
      const copy = { ...revealed };
      delete copy[accountId];
      setRevealed(copy);
      return;
    }
    try {
      const res: any = await apiRequest("POST", `/api/ops/service-accounts/${accountId}/reveal`, {});
      setRevealed(r => ({ ...r, [accountId]: res?.secrets ?? {} }));
    } catch (e: any) {
      toast({ title: "Failed to reveal", description: e?.message, variant: "destructive" });
    }
  }

  function copyToClipboard(value: string) {
    try {
      navigator.clipboard.writeText(value);
      toast({ title: "Copied" });
    } catch {
      // ignore
    }
  }

  function openCreate() {
    setEditing({ ...EMPTY });
  }

  function openEdit(a: ServiceAccount) {
    setEditing({
      id: a.id,
      service: a.service,
      label: a.label ?? "",
      accountEmail: a.accountEmail ?? "",
      accountId: a.accountId ?? "",
      loginUrl: a.loginUrl ?? "",
      notes: a.notes ?? "",
      secrets: [{ key: "", value: "" }],
      hasSecrets: a.hasSecrets,
    });
  }

  function handleSubmit() {
    if (!editing) return;
    const secretsObj: Record<string, string> = {};
    for (const s of editing.secrets) {
      if (s.key.trim() && s.value.trim()) secretsObj[s.key.trim()] = s.value;
    }
    const payload: any = {
      service: editing.service,
      label: editing.label || null,
      accountEmail: editing.accountEmail || null,
      accountId: editing.accountId || null,
      loginUrl: editing.loginUrl || null,
      notes: editing.notes || null,
    };
    if (Object.keys(secretsObj).length > 0) payload.secrets = secretsObj;
    if (editing.id) {
      updateMutation.mutate({ id: editing.id, payload });
    } else {
      createMutation.mutate(payload);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">Service accounts</h3>
          <p className="text-sm text-muted-foreground">
            Third-party accounts we set up for this project. Secrets are encrypted at rest.
          </p>
        </div>
        <Button onClick={openCreate} data-testid="button-add-service-account">
          <Plus className="w-4 h-4 mr-2" /> Add account
        </Button>
      </div>

      {vaultStatus && !vaultStatus.configured && (
        <Card className="border-amber-500/40 bg-amber-500/5">
          <CardContent className="py-3 text-sm">
            <div className="flex items-start gap-2">
              <KeyRound className="w-4 h-4 mt-0.5 text-amber-500" />
              <div>
                <div className="font-medium text-amber-100">Secrets vault not yet configured</div>
                <div className="text-muted-foreground mt-1">
                  Set the <code className="px-1 py-0.5 bg-background/40 rounded">ACCOUNT_SECRETS_KEY</code> env var
                  to a 64-character hex string to enable storing API keys / passwords.
                  Without it you can still track non-secret fields (account email, login URL, notes).
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="mt-2"
                  onClick={async () => {
                    try {
                      const r: any = await apiRequest("POST", "/api/ops/service-accounts/generate-key", {});
                      if (r?.key) {
                        await navigator.clipboard.writeText(r.key);
                        toast({ title: "Key copied to clipboard", description: "Set ACCOUNT_SECRETS_KEY in Railway and redeploy." });
                      }
                    } catch (e: any) {
                      toast({ title: "Failed to generate key", description: e?.message, variant: "destructive" });
                    }
                  }}
                  data-testid="button-generate-vault-key"
                >
                  Generate a key (copy to clipboard)
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {isLoading ? (
        <div className="text-sm text-muted-foreground">Loading…</div>
      ) : accounts.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            No service accounts tracked yet. Click "Add account" to start.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {accounts.map(a => {
            const isRevealed = !!revealed[a.id];
            const revealedSecrets = revealed[a.id] ?? {};
            return (
              <Card key={a.id} data-testid={`row-service-account-${a.id}`}>
                <CardContent className="py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium">{serviceLabel(a.service)}</span>
                        {a.label && (
                          <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
                            {a.label}
                          </span>
                        )}
                        {a.hasSecrets && (
                          <span className="text-xs px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-200 border border-blue-500/30">
                            secrets stored
                          </span>
                        )}
                      </div>
                      <div className="mt-1.5 text-sm space-y-0.5">
                        {a.accountEmail && (
                          <div className="flex items-center gap-2 text-muted-foreground">
                            <span className="text-xs uppercase tracking-wide">Email:</span>
                            <span className="font-mono">{a.accountEmail}</span>
                            <button
                              onClick={() => copyToClipboard(a.accountEmail!)}
                              className="text-muted-foreground hover:text-foreground"
                              title="Copy"
                            >
                              <Copy className="w-3 h-3" />
                            </button>
                          </div>
                        )}
                        {a.accountId && (
                          <div className="flex items-center gap-2 text-muted-foreground">
                            <span className="text-xs uppercase tracking-wide">Account ID:</span>
                            <span className="font-mono">{a.accountId}</span>
                            <button
                              onClick={() => copyToClipboard(a.accountId!)}
                              className="text-muted-foreground hover:text-foreground"
                              title="Copy"
                            >
                              <Copy className="w-3 h-3" />
                            </button>
                          </div>
                        )}
                        {a.loginUrl && (
                          <div className="flex items-center gap-2 text-muted-foreground">
                            <span className="text-xs uppercase tracking-wide">Login:</span>
                            <a
                              href={a.loginUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="text-blue-300 hover:underline inline-flex items-center gap-1"
                            >
                              {a.loginUrl}
                              <ExternalLink className="w-3 h-3" />
                            </a>
                          </div>
                        )}
                        {a.notes && (
                          <div className="text-muted-foreground whitespace-pre-wrap mt-1 text-xs">
                            {a.notes}
                          </div>
                        )}
                      </div>

                      {isRevealed && a.hasSecrets && (
                        <div className="mt-3 border border-blue-500/30 bg-blue-500/5 rounded-md p-3 space-y-2">
                          <div className="text-xs uppercase tracking-wide text-blue-200">Secrets (visible — hide when done)</div>
                          {Object.keys(revealedSecrets).length === 0 ? (
                            <div className="text-xs text-muted-foreground">No secrets stored.</div>
                          ) : (
                            Object.entries(revealedSecrets).map(([k, v]) => (
                              <div key={k} className="flex items-center gap-2 text-sm">
                                <span className="text-xs uppercase tracking-wide text-muted-foreground w-32 shrink-0">
                                  {k}
                                </span>
                                <span className="font-mono break-all flex-1">{String(v)}</span>
                                <button
                                  onClick={() => copyToClipboard(String(v))}
                                  className="text-muted-foreground hover:text-foreground"
                                  title="Copy"
                                >
                                  <Copy className="w-3 h-3" />
                                </button>
                              </div>
                            ))
                          )}
                        </div>
                      )}
                    </div>

                    <div className="flex items-center gap-1 shrink-0">
                      {a.hasSecrets && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => handleReveal(a.id)}
                          data-testid={`button-reveal-${a.id}`}
                          title={isRevealed ? "Hide" : "Reveal"}
                        >
                          {isRevealed ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => openEdit(a)}
                        data-testid={`button-edit-${a.id}`}
                        title="Edit"
                      >
                        <Pencil className="w-4 h-4" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          if (confirm(`Delete ${serviceLabel(a.service)} account?`)) deleteMutation.mutate(a.id);
                        }}
                        data-testid={`button-delete-${a.id}`}
                        title="Delete"
                      >
                        <Trash2 className="w-4 h-4 text-red-400" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing?.id ? "Edit account" : "Add account"}</DialogTitle>
          </DialogHeader>
          {editing && (
            <div className="space-y-3">
              <div>
                <Label>Service</Label>
                <Select
                  value={editing.service}
                  onValueChange={(v) => {
                    const preset = SERVICE_PRESETS.find(p => p.value === v);
                    setEditing(e => e ? { ...e, service: v, loginUrl: e.loginUrl || preset?.loginUrl || "" } : e);
                  }}
                >
                  <SelectTrigger data-testid="select-service-account-service">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SERVICE_PRESETS.map(p => (
                      <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Label (optional)</Label>
                <Input
                  placeholder="Production, Staging, etc."
                  value={editing.label}
                  onChange={e => setEditing(s => s ? { ...s, label: e.target.value } : s)}
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <Label>Account email</Label>
                  <Input
                    placeholder="chris@blackridgeplatforms.com"
                    value={editing.accountEmail}
                    onChange={e => setEditing(s => s ? { ...s, accountEmail: e.target.value } : s)}
                  />
                </div>
                <div>
                  <Label>Account / customer ID</Label>
                  <Input
                    placeholder="102277081"
                    value={editing.accountId}
                    onChange={e => setEditing(s => s ? { ...s, accountId: e.target.value } : s)}
                  />
                </div>
              </div>
              <div>
                <Label>Login URL</Label>
                <Input
                  placeholder="https://..."
                  value={editing.loginUrl}
                  onChange={e => setEditing(s => s ? { ...s, loginUrl: e.target.value } : s)}
                />
              </div>
              <div>
                <Label>Notes</Label>
                <Textarea
                  rows={3}
                  placeholder="MFA recovery codes location, billing contact, etc."
                  value={editing.notes}
                  onChange={e => setEditing(s => s ? { ...s, notes: e.target.value } : s)}
                />
              </div>

              <div>
                <Label>Secrets {vaultStatus?.configured ? "(encrypted at rest)" : "(disabled — set ACCOUNT_SECRETS_KEY)"}</Label>
                <div className="space-y-2">
                  {editing.secrets.map((s, i) => (
                    <div key={i} className="flex gap-2">
                      <Input
                        placeholder="password / api_key / webhook_secret"
                        value={s.key}
                        disabled={!vaultStatus?.configured}
                        onChange={e => setEditing(prev => {
                          if (!prev) return prev;
                          const copy = [...prev.secrets];
                          copy[i] = { ...copy[i], key: e.target.value };
                          return { ...prev, secrets: copy };
                        })}
                      />
                      <Input
                        type="password"
                        placeholder="value"
                        value={s.value}
                        disabled={!vaultStatus?.configured}
                        onChange={e => setEditing(prev => {
                          if (!prev) return prev;
                          const copy = [...prev.secrets];
                          copy[i] = { ...copy[i], value: e.target.value };
                          return { ...prev, secrets: copy };
                        })}
                      />
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => setEditing(prev => prev ? { ...prev, secrets: prev.secrets.filter((_, idx) => idx !== i) } : prev)}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  ))}
                  {vaultStatus?.configured && (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => setEditing(prev => prev ? { ...prev, secrets: [...prev.secrets, { key: "", value: "" }] } : prev)}
                    >
                      <Plus className="w-3 h-3 mr-1" /> Add secret field
                    </Button>
                  )}
                </div>
                {editing.hasSecrets && (
                  <div className="text-xs text-amber-300 mt-2">
                    This account already has stored secrets. Saving here will replace them with whatever you enter above (leave blank to keep the existing ones).
                  </div>
                )}
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
            <Button onClick={handleSubmit} data-testid="button-save-service-account">
              {editing?.id ? "Save changes" : "Add account"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
