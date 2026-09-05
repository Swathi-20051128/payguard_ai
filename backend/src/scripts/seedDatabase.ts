/**
 * Comprehensive database seed script for PayGuard AI.
 * 
 * 1. Bootstraps demo accounts (admin, analyst, viewer).
 * 2. Generates ~200 synthetic transactions spanning 10 fraud scenarios.
 * 3. Evaluates risk scores using rules + ML engine.
 * 4. Generates alerts, opens investigation cases, and populates audit logs.
 * 
 * Usage:
 *   npm run seed:all
 */
import "dotenv/config";
import { connectToDatabase, disconnectFromDatabase } from "../config/db";
import { logger } from "../config/logger";
import { User, UserRole } from "../models/User";
import { Upload } from "../models/Upload";
import { Transaction } from "../models/Transaction";
import { Alert } from "../models/Alert";
import { Case } from "../models/Case";
import { AuditLog } from "../models/AuditLog";
import { hashPassword } from "../utils/password";
import { generateDataset } from "../services/generator";
import { ingestJsonArray } from "../services/csvIngestService";
import { newIngestResult } from "../services/transactionIngestService";
import { analyzeBatch } from "../services/riskAnalysisService";
import { createCase } from "../services/caseService";
import { recordAudit } from "../services/auditService";
import { generateSampleSchema } from "../validation/transactionSchemas";

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
  // eslint-disable-next-line no-console
  console.log("🌱 Starting PayGuard AI Comprehensive Database Seeding...");
  await connectToDatabase();

  // Clear previous dataset collections to allow clean re-seeding
  await Transaction.deleteMany({});
  await Alert.deleteMany({});
  await Case.deleteMany({});
  await AuditLog.deleteMany({});
  await Upload.deleteMany({});

  // 1. Seed Demo Users
  let adminUserId = "";
  let analystUserId = "";
  for (const seed of SEED_USERS) {
    let user = await User.findOne({ email: seed.email });
    if (!user) {
      const passwordHash = await hashPassword(seed.password);
      user = await User.create({
        name: seed.name,
        email: seed.email,
        passwordHash,
        role: seed.role,
      });
      logger.info({ email: seed.email, role: seed.role }, "Seed user created");
    }
    if (seed.role === "admin") adminUserId = user.id;
    if (seed.role === "analyst") analystUserId = user.id;
  }
  // eslint-disable-next-line no-console
  console.log("✅ Demo users ready.");

  // 2. Generate Synthetic Transactions with higher suspicious rate for rich alerts
  // eslint-disable-next-line no-console
  console.log("⚡ Generating 200 synthetic transactions across 10 fraud scenarios...");
  const upload = await Upload.create({
    filename: "seed-dataset-200-transactions",
    source: "generated",
    status: "processing",
    uploadedBy: adminUserId,
  });

  const parsedInput = generateSampleSchema.parse({
    transactionCount: 200,
    customerCount: 40,
    merchantCount: 15,
    deviceCount: 50,
    cardTokenCount: 60,
    ipHashCount: 50,
    suspiciousRate: 0.35,
  });

  const { rows, scenarioCounts } = generateDataset(parsedInput, 100);
  const ingestRes = newIngestResult();

  await ingestJsonArray(
    rows.map((r) => ({ ...r, timestamp: r.timestamp.toISOString() })),
    upload.id,
    ingestRes
  );

  upload.status = "completed";
  upload.totalRows = ingestRes.totalRows;
  upload.insertedCount = ingestRes.insertedCount;
  upload.duplicateCount = ingestRes.duplicateCount;
  upload.invalidCount = ingestRes.invalidCount;
  upload.sampleErrors = ingestRes.sampleErrors;
  upload.completedAt = new Date();
  await upload.save();

  // eslint-disable-next-line no-console
  console.log(`✅ Ingested ${ingestRes.insertedCount} transactions. Scenario breakdown:`, scenarioCounts);

  // 3. Batch Risk Analysis
  // eslint-disable-next-line no-console
  console.log("🔍 Running automated Risk Scoring (Rules + ML) & Alert generation...");
  const batchRes = await analyzeBatch({});
  // eslint-disable-next-line no-console
  console.log(`✅ Scored ${batchRes.totalAnalyzed} transactions across risk levels:`, batchRes.byRiskLevel);

  // 4. Create Investigation Cases from Open Risk Alerts
  const openAlerts = await Alert.find({ status: "OPEN" }).limit(10);
  // eslint-disable-next-line no-console
  console.log(`🚨 Opening sample investigation cases for ${openAlerts.length} risk alerts...`);

  for (let i = 0; i < openAlerts.length; i++) {
    const alert = openAlerts[i];
    try {
      const createdCase = await createCase([alert.id], { userId: analystUserId });
      await recordAudit({
        userId: analystUserId,
        action: "CASE_ASSIGNED",
        entityType: "CASE",
        entityId: createdCase.id,
        newState: { assignedTo: analystUserId },
      });
    } catch {
      // Ignore if already cased
    }
  }

  // Record initial system ingestion audit log
  await recordAudit({
    userId: adminUserId,
    action: "DATASET_INGESTED",
    entityType: "TRANSACTION",
    entityId: upload.id,
    newState: { totalRows: ingestRes.insertedCount, source: "generated" },
  });

  // eslint-disable-next-line no-console
  console.log("\n🎉 Database Seeding Complete! Every page (Dashboard, Transactions, Alerts, Cases, Audit) is now fully populated.");
  // eslint-disable-next-line no-console
  console.log("   Admin login:    admin@payguard.demo   / AdminPass123!");
  // eslint-disable-next-line no-console
  console.log("   Analyst login:  analyst@payguard.demo / AnalystPass123!");
  // eslint-disable-next-line no-console
  console.log("   Viewer login:   viewer@payguard.demo  / ViewerPass123!\n");

  await disconnectFromDatabase();
  process.exit(0);
}

main().catch((err) => {
  logger.error({ err }, "Seed script failed");
  process.exit(1);
});
