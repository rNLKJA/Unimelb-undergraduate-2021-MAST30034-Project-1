# /// script
# requires-python = ">=3.11"
# dependencies = ["numpy>=2", "scipy>=1.13", "statsmodels>=0.14"]
# ///
"""Reference values for the TypeScript statistics helpers (web/src/lib/stats).

    uv run scripts/stats_reference.py

Computes known values with scipy, statsmodels and numpy, and, when Rscript is on the
PATH, the same quantities with base R, then writes
web/src/lib/stats/__fixtures__/reference.json. The Vitest suites compare the
TypeScript implementations against both. Inputs are fixed (seed 20190101), so the
file is reproducible.
"""

from __future__ import annotations

import json
import shutil
import subprocess

import numpy as np
import statsmodels.api as sm
from scipy import special, stats
from statsmodels.stats.contingency_tables import mcnemar
from statsmodels.stats.proportion import proportion_confint
from statsmodels.stats.stattools import durbin_watson

from common import WEB, write_json

SEED = 20190101


def r_values() -> dict | None:
    if not shutil.which("Rscript"):
        return None
    code = r"""
    cat(sprintf("%.17g", qnorm(c(0.001, 0.025, 0.5, 0.975, 0.999999))), sep="\n"); cat("--\n")
    cat(sprintf("%.17g", qt(c(0.025, 0.975, 0.995), df=c(5, 30, 344))), sep="\n"); cat("--\n")
    cat(sprintf("%.17g", pt(c(-2, 1.3, 2.5), df=c(3, 10, 100))), sep="\n"); cat("--\n")
    for (case in list(c(0, 20), c(7, 20), c(20, 20), c(901, 1000), c(45, 50))) {
      ci <- prop.test(case[1], case[2], correct=FALSE)$conf.int
      cat(sprintf("%.17g", ci), sep="\n")
    }
    cat("--\n")
    cat(sprintf("%.17g", c(binom.test(3, 20)$p.value, binom.test(12, 30, p=0.3)$p.value, binom.test(0, 8)$p.value)), sep="\n")
    """
    out = subprocess.run(["Rscript", "-e", code], capture_output=True, text=True, check=True).stdout
    blocks = [[float(x) for x in b.split()] for b in out.strip().split("--")]
    wil = blocks[3]
    return {
        "version": subprocess.run(["Rscript", "--version"], capture_output=True, text=True).stderr.strip()
        or subprocess.run(["Rscript", "--version"], capture_output=True, text=True).stdout.strip(),
        "qnorm": {"p": [0.001, 0.025, 0.5, 0.975, 0.999999], "x": blocks[0]},
        "qt": {"p": [0.025, 0.975, 0.995], "df": [5, 30, 344], "x": blocks[1]},
        "pt": {"t": [-2, 1.3, 2.5], "df": [3, 10, 100], "p": blocks[2]},
        "wilson": [
            {"x": x, "n": n, "lower": wil[2 * i], "upper": wil[2 * i + 1]}
            for i, (x, n) in enumerate([(0, 20), (7, 20), (20, 20), (901, 1000), (45, 50)])
        ],
        "binom_test": [
            {"k": 3, "n": 20, "p": 0.5, "pvalue": blocks[4][0]},
            {"k": 12, "n": 30, "p": 0.3, "pvalue": blocks[4][1]},
            {"k": 0, "n": 8, "p": 0.5, "pvalue": blocks[4][2]},
        ],
    }


