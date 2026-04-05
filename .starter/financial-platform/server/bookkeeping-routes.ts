import type { Express, RequestHandler } from "express";
import { bookkeepingStorage } from "./bookkeeping-storage";
import { insertAccountSchema, insertVendorSchema, reconciliations, reconciliationItems, transactionLinesV2, transactionsV2, accountsV2, vendors, expenses, bills, billPayments, budgets, accounts } from "@shared/schema";
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
      const result = await bookkeepingStorage.createJournalEntryWithLines(
        { ...entryData, date: new Date(entryData.date), createdBy: "admin" },
        lines
      );
      res.status(201).json(result);
    } catch (error: any) {
      res.status(400).json({ message: error.message || "Failed to create journal entry" });
    }
  });

  app.post("/api/ops/journal-entries/:id/void", isAuthenticated, async (req, res) => {
    try {
      const entry = await bookkeepingStorage.voidJournalEntry(param(req, "id"));
      if (!entry) return res.status(404).json({ message: "Entry not found" });
      res.json(entry);
    } catch (error) {
      res.status(500).json({ message: "Failed to void entry" });
    }
  });

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

  app.get("/api/ops/expenses", isAuthenticated, async (req, res) => {
    try {
      const filters: any = {};
      if (req.query.startDate) filters.startDate = new Date(req.query.startDate as string);
      if (req.query.endDate) filters.endDate = new Date(req.query.endDate as string);
      if (req.query.accountId) filters.accountId = req.query.accountId;
      if (req.query.vendorId) filters.vendorId = req.query.vendorId;
      const expenseList = await bookkeepingStorage.getExpenses(filters);
      res.json(expenseList);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch expenses" });
    }
  });

  app.post("/api/ops/expenses", isAuthenticated, async (req, res) => {
    try {
      const data = { ...req.body, date: new Date(req.body.date), amount: String(req.body.amount) };
      const validFrequencies = ["weekly", "monthly", "quarterly", "annually"];
      if (data.isRecurring) {
        if (!data.recurringFrequency || !validFrequencies.includes(data.recurringFrequency)) {
          return res.status(400).json({ message: "Recurring expenses require a valid frequency" });
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
      if (req.body.receiptNotes !== undefined) updates.receiptNotes = req.body.receiptNotes || null;
      if (req.body.isBillable !== undefined) updates.isBillable = req.body.isBillable;
      if (req.body.taxDeductible !== undefined) updates.taxDeductible = req.body.taxDeductible;
      if (req.body.checkNumber !== undefined) updates.checkNumber = req.body.checkNumber || null;
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
      try {
        const { deleteTransaction } = await import("./accounting-v2");
        const { transactionsV2 } = await import("@shared/schema");
        const { eq } = await import("drizzle-orm");
        const { db } = await import("./db");
        const [v2tx] = await db.select().from(transactionsV2).where(eq(transactionsV2.referenceId, `expense_${param(req, "id")}`)).limit(1);
        if (v2tx) await deleteTransaction(v2tx.id);
      } catch (e) {
        console.error("Delete v2 expense entry failed:", e);
      }
      const deleted = await bookkeepingStorage.deleteExpense(param(req, "id"));
      if (!deleted) return res.status(404).json({ message: "Expense not found" });
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ message: "Failed to delete expense" });
    }
  });

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

      const vendorMap = new Map<string, string>();
      const allVendors = await bookkeepingStorage.getVendors();
      for (const v of allVendors) vendorMap.set(v.id, v.name);

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
        .select({ vendorId: expenses.vendorId, amount: expenses.amount })
        .from(expenses)
        .where(and(
          inArray(expenses.vendorId, vendorIds),
          drizzleSql`${expenses.date} >= ${startDate}`,
          drizzleSql`${expenses.date} <= ${endDate}`
        ));

      const billPaymentRows = await db
        .select({ vendorId: bills.vendorId, amount: billPayments.amount })
        .from(billPayments)
        .innerJoin(bills, eq(billPayments.billId, bills.id))
        .where(and(
          inArray(bills.vendorId, vendorIds),
          drizzleSql`${billPayments.paidAt} >= ${startDate}`,
          drizzleSql`${billPayments.paidAt} <= ${endDate}`
        ));

      const vendorTotals = new Map<string, number>();
      for (const row of expenseRows) {
        if (row.vendorId) vendorTotals.set(row.vendorId, (vendorTotals.get(row.vendorId) || 0) + Number(row.amount));
      }
      for (const row of billPaymentRows) {
        if (row.vendorId) vendorTotals.set(row.vendorId, (vendorTotals.get(row.vendorId) || 0) + Number(row.amount));
      }

      const result = allVendors.map(v => ({
        id: v.id, name: v.name, email: v.email, address: v.address, taxId: v.taxId,
        totalPaid: vendorTotals.get(v.id) || 0,
        over600: (vendorTotals.get(v.id) || 0) >= 600,
      }));

      result.sort((a, b) => b.totalPaid - a.totalPaid);

      res.json({ year, vendors: result, totalPaid: result.reduce((s, r) => s + r.totalPaid, 0), vendorsOver600: result.filter(r => r.over600).length });
    } catch (error) {
      res.status(500).json({ message: "Failed to generate 1099 summary" });
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

  app.get("/api/ops/income-statement", isAuthenticated, async (req, res) => {
    try {
      const startDate = req.query.startDate ? new Date(req.query.startDate as string) : new Date(new Date().getFullYear(), 0, 1);
      const endDate = req.query.endDate ? new Date(req.query.endDate as string) : new Date();
      const report = await bookkeepingStorage.getIncomeStatement(startDate, endDate);
      res.json(report);
    } catch (error) {
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
      const validTypes = ["service", "subscription", "other"];
      const safeType = validTypes.includes(revenueType) ? revenueType : "service";
      const accountNumber = safeType === "subscription" ? "4100" : safeType === "other" ? "4200" : "4000";
      const entry = await bookkeepingStorage.postManualRevenue(
        String(parsedAmount), description.trim(), parsedDate, accountNumber
      );
      res.status(201).json(entry);
    } catch (error) {
      res.status(500).json({ message: "Failed to record revenue" });
    }
  });

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
        return res.status(409).json({ message: "Opening balances have already been posted." });
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
          return res.status(400).json({ message: "Owner's Equity account (3000) not found" });
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

      if (v1Lines.length > 0) {
        try {
          await bookkeepingStorage.createJournalEntryWithLines(
            { date, memo: "Opening Balances", reference: `opening_balance_${startDate}`, sourceType: "opening_balance", sourceId: `opening_balance_${startDate}` },
            v1Lines
          );
        } catch (e) {
          console.error("V1 opening balance journal failed:", e);
        }
      }

      res.status(201).json({ success: true, transactionId: v2Tx.id, lineCount: v2Lines.length });
    } catch (error: any) {
      if (error.message?.includes("ref_unique_idx")) {
        return res.status(409).json({ message: "Opening balances for this date already exist." });
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
        accountId, year: Number(year), month: month != null ? Number(month) : null,
        amount: String(amount), notes: notes || null,
      }).returning();
      res.status(201).json(created);
    } catch (error) {
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
            accountId: item.accountId, year: Number(year),
            month: item.month != null ? Number(item.month) : null,
            amount: String(item.amount), notes: item.notes || null,
          }).returning();
          results.push(created);
        }
      }
      res.json({ saved: results.length });
    } catch (error) {
      res.status(500).json({ message: "Failed to save budgets" });
    }
  });

  app.delete("/api/ops/budgets/:id", isAuthenticated, async (req, res) => {
    try {
      await db.delete(budgets).where(eq(budgets.id, param(req, "id")));
      res.json({ success: true });
    } catch (error) {
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

      if (period === "month" && month != null) {
        dateStart = new Date(year, month - 1, 1);
        dateEnd = new Date(year, month, 1);
      } else if (period === "quarter" && quarter != null) {
        const qStart = (quarter - 1) * 3;
        dateStart = new Date(year, qStart, 1);
        dateEnd = new Date(year, qStart + 3, 1);
      } else {
        dateStart = new Date(year, 0, 1);
        dateEnd = new Date(year + 1, 0, 1);
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
          if (period === "month") budgetMap.set(b.accountId, annualAmt / 12);
          else if (period === "quarter") budgetMap.set(b.accountId, annualAmt / 4);
          else budgetMap.set(b.accountId, annualAmt);
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
      for (const r of expenseRows) actualMap.set(r.accountId, Number(r.total));

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
        if (r.accountId) actualMap.set(r.accountId, (actualMap.get(r.accountId) || 0) + Number(r.total));
      }

      const report = expenseAccounts
        .filter(a => budgetMap.has(a.id) || actualMap.has(a.id))
        .map(a => {
          const budgeted = Math.round((budgetMap.get(a.id) || 0) * 100) / 100;
          const actual = Math.round((actualMap.get(a.id) || 0) * 100) / 100;
          const variance = Math.round((budgeted - actual) * 100) / 100;
          const percentUsed = budgeted > 0 ? Math.round((actual / budgeted) * 10000) / 100 : actual > 0 ? 999 : 0;
          return {
            accountId: a.id, accountNumber: a.accountNumber, accountName: a.name,
            budgeted, actual, variance, percentUsed,
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
        period, year, month, quarter,
      });
    } catch (error) {
      res.status(500).json({ message: "Failed to generate budget vs actual report" });
    }
  });

  app.get("/api/accounting/v2/accounts", isAuthenticated, async (_req, res) => {
    try {
      const accts = await db.select().from(accountsV2).orderBy(accountsV2.code);
      res.json(accts);
    } catch (error) {
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
          .select({ id: transactionLinesV2.id, debit: transactionLinesV2.debit, credit: transactionLinesV2.credit })
          .from(transactionLinesV2)
          .where(and(
            eq(transactionLinesV2.accountId, accountId),
            inArray(transactionLinesV2.id, clearedLineIds)
          ));

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
      res.status(500).json({ message: "Failed to fetch reconciliation history" });
    }
  });

  bookkeepingStorage.seedDefaultAccounts().catch(err =>
    console.error("Failed to seed chart of accounts:", err)
  );

  import("./accounting-v2").then(async ({ seedSystemAccounts, backfillV2FromExpenses }) => {
    const { created, skipped } = await seedSystemAccounts();
    console.log(`Accounting v2: ${created} created, ${skipped} already existed`);
    await backfillV2FromExpenses();
  }).catch(err =>
    console.error("Failed to seed v2 accounts:", err)
  );
}
