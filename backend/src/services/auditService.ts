import { AuditLog } from "../models/AuditLog";
import { AuditEventData, computeHash, GENESIS_HASH } from "./audit/hashChain";

export interface RecordAuditInput {
  userId: string;
  action: string;
  entityType: "TRANSACTION" | "ALERT" | "CASE" | "WATCHLIST" | "USER";
  entityId: string;
  previousState?: unknown;
  newState?: unknown;
  reason?: string;
  metadata?: unknown;
  modelVersion?: string;
  ipAddress?: string;
}

/**
 * Appends one entry to the tamper-evident audit log. Every mutating
 * action in Phase 7 (case creation, assignment, decisions, test-mode
 * actions, alert status changes) calls this -- see Feature 11's
 * requirement that every action is auditable.
 *
 * Concurrency note: finding "the last entry" and inserting the next
 * one isn't wrapped in a transaction, so two truly simultaneous
 * writes could race on `sequence`. At this project's scale that's an
 * acceptable, documented limitation (a real deployment would use a
 * transaction or a dedicated sequence counter); verifyChain() would
 * still correctly detect any resulting inconsistency.
 */
export async function recordAudit(input: RecordAuditInput): Promise<void> {
  const last = await AuditLog.findOne().sort({ sequence: -1 });
  const previousHash = last?.currentHash ?? GENESIS_HASH;
  const sequence = (last?.sequence ?? -1) + 1;

  const event: AuditEventData = {
    userId: input.userId,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId,
    previousState: input.previousState,
    newState: input.newState,
    reason: input.reason,
    metadata: input.metadata,
  };

  const createdAt = new Date();
  const currentHash = computeHash(previousHash, event, createdAt.toISOString());

  await AuditLog.create({
    userId: input.userId,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId,
    previousState: input.previousState,
    newState: input.newState,
    reason: input.reason,
    metadata: input.metadata,
    modelVersion: input.modelVersion,
    ipAddress: input.ipAddress,
    sequence,
    previousHash,
    currentHash,
    createdAt,
  });
}
