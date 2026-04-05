import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Shield, Search, ChevronDown, ChevronRight, Download, FileText,
  ArrowLeftRight, Pencil, Plus, Ban, Lock, Unlock, User,
} from "lucide-react";
import { HelpTooltip, HELP_CONTENT } from "@/components/help-tooltip";
import type { AuditLog } from "@shared/schema";
import jsPDF from "jspdf";

function formatDate(d: string | Date): string {
  return new Date(d).toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
}

const ACTION_ICONS: Record<string, any> = {
  create: Plus,
  update: Pencil,
  void: Ban,
  reverse: ArrowLeftRight,
  close: Lock,
  reopen: Unlock,
};

const ACTION_COLORS: Record<string, string> = {
  create: "bg-green-50 text-green-700",
  update: "bg-blue-50 text-blue-700",
  void: "bg-red-50 text-red-700",
  reverse: "bg-orange-50 text-orange-700",
  close: "bg-purple-50 text-purple-700",
  reopen: "bg-yellow-50 text-yellow-700",
};

export default function AuditTrailPage() {
  const [filterStartDate, setFilterStartDate] = useState("");
  const [filterEndDate, setFilterEndDate] = useState("");
  const [filterAction, setFilterAction] = useState("");
  const [filterRecordType, setFilterRecordType] = useState("");
  const [filterUser, setFilterUser] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const queryParams = useMemo(() => {
    const params = new URLSearchParams();
    if (filterStartDate) params.set("startDate", filterStartDate);
    if (filterEndDate) params.set("endDate", filterEndDate);
    if (filterAction) params.set("action", filterAction);
    if (filterRecordType) params.set("recordType", filterRecordType);
    if (filterUser) params.set("performedBy", filterUser);
    params.set("limit", "200");
    return params.toString();
  }, [filterStartDate, filterEndDate, filterAction, filterRecordType, filterUser]);

  const { data, isLoading } = useQuery<{ logs: AuditLog[]; total: number }>({
    queryKey: ["/api/ops/audit-logs", `?${queryParams}`],
  });

  const logs = data?.logs ?? [];
  const total = data?.total ?? 0;

  const filteredLogs = useMemo(() => {
    if (!searchTerm) return logs;
    const lower = searchTerm.toLowerCase();
    return logs.filter(
      (l) =>
        (l.description ?? "").toLowerCase().includes(lower) ||
        (l.recordType ?? "").toLowerCase().includes(lower) ||
        (l.recordId ?? "").toLowerCase().includes(lower)
    );
  }, [logs, searchTerm]);

  const exportPdf = () => {
    const doc = new jsPDF({ orientation: "landscape" });
    doc.setFontSize(16);
    doc.text("Audit Trail Report", 14, 18);
    doc.setFontSize(9);
    doc.text(`Generated: ${new Date().toLocaleString()}`, 14, 25);
    if (filterStartDate || filterEndDate) {
      doc.text(`Period: ${filterStartDate || "Start"} to ${filterEndDate || "Present"}`, 14, 30);
    }

    let y = 40;
    doc.setFontSize(8);
    const headers = ["Date/Time", "Action", "Record Type", "Description", "Amount", "User"];
    const colX = [14, 55, 80, 110, 210, 245];
    headers.forEach((h, i) => {
      doc.setFont("helvetica", "bold");
      doc.text(h, colX[i], y);
    });
    y += 6;
    doc.setFont("helvetica", "normal");

    for (const log of filteredLogs) {
      if (y > 190) {
        doc.addPage();
        y = 20;
      }
      doc.text(formatDate(log.performedAt), colX[0], y);
      doc.text(log.action, colX[1], y);
      doc.text(log.recordType, colX[2], y);
      doc.text((log.description ?? "").slice(0, 60), colX[3], y);
      doc.text(log.amount ? formatCurrency(Number(log.amount)) : "—", colX[4], y);
      doc.text(log.performedBy ?? "—", colX[5], y);
      y += 5;
    }

    doc.save("audit-trail.pdf");
  };

  return (
    <div className="space-y-6" data-testid="audit-trail-page">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2" data-testid="text-audit-title">
            <Shield className="w-6 h-6 text-primary" />
            Audit Trail
            <HelpTooltip {...HELP_CONTENT.auditTrail} size="md" />
          </h1>
          <p className="text-muted-foreground mt-1">
            Complete record of every financial action taken in the system
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={exportPdf} data-testid="button-export-audit-pdf">
          <Download className="w-4 h-4 mr-1.5" />
          Export PDF
        </Button>
      </div>

      <Card>
        <CardContent className="pt-4">
          <div className="flex flex-wrap gap-3">
            <div className="flex items-center gap-2">
              <Search className="w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search descriptions..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-48"
                data-testid="input-audit-search"
              />
            </div>
            <Input
              type="date"
              value={filterStartDate}
              onChange={(e) => setFilterStartDate(e.target.value)}
              className="w-40"
              data-testid="input-audit-start-date"
            />
            <Input
              type="date"
              value={filterEndDate}
              onChange={(e) => setFilterEndDate(e.target.value)}
              className="w-40"
              data-testid="input-audit-end-date"
            />
            <Select value={filterAction} onValueChange={(v) => setFilterAction(v === "all" ? "" : v)}>
              <SelectTrigger className="w-36" data-testid="select-audit-action">
                <SelectValue placeholder="All Actions" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Actions</SelectItem>
                <SelectItem value="create">Create</SelectItem>
                <SelectItem value="update">Update</SelectItem>
                <SelectItem value="void">Void</SelectItem>
                <SelectItem value="close">Close</SelectItem>
                <SelectItem value="reopen">Reopen</SelectItem>
              </SelectContent>
            </Select>
            <Select value={filterRecordType} onValueChange={(v) => setFilterRecordType(v === "all" ? "" : v)}>
              <SelectTrigger className="w-44" data-testid="select-audit-record-type">
                <SelectValue placeholder="All Record Types" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Record Types</SelectItem>
                <SelectItem value="journal_entry">Journal Entry</SelectItem>
                <SelectItem value="expense">Expense</SelectItem>
                <SelectItem value="adjusting_entry">Adjusting Entry</SelectItem>
                <SelectItem value="fiscal_period">Fiscal Period</SelectItem>
                <SelectItem value="year_end_close">Year-End Close</SelectItem>
                <SelectItem value="admin_user">Admin User</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center justify-between">
            <span>Activity Log ({filteredLogs.length} of {total} records)</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <Skeleton className="h-64 w-full" />
          ) : filteredLogs.length === 0 ? (
            <p className="text-center text-muted-foreground py-12" data-testid="text-no-audit-logs">
              No audit log entries found. Actions will appear here as you use the financial system.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8" />
                  <TableHead>Date/Time</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Record Type</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>User</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredLogs.map((log) => {
                  const isExpanded = expandedId === log.id;
                  const Icon = ACTION_ICONS[log.action] || FileText;
                  const colorClass = ACTION_COLORS[log.action] || "bg-gray-50 text-gray-700";
                  return (
                    <>
                      <TableRow
                        key={log.id}
                        className="cursor-pointer hover:bg-muted/30"
                        onClick={() => setExpandedId(isExpanded ? null : log.id)}
                        data-testid={`row-audit-${log.id}`}
                      >
                        <TableCell>
                          {isExpanded ? (
                            <ChevronDown className="w-4 h-4 text-muted-foreground" />
                          ) : (
                            <ChevronRight className="w-4 h-4 text-muted-foreground" />
                          )}
                        </TableCell>
                        <TableCell className="text-sm whitespace-nowrap tabular-nums">
                          {formatDate(log.performedAt)}
                        </TableCell>
                        <TableCell>
                          <Badge variant="secondary" className={`text-xs gap-1 ${colorClass}`}>
                            <Icon className="w-3 h-3" />
                            {log.action}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-sm">
                          {log.recordType.replace(/_/g, " ")}
                        </TableCell>
                        <TableCell className="text-sm max-w-[300px] truncate">
                          {log.description || "—"}
                        </TableCell>
                        <TableCell className="text-right text-sm tabular-nums">
                          {log.amount ? formatCurrency(Number(log.amount)) : "—"}
                        </TableCell>
                        <TableCell>
                          <span className="text-sm flex items-center gap-1">
                            <User className="w-3 h-3" />
                            {log.performedBy || "system"}
                          </span>
                        </TableCell>
                      </TableRow>
                      {isExpanded && (log.before || log.after) && (
                        <TableRow key={`${log.id}-detail`}>
                          <TableCell colSpan={7} className="bg-muted/20 p-4">
                            <div className="grid grid-cols-2 gap-4 text-xs font-mono">
                              {log.before && (
                                <div>
                                  <p className="font-sans text-sm font-medium mb-2 text-red-600">Before</p>
                                  <pre className="bg-red-50 p-3 rounded overflow-auto max-h-48 whitespace-pre-wrap">
                                    {(() => { try { return JSON.stringify(JSON.parse(log.before), null, 2); } catch { return log.before; } })()}
                                  </pre>
                                </div>
                              )}
                              {log.after && (
                                <div>
                                  <p className="font-sans text-sm font-medium mb-2 text-green-600">After</p>
                                  <pre className="bg-green-50 p-3 rounded overflow-auto max-h-48 whitespace-pre-wrap">
                                    {(() => { try { return JSON.stringify(JSON.parse(log.after), null, 2); } catch { return log.after; } })()}
                                  </pre>
                                </div>
                              )}
                            </div>
                            {log.recordId && (
                              <p className="text-xs text-muted-foreground mt-2">
                                Record ID: {log.recordId}
                              </p>
                            )}
                          </TableCell>
                        </TableRow>
                      )}
                    </>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
