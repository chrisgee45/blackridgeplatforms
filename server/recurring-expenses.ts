import { db } from "./db";
import { expenses } from "@shared/schema";
import { eq, and, lte, isNotNull } from "drizzle-orm";
import { bookkeepingStorage } from "./bookkeeping-storage";

const VALID_FREQUENCIES = ["weekly", "monthly", "quarterly", "annually"] as const;

function computeNextDate(current: Date, frequency: string, dayOfMonth?: number | null): Date {
  const next = new Date(current);
  if (frequency === "weekly") {
    next.setDate(next.getDate() + 7);
  } else {
    const monthsToAdd = frequency === "monthly" ? 1 : frequency === "quarterly" ? 3 : 12;
    next.setMonth(next.getMonth() + monthsToAdd);
    if (dayOfMonth) {
      const maxDay = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate();
      next.setDate(Math.min(dayOfMonth, maxDay));
    }
  }
  return next;
}

async function createChildExpense(parent: typeof expenses.$inferSelect, dueDate: Date) {
  const newExpense = await bookkeepingStorage.createExpenseWithJournal({
    vendorId: parent.vendorId,
    accountId: parent.accountId,
    description: parent.description,
    amount: String(parent.amount),
    date: dueDate,
    projectId: parent.projectId,
    clientId: parent.clientId,
    paymentMethod: parent.paymentMethod,
    receiptNotes: parent.receiptNotes,
    isBillable: parent.isBillable,
    taxDeductible: parent.taxDeductible,
    scheduleCLine: parent.scheduleCLine,
    isRecurring: false,
    recurringParentId: parent.id,
  });

  try {
    const { recordExpense, getAccountIdByCode } = await import("./accounting-v2");
    const legacyAccount = await bookkeepingStorage.getAccount(parent.accountId);
    let v2ExpenseAccountId: string;
    try {
      v2ExpenseAccountId = await getAccountIdByCode(legacyAccount?.accountNumber || "5090");
    } catch {
      v2ExpenseAccountId = await getAccountIdByCode("5090");
    }
    await recordExpense({
      amount: Number(parent.amount),
      expenseAccountId: v2ExpenseAccountId,
      paymentMethod: "cash",
      occurredAt: dueDate,
      memo: parent.description || "Recurring expense",
      referenceType: "expense",
      referenceId: `expense_${newExpense.id}`,
    });
  } catch (e) {
    console.error("Auto-post recurring expense to v2 ledger failed:", e);
  }

  return newExpense;
}

export async function processRecurringExpenses() {
  const now = new Date();

  const dueExpenses = await db
    .select()
    .from(expenses)
    .where(
      and(
        eq(expenses.isRecurring, true),
        isNotNull(expenses.nextDueDate),
        lte(expenses.nextDueDate, now)
      )
    );

  let created = 0;
  const MAX_CATCHUP = 12;

  for (const parent of dueExpenses) {
    if (!parent.nextDueDate || !parent.recurringFrequency) continue;
    if (!VALID_FREQUENCIES.includes(parent.recurringFrequency as any)) continue;

    try {
      let currentDue = new Date(parent.nextDueDate);
      let catchupCount = 0;

      while (currentDue <= now && catchupCount < MAX_CATCHUP) {
        await createChildExpense(parent, currentDue);
        created++;
        catchupCount++;
        currentDue = computeNextDate(currentDue, parent.recurringFrequency, parent.recurringDayOfMonth);
      }

      await db.update(expenses)
        .set({ nextDueDate: currentDue })
        .where(eq(expenses.id, parent.id));
    } catch (e) {
      console.error(`Failed to create recurring expense from ${parent.id}:`, e);
    }
  }

  if (created > 0) {
    console.log(`Recurring expenses: ${created} auto-created`);
  }
}

export function startRecurringExpenseRunner() {
  setInterval(() => {
    processRecurringExpenses().catch(e => console.error("Recurring expense runner error:", e));
  }, 60 * 60 * 1000);

  setTimeout(() => {
    processRecurringExpenses().catch(e => console.error("Recurring expense initial run error:", e));
  }, 10000);
}
