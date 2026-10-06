import { describe, expect, it } from "vitest";
import ref from "./__fixtures__/reference.json";
import { bootstrap, bootstrapMean, bootstrapTwoSample } from "./bootstrap";
import { mean, sum } from "./descriptive";
import { cohensD, hedgesG, pairedDz } from "./effect-size";
import { coefficient, dummies, invert, ols } from "./ols";
import { mcnemarExact, signTest } from "./paired";
import { conformalOffsets, conformalQuantile, median, quantile } from "./quantile";
import { mulberry32 } from "./rng";
import { pairedTTest, welchTTest } from "./ttest";
import { wilsonInterval } from "./wilson";

function close(a: number, b: number, tol: number) {
  expect(Math.abs(a - b), `${a} vs ${b}`).toBeLessThanOrEqual(tol * Math.max(1, Math.abs(b)));
}

describe("Wilson interval", () => {
  it("matches statsmodels proportion_confint(method='wilson')", () => {
    for (const r of ref.wilson) {
      const ci = wilsonInterval(r.x, r.n, r.confidence);
      close(ci.lower, r.lower, 1e-12);
      close(ci.upper, r.upper, 1e-12);
    }
  });
  it("matches R prop.test(correct = FALSE)", () => {
    for (const r of ref.r!.wilson) {
      const ci = wilsonInterval(r.x, r.n);
      close(ci.lower, r.lower, 1e-12);
      close(ci.upper, r.upper, 1e-12);
    }
  });
  it("stays inside [0, 1] and rejects impossible counts", () => {
    expect(wilsonInterval(0, 5).lower).toBe(0);
    expect(wilsonInterval(5, 5).upper).toBe(1);
    expect(() => wilsonInterval(6, 5)).toThrow();
    expect(wilsonInterval(0, 0).estimate).toBeNaN();
  });
});

describe("quantiles", () => {
  it("type 7 matches numpy.quantile", () => {
    for (const r of ref.quantile) close(quantile(r.xs, r.p), r.q, 1e-12);
    expect(median([5, 1, 3])).toBe(3);
  });
  it("conformal order statistics match the definitions computed in numpy", () => {
    const res = ref.conformal.residuals;
    for (const c of ref.conformal.cases) {
      expect(conformalQuantile(res.map(Math.abs), c.alpha)).toBe(c.abs_q);
      const o = conformalOffsets(res, c.alpha);
      expect(o.lower).toBe(c.lower);
      expect(o.upper).toBe(c.upper);
    }
  });
  it("returns an infinite interval when the calibration set is too small", () => {
    expect(conformalQuantile([1, 2, 3], 0.1)).toBe(Infinity);
    const o = conformalOffsets([1, 2, 3], 0.1);
    expect(o.lower).toBe(-Infinity);
    expect(o.upper).toBe(Infinity);
  });
  it("split-conformal covers at least 1 - alpha on exchangeable data", () => {
    const rng = mulberry32(7);
    const draw = () => -Math.log(1 - rng()) - 1; // skewed residuals
    let covered = 0;
    const reps = 400;
    for (let r = 0; r < reps; r++) {
      const cal = Array.from({ length: 50 }, draw);
      const { lower, upper } = conformalOffsets(cal, 0.2);
      const t = draw();
      if (t >= lower && t <= upper) covered++;
    }
    // theory: coverage >= 0.8 (and < 0.8 + 2/51); allow Monte Carlo error
    expect(covered / reps).toBeGreaterThan(0.75);
  });
});

describe("t tests and effect sizes (scipy)", () => {
  const t = ref.ttest;
  it("Welch two-sample test", () => {
    const r = welchTTest(t.a, t.b);
    close(r.t, t.welch.t, 1e-10);
    close(r.df, t.welch.df, 1e-10);
    close(r.p, t.welch.p, 1e-10);
    close(r.lower, t.welch.lower, 1e-9);
    close(r.upper, t.welch.upper, 1e-9);
  });
  it("paired (one-sample) test", () => {
    const r = pairedTTest(t.d);
    close(r.t, t.paired.t, 1e-10);
    expect(r.df).toBe(t.paired.df);
    close(r.p, t.paired.p, 1e-10);
    close(r.lower, t.paired.lower, 1e-9);
    close(r.upper, t.paired.upper, 1e-9);
  });
  it("Cohen's d, Hedges' g and d_z", () => {
    close(cohensD(t.a, t.b), t.cohens_d, 1e-12);
    close(hedgesG(t.a, t.b), t.hedges_g, 1e-12);
    close(pairedDz(t.d), t.dz, 1e-12);
  });
});

