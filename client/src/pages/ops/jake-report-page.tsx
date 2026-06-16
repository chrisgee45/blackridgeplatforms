import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Sparkles, MailCheck, MailQuestion, AlertTriangle, MessageCircle, RefreshCw } from "lucide-react";

interface JakeDailyReport {
  windowStart: string;
  windowEnd: string;
  totals: {
    inbound: number;
    replies: number;
    welcomes: number;
    checkins: number;
    notifies: number;
    openHandoffs: number;
  };
  projects: {
    projectId: string;
    projectName: string;
    clientName: string | null;
    inbound: number;
    replies: number;
    notifies: number;
    awaitingHandoff: boolean;
    handoffReason: string | null;
  }[];
  recentHandoffs: { projectId: string; projectName: string; reason: string | null }[];
}

export default function JakeReportPage() {
  const [hours, setHours] = useState<24 | 72 | 168>(24);
  const { data, isLoading, refetch, isFetching } = useQuery<JakeDailyReport>({
    queryKey: ["/api/ops/jake/report", hours],
    queryFn: async () => {
      const res = await fetch(`/api/ops/jake/report?hours=${hours}`);
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
    refetchInterval: 60000,
  });

  return (
    <div className="p-3 sm:p-6 space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2" data-testid="text-page-title">
            <Sparkles className="w-6 h-6 text-cyan-300" /> Jake Report
          </h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            Every Jake conversation, check-in, and open handoff in one place. Push digest fires at 8am CT daily.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-md border border-border/60 p-0.5">
            {([24, 72, 168] as const).map(h => (
              <Button
                key={h}
                size="sm"
                variant={hours === h ? "secondary" : "ghost"}
                className="h-7 px-2.5 text-xs"
                onClick={() => setHours(h)}
                data-testid={`button-window-${h}`}
              >
                {h === 24 ? "24h" : h === 72 ? "3 days" : "7 days"}
              </Button>
            ))}
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => refetch()}
            disabled={isFetching}
            data-testid="button-refresh"
          >
            <RefreshCw className={`w-3.5 h-3.5 mr-1 ${isFetching ? "animate-spin" : ""}`} /> Refresh
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
        <StatCard label="Inbound" value={data?.totals.inbound} icon={<MessageCircle className="w-4 h-4 text-blue-300" />} />
        <StatCard label="Replies" value={data?.totals.replies} icon={<MailCheck className="w-4 h-4 text-emerald-300" />} />
        <StatCard label="Welcomes" value={data?.totals.welcomes} icon={<Sparkles className="w-4 h-4 text-cyan-300" />} />
        <StatCard label="Check-ins" value={data?.totals.checkins} icon={<MailCheck className="w-4 h-4 text-purple-300" />} />
        <StatCard label="Notify items" value={data?.totals.notifies} icon={<MailQuestion className="w-4 h-4 text-amber-300" />} />
        <StatCard label="Open handoffs" value={data?.totals.openHandoffs} icon={<AlertTriangle className="w-4 h-4 text-red-300" />} highlight={!!data?.totals.openHandoffs} />
      </div>

      {data?.recentHandoffs && data.recentHandoffs.length > 0 && (
        <Card className="border-amber-500/40 bg-amber-500/5">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2 text-amber-300">
              <AlertTriangle className="w-4 h-4" /> Open handoffs ({data.recentHandoffs.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 pt-0">
            {data.recentHandoffs.map(h => (
              <Link key={h.projectId} href={`/admin/ops/projects/${h.projectId}`}>
                <div
                  className="flex items-start gap-3 p-2.5 rounded-md border border-amber-500/20 hover-elevate cursor-pointer"
                  data-testid={`open-handoff-${h.projectId}`}
                >
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-300 mt-0.5 shrink-0" />
                  <div className="min-w-0">
                    <div className="text-sm font-medium">{h.projectName}</div>
                    <p className="text-xs text-muted-foreground mt-0.5">{h.reason ?? "Needs your attention."}</p>
                  </div>
                </div>
              </Link>
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Activity by project</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
          ) : !data?.projects.length ? (
            <p className="text-center text-sm text-muted-foreground py-10">
              No Jake activity in this window. Activate Jake on a project to start the conversation.
            </p>
          ) : (
            <div className="space-y-1">
              {data.projects.map(p => (
                <Link key={p.projectId} href={`/admin/ops/projects/${p.projectId}`}>
                  <div
                    className="flex items-center gap-3 p-2.5 rounded-md border border-border/30 hover-elevate cursor-pointer"
                    data-testid={`report-project-${p.projectId}`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium truncate">{p.projectName}</span>
                        {p.clientName && <span className="text-xs text-muted-foreground">{p.clientName}</span>}
                        {p.awaitingHandoff && (
                          <Badge variant="outline" className="text-[10px] border-amber-500/40 text-amber-300">
                            Awaiting answer
                          </Badge>
                        )}
                      </div>
                      {p.handoffReason && (
                        <p className="text-xs text-amber-200/80 mt-0.5 truncate">{p.handoffReason}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0 text-[11px] text-muted-foreground">
                      {p.inbound > 0 && <span className="text-blue-300">{p.inbound} in</span>}
                      {p.replies > 0 && <span className="text-emerald-300">{p.replies} reply</span>}
                      {p.notifies > 0 && <span className="text-amber-300">{p.notifies} fyi</span>}
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function StatCard({
  label,
  value,
  icon,
  highlight,
}: {
  label: string;
  value: number | undefined;
  icon: React.ReactNode;
  highlight?: boolean;
}) {
  return (
    <Card className={highlight ? "border-red-500/40 bg-red-500/5" : undefined}>
      <CardContent className="pt-3 pb-3">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">{icon} {label}</div>
        <div className="text-xl font-bold" data-testid={`stat-${label.toLowerCase().replace(/\s+/g, "-")}`}>{value ?? 0}</div>
      </CardContent>
    </Card>
  );
}
