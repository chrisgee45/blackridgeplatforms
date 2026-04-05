import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Users, Plus, Mail, Phone, Building2, Star, Search, X, Edit, Trash2,
} from "lucide-react";
import type { ContactPerson, Company } from "@shared/schema";

export default function ContactsPage() {
  const { toast } = useToast();
  const [showForm, setShowForm] = useState(false);
  const [editingContactId, setEditingContactId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [companyFilter, setCompanyFilter] = useState("all");

  const [formName, setFormName] = useState("");
  const [formEmail, setFormEmail] = useState("");
  const [formPhone, setFormPhone] = useState("");
  const [formRole, setFormRole] = useState("");
  const [formCompanyId, setFormCompanyId] = useState("");
  const [formIsPrimary, setFormIsPrimary] = useState(false);
  const [formNotes, setFormNotes] = useState("");

  const { data: contacts = [], isLoading: contactsLoading } = useQuery<ContactPerson[]>({
    queryKey: ["/api/ops/contacts"],
  });

  const { data: companies = [], isLoading: companiesLoading } = useQuery<Company[]>({
    queryKey: ["/api/ops/companies"],
  });

  const companyMap = useMemo(() => {
    const map: Record<string, Company> = {};
    companies.forEach((c) => { map[c.id] = c; });
    return map;
  }, [companies]);

  const createContactMutation = useMutation({
    mutationFn: async (data: Record<string, unknown>) => {
      const res = await apiRequest("POST", "/api/ops/contacts", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ops/contacts"] });
      toast({ title: "Contact created" });
      resetForm();
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const updateContactMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Record<string, unknown> }) => {
      const res = await apiRequest("PATCH", `/api/ops/contacts/${id}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ops/contacts"] });
      toast({ title: "Contact updated" });
      resetForm();
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const deleteContactMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/ops/contacts/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ops/contacts"] });
      toast({ title: "Contact deleted" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  function resetForm() {
    setShowForm(false);
    setEditingContactId(null);
    setFormName("");
    setFormEmail("");
    setFormPhone("");
    setFormRole("");
    setFormCompanyId("");
    setFormIsPrimary(false);
    setFormNotes("");
  }

  function handleEdit(contact: ContactPerson) {
    setEditingContactId(contact.id);
    setFormName(contact.name);
    setFormEmail(contact.email || "");
    setFormPhone(contact.phone || "");
    setFormRole(contact.role || "");
    setFormCompanyId(contact.companyId || "");
    setFormIsPrimary(contact.isPrimary ?? false);
    setFormNotes(contact.notes || "");
    setShowForm(true);
  }

  function handleDelete(contact: ContactPerson) {
    if (!window.confirm(`Are you sure you want to delete "${contact.name}"?`)) return;
    deleteContactMutation.mutate(contact.id);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!formName.trim() || !formEmail.trim()) return;
    const payload = {
      name: formName.trim(),
      email: formEmail.trim(),
      phone: formPhone.trim() || null,
      role: formRole.trim() || null,
      companyId: formCompanyId || null,
      isPrimary: formIsPrimary,
      notes: formNotes.trim() || null,
    };
    if (editingContactId) {
      updateContactMutation.mutate({ id: editingContactId, data: payload });
    } else {
      createContactMutation.mutate(payload);
    }
  }

  const filtered = useMemo(() => {
    let list = contacts;
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(
        (c) =>
          c.name.toLowerCase().includes(q) ||
          (c.email && c.email.toLowerCase().includes(q))
      );
    }
    if (companyFilter !== "all") {
      list = list.filter((c) => c.companyId === companyFilter);
    }
    return list;
  }, [contacts, search, companyFilter]);

  const isLoading = contactsLoading || companiesLoading;

  return (
    <div className="p-3 sm:p-6 space-y-4 sm:space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Users className="w-6 h-6" />
            Contacts
          </h1>
          <p className="text-muted-foreground text-sm mt-1">Manage client contacts</p>
        </div>
        <Button
          data-testid="button-add-contact"
          onClick={() => {
            if (showForm) {
              resetForm();
            } else {
              setEditingContactId(null);
              setShowForm(true);
            }
          }}
        >
          {showForm ? <X className="w-4 h-4 mr-2" /> : <Plus className="w-4 h-4 mr-2" />}
          {showForm ? "Cancel" : "Add Contact"}
        </Button>
      </div>

      {showForm && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">{editingContactId ? "Edit Contact" : "New Contact"}</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-sm font-medium" htmlFor="contact-name">Name *</label>
                <Input
                  id="contact-name"
                  data-testid="input-contact-name"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  placeholder="Full name"
                  required
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium" htmlFor="contact-email">Email *</label>
                <Input
                  id="contact-email"
                  data-testid="input-contact-email"
                  type="email"
                  value={formEmail}
                  onChange={(e) => setFormEmail(e.target.value)}
                  placeholder="email@example.com"
                  required
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium" htmlFor="contact-phone">Phone</label>
                <Input
                  id="contact-phone"
                  data-testid="input-contact-phone"
                  value={formPhone}
                  onChange={(e) => setFormPhone(e.target.value)}
                  placeholder="Phone number"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium" htmlFor="contact-role">Role</label>
                <Input
                  id="contact-role"
                  data-testid="input-contact-role"
                  value={formRole}
                  onChange={(e) => setFormRole(e.target.value)}
                  placeholder="Job title"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Company</label>
                <Select value={formCompanyId} onValueChange={setFormCompanyId}>
                  <SelectTrigger data-testid="select-contact-company">
                    <SelectValue placeholder="Select company" />
                  </SelectTrigger>
                  <SelectContent>
                    {companies.map((c) => (
                      <SelectItem key={c.id} value={c.id} data-testid={`select-company-${c.id}`}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center gap-2 self-end pb-1">
                <Checkbox
                  id="contact-primary"
                  data-testid="checkbox-contact-primary"
                  checked={formIsPrimary}
                  onCheckedChange={(v) => setFormIsPrimary(!!v)}
                />
                <label htmlFor="contact-primary" className="text-sm font-medium cursor-pointer">
                  Primary contact
                </label>
              </div>
              <div className="sm:col-span-2 space-y-1.5">
                <label className="text-sm font-medium" htmlFor="contact-notes">Notes</label>
                <Textarea
                  id="contact-notes"
                  data-testid="input-contact-notes"
                  value={formNotes}
                  onChange={(e) => setFormNotes(e.target.value)}
                  placeholder="Additional notes..."
                  className="resize-none"
                  rows={3}
                />
              </div>
              <div className="sm:col-span-2 flex gap-2 justify-end">
                <Button
                  type="button"
                  variant="outline"
                  data-testid="button-cancel-contact"
                  onClick={resetForm}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  data-testid="button-submit-contact"
                  disabled={createContactMutation.isPending || updateContactMutation.isPending}
                >
                  {(createContactMutation.isPending || updateContactMutation.isPending)
                    ? "Saving..."
                    : editingContactId
                      ? "Update Contact"
                      : "Save Contact"}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            data-testid="input-search-contacts"
            className="pl-9"
            placeholder="Search by name or email..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Select value={companyFilter} onValueChange={setCompanyFilter}>
          <SelectTrigger className="w-[200px]" data-testid="select-filter-company">
            <SelectValue placeholder="All Companies" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Companies</SelectItem>
            {companies.map((c) => (
              <SelectItem key={c.id} value={c.id} data-testid={`filter-company-${c.id}`}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full rounded-md" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12" data-testid="empty-state-contacts">
          <Users className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
          <p className="text-muted-foreground text-sm">
            {contacts.length === 0 ? "No contacts yet. Add your first contact." : "No contacts match your filters."}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((contact) => {
            const company = contact.companyId ? companyMap[contact.companyId] : null;
            return (
              <div
                key={contact.id}
                data-testid={`row-contact-${contact.id}`}
                className="flex items-center gap-4 flex-wrap rounded-md border p-3 hover-elevate"
              >
                <div className="flex-1 min-w-[160px]">
                  <span className="font-semibold" data-testid={`text-contact-name-${contact.id}`}>
                    {contact.name}
                  </span>
                  {contact.role && (
                    <span className="text-muted-foreground text-sm ml-2" data-testid={`text-contact-role-${contact.id}`}>
                      {contact.role}
                    </span>
                  )}
                </div>

                {company && (
                  <div className="flex items-center gap-1 text-muted-foreground text-sm" data-testid={`text-contact-company-${contact.id}`}>
                    <Building2 className="w-3.5 h-3.5" />
                    {company.name}
                  </div>
                )}

                {contact.email && (
                  <a
                    href={`mailto:${contact.email}`}
                    className="flex items-center gap-1 text-sm hover:underline"
                    data-testid={`link-contact-email-${contact.id}`}
                  >
                    <Mail className="w-3.5 h-3.5 text-muted-foreground" />
                    {contact.email}
                  </a>
                )}

                {contact.phone && (
                  <span className="flex items-center gap-1 text-sm text-muted-foreground" data-testid={`text-contact-phone-${contact.id}`}>
                    <Phone className="w-3.5 h-3.5" />
                    {contact.phone}
                  </span>
                )}

                {contact.isPrimary && (
                  <Badge
                    variant="secondary"
                    className="no-default-hover-elevate no-default-active-elevate"
                    data-testid={`badge-primary-${contact.id}`}
                  >
                    <Star className="w-3 h-3 mr-1" />
                    Primary
                  </Badge>
                )}

                <div className="flex items-center gap-1">
                  <Button
                    size="icon"
                    variant="ghost"
                    data-testid={`button-edit-contact-${contact.id}`}
                    onClick={() => handleEdit(contact)}
                  >
                    <Edit className="w-4 h-4" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    data-testid={`button-delete-contact-${contact.id}`}
                    onClick={() => handleDelete(contact)}
                    disabled={deleteContactMutation.isPending}
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
