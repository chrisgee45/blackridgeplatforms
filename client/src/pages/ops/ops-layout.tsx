import { useState, useEffect, useCallback } from "react";
import { useLocation, Link } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { useQuery } from "@tanstack/react-query";
import RidgeWidget from "@/components/RidgeWidget";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarHeader,
  SidebarFooter,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { VisuallyHidden } from "@radix-ui/react-visually-hidden";
import {
  Mountain,
  LayoutDashboard,
  FolderKanban,
  CheckSquare,
  Users,
  Building2,
  FileCog,
  Search,
  Command,
  LogOut,
  Loader2,
  Zap,
  ArrowLeft,
  FileText,
  FileBarChart,
  Brain,
  Megaphone,
  UserCircle,
  Receipt,
  LineChart,
  Calculator,
  CalendarDays,
  ClipboardCheck,
  Shield,
  Database,
  BookOpen,
  ShieldCheck,
  Scan,
} from "lucide-react";
import { MfaSettingsDialog } from "@/components/MfaSettings";
import type { Project, Company, ContactPerson, Task, ProjectTemplate } from "@shared/schema";

interface SearchResults {
  projects: Project[];
  companies: Company[];
  contacts: ContactPerson[];
  tasks: Task[];
  templates: ProjectTemplate[];
}

const NAV_ITEMS = [
  { title: "Dashboard", href: "/admin/ops", icon: LayoutDashboard },
  { title: "Projects", href: "/admin/ops/projects", icon: FolderKanban },
  { title: "Tasks", href: "/admin/ops/tasks", icon: CheckSquare },
  { title: "Project Flow", href: "/admin/ops/pipeline", icon: Zap },
  { title: "Companies", href: "/admin/ops/companies", icon: Building2 },
  { title: "Contacts", href: "/admin/ops/contacts", icon: Users },
  { title: "Templates", href: "/admin/ops/templates", icon: FileCog },
  { title: "Reports", href: "/admin/ops/reports", icon: FileBarChart },
  { title: "Clients", href: "/admin/ops/clients", icon: UserCircle },
  { title: "AI Ops", href: "/admin/ops/ai", icon: Brain },
  { title: "Outreach", href: "/admin/ops/outreach", icon: Megaphone },
  { title: "Expenses", href: "/admin/ops/expenses", icon: Receipt },
  { title: "Financials", href: "/admin/ops/financials", icon: LineChart },
  { title: "Tax Center", href: "/admin/ops/tax-center", icon: Calculator },
  { title: "Calendar", href: "/admin/ops/calendar", icon: CalendarDays },
  { title: "QA Checklist", href: "/admin/ops/qa", icon: ClipboardCheck },
  { title: "Policies", href: "/admin/ops/policies", icon: BookOpen },
  { title: "Audit Trail", href: "/admin/ops/audit-trail", icon: Shield },
  { title: "Backups", href: "/admin/ops/backups", icon: Database },
  { title: "QA Audit Portal", href: "/admin/ops/qa-audit", icon: Scan },
];

const quickActions = [
  { label: "Go to Dashboard", href: "/admin/ops", icon: LayoutDashboard },
  { label: "Go to Projects", href: "/admin/ops/projects", icon: FolderKanban },
  { label: "Go to Tasks", href: "/admin/ops/tasks", icon: CheckSquare },
  { label: "Go to Project Flow", href: "/admin/ops/pipeline", icon: Zap },
  { label: "Go to Companies", href: "/admin/ops/companies", icon: Building2 },
  { label: "Go to Contacts", href: "/admin/ops/contacts", icon: Users },
  { label: "Go to Templates", href: "/admin/ops/templates", icon: FileCog },
  { label: "Go to Reports", href: "/admin/ops/reports", icon: FileBarChart },
  { label: "Go to Clients", href: "/admin/ops/clients", icon: UserCircle },
  { label: "Go to AI Ops", href: "/admin/ops/ai", icon: Brain },
  { label: "Go to Outreach", href: "/admin/ops/outreach", icon: Megaphone },
  { label: "Go to Expenses", href: "/admin/ops/expenses", icon: Receipt },
  { label: "Go to Financials", href: "/admin/ops/financials", icon: LineChart },
  { label: "Go to Tax Center", href: "/admin/ops/tax-center", icon: Calculator },
  { label: "Go to Calendar", href: "/admin/ops/calendar", icon: CalendarDays },
  { label: "Go to QA Checklist", href: "/admin/ops/qa", icon: ClipboardCheck },
  { label: "Go to Policies", href: "/admin/ops/policies", icon: BookOpen },
  { label: "Go to Audit Trail", href: "/admin/ops/audit-trail", icon: Shield },
  { label: "Go to Backups", href: "/admin/ops/backups", icon: Database },
  { label: "Go to QA Audit Portal", href: "/admin/ops/qa-audit", icon: Scan },
  { label: "Back to CRM", href: "/admin", icon: ArrowLeft },
];

