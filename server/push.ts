import webpush from "web-push";
import { db } from "./db";
import { pushSubscriptions } from "@shared/schema";
import { eq } from "drizzle-orm";

let configured = false;
let publicKey = "";

/**
 * Configures web-push from the VAPID env vars. Call once on startup.
 * Never throws: a missing or malformed key just leaves push disabled,
 * it must not be able to crash the server.
 *   VAPID_PUBLIC_KEY  - shared with the browser to subscribe
 *   VAPID_PRIVATE_KEY - signs push messages from the server
 */
export function initPush(): void {
  const pub = (process.env.VAPID_PUBLIC_KEY || "").trim();
  const priv = (process.env.VAPID_PRIVATE_KEY || "").trim();
  if (!pub || !priv) {
    console.log("Web push not configured (VAPID keys missing)");
    return;
  }
  try {
    webpush.setVapidDetails("mailto:chris@blackridgeplatforms.com", pub, priv);
    publicKey = pub;
    configured = true;
    console.log("Web push configured");
  } catch (err: any) {
    console.error("Web push disabled - invalid VAPID keys:", err?.message);
  }
}

export function isPushConfigured(): boolean {
  return configured;
}

export function getVapidPublicKey(): string {
  return publicKey;
}

/** Sends a notification to every saved browser subscription. */
export async function sendPushToAll(payload: { title: string; body: string; url?: string }): Promise<void> {
  if (!configured) return;
  const subs = await db.select().from(pushSubscriptions);
  const data = JSON.stringify(payload);
  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          data,
        );
      } catch (err: any) {
        // 404/410 mean the subscription is dead - drop it.
        if (err?.statusCode === 404 || err?.statusCode === 410) {
          await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, s.id));
        } else {
          console.error("Push send failed:", err?.statusCode, err?.body || err?.message);
        }
      }
    }),
  );
}