describe("OLS with robust standard errors (statsmodels)", () => {
  const o = ref.ols;
  const fit = ols(o.X, o.y);
  it("coefficients, R² and residual scale", () => {
    o.beta.forEach((b, j) => close(fit.beta[j], b, 1e-10));
    close(fit.r2, o.r2, 1e-12);
    close(fit.sigma, o.sigma, 1e-10);
    expect(fit.df).toBe(o.df);
  });
  it("leverage", () => {
    o.leverage.forEach((h, i) => close(fit.leverage[i], h, 1e-12));
  });
  it("classical, HC0, HC1 and HC3 standard errors", () => {
    for (const kind of ["classical", "hc0", "hc1", "hc3"] as const) {
      o.se[kind].forEach((se, j) => close(Math.sqrt(fit.cov[kind][j][j]), se, 1e-10));
    }
  });
  it("t-based HC3 confidence intervals", () => {
    o.ci_hc3_t.forEach(([lo, hi], j) => {
      const c = coefficient(fit, j, "hc3");
      close(c.lower, lo, 1e-9);
      close(c.upper, hi, 1e-9);
    });
  });
  it("refuses collinear designs", () => {
    expect(() =>
      ols(
        [
          [1, 2],
          [2, 4],
          [3, 6],
        ],
        [1, 2, 3],
      ),
    ).toThrow(/singular/);
    const inv = invert([
      [4, 2],
      [2, 3],
    ]);
    [
      [0.375, -0.25],
      [-0.25, 0.5],
    ].forEach((row, i) => row.forEach((v, j) => close(inv[i][j], v, 1e-15)));
  });
  it("builds treatment-coded dummies", () => {
    const d = dummies(["a", "b", "c", "a"], ["a", "b", "c"], "a");
    expect(d.names).toEqual(["b", "c"]);
    expect(d.columns).toEqual([
      [0, 0],
      [1, 0],
      [0, 1],
      [0, 0],
    ]);
  });
});

describe("paired tests for classifiers (statsmodels mcnemar exact)", () => {
  it("McNemar exact p-values", () => {
    for (const r of ref.mcnemar) close(mcnemarExact(r.b, r.c), r.p, 1e-10);
  });
  it("sign test drops ties", () => {
    const s = signTest([1, -2, 0, 3, 0.5]);
    expect(s).toMatchObject({ positive: 3, negative: 1 });
    close(s.p, 0.625, 1e-12);
  });
});

describe("seeded bootstrap", () => {
  it("is reproducible for a given seed and changes with it", () => {
    const xs = Array.from({ length: 30 }, (_, i) => Math.sin(i) * 3 + i / 10);
    const a = bootstrapMean(xs, { B: 500, seed: 11 });
    const b = bootstrapMean(xs, { B: 500, seed: 11 });
    const c = bootstrapMean(xs, { B: 500, seed: 12 });
    expect(a).toEqual(b);
    expect(a.lower).not.toBe(c.lower);
    expect(a.estimate).toBeCloseTo(mean(xs), 12);
    expect(a.lower).toBeLessThan(a.estimate);
    expect(a.upper).toBeGreaterThan(a.estimate);
  });
  it("percentile interval of the mean is close to the t interval for symmetric data", () => {
    const rng = mulberry32(3);
    const xs = Array.from({ length: 200 }, () => rng() + rng() + rng());
    const boot = bootstrapMean(xs, { B: 4000, seed: 5 });
    const t = pairedTTest(xs);
    expect(Math.abs(boot.lower - t.lower)).toBeLessThan(0.02);
    expect(Math.abs(boot.upper - t.upper)).toBeLessThan(0.02);
  });
  it("cluster weights reproduce the full-sample statistic and resample whole units", () => {
    const sums = [10, 20, 30];
    const counts = [1, 2, 3];
    const r = bootstrap(3, (w) => sum(sums.map((s, i) => s * w[i])) / sum(counts.map((c, i) => c * w[i])), {
      B: 200,
    });
    expect(r.estimate).toBe(10);
    // every unit has sum / count = 10, so every resample does too
    expect(r.lower).toBe(10);
    expect(r.upper).toBe(10);
  });
  it("two-sample bootstrap of a difference in means", () => {
    const r = bootstrapTwoSample(ref.ttest.a, ref.ttest.b, (a, b) => mean(a) - mean(b), { B: 3000 });
    const w = welchTTest(ref.ttest.a, ref.ttest.b);
    expect(r.estimate).toBeCloseTo(w.estimate, 12);
    expect(Math.abs(r.lower - w.lower)).toBeLessThan(0.35);
    expect(Math.abs(r.upper - w.upper)).toBeLessThan(0.35);
  });
});
