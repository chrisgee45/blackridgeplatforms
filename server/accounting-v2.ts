import { db } from "./db";
import { accountsV2, transactionsV2, transactionLinesV2 } from "@shared/schema";
import type { AccountV2 } from "@shared/schema";
import { eq, and, gte, lte, sql } from "drizzle-orm";

type SeedAccount = {
  name: string;
  type: "asset" | "liability" | "equity" | "revenue" | "expense";
  code: string;
};

const SYSTEM_ACCOUNTS: SeedAccount[] = [
  { code: "1000", name: "Cash",                type: "asset" },
  { code: "1020", name: "Stripe Clearing",     type: "asset" },

  { code: "2000", name: "Credit Card Payable", type: "liability" },
  { code: "2050", name: "Sales Tax Payable",    type: "liability" },
  { code: "2100", name: "Unearned Revenue",     type: "liability" },

  { code: "3000", name: "Owner's Equity",       type: "equity" },
  { code: "3100", name: "Owner's Draw",        type: "equity" },
  { code: "3200", name: "Owner Contribution",  type: "equity" },

  { code: "4000", name: "Website Build Income", type: "revenue" },
  { code: "4010", name: "Subscription Income",  type: "revenue" },
  { code: "4090", name: "Other Income",         type: "revenue" },

  { code: "5000", name: "Software Expense",     type: "expense" },
  { code: "5010", name: "Hosting Expense",      type: "expense" },
  { code: "5090", name: "Other Expense",        type: "expense" },

  { code: "8100", name: "Advertising & Marketing", type: "expense" },
  { code: "8200", name: "Contract Labor",          type: "expense" },
  { code: "8300", name: "Insurance",               type: "expense" },
  { code: "8400", name: "Legal & Professional",    type: "expense" },
  { code: "8500", name: "Office Expense",          type: "expense" },
  { code: "8600", name: "Supplies",                type: "expense" },
  { code: "8700", name: "Utilities",               type: "expense" },
  { code: "8800", name: "Software & Subscriptions",type: "expense" },
  { code: "8850", name: "Commissions & Fees",      type: "expense" },
  { code: "8900", name: "Travel",                  type: "expense" },
  { code: "8950", name: "Meals & Entertainment",   type: "expense" },
  { code: "9000", name: "Rent",                    type: "expense" },
  { code: "9050", name: "Wages",                   type: "expense" },
  { code: "9100", name: "Depreciation",            type: "expense" },
  { code: "9150", name: "Client Gifts",            type: "expense" },
  { code: "9200", name: "Car & Truck Expenses",    type: "expense" },
  { code: "9300", name: "Other Expenses",          type: "expense" },
];

export async function seedSystemAccounts(): Promise<{ created: number; skipped: number }> {
  let created = 0;
  let skipped = 0;

  const dupeTravel = await db.execute(sql`
    SELECT id, name FROM accounts_v2 WHERE code = '8900' ORDER BY created_at ASC
  `);
  if ((dupeTravel.rows as any[]).length > 1) {
    const keepId = (dupeTravel.rows[0] as any).id;
    for (let i = 1; i < (dupeTravel.rows as any[]).length; i++) {
      const removeId = (dupeTravel.rows[i] as any).id;
      await db.execute(sql`UPDATE journal_lines SET account_id = ${keepId} WHERE account_id = ${removeId}`);
      await db.execute(sql`DELETE FROM accounts_v2 WHERE id = ${removeId}`);
    }
    await db.execute(sql`UPDATE accounts_v2 SET name = 'Travel' WHERE id = ${keepId}`);
  } else if ((dupeTravel.rows as any[]).length === 1) {
    await db.execute(sql`UPDATE accounts_v2 SET name = 'Travel' WHERE code = '8900'`);
  }

  for (const a of SYSTEM_ACCOUNTS) {
    const byCode = await db.select({ id: accountsV2.id, name: accountsV2.name })
      .from(accountsV2)
      .where(eq(accountsV2.code, a.code))
      .limit(1);

    if (byCode.length > 0) {
      if (byCode[0].name !== a.name) {
        await db.update(accountsV2)
          .set({ name: a.name })
          .where(eq(accountsV2.id, byCode[0].id));
      }
      skipped++;
    } else {
      const byName = await db.select({ id: accountsV2.id })
        .from(accountsV2)
        .where(eq(accountsV2.name, a.name))
        .limit(1);

      if (byName.length === 0) {
        await db.insert(accountsV2).values({
          code: a.code,
          name: a.name,
          type: a.type,
          isSystem: true,
        });
        created++;
      } else {
        skipped++;
      }
    }
  }

  return { created, skipped };
}

