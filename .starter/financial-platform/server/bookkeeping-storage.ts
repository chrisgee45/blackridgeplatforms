import {
  accounts, journalEntries, journalLines, vendors, expenses, bills, billPayments,
  taxSettings, quarterlyTaxPayments,
  type InsertAccount, type Account,
  type InsertJournalEntry, type JournalEntry,
  type InsertJournalLine, type JournalLine,
  type InsertVendor, type Vendor,
  type InsertExpense, type Expense,
  type InsertBill, type Bill,
  type InsertBillPayment, type BillPayment,
  type TaxSettings,
  type InsertQuarterlyTaxPayment, type QuarterlyTaxPayment,
} from "@shared/schema";
import { db } from "./db";
import { eq, desc, asc, and, sql, gte, lte } from "drizzle-orm";

export class BookkeepingStorage {

  async getAccounts(): Promise<Account[]> {
    return db.select().from(accounts).orderBy(asc(accounts.accountNumber));
  }

  async getAccount(id: string): Promise<Account | undefined> {
    const [account] = await db.select().from(accounts).where(eq(accounts.id, id));
    return account;
  }

  async getAccountByNumber(accountNumber: string): Promise<Account | undefined> {
    const [account] = await db.select().from(accounts).where(eq(accounts.accountNumber, accountNumber));
    return account;
  }

  async createAccount(data: InsertAccount): Promise<Account> {
    const [account] = await db.insert(accounts).values(data).returning();
    return account;
  }

  async updateAccount(id: string, data: Partial<InsertAccount>): Promise<Account | undefined> {
    const [account] = await db.update(accounts).set(data).where(eq(accounts.id, id)).returning();
    return account;
  }

  async getAccountBalances(startDate?: Date, endDate?: Date): Promise<Array<Account & { totalDebit: string; totalCredit: string; balance: string }>> {
    const conditions = [sql`je.is_void = false`];
    if (startDate) conditions.push(sql`je.date >= ${startDate}`);
    if (endDate) conditions.push(sql`je.date <= ${endDate}`);
    const whereClause = sql.join(conditions, sql` AND `);

    const result = await db.execute(sql`
      SELECT a.*,
        COALESCE(SUM(jl.debit), 0) as total_debit,
        COALESCE(SUM(jl.credit), 0) as total_credit,
        CASE WHEN a.normal_balance = 'debit'
          THEN COALESCE(SUM(jl.debit), 0) - COALESCE(SUM(jl.credit), 0)
          ELSE COALESCE(SUM(jl.credit), 0) - COALESCE(SUM(jl.debit), 0)
        END as balance
      FROM accounts a
      LEFT JOIN journal_lines jl ON jl.account_id = a.id
      LEFT JOIN journal_entries je ON je.id = jl.journal_entry_id AND ${whereClause}
      WHERE a.is_active = true
      GROUP BY a.id
      ORDER BY a.account_number
    `);
    return result.rows as any;
  }

  async getTrialBalance(asOfDate?: Date): Promise<Array<{ accountNumber: string; name: string; type: string; debit: string; credit: string }>> {
    const dateCondition = asOfDate ? sql`AND je.date <= ${asOfDate}` : sql``;
    const result = await db.execute(sql`
      SELECT a.account_number, a.name, a.type, a.normal_balance,
        COALESCE(SUM(jl.debit), 0) as total_debit,
        COALESCE(SUM(jl.credit), 0) as total_credit,
        CASE WHEN a.normal_balance = 'debit'
          THEN GREATEST(COALESCE(SUM(jl.debit), 0) - COALESCE(SUM(jl.credit), 0), 0)
          ELSE 0
        END as debit,
        CASE WHEN a.normal_balance = 'credit'
          THEN GREATEST(COALESCE(SUM(jl.credit), 0) - COALESCE(SUM(jl.debit), 0), 0)
          ELSE 0
        END as credit
      FROM accounts a
      LEFT JOIN journal_lines jl ON jl.account_id = a.id
      LEFT JOIN journal_entries je ON je.id = jl.journal_entry_id AND je.is_void = false ${dateCondition}
      WHERE a.is_active = true
      GROUP BY a.id, a.account_number, a.name, a.type, a.normal_balance
      HAVING COALESCE(SUM(jl.debit), 0) != 0 OR COALESCE(SUM(jl.credit), 0) != 0
      ORDER BY a.account_number
    `);
    return result.rows as any;
  }

