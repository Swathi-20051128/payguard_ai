import cors from "cors";
import express, { Express } from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import pinoHttp from "pino-http";
import { env } from "./config/env";
import { logger } from "./config/logger";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler";
import { alertsRouter } from "./routes/alerts";
import { auditRouter } from "./routes/audit";
import { authRouter } from "./routes/auth";
import { casesRouter } from "./routes/cases";
import { healthRouter } from "./routes/health";
import { riskRouter } from "./routes/risk";
import { transactionsRouter } from "./routes/transactions";

/**
 * Builds (but does not start) the Express app. Kept separate from
 * index.ts so tests can import the app directly with supertest
 * without binding a real port or connecting to a real database.
 */
export function createApp(): Express {
  const app = express();

  // Security headers
  app.use(helmet());

  // CORS — restrict to configured origin(s)
  const allowedOrigins = env.CORS_ORIGIN.split(",").map((o) => o.trim());
  app.use(
    cors({
      origin: allowedOrigins,
      credentials: true,
    })
  );

  // Body parsing — bounded size to avoid abuse via huge payloads
  app.use(express.json({ limit: "1mb" }));
  app.use(express.urlencoded({ extended: true, limit: "1mb" }));

  // Request logging (redacts sensitive fields — see config/logger.ts)
  app.use(pinoHttp({ logger, autoLogging: env.NODE_ENV !== "test" }));

  // Global rate limiting. Auth and upload routes apply stricter
  // limits locally in later phases.
  app.use(
    rateLimit({
      windowMs: env.RATE_LIMIT_WINDOW_MS,
      max: env.RATE_LIMIT_MAX,
      standardHeaders: true,
      legacyHeaders: false,
    })
  );

  // Routes
  app.use("/api", healthRouter);
  app.use("/api", authRouter);
  // Mounted at its own prefix (rather than bare "/api") so that
  // transactionsRouter's blanket `.use(authenticate)` only intercepts
  // requests actually under /api/transactions — not every unmatched
  // path under /api, which would otherwise return a misleading 401
  // instead of falling through to the 404 handler.
  app.use("/api/transactions", transactionsRouter);
  app.use("/api/risk", riskRouter);
  app.use("/api/alerts", alertsRouter);
  app.use("/api/cases", casesRouter);
  app.use("/api/audit-logs", auditRouter);

  app.get("/", (_req, res) => {
    res.json({ service: "PayGuard AI backend", status: "running" });
  });

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
