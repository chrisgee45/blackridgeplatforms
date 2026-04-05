import { db } from "./db";
import { eq, and, sql, desc, asc, gte, lte, inArray } from "drizzle-orm";
import {
  fiscalPeriods, auditLogs, journalEntries, journalLines,
  accounts, expenses, transactionsV2, transactionLinesV2,
  accountsV2, reconciliationItems, adminUsers,
  type InsertFiscalPeriod, type InsertAuditLog,
  type FiscalPeriod, type AuditLog,
} from "@shared/schema";

export async function getFiscalPeriods(year?: number): Promise<FiscalPeriod[]> {
  if (year) {
    return db.select().from(fiscalPeriods).where(eq(fiscalPeriods.year, year)).orderBy(asc(fiscalPeriods.month));
  }
  return db.select().from(fiscalPeriods).orderBy(desc(fiscalPeriods.year), asc(fiscalPeriods.month));
}

export async function getOrCreateFiscalPeriod(year: number, month: number): Promise<FiscalPeriod> {
  const existing = await db.select().from(fiscalPeriods)
    .where(and(eq(fiscalPeriods.year, year), eq(fiscalPeriods.month, month)))
    .limit(1);
  if (existing.length > 0) return existing[0];
  const [created] = await db.insert(fiscalPeriods).values({ year, month, status: "open" }).returning();
  return created;
}

export async function isPeriodClosed(date: Date): Promise<boolean> {
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  const period = await db.select().from(fiscalPeriods)
    .where(and(eq(fiscalPeriods.year, year), eq(fiscalPeriods.month, month)))
    .limit(1);
  return period.length > 0 && period[0].status === "closed";
}

export async function assertPeriodOpen(date: Date): Promise<void> {
  if (await isPeriodClosed(date)) {
    const year = date.getFullYear();
    const month = date.getMonth() + 1;
    const monthName = new Date(year, month - 1).toLocaleString("en-US", { month: "long" });
    throw new Error(`Cannot modify entries in closed period: ${monthName} ${year}`);
  }
}

export async function closeFiscalPeriod(year: number, month: number, closedBy: string): Promise<FiscalPeriod> {
  const period = await getOrCreateFiscalPeriod(year, month);
  if (period.status === "closed") throw new Error(`Period ${month}/${year} is already closed`);

  const [updated] = await db.update(fiscalPeriods)
    .set({ status: "closed", closedBy, closedAt: new Date() })
    .where(eq(fiscalPeriods.id, period.id))
    .returning();

  await createAuditLog({
    action: "close",
    recordType: "fiscal_period",
    recordId: updated.id,
    description: `Closed period ${month}/${year}`,
    performedBy: closedBy,
  });

  return updated;
}

export async function reopenFiscalPeriod(year: number, month: number, reopenedBy: string): Promise<FiscalPeriod> {
  const period = await db.select().from(fiscalPeriods)
    .where(and(eq(fiscalPeriods.year, year), eq(fiscalPeriods.month, month)))
    .limit(1);
  if (period.length === 0 || period[0].status === "open") throw new Error(`Period ${month}/${year} is not closed`);

  const [updated] = await db.update(fiscalPeriods)
    .set({ status: "open", closedBy: null, closedAt: null })
    .where(eq(fiscalPeriods.id, period[0].id))
    .returning();

  await createAuditLog({
    action: "reopen",
    recordType: "fiscal_period",
    recordId: updated.id,
    description: `Reopened period ${month}/${year}`,
    performedBy: reopenedBy,
  });

  return updated;
}

export async function createAuditLog(data: InsertAuditLog): Promise<AuditLog> {
  const [log] = await db.insert(auditLogs).values(data).returning();
  return log;
}

export async function getAuditLogs(filters?: {
  startDate?: Date;
  endDate?: Date;
  recordType?: string;
  action?: string;
  performedBy?: string;
  limit?: number;
  offset?: number;
}): Promise<{ logs: AuditLog[]; total: number }> {
  const conditions: any[] = [];
  if (filters?.startDate) conditions.push(gte(auditLogs.performedAt, filters.startDate));
  if (filters?.endDate) conditions.push(lte(auditLogs.performedAt, filters.endDate));
  if (filters?.recordType) conditions.push(eq(auditLogs.recordType, filters.recordType));
  if (filters?.action) conditions.push(eq(auditLogs.action, filters.action));
  if (filters?.performedBy) conditions.push(eq(auditLogs.performedBy, filters.performedBy));

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [countResult] = await db.select({ count: sql<number>`count(*)::int` }).from(auditLogs).where(where);
  const logs = await db.select().from(auditLogs)
    .where(where)
    .orderBy(desc(auditLogs.performedAt))
    .limit(filters?.limit ?? 100)
    .offset(filters?.offset ?? 0);

  return { logs, total: countResult.count };
}

