/**
 * Reminder delivery. Two channels are supported:
 *
 *   1. Carrier email-to-SMS gateway (REMINDER_SMS_EMAIL) - sends the text
 *      through the existing Resend email setup. No Twilio needed, and it
 *      sidesteps US A2P 10DLC carrier filtering.
 *   2. Twilio REST API (TWILIO_* + REMINDER_PHONE).
 *
 * If the gateway address is set it is preferred; otherwise Twilio is used.
 *
 * Configure via env:
 *   REMINDER_SMS_EMAIL   - carrier gateway address, e.g. 4055551234@vtext.com
 *   TWILIO_ACCOUNT_SID   - Twilio account SID (starts with AC...)
 *   TWILIO_AUTH_TOKEN    - Twilio auth token
 *   TWILIO_FROM_NUMBER   - the Twilio phone number to send from (E.164)
 *   REMINDER_PHONE       - the cell number Twilio reminders are sent to (E.164)
 */

import { getResendClient } from "./email";

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

export function getReminderSmsEmail(): string | null {
  return process.env.REMINDER_SMS_EMAIL || null;
}

/** True if any reminder channel (email gateway or Twilio) is configured. */
export function isReminderConfigured(): boolean {
  return !!getReminderSmsEmail() || isSmsConfigured();
}

/**
 * Sends a reminder over the best available channel. Prefers the carrier
 * email-to-SMS gateway when REMINDER_SMS_EMAIL is set, else Twilio.
 */
export async function sendReminder(body: string): Promise<void> {
  const gateway = getReminderSmsEmail();
  if (gateway) {
    const resend = getResendClient();
    if (!resend) {
      throw new Error("REMINDER_SMS_EMAIL is set but RESEND_API_KEY is not configured");
    }
    await resend.client.emails.send({
      from: resend.fromEmail,
      to: [gateway],
      subject: "Reminder",
      text: body,
    });
    return;
  }
  if (isSmsConfigured()) {
    await sendSms(getReminderPhone()!, body);
    return;
  }
  throw new Error("No reminder channel configured (set REMINDER_SMS_EMAIL or the TWILIO_* variables)");
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