function CommandBar({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const [query, setQuery] = useState("");
  const [, navigate] = useLocation();

  const debouncedQuery = useDebounce(query, 250);

  const { data: searchResults, isLoading: searching } = useQuery<SearchResults>({
    queryKey: ["/api/ops/search", debouncedQuery],
    queryFn: async () => {
      if (!debouncedQuery || debouncedQuery.length < 2) return { projects: [], companies: [], contacts: [], tasks: [], templates: [] };
      const res = await fetch(`/api/ops/search?q=${encodeURIComponent(debouncedQuery)}`, { credentials: "include" });
      if (!res.ok) throw new Error("Search failed");
      return res.json();
    },
    enabled: open && debouncedQuery.length >= 2,
  });

  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  const goTo = (path: string) => {
    navigate(path);
    onOpenChange(false);
  };

  const filteredActions = query
    ? quickActions.filter(a => a.label.toLowerCase().includes(query.toLowerCase()))
    : quickActions;

  const hasEntityResults = searchResults && (
    searchResults.projects.length > 0 ||
    searchResults.companies.length > 0 ||
    searchResults.contacts.length > 0 ||
    searchResults.tasks.length > 0 ||
    searchResults.templates.length > 0
  );

  const showQuickActions = !query || (filteredActions.length > 0 && !hasEntityResults);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg p-0 gap-0 bg-card/95 backdrop-blur-xl border-border/30 overflow-hidden">
        <VisuallyHidden><DialogTitle>Search</DialogTitle></VisuallyHidden>
        <div className="flex items-center gap-2 px-4 border-b border-border/30">
          <Search className="w-4 h-4 text-muted-foreground shrink-0" />
          <Input
            data-testid="input-command-search"
            placeholder="Search projects, companies, contacts, tasks..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="border-0 focus-visible:ring-0 bg-transparent h-12 text-sm"
            autoFocus
          />
          {searching && <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground shrink-0" />}
          <Badge variant="outline" className="text-[10px] shrink-0 no-default-hover-elevate no-default-active-elevate">ESC</Badge>
        </div>
        <div className="max-h-80 overflow-y-auto p-2 space-y-1">
          {hasEntityResults && (
            <>
              {searchResults.projects.length > 0 && (
                <SearchGroup title="Projects" icon={FolderKanban}>
                  {searchResults.projects.map(p => (
                    <SearchItem
                      key={p.id}
                      label={p.name}
                      detail={p.stage?.replace(/_/g, " ")}
                      onClick={() => goTo(`/admin/ops/projects/${p.id}`)}
                      testId={`search-project-${p.id}`}
                    />
                  ))}
                </SearchGroup>
              )}
              {searchResults.companies.length > 0 && (
                <SearchGroup title="Companies" icon={Building2}>
                  {searchResults.companies.map(c => (
                    <SearchItem
                      key={c.id}
                      label={c.name}
                      detail={c.domain ?? undefined}
                      onClick={() => goTo(`/admin/ops/companies`)}
                      testId={`search-company-${c.id}`}
                    />
                  ))}
                </SearchGroup>
              )}
              {searchResults.contacts.length > 0 && (
                <SearchGroup title="Contacts" icon={Users}>
                  {searchResults.contacts.map(c => (
                    <SearchItem
                      key={c.id}
                      label={c.name}
                      detail={c.email ?? c.role ?? undefined}
                      onClick={() => goTo(`/admin/ops/contacts`)}
                      testId={`search-contact-${c.id}`}
                    />
                  ))}
                </SearchGroup>
              )}
              {searchResults.tasks.length > 0 && (
                <SearchGroup title="Tasks" icon={CheckSquare}>
                  {searchResults.tasks.map(t => (
                    <SearchItem
                      key={t.id}
                      label={t.title}
                      detail={t.status}
                      onClick={() => goTo(t.projectId ? `/admin/ops/projects/${t.projectId}` : `/admin/ops/tasks`)}
                      testId={`search-task-${t.id}`}
                    />
                  ))}
                </SearchGroup>
              )}
              {searchResults.templates.length > 0 && (
                <SearchGroup title="Templates" icon={FileText}>
                  {searchResults.templates.map(t => (
                    <SearchItem
                      key={t.id}
                      label={t.name}
                      onClick={() => goTo(`/admin/ops/templates`)}
                      testId={`search-template-${t.id}`}
                    />
                  ))}
                </SearchGroup>
              )}
            </>
          )}

          {showQuickActions && filteredActions.length > 0 && (
            <SearchGroup title="Quick Actions" icon={Zap}>
              {filteredActions.map((item) => (
                <SearchItem
                  key={item.label}
                  label={item.label}
                  onClick={() => goTo(item.href)}
                  testId={`cmd-${item.label.toLowerCase().replace(/\s+/g, "-")}`}
                />
              ))}
            </SearchGroup>
          )}

          {query.length >= 2 && !searching && !hasEntityResults && filteredActions.length === 0 && (
            <div className="text-center py-8 text-muted-foreground text-sm" data-testid="text-no-results">No results found</div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function SearchGroup({ title, icon: Icon, children }: { title: string; icon: React.ComponentType<{ className?: string }>; children: React.ReactNode }) {
  return (
    <div>
      <div className="flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-medium tracking-widest uppercase text-muted-foreground/60">
        <Icon className="w-3 h-3" />
        {title}
      </div>
      {children}
    </div>
  );
}

function SearchItem({ label, detail, onClick, testId }: { label: string; detail?: string; onClick: () => void; testId: string }) {
  return (
    <button
      data-testid={testId}
      onClick={onClick}
      className="w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm text-left hover-elevate transition-colors"
    >
      <span className="text-foreground flex-1 truncate">{label}</span>
      {detail && <span className="text-xs text-muted-foreground shrink-0">{detail}</span>}
    </button>
  );
}

function useDebounce(value: string, delay: number): string {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

function OpsSidebar({ setMfaOpen }: { setMfaOpen: (open: boolean) => void }) {
  const [location] = useLocation();

  return (
    <Sidebar>
      <SidebarHeader className="p-4">
        <Link href="/admin/ops">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-md bg-primary/10 border border-primary/20 flex items-center justify-center">
              <Mountain className="w-4 h-4 text-primary" />
            </div>
            <div>
              <span className="font-semibold text-sm tracking-tight text-sidebar-foreground">BlackRidge</span>
              <span className="block text-[10px] text-primary font-medium tracking-widest uppercase">OPS</span>
            </div>
          </div>
        </Link>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel className="text-[10px] tracking-widest uppercase text-muted-foreground/60">Navigation</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {NAV_ITEMS.map((item) => {
                const isActive = location === item.href || 
                  (item.href !== "/admin/ops" && location.startsWith(item.href));
                return (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton asChild data-active={isActive}>
                      <Link href={item.href} data-testid={`nav-${item.title.toLowerCase().replace(/\s+/g, "-")}`}>
                        <item.icon className="w-4 h-4" />
                        <span>{item.title}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="p-3">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton onClick={() => setMfaOpen?.(true)} data-testid="nav-mfa-settings">
              <ShieldCheck className="w-4 h-4" />
              <span>MFA Settings</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton asChild>
              <Link href="/admin" data-testid="nav-back-crm">
                <ArrowLeft className="w-4 h-4" />
                <span>Back to CRM</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}

export default function OpsLayout({ children }: { children: React.ReactNode }) {
  const { user, isLoading, logout } = useAuth();
  const [commandOpen, setCommandOpen] = useState(false);
  const [mfaOpen, setMfaOpen] = useState(false);
  const [, navigate] = useLocation();

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setCommandOpen((open) => !open);
      }
    };
    document.addEventListener("keydown", down);
    return () => document.removeEventListener("keydown", down);
  }, []);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen bg-background">
        <Loader2 className="w-6 h-6 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) {
    navigate("/admin");
    return null;
  }

  const sidebarStyle = {
    "--sidebar-width": "15rem",
    "--sidebar-width-icon": "3.5rem",
  };

  return (
    <SidebarProvider style={sidebarStyle as React.CSSProperties}>
      <div className="flex h-screen w-full bg-background">
        <OpsSidebar setMfaOpen={setMfaOpen} />
        <div className="flex flex-col flex-1 min-w-0">
          <header className="flex items-center justify-between gap-2 px-4 h-14 border-b border-border/40 bg-background/80 backdrop-blur-sm sticky top-0 z-50">
            <div className="flex items-center gap-2">
              <SidebarTrigger data-testid="button-sidebar-toggle" />
              <button
                data-testid="button-command-bar"
                onClick={() => setCommandOpen(true)}
                className="flex items-center gap-2 px-3 h-8 rounded-md border border-border/40 bg-muted/30 text-muted-foreground text-sm hover-elevate transition-colors min-w-0 sm:min-w-[200px]"
              >
                <Search className="w-3.5 h-3.5" />
                <span className="flex-1 text-left">Search...</span>
                <div className="flex items-center gap-0.5">
                  <kbd className="pointer-events-none inline-flex h-5 select-none items-center gap-0.5 rounded border border-border/50 bg-muted px-1 font-mono text-[10px] font-medium text-muted-foreground">
                    <Command className="w-2.5 h-2.5" />K
                  </kbd>
                </div>
              </button>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => logout()}
                data-testid="button-logout"
              >
                <LogOut className="w-4 h-4" />
              </Button>
            </div>
          </header>
          <main className="flex-1 overflow-x-hidden overflow-y-auto">
            {children}
          </main>
        </div>
      </div>
      <CommandBar open={commandOpen} onOpenChange={setCommandOpen} />
      <RidgeWidget autoGreet={true} />
      <MfaSettingsDialog open={mfaOpen} onClose={() => setMfaOpen(false)} />
    </SidebarProvider>
  );
}
