/**
 * The 2021 cleaning rules as pure predicates over one trip record.
 *
 * A line-for-line port of the PySpark filters in coursework/Project 1 1118472.ipynb
 * (cells 21-84) and of scripts/pipeline.py, which runs the same rules over the
 * whole year with DuckDB. Quirks are kept on purpose:
 *  - the "miles per hour" rule divides miles by *minutes* (cell 74);
 *  - the tip rule keeps tips up to half the fare (cell 81: fare >= 2 * tip);
 *  - pickups from 2018 survive round 1 (cell 22) and only fall out when the
 *    2019 weather table is joined.
 */

export interface TripRecord {
  vendorId: number | null;
  /** "YYYY-MM-DD HH:MM:SS", New York wall time */
  pickup: string | null;
  dropoff: string | null;
  passengerCount: number | null;
  tripDistance: number | null;
  ratecodeId: number | null;
  storeAndFwdFlag: string | null;
  puLocationId: number | null;
  doLocationId: number | null;
  paymentType: number | null;
  fareAmount: number | null;
  extra: number | null;
  mtaTax: number | null;
  tipAmount: number | null;
  tollsAmount: number | null;
  improvementSurcharge: number | null;
  totalAmount: number | null;
  congestionSurcharge: number | null;
}

export type Round = "Round 1" | "Round 2" | "Round 3";

export interface Rule {
  id: string;
  round: Round;
  label: string;
  /** the condition as written in the notebook / pipeline */
  code: string;
  /** true when the trip is KEPT */
  keep: (t: CleanTrip) => boolean;
}

/** A record that passed dropna(): every field present. */
export type CleanTrip = { [K in keyof TripRecord]: NonNullable<TripRecord[K]> };

/** Fare z-score statistics printed by the notebook (cell 30). */
export const NOTEBOOK_FARE_MEAN = 13.025828555402784;
export const NOTEBOOK_FARE_STD = 94.37330125809798;

/** Upper fare bound implied by the z-score rule: mean + z * sd. */
export function zScoreThreshold(mean: number, std: number, z = 3): number {
  return mean + z * std;
}

/** Parse "YYYY-MM-DD HH:MM:SS" as a naive wall-clock time, in seconds. */
export function wallSeconds(ts: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/.exec(ts.trim());
  if (!m) return Number.NaN;
  const [, y, mo, d, h, mi, s] = m.map(Number);
  return Date.UTC(y, mo - 1, d, h, mi, s) / 1000;
}

/** Trip duration in minutes (cell 64: (dropoff - pickup) seconds / 60). */
export function travelTimeMinutes(pickup: string, dropoff: string): number {
  return (wallSeconds(dropoff) - wallSeconds(pickup)) / 60;
}

/** The notebook's "driving_speed_miles_per_hour": miles divided by minutes (cell 74). */
export function notebookSpeed(t: Pick<CleanTrip, "tripDistance" | "pickup" | "dropoff">): number {
  return t.tripDistance / travelTimeMinutes(t.pickup, t.dropoff);
}

/** Lexicographic comparison works for zero-padded timestamps, exactly as in Spark (cell 22). */
const between = (v: string, lo: string, hi: string) => v >= lo && v <= hi;

const FARE_LIMIT = zScoreThreshold(NOTEBOOK_FARE_MEAN, NOTEBOOK_FARE_STD);

