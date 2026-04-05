import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { fetchLatestWeeklyOps, generateWeeklyOps } from "@/lib/ai";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, RefreshCw, Brain, ShieldAlert, Lightbulb, Star, Activity } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

function getHealthColor(score: number) {
  if (score >= 75) return "text-green-500";
  if (score >= 50) return "text-yellow-500";
  return "text-destructive";
}

function getHealthBg(score: number) {
  if (score >= 75) return "bg-green-500/10 border-green-500/30";
  if (score >= 50) return "bg-yellow-500/10 border-yellow-500/30";
  return "bg-destructive/10 border-destructive/30";
}

function getUrgencyVariant(urgency: string) {
  if (urgency === "high") return "destructive" as const;
  if (urgency === "medium") return "secondary" as const;
  return "outline" as const;
}

function getImpactVariant(impact: string) {
  if (impact === "high") return "destructive" as const;
  if (impact === "medium") return "secondary" as const;
  return "outline" as const;
}

export default function AIOpsPage() {
  const { toast } = useToast();

  const { data, isLoading, error } = useQuery({
    queryKey: ["ai-report", "weekly_ops"],
    queryFn: fetchLatestWeeklyOps,
  });

  const gen = useMutation({
    mutationFn: generateWeeklyOps,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ai-report", "weekly_ops"] });
      toast({ title: "Report generated", description: "AI analysis is ready." });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to generate report.", variant: "destructive" });
    },
  });

  const report = data?.report;
  const ai = report?.payload?.ai;
  const healthScore = ai?.summary?.health_score;

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2" data-testid="text-ai-ops-heading">
            <Brain className="h-6 w-6" />
            AI Ops Dashboard
          </h1>
          <p className="text-sm text-muted-foreground">Weekly operations intelligence for internal use.</p>
        </div>

        <Button
          onClick={() => gen.mutate()}
          disabled={gen.isPending}
          data-testid="button-generate-ai-report"
        >
          {gen.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin mr-2" />
          ) : (
            <RefreshCw className="h-4 w-4 mr-2" />
          )}
          {gen.isPending ? "Generating..." : "Generate Weekly AI Report"}
        </Button>
      </div>

      {isLoading && (
        <div className="flex justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      )}

      {error && (
        <Card>
          <CardContent className="py-8 text-center text-destructive">
            Failed to load report.
          </CardContent>
        </Card>
      )}

      {!report && !isLoading && !error && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 gap-3">
            <Activity className="h-12 w-12 text-muted-foreground" />
            <p className="text-muted-foreground">No report yet. Click "Generate Weekly AI Report" to get started.</p>
          </CardContent>
        </Card>
      )}

      {report && (
        <div className="space-y-4">
          {ai?.summary && (
            <Card className={`border ${healthScore !== undefined ? getHealthBg(healthScore) : ""}`}>
              <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <Activity className="h-4 w-4" />
                  Health Score
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-baseline gap-2 mb-3" data-testid="text-ai-health-score">
                  <span className={`text-4xl font-bold ${healthScore !== undefined ? getHealthColor(healthScore) : ""}`}>
                    {healthScore ?? "—"}
                  </span>
                  <span className="text-sm text-muted-foreground">/100</span>
                </div>
                <p className="text-sm leading-relaxed" data-testid="text-ai-overview">{ai.summary.overview}</p>
              </CardContent>
            </Card>
          )}

          {ai?.highlights && ai.highlights.length > 0 && (
            <Card>
              <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <Star className="h-4 w-4 text-yellow-500" />
                  Highlights
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2">
                  {ai.highlights.map((h: string, i: number) => (
                    <li key={i} className="flex items-start gap-2 text-sm">
                      <Star className="h-3.5 w-3.5 text-yellow-500 shrink-0 mt-0.5" />
                      <span>{h}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          {ai?.risk_items && ai.risk_items.length > 0 && (
            <Card>
              <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <ShieldAlert className="h-4 w-4 text-destructive" />
                  Risk Items ({ai.risk_items.length})
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {ai.risk_items.map((risk: any, i: number) => (
                    <div key={i} className="flex items-start gap-3 text-sm p-3 rounded-md bg-muted/50">
                      <div className="shrink-0 mt-0.5">
                        <Badge variant={getUrgencyVariant(risk.urgency)} className="text-xs capitalize">{risk.urgency}</Badge>
                      </div>
                      <div className="min-w-0 space-y-1">
                        <div className="font-medium">{risk.title}</div>
                        <p className="text-muted-foreground">{risk.reason}</p>
                        <div className="flex items-start gap-1.5 text-xs">
                          <Lightbulb className="h-3.5 w-3.5 shrink-0 mt-0.5 text-yellow-500" />
                          <span>{risk.recommended_action}</span>
                        </div>
                        <Badge variant="outline" className="text-xs capitalize">{risk.entity_type}</Badge>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {ai?.recommended_actions && ai.recommended_actions.length > 0 && (
            <Card>
              <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <Lightbulb className="h-4 w-4 text-yellow-500" />
                  Recommended Actions
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {ai.recommended_actions.map((a: any, i: number) => (
                    <div key={i} className="flex items-start gap-3 text-sm">
                      <Badge variant={getImpactVariant(a.impact)} className="text-xs capitalize shrink-0 mt-0.5">{a.impact}</Badge>
                      <div className="min-w-0">
                        <div className="font-medium">{a.title}</div>
                        <p className="text-muted-foreground">{a.detail}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          <p className="text-xs text-muted-foreground" data-testid="text-ai-generated-at">
            Generated at: {new Date(report.generatedAt).toLocaleString()}
          </p>
        </div>
      )}
    </div>
  );
}
