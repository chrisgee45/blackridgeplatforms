import { lazy, Suspense } from "react";
import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Loader2 } from "lucide-react";

const LoginPage = lazy(() => import("@/pages/login"));
const NotFound = lazy(() => import("@/pages/not-found"));
const AppLayout = lazy(() => import("@/pages/layout"));
const Dashboard = lazy(() => import("@/pages/dashboard"));
const ExpensesPage = lazy(() => import("@/pages/expenses-page"));
const FinancialsPage = lazy(() => import("@/pages/financials-page"));
const TaxCenterPage = lazy(() => import("@/pages/tax-center-page"));
const ReportsPage = lazy(() => import("@/pages/reports-page"));

function LoadingFallback() {
  return (
    <div className="flex items-center justify-center min-h-screen" data-testid="loading-fallback">
      <Loader2 className="h-8 w-8 animate-spin text-primary" />
    </div>
  );
}

function Page({ component: Component }: { component: React.ComponentType }) {
  return (
    <AppLayout>
      <Component />
    </AppLayout>
  );
}

function Router() {
  return (
    <Suspense fallback={<LoadingFallback />}>
      <Switch>
        <Route path="/login" component={LoginPage} />
        <Route path="/">
          {() => <Page component={Dashboard} />}
        </Route>
        <Route path="/expenses">
          {() => <Page component={ExpensesPage} />}
        </Route>
        <Route path="/financials">
          {() => <Page component={FinancialsPage} />}
        </Route>
        <Route path="/tax-center">
          {() => <Page component={TaxCenterPage} />}
        </Route>
        <Route path="/reports">
          {() => <Page component={ReportsPage} />}
        </Route>
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
