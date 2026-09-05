import { Router } from "express";
import { authenticate, authorize } from "../middleware/auth";
import { AppError } from "../middleware/errorHandler";
import { Transaction } from "../models/Transaction";
import { Alert } from "../models/Alert";
import { Case } from "../models/Case";
import { analyzeBatch, analyzeTransaction, RULE_ENGINE_VERSION } from "../services/riskAnalysisService";
import { asyncHandler } from "../utils/asyncHandler";
import { analyzeBatchSchema, analyzeTransactionSchema } from "../validation/transactionSchemas";

export const riskRouter = Router();

riskRouter.use(authenticate);

/**
 * POST /api/risk/analyze-transaction
 * Re-scores a single transaction on demand.
 */
riskRouter.post(
  "/analyze-transaction",
  authorize("admin", "analyst"),
  asyncHandler(async (req, res) => {
    const { transactionId } = analyzeTransactionSchema.parse(req.body);

    const txn = await Transaction.findOne({ transactionId });
    if (!txn) {
      throw new AppError("Transaction not found", 404, "TRANSACTION_NOT_FOUND");
    }

    const result = await analyzeTransaction(txn);
    res.status(200).json({ result });
  })
);

/**
 * POST /api/risk/analyze-batch
 * Scores transactions in batch.
 */
riskRouter.post(
  "/analyze-batch",
  authorize("admin", "analyst"),
  asyncHandler(async (req, res) => {
    const input = analyzeBatchSchema.parse(req.body ?? {});

    const filter: Record<string, unknown> = input.reanalyzeAll
      ? {}
      : input.uploadId
        ? { uploadId: input.uploadId }
        : { transactionId: { $in: input.transactionIds } };

    const result = await analyzeBatch(filter);
    res.status(200).json({ result, ruleEngineVersion: RULE_ENGINE_VERSION });
  })
);

/**
 * GET /api/risk/summary
 * Detailed dashboard statistics aggregate.
 */
riskRouter.get(
  "/summary",
  asyncHandler(async (_req, res) => {
    const [levelCounts, exposureAgg, totalCount, mlCoverage, scenarioAgg, openAlertsCount, totalCasesCount] = await Promise.all([
      Transaction.aggregate([{ $group: { _id: "$riskLevel", count: { $sum: 1 } } }]),
      Transaction.aggregate([
        { $match: { estimatedExposure: { $gt: 0 } } },
        { $group: { _id: null, totalAmount: { $sum: "$estimatedExposure" }, count: { $sum: 1 } } },
      ]),
      Transaction.countDocuments({}),
      Transaction.aggregate([
        { $match: { riskScore: { $exists: true } } },
        { $group: { _id: "$mlUsedFallback", count: { $sum: 1 } } },
      ]),
      Transaction.aggregate([
        { $match: { fraudScenario: { $exists: true, $ne: null } } },
        { $group: { _id: "$fraudScenario", count: { $sum: 1 } } },
      ]),
      Alert.countDocuments({ status: "OPEN" }),
      Case.countDocuments({}),
    ]);

    const byRiskLevel: Record<string, number> = { LOW: 0, MEDIUM: 0, HIGH: 0, CRITICAL: 0, UNSCORED: 0 };
    for (const bucket of levelCounts) {
      const key = bucket._id ?? "UNSCORED";
      byRiskLevel[key] = bucket.count;
    }

    let mlScored = 0;
    let rulesOnlyFallback = 0;
    for (const bucket of mlCoverage) {
      if (bucket._id === true) rulesOnlyFallback = bucket.count;
      else if (bucket._id === false) mlScored = bucket.count;
    }

    const fraudScenarios: Record<string, number> = {};
    for (const bucket of scenarioAgg) {
      if (bucket._id) {
        fraudScenarios[bucket._id] = bucket.count;
      }
    }

    res.status(200).json({
      totalTransactions: totalCount,
      byRiskLevel,
      simulatedExposure: {
        amount: exposureAgg[0]?.totalAmount ?? 0,
        transactionCount: exposureAgg[0]?.count ?? 0,
        note: "Sum of estimated exposure across HIGH and CRITICAL risk items.",
      },
      mlCoverage: {
        scoredWithMl: mlScored,
        rulesOnlyFallback,
      },
      fraudScenarios,
      openAlertsCount,
      totalCasesCount,
      ruleEngineVersion: RULE_ENGINE_VERSION,
    });
  })
);
