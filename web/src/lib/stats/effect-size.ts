import { mean, variance } from "./descriptive";

/** Cohen's d with the pooled standard deviation. */
export function cohensD(a: readonly number[], b: readonly number[]): number {
  const na = a.length;
  const nb = b.length;
  const pooled = ((na - 1) * variance(a) + (nb - 1) * variance(b)) / (na + nb - 2);
  return (mean(a) - mean(b)) / Math.sqrt(pooled);
}

/** Hedges' g: Cohen's d with the small-sample correction J = 1 - 3 / (4(na + nb) - 9). */
export function hedgesG(a: readonly number[], b: readonly number[]): number {
  return cohensD(a, b) * (1 - 3 / (4 * (a.length + b.length) - 9));
}

/** Standardised mean of paired differences, d_z = mean(d) / sd(d). */
export function pairedDz(d: readonly number[]): number {
  return mean(d) / Math.sqrt(variance(d));
}
