/**
 * All rule thresholds and risk-category weights live here so the
 * whole detection system stays explainable and tunable from one
 * place — an analyst (or Phase 8's admin settings page) should be
 * able to point at a single file and see exactly what triggers an
 * alert. Nothing here is hardcoded elsewhere.
 *
 * Weights mirror the spec's risk-scoring formula exactly:
 *   riskScore = velocityRisk*0.25 + deviceLinkRisk*0.20 +
 *               amountAnomalyRisk*0.15 + merchantDeviationRisk*0.15 +
 *               refundChargebackRisk*0.15 + locationRisk*0.10
 */
export const RISK_WEIGHTS = {
  velocity: 0.25,
  deviceLink: 0.2,
  amountAnomaly: 0.15,
  merchantDeviation: 0.15,
  refundChargeback: 0.15,
  location: 0.1,
} as const;

export const RULE_THRESHOLDS = {
  /** "More than 10 attempts from a device in five minutes." */
  velocityWindowMinutes: 5,
  velocityMaxAttempts: 10,

  /** "More than five card tokens from one device in one hour." */
  cardTestingWindowMinutes: 60,
  cardTestingMaxDistinctCards: 5,

  /** Window for treating a repeated orderId as a duplicate-payment signal. */
  duplicateOrderWindowHours: 24,

  /** "Merchant hourly volume greater than four times its historical baseline." */
  merchantSpikeMultiplier: 4,
  /** Minimum hourly buckets with activity needed to trust a merchant's own baseline. */
  merchantMinHistoryBuckets: 5,
  /** Lookback window for computing a merchant's historical hourly baseline. */
  merchantBaselineLookbackDays: 14,

  /** "Amount more than five times customer historical average." */
  unusualAmountMultiplier: 5,
  /** Minimum prior successful transactions needed to trust a customer's average. */
  customerMinHistoryCount: 3,

  /** "Multiple customers linked to one device or IP." */
  coordinatedMinDistinctCustomers: 3,
  coordinatedWindowHours: 24,

  /** Minimum prior transactions + dominance ratio needed to trust a customer's "usual city". */
  locationMinHistoryCount: 3,
  locationDominanceRatio: 0.5,
  // No day-based lookback window here (Phase 6 simplification): the
  // dominant-city calculation uses ALL prior transactions, matching
  // the ML service's equivalent feature exactly (see
  // ml-service/app/core/features.py) rather than diverging on an
  // arbitrary bound the two systems would otherwise disagree on.
} as const;

export const RISK_LEVEL_THRESHOLDS = {
  LOW: 0,
  MEDIUM: 30,
  HIGH: 60,
  CRITICAL: 80,
} as const;

export function riskLevelFor(score: number): "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" {
  if (score >= RISK_LEVEL_THRESHOLDS.CRITICAL) return "CRITICAL";
  if (score >= RISK_LEVEL_THRESHOLDS.HIGH) return "HIGH";
  if (score >= RISK_LEVEL_THRESHOLDS.MEDIUM) return "MEDIUM";
  return "LOW";
}
