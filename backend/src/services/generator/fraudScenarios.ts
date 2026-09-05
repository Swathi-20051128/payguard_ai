import { EntityPools, FAILURE_REASONS, CITY_POOL } from "./entityPools";
import { nextId } from "./normalTransactions";
import { chance, pick, pickN, randFloat, randInt, randLogNormal, Rng } from "./rng";
import { GeneratedRow } from "./types";

export type FraudScenario =
  | "CARD_TESTING"
  | "VELOCITY_ABUSE"
  | "DUPLICATE_PAYMENT"
  | "ACCOUNT_TAKEOVER"
  | "REFUND_ABUSE"
  | "MERCHANT_SPIKE"
  | "LOCATION_ANOMALY"
  | "COORDINATED_ACTIVITY"
  | "HIGH_VALUE_ANOMALY"
  | "REPEATED_FAILURE_THEN_SUCCESS";

export const FRAUD_SCENARIOS: FraudScenario[] = [
  "CARD_TESTING",
  "VELOCITY_ABUSE",
  "DUPLICATE_PAYMENT",
  "ACCOUNT_TAKEOVER",
  "REFUND_ABUSE",
  "MERCHANT_SPIKE",
  "LOCATION_ANOMALY",
  "COORDINATED_ACTIVITY",
  "HIGH_VALUE_ANOMALY",
  "REPEATED_FAILURE_THEN_SUCCESS",
];

const minutes = (n: number) => n * 60 * 1000;

function baseRow(overrides: Partial<GeneratedRow> & Pick<GeneratedRow, "merchantId" | "customerId" | "deviceId" | "timestamp" | "amount">): GeneratedRow {
  return {
    transactionId: nextId("txn"),
    orderId: nextId("order"),
    currency: "INR",
    status: "success",
    paymentMethod: "card",
    ipHash: "ip_hash_0",
    country: "IN",
    city: "Mumbai",
    refundAmount: 0,
    chargebackFlag: false,
    groundTruthRisk: 0,
    fraudScenario: undefined,
    ...overrides,
  };
}

/** Several card tokens tried from one device in a short burst, mostly declined. */
function genCardTesting(rng: Rng, pools: EntityPools, t0: Date): GeneratedRow[] {
  const device = pick(rng, pools.devices);
  const ip = pick(rng, pools.ipHashes);
  const cards = pickN(rng, pools.cardTokens, randInt(rng, 6, 10));
  const cust = pick(rng, pools.customers);

  return cards.map((card, i) => {
    const ts = new Date(t0.getTime() + i * (10_000 + randInt(rng, 0, 5000)));
    const status = chance(rng, 0.8) ? "failed" : "success";
    return baseRow({
      merchantId: pick(rng, pools.merchants).merchantId,
      customerId: cust.customerId,
      deviceId: device,
      cardToken: card,
      ipHash: ip,
      amount: randFloat(rng, 1, 50),
      timestamp: ts,
      status,
      failureReason: status === "failed" ? "card_declined" : undefined,
      groundTruthRisk: randInt(rng, 80, 96),
      fraudScenario: "CARD_TESTING",
    });
  });
}

/** Many attempts from one device+customer within five minutes. */
function genVelocityAbuse(rng: Rng, pools: EntityPools, t0: Date): GeneratedRow[] {
  const cust = pick(rng, pools.customers);
  const device = pick(rng, pools.devices);
  const merchant = pick(rng, pools.merchants);
  const count = randInt(rng, 11, 18);

  return Array.from({ length: count }, (_, i) => {
    const ts = new Date(t0.getTime() + i * randInt(rng, 5_000, 25_000));
    return baseRow({
      merchantId: merchant.merchantId,
      customerId: cust.customerId,
      deviceId: device,
      cardToken: pick(rng, cust.usualCardTokens.length ? cust.usualCardTokens : pools.cardTokens),
      amount: randLogNormal(rng, cust.avgAmount, 0.3),
      timestamp: ts,
      status: chance(rng, 0.7) ? "success" : "failed",
      groundTruthRisk: randInt(rng, 70, 92),
      fraudScenario: "VELOCITY_ABUSE",
    });
  });
}

/** The same order ID paid multiple times in quick succession. */
function genDuplicatePayment(rng: Rng, pools: EntityPools, t0: Date): GeneratedRow[] {
  const cust = pick(rng, pools.customers);
  const merchant = pick(rng, pools.merchants);
  const orderId = nextId("order");
  const amount = randLogNormal(rng, cust.avgAmount, 0.2);
  const count = randInt(rng, 2, 4);

  return Array.from({ length: count }, (_, i) => {
    const ts = new Date(t0.getTime() + i * randInt(rng, 2_000, 20_000));
    const row = baseRow({
      merchantId: merchant.merchantId,
      customerId: cust.customerId,
      deviceId: pick(rng, cust.usualDeviceIds),
      cardToken: pick(rng, cust.usualCardTokens),
      amount,
      timestamp: ts,
      status: "success",
      groundTruthRisk: randInt(rng, 60, 82),
      fraudScenario: "DUPLICATE_PAYMENT",
    });
    // All rows in this cluster deliberately share one orderId — the
    // signal this scenario represents — while each still gets its
    // own unique transactionId (baseRow already assigned one).
    row.orderId = orderId;
    return row;
  });
}

