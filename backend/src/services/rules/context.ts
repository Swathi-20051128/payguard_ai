import { Transaction } from "../../models/Transaction";
import { RULE_THRESHOLDS } from "./config";
import { computeCustomerStats, computeDeviceStats } from "./contextStats";
import { RuleTransactionInput } from "./rules";
import { AnalysisContext } from "./types";

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

// Safety cap on bulk history fetches — generous relative to any
// device/customer activity observed in the supplied datasets (max
// ~180 transactions for a single device), but bounds worst-case
// memory/latency for a pathological outlier.
const HISTORY_FETCH_LIMIT = 2000;

export interface ContextInput extends RuleTransactionInput {
  orderId: string;
  merchantId: string;
  customerId: string;
  deviceId: string;
  ipHash: string;
  timestamp: Date;
}

/**
 * Fetches every piece of context both the rule engine (Phase 4) and
 * the ML service mapping (Phase 6) need for one transaction.
 *
 * Device and customer history are each bulk-fetched ONCE and then
 * reduced with pure functions (contextStats.ts) — rather than
 * issuing 5-6 separate narrow, differently-windowed Mongo
 * aggregations per entity — which cuts round trips and, just as
 * importantly, keeps the actual statistical logic unit-testable
 * without a database. Only genuinely cross-entity lookups (merchant
 * volume, order duplication, device-OR-ip coordination) remain as
 * their own targeted queries, since they can't be derived from
 * either bulk-fetched array alone.
 */
export async function fetchAnalysisContext(txn: ContextInput): Promise<AnalysisContext> {
  const [deviceHistory, customerHistory, duplicateOrderCount, merchantVolume, distinctCustomersOnDeviceOrIp] =
    await Promise.all([
      Transaction.find({ deviceId: txn.deviceId, timestamp: { $lte: txn.timestamp } })
        .select("timestamp cardToken status customerId")
        .sort({ timestamp: 1 })
        .limit(HISTORY_FETCH_LIMIT)
        .lean(),
      Transaction.find({ customerId: txn.customerId, timestamp: { $lt: txn.timestamp } })
        .select("timestamp amount refundAmount chargebackFlag city deviceId ipHash")
        .sort({ timestamp: 1 })
        .limit(HISTORY_FETCH_LIMIT)
        .lean(),
      countDuplicateOrders(txn),
      computeMerchantVolumeAndBaseline(txn),
      countDistinctCustomersOnDeviceOrIp(txn),
    ]);

  const deviceStats = computeDeviceStats(
    deviceHistory.map((h: any) => ({
      timestamp: h.timestamp,
      cardToken: h.cardToken,
      status: h.status,
      customerId: h.customerId,
    })),
    txn.timestamp
  );

  const customerStats = computeCustomerStats(
    customerHistory.map((h: any) => ({
      timestamp: h.timestamp,
      amount: h.amount,
      refundAmount: h.refundAmount,
      chargebackFlag: h.chargebackFlag,
      city: h.city,
      deviceId: h.deviceId,
      ipHash: h.ipHash,
    })),
    txn.timestamp,
    txn.deviceId,
    txn.ipHash
  );

  return {
    deviceAttemptsInWindow: deviceStats.deviceAttemptsInWindow,
    uniqueCardsPerDeviceInWindow: deviceStats.uniqueCardsPerDeviceInWindow,
    isDuplicateOrderId: duplicateOrderCount > 0,
    duplicateOrderCount,

    merchantHourlyVolume: merchantVolume.hourlyVolume,
    merchantHourlyBaseline: merchantVolume.baseline,
    merchantBaselineIsFallback: merchantVolume.isFallback,

    customerAverageAmount: customerStats.customerAverageAmount,

    distinctCustomersOnDeviceOrIp,

    customerDominantCity: customerStats.customerDominantCity,
    customerDominantCityShare: customerStats.customerDominantCityShare,

    // ML-only additional fields
    deviceAttemptsIn1Hour: deviceStats.deviceAttemptsIn1Hour,
    deviceTransactionCountLifetime: deviceStats.deviceTransactionCountLifetime,
    failedAttemptsIn1Hour: deviceStats.failedAttemptsIn1Hour,
    uniqueCardsPerDeviceLifetime: deviceStats.uniqueCardsPerDeviceLifetime,
    uniqueCustomersForDevice: deviceStats.uniqueCustomersForDevice,

    customerAmountStdDev: customerStats.customerAmountStdDev,
    customerAccountAgeDays: customerStats.customerAccountAgeDays,
    customerRefundRate: customerStats.customerRefundRate,
    customerChargebackRate: customerStats.customerChargebackRate,

    deviceNovelty: customerStats.deviceNovelty,
    ipNovelty: customerStats.ipNovelty,
  };
}

