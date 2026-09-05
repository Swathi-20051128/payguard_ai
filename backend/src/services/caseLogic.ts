import { AlertStatus } from "../models/Alert";
import { CaseStatus, ReviewerDecision } from "../models/Case";

export interface AlertSummary {
  id: string;
  transactionId: string;
  merchantId: string;
  riskScore: number;
  severity: "MEDIUM" | "HIGH" | "CRITICAL";
}

export interface DerivedCaseFields {
  alertIds: string[];
  transactionIds: string[];
  merchantId: string;
  riskScore: number;
  riskLevel: "MEDIUM" | "HIGH" | "CRITICAL";
  recommendedAction: string;
}

const SEVERITY_RANK: Record<"MEDIUM" | "HIGH" | "CRITICAL", number> = { MEDIUM: 0, HIGH: 1, CRITICAL: 2 };

/**
 * Derives a new case's summary fields from the alerts it's opened
 * from. A case is scoped to one merchant (matching the Case model),
 * so mixed-merchant alert sets are rejected rather than silently
 * picking one -- the caller (the route) turns this into a 422.
 */
export function deriveCaseFields(alerts: AlertSummary[]): DerivedCaseFields | { error: string } {
  if (alerts.length === 0) {
    return { error: "At least one alert is required to open a case." };
  }

  const merchantIds = new Set(alerts.map((a) => a.merchantId));
  if (merchantIds.size > 1) {
    return { error: "All alerts in a case must belong to the same merchant." };
  }

  const highestSeverity = alerts.reduce(
    (max, a) => (SEVERITY_RANK[a.severity] > SEVERITY_RANK[max] ? a.severity : max),
    alerts[0].severity
  );
  const maxRiskScore = Math.max(...alerts.map((a) => a.riskScore));

  return {
    alertIds: alerts.map((a) => a.id),
    transactionIds: [...new Set(alerts.map((a) => a.transactionId))],
    merchantId: alerts[0].merchantId,
    riskScore: maxRiskScore,
    riskLevel: highestSeverity,
    recommendedAction: recommendedActionForCase(highestSeverity),
  };
}

function recommendedActionForCase(severity: "MEDIUM" | "HIGH" | "CRITICAL"): string {
  switch (severity) {
    case "MEDIUM":
      return "Review evidence and confirm whether further action is needed.";
    case "HIGH":
      return "Requires investigation before further action.";
    case "CRITICAL":
      return "Requires verification or escalation before proceeding.";
  }
}

/** Maps an analyst's decision to the case's resulting status. */
export function caseStatusForDecision(decision: ReviewerDecision): CaseStatus {
  switch (decision) {
    case "confirmed_suspicious":
      return "CONFIRMED_SUSPICIOUS";
    case "dismissed":
      return "DISMISSED";
    case "escalated":
      return "ESCALATED";
  }
}

/**
 * Maps the same decision to what happens to the case's linked
 * alerts. "confirmed_suspicious" resolves them (a verdict was
 * reached and acted on) rather than leaving them open-ended in the
 * queue -- this is a workflow-completion state, not a claim that
 * fraud is confirmed (the case's own status/decision field carries
 * that more precise language).
 */
export function alertStatusForDecision(decision: ReviewerDecision): AlertStatus {
  switch (decision) {
    case "confirmed_suspicious":
      return "RESOLVED";
    case "dismissed":
      return "DISMISSED";
    case "escalated":
      return "ESCALATED";
  }
}
