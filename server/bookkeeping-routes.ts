import type { Express, RequestHandler } from "express";
import { bookkeepingStorage } from "./bookkeeping-storage";
import { insertAccountSchema, insertVendorSchema, insertExpenseSchema, insertBillSchema, reconciliations, reconciliationItems, transactionLinesV2, transactionsV2, accountsV2, paymentLinks, projects, clients, vendors, expenses, bills, billPayments, budgets, accounts } from "@shared/schema";
import { ZodError } from "zod";
import { fromZodError } from "zod-validation-error";
import { db } from "./db";
import { eq, and, notInArray, desc, sql as drizzleSql, inArray } from "drizzle-orm";

function param(req: any, key: string): string {
  const v = req.params?.[key];
  if (Array.isArray(v)) return v[0];
  return String(v ?? "");
}

export function registerBookkeepingRoutes(app: Express, isAuthenticated: RequestHandler) {

  // === Lead Activities ===

  app.get("/api/leads/:id/activities", isAuthenticated, async (req, res) => {
    try {
      const activities = await bookkeepingStorage.getLeadActivities(param(req, "id"));
      res.json(activities);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch activities" });
    }
  });

  app.post("/api/leads/:id/activities", isAuthenticated, async (req, res) => {
    try {
      const activity = await bookkeepingStorage.createLeadActivity({
        leadId: param(req, "id"),
        type: req.body.type || "note",
        description: req.body.description,
        metadata: req.body.metadata || null,
        createdBy: "admin",
      });
      res.status(201).json(activity);
    } catch (error) {
      res.status(500).json({ message: "Failed to create activity" });
    }
  });

  // === Accounts ===

  app.get("/api/ops/accounts", isAuthenticated, async (_req, res) => {
    try {
      const accts = await bookkeepingStorage.getAccounts();
      res.json(accts);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch accounts" });
    }
  });

  app.post("/api/ops/accounts", isAuthenticated, async (req, res) => {
    try {
      const validated = insertAccountSchema.parse(req.body);
      const account = await bookkeepingStorage.createAccount(validated);
      res.status(201).json(account);
    } catch (error) {
      if (error instanceof ZodError) {
        res.status(400).json({ message: fromZodError(error).message });
      } else {
        res.status(500).json({ message: "Failed to create account" });
      }
    }
  });

  app.patch("/api/ops/accounts/:id", isAuthenticated, async (req, res) => {
    try {
      const account = await bookkeepingStorage.updateAccount(param(req, "id"), req.body);
      if (!account) return res.status(404).json({ message: "Account not found" });
      res.json(account);
    } catch (error) {
      res.status(500).json({ message: "Failed to update account" });
    }
  });

  app.get("/api/ops/account-balances", isAuthenticated, async (req, res) => {
    try {
      const startDate = req.query.startDate ? new Date(req.query.startDate as string) : undefined;
      const endDate = req.query.endDate ? new Date(req.query.endDate as string) : undefined;
      const balances = await bookkeepingStorage.getAccountBalances(startDate, endDate);
      res.json(balances);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch account balances" });
    }
  });

  app.get("/api/ops/trial-balance", isAuthenticated, async (req, res) => {
    try {
      const asOfDate = req.query.asOfDate ? new Date(req.query.asOfDate as string) : undefined;
      const trialBalance = await bookkeepingStorage.getTrialBalance(asOfDate);
      res.json(trialBalance);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch trial balance" });
    }
  });

  // === Journal Entries ===

  app.get("/api/ops/journal-entries", isAuthenticated, async (req, res) => {
    try {
      const startDate = req.query.startDate ? new Date(req.query.startDate as string) : undefined;
      const endDate = req.query.endDate ? new Date(req.query.endDate as string) : undefined;
      const entries = await bookkeepingStorage.getJournalEntries(startDate, endDate);
      res.json(entries);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch journal entries" });
    }
  });

  app.get("/api/ops/journal-entries/:id", isAuthenticated, async (req, res) => {
    try {
      const entry = await bookkeepingStorage.getJournalEntry(param(req, "id"));
      if (!entry) return res.status(404).json({ message: "Entry not found" });
      const lines = await bookkeepingStorage.getJournalLines(entry.id);
      res.json({ ...entry, lines });
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch journal entry" });
    }
  });

  app.post("/api/ops/journal-entries", isAuthenticated, async (req, res) => {
    try {
      const { lines, ...entryData } = req.body;
      if (!lines || !Array.isArray(lines) || lines.length < 2) {
        return res.status(400).json({ message: "At least 2 journal lines required" });
      }
      const { assertPeriodOpen, createAuditLog } = await import("./gaap-compliance");
      await assertPeriodOpen(new Date(entryData.date));
      const username = (req.session as any)?.adminUsername || "admin";
      const result = await bookkeepingStorage.createJournalEntryWithLines(
        { ...entryData, date: new Date(entryData.date), createdBy: username },
        lines
      );
      await createAuditLog({
        action: "create",
        recordType: "journal_entry",
        recordId: result.id,
        amount: lines.reduce((s: number, l: any) => s + Number(l.debit || 0), 0).toFixed(2),
        description: `Created journal entry: ${entryData.memo || ""}`,
        performedBy: username,
      });
      res.status(201).json(result);
    } catch (error: any) {
      res.status(400).json({ message: error.message || "Failed to create journal entry" });
    }
  });

  // === Vendors ===

  app.get("/api/ops/vendors", isAuthenticated, async (_req, res) => {
    try {
      const v = await bookkeepingStorage.getVendors();
      res.json(v);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch vendors" });
    }
  });

  app.post("/api/ops/vendors", isAuthenticated, async (req, res) => {
    try {
      const validated = insertVendorSchema.parse(req.body);
      const vendor = await bookkeepingStorage.createVendor(validated);
      res.status(201).json(vendor);
    } catch (error) {
      if (error instanceof ZodError) {
        res.status(400).json({ message: fromZodError(error).message });
      } else {
        res.status(500).json({ message: "Failed to create vendor" });
      }
    }
  });

  app.patch("/api/ops/vendors/:id", isAuthenticated, async (req, res) => {
    try {
      const vendor = await bookkeepingStorage.updateVendor(param(req, "id"), req.body);
      if (!vendor) return res.status(404).json({ message: "Vendor not found" });
      res.json(vendor);
    } catch (error) {
      res.status(500).json({ message: "Failed to update vendor" });
    }
  });

  // === Expenses ===

  app.get("/api/ops/expenses", isAuthenticated, async (req, res) => {
    try {
      const filters: any = {};
      if (req.query.startDate) filters.startDate = new Date(req.query.startDate as string);
      if (req.query.endDate) filters.endDate = new Date(req.query.endDate as string);
      if (req.query.accountId) filters.accountId = req.query.accountId;
      if (req.query.vendorId) filters.vendorId = req.query.vendorId;
      if (req.query.projectId) filters.projectId = req.query.projectId;
      const expenseList = await bookkeepingStorage.getExpenses(filters);
      res.json(expenseList);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch expenses" });
    }
  });

  app.post("/api/ops/expenses", isAuthenticated, async (req, res) => {
    try {
      const { assertPeriodOpen, createAuditLog } = await import("./gaap-compliance");
      const data = { ...req.body, date: new Date(req.body.date), amount: String(req.body.amount) };
      await assertPeriodOpen(data.date);
      const validFrequencies = ["weekly", "monthly", "quarterly", "annually"];
      if (data.isRecurring) {
        if (!data.recurringFrequency || !validFrequencies.includes(data.recurringFrequency)) {
          return res.status(400).json({ message: "Recurring expenses require a valid frequency (weekly, monthly, quarterly, annually)" });
        }
        const dateObj = new Date(data.date);
        data.recurringDayOfMonth = dateObj.getDate();
        const next = new Date(dateObj);
        if (data.recurringFrequency === "monthly") next.setMonth(next.getMonth() + 1);
        else if (data.recurringFrequency === "quarterly") next.setMonth(next.getMonth() + 3);
        else if (data.recurringFrequency === "annually") next.setFullYear(next.getFullYear() + 1);
        else if (data.recurringFrequency === "weekly") next.setDate(next.getDate() + 7);
        data.nextDueDate = next;
      }
      const expense = await bookkeepingStorage.createExpenseWithJournal(data);

      try {
        const { recordExpense, getAccountIdByCode } = await import("./accounting-v2");
        const legacyAccount = await bookkeepingStorage.getAccount(data.accountId);
        let v2ExpenseAccountId: string;
        try {
          v2ExpenseAccountId = await getAccountIdByCode(legacyAccount?.accountNumber || "5090");
        } catch {
          v2ExpenseAccountId = await getAccountIdByCode("5090");
        }
        await recordExpense({
          amount: Number(data.amount),
          expenseAccountId: v2ExpenseAccountId,
          paymentMethod: data.paymentMethod === "credit_card" ? "credit_card" : "cash",
          occurredAt: data.date,
          memo: data.description || "Expense",
          referenceType: "expense",
          referenceId: `expense_${expense.id}`,
        });
      } catch (e) {
        console.error("Auto-post expense to v2 ledger failed:", e);
      }

      res.status(201).json(expense);
    } catch (error: any) {
      res.status(400).json({ message: error.message || "Failed to create expense" });
    }
  });

  app.patch("/api/ops/expenses/:id", isAuthenticated, async (req, res) => {
    try {
      const id = param(req, "id");
      const existing = await bookkeepingStorage.getExpenses({});
      const oldExpense = existing.find((e: any) => e.id === id);
      if (!oldExpense) return res.status(404).json({ message: "Expense not found" });

      const updates: Record<string, any> = {};
      if (req.body.description !== undefined) updates.description = req.body.description;
      if (req.body.amount !== undefined) updates.amount = String(req.body.amount);
      if (req.body.date !== undefined) updates.date = new Date(req.body.date);
      if (req.body.accountId !== undefined) updates.accountId = req.body.accountId;
      if (req.body.vendorId !== undefined) updates.vendorId = req.body.vendorId || null;
      if (req.body.paymentMethod !== undefined) updates.paymentMethod = req.body.paymentMethod;
      if (req.body.projectId !== undefined) updates.projectId = req.body.projectId || null;
      if (req.body.clientId !== undefined) updates.clientId = req.body.clientId || null;
      if (req.body.receiptNotes !== undefined) updates.receiptNotes = req.body.receiptNotes || null;
      if (req.body.isBillable !== undefined) updates.isBillable = req.body.isBillable;
      if (req.body.taxDeductible !== undefined) updates.taxDeductible = req.body.taxDeductible;
      if (req.body.checkNumber !== undefined) updates.checkNumber = req.body.checkNumber || null;
      if (req.body.receiptStorageKey !== undefined) updates.receiptStorageKey = req.body.receiptStorageKey || null;
      if (req.body.receiptFilename !== undefined) updates.receiptFilename = req.body.receiptFilename || null;
      if (req.body.fundingSource !== undefined) updates.fundingSource = req.body.fundingSource;

      const expense = await bookkeepingStorage.updateExpense(id, updates);
      if (!expense) return res.status(404).json({ message: "Expense not found" });

      const amountChanged = updates.amount && updates.amount !== String(oldExpense.amount);
      const accountChanged = updates.accountId && updates.accountId !== oldExpense.accountId;
      const memoChanged = updates.description && updates.description !== oldExpense.description;
      const fundingChanged = updates.fundingSource && updates.fundingSource !== oldExpense.fundingSource;

      if ((amountChanged || accountChanged || memoChanged || fundingChanged) && expense.journalEntryId) {
        try {
          const { journalLines } = await import("@shared/schema");
          const { eq } = await import("drizzle-orm");
          const { db } = await import("./db");

          const lines = await db.select().from(journalLines).where(eq(journalLines.journalEntryId, expense.journalEntryId));
          const newAmount = String(expense.amount);
          const newMemo = expense.description;
          const creditAccount = await bookkeepingStorage.getCreditAccountForFundingSource(expense.fundingSource);

          for (const line of lines) {
            const isDebitLine = Number(line.debit) > 0;
            await db.update(journalLines).set({
              debit: isDebitLine ? newAmount : "0",
              credit: isDebitLine ? "0" : newAmount,
              accountId: isDebitLine ? expense.accountId : creditAccount.id,
              memo: newMemo,
            }).where(eq(journalLines.id, line.id));
          }

          const { journalEntries } = await import("@shared/schema");
          await db.update(journalEntries).set({ memo: newMemo }).where(eq(journalEntries.id, expense.journalEntryId));
        } catch (e) {
          console.error("Failed to update journal entry for expense edit:", e);
        }
      }

      res.json(expense);
    } catch (error: any) {
      res.status(400).json({ message: error.message || "Failed to update expense" });
    }
  });

  app.delete("/api/ops/expenses/:id", isAuthenticated, async (req, res) => {
    try {
      const role = (req.session as any)?.adminRole || ((req.session as any)?.isAdmin ? "admin" : null);
      if (role !== "admin") {
        return res.status(403).json({ message: "Admin role required to void expenses" });
      }
      const { voidExpense } = await import("./gaap-compliance");
      const username = (req.session as any)?.adminUsername || "admin";
      await voidExpense(param(req, "id"), username);
      res.json({ success: true });
    } catch (error: any) {
      res.status(400).json({ message: error.message || "Failed to void expense" });
    }
  });

  // === Bills (AP) ===

  app.get("/api/ops/bills", isAuthenticated, async (req, res) => {
    try {
      const filters: any = {};
      if (req.query.status) filters.status = req.query.status;
      if (req.query.vendorId) filters.vendorId = req.query.vendorId;
      const billList = await bookkeepingStorage.getBills(filters);
      res.json(billList);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch bills" });
    }
  });

  app.get("/api/ops/bills/dashboard/stats", isAuthenticated, async (_req, res) => {
    try {
      const allBills = await bookkeepingStorage.getBills();
      const now = new Date();
      const weekFromNow = new Date(now);
      weekFromNow.setDate(weekFromNow.getDate() + 7);

      const unpaidBills = allBills.filter(b => b.status === "pending" || b.status === "partially_paid" || b.status === "overdue");
      const totalOutstanding = unpaidBills.reduce((s, b) => s + (Number(b.amount) - Number(b.paidAmount)), 0);

      const dueThisWeek = unpaidBills.filter(b => {
        const due = new Date(b.dueDate);
        return due >= now && due <= weekFromNow;
      });
      const dueThisWeekTotal = dueThisWeek.reduce((s, b) => s + (Number(b.amount) - Number(b.paidAmount)), 0);

      const overdueBills = unpaidBills.filter(b => new Date(b.dueDate) < now);
      const overdueTotal = overdueBills.reduce((s, b) => s + (Number(b.amount) - Number(b.paidAmount)), 0);

      res.json({
        totalOutstanding,
        totalOutstandingCount: unpaidBills.length,
        dueThisWeek: dueThisWeekTotal,
        dueThisWeekCount: dueThisWeek.length,
        overdue: overdueTotal,
        overdueCount: overdueBills.length,
      });
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch bills dashboard" });
    }
  });

  app.post("/api/ops/bills", isAuthenticated, async (req, res) => {
    try {
      if (!req.body.vendorId || !req.body.amount || !req.body.dueDate) {
        return res.status(400).json({ message: "vendorId, amount, and dueDate are required" });
      }
      const amt = Number(req.body.amount);
      if (!Number.isFinite(amt) || amt <= 0) {
        return res.status(400).json({ message: "Amount must be a positive number" });
      }
      const data = { ...req.body, dueDate: new Date(req.body.dueDate), amount: String(amt) };
      const bill = await bookkeepingStorage.createBill(data);

      try {
        const { postJournal, getAccountIdByCode } = await import("./accounting-v2");
        const legacyAccount = data.accountId ? await bookkeepingStorage.getAccount(data.accountId) : null;
        let v2ExpAccountId: string;
        try {
          v2ExpAccountId = await getAccountIdByCode(legacyAccount?.accountNumber || "5090");
        } catch {
          v2ExpAccountId = await getAccountIdByCode("5090");
        }
        const apAccountId = await getAccountIdByCode("2000");
        await postJournal({
          occurredAt: data.dueDate,
          memo: data.description || "Bill",
          referenceType: "bill",
          referenceId: `bill_${bill.id}`,
          lines: [
            { accountId: v2ExpAccountId, debit: Number(data.amount), memo: "Bill expense" },
            { accountId: apAccountId, credit: Number(data.amount), memo: "AP liability" },
          ],
        });
      } catch (e) {
        console.error("Auto-post bill to v2 ledger failed:", e);
      }

      res.status(201).json(bill);
    } catch (error: any) {
      res.status(400).json({ message: error.message || "Failed to create bill" });
    }
  });

  app.patch("/api/ops/bills/:id", isAuthenticated, async (req, res) => {
    try {
      const id = param(req, "id");
      const existing = await bookkeepingStorage.getBill(id);
      if (!existing) return res.status(404).json({ message: "Bill not found" });

      const hasPayments = Number(existing.paidAmount) > 0;
      const updates: Record<string, any> = {};
      if (req.body.description !== undefined) updates.description = req.body.description;
      if (req.body.dueDate !== undefined) updates.dueDate = new Date(req.body.dueDate);
      if (req.body.reference !== undefined) updates.reference = req.body.reference;
      if (req.body.accountId !== undefined && !hasPayments) updates.accountId = req.body.accountId;
      if (req.body.amount !== undefined && !hasPayments) {
        const amt = Number(req.body.amount);
        if (!Number.isFinite(amt) || amt <= 0) return res.status(400).json({ message: "Amount must be positive" });
        updates.amount = String(amt);
      }
      if (req.body.status === "void" && !hasPayments) updates.status = "void";

      const bill = await bookkeepingStorage.updateBill(id, updates);
      if (!bill) return res.status(404).json({ message: "Bill not found" });
      res.json(bill);
    } catch (error) {
      res.status(500).json({ message: "Failed to update bill" });
    }
  });

  app.delete("/api/ops/bills/:id", isAuthenticated, async (req, res) => {
    try {
      const ok = await bookkeepingStorage.deleteBill(param(req, "id"));
      if (!ok) return res.status(404).json({ message: "Bill not found" });
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ message: "Failed to delete bill" });
    }
  });

  app.get("/api/ops/bills/:id/payments", isAuthenticated, async (req, res) => {
    try {
      const payments = await bookkeepingStorage.getBillPayments(param(req, "id"));
      res.json(payments);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch bill payments" });
    }
  });

  app.post("/api/ops/bills/:id/pay", isAuthenticated, async (req, res) => {
    try {
      const billId = param(req, "id");
      const amount = Number(req.body.amount);
      const paymentMethod = req.body.paymentMethod || "cash";
      const memo = req.body.memo;

      if (!amount || amount <= 0) return res.status(400).json({ message: "Payment amount required" });

      const result = await bookkeepingStorage.recordBillPayment(billId, amount, paymentMethod, memo);

      try {
        const { postJournal, getAccountIdByCode } = await import("./accounting-v2");
        const cashAccountId = await getAccountIdByCode("1000");
        const apAccountId = await getAccountIdByCode("2000");
        await postJournal({
          occurredAt: new Date(),
          memo: memo || `Bill payment: ${result.bill.description || "Bill"}`,
          referenceType: "bill_payment",
          referenceId: `bill_payment_${result.payment.id}`,
          lines: [
            { accountId: apAccountId, debit: amount, memo: "AP payment" },
            { accountId: cashAccountId, credit: amount, memo: "Cash out" },
          ],
        });
      } catch (e) {
        console.error("Auto-post bill payment to v2 ledger failed:", e);
      }

      res.json(result);
    } catch (error: any) {
      res.status(400).json({ message: error.message || "Failed to record payment" });
    }
  });

  app.get("/api/accounting/ap-aging", isAuthenticated, async (_req, res) => {
    try {
      const allBills = await bookkeepingStorage.getBills();
      const unpaidBills = allBills.filter(b => b.status === "pending" || b.status === "partially_paid" || b.status === "overdue");

      const vendorIds = [...new Set(unpaidBills.map(b => b.vendorId).filter(Boolean))];
      const vendorMap = new Map<string, string>();
      for (const vid of vendorIds) {
        const vendors = await bookkeepingStorage.getVendors();
        for (const v of vendors) vendorMap.set(v.id, v.name);
        break;
      }

      const now = new Date();
      const rows = unpaidBills.map(b => {
        const dueDate = new Date(b.dueDate);
        const balanceDue = Number(b.amount) - Number(b.paidAmount);
        const daysPastDue = Math.max(0, Math.floor((now.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24)));

        let bucket: "current" | "1-30" | "31-60" | "61-90" | "90+" = "current";
        if (daysPastDue > 90) bucket = "90+";
        else if (daysPastDue > 60) bucket = "61-90";
        else if (daysPastDue > 30) bucket = "31-60";
        else if (daysPastDue > 0) bucket = "1-30";

        return {
          id: b.id,
          vendorName: vendorMap.get(b.vendorId) || "Unknown Vendor",
          description: b.description,
          reference: b.reference,
          dueDate: dueDate.toISOString(),
          totalAmount: Number(b.amount),
          amountPaid: Number(b.paidAmount),
          balanceDue,
          daysPastDue,
          bucket,
        };
      });

      rows.sort((a, b) => b.daysPastDue - a.daysPastDue);

      const summary = { current: 0, "1-30": 0, "31-60": 0, "61-90": 0, "90+": 0, total: 0 };
      for (const r of rows) {
        summary[r.bucket] += r.balanceDue;
        summary.total += r.balanceDue;
      }

      res.json({ rows, summary });
    } catch (error) {
      console.error("AP Aging report error:", error);
      res.status(500).json({ message: "Failed to generate AP aging report" });
    }
  });

  app.get("/api/accounting/1099-summary", isAuthenticated, async (req, res) => {
    try {
      const year = Number(req.query.year) || new Date().getFullYear();
      const startDate = new Date(year, 0, 1);
      const endDate = new Date(year, 11, 31, 23, 59, 59);

      const allVendors = await db.select().from(vendors).where(eq(vendors.is1099Contractor, true));
      if (allVendors.length === 0) {
        return res.json({ year, vendors: [], totalPaid: 0, vendorsOver600: 0 });
      }

      const vendorIds = allVendors.map(v => v.id);

      const expenseRows = await db
        .select({
          vendorId: expenses.vendorId,
          amount: expenses.amount,
        })
        .from(expenses)
        .where(
          and(
            inArray(expenses.vendorId, vendorIds),
            drizzleSql`${expenses.date} >= ${startDate}`,
            drizzleSql`${expenses.date} <= ${endDate}`
          )
        );

      const billPaymentRows = await db
        .select({
          vendorId: bills.vendorId,
          amount: billPayments.amount,
        })
        .from(billPayments)
        .innerJoin(bills, eq(billPayments.billId, bills.id))
        .where(
          and(
            inArray(bills.vendorId, vendorIds),
            drizzleSql`${billPayments.paidAt} >= ${startDate}`,
            drizzleSql`${billPayments.paidAt} <= ${endDate}`
          )
        );

      const vendorTotals = new Map<string, number>();
      for (const row of expenseRows) {
        if (row.vendorId) {
          vendorTotals.set(row.vendorId, (vendorTotals.get(row.vendorId) || 0) + Number(row.amount));
        }
      }
      for (const row of billPaymentRows) {
        if (row.vendorId) {
          vendorTotals.set(row.vendorId, (vendorTotals.get(row.vendorId) || 0) + Number(row.amount));
        }
      }

      const result = allVendors.map(v => ({
        id: v.id,
        name: v.name,
        email: v.email,
        address: v.address,
        taxId: v.taxId,
        totalPaid: vendorTotals.get(v.id) || 0,
        over600: (vendorTotals.get(v.id) || 0) >= 600,
      }));

      result.sort((a, b) => b.totalPaid - a.totalPaid);

      const totalPaid = result.reduce((s, r) => s + r.totalPaid, 0);
      const vendorsOver600 = result.filter(r => r.over600).length;

      res.json({ year, vendors: result, totalPaid, vendorsOver600 });
    } catch (error) {
      console.error("1099 summary error:", error);
      res.status(500).json({ message: "Failed to generate 1099 summary" });
    }
  });

  // === AR/AP Aging ===

  app.get("/api/ops/ar-aging", isAuthenticated, async (_req, res) => {
    try {
      const aging = await bookkeepingStorage.getARaging();
      res.json(aging);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch AR aging" });
    }
  });

  app.get("/api/ops/ap-aging", isAuthenticated, async (_req, res) => {
    try {
      const aging = await bookkeepingStorage.getAPaging();
      res.json(aging);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch AP aging" });
    }
  });

  // === Financial Reports ===

  app.get("/api/ops/income-statement", isAuthenticated, async (req, res) => {
    try {
      const startDate = req.query.startDate ? new Date(req.query.startDate as string) : new Date(new Date().getFullYear(), 0, 1);
      const endDate = req.query.endDate ? new Date(req.query.endDate as string) : new Date();

      const { getIncomeStatement: getIncomeStatementV2 } = await import("./accounting-v2");
      const v2Report = await getIncomeStatementV2({ start: startDate, end: endDate });

      const CODE_TO_SCHEDULE_C: Record<string, string> = {
        "8100": "8",
        "9200": "9",
        "8850": "10",
        "8200": "11",
        "9100": "13",
        "8300": "15",
        "8400": "17",
        "8500": "18",
        "9000": "20b",
        "8600": "22",
        "8900": "24a",
        "8950": "24b",
        "8700": "25",
        "9050": "26",
        "9300": "27a",
        "5000": "27a",
        "5010": "27a",
        "5090": "27a",
        "8800": "27a",
        "9150": "27a",
      };

      const expenses = v2Report.expenses.map((e: any) => ({
        ...e,
        balance: Math.abs(e.amount),
        schedule_c_line: CODE_TO_SCHEDULE_C[e.code] || null,
      }));

      const revenue = v2Report.revenue.map((r: any) => ({
        ...r,
        balance: Math.abs(r.amount),
      }));

      res.json({
        revenue,
        expenses,
        totalRevenue: v2Report.totalRevenue,
        totalExpenses: v2Report.totalExpenses,
        netIncome: v2Report.netIncome,
      });
    } catch (error) {
      console.error("Income statement error:", error);
      res.status(500).json({ message: "Failed to generate income statement" });
    }
  });

  app.get("/api/ops/balance-sheet", isAuthenticated, async (req, res) => {
    try {
      const asOfDate = req.query.asOfDate ? new Date(req.query.asOfDate as string) : new Date();
      const report = await bookkeepingStorage.getBalanceSheet(asOfDate);
      res.json(report);
    } catch (error) {
      res.status(500).json({ message: "Failed to generate balance sheet" });
    }
  });

  app.get("/api/ops/cash-flow", isAuthenticated, async (req, res) => {
    try {
      const startDate = req.query.startDate ? new Date(req.query.startDate as string) : new Date(new Date().getFullYear(), 0, 1);
      const endDate = req.query.endDate ? new Date(req.query.endDate as string) : new Date();
      const report = await bookkeepingStorage.getCashFlow(startDate, endDate);
      res.json(report);
    } catch (error) {
      res.status(500).json({ message: "Failed to generate cash flow" });
    }
  });

  // === Tax ===

  app.get("/api/ops/tax-settings", isAuthenticated, async (_req, res) => {
    try {
      const settings = await bookkeepingStorage.getTaxSettings();
      res.json(settings || { federalRate: "22", stateRate: "0", filingType: "sole_prop", selfEmploymentRate: "15.3", qbiDeduction: true });
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch tax settings" });
    }
  });

  app.put("/api/ops/tax-settings", isAuthenticated, async (req, res) => {
    try {
      const settings = await bookkeepingStorage.upsertTaxSettings(req.body);
      res.json(settings);
    } catch (error) {
      res.status(500).json({ message: "Failed to update tax settings" });
    }
  });

  app.get("/api/ops/quarterly-payments/:year", isAuthenticated, async (req, res) => {
    try {
      const payments = await bookkeepingStorage.getQuarterlyPayments(parseInt(param(req, "year")));
      res.json(payments);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch quarterly payments" });
    }
  });

  app.put("/api/ops/quarterly-payments", isAuthenticated, async (req, res) => {
    try {
      const data = { ...req.body, dueDate: new Date(req.body.dueDate) };
      const payment = await bookkeepingStorage.upsertQuarterlyPayment(data);
      res.json(payment);
    } catch (error) {
      res.status(500).json({ message: "Failed to update quarterly payment" });
    }
  });

  // === Calendar Events ===

  app.get("/api/ops/calendar-events", isAuthenticated, async (req, res) => {
    try {
      const startStr = req.query.startDate as string || req.query.start as string;
      const endStr = req.query.endDate as string || req.query.end as string;
      if (!startStr || !endStr) {
        return res.json([]);
      }
      const startDate = new Date(startStr);
      const endDate = new Date(endStr);
      if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
        return res.json([]);
      }
      const { db: database } = await import("./db");
      const { sql } = await import("drizzle-orm");

      const [leadFollowups, taskDueDates, milestoneDueDates, billDueDates, taxPayments] = await Promise.all([
        database.execute(sql`
          SELECT id, name as title, follow_up_date as date, 'follow_up' as event_type, status as detail
          FROM contact_submissions
          WHERE follow_up_date >= ${startDate} AND follow_up_date <= ${endDate} AND follow_up_date IS NOT NULL
        `),
        database.execute(sql`
          SELECT t.id, t.title, t.due_date as date, 'task' as event_type, t.status as detail, p.name as project_name
          FROM tasks t LEFT JOIN projects p ON p.id = t.project_id
          WHERE t.due_date >= ${startDate} AND t.due_date <= ${endDate} AND t.due_date IS NOT NULL
        `),
        database.execute(sql`
          SELECT m.id, m.title, m.due_date as date, 'milestone' as event_type, p.name as project_name
          FROM milestones m LEFT JOIN projects p ON p.id = m.project_id
          WHERE m.due_date >= ${startDate} AND m.due_date <= ${endDate} AND m.due_date IS NOT NULL
        `),
        database.execute(sql`
          SELECT b.id, b.description as title, b.due_date as date, 'bill' as event_type, v.name as vendor_name, b.amount
          FROM bills b LEFT JOIN vendors v ON v.id = b.vendor_id
          WHERE b.due_date >= ${startDate} AND b.due_date <= ${endDate} AND b.status != 'paid'
        `),
        database.execute(sql`
          SELECT id, quarter as title, due_date as date, 'tax_payment' as event_type, estimated_amount as amount, paid_amount
          FROM quarterly_tax_payments
          WHERE due_date >= ${startDate} AND due_date <= ${endDate}
        `),
      ]);

      const events = [
        ...leadFollowups.rows.map((r: any) => ({ ...r, event_type: "follow_up", color: "#f59e0b" })),
        ...taskDueDates.rows.map((r: any) => ({ ...r, event_type: "task", color: "#3b82f6" })),
        ...milestoneDueDates.rows.map((r: any) => ({ ...r, event_type: "milestone", color: "#8b5cf6" })),
        ...billDueDates.rows.map((r: any) => ({ ...r, event_type: "bill", color: "#ef4444" })),
        ...taxPayments.rows.map((r: any) => ({ ...r, event_type: "tax_payment", color: "#10b981" })),
      ];

      res.json(events);
    } catch (error) {
      console.error("Calendar events error:", error);
      res.status(500).json({ message: "Failed to fetch calendar events" });
    }
  });

  // === Hot Leads ===

  app.get("/api/leads/hot", isAuthenticated, async (_req, res) => {
    try {
      const { db: database } = await import("./db");
      const { sql } = await import("drizzle-orm");
      const result = await database.execute(sql`
        SELECT cs.id, cs.name, cs.email, cs.company, cs.status, cs.close_probability,
          cs.projected_value, cs.follow_up_date, cs.updated_at,
          ol.ai_score, ol.value_estimate, ol.pitch_angle
        FROM contact_submissions cs
        LEFT JOIN outreach_leads ol ON ol.crm_lead_id = cs.id
        WHERE (
          cs.close_probability >= 70
          OR ol.ai_score >= 70
          OR cs.status IN ('qualified', 'proposal', 'negotiation')
        )
        AND cs.status NOT IN ('won', 'lost')
        ORDER BY COALESCE(ol.ai_score, 0) + COALESCE(cs.close_probability, 0) DESC
        LIMIT 10
      `);
      res.json(result.rows);
    } catch (error) {
      console.error("Hot leads error:", error);
      res.status(500).json({ message: "Failed to fetch hot leads" });
    }
  });

  // === Manual Revenue Entry ===

  app.post("/api/ops/revenue", isAuthenticated, async (req, res) => {
    try {
      const { amount, description, date, revenueType } = req.body;
      const parsedAmount = parseFloat(amount);
      if (!parsedAmount || parsedAmount <= 0 || isNaN(parsedAmount)) {
        return res.status(400).json({ message: "Amount must be a positive number" });
      }
      if (!description || typeof description !== "string" || !description.trim()) {
        return res.status(400).json({ message: "Description is required" });
      }
      const parsedDate = new Date(date);
      if (isNaN(parsedDate.getTime())) {
        return res.status(400).json({ message: "Valid date is required" });
      }
      const validTypes = ["project", "subscription", "other"];
      const safeType = validTypes.includes(revenueType) ? revenueType : "project";
      const accountNumber = safeType === "subscription" ? "4100" : safeType === "other" ? "4200" : "4000";
      const entry = await bookkeepingStorage.postManualRevenue(
        String(parsedAmount),
        description.trim(),
        parsedDate,
        accountNumber
      );
      res.status(201).json(entry);
    } catch (error) {
      console.error("Manual revenue error:", error);
      res.status(500).json({ message: "Failed to record revenue" });
    }
  });

  // === Backfill existing payments to ledger ===

  app.post("/api/ops/backfill-ledger", isAuthenticated, async (req, res) => {
    try {
      const count = await backfillExistingPayments();
      res.json({ success: true, entriesCreated: count });
    } catch (error) {
      console.error("Backfill error:", error);
      res.status(500).json({ message: "Failed to backfill ledger" });
    }
  });

  // Seed chart of accounts on startup, then backfill existing payments
  bookkeepingStorage.seedDefaultAccounts().then(async () => {
    try {
      const count = await backfillExistingPayments();
      if (count > 0) console.log(`Backfilled ${count} payments to ledger`);
    } catch (err) {
      console.error("Failed to backfill payments:", err);
    }
  }).catch(err =>
    console.error("Failed to seed chart of accounts:", err)
  );

  // Seed v2 system accounts, then backfill payments
  import("./accounting-v2").then(async ({ seedSystemAccounts, backfillV2FromPayments }) => {
    const { created, skipped } = await seedSystemAccounts();
    console.log(`Accounting v2: ${created} created, ${skipped} already existed`);
    await backfillV2FromPayments();
  }).catch(err =>
    console.error("Failed to seed v2 accounts:", err)
  );

  app.post("/api/accounting/opening-balances", isAuthenticated, async (req, res) => {
    try {
      const { startDate, balances } = req.body;
      if (!startDate || !Array.isArray(balances) || balances.length === 0) {
        return res.status(400).json({ message: "Start date and balances are required" });
      }

      const existingOB = await db.select({ id: transactionsV2.id })
        .from(transactionsV2)
        .where(eq(transactionsV2.referenceType, "opening_balance"))
        .limit(1);
      if (existingOB.length > 0) {
        return res.status(409).json({ message: "Opening balances have already been posted. Void or delete the existing entry from the General Ledger first." });
      }

      const date = new Date(startDate);
      date.setHours(0, 0, 0, 0);

      const v2Accounts = await db.select().from(accountsV2).orderBy(accountsV2.code);
      const v2Map = new Map(v2Accounts.map(a => [a.id, a]));

      const v1Accounts = await bookkeepingStorage.getAccounts();

      const v1Lines: Array<{ accountId: string; debit: string; credit: string; memo: string }> = [];
      const v2Lines: Array<{ accountId: string; debit?: number; credit?: number; memo?: string }> = [];

      for (const b of balances) {
        const amount = parseFloat(b.amount);
        if (!amount || amount === 0) continue;

        const v2Acct = v2Map.get(b.accountId);
        if (!v2Acct) continue;

        const isDebitNormal = v2Acct.type === "asset" || v2Acct.type === "expense";
        const absAmount = Math.abs(amount);

        if (isDebitNormal) {
          v2Lines.push({ accountId: b.accountId, debit: absAmount, credit: 0, memo: "Opening balance" });
        } else {
          v2Lines.push({ accountId: b.accountId, debit: 0, credit: absAmount, memo: "Opening balance" });
        }

        const v1Match = v1Accounts.find(a => a.accountNumber === v2Acct.code);
        if (v1Match) {
          if (isDebitNormal) {
            v1Lines.push({ accountId: v1Match.id, debit: absAmount.toFixed(2), credit: "0", memo: "Opening balance" });
          } else {
            v1Lines.push({ accountId: v1Match.id, debit: "0", credit: absAmount.toFixed(2), memo: "Opening balance" });
          }
        }
      }

      if (v2Lines.length === 0) {
        return res.status(400).json({ message: "No valid balances to post" });
      }

      const totalDebits = v2Lines.reduce((s, l) => s + (l.debit ?? 0), 0);
      const totalCredits = v2Lines.reduce((s, l) => s + (l.credit ?? 0), 0);
      const diff = Math.round((totalDebits - totalCredits) * 100) / 100;

      if (Math.abs(diff) > 0.001) {
        const equityAcct = v2Accounts.find(a => a.code === "3000");
        if (!equityAcct) {
          return res.status(400).json({ message: "Owner's Equity account (3000) not found to balance entry" });
        }
        if (diff > 0) {
          v2Lines.push({ accountId: equityAcct.id, debit: 0, credit: diff, memo: "Opening balance — equity plug" });
        } else {
          v2Lines.push({ accountId: equityAcct.id, debit: Math.abs(diff), credit: 0, memo: "Opening balance — equity plug" });
        }

        const v1Equity = v1Accounts.find(a => a.accountNumber === "3000");
        if (v1Equity) {
          if (diff > 0) {
            v1Lines.push({ accountId: v1Equity.id, debit: "0", credit: diff.toFixed(2), memo: "Opening balance — equity plug" });
          } else {
            v1Lines.push({ accountId: v1Equity.id, debit: Math.abs(diff).toFixed(2), credit: "0", memo: "Opening balance — equity plug" });
          }
        }
      }

      const { postJournal } = await import("./accounting-v2");
      const v2Tx = await postJournal({
        occurredAt: date,
        memo: "Opening Balances",
        referenceType: "opening_balance",
        referenceId: `opening_balance_${startDate}`,
        lines: v2Lines,
      });

      let v1Posted = false;
      if (v1Lines.length > 0) {
        try {
          await bookkeepingStorage.createJournalEntryWithLines(
            { date, memo: "Opening Balances", reference: `opening_balance_${startDate}`, sourceType: "opening_balance", sourceId: `opening_balance_${startDate}` },
            v1Lines
          );
          v1Posted = true;
        } catch (e) {
          console.error("V1 opening balance journal failed (v2 succeeded):", e);
        }
      }

      res.status(201).json({ success: true, transactionId: v2Tx.id, lineCount: v2Lines.length, v1Posted });
    } catch (error: any) {
      console.error("Opening balances error:", error);
      if (error.message?.includes("ref_unique_idx")) {
        return res.status(409).json({ message: "Opening balances for this date already exist. Void or delete the existing entry first." });
      }
      res.status(500).json({ message: error.message || "Failed to post opening balances" });
    }
  });

  app.get("/api/accounting/opening-balances/check", isAuthenticated, async (_req, res) => {
    try {
      const existing = await db.select({ id: transactionsV2.id, occurredAt: transactionsV2.occurredAt })
        .from(transactionsV2)
        .where(eq(transactionsV2.referenceType, "opening_balance"))
        .limit(1);
      res.json({ exists: existing.length > 0, entry: existing[0] || null });
    } catch (error) {
      res.status(500).json({ message: "Failed to check opening balances" });
    }
  });

  app.get("/api/ops/budgets", isAuthenticated, async (req, res) => {
    try {
      const year = Number(req.query.year) || new Date().getFullYear();
      const rows = await db.select().from(budgets).where(eq(budgets.year, year)).orderBy(budgets.accountId);
      res.json(rows);
    } catch (error) {
      console.error("Get budgets error:", error);
      res.status(500).json({ message: "Failed to fetch budgets" });
    }
  });

  app.post("/api/ops/budgets", isAuthenticated, async (req, res) => {
    try {
      const { accountId, year, month, amount, notes } = req.body;
      if (!accountId || !year || !amount) {
        return res.status(400).json({ message: "accountId, year, and amount are required" });
      }
      const existing = await db.select().from(budgets)
        .where(and(
          eq(budgets.accountId, accountId),
          eq(budgets.year, Number(year)),
          month != null ? eq(budgets.month, Number(month)) : drizzleSql`${budgets.month} IS NULL`
        ))
        .limit(1);
      if (existing.length > 0) {
        const [updated] = await db.update(budgets)
          .set({ amount: String(amount), notes: notes || null, updatedAt: new Date() })
          .where(eq(budgets.id, existing[0].id))
          .returning();
        return res.json(updated);
      }
      const [created] = await db.insert(budgets).values({
        accountId,
        year: Number(year),
        month: month != null ? Number(month) : null,
        amount: String(amount),
        notes: notes || null,
      }).returning();
      res.status(201).json(created);
    } catch (error) {
      console.error("Create/update budget error:", error);
      res.status(500).json({ message: "Failed to save budget" });
    }
  });

  app.post("/api/ops/budgets/bulk", isAuthenticated, async (req, res) => {
    try {
      const { budgets: items, year } = req.body;
      if (!Array.isArray(items) || !year) {
        return res.status(400).json({ message: "budgets array and year are required" });
      }
      const results = [];
      for (const item of items) {
        if (!item.accountId || item.amount == null) continue;
        const existing = await db.select().from(budgets)
          .where(and(
            eq(budgets.accountId, item.accountId),
            eq(budgets.year, Number(year)),
            item.month != null ? eq(budgets.month, Number(item.month)) : drizzleSql`${budgets.month} IS NULL`
          ))
          .limit(1);
        if (existing.length > 0) {
          if (Number(item.amount) === 0) {
            await db.delete(budgets).where(eq(budgets.id, existing[0].id));
          } else {
            const [updated] = await db.update(budgets)
              .set({ amount: String(item.amount), notes: item.notes || null, updatedAt: new Date() })
              .where(eq(budgets.id, existing[0].id))
              .returning();
            results.push(updated);
          }
        } else if (Number(item.amount) > 0) {
          const [created] = await db.insert(budgets).values({
            accountId: item.accountId,
            year: Number(year),
            month: item.month != null ? Number(item.month) : null,
            amount: String(item.amount),
            notes: item.notes || null,
          }).returning();
          results.push(created);
        }
      }
      res.json({ saved: results.length });
    } catch (error) {
      console.error("Bulk budget save error:", error);
      res.status(500).json({ message: "Failed to save budgets" });
    }
  });

  app.delete("/api/ops/budgets/:id", isAuthenticated, async (req, res) => {
    try {
      await db.delete(budgets).where(eq(budgets.id, param(req, "id")));
      res.json({ success: true });
    } catch (error) {
      console.error("Delete budget error:", error);
      res.status(500).json({ message: "Failed to delete budget" });
    }
  });

  app.get("/api/ops/budget-vs-actual", isAuthenticated, async (req, res) => {
    try {
      const year = Number(req.query.year) || new Date().getFullYear();
      const period = String(req.query.period || "year");
      const month = req.query.month ? Number(req.query.month) : null;
      const quarter = req.query.quarter ? Number(req.query.quarter) : null;

      let dateStart: Date;
      let dateEnd: Date;
      let budgetMultiplier = 1;

      if (period === "month" && month != null) {
        dateStart = new Date(year, month - 1, 1);
        dateEnd = new Date(year, month, 1);
        budgetMultiplier = 1;
      } else if (period === "quarter" && quarter != null) {
        const qStart = (quarter - 1) * 3;
        dateStart = new Date(year, qStart, 1);
        dateEnd = new Date(year, qStart + 3, 1);
        budgetMultiplier = 3;
      } else {
        dateStart = new Date(year, 0, 1);
        dateEnd = new Date(year + 1, 0, 1);
        budgetMultiplier = 12;
      }

      const expenseAccounts = await db.select().from(accounts)
        .where(eq(accounts.type, "expense"));

      const budgetRows = await db.select().from(budgets)
        .where(eq(budgets.year, year));

      const budgetMap = new Map<string, number>();
      for (const b of budgetRows) {
        if (b.month != null) {
          if (period === "month" && b.month === month) {
            budgetMap.set(b.accountId, (budgetMap.get(b.accountId) || 0) + Number(b.amount));
          } else if (period === "quarter" && quarter != null) {
            const qStart = (quarter - 1) * 3 + 1;
            if (b.month >= qStart && b.month < qStart + 3) {
              budgetMap.set(b.accountId, (budgetMap.get(b.accountId) || 0) + Number(b.amount));
            }
          } else if (period === "year") {
            budgetMap.set(b.accountId, (budgetMap.get(b.accountId) || 0) + Number(b.amount));
          }
        } else {
          const annualAmt = Number(b.amount);
          if (period === "month") {
            budgetMap.set(b.accountId, annualAmt / 12);
          } else if (period === "quarter") {
            budgetMap.set(b.accountId, annualAmt / 4);
          } else {
            budgetMap.set(b.accountId, annualAmt);
          }
        }
      }

      const expenseRows = await db.select({
        accountId: expenses.accountId,
        total: drizzleSql<string>`COALESCE(SUM(${expenses.amount}), 0)`,
      })
        .from(expenses)
        .where(and(
          drizzleSql`${expenses.date} >= ${dateStart}`,
          drizzleSql`${expenses.date} < ${dateEnd}`
        ))
        .groupBy(expenses.accountId);

      const actualMap = new Map<string, number>();
      for (const r of expenseRows) {
        actualMap.set(r.accountId, Number(r.total));
      }

      const billRows = await db.select({
        accountId: bills.accountId,
        total: drizzleSql<string>`COALESCE(SUM(${bills.amount}), 0)`,
      })
        .from(bills)
        .where(and(
          drizzleSql`${bills.dueDate} >= ${dateStart}`,
          drizzleSql`${bills.dueDate} < ${dateEnd}`
        ))
        .groupBy(bills.accountId);

      for (const r of billRows) {
        if (r.accountId) {
          actualMap.set(r.accountId, (actualMap.get(r.accountId) || 0) + Number(r.total));
        }
      }

      const report = expenseAccounts
        .filter(a => budgetMap.has(a.id) || actualMap.has(a.id))
        .map(a => {
          const budgeted = Math.round((budgetMap.get(a.id) || 0) * 100) / 100;
          const actual = Math.round((actualMap.get(a.id) || 0) * 100) / 100;
          const variance = Math.round((budgeted - actual) * 100) / 100;
          const percentUsed = budgeted > 0 ? Math.round((actual / budgeted) * 10000) / 100 : actual > 0 ? 999 : 0;
          return {
            accountId: a.id,
            accountNumber: a.accountNumber,
            accountName: a.name,
            budgeted,
            actual,
            variance,
            percentUsed,
            status: budgeted > 0 ? (actual > budgeted ? "over" : "under") : (actual > 0 ? "over" : "under"),
          };
        })
        .sort((a, b) => a.accountNumber.localeCompare(b.accountNumber));

      const totals = report.reduce((acc, r) => ({
        budgeted: acc.budgeted + r.budgeted,
        actual: acc.actual + r.actual,
      }), { budgeted: 0, actual: 0 });

      res.json({
        report,
        totals: {
          ...totals,
          variance: Math.round((totals.budgeted - totals.actual) * 100) / 100,
          percentUsed: totals.budgeted > 0 ? Math.round((totals.actual / totals.budgeted) * 10000) / 100 : 0,
        },
        period,
        year,
        month,
        quarter,
      });
    } catch (error) {
      console.error("Budget vs actual error:", error);
      res.status(500).json({ message: "Failed to generate budget vs actual report" });
    }
  });

  app.get("/api/accounting/v2/accounts", isAuthenticated, async (_req, res) => {
    try {
      const accounts = await db.select().from(accountsV2).orderBy(accountsV2.code);
      res.json(accounts);
    } catch (error) {
      console.error("Get v2 accounts error:", error);
      res.status(500).json({ message: "Failed to fetch accounts" });
    }
  });

  app.get("/api/accounting/reconciliation/unreconciled/:accountId", isAuthenticated, async (req, res) => {
    try {
      const accountId = param(req, "accountId");

      const reconciledLineIds = db
        .select({ id: reconciliationItems.transactionLineId })
        .from(reconciliationItems);

      const lines = await db
        .select({
          lineId: transactionLinesV2.id,
          transactionId: transactionLinesV2.transactionId,
          debit: transactionLinesV2.debit,
          credit: transactionLinesV2.credit,
          lineMemo: transactionLinesV2.lineMemo,
          occurredAt: transactionsV2.occurredAt,
          memo: transactionsV2.memo,
          referenceType: transactionsV2.referenceType,
        })
        .from(transactionLinesV2)
        .innerJoin(transactionsV2, eq(transactionLinesV2.transactionId, transactionsV2.id))
        .where(
          and(
            eq(transactionLinesV2.accountId, accountId),
            notInArray(transactionLinesV2.id, reconciledLineIds)
          )
        )
        .orderBy(transactionsV2.occurredAt);

      res.json(lines);
    } catch (error) {
      console.error("Get unreconciled lines error:", error);
      res.status(500).json({ message: "Failed to fetch unreconciled transactions" });
    }
  });

  app.post("/api/accounting/reconciliation/complete", isAuthenticated, async (req, res) => {
    try {
      const { accountId, statementDate, statementBalance, clearedLineIds } = req.body;

      if (!accountId || !statementDate || statementBalance === undefined || !clearedLineIds?.length) {
        return res.status(400).json({ message: "Missing required fields" });
      }

      const result = await db.transaction(async (tx) => {
        const clearedLines = await tx
          .select({
            id: transactionLinesV2.id,
            debit: transactionLinesV2.debit,
            credit: transactionLinesV2.credit,
          })
          .from(transactionLinesV2)
          .where(
            and(
              eq(transactionLinesV2.accountId, accountId),
              inArray(transactionLinesV2.id, clearedLineIds)
            )
          );

        let clearedBalance = 0;
        for (const line of clearedLines) {
          clearedBalance += Number(line.debit) - Number(line.credit);
        }

        const [rec] = await tx.insert(reconciliations).values({
          accountId,
          statementDate: new Date(statementDate),
          statementBalance: String(statementBalance),
          clearedBalance: String(clearedBalance),
          itemCount: clearedLineIds.length,
          completedAt: new Date(),
        }).returning();

        for (const lineId of clearedLineIds) {
          await tx.insert(reconciliationItems).values({
            reconciliationId: rec.id,
            transactionLineId: lineId,
          });
        }

        return rec;
      });

      res.json(result);
    } catch (error) {
      console.error("Complete reconciliation error:", error);
      res.status(500).json({ message: "Failed to complete reconciliation" });
    }
  });

  app.get("/api/accounting/reconciliation/history", isAuthenticated, async (_req, res) => {
    try {
      const history = await db
        .select({
          id: reconciliations.id,
          accountId: reconciliations.accountId,
          accountName: accountsV2.name,
          accountCode: accountsV2.code,
          statementDate: reconciliations.statementDate,
          statementBalance: reconciliations.statementBalance,
          clearedBalance: reconciliations.clearedBalance,
          itemCount: reconciliations.itemCount,
          completedAt: reconciliations.completedAt,
        })
        .from(reconciliations)
        .innerJoin(accountsV2, eq(reconciliations.accountId, accountsV2.id))
        .orderBy(desc(reconciliations.completedAt));

      res.json(history);
    } catch (error) {
      console.error("Get reconciliation history error:", error);
      res.status(500).json({ message: "Failed to fetch reconciliation history" });
    }
  });

  app.get("/api/accounting/ar-aging", isAuthenticated, async (_req, res) => {
    try {
      const pending = await db
        .select({
          id: paymentLinks.id,
          amount: paymentLinks.amount,
          description: paymentLinks.description,
          clientName: paymentLinks.clientName,
          status: paymentLinks.status,
          createdAt: paymentLinks.createdAt,
          projectId: paymentLinks.projectId,
          clientId: paymentLinks.clientId,
        })
        .from(paymentLinks)
        .where(eq(paymentLinks.status, "pending"));

      const projectIds = [...new Set(pending.map((p) => p.projectId).filter(Boolean))] as string[];
      const projectMap = new Map<string, { name: string }>();
      if (projectIds.length > 0) {
        const projectRows = await db
          .select({ id: projects.id, name: projects.name })
          .from(projects)
          .where(inArray(projects.id, projectIds));
        for (const p of projectRows) {
          projectMap.set(p.id, { name: p.name });
        }
      }

      const clientIds = [...new Set(pending.map((p) => p.clientId).filter(Boolean))] as string[];
      const clientMap = new Map<string, { name: string }>();
      if (clientIds.length > 0) {
        const clientRows = await db
          .select({ id: clients.id, name: clients.name })
          .from(clients)
          .where(inArray(clients.id, clientIds));
        for (const c of clientRows) {
          clientMap.set(c.id, { name: c.name });
        }
      }

      const now = new Date();
      const rows = pending.map((pl) => {
        const invoiceDate = pl.createdAt ? new Date(pl.createdAt) : now;
        const invMatch = pl.description?.match(/INV-\d+/);
        const invoiceNumber = invMatch ? invMatch[0] : `PL-${pl.id.slice(0, 6)}`;

        const dueDate = new Date(invoiceDate);
        dueDate.setDate(dueDate.getDate() + 30);

        const totalAmount = Number(pl.amount);
        const amountPaid = 0;
        const balanceDue = totalAmount - amountPaid;

        const daysPastDue = Math.max(0, Math.floor((now.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24)));

        let bucket: "current" | "1-30" | "31-60" | "61-90" | "90+" = "current";
        if (daysPastDue > 90) bucket = "90+";
        else if (daysPastDue > 60) bucket = "61-90";
        else if (daysPastDue > 30) bucket = "31-60";
        else if (daysPastDue > 0) bucket = "1-30";

        const clientName = pl.clientName || (pl.clientId ? clientMap.get(pl.clientId)?.name : null) || "Unknown";
        const projectName = pl.projectId ? projectMap.get(pl.projectId)?.name : null;

        return {
          id: pl.id,
          clientName,
          projectName,
          invoiceNumber,
          invoiceDate: invoiceDate.toISOString(),
          dueDate: dueDate.toISOString(),
          totalAmount,
          amountPaid,
          balanceDue,
          daysPastDue,
          bucket,
        };
      });

      rows.sort((a, b) => b.daysPastDue - a.daysPastDue);

      const summary = {
        current: 0,
        "1-30": 0,
        "31-60": 0,
        "61-90": 0,
        "90+": 0,
        total: 0,
      };
      for (const r of rows) {
        summary[r.bucket] += r.balanceDue;
        summary.total += r.balanceDue;
      }

      res.json({ rows, summary });
    } catch (error) {
      console.error("AR Aging report error:", error);
      res.status(500).json({ message: "Failed to generate AR aging report" });
    }
  });
}

