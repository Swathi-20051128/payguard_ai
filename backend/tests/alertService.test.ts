import { buildAlertFields, recommendedActionText, severityFor } from "../src/services/alertService";
import { CombinedRiskResult } from "../src/services/combinedRiskScoring";

function combined(overrides: Partial<CombinedRiskResult> = {}): CombinedRiskResult {
  return {
    riskScore: 50,
    riskLevel: "MEDIUM",
    reasons: ["some reason"],
    confidence: "high",
    ruleScore: 50,
    ruleEngineVersion: "rules-v1",
    mlAnomalyScore: 40,
    mlSupervisedProbability: 60,
    mlModelVersion: "v1",
    mlUsedFallback: false,
    estimatedExposure: 0,
    ...overrides,
  };
}

const txn = { transactionId: "txn_1", merchantId: "merchant_1", customerId: "customer_1" };

describe("severityFor", () => {
  it("returns null for LOW risk", () => {
    expect(severityFor("LOW")).toBeNull();
  });

  it.each(["MEDIUM", "HIGH", "CRITICAL"] as const)("returns %s for %s risk", (level) => {
    expect(severityFor(level)).toBe(level);
  });
});

describe("buildAlertFields", () => {
  it("returns null for a LOW-risk transaction — no alert generated", () => {
    expect(buildAlertFields(txn, combined({ riskLevel: "LOW", riskScore: 10 }))).toBeNull();
  });

  it("builds full alert fields for a MEDIUM+ risk transaction", () => {
    const fields = buildAlertFields(txn, combined({ riskLevel: "HIGH", riskScore: 72 }));
    expect(fields).not.toBeNull();
    expect(fields!.transactionId).toBe("txn_1");
    expect(fields!.merchantId).toBe("merchant_1");
    expect(fields!.severity).toBe("HIGH");
    expect(fields!.riskScore).toBe(72);
    expect(fields!.reasons).toEqual(["some reason"]);
  });

  it("carries through confidence and exposure from the combined result", () => {
    const fields = buildAlertFields(txn, combined({ riskLevel: "CRITICAL", confidence: "low", estimatedExposure: 9999 }));
    expect(fields!.confidence).toBe("low");
    expect(fields!.estimatedExposure).toBe(9999);
  });

  it("carries through rule and ML model versions", () => {
    const fields = buildAlertFields(txn, combined({ riskLevel: "MEDIUM", ruleEngineVersion: "rules-v2", mlModelVersion: "v3" }));
    expect(fields!.ruleEngineVersion).toBe("rules-v2");
    expect(fields!.mlModelVersion).toBe("v3");
  });
});

describe("recommendedActionText", () => {
  it("never claims fraud is confirmed, for any risk level", () => {
    for (const level of ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const) {
      expect(recommendedActionText(level).toLowerCase()).not.toContain("fraud confirmed");
    }
  });

  it("escalates language appropriately with severity", () => {
    expect(recommendedActionText("MEDIUM")).toContain("review queue");
    expect(recommendedActionText("HIGH")).toContain("investigation");
    expect(recommendedActionText("CRITICAL")).toContain("verification or escalation");
  });
});
