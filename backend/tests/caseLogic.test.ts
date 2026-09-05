import { alertStatusForDecision, AlertSummary, caseStatusForDecision, deriveCaseFields } from "../src/services/caseLogic";

function alert(overrides: Partial<AlertSummary> = {}): AlertSummary {
  return {
    id: "alert1",
    transactionId: "txn_1",
    merchantId: "merchant_1",
    riskScore: 65,
    severity: "HIGH",
    ...overrides,
  };
}

describe("deriveCaseFields", () => {
  it("returns an error for an empty alert list", () => {
    const result = deriveCaseFields([]);
    expect("error" in result).toBe(true);
  });

  it("returns an error when alerts span multiple merchants", () => {
    const result = deriveCaseFields([alert({ merchantId: "m1" }), alert({ merchantId: "m2" })]);
    expect("error" in result).toBe(true);
    expect((result as { error: string }).error).toContain("same merchant");
  });

  it("derives fields from a single alert", () => {
    const result = deriveCaseFields([alert({ id: "a1", transactionId: "t1", riskScore: 72, severity: "HIGH" })]);
    expect(result).not.toHaveProperty("error");
    const fields = result as any;
    expect(fields.alertIds).toEqual(["a1"]);
    expect(fields.transactionIds).toEqual(["t1"]);
    expect(fields.riskScore).toBe(72);
    expect(fields.riskLevel).toBe("HIGH");
  });

  it("takes the MAX risk score across multiple alerts", () => {
    const result = deriveCaseFields([
      alert({ id: "a1", riskScore: 40, severity: "MEDIUM" }),
      alert({ id: "a2", riskScore: 90, severity: "CRITICAL" }),
    ]);
    const fields = result as any;
    expect(fields.riskScore).toBe(90);
  });

  it("takes the HIGHEST severity across multiple alerts, not the first one", () => {
    const result = deriveCaseFields([
      alert({ id: "a1", severity: "MEDIUM" }),
      alert({ id: "a2", severity: "CRITICAL" }),
      alert({ id: "a3", severity: "HIGH" }),
    ]);
    expect((result as any).riskLevel).toBe("CRITICAL");
  });

  it("deduplicates transactionIds when multiple alerts reference the same transaction", () => {
    const result = deriveCaseFields([
      alert({ id: "a1", transactionId: "t1" }),
      alert({ id: "a2", transactionId: "t1" }),
    ]);
    expect((result as any).transactionIds).toEqual(["t1"]);
  });

  it("produces recommendedAction text that scales with severity and never claims fraud confirmed", () => {
    for (const severity of ["MEDIUM", "HIGH", "CRITICAL"] as const) {
      const fields = deriveCaseFields([alert({ severity })]) as any;
      expect(fields.recommendedAction.toLowerCase()).not.toContain("fraud confirmed");
    }
  });
});

describe("caseStatusForDecision", () => {
  it("maps each decision to its case status", () => {
    expect(caseStatusForDecision("confirmed_suspicious")).toBe("CONFIRMED_SUSPICIOUS");
    expect(caseStatusForDecision("dismissed")).toBe("DISMISSED");
    expect(caseStatusForDecision("escalated")).toBe("ESCALATED");
  });
});

describe("alertStatusForDecision", () => {
  it("maps each decision to its resulting alert status", () => {
    expect(alertStatusForDecision("confirmed_suspicious")).toBe("RESOLVED");
    expect(alertStatusForDecision("dismissed")).toBe("DISMISSED");
    expect(alertStatusForDecision("escalated")).toBe("ESCALATED");
  });
});
