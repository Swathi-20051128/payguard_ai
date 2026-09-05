import { aggregateRisk } from "../src/services/riskScoring";
import { RuleFinding } from "../src/services/rules/types";

function finding(overrides: Partial<RuleFinding>): RuleFinding {
  return { code: "VELOCITY_ABUSE", category: "velocity", score: 100, message: "test", ...overrides };
}

describe("aggregateRisk", () => {
  it("returns 0/LOW for no findings", () => {
    const result = aggregateRisk([]);
    expect(result.riskScore).toBe(0);
    expect(result.riskLevel).toBe("LOW");
    expect(result.reasons).toHaveLength(0);
  });

  it("applies the exact spec weights for a single maxed-out category", () => {
    // velocity alone at 100 -> 100*0.25 = 25
    const result = aggregateRisk([finding({ category: "velocity", score: 100 })]);
    expect(result.riskScore).toBe(25);
  });

  it("weights deviceLink at 0.20", () => {
    const result = aggregateRisk([finding({ category: "deviceLink", score: 100 })]);
    expect(result.riskScore).toBe(20);
  });

  it("weights amountAnomaly at 0.15", () => {
    const result = aggregateRisk([finding({ category: "amountAnomaly", score: 100 })]);
    expect(result.riskScore).toBe(15);
  });

  it("weights merchantDeviation at 0.15", () => {
    const result = aggregateRisk([finding({ category: "merchantDeviation", score: 100 })]);
    expect(result.riskScore).toBe(15);
  });

  it("weights refundChargeback at 0.15", () => {
    const result = aggregateRisk([finding({ category: "refundChargeback", score: 100 })]);
    expect(result.riskScore).toBe(15);
  });

  it("weights location at 0.10", () => {
    const result = aggregateRisk([finding({ category: "location", score: 100 })]);
    expect(result.riskScore).toBe(10);
  });

  it("sums correctly across all six categories maxed out (should hit exactly 100)", () => {
    const result = aggregateRisk([
      finding({ category: "velocity", score: 100 }),
      finding({ category: "deviceLink", score: 100 }),
      finding({ category: "amountAnomaly", score: 100 }),
      finding({ category: "merchantDeviation", score: 100 }),
      finding({ category: "refundChargeback", score: 100 }),
      finding({ category: "location", score: 100 }),
    ]);
    expect(result.riskScore).toBe(100);
    expect(result.riskLevel).toBe("CRITICAL");
  });

  it("takes the MAX within a category, not the sum, when two rules share a category", () => {
    // CARD_TESTING and COORDINATED_ACTIVITY both feed deviceLink.
    const result = aggregateRisk([
      finding({ code: "CARD_TESTING", category: "deviceLink", score: 60 }),
      finding({ code: "COORDINATED_ACTIVITY", category: "deviceLink", score: 90 }),
    ]);
    // Should be 90 * 0.20 = 18, NOT (60+90) capped or summed.
    expect(result.riskScore).toBe(18);
  });

  it("includes every finding's message in reasons, in order", () => {
    const result = aggregateRisk([
      finding({ message: "first reason" }),
      finding({ category: "location", message: "second reason" }),
    ]);
    expect(result.reasons).toEqual(["first reason", "second reason"]);
  });

  it.each([
    [0, "LOW"],
    [29, "LOW"],
    [30, "MEDIUM"],
    [59, "MEDIUM"],
    [60, "HIGH"],
    [79, "HIGH"],
    [80, "CRITICAL"],
    [100, "CRITICAL"],
  ] as const)("classifies a weighted score around %i as %s", (targetScore, expectedLevel) => {
    // Weights sum to exactly 1.0, so setting every category to the
    // same sub-score makes the weighted total equal that sub-score
    // exactly — a clean way to hit any target riskScore directly.
    const findings = (
      ["velocity", "deviceLink", "amountAnomaly", "merchantDeviation", "refundChargeback", "location"] as const
    ).map((category) => finding({ category, score: targetScore }));
    const result = aggregateRisk(findings);
    expect(result.riskScore).toBe(targetScore);
    expect(result.riskLevel).toBe(expectedLevel);
  });

  it("never suggests fraud is confirmed — recommendedAction language check", () => {
    const cases: [number, string][] = [
      [0, "Continue monitoring"],
      [40, "analyst review queue"],
      [65, "Requires investigation"],
      [90, "Requires verification or escalation"],
    ];
    for (const [targetScore, expectedSubstring] of cases) {
      const findings = (
        ["velocity", "deviceLink", "amountAnomaly", "merchantDeviation", "refundChargeback", "location"] as const
      ).map((category) => finding({ category, score: targetScore }));
      const result = aggregateRisk(findings);
      expect(result.recommendedAction).toContain(expectedSubstring);
      expect(result.recommendedAction.toLowerCase()).not.toContain("fraud confirmed");
    }
  });

  it("returns per-category scores for the explainability UI", () => {
    const result = aggregateRisk([
      finding({ category: "velocity", score: 80 }),
      finding({ category: "location", score: 40 }),
    ]);
    expect(result.categoryScores.velocity).toBe(80);
    expect(result.categoryScores.location).toBe(40);
    expect(result.categoryScores.deviceLink).toBe(0);
  });
});
