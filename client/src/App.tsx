import { lazy, Suspense } from "react";
import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Loader2 } from "lucide-react";

import Home from "@/pages/home";

const NotFound = lazy(() => import("@/pages/not-found"));
const AdminPortal = lazy(() => import("@/pages/admin"));
const OpsLayout = lazy(() => import("@/pages/ops/ops-layout"));
const OpsDashboard = lazy(() => import("@/pages/ops/dashboard"));
const ProjectDetail = lazy(() => import("@/pages/ops/project-detail"));
const ProjectsList = lazy(() => import("@/pages/ops/projects-list"));
const TasksPage = lazy(() => import("@/pages/ops/tasks-page"));
const ContactsPage = lazy(() => import("@/pages/ops/contacts-page"));
const PipelinePage = lazy(() => import("@/pages/ops/pipeline-page"));
const CompaniesPage = lazy(() => import("@/pages/ops/companies-page"));
const TemplatesPage = lazy(() => import("@/pages/ops/templates-page"));
const ReportsPage = lazy(() => import("@/pages/ops/reports-page"));
const AIOpsPage = lazy(() => import("@/pages/ops/ai-ops-page"));
const OutreachPage = lazy(() => import("@/pages/ops/outreach-page"));
const ClientsPage = lazy(() => import("@/pages/ops/clients-page"));
const ExpensesPage = lazy(() => import("@/pages/ops/expenses-page"));
const CalendarPage = lazy(() => import("@/pages/ops/calendar-page"));
const FinancialsPage = lazy(() => import("@/pages/ops/financials-page"));
const TaxCenterPage = lazy(() => import("@/pages/ops/tax-center-page"));
const QaTemplatesPage = lazy(() => import("@/pages/ops/qa-templates-page"));
const AuditTestPage = lazy(() => import("@/pages/ops/audit-test-page"));
const AuditsListPage = lazy(() => import("@/pages/ops/audits-list-page"));
const AuditTrailPage = lazy(() => import("@/pages/ops/audit-trail-page"));
const BackupsPage = lazy(() => import("@/pages/ops/backups-page"));
const QaAuditPortalPage = lazy(() => import("@/pages/ops/qa-audit-portal-page"));
const PoliciesPage = lazy(() => import("@/pages/ops/policies-page"));
const PayPage = lazy(() => import("@/pages/pay-page"));
const KickoffForm = lazy(() => import("@/pages/kickoff-form"));
const OAuthCallback = lazy(() => import("@/pages/oauth-callback"));

function LoadingFallback() {
  return (
    <div className="flex items-center justify-center min-h-screen" data-testid="loading-fallback">
      <Loader2 className="h-8 w-8 animate-spin text-primary" />
    </div>
  );
}

function OpsPage({ component: Component }: { component: React.ComponentType }) {
  return (
    <OpsLayout>
      <Component />
    </OpsLayout>
  );
}

function PlaceholderPage({ title }: { title: string }) {
  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
      <p className="text-muted-foreground text-sm mt-1">Coming in next phase</p>
    </div>
  );
}

function ProjectsPage() { return <PlaceholderPage title="Projects" />; }

function Router() {
  return (
    <Suspense fallback={<LoadingFallback />}>
      <Switch>
        <Route path="/" component={Home} />
        <Route path="/oauth-callback" component={OAuthCallback} />
        <Route path="/admin" component={AdminPortal} />
        <Route path="/admin/ops">
          {() => <OpsPage component={OpsDashboard} />}
        </Route>
        <Route path="/admin/ops/projects">
          {() => <OpsPage component={ProjectsList} />}
        </Route>
        <Route path="/admin/ops/projects/:id">
          {() => <OpsPage component={ProjectDetail} />}
        </Route>
        <Route path="/admin/ops/tasks">
          {() => <OpsPage component={TasksPage} />}
        </Route>
        <Route path="/admin/ops/pipeline">
          {() => <OpsPage component={PipelinePage} />}
        </Route>
        <Route path="/admin/ops/companies">
          {() => <OpsPage component={CompaniesPage} />}
        </Route>
        <Route path="/admin/ops/contacts">
          {() => <OpsPage component={ContactsPage} />}
        </Route>
        <Route path="/admin/ops/templates">
          {() => <OpsPage component={TemplatesPage} />}
        </Route>
        <Route path="/admin/ops/reports">
          {() => <OpsPage component={ReportsPage} />}
        </Route>
        <Route path="/admin/ops/ai">
          {() => <OpsPage component={AIOpsPage} />}
        </Route>
        <Route path="/admin/ops/outreach/audits/test">
          {() => <OpsPage component={AuditTestPage} />}
        </Route>
        <Route path="/admin/ops/outreach/audits">
          {() => <OpsPage component={AuditsListPage} />}
        </Route>
        <Route path="/admin/ops/outreach">
          {() => <OpsPage component={OutreachPage} />}
        </Route>
        <Route path="/admin/ops/clients">
          {() => <OpsPage component={ClientsPage} />}
        </Route>
        <Route path="/admin/ops/expenses">
          {() => <OpsPage component={ExpensesPage} />}
        </Route>
        <Route path="/admin/ops/calendar">
          {() => <OpsPage component={CalendarPage} />}
        </Route>
        <Route path="/admin/ops/financials">
          {() => <OpsPage component={FinancialsPage} />}
        </Route>
        <Route path="/admin/ops/tax-center">
          {() => <OpsPage component={TaxCenterPage} />}
        </Route>
        <Route path="/admin/ops/qa">
          {() => <OpsPage component={QaTemplatesPage} />}
        </Route>
        <Route path="/admin/ops/policies">
          {() => <OpsPage component={PoliciesPage} />}
        </Route>
        <Route path="/admin/ops/audit-trail">
          {() => <OpsPage component={AuditTrailPage} />}
        </Route>
        <Route path="/admin/ops/backups">
          {() => <OpsPage component={BackupsPage} />}
        </Route>
        <Route path="/admin/ops/qa-audit">
          {() => <OpsPage component={QaAuditPortalPage} />}
        </Route>
        <Route path="/pay/:token" component={PayPage} />
        <Route path="/kickoff/:token" component={KickoffForm} />
        <Route component={NotFound} />
      </Switch>
    </Suspense>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Router />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
