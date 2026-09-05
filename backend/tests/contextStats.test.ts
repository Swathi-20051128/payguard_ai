import {
  computeCustomerStats,
  computeDeviceStats,
  CustomerHistoryRow,
  DeviceHistoryRow,
} from "../src/services/rules/contextStats";

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function ts(offsetMsFromRef: number, ref: Date): Date {
  return new Date(ref.getTime() + offsetMsFromRef);
}

describe("computeDeviceStats", () => {
  const ref = new Date("2026-01-01T12:00:00Z");

  it("counts only the reference row when history has just one entry", () => {
    const history: DeviceHistoryRow[] = [{ timestamp: ref, cardToken: "c1", status: "success", customerId: "cu1" }];
    const stats = computeDeviceStats(history, ref);
    expect(stats.deviceAttemptsInWindow).toBe(1);
    expect(stats.deviceAttemptsIn1Hour).toBe(1);
    expect(stats.deviceTransactionCountLifetime).toBe(1);
  });

  it("respects the 5-minute window boundary", () => {
    const history: DeviceHistoryRow[] = [
      { timestamp: ts(-4 * MINUTE, ref), cardToken: "c1", status: "success", customerId: "cu1" },
      { timestamp: ts(-6 * MINUTE, ref), cardToken: "c2", status: "success", customerId: "cu1" }, // outside 5min
      { timestamp: ref, cardToken: "c3", status: "success", customerId: "cu1" },
    ];
    const stats = computeDeviceStats(history, ref);
    expect(stats.deviceAttemptsInWindow).toBe(2); // -4min and ref, not -6min
    expect(stats.deviceAttemptsIn1Hour).toBe(3); // all within 1h
  });

  it("counts distinct cards separately for the 1h window vs lifetime", () => {
    const history: DeviceHistoryRow[] = [
      { timestamp: ts(-2 * HOUR, ref), cardToken: "old_card", status: "success", customerId: "cu1" }, // outside 1h
      { timestamp: ts(-10 * MINUTE, ref), cardToken: "c1", status: "success", customerId: "cu1" },
      { timestamp: ref, cardToken: "c2", status: "success", customerId: "cu1" },
    ];
    const stats = computeDeviceStats(history, ref);
    expect(stats.uniqueCardsPerDeviceInWindow).toBe(2); // c1, c2
    expect(stats.uniqueCardsPerDeviceLifetime).toBe(3); // old_card, c1, c2
  });

  it("counts failed attempts only within the 1h window", () => {
    const history: DeviceHistoryRow[] = [
      { timestamp: ts(-3 * HOUR, ref), cardToken: "c1", status: "failed", customerId: "cu1" }, // outside 1h
      { timestamp: ts(-10 * MINUTE, ref), cardToken: "c2", status: "failed", customerId: "cu1" },
      { timestamp: ref, cardToken: "c3", status: "success", customerId: "cu1" },
    ];
    const stats = computeDeviceStats(history, ref);
    expect(stats.failedAttemptsIn1Hour).toBe(1);
  });

  it("counts distinct customers within the 24h window", () => {
    const history: DeviceHistoryRow[] = [
      { timestamp: ts(-2 * DAY, ref), cardToken: "c1", status: "success", customerId: "old_customer" }, // outside 24h
      { timestamp: ts(-1 * HOUR, ref), cardToken: "c2", status: "success", customerId: "cu1" },
      { timestamp: ref, cardToken: "c3", status: "success", customerId: "cu2" },
    ];
    const stats = computeDeviceStats(history, ref);
    expect(stats.uniqueCustomersForDevice).toBe(2); // cu1, cu2 — not old_customer
  });

  it("ignores undefined cardTokens when counting distinct cards", () => {
    const history: DeviceHistoryRow[] = [
      { timestamp: ref, cardToken: undefined, status: "success", customerId: "cu1" },
      { timestamp: ref, cardToken: undefined, status: "success", customerId: "cu1" },
    ];
    const stats = computeDeviceStats(history, ref);
    expect(stats.uniqueCardsPerDeviceLifetime).toBe(0);
  });
});

