import { tQuantile, tTestPValue } from "./distributions";

/**
 * Ordinary least squares with classical and heteroskedasticity-consistent standard errors
 * (White's HC0, the n / (n - p) scaled HC1, and MacKinnon and White's HC3, which divides each
 * squared residual by (1 - h_ii)^2). Verified against statsmodels in ols.test.ts.
 *
 * Small dense problems only (hundreds of rows, tens of columns): the website runs it on
 * day-level data. The 75-million-row trip regression is fitted in scripts/rigour.py.
 */

export type CovarianceKind = "classical" | "hc0" | "hc1" | "hc3";

export interface OlsFit {
  names: string[];
  n: number;
  p: number;
  df: number;
  beta: number[];
  fitted: number[];
  residuals: number[];
  leverage: number[];
  r2: number;
  sigma: number;
  /** covariance matrices of beta */
  cov: Record<CovarianceKind, number[][]>;
}

/** Inverse of a symmetric positive-definite matrix by Gauss-Jordan elimination with partial pivoting. */
export function invert(m: readonly (readonly number[])[]): number[][] {
  const n = m.length;
  // equilibrate: invert D M D, then rescale, so columns on very different scales stay accurate
  const d = m.map((row, i) => 1 / Math.sqrt(Math.abs(row[i]) || 1));
  const a = m.map((row, i) => [
    ...row.map((v, j) => v * d[i] * d[j]),
    ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)),
  ]);
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(a[r][c]) > Math.abs(a[piv][c])) piv = r;
    if (Math.abs(a[piv][c]) < 1e-12) throw new Error("singular design matrix (collinear columns)");
    [a[c], a[piv]] = [a[piv], a[c]];
    const pv = a[c][c];
    for (let j = 0; j < 2 * n; j++) a[c][j] /= pv;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = a[r][c];
      if (f === 0) continue;
      for (let j = 0; j < 2 * n; j++) a[r][j] -= f * a[c][j];
    }
  }
  return a.map((row, i) => row.slice(n).map((v, j) => v * d[i] * d[j]));
}

function sandwich(A: number[][], X: readonly (readonly number[])[], w: readonly number[]): number[][] {
  const p = A.length;
  const meat = Array.from({ length: p }, () => new Array<number>(p).fill(0));
  X.forEach((x, i) => {
    for (let a = 0; a < p; a++) {
      const xa = x[a] * w[i];
      if (xa === 0) continue;
      for (let b = 0; b < p; b++) meat[a][b] += xa * x[b];
    }
  });
  const AM = A.map((row) => meat[0].map((_, j) => row.reduce((s, v, k) => s + v * meat[k][j], 0)));
  return AM.map((row) => A[0].map((_, j) => row.reduce((s, v, k) => s + v * A[k][j], 0)));
}

export function ols(X: readonly (readonly number[])[], y: readonly number[], names?: string[]): OlsFit {
  const n = X.length;
  const p = X[0]?.length ?? 0;
  if (n !== y.length) throw new Error("X and y have different numbers of rows");
  if (n <= p) throw new Error("need more rows than columns");
  const XtX = Array.from({ length: p }, () => new Array<number>(p).fill(0));
  const Xty = new Array<number>(p).fill(0);
  X.forEach((x, i) => {
    for (let a = 0; a < p; a++) {
      Xty[a] += x[a] * y[i];
      for (let b = 0; b < p; b++) XtX[a][b] += x[a] * x[b];
    }
  });
  const A = invert(XtX);
  const beta = A.map((row) => row.reduce((s, v, k) => s + v * Xty[k], 0));
  const fitted = X.map((x) => x.reduce((s, v, k) => s + v * beta[k], 0));
  const residuals = y.map((v, i) => v - fitted[i]);
  const leverage = X.map((x) => {
    let h = 0;
    for (let a = 0; a < p; a++) for (let b = 0; b < p; b++) h += x[a] * A[a][b] * x[b];
    return h;
  });
  const sse = residuals.reduce((s, e) => s + e * e, 0);
  const ybar = y.reduce((s, v) => s + v, 0) / n;
  const sst = y.reduce((s, v) => s + (v - ybar) ** 2, 0);
  const df = n - p;
  const s2 = sse / df;
  const e2 = residuals.map((e) => e * e);
  const hc0 = sandwich(A, X, e2);
  return {
    names: names ?? beta.map((_, j) => `x${j}`),
    n,
    p,
    df,
    beta,
    fitted,
    residuals,
    leverage,
    r2: 1 - sse / sst,
    sigma: Math.sqrt(s2),
    cov: {
      classical: A.map((row) => row.map((v) => v * s2)),
      hc0,
      hc1: hc0.map((row) => row.map((v) => (v * n) / df)),
      hc3: sandwich(
        A,
        X,
        e2.map((v, i) => v / (1 - leverage[i]) ** 2),
      ),
    },
  };
}

export interface Coefficient {
  name: string;
  estimate: number;
  se: number;
  t: number;
  p: number;
  lower: number;
  upper: number;
}

/** Coefficient j with a t-based confidence interval (df = n - p) from the chosen covariance. */
export function coefficient(
  fit: OlsFit,
  j: number,
  kind: CovarianceKind = "hc3",
  confidence = 0.95,
): Coefficient {
  const se = Math.sqrt(fit.cov[kind][j][j]);
  const estimate = fit.beta[j];
  const t = estimate / se;
  const q = tQuantile(1 - (1 - confidence) / 2, fit.df);
  return {
    name: fit.names[j],
    estimate,
    se,
    t,
    p: tTestPValue(t, fit.df),
    lower: estimate - q * se,
    upper: estimate + q * se,
  };
}

/** Treatment-coded dummy columns for a categorical variable (the reference level gets none). */
export function dummies<T extends string | number>(
  values: readonly T[],
  levels: readonly T[],
  reference: T,
): { names: string[]; columns: number[][] } {
  const kept = levels.filter((l) => l !== reference);
  return {
    names: kept.map(String),
    columns: values.map((v) => kept.map((l) => (v === l ? 1 : 0))),
  };
}
