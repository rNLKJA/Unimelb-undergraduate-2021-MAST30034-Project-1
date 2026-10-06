import { describe, expect, it } from "vitest";
import { binOf, predictionInterval, type ConformalTable } from "./conformal";
import { eventMatching, isoWeekday, rainAnalysis, type EffectsBoroughDay, type EffectsDay } from "./effects";
import { holdoutTable, metricsFromDays, type HoldoutDay } from "./holdout";
import { mulberry32 } from "./stats/rng";

function dates(n: number, start = "2019-02-01"): string[] {
  const t0 = Date.UTC(+start.slice(0, 4), +start.slice(5, 7) - 1, +start.slice(8, 10));
  return Array.from({ length: n }, (_, i) => new Date(t0 + i * 86_400_000).toISOString().slice(0, 10));
}

describe("calendar", () => {
  it("knows ISO weekdays", () => {
    expect(isoWeekday("2019-10-09")).toBe(3); // a Wednesday
    expect(isoWeekday("2019-12-29")).toBe(7);
    expect(isoWeekday("2019-01-07")).toBe(1);
  });
});

describe("rain analysis", () => {
  it("recovers a planted 5% wet-day effect and excludes snow and empty days", () => {
    const rng = mulberry32(1);
    const ds = dates(300);
    const days: EffectsDay[] = ds.map((date, i) => {
      const precipitation = i % 4 === 0 ? 0.3 + rng() : i % 7 === 0 ? 0.05 : 0;
      const wet = precipitation >= 0.1;
      const noise = (rng() - 0.5) * 0.02;
      return {
        date,
        trips: i === 5 ? 10 : 200_000,
        indexed_trips: 190_000,
        mean_min: 14 + (wet ? 1 : 0) + noise * 10,
        median_min: 11,
        mean_log_ratio: (wet ? Math.log(1.05) : 0) + noise,
        sd_log_ratio: 0.4,
        precipitation,
        snow: i === 9 ? 1 : 0,
        snow_depth: 0,
        tavg: 50,
        events: 100,
        collisions: 500,
      };
    });
    const r = rainAnalysis(days, { B: 1000 });
    expect(r.excluded).toEqual({ lowTrips: 1, snow: 1 });
    expect(r.adjusted.boot.estimate).toBeCloseTo(0.05, 2);
    expect(r.adjusted.boot.lower).toBeLessThan(0.05);
    expect(r.adjusted.boot.upper).toBeGreaterThan(0.05);
    expect(r.regression.wetPct.estimate).toBeCloseTo(0.05, 2);
    expect(r.regression.wetPct.lower).toBeLessThan(0.05);
    expect(r.rawMinutes.boot.estimate).toBeCloseTo(1, 1);
    expect(r.wet.days + r.dry.days + r.light.days).toBe(r.usableDays);
    expect(r.dose.find((d) => d.label === "1 in or more")!.days).toBeGreaterThan(0);
  });
});

describe("matched event comparison", () => {
  const ds = dates(120, "2019-03-01");
  const rows: EffectsBoroughDay[] = ds.map((date, i) => ({
    date,
    borough: "Manhattan",
    trips: 100_000,
    indexed_trips: 90_000,
    mean_min: 12,
    median_min: 10,
    // every 10th day is event-heavy and 3% slower
    events: i % 10 === 0 ? 500 : 100 + (i % 3),
    mean_log_ratio: i % 10 === 0 ? Math.log(1.03) : 0,
    sd_log_ratio: 0.4,
    precipitation: 0,
    tavg: 60,
    collisions: 300,
  }));

  it("pairs each event-heavy day with the nearest light day on the same weekday", () => {
    const r = eventMatching(rows, ["Manhattan"], { B: 500 });
    expect(r.pairs.length).toBe(12);
    expect(r.overall.highDays).toBe(12);
    for (const p of r.pairs) {
      expect(isoWeekday(p.control)).toBe(isoWeekday(p.date));
      expect(p.gapDays % 7).toBe(0);
      expect(p.gapDays).toBeLessThanOrEqual(28);
      expect(p.controlEvents).toBeLessThan(p.events);
    }
    expect(r.overall.effect.estimate).toBeCloseTo(0.03, 10);
    expect(r.overall.sign.positive).toBe(12);
  });

  it("compares only within the same weather and skips holidays", () => {
    // a wet event-heavy day has no wet neighbours on its weekday, so it is not compared at all
    const wetHigh = rows.map((x, i) => (i === 0 ? { ...x, precipitation: 1 } : x));
    const r = eventMatching(wetHigh, ["Manhattan"], { B: 200 });
    expect(r.pairs.find((p) => p.date === ds[0])).toBeUndefined();
    expect(r.overall.highDays).toBe(11);
    const holiday = rows.map((x) => (x.date === "2019-05-27" ? { ...x, events: 9999 } : x));
    expect(
      eventMatching(holiday, ["Manhattan"], { B: 200 }).pairs.find((p) => p.date === "2019-05-27"),
    ).toBeUndefined();
  });
});

