import { bootstrap, DEFAULT_SEED, type BootstrapResult } from "./stats/bootstrap";

/**
 * Hold-out metrics from per-day sums (scripts/rigour.py), with confidence intervals from a
 * cluster bootstrap that resamples whole days: trips on the same day share weather, traffic
 * and events, so treating 13 million test trips as independent would overstate precision.
 */

export interface HoldoutDay {
  split: string;
  model: string;
  date: string;
  trips: number;
  sum_err: number;
  sum_sq_err: number;
  sum_abs_err: number;
  sum_y: number;
  sum_y2: number;
}

export interface Metrics {
  trips: number;
  rmse: number;
  mae: number;
  r2: number;
  bias: number;
}

/** Weighted metrics over days (weights = how often each day appears in a resample). */
export function metricsFromDays(days: readonly HoldoutDay[], w?: Float64Array): Metrics {
  let n = 0;
  let se = 0;
  let se2 = 0;
  let sae = 0;
  let sy = 0;
  let sy2 = 0;
  days.forEach((d, i) => {
    const k = w ? w[i] : 1;
    if (!k) return;
    n += k * d.trips;
    se += k * d.sum_err;
    se2 += k * d.sum_sq_err;
    sae += k * d.sum_abs_err;
    sy += k * d.sum_y;
    sy2 += k * d.sum_y2;
  });
  const sst = sy2 - (sy * sy) / n;
  return { trips: n, rmse: Math.sqrt(se2 / n), mae: sae / n, r2: 1 - se2 / sst, bias: se / n };
}

export interface ModelRow {
  model: string;
  days: number;
  trips: number;
  rmse: BootstrapResult;
  mae: BootstrapResult;
  r2: BootstrapResult;
  /** this model minus the reference model on the same resampled days (negative = better) */
  dRmse: BootstrapResult | null;
  dMae: BootstrapResult | null;
}

/**
 * Metrics with day-bootstrap 95% intervals for every model of one split, plus paired
 * differences against `reference`. Every statistic uses the same seed, so all of them see
 * exactly the same resampled days.
 */
export function holdoutTable(
  rows: readonly HoldoutDay[],
  split: string,
  reference: string,
  { B = 2000, seed = DEFAULT_SEED }: { B?: number; seed?: number } = {},
): ModelRow[] {
  const inSplit = rows.filter((r) => r.split === split);
  const dates = [...new Set(inSplit.map((r) => r.date))].sort();
  const models = [...new Set(inSplit.map((r) => r.model))];
  const aligned = new Map<string, HoldoutDay[]>();
  for (const m of models) {
    const byDate = new Map(inSplit.filter((r) => r.model === m).map((r) => [r.date, r]));
    aligned.set(
      m,
      dates.map((d) => {
        const r = byDate.get(d);
        if (!r) throw new Error(`model ${m} has no row for ${d}`);
        return r;
      }),
    );
  }
  const opts = { B, seed };
  const ref = aligned.get(reference);
  return models.map((m) => {
    const days = aligned.get(m)!;
    const stat = (key: keyof Metrics) => bootstrap(dates.length, (w) => metricsFromDays(days, w)[key], opts);
    const diff = (key: "rmse" | "mae") =>
      ref && m !== reference
        ? bootstrap(dates.length, (w) => metricsFromDays(days, w)[key] - metricsFromDays(ref, w)[key], opts)
        : null;
    return {
      model: m,
      days: dates.length,
      trips: metricsFromDays(days).trips,
      rmse: stat("rmse"),
      mae: stat("mae"),
      r2: stat("r2"),
      dRmse: diff("rmse"),
      dMae: diff("mae"),
    };
  });
}
