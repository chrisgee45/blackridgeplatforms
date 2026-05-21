import { useLocation } from "wouter";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import FinancialsPage from "./financials-page";
import ExpensesPage from "./expenses-page";
import TaxCenterPage from "./tax-center-page";

type TabValue = "financials" | "expenses" | "tax";

export default function AccountingPage() {
  const [location, navigate] = useLocation();
  const [pathname, search] = location.split("?");
  const params = new URLSearchParams(search ?? "");
  const queryTab = params.get("tab");

  const defaultFromPath: TabValue =
    pathname.includes("/expenses") ? "expenses" :
    pathname.includes("/tax") ? "tax" :
    "financials";

  const tab: TabValue =
    queryTab === "expenses" || queryTab === "tax" || queryTab === "financials"
      ? queryTab
      : defaultFromPath;

  const setTab = (value: string) => {
    const next = value === "financials" ? "" : `?tab=${value}`;
    navigate(`/admin/ops/accounting${next}`, { replace: true });
  };

  return (
    <Tabs value={tab} onValueChange={setTab}>
      <div className="px-6 pt-6">
        <TabsList>
          <TabsTrigger value="financials" data-testid="tab-accounting-financials">Financials</TabsTrigger>
          <TabsTrigger value="expenses" data-testid="tab-accounting-expenses">Expenses</TabsTrigger>
          <TabsTrigger value="tax" data-testid="tab-accounting-tax">Tax Center</TabsTrigger>
        </TabsList>
      </div>
      <TabsContent value="financials">
        <FinancialsPage />
      </TabsContent>
      <TabsContent value="expenses">
        <ExpensesPage />
      </TabsContent>
      <TabsContent value="tax">
        <TaxCenterPage />
      </TabsContent>
    </Tabs>
  );
}
