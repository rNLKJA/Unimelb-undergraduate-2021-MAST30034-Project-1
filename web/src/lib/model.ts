/**
 * The 2021 trip-duration model: feature encoding and prediction.
 *
 * Port of cells 259-277 of the notebook. Spark's VectorAssembler put 579 values
 * in this order (cell 273): 11 numeric columns, then one-hot vectors (dropLast =
 * false, so a vector of size max+1) for weekday, hour, rate code, passenger
 * count, pickup zone name, vendor, drop-off zone name and the store-and-forward
 * flag. Zone names and the flag are StringIndexer indexes: most frequent first.
 */

export type BlockName =
  | "numeric"
  | "weekday"
  | "hour"
  | "ratecode"
  | "passenger_count"
  | "pickup_zone"
  | "vendor"
  | "dropoff_zone"
  | "store_and_fwd_flag";

export interface Block {
  name: BlockName;
  start: number;
  size: number;
}

export const FEATURE_COUNT = 579;

export const BLOCKS: Block[] = [
  { name: "numeric", start: 0, size: 11 },
  { name: "weekday", start: 11, size: 8 },
  { name: "hour", start: 19, size: 24 },
  { name: "ratecode", start: 43, size: 7 },
  { name: "passenger_count", start: 50, size: 7 },
  { name: "pickup_zone", start: 57, size: 258 },
  { name: "vendor", start: 315, size: 3 },
  { name: "dropoff_zone", start: 318, size: 259 },
  { name: "store_and_fwd_flag", start: 577, size: 2 },
];

export const NUMERIC_FEATURES = [
  "precipitation",
  "snow",
  "snowDepth",
  "tavg",
  "wt01",
  "wt02",
  "wt03",
  "wt06",
  "wt08",
  "events",
  "collisions",
] as const;

export type NumericFeature = (typeof NUMERIC_FEATURES)[number];

export const NUMERIC_LABELS: Record<NumericFeature, string> = {
  precipitation: "Precipitation (in)",
  snow: "Snowfall (in)",
  snowDepth: "Snow depth (in)",
  tavg: "Average temperature (°F)",
  wt01: "Fog (WT01)",
  wt02: "Heavy fog (WT02)",
  wt03: "Thunder (WT03)",
  wt06: "Glaze or rime (WT06)",
  wt08: "Smoke or haze (WT08)",
  events: "Permitted events in the pickup borough",
  collisions: "Collisions in the pickup borough",
};

export interface Coefficients {
  label: string;
  intercept: number;
  coefficients: number[];
}

export interface ModelArtefact {
  pickupZones: string[];
  dropoffZones: string[];
  flags: string[];
  original: Coefficients;
  refit: Coefficients;
}

export interface TripContext {
  numeric: Record<NumericFeature, number>;
  /** Spark dayofweek: 1 = Sunday ... 7 = Saturday */
  sparkWeekday: number;
  hour: number;
  ratecode: number;
  passengers: number;
  /** zone names as the model saw them (shapefile `zone` field) */
  pickupZone: string;
  dropoffZone: string;
  vendor: number;
  flag: string;
}

export interface Feature {
  index: number;
  value: number;
  block: BlockName;
}

const blockStart = (name: BlockName) => BLOCKS.find((b) => b.name === name)!.start;
const blockSize = (name: BlockName) => BLOCKS.find((b) => b.name === name)!.size;

function oneHot(name: BlockName, level: number): Feature[] {
  if (!Number.isInteger(level) || level < 0 || level >= blockSize(name)) return [];
  return [{ index: blockStart(name) + level, value: 1, block: name }];
}

/** Encode a trip as the sparse 579-long vector the 2021 model was trained on. */
export function encode(
  ctx: TripContext,
  model: Pick<ModelArtefact, "pickupZones" | "dropoffZones" | "flags">,
): Feature[] {
  const out: Feature[] = NUMERIC_FEATURES.map((k, i) => ({
    index: i,
    value: ctx.numeric[k],
    block: "numeric" as const,
  }));
  out.push(...oneHot("weekday", ctx.sparkWeekday));
  out.push(...oneHot("hour", ctx.hour));
  out.push(...oneHot("ratecode", ctx.ratecode));
  out.push(...oneHot("passenger_count", ctx.passengers));
  out.push(...oneHot("pickup_zone", model.pickupZones.indexOf(ctx.pickupZone)));
  out.push(...oneHot("vendor", ctx.vendor));
  out.push(...oneHot("dropoff_zone", model.dropoffZones.indexOf(ctx.dropoffZone)));
  out.push(...oneHot("store_and_fwd_flag", model.flags.indexOf(ctx.flag)));
  return out;
}

/** intercept + sum(beta_j * x_j) */
export function predict(coef: Pick<Coefficients, "intercept" | "coefficients">, features: Feature[]): number {
  let y = coef.intercept;
  for (const f of features) y += coef.coefficients[f.index] * f.value;
  return y;
}

export interface Contribution {
  block: BlockName;
  index: number;
  value: number;
  /** beta * x, in minutes */
  minutes: number;
}

/** Per-feature contributions (non-zero only), largest absolute effect first. */
export function contributions(coef: Pick<Coefficients, "coefficients">, features: Feature[]): Contribution[] {
  return features
    .map((f) => ({
      block: f.block,
      index: f.index,
      value: f.value,
      minutes: coef.coefficients[f.index] * f.value,
    }))
    .filter((c) => c.minutes !== 0)
    .sort((a, b) => Math.abs(b.minutes) - Math.abs(a.minutes));
}

/** Contributions summed per block (e.g. everything weather-related is in "numeric"). */
export function blockTotals(contribs: Contribution[]): Record<BlockName, number> {
  const totals = Object.fromEntries(BLOCKS.map((b) => [b.name, 0])) as Record<BlockName, number>;
  for (const c of contribs) totals[c.block] += c.minutes;
  return totals;
}

/** Coefficient of one level of a one-hot block (0 when the level does not exist). */
export function levelCoefficient(
  coef: Pick<Coefficients, "coefficients">,
  name: BlockName,
  level: number,
): number {
  if (level < 0 || level >= blockSize(name)) return 0;
  return coef.coefficients[blockStart(name) + level];
}
