import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { createServer } from "http";
import { ensureTemplates } from "./ensure-templates";
import { createSeoMiddleware } from "./seo-middleware";
import helmet from "helmet";
import cors from "cors";
import rateLimit from "express-rate-limit";

const app = express();
const httpServer = createServer(app);

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

const isDev = process.env.NODE_ENV !== "production";

const cspDirectives: Record<string, string[]> = {
  defaultSrc: ["'self'"],
  scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'", "https://js.stripe.com", "https://cdn.plaid.com"],
  styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
  fontSrc: ["'self'", "https://fonts.gstatic.com", "data:"],
  imgSrc: ["'self'", "data:", "https:", "blob:"],
  connectSrc: ["'self'", "https:", "wss:"],
  frameSrc: ["https://js.stripe.com", "https://cdn.plaid.com"],
  objectSrc: ["'none'"],
};

if (isDev) {
  cspDirectives.connectSrc!.push("ws:");
}

app.use(helmet({
  contentSecurityPolicy: { directives: cspDirectives },
  crossOriginEmbedderPolicy: false,
  xFrameOptions: { action: "sameorigin" },
  referrerPolicy: { policy: "strict-origin-when-cross-origin" },
}));

const allowedOrigins: string[] = [
  "https://blackridgeplatforms.com",
  "https://www.blackridgeplatforms.com",
];
// Extra comma-separated origins for staging/custom domains
if (process.env.ALLOWED_ORIGINS) {
  for (const origin of process.env.ALLOWED_ORIGINS.split(",")) {
    const trimmed = origin.trim();
    if (trimmed) allowedOrigins.push(trimmed);
  }
}
if (isDev) {
  allowedOrigins.push("http://localhost:5000", "http://localhost:5173");
}

app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error("Not allowed by CORS"));
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
}));

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, res) => {
    res.status(429).json({
      error: "Too many login attempts. Please try again in 15 minutes.",
      retryAfter: 900,
    });
  },
});

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests. Please slow down." },
});

app.use("/api/admin/login", authLimiter);
app.use("/api/auth/login", authLimiter);
app.use("/api/", apiLimiter);

if (process.env.NODE_ENV === "production") {
  app.use((req, res, next) => {
    if (req.path === "/api/health") return next();
    const userAgent = req.headers["user-agent"] || "";
    if (!userAgent || userAgent.includes("HealthCheck") || userAgent.includes("kube-probe") || userAgent.includes("GoogleHC")) return next();
    if (req.headers["x-forwarded-proto"] !== "https") {
      return res.redirect(301, `https://${req.hostname}${req.originalUrl}`);
    }
    next();
  });
}

app.use((req, res, next) => {
  const contentLength = parseInt(req.headers["content-length"] || "0", 10);
  if (contentLength > 1 * 1024 * 1024) {
    return res.status(413).json({ error: "Payload too large. Maximum size is 1MB." });
  }
  next();
});

app.use("/api/", (_req, res, next) => {
  res.setHeader("API-Version", "1.0.0");
  res.setHeader("X-API-Version", "1.0.0");
  next();
});

app.use(
  express.json({
    limit: "1mb",
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(express.urlencoded({ extended: false, limit: "1mb" }));

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      log(logLine);
    }
  });

  next();
});

(async () => {
  await ensureTemplates();
  app.use(createSeoMiddleware());

  await registerRoutes(httpServer, app);

  app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
    if (res.headersSent) {
      return next(err);
    }

    console.error(`[${new Date().toISOString()}] Error on ${_req.method} ${_req.path}:`, err);

    if (err.message && err.message.includes("CORS")) {
      return res.status(403).json({ error: "CORS policy violation" });
    }
    if (err.type === "entity.too.large") {
      return res.status(413).json({ error: "Payload too large. Maximum size is 1MB." });
    }
    if (err.name === "JsonWebTokenError" || err.name === "TokenExpiredError") {
      return res.status(401).json({ error: "Invalid or expired token" });
    }
    if (err.name === "ValidationError") {
      return res.status(422).json({ error: err.message });
    }

    const status = err.status || err.statusCode || 500;
    return res.status(status).json({
      error: isDev ? err.message : "An internal server error occurred",
    });
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = parseInt(process.env.PORT || "5000", 10);
  // reusePort is not supported on Windows — omit it and let the OS manage.
  httpServer.listen(port, "0.0.0.0", () => {
    log(`serving on port ${port}`);
  });
})();
