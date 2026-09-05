import dns from "dns";

// Ensure public DNS fallback runs BEFORE any database or network imports
try {
  dns.setServers(["8.8.8.8", "1.1.1.1", "8.8.4.4"]);
} catch {
  // Ignore if system policy restricts custom DNS servers
}

import dotenv from "dotenv";
import path from "path";
import { z } from "zod";

// Load .env from local CWD or root directory
dotenv.config();
dotenv.config({ path: path.resolve(__dirname, "../../../.env") });

/**
 * All environment configuration is validated once at boot.
 * If a required variable is missing or malformed, the process
 * fails fast with a clear error instead of failing later in a
 * confusing place (e.g. a silent undefined JWT secret).
 */
const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),

  MONGO_URI: z.string().min(1).default("mongodb://localhost:27017/payguard"),
  REDIS_URL: z.string().min(1).default("redis://localhost:6379"),
  ML_SERVICE_URL: z.string().url().default("http://localhost:8001"),

  JWT_SECRET: z.string().min(8, "JWT_SECRET must be at least 8 characters").default("dev_only_change_me_please_1234"),
  JWT_EXPIRES_IN: z.string().default("8h"),

  CORS_ORIGIN: z.string().default("http://localhost:5173"),

  MAX_UPLOAD_SIZE_MB: z.coerce.number().positive().default(25),
  UPLOAD_DIR: z.string().default("./uploads"),

  RATE_LIMIT_WINDOW_MS: z.coerce.number().positive().default(60_000),
  RATE_LIMIT_MAX: z.coerce.number().positive().default(120),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  // eslint-disable-next-line no-console
  console.error("❌ Invalid environment configuration:", parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
export type Env = typeof env;
