import { describe, expect, it } from "vitest";
import {
  FARE_LIMIT,
  NOTEBOOK_FARE_MEAN,
  NOTEBOOK_FARE_STD,
  RULES,
  funnel,
  isWallTimestamp,
  judge,
  notebookSpeed,
  travelTimeMinutes,
  zScoreThreshold,
  type TripRecord,
} from "./cleaning";

/** A trip shown in the notebook's round-1 output (cell 22, first row). */
const longTrip: TripRecord = {
  vendorId: 1,
  pickup: "2019-01-01 07:01:20",
  dropoff: "2019-01-31 14:29:21",
  passengerCount: 1,
  tripDistance: 1.2,
  ratecodeId: 1,
  storeAndFwdFlag: "N",
  puLocationId: 48,
  doLocationId: 163,
  paymentType: 2,
  fareAmount: 6.5,
  extra: 0,
  mtaTax: 0.5,
  tipAmount: 0,
  tollsAmount: 0,
  improvementSurcharge: 0.3,
  totalAmount: 7.3,
  congestionSurcharge: 0,
};

const ordinary: TripRecord = {
  ...longTrip,
  vendorId: 2,
  pickup: "2019-01-25 17:01:30",
  dropoff: "2019-01-25 17:58:00",
  tripDistance: 10.68,
  puLocationId: 246,
  doLocationId: 223,
  paymentType: 1,
  fareAmount: 42.5,
  extra: 1,
  tipAmount: 7.51,
  tollsAmount: 5.76,
  totalAmount: 59.52,
};

describe("notebook examples", () => {
  it("drops the first rows of 2019-01 with a missing congestion surcharge (cell 18 -> 21)", () => {
    const v = judge({ ...longTrip, pickup: "2018-12-21 13:48:30", congestionSurcharge: null });
    expect(v).toEqual({ kept: false, reason: "missing", fields: ["congestionSurcharge"] });
  });

  it("computes the 30-day 'trip' of cell 77 as 43648.0167 minutes and removes it in round 3", () => {
    expect(travelTimeMinutes(longTrip.pickup!, longTrip.dropoff!)).toBeCloseTo(43648.01666666667, 9);
    const v = judge(longTrip);
    expect(v.kept).toBe(false);
    expect(v.kept === false && v.reason === "rule" && v.rule.id).toBe("max-duration");
  });

  it("keeps an ordinary trip (cell 29, first row)", () => {
    expect(judge(ordinary)).toEqual({ kept: true });
  });

  it("keeps a speed of exactly 50 'mph', which is really miles per minute (cell 75)", () => {
    const t = {
      ...ordinary,
      pickup: "2019-07-19 12:51:28",
      dropoff: "2019-07-19 12:51:31",
      tripDistance: 2.5,
      fareAmount: 52,
      tipAmount: 0,
      totalAmount: 55.3,
      ratecodeId: 2,
    };
    expect(notebookSpeed(t as never)).toBeCloseTo(50, 12);
    expect(judge(t)).toEqual({ kept: true });
    const faster = { ...t, tripDistance: 2.6 };
    const v = judge(faster);
    expect(v.kept === false && v.reason === "rule" && v.rule.id).toBe("speed");
  });

  it("keeps a $12.25 tip on a $52 fare (cell 83) and drops a tip above half the fare", () => {
    expect(judge({ ...ordinary, fareAmount: 52, tipAmount: 12.25 }).kept).toBe(true);
    const v = judge({ ...ordinary, fareAmount: 10, tipAmount: 5.01 });
    expect(v.kept === false && v.reason === "rule" && v.rule.id).toBe("tip");
    expect(judge({ ...ordinary, fareAmount: 10, tipAmount: 5 }).kept).toBe(true);
  });

  it("drops vendor 4, rate code 99 and seven passengers in round 1", () => {
    const ids = [
      judge({ ...ordinary, vendorId: 4 }),
      judge({ ...ordinary, ratecodeId: 99 }),
      judge({ ...ordinary, passengerCount: 7 }),
    ].map((v) => (v.kept === false && v.reason === "rule" ? v.rule.id : "kept"));
    expect(ids).toEqual(["vendor", "ratecode", "passengers"]);
  });

  it("lets a 2018 pickup through round 1 when the drop-off is in 2019 (cell 22 lower bound is 2018-01-01)", () => {
    const t = { ...ordinary, pickup: "2018-12-31 23:50:00", dropoff: "2019-01-01 00:10:00" };
    expect(judge(t)).toEqual({ kept: true });
  });
});

describe("fare z-score (cells 30 and 53)", () => {
  it("puts the upper fare bound at mean + 3 sd = $296.15", () => {
    expect(zScoreThreshold(NOTEBOOK_FARE_MEAN, NOTEBOOK_FARE_STD)).toBeCloseTo(296.1457, 3);
    expect(FARE_LIMIT).toBeCloseTo(296.1457, 3);
  });

  it("keeps the $296 maximum fare of the cleaned summary (cell 58) and drops $297", () => {
    expect(judge({ ...ordinary, fareAmount: 296, totalAmount: 320 }).kept).toBe(true);
    const v = judge({ ...ordinary, fareAmount: 297, totalAmount: 320 });
    expect(v.kept === false && v.reason === "rule" && v.rule.id).toBe("fare-zscore");
  });
});

describe("funnel", () => {
  it("counts survivors rule by rule in notebook order", () => {
    const f = funnel([ordinary, longTrip, { ...ordinary, vendorId: 4 }, { ...ordinary, extra: null }]);
    expect(f[0].remaining).toBe(3);
    expect(f.at(-1)!.remaining).toBe(1);
    expect(f).toHaveLength(RULES.length + 1);
    for (let i = 1; i < f.length; i++) expect(f[i].remaining).toBeLessThanOrEqual(f[i - 1].remaining);
  });
});

describe("malformed timestamps", () => {
  it("accepts only real 'YYYY-MM-DD HH:MM:SS' timestamps", () => {
    expect(isWallTimestamp("2019-06-12 08:15:00")).toBe(true);
    expect(isWallTimestamp("2019-06-12 8:15:00")).toBe(false);
    expect(isWallTimestamp("2019-12-31T10:00:00")).toBe(false);
    expect(isWallTimestamp("garbage")).toBe(false);
    expect(isWallTimestamp("2019-02-30 10:00:00")).toBe(false);
    expect(isWallTimestamp("2019-06-12 24:00:00")).toBe(false);
  });

  it("reports bad input instead of blaming a cleaning rule", () => {
    expect(judge({ ...ordinary, pickup: "2019-06-12 8:15:00" })).toEqual({
      kept: false,
      reason: "invalid",
      fields: ["pickup"],
    });
    expect(judge({ ...ordinary, pickup: "garbage", dropoff: "2019-12-31T10:00:00" })).toEqual({
      kept: false,
      reason: "invalid",
      fields: ["pickup", "dropoff"],
    });
  });

  it("still lets missing values win, as dropna() runs first", () => {
    const v = judge({ ...ordinary, pickup: "garbage", tipAmount: null });
    expect(v).toEqual({ kept: false, reason: "missing", fields: ["tipAmount"] });
  });
});
