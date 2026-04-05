import { sql } from "drizzle-orm";
import { pgTable, text, varchar, timestamp, integer, boolean, jsonb, pgEnum, numeric, index, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const sessions = pgTable(
  "sessions",
  {
    sid: varchar("sid").primaryKey(),
    sess: jsonb("sess").notNull(),
    expire: timestamp("expire").notNull(),
  },
  (table) => [index("IDX_session_expire").on(table.expire)]
);

export const adminUsers = pgTable("admin_users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  username: text("username").notNull().unique(),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export type AdminUser = typeof adminUsers.$inferSelect;

export const accountTypeEnum = pgEnum("account_type", [
  "asset", "liability", "equity", "revenue", "expense"
]);

export const normalBalanceEnum = pgEnum("normal_balance", [
  "debit", "credit"
]);

export const accounts = pgTable("accounts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  accountNumber: text("account_number").notNull().unique(),
  name: text("name").notNull(),
  type: accountTypeEnum("type").notNull(),
  subtype: text("subtype"),
  description: text("description"),
  isActive: boolean("is_active").notNull().default(true),
  parentAccountId: varchar("parent_account_id"),
  normalBalance: normalBalanceEnum("normal_balance").notNull(),
  scheduleCLine: text("schedule_c_line"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertAccountSchema = createInsertSchema(accounts).omit({
  id: true,
  createdAt: true,
});
export type InsertAccount = z.infer<typeof insertAccountSchema>;
export type Account = typeof accounts.$inferSelect;

export const journalEntries = pgTable("journal_entries", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  date: timestamp("date").notNull(),
  memo: text("memo"),
  reference: text("reference"),
  sourceType: text("source_type"),
  sourceId: text("source_id"),
  isReconciled: boolean("is_reconciled").notNull().default(false),
  isVoid: boolean("is_void").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow(),
  createdBy: text("created_by").default("system"),
});

export const insertJournalEntrySchema = createInsertSchema(journalEntries).omit({
  id: true,
  createdAt: true,
});
export type InsertJournalEntry = z.infer<typeof insertJournalEntrySchema>;
export type JournalEntry = typeof journalEntries.$inferSelect;

export const journalLines = pgTable("journal_lines", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  journalEntryId: varchar("journal_entry_id").references(() => journalEntries.id, { onDelete: "cascade" }).notNull(),
  accountId: varchar("account_id").references(() => accounts.id).notNull(),
  debit: numeric("debit", { precision: 12, scale: 2 }).notNull().default("0"),
  credit: numeric("credit", { precision: 12, scale: 2 }).notNull().default("0"),
  memo: text("memo"),
});

export const insertJournalLineSchema = createInsertSchema(journalLines).omit({
  id: true,
});
export type InsertJournalLine = z.infer<typeof insertJournalLineSchema>;
export type JournalLine = typeof journalLines.$inferSelect;

export const vendors = pgTable("vendors", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  email: text("email"),
  phone: text("phone"),
  address: text("address"),
  taxId: text("tax_id"),
  notes: text("notes"),
  isActive: boolean("is_active").notNull().default(true),
  is1099Contractor: boolean("is_1099_contractor").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertVendorSchema = createInsertSchema(vendors).omit({
  id: true,
  createdAt: true,
});
export type InsertVendor = z.infer<typeof insertVendorSchema>;
export type Vendor = typeof vendors.$inferSelect;

export const paymentMethodEnum = pgEnum("payment_method_type", [
  "cash", "check", "card", "transfer", "other"
]);

export const expenses = pgTable("expenses", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  vendorId: varchar("vendor_id").references(() => vendors.id),
  accountId: varchar("account_id").references(() => accounts.id).notNull(),
  description: text("description").notNull(),
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
  date: timestamp("date").notNull(),
  paymentMethod: paymentMethodEnum("payment_method").default("card"),
  checkNumber: text("check_number"),
  receiptNotes: text("receipt_notes"),
  isBillable: boolean("is_billable").default(false),
  taxDeductible: boolean("tax_deductible").default(true),
  scheduleCLine: text("schedule_c_line"),
  journalEntryId: varchar("journal_entry_id").references(() => journalEntries.id),
  isRecurring: boolean("is_recurring").default(false),
  recurringFrequency: varchar("recurring_frequency", { length: 20 }),
  recurringDayOfMonth: integer("recurring_day_of_month"),
  nextDueDate: timestamp("next_due_date"),
  recurringParentId: varchar("recurring_parent_id"),
  fundingSource: varchar("funding_source", { length: 30 }).default("business_checking"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertExpenseSchema = createInsertSchema(expenses).omit({
  id: true,
  journalEntryId: true,
  createdAt: true,
});
export type InsertExpense = z.infer<typeof insertExpenseSchema>;
export type Expense = typeof expenses.$inferSelect;

export const billStatusEnum = pgEnum("bill_status", [
  "pending", "partially_paid", "paid", "overdue", "void"
]);

export const bills = pgTable("bills", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  vendorId: varchar("vendor_id").references(() => vendors.id).notNull(),
  accountId: varchar("account_id").references(() => accounts.id),
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
  paidAmount: numeric("paid_amount", { precision: 12, scale: 2 }).notNull().default("0"),
  dueDate: timestamp("due_date").notNull(),
  paidDate: timestamp("paid_date"),
  status: billStatusEnum("status").notNull().default("pending"),
  description: text("description"),
  reference: text("reference"),
  paymentMethod: varchar("payment_method", { length: 20 }),
  journalEntryId: varchar("journal_entry_id").references(() => journalEntries.id),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertBillSchema = createInsertSchema(bills).omit({
  id: true,
  paidAmount: true,
  paidDate: true,
  journalEntryId: true,
  createdAt: true,
});
export type InsertBill = z.infer<typeof insertBillSchema>;
export type Bill = typeof bills.$inferSelect;

export const billPayments = pgTable("bill_payments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  billId: varchar("bill_id").references(() => bills.id).notNull(),
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
  paymentMethod: varchar("payment_method", { length: 20 }).notNull().default("cash"),
  memo: text("memo"),
  journalEntryId: varchar("journal_entry_id").references(() => journalEntries.id),
  paidAt: timestamp("paid_at").defaultNow(),
});

export const insertBillPaymentSchema = createInsertSchema(billPayments).omit({
  id: true,
  journalEntryId: true,
  paidAt: true,
});
export type InsertBillPayment = z.infer<typeof insertBillPaymentSchema>;
export type BillPayment = typeof billPayments.$inferSelect;

export const taxSettings = pgTable("tax_settings", {
  id: varchar("id").primaryKey().default(sql`'default'`),
  federalRate: numeric("federal_rate", { precision: 5, scale: 2 }).notNull().default("22"),
  stateRate: numeric("state_rate", { precision: 5, scale: 2 }).notNull().default("0"),
  stateName: text("state_name"),
  filingType: text("filing_type").notNull().default("sole_prop"),
  selfEmploymentRate: numeric("self_employment_rate", { precision: 5, scale: 2 }).notNull().default("15.3"),
  qbiDeduction: boolean("qbi_deduction").notNull().default(true),
  taxpayerName: text("taxpayer_name"),
  taxpayerSSN: text("taxpayer_ssn"),
  spouseName: text("spouse_name"),
  spouseSSN: text("spouse_ssn"),
  address: text("address"),
  city: text("city"),
  taxState: text("tax_state"),
  zip: text("zip"),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export type TaxSettings = typeof taxSettings.$inferSelect;

export const quarterlyTaxPayments = pgTable("quarterly_tax_payments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  year: integer("year").notNull(),
  quarter: integer("quarter").notNull(),
  dueDate: timestamp("due_date").notNull(),
  estimatedAmount: numeric("estimated_amount", { precision: 12, scale: 2 }).notNull().default("0"),
  paidAmount: numeric("paid_amount", { precision: 12, scale: 2 }).notNull().default("0"),
  paidDate: timestamp("paid_date"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertQuarterlyTaxPaymentSchema = createInsertSchema(quarterlyTaxPayments).omit({
  id: true,
  createdAt: true,
});
export type InsertQuarterlyTaxPayment = z.infer<typeof insertQuarterlyTaxPaymentSchema>;
export type QuarterlyTaxPayment = typeof quarterlyTaxPayments.$inferSelect;

export const accountTypeEnumV2 = pgEnum("account_type_v2", [
  "asset", "liability", "equity", "revenue", "expense",
]);

export const paymentMethodEnumV2 = pgEnum("payment_method_v2", [
  "cash", "credit_card", "stripe", "ach", "check",
]);

export const accountsV2 = pgTable(
  "accounts_v2",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    code: varchar("code", { length: 32 }),
    name: text("name").notNull(),
    type: accountTypeEnumV2("type").notNull(),
    isSystem: boolean("is_system").notNull().default(false),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    nameUniq: uniqueIndex("accounts_v2_name_uniq").on(t.name),
    typeIdx: index("accounts_v2_type_idx").on(t.type),
  })
);

export const insertAccountV2Schema = createInsertSchema(accountsV2).omit({
  id: true,
  createdAt: true,
});
export type InsertAccountV2 = z.infer<typeof insertAccountV2Schema>;
export type AccountV2 = typeof accountsV2.$inferSelect;

export const transactionsV2 = pgTable(
  "transactions_v2",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    occurredAt: timestamp("occurred_at").notNull().defaultNow(),
    memo: text("memo"),
    referenceType: varchar("reference_type", { length: 32 }),
    referenceId: varchar("reference_id"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    occurredIdx: index("tx_v2_occurred_idx").on(t.occurredAt),
    refIdx: uniqueIndex("tx_v2_ref_unique_idx").on(t.referenceId).where(sql`reference_id IS NOT NULL`),
  })
);

export const insertTransactionV2Schema = createInsertSchema(transactionsV2).omit({
  id: true,
  createdAt: true,
});
export type InsertTransactionV2 = z.infer<typeof insertTransactionV2Schema>;
export type TransactionV2 = typeof transactionsV2.$inferSelect;

export const transactionLinesV2 = pgTable(
  "transaction_lines_v2",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    transactionId: varchar("transaction_id")
      .notNull()
      .references(() => transactionsV2.id, { onDelete: "cascade" }),
    accountId: varchar("account_id")
      .notNull()
      .references(() => accountsV2.id),
    debit: numeric("debit", { precision: 14, scale: 2 }).notNull().default("0"),
    credit: numeric("credit", { precision: 14, scale: 2 }).notNull().default("0"),
    lineMemo: text("line_memo"),
  },
  (t) => ({
    txIdx: index("lines_v2_tx_idx").on(t.transactionId),
    acctIdx: index("lines_v2_acct_idx").on(t.accountId),
    acctTxIdx: index("lines_v2_acct_tx_idx").on(t.accountId, t.transactionId),
  })
);

export const insertTransactionLineV2Schema = createInsertSchema(transactionLinesV2).omit({
  id: true,
});
export type InsertTransactionLineV2 = z.infer<typeof insertTransactionLineV2Schema>;
export type TransactionLineV2 = typeof transactionLinesV2.$inferSelect;

export const reconciliations = pgTable("reconciliations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  accountId: varchar("account_id").notNull().references(() => accountsV2.id),
  statementDate: timestamp("statement_date").notNull(),
  statementBalance: numeric("statement_balance", { precision: 14, scale: 2 }).notNull(),
  clearedBalance: numeric("cleared_balance", { precision: 14, scale: 2 }).notNull(),
  itemCount: integer("item_count").notNull().default(0),
  completedAt: timestamp("completed_at").notNull().defaultNow(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertReconciliationSchema = createInsertSchema(reconciliations).omit({
  id: true,
  createdAt: true,
});
export type InsertReconciliation = z.infer<typeof insertReconciliationSchema>;
export type Reconciliation = typeof reconciliations.$inferSelect;

export const reconciliationItems = pgTable("reconciliation_items", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  reconciliationId: varchar("reconciliation_id").notNull().references(() => reconciliations.id, { onDelete: "cascade" }),
  transactionLineId: varchar("transaction_line_id").notNull().references(() => transactionLinesV2.id),
});

export type ReconciliationItem = typeof reconciliationItems.$inferSelect;

export const budgets = pgTable("budgets", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  accountId: varchar("account_id").references(() => accounts.id).notNull(),
  year: integer("year").notNull(),
  month: integer("month"),
  amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (t) => ({
  uniqueBudget: index("budget_account_year_month_idx").on(t.accountId, t.year, t.month),
}));

export const insertBudgetSchema = createInsertSchema(budgets).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertBudget = z.infer<typeof insertBudgetSchema>;
export type Budget = typeof budgets.$inferSelect;

export const invoiceCounter = pgTable("invoice_counter", {
  id: integer("id").primaryKey().default(1),
  nextNumber: integer("next_number").notNull().default(1001),
});