export async function voidJournalEntry(entryId: string, voidedBy: string): Promise<void> {
  const entry = await db.select().from(journalEntries).where(eq(journalEntries.id, entryId)).limit(1);
  if (entry.length === 0) throw new Error("Journal entry not found");
  if (entry[0].isVoid) throw new Error("Journal entry is already voided");

  await assertPeriodOpen(entry[0].date);

  const lines = await db.select().from(journalLines).where(eq(journalLines.journalEntryId, entryId));

  const reconciledCheck = await db.select({ count: sql<number>`count(*)::int` })
    .from(reconciliationItems)
    .where(sql`${reconciliationItems.transactionLineId} IN (
      SELECT tl.id FROM transaction_lines_v2 tl
      JOIN transactions_v2 t ON tl.transaction_id = t.id
      WHERE t.reference_id = ${entryId} OR t.reference_type = 'journal_entry'
    )`);
  if (reconciledCheck[0]?.count > 0) {
    throw new Error("Cannot void: this entry contains reconciled transactions. Undo reconciliation first.");
  }

  const beforeSnapshot = JSON.stringify({ ...entry[0], lines });

  await db.update(journalEntries).set({ isVoid: true }).where(eq(journalEntries.id, entryId));

  const reversalDate = new Date();
  const [reversalEntry] = await db.insert(journalEntries).values({
    date: reversalDate,
    memo: `REVERSAL of: ${entry[0].memo || entryId}`,
    sourceType: "reversal",
    sourceId: entryId,
    createdBy: voidedBy,
  }).returning();

  for (const line of lines) {
    await db.insert(journalLines).values({
      journalEntryId: reversalEntry.id,
      accountId: line.accountId,
      debit: line.credit,
      credit: line.debit,
      memo: `Reversal of entry ${entryId}`,
    });
  }

  await reverseV2Transaction(entryId, voidedBy);

  await createAuditLog({
    action: "void",
    recordType: "journal_entry",
    recordId: entryId,
    amount: lines.reduce((s, l) => s + Number(l.debit), 0).toString(),
    description: `Voided journal entry: ${entry[0].memo || entryId}`,
    before: beforeSnapshot,
    after: JSON.stringify({ isVoid: true, reversalId: reversalEntry.id }),
    performedBy: voidedBy,
  });
}

async function reverseV2Transaction(referenceId: string, voidedBy: string): Promise<void> {
  try {
    const v2Txns = await db.select().from(transactionsV2)
      .where(eq(transactionsV2.referenceId, referenceId));
    for (const tx of v2Txns) {
      const txLines = await db.select().from(transactionLinesV2)
        .where(eq(transactionLinesV2.transactionId, tx.id));
      if (txLines.length === 0) continue;
      const [reversalTx] = await db.insert(transactionsV2).values({
        occurredAt: new Date(),
        memo: `REVERSAL of: ${tx.memo || tx.id}`,
        referenceType: "reversal",
        referenceId: tx.id,
        status: "posted",
      }).returning();
      for (const line of txLines) {
        await db.insert(transactionLinesV2).values({
          transactionId: reversalTx.id,
          accountId: line.accountId,
          debit: line.credit,
          credit: line.debit,
        });
      }
    }
  } catch (e) {
    console.error("V2 reversal failed (non-fatal):", e);
  }
}