  async getJournalEntries(startDate?: Date, endDate?: Date): Promise<JournalEntry[]> {
    const conditions: any[] = [];
    if (startDate) conditions.push(gte(journalEntries.date, startDate));
    if (endDate) conditions.push(lte(journalEntries.date, endDate));
    const where = conditions.length > 0 ? and(...conditions) : undefined;
    return db.select().from(journalEntries)
      .where(where)
      .orderBy(desc(journalEntries.date));
  }

  async getJournalEntry(id: string): Promise<JournalEntry | undefined> {
    const [entry] = await db.select().from(journalEntries).where(eq(journalEntries.id, id));
    return entry;
  }

  async getJournalLines(journalEntryId: string): Promise<JournalLine[]> {
    return db.select().from(journalLines).where(eq(journalLines.journalEntryId, journalEntryId));
  }

  async createJournalEntryWithLines(
    entry: InsertJournalEntry,
    lines: Omit<InsertJournalLine, "journalEntryId">[]
  ): Promise<{ entry: JournalEntry; lines: JournalLine[] }> {
    const totalDebit = lines.reduce((sum, l) => sum + parseFloat(String(l.debit || 0)), 0);
    const totalCredit = lines.reduce((sum, l) => sum + parseFloat(String(l.credit || 0)), 0);
    if (Math.abs(totalDebit - totalCredit) > 0.01) {
      throw new Error(`Journal entry not balanced: debits=${totalDebit}, credits=${totalCredit}`);
    }

    const [createdEntry] = await db.insert(journalEntries).values(entry).returning();
    const createdLines: JournalLine[] = [];
    for (const line of lines) {
      const [createdLine] = await db.insert(journalLines).values({
        ...line,
        journalEntryId: createdEntry.id,
      }).returning();
      createdLines.push(createdLine);
    }
    return { entry: createdEntry, lines: createdLines };
  }

  async voidJournalEntry(id: string): Promise<JournalEntry | undefined> {
    const [entry] = await db.update(journalEntries)
      .set({ isVoid: true })
      .where(eq(journalEntries.id, id))
      .returning();
    return entry;
  }

  async getVendors(): Promise<Vendor[]> {
    return db.select().from(vendors).orderBy(asc(vendors.name));
  }

  async getVendor(id: string): Promise<Vendor | undefined> {
    const [vendor] = await db.select().from(vendors).where(eq(vendors.id, id));
    return vendor;
  }

  async createVendor(data: InsertVendor): Promise<Vendor> {
    const [vendor] = await db.insert(vendors).values(data).returning();
    return vendor;
  }

  async updateVendor(id: string, data: Partial<InsertVendor>): Promise<Vendor | undefined> {
    const [vendor] = await db.update(vendors).set(data).where(eq(vendors.id, id)).returning();
    return vendor;
  }

  async getExpenses(filters?: { startDate?: Date; endDate?: Date; accountId?: string; vendorId?: string }): Promise<Expense[]> {
    const conditions: any[] = [];
    if (filters?.startDate) conditions.push(gte(expenses.date, filters.startDate));
    if (filters?.endDate) conditions.push(lte(expenses.date, filters.endDate));
    if (filters?.accountId) conditions.push(eq(expenses.accountId, filters.accountId));
    if (filters?.vendorId) conditions.push(eq(expenses.vendorId, filters.vendorId));
    const where = conditions.length > 0 ? and(...conditions) : undefined;
    return db.select().from(expenses).where(where).orderBy(desc(expenses.date));
  }

  async createExpense(data: InsertExpense): Promise<Expense> {
    const [expense] = await db.insert(expenses).values(data).returning();
    return expense;
  }

