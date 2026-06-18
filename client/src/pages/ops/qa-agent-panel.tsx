/**
 * "Run QA Audit" panel embedded inside the project's QA tab.
 * Lets Chris type a staging URL, fires off an automated audit
 * (Lighthouse + link check + security headers + AI review),
 * polls until done, and renders the report.
 */
import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Play, Loader2, Trash2, CheckCircle2, XCircle, AlertCircle } from "lucide-react";

interface QaReport {
  id: string;
  projectId: string;
  url: string;
  status: "queued" | "running" | "completed" | "failed";
  desktopScores: { performance: number | null; accessibility: number | null; bestPractices: number | null; seo: number | null; notes?: string } | null;
  mobileScores: { performance: number | null; accessibility: number | null; bestPractices: number | null; seo: number | null; notes?: string } | null;
  brokenLinks: Array<{ url: string; status: number | string }> | null;
  securityHeaders: {
    https: boolean; hsts: boolean; csp: boolean;
    xFrameOptions: boolean; xContentTypeOptions: boolean; referrerPolicy: boolean;
  } | null;
  aiReview: string | null;
  errorMessage: string | null;
  createdAt: string | null;
  completedAt: string | null;
}

function ScoreCell({ label, value }: { label: string; value: number | null }) {
  const color = value == null ? "text-muted-foreground"
    : value >= 90 ? "text-emerald-400"
    : value >= 60 ? "text-amber-400"
    : "text-red-400";
  return (
    <div className="flex flex-col items-center">
      <div className={`text-xl font-bold ${color}`}>{value ?? "—"}</div>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
    </div>
  );
}

function HeaderCheck({ ok, label }: { ok: boolean; label: string }) {
  return (
    <div className="flex items-center gap-2 text-sm">
      {ok ? <CheckCircle2 className="w-4 h-4 text-emerald-400" /> : <XCircle className="w-4 h-4 text-red-400" />}
      <span className={ok ? "text-foreground" : "text-muted-foreground"}>{label}</span>
    </div>
  );
}

