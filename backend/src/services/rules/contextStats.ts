import { RULE_THRESHOLDS } from "./config";

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export interface DeviceHistoryRow {
  timestamp: Date;
  cardToken?: string;
  status: string;
  customerId: string;
}

export interface DeviceStats {
  deviceAttemptsInWindow: number; // 5 min, inclusive of the reference row
  deviceAttemptsIn1Hour: number;
  uniqueCardsPerDeviceInWindow: number; // 1h
  uniqueCardsPerDeviceLifetime: number;
  deviceTransactionCountLifetime: number;
  failedAttemptsIn1Hour: number;
  uniqueCustomersForDevice: number; // 24h, device-only (not OR'd with IP)
}

/**
 * Computes every device-scoped statistic from one bulk-fetched history
 * array (all of a device's transactions with timestamp <= reference,
 * i.e. up to and including "now"). Doing this client-side in one pass
 * — rather than issuing 5-6 separate windowed Mongo aggregations —
 * cuts round trips and, just as importantly, makes this logic
 * directly unit-testable with plain arrays.
 */
export function computeDeviceStats(history: DeviceHistoryRow[], referenceTimestamp: Date): DeviceStats {
  const refMs = referenceTimestamp.getTime();
  const window5min = history.filter((h) => refMs - h.timestamp.getTime() <= 5 * MINUTE);
  const window1h = history.filter((h) => refMs - h.timestamp.getTime() <= HOUR);
  const window24h = history.filter((h) => refMs - h.timestamp.getTime() <= DAY);

  return {
    deviceAttemptsInWindow: window5min.length,
    deviceAttemptsIn1Hour: window1h.length,
    uniqueCardsPerDeviceInWindow: distinctCount(window1h.map((h) => h.cardToken)),
    uniqueCardsPerDeviceLifetime: distinctCount(history.map((h) => h.cardToken)),
    deviceTransactionCountLifetime: history.length,
    failedAttemptsIn1Hour: window1h.filter((h) => h.status === "failed").length,
    uniqueCustomersForDevice: distinctCount(window24h.map((h) => h.customerId)),
  };
}

export interface CustomerHistoryRow {
  timestamp: Date;
  amount: number;
  refundAmount: number;
  chargebackFlag: boolean;
  city: string;
  deviceId: string;
  ipHash: string;
}

export interface CustomerStats {
  customerAverageAmount: number | null;
  customerAmountStdDev: number | null;
  customerAccountAgeDays: number;
  customerRefundRate: number;
  customerChargebackRate: number;
  customerDominantCity: string | null;
  customerDominantCityShare: number;
  deviceNovelty: boolean;
  ipNovelty: boolean;
}

/**
 * Computes every customer-scoped statistic from one bulk-fetched,
 * STRICTLY PRIOR history array (timestamp < reference — never
 * includes the transaction being scored itself, to avoid a
 * transaction trivially "confirming" its own baseline).
 */
export function computeCustomerStats(
  history: CustomerHistoryRow[],
  referenceTimestamp: Date,
  currentDeviceId: string,
  currentIpHash: string
): CustomerStats {
  const count = history.length;

  const amounts = history.map((h) => h.amount);
  const hasEnoughForAmountStats = count >= RULE_THRESHOLDS.customerMinHistoryCount;
  const mean = hasEnoughForAmountStats ? average(amounts) : null;
  const stdDev = hasEnoughForAmountStats ? standardDeviation(amounts, mean!) : null;

  const accountAgeDays = count > 0 ? (referenceTimestamp.getTime() - history[0].timestamp.getTime()) / DAY : 0;

  const refundRate = count > 0 ? history.filter((h) => h.refundAmount > 0).length / count : 0;
  const chargebackRate = count > 0 ? history.filter((h) => h.chargebackFlag).length / count : 0;

  const { city: computedDominantCity, share: dominantShare } = dominantCity(history);

  const deviceNovelty = history.every((h) => h.deviceId !== currentDeviceId);
  const ipNovelty = history.every((h) => h.ipHash !== currentIpHash);

  return {
    customerAverageAmount: mean,
    customerAmountStdDev: stdDev,
    customerAccountAgeDays: accountAgeDays,
    customerRefundRate: refundRate,
    customerChargebackRate: chargebackRate,
    customerDominantCity: computedDominantCity,
    customerDominantCityShare: dominantShare,
    deviceNovelty,
    ipNovelty,
  };
}

function distinctCount(values: (string | undefined)[]): number {
  return new Set(values.filter((v): v is string => Boolean(v))).size;
}

function average(values: number[]): number {
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function standardDeviation(values: number[], mean: number): number {
  if (values.length < 2) return 0;
  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

function dominantCity(history: CustomerHistoryRow[]): { city: string | null; share: number } {
  if (history.length < RULE_THRESHOLDS.locationMinHistoryCount) {
    return { city: null, share: 0 };
  }
  const counts = new Map<string, number>();
  for (const h of history) {
    counts.set(h.city, (counts.get(h.city) ?? 0) + 1);
  }
  let topCity: string | null = null;
  let topCount = 0;
  for (const [city, count] of counts) {
    if (count > topCount) {
      topCity = city;
      topCount = count;
    }
  }
  return { city: topCity, share: topCount / history.length };
}
