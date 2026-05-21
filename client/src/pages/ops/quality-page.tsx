import { useLocation } from "wouter";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import QaTemplatesPage from "./qa-templates-page";
import QaAuditPortalPage from "./qa-audit-portal-page";

export default function QualityPage() {
  const [location, navigate] = useLocation();
  const [pathname, search] = location.split("?");
  const params = new URLSearchParams(search ?? "");
  const queryTab = params.get("tab");
  const defaultFromPath = pathname.includes("qa-audit") ? "audits" : "checklists";
  const tab = queryTab === "audits" || queryTab === "checklists" ? queryTab : defaultFromPath;

  const setTab = (value: string) => {
    const next = value === "audits" ? "?tab=audits" : "";
    navigate(`/admin/ops/quality${next}`, { replace: true });
  };

  return (
    <Tabs value={tab} onValueChange={setTab}>
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
