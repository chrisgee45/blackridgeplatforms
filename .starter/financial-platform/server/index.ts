import express from "express";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import { registerRoutes } from "./routes";
import { pool } from "./db";
import { startRecurringExpenseRunner } from "./recurring-expenses";

const app = express();
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: false }));

const PgSession = connectPgSimple(session);
app.use(
  session({
    store: new PgSession({ pool, createTableIfMissing: true }),
    secret: process.env.SESSION_SECRET || "financial-platform-secret",
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false, maxAge: 7 * 24 * 60 * 60 * 1000 },
  })
);

registerRoutes(app);

const PORT = parseInt(process.env.PORT || "5000", 10);

(async () => {
  if (process.env.NODE_ENV === "production") {
    const { serveStatic } = await import("./static");
    serveStatic(app);
  } else {
    const { createServer } = await import("http");
    const { setupVite } = await import("./vite");
    const server = createServer(app);
    await setupVite(server, app);
    server.listen(PORT, "0.0.0.0", () => {
      console.log(`Financial Platform running on port ${PORT}`);
    });
    startRecurringExpenseRunner();
    return;
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Financial Platform running on port ${PORT}`);
  });
  startRecurringExpenseRunner();
})();
