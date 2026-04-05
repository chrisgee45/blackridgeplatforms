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
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  CheckCircle2, Clock, Loader2, Scale, History,
} from "lucide-react";

interface AccountV2 {
  id: string;
  code: string;
  name: string;
  type: string;
}

interface UnreconciledLine {
  lineId: string;
  transactionId: string;
  debit: string;
  credit: string;
  lineMemo: string | null;
  occurredAt: string;
  memo: string | null;
  referenceType: string | null;
}

interface ReconciliationRecord {
  id: string;
  accountId: string;
  accountName: string;
  accountCode: string;
  statementDate: string;
  statementBalance: string;
  clearedBalance: string;
  itemCount: number;
  completedAt: string;
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  }).format(value);
}

function formatDate(d: string | Date): string {
  return new Date(d).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export default function ReconciliationTab() {
  const { toast } = useToast();
  const [selectedAccountId, setSelectedAccountId] = useState("");
  const [statementBalance, setStatementBalance] = useState("");
  const [statementDate, setStatementDate] = useState(new Date().toISOString().slice(0, 10));
  const [checkedLineIds, setCheckedLineIds] = useState<Set<string>>(new Set());
  const [showReconciler, setShowReconciler] = useState(false);

  const { data: accounts } = useQuery<AccountV2[]>({
    queryKey: ["/api/accounting/v2/accounts"],
  });

  const reconcilableAccounts = useMemo(
    () => (accounts ?? []).filter((a) => ["asset", "liability"].includes(a.type)),
    [accounts],
  );

  const { data: unreconciledLines, isLoading: linesLoading } = useQuery<UnreconciledLine[]>({
    queryKey: ["/api/accounting/reconciliation/unreconciled", selectedAccountId],
    enabled: !!selectedAccountId && showReconciler,
  });

  const { data: history, isLoading: historyLoading } = useQuery<ReconciliationRecord[]>({
    queryKey: ["/api/accounting/reconciliation/history"],
  });

  const deposits = useMemo(
    () => (unreconciledLines ?? []).filter((l) => Number(l.debit) > 0),
    [unreconciledLines],
  );

  const payments = useMemo(
    () => (unreconciledLines ?? []).filter((l) => Number(l.credit) > 0),
    [unreconciledLines],
  );

  const clearedDeposits = useMemo(
    () => deposits.filter((d) => checkedLineIds.has(d.lineId)).reduce((s, d) => s + Number(d.debit), 0),
    [deposits, checkedLineIds],
  );

  const clearedPayments = useMemo(
    () => payments.filter((p) => checkedLineIds.has(p.lineId)).reduce((s, p) => s + Number(p.credit), 0),
    [payments, checkedLineIds],
  );

  const clearedBalance = clearedDeposits - clearedPayments;
  const stmtBal = parseFloat(statementBalance) || 0;
  const difference = stmtBal - clearedBalance;
  const isBalanced = Math.abs(difference) < 0.005 && statementBalance !== "";

  const completeMutation = useMutation({
    mutationFn: async (data: Record<string, unknown>) => {
      const res = await apiRequest("POST", "/api/accounting/reconciliation/complete", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/accounting/reconciliation"] });
      queryClient.invalidateQueries({ queryKey: ["/api/accounting/reconciliation/unreconciled"] });
      queryClient.invalidateQueries({ queryKey: ["/api/accounting/reconciliation/history"] });
      toast({ title: "Reconciliation completed" });
      setCheckedLineIds(new Set());
      setStatementBalance("");
      setShowReconciler(false);
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  function handleComplete() {
    completeMutation.mutate({
      accountId: selectedAccountId,
      statementDate,
      statementBalance: stmtBal,
      clearedLineIds: Array.from(checkedLineIds),
    });
  }

  function toggleLine(lineId: string) {
    setCheckedLineIds((prev) => {
      const next = new Set(prev);
      if (next.has(lineId)) next.delete(lineId);
      else next.add(lineId);
      return next;
    });
  }

  function toggleAll(lines: UnreconciledLine[], type: "debit" | "credit") {
    const ids = lines.map((l) => l.lineId);
    const allChecked = ids.every((id) => checkedLineIds.has(id));
    setCheckedLineIds((prev) => {
      const next = new Set(prev);
      if (allChecked) {
        ids.forEach((id) => next.delete(id));
      } else {
        ids.forEach((id) => next.add(id));
      }
      return next;
    });
  }

  function startReconciliation() {
    if (!selectedAccountId) {
      toast({ title: "Select an account first", variant: "destructive" });
      return;
    }
    setCheckedLineIds(new Set());
    setShowReconciler(true);
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Scale className="w-5 h-5" />
            Bank Reconciliation
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!showReconciler ? (
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label>Account</Label>
                  <Select value={selectedAccountId} onValueChange={setSelectedAccountId}>
                    <SelectTrigger data-testid="select-recon-account">
                      <SelectValue placeholder="Select account" />
                    </SelectTrigger>
                    <SelectContent>
                      {reconcilableAccounts.map((a) => (
                        <SelectItem key={a.id} value={a.id}>
                          {a.code} - {a.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Statement Date</Label>
                  <Input
                    type="date"
                    value={statementDate}
                    onChange={(e) => setStatementDate(e.target.value)}
                    data-testid="input-statement-date"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Statement Ending Balance ($)</Label>
                  <Input
                    type="number"
                    step="0.01"
                    placeholder="0.00"
                    value={statementBalance}
                    onChange={(e) => setStatementBalance(e.target.value)}
                    data-testid="input-statement-balance"
                  />
                </div>
              </div>
              <Button
                onClick={startReconciliation}
                disabled={!selectedAccountId}
                data-testid="button-start-reconciliation"
              >
                Start Reconciliation
              </Button>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center justify-between flex-wrap gap-3">
                <div className="flex items-center gap-4">
                  <div>
                    <span className="text-sm text-muted-foreground">Account: </span>
                    <span className="font-medium" data-testid="text-recon-account">
                      {reconcilableAccounts.find((a) => a.id === selectedAccountId)?.name}
                    </span>
                  </div>
                  <div>
                    <span className="text-sm text-muted-foreground">Statement Date: </span>
                    <span className="font-medium">{formatDate(statementDate)}</span>
                  </div>
                </div>
                <Button variant="outline" size="sm" onClick={() => setShowReconciler(false)} data-testid="button-cancel-recon">
                  Cancel
                </Button>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="rounded-md border border-border/50 p-3">
                  <p className="text-xs text-muted-foreground">Statement Balance</p>
                  <p className="text-lg font-semibold tabular-nums" data-testid="text-stmt-balance">
                    {formatCurrency(stmtBal)}
                  </p>
                </div>
                <div className="rounded-md border border-border/50 p-3">
                  <p className="text-xs text-muted-foreground">Cleared Balance</p>
                  <p className="text-lg font-semibold tabular-nums" data-testid="text-cleared-balance">
                    {formatCurrency(clearedBalance)}
                  </p>
                </div>
                <div className="rounded-md border border-border/50 p-3">
                  <p className="text-xs text-muted-foreground">Statement Ending Balance</p>
                  <Input
                    type="number"
                    step="0.01"
                    value={statementBalance}
                    onChange={(e) => setStatementBalance(e.target.value)}
                    className="mt-1 h-8"
                    data-testid="input-stmt-balance-inline"
                  />
                </div>
                <div className={`rounded-md border p-3 ${isBalanced ? "border-emerald-500 bg-emerald-500/5" : "border-amber-500 bg-amber-500/5"}`}>
                  <p className="text-xs text-muted-foreground">Difference</p>
                  <p className={`text-lg font-bold tabular-nums ${isBalanced ? "text-emerald-500" : "text-amber-600"}`} data-testid="text-difference">
                    {formatCurrency(difference)}
                  </p>
                </div>
              </div>

              {linesLoading ? (
                <div className="space-y-2">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <Skeleton key={i} className="h-10 w-full" />
                  ))}
                </div>
              ) : (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <h3 className="text-sm font-semibold flex items-center gap-1.5">
                        <Badge variant="outline" className="bg-emerald-500/10 text-emerald-600 border-emerald-500/30 text-[10px]">
                          {deposits.length}
                        </Badge>
                        Deposits (Debits)
                      </h3>
                      <Button variant="ghost" size="sm" className="text-xs h-6" onClick={() => toggleAll(deposits, "debit")} data-testid="button-toggle-all-deposits">
                        {deposits.every((d) => checkedLineIds.has(d.lineId)) ? "Uncheck All" : "Check All"}
                      </Button>
                    </div>
                    <div className="rounded-md border border-border/50 max-h-[400px] overflow-y-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="w-8" />
                            <TableHead>Date</TableHead>
                            <TableHead>Description</TableHead>
                            <TableHead className="text-right">Amount</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {deposits.length === 0 ? (
                            <TableRow>
                              <TableCell colSpan={4} className="text-center text-muted-foreground py-8 text-sm">
                                No unreconciled deposits
                              </TableCell>
                            </TableRow>
                          ) : (
                            deposits.map((line) => (
                              <TableRow
                                key={line.lineId}
                                className={checkedLineIds.has(line.lineId) ? "bg-emerald-500/5" : ""}
                                data-testid={`row-deposit-${line.lineId}`}
                              >
                                <TableCell>
                                  <Checkbox
                                    checked={checkedLineIds.has(line.lineId)}
                                    onCheckedChange={() => toggleLine(line.lineId)}
                                    data-testid={`check-deposit-${line.lineId}`}
                                  />
                                </TableCell>
                                <TableCell className="text-xs tabular-nums whitespace-nowrap">
                                  {formatDate(line.occurredAt)}
                                </TableCell>
                                <TableCell className="text-sm max-w-[180px] truncate" title={line.lineMemo || line.memo || ""}>
                                  {line.lineMemo || line.memo || line.referenceType || "—"}
                                </TableCell>
                                <TableCell className="text-right tabular-nums text-sm font-medium text-emerald-600">
                                  {formatCurrency(Number(line.debit))}
                                </TableCell>
                              </TableRow>
                            ))
                          )}
                        </TableBody>
                      </Table>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1 text-right tabular-nums" data-testid="text-cleared-deposits">
                      Cleared: {formatCurrency(clearedDeposits)}
                    </p>
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <h3 className="text-sm font-semibold flex items-center gap-1.5">
                        <Badge variant="outline" className="bg-red-500/10 text-red-600 border-red-500/30 text-[10px]">
                          {payments.length}
                        </Badge>
                        Payments (Credits)
                      </h3>
                      <Button variant="ghost" size="sm" className="text-xs h-6" onClick={() => toggleAll(payments, "credit")} data-testid="button-toggle-all-payments">
                        {payments.every((p) => checkedLineIds.has(p.lineId)) ? "Uncheck All" : "Check All"}
                      </Button>
                    </div>
                    <div className="rounded-md border border-border/50 max-h-[400px] overflow-y-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="w-8" />
                            <TableHead>Date</TableHead>
                            <TableHead>Description</TableHead>
                            <TableHead className="text-right">Amount</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {payments.length === 0 ? (
                            <TableRow>
                              <TableCell colSpan={4} className="text-center text-muted-foreground py-8 text-sm">
                                No unreconciled payments
                              </TableCell>
                            </TableRow>
                          ) : (
                            payments.map((line) => (
                              <TableRow
                                key={line.lineId}
                                className={checkedLineIds.has(line.lineId) ? "bg-red-500/5" : ""}
                                data-testid={`row-payment-${line.lineId}`}
                              >
                                <TableCell>
                                  <Checkbox
                                    checked={checkedLineIds.has(line.lineId)}
                                    onCheckedChange={() => toggleLine(line.lineId)}
                                    data-testid={`check-payment-${line.lineId}`}
                                  />
                                </TableCell>
                                <TableCell className="text-xs tabular-nums whitespace-nowrap">
                                  {formatDate(line.occurredAt)}
                                </TableCell>
                                <TableCell className="text-sm max-w-[180px] truncate" title={line.lineMemo || line.memo || ""}>
                                  {line.lineMemo || line.memo || line.referenceType || "—"}
                                </TableCell>
                                <TableCell className="text-right tabular-nums text-sm font-medium text-red-600">
                                  {formatCurrency(Number(line.credit))}
                                </TableCell>
                              </TableRow>
                            ))
                          )}
                        </TableBody>
                      </Table>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1 text-right tabular-nums" data-testid="text-cleared-payments">
                      Cleared: {formatCurrency(clearedPayments)}
                    </p>
                  </div>
                </div>
              )}

              <div className="flex justify-end pt-2">
                <Button
                  onClick={handleComplete}
                  disabled={!isBalanced || completeMutation.isPending || checkedLineIds.size === 0}
                  className={isBalanced ? "bg-emerald-600 hover:bg-emerald-700" : ""}
                  data-testid="button-complete-reconciliation"
                >
                  {completeMutation.isPending && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}
                  {isBalanced ? (
                    <>
                      <CheckCircle2 className="w-4 h-4 mr-1" />
                      Complete Reconciliation ({checkedLineIds.size} items)
                    </>
                  ) : (
                    `Difference: ${formatCurrency(difference)}`
                  )}
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <History className="w-5 h-5" />
            Reconciliation History
          </CardTitle>
        </CardHeader>
        <CardContent>
          {historyLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : !history || history.length === 0 ? (
            <div className="flex flex-col items-center py-12">
              <Clock className="w-10 h-10 text-muted-foreground/30 mb-3" />
              <p className="text-muted-foreground text-sm" data-testid="text-no-history">
                No reconciliations completed yet
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date Completed</TableHead>
                  <TableHead>Account</TableHead>
                  <TableHead>Statement Date</TableHead>
                  <TableHead className="text-right">Statement Balance</TableHead>
                  <TableHead className="text-right">Cleared Balance</TableHead>
                  <TableHead className="text-right">Items</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {history.map((rec) => (
                  <TableRow key={rec.id} data-testid={`row-recon-history-${rec.id}`}>
                    <TableCell className="text-sm tabular-nums">
                      {formatDate(rec.completedAt)}
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary" className="text-xs">
                        {rec.accountCode} - {rec.accountName}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm tabular-nums">
                      {formatDate(rec.statementDate)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-sm font-medium">
                      {formatCurrency(Number(rec.statementBalance))}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-sm font-medium">
                      {formatCurrency(Number(rec.clearedBalance))}
                    </TableCell>
                    <TableCell className="text-right text-sm text-muted-foreground">
                      {rec.itemCount}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
