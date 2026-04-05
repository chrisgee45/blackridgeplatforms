# BlackRidge Platforms - Marketing Website & Admin CRM & Ops Portal

## Overview
This project delivers a premium marketing website for BlackRidge Platforms, specializing in high-value web solutions, aimed at client conversion. It includes an authenticated Admin CRM for lead management and a comprehensive "BlackRidge Ops" portal for end-to-end business operations, encompassing project management, task tracking, time management, bookkeeping, and tax planning. The system is designed for robust client acquisition, project delivery, financial oversight, and business analytics, ultimately driving business growth and efficiency.

## User Preferences
- I prefer a premium, authoritative brand aesthetic.
- I prefer a clean professional light theme for the admin/ops portals (navy sidebar, light backgrounds, gold accent).
- The marketing site retains the dark premium theme.
- I want inclusive messaging that appeals to both startups and enterprises.
- My contact email is chris@blackridgeplatforms.com.
- My phone number (405-201-5869) is displayed on the website in the navbar, mobile menu, and footer.

## System Architecture
The application employs a modern full-stack architecture with a React frontend (Vite, Tailwind CSS, shadcn/ui, Framer Motion, Recharts) and an Express.js backend utilizing PostgreSQL via Drizzle ORM. Authentication for admin and ops portals uses `express-session` and `connect-pg-simple`. Client-side routing is managed by Wouter, separating public and authenticated areas. Forms use `react-hook-form` with `zod` validation, and data fetching is handled by `@tanstack/react-query`.

**Key Features and Design Decisions:**
- **UI/UX**: The marketing site uses a dark premium theme, while admin/ops portals feature a light professional theme with a navy sidebar and gold accents. The Inter font family is used throughout.
- **Marketing Site**: A single-page design covering hero, services, portfolio, process, testimonials, about, and a contact form. Server-side content injection for SEO.
- **Admin CRM Portal**: Features custom authentication with optional TOTP-based MFA, comprehensive lead management (statuses, priority, notes, search/filter), a deal pipeline, dashboard with lead statistics, AI-powered "Hot Leads" widget, automated follow-up, and lead source tracking.
- **BlackRidge Ops Portal**: Offers extensive project management with an 8-stage pipeline, Kanban view, task management, time tracking with profitability metrics, and a "Today Cockpit" dashboard. Includes a Project Command Center, Calendar View, and a Client Kickoff Discovery system for onboarding.
- **Client Revenue System**: Manages clients with status tracking, MRR/ARR calculation, deals pipeline, subscription management, and Stripe payment tracking.
- **Bookkeeping System**: Features a Chart of Accounts, double-entry journal, manual revenue recording, and an Expense Tracker with full CRUD. Includes GAAP compliance (period locking, immutable audit trail, void instead of delete, year-end closing, adjusting entries, role-based access, reconciliation locking).
- **Financial Reporting**: Generates AR/AP Aging reports, Bank Reconciliation, Budget Module with Budget vs. Actual reports, and PDF exports for Income Statement, Balance Sheet, Cash Flow, and General Ledger.
- **Tax Center**: Provides configurable tax settings, a tax summary, Schedule C preview, quarterly estimates tracker, and a 1040-ES Voucher Generator. Supports IRS Schedule C PDF Export.
- **Automated Workflows**: Welcome Sequence for client onboarding (3-email sequence), Policy & Procedures document management system, and Daily Backup System for database.
- **AI-Powered Tools**: Outreach Engine for lead intake and email campaigns (including a "Bad Website Finder" for lead qualification), Autonomous Email Conversation System, AI Lead Enrichment, and RIDGE AI CFO (voice-enabled AI assistant with conversation memory, auto-reporting, full accounting access, and real-time streaming audio via binary frame protocol at POST /api/ridge/stream — Anthropic text streamed sentence-by-sentence through ElevenLabs TTS with audio played as chunks arrive; transcript hidden by default with toggle).
- **Payment Tracking**: Manages deposits, milestones, and final payments, with status tracking, reminders, and integration into the Project Command Center.
- **Bank Sync (Plaid)**: Plaid-powered bank account linking and transaction sync with smart auto-matching and manual categorization.
- **QA Audit Portal**: Fully integrated TypeScript QA audit system (server/qa-agents.ts, server/qa-audit-routes.ts) with 4 agents (Security, Infrastructure, API, Data Flow — 36 tests total). Uses SSE for real-time progress, AI executive summaries via Anthropic Claude, and stores results in PostgreSQL (qaAudits, qaAuditFindings tables). Accessible via Ops sidebar at /admin/ops/qa-audit. Works in both dev and production.
- **Security Hardening**: Helmet (CSP, HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy), strict CORS (explicit allowlist only), express-rate-limit (10 login attempts/15min, 100 API requests/min), 1MB body size limit, API 404 catch-all for unknown `/api/*` routes, X-API-Version response header, structured error handler with environment-aware detail levels.

## External Dependencies
- **PostgreSQL**: Primary database.
- **Resend**: Email sending.
- **Anthropic Claude (claude-sonnet-4-6)**: AI processing for various features (lead analysis, outreach, website scoring, RIDGE CFO).
- **ElevenLabs**: Text-to-speech for RIDGE AI CFO.
- **Replit Object Storage**: Document, receipt, and daily backup storage.
- **jsPDF**: Client-side PDF generation.
- **pdfkit**: Server-side PDF generation.
- **Plaid**: Bank account linking and transaction synchronization.
- **Stripe**: Payment processing.
- **otpauth + qrcode**: TOTP-based MFA.
- **OpenAI (via Replit AI Integrations)**: AI integrations.
- **Anthropic Claude**: AI summaries for QA Audit Portal executive analysis.