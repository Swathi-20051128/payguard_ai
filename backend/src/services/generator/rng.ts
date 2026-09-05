/**
 * Mulberry32 — a small, fast, seedable PRNG. Using a seeded generator
 * (rather than bare Math.random) makes sample-data generation
 * reproducible, which matters for demoability ("run it again, get a
 * comparable dataset") and for unit-testing the generator itself.
 */
export function createRng(seed: number) {
  let a = seed >>> 0;
  return function rng(): number {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type Rng = () => number;

export function randInt(rng: Rng, min: number, max: number): number {
  return Math.floor(rng() * (max - min + 1)) + min;
}

export function randFloat(rng: Rng, min: number, max: number): number {
  return rng() * (max - min) + min;
}

export function pick<T>(rng: Rng, arr: readonly T[]): T {
  return arr[randInt(rng, 0, arr.length - 1)];
}

export function pickN<T>(rng: Rng, arr: readonly T[], n: number): T[] {
  const pool = [...arr];
  const out: T[] = [];
  for (let i = 0; i < n && pool.length > 0; i++) {
    const idx = randInt(rng, 0, pool.length - 1);
    out.push(pool[idx]);
    pool.splice(idx, 1);
  }
  return out;
}

/** Approximate log-normal draw — good fit for transaction amount distributions. */
export function randLogNormal(rng: Rng, medianValue: number, spread: number): number {
  // Box-Muller for a standard normal, scaled into log-space around the median.
  const u1 = Math.max(rng(), 1e-9);
  const u2 = rng();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return Math.round(medianValue * Math.exp(z * spread) * 100) / 100;
}

export function chance(rng: Rng, probability: number): boolean {
  return rng() < probability;
}
