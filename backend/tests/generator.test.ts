import { generateDataset } from "../src/services/generator";
import { FRAUD_SCENARIOS } from "../src/services/generator/fraudScenarios";
import { generateSampleSchema, transactionRowSchema } from "../src/validation/transactionSchemas";

describe("sample data generator", () => {
  const input = generateSampleSchema.parse({
    transactionCount: 1000,
    customerCount: 80,
    merchantCount: 10,
    deviceCount: 150,
    cardTokenCount: 200,
    ipHashCount: 150,
    suspiciousRate: 0.1,
  });

  it("generates exactly the requested number of transactions", () => {
    const { rows } = generateDataset(input, 1);
    expect(rows.length).toBe(input.transactionCount);
  });

  it("generates unique transactionIds", () => {
    const { rows } = generateDataset(input, 2);
    const ids = new Set(rows.map((r) => r.transactionId));
    expect(ids.size).toBe(rows.length);
  });

  it("hits the target suspicious rate closely", () => {
    const { rows } = generateDataset(input, 3);
    const suspiciousCount = rows.filter((r) => r.fraudScenario).length;
    const rate = suspiciousCount / rows.length;
    // The loop stops as soon as it reaches/exceeds the target, so the
    // actual rate can overshoot slightly but never undershoot.
    expect(rate).toBeGreaterThanOrEqual(input.suspiciousRate - 0.001);
    expect(rate).toBeLessThan(input.suspiciousRate + 0.05);
  });

  it("produces rows that all pass the real ingestion validation schema", () => {
    const { rows } = generateDataset(input, 4);
    const invalid = rows.filter((r) => !transactionRowSchema.safeParse(r).success);
    expect(invalid).toHaveLength(0);
  });

  it("never generates a cardToken shaped like a real card number", () => {
    const { rows } = generateDataset(input, 5);
    const realLooking = rows.filter((r) => r.cardToken && /^\d{12,19}$/.test(r.cardToken));
    expect(realLooking).toHaveLength(0);
  });

  it("covers all 10 fraud scenarios given enough transactions", () => {
    const bigInput = generateSampleSchema.parse({ ...input, transactionCount: 5000, suspiciousRate: 0.15 });
    const { scenarioCounts } = generateDataset(bigInput, 6);
    for (const scenario of FRAUD_SCENARIOS) {
      expect(scenarioCounts[scenario]).toBeGreaterThan(0);
    }
  });

  it("gives normal transactions a groundTruthRisk of 0 and no fraudScenario", () => {
    const { rows } = generateDataset(input, 7);
    const normalRows = rows.filter((r) => !r.fraudScenario);
    expect(normalRows.length).toBeGreaterThan(0);
    for (const r of normalRows) {
      expect(r.groundTruthRisk).toBe(0);
    }
  });

  it("never overshoots the requested count, even when a merchant-spike cluster could otherwise dominate", () => {
    // Regression test: with a small transactionCount, high
    // suspiciousRate, and many merchants (increasing the odds of
    // hitting a high-baseline merchant), a single MERCHANT_SPIKE
    // cluster used to be able to generate hundreds of rows on its
    // own and blow past the requested total (e.g. 542 rows for a
    // request of 150). Swept across many seeds to catch it reliably.
    const smallInput = generateSampleSchema.parse({
      transactionCount: 150,
      customerCount: 500,
      merchantCount: 50,
      deviceCount: 1000,
      cardTokenCount: 1500,
      ipHashCount: 1000,
      suspiciousRate: 0.5,
    });

    for (let seed = 1; seed <= 200; seed++) {
      const { rows } = generateDataset(smallInput, seed);
      expect(rows.length).toBe(smallInput.transactionCount);
    }
  });

  it("is reproducible in structure (minus wall-clock timestamps) for the same seed", () => {
    const a = generateDataset(input, 42);
    const b = generateDataset(input, 42);
    const strip = (rows: typeof a.rows) => rows.map(({ timestamp, ...rest }) => rest);
    expect(strip(a.rows)).toEqual(strip(b.rows));
    expect(a.scenarioCounts).toEqual(b.scenarioCounts);
  });
});
