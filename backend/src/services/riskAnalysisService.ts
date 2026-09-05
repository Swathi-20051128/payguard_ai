import { ITransaction, Transaction } from "../models/Transaction";
import { mapWithConcurrency } from "../utils/concurrency";
import { upsertAlertForTransaction, upsertAlertsForBatch } from "./alertService";
import { CombinedRiskResult, combineRiskScores, RULE_ENGINE_VERSION } from "./combinedRiskScoring";
import { mapContextToMlPayload, MlPredictionResult, MlTransactionPayload, scoreBatch, scoreOne } from "./mlClient";
import { fetchAnalysisContext } from "./rules/context";
import { evaluateRules } from "./rules/rules";
import { AnalysisContext } from "./rules/types";
import { aggregateRisk } from "./riskScoring";

export { RULE_ENGINE_VERSION };

/** How many transactions have their CONTEXT fetched (Mongo-bound work) concurrently in a batch run. */
const CONTEXT_FETCH_CONCURRENCY = 25;

export interface AnalyzeResult {
  transactionId: string;
  riskScore: number;
  riskLevel: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  reasons: string[];
  confidence: "high" | "medium" | "low";
  estimatedExposure: number;
  mlUsedFallback: boolean;
}

function toAnalyzeResult(transactionId: string, combined: CombinedRiskResult): AnalyzeResult {
  return {
    transactionId,
    riskScore: combined.riskScore,
    riskLevel: combined.riskLevel,
    reasons: combined.reasons,
    confidence: combined.confidence,
    estimatedExposure: combined.estimatedExposure,
    mlUsedFallback: combined.mlUsedFallback,
  };
}

function contextInputFor(txn: ITransaction) {
  return {
    transactionId: txn.transactionId,
    orderId: txn.orderId,
    amount: txn.amount,
    refundAmount: txn.refundAmount,
    chargebackFlag: txn.chargebackFlag,
    city: txn.city,
    merchantId: txn.merchantId,
    customerId: txn.customerId,
    deviceId: txn.deviceId,
    ipHash: txn.ipHash,
    timestamp: txn.timestamp,
  };
}

function runRules(txn: ITransaction, context: AnalysisContext) {
  const findings = evaluateRules(
    {
      transactionId: txn.transactionId,
      amount: txn.amount,
      refundAmount: txn.refundAmount,
      chargebackFlag: txn.chargebackFlag,
      city: txn.city,
    },
    context
  );
  return aggregateRisk(findings);
}

function persistUpdate(transactionId: string, combined: CombinedRiskResult) {
  return {
    updateOne: {
      filter: { transactionId },
      update: {
        $set: {
          riskScore: combined.riskScore,
          riskLevel: combined.riskLevel,
          riskReasons: combined.reasons,
          confidence: combined.confidence,
          estimatedExposure: combined.estimatedExposure,
          ruleScore: combined.ruleScore,
          ruleEngineVersion: combined.ruleEngineVersion,
          mlAnomalyScore: combined.mlAnomalyScore,
          mlSupervisedProbability: combined.mlSupervisedProbability,
          mlModelVersion: combined.mlModelVersion,
          mlUsedFallback: combined.mlUsedFallback,
          analyzedAt: new Date(),
        },
      },
    },
  };
}

/**
 * Scores one transaction end to end: fetches context, runs the rule
 * engine, calls the ML service (falling back gracefully to
 * rules-only if it's unavailable — spec's failure-handling
 * requirement), blends the two into a final assessment, and persists
 * it. Used for one-off re-analysis (see POST /api/risk/analyze-transaction);
 * analyzeBatch below has its own more efficient path for scoring many
 * transactions at once.
 */
export async function analyzeTransaction(txn: ITransaction): Promise<AnalyzeResult> {
  const context = await fetchAnalysisContext(contextInputFor(txn));
  const ruleAggregation = runRules(txn, context);

  const mlPayload: MlTransactionPayload = {
    transactionId: txn.transactionId,
    amount: txn.amount,
    refundAmount: txn.refundAmount,
    chargebackFlag: txn.chargebackFlag,
    context: mapContextToMlPayload(context, { amount: txn.amount, city: txn.city }),
  };
  const mlResult = await scoreOne(mlPayload);

  const combined = combineRiskScores(ruleAggregation, mlResult, txn.amount);

  await Transaction.bulkWrite([persistUpdate(txn.transactionId, combined)]);
  await upsertAlertForTransaction(
    { transactionId: txn.transactionId, merchantId: txn.merchantId, customerId: txn.customerId },
    combined
  );

  return toAnalyzeResult(txn.transactionId, combined);
}

