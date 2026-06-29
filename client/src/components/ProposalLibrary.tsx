import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useUpload } from "@/hooks/use-upload";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FileText, Upload, Trash2, Download, Send, Loader2 } from "lucide-react";

export interface ProposalAsset {
  id: string;
  name: string;
  description: string | null;
  storageKey: string;
  fileName: string;
  fileType: string | null;
  fileSize: number | null;
  createdAt: string;
  updatedAt: string;
}

const PROPOSAL_ASSETS_KEY = ["/api/proposal-assets"];

function errorText(error: any): string {
  const m = String(error?.message || "").match(/^\d+:\s*([\s\S]*)$/);
  if (m) {
    try {
      return JSON.parse(m[1])?.message || m[1];
    } catch {
      return m[1];
    }
  }
  return error?.message || "Something went wrong";
}

function formatSize(bytes: number | null): string {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function useProposalAssets() {
  return useQuery<ProposalAsset[]>({
    queryKey: PROPOSAL_ASSETS_KEY,
    queryFn: async () => {
      const res = await fetch("/api/proposal-assets", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch proposals");
      return res.json();
    },
  });
}

/** Upload dialog: pick a file, give it a name, save to the library. */
function UploadProposalDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { toast } = useToast();
  const { uploadFile, isUploading } = useUpload();
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  const reset = () => {
    setFile(null);
    setName("");
    setDescription("");
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error("Choose a file first");
      const uploaded = await uploadFile(file);
      if (!uploaded) throw new Error("Upload failed");
      await apiRequest("POST", "/api/proposal-assets", {
        name: name.trim() || file.name,
        description: description.trim() || undefined,
        storageKey: uploaded.objectPath,
        fileName: file.name,
        fileType: file.type || undefined,
        fileSize: file.size,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: PROPOSAL_ASSETS_KEY });
      toast({ title: "Proposal uploaded", description: "It's now in your library, ready to send." });
      reset();
      onOpenChange(false);
    },
    onError: (e) => toast({ title: "Upload failed", description: errorText(e), variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) reset(); onOpenChange(v); }}>
      <DialogContent className="max-w-lg" data-testid="dialog-upload-proposal">
        <DialogHeader>
          <DialogTitle>Upload a proposal</DialogTitle>
          <DialogDescription>
            Add a finished proposal (PDF, Word, etc.). You and your AI agent can send it to any lead.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="proposal-file">File</Label>
            <Input
              id="proposal-file"
              type="file"
              accept=".pdf,.doc,.docx,.ppt,.pptx,.key,.pages,application/pdf"
              onChange={(e) => {
                const f = e.target.files?.[0] || null;
                setFile(f);
                if (f && !name.trim()) setName(f.name.replace(/\.[^.]+$/, ""));
              }}
              data-testid="input-proposal-file"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="proposal-name">Name</Label>
            <Input
              id="proposal-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Standard Website Proposal"
              data-testid="input-proposal-name"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="proposal-description">Description (optional)</Label>
            <Textarea
              id="proposal-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="A short note so you (and the AI) know when to use this one."
              rows={2}
              data-testid="input-proposal-description"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} data-testid="button-cancel-upload">
            Cancel
          </Button>
          <Button
            onClick={() => saveMutation.mutate()}
            disabled={!file || saveMutation.isPending || isUploading}
            data-testid="button-confirm-upload"
          >
            {saveMutation.isPending || isUploading ? (
              <Loader2 className="h-4 w-4 mr-1 animate-spin" />
            ) : (
              <Upload className="h-4 w-4 mr-1" />
            )}
            Upload
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Manage the reusable proposal library: upload, list, download, delete.
 * Shared between the CRM and the Outreach engine.
 */
