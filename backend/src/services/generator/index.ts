import { GenerateSampleInput } from "../../validation/transactionSchemas";
import { buildEntityPools } from "./entityPools";
import { FRAUD_SCENARIOS, generateScenarioCluster } from "./fraudScenarios";
import { generateNormalTransaction, resetIdCounter } from "./normalTransactions";
import { createRng, randInt } from "./rng";
import { GeneratedRow } from "./types";

export interface GeneratedDataset {
  rows: GeneratedRow[];
  scenarioCounts: Record<string, number>;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const LOOKBACK_DAYS = 21;

/**
 * Generates a full synthetic dataset: entity pools, a majority of
 * ordinary transactions, and a target percentage of suspicious
 * transactions distributed across all 10 fraud scenarios from the
 * spec (card testing, velocity abuse, duplicate payment, account
 * takeover, refund abuse, merchant spike, location anomaly,
 * coordinated activity, high-value anomaly, repeated failure→success).
 *
 * `seed` makes the entity pools, scenario mix, and per-cluster
 * structure reproducible for a given run. Note that transaction
 * timestamps are anchored to the real invocation time (a recent
 * rolling window ending "now"), so two runs with the same seed
 * produce the same shape of dataset but not byte-identical
 * timestamps unless called at the exact same moment.
 */
export function generateDataset(input: GenerateSampleInput, seed: number = Date.now()): GeneratedDataset {
  resetIdCounter();
  const rng = createRng(seed);
  const pools = buildEntityPools(rng, input);

  const now = Date.now();
  const randomTimestamp = () => new Date(now - randInt(rng, 0, LOOKBACK_DAYS * DAY_MS));

  const targetSuspicious = Math.round(input.transactionCount * input.suspiciousRate);
  const suspiciousRows: GeneratedRow[] = [];

  let scenarioIdx = 0;
  let safetyIterations = 0;
  const maxIterations = FRAUD_SCENARIOS.length * 50; // generous — prevents any pathological infinite loop

  while (suspiciousRows.length < targetSuspicious && suspiciousRows.length < input.transactionCount && safetyIterations < maxIterations) {
    const scenario = FRAUD_SCENARIOS[scenarioIdx % FRAUD_SCENARIOS.length];
    scenarioIdx += 1;
    safetyIterations += 1;
    const cluster = generateScenarioCluster(scenario, rng, pools, randomTimestamp());
    suspiciousRows.push(...cluster);
  }

  // Defense in depth: even with the per-scenario cap in
  // fraudScenarios.ts, never trust a single generator to keep the
  // total within budget — truncate here so the caller's requested
  // transactionCount is a hard ceiling, not a rough target.
  if (suspiciousRows.length > input.transactionCount) {
    suspiciousRows.length = input.transactionCount;
  }

  const normalCount = Math.max(0, input.transactionCount - suspiciousRows.length);
  const normalRows: GeneratedRow[] = Array.from({ length: normalCount }, () =>
    generateNormalTransaction(rng, pools, randomTimestamp())
  );

  const rows = shuffle(rng, [...normalRows, ...suspiciousRows]);

  // Computed from the final (possibly truncated) row set rather than
  // accumulated during generation, so it's always accurate even if
  // truncation cut part of the last cluster.
  const scenarioCounts: Record<string, number> = {};
  for (const row of rows) {
    if (row.fraudScenario) {
      scenarioCounts[row.fraudScenario] = (scenarioCounts[row.fraudScenario] || 0) + 1;
    }
  }

  return { rows, scenarioCounts };
}

function shuffle<T>(rng: () => number, arr: T[]): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
