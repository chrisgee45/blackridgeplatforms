/**
 * Minimal Twilio SMS sender. Uses the Twilio REST API directly so there's
 * no extra dependency.
 *
 * Configure via env:
 *   TWILIO_ACCOUNT_SID   - Twilio account SID (starts with AC...)
 *   TWILIO_AUTH_TOKEN    - Twilio auth token
 *   TWILIO_FROM_NUMBER   - the Twilio phone number to send from (E.164, e.g. +14055551234)
 *   REMINDER_PHONE       - the cell number reminders are sent to (E.164)
 */

export function isSmsConfigured(): boolean {
  return !!(
    process.env.TWILIO_ACCOUNT_SID &&
    process.env.TWILIO_AUTH_TOKEN &&
    process.env.TWILIO_FROM_NUMBER &&
    process.env.REMINDER_PHONE
  );
}

export function getReminderPhone(): string | null {
  return process.env.REMINDER_PHONE || null;
}

export async function sendSms(to: string, body: string): Promise<void> {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_FROM_NUMBER;
  if (!sid || !token || !from) {
    throw new Error("Twilio is not configured");
  }
  const auth = Buffer.from(`${sid}:${token}`).toString("base64");
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ To: to, From: from, Body: body }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Twilio ${res.status}: ${text.slice(0, 200)}`);
  }
}
