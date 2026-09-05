import { MlPredictionResult } from "./mlClient";
import { riskLevelFor } from "./rules/config";
import { RiskAggregation } from "./riskScoring";

export const RULE_ENGINE_VERSION = "rules-v1";

/**
 * Rules get more weight than the ML model in the final blend. This
 * is a deliberate, documented choice, not an arbitrary default: the
 * rule engine's thresholds are transparent and directly traceable to
 * spec-mandated behavior (Feature 4), while the ML model — despite
 * being genuinely predictive where it has signal (see Phase 5's real
 * evaluation results) — is a black box to the end user and, as that
 * same evaluation showed, fails to catch 3 of 8 fraud patterns
 * entirely on the supplied dataset. Weighting it as a strong minority
 * voice rather than a co-equal one reflects that.
 */
const RULE_WEIGHT = 0.6;
const ML_WEIGHT = 0.4;

/** riskScore >= this uses the transaction's own amount as its simulated exposure; below it, exposure is 0. */
const EXPOSURE_RISK_THRESHOLD = 60;

export type Confidence = "high" | "medium" | "low";

export interface CombinedRiskResult {
  riskScore: number;
  riskLevel: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  reasons: string[];
  confidence: Confidence;

  ruleScore: number;
  ruleEngineVersion: string;

  mlAnomalyScore: number | null;
  mlSupervisedProbability: number | null;
  mlModelVersion: string | null;
  mlUsedFallback: boolean;

  /** Simulated financial exposure — see spec's requirement that all monetary risk figures are explicitly marked as such, never presented as a real loss estimate. */
  estimatedExposure: number;
}

/**
 * Blends the rule engine's output with the ML model's output (or
 * falls back to rules-only when the ML service was unavailable —
 * mlResult === null) into one final, explainable risk assessment.
 * Pure and synchronous: no I/O, fully unit-testable.
 */
export function combineRiskScores(
  ruleAggregation: RiskAggregation,
  mlResult: MlPredictionResult | null,
  amount: number
): CombinedRiskResult {
  let riskScore: number;
  let confidence: Confidence;

  if (mlResult === null) {
    riskScore = ruleAggregation.riskScore;
    confidence = "low";
  } else {
    riskScore = Math.round(RULE_WEIGHT * ruleAggregation.riskScore + ML_WEIGHT * mlResult.supervisedProbability);
    confidence = mlResult.usedDefaultFeatures ? "medium" : "high";
  }

  const riskLevel = riskLevelFor(riskScore);
  const mlReasons = mlResult ? explainMlContribution(mlResult) : [];
  const reasons = [...ruleAggregation.reasons, ...mlReasons];

  const estimatedExposure = riskScore >= EXPOSURE_RISK_THRESHOLD ? amount : 0;

  return {
    riskScore,
    riskLevel,
    reasons,
    confidence,
    ruleScore: ruleAggregation.riskScore,
    ruleEngineVersion: RULE_ENGINE_VERSION,
    mlAnomalyScore: mlResult?.anomalyScore ?? null,
    mlSupervisedProbability: mlResult?.supervisedProbability ?? null,
    mlModelVersion: mlResult?.modelVersion ?? null,
    mlUsedFallback: mlResult === null,
    estimatedExposure,
  };
}

/** Human-readable names for the ML feature set — used to turn SHAP feature names into analyst-facing text, never raw camelCase identifiers. */
const FEATURE_LABELS: Record<string, string> = {
  amount: "the transaction amount",
  amountDeviationFromCustomerMean: "how far the amount deviates from this customer's usual spending",
  transactionsIn5Minutes: "recent transaction velocity from this device",
  transactionsIn1Hour: "transaction volume from this device in the last hour",
  deviceTransactionCountLifetime: "how many transactions this device has made in total",
  failedAttemptsIn1Hour: "recent failed payment attempts from this device",
  uniqueCardsPerDevice: "the number of distinct cards used from this device recently",
  uniqueCardsPerDeviceLifetime: "the number of distinct cards ever used from this device",
  uniqueCustomersPerDevice: "the number of distinct customers who have used this device",
  merchantVolumeDeviation: "how far this merchant's volume deviates from its baseline",
  customerAccountAge: "how long this customer has been active",
  refundRate: "this customer's historical refund rate",
  chargebackRate: "this customer's historical chargeback rate",
  refundToAmountRatio: "how much of this transaction has been refunded",
  isDuplicateOrder: "whether this order ID has been charged before",
  locationChangedFromPrevious: "whether this city differs from the customer's usual city",
  deviceNovelty: "whether this is a new device for this customer",
  ipNovelty: "whether this is a new IP address for this customer",
};

/**
 * Turns the ML model's top SHAP feature contributions into
 * analyst-facing explanation strings — only features that pushed
 * the prediction TOWARD "suspicious" (positive contribution), never
 * the ones pushing toward "normal", mirroring how rule reasons only
 * list fired rules.
 */
function explainMlContribution(mlResult: MlPredictionResult): string[] {
  return mlResult.topContributingFeatures
    .filter((f) => f.contribution > 0)
    .map((f) => {
      const label = FEATURE_LABELS[f.feature] ?? f.feature;
      return `ML model: ${label} (value: ${f.value}) was a top contributor to this transaction's anomaly score.`;
    });
}