/** An existing customer transacting from a brand-new device, unusual amount, unfamiliar city. */
function genAccountTakeover(rng: Rng, pools: EntityPools, t0: Date): GeneratedRow[] {
  const cust = pick(rng, pools.customers);
  const merchant = pick(rng, pools.merchants);
  const unfamiliarCity = pick(
    rng,
    CITY_POOL.filter((c) => c.city !== cust.usualCity.city)
  );
  // A device never seen in this customer's usual set — deliberately
  // pulled from outside their profile pool.
  const newDevice = pick(rng, pools.devices);

  return [
    baseRow({
      merchantId: merchant.merchantId,
      customerId: cust.customerId,
      deviceId: newDevice,
      cardToken: pick(rng, pools.cardTokens),
      amount: cust.avgAmount * randFloat(rng, 5, 9),
      timestamp: t0,
      country: unfamiliarCity.country,
      city: unfamiliarCity.city,
      status: "success",
      groundTruthRisk: randInt(rng, 75, 93),
      fraudScenario: "ACCOUNT_TAKEOVER",
    }),
  ];
}

/** Refunds issued close to (or exceeding) the captured amount, repeatedly, for one customer. */
function genRefundAbuse(rng: Rng, pools: EntityPools, t0: Date): GeneratedRow[] {
  const cust = pick(rng, pools.customers);
  const merchant = pick(rng, pools.merchants);
  const count = randInt(rng, 3, 6);

  return Array.from({ length: count }, (_, i) => {
    const amount = randLogNormal(rng, cust.avgAmount, 0.3);
    const ts = new Date(t0.getTime() + i * minutes(randInt(rng, 60, 24 * 60)));
    return baseRow({
      merchantId: merchant.merchantId,
      customerId: cust.customerId,
      deviceId: pick(rng, cust.usualDeviceIds),
      cardToken: pick(rng, cust.usualCardTokens),
      amount,
      timestamp: ts,
      status: "refunded",
      refundAmount: Math.round(amount * randFloat(rng, 0.9, 1.0) * 100) / 100,
      chargebackFlag: chance(rng, 0.2),
      groundTruthRisk: randInt(rng, 60, 85),
      fraudScenario: "REFUND_ABUSE",
    });
  });
}

/** A merchant's hourly volume spikes to several times its normal baseline. */
function genMerchantSpike(rng: Rng, pools: EntityPools, t0: Date): GeneratedRow[] {
  const merchant = pick(rng, pools.merchants);
  // Capped regardless of the merchant's baseline: the 4-6x-baseline
  // *ratio* is the signal the merchant-spike rule looks for (Phase 4),
  // not an unbounded absolute row count — without this cap, a
  // high-baseline merchant could generate hundreds of rows in one
  // cluster and blow past the caller's requested transactionCount.
  const count = Math.min(Math.round(merchant.baselineHourlyVolume * randFloat(rng, 4, 6)), 60);

  return Array.from({ length: count }, (_, i) => {
    const cust = pick(rng, pools.customers);
    const ts = new Date(t0.getTime() + i * randInt(rng, 3_000, 60_000));
    return baseRow({
      merchantId: merchant.merchantId,
      customerId: cust.customerId,
      deviceId: pick(rng, cust.usualDeviceIds),
      cardToken: pick(rng, cust.usualCardTokens),
      amount: randLogNormal(rng, cust.avgAmount, 0.4),
      timestamp: ts,
      status: chance(rng, 0.9) ? "success" : "failed",
      groundTruthRisk: randInt(rng, 40, 65),
      fraudScenario: "MERCHANT_SPIKE",
    });
  });
}

/** The same customer transacting from two far-apart cities within an implausibly short window. */
function genLocationAnomaly(rng: Rng, pools: EntityPools, t0: Date): GeneratedRow[] {
  const cust = pick(rng, pools.customers);
  const merchant = pick(rng, pools.merchants);
  const otherCity = pick(
    rng,
    CITY_POOL.filter((c) => c.city !== cust.usualCity.city)
  );
  const gapMinutes = randInt(rng, 15, 90); // too short to plausibly travel between cities

  return [
    baseRow({
      merchantId: merchant.merchantId,
      customerId: cust.customerId,
      deviceId: pick(rng, cust.usualDeviceIds),
      cardToken: pick(rng, cust.usualCardTokens),
      amount: randLogNormal(rng, cust.avgAmount, 0.2),
      timestamp: t0,
      country: cust.usualCity.country,
      city: cust.usualCity.city,
      status: "success",
      groundTruthRisk: 0,
      fraudScenario: undefined,
    }),
    baseRow({
      merchantId: merchant.merchantId,
      customerId: cust.customerId,
      deviceId: pick(rng, pools.devices),
      cardToken: pick(rng, cust.usualCardTokens),
      amount: randLogNormal(rng, cust.avgAmount, 0.2),
      timestamp: new Date(t0.getTime() + minutes(gapMinutes)),
      country: otherCity.country,
      city: otherCity.city,
      status: "success",
      groundTruthRisk: randInt(rng, 65, 87),
      fraudScenario: "LOCATION_ANOMALY",
    }),
  ];
}

