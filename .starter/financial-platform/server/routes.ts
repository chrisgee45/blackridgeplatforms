import type { Express, Request, Response, NextFunction } from "express";
import { registerBookkeepingRoutes } from "./bookkeeping-routes";
import { createAccountingV2Router } from "./accounting-v2-routes";
import { adminUsers } from "@shared/schema";
import { db } from "./db";
import { eq } from "drizzle-orm";

declare module "express-session" {
  interface SessionData {
    adminId?: string;
    isAdmin?: boolean;
  }
}

function isAuthenticated(req: Request, res: Response, next: NextFunction) {
  if (req.session?.isAdmin) return next();
  res.status(401).json({ message: "Unauthorized" });
}

export function registerRoutes(app: Express) {
  app.post("/api/auth/login", async (req, res) => {
    try {
      const { username, password } = req.body;
      const expectedUsername = process.env.ADMIN_USERNAME || "admin";
      const expectedPassword = process.env.ADMIN_PASSWORD || "admin";

      if (username !== expectedUsername || password !== expectedPassword) {
        return res.status(401).json({ message: "Invalid credentials" });
      }

      let [user] = await db.select().from(adminUsers).where(eq(adminUsers.username, username)).limit(1);
      if (!user) {
        [user] = await db.insert(adminUsers).values({ username }).returning();
      }
      await db.update(adminUsers).set({ lastLoginAt: new Date() }).where(eq(adminUsers.id, user.id));

      req.session.adminId = user.id;
      req.session.isAdmin = true;
      res.json({ success: true, user: { id: user.id, username: user.username } });
    } catch (error) {
      res.status(500).json({ message: "Login failed" });
    }
  });

  app.post("/api/auth/logout", (req, res) => {
    req.session.destroy(() => {
      res.json({ success: true });
    });
  });

  app.get("/api/auth/me", (req, res) => {
    if (req.session?.isAdmin) {
      return res.json({ authenticated: true, adminId: req.session.adminId });
    }
    res.json({ authenticated: false });
  });

  registerBookkeepingRoutes(app, isAuthenticated);

  const v2Router = createAccountingV2Router(isAuthenticated);
  app.use("/api/accounting/v2", v2Router);
}
