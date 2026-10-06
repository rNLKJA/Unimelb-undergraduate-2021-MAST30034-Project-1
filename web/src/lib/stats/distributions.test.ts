import { describe, expect, it } from "vitest";
import ref from "./__fixtures__/reference.json";
import {
  binomialPmf,
  binomialTestTwoSided,
  incompleteBeta,
  logGamma,
  normalCdf,
  normalQuantile,
  tCdf,
  tQuantile,
} from "./distributions";

/** |a - b| <= tol * max(1, |b|) */
function close(a: number, b: number, tol: number) {
  expect(Math.abs(a - b), `${a} vs ${b}`).toBeLessThanOrEqual(tol * Math.max(1, Math.abs(b)));
}

describe("standard normal (scipy.stats.norm)", () => {
  it("CDF to 1e-13", () => {
    for (const r of ref.normal.cdf) close(normalCdf(r.x), r.p, 1e-13);
  });
  it("quantile to 1e-9, tails included", () => {
    for (const r of ref.normal.ppf) close(normalQuantile(r.p), r.x, 1e-9);
  });
  it("agrees with R qnorm", () => {
    ref.r!.qnorm.p.forEach((p, i) => close(normalQuantile(p), ref.r!.qnorm.x[i], 1e-9));
  });
  it("handles the edges", () => {
    expect(normalQuantile(0)).toBe(-Infinity);
    expect(normalQuantile(1)).toBe(Infinity);
    expect(normalQuantile(1.2)).toBeNaN();
    expect(normalCdf(0)).toBe(0.5);
  });
});

describe("special functions (scipy.special)", () => {
  it("log gamma to 1e-12", () => {
    for (const r of ref.gammaln) close(logGamma(r.x), r.y, 1e-12);
  });
  it("regularised incomplete beta to 1e-12", () => {
    for (const r of ref.betainc) close(incompleteBeta(r.x, r.a, r.b), r.y, 1e-12);
  });
});

describe("Student t (scipy.stats.t and R)", () => {
  it("CDF to 1e-12 for df from 1 to 1000", () => {
    for (const r of ref.t.cdf) close(tCdf(r.t, r.df), r.p, 1e-12);
  });
  it("quantile to 1e-9", () => {
    for (const r of ref.t.ppf) close(tQuantile(r.p, r.df), r.x, 1e-9);
  });
  it("agrees with R qt and pt", () => {
    ref.r!.qt.p.forEach((p, i) => close(tQuantile(p, ref.r!.qt.df[i]), ref.r!.qt.x[i], 1e-9));
    ref.r!.pt.t.forEach((t, i) => close(tCdf(t, ref.r!.pt.df[i]), ref.r!.pt.p[i], 1e-12));
  });
});

describe("binomial (scipy.stats.binom / binomtest and R binom.test)", () => {
  it("pmf to 1e-12", () => {
    for (const r of ref.binomial.pmf) close(binomialPmf(r.k, r.n, r.p), r.y, 1e-12);
  });
  it("exact two-sided test p-values", () => {
    for (const r of ref.binomial.test) close(binomialTestTwoSided(r.k, r.n, r.p), r.pvalue, 1e-10);
    for (const r of ref.r!.binom_test) close(binomialTestTwoSided(r.k, r.n, r.p), r.pvalue, 1e-10);
  });
});
