import { bootstrapMean, bootstrapTwoSample, DEFAULT_SEED, type BootstrapResult } from "./stats/bootstrap";
import { mean } from "./stats/descriptive";
import { hedgesG, pairedDz } from "./stats/effect-size";
import { coefficient, dummies, ols, type Coefficient } from "./stats/ols";
import { signTest } from "./stats/paired";
import { quantile } from "./stats/quantile";
import { pairedTTest, welchTTest, type TTestResult } from "./stats/ttest";

/**
 * Rain and permitted-event effects on trip duration, from day-level aggregates
 * (scripts/effects.py). The outcome is a composition-adjusted duration index: the mean,
 * over a day's trips, of log(minutes / median minutes of the same route at the same hour).
 * exp(index) - 1 reads as "the same trips took this much longer than usual".
 */

export interface EffectsDay {
  date: string;
  trips: number;
  indexed_trips: number;
  mean_min: number;
  median_min: number;
  mean_log_ratio: number | null;
  sd_log_ratio: number | null;
  precipitation: number;
  snow: number;
  snow_depth: number;
  tavg: number;
  events: number;
  collisions: number;
}

export interface EffectsBoroughDay {
  date: string;
  borough: string;
  trips: number;
  indexed_trips: number;
  mean_min: number;
  median_min: number;
  mean_log_ratio: number | null;
  sd_log_ratio: number | null;
  precipitation: number;
  tavg: number;
  events: number | null;
  collisions: number;
}

/** Rain day: at least 0.1 inch at Central Park (NOAA's "measurable rain" threshold is 0.01). */
export const WET_INCHES = 0.1;
export const MIN_DAY_TRIPS = 1000;
export const MIN_BOROUGH_DAY_TRIPS = 200;
export const MATCH_WINDOW_DAYS = 28;
/** US federal holidays in 2019, excluded from the matched comparison. */
export const HOLIDAYS_2019 = [
  "2019-01-01",
  "2019-01-21",
  "2019-02-18",
  "2019-05-27",
  "2019-07-04",
  "2019-09-02",
  "2019-10-14",
  "2019-11-11",
  "2019-11-28",
  "2019-12-25",
];

const DAY_MS = 86_400_000;
const dayNumber = (date: string) =>
  Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10)) / DAY_MS;
/** ISO weekday, 1 = Monday ... 7 = Sunday */
export const isoWeekday = (date: string) => ((((dayNumber(date) + 3) % 7) + 7) % 7) + 1;
const pct = (logDiff: number) => Math.expm1(logDiff);
const toPct = (r: BootstrapResult): BootstrapResult => ({
  ...r,
  estimate: pct(r.estimate),
  lower: pct(r.lower),
  upper: pct(r.upper),
});

export interface GroupStats {
  label: string;
  days: number;
  meanMinutes: number;
  meanIndex: number;
}

export interface RainAnalysis {
  usableDays: number;
  excluded: { lowTrips: number; snow: number };
  dry: GroupStats;
  wet: GroupStats;
  light: GroupStats;
  /** wet minus dry, raw daily mean minutes */
  rawMinutes: { boot: BootstrapResult; welch: TTestResult; hedgesG: number };
  /** wet versus dry, composition-adjusted, as a percentage change */
  adjusted: { boot: BootstrapResult; hedgesG: number };
  /** wet coefficient from index ~ wet + light + month + weekday + holiday, HC3 CI, as a % change */
  regression: {
    wet: Coefficient;
    light: Coefficient;
    wetPct: { estimate: number; lower: number; upper: number };
    n: number;
    p: number;
    r2: number;
  };
  dose: { label: string; days: number; boot: BootstrapResult | null }[];
}

