import pino from "pino";
import { env } from "./env";

/**
 * Structured logger. In development, pretty-prints to stdout.
 * In production, emits plain JSON lines suitable for log aggregation.
 *
 * IMPORTANT: never log full request bodies for transaction ingestion
 * or auth routes — see middleware/requestLogger.ts for redaction rules.
 */
export const logger = pino({
  level: process.env.LOG_LEVEL || "info",
  transport:
    env.NODE_ENV === "development"
      ? {
          target: "pino-pretty",
          options: { colorize: true, translateTime: "HH:MM:ss", ignore: "pid,hostname" },
        }
      : undefined,
  redact: {
    paths: [
      "req.headers.authorization",
      "req.body.password",
      "req.body.cardToken",
      "req.body.cardNumber",
      "req.body.cvv",
    ],
    censor: "[REDACTED]",
  },
});
