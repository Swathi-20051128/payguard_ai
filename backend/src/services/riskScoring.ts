import { RISK_WEIGHTS, riskLevelFor } from "./rules/config";
import { RiskCategory, RuleFinding } from "./rules/types";

export interface RiskAggregation {
  riskScore: number;
  riskLevel: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  categoryScores: Record<RiskCategory, number>;
  reasons: string[];
  recommendedAction: string;
}

/**
 * Combines fired-rule findings into the final weighted risk score:
 *
 *   riskScore = velocityRisk*0.25 + deviceLinkRisk*0.20 +
 *               amountAnomalyRisk*0.15 + merchantDeviationRisk*0.15 +
 *               refundChargebackRisk*0.15 + locationRisk*0.10
 *
 * Within a category, multiple findings take the MAX of their
 * individual scores (not the sum) — e.g. CARD_TESTING and
 * COORDINATED_ACTIVITY both feed "deviceLink", but firing both isn't
 * twice as suspicious as firing the stronger one alone. This keeps
 * the final score bounded at 100 by construction and keeps each
 * category's contribution legible on its own.
 *
 * Pure function — no DB access, no I/O — so it's exhaustively unit
 * testable independent of the rule engine that produces its input.
 */
export function aggregateRisk(findings: RuleFinding[]): RiskAggregation {
  const categoryScores: Record<RiskCategory, number> = {
    velocity: 0,
    deviceLink: 0,
    amountAnomaly: 0,
    merchantDeviation: 0,
    refundChargeback: 0,
    location: 0,
  };

  for (const finding of findings) {
    categoryScores[finding.category] = Math.max(categoryScores[finding.category], finding.score);
  }

  const weighted =
    categoryScores.velocity * RISK_WEIGHTS.velocity +
    categoryScores.deviceLink * RISK_WEIGHTS.deviceLink +
    categoryScores.amountAnomaly * RISK_WEIGHTS.amountAnomaly +
    categoryScores.merchantDeviation * RISK_WEIGHTS.merchantDeviation +
    categoryScores.refundChargeback * RISK_WEIGHTS.refundChargeback +
    categoryScores.location * RISK_WEIGHTS.location;

  const riskScore = Math.max(0, Math.min(100, Math.round(weighted)));
  const riskLevel = riskLevelFor(riskScore);

  return {
    riskScore,
    riskLevel,
    categoryScores,
    reasons: findings.map((f) => f.message),
    recommendedAction: recommendedActionFor(riskLevel),
  };
}

/**
 * Never claims certainty — the spec explicitly forbids "fraud
 * confirmed" language anywhere in the system. These are always
 * framed as next steps for a human, not verdicts.
 */
function recommendedActionFor(level: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL"): string {
  switch (level) {
    case "LOW":
      return "Continue monitoring — no action needed.";
    case "MEDIUM":
      return "Include in analyst review queue.";
    case "HIGH":
      return "Requires investigation before further action.";
    case "CRITICAL":
      return "Requires verification or escalation before proceeding.";
  }
}
