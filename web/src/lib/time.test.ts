import { describe, expect, it } from "vitest";
import { datesOf2019, hourLabel, isoToSparkWeekday, isoWeekdayOf, sparkToIsoWeekday } from "./time";

describe("weekday conventions", () => {
  it("2019-01-01 was a Tuesday: ISO 2, Spark dayofweek 3", () => {
    expect(isoWeekdayOf("2019-01-01")).toBe(2);
    expect(isoToSparkWeekday(2)).toBe(3);
  });

  it("Sunday is ISO 7 and Spark 1; Monday is ISO 1 and Spark 2", () => {
    expect(isoToSparkWeekday(7)).toBe(1);
    expect(isoToSparkWeekday(1)).toBe(2);
    for (let iso = 1; iso <= 7; iso++) expect(sparkToIsoWeekday(isoToSparkWeekday(iso))).toBe(iso);
  });

  it("lists 365 days of 2019", () => {
    const d = datesOf2019();
    expect(d).toHaveLength(365);
    expect(d[0]).toBe("2019-01-01");
    expect(d.at(-1)).toBe("2019-12-31");
  });

  it("formats hours on a 12-hour clock", () => {
    expect([0, 7, 12, 23].map(hourLabel)).toEqual(["12 am", "7 am", "12 pm", "11 pm"]);
  });
});
