import { describe, expect, it } from "vitest";
import { bootstrap } from "@/lib/stats/bootstrap";
import { wilsonInterval } from "@/lib/stats/wilson";
import { BOOTSTRAP_SEED, getConformalCoverage, getConformalCoverageDaily, HOLDOUT_B } from "./evidence";

describe("conformal coverage intervals", () => {
  it("match the website's own day bootstrap (scripts/rigour.py ports mulberry32 and the percentile rule)", async () => {
    const [coverage, daily] = await Promise.all([getConformalCoverage(), getConformalCoverageDaily()]);
    const headline = coverage.filter((r) => r.group_type === "all");
    expect(headline).toHaveLength(18); // 2 schemes x 3 methods x 3 levels
    for (const r of headline) {
      const days = daily.filter(
        (d) => d.scheme === r.scheme && d.method === r.method && Math.abs(d.level - r.level) < 1e-9,
      );
      expect(days).toHaveLength(r.days);
      expect(days.reduce((s, d) => s + d.trips, 0)).toBe(r.trips);
      expect(days.reduce((s, d) => s + d.covered, 0)).toBe(r.covered);
      const b = bootstrap(
        days.length,
        (w) => {
          let c = 0;
          let n = 0;
          days.forEach((d, i) => {
            c += w[i] * d.covered;
            n += w[i] * d.trips;
          });
          return c / n;
        },
        { B: HOLDOUT_B, seed: BOOTSTRAP_SEED },
      );
      const label = `${r.scheme} ${r.method} ${r.level}`;
      expect(b.estimate, label).toBeCloseTo(r.covered / r.trips, 12);
      expect(b.lower, label).toBeCloseTo(r.ci_low, 10);
      expect(b.upper, label).toBeCloseTo(r.ci_high, 10);
    }
  });

  it("are much wider than Wilson intervals that treat trips as independent", async () => {
    const coverage = await getConformalCoverage();
    const r = coverage.find(
      (c) =>
        c.scheme === "random" &&
        c.method === "global" &&
        Math.abs(c.level - 0.9) < 1e-9 &&
        c.group_type === "all",
    )!;
    const naive = wilsonInterval(r.covered, r.trips);
    expect((r.ci_high - r.ci_low) / (naive.upper - naive.lower)).toBeGreaterThan(5);
  });
});