  async updateExpense(id: string, data: Partial<InsertExpense>): Promise<Expense | undefined> {
    const [expense] = await db.update(expenses).set(data).where(eq(expenses.id, id)).returning();
    return expense;
  }

  async deleteExpense(id: string): Promise<boolean> {
    const [expense] = await db.select().from(expenses).where(eq(expenses.id, id));
    if (expense?.journalEntryId) {
      await this.voidJournalEntry(expense.journalEntryId);
    }
    const result = await db.delete(expenses).where(eq(expenses.id, id)).returning();
    return result.length > 0;
  }

  async getCreditAccountForFundingSource(fundingSource?: string | null): Promise<Account> {
    let acctNumber = "1000";
    if (fundingSource === "personal") acctNumber = "3200";
    else if (fundingSource === "business_credit_card") acctNumber = "2100";
    const account = await this.getAccountByNumber(acctNumber);
    if (!account) {
      const fallback = await this.getAccountByNumber("1000");
      if (!fallback) throw new Error("Cash account not found - seed chart of accounts first");
      return fallback;
    }
    return account;
  }

  async createExpenseWithJournal(data: InsertExpense): Promise<Expense> {
    const creditAccount = await this.getCreditAccountForFundingSource(data.fundingSource);

    const { entry } = await this.createJournalEntryWithLines(
      {
        date: data.date,
        memo: data.description,
        sourceType: "expense",
        createdBy: "admin",
      },
      [
        { accountId: data.accountId, debit: String(data.amount), credit: "0", memo: data.description },
        { accountId: creditAccount.id, debit: "0", credit: String(data.amount), memo: data.description },
      ]
    );

    const [expense] = await db.insert(expenses).values({ ...data, journalEntryId: entry.id }).returning();
    await db.update(journalEntries).set({ sourceId: expense.id }).where(eq(journalEntries.id, entry.id));
    return expense;
  }

  async getBills(filters?: { status?: string; vendorId?: string }): Promise<Bill[]> {
    const conditions: any[] = [];
    if (filters?.status) conditions.push(eq(bills.status, filters.status as any));
    if (filters?.vendorId) conditions.push(eq(bills.vendorId, filters.vendorId));
    const where = conditions.length > 0 ? and(...conditions) : undefined;
    return db.select().from(bills).where(where).orderBy(desc(bills.dueDate));
  }

  async createBill(data: InsertBill): Promise<Bill> {
    const apAccount = await this.getAccountByNumber("2000");
    if (!apAccount) throw new Error("AP account not found");

    const expenseAccount = data.accountId ? await this.getAccount(data.accountId) : null;
    const targetAccountId = expenseAccount?.id || (await this.getAccountByNumber("8500"))?.id;
    if (!targetAccountId) throw new Error("No expense account found");

    const { entry } = await this.createJournalEntryWithLines(
      { date: data.dueDate, memo: data.description || "Bill", sourceType: "bill", createdBy: "admin" },
      [
        { accountId: targetAccountId, debit: String(data.amount), credit: "0", memo: data.description },
        { accountId: apAccount.id, debit: "0", credit: String(data.amount), memo: data.description },
      ]
    );

    const [bill] = await db.insert(bills).values({ ...data, journalEntryId: entry.id }).returning();
    await db.update(journalEntries).set({ sourceId: bill.id }).where(eq(journalEntries.id, entry.id));
    return bill;
  }

  async getBill(id: string): Promise<Bill | undefined> {
    const [bill] = await db.select().from(bills).where(eq(bills.id, id));
    return bill;
  }

  async updateBill(id: string, data: Partial<InsertBill>): Promise<Bill | undefined> {
    const [bill] = await db.update(bills).set(data).where(eq(bills.id, id)).returning();
    return bill;
  }

