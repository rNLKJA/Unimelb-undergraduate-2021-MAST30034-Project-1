/** Descriptive statistics (sample versions, n - 1 denominators). */

export function sum(xs: readonly number[]): number {
  // Neumaier compensated summation keeps long sums of mixed-magnitude values exact enough
  let s = 0;
  let c = 0;
  for (const x of xs) {
    const t = s + x;
    c += Math.abs(s) >= Math.abs(x) ? s - t + x : x - t + s;
    s = t;
  }
  return s + c;
}

export function mean(xs: readonly number[]): number {
  return xs.length ? sum(xs) / xs.length : NaN;
}

/** Sample variance (n - 1). */
export function variance(xs: readonly number[]): number {
  const n = xs.length;
  if (n < 2) return NaN;
  const m = mean(xs);
  return sum(xs.map((x) => (x - m) ** 2)) / (n - 1);
}

export function sd(xs: readonly number[]): number {
  return Math.sqrt(variance(xs));
}
