import { useState, useEffect } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import QaTemplatesPage from "./qa-templates-page";
import QaAuditPortalPage from "./qa-audit-portal-page";

type TabValue = "checklists" | "audits";

function initialTab(): TabValue {
  if (typeof window === "undefined") return "checklists";
  const search = new URLSearchParams(window.location.search);
  const q = search.get("tab");
  if (q === "audits" || q === "checklists") return q;
  if (window.location.pathname.includes("qa-audit")) return "audits";
  return "checklists";
}

export default function QualityPage() {
  const [tab, setTab] = useState<TabValue>(initialTab);

  useEffect(() => {
    const next = tab === "audits" ? "?tab=audits" : "";
    const url = `/admin/ops/quality${next}`;
    if (window.location.pathname + window.location.search !== url) {
      window.history.replaceState(null, "", url);
    }
  }, [tab]);

  return (
    <Tabs value={tab} onValueChange={(v) => setTab(v as TabValue)}>
      <div className="px-6 pt-6">
        <TabsList>
          <TabsTrigger value="checklists" data-testid="tab-quality-checklists">Checklists</TabsTrigger>
          <TabsTrigger value="audits" data-testid="tab-quality-audits">Security Audits</TabsTrigger>
        </TabsList>
      </div>
      <TabsContent value="checklists">
        <QaTemplatesPage />
      </TabsContent>
      <TabsContent value="audits">
        <QaAuditPortalPage />
      </TabsContent>
    </Tabs>
  );
}
