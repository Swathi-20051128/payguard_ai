import { createHash } from "node:crypto";

export const GENESIS_HASH = "0".repeat(64);

export interface AuditEventData {
  userId: string;
  action: string;
  entityType: string;
  entityId: string;
  previousState?: unknown;
  newState?: unknown;
  reason?: string;
  metadata?: unknown;
}

/**
 * currentHash = SHA256(previousHash + canonicalEventData + timestamp)
 *
 * Chaining each entry's hash to the one before it means altering or
 * deleting any past entry breaks every hash after it -- the same
 * principle a blockchain uses, without needing one. Verified by
 * verifyChain() below, which any admin/analyst can run against the
 * full log to confirm nothing has been tampered with.
 */
export function computeHash(previousHash: string, event: AuditEventData, timestampIso: string): string {
  const canonical = JSON.stringify(event, Object.keys(event).sort());
  return createHash("sha256").update(previousHash + canonical + timestampIso).digest("hex");
}

export interface ChainEntry {
  sequence: number;
  previousHash: string;
  currentHash: string;
  createdAt: Date;
  event: AuditEventData;
}

export interface ChainVerificationResult {
  valid: boolean;
  brokenAtSequence: number | null;
  totalEntries: number;
}

/**
 * Recomputes every entry's hash from its stored event data and
 * compares it against what's stored -- confirms the chain hasn't
 * been tampered with. Entries must be passed in ascending sequence
 * order.
 */
export function verifyChain(entries: ChainEntry[]): ChainVerificationResult {
  let expectedPreviousHash = GENESIS_HASH;

  for (const entry of entries) {
    if (entry.previousHash !== expectedPreviousHash) {
      return { valid: false, brokenAtSequence: entry.sequence, totalEntries: entries.length };
    }
    const recomputed = computeHash(entry.previousHash, entry.event, entry.createdAt.toISOString());
    if (recomputed !== entry.currentHash) {
      return { valid: false, brokenAtSequence: entry.sequence, totalEntries: entries.length };
    }
    expectedPreviousHash = entry.currentHash;
  }

  return { valid: true, brokenAtSequence: null, totalEntries: entries.length };
}
