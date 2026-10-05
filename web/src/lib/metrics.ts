/**
 * Regression metrics as Spark's RegressionEvaluator computes them (cells 293, 296):
 *  r2   = 1 - SSE / SST, SST around the evaluation set's own mean
 *  rmse = sqrt(SSE / n)
 */

export function mean(xs: readonly number[]): number {
  if (!xs.length) return Number.NaN;
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}

/** Sample standard deviation (n - 1), as Spark's summary() and describe(). */
export function sampleStd(xs: readonly number[]): number {
  if (xs.length < 2) return Number.NaN;
  const m = mean(xs);
  let s = 0;
  for (const x of xs) s += (x - m) ** 2;
  return Math.sqrt(s / (xs.length - 1));
}

export function sse(yTrue: readonly number[], yPred: readonly number[]): number {
  if (yTrue.length !== yPred.length) throw new Error("length mismatch");
  let s = 0;
  for (let i = 0; i < yTrue.length; i++) s += (yTrue[i] - yPred[i]) ** 2;
  return s;
}

export function rmse(yTrue: readonly number[], yPred: readonly number[]): number {
  return Math.sqrt(sse(yTrue, yPred) / yTrue.length);
}

export function r2(yTrue: readonly number[], yPred: readonly number[]): number {
  const m = mean(yTrue);
  let sst = 0;
  for (const y of yTrue) sst += (y - m) ** 2;
  return 1 - sse(yTrue, yPred) / sst;
}

/** Sufficient statistics of a data set for a linear model y ~ a + b.x. */
export interface SufficientStats {
  n: number;
  sy: number;
  syy: number;
  sx: number[];
  sxy: number[];
  /** X'X, row-major */
  G: number[][];
}

/** R^2 and RMSE of (intercept, beta) from sufficient statistics (port of scripts/fit_model.py:score). */
export function scoreFromStats(
  s: SufficientStats,
  beta: readonly number[],
  intercept: number,
): { r2: number; rmse: number } {
  const p = beta.length;
  let bSxy = 0;
  let bSx = 0;
  let bGb = 0;
  for (let i = 0; i < p; i++) {
    bSxy += beta[i] * s.sxy[i];
    bSx += beta[i] * s.sx[i];
    let row = 0;
    for (let j = 0; j < p; j++) row += s.G[i][j] * beta[j];
    bGb += beta[i] * row;
  }
  const sseV = s.syy - 2 * intercept * s.sy - 2 * bSxy + s.n * intercept ** 2 + 2 * intercept * bSx + bGb;
  const sst = s.syy - (s.sy * s.sy) / s.n;
  return { r2: 1 - sseV / sst, rmse: Math.sqrt(sseV / s.n) };
}

/** Pearson correlation of paired values (pairs with a non-finite member are skipped). */
export function pearson(xs: readonly (number | null)[], ys: readonly (number | null)[]): number {
  const px: number[] = [];
  const py: number[] = [];
  for (let i = 0; i < Math.min(xs.length, ys.length); i++) {
    const x = xs[i];
    const y = ys[i];
    if (typeof x === "number" && typeof y === "number" && Number.isFinite(x) && Number.isFinite(y)) {
      px.push(x);
      py.push(y);
    }
  }
  if (px.length < 3) return Number.NaN;
  const mx = mean(px);
  const my = mean(py);
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < px.length; i++) {
    sxy += (px[i] - mx) * (py[i] - my);
    sxx += (px[i] - mx) ** 2;
    syy += (py[i] - my) ** 2;
  }
  return sxy / Math.sqrt(sxx * syy);
}

/** Ordinary least-squares line y = a + b x through paired values. */
export function olsLine(xs: readonly number[], ys: readonly number[]): { a: number; b: number } {
  const mx = mean(xs);
  const my = mean(ys);
  let sxy = 0;
  let sxx = 0;
  for (let i = 0; i < xs.length; i++) {
    sxy += (xs[i] - mx) * (ys[i] - my);
    sxx += (xs[i] - mx) ** 2;
  }
  const b = sxx === 0 ? 0 : sxy / sxx;
  return { a: my - b * mx, b };
}
