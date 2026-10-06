/**
 * Split-conformal prediction intervals for the estimator (table built by
 * scripts/build_evidence_tables.py from scripts/out/rigour.json).
 */

/**
 * Empirical coverage on held-out trips. ciLow / ciHigh: 95% interval from a bootstrap that
 * resamples whole test days (trips on the same day are not independent).
 */
export interface CoverageTest {
  trips: number;
  covered: number;
  ciLow: number;
  ciHigh: number;
}

export interface ConformalBorough {
  borough: string;
  /** interior bin edges on the predicted duration, ascending */
  edges: number[];
  /** [lower, upper] residual offsets per bin */
  offsets: [number, number][];
  nCal: number[];
  /** coverage of the borough's test trips, all bins together */
  test: CoverageTest | null;
  /** coverage of the borough's test trips in each bin */
  binTest: (CoverageTest | null)[];
}

export interface ConformalLevel {
  level: number;
  boroughs: ConformalBorough[];
  test: CoverageTest & { meanWidth: number };
  globalHalfWidth: number;
  globalTest: CoverageTest & { meanWidth: number };
}

export interface ConformalTable {
  description: string;
  calibrationTrips: number;
  testTrips: number;
  testDays: number;
  bootstrap: { unit: string; B: number; seed: number; confidence: number };
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
  /** coverage on held-out trips of the same borough and bin */
  test: CoverageTest | null;
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
    test: b.binTest[i] ?? null,
  };
}
