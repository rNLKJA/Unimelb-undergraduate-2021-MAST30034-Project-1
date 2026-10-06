import { describe, expect, it } from "vitest";
import { getBoroughFlows, getFolds, getFunnel, getWeekdayHourVendor, getZones } from "./analytics";
import { query } from "./db";

/**
 * Parity of the committed analytics.db with numbers printed in the 2021 notebook.
 * The revived pipeline reads TLC's 2022 Parquet re-issue of the same months, so
 * counts are compared with a tolerance rather than exactly.
 */
describe("cleaning funnel vs notebook counts", () => {
  it("lands within 0.01% of every notebook checkpoint after dropna", async () => {
    const funnel = await getFunnel();
    const checkpoints = funnel.filter((f) => f.notebook_rows !== null);
    expect(checkpoints).toHaveLength(11);
    for (const f of checkpoints.slice(1)) {
      expect(Math.abs(f.difference_pct!), f.label).toBeLessThan(0.01);
    }
    // the Parquet re-issue has ~199k extra raw rows, all with missing values
    expect(checkpoints[0].revived_rows - checkpoints[0].notebook_rows!).toBeGreaterThan(0);
    expect(Math.abs(checkpoints[0].difference_pct!)).toBeLessThan(0.3);
  });
});

describe("analysis vs the notebook's 10% sample", () => {
  it("vendor 1 mean trip time per weekday matches cell 229 within 0.05 min", async () => {
    // cell 229: trip_vendor_1.groupby('weekday').mean(), Monday = 1
    const notebook = [13.989145, 14.448598, 14.973485, 15.541611, 15.098545, 13.513046, 13.158195];
    const rows = (await getWeekdayHourVendor()).filter((r) => r.vendor === 1);
    for (let d = 1; d <= 7; d++) {
      const day = rows.filter((r) => r.isodow === d);
      const n = day.reduce((s, r) => s + r.trips, 0);
      const m = day.reduce((s, r) => s + r.trips * r.mean_min, 0) / n;
      expect(Math.abs(m - notebook[d - 1])).toBeLessThan(0.05);
    }
  });

  it("borough flows are ten times the sampled borough matrix of cell 219", async () => {
    const flows = await getBoroughFlows();
    const get = (a: string, b: string) =>
      flows.find((f) => f.pickup_borough === a && f.dropoff_borough === b)!.trips;
    const sample: [string, string, number][] = [
      ["Manhattan", "Manhattan", 6435035],
      ["Queens", "Manhattan", 279740],
      ["Manhattan", "Queens", 236169],
      ["Manhattan", "Brooklyn", 188856],
    ];
    for (const [a, b, n] of sample) {
      const ratio = get(a, b) / n;
      expect(ratio).toBeGreaterThan(9.9);
      expect(ratio).toBeLessThan(10.1);
    }
  });
});

describe("model tables", () => {
  it("stores ten folds with the notebook's metrics", async () => {
    const folds = await getFolds();
    expect(folds).toHaveLength(10);
    expect(folds[0].notebook_r2).toBeCloseTo(0.36760282845620995, 12);
    expect(folds[9].notebook_rmse).toBeCloseTo(9.174433417750326, 12);
  });

  it("indexes zone names in StringIndexer order (most trips first)", async () => {
    const rows = await query<{ side: string; idx: number; trips: number }>(
      "SELECT side, idx, trips FROM model_zone_index ORDER BY side, idx",
    );
    for (const side of ["pickup", "dropoff"]) {
      const s = rows.filter((r) => r.side === side);
      for (let i = 1; i < s.length; i++) expect(s[i].trips).toBeLessThanOrEqual(s[i - 1].trips);
    }
  });

  it("knows every lookup zone, with polygons for the 263 real ones", async () => {
    const zones = await getZones();
    expect(zones).toHaveLength(265);
    expect(zones.filter((z) => z.has_polygon === 1)).toHaveLength(263);
  });
});
