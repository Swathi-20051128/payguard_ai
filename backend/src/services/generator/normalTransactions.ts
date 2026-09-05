import { CustomerProfile, EntityPools, FAILURE_REASONS, PAYMENT_METHODS } from "./entityPools";
import { GeneratedRow } from "./types";
import { chance, pick, randInt, randLogNormal, Rng } from "./rng";

let counter = 0;
function nextId(prefix: string): string {
  counter += 1;
  // Counter alone guarantees uniqueness within a generation run —
  // deliberately no wall-clock component here, so IDs don't leak
  // real invocation time and don't break run-to-run reproducibility
  // for a fixed seed.
  return `${prefix}_${counter.toString(36)}`;
}

/** Resets the module-level ID counter — call between generator runs in tests. */
export function resetIdCounter() {
  counter = 0;
}

/**
 * A single ordinary transaction: usual device, usual card, usual (or
 * occasionally a nearby) city, amount drawn around the customer's own
 * average. This is the "boring" majority class the fraud clusters
 * stand out against.
 */
export function generateNormalTransaction(
  rng: Rng,
  pools: EntityPools,
  timestamp: Date,
  customer?: CustomerProfile
): GeneratedRow {
  const cust = customer ?? pick(rng, pools.customers);
  const merchant = pick(rng, pools.merchants);
  const status = chance(rng, 0.92) ? "success" : chance(rng, 0.5) ? "failed" : "pending";

  return {
    transactionId: nextId("txn"),
    orderId: nextId("order"),
    merchantId: merchant.merchantId,
    customerId: cust.customerId,
    amount: randLogNormal(rng, cust.avgAmount, 0.35),
    currency: "INR",
    status,
    paymentMethod: pick(rng, PAYMENT_METHODS),
    cardToken: pick(rng, cust.usualCardTokens),
    deviceId: pick(rng, cust.usualDeviceIds),
    ipHash: pick(rng, pools.ipHashes),
    country: cust.usualCity.country,
    city: cust.usualCity.city,
    timestamp,
    refundAmount: 0,
    chargebackFlag: false,
    failureReason: status === "failed" ? pick(rng, FAILURE_REASONS) : undefined,
    groundTruthRisk: 0,
    fraudScenario: undefined,
  };
}

export { nextId };
