/**
 * CRUD routes for the project service-account vault. Non-secret fields
 * round-trip in plaintext for searchability; the secrets blob is
 * returned only when the caller hits the explicit reveal endpoint.
 */
import type { Express, RequestHandler } from "express";
import { db } from "./db";
import { projectServiceAccounts, blackridgeServiceAccounts } from "@shared/schema";
import { eq, desc, sql } from "drizzle-orm";
import {
  encryptSecrets,
  decryptSecrets,
  isVaultConfigured,
  generateMasterKey,
} from "./secret-vault";

let schemaReady: Promise<void> | null = null;
async function ensureServiceAccountsSchema(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS project_service_accounts (
      id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
      project_id varchar NOT NULL REFERENCES projects(id),
      service text NOT NULL,
      label text,
      account_email text,
      account_id text,
      login_url text,
      notes text,
      secrets_encrypted text,
      created_at timestamptz DEFAULT now(),
      updated_at timestamptz DEFAULT now()
    )
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS project_service_accounts_project_id_idx
      ON project_service_accounts (project_id)
  `);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS blackridge_service_accounts (
      id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
      service text NOT NULL,
      label text,
      account_email text,
      account_id text,
      login_url text,
      notes text,
      secrets_encrypted text,
      created_at timestamptz DEFAULT now(),
      updated_at timestamptz DEFAULT now()
    )
  `);
}
function getSchemaReady(): Promise<void> {
  if (!schemaReady) {
    schemaReady = ensureServiceAccountsSchema().catch(err => {
      console.error("Service-account schema error:", err);
      schemaReady = null;
      throw err;
    });
  }
  return schemaReady;
}