export interface BatchAnalyzeResult {
  totalAnalyzed: number;
  byRiskLevel: Record<"LOW" | "MEDIUM" | "HIGH" | "CRITICAL", number>;
  failedTransactionIds: string[];
  mlAvailable: boolean;
}

/**
 * Scores every transaction matched by `filter`. Two-phase design for
 * efficiency at scale:
 *
 *   1. Fetch each transaction's context and run rules — Mongo-bound,
 *      so this stays concurrency-limited (CONTEXT_FETCH_CONCURRENCY).
 *   2. Send every transaction's ML payload in one (chunked) HTTP call
 *      to the ML service, rather than one call per transaction — a
 *      10,000-row batch means 10,000x fewer ML round trips this way.
 *
 * If the ML service is unavailable, the WHOLE batch falls back to
 * rules-only (see scoreBatch's doc comment for why partial ML
 * coverage isn't an option) — every transaction still gets scored,
 * just with confidence="low" and mlUsedFallback=true.
 *
 * Persistence is a single bulkWrite rather than N individual
 * updateOne calls.
 */
export async function analyzeBatch(filter: Record<string, unknown>): Promise<BatchAnalyzeResult> {
  const transactions = await Transaction.find(filter);

  const byRiskLevel: BatchAnalyzeResult["byRiskLevel"] = { LOW: 0, MEDIUM: 0, HIGH: 0, CRITICAL: 0 };
  const failedTransactionIds: string[] = [];

  // Phase 1: context + rules (Mongo-bound, concurrency-limited)
  interface PreparedTxn {
    txn: ITransaction;
    context: AnalysisContext;
    ruleAggregation: ReturnType<typeof runRules>;
  }
  const prepared: PreparedTxn[] = [];

  await mapWithConcurrency(transactions, CONTEXT_FETCH_CONCURRENCY, async (txn) => {
    try {
      const context = await fetchAnalysisContext(contextInputFor(txn));
      const ruleAggregation = runRules(txn, context);
      prepared.push({ txn, context, ruleAggregation });
    } catch {
      failedTransactionIds.push(txn.transactionId);
    }
  });

  // Phase 2: one batched ML call for everything prepared above
  const mlPayloads: MlTransactionPayload[] = prepared.map((p) => ({
    transactionId: p.txn.transactionId,
    amount: p.txn.amount,
    refundAmount: p.txn.refundAmount,
    chargebackFlag: p.txn.chargebackFlag,
    context: mapContextToMlPayload(p.context, { amount: p.txn.amount, city: p.txn.city }),
  }));

  const mlResults = await scoreBatch(mlPayloads);
  const mlAvailable = mlResults !== null;
  const mlByTransactionId = new Map<string, MlPredictionResult>((mlResults ?? []).map((r) => [r.transactionId, r]));

  const bulkOps = [];
  const alertItems: { txn: { transactionId: string; merchantId: string; customerId: string }; combined: CombinedRiskResult }[] = [];

  for (const p of prepared) {
    const mlResult = mlByTransactionId.get(p.txn.transactionId) ?? null;
    const combined = combineRiskScores(p.ruleAggregation, mlResult, p.txn.amount);
    byRiskLevel[combined.riskLevel] += 1;
    bulkOps.push(persistUpdate(p.txn.transactionId, combined));
    alertItems.push({
      txn: { transactionId: p.txn.transactionId, merchantId: p.txn.merchantId, customerId: p.txn.customerId },
      combined,
    });
  }

  if (bulkOps.length > 0) {
    await Transaction.bulkWrite(bulkOps);
  }
  await upsertAlertsForBatch(alertItems);

  return {
    totalAnalyzed: prepared.length,
    byRiskLevel,
    failedTransactionIds,
    mlAvailable,
  };
}