export async function getSystemAccounts(): Promise<AccountV2[]> {
  return db.select().from(accountsV2).orderBy(accountsV2.code);
}

// === Journal Posting ===

export type JournalLine = {
  accountId: string;
  debit?: number;
  credit?: number;
  memo?: string;
};

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

function assertBalanced(lines: JournalLine[]) {
  const debits = round2(lines.reduce((s, l) => s + (l.debit ?? 0), 0));
  const credits = round2(lines.reduce((s, l) => s + (l.credit ?? 0), 0));
  if (debits !== credits) {
    throw new Error(`Journal not balanced. Debits=${debits} Credits=${credits}`);
  }
  if (debits <= 0) throw new Error("Journal must have a positive total.");
}

export async function postJournal(params: {
  occurredAt?: Date;
  memo?: string;
  referenceType?: string;
  referenceId?: string;
  lines: JournalLine[];
}) {
  assertBalanced(params.lines);

  return await db.transaction(async (tx) => {
    if (params.referenceId) {
      const [existing] = await tx.select({ id: transactionsV2.id })
        .from(transactionsV2)
        .where(eq(transactionsV2.referenceId, params.referenceId))
        .limit(1);
      if (existing) return existing;
    }

    const [t] = await tx
      .insert(transactionsV2)
      .values({
        occurredAt: params.occurredAt ?? new Date(),
        memo: params.memo,
        referenceType: params.referenceType,
        referenceId: params.referenceId,
      })
      .returning();

    const values = params.lines.map((l) => ({
      transactionId: t.id,
      accountId: l.accountId,
      debit: (l.debit ?? 0).toFixed(2),
      credit: (l.credit ?? 0).toFixed(2),
      lineMemo: l.memo,
    }));

    await tx.insert(transactionLinesV2).values(values);

    return t;
  });
}

export async function deleteTransaction(transactionId: string) {
  return await db.transaction(async (tx) => {
    await tx.delete(transactionLinesV2).where(eq(transactionLinesV2.transactionId, transactionId));
    const [deleted] = await tx.delete(transactionsV2).where(eq(transactionsV2.id, transactionId)).returning();
    return deleted ?? null;
  });
}

export async function getAccountIdByName(name: string): Promise<string> {
  const [acct] = await db.select({ id: accountsV2.id })
    .from(accountsV2)
    .where(eq(accountsV2.name, name))
    .limit(1);
  if (!acct) throw new Error(`Account not found: ${name}`);
  return acct.id;
}

export async function getAccountIdByCode(code: string): Promise<string> {
  const [acct] = await db.select({ id: accountsV2.id })
    .from(accountsV2)
    .where(eq(accountsV2.code, code))
    .limit(1);
  if (!acct) throw new Error(`Account not found for code: ${code}`);
  return acct.id;
}

// === Revenue & Expense Helpers ===

type PaymentMethod = "cash" | "credit_card" | "stripe" | "ach" | "check";

