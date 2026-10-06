import { describe, expect, it } from "vitest";
import artefact from "./data/model.json";
import { mean, r2, rmse, sampleStd, scoreFromStats, type SufficientStats } from "./metrics";

describe("regression metrics", () => {
  it("matches hand-computed R^2 and RMSE", () => {
    const y = [3, -0.5, 2, 7];
    const p = [2.5, 0, 2, 8];
    expect(rmse(y, p)).toBeCloseTo(Math.sqrt(0.375), 12);
    expect(r2(y, p)).toBeCloseTo(0.9486081370449679, 12);
  });

  it("uses the sample (n - 1) standard deviation like Spark's summary()", () => {
    expect(sampleStd([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(2.138089935299395, 12);
  });

  it("scores from sufficient statistics exactly like scoring row by row (port of fit_model.py:score)", () => {
    const X = [
      [1, 0, 2.5],
      [0, 1, 1.0],
      [1, 0, 0.5],
      [0, 1, 3.0],
      [1, 0, 1.5],
    ];
    const y = [10, 7, 6, 12, 9];
    const beta = [1.5, -0.5, 2.2];
    const b0 = 3.1;
    const p = X[0].length;
    const s: SufficientStats = {
      n: X.length,
      sy: y.reduce((a, b) => a + b, 0),
      syy: y.reduce((a, b) => a + b * b, 0),
      sx: Array.from({ length: p }, (_, j) => X.reduce((a, r) => a + r[j], 0)),
      sxy: Array.from({ length: p }, (_, j) => X.reduce((a, r, i) => a + r[j] * y[i], 0)),
      G: Array.from({ length: p }, (_, i) =>
        Array.from({ length: p }, (_, j) => X.reduce((a, r) => a + r[i] * r[j], 0)),
      ),
    };
    const pred = X.map((r) => b0 + r.reduce((a, v, j) => a + v * beta[j], 0));
    const got = scoreFromStats(s, beta, b0);
    expect(got.r2).toBeCloseTo(r2(y, pred), 12);
    expect(got.rmse).toBeCloseTo(rmse(y, pred), 12);
  });
});

describe("2021 cross-validation results (cell 296)", () => {
  // printed by the notebook for the 10 folds
  const R2 = [
    0.36760282845620995, 0.36678708264393634, 0.3670465584538307, 0.3654535560556006, 0.366036933775323,
    0.3662072716006791, 0.3663915797273418, 0.3666518867805053, 0.36611114335737716, 0.3669612540790398,
  ];
  const RMSE = [
    9.174372358224751, 9.170723327292436, 9.16956723009064, 9.170685124340627, 9.17542554156678,
    9.177786930574978, 9.171276980817, 9.17923660722613, 9.182336881837195, 9.174433417750326,
  ];

  it("averages to R^2 0.3665 and RMSE 9.17 minutes", () => {
    expect(mean(R2)).toBeCloseTo(artefact.summary.notebook_mean_r2, 12);
    expect(mean(RMSE)).toBeCloseTo(artefact.summary.notebook_mean_rmse, 12);
  });

  it("the 2021 coefficients score within 0.003 R^2 and 0.01 min RMSE on the revived data", () => {
    expect(Math.abs(artefact.summary.original_coefficients_on_revived_mean_r2 - mean(R2))).toBeLessThan(
      0.003,
    );
    expect(Math.abs(artefact.summary.original_coefficients_on_revived_mean_rmse - mean(RMSE))).toBeLessThan(
      0.01,
    );
  });

  it("the refit lands on the same model (zone coefficients correlate > 0.999)", () => {
    expect(artefact.summary.zone_coefficient_correlation).toBeGreaterThan(0.999);
    expect(Math.abs(artefact.summary.refit_mean_r2 - mean(R2))).toBeLessThan(0.003);
  });
});

describe("correlation", () => {
  it("is 1 for a perfect line, -1 for its mirror and skips missing pairs", async () => {
    const { pearson, olsLine } = await import("./metrics");
    expect(pearson([1, 2, 3, 4], [2, 4, 6, 8])).toBeCloseTo(1, 12);
    expect(pearson([1, 2, 3, 4], [8, 6, 4, 2])).toBeCloseTo(-1, 12);
    expect(pearson([1, 2, null, 4, 5], [1, 2, 99, 4, 5])).toBeCloseTo(1, 12);
    expect(olsLine([0, 1, 2], [1, 3, 5])).toEqual({ a: 1, b: 2 });
  });
});
