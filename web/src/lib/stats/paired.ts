import { binomialTestTwoSided } from "./distributions";

/**
 * Exact McNemar test for two classifiers scored on the same items: only the discordant pairs
 * matter (b = A right and B wrong, c = A wrong and B right), and under H0 b ~ Bin(b + c, 1/2).
 */
export function mcnemarExact(b: number, c: number): number {
  return binomialTestTwoSided(b, b + c, 0.5);
}

/** Exact sign test of paired differences (zeros dropped). */
export function signTest(diffs: readonly number[]): { positive: number; negative: number; p: number } {
  const positive = diffs.filter((d) => d > 0).length;
  const negative = diffs.filter((d) => d < 0).length;
  return { positive, negative, p: binomialTestTwoSided(positive, positive + negative, 0.5) };
}
