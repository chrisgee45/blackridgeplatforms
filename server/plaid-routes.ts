import type { Express, RequestHandler } from "express";
import { Configuration, PlaidApi, PlaidEnvironments, Products, CountryCode } from "plaid";
import { db } from "./db";
import { plaidConnections, bankTransactions, expenses, vendors } from "@shared/schema";
import { eq, and, desc, sql, between, ilike, or } from "drizzle-orm";

const plaidConfig = new Configuration({
  basePath: PlaidEnvironments[process.env.PLAID_ENV || "sandbox"],
  baseOptions: {
    headers: {
      "PLAID-CLIENT-ID": process.env.PLAID_CLIENT_ID,
      "PLAID-SECRET": process.env.PLAID_SECRET,
    },
  },
});

const plaidClient = new PlaidApi(plaidConfig);

export function registerPlaidRoutes(app: Express, isAuthenticated: RequestHandler) {

  app.post("/api/plaid/create-link-token", isAuthenticated, async (req, res) => {
    try {
      const linkConfig: any = {
        user: { client_user_id: "blackridge-admin" },
        client_name: "BlackRidge Platforms",
        products: [Products.Transactions],
        country_codes: [CountryCode.Us],
        language: "en",
      };
      if (process.env.PLAID_ENV === "production" || process.env.PLAID_ENV === "development") {
        linkConfig.redirect_uri = process.env.PLAID_REDIRECT_URI || "https://blackridgeplatforms.com/oauth-callback";
      }
      const response = await plaidClient.linkTokenCreate(linkConfig);
      res.json({ link_token: response.data.link_token });
    } catch (error: any) {
      const plaidError = error?.response?.data;
      console.error("Plaid link token error:", JSON.stringify(plaidError || error?.message || error, null, 2));
      const detail = plaidError?.error_message || plaidError?.display_message || error?.message || "Unknown error";
      res.status(500).json({ message: `Failed to create link token: ${detail}` });
    }
  });

  app.post("/api/plaid/exchange-token", isAuthenticated, async (req, res) => {
    try {
      const { public_token, metadata } = req.body;
      if (!public_token) {
        return res.status(400).json({ message: "public_token is required" });
      }

      const exchangeResponse = await plaidClient.itemPublicTokenExchange({
        public_token,
      });

      const { access_token, item_id } = exchangeResponse.data;

      const account = metadata?.accounts?.[0];
      const institution = metadata?.institution;

      const [connection] = await db.insert(plaidConnections).values({
        accessToken: access_token,
        itemId: item_id,
        institutionId: institution?.institution_id || null,
        institutionName: institution?.name || "Unknown Bank",
        accountId: account?.id || null,
        accountName: account?.name || null,
        accountMask: account?.mask || null,
        accountType: account?.subtype || account?.type || null,
        status: "active",
      }).returning();

      const { accessToken: _removed, ...safeConnection } = connection;
      res.json(safeConnection);
    } catch (error: any) {
      console.error("Plaid exchange error:", error?.response?.data || error);
      res.status(500).json({ message: "Failed to connect bank account" });
    }
  });

  app.get("/api/plaid/connections", isAuthenticated, async (_req, res) => {
    try {
      const connections = await db.select().from(plaidConnections).orderBy(desc(plaidConnections.createdAt));
      const safe = connections.map(({ accessToken, ...rest }) => rest);
      res.json(safe);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch connections" });
    }
  });

  app.patch("/api/plaid/connections/:id", isAuthenticated, async (req, res) => {
    try {
      const { id } = req.params;
      const { isPersonal } = req.body;
      const [updated] = await db.update(plaidConnections)
        .set({ isPersonal: !!isPersonal })
        .where(eq(plaidConnections.id, id))
        .returning();
      if (!updated) return res.status(404).json({ message: "Connection not found" });
      const { accessToken: _removed, ...safe } = updated;
      res.json(safe);
    } catch (error) {
      res.status(500).json({ message: "Failed to update connection" });
    }
  });

  app.delete("/api/plaid/connections/:id", isAuthenticated, async (req, res) => {
    try {
      const { id } = req.params;
      const [conn] = await db.select().from(plaidConnections).where(eq(plaidConnections.id, id));
      if (!conn) return res.status(404).json({ message: "Connection not found" });

      try {
        await plaidClient.itemRemove({ access_token: conn.accessToken });
      } catch (e) {
        // ignore plaid removal errors
      }

      await db.delete(bankTransactions).where(eq(bankTransactions.connectionId, id));
      await db.delete(plaidConnections).where(eq(plaidConnections.id, id));

      res.json({ message: "Connection removed" });
    } catch (error) {
      res.status(500).json({ message: "Failed to remove connection" });
    }
  });

  app.post("/api/plaid/sync/:connectionId", isAuthenticated, async (req, res) => {
    try {
      const { connectionId } = req.params;
      const [conn] = await db.select().from(plaidConnections).where(eq(plaidConnections.id, connectionId));
      if (!conn) return res.status(404).json({ message: "Connection not found" });

      let cursor = conn.cursor || undefined;
      let added: any[] = [];
      let modified: any[] = [];
      let removed: any[] = [];
      let hasMore = true;

      while (hasMore) {
        const response = await plaidClient.transactionsSync({
          access_token: conn.accessToken,
          cursor,
        });

        added = added.concat(response.data.added);
        modified = modified.concat(response.data.modified);
        removed = removed.concat(response.data.removed);
        hasMore = response.data.has_more;
        cursor = response.data.next_cursor;
      }

      let insertedCount = 0;
      let updatedCount = 0;
      let removedCount = 0;

      for (const txn of added) {
        const existing = await db.select().from(bankTransactions)
          .where(eq(bankTransactions.plaidTransactionId, txn.transaction_id));

        if (existing.length === 0) {
          await db.insert(bankTransactions).values({
            connectionId,
            plaidTransactionId: txn.transaction_id,
            accountId: txn.account_id,
            date: txn.date,
            name: txn.name || txn.merchant_name || "Unknown",
            merchantName: txn.merchant_name,
            amount: String(txn.amount),
            isoCurrencyCode: txn.iso_currency_code || "USD",
            category: txn.personal_finance_category?.primary || txn.category?.[0] || null,
            categoryDetailed: txn.personal_finance_category?.detailed || txn.category?.join(" > ") || null,
            pending: txn.pending || false,
            status: "pending",
          });
          insertedCount++;
        }
      }

      for (const txn of modified) {
        await db.update(bankTransactions)
          .set({
            name: txn.name || txn.merchant_name || "Unknown",
            merchantName: txn.merchant_name,
            amount: String(txn.amount),
            category: txn.personal_finance_category?.primary || txn.category?.[0] || null,
            pending: txn.pending || false,
            date: txn.date,
          })
          .where(eq(bankTransactions.plaidTransactionId, txn.transaction_id));
        updatedCount++;
      }

      for (const txn of removed) {
        await db.delete(bankTransactions)
          .where(eq(bankTransactions.plaidTransactionId, txn.transaction_id));
        removedCount++;
      }

      await db.update(plaidConnections)
        .set({ cursor, lastSyncedAt: new Date() })
        .where(eq(plaidConnections.id, connectionId));

      res.json({ added: insertedCount, updated: updatedCount, removed: removedCount });
    } catch (error: any) {
      console.error("Plaid sync error:", error?.response?.data || error);
      res.status(500).json({ message: "Failed to sync transactions" });
    }
  });

  app.get("/api/plaid/transactions", isAuthenticated, async (req, res) => {
    try {
      const { status, connectionId, search, limit = "50", offset = "0" } = req.query;
      const conditions: any[] = [];

      if (status && status !== "all") {
        conditions.push(eq(bankTransactions.status, status as any));
      }
      if (connectionId) {
        conditions.push(eq(bankTransactions.connectionId, String(connectionId)));
      }
      if (search) {
        conditions.push(
          or(
            ilike(bankTransactions.name, `%${search}%`),
            ilike(bankTransactions.merchantName, `%${search}%`)
          )
        );
      }

      const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

      const [txns, countResult] = await Promise.all([
        db.select().from(bankTransactions)
          .where(whereClause)
          .orderBy(desc(bankTransactions.date))
          .limit(Number(limit))
          .offset(Number(offset)),
        db.select({ count: sql<number>`count(*)` }).from(bankTransactions).where(whereClause),
      ]);

      res.json({ transactions: txns, total: Number(countResult[0]?.count || 0) });
    } catch (error) {
      console.error("Fetch transactions error:", error);
      res.status(500).json({ message: "Failed to fetch transactions" });
    }
  });

  app.get("/api/plaid/transactions/stats", isAuthenticated, async (_req, res) => {
    try {
      const stats = await db.select({
        status: bankTransactions.status,
        count: sql<number>`count(*)`,
      }).from(bankTransactions).groupBy(bankTransactions.status);

      const result: Record<string, number> = { pending: 0, matched: 0, categorized: 0, ignored: 0 };
      for (const s of stats) {
        result[s.status] = Number(s.count);
      }
      result.total = Object.values(result).reduce((a, b) => a + b, 0);

      res.json(result);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch stats" });
    }
  });

  app.patch("/api/plaid/transactions/:id/status", isAuthenticated, async (req, res) => {
    try {
      const { id } = req.params;
      const { status, notes } = req.body;
      if (!["pending", "matched", "categorized", "ignored"].includes(status)) {
        return res.status(400).json({ message: "Invalid status" });
      }

      const [existing] = await db.select().from(bankTransactions).where(eq(bankTransactions.id, id));
      if (!existing) return res.status(404).json({ message: "Transaction not found" });

      const updates: any = { status };
      if (notes !== undefined) updates.notes = notes;
      if (status === "pending") {
        updates.matchedExpenseId = null;
        updates.matchedPaymentId = null;
        updates.linkedAccountId = null;
      }

      const [updated] = await db.update(bankTransactions)
        .set(updates)
        .where(eq(bankTransactions.id, id))
        .returning();

      res.json(updated);
    } catch (error) {
      res.status(500).json({ message: "Failed to update transaction" });
    }
  });

  app.post("/api/plaid/transactions/:id/match", isAuthenticated, async (req, res) => {
    try {
      const { id } = req.params;
      const { expenseId } = req.body;

      if (!expenseId) return res.status(400).json({ message: "expenseId required" });

      const [existing] = await db.select().from(bankTransactions).where(eq(bankTransactions.id, id));
      if (!existing) return res.status(404).json({ message: "Transaction not found" });
      if (existing.status !== "pending") return res.status(409).json({ message: "Transaction already processed" });

      const [updated] = await db.update(bankTransactions)
        .set({ status: "matched", matchedExpenseId: String(expenseId) })
        .where(eq(bankTransactions.id, id))
        .returning();

      res.json(updated);
    } catch (error) {
      res.status(500).json({ message: "Failed to match transaction" });
    }
  });

  app.post("/api/plaid/auto-match/:connectionId", isAuthenticated, async (req, res) => {
    try {
      const { connectionId } = req.params;

      const pendingTxns = await db.select().from(bankTransactions)
        .where(and(
          eq(bankTransactions.connectionId, connectionId),
          eq(bankTransactions.status, "pending")
        ));

      const [conn] = await db.select().from(plaidConnections).where(eq(plaidConnections.id, connectionId));
      if (!conn) return res.status(404).json({ message: "Connection not found" });

      const allExpenses = await db.select().from(expenses)
        .where(eq(expenses.isVoid, false));

      const alreadyMatchedExpIds = await db.select({ matchedExpenseId: bankTransactions.matchedExpenseId })
        .from(bankTransactions)
        .where(and(
          eq(bankTransactions.status, "matched"),
          sql`${bankTransactions.matchedExpenseId} IS NOT NULL`
        ));
      const usedExpenseIds = new Set(alreadyMatchedExpIds.map(r => r.matchedExpenseId));
      const claimedThisRun = new Set<number>();

      let matchedCount = 0;

      for (const txn of pendingTxns) {
        if (parseFloat(txn.amount) <= 0) continue;

        const txnAmount = parseFloat(txn.amount);
        const txnDate = txn.date;
        const txnName = (txn.merchantName || txn.name || "").toLowerCase();

        let bestMatch: any = null;
        let bestScore = 0;

        for (const exp of allExpenses) {
          const expId = String(exp.id);
          if (usedExpenseIds.has(expId) || claimedThisRun.has(expId)) continue;

          const expAmount = Math.abs(parseFloat(String(exp.amount)));

          const amountDiff = Math.abs(txnAmount - expAmount);
          if (amountDiff > 0.01) continue;

          let score = 50;

          const expDateStr = exp.date ? `${exp.date.getFullYear()}-${String(exp.date.getMonth()+1).padStart(2,'0')}-${String(exp.date.getDate()).padStart(2,'0')}` : "";

          if (txnDate === expDateStr) {
            score += 30;
          } else if (expDateStr) {
            const dayDiff = Math.abs(
              (new Date(txnDate).getTime() - new Date(expDateStr).getTime()) / (1000 * 60 * 60 * 24)
            );
            if (dayDiff <= 3) score += 20;
            else if (dayDiff <= 7) score += 10;
            else continue;
          } else {
            continue;
          }

          const expDesc = (exp.description || "").toLowerCase();
          if (txnName && expDesc && (txnName.includes(expDesc) || expDesc.includes(txnName))) {
            score += 20;
          }

          if (score > bestScore) {
            bestScore = score;
            bestMatch = exp;
          }
        }

        if (bestMatch && bestScore >= 70) {
          await db.update(bankTransactions)
            .set({ status: "matched", matchedExpenseId: String(bestMatch.id) })
            .where(eq(bankTransactions.id, txn.id));
          claimedThisRun.add(String(bestMatch.id));
          matchedCount++;
        }
      }

      res.json({ matched: matchedCount, total: pendingTxns.length });
    } catch (error) {
      console.error("Auto-match error:", error);
      res.status(500).json({ message: "Failed to auto-match" });
    }
  });

  app.post("/api/plaid/transactions/:id/categorize", isAuthenticated, async (req, res) => {
    try {
      const { id } = req.params;
      const { accountId, description, vendorId, paymentMethod, taxDeductible, transactionType } = req.body;
      const type = transactionType || "expense";

      if (!accountId) return res.status(400).json({ message: "accountId required" });

      const [txn] = await db.select().from(bankTransactions).where(eq(bankTransactions.id, id));
      if (!txn) return res.status(404).json({ message: "Transaction not found" });
      if (txn.status !== "pending") return res.status(409).json({ message: "Transaction already processed" });

      const amount = Math.abs(parseFloat(txn.amount));
      const memo = description || txn.merchantName || txn.name;

      // Defensive: if txn.date isn't a valid date string, fall back to created_at
      const parsedDate = txn.date ? new Date(txn.date) : null;
      const txnDate = parsedDate && !isNaN(parsedDate.getTime())
        ? parsedDate
        : (txn.createdAt || new Date());

      if (type === "owner_contribution") {
        const { bookkeepingStorage } = await import("./bookkeeping-storage");
        const ownerContribAccount = await bookkeepingStorage.getAccountByNumber("3200");
        if (!ownerContribAccount) throw new Error("Owner Contribution account (3200) not found");
        await bookkeepingStorage.createJournalEntryWithLines(
          {
            date: txnDate,
            memo: `Owner contribution: ${memo}`,
            sourceType: "owner_contribution",
            createdBy: "admin",
          },
          [
            { accountId: String(accountId), debit: String(amount), credit: "0" },
            { accountId: ownerContribAccount.id, debit: "0", credit: String(amount) },
          ]
        );

        await db.update(bankTransactions)
          .set({
            status: "categorized",
            linkedAccountId: String(accountId),
          })
          .where(eq(bankTransactions.id, id));

        res.json({ transaction: txn, type: "owner_contribution" });
      } else if (type === "income" || type === "refund") {
        const { recordRevenue } = await import("./accounting-v2");
        const tx = await recordRevenue({
          amount,
          revenueAccountId: String(accountId),
          occurredAt: txnDate,
          memo: type === "refund" ? `Refund: ${memo}` : memo,
          paymentMethod: paymentMethod || "card",
          isDeposit: type === "income",
          referenceType: "bank_sync",
          referenceId: txn.id,
        });

        await db.update(bankTransactions)
          .set({
            status: "categorized",
            linkedAccountId: String(accountId),
          })
          .where(eq(bankTransactions.id, id));

        res.json({ transaction: txn, journalEntry: tx });
      } else if (type === "transfer") {
        const { bookkeepingStorage } = await import("./bookkeeping-storage");
        const cashAccount = await bookkeepingStorage.getAccountByNumber("1000");
        if (!cashAccount) throw new Error("Cash account (1000) not found");
        await bookkeepingStorage.createJournalEntryWithLines(
          {
            date: txnDate,
            memo: `Transfer: ${memo}`,
            sourceType: "bank_sync",
            createdBy: "admin",
          },
          [
            { accountId: String(accountId), debit: String(amount), credit: "0" },
            { accountId: cashAccount.id, debit: "0", credit: String(amount) },
          ]
        );

        await db.update(bankTransactions)
          .set({
            status: "categorized",
            linkedAccountId: String(accountId),
          })
          .where(eq(bankTransactions.id, id));

        res.json({ transaction: txn, type: "transfer" });
      } else {
        const { bookkeepingStorage } = await import("./bookkeeping-storage");
        const expenseData = {
          accountId: String(accountId),
          description: memo,
          amount: String(amount),
          date: txnDate,
          vendorId: vendorId || null,
          paymentMethod: paymentMethod || "card",
          taxDeductible: taxDeductible !== false,
          isBillable: false,
          fundingSource: "business_checking",
        };

        const expense = await bookkeepingStorage.createExpenseWithJournal(expenseData as any);

        await db.update(bankTransactions)
          .set({
            status: "categorized",
            matchedExpenseId: String(expense.id),
            linkedAccountId: String(accountId),
          })
          .where(eq(bankTransactions.id, id));

        res.json({ transaction: txn, expense });
      }
    } catch (error: any) {
      console.error("Categorize error:", error);
      res.status(500).json({
        message: "Failed to categorize transaction",
        error: error?.message || String(error),
        detail: error?.detail || error?.stack?.split("\n")[0] || undefined,
      });
    }
  });
}