export async function voidV2Transaction(transactionId: string, voidedBy: string): Promise<void> {
  const [tx] = await db.select().from(transactionsV2)
    .where(eq(transactionsV2.id, transactionId)).limit(1);
  if (!tx) throw new Error("Transaction not found");
  if (tx.referenceType === "reversal") throw new Error("Cannot void a reversal entry");

  if (tx.occurredAt) await assertPeriodOpen(tx.occurredAt);

  const txLines = await db.select().from(transactionLinesV2)
    .where(eq(transactionLinesV2.transactionId, transactionId));

  const reconciledCheck = await db.select({ count: sql<number>`count(*)::int` })
    .from(reconciliationItems)
    .where(inArray(
      reconciliationItems.transactionLineId,
      txLines.map(l => l.id)
    ));
  if (reconciledCheck[0]?.count > 0) {
    throw new Error("Cannot void: this transaction contains reconciled items. Undo reconciliation first.");
  }

  const [reversalTx] = await db.insert(transactionsV2).values({
    occurredAt: new Date(),
    memo: `REVERSAL of: ${tx.memo || tx.id}`,
    referenceType: "reversal",
    referenceId: transactionId,
    status: "posted",
  }).returning();

  for (const line of txLines) {
    await db.insert(transactionLinesV2).values({
      transactionId: reversalTx.id,
      accountId: line.accountId,
      debit: line.credit,
      credit: line.debit,
    });
  }

  if (tx.referenceId) {
    const legacyEntryId = tx.referenceId.replace(/^(expense_|project_payment_|stripe_payment_)/, "");
    const legacyEntries = await db.select().from(journalEntries)
      .where(eq(journalEntries.id, legacyEntryId)).limit(1);
    if (legacyEntries.length > 0 && !legacyEntries[0].isVoid) {
      try {
        await db.update(journalEntries).set({ isVoid: true }).where(eq(journalEntries.id, legacyEntryId));
      } catch {}
    }
  }

  await createAuditLog({
    action: "void",
    recordType: "journal_entry",
    recordId: transactionId,
    amount: txLines.reduce((s, l) => s + Number(l.debit), 0).toString(),
    description: `Voided v2 transaction: ${tx.memo || transactionId}`,
    before: JSON.stringify({ ...tx, lines: txLines }),
    after: JSON.stringify({ reversalId: reversalTx.id }),
    performedBy: voidedBy,
  });
}

export async function voidExpense(expenseId: string, voidedBy: string): Promise<void> {
  const [expense] = await db.select().from(expenses).where(eq(expenses.id, expenseId)).limit(1);
  if (!expense) throw new Error("Expense not found");
  if (expense.isVoid) throw new Error("Expense is already voided");

  await assertPeriodOpen(expense.date);

  const beforeSnapshot = JSON.stringify(expense);

  await db.update(expenses).set({ isVoid: true }).where(eq(expenses.id, expenseId));

  if (expense.journalEntryId) {
    try {
      await voidJournalEntry(expense.journalEntryId, voidedBy);
    } catch (e: any) {
      if (!e.message.includes("already voided")) throw e;
    }
  }

  await reverseV2Transaction(`expense_${expenseId}`, voidedBy);

  await createAuditLog({
    action: "void",
    recordType: "expense",
    recordId: expenseId,
    amount: expense.amount,
    description: `Voided expense: ${expense.description}`,
    before: beforeSnapshot,
    after: JSON.stringify({ isVoid: true }),
    performedBy: voidedBy,
  });
}

