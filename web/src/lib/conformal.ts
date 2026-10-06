/**
 * Split-conformal prediction intervals for the estimator (table built by
 * scripts/build_evidence_tables.py from scripts/out/rigour.json).
 */

export interface ConformalBorough {
  borough: string;
  /** interior bin edges on the predicted duration, ascending */
  edges: number[];
  /** [lower, upper] residual offsets per bin */
  offsets: [number, number][];
  nCal: number[];
  test: { trips: number; covered: number } | null;
}

export interface ConformalLevel {
  level: number;
  boroughs: ConformalBorough[];
  test: { trips: number; covered: number; meanWidth: number };
  globalHalfWidth: number;
  globalTest: { trips: number; covered: number; meanWidth: number };
}

export interface ConformalTable {
  description: string;
  calibrationTrips: number;
  testTrips: number;
  levels: ConformalLevel[];
}

/** Index of the bin holding `x`: the number of edges <= x (numpy searchsorted, side="right"). */
export function binOf(edges: readonly number[], x: number): number {
  let lo = 0;
  let hi = edges.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (edges[mid] <= x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export interface PredictionInterval {
  lower: number;
  upper: number;
  /** lower end before clipping at zero (trip times are positive) */
  rawLower: number;
  bin: number;
  bins: number;
  nCal: number;
  borough: string;
  test: { trips: number; covered: number } | null;
}

/**
 * Interval for a prediction `yhat` of a trip picked up in `borough`. Boroughs without
 * their own calibration data use Manhattan's bins (the estimator labels this).
 */
export function predictionInterval(
  table: ConformalTable,
  level: number,
  borough: string,
  yhat: number,
): PredictionInterval | null {
  const lv = table.levels.find((l) => Math.abs(l.level - level) < 1e-9);
  if (!lv) return null;
  const b =
    lv.boroughs.find((x) => x.borough === borough) ?? lv.boroughs.find((x) => x.borough === "Manhattan");
  if (!b) return null;
  const i = binOf(b.edges, yhat);
  const [lo, hi] = b.offsets[i];
  return {
    lower: Math.max(0, yhat + lo),
    upper: yhat + hi,
    rawLower: yhat + lo,
    bin: i,
    bins: b.offsets.length,
    nCal: b.nCal[i],
    borough: b.borough,
    test: b.test,
  };
}