export function ProposalLibrary() {
  const { toast } = useToast();
  const [uploadOpen, setUploadOpen] = useState(false);
  const { data: assets = [], isLoading } = useProposalAssets();

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => apiRequest("DELETE", `/api/proposal-assets/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: PROPOSAL_ASSETS_KEY });
      toast({ title: "Proposal removed" });
    },
    onError: (e) => toast({ title: "Error", description: errorText(e), variant: "destructive" }),
  });

  return (
    <div data-testid="proposal-library">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <FileText className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-semibold">Proposal Library</span>
        </div>
        <Button size="sm" onClick={() => setUploadOpen(true)} data-testid="button-upload-proposal">
          <Upload className="h-4 w-4 mr-1" /> Upload Proposal
        </Button>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-6">
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        </div>
      ) : assets.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-6" data-testid="text-no-proposal-assets">
          No uploaded proposals yet. Upload one and your AI agent can send it to any lead on request.
        </p>
      ) : (
        <div className="space-y-2">
          {assets.map((a) => (
            <div
              key={a.id}
              className="flex items-center gap-3 p-2.5 rounded-lg border border-border/50"
              data-testid={`proposal-asset-${a.id}`}
            >
              <div className="h-8 w-8 rounded-md flex items-center justify-center shrink-0 bg-primary/10">
                <FileText className="h-4 w-4 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">{a.name}</div>
                <div className="text-xs text-muted-foreground truncate">
                  {a.fileName}
                  {a.fileSize ? ` · ${formatSize(a.fileSize)}` : ""}
                  {a.description ? ` · ${a.description}` : ""}
                </div>
              </div>
              <a
                href={a.storageKey}
                target="_blank"
                rel="noreferrer"
                className="text-muted-foreground hover:text-foreground p-1.5 rounded-md"
                title="Download"
                data-testid={`button-download-proposal-${a.id}`}
              >
                <Download className="h-4 w-4" />
              </a>
              <button
                onClick={() => { if (confirm(`Remove "${a.name}" from the library?`)) deleteMutation.mutate(a.id); }}
                className="text-muted-foreground hover:text-red-500 p-1.5 rounded-md"
                title="Delete"
                data-testid={`button-delete-proposal-asset-${a.id}`}
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      )}

      <UploadProposalDialog open={uploadOpen} onOpenChange={setUploadOpen} />
    </div>
  );
}

/**
 * Pick a library proposal and send it to a specific lead as an attachment.
 * Works for both CRM (leadType="crm") and outreach (leadType="outreach") leads.
 */
export function SendUploadedProposalDialog({
  open,
  onOpenChange,
  leadType,
  leadId,
  leadLabel,
  leadEmail,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  leadType: "crm" | "outreach";
  leadId: string;
  leadLabel?: string;
  leadEmail?: string | null;
}) {
  const { toast } = useToast();
  const { data: assets = [], isLoading } = useProposalAssets();
  const [selectedId, setSelectedId] = useState<string>("");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");

  const reset = () => {
    setSelectedId("");
    setSubject("");
    setMessage("");
  };

  const sendMutation = useMutation({
    mutationFn: async () => {
      if (!selectedId) throw new Error("Pick a proposal to send");
      await apiRequest("POST", `/api/proposal-assets/${selectedId}/send`, {
        leadType,
        leadId,
        subject: subject.trim() || undefined,
        message: message.trim() || undefined,
      });
    },
    onSuccess: () => {
      toast({ title: "Proposal sent", description: leadEmail ? `Emailed to ${leadEmail}` : "On its way." });
      reset();
      onOpenChange(false);
    },
    onError: (e) => toast({ title: "Could not send", description: errorText(e), variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) reset(); onOpenChange(v); }}>
      <DialogContent className="max-w-lg" data-testid="dialog-send-uploaded-proposal">
        <DialogHeader>
          <DialogTitle>Send a proposal</DialogTitle>
          <DialogDescription>
            {leadLabel ? `Attach an uploaded proposal and email it to ${leadLabel}.` : "Attach an uploaded proposal and email it to this lead."}
            {leadEmail ? ` (${leadEmail})` : ""}
          </DialogDescription>
        </DialogHeader>

        {!leadEmail && (
          <p className="text-xs text-amber-500" data-testid="text-no-lead-email">
            This lead has no email address on file. Add one before sending.
          </p>
        )}

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Proposal</Label>
            {isLoading ? (
              <div className="flex items-center py-2"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>
            ) : assets.length === 0 ? (
              <p className="text-sm text-muted-foreground">No uploaded proposals yet. Upload one in the Proposal Library first.</p>
            ) : (
              <Select value={selectedId} onValueChange={setSelectedId}>
                <SelectTrigger data-testid="select-proposal-asset"><SelectValue placeholder="Choose a proposal" /></SelectTrigger>
                <SelectContent>
                  {assets.map((a) => (
                    <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="send-subject">Subject (optional)</Label>
            <Input
              id="send-subject"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Defaults to the proposal name"
              data-testid="input-send-subject"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="send-message">Cover note (optional)</Label>
            <Textarea
              id="send-message"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="A short, friendly note for the email body. Leave blank to use a default."
              rows={4}
              data-testid="input-send-message"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} data-testid="button-cancel-send-proposal">
            Cancel
          </Button>
          <Button
            onClick={() => sendMutation.mutate()}
            disabled={!selectedId || !leadEmail || sendMutation.isPending}
            data-testid="button-confirm-send-proposal"
          >
            {sendMutation.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Send className="h-4 w-4 mr-1" />}
            Send
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
