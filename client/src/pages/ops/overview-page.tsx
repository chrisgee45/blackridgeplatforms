import { useLocation } from "wouter";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import Dashboard from "./dashboard";
import AiOpsPage from "./ai-ops-page";
import ReportsPage from "./reports-page";

type TabValue = "dashboard" | "ai" | "reports";

export default function OverviewPage() {
  const [location, navigate] = useLocation();
  const [pathname, search] = location.split("?");
  const params = new URLSearchParams(search ?? "");
  const queryTab = params.get("tab");

  const defaultFromPath: TabValue =
    pathname.endsWith("/ai") ? "ai" :
    pathname.endsWith("/reports") ? "reports" :
    "dashboard";

  const tab: TabValue =
    queryTab === "ai" || queryTab === "reports" || queryTab === "dashboard"
      ? queryTab
      : defaultFromPath;

  const setTab = (value: string) => {
    const next = value === "dashboard" ? "" : `?tab=${value}`;
    navigate(`/admin/ops${next}`, { replace: true });
  };

  return (
    <Tabs value={tab} onValueChange={setTab}>
      <div className="px-6 pt-6">
        <TabsList>
          <TabsTrigger value="dashboard" data-testid="tab-overview-dashboard">Dashboard</TabsTrigger>
          <TabsTrigger value="ai" data-testid="tab-overview-ai">AI Insights</TabsTrigger>
          <TabsTrigger value="reports" data-testid="tab-overview-reports">Reports</TabsTrigger>
        </TabsList>
      </div>
      <TabsContent value="dashboard">
        <Dashboard />
      </TabsContent>
      <TabsContent value="ai">
        <AiOpsPage />
      </TabsContent>
      <TabsContent value="reports">
        <ReportsPage />
      </TabsContent>
    </Tabs>
  );
}
