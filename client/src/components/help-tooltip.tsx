import { useState } from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { HelpCircle } from "lucide-react";

interface HelpTooltipProps {
  title: string;
  description: string;
  howToUse?: string;
  size?: "sm" | "md";
}

export function HelpTooltip({ title, description, howToUse, size = "sm" }: HelpTooltipProps) {
  const [open, setOpen] = useState(false);
  const iconSize = size === "sm" ? "w-3.5 h-3.5" : "w-4 h-4";

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center justify-center rounded-full text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
          aria-label={`Help: ${title}`}
          data-testid={`help-${title.toLowerCase().replace(/[\s/&]+/g, "-")}`}
        >
          <HelpCircle className={iconSize} />
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="w-80 p-0"
        side="top"
        align="start"
        sideOffset={8}
      >
        <div className="p-4 space-y-2">
          <h4 className="font-semibold text-sm text-foreground">{title}</h4>
          <p className="text-xs text-muted-foreground leading-relaxed">{description}</p>
          {howToUse && (
            <div className="pt-1.5 border-t">
              <p className="text-xs font-medium text-foreground mb-1">How to use</p>
              <p className="text-xs text-muted-foreground leading-relaxed">{howToUse}</p>
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

export const HELP_CONTENT = {
  incomeStatement: {
    title: "Income Statement (P&L)",
    description: "Shows your revenue earned and expenses incurred over a period. The bottom line is your Net Income — profit if positive, loss if negative. Also called a Profit & Loss statement.",
    howToUse: "Select a date range at the top of the page, then view this tab. Revenue minus expenses equals your net income. Use the PDF export to share with your accountant or for tax filing.",
  },
  balanceSheet: {
    title: "Balance Sheet",
    description: "A snapshot of what your business owns (Assets), owes (Liabilities), and the owner's stake (Equity) at a specific point in time. Assets must always equal Liabilities + Equity.",
    howToUse: "Review this report at month-end or year-end. If it doesn't balance, check for missing journal entries. Export the PDF for your records.",
  },
  cashFlow: {
    title: "Cash Flow Statement",
    description: "Tracks how cash moves in and out of your business across operating, investing, and financing activities. Unlike the income statement, this shows actual cash movement rather than accrual-based figures.",
    howToUse: "Use this to understand your actual cash position. A profitable business can still run out of cash if receivables are slow — this report helps you spot that.",
  },
  generalLedger: {
    title: "General Ledger",
    description: "The complete record of every financial transaction in your system. Each entry has balanced debits and credits across one or more accounts. This is the foundation of double-entry bookkeeping.",
    howToUse: "Search and filter entries by date, source, or keyword. Click any row to expand and see the individual debit/credit lines. Use the void button (⊘) to reverse an entry instead of deleting it.",
  },
  reconciliation: {
    title: "Bank Reconciliation",
    description: "The process of matching your recorded transactions against your bank statement to ensure your books are accurate. Any differences indicate missing or duplicate entries.",
    howToUse: "Select a bank/cash account, enter your bank statement balance, then check off transactions that appear on your statement. The difference should reach zero. Once complete, those transactions are locked from editing.",
  },
  billsAP: {
    title: "Bills / Accounts Payable",
    description: "Track money you owe to vendors and suppliers. Bills represent future payment obligations. Accounts Payable (AP) is the total of all unpaid bills — a liability on your balance sheet.",
    howToUse: "Add bills when you receive vendor invoices. Record payments against bills (partial or full). The dashboard shows total outstanding, due this week, and overdue amounts.",
  },
  openingBalances: {
    title: "Opening Balances",
    description: "Starting account balances when you migrate from another accounting system (like QuickBooks). This creates a single journal entry that establishes your starting point so historical balances carry forward correctly.",
    howToUse: "Enter balances from your previous system's final balance sheet. Owner's Equity auto-calculates as the balancing amount. You only need to do this once when first setting up.",
  },
  budget: {
    title: "Budget",
    description: "Set spending targets for each expense category on an annual basis. The Budget vs. Actual report compares your planned spending against what you actually spent, helping you control costs.",
    howToUse: "In Budget Setup, enter annual amounts per category — monthly averages are calculated automatically. Switch to Budget vs. Actual to see color-coded progress bars showing where you're over or under budget.",
  },
  gaapPeriods: {
    title: "GAAP / Fiscal Periods",
    description: "GAAP (Generally Accepted Accounting Principles) compliance features. Fiscal periods divide your year into monthly accounting periods that can be opened or closed. Closing a period prevents any changes to transactions in that month, ensuring financial integrity.",
    howToUse: "Initialize a year to create 12 monthly periods. Close periods after month-end review to lock them. All 12 periods must be closed before you can perform a year-end close. Only admin users can close/reopen periods.",
  },
  fiscalPeriod: {
    title: "Fiscal Period",
    description: "A single monthly accounting period (e.g., January 2026). When open, transactions can be created or modified for dates in that month. When closed, the period is locked — no changes allowed.",
    howToUse: "Close a period after you've completed all entries and reconciliation for that month. If you discover an error, an admin can reopen the period temporarily to make corrections.",
  },
  yearEndClose: {
    title: "Year-End Close",
    description: "An accounting procedure performed at the end of each fiscal year. It creates a closing journal entry that zeros out all revenue and expense accounts and transfers the net income (or loss) to Retained Earnings. This resets the income statement for the new year.",
    howToUse: "First close all 12 monthly periods for the year. Then click 'Close Year'. This creates a closing entry — revenue accounts are debited, expense accounts are credited, and the difference goes to Retained Earnings (account 3900).",
  },
  auditTrail: {
    title: "Audit Trail",
    description: "A complete, immutable log of every financial action in the system — creating entries, voiding transactions, closing periods, and more. Each record shows who did what, when, and includes before/after snapshots of the data.",
    howToUse: "Use the filters to narrow by date range, action type (create, void, close), or record type. Click any row to expand and see the detailed before/after data. Export to PDF for compliance documentation.",
  },
  voidEntry: {
    title: "Void (vs Delete)",
    description: "Instead of deleting a transaction (which would destroy the audit trail), voiding creates a reversing entry that exactly offsets the original. The original entry is marked as voided but remains visible for accountability. This is a GAAP requirement.",
    howToUse: "Click the ⊘ icon on any journal entry or expense. A confirmation dialog will appear. Once voided, a new reversing entry is automatically created. This cannot be undone — only admin users can void entries.",
  },
  adjustingEntry: {
    title: "Adjusting Entry",
    description: "Special journal entries made at the end of an accounting period to record revenue earned or expenses incurred that haven't been captured in daily transactions. Common examples: accrued interest, prepaid insurance amortization, depreciation.",
    howToUse: "Create adjusting entries before closing a period. They are tagged with 'adjusting' source type so you can easily identify them in the general ledger.",
  },
  userRoles: {
    title: "User Roles",
    description: "Two roles control access to sensitive financial operations. Admin has full access including voiding entries, closing periods, year-end close, and user management. Bookkeeper can create and edit entries but cannot perform destructive or period-closing actions.",
    howToUse: "Admins can change a user's role from the dropdown in the User Roles section. The role takes effect on the user's next login.",
  },
  reconciliationLock: {
    title: "Reconciliation Lock",
    description: "Once a transaction has been included in a completed bank reconciliation, it becomes locked and cannot be voided or modified. This prevents changes that would invalidate a reconciliation you've already confirmed matches your bank statement.",
    howToUse: "After completing a reconciliation, the included transactions are automatically locked. If you need to modify a locked transaction, you'll need to undo the reconciliation first.",
  },
  expenses: {
    title: "Expense Tracker",
    description: "Record and categorize business expenses. Each expense automatically creates a journal entry debiting the expense category and crediting your cash/bank account. Expenses appear on your Income Statement and reduce your taxable income.",
    howToUse: "Click 'Add Expense' to record a new expense. Select a category (account), vendor, amount, and date. Attach receipt images for documentation. For recurring expenses, set the frequency and the system will track when the next one is due.",
  },
  recurringExpense: {
    title: "Recurring Expense",
    description: "An expense that repeats on a regular schedule — weekly, monthly, quarterly, or annually. The system tracks the next due date automatically so you know when each recurring cost is coming up.",
    howToUse: "When creating an expense, toggle 'Recurring' on, then select the frequency. The next due date is calculated automatically from the expense date.",
  },
  chartOfAccounts: {
    title: "Chart of Accounts",
    description: "The organized list of all account categories in your bookkeeping system. Accounts are grouped into five types: Assets (what you own), Liabilities (what you owe), Equity (owner's stake), Revenue (income earned), and Expenses (costs incurred). Each account has a number that maps to IRS Schedule C for tax reporting.",
    howToUse: "Review your chart of accounts to ensure all your expense and revenue categories are set up. You can add new accounts as needed. Account numbers in the 4000s are revenue, 5000-9000s are expenses.",
  },
  journalEntry: {
    title: "Journal Entry",
    description: "The building block of double-entry bookkeeping. Every transaction is recorded as a journal entry with at least one debit and one credit. Total debits must always equal total credits — this keeps your books balanced.",
    howToUse: "Most journal entries are created automatically (from expenses, payments, etc.). For manual adjustments, create a journal entry directly with the appropriate debit and credit lines.",
  },
  debitCredit: {
    title: "Debits & Credits",
    description: "Debits increase asset and expense accounts, decrease liability, equity, and revenue accounts. Credits do the opposite. In every transaction, debits must equal credits. Think of it as: debits = where money went, credits = where money came from.",
    howToUse: "When creating manual journal entries, remember: expenses go up with debits, revenue goes up with credits. Asset accounts (like cash) increase with debits. Liability accounts (like loans) increase with credits.",
  },
  taxCenter: {
    title: "Tax Center",
    description: "Centralized tax planning and preparation tools. Includes a Schedule C preview showing your self-employment income and deductions, quarterly estimated tax payment tracker, and 1040-ES voucher generation for making IRS payments.",
    howToUse: "Start by entering your taxpayer info in Settings (name, SSN, address). Review your Schedule C preview to see estimated taxable income. Use the quarterly tracker to plan estimated payments and generate pre-filled 1040-ES vouchers.",
  },
  scheduleC: {
    title: "Schedule C Preview",
    description: "IRS Schedule C reports profit or loss from your sole proprietorship business. This preview pulls data from your bookkeeping accounts mapped to Schedule C line items, giving you an estimate of your tax filing numbers.",
    howToUse: "Review this before tax time. Compare line items to your actual expenses to make sure everything is categorized correctly. The amounts come from your chart of accounts with IRS Schedule C mappings.",
  },
  quarterlyEstimates: {
    title: "Quarterly Estimated Taxes",
    description: "Self-employed individuals must pay estimated income tax four times a year (April 15, June 15, September 15, January 15). Underpaying can result in IRS penalties. Each payment covers roughly 25% of your annual tax liability.",
    howToUse: "The tracker shows each quarter's due date and payment status. Click 'Generate 1040-ES' to create a pre-filled payment voucher you can mail with your check, or use the amount shown to pay online at IRS.gov/payments.",
  },
  clients: {
    title: "Clients",
    description: "Your active, prospective, and past client records. Each client tracks contact info, status, monthly recurring revenue (MRR), and linked projects. Clients can be created from CRM leads or added directly.",
    howToUse: "Add clients manually or convert CRM leads. Track their status (active, churned, prospect). Link projects and deals to each client. The system calculates MRR and ARR from active subscriptions.",
  },
  paymentLinks: {
    title: "Payment Links",
    description: "Branded, shareable URLs that let clients pay invoices online via Stripe. Each link shows the invoice details, amount due, and processes credit card or ACH payments. Payment confirmations automatically update your project payments and ledger.",
    howToUse: "Create a payment link from a project's payment tab. Share the URL with your client. When they pay, the system automatically records the payment, updates the project status, and posts the revenue to your books.",
  },
  arAging: {
    title: "AR Aging (Accounts Receivable)",
    description: "Shows how long your unpaid invoices have been outstanding, grouped into time buckets: Current, 1-30 days, 31-60 days, 61-90 days, and 90+ days. Older receivables are harder to collect and may need write-off.",
    howToUse: "Review regularly to identify slow-paying clients. Follow up on invoices that age past 30 days. Consider stricter payment terms or deposits for clients with consistently late payments.",
  },
  apAging: {
    title: "AP Aging (Accounts Payable)",
    description: "Shows how long your unpaid bills have been outstanding, using the same time buckets as AR Aging. Helps you prioritize which vendor bills to pay first and manage cash flow.",
    howToUse: "Review weekly to avoid late fees. Pay overdue bills first, then focus on those due this week. Use this alongside your cash flow statement to plan payment timing.",
  },
  complianceStatus: {
    title: "GAAP Compliance Status",
    description: "A dashboard showing which GAAP (Generally Accepted Accounting Principles) compliance features are active in your system. Green indicators mean the feature is fully implemented and operational.",
    howToUse: "This is an informational display — no action needed. All six compliance features (Period Locking, Audit Trail, Year-End Closing, Adjusting Entries, Role-Based Access, Reconciliation Lock) should show as Active.",
  },
} as const;
