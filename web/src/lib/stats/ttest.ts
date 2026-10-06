import { mean, variance } from "./descriptive";
import { tQuantile, tTestPValue } from "./distributions";

export interface TTestResult {
  estimate: number;
  t: number;
  df: number;
  p: number;
  lower: number;
  upper: number;
}

/** Welch's two-sample t test of mean(a) - mean(b), as scipy `ttest_ind(equal_var=False)`. */
export function welchTTest(a: readonly number[], b: readonly number[], confidence = 0.95): TTestResult {
  const va = variance(a) / a.length;
  const vb = variance(b) / b.length;
  const se = Math.sqrt(va + vb);
  const df = (va + vb) ** 2 / (va ** 2 / (a.length - 1) + vb ** 2 / (b.length - 1));
  const estimate = mean(a) - mean(b);
  const t = estimate / se;
  const q = tQuantile(1 - (1 - confidence) / 2, df);
  return { estimate, t, df, p: tTestPValue(t, df), lower: estimate - q * se, upper: estimate + q * se };
}

/** One-sample t test of mean(d) = 0, used for paired differences (scipy `ttest_rel`). */
export function pairedTTest(d: readonly number[], confidence = 0.95): TTestResult {
  const n = d.length;
  const se = Math.sqrt(variance(d) / n);
  const estimate = mean(d);
  const t = estimate / se;
  const df = n - 1;
  const q = tQuantile(1 - (1 - confidence) / 2, df);
  return { estimate, t, df, p: tTestPValue(t, df), lower: estimate - q * se, upper: estimate + q * se };
}