export const RULES: Rule[] = [
  // ---- round 1 (cell 22) ----
  {
    id: "distance",
    round: "Round 1",
    label: "Trip distance must be positive",
    code: "trip_distance > 0",
    keep: (t) => t.tripDistance > 0,
  },
  {
    id: "passengers",
    round: "Round 1",
    label: "Passenger count between 1 and 6",
    code: "passenger_count BETWEEN 1 AND 6",
    keep: (t) => t.passengerCount >= 1 && t.passengerCount <= 6,
  },
  {
    id: "ratecode",
    round: "Round 1",
    label: "Known rate code (drops 99)",
    code: "RatecodeID BETWEEN 1 AND 6",
    keep: (t) => t.ratecodeId >= 1 && t.ratecodeId <= 6,
  },
  {
    id: "fare-positive",
    round: "Round 1",
    label: "Fare must be positive",
    code: "fare_amount > 0",
    keep: (t) => t.fareAmount > 0,
  },
  {
    id: "extra",
    round: "Round 1",
    label: "Extra charge cannot be negative",
    code: "extra >= 0",
    keep: (t) => t.extra >= 0,
  },
  {
    id: "mta-tax",
    round: "Round 1",
    label: "MTA tax of $0.50 to $1",
    code: "mta_tax BETWEEN 0.5 AND 1",
    keep: (t) => t.mtaTax >= 0.5 && t.mtaTax <= 1,
  },
  {
    id: "tolls",
    round: "Round 1",
    label: "Tolls cannot be negative",
    code: "tolls_amount >= 0",
    keep: (t) => t.tollsAmount >= 0,
  },
  {
    id: "improvement",
    round: "Round 1",
    label: "Improvement surcharge equals $0.30",
    code: "improvement_surcharge = 0.30",
    keep: (t) => t.improvementSurcharge === 0.3,
  },
  {
    id: "total",
    round: "Round 1",
    label: "Total amount must be positive",
    code: "total_amount > 0",
    keep: (t) => t.totalAmount > 0,
  },
  {
    id: "congestion",
    round: "Round 1",
    label: "Congestion surcharge cannot be negative",
    code: "congestion_surcharge >= 0",
    keep: (t) => t.congestionSurcharge >= 0,
  },
  {
    id: "pickup-window",
    round: "Round 1",
    label: "Pickup between 2018-01-01 and 2019-12-31",
    code: "pickup BETWEEN '2018-01-01 00:00:00' AND '2019-12-31 23:59:59'",
    keep: (t) => between(t.pickup, "2018-01-01 00:00:00", "2019-12-31 23:59:59"),
  },
  {
    id: "dropoff-window",
    round: "Round 1",
    label: "Drop-off within 2019",
    code: "dropoff BETWEEN '2019-01-01 00:00:00' AND '2019-12-31 23:59:59'",
    keep: (t) => between(t.dropoff, "2019-01-01 00:00:00", "2019-12-31 23:59:59"),
  },
  {
    id: "vendor",
    round: "Round 1",
    label: "Drop unknown vendor 4",
    code: "VendorID != 4",
    keep: (t) => t.vendorId !== 4,
  },
  // ---- round 2 (cell 53) ----
  {
    id: "fare-zscore",
    round: "Round 2",
    label: "Fare z-score at most 3",
    code: `(fare_amount - ${NOTEBOOK_FARE_MEAN}) / ${NOTEBOOK_FARE_STD} <= 3`,
    keep: (t) => (t.fareAmount - NOTEBOOK_FARE_MEAN) / NOTEBOOK_FARE_STD <= 3,
  },
  // ---- round 3 (cells 64-84) ----
  {
    id: "min-fare",
    round: "Round 3",
    label: "Fare at least the $2.50 flag-fall",
    code: "fare_amount >= 2.5",
    keep: (t) => t.fareAmount >= 2.5,
  },
  {
    id: "positive-duration",
    round: "Round 3",
    label: "Drop-off after pick-up",
    code: "travel_time > 0",
    keep: (t) => travelTimeMinutes(t.pickup, t.dropoff) > 0,
  },
  {
    id: "speed",
    round: "Round 3",
    label: "Distance / minutes at most 50 (the 'mph' rule)",
    code: "trip_distance / travel_time <= 50",
    keep: (t) => notebookSpeed(t) <= 50,
  },
  {
    id: "max-duration",
    round: "Round 3",
    label: "Trip at most 180 minutes",
    code: "travel_time <= 180",
    keep: (t) => travelTimeMinutes(t.pickup, t.dropoff) <= 180,
  },
  {
    id: "tip",
    round: "Round 3",
    label: "Tip at most half the fare",
    code: "fare_amount >= 2 * tip_amount",
    keep: (t) => t.fareAmount >= 2 * t.tipAmount,
  },
];

export { FARE_LIMIT };

export type Verdict =
  | { kept: true }
  | { kept: false; reason: "missing"; fields: (keyof TripRecord)[] }
  | { kept: false; reason: "rule"; rule: Rule };

/** First reason a record would be removed, in notebook order (or kept). */
export function judge(trip: TripRecord): Verdict {
  const missing = (Object.keys(trip) as (keyof TripRecord)[]).filter(
    (k) => trip[k] === null || trip[k] === undefined,
  );
  if (missing.length) return { kept: false, reason: "missing", fields: missing };
  const t = trip as CleanTrip;
  for (const rule of RULES) if (!rule.keep(t)) return { kept: false, reason: "rule", rule };
  return { kept: true };
}

/** Apply the rules to many records and count survivors after each one (the funnel). */
export function funnel(trips: TripRecord[]): { label: string; remaining: number }[] {
  let current = trips.filter((t) =>
    Object.values(t).every((v) => v !== null && v !== undefined),
  ) as CleanTrip[];
  const out = [{ label: "Drop rows with any missing value", remaining: current.length }];
  for (const rule of RULES) {
    current = current.filter((t) => rule.keep(t));
    out.push({ label: rule.label, remaining: current.length });
  }
  return out;
}