/** Multiple distinct customers all transacting through the same device/IP — a mule/bot-farm pattern. */
function genCoordinatedActivity(rng: Rng, pools: EntityPools, t0: Date): GeneratedRow[] {
  const device = pick(rng, pools.devices);
  const ip = pick(rng, pools.ipHashes);
  const merchant = pick(rng, pools.merchants);
  const customers = pickN(rng, pools.customers, randInt(rng, 4, 8));

  return customers.map((cust, i) => {
    const ts = new Date(t0.getTime() + i * randInt(rng, 20_000, 180_000));
    return baseRow({
      merchantId: merchant.merchantId,
      customerId: cust.customerId,
      deviceId: device,
      ipHash: ip,
      cardToken: pick(rng, pools.cardTokens),
      amount: randLogNormal(rng, cust.avgAmount, 0.3),
      timestamp: ts,
      status: "success",
      groundTruthRisk: randInt(rng, 70, 90),
      fraudScenario: "COORDINATED_ACTIVITY",
    });
  });
}

/** A single transaction far above the customer's own historical average. */
function genHighValueAnomaly(rng: Rng, pools: EntityPools, t0: Date): GeneratedRow[] {
  const cust = pick(rng, pools.customers);
  const merchant = pick(rng, pools.merchants);

  return [
    baseRow({
      merchantId: merchant.merchantId,
      customerId: cust.customerId,
      deviceId: pick(rng, cust.usualDeviceIds),
      cardToken: pick(rng, cust.usualCardTokens),
      amount: cust.avgAmount * randFloat(rng, 6, 11),
      timestamp: t0,
      status: "success",
      groundTruthRisk: randInt(rng, 55, 78),
      fraudScenario: "HIGH_VALUE_ANOMALY",
    }),
  ];
}

/** Several failed attempts immediately followed by one success — consistent with guessing/testing a token. */
function genRepeatedFailureThenSuccess(rng: Rng, pools: EntityPools, t0: Date): GeneratedRow[] {
  const cust = pick(rng, pools.customers);
  const device = pick(rng, cust.usualDeviceIds);
  const merchant = pick(rng, pools.merchants);
  const failCount = randInt(rng, 4, 7);

  const rows: GeneratedRow[] = Array.from({ length: failCount }, (_, i) => {
    const ts = new Date(t0.getTime() + i * randInt(rng, 5_000, 20_000));
    return baseRow({
      merchantId: merchant.merchantId,
      customerId: cust.customerId,
      deviceId: device,
      cardToken: pick(rng, cust.usualCardTokens),
      amount: randLogNormal(rng, cust.avgAmount, 0.25),
      timestamp: ts,
      status: "failed",
      failureReason: pick(rng, FAILURE_REASONS),
      groundTruthRisk: randInt(rng, 50, 70),
      fraudScenario: "REPEATED_FAILURE_THEN_SUCCESS",
    });
  });

  rows.push(
    baseRow({
      merchantId: merchant.merchantId,
      customerId: cust.customerId,
      deviceId: device,
      cardToken: pick(rng, cust.usualCardTokens),
      amount: randLogNormal(rng, cust.avgAmount, 0.25),
      timestamp: new Date(t0.getTime() + failCount * 15_000 + 5_000),
      status: "success",
      groundTruthRisk: randInt(rng, 50, 70),
      fraudScenario: "REPEATED_FAILURE_THEN_SUCCESS",
    })
  );

  return rows;
}

const GENERATORS: Record<FraudScenario, (rng: Rng, pools: EntityPools, t0: Date) => GeneratedRow[]> = {
  CARD_TESTING: genCardTesting,
  VELOCITY_ABUSE: genVelocityAbuse,
  DUPLICATE_PAYMENT: genDuplicatePayment,
  ACCOUNT_TAKEOVER: genAccountTakeover,
  REFUND_ABUSE: genRefundAbuse,
  MERCHANT_SPIKE: genMerchantSpike,
  LOCATION_ANOMALY: genLocationAnomaly,
  COORDINATED_ACTIVITY: genCoordinatedActivity,
  HIGH_VALUE_ANOMALY: genHighValueAnomaly,
  REPEATED_FAILURE_THEN_SUCCESS: genRepeatedFailureThenSuccess,
};

export function generateScenarioCluster(
  scenario: FraudScenario,
  rng: Rng,
  pools: EntityPools,
  t0: Date
): GeneratedRow[] {
  return GENERATORS[scenario](rng, pools, t0);
}
