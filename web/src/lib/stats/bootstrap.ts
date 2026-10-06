import { quantile } from "./quantile";
import { mulberry32, randomInt } from "./rng";
import type { Interval } from "./wilson";

export interface BootstrapOptions {
  /** number of resamples */
  B?: number;
  seed?: number;
  confidence?: number;
}

export interface BootstrapResult extends Interval {
  B: number;
  seed: number;
  confidence: number;
  /** bootstrap standard error (sd of the replicates) */
  se: number;
}

export const DEFAULT_SEED = 20190101;

function summarise(
  estimate: number,
  reps: number[],
  B: number,
  seed: number,
  confidence: number,
): BootstrapResult {
  const ok = reps.filter(Number.isFinite);
  const a = (1 - confidence) / 2;
  const m = ok.reduce((s, x) => s + x, 0) / ok.length;
  const se = Math.sqrt(ok.reduce((s, x) => s + (x - m) ** 2, 0) / Math.max(1, ok.length - 1));
  return { estimate, lower: quantile(ok, a), upper: quantile(ok, 1 - a), B, seed, confidence, se };
}

/**
 * Percentile bootstrap for a statistic of n units. `statistic` receives the multiplicity of
 * each unit in the resample (weights summing to n), which keeps cluster bootstraps cheap:
 * resampling days and passing per-day weights to sums of per-day totals.
 */
export function bootstrap(
  n: number,
  statistic: (weights: Float64Array) => number,
  { B = 2000, seed = DEFAULT_SEED, confidence = 0.95 }: BootstrapOptions = {},
): BootstrapResult {
  const ones = new Float64Array(n).fill(1);
  const estimate = statistic(ones);
  const rng = mulberry32(seed);
  const reps: number[] = [];
  const w = new Float64Array(n);
  for (let b = 0; b < B; b++) {
    w.fill(0);
    for (let i = 0; i < n; i++) w[randomInt(rng, n)] += 1;
    reps.push(statistic(w));
  }
  return summarise(estimate, reps, B, seed, confidence);
}

/**
 * Two independent groups, resampled separately (stratified bootstrap), for a statistic of
 * both groups such as a difference in means.
 */
export function bootstrapTwoSample(
  a: readonly number[],
  b: readonly number[],
  statistic: (a: readonly number[], b: readonly number[]) => number,
  { B = 2000, seed = DEFAULT_SEED, confidence = 0.95 }: BootstrapOptions = {},
): BootstrapResult {
  const estimate = statistic(a, b);
  const rng = mulberry32(seed);
  const reps: number[] = [];
  const ra = new Array<number>(a.length);
  const rb = new Array<number>(b.length);
  for (let i = 0; i < B; i++) {
    for (let j = 0; j < a.length; j++) ra[j] = a[randomInt(rng, a.length)];
    for (let j = 0; j < b.length; j++) rb[j] = b[randomInt(rng, b.length)];
    reps.push(statistic(ra, rb));
  }
  return summarise(estimate, reps, B, seed, confidence);
}

/** Bootstrap of the mean of paired differences (resampling pairs). */
export function bootstrapMean(xs: readonly number[], options: BootstrapOptions = {}): BootstrapResult {
  return bootstrap(
    xs.length,
    (w) => {
      let s = 0;
      let n = 0;
      for (let i = 0; i < xs.length; i++) {
        s += w[i] * xs[i];
        n += w[i];
      }
      return s / n;
    },
    options,
  );
}
