import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  ClipboardCheck, Plus, Pencil, Trash2, Loader2, ListChecks,
} from "lucide-react";
import type { QaTemplate } from "@shared/schema";

const PROJECT_TYPES = [
  { value: "marketing_website", label: "Marketing Website" },
  { value: "crm_portal", label: "CRM Portal" },
  { value: "saas_platform", label: "SaaS Platform" },
  { value: "ecommerce_site", label: "E-commerce Site" },
  { value: "internal_tool", label: "Internal Tool" },
] as const;

type ProjectType = (typeof PROJECT_TYPES)[number]["value"];

function getProjectTypeLabel(value: string): string {
  return PROJECT_TYPES.find(p => p.value === value)?.label ?? value;
}

export default function QaTemplatesPage() {
  const [selectedType, setSelectedType] = useState<ProjectType>("marketing_website");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<QaTemplate | null>(null);
  const [formCategory, setFormCategory] = useState("");
  const [formDescription, setFormDescription] = useState("");
  const [formSortOrder, setFormSortOrder] = useState("0");
  const { toast } = useToast();

  const { data: templates, isLoading } = useQuery<QaTemplate[]>({
    queryKey: ["/api/ops/qa/templates", selectedType],
    queryFn: async () => {
      const res = await fetch(`/api/ops/qa/templates?projectType=${selectedType}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch templates");
      return res.json();
    },
  });

  const createMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/ops/qa/templates", {
      projectType: selectedType,
      category: formCategory,
      itemDescription: formDescription,
      sortOrder: parseInt(formSortOrder) || 0,
    }),
    onSuccess: () => {
      toast({ title: "Template item created" });
      queryClient.invalidateQueries({ queryKey: ["/api/ops/qa/templates", selectedType] });
      closeDialog();
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to create template item", variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: (id: string) => apiRequest("PATCH", `/api/ops/qa/templates/${id}`, {
      category: formCategory,
      itemDescription: formDescription,
      sortOrder: parseInt(formSortOrder) || 0,
    }),
    onSuccess: () => {
      toast({ title: "Template item updated" });
      queryClient.invalidateQueries({ queryKey: ["/api/ops/qa/templates", selectedType] });
      closeDialog();
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to update template item", variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/ops/qa/templates/${id}`),
    onSuccess: () => {
      toast({ title: "Template item deleted" });
      queryClient.invalidateQueries({ queryKey: ["/api/ops/qa/templates", selectedType] });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to delete template item", variant: "destructive" });
    },
  });

  function openCreate() {
    setEditingItem(null);
    setFormCategory("");
    setFormDescription("");
    setFormSortOrder("0");
    setDialogOpen(true);
  }

  function openEdit(item: QaTemplate) {
    setEditingItem(item);
    setFormCategory(item.category);
    setFormDescription(item.itemDescription);
    setFormSortOrder(String(item.sortOrder ?? 0));
    setDialogOpen(true);
  }

  function closeDialog() {
    setDialogOpen(false);
    setEditingItem(null);
    setFormCategory("");
    setFormDescription("");
    setFormSortOrder("0");
  }

  function handleSubmit() {
    if (!formCategory.trim() || !formDescription.trim()) return;
    if (editingItem) {
      updateMutation.mutate(editingItem.id);
    } else {
      createMutation.mutate();
    }
  }

  const grouped: Record<string, QaTemplate[]> = {};
  if (templates) {
    for (const t of templates) {
      if (!grouped[t.category]) grouped[t.category] = [];
      grouped[t.category].push(t);
    }
    for (const key of Object.keys(grouped)) {
      grouped[key].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
    }
  }
  const categories = Object.keys(grouped).sort();

  const isMutating = createMutation.isPending || updateMutation.isPending;

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight" data-testid="text-page-title">
            QA Checklist Templates
          </h1>
          <p className="text-muted-foreground text-sm mt-1" data-testid="text-page-subtitle">
            Manage default QA checklist items by project type
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Select value={selectedType} onValueChange={(v) => setSelectedType(v as ProjectType)}>
            <SelectTrigger className="w-[200px]" data-testid="select-project-type">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PROJECT_TYPES.map((pt) => (
                <SelectItem key={pt.value} value={pt.value} data-testid={`option-type-${pt.value}`}>
                  {pt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button size="sm" onClick={openCreate} data-testid="button-add-template">
            <Plus className="w-4 h-4 mr-1" /> Add Item
          </Button>
        </div>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        {PROJECT_TYPES.map((pt) => (
          <Button
            key={pt.value}
            variant={selectedType === pt.value ? "default" : "outline"}
            size="sm"
            onClick={() => setSelectedType(pt.value)}
            data-testid={`button-type-${pt.value}`}
          >
            {pt.label}
          </Button>
        ))}
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <Card key={i}>
              <CardHeader>
                <Skeleton className="h-5 w-40" />
              </CardHeader>
              <CardContent className="space-y-2">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-4 w-5/6" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : categories.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <ClipboardCheck className="w-10 h-10 mx-auto text-muted-foreground/40 mb-3" />
            <p className="text-muted-foreground text-sm" data-testid="text-no-templates">
              No template items for {getProjectTypeLabel(selectedType)}
            </p>
            <Button size="sm" variant="outline" className="mt-3" onClick={openCreate} data-testid="button-add-first">
              <Plus className="w-4 h-4 mr-1" /> Add First Item
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {categories.map((category) => (
            <Card key={category} data-testid={`card-category-${category.replace(/\s+/g, "-").toLowerCase()}`}>
              <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-3">
                <div className="flex items-center gap-2 flex-wrap">
                  <ListChecks className="w-4 h-4 text-muted-foreground" />
                  <CardTitle className="text-sm font-semibold">{category}</CardTitle>
                  <Badge variant="secondary" className="text-xs" data-testid={`badge-count-${category.replace(/\s+/g, "-").toLowerCase()}`}>
                    {grouped[category].length}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-1">
                {grouped[category].map((item) => (
                  <div
                    key={item.id}
                    className="flex items-start gap-2 py-2 group"
                    data-testid={`row-template-${item.id}`}
                  >
                    <span className="text-sm text-foreground flex-1">{item.itemDescription}</span>
                    <div className="flex items-center gap-1 shrink-0 invisible group-hover:visible">
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => openEdit(item)}
                        data-testid={`button-edit-${item.id}`}
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => deleteMutation.mutate(item.id)}
                        disabled={deleteMutation.isPending}
                        data-testid={`button-delete-${item.id}`}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingItem ? "Edit Template Item" : "Add Template Item"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div>
              <label className="text-sm font-medium">Category</label>
              <Input
                placeholder="e.g. Frontend UI/UX"
                value={formCategory}
                onChange={(e) => setFormCategory(e.target.value)}
                data-testid="input-category"
              />
              {categories.length > 0 && !editingItem && (
                <div className="flex gap-1 mt-2 flex-wrap">
                  {categories.map((c) => (
                    <Badge
                      key={c}
                      variant="outline"
                      className="cursor-pointer text-xs"
                      onClick={() => setFormCategory(c)}
                      data-testid={`badge-suggest-${c.replace(/\s+/g, "-").toLowerCase()}`}
                    >
                      {c}
                    </Badge>
                  ))}
                </div>
              )}
            </div>
            <div>
              <label className="text-sm font-medium">Description</label>
              <Input
                placeholder="e.g. All forms have proper validation and error messages"
                value={formDescription}
                onChange={(e) => setFormDescription(e.target.value)}
                data-testid="input-description"
              />
            </div>
            <div>
              <label className="text-sm font-medium">Sort Order</label>
              <Input
                type="number"
                min="0"
                value={formSortOrder}
                onChange={(e) => setFormSortOrder(e.target.value)}
                data-testid="input-sort-order"
              />
            </div>
            <Button
              className="w-full"
              disabled={!formCategory.trim() || !formDescription.trim() || isMutating}
              onClick={handleSubmit}
              data-testid="button-submit-template"
            >
              {isMutating ? (
                <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Saving...</>
              ) : editingItem ? (
                "Update Item"
              ) : (
                "Create Item"
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
