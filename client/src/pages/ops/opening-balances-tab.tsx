import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  AlertCircle, CheckCircle2, Loader2, BookOpen,
} from "lucide-react";

interface V2Account {
  id: string;
  code: string | null;
  name: string;
  type: "asset" | "liability" | "equity" | "revenue" | "expense";
  isSystem: boolean;
}

const TYPE_ORDER: Record<string, number> = { asset: 0, liability: 1, equity: 2, revenue: 3, expense: 4 };
const TYPE_LABELS: Record<string, string> = {
  asset: "Assets",
  liability: "Liabilities",
  equity: "Equity",
  revenue: "Revenue",
  expense: "Expenses",
};

function formatCurrency(v: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(v);
}

export default function OpeningBalancesTab() {
  const { toast } = useToast();
  const [startDate, setStartDate] = useState(new Date().toISOString().slice(0, 10));
  const [balances, setBalances] = useState<Record<string, string>>({});

  const { data: accounts, isLoading: accountsLoading } = useQuery<V2Account[]>({
    queryKey: ["/api/accounting/v2/accounts"],
  });

  const { data: existingCheck, isLoading: checkLoading } = useQuery<{ exists: boolean; entry: any }>({
    queryKey: ["/api/accounting/opening-balances/check"],
  });

  const postMutation = useMutation({
    mutationFn: async (payload: { startDate: string; balances: { accountId: string; amount: string }[] }) => {
      const res = await apiRequest("POST", "/api/accounting/opening-balances", payload);
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/accounting/opening-balances/check"] });
      queryClient.invalidateQueries({ queryKey: ["/api/accounting/v2/accounts"] });
      toast({ title: "Opening balances posted", description: `${data.lineCount} account balances recorded.` });
      setBalances({});
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const relevantAccounts = useMemo(() => {
    if (!accounts) return [];
    return accounts
      .filter(a => ["asset", "liability", "equity"].includes(a.type) && a.code !== "3000")
      .sort((a, b) => {
        const typeA = TYPE_ORDER[a.type] ?? 99;
        const typeB = TYPE_ORDER[b.type] ?? 99;
        if (typeA !== typeB) return typeA - typeB;
        return (a.code ?? "").localeCompare(b.code ?? "");
      });
  }, [accounts]);

  const grouped = useMemo(() => {
    const groups: Record<string, V2Account[]> = {};
    for (const a of relevantAccounts) {
      if (!groups[a.type]) groups[a.type] = [];
      groups[a.type].push(a);
    }
    return groups;
  }, [relevantAccounts]);

  const summary = useMemo(() => {
    let totalAssets = 0;
    let totalLiabilities = 0;
    let totalEquity = 0;

    for (const a of relevantAccounts) {
      const val = parseFloat(balances[a.id] || "0") || 0;
      if (a.type === "asset") totalAssets += val;
      else if (a.type === "liability") totalLiabilities += val;
      else if (a.type === "equity") totalEquity += val;
    }

    const equityPlug = totalAssets - totalLiabilities - totalEquity;
    return { totalAssets, totalLiabilities, totalEquity, equityPlug };
  }, [relevantAccounts, balances]);

  const hasAnyBalance = Object.values(balances).some(v => parseFloat(v) > 0);

  function handlePost() {
    const entries = relevantAccounts
      .filter(a => {
        const val = parseFloat(balances[a.id] || "0");
        return val > 0;
      })
      .map(a => ({ accountId: a.id, amount: balances[a.id] }));

    if (entries.length === 0) {
      toast({ title: "No balances entered", variant: "destructive" });
      return;
    }

    postMutation.mutate({ startDate, balances: entries });
  }

  if (accountsLoading || checkLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (existingCheck?.exists) {
    const entryDate = existingCheck.entry?.occurredAt
      ? new Date(existingCheck.entry.occurredAt).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })
      : "a previous date";

    return (
      <Card>
        <CardContent className="py-10 text-center space-y-3">
          <CheckCircle2 className="w-12 h-12 text-emerald-500 mx-auto" />
          <h3 className="text-lg font-semibold" data-testid="text-opening-balances-done">Opening Balances Already Posted</h3>
          <p className="text-sm text-muted-foreground max-w-md mx-auto">
            Opening balances were posted as of {entryDate}. To re-enter them, void or delete the existing opening balance journal entry from the General Ledger first.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <BookOpen className="w-5 h-5 text-primary" />
            <div>
              <CardTitle className="text-base" data-testid="text-opening-balances-title">Opening Balances</CardTitle>
              <p className="text-sm text-muted-foreground mt-0.5">
                Enter your starting account balances as of a specific date. This is typically used when migrating from another system like QuickBooks.
              </p>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex items-end gap-4">
            <div className="space-y-1">
              <Label>Start Date</Label>
              <Input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-48"
                data-testid="input-opening-date"
              />
            </div>
            <p className="text-xs text-muted-foreground pb-2">
              Enter the date your accounting starts. All balances will be recorded as of this date.
            </p>
          </div>

          <div className="flex items-start gap-2 p-3 bg-amber-500/5 border border-amber-500/20 rounded-md">
            <AlertCircle className="w-4 h-4 text-amber-500 mt-0.5 shrink-0" />
            <p className="text-xs text-muted-foreground">
              Enter positive amounts for each account. For asset accounts (Cash, A/R), enter your actual balance.
              For liability accounts (A/P, Credit Card), enter what you owe.
              Owner's Equity will be auto-calculated as the balancing amount.
            </p>
          </div>

          <div className="rounded-md border border-border/50 overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-20">Code</TableHead>
                  <TableHead>Account</TableHead>
                  <TableHead className="w-16">Type</TableHead>
                  <TableHead className="w-44 text-right">Balance</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {Object.entries(grouped).map(([type, accts]) => (
                  <GroupedRows
                    key={type}
                    type={type}
                    accounts={accts}
                    balances={balances}
                    setBalances={setBalances}
                  />
                ))}
                <TableRow className="bg-muted/30 font-medium">
                  <TableCell></TableCell>
                  <TableCell className="text-sm">
                    Owner's Equity (3000)
                    <span className="text-xs text-muted-foreground ml-2">— auto-calculated</span>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className="text-[10px]">Equity</Badge>
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-sm font-semibold" data-testid="text-equity-plug">
                    {formatCurrency(summary.equityPlug)}
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>

          <div className="grid grid-cols-4 gap-3">
            <SummaryBox label="Total Assets" value={summary.totalAssets} color="text-emerald-500" testId="stat-total-assets" />
            <SummaryBox label="Total Liabilities" value={summary.totalLiabilities} color="text-red-400" testId="stat-total-liabilities" />
            <SummaryBox label="Other Equity" value={summary.totalEquity} color="text-blue-500" testId="stat-other-equity" />
            <SummaryBox label="Owner's Equity (Plug)" value={summary.equityPlug} color="text-primary" testId="stat-equity-plug" />
          </div>

          <div className="flex items-center gap-2 text-xs text-muted-foreground bg-muted/30 p-3 rounded-md">
            <span className="font-medium">Accounting equation:</span>
            <span>Assets ({formatCurrency(summary.totalAssets)})</span>
            <span>=</span>
            <span>Liabilities ({formatCurrency(summary.totalLiabilities)})</span>
            <span>+</span>
            <span>Equity ({formatCurrency(summary.totalEquity + summary.equityPlug)})</span>
          </div>

          <div className="flex justify-end">
            <Button
              onClick={handlePost}
              disabled={postMutation.isPending || !hasAnyBalance}
              data-testid="button-post-opening-balances"
            >
              {postMutation.isPending && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}
              Post Opening Balances
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function GroupedRows({
  type, accounts, balances, setBalances,
}: {
  type: string;
  accounts: V2Account[];
  balances: Record<string, string>;
  setBalances: React.Dispatch<React.SetStateAction<Record<string, string>>>;
}) {
  return (
    <>
      <TableRow className="bg-muted/20 hover:bg-muted/20">
        <TableCell colSpan={4} className="text-xs font-semibold text-muted-foreground uppercase tracking-wider py-1.5">
          {TYPE_LABELS[type] || type}
        </TableCell>
      </TableRow>
      {accounts.map((a) => (
        <TableRow key={a.id} data-testid={`row-ob-${a.code}`}>
          <TableCell className="text-xs text-muted-foreground tabular-nums">{a.code}</TableCell>
          <TableCell className="text-sm">{a.name}</TableCell>
          <TableCell>
            <Badge variant="outline" className="text-[10px]">{TYPE_LABELS[a.type]?.slice(0, -1) || a.type}</Badge>
          </TableCell>
          <TableCell className="text-right">
            <div className="flex items-center justify-end gap-1">
              <span className="text-xs text-muted-foreground">$</span>
              <Input
                type="number"
                step="0.01"
                min="0"
                placeholder="0.00"
                className="w-32 text-right tabular-nums h-8 text-sm"
                value={balances[a.id] || ""}
                onChange={(e) => setBalances(prev => ({ ...prev, [a.id]: e.target.value }))}
                data-testid={`input-ob-${a.code}`}
              />
            </div>
          </TableCell>
        </TableRow>
      ))}
    </>
  );
}

function SummaryBox({ label, value, color, testId }: { label: string; value: number; color: string; testId: string }) {
  return (
    <div className="border border-border/50 rounded-md p-3 text-center">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`text-sm font-semibold tabular-nums mt-0.5 ${color}`} data-testid={testId}>
        {formatCurrency(value)}
      </p>
    </div>
  );
}
