import { Router } from "express";
import { isDbConnected } from "../config/db";
import { env } from "../config/env";
import { logger } from "../config/logger";

export const healthRouter = Router();

/**
 * GET /api/health
 *
 * Liveness + dependency status. Always returns 200 with a body that
 * describes which subsystems are up, rather than 500ing the whole
 * API just because a downstream (e.g. the ML service) is briefly
 * unavailable — the system is designed to degrade gracefully
 * (see Phase 5/6 fallback rules).
 */
healthRouter.get("/health", async (_req, res) => {
  const dbUp = isDbConnected();
  const mlStatus = await checkMlService();

  const overall = dbUp ? "ok" : "degraded";

  res.status(200).json({
    status: overall,
    service: "payguard-backend",
    timestamp: new Date().toISOString(),
    dependencies: {
      mongodb: dbUp ? "up" : "down",
      mlService: mlStatus,
    },
  });
});

async function checkMlService(): Promise<"up" | "down"> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);
    const resp = await fetch(`${env.ML_SERVICE_URL}/ml/health`, { signal: controller.signal });
    clearTimeout(timeout);
    return resp.ok ? "up" : "down";
  } catch (err) {
    logger.debug({ err }, "ML service health check failed");
    return "down";
  }
}