async function backfillExistingPayments(): Promise<number> {
  const { db: database } = await import("./db");
  const { sql } = await import("drizzle-orm");
  let count = 0;

  const projectPayments = await database.execute(sql`
    SELECT pp.id, pp.amount, pp.type, pp.label, pp.received_date, p.name as project_name
    FROM project_payments pp
    LEFT JOIN projects p ON p.id = pp.project_id
    WHERE pp.status = 'received' AND (pp.ledger_excluded = false OR pp.ledger_excluded IS NULL)
  `);

  for (const pp of projectPayments.rows as any[]) {
    const sourceId = `project_payment_${pp.id}`;
    const exists = await bookkeepingStorage.hasExistingJournalForSource("project_payment", sourceId);
    if (!exists) {
      const desc = `Project payment: ${pp.project_name || "Unknown"} - ${pp.label || pp.type}`;
      const date = pp.received_date ? new Date(pp.received_date) : new Date();
      await bookkeepingStorage.postPaymentToLedgerWithDate(
        String(pp.amount), desc, "project_payment", sourceId, date, true
      );
      count++;
    }
  }

  const stripePayments = await database.execute(sql`
    SELECT sp.id, sp.amount, sp.description, sp.paid_at, sp.created_at, sp.payment_type, sp.subscription_id
    FROM stripe_payments sp
    WHERE sp.status = 'succeeded'
  `);

  for (const sp of stripePayments.rows as any[]) {
    const sourceId = `stripe_payment_${sp.id}`;
    const exists = await bookkeepingStorage.hasExistingJournalForSource("stripe_payment", sourceId);
    if (!exists) {
      const isSubscription = sp.payment_type === "recurring" || !!sp.subscription_id;
      const desc = isSubscription
        ? `Subscription payment: ${sp.description || "Recurring"}`
        : `Stripe payment: ${sp.description || "Payment"}`;
      const date = sp.paid_at ? new Date(sp.paid_at) : sp.created_at ? new Date(sp.created_at) : new Date();
      await bookkeepingStorage.postPaymentToLedgerWithDate(
        String(sp.amount), desc, "stripe_payment", sourceId, date, !isSubscription
      );
      count++;
    }
  }

  return count;
}
