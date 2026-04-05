import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useUpload } from "@/hooks/use-upload";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  FileText, Plus, Search, Send, Edit, Trash2, MoreHorizontal, Upload,
  Loader2, Eye, Archive, CheckCircle2, Clock, BookOpen, Shield,
  Briefcase, Users, FileCheck, AlertTriangle, Paperclip,
} from "lucide-react";
import type { Policy } from "@shared/schema";

const CATEGORIES = [
  { value: "general", label: "General", icon: BookOpen },
  { value: "hr", label: "Human Resources", icon: Users },
  { value: "security", label: "Security", icon: Shield },
  { value: "operations", label: "Operations", icon: Briefcase },
  { value: "compliance", label: "Compliance", icon: FileCheck },
  { value: "safety", label: "Safety", icon: AlertTriangle },
  { value: "finance", label: "Finance", icon: FileText },
];

const STATUS_CONFIG = {
  draft: { label: "Draft", color: "bg-yellow-100 text-yellow-800", icon: Clock },
  published: { label: "Published", color: "bg-emerald-100 text-emerald-800", icon: CheckCircle2 },
  archived: { label: "Archived", color: "bg-gray-100 text-gray-600", icon: Archive },
};

function PolicyEditor({
  open,
  onClose,
  policy,
}: {
  open: boolean;
  onClose: () => void;
  policy?: Policy | null;
}) {
  const { toast } = useToast();
  const isEdit = !!policy;

  const [title, setTitle] = useState(policy?.title || "");
  const [category, setCategory] = useState(policy?.category || "general");
  const [content, setContent] = useState(policy?.content || "");
  const [status, setStatus] = useState<string>(policy?.status || "draft");
  const [effectiveDate, setEffectiveDate] = useState(
    policy?.effectiveDate ? new Date(policy.effectiveDate).toISOString().split("T")[0] : ""
  );
  const [fileStorageKey, setFileStorageKey] = useState(policy?.fileStorageKey || "");
  const [fileName, setFileName] = useState(policy?.fileName || "");
  const [fileSize, setFileSize] = useState<number | null>(policy?.fileSize || null);

  useEffect(() => {
    if (open) {
      setTitle(policy?.title || "");
      setCategory(policy?.category || "general");
      setContent(policy?.content || "");
      setStatus(policy?.status || "draft");
      setEffectiveDate(policy?.effectiveDate ? new Date(policy.effectiveDate).toISOString().split("T")[0] : "");
      setFileStorageKey(policy?.fileStorageKey || "");
      setFileName(policy?.fileName || "");
      setFileSize(policy?.fileSize || null);
    }
  }, [open, policy]);

  const { uploadFile, isUploading, progress } = useUpload({
    onSuccess: (response) => {
      setFileStorageKey(response.objectPath);
      setFileName(response.metadata.name);
      setFileSize(response.metadata.size);
      toast({ title: "File uploaded", description: response.metadata.name });
    },
    onError: () => {
      toast({ title: "Upload failed", variant: "destructive" });
    },
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      const data = {
        title,
        category,
        content: content || null,
        status,
        effectiveDate: effectiveDate || null,
        fileStorageKey: fileStorageKey || null,
        fileName: fileName || null,
        fileSize,
      };
      if (isEdit) {
        return apiRequest("PATCH", `/api/policies/${policy.id}`, data);
      }
      return apiRequest("POST", "/api/policies", data);
    },
    onSuccess: () => {
      toast({ title: isEdit ? "Policy updated" : "Policy created" });
      queryClient.invalidateQueries({ queryKey: ["/api/policies"] });
      onClose();
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to save policy", variant: "destructive" });
    },
  });

  const handleFileInput = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) await uploadFile(file);
  };

  return (
    <Dialog open={open} onOpenChange={() => onClose()}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto" data-testid="dialog-policy-editor">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Policy" : "Create New Policy"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium mb-1 block">Title</label>
              <Input
                value={title}
                onChange={e => setTitle(e.target.value)}
                placeholder="e.g. Remote Work Policy"
                data-testid="input-policy-title"
              />
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">Category</label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger data-testid="select-policy-category">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map(c => (
                    <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium mb-1 block">Status</label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger data-testid="select-policy-status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="draft">Draft</SelectItem>
                  <SelectItem value="published">Published</SelectItem>
                  <SelectItem value="archived">Archived</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">Effective Date</label>
              <Input
                type="date"
                value={effectiveDate}
                onChange={e => setEffectiveDate(e.target.value)}
                data-testid="input-effective-date"
              />
            </div>
          </div>

          <div>
            <label className="text-sm font-medium mb-1 block">Policy Content</label>
            <Textarea
              value={content}
              onChange={e => setContent(e.target.value)}
              placeholder="Write your policy content here..."
              rows={12}
              className="font-mono text-sm"
              data-testid="textarea-policy-content"
            />
          </div>

          <div>
            <label className="text-sm font-medium mb-2 block">Attachment</label>
            <div className="flex items-center gap-3">
              <label className="cursor-pointer">
                <input
                  type="file"
                  className="hidden"
                  onChange={handleFileInput}
                  accept=".pdf,.doc,.docx,.txt,.xlsx,.xls,.pptx,.ppt"
                  data-testid="input-file-upload"
                />
                <div className="flex items-center gap-2 px-4 py-2 border rounded-md hover:bg-muted transition-colors">
                  {isUploading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Upload className="h-4 w-4" />
                  )}
                  <span className="text-sm">{isUploading ? `Uploading ${progress}%` : "Upload File"}</span>
                </div>
              </label>
              {fileName && (
                <div className="flex items-center gap-2 px-3 py-1.5 bg-blue-50 text-blue-700 rounded-md text-sm">
                  <Paperclip className="h-3.5 w-3.5" />
                  <span>{fileName}</span>
                  <button
                    onClick={() => { setFileStorageKey(""); setFileName(""); setFileSize(null); }}
                    className="text-blue-400 hover:text-blue-600 ml-1"
                    data-testid="btn-remove-file"
                  >
                    ×
                  </button>
                </div>
              )}
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={onClose} data-testid="btn-cancel-policy">
              Cancel
            </Button>
            <Button
              onClick={() => saveMutation.mutate()}
              disabled={!title || saveMutation.isPending}
              data-testid="btn-save-policy"
            >
              {saveMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <CheckCircle2 className="h-4 w-4 mr-2" />}
              {isEdit ? "Update Policy" : "Create Policy"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function EmailDialog({
  open,
  onClose,
  policy,
}: {
  open: boolean;
  onClose: () => void;
  policy: Policy | null;
}) {
  const { toast } = useToast();
  const [recipientInput, setRecipientInput] = useState("");
  const [recipients, setRecipients] = useState<string[]>([]);
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");

  const emailMutation = useMutation({
    mutationFn: async () => {
      const allRecipients = [...recipients];
      if (recipientInput.trim()) {
        recipientInput.split(",").map(e => e.trim()).filter(Boolean).forEach(e => {
          if (!allRecipients.includes(e)) allRecipients.push(e);
        });
      }
      const res = await apiRequest("POST", `/api/policies/${policy?.id}/email`, {
        recipients: allRecipients,
        subject: subject || undefined,
        message: message || undefined,
      });
      return res.json();
    },
    onSuccess: (data: any) => {
      toast({ title: "Sent!", description: `Policy emailed to ${data.recipientCount} recipient(s)` });
      queryClient.invalidateQueries({ queryKey: ["/api/policies"] });
      onClose();
      setRecipientInput("");
      setRecipients([]);
      setSubject("");
      setMessage("");
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to send email", variant: "destructive" });
    },
  });

  const addRecipient = () => {
    const emails = recipientInput.split(",").map(e => e.trim()).filter(e => e && e.includes("@"));
    const newRecipients = [...new Set([...recipients, ...emails])];
    setRecipients(newRecipients);
    setRecipientInput("");
  };

  return (
    <Dialog open={open} onOpenChange={() => onClose()}>
      <DialogContent data-testid="dialog-email-policy">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Send className="h-5 w-5 text-blue-600" />
            Email Policy
          </DialogTitle>
        </DialogHeader>
        {policy && (
          <div className="space-y-4">
            <div className="p-3 bg-muted rounded-lg">
              <p className="font-medium text-sm">{policy.title}</p>
              <p className="text-xs text-muted-foreground mt-1">{policy.category} · v{policy.version}</p>
            </div>

            <div>
              <label className="text-sm font-medium mb-1 block">Recipients</label>
              <div className="flex gap-2">
                <Input
                  value={recipientInput}
                  onChange={e => setRecipientInput(e.target.value)}
                  placeholder="email@example.com (comma-separated)"
                  onKeyDown={e => e.key === "Enter" && (e.preventDefault(), addRecipient())}
                  data-testid="input-recipients"
                />
                <Button variant="outline" onClick={addRecipient} data-testid="btn-add-recipient">
                  Add
                </Button>
              </div>
              {recipients.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {recipients.map((email, i) => (
                    <Badge key={i} variant="secondary" className="text-xs gap-1">
                      {email}
                      <button onClick={() => setRecipients(recipients.filter((_, idx) => idx !== i))} className="ml-0.5 hover:text-red-500">×</button>
                    </Badge>
                  ))}
                </div>
              )}
            </div>

            <div>
              <label className="text-sm font-medium mb-1 block">Subject (optional)</label>
              <Input
                value={subject}
                onChange={e => setSubject(e.target.value)}
                placeholder={`Policy Document: ${policy.title}`}
                data-testid="input-email-subject"
              />
            </div>

            <div>
              <label className="text-sm font-medium mb-1 block">Message (optional)</label>
              <Textarea
                value={message}
                onChange={e => setMessage(e.target.value)}
                placeholder="Include a personal note with the policy..."
                rows={3}
                data-testid="textarea-email-message"
              />
            </div>

            <Button
              className="w-full"
              onClick={() => emailMutation.mutate()}
              disabled={recipients.length === 0 && !recipientInput.trim() || emailMutation.isPending}
              data-testid="btn-send-policy-email"
            >
              {emailMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Send className="h-4 w-4 mr-2" />}
              Send Policy
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function PolicyViewer({
  open,
  onClose,
  policy,
}: {
  open: boolean;
  onClose: () => void;
  policy: Policy | null;
}) {
  if (!policy) return null;
  const statusConfig = STATUS_CONFIG[policy.status];

  return (
    <Dialog open={open} onOpenChange={() => onClose()}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto" data-testid="dialog-policy-viewer">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3">
            <FileText className="h-5 w-5" />
            {policy.title}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="flex items-center gap-2 flex-wrap">
            <Badge className={`${statusConfig.color} border-0 text-xs`}>{statusConfig.label}</Badge>
            <Badge variant="outline" className="text-xs">{policy.category}</Badge>
            <Badge variant="outline" className="text-xs">v{policy.version}</Badge>
            {policy.effectiveDate && (
              <span className="text-xs text-muted-foreground">
                Effective: {new Date(policy.effectiveDate).toLocaleDateString()}
              </span>
            )}
          </div>
          {policy.content && (
            <div className="prose prose-sm max-w-none bg-muted/50 rounded-lg p-6 whitespace-pre-wrap font-mono text-sm leading-relaxed border" data-testid="policy-content-view">
              {policy.content}
            </div>
          )}
          {policy.fileName && (
            <div className="flex items-center gap-2 p-3 bg-blue-50 rounded-lg text-blue-700 text-sm">
              <Paperclip className="h-4 w-4" />
              <span>{policy.fileName}</span>
              {policy.fileSize && <span className="text-blue-400">({(policy.fileSize / 1024).toFixed(1)} KB)</span>}
            </div>
          )}
          <div className="text-xs text-muted-foreground space-y-1 pt-2 border-t">
            <p>Created: {new Date(policy.createdAt).toLocaleString()}</p>
            <p>Updated: {new Date(policy.updatedAt).toLocaleString()}</p>
            {policy.lastEmailedAt && <p>Last emailed: {new Date(policy.lastEmailedAt).toLocaleString()}</p>}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function PoliciesPage() {
  const { toast } = useToast();
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingPolicy, setEditingPolicy] = useState<Policy | null>(null);
  const [emailPolicy, setEmailPolicy] = useState<Policy | null>(null);
  const [viewingPolicy, setViewingPolicy] = useState<Policy | null>(null);

  const { data: policiesList = [], isLoading } = useQuery<Policy[]>({
    queryKey: ["/api/policies", searchTerm, statusFilter, categoryFilter],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (searchTerm) params.set("search", searchTerm);
      if (statusFilter !== "all") params.set("status", statusFilter);
      if (categoryFilter !== "all") params.set("category", categoryFilter);
      const res = await fetch(`/api/policies?${params}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/policies/${id}`);
    },
    onSuccess: () => {
      toast({ title: "Policy deleted" });
      queryClient.invalidateQueries({ queryKey: ["/api/policies"] });
    },
  });

  const stats = {
    total: policiesList.length,
    published: policiesList.filter(p => p.status === "published").length,
    draft: policiesList.filter(p => p.status === "draft").length,
  };

  return (
    <div className="space-y-6" data-testid="policies-page">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight" data-testid="page-title-policies">Policy & Procedures</h2>
          <p className="text-muted-foreground">Create, manage, and distribute policy documents</p>
        </div>
        <Button onClick={() => { setEditingPolicy(null); setEditorOpen(true); }} data-testid="btn-create-policy">
          <Plus className="h-4 w-4 mr-2" /> New Policy
        </Button>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-blue-50 flex items-center justify-center">
              <FileText className="h-5 w-5 text-blue-600" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Total Policies</p>
              <p className="text-2xl font-bold" data-testid="stat-total-policies">{stats.total}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-emerald-50 flex items-center justify-center">
              <CheckCircle2 className="h-5 w-5 text-emerald-600" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Published</p>
              <p className="text-2xl font-bold" data-testid="stat-published">{stats.published}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-yellow-50 flex items-center justify-center">
              <Clock className="h-5 w-5 text-yellow-600" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Drafts</p>
              <p className="text-2xl font-bold" data-testid="stat-drafts">{stats.draft}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search policies..."
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            className="pl-9"
            data-testid="input-search-policies"
          />
        </div>
        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
          <SelectTrigger className="w-[160px]" data-testid="select-category-filter">
            <SelectValue placeholder="Category" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Categories</SelectItem>
            {CATEGORIES.map(c => (
              <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[140px]" data-testid="select-status-filter">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            <SelectItem value="draft">Draft</SelectItem>
            <SelectItem value="published">Published</SelectItem>
            <SelectItem value="archived">Archived</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map(i => <Skeleton key={i} className="h-16 w-full" />)}
        </div>
      ) : policiesList.length === 0 ? (
        <Card>
          <CardContent className="p-12 text-center">
            <FileText className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <h3 className="text-lg font-semibold mb-1">No policies yet</h3>
            <p className="text-muted-foreground mb-4">Create your first policy document to get started</p>
            <Button onClick={() => { setEditingPolicy(null); setEditorOpen(true); }} data-testid="btn-create-first-policy">
              <Plus className="h-4 w-4 mr-2" /> Create Policy
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Policy</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Version</TableHead>
                <TableHead>Updated</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {policiesList.map(policy => {
                const statusConf = STATUS_CONFIG[policy.status];
                const catConf = CATEGORIES.find(c => c.value === policy.category);
                const CatIcon = catConf?.icon || BookOpen;
                return (
                  <TableRow key={policy.id} data-testid={`policy-row-${policy.id}`}>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <div className="h-9 w-9 rounded-lg bg-slate-100 flex items-center justify-center shrink-0">
                          <CatIcon className="h-4 w-4 text-slate-600" />
                        </div>
                        <div>
                          <p className="font-medium text-sm">{policy.title}</p>
                          <div className="flex items-center gap-2 mt-0.5">
                            {policy.fileName && (
                              <span className="text-xs text-blue-600 flex items-center gap-1">
                                <Paperclip className="h-3 w-3" /> {policy.fileName}
                              </span>
                            )}
                            {policy.lastEmailedAt && (
                              <span className="text-xs text-muted-foreground flex items-center gap-1">
                                <Send className="h-3 w-3" /> Sent {new Date(policy.lastEmailedAt).toLocaleDateString()}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-xs capitalize">{catConf?.label || policy.category}</Badge>
                    </TableCell>
                    <TableCell>
                      <Badge className={`${statusConf.color} border-0 text-xs`}>{statusConf.label}</Badge>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">v{policy.version}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{new Date(policy.updatedAt).toLocaleDateString()}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button size="sm" variant="ghost" className="h-8 px-2" onClick={() => setViewingPolicy(policy)} data-testid={`btn-view-${policy.id}`}>
                          <Eye className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-8 px-2 text-blue-600 hover:text-blue-700"
                          onClick={() => setEmailPolicy(policy)}
                          data-testid={`btn-email-${policy.id}`}
                        >
                          <Send className="h-3.5 w-3.5" />
                        </Button>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button size="sm" variant="ghost" className="h-8 px-2" data-testid={`btn-more-${policy.id}`}>
                              <MoreHorizontal className="h-3.5 w-3.5" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => { setEditingPolicy(policy); setEditorOpen(true); }} data-testid={`menu-edit-${policy.id}`}>
                              <Edit className="h-4 w-4 mr-2" /> Edit
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              className="text-red-600"
                              onClick={() => deleteMutation.mutate(policy.id)}
                              data-testid={`menu-delete-${policy.id}`}
                            >
                              <Trash2 className="h-4 w-4 mr-2" /> Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Card>
      )}

      <PolicyEditor
        open={editorOpen}
        onClose={() => { setEditorOpen(false); setEditingPolicy(null); }}
        policy={editingPolicy}
      />

      <EmailDialog
        open={!!emailPolicy}
        onClose={() => setEmailPolicy(null)}
        policy={emailPolicy}
      />

      <PolicyViewer
        open={!!viewingPolicy}
        onClose={() => setViewingPolicy(null)}
        policy={viewingPolicy}
      />
    </div>
  );
}
