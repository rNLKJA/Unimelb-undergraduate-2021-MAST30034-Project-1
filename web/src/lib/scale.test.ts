import { describe, expect, it } from "vitest";
import { classify, niceStep, niceTicks, quantileBreaks, rampIndex, stepDecimals } from "./scale";

describe("quantile classes", () => {
  it("splits values into equal-count classes and ignores no-data", () => {
    const values = [null, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
    const b = quantileBreaks(values, 4);
    expect(b).toHaveLength(3);
    expect(classify(1, b)).toBe(0);
    expect(classify(12, b)).toBe(3);
    expect(classify(0, b)).toBe(-1);
    expect(classify(null, b)).toBe(-1);
  });

  it("collapses duplicate breaks for skewed data", () => {
    const b = quantileBreaks([1, 1, 1, 1, 1, 1, 50], 6);
    for (let i = 1; i < b.length; i++) expect(b[i]).toBeGreaterThan(b[i - 1]);
  });

  it("spreads few classes over the whole ramp", () => {
    expect([0, 1, 2].map((c) => rampIndex(c, 3))).toEqual([0, 3, 5]);
    expect(rampIndex(-1, 3)).toBe(-1);
  });
});

describe("nice ticks", () => {
  it("rounds the day-level trip counts to whole 20K steps", () => {
    const { ticks, step } = niceTicks(186_512, 278_004);
    expect(step).toBe(20_000);
    expect(ticks[0]).toBe(180_000);
    expect(ticks.at(-1)).toBe(280_000);
  });

  it("covers the domain with 1/2/5 steps and no float noise", () => {
    expect(niceStep(0, 1)).toBe(0.2);
    expect(niceTicks(0, 3.1).ticks).toEqual([0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5]);
    expect(niceTicks(9, 49).ticks).toEqual([0, 10, 20, 30, 40, 50]);
    expect(niceTicks(0.1, 0.7).ticks).toEqual([0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7]);
  });

  it("prints just enough decimals", () => {
    expect(stepDecimals(20_000)).toBe(0);
    expect(stepDecimals(1)).toBe(0);
    expect(stepDecimals(0.5)).toBe(1);
    expect(stepDecimals(0.05)).toBe(2);
  });
});