describe("computeCustomerStats", () => {
  const ref = new Date("2026-01-01T12:00:00Z");

  function row(overrides: Partial<CustomerHistoryRow>): CustomerHistoryRow {
    return {
      timestamp: ref,
      amount: 100,
      refundAmount: 0,
      chargebackFlag: false,
      city: "Mumbai",
      deviceId: "device_1",
      ipHash: "ip_1",
      ...overrides,
    };
  }

  it("returns null average/stdDev with fewer than 3 prior transactions", () => {
    const history = [row({}), row({})];
    const stats = computeCustomerStats(history, ref, "device_2", "ip_2");
    expect(stats.customerAverageAmount).toBeNull();
    expect(stats.customerAmountStdDev).toBeNull();
  });

  it("computes average/stdDev once 3+ prior transactions exist", () => {
    const history = [row({ amount: 90 }), row({ amount: 100 }), row({ amount: 110 })];
    const stats = computeCustomerStats(history, ref, "device_2", "ip_2");
    expect(stats.customerAverageAmount).toBe(100);
    expect(stats.customerAmountStdDev).toBeCloseTo(10, 5);
  });

  it("returns account age 0 for a customer with no prior history (first transaction)", () => {
    const stats = computeCustomerStats([], ref, "device_1", "ip_1");
    expect(stats.customerAccountAgeDays).toBe(0);
  });

  it("computes account age in days from the earliest prior transaction", () => {
    const history = [row({ timestamp: ts(-5 * DAY, ref) }), row({ timestamp: ts(-2 * DAY, ref) })];
    const stats = computeCustomerStats(history, ref, "device_2", "ip_2");
    expect(stats.customerAccountAgeDays).toBeCloseTo(5, 5);
  });

  it("computes refund and chargeback rates from prior history", () => {
    const history = [
      row({ refundAmount: 50, chargebackFlag: false }),
      row({ refundAmount: 0, chargebackFlag: true }),
      row({ refundAmount: 0, chargebackFlag: false }),
      row({ refundAmount: 0, chargebackFlag: false }),
    ];
    const stats = computeCustomerStats(history, ref, "device_2", "ip_2");
    expect(stats.customerRefundRate).toBe(0.25);
    expect(stats.customerChargebackRate).toBe(0.25);
  });

  it("defaults refund/chargeback rate to 0 with no history", () => {
    const stats = computeCustomerStats([], ref, "device_1", "ip_1");
    expect(stats.customerRefundRate).toBe(0);
    expect(stats.customerChargebackRate).toBe(0);
  });

  it("finds the dominant city only with 3+ prior transactions", () => {
    const history = [row({ city: "Mumbai" }), row({ city: "Delhi" })];
    const stats = computeCustomerStats(history, ref, "device_2", "ip_2");
    expect(stats.customerDominantCity).toBeNull();
  });

  it("identifies the dominant city and its share correctly", () => {
    const history = [
      row({ city: "Mumbai" }),
      row({ city: "Mumbai" }),
      row({ city: "Mumbai" }),
      row({ city: "Delhi" }),
    ];
    const stats = computeCustomerStats(history, ref, "device_2", "ip_2");
    expect(stats.customerDominantCity).toBe("Mumbai");
    expect(stats.customerDominantCityShare).toBe(0.75);
  });

  it("flags deviceNovelty=true when the customer has never used this device", () => {
    const history = [row({ deviceId: "old_device" })];
    const stats = computeCustomerStats(history, ref, "new_device", "ip_1");
    expect(stats.deviceNovelty).toBe(true);
  });

  it("flags deviceNovelty=false when the customer HAS used this device before", () => {
    const history = [row({ deviceId: "device_1" })];
    const stats = computeCustomerStats(history, ref, "device_1", "ip_2");
    expect(stats.deviceNovelty).toBe(false);
  });

  it("flags ipNovelty independently of deviceNovelty", () => {
    const history = [row({ deviceId: "device_1", ipHash: "old_ip" })];
    const stats = computeCustomerStats(history, ref, "device_1", "new_ip");
    expect(stats.deviceNovelty).toBe(false);
    expect(stats.ipNovelty).toBe(true);
  });

  it("treats a first-ever transaction as novel on both device and IP", () => {
    const stats = computeCustomerStats([], ref, "device_1", "ip_1");
    expect(stats.deviceNovelty).toBe(true);
    expect(stats.ipNovelty).toBe(true);
  });
});
