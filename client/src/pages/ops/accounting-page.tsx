import { useState, useEffect } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import FinancialsPage from "./financials-page";
import ExpensesPage from "./expenses-page";
import TaxCenterPage from "./tax-center-page";

type TabValue = "financials" | "expenses" | "tax";

function initialTab(): TabValue {
  if (typeof window === "undefined") return "financials";
  const search = new URLSearchParams(window.location.search);
  const q = search.get("tab");
  if (q === "expenses" || q === "tax" || q === "financials") return q;
  const path = window.location.pathname;
  if (path.includes("/expenses")) return "expenses";
  if (path.includes("/tax")) return "tax";
  return "financials";
}

export default function AccountingPage() {
  const [tab, setTab] = useState<TabValue>(initialTab);

  useEffect(() => {
    const next = tab === "financials" ? "" : `?tab=${tab}`;
    const url = `/admin/ops/accounting${next}`;
    if (window.location.pathname + window.location.search !== url) {
      window.history.replaceState(null, "", url);
    }
  }, [tab]);

  return (
    <Tabs value={tab} onValueChange={(v) => setTab(v as TabValue)}>
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