export async function recordRevenue(input: {
  amount: number;
  revenueAccountId: string;
  occurredAt?: Date;
  memo?: string;
  paymentMethod: PaymentMethod;
  salesTaxAmount?: number;
  isDeposit?: boolean;
  referenceType?: string;
  referenceId?: string;
}) {
  const amt = input.amount;
  const tax = input.salesTaxAmount ?? 0;
  const net = amt - tax;

  if (amt <= 0) throw new Error("Revenue amount must be > 0");
  if (tax < 0) throw new Error("Sales tax cannot be negative");
  if (net < 0) throw new Error("Sales tax cannot exceed total amount");

  const cashId = await getAccountIdByName("Cash");
  const stripeClearingId = await getAccountIdByName("Stripe Clearing");
  const salesTaxPayableId = await getAccountIdByName("Sales Tax Payable");
  const unearnedRevenueId = await getAccountIdByName("Unearned Revenue");

  const debitAccount =
    input.paymentMethod === "stripe" ? stripeClearingId : cashId;

  const creditRevenueAccount =
    input.isDeposit ? unearnedRevenueId : input.revenueAccountId;

  const lines: JournalLine[] = [];

  lines.push({ accountId: debitAccount, debit: amt, memo: `Payment (${input.paymentMethod})` });

  if (net > 0) {
    lines.push({ accountId: creditRevenueAccount, credit: net, memo: input.isDeposit ? "Deposit (unearned)" : "Revenue" });
  }

  if (tax > 0) {
    lines.push({ accountId: salesTaxPayableId, credit: tax, memo: "Sales tax collected" });
  }

  return postJournal({
    occurredAt: input.occurredAt,
    memo: input.memo ?? "Revenue",
    referenceType: input.referenceType ?? "revenue",
    referenceId: input.referenceId,
    lines,
  });
}

export async function recordExpense(input: {
  amount: number;
  expenseAccountId: string;
  occurredAt?: Date;
  memo?: string;
  paymentMethod: "cash" | "credit_card";
  referenceType?: string;
  referenceId?: string;
}) {
  if (input.amount <= 0) throw new Error("Expense amount must be > 0");

  const cashId = await getAccountIdByName("Cash");
  const ccPayableId = await getAccountIdByName("Credit Card Payable");

  const creditAccount = input.paymentMethod === "credit_card" ? ccPayableId : cashId;

  return postJournal({
    occurredAt: input.occurredAt,
    memo: input.memo ?? "Expense",
    referenceType: input.referenceType ?? "expense",
    referenceId: input.referenceId,
    lines: [
      { accountId: input.expenseAccountId, debit: input.amount, memo: "Expense" },
      { accountId: creditAccount, credit: input.amount, memo: `Paid via ${input.paymentMethod}` },
    ],
  });
}

export async function recordOwnerDraw(input: {
  amount: number;
  occurredAt?: Date;
  memo?: string;
  referenceId?: string;
}) {
  if (!Number.isFinite(input.amount) || input.amount <= 0) throw new Error("Draw amount must be a positive number");

  const cashId = await getAccountIdByName("Cash");
  const drawId = await getAccountIdByName("Owner's Draw");

  return postJournal({
    occurredAt: input.occurredAt,
    memo: input.memo ?? "Owner's draw",
    referenceType: "owner_draw",
    referenceId: input.referenceId,
    lines: [
      { accountId: drawId, debit: input.amount, memo: "Owner's draw" },
      { accountId: cashId, credit: input.amount, memo: "Cash out" },
    ],
  });
}

// === Reporting / Queries ===

export async function getAccountActivity(params: {
  start: Date;
  end: Date;
}) {
  const rows = await db
    .select({
      accountId: accountsV2.id,
      name: accountsV2.name,
      type: accountsV2.type,
      code: accountsV2.code,
      debit: sql<string>`COALESCE(SUM(${transactionLinesV2.debit}), 0)`,
      credit: sql<string>`COALESCE(SUM(${transactionLinesV2.credit}), 0)`,
    })
    .from(transactionLinesV2)
    .innerJoin(transactionsV2, eq(transactionLinesV2.transactionId, transactionsV2.id))
    .innerJoin(accountsV2, eq(transactionLinesV2.accountId, accountsV2.id))
    .where(
      and(
        gte(transactionsV2.occurredAt, params.start),
        lte(transactionsV2.occurredAt, params.end)
      )
    )
    .groupBy(accountsV2.id, accountsV2.name, accountsV2.type, accountsV2.code);

  return rows.map((r) => {
    const debit = Number(r.debit);
    const credit = Number(r.credit);

    const normal =
      r.type === "asset" || r.type === "expense"
        ? debit - credit
        : credit - debit;

    return {
      ...r,
      debit,
      credit,
      amount: Math.round(normal * 100) / 100,
    };
  });
}