  async deleteBill(id: string): Promise<boolean> {
    const [bill] = await db.select().from(bills).where(eq(bills.id, id));
    if (!bill) return false;

    const payments = await db.select().from(billPayments).where(eq(billPayments.billId, id));
    for (const p of payments) {
      if (p.journalEntryId) {
        await this.voidJournalEntry(p.journalEntryId);
      }
    }

    if (bill.journalEntryId) {
      await this.voidJournalEntry(bill.journalEntryId);
    }
    await db.delete(billPayments).where(eq(billPayments.billId, id));
    const result = await db.delete(bills).where(eq(bills.id, id)).returning();
    return result.length > 0;
  }

  async getBillPayments(billId: string): Promise<BillPayment[]> {
    return db.select().from(billPayments).where(eq(billPayments.billId, billId)).orderBy(desc(billPayments.paidAt));
  }

  async recordBillPayment(billId: string, paymentAmount: number, paymentMethod: string = "cash", memo?: string): Promise<{ bill: Bill; payment: BillPayment }> {
    const [bill] = await db.select().from(bills).where(eq(bills.id, billId));
    if (!bill) throw new Error("Bill not found");

    const totalBill = Number(bill.amount);
    const alreadyPaid = Number(bill.paidAmount);
    const remaining = totalBill - alreadyPaid;

    if (paymentAmount <= 0) throw new Error("Payment amount must be positive");
    if (paymentAmount > remaining + 0.01) throw new Error(`Payment ($${paymentAmount}) exceeds remaining balance ($${remaining.toFixed(2)})`);

    const cashAccount = await this.getAccountByNumber("1000");
    const apAccount = await this.getAccountByNumber("2000");
    if (!cashAccount || !apAccount) throw new Error("Required accounts not found");

    const { entry } = await this.createJournalEntryWithLines(
      { date: new Date(), memo: memo || `Payment for bill: ${bill.description}`, sourceType: "bill_payment", sourceId: billId, createdBy: "admin" },
      [
        { accountId: apAccount.id, debit: String(paymentAmount), credit: "0", memo: `Bill payment` },
        { accountId: cashAccount.id, debit: "0", credit: String(paymentAmount), memo: `Cash out` },
      ]
    );

    const [payment] = await db.insert(billPayments).values({
      billId,
      amount: String(paymentAmount),
      paymentMethod,
      memo,
      journalEntryId: entry.id,
    }).returning();

    const newPaidAmount = alreadyPaid + paymentAmount;
    const newStatus = newPaidAmount >= totalBill - 0.01 ? "paid" : "partially_paid";

    const [updated] = await db.update(bills)
      .set({
        paidAmount: String(newPaidAmount),
        status: newStatus as any,
        paidDate: newStatus === "paid" ? new Date() : null,
      })
      .where(eq(bills.id, billId))
      .returning();

    return { bill: updated, payment };
  }

  async getAPaging(): Promise<{ current: any[]; days30: any[]; days60: any[]; days90: any[]; over90: any[] }> {
    const result = await db.execute(sql`
      SELECT b.id, b.amount, b.description, b.due_date, b.status, v.name as vendor_name,
        EXTRACT(DAY FROM NOW() - b.due_date) as days_outstanding
      FROM bills b
      LEFT JOIN vendors v ON v.id = b.vendor_id
      WHERE b.status IN ('pending', 'overdue')
      ORDER BY b.due_date ASC
    `);
    const rows = result.rows as any[];
    return {
      current: rows.filter(r => r.days_outstanding <= 0),
      days30: rows.filter(r => r.days_outstanding > 0 && r.days_outstanding <= 30),
      days60: rows.filter(r => r.days_outstanding > 30 && r.days_outstanding <= 60),
      days90: rows.filter(r => r.days_outstanding > 60 && r.days_outstanding <= 90),
      over90: rows.filter(r => r.days_outstanding > 90),
    };
  }