export async function performYearEndClose(year: number, closedBy: string): Promise<{ closingEntryId: string }> {
  const periods = await getFiscalPeriods(year);
  for (let m = 1; m <= 12; m++) {
    const period = periods.find(p => p.month === m);
    if (!period || period.status !== "closed") {
      const monthName = new Date(year, m - 1).toLocaleString("en-US", { month: "long" });
      throw new Error(`Cannot close year ${year}: ${monthName} is still open. Close all monthly periods first.`);
    }
  }

  const existingClose = await db.select().from(journalEntries)
    .where(and(
      eq(journalEntries.sourceType, "year_end_close"),
      eq(journalEntries.sourceId, `year_${year}`),
      eq(journalEntries.isVoid, false)
    )).limit(1);
  if (existingClose.length > 0) throw new Error(`Year ${year} has already been closed`);

  const yearStart = new Date(year, 0, 1);
  const yearEnd = new Date(year, 11, 31, 23, 59, 59);

  const revenueAccounts = await db.select().from(accounts)
    .where(and(eq(accounts.type, "revenue"), eq(accounts.isActive, true)));
  const expenseAccounts = await db.select().from(accounts)
    .where(and(eq(accounts.type, "expense"), eq(accounts.isActive, true)));

  const allAccounts = [...revenueAccounts, ...expenseAccounts];
  const closingLines: { accountId: string; debit: string; credit: string; memo: string }[] = [];
  let netIncome = 0;

  for (const acct of allAccounts) {
    const result = await db.select({
      totalDebit: sql<string>`COALESCE(SUM(${journalLines.debit}), 0)`,
      totalCredit: sql<string>`COALESCE(SUM(${journalLines.credit}), 0)`,
    }).from(journalLines)
      .innerJoin(journalEntries, eq(journalLines.journalEntryId, journalEntries.id))
      .where(and(
        eq(journalLines.accountId, acct.id),
        gte(journalEntries.date, yearStart),
        lte(journalEntries.date, yearEnd),
        eq(journalEntries.isVoid, false),
      ));

    const totalDebit = Number(result[0]?.totalDebit ?? 0);
    const totalCredit = Number(result[0]?.totalCredit ?? 0);
    const balance = totalDebit - totalCredit;

    if (Math.abs(balance) < 0.005) continue;

    if (acct.type === "revenue") {
      closingLines.push({
        accountId: acct.id,
        debit: Math.max(balance * -1, 0).toFixed(2),
        credit: Math.max(balance, 0).toFixed(2),
        memo: `Close ${acct.name} to Retained Earnings`,
      });
      netIncome += (totalCredit - totalDebit);
    } else {
      closingLines.push({
        accountId: acct.id,
        debit: Math.max(balance * -1, 0).toFixed(2),
        credit: Math.max(balance, 0).toFixed(2),
        memo: `Close ${acct.name} to Retained Earnings`,
      });
      netIncome -= (totalDebit - totalCredit);
    }
  }

  let retainedEarningsAcct = await db.select().from(accounts)
    .where(eq(accounts.accountNumber, "3900")).limit(1);

  if (retainedEarningsAcct.length === 0) {
    const [created] = await db.insert(accounts).values({
      accountNumber: "3900",
      name: "Retained Earnings",
      type: "equity",
      subtype: "retained_earnings",
      normalBalance: "credit",
      isActive: true,
      description: "Accumulated net income from prior years",
    }).returning();
    retainedEarningsAcct = [created];
  }

  if (netIncome > 0) {
    closingLines.push({
      accountId: retainedEarningsAcct[0].id,
      debit: "0",
      credit: netIncome.toFixed(2),
      memo: `Net income for ${year} to Retained Earnings`,
    });
  } else if (netIncome < 0) {
    closingLines.push({
      accountId: retainedEarningsAcct[0].id,
      debit: Math.abs(netIncome).toFixed(2),
      credit: "0",
      memo: `Net loss for ${year} to Retained Earnings`,
    });
  }

  if (closingLines.length === 0) {
    throw new Error(`No revenue or expense activity found for ${year}`);
  }

  const closingDate = new Date(year, 11, 31);
  const [closingEntry] = await db.insert(journalEntries).values({
    date: closingDate,
    memo: `Year-end closing entry for ${year}`,
    sourceType: "year_end_close",
    sourceId: `year_${year}`,
    createdBy: closedBy,
  }).returning();

  for (const line of closingLines) {
    await db.insert(journalLines).values({
      journalEntryId: closingEntry.id,
      accountId: line.accountId,
      debit: line.debit,
      credit: line.credit,
      memo: line.memo,
    });
  }

  await createAuditLog({
    action: "create",
    recordType: "year_end_close",
    recordId: closingEntry.id,
    amount: Math.abs(netIncome).toFixed(2),
    description: `Year-end close for ${year}. Net income: $${netIncome.toFixed(2)}`,
    performedBy: closedBy,
  });

  return { closingEntryId: closingEntry.id };
}

export async function isEntryReconciled(entryId: string): Promise<boolean> {
  const result = await db.select({ count: sql<number>`count(*)::int` })
    .from(reconciliationItems)
    .innerJoin(transactionLinesV2, eq(reconciliationItems.transactionLineId, transactionLinesV2.id))
    .innerJoin(transactionsV2, eq(transactionLinesV2.transactionId, transactionsV2.id))
    .where(eq(transactionsV2.referenceId, entryId));
  return (result[0]?.count ?? 0) > 0;
}

export function isAdmin(role: string | null | undefined): boolean {
  return role === "admin";
}

export function isBookkeeperOrAdmin(role: string | null | undefined): boolean {
  return role === "admin" || role === "bookkeeper";
}

export async function getAdminUsers() {
  return db.select().from(adminUsers).orderBy(asc(adminUsers.username));
}

export async function updateAdminRole(userId: string, role: "admin" | "bookkeeper", updatedBy: string) {
  const [user] = await db.select().from(adminUsers).where(eq(adminUsers.id, userId)).limit(1);
  if (!user) throw new Error("User not found");

  const [updated] = await db.update(adminUsers)
    .set({ role })
    .where(eq(adminUsers.id, userId))
    .returning();

  await createAuditLog({
    action: "update",
    recordType: "admin_user",
    recordId: userId,
    description: `Changed role for ${user.username} from ${user.role} to ${role}`,
    before: JSON.stringify({ role: user.role }),
    after: JSON.stringify({ role }),
    performedBy: updatedBy,
  });

  return updated;
}
