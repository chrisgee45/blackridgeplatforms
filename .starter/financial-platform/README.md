# Financial Platform Starter

A standalone, full-stack financial management platform built with Express, Vite, React, PostgreSQL, and Drizzle ORM. Fork and deploy as your own bookkeeping, expense tracking, and tax management system.

## Features

- **Dashboard** — At-a-glance financial health: YTD expenses, monthly trends, recent transactions, upcoming bills, tax estimates
- **Expense Tracker** — Full CRUD with vendor management, category assignment, receipt attachments, recurring expenses, payment method tracking, and funding source selection
- **Financials (General Ledger)** — Double-entry journal system with Chart of Accounts (IRS Schedule C mapped), manual revenue recording, and searchable transaction history
- **Bills / Accounts Payable** — Bill lifecycle management with partial payment support, AP aging reports, and automatic journal entries
- **Bank Reconciliation** — Reconcile accounts against bank statements with real-time difference calculation
- **Budget Module** — Annual budgets per expense category with Budget vs. Actual comparison, color-coded progress, and CSV export
- **Opening Balances** — Migrate from another system by entering starting account balances
- **Tax Center** — Tax settings, Schedule C preview, quarterly estimates tracker, and 1040-ES voucher PDF generation
- **Reports** — Financial overview, expense breakdown by category, AR/AP aging reports, P&L, Balance Sheet, Cash Flow, and General Ledger PDF exports

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18, Vite, Tailwind CSS, shadcn/ui, Framer Motion |
| Backend | Express.js, Node.js |
| Database | PostgreSQL, Drizzle ORM |
| Auth | Session-based (express-session + connect-pg-simple) |
| PDF | jsPDF (client-side generation) |

## Quick Start

### Prerequisites

- Node.js 20+
- PostgreSQL 15+

### Setup

```bash
# Clone / fork
git clone <your-repo-url>
cd financial-platform

# Install dependencies
npm install

# Set environment variables
cp .env.example .env
# Edit .env with your values:
#   DATABASE_URL=postgresql://user:pass@localhost:5432/financial_platform
#   SESSION_SECRET=<random-string>
#   ADMIN_USERNAME=admin
#   ADMIN_PASSWORD=<your-password>

# Push database schema
npx drizzle-kit push

# Start development server
npm run dev
```

The app runs at `http://localhost:5000` by default.

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `SESSION_SECRET` | Yes | Secret for session encryption |
| `ADMIN_USERNAME` | Yes | Login username |
| `ADMIN_PASSWORD` | Yes | Login password |

## Project Structure

```
├── client/
│   ├── index.html
│   └── src/
│       ├── App.tsx              # Routes
│       ├── main.tsx             # Entry point
│       ├── index.css            # Tailwind + theme variables
│       ├── components/
│       │   ├── ObjectUploader.tsx
│       │   └── ui/              # shadcn/ui components
│       ├── hooks/
│       │   ├── use-auth.ts
│       │   └── use-toast.ts
│       ├── lib/
│       │   ├── queryClient.ts
│       │   ├── utils.ts
│       │   ├── financial-pdf.ts # P&L, Balance Sheet, etc.
│       │   └── form-1040es-pdf.ts
│       └── pages/
│           ├── dashboard.tsx
│           ├── expenses-page.tsx
│           ├── financials-page.tsx
│           ├── bills-tab.tsx
│           ├── budget-tab.tsx
│           ├── opening-balances-tab.tsx
│           ├── reconciliation-tab.tsx
│           ├── tax-center-page.tsx
│           ├── reports-page.tsx
│           ├── ar-aging-report.tsx
│           ├── layout.tsx        # Sidebar + auth guard
│           ├── login.tsx
│           └── not-found.tsx
├── server/
│   ├── index.ts                 # Express app entry
│   ├── routes.ts                # Auth + API routing
│   ├── db.ts                    # Drizzle + pg pool
│   ├── bookkeeping-routes.ts    # Financial API endpoints
│   ├── bookkeeping-storage.ts   # Database CRUD layer
│   ├── accounting-v2.ts         # V2 ledger engine
│   ├── accounting-v2-routes.ts  # V2 ledger endpoints
│   ├── recurring-expenses.ts    # Recurring expense processor
│   ├── vite.ts                  # Vite dev middleware
│   └── static.ts                # Production static serving
├── shared/
│   └── schema.ts                # Drizzle schema + Zod types
├── package.json
├── tsconfig.json
├── vite.config.ts
├── tailwind.config.ts
├── postcss.config.js
└── drizzle.config.ts
```

## Rebranding

To rebrand for your own business:

1. **App Name**: Update the sidebar title in `client/src/pages/layout.tsx`
2. **Colors**: Edit CSS variables in `client/src/index.css`
3. **Logo**: Replace or add your logo in the layout component
4. **Tax Settings**: Configure taxpayer info in the Tax Center settings panel

## API Overview

All financial API endpoints are under `/api/ops/` and require authentication.

| Endpoint | Methods | Description |
|----------|---------|-------------|
| `/api/ops/accounts` | GET, POST, PATCH | Chart of Accounts |
| `/api/ops/expenses` | GET, POST, PATCH, DELETE | Expense tracking |
| `/api/ops/vendors` | GET, POST, PATCH, DELETE | Vendor management |
| `/api/ops/journal` | GET, POST, DELETE | Journal entries |
| `/api/ops/bills` | GET, POST, DELETE | Bills / AP |
| `/api/ops/bills/:id/payments` | GET, POST | Bill payments |
| `/api/ops/budgets` | GET, POST, DELETE | Budget management |
| `/api/ops/tax-settings` | GET, POST | Tax configuration |
| `/api/ops/tax-summary` | GET | Tax liability summary |
| `/api/ops/quarterly-estimates` | GET, POST, PATCH | Quarterly tax estimates |
| `/api/accounting/income-statement` | GET | P&L report data |
| `/api/accounting/balance-sheet` | GET | Balance sheet data |
| `/api/accounting/trial-balance` | GET | Trial balance data |
| `/api/accounting/ar-aging` | GET | AR aging report |
| `/api/accounting/ap-aging` | GET | AP aging report |
| `/api/accounting/reconciliation/*` | GET, POST | Bank reconciliation |

## License

MIT
