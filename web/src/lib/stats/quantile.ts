/**
 * Quantiles. `quantile` is the linear interpolation rule (Hyndman and Fan type 7), the
 * default in numpy, R and Excel. The conformal helpers use the finite-sample order
 * statistics of split-conformal prediction (Vovk et al.; Lei et al. 2018).
 */

function sorted(xs: readonly number[]): number[] {
  return [...xs].sort((a, b) => a - b);
}

/** Type-7 quantile of xs at probability p. */
export function quantile(xs: readonly number[], p: number): number {
  if (!xs.length) return NaN;
  if (!(p >= 0 && p <= 1)) throw new RangeError("p must lie in [0, 1]");
  const s = sorted(xs);
  const h = (s.length - 1) * p;
  const lo = Math.floor(h);
  const hi = Math.ceil(h);
  return s[lo] + (h - lo) * (s[hi] - s[lo]);
}

export function median(xs: readonly number[]): number {
  return quantile(xs, 0.5);
}

/**
 * Split-conformal quantile of nonconformity scores: the ceil((n + 1)(1 - alpha))-th smallest.
 * Returns Infinity when the calibration set is too small for the requested level.
 */
export function conformalQuantile(scores: readonly number[], alpha: number): number {
  const n = scores.length;
  const k = Math.ceil((n + 1) * (1 - alpha));
  if (k > n) return Infinity;
  return sorted(scores)[k - 1];
}

/**
 * Asymmetric split-conformal offsets from signed residuals r = y - yhat, alpha / 2 in each
 * tail: the interval is [yhat + lower, yhat + upper]. Coverage is at least 1 - alpha.
 */
export function conformalOffsets(
  residuals: readonly number[],
  alpha: number,
): { lower: number; upper: number } {
  const n = residuals.length;
  const s = sorted(residuals);
  const kLo = Math.floor((n + 1) * (alpha / 2));
  const kHi = Math.ceil((n + 1) * (1 - alpha / 2));
  return {
    lower: kLo >= 1 ? s[kLo - 1] : -Infinity,
    upper: kHi <= n ? s[kHi - 1] : Infinity,
  };
}