  async getIncomeStatement(startDate: Date, endDate: Date): Promise<{ revenue: any[]; expenses: any[]; totalRevenue: number; totalExpenses: number; netIncome: number }> {
    const result = await db.execute(sql`
      SELECT a.id, a.account_number, a.name, a.type, a.schedule_c_line,
        COALESCE(SUM(jl.credit) - SUM(jl.debit), 0) as balance
      FROM accounts a
      LEFT JOIN journal_lines jl ON jl.account_id = a.id
      LEFT JOIN journal_entries je ON je.id = jl.journal_entry_id
        AND je.is_void = false
        AND je.date >= ${startDate}
        AND je.date <= ${endDate}
      WHERE a.type IN ('revenue', 'expense') AND a.is_active = true
      GROUP BY a.id
      ORDER BY a.account_number
    `);
    const rows = result.rows as any[];
    const revenue = rows.filter(r => r.type === "revenue").map(r => ({ ...r, balance: Math.abs(parseFloat(r.balance || 0)) }));
    const expenseRows = rows.filter(r => r.type === "expense").map(r => ({ ...r, balance: Math.abs(parseFloat(r.balance || 0)) }));
    const totalRevenue = revenue.reduce((s: number, r: any) => s + r.balance, 0);
    const totalExpenses = expenseRows.reduce((s: number, r: any) => s + r.balance, 0);
    return { revenue, expenses: expenseRows, totalRevenue, totalExpenses, netIncome: totalRevenue - totalExpenses };
  }

  async getBalanceSheet(asOfDate: Date): Promise<{ assets: any[]; liabilities: any[]; equity: any[]; totalAssets: number; totalLiabilities: number; totalEquity: number }> {
    const result = await db.execute(sql`
      SELECT a.id, a.account_number, a.name, a.type, a.normal_balance,
        CASE WHEN a.normal_balance = 'debit'
          THEN COALESCE(SUM(jl.debit), 0) - COALESCE(SUM(jl.credit), 0)
          ELSE COALESCE(SUM(jl.credit), 0) - COALESCE(SUM(jl.debit), 0)
        END as balance
      FROM accounts a
      LEFT JOIN journal_lines jl ON jl.account_id = a.id
      LEFT JOIN journal_entries je ON je.id = jl.journal_entry_id
        AND je.is_void = false
        AND je.date <= ${asOfDate}
      WHERE a.type IN ('asset', 'liability', 'equity') AND a.is_active = true
      GROUP BY a.id
      HAVING COALESCE(SUM(jl.debit), 0) != 0 OR COALESCE(SUM(jl.credit), 0) != 0
      ORDER BY a.account_number
    `);
    const rows = result.rows as any[];
    const assets = rows.filter(r => r.type === "asset").map(r => ({ ...r, balance: parseFloat(r.balance || 0) }));
    const liabilities = rows.filter(r => r.type === "liability").map(r => ({ ...r, balance: parseFloat(r.balance || 0) }));
    const equity = rows.filter(r => r.type === "equity").map(r => ({ ...r, balance: parseFloat(r.balance || 0) }));

    const incomeResult = await db.execute(sql`
      SELECT
        COALESCE(SUM(CASE WHEN a.type = 'revenue' THEN jl.credit - jl.debit ELSE 0 END), 0) -
        COALESCE(SUM(CASE WHEN a.type = 'expense' THEN jl.debit - jl.credit ELSE 0 END), 0) as retained_earnings
      FROM journal_lines jl
      JOIN accounts a ON a.id = jl.account_id
      JOIN journal_entries je ON je.id = jl.journal_entry_id AND je.is_void = false AND je.date <= ${asOfDate}
      WHERE a.type IN ('revenue', 'expense')
    `);
    const retainedEarnings = parseFloat((incomeResult.rows[0] as any)?.retained_earnings || 0);
    if (retainedEarnings !== 0) {
      equity.push({ account_number: "3900", name: "Retained Earnings", type: "equity", balance: retainedEarnings });
    }

    return {
      assets,
      liabilities,
      equity,
      totalAssets: assets.reduce((s: number, r: any) => s + r.balance, 0),
      totalLiabilities: liabilities.reduce((s: number, r: any) => s + r.balance, 0),
      totalEquity: equity.reduce((s: number, r: any) => s + r.balance, 0),
    };
  }

