import "server-only";

import { cache } from "react";
import { query } from "./db";

export type Side = "pickup" | "dropoff";

export interface Zone {
  location_id: number;
  borough: string;
  zone: string;
  service_zone: string;
  model_zone_name: string | null;
  has_polygon: number;
  centroid_lon: number | null;
  centroid_lat: number | null;
  pickups: number;
  dropoffs: number;
}

export const getZones = cache(() => query<Zone>("SELECT * FROM zones ORDER BY location_id"));

/** Real map zones (1-263); 264/265 are TLC's "unknown" buckets. */
export const getMapZones = cache(async () => (await getZones()).filter((z) => z.has_polygon === 1));

export interface ZoneSlice {
  side: Side;
  isodow: number;
  /** zone ids, in the order of each hour's arrays */
  ids: number[];
  /** trips[hour][i]; hour 24 = the whole day */
  trips: number[][];
  /** median minutes[hour][i] (null when there were no trips); hour 24 = the whole day */
  median: (number | null)[][];
}

/** Trips and median minutes for every zone and hour (0-23, 24 = all day) of one weekday (0 = all days). */
export async function getZoneSlice(side: Side, isodow: number): Promise<ZoneSlice> {
  const rows = await query<{ location_id: number; hour: number; trips: number; median_min: number | null }>(
    "SELECT location_id, hour, trips, median_min FROM zone_hourly WHERE side = ? AND isodow = ?",
    [side, isodow],
  );
  const ids = [...new Set(rows.map((r) => r.location_id))].sort((a, b) => a - b);
  const pos = new Map(ids.map((id, i) => [id, i]));
  const trips = Array.from({ length: 25 }, () => new Array<number>(ids.length).fill(0));
  const median = Array.from({ length: 25 }, () => new Array<number | null>(ids.length).fill(null));
  for (const r of rows) {
    const i = pos.get(r.location_id)!;
    trips[r.hour][i] = r.trips;
    median[r.hour][i] = r.median_min;
  }
  return { side, isodow, ids, trips, median };
}

export const getZoneVendor = cache((side: Side) =>
  query<{ location_id: number; vendor: number; trips: number }>(
    "SELECT location_id, vendor, trips FROM zone_vendor WHERE side = ?",
    [side],
  ),
);

export interface RouteRow {
  pu_id: number;
  do_id: number;
  trips: number;
  median_min: number | null;
  mean_min: number | null;
  mean_miles: number | null;
  mean_fare: number | null;
  mean_mph: number | null;
}

/** Busiest routes leaving (or arriving at) a zone. */
export function getRoutesFor(id: number, direction: "from" | "to", limit = 12) {
  const col = direction === "from" ? "pu_id" : "do_id";
  return query<RouteRow>(`SELECT * FROM routes WHERE ${col} = ? ORDER BY trips DESC LIMIT ?`, [id, limit]);
}

export function getRoute(pu: number, doId: number) {
  return query<RouteRow>("SELECT * FROM routes WHERE pu_id = ? AND do_id = ?", [pu, doId]).then(
    (r) => r[0] ?? null,
  );
}

export function getRouteHourly(pu: number, doId: number) {
  return query<{ hour: number; trips: number; median_min: number | null }>(
    "SELECT hour, trips, median_min FROM route_hourly WHERE pu_id = ? AND do_id = ? ORDER BY hour",
    [pu, doId],
  );
}

export const getTopRoutes = cache((limit = 30) =>
  query<RouteRow>("SELECT * FROM routes ORDER BY trips DESC LIMIT ?", [limit]),
);

export const getBoroughFlows = cache(() =>
  query<{ pickup_borough: string; dropoff_borough: string; trips: number; median_min: number | null }>(
    "SELECT * FROM borough_flows",
  ),
);

export interface DailyRow {
  date: string;
  isodow: number;
  trips: number;
  median_min: number | null;
  mean_min: number | null;
  mean_miles: number | null;
  mean_fare: number | null;
  precipitation: number;
  snow: number;
  snow_depth: number;
  tavg: number;
  tmax: number;
  tmin: number;
  wt01: number;
  wt02: number;
  wt03: number;
  wt06: number;
  wt08: number;
  events: number;
  collisions: number;
}

export const getDaily = cache(() => query<DailyRow>("SELECT * FROM daily ORDER BY date"));

export interface DailyBoroughRow {
  date: string;
  borough: string;
  pickups: number;
  median_min: number | null;
  events: number | null;
  collisions: number;
}

export const getDailyBorough = cache(() =>
  query<DailyBoroughRow>("SELECT * FROM daily_borough ORDER BY date, borough"),
);