export function rainAnalysis(
  days: readonly EffectsDay[],
  opts: { B?: number; seed?: number } = {},
): RainAnalysis {
  const B = opts.B ?? 4000;
  const seed = opts.seed ?? DEFAULT_SEED;
  const enough = days.filter((d) => d.trips >= MIN_DAY_TRIPS && d.mean_log_ratio !== null);
  const usable = enough.filter((d) => d.snow === 0);
  const wet = usable.filter((d) => d.precipitation >= WET_INCHES);
  const dry = usable.filter((d) => d.precipitation === 0);
  const light = usable.filter((d) => d.precipitation > 0 && d.precipitation < WET_INCHES);
  const idx = (g: readonly EffectsDay[]) => g.map((d) => d.mean_log_ratio as number);
  const mins = (g: readonly EffectsDay[]) => g.map((d) => d.mean_min);
  const group = (label: string, g: readonly EffectsDay[]): GroupStats => ({
    label,
    days: g.length,
    meanMinutes: mean(mins(g)),
    meanIndex: mean(idx(g)),
  });
  const diff = (a: readonly number[], b: readonly number[]) => mean(a) - mean(b);

  // regression on every usable day
  const months = usable.map((d) => +d.date.slice(5, 7));
  const wds = usable.map((d) => isoWeekday(d.date));
  const m = dummies(months, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], 7);
  const w = dummies(wds, [1, 2, 3, 4, 5, 6, 7], 3);
  const holidays = new Set(HOLIDAYS_2019);
  const X = usable.map((d, i) => [
    1,
    d.precipitation >= WET_INCHES ? 1 : 0,
    d.precipitation > 0 && d.precipitation < WET_INCHES ? 1 : 0,
    holidays.has(d.date) ? 1 : 0,
    ...m.columns[i],
    ...w.columns[i],
  ]);
  const names = [
    "(intercept)",
    "wet",
    "light",
    "holiday",
    ...m.names.map((x) => `month ${x}`),
    ...w.names.map((x) => `isodow ${x}`),
  ];
  // drop dummy columns that are all zero (e.g. months without usable days)
  const keep = names.map((_, j) => j < 2 || X.some((r) => r[j] !== 0));
  const fit = ols(
    X.map((r) => r.filter((_, j) => keep[j])),
    usable.map((d) => d.mean_log_ratio as number),
    names.filter((_, j) => keep[j]),
  );
  const wetCoef = coefficient(fit, 1, "hc3");
  const lightCoef = coefficient(fit, 2, "hc3");

  const bins: [string, (p: number) => boolean][] = [
    ["Trace to 0.1 in", (p) => p > 0 && p < 0.1],
    ["0.1 to 0.5 in", (p) => p >= 0.1 && p < 0.5],
    ["0.5 to 1 in", (p) => p >= 0.5 && p < 1],
    ["1 in or more", (p) => p >= 1],
  ];
  return {
    usableDays: usable.length,
    excluded: { lowTrips: days.length - enough.length, snow: enough.length - usable.length },
    dry: group("Dry (0 in)", dry),
    wet: group(`Wet (${WET_INCHES} in or more)`, wet),
    light: group("Light (under 0.1 in)", light),
    rawMinutes: {
      boot: bootstrapTwoSample(mins(wet), mins(dry), diff, { B, seed }),
      welch: welchTTest(mins(wet), mins(dry)),
      hedgesG: hedgesG(mins(wet), mins(dry)),
    },
    adjusted: {
      boot: toPct(bootstrapTwoSample(idx(wet), idx(dry), diff, { B, seed })),
      hedgesG: hedgesG(idx(wet), idx(dry)),
    },
    regression: {
      wet: wetCoef,
      light: lightCoef,
      wetPct: { estimate: pct(wetCoef.estimate), lower: pct(wetCoef.lower), upper: pct(wetCoef.upper) },
      n: fit.n,
      p: fit.p,
      r2: fit.r2,
    },
    dose: bins.map(([label, f]) => {
      const g = usable.filter((d) => f(d.precipitation));
      return {
        label,
        days: g.length,
        boot: g.length >= 3 ? toPct(bootstrapTwoSample(idx(g), idx(dry), diff, { B, seed })) : null,
      };
    }),
  };
}

export interface MatchedPair {
  borough: string;
  date: string;
  control: string;
  events: number;
  controlEvents: number;
  index: number;
  controlIndex: number;
  diff: number;
  tavgDiff: number;
  precipitationDiff: number;
  gapDays: number;
}

export interface PairSummary {
  borough: string;
  pairs: number;
  /** borough-days that met the event-heavy definition */
  highDays: number;
  unmatched: number;
  distinctControls: number;
  meanEvents: { high: number; control: number };
  balance: { meanGapDays: number; meanTavgDiff: number; meanPrecipitationDiff: number };
  /** % change in the duration index, event-heavy day vs matched control */
  effect: BootstrapResult;
  ttest: TTestResult;
  sign: { positive: number; negative: number; p: number };
  dz: number;
}

/** An event-heavy day has at least this multiple of the local typical event count. */
export const EVENT_RATIO = 1.5;

/**
 * Matched comparison. Permitted events follow the season and the day of the week, so a day is
 * compared only with its own neighbourhood: the same borough, the same weekday, within four
 * weeks and with the same wet/dry status (its "window"). A day is event-heavy when it has at
 * least 1.5 times the median event count of its window; its control is the nearest window day
 * at or below that median that is not itself event-heavy. Holidays are excluded on both sides
 * and controls may be reused (matching with replacement).
 */
