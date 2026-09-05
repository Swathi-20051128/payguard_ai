import { Alert, AlertSeverity } from "../models/Alert";
import { CombinedRiskResult } from "./combinedRiskScoring";

export interface AlertableTransaction {
  transactionId: string;
  merchantId: string;
  customerId: string;
}

/**
 * LOW-risk transactions never generate an alert -- the whole point
 * of the risk levels is that LOW means "continue monitoring, no
 * action needed" (see riskScoring.ts's recommendedActionFor). Alerts
 * exist so an analyst's queue only ever contains things actually
 * worth their attention.
 */
export function severityFor(riskLevel: CombinedRiskResult["riskLevel"]): AlertSeverity | null {
  if (riskLevel === "MEDIUM" || riskLevel === "HIGH" || riskLevel === "CRITICAL") return riskLevel;
  return null;
}

export function recommendedActionText(riskLevel: CombinedRiskResult["riskLevel"]): string {
  switch (riskLevel) {
    case "MEDIUM":
      return "Include in analyst review queue.";
    case "HIGH":
      return "Requires investigation before further action.";
    case "CRITICAL":
      return "Requires verification or escalation before proceeding.";
    default:
      return "Continue monitoring.";
  }
}

/**
 * Builds the fields for an alert upsert — pure, testable without a
 * database. Returns null when the risk level doesn't warrant an
 * alert at all.
 */
export function buildAlertFields(txn: AlertableTransaction, combined: CombinedRiskResult) {
  const severity = severityFor(combined.riskLevel);
  if (severity === null) return null;

  return {
    transactionId: txn.transactionId,
    merchantId: txn.merchantId,
    customerId: txn.customerId,
    riskScore: combined.riskScore,
    severity,
    confidence: combined.confidence,
    reasons: combined.reasons,
    recommendedAction: recommendedActionText(combined.riskLevel),
    estimatedExposure: combined.estimatedExposure,
    ruleEngineVersion: combined.ruleEngineVersion,
    mlModelVersion: combined.mlModelVersion,
  };
}

/**
 * Creates a new alert or updates the existing one for this
 * transaction (one alert per transaction — see the unique index on
 * Alert.transactionId) with the latest risk assessment. Re-analysis
 * refreshes score/reasons on an existing alert rather than spawning
 * a duplicate, and never silently changes its status — that's an
 * analyst decision (see caseService), not something re-scoring
 * should override.
 */
export async function upsertAlertForTransaction(
  txn: AlertableTransaction,
  combined: CombinedRiskResult
): Promise<string | null> {
  const fields = buildAlertFields(txn, combined);
  if (fields === null) return null;

  const alert = await Alert.findOneAndUpdate(
    { transactionId: txn.transactionId },
    { $set: fields, $setOnInsert: { status: "OPEN" } },
    { upsert: true, new: true }
  );

  return alert._id.toString();
}

/**
 * Bulk equivalent for batch analysis — one Alert.bulkWrite call
 * instead of N individual upserts.
 */
export async function upsertAlertsForBatch(
  items: { txn: AlertableTransaction; combined: CombinedRiskResult }[]
): Promise<void> {
  const ops = items
    .map(({ txn, combined }) => {
      const fields = buildAlertFields(txn, combined);
      if (fields === null) return null;
      return {
        updateOne: {
          filter: { transactionId: txn.transactionId },
          update: { $set: fields, $setOnInsert: { status: "OPEN" as const } },
          upsert: true,
        },
      };
    })
    .filter((op): op is NonNullable<typeof op> => op !== null);

  if (ops.length > 0) {
    await Alert.bulkWrite(ops);
  }
}
