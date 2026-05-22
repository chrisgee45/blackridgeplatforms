import type { Express, RequestHandler } from "express";
import { db } from "./db";
import { pushSubscriptions } from "@shared/schema";
import { eq, sql } from "drizzle-orm";
import { getVapidPublicKey, isPushConfigured, sendPushToAll } from "./push";

/** Creates the push_subscriptions table if it doesn't exist (no migration runner). */
export async function ensurePushTable(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS push_subscriptions (
      id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
      endpoint text NOT NULL UNIQUE,
      p256dh text NOT NULL,
      auth text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `);
}

export function registerPushRoutes(app: Express, isAuthenticated: RequestHandler) {
  app.get("/api/push/vapid", isAuthenticated, (_req, res) => {
    res.json({ publicKey: getVapidPublicKey(), configured: isPushConfigured() });
  });

  app.post("/api/push/subscribe", isAuthenticated, async (req, res) => {
    try {
      const sub = req.body;
      if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth) {
        return res.status(400).json({ message: "Invalid subscription" });
      }
      await db
        .insert(pushSubscriptions)
        .values({ endpoint: sub.endpoint, p256dh: sub.keys.p256dh, auth: sub.keys.auth })
        .onConflictDoNothing();
      res.json({ success: true });
    } catch (error: any) {
      console.error("Push subscribe error:", error);
      res.status(500).json({ message: "Failed to save subscription" });
    }
  });

  app.post("/api/push/unsubscribe", isAuthenticated, async (req, res) => {
    try {
      if (typeof req.body?.endpoint === "string") {
        await db.delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, req.body.endpoint));
      }
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ message: "Failed to unsubscribe" });
    }
  });

  app.post("/api/push/test", isAuthenticated, async (_req, res) => {
    try {
      if (!isPushConfigured()) {
        return res.status(400).json({ message: "Push is not configured. Set VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY in Railway." });
      }
      await sendPushToAll({ title: "BlackRidge CRM", body: "Push alerts are working on this device.", url: "/admin" });
      res.json({ success: true });
    } catch (error: any) {
      console.error("Push test error:", error);
      res.status(500).json({ message: error?.message || "Failed to send test push" });
    }
  });
}