export function registerServiceAccountRoutes(app: Express, isAuthenticated: RequestHandler): void {
  // Capability probe — UI uses this to decide whether to show the
  // secrets fields and "Reveal" buttons or to nudge Chris to set
  // ACCOUNT_SECRETS_KEY.
  app.get("/api/ops/service-accounts/vault-status", isAuthenticated, async (_req, res) => {
    res.json({ configured: isVaultConfigured() });
  });

  // One-shot key generator. Returns a fresh hex key so Chris can copy
  // it straight into Railway env vars without leaving the OPS portal.
  // The key is not stored anywhere on the server — that's the user's
  // job (and it's the whole point of a master key).
  app.post("/api/ops/service-accounts/generate-key", isAuthenticated, async (_req, res) => {
    res.json({ key: generateMasterKey() });
  });

  app.get("/api/ops/projects/:projectId/service-accounts", isAuthenticated, async (req, res) => {
    try {
      await getSchemaReady();
      const rows = await db
        .select({
          id: projectServiceAccounts.id,
          projectId: projectServiceAccounts.projectId,
          service: projectServiceAccounts.service,
          label: projectServiceAccounts.label,
          accountEmail: projectServiceAccounts.accountEmail,
          accountId: projectServiceAccounts.accountId,
          loginUrl: projectServiceAccounts.loginUrl,
          notes: projectServiceAccounts.notes,
          hasSecrets: projectServiceAccounts.secretsEncrypted,
          createdAt: projectServiceAccounts.createdAt,
          updatedAt: projectServiceAccounts.updatedAt,
        })
        .from(projectServiceAccounts)
        .where(eq(projectServiceAccounts.projectId, String(req.params.projectId)))
        .orderBy(desc(projectServiceAccounts.updatedAt));
      // Coerce hasSecrets to a boolean so the API never returns
      // the actual blob in the list view.
      res.json(rows.map(r => ({ ...r, hasSecrets: !!r.hasSecrets })));
    } catch (err: any) {
      console.error("List service accounts error:", err);
      res.status(500).json({ message: err?.message ?? "Failed to load accounts" });
    }
  });

  app.post("/api/ops/projects/:projectId/service-accounts", isAuthenticated, async (req, res) => {
    try {
      await getSchemaReady();
      const { service, label, accountEmail, accountId, loginUrl, notes, secrets } = req.body || {};
      if (!service || typeof service !== "string") {
        return res.status(400).json({ message: "service is required" });
      }
      const secretsEncrypted = secrets && typeof secrets === "object" && Object.keys(secrets).length > 0
        ? encryptSecrets(secrets)
        : null;
      const [row] = await db.insert(projectServiceAccounts).values({
        projectId: String(req.params.projectId),
        service,
        label: label ?? null,
        accountEmail: accountEmail ?? null,
        accountId: accountId ?? null,
        loginUrl: loginUrl ?? null,
        notes: notes ?? null,
        secretsEncrypted,
      }).returning();
      res.status(201).json({
        ...row,
        secretsEncrypted: undefined,
        hasSecrets: !!row.secretsEncrypted,
      });
    } catch (err: any) {
      console.error("Create service account error:", err);
      res.status(500).json({ message: err?.message ?? "Failed to create" });
    }
  });

  app.patch("/api/ops/service-accounts/:id", isAuthenticated, async (req, res) => {
    try {
      await getSchemaReady();
      const id = String(req.params.id);
      const [existing] = await db.select().from(projectServiceAccounts).where(eq(projectServiceAccounts.id, id));
      if (!existing) return res.status(404).json({ message: "Not found" });

      const { service, label, accountEmail, accountId, loginUrl, notes, secrets, clearSecrets } = req.body || {};
      const patch: Record<string, unknown> = { updatedAt: new Date() };
      if (typeof service === "string") patch.service = service;
      if (label !== undefined) patch.label = label;
      if (accountEmail !== undefined) patch.accountEmail = accountEmail;
      if (accountId !== undefined) patch.accountId = accountId;
      if (loginUrl !== undefined) patch.loginUrl = loginUrl;
      if (notes !== undefined) patch.notes = notes;
      if (clearSecrets) {
        patch.secretsEncrypted = null;
      } else if (secrets && typeof secrets === "object" && Object.keys(secrets).length > 0) {
        patch.secretsEncrypted = encryptSecrets(secrets);
      }

      const [row] = await db.update(projectServiceAccounts).set(patch).where(eq(projectServiceAccounts.id, id)).returning();
      res.json({
        ...row,
        secretsEncrypted: undefined,
        hasSecrets: !!row.secretsEncrypted,
      });
    } catch (err: any) {
      console.error("Update service account error:", err);
      res.status(500).json({ message: err?.message ?? "Failed to update" });
    }
  });

  app.delete("/api/ops/service-accounts/:id", isAuthenticated, async (req, res) => {
    try {
      await db.delete(projectServiceAccounts).where(eq(projectServiceAccounts.id, String(req.params.id)));
      res.json({ ok: true });
    } catch (err: any) {
      console.error("Delete service account error:", err);
      res.status(500).json({ message: err?.message ?? "Failed to delete" });
    }
  });

  // Reveal — explicit endpoint Chris hits when he clicks "Show".
  // Logged so any read of a secret leaves a trail.
  app.post("/api/ops/service-accounts/:id/reveal", isAuthenticated, async (req, res) => {
    try {
      const id = String(req.params.id);
      const [row] = await db.select().from(projectServiceAccounts).where(eq(projectServiceAccounts.id, id));
      if (!row) return res.status(404).json({ message: "Not found" });
      const secrets = row.secretsEncrypted ? decryptSecrets(row.secretsEncrypted) : {};
      console.log(`[secret-vault] reveal id=${id} service=${row.service} project=${row.projectId}`);
      res.json({ secrets });
    } catch (err: any) {
      console.error("Reveal service account error:", err);
      res.status(500).json({ message: err?.message ?? "Failed to reveal" });
    }
  });

  // === BlackRidge-scoped vault (the OPS "Vault" page) ===
  // Same shape as the project-scoped routes above but without a
  // projectId. These are the platform's own accounts: Railway,
  // Resend, Anthropic, AWS, Stripe, etc.

  app.get("/api/ops/blackridge/service-accounts", isAuthenticated, async (_req, res) => {
    try {
      await getSchemaReady();
      const rows = await db
        .select({
          id: blackridgeServiceAccounts.id,
          service: blackridgeServiceAccounts.service,
          label: blackridgeServiceAccounts.label,
          accountEmail: blackridgeServiceAccounts.accountEmail,
          accountId: blackridgeServiceAccounts.accountId,
          loginUrl: blackridgeServiceAccounts.loginUrl,
          notes: blackridgeServiceAccounts.notes,
          hasSecrets: blackridgeServiceAccounts.secretsEncrypted,
          createdAt: blackridgeServiceAccounts.createdAt,
          updatedAt: blackridgeServiceAccounts.updatedAt,
        })
        .from(blackridgeServiceAccounts)
        .orderBy(desc(blackridgeServiceAccounts.updatedAt));
      res.json(rows.map(r => ({ ...r, hasSecrets: !!r.hasSecrets })));
    } catch (err: any) {
      console.error("List blackridge accounts error:", err);
      res.status(500).json({ message: err?.message ?? "Failed to load accounts" });
    }
  });

  app.post("/api/ops/blackridge/service-accounts", isAuthenticated, async (req, res) => {
    try {
      await getSchemaReady();
      const { service, label, accountEmail, accountId, loginUrl, notes, secrets } = req.body || {};
      if (!service || typeof service !== "string") {
        return res.status(400).json({ message: "service is required" });
      }
      const secretsEncrypted = secrets && typeof secrets === "object" && Object.keys(secrets).length > 0
        ? encryptSecrets(secrets)
        : null;
      const [row] = await db.insert(blackridgeServiceAccounts).values({
        service,
        label: label ?? null,
        accountEmail: accountEmail ?? null,
        accountId: accountId ?? null,
        loginUrl: loginUrl ?? null,
        notes: notes ?? null,
        secretsEncrypted,
      }).returning();
      res.status(201).json({
        ...row,
        secretsEncrypted: undefined,
        hasSecrets: !!row.secretsEncrypted,
      });
    } catch (err: any) {
      console.error("Create blackridge account error:", err);
      res.status(500).json({ message: err?.message ?? "Failed to create" });
    }
  });

  app.patch("/api/ops/blackridge/service-accounts/:id", isAuthenticated, async (req, res) => {
    try {
      await getSchemaReady();
      const id = String(req.params.id);
      const [existing] = await db.select().from(blackridgeServiceAccounts).where(eq(blackridgeServiceAccounts.id, id));
      if (!existing) return res.status(404).json({ message: "Not found" });
      const { service, label, accountEmail, accountId, loginUrl, notes, secrets, clearSecrets } = req.body || {};
      const patch: Record<string, unknown> = { updatedAt: new Date() };
      if (typeof service === "string") patch.service = service;
      if (label !== undefined) patch.label = label;
      if (accountEmail !== undefined) patch.accountEmail = accountEmail;
      if (accountId !== undefined) patch.accountId = accountId;
      if (loginUrl !== undefined) patch.loginUrl = loginUrl;
      if (notes !== undefined) patch.notes = notes;
      if (clearSecrets) {
        patch.secretsEncrypted = null;
      } else if (secrets && typeof secrets === "object" && Object.keys(secrets).length > 0) {
        patch.secretsEncrypted = encryptSecrets(secrets);
      }
      const [row] = await db.update(blackridgeServiceAccounts).set(patch).where(eq(blackridgeServiceAccounts.id, id)).returning();
      res.json({ ...row, secretsEncrypted: undefined, hasSecrets: !!row.secretsEncrypted });
    } catch (err: any) {
      console.error("Update blackridge account error:", err);
      res.status(500).json({ message: err?.message ?? "Failed to update" });
    }
  });

  app.delete("/api/ops/blackridge/service-accounts/:id", isAuthenticated, async (req, res) => {
    try {
      await db.delete(blackridgeServiceAccounts).where(eq(blackridgeServiceAccounts.id, String(req.params.id)));
      res.json({ ok: true });
    } catch (err: any) {
      console.error("Delete blackridge account error:", err);
      res.status(500).json({ message: err?.message ?? "Failed to delete" });
    }
  });

  app.post("/api/ops/blackridge/service-accounts/:id/reveal", isAuthenticated, async (req, res) => {
    try {
      const id = String(req.params.id);
      const [row] = await db.select().from(blackridgeServiceAccounts).where(eq(blackridgeServiceAccounts.id, id));
      if (!row) return res.status(404).json({ message: "Not found" });
      const secrets = row.secretsEncrypted ? decryptSecrets(row.secretsEncrypted) : {};
      console.log(`[secret-vault] reveal blackridge id=${id} service=${row.service}`);
      res.json({ secrets });
    } catch (err: any) {
      console.error("Reveal blackridge account error:", err);
      res.status(500).json({ message: err?.message ?? "Failed to reveal" });
    }
  });
}