async function countDuplicateOrders(txn: ContextInput): Promise<number> {
  const windowStart = new Date(txn.timestamp.getTime() - RULE_THRESHOLDS.duplicateOrderWindowHours * HOUR);
  const windowEnd = new Date(txn.timestamp.getTime() + RULE_THRESHOLDS.duplicateOrderWindowHours * HOUR);
  return Transaction.countDocuments({
    orderId: txn.orderId,
    transactionId: { $ne: txn.transactionId },
    timestamp: { $gte: windowStart, $lte: windowEnd },
  });
}

interface MerchantVolumeResult {
  hourlyVolume: number;
  baseline: number | null;
  isFallback: boolean;
}

async function computeMerchantVolumeAndBaseline(txn: ContextInput): Promise<MerchantVolumeResult> {
  const hourStart = floorToHour(txn.timestamp);
  const hourEnd = new Date(hourStart.getTime() + HOUR);
  const lookbackStart = new Date(hourStart.getTime() - RULE_THRESHOLDS.merchantBaselineLookbackDays * DAY);

  const [hourlyVolume, merchantBuckets] = await Promise.all([
    Transaction.countDocuments({ merchantId: txn.merchantId, timestamp: { $gte: hourStart, $lt: hourEnd } }),
    hourlyBucketStats({ merchantId: txn.merchantId }, lookbackStart, hourStart),
  ]);

  if (merchantBuckets.bucketCount >= RULE_THRESHOLDS.merchantMinHistoryBuckets) {
    return { hourlyVolume, baseline: merchantBuckets.avgPerBucket, isFallback: false };
  }

  // Spec's failure-handling rule: "Unknown merchant: use global
  // baseline and mark confidence accordingly." A merchant with too
  // little history to trust its own baseline borrows the platform-
  // wide average instead of being silently skipped or producing a
  // noisy false positive off a near-empty history.
  const globalBuckets = await hourlyBucketStats({}, lookbackStart, hourStart);
  if (globalBuckets.bucketCount === 0) {
    return { hourlyVolume, baseline: null, isFallback: true };
  }
  return { hourlyVolume, baseline: globalBuckets.avgPerBucket, isFallback: true };
}

async function hourlyBucketStats(
  matchExtra: Record<string, unknown>,
  from: Date,
  to: Date
): Promise<{ avgPerBucket: number; bucketCount: number }> {
  const result = await Transaction.aggregate([
    { $match: { ...matchExtra, timestamp: { $gte: from, $lt: to } } },
    { $group: { _id: { $dateTrunc: { date: "$timestamp", unit: "hour" } }, count: { $sum: 1 } } },
    { $group: { _id: null, avgPerBucket: { $avg: "$count" }, bucketCount: { $sum: 1 } } },
  ]);
  return { avgPerBucket: result[0]?.avgPerBucket ?? 0, bucketCount: result[0]?.bucketCount ?? 0 };
}

async function countDistinctCustomersOnDeviceOrIp(txn: ContextInput): Promise<number> {
  const windowStart = new Date(txn.timestamp.getTime() - RULE_THRESHOLDS.coordinatedWindowHours * HOUR);
  const result = await Transaction.aggregate([
    {
      $match: {
        $or: [{ deviceId: txn.deviceId }, { ipHash: txn.ipHash }],
        timestamp: { $gte: windowStart, $lte: txn.timestamp },
      },
    },
    { $group: { _id: "$customerId" } },
    { $count: "distinctCustomers" },
  ]);
  return result[0]?.distinctCustomers ?? 0;
}

function floorToHour(date: Date): Date {
  const floored = new Date(date);
  floored.setMinutes(0, 0, 0);
  return floored;
}
