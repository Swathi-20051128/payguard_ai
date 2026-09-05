import { AuditEventData, ChainEntry, computeHash, GENESIS_HASH, verifyChain } from "../src/services/audit/hashChain";

function event(overrides: Partial<AuditEventData> = {}): AuditEventData {
  return {
    userId: "user1",
    action: "CASE_CREATED",
    entityType: "CASE",
    entityId: "case1",
    ...overrides,
  };
}

describe("computeHash", () => {
  it("is deterministic for the same inputs", () => {
    const e = event();
    const ts = "2026-01-01T00:00:00.000Z";
    expect(computeHash(GENESIS_HASH, e, ts)).toBe(computeHash(GENESIS_HASH, e, ts));
  });

  it("produces a different hash when previousHash changes", () => {
    const e = event();
    const ts = "2026-01-01T00:00:00.000Z";
    const h1 = computeHash(GENESIS_HASH, e, ts);
    const h2 = computeHash("a".repeat(64), e, ts);
    expect(h1).not.toBe(h2);
  });

  it("produces a different hash when any event field changes", () => {
    const ts = "2026-01-01T00:00:00.000Z";
    const h1 = computeHash(GENESIS_HASH, event({ reason: "A" }), ts);
    const h2 = computeHash(GENESIS_HASH, event({ reason: "B" }), ts);
    expect(h1).not.toBe(h2);
  });

  it("produces a different hash when the timestamp changes", () => {
    const e = event();
    const h1 = computeHash(GENESIS_HASH, e, "2026-01-01T00:00:00.000Z");
    const h2 = computeHash(GENESIS_HASH, e, "2026-01-01T00:00:01.000Z");
    expect(h1).not.toBe(h2);
  });

  it("is insensitive to key order (canonical serialization)", () => {
    const ts = "2026-01-01T00:00:00.000Z";
    const a: AuditEventData = { userId: "u1", action: "X", entityType: "CASE", entityId: "c1" };
    const b: AuditEventData = { entityId: "c1", entityType: "CASE", action: "X", userId: "u1" };
    expect(computeHash(GENESIS_HASH, a, ts)).toBe(computeHash(GENESIS_HASH, b, ts));
  });

  it("returns a 64-character hex string (SHA-256)", () => {
    const hash = computeHash(GENESIS_HASH, event(), "2026-01-01T00:00:00.000Z");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("verifyChain", () => {
  function buildValidChain(length: number): ChainEntry[] {
    const entries: ChainEntry[] = [];
    let previousHash = GENESIS_HASH;
    for (let i = 0; i < length; i++) {
      const createdAt = new Date(2026, 0, 1, 0, 0, i);
      const e = event({ entityId: `case${i}` });
      const currentHash = computeHash(previousHash, e, createdAt.toISOString());
      entries.push({ sequence: i, previousHash, currentHash, createdAt, event: e });
      previousHash = currentHash;
    }
    return entries;
  }

  it("validates an untampered chain", () => {
    const result = verifyChain(buildValidChain(5));
    expect(result.valid).toBe(true);
    expect(result.brokenAtSequence).toBeNull();
    expect(result.totalEntries).toBe(5);
  });

  it("validates an empty chain trivially", () => {
    expect(verifyChain([])).toEqual({ valid: true, brokenAtSequence: null, totalEntries: 0 });
  });

  it("detects tampering with an event's data after the fact", () => {
    const chain = buildValidChain(5);
    chain[2].event = { ...chain[2].event, reason: "tampered!" };
    const result = verifyChain(chain);
    expect(result.valid).toBe(false);
    expect(result.brokenAtSequence).toBe(2);
  });

  it("detects a broken previousHash link (e.g. a deleted middle entry)", () => {
    const chain = buildValidChain(5);
    chain.splice(2, 1); // remove entry at sequence 2 — breaks the link at sequence 3
    const result = verifyChain(chain);
    expect(result.valid).toBe(false);
    expect(result.brokenAtSequence).toBe(3);
  });

  it("detects a currentHash that was directly overwritten", () => {
    const chain = buildValidChain(3);
    chain[1].currentHash = "f".repeat(64);
    const result = verifyChain(chain);
    expect(result.valid).toBe(false);
    expect(result.brokenAtSequence).toBe(1);
  });

  it("detects the first entry not starting from the genesis hash", () => {
    const chain = buildValidChain(3);
    chain[0].previousHash = "1".repeat(64);
    const result = verifyChain(chain);
    expect(result.valid).toBe(false);
    expect(result.brokenAtSequence).toBe(0);
  });
});
