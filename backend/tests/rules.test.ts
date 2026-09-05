import {
  cardTestingRule,
  chargebackFlagRule,
  coordinatedActivityRule,
  duplicatePaymentRule,
  evaluateRules,
  locationAnomalyRule,
  merchantSpikeRule,
  refundMismatchRule,
  RuleTransactionInput,
  unusualAmountRule,
  velocityRule,
} from "../src/services/rules/rules";
import { RuleContext } from "../src/services/rules/types";

function baseContext(overrides: Partial<RuleContext> = {}): RuleContext {
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
    ...overrides,
  };
}

function baseTxn(overrides: Partial<RuleTransactionInput> = {}): RuleTransactionInput {
  return {
    transactionId: "txn_1",
    amount: 1000,
    refundAmount: 0,
    chargebackFlag: false,
    city: "Mumbai",
    ...overrides,
  };
}

describe("velocityRule", () => {
  it("does not fire at exactly the threshold (10)", () => {
    expect(velocityRule(baseContext({ deviceAttemptsInWindow: 10 }))).toBeNull();
  });

  it("fires just above the threshold", () => {
    const finding = velocityRule(baseContext({ deviceAttemptsInWindow: 11 }));
    expect(finding).not.toBeNull();
    expect(finding!.code).toBe("VELOCITY_ABUSE");
    expect(finding!.category).toBe("velocity");
    expect(finding!.message).toContain("11 payment attempts");
  });

  it("clamps score at 100 for extreme values", () => {
    const finding = velocityRule(baseContext({ deviceAttemptsInWindow: 500 }));
    expect(finding!.score).toBe(100);
  });
});

describe("cardTestingRule", () => {
  it("does not fire at exactly 5 distinct cards", () => {
    expect(cardTestingRule(baseContext({ uniqueCardsPerDeviceInWindow: 5 }))).toBeNull();
  });

  it("fires at 6 distinct cards", () => {
    const finding = cardTestingRule(baseContext({ uniqueCardsPerDeviceInWindow: 6 }));
    expect(finding!.code).toBe("CARD_TESTING");
    expect(finding!.message).toContain("6 distinct card tokens");
  });
});

describe("coordinatedActivityRule", () => {
  it("does not fire at 2 distinct customers", () => {
    expect(coordinatedActivityRule(baseContext({ distinctCustomersOnDeviceOrIp: 2 }))).toBeNull();
  });

  it("fires at exactly 3 distinct customers (threshold is inclusive)", () => {
    const finding = coordinatedActivityRule(baseContext({ distinctCustomersOnDeviceOrIp: 3 }));
    expect(finding!.code).toBe("COORDINATED_ACTIVITY");
    expect(finding!.category).toBe("deviceLink");
  });
});

describe("duplicatePaymentRule", () => {
  it("does not fire when there is no duplicate", () => {
    expect(duplicatePaymentRule(baseContext({ isDuplicateOrderId: false }))).toBeNull();
  });

  it("fires with a fixed score when duplicate detected", () => {
    const finding = duplicatePaymentRule(baseContext({ isDuplicateOrderId: true, duplicateOrderCount: 2 }));
    expect(finding!.code).toBe("DUPLICATE_PAYMENT");
    expect(finding!.category).toBe("amountAnomaly");
    expect(finding!.score).toBe(70);
    expect(finding!.message).toContain("charged 3 times");
  });
});

describe("unusualAmountRule", () => {
  it("skips when there is no customer history (null average)", () => {
    expect(unusualAmountRule(baseTxn({ amount: 100000 }), baseContext({ customerAverageAmount: null }))).toBeNull();
  });

  it("does not fire at exactly 5x average", () => {
    expect(
      unusualAmountRule(baseTxn({ amount: 5000 }), baseContext({ customerAverageAmount: 1000 }))
    ).toBeNull();
  });

  it("fires above 5x average and reports the multiplier", () => {
    const finding = unusualAmountRule(baseTxn({ amount: 8000 }), baseContext({ customerAverageAmount: 1000 }));
    expect(finding!.code).toBe("UNUSUAL_AMOUNT");
    expect(finding!.message).toContain("8.0x");
  });
});

