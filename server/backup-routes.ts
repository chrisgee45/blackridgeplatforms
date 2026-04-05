import { Router, Request, Response } from "express";
import { performBackup, getBackupHistory, getBackupStats } from "./backup-service";

export function registerBackupRoutes(app: Router, isAuthenticated: any) {
  app.get("/api/ops/backups", isAuthenticated, async (_req: Request, res: Response) => {
    try {
      const history = await getBackupHistory();
      res.json(history);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/ops/backups/stats", isAuthenticated, async (_req: Request, res: Response) => {
    try {
      const stats = await getBackupStats();
      res.json(stats);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/ops/backups/trigger", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const role = (req.session as any)?.adminRole || ((req.session as any)?.isAdmin ? "admin" : null);
      if (role !== "admin") {
        return res.status(403).json({ message: "Admin role required to trigger backups" });
      }

      res.json({ message: "Backup started", status: "in_progress" });

      performBackup("manual")
        .then((result) => {
          if (!result.success) {
            console.error("Manual backup failed:", result.error);
          }
        })
        .catch((err) => console.error("Manual backup error:", err.message));
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });
}
