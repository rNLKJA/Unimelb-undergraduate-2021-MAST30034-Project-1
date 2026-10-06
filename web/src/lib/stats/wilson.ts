import { normalQuantile } from "./distributions";

export interface Interval {
  estimate: number;
  lower: number;
  upper: number;
}

/**
 * Wilson score interval for a binomial proportion (no continuity correction).
 * Matches statsmodels `proportion_confint(method="wilson")` and R `prop.test(correct = FALSE)`.
 */
export function wilsonInterval(successes: number, n: number, confidence = 0.95): Interval {
  if (n <= 0) return { estimate: NaN, lower: 0, upper: 1 };
  if (successes < 0 || successes > n) throw new RangeError("successes must lie in [0, n]");
  const z = normalQuantile(1 - (1 - confidence) / 2);
  const p = successes / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const centre = (p + z2 / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom;
  return { estimate: p, lower: Math.max(0, centre - half), upper: Math.min(1, centre + half) };
}
