/**
 * Bootstraps demo accounts for local development and evaluator/demo use.
 *
 * Public self-registration (`POST /api/auth/register`) always creates
 * "viewer" accounts, so there is intentionally no way to create an
 * admin or analyst through the API — this script is the only way,
 * and it is idempotent (safe to re-run; it skips users that already
 * exist).
 *
 * Usage:
 *   npm run seed:users
 *
 * Credentials are read from environment variables with documented
 * defaults for local/demo use only. Override them in your .env for
 * anything beyond a throwaway local demo.
 */
import { connectToDatabase, disconnectFromDatabase } from "../config/db";
import { logger } from "../config/logger";
import { User, UserRole } from "../models/User";
import { hashPassword } from "../utils/password";

interface SeedUser {
  name: string;
  email: string;
  password: string;
  role: UserRole;
}

const SEED_USERS: SeedUser[] = [
  {
    name: "Demo Admin",
    email: process.env.SEED_ADMIN_EMAIL || "admin@payguard.demo",
    password: process.env.SEED_ADMIN_PASSWORD || "AdminPass123!",
    role: "admin",
  },
  {
    name: "Demo Risk Analyst",
    email: process.env.SEED_ANALYST_EMAIL || "analyst@payguard.demo",
    password: process.env.SEED_ANALYST_PASSWORD || "AnalystPass123!",
    role: "analyst",
  },
  {
    name: "Demo Viewer",
    email: process.env.SEED_VIEWER_EMAIL || "viewer@payguard.demo",
    password: process.env.SEED_VIEWER_PASSWORD || "ViewerPass123!",
    role: "viewer",
  },
];

async function main() {
  await connectToDatabase();

  for (const seed of SEED_USERS) {
    const existing = await User.findOne({ email: seed.email });
    if (existing) {
      logger.info({ email: seed.email }, "Seed user already exists, skipping");
      continue;
    }

    const passwordHash = await hashPassword(seed.password);
    await User.create({
      name: seed.name,
      email: seed.email,
      passwordHash,
      role: seed.role,
    });
    logger.info({ email: seed.email, role: seed.role }, "Seed user created");
  }

  // eslint-disable-next-line no-console
  console.log("\nDemo accounts ready:");
  for (const seed of SEED_USERS) {
    // eslint-disable-next-line no-console
    console.log(`  ${seed.role.padEnd(8)} ${seed.email}  /  ${seed.password}`);
  }
  // eslint-disable-next-line no-console
  console.log("\nThese are for local/demo use only — change or remove before any real deployment.\n");

  await disconnectFromDatabase();
  process.exit(0);
}

main().catch((err) => {
  logger.error({ err }, "Seed script failed");
  process.exit(1);
});
