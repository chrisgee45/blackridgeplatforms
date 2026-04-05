import { Resend } from "resend";

/**
 * Returns a configured Resend client + fromEmail, or null if RESEND_API_KEY
 * is not set. Used across the codebase wherever we send transactional email.
 *
 * Configure via env:
 *   RESEND_API_KEY=re_xxx
 *   RESEND_FROM_EMAIL=chris@blackridgeplatforms.com
 */
export function getResendClient(): { client: Resend; fromEmail: string } | null {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return null;
  return {
    client: new Resend(apiKey),
    fromEmail: process.env.RESEND_FROM_EMAIL || "chris@blackridgeplatforms.com",
  };
}
