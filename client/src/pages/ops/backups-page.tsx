import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Database, Shield, Clock, HardDrive, Download,
  CheckCircle2, XCircle, Loader2, RefreshCw, AlertTriangle,
} from "lucide-react";

interface Backup {
  id: string;
  filename: string;
  storagePath: string;
  sizeBytes: number | null;
  status: string;
  triggerType: string;
  createdAt: string;
  completedAt: string | null;
  errorMessage: string | null;
}

interface BackupStats {
  lastBackup: { filename: string; createdAt: string; sizeBytes: number | null } | null;
  totalBackups: number;
  totalSizeBytes: number;
  recentFailures: number;
  maxBackups: number;
}

function formatBytes(bytes: number | null): string {
  if (!bytes) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const hours = Math.floor(diff / 3600000);
  if (hours < 1) return "Less than an hour ago";
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

export default function BackupsPage() {
  const { toast } = useToast();
  const [triggering, setTriggering] = useState(false);

  const { data: stats, isLoading: statsLoading } = useQuery<BackupStats>({
    queryKey: ["/api/ops/backups/stats"],
    refetchInterval: 30000,
  });

  const { data: history, isLoading: historyLoading } = useQuery<Backup[]>({
    queryKey: ["/api/ops/backups"],
    refetchInterval: 15000,
  });

  async function triggerBackup() {
    setTriggering(true);
    try {
      await apiRequest("POST", "/api/ops/backups/trigger");
      toast({ title: "Backup started", description: "A manual backup has been triggered. It will appear in the history shortly." });
      setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ["/api/ops/backups"] });
        queryClient.invalidateQueries({ queryKey: ["/api/ops/backups/stats"] });
      }, 5000);
    } catch (error: any) {
      toast({ title: "Backup failed", description: error.message, variant: "destructive" });
    } finally {
      setTriggering(false);
    }
  }

  const hasRecentBackup = stats?.lastBackup
    ? (Date.now() - new Date(stats.lastBackup.createdAt).getTime()) < 25 * 3600000
    : false;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2" data-testid="text-page-title">
            <Shield className="w-6 h-6 text-primary" />
            Data Backups & Security
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Automated daily database backups stored securely in Amazon S3
          </p>
        </div>
        <Button
          onClick={triggerBackup}
          disabled={triggering}
          data-testid="btn-trigger-backup"
        >
          {triggering ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Download className="w-4 h-4 mr-2" />}
          {triggering ? "Running..." : "Run Backup Now"}
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {statsLoading ? (
          Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-[100px]" />)
        ) : (
          <>
            <Card data-testid="card-backup-status">
              <CardContent className="pt-4 pb-3">
                <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
                  {hasRecentBackup ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" /> : <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />}
                  Backup Status
                </div>
                <div className="text-lg font-bold" data-testid="text-backup-status">
                  {hasRecentBackup ? (
                    <span className="text-emerald-600">Protected</span>
                  ) : (
                    <span className="text-amber-600">Needs Backup</span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  {stats?.lastBackup ? timeAgo(stats.lastBackup.createdAt) : "No backups yet"}
                </p>
              </CardContent>
            </Card>

            <Card data-testid="card-last-backup">
              <CardContent className="pt-4 pb-3">
                <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
                  <Clock className="h-3.5 w-3.5" />
                  Last Backup
                </div>
                <div className="text-lg font-bold" data-testid="text-last-backup">
                  {stats?.lastBackup
                    ? new Date(stats.lastBackup.createdAt).toLocaleDateString()
                    : "Never"
                  }
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  {stats?.lastBackup ? formatBytes(stats.lastBackup.sizeBytes) : "—"}
                </p>
              </CardContent>
            </Card>

            <Card data-testid="card-total-backups">
              <CardContent className="pt-4 pb-3">
                <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
                  <Database className="h-3.5 w-3.5" />
                  Total Backups
                </div>
                <div className="text-lg font-bold" data-testid="text-total-backups">
                  {stats?.totalBackups ?? 0}
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  Last {stats?.maxBackups ?? 30} backups kept
                </p>
              </CardContent>
            </Card>

            <Card data-testid="card-storage-used">
              <CardContent className="pt-4 pb-3">
                <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
                  <HardDrive className="h-3.5 w-3.5" />
                  Storage Used
                </div>
                <div className="text-lg font-bold" data-testid="text-storage-used">
                  {formatBytes(stats?.totalSizeBytes ?? 0)}
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  {stats?.recentFailures ? (
                    <span className="text-red-500">{stats.recentFailures} recent failure{stats.recentFailures > 1 ? "s" : ""}</span>
                  ) : (
                    "No recent failures"
                  )}
                </p>
              </CardContent>
            </Card>
          </>
        )}
      </div>

      <Card className="border-emerald-200/50 bg-emerald-50/30">
        <CardContent className="pt-4 pb-3">
          <div className="flex items-start gap-3">
            <Shield className="w-5 h-5 text-emerald-600 mt-0.5 shrink-0" />
            <div>
              <h3 className="font-semibold text-sm text-emerald-800">Data Security Overview</h3>
              <ul className="text-xs text-emerald-700 mt-1.5 space-y-1">
                <li>Automated daily backups run at 3:00 AM with full database dumps</li>
                <li>Backups are compressed and uploaded to Amazon S3 with AES-256 server-side encryption</li>
                <li>Rolling retention of last 30 backups — older backups are automatically pruned from S3</li>
                <li>Database uses SSL/TLS encrypted connections for all data in transit</li>
                <li>All financial data uses GAAP-compliant immutable audit trails</li>
              </ul>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <RefreshCw className="w-4 h-4 text-primary" />
            Backup History
          </CardTitle>
        </CardHeader>
        <CardContent>
          {historyLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-12" />)}
            </div>
          ) : !history?.length ? (
            <div className="text-center py-12 text-muted-foreground">
              <Database className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p className="font-medium">No backups yet</p>
              <p className="text-sm mt-1">Click "Run Backup Now" to create your first backup</p>
            </div>
          ) : (
            <div className="space-y-2">
              {history.map((backup) => (
                <div
                  key={backup.id}
                  className="flex items-center justify-between border border-border/40 rounded-lg px-4 py-3"
                  data-testid={`row-backup-${backup.id}`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    {backup.status === "completed" ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                    ) : backup.status === "failed" ? (
                      <XCircle className="w-4 h-4 text-red-500 shrink-0" />
                    ) : (
                      <Loader2 className="w-4 h-4 text-blue-500 animate-spin shrink-0" />
                    )}
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{backup.filename}</p>
                      <p className="text-xs text-muted-foreground">
                        {new Date(backup.createdAt).toLocaleString()}
                        {backup.errorMessage && (
                          <span className="text-red-500 ml-2">{backup.errorMessage}</span>
                        )}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <Badge variant={backup.triggerType === "manual" ? "default" : "secondary"} className="text-xs">
                      {backup.triggerType}
                    </Badge>
                    <Badge
                      variant="outline"
                      className={backup.status === "completed" ? "border-emerald-300 text-emerald-700" : backup.status === "failed" ? "border-red-300 text-red-700" : "border-blue-300 text-blue-700"}
                    >
                      {backup.status}
                    </Badge>
                    <span className="text-xs text-muted-foreground w-16 text-right">
                      {formatBytes(backup.sizeBytes)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
