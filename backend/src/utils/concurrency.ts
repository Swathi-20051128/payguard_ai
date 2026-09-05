/**
 * Runs `fn` over `items` with at most `limit` calls in flight at
 * once. Used by the risk-analysis batch runner so scoring a 10,000-
 * row upload doesn't fire 10,000 concurrent Mongo queries, but also
 * doesn't run them one at a time (which would be needlessly slow
 * for I/O-bound work).
 *
 * No external dependency (like p-limit) needed for something this
 * small — plain worker-pool pattern.
 */
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const current = nextIndex;
      nextIndex += 1;
      results[current] = await fn(items[current], current);
    }
  }

  const workerCount = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  return results;
}
