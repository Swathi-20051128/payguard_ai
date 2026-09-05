import { RULE_THRESHOLDS } from "./config";
import { RuleContext, RuleFinding } from "./types";

/** Clamp a raw signal-strength ratio into a 0-100 sub-score. */
function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

/**
 * Minimal transaction shape the pure rule functions need. Using a
 * narrow interface (rather than the full Mongoose ITransaction)
 * keeps these functions trivially testable with plain object
 * literals — no Document mocking required.
 */
export interface RuleTransactionInput {
  transactionId: string;
  amount: number;
  refundAmount: number;
  chargebackFlag: boolean;
  city: string;
}

/**
 * "More than 10 attempts from a device in five minutes." Scored
 * continuously (attempts / threshold * 100) so a transaction sitting
 * just under the threshold still shows some velocity risk, rather
 * than a hard 0 → 100 cliff at attempt #11.
 */
export function velocityRule(context: RuleContext): RuleFinding | null {
  const { deviceAttemptsInWindow } = context;
  const threshold = RULE_THRESHOLDS.velocityMaxAttempts;

  if (deviceAttemptsInWindow <= threshold) return null;

  return {
    code: "VELOCITY_ABUSE",
    category: "velocity",
    score: clampScore((deviceAttemptsInWindow / threshold) * 100),
    message: `${deviceAttemptsInWindow} payment attempts from this device in the last ${RULE_THRESHOLDS.velocityWindowMinutes} minutes (threshold: ${threshold}).`,
  };
}

/** "More than five card tokens from one device in one hour." */
export function cardTestingRule(context: RuleContext): RuleFinding | null {
  const { uniqueCardsPerDeviceInWindow } = context;
  const threshold = RULE_THRESHOLDS.cardTestingMaxDistinctCards;

  if (uniqueCardsPerDeviceInWindow <= threshold) return null;

  return {
    code: "CARD_TESTING",
    category: "deviceLink",
    score: clampScore((uniqueCardsPerDeviceInWindow / threshold) * 100),
    message: `${uniqueCardsPerDeviceInWindow} distinct card tokens used from this device in the last hour (threshold: ${threshold}).`,
  };
}

/** "Multiple customers linked to one device or IP." */
export function coordinatedActivityRule(context: RuleContext): RuleFinding | null {
  const { distinctCustomersOnDeviceOrIp } = context;
  const threshold = RULE_THRESHOLDS.coordinatedMinDistinctCustomers;

  if (distinctCustomersOnDeviceOrIp < threshold) return null;

  return {
    code: "COORDINATED_ACTIVITY",
    category: "deviceLink",
    score: clampScore((distinctCustomersOnDeviceOrIp / threshold) * 100),
    message: `${distinctCustomersOnDeviceOrIp} distinct customers have transacted from this device/IP in the last ${RULE_THRESHOLDS.coordinatedWindowHours}h (threshold: ${threshold}).`,
  };
}

/** "Duplicate order/payment" — the same orderId paid more than once recently. */
export function duplicatePaymentRule(context: RuleContext): RuleFinding | null {
  if (!context.isDuplicateOrderId) return null;

  return {
    code: "DUPLICATE_PAYMENT",
    category: "amountAnomaly",
    // Fixed strong score: duplicate payment is a binary integrity
    // signal, not something that scales with a ratio.
    score: 70,
    message: `This order ID has been charged ${context.duplicateOrderCount + 1} times in the last ${RULE_THRESHOLDS.duplicateOrderWindowHours}h.`,
  };
}

/** "Amount more than five times customer historical average." */
export function unusualAmountRule(txn: RuleTransactionInput, context: RuleContext): RuleFinding | null {
  if (context.customerAverageAmount === null || context.customerAverageAmount <= 0) return null;

  const multiplier = txn.amount / context.customerAverageAmount;
  const threshold = RULE_THRESHOLDS.unusualAmountMultiplier;

  if (multiplier <= threshold) return null;

  return {
    code: "UNUSUAL_AMOUNT",
    category: "amountAnomaly",
    score: clampScore((multiplier / threshold) * 100),
    message: `Amount is ${multiplier.toFixed(1)}x this customer's historical average (₹${context.customerAverageAmount.toFixed(2)}).`,
  };
}

/** "Merchant hourly volume greater than four times its historical baseline." */
export function merchantSpikeRule(context: RuleContext): RuleFinding | null {
  if (context.merchantHourlyBaseline === null || context.merchantHourlyBaseline <= 0) return null;

  const multiplier = context.merchantHourlyVolume / context.merchantHourlyBaseline;
  const threshold = RULE_THRESHOLDS.merchantSpikeMultiplier;

  if (multiplier <= threshold) return null;

  const fallbackNote = context.merchantBaselineIsFallback
    ? " (this merchant has limited history — compared against the global baseline)"
    : "";

  return {
    code: "MERCHANT_SPIKE",
    category: "merchantDeviation",
    score: clampScore((multiplier / threshold) * 100),
    message: `Merchant volume this hour (${context.merchantHourlyVolume}) is ${multiplier.toFixed(1)}x its baseline (${context.merchantHourlyBaseline.toFixed(1)}/hr)${fallbackNote}.`,
    usedFallback: context.merchantBaselineIsFallback,
  };
}

/** "Refund amount greater than captured amount" — an over-refund, always anomalous. */
export function refundMismatchRule(txn: RuleTransactionInput): RuleFinding | null {
  if (txn.amount <= 0 || txn.refundAmount <= txn.amount) return null;

  const ratio = txn.refundAmount / txn.amount;

  return {
    code: "REFUND_MISMATCH",
    category: "refundChargeback",
    score: clampScore(ratio * 100),
    message: `Refund amount (₹${txn.refundAmount.toFixed(2)}) exceeds the captured amount (₹${txn.amount.toFixed(2)}).`,
  };
}

/** A settled chargeback is itself a strong, fixed risk signal. */
export function chargebackFlagRule(txn: RuleTransactionInput): RuleFinding | null {
  if (!txn.chargebackFlag) return null;

  return {
    code: "CHARGEBACK_FLAG",
    category: "refundChargeback",
    score: 85,
    message: "This transaction has an open or settled chargeback.",
  };
}

/** The customer transacting from a city well outside their established pattern. */
export function locationAnomalyRule(txn: RuleTransactionInput, context: RuleContext): RuleFinding | null {
  if (context.customerDominantCity === null) return null;
  if (context.customerDominantCityShare < RULE_THRESHOLDS.locationDominanceRatio) return null;
  if (txn.city === context.customerDominantCity) return null;

  return {
    code: "LOCATION_ANOMALY",
    category: "location",
    score: clampScore(context.customerDominantCityShare * 100),
    message: `Transaction city (${txn.city}) differs from this customer's usual city (${context.customerDominantCity}, ${(context.customerDominantCityShare * 100).toFixed(0)}% of their history).`,
  };
}

/**
 * Runs every rule against one transaction + its precomputed context
 * and returns only the ones that fired. Pure and synchronous — safe
 * to unit test with plain object literals, no database required.
 */
export function evaluateRules(txn: RuleTransactionInput, context: RuleContext): RuleFinding[] {
  const findings: (RuleFinding | null)[] = [
    velocityRule(context),
    cardTestingRule(context),
    coordinatedActivityRule(context),
    duplicatePaymentRule(context),
    unusualAmountRule(txn, context),
    merchantSpikeRule(context),
    refundMismatchRule(txn),
    chargebackFlagRule(txn),
    locationAnomalyRule(txn, context),
  ];

  return findings.filter((f): f is RuleFinding => f !== null);
}
