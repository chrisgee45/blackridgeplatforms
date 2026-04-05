import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Loader2, Search, ExternalLink, CheckCircle, XCircle, SlidersHorizontal, X, Globe, Eye, UserPlus, Ban } from "lucide-react";
import { Link } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface WebsiteAudit {
  id: string;
  businessName: string;
  websiteUrl: string;
  industry: string | null;
  city: string | null;
  phone: string | null;
  screenshotUrl: string | null;
  ruleScore: number | null;
  aiScore: number | null;
  badSiteScore: string | null;
  redesignWorthy: boolean | null;
  topProblems: string[] | null;
  pitchAngle: string | null;
  openingLine: string | null;
  visualStyleAssessment: string | null;
  conversionAssessment: string | null;
  status: string;
  createdAt: string;
}

export default function AuditsListPage() {
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [redesignFilter, setRedesignFilter] = useState<string>("all");
  const [industryFilter, setIndustryFilter] = useState<string>("all");
  const [cityFilter, setCityFilter] = useState<string>("all");
  const [scoreMin, setScoreMin] = useState("");
  const [scoreMax, setScoreMax] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [selectedAudit, setSelectedAudit] = useState<WebsiteAudit | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const { data: audits, isLoading } = useQuery<WebsiteAudit[]>({
    queryKey: ["/api/outreach/audits"],
  });

  const bulkImportMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      const res = await apiRequest("POST", "/api/outreach/audits/bulk-import", { ids });
      return res.json();
    },
    onSuccess: (data) => {
      setSelectedIds(new Set());
      queryClient.invalidateQueries({ queryKey: ["/api/outreach/audits"] });
      queryClient.invalidateQueries({ queryKey: ["/api/outreach/leads"] });
      toast({
        title: "Bulk import complete",
        description: `${data.imported} imported, ${data.skipped} skipped.`,
      });
    },
    onError: (err: any) => {
      toast({ title: "Bulk import failed", description: err.message, variant: "destructive" });
    },
  });

  const bulkRejectMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      const res = await apiRequest("POST", "/api/outreach/audits/bulk-reject", { ids });
      return res.json();
    },
    onSuccess: (data) => {
      setSelectedIds(new Set());
      queryClient.invalidateQueries({ queryKey: ["/api/outreach/audits"] });
      toast({
        title: "Bulk reject complete",
        description: `${data.rejected} audits rejected.`,
      });
    },
    onError: (err: any) => {
      toast({ title: "Bulk reject failed", description: err.message, variant: "destructive" });
    },
  });

  const industries = useMemo(() => {
    if (!audits) return [];
    const set = new Set(audits.map(a => a.industry).filter(Boolean) as string[]);
    return Array.from(set).sort();
  }, [audits]);

  const cities = useMemo(() => {
    if (!audits) return [];
    const set = new Set(audits.map(a => a.city).filter(Boolean) as string[]);
    return Array.from(set).sort();
  }, [audits]);

  const filtered = useMemo(() => {
    if (!audits) return [];
    return audits.filter(a => {
      if (search) {
        const q = search.toLowerCase();
        if (!a.businessName.toLowerCase().includes(q) && !a.websiteUrl.toLowerCase().includes(q)) return false;
      }
      if (redesignFilter === "yes" && !a.redesignWorthy) return false;
      if (redesignFilter === "no" && a.redesignWorthy !== false) return false;
      if (industryFilter !== "all" && a.industry !== industryFilter) return false;
      if (cityFilter !== "all" && a.city !== cityFilter) return false;
      if (scoreMin) {
        const min = Number(scoreMin);
        if (a.badSiteScore == null || Number(a.badSiteScore) < min) return false;
      }
      if (scoreMax) {
        const max = Number(scoreMax);
        if (a.badSiteScore == null || Number(a.badSiteScore) > max) return false;
      }
      return true;
    });
  }, [audits, search, redesignFilter, industryFilter, cityFilter, scoreMin, scoreMax]);

  const hasActiveFilters = redesignFilter !== "all" || industryFilter !== "all" || cityFilter !== "all" || scoreMin || scoreMax;

  const pendingFiltered = useMemo(() => filtered.filter(a => a.status === "pending"), [filtered]);
  const importableSelected = useMemo(() => {
    return filtered.filter(a => selectedIds.has(a.id) && a.status === "pending" && a.redesignWorthy === true);
  }, [filtered, selectedIds]);
  const rejectableSelected = useMemo(() => {
    return filtered.filter(a => selectedIds.has(a.id) && a.status === "pending");
  }, [filtered, selectedIds]);

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === pendingFiltered.length && pendingFiltered.length > 0) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(pendingFiltered.map(a => a.id)));
    }
  };

  const isBulkBusy = bulkImportMutation.isPending || bulkRejectMutation.isPending;

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900" data-testid="text-page-title">Website Audits</h1>
          <p className="text-sm text-gray-500 mt-1">
            {filtered.length} audit{filtered.length !== 1 ? "s" : ""}
            {hasActiveFilters ? " (filtered)" : ""}
          </p>
        </div>
        <Link href="/admin/ops/outreach/audits/test">
          <Button variant="outline" size="sm" data-testid="link-run-audit">
            Run Single Audit
          </Button>
        </Link>
      </div>

      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <Input
            data-testid="input-search"
            placeholder="Search by business name or URL..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Button
          variant={showFilters ? "default" : "outline"}
          size="sm"
          data-testid="button-toggle-filters"
          onClick={() => setShowFilters(!showFilters)}
        >
          <SlidersHorizontal className="w-4 h-4 mr-1.5" />
          Filters
          {hasActiveFilters && (
            <Badge variant="secondary" className="ml-1.5 text-xs px-1.5 py-0">
              Active
            </Badge>
          )}
        </Button>
      </div>

      {showFilters && (
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="grid grid-cols-5 gap-3 items-end">
              <div className="space-y-1">
                <label className="text-xs font-medium text-gray-500">Redesign Worthy</label>
                <Select value={redesignFilter} onValueChange={setRedesignFilter}>
                  <SelectTrigger data-testid="select-redesign-filter">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All</SelectItem>
                    <SelectItem value="yes">Yes</SelectItem>
                    <SelectItem value="no">No</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-gray-500">Industry</label>
                <Select value={industryFilter} onValueChange={setIndustryFilter}>
                  <SelectTrigger data-testid="select-industry-filter">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All</SelectItem>
                    {industries.map(ind => (
                      <SelectItem key={ind} value={ind}>{ind}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-gray-500">City</label>
                <Select value={cityFilter} onValueChange={setCityFilter}>
                  <SelectTrigger data-testid="select-city-filter">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All</SelectItem>
                    {cities.map(c => (
                      <SelectItem key={c} value={c}>{c}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-gray-500">Score Min</label>
                <Input
                  data-testid="input-score-min"
                  type="number"
                  min={0}
                  max={100}
                  placeholder="0"
                  value={scoreMin}
                  onChange={(e) => setScoreMin(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-gray-500">Score Max</label>
                <Input
                  data-testid="input-score-max"
                  type="number"
                  min={0}
                  max={100}
                  placeholder="100"
                  value={scoreMax}
                  onChange={(e) => setScoreMax(e.target.value)}
                />
              </div>
            </div>
            {hasActiveFilters && (
              <Button
                variant="ghost"
                size="sm"
                className="mt-2 text-xs"
                data-testid="button-clear-filters"
                onClick={() => {
                  setRedesignFilter("all");
                  setIndustryFilter("all");
                  setCityFilter("all");
                  setScoreMin("");
                  setScoreMax("");
                }}
              >
                Clear all filters
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
        </div>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-gray-500">
            {audits && audits.length > 0 ? "No audits match your filters." : "No website audits yet. Run your first audit to get started."}
          </CardContent>
        </Card>
      ) : (
        <>
          {selectedIds.size > 0 && (
            <div className="flex items-center gap-3 px-4 py-3 bg-blue-50 border border-blue-200 rounded-lg" data-testid="bulk-action-bar">
              <span className="text-sm font-medium text-blue-800" data-testid="text-selected-count">
                {selectedIds.size} selected
              </span>
              <div className="h-4 w-px bg-blue-300" />
              <Button
                size="sm"
                data-testid="button-bulk-import"
                onClick={() => bulkImportMutation.mutate(importableSelected.map(a => a.id))}
                disabled={isBulkBusy || importableSelected.length === 0}
              >
                {bulkImportMutation.isPending ? (
                  <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
                ) : (
                  <UserPlus className="w-4 h-4 mr-1.5" />
                )}
                Import {importableSelected.length} Lead{importableSelected.length !== 1 ? "s" : ""}
              </Button>
              <Button
                size="sm"
                variant="outline"
                data-testid="button-bulk-reject"
                onClick={() => bulkRejectMutation.mutate(rejectableSelected.map(a => a.id))}
                disabled={isBulkBusy || rejectableSelected.length === 0}
                className="text-red-600 border-red-200 hover:bg-red-50"
              >
                {bulkRejectMutation.isPending ? (
                  <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
                ) : (
                  <Ban className="w-4 h-4 mr-1.5" />
                )}
                Reject {rejectableSelected.length}
              </Button>
              {importableSelected.length < rejectableSelected.length && (
                <span className="text-xs text-blue-600 ml-1">
                  (Import filters to redesign-worthy only)
                </span>
              )}
              <Button
                size="sm"
                variant="ghost"
                className="ml-auto text-xs text-gray-500"
                data-testid="button-clear-selection"
                onClick={() => setSelectedIds(new Set())}
              >
                Clear selection
              </Button>
            </div>
          )}
          <Card>
            <div className="overflow-x-auto">
              <table className="w-full text-sm" data-testid="table-audits">
                <thead>
                  <tr className="border-b bg-gray-50 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    <th className="px-4 py-3 w-8">
                      <input
                        type="checkbox"
                        checked={pendingFiltered.length > 0 && selectedIds.size === pendingFiltered.length}
                        onChange={toggleSelectAll}
                        className="rounded border-gray-300"
                        data-testid="checkbox-select-all"
                        title="Select all pending audits"
                      />
                    </th>
                    <th className="px-4 py-3">Business</th>
                    <th className="px-4 py-3">Website</th>
                    <th className="px-4 py-3">Industry</th>
                    <th className="px-4 py-3">City</th>
                    <th className="px-4 py-3 text-center">Rule</th>
                    <th className="px-4 py-3 text-center">AI</th>
                    <th className="px-4 py-3 text-center">Score</th>
                    <th className="px-4 py-3 text-center">Redesign</th>
                    <th className="px-4 py-3 text-center">Status</th>
                    <th className="px-4 py-3">Date</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {filtered.map((audit) => (
                    <AuditRow
                      key={audit.id}
                      audit={audit}
                      onPreview={() => setSelectedAudit(audit)}
                      isSelected={selectedIds.has(audit.id)}
                      onToggleSelect={() => toggleSelect(audit.id)}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}

      {selectedAudit && (
        <AuditDetailDrawer audit={selectedAudit} onClose={() => setSelectedAudit(null)} />
      )}
    </div>
  );
}

function ScoreBadge({ value }: { value: number | string | null }) {
  if (value == null) return <span className="text-gray-300">--</span>;
  const num = Number(value);
  let color = "bg-green-100 text-green-800";
  if (num >= 60) color = "bg-red-100 text-red-800";
  else if (num >= 40) color = "bg-amber-100 text-amber-800";
  return (
    <span className={`inline-flex items-center justify-center px-2 py-0.5 rounded text-xs font-medium ${color}`}>
      {num}
    </span>
  );
}

function AuditRow({ audit, onPreview, isSelected, onToggleSelect }: { audit: WebsiteAudit; onPreview: () => void; isSelected: boolean; onToggleSelect: () => void }) {
  const isPending = audit.status === "pending";
  return (
    <tr className={`hover:bg-gray-50 transition-colors ${isSelected ? "bg-blue-50/50" : ""}`} data-testid={`row-audit-${audit.id}`}>
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          {isPending ? (
            <input
              type="checkbox"
              checked={isSelected}
              onChange={onToggleSelect}
              className="rounded border-gray-300"
              data-testid={`checkbox-audit-${audit.id}`}
            />
          ) : (
            <span className="w-4" />
          )}
          <button
            onClick={onPreview}
            className="text-gray-400 hover:text-blue-600 transition-colors"
            title="Preview audit"
            data-testid={`button-preview-${audit.id}`}
          >
            <Eye className="w-4 h-4" />
          </button>
        </div>
      </td>
      <td className="px-4 py-3 font-medium text-gray-900 max-w-[200px] truncate" data-testid={`text-business-${audit.id}`}>
        {audit.businessName}
      </td>
      <td className="px-4 py-3 max-w-[200px]">
        <a
          href={audit.websiteUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue-600 hover:underline flex items-center gap-1 truncate"
          data-testid={`link-website-${audit.id}`}
        >
          {audit.websiteUrl.replace(/^https?:\/\//, "")}
          <ExternalLink className="w-3 h-3 flex-shrink-0" />
        </a>
      </td>
      <td className="px-4 py-3 text-gray-600" data-testid={`text-industry-${audit.id}`}>
        {audit.industry || "--"}
      </td>
      <td className="px-4 py-3 text-gray-600" data-testid={`text-city-${audit.id}`}>
        {audit.city || "--"}
      </td>
      <td className="px-4 py-3 text-center"><ScoreBadge value={audit.ruleScore} /></td>
      <td className="px-4 py-3 text-center"><ScoreBadge value={audit.aiScore} /></td>
      <td className="px-4 py-3 text-center"><ScoreBadge value={audit.badSiteScore} /></td>
      <td className="px-4 py-3 text-center" data-testid={`badge-redesign-${audit.id}`}>
        {audit.redesignWorthy === true ? (
          <CheckCircle className="w-4 h-4 text-green-600 mx-auto" />
        ) : audit.redesignWorthy === false ? (
          <XCircle className="w-4 h-4 text-gray-300 mx-auto" />
        ) : (
          <span className="text-gray-300">--</span>
        )}
      </td>
      <td className="px-4 py-3 text-center" data-testid={`text-status-${audit.id}`}>
        <StatusBadge status={audit.status} />
      </td>
      <td className="px-4 py-3 text-gray-500 text-xs whitespace-nowrap" data-testid={`text-date-${audit.id}`}>
        {new Date(audit.createdAt).toLocaleDateString()}
      </td>
    </tr>
  );
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    pending: "bg-gray-100 text-gray-700",
    imported: "bg-blue-100 text-blue-700",
    rejected: "bg-red-100 text-red-700",
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${styles[status] || styles.pending}`}>
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  );
}

function AuditDetailDrawer({ audit: initialAudit, onClose }: { audit: WebsiteAudit; onClose: () => void }) {
  const [audit, setAudit] = useState(initialAudit);
  const { toast } = useToast();
  const score = audit.badSiteScore != null ? Number(audit.badSiteScore) : null;
  const isPending = audit.status === "pending";

  const importMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/outreach/audits/${audit.id}/import`);
      return res.json();
    },
    onSuccess: () => {
      setAudit({ ...audit, status: "imported" });
      queryClient.invalidateQueries({ queryKey: ["/api/outreach/audits"] });
      queryClient.invalidateQueries({ queryKey: ["/api/outreach/leads"] });
      toast({ title: "Lead imported", description: `${audit.businessName} added to outreach leads.` });
    },
    onError: (err: any) => {
      toast({ title: "Import failed", description: err.message || "Could not import lead", variant: "destructive" });
    },
  });

  const rejectMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/outreach/audits/${audit.id}/reject`);
      return res.json();
    },
    onSuccess: () => {
      setAudit({ ...audit, status: "rejected" });
      queryClient.invalidateQueries({ queryKey: ["/api/outreach/audits"] });
      toast({ title: "Audit rejected", description: `${audit.businessName} marked as rejected.` });
    },
    onError: (err: any) => {
      toast({ title: "Reject failed", description: err.message || "Could not reject audit", variant: "destructive" });
    },
  });

  return (
    <>
      <div
        className="fixed inset-0 bg-black/30 z-40"
        onClick={onClose}
        data-testid="drawer-backdrop"
      />
      <div
        className="fixed right-0 top-0 h-full w-full max-w-lg bg-white shadow-2xl z-50 overflow-y-auto animate-in slide-in-from-right duration-200"
        data-testid="drawer-audit-detail"
      >
        <div className="sticky top-0 bg-white border-b px-6 py-4 flex items-center justify-between z-10">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-bold text-gray-900 truncate" data-testid="drawer-business-name">
                {audit.businessName}
              </h2>
              <StatusBadge status={audit.status} />
            </div>
            <a
              href={audit.websiteUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-blue-600 hover:underline flex items-center gap-1"
              data-testid="drawer-website-url"
            >
              <Globe className="w-3 h-3" />
              {audit.websiteUrl.replace(/^https?:\/\//, "")}
              <ExternalLink className="w-3 h-3" />
            </a>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors text-gray-500"
            data-testid="button-close-drawer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {isPending && (
          <div className="px-6 py-3 bg-gray-50 border-b flex items-center gap-2">
            <Button
              size="sm"
              data-testid="button-import-lead"
              onClick={() => importMutation.mutate()}
              disabled={importMutation.isPending || rejectMutation.isPending}
            >
              {importMutation.isPending ? (
                <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
              ) : (
                <UserPlus className="w-4 h-4 mr-1.5" />
              )}
              Import Lead
            </Button>
            <Button
              size="sm"
              variant="outline"
              data-testid="button-reject-audit"
              onClick={() => rejectMutation.mutate()}
              disabled={importMutation.isPending || rejectMutation.isPending}
              className="text-red-600 border-red-200 hover:bg-red-50"
            >
              {rejectMutation.isPending ? (
                <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
              ) : (
                <Ban className="w-4 h-4 mr-1.5" />
              )}
              Reject
            </Button>
          </div>
        )}

        <div className="p-6 space-y-6">
          {audit.screenshotUrl && (
            <div>
              <img
                src={audit.screenshotUrl}
                alt={`Screenshot of ${audit.websiteUrl}`}
                className="rounded-lg border border-gray-200 w-full"
                data-testid="drawer-screenshot"
              />
            </div>
          )}

          <div className="grid grid-cols-4 gap-3">
            <ScoreCard label="Rule Score" value={audit.ruleScore} testId="drawer-rule-score" />
            <ScoreCard label="AI Score" value={audit.aiScore} testId="drawer-ai-score" />
            <ScoreCard label="Final Score" value={score} testId="drawer-bad-site-score" />
            <div className="text-center p-3 bg-gray-50 rounded-lg">
              <p className="text-[10px] text-gray-500 mb-1 uppercase tracking-wide">Redesign</p>
              <Badge
                data-testid="drawer-redesign-worthy"
                variant={audit.redesignWorthy ? "default" : "secondary"}
                className={audit.redesignWorthy ? "bg-green-600 hover:bg-green-700" : ""}
              >
                {audit.redesignWorthy ? "Yes" : "No"}
              </Badge>
            </div>
          </div>

          {audit.topProblems && audit.topProblems.length > 0 && (
            <DetailSection title="Top Problems" testId="drawer-top-problems">
              <ul className="space-y-2">
                {(audit.topProblems as string[]).map((p, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-gray-700">
                    <span className="flex-shrink-0 w-5 h-5 rounded-full bg-red-100 text-red-700 flex items-center justify-center text-xs font-medium mt-0.5">
                      {i + 1}
                    </span>
                    {p}
                  </li>
                ))}
              </ul>
            </DetailSection>
          )}

          {audit.openingLine && (
            <DetailSection title="Opening Line" testId="drawer-opening-line">
              <div className="bg-blue-50 border border-blue-100 rounded-lg p-3">
                <p className="text-sm text-blue-900 italic">"{audit.openingLine}"</p>
              </div>
            </DetailSection>
          )}

          {audit.pitchAngle && (
            <DetailSection title="Pitch Angle" testId="drawer-pitch-angle">
              <p className="text-sm text-gray-700">{audit.pitchAngle}</p>
            </DetailSection>
          )}

          {audit.visualStyleAssessment && (
            <DetailSection title="Visual Style Assessment" testId="drawer-visual-style">
              <p className="text-sm text-gray-700">{audit.visualStyleAssessment}</p>
            </DetailSection>
          )}

          {audit.conversionAssessment && (
            <DetailSection title="Conversion Assessment" testId="drawer-conversion">
              <p className="text-sm text-gray-700">{audit.conversionAssessment}</p>
            </DetailSection>
          )}

          <div className="flex items-center gap-3 text-xs text-gray-400 pt-4 border-t">
            <span>ID: {audit.id.slice(0, 8)}...</span>
            <span>Audited: {new Date(audit.createdAt).toLocaleString()}</span>
            {audit.industry && <span>Industry: {audit.industry}</span>}
            {audit.city && <span>City: {audit.city}</span>}
          </div>
        </div>
      </div>
    </>
  );
}

function ScoreCard({ label, value, testId }: { label: string; value: number | null; testId: string }) {
  let color = "text-gray-900";
  if (value != null) {
    if (value >= 60) color = "text-red-600";
    else if (value >= 40) color = "text-amber-600";
    else color = "text-green-600";
  }
  return (
    <div className="text-center p-3 bg-gray-50 rounded-lg">
      <p className="text-[10px] text-gray-500 mb-1 uppercase tracking-wide">{label}</p>
      <p className={`text-xl font-bold ${color}`} data-testid={testId}>
        {value != null ? value : "--"}
      </p>
    </div>
  );
}

function DetailSection({ title, testId, children }: { title: string; testId: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">{title}</h3>
      <div data-testid={testId}>{children}</div>
    </div>
  );
}