def main() -> None:
    rng = np.random.default_rng(SEED)
    out: dict = {"seed": SEED, "generator": "scripts/stats_reference.py"}

    xs = [-8, -5, -3, -1.96, -1, -0.5, 0, 0.3, 1, 1.645, 2.5, 4, 6, 9]
    ps = [1e-10, 1e-6, 0.001, 0.0125, 0.025, 0.05, 0.1, 0.3, 0.5, 0.7, 0.9, 0.975, 0.995, 0.999999]
    out["normal"] = {
        "cdf": [{"x": x, "p": float(stats.norm.cdf(x))} for x in xs],
        "ppf": [{"p": p, "x": float(stats.norm.ppf(p))} for p in ps],
    }
    out["gammaln"] = [{"x": x, "y": float(special.gammaln(x))} for x in [0.1, 0.5, 1, 2.5, 7, 30.5, 172.3]]
    out["betainc"] = [
        {"x": x, "a": a, "b": b, "y": float(special.betainc(a, b, x))}
        for x, a, b in [(0.2, 0.5, 0.5), (0.5, 2, 3), (0.9, 10, 0.5), (0.01, 5, 50), (0.75, 172, 0.5)]
    ]
    dfs = [1, 2, 3, 5, 10, 30, 100, 344, 1000]
    out["t"] = {
        "cdf": [{"t": t, "df": d, "p": float(stats.t.cdf(t, d))} for d in dfs for t in [-4, -2, -0.5, 0, 1.3, 2.5, 6]],
        "ppf": [{"p": p, "df": d, "x": float(stats.t.ppf(p, d))} for d in dfs for p in [0.0005, 0.025, 0.05, 0.1, 0.5, 0.9, 0.975, 0.995]],
    }
    out["binomial"] = {
        "pmf": [{"k": k, "n": n, "p": p, "y": float(stats.binom.pmf(k, n, p))} for k, n, p in [(3, 10, 0.5), (0, 8, 0.2), (40, 100, 0.37), (199, 200, 0.99)]],
        "test": [
            {"k": k, "n": n, "p": p, "pvalue": float(stats.binomtest(k, n, p).pvalue)}
            for k, n, p in [(3, 20, 0.5), (12, 30, 0.3), (0, 8, 0.5), (10, 20, 0.5), (17, 25, 0.5), (60, 100, 0.55), (1, 40, 0.1)]
        ],
    }
    cases = [(0, 20), (7, 20), (20, 20), (901, 1000), (45, 50), (11252, 12500), (3, 7)]
    out["wilson"] = [
        {"x": x, "n": n, "confidence": conf, "lower": float(lo), "upper": float(hi)}
        for x, n in cases
        for conf in (0.95, 0.9)
        for lo, hi in [proportion_confint(x, n, alpha=1 - conf, method="wilson")]
    ]
    arrays = [rng.normal(size=11).round(4).tolist(), rng.exponential(size=40).round(4).tolist(), [3.0, 1.0, 2.0]]
    out["quantile"] = [
        {"xs": a, "p": p, "q": float(np.quantile(a, p))} for a in arrays for p in [0, 0.05, 0.1, 0.25, 0.5, 0.9, 0.975, 1]
    ]
    resid = rng.normal(size=99).round(4).tolist()
    out["conformal"] = {
        "residuals": resid,
        "cases": [
            {
                "alpha": a,
                "abs_q": float(np.sort(np.abs(resid))[int(np.ceil((len(resid) + 1) * (1 - a))) - 1]),
                "lower": float(np.sort(resid)[int(np.floor((len(resid) + 1) * a / 2)) - 1]),
                "upper": float(np.sort(resid)[int(np.ceil((len(resid) + 1) * (1 - a / 2))) - 1]),
            }
            for a in (0.2, 0.1, 0.05)
        ],
    }

    a = (rng.normal(loc=10, scale=2, size=23)).round(3)
    b = (rng.normal(loc=9, scale=3.5, size=31)).round(3)
    w = stats.ttest_ind(a, b, equal_var=False)
    wci = w.confidence_interval(0.95)
    d = (rng.normal(loc=0.4, scale=1.2, size=28)).round(3)
    pr = stats.ttest_1samp(d, 0.0)
    pci = pr.confidence_interval(0.95)
    pooled = np.sqrt(((len(a) - 1) * a.var(ddof=1) + (len(b) - 1) * b.var(ddof=1)) / (len(a) + len(b) - 2))
    cd = (a.mean() - b.mean()) / pooled
    out["ttest"] = {
        "a": a.tolist(),
        "b": b.tolist(),
        "welch": {"t": float(w.statistic), "df": float(w.df), "p": float(w.pvalue), "lower": float(wci.low), "upper": float(wci.high)},
        "d": d.tolist(),
        "paired": {"t": float(pr.statistic), "df": float(pr.df), "p": float(pr.pvalue), "lower": float(pci.low), "upper": float(pci.high)},
        "cohens_d": float(cd),
        "hedges_g": float(cd * (1 - 3 / (4 * (len(a) + len(b)) - 9))),
        "dz": float(d.mean() / d.std(ddof=1)),
    }

    n = 60
    x1 = rng.normal(size=n)
    x2 = rng.uniform(0, 5, size=n)
    grp = rng.integers(0, 3, size=n)
    y = 2 + 1.5 * x1 - 0.7 * x2 + np.where(grp == 1, 0.8, 0) + np.where(grp == 2, -1.1, 0) + rng.normal(size=n) * (0.5 + x2 / 2)
    X = np.column_stack([np.ones(n), x1, x2, (grp == 1).astype(float), (grp == 2).astype(float)]).round(6)
    y = y.round(6)
    fits = {k: sm.OLS(y, X).fit(cov_type=k) for k in ("nonrobust", "HC0", "HC1", "HC3")}
    f = fits["nonrobust"]
    out["ols"] = {
        "X": X.tolist(),
        "y": y.tolist(),
        "beta": f.params.tolist(),
        "se": {
            "classical": fits["nonrobust"].bse.tolist(),
            "hc0": fits["HC0"].bse.tolist(),
            "hc1": fits["HC1"].bse.tolist(),
            "hc3": fits["HC3"].bse.tolist(),
        },
        "leverage": f.get_influence().hat_matrix_diag.tolist(),
        "r2": float(f.rsquared),
        "sigma": float(np.sqrt(f.scale)),
        "df": float(f.df_resid),
        "ci_hc3_t": [
            [float(lo), float(hi)]
            for lo, hi in sm.OLS(y, X).fit(cov_type="HC3", use_t=True).conf_int(0.05)
        ],
        # Newey-West (Bartlett kernel), rows taken in order as a time series, no small-sample correction
        "hac_lags": 3,
        "hac": sm.OLS(y, X).fit(cov_type="HAC", cov_kwds={"maxlags": 3, "use_correction": False}).bse.tolist(),
        "durbin_watson": float(durbin_watson(f.resid)),
        "lag1_autocorrelation": float(np.sum(f.resid[1:] * f.resid[:-1]) / np.sum(f.resid**2)),
    }
    out["mcnemar"] = [
        {"b": b_, "c": c_, "p": float(mcnemar([[10, b_], [c_, 7]], exact=True).pvalue)}
        for b_, c_ in [(3, 9), (0, 5), (6, 6), (1, 12), (14, 4)]
    ]
    out["r"] = r_values()
    write_json(WEB / "src" / "lib" / "stats" / "__fixtures__" / "reference.json", out)


if __name__ == "__main__":
    main()