export const getWeekdayHourVendor = cache(() =>
  query<{
    vendor: number;
    isodow: number;
    hour: number;
    trips: number;
    mean_min: number;
    median_min: number;
  }>("SELECT * FROM weekday_hour_vendor ORDER BY vendor, isodow, hour"),
);

export interface FunnelRow {
  step: number;
  stage: string;
  label: string;
  rule: string;
  revived_rows: number;
  notebook_rows: number | null;
  difference_pct: number | null;
}

export const getFunnel = cache(() => query<FunnelRow>("SELECT * FROM cleaning_funnel ORDER BY step"));

export interface FoldRow {
  fold: number;
  test_rows: number;
  notebook_r2: number;
  notebook_rmse: number;
  original_on_revived_r2: number;
  original_on_revived_rmse: number;
  refit_r2: number;
  refit_rmse: number;
  refit_nonzero: number;
}

export const getFolds = cache(() => query<FoldRow>("SELECT * FROM model_folds ORDER BY fold"));

export interface CoefRow {
  feature_index: number;
  block: string;
  level: number;
  label: string;
  original_2021: number;
  refit_2026: number;
}

export const getCoefficients = cache(() =>
  query<CoefRow>("SELECT * FROM model_coefficients ORDER BY feature_index"),
);

/** Headline numbers for the landing page. */
export const getHeadline = cache(async () => {
  const funnel = await getFunnel();
  const raw = funnel[0];
  const final = funnel.find((f) => f.label.startsWith("Join collisions"))!;
  const [busiest] = await query<{ zone: string; borough: string; pickups: number }>(
    "SELECT zone, borough, pickups FROM zones ORDER BY pickups DESC LIMIT 1",
  );
  const [manhattan] = await query<{ share: number }>(
    `SELECT CAST(SUM(CASE WHEN pickup_borough = 'Manhattan' AND dropoff_borough = 'Manhattan' THEN trips ELSE 0 END) AS REAL)
            / SUM(trips) AS share FROM borough_flows`,
  );
  const folds = await getFolds();
  const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  return {
    rawRows: raw.revived_rows,
    rawRowsNotebook: raw.notebook_rows ?? 0,
    finalRows: final.revived_rows,
    finalRowsNotebook: final.notebook_rows ?? 0,
    busiest,
    manhattanShare: manhattan.share,
    notebookR2: avg(folds.map((f) => f.notebook_r2)),
    notebookRmse: avg(folds.map((f) => f.notebook_rmse)),
    revivedR2: avg(folds.map((f) => f.original_on_revived_r2)),
    revivedRmse: avg(folds.map((f) => f.original_on_revived_rmse)),
    refitR2: avg(folds.map((f) => f.refit_r2)),
    refitRmse: avg(folds.map((f) => f.refit_rmse)),
  };
});

export interface Conditions {
  date: string;
  precipitation: number;
  snow: number;
  snow_depth: number;
  tavg: number;
  wt01: number;
  wt02: number;
  wt03: number;
  wt06: number;
  wt08: number;
  /** borough -> events (null = no permitted event recorded: the 2021 model dropped such trips) */
  events: Record<string, number | null>;
  collisions: Record<string, number>;
}

/** Weather, events and collisions for every day of 2019 (the estimator's numeric features). */
export const getConditions = cache(async (): Promise<Conditions[]> => {
  const weather = await query<Omit<Conditions, "events" | "collisions">>(
    "SELECT date, precipitation, snow, snow_depth, tavg, wt01, wt02, wt03, wt06, wt08 FROM weather ORDER BY date",
  );
  const per = await getDailyBorough();
  const byDate = new Map<string, Conditions>(
    weather.map((w) => [w.date, { ...w, events: {}, collisions: {} }]),
  );
  for (const r of per) {
    const c = byDate.get(r.date);
    if (!c) continue;
    c.events[r.borough] = r.events;
    c.collisions[r.borough] = r.collisions;
  }
  return [...byDate.values()];
});

/** Totals of the side datasets, for the data notes. */
export const getSideTotals = cache(async () => {
  const [ev] = await query<{ events: number; days: number }>(
    "SELECT SUM(number_of_event) AS events, COUNT(DISTINCT date) AS days FROM events_daily",
  );
  const [co] = await query<{ collisions: number; last: string }>(
    "SELECT SUM(collisions) AS collisions, MAX(date) AS last FROM collisions_hourly",
  );
  return { events: ev.events, eventDays: ev.days, collisions: co.collisions, lastCollision: co.last };
});

export const getModelPath = cache(() =>
  query<{ reg_param: number; elastic_net_param: number; cv_r2: number; cv_rmse: number; nonzero: number }>(
    "SELECT * FROM model_path ORDER BY reg_param",
  ),
);
