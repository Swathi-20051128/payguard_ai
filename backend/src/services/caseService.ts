import { AppError } from "../middleware/errorHandler";
import { Alert } from "../models/Alert";
import { Case, ICase, ReviewerDecision } from "../models/Case";
import { Watchlist, WatchlistEntityType } from "../models/Watchlist";
import { recordAudit } from "./auditService";
import { alertStatusForDecision, caseStatusForDecision, deriveCaseFields } from "./caseLogic";

export interface ActorContext {
  userId: string;
  ipAddress?: string;
}

/**
 * Opens a case from one or more OPEN alerts (an explicit analyst
 * action -- see spec's example workflow: "The analyst opens an
 * investigation case"). Alerts already attached to another case are
 * rejected rather than silently reassigned.
 */
export async function createCase(alertIds: string[], actor: ActorContext): Promise<ICase> {
  const alerts = await Alert.find({ _id: { $in: alertIds } });

  if (alerts.length !== alertIds.length) {
    throw new AppError("One or more alertIds were not found", 404, "ALERT_NOT_FOUND");
  }
  const alreadyCased = alerts.find((a) => a.caseId);
  if (alreadyCased) {
    throw new AppError(`Alert ${alreadyCased.id} is already attached to a case`, 409, "ALERT_ALREADY_CASED");
  }

  const derived = deriveCaseFields(
    alerts.map((a) => ({
      id: a.id,
      transactionId: a.transactionId,
      merchantId: a.merchantId,
      riskScore: a.riskScore,
      severity: a.severity,
    }))
  );
  if ("error" in derived) {
    throw new AppError(derived.error, 422, "INVALID_CASE_ALERTS");
  }

  const created = await Case.create({
    ...derived,
    status: "OPEN",
    createdBy: actor.userId,
  });

  await Alert.updateMany({ _id: { $in: alertIds } }, { $set: { status: "UNDER_REVIEW", caseId: created._id } });

  await recordAudit({
    userId: actor.userId,
    action: "CASE_CREATED",
    entityType: "CASE",
    entityId: created.id,
    newState: { status: created.status, alertIds: derived.alertIds, riskLevel: derived.riskLevel },
    ipAddress: actor.ipAddress,
  });

  return created;
}

export async function assignCase(caseId: string, assignedTo: string, actor: ActorContext): Promise<ICase> {
  const existing = await Case.findById(caseId);
  if (!existing) throw new AppError("Case not found", 404, "CASE_NOT_FOUND");

  const previousAssignee = existing.assignedTo?.toString() ?? null;

  existing.assignedTo = assignedTo as unknown as ICase["assignedTo"];
  if (existing.status === "OPEN") existing.status = "UNDER_REVIEW";
  await existing.save();

  await recordAudit({
    userId: actor.userId,
    action: "CASE_ASSIGNED",
    entityType: "CASE",
    entityId: existing.id,
    previousState: { assignedTo: previousAssignee },
    newState: { assignedTo },
    ipAddress: actor.ipAddress,
  });

  return existing;
}

export interface DecideCaseInput {
  decision: ReviewerDecision;
  comment?: string;
}

/**
 * Records an analyst's final decision on a case and propagates it to
 * every alert the case was opened from (see alertStatusForDecision).
 * The wording of every resulting status is deliberately never
 * "fraud confirmed" -- see caseLogic.ts.
 */
export async function decideCase(caseId: string, input: DecideCaseInput, actor: ActorContext): Promise<ICase> {
  const existing = await Case.findById(caseId);
  if (!existing) throw new AppError("Case not found", 404, "CASE_NOT_FOUND");

  const previousStatus = existing.status;
  const newStatus = caseStatusForDecision(input.decision);

  existing.status = newStatus;
  existing.reviewerDecision = input.decision;
  existing.reviewerComment = input.comment;
  existing.decidedBy = actor.userId as unknown as ICase["decidedBy"];
  existing.decidedAt = new Date();
  await existing.save();

  await Alert.updateMany(
    { _id: { $in: existing.alertIds } },
    { $set: { status: alertStatusForDecision(input.decision) } }
  );

  await recordAudit({
    userId: actor.userId,
    action: "CASE_DECISION_RECORDED",
    entityType: "CASE",
    entityId: existing.id,
    previousState: { status: previousStatus },
    newState: { status: newStatus, decision: input.decision },
    reason: input.comment,
    ipAddress: actor.ipAddress,
  });

  return existing;
}

export type CaseActionType =
  | "request_verification"
  | "add_to_watchlist"
  | "generate_report"
  | "merchant_notification"
  | "review_hold";

export interface CaseActionInput {
  actionType: CaseActionType;
  reason?: string;
  watchlist?: { entityType: WatchlistEntityType; entityValue: string };
}

export interface CaseActionResult {
  actionType: CaseActionType;
  simulated: true;
  message: string;
  data?: Record<string, unknown>;
}

/**
 * Performs one of the spec's safe test-mode actions (Feature 10).
 * Every branch is a SIMULATION ONLY -- no real payment is blocked,
 * no real customer is contacted, no real notification is sent. Each
 * action is recorded to the audit log regardless of what it does.
 */
export async function performCaseAction(
  caseId: string,
  input: CaseActionInput,
  actor: ActorContext
): Promise<CaseActionResult> {
  const existing = await Case.findById(caseId);
  if (!existing) throw new AppError("Case not found", 404, "CASE_NOT_FOUND");

  let result: CaseActionResult;

  switch (input.actionType) {
    case "request_verification":
      result = {
        actionType: "request_verification",
        simulated: true,
        message: "A simulated verification request has been recorded for this case. No real customer was contacted.",
      };
      break;

    case "merchant_notification":
      result = {
        actionType: "merchant_notification",
        simulated: true,
        message: `A simulated notification to merchant ${existing.merchantId} has been recorded. No real notification was sent.`,
      };
      break;

    case "review_hold":
      existing.reviewHoldActive = true;
      await existing.save();
      result = {
        actionType: "review_hold",
        simulated: true,
        message: "A simulated review hold has been placed on this case. No real payment was blocked.",
      };
      break;

    case "generate_report": {
      const report = {
        caseId: existing.id,
        merchantId: existing.merchantId,
        riskScore: existing.riskScore,
        riskLevel: existing.riskLevel,
        status: existing.status,
        transactionIds: existing.transactionIds,
        recommendedAction: existing.recommendedAction,
        generatedAt: new Date().toISOString(),
        generatedBy: actor.userId,
      };
      result = {
        actionType: "generate_report",
        simulated: true,
        message: "Case report generated.",
        data: report,
      };
      break;
    }

    case "add_to_watchlist": {
      if (!input.watchlist) {
        throw new AppError(
          "watchlist.entityType and watchlist.entityValue are required for this action",
          422,
          "MISSING_WATCHLIST_INPUT"
        );
      }
      const entry = await Watchlist.create({
        entityType: input.watchlist.entityType,
        entityValue: input.watchlist.entityValue,
        reason: input.reason ?? `Added from case ${existing.id}`,
        addedBy: actor.userId,
        caseId: existing._id,
      });
      result = {
        actionType: "add_to_watchlist",
        simulated: true,
        message: `${input.watchlist.entityType} ${input.watchlist.entityValue} added to the watchlist.`,
        data: { watchlistId: entry.id },
      };
      break;
    }
  }

  await recordAudit({
    userId: actor.userId,
    action: `CASE_ACTION_${input.actionType.toUpperCase()}`,
    entityType: "CASE",
    entityId: existing.id,
    reason: input.reason,
    metadata: result,
    ipAddress: actor.ipAddress,
  });

  return result;
}