export async function getIncomeStatement(params: {
  start: Date;
  end: Date;
}) {
  const activity = await getAccountActivity(params);

  const revenue = activity.filter((a) => a.type === "revenue");
  const expenses = activity.filter((a) => a.type === "expense");

  const totalRevenue = revenue.reduce((s, a) => s + a.amount, 0);
  const totalExpenses = expenses.reduce((s, a) => s + a.amount, 0);
  const netIncome = Math.round((totalRevenue - totalExpenses) * 100) / 100;

  return { revenue, expenses, totalRevenue, totalExpenses, netIncome };
}

export async function getBalanceSheetAsOf(params: {
  asOf: Date;
}) {
  const activity = await getAccountActivity({
    start: new Date("2000-01-01"),
    end: params.asOf,
  });

  const assets = activity.filter((a) => a.type === "asset");
  const liabilities = activity.filter((a) => a.type === "liability");
  const equity = activity.filter((a) => a.type === "equity");

  const totalAssets = assets.reduce((s, a) => s + a.amount, 0);
  const totalLiabilities = liabilities.reduce((s, a) => s + a.amount, 0);
  const totalEquity = equity.reduce((s, a) => s + a.amount, 0);

  return {
    assets,
    liabilities,
    equity,
    totalAssets,
    totalLiabilities,
    totalEquity,
  };
}

// === Account Drilldown ===

function toNum(v: any): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

export async function getAccountDrilldown(params: {
  accountId: string;
  start?: Date;
  end?: Date;
  limit?: number;
  offset?: number;
}) {
  const limit = Math.min(Math.max(params.limit ?? 200, 1), 500);
  const offset = Math.max(params.offset ?? 0, 0);

  const whereParts: any[] = [eq(transactionLinesV2.accountId, params.accountId)];
  if (params.start) whereParts.push(gte(transactionsV2.occurredAt, params.start));
  if (params.end) whereParts.push(lte(transactionsV2.occurredAt, params.end));

  const rows = await db
    .select({
      occurredAt: transactionsV2.occurredAt,
      transactionId: transactionsV2.id,
      transactionMemo: transactionsV2.memo,
      referenceType: transactionsV2.referenceType,
      referenceId: transactionsV2.referenceId,
      lineMemo: transactionLinesV2.lineMemo,
      debit: transactionLinesV2.debit,
      credit: transactionLinesV2.credit,
    })
    .from(transactionLinesV2)
    .innerJoin(transactionsV2, eq(transactionLinesV2.transactionId, transactionsV2.id))
    .where(and(...whereParts))
    .orderBy(sql`${transactionsV2.occurredAt} DESC`, sql`${transactionsV2.id} DESC`)
    .limit(limit)
    .offset(offset);

  const [acct] = await db.select().from(accountsV2).where(eq(accountsV2.id, params.accountId)).limit(1);
  if (!acct) throw new Error("Account not found");

  const isNormalDebit = acct.type === "asset" || acct.type === "expense";

  let running = 0;

  const items = rows.map((r) => {
    const debit = toNum(r.debit);
    const credit = toNum(r.credit);
    const delta = isNormalDebit ? (debit - credit) : (credit - debit);
    running = Math.round((running + delta) * 100) / 100;

    return {
      occurredAt: r.occurredAt,
      transactionId: r.transactionId,
      transactionMemo: r.transactionMemo,
      referenceType: r.referenceType,
      referenceId: r.referenceId,
      lineMemo: r.lineMemo,
      debit,
      credit,
      delta,
      runningBalance: running,
    };
  });

  return {
    account: { id: acct.id, name: acct.name, type: acct.type, code: acct.code },
    limit,
    offset,
    items,
  };
}

// === Backfill from existing project & stripe payments ===