describe("hold-out metrics", () => {
  const day = (model: string, date: string, trips: number, errs: number[], ys: number[]): HoldoutDay => ({
    split: "temporal",
    model,
    date,
    trips,
    sum_err: errs.reduce((s, e) => s + e, 0),
    sum_sq_err: errs.reduce((s, e) => s + e * e, 0),
    sum_abs_err: errs.reduce((s, e) => s + Math.abs(e), 0),
    sum_y: ys.reduce((s, y) => s + y, 0),
    sum_y2: ys.reduce((s, y) => s + y * y, 0),
  });

  it("matches metrics computed directly from the trips", () => {
    const ys = [10, 12, 30, 8];
    const errs = [1, -2, 5, 0];
    const m = metricsFromDays([
      day("a", "2019-11-01", 2, errs.slice(0, 2), ys.slice(0, 2)),
      day("a", "2019-11-02", 2, errs.slice(2), ys.slice(2)),
    ]);
    const ybar = ys.reduce((s, y) => s + y) / 4;
    const sst = ys.reduce((s, y) => s + (y - ybar) ** 2, 0);
    expect(m.rmse).toBeCloseTo(Math.sqrt((1 + 4 + 25 + 0) / 4), 12);
    expect(m.mae).toBeCloseTo(8 / 4, 12);
    expect(m.bias).toBeCloseTo(1, 12);
    expect(m.r2).toBeCloseTo(1 - 30 / sst, 12);
  });

  it("bootstraps whole days and pairs model differences on the same resamples", () => {
    const rng = mulberry32(2);
    const rows: HoldoutDay[] = [];
    for (const date of dates(40, "2019-11-01")) {
      const ys = Array.from({ length: 50 }, () => 5 + 20 * rng());
      const good = ys.map(() => (rng() - 0.5) * 2);
      rows.push(
        day(
          "ref",
          date,
          50,
          good.map((e) => e * 3),
          ys,
        ),
      );
      rows.push(day("better", date, 50, good, ys));
    }
    const t = holdoutTable(rows, "temporal", "ref", { B: 400 });
    const better = t.find((r) => r.model === "better")!;
    const ref = t.find((r) => r.model === "ref")!;
    expect(ref.dRmse).toBeNull();
    expect(better.dRmse!.upper).toBeLessThan(0);
    expect(better.rmse.estimate).toBeCloseTo(ref.rmse.estimate / 3, 10);
    expect(better.days).toBe(40);
  });
});

describe("conformal lookup", () => {
  const table: ConformalTable = {
    description: "",
    calibrationTrips: 100,
    testTrips: 100,
    levels: [
      {
        level: 0.9,
        boroughs: [
          {
            borough: "Manhattan",
            edges: [10, 20],
            offsets: [
              [-3, 5],
              [-4, 8],
              [-9, 20],
            ],
            nCal: [30, 30, 40],
            test: { trips: 100, covered: 90 },
          },
          { borough: "Queens", edges: [], offsets: [[-10, 30]], nCal: [50], test: null },
        ],
        test: { trips: 100, covered: 90, meanWidth: 20 },
        globalHalfWidth: 12,
        globalTest: { trips: 100, covered: 90, meanWidth: 22 },
      },
    ],
  };
  it("finds bins like numpy searchsorted(side='right')", () => {
    expect(binOf([10, 20], 5)).toBe(0);
    expect(binOf([10, 20], 10)).toBe(1);
    expect(binOf([10, 20], 25)).toBe(2);
    expect(binOf([], 3)).toBe(0);
  });
  it("builds the interval for the trip's borough and clips the lower end at zero", () => {
    expect(predictionInterval(table, 0.9, "Manhattan", 15)).toMatchObject({
      lower: 11,
      upper: 23,
      bin: 1,
      bins: 3,
    });
    expect(predictionInterval(table, 0.9, "Queens", 6)).toMatchObject({ lower: 0, rawLower: -4, upper: 36 });
    expect(predictionInterval(table, 0.9, "Staten Island", 15)!.borough).toBe("Manhattan");
    expect(predictionInterval(table, 0.5, "Manhattan", 15)).toBeNull();
  });
});
