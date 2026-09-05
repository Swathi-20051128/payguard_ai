import { mapContextToMlPayload } from "../src/services/mlClient";
import { AnalysisContext } from "../src/services/rules/types";

function baseContext(overrides: Partial<AnalysisContext> = {}): AnalysisContext {
  return {
    deviceAttemptsInWindow: 1,
    uniqueCardsPerDeviceInWindow: 1,
    isDuplicateOrderId: false,
    duplicateOrderCount: 0,
    merchantHourlyVolume: 5,
    merchantHourlyBaseline: 10,
    merchantBaselineIsFallback: false,
    customerAverageAmount: 1000,
    distinctCustomersOnDeviceOrIp: 1,
    customerDominantCity: "Mumbai",
    customerDominantCityShare: 0.9,
    deviceAttemptsIn1Hour: 1,
    deviceTransactionCountLifetime: 5,
    failedAttemptsIn1Hour: 0,
    uniqueCardsPerDeviceLifetime: 2,
    uniqueCustomersForDevice: 1,
    customerAmountStdDev: 100,
    customerAccountAgeDays: 30,
    customerRefundRate: 0.1,
    customerChargebackRate: 0,
    deviceNovelty: false,
    ipNovelty: false,
    ...overrides,
  };
}

describe("mapContextToMlPayload", () => {
  it("maps all always-available fields directly", () => {
    const payload = mapContextToMlPayload(baseContext(), { amount: 1000, city: "Mumbai" });
    expect(payload.transactionsIn5Minutes).toBe(1);
    expect(payload.transactionsIn1Hour).toBe(1);
    expect(payload.deviceTransactionCountLifetime).toBe(5);
    expect(payload.failedAttemptsIn1Hour).toBe(0);
    expect(payload.uniqueCardsPerDevice).toBe(1);
    expect(payload.uniqueCardsPerDeviceLifetime).toBe(2);
    expect(payload.uniqueCustomersPerDevice).toBe(1);
    expect(payload.customerAccountAge).toBe(30);
    expect(payload.refundRate).toBe(0.1);
    expect(payload.chargebackRate).toBe(0);
    expect(payload.isDuplicateOrder).toBe(false);
    expect(payload.deviceNovelty).toBe(false);
    expect(payload.ipNovelty).toBe(false);
  });

  it("computes amountDeviationFromCustomerMean as a real z-score when std > 0", () => {
    const payload = mapContextToMlPayload(
      baseContext({ customerAverageAmount: 1000, customerAmountStdDev: 100 }),
      { amount: 1300, city: "Mumbai" }
    );
    expect(payload.amountDeviationFromCustomerMean).toBeCloseTo(3, 5); // (1300-1000)/100
  });

  it("sends 0 for amountDeviation when average exists but stdDev is 0 (no variance)", () => {
    const payload = mapContextToMlPayload(
      baseContext({ customerAverageAmount: 1000, customerAmountStdDev: 0 }),
      { amount: 5000, city: "Mumbai" }
    );
    expect(payload.amountDeviationFromCustomerMean).toBe(0);
  });

  it("omits amountDeviationFromCustomerMean when there's no customer average at all", () => {
    const payload = mapContextToMlPayload(baseContext({ customerAverageAmount: null }), {
      amount: 1000,
      city: "Mumbai",
    });
    expect(payload.amountDeviationFromCustomerMean).toBeUndefined();
  });

  it("computes merchantVolumeDeviation as (volume-baseline)/baseline", () => {
    const payload = mapContextToMlPayload(
      baseContext({ merchantHourlyVolume: 40, merchantHourlyBaseline: 10 }),
      { amount: 1000, city: "Mumbai" }
    );
    expect(payload.merchantVolumeDeviation).toBeCloseTo(3, 5); // (40-10)/10
  });

  it("omits merchantVolumeDeviation when the merchant has no trustworthy baseline", () => {
    const payload = mapContextToMlPayload(baseContext({ merchantHourlyBaseline: null }), {
      amount: 1000,
      city: "Mumbai",
    });
    expect(payload.merchantVolumeDeviation).toBeUndefined();
  });

  it("computes locationChangedFromPrevious=true when city differs from an established dominant city", () => {
    const payload = mapContextToMlPayload(
      baseContext({ customerDominantCity: "Mumbai", customerDominantCityShare: 0.8 }),
      { amount: 1000, city: "Delhi" }
    );
    expect(payload.locationChangedFromPrevious).toBe(true);
  });

  it("computes locationChangedFromPrevious=false when city matches the dominant city", () => {
    const payload = mapContextToMlPayload(
      baseContext({ customerDominantCity: "Mumbai", customerDominantCityShare: 0.8 }),
      { amount: 1000, city: "Mumbai" }
    );
    expect(payload.locationChangedFromPrevious).toBe(false);
  });

  it("omits locationChangedFromPrevious when there's no established dominant city", () => {
    const payload = mapContextToMlPayload(baseContext({ customerDominantCity: null }), {
      amount: 1000,
      city: "Delhi",
    });
    expect(payload.locationChangedFromPrevious).toBeUndefined();
  });

  it("omits locationChangedFromPrevious when the dominant city isn't dominant enough", () => {
    const payload = mapContextToMlPayload(
      baseContext({ customerDominantCity: "Mumbai", customerDominantCityShare: 0.3 }),
      { amount: 1000, city: "Delhi" }
    );
    expect(payload.locationChangedFromPrevious).toBeUndefined();
  });

  it("sends a real 0 value for account age of a brand-new customer, not an omission", () => {
    const payload = mapContextToMlPayload(baseContext({ customerAccountAgeDays: 0 }), {
      amount: 1000,
      city: "Mumbai",
    });
    expect(payload.customerAccountAge).toBe(0);
  });
});