  async getCashFlow(startDate: Date, endDate: Date): Promise<{ inflows: any[]; outflows: any[]; netCashFlow: number }> {
    const result = await db.execute(sql`
      SELECT je.date, je.memo, je.source_type,
        jl.debit, jl.credit
      FROM journal_lines jl
      JOIN journal_entries je ON je.id = jl.journal_entry_id AND je.is_void = false
      JOIN accounts a ON a.id = jl.account_id
      WHERE a.account_number = '1000'
        AND je.date >= ${startDate}
        AND je.date <= ${endDate}
      ORDER BY je.date DESC
    `);
    const rows = result.rows as any[];
    const inflows = rows.filter(r => parseFloat(r.debit) > 0).map(r => ({ ...r, amount: parseFloat(r.debit) }));
    const outflows = rows.filter(r => parseFloat(r.credit) > 0).map(r => ({ ...r, amount: parseFloat(r.credit) }));
    return {
      inflows,
      outflows,
      netCashFlow: inflows.reduce((s: number, r: any) => s + r.amount, 0) - outflows.reduce((s: number, r: any) => s + r.amount, 0),
    };
  }

  async getTaxSettings(): Promise<TaxSettings | null> {
    const [settings] = await db.select().from(taxSettings);
    return settings || null;
  }

  async upsertTaxSettings(data: Partial<TaxSettings>): Promise<TaxSettings> {
    const existing = await this.getTaxSettings();
    if (existing) {
      const [updated] = await db.update(taxSettings)
        .set({ ...data, updatedAt: new Date() })
        .where(eq(taxSettings.id, "default"))
        .returning();
      return updated;
    }
    const [created] = await db.insert(taxSettings).values({ id: "default", ...data } as any).returning();
    return created;
  }

  async getQuarterlyPayments(year: number): Promise<QuarterlyTaxPayment[]> {
    return db.select().from(quarterlyTaxPayments)
      .where(eq(quarterlyTaxPayments.year, year))
      .orderBy(asc(quarterlyTaxPayments.quarter));
  }

  async upsertQuarterlyPayment(data: InsertQuarterlyTaxPayment): Promise<QuarterlyTaxPayment> {
    const existing = await db.select().from(quarterlyTaxPayments)
      .where(and(eq(quarterlyTaxPayments.year, data.year), eq(quarterlyTaxPayments.quarter, data.quarter)));
    if (existing.length > 0) {
      const [updated] = await db.update(quarterlyTaxPayments)
        .set(data)
        .where(eq(quarterlyTaxPayments.id, existing[0].id))
        .returning();
      return updated;
    }
    const [created] = await db.insert(quarterlyTaxPayments).values(data).returning();
    return created;
  }

  async hasExistingJournalForSource(sourceType: string, sourceId: string): Promise<boolean> {
    const [existing] = await db.select({ id: journalEntries.id }).from(journalEntries)
      .where(and(eq(journalEntries.sourceType, sourceType), eq(journalEntries.sourceId, sourceId)))
      .limit(1);
    return !!existing;
  }

  async postManualRevenue(amount: string, description: string, date: Date, accountNumber: string) {
    let revenueAccount = await this.getAccountByNumber(accountNumber);
    if (!revenueAccount) {
      revenueAccount = await this.getAccountByNumber("4000");
    }
    if (!revenueAccount) throw new Error("Revenue account not found");

    const cashAccount = await this.getAccountByNumber("1000");
    if (!cashAccount) throw new Error("Cash account not found");

    return this.createJournalEntryWithLines(
      { date, memo: description, sourceType: "manual_revenue", createdBy: "admin" },
      [
        { accountId: cashAccount.id, debit: amount, credit: "0", memo: description },
        { accountId: revenueAccount.id, debit: "0", credit: amount, memo: description },
      ]
    );
  }

