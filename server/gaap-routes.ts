import { Router, Request, Response } from "express";
import {
  getFiscalPeriods, closeFiscalPeriod, reopenFiscalPeriod,
  getAuditLogs, voidJournalEntry, voidExpense,
  performYearEndClose, getAdminUsers, updateAdminRole,
  isAdmin, createAuditLog, getOrCreateFiscalPeriod,
} from "./gaap-compliance";

export function registerGaapRoutes(app: Router, isAuthenticated: any) {
  function requireAdmin(req: Request, res: Response, next: any) {
    const role = (req.session as any)?.adminRole || ((req.session as any)?.isAdmin ? "admin" : null);
    if (!isAdmin(role)) {
      return res.status(403).json({ message: "Admin role required for this action" });
    }
    next();
  }

  app.get("/api/ops/fiscal-periods", isAuthenticated, async (req, res) => {
    try {
      const year = req.query.year ? Number(req.query.year) : undefined;
      const periods = await getFiscalPeriods(year);
      res.json(periods);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/ops/fiscal-periods/ensure-year", isAuthenticated, async (req, res) => {
    try {
      const { year } = req.body;
      if (!year) return res.status(400).json({ message: "Year required" });
      const periods = [];
      for (let m = 1; m <= 12; m++) {
        periods.push(await getOrCreateFiscalPeriod(year, m));
      }
      res.json(periods);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/ops/fiscal-periods/close", isAuthenticated, requireAdmin, async (req, res) => {
    try {
      const { year, month } = req.body;
      if (!year || !month) return res.status(400).json({ message: "Year and month required" });
      const username = (req.session as any)?.adminUsername || "admin";
      const period = await closeFiscalPeriod(year, month, username);
      res.json(period);
    } catch (e: any) {
      res.status(400).json({ message: e.message });
    }
  });

  app.post("/api/ops/fiscal-periods/reopen", isAuthenticated, requireAdmin, async (req, res) => {
    try {
      const { year, month } = req.body;
      if (!year || !month) return res.status(400).json({ message: "Year and month required" });
      const username = (req.session as any)?.adminUsername || "admin";
      const period = await reopenFiscalPeriod(year, month, username);
      res.json(period);
    } catch (e: any) {
      res.status(400).json({ message: e.message });
    }
  });

  app.post("/api/ops/journal-entries/:id/void", isAuthenticated, requireAdmin, async (req, res) => {
    try {
      const username = (req.session as any)?.adminUsername || "admin";
      await voidJournalEntry(req.params.id, username);
      res.json({ success: true });
    } catch (e: any) {
      res.status(400).json({ message: e.message });
    }
  });

  app.post("/api/ops/transactions/:id/void", isAuthenticated, requireAdmin, async (req, res) => {
    try {
      const { voidV2Transaction } = await import("./gaap-compliance");
      const username = (req.session as any)?.adminUsername || "admin";
      await voidV2Transaction(req.params.id, username);
      res.json({ success: true });
    } catch (e: any) {
      res.status(400).json({ message: e.message });
    }
  });

  app.post("/api/ops/expenses/:id/void", isAuthenticated, requireAdmin, async (req, res) => {
    try {
      const username = (req.session as any)?.adminUsername || "admin";
      await voidExpense(req.params.id, username);
      res.json({ success: true });
    } catch (e: any) {
      res.status(400).json({ message: e.message });
    }
  });

  app.post("/api/ops/year-end-close", isAuthenticated, requireAdmin, async (req, res) => {
    try {
      const { year } = req.body;
      if (!year) return res.status(400).json({ message: "Year required" });
      const username = (req.session as any)?.adminUsername || "admin";
      const result = await performYearEndClose(year, username);
      res.json(result);
    } catch (e: any) {
      res.status(400).json({ message: e.message });
    }
  });

  app.get("/api/ops/audit-logs", isAuthenticated, async (req, res) => {
    try {
      const filters: any = {};
      if (req.query.startDate) filters.startDate = new Date(req.query.startDate as string);
      if (req.query.endDate) filters.endDate = new Date(req.query.endDate as string);
      if (req.query.recordType) filters.recordType = req.query.recordType;
      if (req.query.action) filters.action = req.query.action;
      if (req.query.performedBy) filters.performedBy = req.query.performedBy;
      if (req.query.limit) filters.limit = Number(req.query.limit);
      if (req.query.offset) filters.offset = Number(req.query.offset);
      const result = await getAuditLogs(filters);
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/ops/admin-users", isAuthenticated, requireAdmin, async (req, res) => {
    try {
      const users = await getAdminUsers();
      res.json(users);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.patch("/api/ops/admin-users/:id/role", isAuthenticated, requireAdmin, async (req, res) => {
    try {
      const { role } = req.body;
      if (!role || !["admin", "bookkeeper"].includes(role)) {
        return res.status(400).json({ message: "Valid role required (admin or bookkeeper)" });
      }
      const username = (req.session as any)?.adminUsername || "admin";
      const updated = await updateAdminRole(req.params.id, role, username);
      res.json(updated);
    } catch (e: any) {
      res.status(400).json({ message: e.message });
    }
  });

  app.post("/api/ops/journal-entries/adjusting", isAuthenticated, async (req, res) => {
    try {
      const { date, memo, lines, periodYear, periodMonth } = req.body;
      if (!date || !lines || !Array.isArray(lines) || lines.length < 2) {
        return res.status(400).json({ message: "Date and at least 2 lines required" });
      }
      if (!periodYear || !periodMonth) {
        return res.status(400).json({ message: "Period year and month required for adjusting entries" });
      }

      const { assertPeriodOpen } = await import("./gaap-compliance");
      await assertPeriodOpen(new Date(date));

      const { db } = await import("./db");
      const { journalEntries, journalLines } = await import("@shared/schema");

      const totalDebits = lines.reduce((s: number, l: any) => s + Number(l.debit || 0), 0);
      const totalCredits = lines.reduce((s: number, l: any) => s + Number(l.credit || 0), 0);
      if (Math.abs(totalDebits - totalCredits) > 0.005) {
        return res.status(400).json({ message: "Adjusting entry must balance: debits must equal credits" });
      }

      const username = (req.session as any)?.adminUsername || "admin";
      const [entry] = await db.insert(journalEntries).values({
        date: new Date(date),
        memo: memo || `Adjusting entry for ${periodMonth}/${periodYear}`,
        sourceType: "adjusting",
        sourceId: `adj_${periodYear}_${periodMonth}`,
        createdBy: username,
      }).returning();

      for (const line of lines) {
        await db.insert(journalLines).values({
          journalEntryId: entry.id,
          accountId: line.accountId,
          debit: String(line.debit || 0),
          credit: String(line.credit || 0),
          memo: line.memo || "",
        });
      }

      await createAuditLog({
        action: "create",
        recordType: "adjusting_entry",
        recordId: entry.id,
        amount: totalDebits.toFixed(2),
        description: `Adjusting entry for ${periodMonth}/${periodYear}: ${memo || ""}`,
        performedBy: username,
      });

      res.json(entry);
    } catch (e: any) {
      res.status(400).json({ message: e.message });
    }
  });

  app.get("/api/ops/journal-entries/adjusting", isAuthenticated, async (req, res) => {
    try {
      const { db } = await import("./db");
      const { journalEntries, journalLines, accounts } = await import("@shared/schema");
      const { eq, and, gte, lte } = await import("drizzle-orm");

      const conditions: any[] = [eq(journalEntries.sourceType, "adjusting"), eq(journalEntries.isVoid, false)];
      if (req.query.year && req.query.month) {
        const year = Number(req.query.year);
        const month = Number(req.query.month);
        conditions.push(eq(journalEntries.sourceId, `adj_${year}_${month}`));
      }

      const entries = await db.select().from(journalEntries)
        .where(and(...conditions))
        .orderBy(journalEntries.date);

      const result = [];
      for (const entry of entries) {
        const lines = await db.select({
          id: journalLines.id,
          accountId: journalLines.accountId,
          accountName: accounts.name,
          debit: journalLines.debit,
          credit: journalLines.credit,
          memo: journalLines.memo,
        }).from(journalLines)
          .innerJoin(accounts, eq(journalLines.accountId, accounts.id))
          .where(eq(journalLines.journalEntryId, entry.id));
        result.push({ ...entry, lines });
      }

      res.json(result);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });
}
