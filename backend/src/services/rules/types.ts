export type RiskCategory = "velocity" | "deviceLink" | "amountAnomaly" | "merchantDeviation" | "refundChargeback" | "location";

export type RuleCode =
  | "VELOCITY_ABUSE"
  | "CARD_TESTING"
  | "COORDINATED_ACTIVITY"
  | "DUPLICATE_PAYMENT"
  | "UNUSUAL_AMOUNT"
  | "MERCHANT_SPIKE"
  | "REFUND_MISMATCH"
  | "CHARGEBACK_FLAG"
  | "LOCATION_ANOMALY";

/**
 * One fired rule's contribution. `score` is 0-100 — how strongly this
 * specific signal fired, not the final blended riskScore. `message`
 * is the analyst-facing explanation and must always cite the actual
 * numbers involved (see Feature 7 in the spec: "12 payment attempts
 * ... within 4 minutes", never "Fraud detected by AI").
 */
export interface RuleFinding {
  code: RuleCode;
  category: RiskCategory;
  score: number;
  message: string;
  /** Notes when a rule used a degraded/fallback data source (e.g. a
   *  global baseline instead of the merchant's own history) so this
   *  can be surfaced as lower-confidence downstream. */
  usedFallback?: boolean;
}

/**
 * All the contextual numbers a transaction's rules need, fetched
 * once per transaction (see context.ts) so the rule-evaluation logic
 * itself (rules.ts) stays pure and independently testable without a
 * database.
 */
export interface RuleContext {
  deviceAttemptsInWindow: number;
  uniqueCardsPerDeviceInWindow: number;
  isDuplicateOrderId: boolean;
  duplicateOrderCount: number;

  merchantHourlyVolume: number;
  merchantHourlyBaseline: number | null; // null = insufficient history, rule skipped
  merchantBaselineIsFallback: boolean; // true = used global baseline, not this merchant's own

  customerAverageAmount: number | null; // null = insufficient history, rule skipped

  distinctCustomersOnDeviceOrIp: number;

  customerDominantCity: string | null; // null = insufficient history, rule skipped
  customerDominantCityShare: number; // fraction of prior transactions in that city
}

/**
 * Superset of RuleContext with the additional numbers the ML
 * service's feature set needs (Phase 5) but the rule engine doesn't
 * use directly. Fetched together in one pass (see context.ts) since
 * both consumers read from overlapping device/customer history —
 * computing them separately would mean duplicate Mongo round trips
 * for the same underlying data.
 *
 * Field names deliberately mirror the ML service's
 * app/core/features.py FEATURE_COLUMNS so the mapping in mlClient.ts
 * is a straight lookup, not a translation table.
 */
export interface AnalysisContext extends RuleContext {
  deviceAttemptsIn1Hour: number;
  deviceTransactionCountLifetime: number;
  failedAttemptsIn1Hour: number;
  uniqueCardsPerDeviceLifetime: number;
  uniqueCustomersForDevice: number; // device-only (not OR'd with IP), 24h — distinct from distinctCustomersOnDeviceOrIp above

  customerAmountStdDev: number | null;
  customerAccountAgeDays: number;
  customerRefundRate: number;
  customerChargebackRate: number;

  deviceNovelty: boolean; // this customer has never used this device before
  ipNovelty: boolean; // this customer has never used this IP before
}