export default function QaAgentPanel({ projectId }: { projectId: string }) {
  const { toast } = useToast();
  const [url, setUrl] = useState("");

  const { data: reports = [], refetch } = useQuery<QaReport[]>({
    queryKey: [`/api/ops/projects/${projectId}/qa-audit/reports`],
    refetchInterval: (q) => {
      const data = q.state.data as QaReport[] | undefined;
      const inFlight = data?.some(r => r.status === "queued" || r.status === "running");
      return inFlight ? 4000 : false;
    },
  });

  const runMutation = useMutation({
    mutationFn: (auditUrl: string) =>
      apiRequest("POST", `/api/ops/projects/${projectId}/qa-audit/run`, { url: auditUrl }),
    onSuccess: async () => {
      setUrl("");
      await refetch();
      toast({ title: "Audit started", description: "Refreshing report list — Lighthouse takes ~30 seconds." });
      queryClient.invalidateQueries({ queryKey: [`/api/ops/projects/${projectId}/qa-audit/reports`] });
    },
    onError: (e: any) => toast({ title: "Failed to start audit", description: e?.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/ops/qa-audit/reports/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/ops/projects/${projectId}/qa-audit/reports`] });
    },
  });

  return (
    <Card className="border-border/40">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Play className="w-4 h-4" /> Automated QA Audit
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex gap-2">
          <Input
            placeholder="https://staging.example.com"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            data-testid="input-qa-url"
          />
          <Button
            onClick={() => runMutation.mutate(url)}
            disabled={!url || runMutation.isPending}
            data-testid="button-run-qa-audit"
          >
            {runMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Play className="w-4 h-4 mr-2" />}
            Run audit
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Runs Google PageSpeed (Lighthouse) on desktop + mobile, checks every internal link,
          inspects security headers, and asks Claude for a written punch list.
          Add your PageSpeed API key in OPS → Vault under "Google PageSpeed" (secret key: <code className="px-1 bg-muted rounded">api_key</code>) for scores; everything else runs without it.
        </p>

        {reports.length === 0 && (
          <div className="text-center py-6 text-sm text-muted-foreground">
            No audits run yet for this project.
          </div>
        )}

        {reports.map((r) => (
          <Card key={r.id} className="border-border/30">
            <CardContent className="py-4 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-medium truncate">{r.url}</div>
                  <div className="text-xs text-muted-foreground">
                    {r.createdAt ? new Date(r.createdAt).toLocaleString() : ""}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {r.status === "queued" && <Badge variant="outline">Queued</Badge>}
                  {r.status === "running" && (
                    <Badge variant="outline" className="bg-blue-500/10 text-blue-300 border-blue-500/30">
                      <Loader2 className="w-3 h-3 mr-1 animate-spin" /> Running
                    </Badge>
                  )}
                  {r.status === "completed" && (
                    <Badge variant="outline" className="bg-emerald-500/10 text-emerald-300 border-emerald-500/30">
                      Completed
                    </Badge>
                  )}
                  {r.status === "failed" && (
                    <Badge variant="outline" className="bg-red-500/10 text-red-300 border-red-500/30">
                      Failed
                    </Badge>
                  )}
                  <Button size="sm" variant="ghost" onClick={() => deleteMutation.mutate(r.id)}>
                    <Trash2 className="w-3.5 h-3.5 text-red-400" />
                  </Button>
                </div>
              </div>

              {r.status === "failed" && r.errorMessage && (
                <div className="flex items-start gap-2 text-sm text-red-300">
                  <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                  <div>{r.errorMessage}</div>
                </div>
              )}

              {r.status === "completed" && (
                <>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="border border-border/30 rounded-md p-3">
                      <div className="text-xs uppercase tracking-wide text-muted-foreground mb-2">Desktop</div>
                      <div className="grid grid-cols-4 gap-2">
                        <ScoreCell label="Perf" value={r.desktopScores?.performance ?? null} />
                        <ScoreCell label="A11y" value={r.desktopScores?.accessibility ?? null} />
                        <ScoreCell label="Best" value={r.desktopScores?.bestPractices ?? null} />
                        <ScoreCell label="SEO" value={r.desktopScores?.seo ?? null} />
                      </div>
                      {r.desktopScores?.notes && (
                        <div className="text-[10px] text-amber-300 mt-2">{r.desktopScores.notes}</div>
                      )}
                    </div>
                    <div className="border border-border/30 rounded-md p-3">
                      <div className="text-xs uppercase tracking-wide text-muted-foreground mb-2">Mobile</div>
                      <div className="grid grid-cols-4 gap-2">
                        <ScoreCell label="Perf" value={r.mobileScores?.performance ?? null} />
                        <ScoreCell label="A11y" value={r.mobileScores?.accessibility ?? null} />
                        <ScoreCell label="Best" value={r.mobileScores?.bestPractices ?? null} />
                        <ScoreCell label="SEO" value={r.mobileScores?.seo ?? null} />
                      </div>
                      {r.mobileScores?.notes && (
                        <div className="text-[10px] text-amber-300 mt-2">{r.mobileScores.notes}</div>
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="border border-border/30 rounded-md p-3 space-y-1.5">
                      <div className="text-xs uppercase tracking-wide text-muted-foreground mb-1">Security headers</div>
                      {r.securityHeaders ? (
                        <>
                          <HeaderCheck ok={r.securityHeaders.https} label="HTTPS" />
                          <HeaderCheck ok={r.securityHeaders.hsts} label="Strict-Transport-Security" />
                          <HeaderCheck ok={r.securityHeaders.csp} label="Content-Security-Policy" />
                          <HeaderCheck ok={r.securityHeaders.xFrameOptions} label="X-Frame-Options" />
                          <HeaderCheck ok={r.securityHeaders.xContentTypeOptions} label="X-Content-Type-Options" />
                          <HeaderCheck ok={r.securityHeaders.referrerPolicy} label="Referrer-Policy" />
                        </>
                      ) : (
                        <div className="text-xs text-muted-foreground">Couldn't read headers.</div>
                      )}
                    </div>
                    <div className="border border-border/30 rounded-md p-3">
                      <div className="text-xs uppercase tracking-wide text-muted-foreground mb-1">Broken internal links</div>
                      {!r.brokenLinks || r.brokenLinks.length === 0 ? (
                        <div className="text-sm text-emerald-400">None found</div>
                      ) : (
                        <ul className="text-xs space-y-1 max-h-40 overflow-y-auto">
                          {r.brokenLinks.map((l, i) => (
                            <li key={i} className="flex items-center gap-2 text-red-300">
                              <span className="font-mono">{String(l.status)}</span>
                              <span className="truncate">{l.url}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </div>

                  {r.aiReview && (
                    <div className="border border-blue-500/30 bg-blue-500/5 rounded-md p-3">
                      <div className="text-xs uppercase tracking-wide text-blue-200 mb-2">AI punch list</div>
                      <div className="text-sm whitespace-pre-wrap">{r.aiReview}</div>
                    </div>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        ))}
      </CardContent>
    </Card>
  );
}
