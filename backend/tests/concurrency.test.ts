import { mapWithConcurrency } from "../src/utils/concurrency";

describe("mapWithConcurrency", () => {
  it("returns results in the original order regardless of completion order", async () => {
    const delays = [30, 10, 20, 5, 25];
    const results = await mapWithConcurrency(delays, 3, async (ms, i) => {
      await new Promise((r) => setTimeout(r, ms));
      return i;
    });
    expect(results).toEqual([0, 1, 2, 3, 4]);
  });

  it("never exceeds the concurrency limit", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const items = Array.from({ length: 20 }, (_, i) => i);

    await mapWithConcurrency(items, 4, async (item) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      return item * 2;
    });

    expect(maxInFlight).toBeLessThanOrEqual(4);
  });

  it("processes every item exactly once", async () => {
    const items = Array.from({ length: 50 }, (_, i) => i);
    const seen: number[] = [];
    await mapWithConcurrency(items, 7, async (item) => {
      seen.push(item);
      return item;
    });
    expect(seen.sort((a, b) => a - b)).toEqual(items);
  });

  it("handles an empty array without hanging", async () => {
    const results = await mapWithConcurrency([], 5, async (x) => x);
    expect(results).toEqual([]);
  });

  it("handles limit greater than item count", async () => {
    const results = await mapWithConcurrency([1, 2, 3], 100, async (x) => x * 10);
    expect(results).toEqual([10, 20, 30]);
  });

  it("propagates a rejection from any single call", async () => {
    await expect(
      mapWithConcurrency([1, 2, 3], 2, async (x) => {
        if (x === 2) throw new Error("boom");
        return x;
      })
    ).rejects.toThrow("boom");
  });
});