export function eventMatching(
  rows: readonly EffectsBoroughDay[],
  boroughs: readonly string[] = ["Manhattan", "Brooklyn", "Queens", "Bronx"],
  opts: { B?: number; seed?: number } = {},
): { pairs: MatchedPair[]; overall: PairSummary; byBorough: PairSummary[]; excluded: string[] } {
  const holidays = new Set(HOLIDAYS_2019);
  const wet = (p: number) => p >= WET_INCHES;
  const pairs: MatchedPair[] = [];
  const meta = new Map<string, { highDays: number; unmatched: number }>();
  for (const b of boroughs) {
    const usable = rows.filter(
      (r) =>
        r.borough === b &&
        r.indexed_trips >= MIN_BOROUGH_DAY_TRIPS &&
        r.events !== null &&
        r.mean_log_ratio !== null &&
        !holidays.has(r.date),
    );
    if (!usable.length) continue;
    const windowOf = (d: EffectsBoroughDay) => {
      const dn = dayNumber(d.date);
      const wd = isoWeekday(d.date);
      return usable.filter((c) => {
        const gap = Math.abs(dayNumber(c.date) - dn);
        return (
          gap > 0 &&
          gap <= MATCH_WINDOW_DAYS &&
          isoWeekday(c.date) === wd &&
          wet(c.precipitation) === wet(d.precipitation)
        );
      });
    };
    const local = new Map(
      usable.map((d) => {
        const w = windowOf(d);
        return [
          d.date,
          {
            window: w,
            median: w.length
              ? quantile(
                  w.map((c) => c.events as number),
                  0.5,
                )
              : NaN,
          },
        ];
      }),
    );
    const isHigh = (d: EffectsBoroughDay) => {
      const l = local.get(d.date)!;
      return (
        l.window.length > 0 && (d.events as number) >= EVENT_RATIO * l.median && (d.events as number) > 0
      );
    };
    const treated = usable.filter(isHigh).sort((x, y) => x.date.localeCompare(y.date));
    let unmatched = 0;
    for (const h of treated) {
      const { window, median } = local.get(h.date)!;
      const hd = dayNumber(h.date);
      let best: EffectsBoroughDay | null = null;
      let bestGap = Infinity;
      for (const c of window) {
        if ((c.events as number) > median || isHigh(c)) continue;
        const gap = Math.abs(dayNumber(c.date) - hd);
        if (gap < bestGap || (gap === bestGap && best && c.date < best.date)) {
          best = c;
          bestGap = gap;
        }
      }
      if (!best) {
        unmatched++;
        continue;
      }
      pairs.push({
        borough: b,
        date: h.date,
        control: best.date,
        events: h.events as number,
        controlEvents: best.events as number,
        index: h.mean_log_ratio as number,
        controlIndex: best.mean_log_ratio as number,
        diff: (h.mean_log_ratio as number) - (best.mean_log_ratio as number),
        tavgDiff: h.tavg - best.tavg,
        precipitationDiff: h.precipitation - best.precipitation,
        gapDays: bestGap,
      });
    }
    meta.set(b, { highDays: treated.length, unmatched });
  }
  const B = opts.B ?? 4000;
  const seed = opts.seed ?? DEFAULT_SEED;
  const summarise = (borough: string, ps: MatchedPair[]): PairSummary => {
    const d = ps.map((p) => p.diff);
    const m = borough === "All boroughs" ? null : meta.get(borough);
    const all = [...meta.values()];
    return {
      borough,
      pairs: ps.length,
      highDays: m ? m.highDays : all.reduce((s, x) => s + x.highDays, 0),
      unmatched: m ? m.unmatched : all.reduce((s, x) => s + x.unmatched, 0),
      distinctControls: new Set(ps.map((p) => `${p.borough}|${p.control}`)).size,
      meanEvents: { high: mean(ps.map((p) => p.events)), control: mean(ps.map((p) => p.controlEvents)) },
      balance: {
        meanGapDays: mean(ps.map((p) => p.gapDays)),
        meanTavgDiff: mean(ps.map((p) => p.tavgDiff)),
        meanPrecipitationDiff: mean(ps.map((p) => p.precipitationDiff)),
      },
      effect: toPct(bootstrapMean(d, { B, seed })),
      ttest: pairedTTest(d),
      sign: signTest(d),
      dz: pairedDz(d),
    };
  };
  return {
    pairs,
    overall: summarise("All boroughs", pairs),
    byBorough: boroughs
      .filter((b) => pairs.filter((p) => p.borough === b).length >= 2)
      .map((b) =>
        summarise(
          b,
          pairs.filter((p) => p.borough === b),
        ),
      ),
    excluded: boroughs.filter((b) => pairs.filter((p) => p.borough === b).length < 2),
  };
}