  async seedDefaultAccounts(): Promise<void> {
    const defaultAccounts: InsertAccount[] = [
      { accountNumber: "1000", name: "Cash", type: "asset", subtype: "cash", normalBalance: "debit", description: "Operating cash account" },
      { accountNumber: "1100", name: "Accounts Receivable", type: "asset", subtype: "accounts_receivable", normalBalance: "debit", description: "Money owed to the business" },
      { accountNumber: "1200", name: "Prepaid Expenses", type: "asset", subtype: "prepaid", normalBalance: "debit" },
      { accountNumber: "1500", name: "Equipment", type: "asset", subtype: "fixed_asset", normalBalance: "debit" },
      { accountNumber: "2000", name: "Accounts Payable", type: "liability", subtype: "accounts_payable", normalBalance: "credit", description: "Money owed to vendors" },
      { accountNumber: "2100", name: "Credit Card", type: "liability", subtype: "credit_card", normalBalance: "credit" },
      { accountNumber: "2200", name: "Sales Tax Payable", type: "liability", subtype: "sales_tax", normalBalance: "credit" },
      { accountNumber: "3000", name: "Owner's Equity", type: "equity", subtype: "owner_equity", normalBalance: "credit" },
      { accountNumber: "3100", name: "Owner's Draw", type: "equity", subtype: "owner_draw", normalBalance: "debit" },
      { accountNumber: "3200", name: "Owner's Contribution", type: "equity", subtype: "owner_contribution", normalBalance: "credit" },
      { accountNumber: "4000", name: "Service Revenue", type: "revenue", subtype: "service", normalBalance: "credit", scheduleCLine: "1" },
      { accountNumber: "4100", name: "Subscription Revenue", type: "revenue", subtype: "recurring", normalBalance: "credit", scheduleCLine: "1" },
      { accountNumber: "4200", name: "Other Revenue", type: "revenue", subtype: "other", normalBalance: "credit", scheduleCLine: "6" },
      { accountNumber: "5000", name: "Advertising", type: "expense", subtype: "operating", normalBalance: "debit", scheduleCLine: "8" },
      { accountNumber: "5100", name: "Contract Labor", type: "expense", subtype: "operating", normalBalance: "debit", scheduleCLine: "11" },
      { accountNumber: "5200", name: "Insurance", type: "expense", subtype: "operating", normalBalance: "debit", scheduleCLine: "15" },
      { accountNumber: "5300", name: "Legal & Professional", type: "expense", subtype: "operating", normalBalance: "debit", scheduleCLine: "17" },
      { accountNumber: "5400", name: "Office Expense", type: "expense", subtype: "operating", normalBalance: "debit", scheduleCLine: "18" },
      { accountNumber: "5500", name: "Rent or Lease", type: "expense", subtype: "operating", normalBalance: "debit", scheduleCLine: "20b" },
      { accountNumber: "5600", name: "Supplies", type: "expense", subtype: "operating", normalBalance: "debit", scheduleCLine: "22" },
      { accountNumber: "5700", name: "Utilities", type: "expense", subtype: "operating", normalBalance: "debit", scheduleCLine: "25" },
      { accountNumber: "5800", name: "Software & Subscriptions", type: "expense", subtype: "operating", normalBalance: "debit", scheduleCLine: "27a" },
      { accountNumber: "5900", name: "Travel & Meals", type: "expense", subtype: "operating", normalBalance: "debit", scheduleCLine: "24a" },
      { accountNumber: "6000", name: "Car & Truck Expenses", type: "expense", subtype: "operating", normalBalance: "debit", scheduleCLine: "9" },
      { accountNumber: "6100", name: "Depreciation", type: "expense", subtype: "operating", normalBalance: "debit", scheduleCLine: "13" },
      { accountNumber: "8500", name: "Other Expenses", type: "expense", subtype: "other", normalBalance: "debit", scheduleCLine: "27a" },
    ];

    for (const account of defaultAccounts) {
      const existing = await this.getAccountByNumber(account.accountNumber);
      if (!existing) {
        await this.createAccount(account);
      }
    }
  }
}

export const bookkeepingStorage = new BookkeepingStorage();