export async function backfillV2FromPayments() {
  const { projectPayments, stripePayments } = await import("@shared/schema");
  const { desc } = await import("drizzle-orm");

  const revenueAcctId = await getAccountIdByCode("4000");
  let created = 0;

  const existingRefs = await db
    .select({ referenceId: transactionsV2.referenceId })
    .from(transactionsV2)
    .where(sql`${transactionsV2.referenceId} IS NOT NULL`);
  const refSet = new Set(existingRefs.map(r => r.referenceId));

  const projPayments = await db.select().from(projectPayments).where(
    and(eq(projectPayments.status, "received"), eq(projectPayments.ledgerExcluded, false))
  );

  for (const pp of projPayments) {
    const refId = `project_payment_${pp.id}`;
    if (refSet.has(refId)) continue;

    await recordRevenue({
      amount: pp.amount,
      revenueAccountId: revenueAcctId,
      paymentMethod: "cash",
      occurredAt: pp.receivedDate ?? pp.createdAt ?? new Date(),
      memo: `Project payment: ${pp.label} ($${pp.amount})`,
      referenceType: "project_payment",
      referenceId: refId,
    });
    created++;
  }

  const subRevenueAcctId = await getAccountIdByCode("4010");
  const stripeRows = await db.select().from(stripePayments).where(eq(stripePayments.status, "succeeded"));

  for (const sp of stripeRows) {
    const refId = `stripe_payment_${sp.id}`;
    if (refSet.has(refId)) continue;

    const amt = Number(sp.amount);
    if (!amt || amt <= 0) continue;

    const isSubscription = (sp as any).paymentType === "recurring" || (sp as any).subscriptionId;
    await recordRevenue({
      amount: amt,
      revenueAccountId: isSubscription ? subRevenueAcctId : revenueAcctId,
      paymentMethod: "stripe",
      occurredAt: sp.paidAt ?? sp.createdAt ?? new Date(),
      memo: `Stripe payment: ${sp.description || "Payment"} ($${amt})`,
      referenceType: "stripe_payment",
      referenceId: refId,
    });
    created++;
  }

  const { expenses, accounts } = await import("@shared/schema");
  const allExpenses = await db.select().from(expenses);
  for (const exp of allExpenses) {
    const refId = `expense_${exp.id}`;
    if (refSet.has(refId)) continue;

    const amt = Number(exp.amount);
    if (!amt || amt <= 0) continue;

    let v2ExpenseAccountId: string;
    try {
      const [legacyAcct] = await db.select().from(accounts).where(eq(accounts.id, exp.accountId)).limit(1);
      v2ExpenseAccountId = await getAccountIdByCode(legacyAcct?.accountNumber || "5090");
    } catch {
      v2ExpenseAccountId = await getAccountIdByCode("5090");
    }

    await recordExpense({
      amount: amt,
      expenseAccountId: v2ExpenseAccountId,
      paymentMethod: "cash",
      occurredAt: exp.date ?? exp.createdAt ?? new Date(),
      memo: exp.description || "Expense",
      referenceType: "expense",
      referenceId: refId,
    });
    created++;
  }

  const { journalEntries: je, journalLines: jl } = await import("@shared/schema");
  const ownerDrawEntries = await db.select().from(je).where(eq(je.sourceType, "owner_draw"));
  for (const od of ownerDrawEntries) {
    const refId = `owner_draw_${od.id}`;
    if (refSet.has(refId)) continue;

    const lines = await db.select().from(jl).where(eq(jl.journalEntryId, od.id));
    const totalDebit = lines.reduce((s, l) => s + Number(l.debit || 0), 0);
    if (totalDebit <= 0) continue;

    await recordOwnerDraw({
      amount: totalDebit,
      occurredAt: od.date ?? od.createdAt ?? new Date(),
      memo: od.memo || "Owner's draw",
      referenceId: refId,
    });
    created++;
  }

  console.log(`Accounting v2 backfill: ${created} payments posted to ledger`);
  return created;
}

// === Cash Flow (from Cash account activity) ===

