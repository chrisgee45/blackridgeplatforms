/**
 * Tiny envelope-encryption helper used by the project service-account
 * vault. AES-256-GCM with a server-side master key supplied via the
 * ACCOUNT_SECRETS_KEY env var (64 hex chars = 32 raw bytes).
 *
 * Encrypted blob format (base64):
 *   [12-byte IV][N-byte ciphertext][16-byte GCM auth tag]
 *
 * Why GCM: AEAD — tamper detection is free. Why 12-byte IV: spec default.
 * The auth tag is appended (not stored separately) so callers only handle
 * one opaque string.
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGO = "aes-256-gcm";
const IV_BYTES = 12;
const TAG_BYTES = 16;

let cachedKey: Buffer | null = null;
function loadKey(): Buffer | null {
  if (cachedKey) return cachedKey;
  const raw = process.env.ACCOUNT_SECRETS_KEY;
  if (!raw) return null;
  const hex = raw.trim();
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    console.warn("[secret-vault] ACCOUNT_SECRETS_KEY is set but not 64 hex chars — encryption disabled");
    return null;
  }
  cachedKey = Buffer.from(hex, "hex");
  return cachedKey;
}

export function isVaultConfigured(): boolean {
  return loadKey() !== null;
}

export function encryptSecrets(payload: Record<string, unknown> | null | undefined): string | null {
  if (!payload || Object.keys(payload).length === 0) return null;
  const key = loadKey();
  if (!key) {
    throw new Error("ACCOUNT_SECRETS_KEY not configured — cannot store secrets");
  }
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, key, iv);
  const plaintext = Buffer.from(JSON.stringify(payload), "utf8");
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, ciphertext, tag]).toString("base64");
}

export function decryptSecrets(envelope: string | null | undefined): Record<string, unknown> {
  if (!envelope) return {};
  const key = loadKey();
  if (!key) {
    throw new Error("ACCOUNT_SECRETS_KEY not configured — cannot decrypt secrets");
  }
  const buf = Buffer.from(envelope, "base64");
  if (buf.length < IV_BYTES + TAG_BYTES + 1) {
    throw new Error("Encrypted blob too short");
  }
  const iv = buf.subarray(0, IV_BYTES);
  const tag = buf.subarray(buf.length - TAG_BYTES);
  const ciphertext = buf.subarray(IV_BYTES, buf.length - TAG_BYTES);
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return JSON.parse(plaintext.toString("utf8"));
}

/**
 * Generate a fresh 32-byte hex key suitable for ACCOUNT_SECRETS_KEY.
 * Exposed via the keygen endpoint so Chris can copy a value into env vars
 * without leaving the OPS portal.
 */
export function generateMasterKey(): string {
  return randomBytes(32).toString("hex");
}
