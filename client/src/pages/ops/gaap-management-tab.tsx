import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  Lock, Unlock, Calendar, CheckCircle, AlertTriangle,
  Shield, BookOpen, Users, Crown, UserCog,
} from "lucide-react";
import { HelpTooltip, HELP_CONTENT } from "@/components/help-tooltip";
import type { FiscalPeriod, AdminUser } from "@shared/schema";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export default function GaapManagementTab() {
  const { toast } = useToast();
  const now = new Date();
  const [selectedYear, setSelectedYear] = useState(now.getFullYear());
  const [yearCloseConfirmOpen, setYearCloseConfirmOpen] = useState(false);

  const { data: authUser } = useQuery<{ role: string }>({
    queryKey: ["/api/auth/user"],
  });
  const isAdminRole = authUser?.role === "admin";

  const { data: periods, isLoading: periodsLoading } = useQuery<FiscalPeriod[]>({
    queryKey: ["/api/ops/fiscal-periods", `?year=${selectedYear}`],
  });

  const { data: users } = useQuery<AdminUser[]>({
    queryKey: ["/api/ops/admin-users"],
    enabled: isAdminRole,
  });

  const ensureYearMutation = useMutation({
    mutationFn: async (year: number) => {
      const res = await apiRequest("POST", "/api/ops/fiscal-periods/ensure-year", { year });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ops/fiscal-periods"] });
    },
  });

  const closePeriodMutation = useMutation({
    mutationFn: async ({ year, month }: { year: number; month: number }) => {
      const res = await apiRequest("POST", "/api/ops/fiscal-periods/close", { year, month });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ops/fiscal-periods"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ops/audit-logs"] });
      toast({ title: "Period closed", description: "The accounting period has been locked." });
    },
    onError: (e: any) => {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    },
  });

  const reopenPeriodMutation = useMutation({
    mutationFn: async ({ year, month }: { year: number; month: number }) => {
      const res = await apiRequest("POST", "/api/ops/fiscal-periods/reopen", { year, month });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ops/fiscal-periods"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ops/audit-logs"] });
      toast({ title: "Period reopened" });
    },
    onError: (e: any) => {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    },
  });

  const yearCloseMutation = useMutation({
    mutationFn: async (year: number) => {
      const res = await apiRequest("POST", "/api/ops/year-end-close", { year });
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/ops/fiscal-periods"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ops/audit-logs"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ops/journal-entries"] });
      setYearCloseConfirmOpen(false);
      toast({ title: "Year closed", description: `Year-end closing entry created successfully.` });
    },
    onError: (e: any) => {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    },
  });

  const updateRoleMutation = useMutation({
    mutationFn: async ({ userId, role }: { userId: string; role: string }) => {
      const res = await apiRequest("PATCH", `/api/ops/admin-users/${userId}/role`, { role });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ops/admin-users"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ops/audit-logs"] });
      toast({ title: "Role updated" });
    },
    onError: (e: any) => {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    },
  });

  const periodMap = useMemo(() => {
    const map = new Map<number, FiscalPeriod>();
    for (const p of periods ?? []) map.set(p.month, p);
    return map;
  }, [periods]);

  const allMonthsClosed = useMemo(() => {
    if (!periods || periods.length < 12) return false;
    return periods.every(p => p.status === "closed");
  }, [periods]);

  const years = [];
  for (let y = now.getFullYear(); y >= now.getFullYear() - 5; y--) years.push(y);

  return (
    <div className="space-y-6" data-testid="gaap-management-tab">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Calendar className="w-4 h-4" />
              Fiscal Periods
              <HelpTooltip {...HELP_CONTENT.fiscalPeriod} />
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-3 mb-4">
              <Select value={String(selectedYear)} onValueChange={(v) => setSelectedYear(Number(v))}>
                <SelectTrigger className="w-28" data-testid="select-fiscal-year">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {years.map((y) => (
                    <SelectItem key={y} value={String(y)}>{y}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                variant="outline"
                size="sm"
                onClick={() => ensureYearMutation.mutate(selectedYear)}
                disabled={ensureYearMutation.isPending}
                data-testid="button-init-year"
              >
                Initialize Year
              </Button>
            </div>

            {periodsLoading ? (
              <Skeleton className="h-48 w-full" />
            ) : (
              <div className="grid grid-cols-4 gap-2">
                {MONTHS.map((monthName, i) => {
                  const month = i + 1;
                  const period = periodMap.get(month);
                  const isClosed = period?.status === "closed";
                  return (
                    <div
                      key={month}
                      className={`rounded-lg border p-3 text-center ${
                        isClosed
                          ? "bg-green-50 border-green-200"
                          : period
                          ? "bg-white border-border"
                          : "bg-muted/30 border-dashed"
                      }`}
                      data-testid={`period-${month}`}
                    >
                      <p className="font-medium text-sm">{monthName}</p>
                      {period ? (
                        <>
                          <Badge
                            variant={isClosed ? "default" : "secondary"}
                            className={`text-xs mt-1 ${isClosed ? "bg-green-600" : ""}`}
                          >
                            {isClosed ? (
                              <><Lock className="w-3 h-3 mr-0.5" /> Closed</>
                            ) : (
                              "Open"
                            )}
                          </Badge>
                          {isAdminRole && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="w-full mt-2 h-7 text-xs"
                              onClick={() =>
                                isClosed
                                  ? reopenPeriodMutation.mutate({ year: selectedYear, month })
                                  : closePeriodMutation.mutate({ year: selectedYear, month })
                              }
                              disabled={closePeriodMutation.isPending || reopenPeriodMutation.isPending}
                              data-testid={`button-toggle-period-${month}`}
                            >
                              {isClosed ? (
                                <><Unlock className="w-3 h-3 mr-0.5" /> Reopen</>
                              ) : (
                                <><Lock className="w-3 h-3 mr-0.5" /> Close</>
                              )}
                            </Button>
                          )}
                          {isClosed && period.closedBy && (
                            <p className="text-[10px] text-muted-foreground mt-1">
                              by {period.closedBy}
                            </p>
                          )}
                        </>
                      ) : (
                        <p className="text-xs text-muted-foreground mt-1">Not initialized</p>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {isAdminRole && (
              <div className="mt-4 pt-4 border-t">
                <Dialog open={yearCloseConfirmOpen} onOpenChange={setYearCloseConfirmOpen}>
                  <DialogTrigger asChild>
                    <Button
                      variant="default"
                      className="w-full"
                      disabled={!allMonthsClosed}
                      data-testid="button-year-end-close"
                    >
                      <BookOpen className="w-4 h-4 mr-2" />
                      Close Year {selectedYear}
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle className="flex items-center gap-2">
                        <AlertTriangle className="w-5 h-5 text-yellow-500" />
                        Confirm Year-End Close
                      </DialogTitle>
                    </DialogHeader>
                    <div className="space-y-3 text-sm">
                      <p>This will create a year-end closing journal entry for <strong>{selectedYear}</strong> that:</p>
                      <ul className="list-disc ml-5 space-y-1">
                        <li>Debits all revenue accounts to zero</li>
                        <li>Credits all expense accounts to zero</li>
                        <li>Posts the net income/loss to <strong>Retained Earnings (3900)</strong></li>
                      </ul>
                      <p className="text-yellow-600 font-medium">This action cannot be easily undone.</p>
                      <Button
                        className="w-full"
                        onClick={() => yearCloseMutation.mutate(selectedYear)}
                        disabled={yearCloseMutation.isPending}
                        data-testid="button-confirm-year-close"
                      >
                        {yearCloseMutation.isPending ? "Processing..." : `Close ${selectedYear}`}
                      </Button>
                    </div>
                  </DialogContent>
                </Dialog>
                {!allMonthsClosed && periods && periods.length > 0 && (
                  <p className="text-xs text-muted-foreground mt-2 text-center">
                    All 12 monthly periods must be closed before year-end close
                  </p>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Users className="w-4 h-4" />
              User Roles & Access
              <HelpTooltip {...HELP_CONTENT.userRoles} />
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3 mb-4">
              <div className="flex items-start gap-3 p-3 rounded-lg bg-blue-50 border border-blue-100">
                <Crown className="w-4 h-4 text-blue-600 mt-0.5 shrink-0" />
                <div className="text-sm">
                  <p className="font-medium text-blue-800">Admin</p>
                  <p className="text-blue-600 text-xs">Full access: close periods, void entries, manage users, year-end close</p>
                </div>
              </div>
              <div className="flex items-start gap-3 p-3 rounded-lg bg-gray-50 border border-gray-100">
                <UserCog className="w-4 h-4 text-gray-600 mt-0.5 shrink-0" />
                <div className="text-sm">
                  <p className="font-medium text-gray-800">Bookkeeper</p>
                  <p className="text-gray-600 text-xs">Can create/edit entries and expenses. Cannot close periods, void entries, or manage users</p>
                </div>
              </div>
            </div>

            {isAdminRole && users ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Username</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Last Login</TableHead>
                    <TableHead className="w-32" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {users.map((user) => (
                    <TableRow key={user.id} data-testid={`row-user-${user.id}`}>
                      <TableCell className="font-medium">{user.username}</TableCell>
                      <TableCell>
                        <Badge variant={user.role === "admin" ? "default" : "secondary"} className="text-xs">
                          {user.role === "admin" ? (
                            <><Crown className="w-3 h-3 mr-0.5" /> Admin</>
                          ) : (
                            <><UserCog className="w-3 h-3 mr-0.5" /> Bookkeeper</>
                          )}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {user.lastLoginAt
                          ? new Date(user.lastLoginAt).toLocaleDateString()
                          : "Never"}
                      </TableCell>
                      <TableCell>
                        <Select
                          value={user.role ?? "admin"}
                          onValueChange={(role) =>
                            updateRoleMutation.mutate({ userId: user.id, role })
                          }
                        >
                          <SelectTrigger className="h-8 text-xs" data-testid={`select-role-${user.id}`}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="admin">Admin</SelectItem>
                            <SelectItem value="bookkeeper">Bookkeeper</SelectItem>
                          </SelectContent>
                        </Select>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : !isAdminRole ? (
              <p className="text-sm text-muted-foreground text-center py-4">
                Admin role required to manage users
              </p>
            ) : null}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Shield className="w-4 h-4" />
            GAAP Compliance Status
            <HelpTooltip {...HELP_CONTENT.complianceStatus} />
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            {[
              { label: "Period Locking", icon: Lock, active: true },
              { label: "Immutable Audit Trail", icon: Shield, active: true },
              { label: "Year-End Closing", icon: BookOpen, active: true },
              { label: "Adjusting Entries", icon: Calendar, active: true },
              { label: "Role-Based Access", icon: Users, active: true },
              { label: "Reconciliation Lock", icon: CheckCircle, active: true },
            ].map((item, i) => (
              <div
                key={i}
                className="flex items-center gap-2 p-3 rounded-lg bg-green-50 border border-green-200"
              >
                <item.icon className="w-4 h-4 text-green-600" />
                <div>
                  <p className="text-xs font-medium text-green-800">{item.label}</p>
                  <p className="text-[10px] text-green-600">Active</p>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