export async function getCashFlow(start: Date, end: Date) {
  const [cashAcct] = await db.select().from(accountsV2).where(eq(accountsV2.code, "1000")).limit(1);
  if (!cashAcct) return { inflows: [], outflows: [], netCashFlow: 0 };

  const rows = await db
    .select({
      transactionMemo: transactionsV2.memo,
      referenceType: transactionsV2.referenceType,
      debit: transactionLinesV2.debit,
      credit: transactionLinesV2.credit,
    })
    .from(transactionLinesV2)
    .innerJoin(transactionsV2, eq(transactionLinesV2.transactionId, transactionsV2.id))
    .where(
      and(
        eq(transactionLinesV2.accountId, cashAcct.id),
        gte(transactionsV2.occurredAt, start),
        lte(transactionsV2.occurredAt, end)
      )
    );

  const inflows: { description: string; amount: number }[] = [];
  const outflows: { description: string; amount: number }[] = [];

  for (const r of rows) {
    const debit = Number(r.debit ?? 0);
    const credit = Number(r.credit ?? 0);
    if (debit > 0) inflows.push({ description: r.transactionMemo || "Cash in", amount: debit });
    if (credit > 0) outflows.push({ description: r.transactionMemo || "Cash out", amount: credit });
  }

  const totalIn = inflows.reduce((s, i) => s + i.amount, 0);
  const totalOut = outflows.reduce((s, i) => s + i.amount, 0);

  return { inflows, outflows, netCashFlow: Math.round((totalIn - totalOut) * 100) / 100 };
}

// === Transactions List (General Ledger) ===

export async function getTransactionsList(start: Date, end: Date) {
  const { projectPayments, projects, clients, stripePayments } = await import("@shared/schema");

  const txRows = await db
    .select()
    .from(transactionsV2)
    .where(and(gte(transactionsV2.occurredAt, start), lte(transactionsV2.occurredAt, end)))
    .orderBy(sql`${transactionsV2.occurredAt} DESC`);

  const results = [];
  for (const tx of txRows) {
    const lines = await db
      .select({
        accountName: accountsV2.name,
        debit: transactionLinesV2.debit,
        credit: transactionLinesV2.credit,
      })
      .from(transactionLinesV2)
      .innerJoin(accountsV2, eq(transactionLinesV2.accountId, accountsV2.id))
      .where(eq(transactionLinesV2.transactionId, tx.id));

    const totalDebits = lines.reduce((s, l) => s + Number(l.debit ?? 0), 0);
    const totalCredits = lines.reduce((s, l) => s + Number(l.credit ?? 0), 0);

    let clientName: string | null = null;
    let projectName: string | null = null;
    let paymentLabel: string | null = null;

    if (tx.referenceId) {
      if (tx.referenceType === "project_payment") {
        const ppId = tx.referenceId.replace("project_payment_", "");
        const [pp] = await db.select({
          label: projectPayments.label,
          type: projectPayments.type,
          projectId: projectPayments.projectId,
        }).from(projectPayments).where(eq(projectPayments.id, ppId)).limit(1);
        if (pp) {
          paymentLabel = pp.label || pp.type;
          const [proj] = await db.select({
            name: projects.name,
            clientId: projects.clientId,
          }).from(projects).where(eq(projects.id, pp.projectId)).limit(1);
          if (proj) {
            projectName = proj.name;
            if (proj.clientId) {
              const [cl] = await db.select({ name: clients.name }).from(clients).where(eq(clients.id, proj.clientId)).limit(1);
              if (cl) clientName = cl.name;
            }
          }
        }
      } else if (tx.referenceType === "stripe_payment") {
        const spId = tx.referenceId.replace("stripe_payment_", "");
        const [sp] = await db.select({
          description: stripePayments.description,
          clientId: stripePayments.clientId,
          projectId: stripePayments.projectId,
        }).from(stripePayments).where(eq(stripePayments.id, spId)).limit(1);
        if (sp) {
          paymentLabel = sp.description || "Stripe payment";
          if (sp.clientId) {
            const [cl] = await db.select({ name: clients.name }).from(clients).where(eq(clients.id, sp.clientId)).limit(1);
            if (cl) clientName = cl.name;
          }
          if (sp.projectId) {
            const [proj] = await db.select({ name: projects.name }).from(projects).where(eq(projects.id, sp.projectId)).limit(1);
            if (proj) projectName = proj.name;
          }
        }
      }
    }

    results.push({
      id: tx.id,
      date: tx.occurredAt,
      memo: tx.memo,
      source: tx.referenceType,
      status: "posted",
      totalDebits,
      totalCredits,
      clientName,
      projectName,
      paymentLabel,
      lines: lines.map(l => ({
        accountName: l.accountName,
        debit: Number(l.debit ?? 0),
        credit: Number(l.credit ?? 0),
      })),
    });
  }

  return results;
}