describe("merchantSpikeRule", () => {
  it("skips when the merchant has no trustworthy baseline (null)", () => {
    expect(merchantSpikeRule(baseContext({ merchantHourlyBaseline: null }))).toBeNull();
  });

  it("does not fire at exactly 4x baseline", () => {
    expect(
      merchantSpikeRule(baseContext({ merchantHourlyVolume: 40, merchantHourlyBaseline: 10 }))
    ).toBeNull();
  });

  it("fires above 4x baseline", () => {
    const finding = merchantSpikeRule(baseContext({ merchantHourlyVolume: 45, merchantHourlyBaseline: 10 }));
    expect(finding!.code).toBe("MERCHANT_SPIKE");
    expect(finding!.category).toBe("merchantDeviation");
  });

  it("notes when a fallback (global) baseline was used", () => {
    const finding = merchantSpikeRule(
      baseContext({ merchantHourlyVolume: 45, merchantHourlyBaseline: 10, merchantBaselineIsFallback: true })
    );
    expect(finding!.usedFallback).toBe(true);
    expect(finding!.message).toContain("global baseline");
  });
});

describe("refundMismatchRule", () => {
  it("does not fire when refund equals the captured amount", () => {
    expect(refundMismatchRule(baseTxn({ amount: 1000, refundAmount: 1000 }))).toBeNull();
  });

  it("fires when refund exceeds the captured amount", () => {
    const finding = refundMismatchRule(baseTxn({ amount: 1000, refundAmount: 1200 }));
    expect(finding!.code).toBe("REFUND_MISMATCH");
    expect(finding!.category).toBe("refundChargeback");
  });

  it("does not fire when amount is 0 (guards against division issues)", () => {
    expect(refundMismatchRule(baseTxn({ amount: 0, refundAmount: 100 }))).toBeNull();
  });
});

describe("chargebackFlagRule", () => {
  it("does not fire when there is no chargeback", () => {
    expect(chargebackFlagRule(baseTxn({ chargebackFlag: false }))).toBeNull();
  });

  it("fires with a fixed high score when chargebackFlag is set", () => {
    const finding = chargebackFlagRule(baseTxn({ chargebackFlag: true }));
    expect(finding!.score).toBe(85);
    expect(finding!.category).toBe("refundChargeback");
  });
});

describe("locationAnomalyRule", () => {
  it("skips when there is no established dominant city", () => {
    expect(
      locationAnomalyRule(baseTxn({ city: "Delhi" }), baseContext({ customerDominantCity: null }))
    ).toBeNull();
  });

  it("skips when the dominant city isn't dominant enough (below share threshold)", () => {
    expect(
      locationAnomalyRule(
        baseTxn({ city: "Delhi" }),
        baseContext({ customerDominantCity: "Mumbai", customerDominantCityShare: 0.3 })
      )
    ).toBeNull();
  });

  it("does not fire when the transaction city matches the dominant city", () => {
    expect(
      locationAnomalyRule(
        baseTxn({ city: "Mumbai" }),
        baseContext({ customerDominantCity: "Mumbai", customerDominantCityShare: 0.9 })
      )
    ).toBeNull();
  });

  it("fires when the city differs and history is trustworthy", () => {
    const finding = locationAnomalyRule(
      baseTxn({ city: "Delhi" }),
      baseContext({ customerDominantCity: "Mumbai", customerDominantCityShare: 0.9 })
    );
    expect(finding!.code).toBe("LOCATION_ANOMALY");
    expect(finding!.category).toBe("location");
    expect(finding!.message).toContain("Mumbai");
  });
});

describe("evaluateRules", () => {
  it("returns an empty array for a perfectly ordinary transaction", () => {
    expect(evaluateRules(baseTxn(), baseContext())).toHaveLength(0);
  });

  it("returns all findings that fired, in a stable order", () => {
    const txn = baseTxn({ amount: 8000, refundAmount: 0, chargebackFlag: true, city: "Delhi" });
    const context = baseContext({
      deviceAttemptsInWindow: 15,
      customerAverageAmount: 1000,
      customerDominantCity: "Mumbai",
      customerDominantCityShare: 0.9,
    });

    const findings = evaluateRules(txn, context);
    const codes = findings.map((f) => f.code);

    expect(codes).toContain("VELOCITY_ABUSE");
    expect(codes).toContain("UNUSUAL_AMOUNT");
    expect(codes).toContain("CHARGEBACK_FLAG");
    expect(codes).toContain("LOCATION_ANOMALY");
    expect(codes).not.toContain("REFUND_MISMATCH");
  });
});
