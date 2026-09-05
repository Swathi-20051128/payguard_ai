import { combineRiskScores } from "../src/services/combinedRiskScoring";
import { MlPredictionResult } from "../src/services/mlClient";
import { RiskAggregation } from "../src/services/riskScoring";

function ruleAgg(overrides: Partial<RiskAggregation> = {}): RiskAggregation {
  return {
    riskScore: 0,
    riskLevel: "LOW",
    categoryScores: {
      velocity: 0,
      deviceLink: 0,
      amountAnomaly: 0,
      merchantDeviation: 0,
      refundChargeback: 0,
      location: 0,
    },
    reasons: [],
    recommendedAction: "Continue monitoring — no action needed.",
    ...overrides,
  };
}

function mlResult(overrides: Partial<MlPredictionResult> = {}): MlPredictionResult {
  return {
    transactionId: "txn_1",
    anomalyScore: 0,
    supervisedProbability: 0,
    modelVersion: "v1",
    usedDefaultFeatures: false,
    confidence: "high",
    topContributingFeatures: [],
    ...overrides,
  };
}

describe("combineRiskScores — ML unavailable (fallback)", () => {
  it("falls back to the rule score alone with low confidence", () => {
    const result = combineRiskScores(ruleAgg({ riskScore: 72, riskLevel: "HIGH" }), null, 1000);
    expect(result.riskScore).toBe(72);
    expect(result.riskLevel).toBe("HIGH");
    expect(result.confidence).toBe("low");
    expect(result.mlUsedFallback).toBe(true);
    expect(result.mlAnomalyScore).toBeNull();
    expect(result.mlSupervisedProbability).toBeNull();
    expect(result.mlModelVersion).toBeNull();
  });

  it("still includes rule reasons even without ML", () => {
    const result = combineRiskScores(ruleAgg({ reasons: ["some rule fired"] }), null, 1000);
    expect(result.reasons).toEqual(["some rule fired"]);
  });
});

describe("combineRiskScores — ML available", () => {
  it("blends rule score (0.6 weight) and ML supervisedProbability (0.4 weight)", () => {
    const result = combineRiskScores(ruleAgg({ riskScore: 100 }), mlResult({ supervisedProbability: 0 }), 1000);
    expect(result.riskScore).toBe(60); // 0.6*100 + 0.4*0
  });

  it("blends the opposite direction correctly too", () => {
    const result = combineRiskScores(ruleAgg({ riskScore: 0 }), mlResult({ supervisedProbability: 100 }), 1000);
    expect(result.riskScore).toBe(40); // 0.6*0 + 0.4*100
  });

  it("sets confidence=high when ML used real (non-default) features", () => {
    const result = combineRiskScores(ruleAgg(), mlResult({ usedDefaultFeatures: false }), 1000);
    expect(result.confidence).toBe("high");
  });

  it("sets confidence=medium when ML had to use default/fallback features", () => {
    const result = combineRiskScores(ruleAgg(), mlResult({ usedDefaultFeatures: true }), 1000);
    expect(result.confidence).toBe("medium");
  });

  it("passes through the ML anomaly score, probability, and model version", () => {
    const result = combineRiskScores(
      ruleAgg(),
      mlResult({ anomalyScore: 55, supervisedProbability: 33, modelVersion: "v2" }),
      1000
    );
    expect(result.mlAnomalyScore).toBe(55);
    expect(result.mlSupervisedProbability).toBe(33);
    expect(result.mlModelVersion).toBe("v2");
    expect(result.mlUsedFallback).toBe(false);
  });
});

describe("combineRiskScores — risk level classification", () => {
  it.each([
    [0, "LOW"],
    [29, "LOW"],
    [30, "MEDIUM"],
    [59, "MEDIUM"],
    [60, "HIGH"],
    [79, "HIGH"],
    [80, "CRITICAL"],
    [100, "CRITICAL"],
  ] as const)("classifies a final blended score of %i as %s", (targetScore, expectedLevel) => {
    // Setting both rule and ML scores to the same value makes the
    // weighted blend equal that value exactly (0.6+0.4=1.0).
    const result = combineRiskScores(
      ruleAgg({ riskScore: targetScore }),
      mlResult({ supervisedProbability: targetScore }),
      1000
    );
    expect(result.riskScore).toBe(targetScore);
    expect(result.riskLevel).toBe(expectedLevel);
  });
});

describe("combineRiskScores — ML explanations", () => {
  it("includes only positive-contribution ML features as reasons", () => {
    const result = combineRiskScores(
      ruleAgg(),
      mlResult({
        topContributingFeatures: [
          { feature: "uniqueCardsPerDevice", value: 8, contribution: 0.4 },
          { feature: "customerAccountAge", value: 400, contribution: -0.2 }, // pushes toward normal — should be excluded
        ],
      }),
      1000
    );
    expect(result.reasons).toHaveLength(1);
    expect(result.reasons[0]).toContain("distinct cards used from this device recently");
  });

  it("produces no ML reasons when nothing pushed toward suspicious", () => {
    const result = combineRiskScores(
      ruleAgg(),
      mlResult({ topContributingFeatures: [{ feature: "amount", value: 100, contribution: -0.1 }] }),
      1000
    );
    expect(result.reasons).toHaveLength(0);
  });

  it("falls back to the raw feature name for an unrecognized feature", () => {
    const result = combineRiskScores(
      ruleAgg(),
      mlResult({ topContributingFeatures: [{ feature: "someNewFeature", value: 1, contribution: 0.1 }] }),
      1000
    );
    expect(result.reasons[0]).toContain("someNewFeature");
  });

  it("merges rule reasons and ML reasons together, rules first", () => {
    const result = combineRiskScores(
      ruleAgg({ reasons: ["rule reason A"] }),
      mlResult({ topContributingFeatures: [{ feature: "amount", value: 1, contribution: 0.5 }] }),
      1000
    );
    expect(result.reasons[0]).toBe("rule reason A");
    expect(result.reasons[1]).toContain("ML model:");
  });
});

describe("combineRiskScores — estimated exposure", () => {
  it("is 0 for a low-risk transaction", () => {
    const result = combineRiskScores(ruleAgg({ riskScore: 20 }), null, 5000);
    expect(result.estimatedExposure).toBe(0);
  });

  it("equals the transaction amount once the score crosses the HIGH threshold (60)", () => {
    const result = combineRiskScores(ruleAgg({ riskScore: 60 }), null, 5000);
    expect(result.estimatedExposure).toBe(5000);
  });

  it("is 0 just below the threshold", () => {
    const result = combineRiskScores(ruleAgg({ riskScore: 59 }), null, 5000);
    expect(result.estimatedExposure).toBe(0);
  });
});
