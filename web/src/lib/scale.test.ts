import { describe, expect, it } from "vitest";
import { classify, quantileBreaks, rampIndex } from "./scale";

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
