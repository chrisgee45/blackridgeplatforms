import { Router } from "express";
import type { RequestHandler } from "express";
import {
  recordRevenue,
  recordExpense,
  recordOwnerDraw,
  getIncomeStatement,
  getBalanceSheetAsOf,
  getAccountActivity,
  getSystemAccounts,
  getAccountIdByName,
  getAccountIdByCode,
  getAccountDrilldown,
  getCashFlow,
  getTransactionsList,
  deleteTransaction,
} from "./accounting-v2";

export function createAccountingV2Router(isAuthenticated: RequestHandler): Router {
  const router = Router();

  router.use(isAuthenticated);

  router.post("/revenue", async (req, res) => {
    try {
      const { amount, revenueAccountId, occurredAt, memo, paymentMethod, salesTaxAmount, isDeposit, referenceType, referenceId } = req.body;
      const tx = await recordRevenue({
        amount: Number(amount),
        revenueAccountId,
        occurredAt: occurredAt ? new Date(occurredAt) : undefined,
        memo,
        paymentMethod: paymentMethod ?? "cash",
        salesTaxAmount: salesTaxAmount ? Number(salesTaxAmount) : undefined,
        isDeposit: isDeposit ?? false,
        referenceType,
        referenceId,
      });
      res.json({ ok: true, transaction: tx });
    } catch (e: any) {
      res.status(400).json({ ok: false, error: e.message });
    }
  });

  router.post("/expense", async (req, res) => {
    try {
      const { amount, expenseAccountId, occurredAt, memo, paymentMethod, referenceType, referenceId } = req.body;
      const tx = await recordExpense({
        amount: Number(amount),
        expenseAccountId,
        occurredAt: occurredAt ? new Date(occurredAt) : undefined,
        memo,
        paymentMethod: paymentMethod ?? "cash",
        referenceType,
        referenceId,
      });
      res.json({ ok: true, transaction: tx });
    } catch (e: any) {
      res.status(400).json({ ok: false, error: e.message });
    }
  });

  router.post("/owner-draw", async (req, res) => {
    try {
      const { amount, occurredAt, memo } = req.body;
      const tx = await recordOwnerDraw({
        amount: Number(amount),
        occurredAt: occurredAt ? new Date(occurredAt) : undefined,
        memo,
      });
      res.json({ ok: true, transaction: tx });
    } catch (e: any) {
      res.status(400).json({ ok: false, error: e.message });
    }
  });

  router.get("/income-statement", async (req, res) => {
    try {
      const start = new Date(String(req.query.start));
      const end = new Date(String(req.query.end));
      if (isNaN(start.getTime()) || isNaN(end.getTime())) {
        return res.status(400).json({ ok: false, error: "Invalid start or end date" });
      }
      const data = await getIncomeStatement({ start, end });
      res.json({ ok: true, data });
    } catch (e: any) {
      res.status(400).json({ ok: false, error: e.message });
    }
  });

  router.get("/balance-sheet", async (req, res) => {
    try {
      const asOf = new Date(String(req.query.asOf));
      if (isNaN(asOf.getTime())) {
        return res.status(400).json({ ok: false, error: "Invalid asOf date" });
      }
      const data = await getBalanceSheetAsOf({ asOf });
      res.json({ ok: true, data });
    } catch (e: any) {
      res.status(400).json({ ok: false, error: e.message });
    }
  });

  router.get("/activity", async (req, res) => {
    try {
      const start = new Date(String(req.query.start));
      const end = new Date(String(req.query.end));
      if (isNaN(start.getTime()) || isNaN(end.getTime())) {
        return res.status(400).json({ ok: false, error: "Invalid start or end date" });
      }
      const data = await getAccountActivity({ start, end });
      res.json({ ok: true, data });
    } catch (e: any) {
      res.status(400).json({ ok: false, error: e.message });
    }
  });

  router.get("/accounts", async (_req, res) => {
    try {
      const accounts = await getSystemAccounts();
      res.json({ ok: true, data: accounts });
    } catch (e: any) {
      res.status(400).json({ ok: false, error: e.message });
    }
  });

  router.get("/account-by-name/:name", async (req, res) => {
    try {
      const id = await getAccountIdByName(req.params.name);
      res.json({ ok: true, id });
    } catch (e: any) {
      res.status(404).json({ ok: false, error: e.message });
    }
  });

  router.get("/account-by-code/:code", async (req, res) => {
    try {
      const id = await getAccountIdByCode(req.params.code);
      res.json({ ok: true, id });
    } catch (e: any) {
      res.status(404).json({ ok: false, error: e.message });
    }
  });

  router.get("/account/:accountId", async (req, res) => {
    try {
      const start = req.query.start ? new Date(String(req.query.start)) : undefined;
      const end = req.query.end ? new Date(String(req.query.end)) : undefined;
      if (start && isNaN(start.getTime())) return res.status(400).json({ ok: false, error: "Invalid start date" });
      if (end && isNaN(end.getTime())) return res.status(400).json({ ok: false, error: "Invalid end date" });
      const data = await getAccountDrilldown({
        accountId: req.params.accountId,
        start,
        end,
        limit: req.query.limit ? Number(req.query.limit) : undefined,
        offset: req.query.offset ? Number(req.query.offset) : undefined,
      });
      res.json({ ok: true, data });
    } catch (e: any) {
      res.status(400).json({ ok: false, error: e.message });
    }
  });

  router.delete("/transactions/:id", async (req, res) => {
    try {
      const id = Array.isArray(req.params.id) ? req.params.id[0] : String(req.params.id ?? "");
      const deleted = await deleteTransaction(id);
      if (!deleted) return res.status(404).json({ ok: false, error: "Transaction not found" });
      res.json({ ok: true });
    } catch (e: any) {
      res.status(400).json({ ok: false, error: e.message });
    }
  });

  router.get("/cash-flow", async (req, res) => {
    try {
      const start = new Date(String(req.query.start || req.query.startDate || `${new Date().getFullYear()}-01-01`));
      const end = new Date(String(req.query.end || req.query.endDate || new Date().toISOString().slice(0, 10)));
      const data = await getCashFlow(start, end);
      res.json({ ok: true, data });
    } catch (e: any) {
      res.status(400).json({ ok: false, error: e.message });
    }
  });

  router.get("/transactions", async (req, res) => {
    try {
      const start = new Date(String(req.query.start || req.query.startDate || `${new Date().getFullYear()}-01-01`));
      const end = new Date(String(req.query.end || req.query.endDate || new Date().toISOString().slice(0, 10)));
      const data = await getTransactionsList(start, end);
      res.json({ ok: true, data });
    } catch (e: any) {
      res.status(400).json({ ok: false, error: e.message });
    }
  });

  return router;
}
