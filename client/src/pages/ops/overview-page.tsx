import { useState, useEffect } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import Dashboard from "./dashboard";
import CalendarPage from "./calendar-page";
import ReportsPage from "./reports-page";

type TabValue = "dashboard" | "calendar" | "reports";

function initialTab(): TabValue {
  if (typeof window === "undefined") return "dashboard";
  const search = new URLSearchParams(window.location.search);
  const q = search.get("tab");
  if (q === "calendar" || q === "reports" || q === "dashboard") return q;
  const path = window.location.pathname;
  if (path.endsWith("/calendar")) return "calendar";
  if (path.endsWith("/reports")) return "reports";
  // Legacy ?tab=ai links land on Dashboard (AI Insights now lives in the menu).
  return "dashboard";
}

export default function OverviewPage() {
  const [tab, setTab] = useState<TabValue>(initialTab);

  useEffect(() => {
    const next = tab === "dashboard" ? "" : `?tab=${tab}`;
    const url = `/admin/ops${next}`;
    if (window.location.pathname + window.location.search !== url) {
      window.history.replaceState(null, "", url);
    }
  }, [tab]);

  return (
    <Tabs value={tab} onValueChange={(v) => setTab(v as TabValue)}>
      <div className="px-6 pt-6">
        <TabsList>
          <TabsTrigger value="dashboard" data-testid="tab-overview-dashboard">Dashboard</TabsTrigger>
          <TabsTrigger value="calendar" data-testid="tab-overview-calendar">Calendar</TabsTrigger>
          <TabsTrigger value="reports" data-testid="tab-overview-reports">Reports</TabsTrigger>
        </TabsList>
      </div>
      <TabsContent value="dashboard">
        <Dashboard />
      </TabsContent>
      <TabsContent value="calendar">
        <CalendarPage />
      </TabsContent>
      <TabsContent value="reports">
        <ReportsPage />
      </TabsContent>
    </Tabs>
  );
}
