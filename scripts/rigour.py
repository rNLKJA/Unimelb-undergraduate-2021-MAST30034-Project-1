# /// script
# requires-python = ">=3.11"
# dependencies = ["duckdb>=1.2", "numpy>=2", "pyarrow>=17", "scipy>=1.13", "statsmodels>=0.14"]
# ///
"""Regression rigour for the trip-duration model: inference, diagnostics, hold-out and conformal intervals.

    uv run scripts/rigour.py          # after pipeline.py and fit_model.py

The 2021 model is a penalised (elastic-net) regression, so its coefficients have
no honest standard errors. This script adds the analysis around it without
changing it:

1. **Inference.** The unpenalised OLS counterpart (same 579-column design,
   one reference level per block, all 2019 model rows) with classical, HC3 and
   day-clustered (CR1) standard errors. Weather, events and collisions are
   constant within a day, so their effective sample size is the number of
   days, not the number of trips; the clustered SEs show how much that matters.
2. **Residual diagnostics** for the 2021 coefficients and the OLS fit: a
   residual-vs-fitted histogram with binned quantiles, normal QQ quantiles and
   residual spread by pickup borough and hour.
3. **Temporal hold-out.** Models fitted on January-October (folds 1-9) and
   scored on November-December, plus the in-period random hold-out (Jan-Oct
   fold 0). Per-day error sums are stored so the website can bootstrap whole
   days (trips on the same day share weather and traffic, so they are not
   independent).
4. **Split-conformal prediction intervals** (global symmetric and Mondrian by
   predicted-duration decile), with empirical coverage on held-out trips and
   day-cluster bootstrap intervals for that coverage.

Folds are the pipeline's deterministic hash of each trip. The only resampling is
the coverage bootstrap, which uses mulberry32 with seed 20190101, ported from the
website so both draw the same days. Output: scripts/out/rigour.json.
"""

from __future__ import annotations

import itertools
import json
import math

import duckdb
import numpy as np
from scipy import stats as sps

import sparse_ols
from common import OUT, WORK_DB, Timer, write_json
from fit_model import BLOCKS, CAT, NUM, P, fit_spark_elastic_net, score

NOV1 = 304  # day index (0 = 1 January) of 1 November 2019
BOROUGHS = ["Manhattan", "Brooklyn", "Queens", "Bronx", "Staten Island", "EWR"]
LEVELS = [0.8, 0.9, 0.95]
N_BINS = 10
CHUNK = 2_000_000
MIN_CELL = 20  # minimum trips for a route x hour median in the lookup baseline
# Day-cluster bootstrap for conformal coverage: the same B and seed as the website's hold-out intervals
BOOT_B = 2000
BOOT_SEED = 20190101

# Residual-diagnostic grids (minutes)
FIT_LO, FIT_HI, FIT_STEP = -10.0, 90.0, 1.0
RES_LO, RES_HI, RES_STEP = -60.0, 120.0, 2.0
FINE_LO, FINE_HI, FINE_STEP = -100.0, 200.0, 0.25


def build_dated(con) -> None:
    """model_rows plus the pickup day and borough, built with the pipeline's exact model-stage SQL."""
    have = con.execute("SELECT count(*) FROM duckdb_tables() WHERE table_name = 'model_rows_dated'").fetchone()[0]
    if not have:
        with Timer("model_rows_dated"):
            con.execute(
                """
                CREATE OR REPLACE TABLE model_rows_dated AS
                WITH m AS (
                    SELECT t.VendorID::INTEGER AS vendor, t.passenger_count::INTEGER AS passenger_count,
                           t.RatecodeID::INTEGER AS ratecode, t.store_and_fwd_flag AS flag,
                           t.travel_time AS y,
                           t.precipitation, t.snow, t.snow_depth, t.tavg, t.wt01, t.wt02, t.wt03, t.wt06, t.wt08,
                           t.number_of_event, t.number_of_collision,
                           spu.zone AS pickup_zone, sdo.zone AS dropoff_zone,
                           hour(t.pickup_dt) AS hour,
                           dayofweek(t.pickup_dt) + 1 AS weekday,
                           (hash(t.pickup_dt, t.dropoff_dt, t.PULocationID, t.DOLocationID, t.VendorID,
                                 t.total_amount, t.trip_distance) % 10)::INTEGER AS fold,
                           t.pickup_date, t.pickup_borough
                    FROM trips t
                    JOIN sf_zones spu ON t.PULocationID = spu.LocationID
                    JOIN sf_zones sdo ON t.DOLocationID = sdo.LocationID
                )
                SELECT m.fold,
                       date_diff('day', DATE '2019-01-01', m.pickup_date)::SMALLINT AS day,
                       (CASE m.pickup_borough WHEN 'Manhattan' THEN 0 WHEN 'Brooklyn' THEN 1 WHEN 'Queens' THEN 2
                             WHEN 'Bronx' THEN 3 WHEN 'Staten Island' THEN 4 ELSE 5 END)::TINYINT AS borough,
                       m.y,
                       m.precipitation, m.snow, m.snow_depth, m.tavg, m.wt01, m.wt02, m.wt03, m.wt06, m.wt08,
                       m.number_of_event::DOUBLE AS number_of_event, m.number_of_collision::DOUBLE AS number_of_collision,
                       (11 + m.weekday)::SMALLINT AS c_weekday,
                       (19 + m.hour)::SMALLINT AS c_hour,
                       (43 + m.ratecode)::SMALLINT AS c_ratecode,
                       (50 + m.passenger_count)::SMALLINT AS c_passenger,
                       (57 + p.idx)::SMALLINT AS c_pickup,
                       (315 + m.vendor)::SMALLINT AS c_vendor,
                       (318 + d.idx)::SMALLINT AS c_dropoff,
                       (577 + f.idx)::SMALLINT AS c_flag
                FROM m
                JOIN pickup_zone_index p ON m.pickup_zone = p.zone
                JOIN dropoff_zone_index d ON m.dropoff_zone = d.zone
                JOIN flag_index f ON m.flag = f.flag
                WHERE m.number_of_event IS NOT NULL
                """
            )
    a = con.execute("SELECT fold, count(*), sum(y) FROM model_rows GROUP BY 1 ORDER BY 1").fetchall()
    b = con.execute("SELECT fold, count(*), sum(y) FROM model_rows_dated GROUP BY 1 ORDER BY 1").fetchall()
    for (fa, na, ya), (fb, nb, yb) in zip(a, b):
        assert fa == fb and na == nb and abs(ya - yb) < 1e-6 * abs(ya), (fa, na, nb, ya, yb)
    print(f"     model_rows_dated matches model_rows fold by fold ({sum(r[1] for r in b):,} rows)")


def moments(con, gexpr: str, G: int) -> dict[str, np.ndarray]:
    """Exact X'X, X'y, sums per group g = gexpr (as fit_model.fold_stats, grouped by an arbitrary key)."""
    n, sy, syy = np.zeros(G), np.zeros(G), np.zeros(G)
    sx, sxy, Gm = np.zeros((G, P)), np.zeros((G, P)), np.zeros((G, P, P))
    pairs = [(i, j) for i in range(len(NUM)) for j in range(i, len(NUM))]
    sel = [f"{gexpr} AS g", "count(*)", "sum(y)", "sum(y * y)"]
    sel += [f"sum({c})" for c in NUM] + [f"sum({c} * y)" for c in NUM]
    sel += [f"sum({NUM[i]} * {NUM[j]})" for i, j in pairs]
    m = len(NUM)
    with Timer("numeric moments"):
        for row in con.execute(f"SELECT {', '.join(sel)} FROM model_rows_dated GROUP BY ALL").fetchall():
            g = row[0]
            n[g], sy[g], syy[g] = row[1], row[2], row[3]
            sx[g, :m] = row[4 : 4 + m]
            sxy[g, :m] = row[4 + m : 4 + 2 * m]
            for (i, j), v in zip(pairs, row[4 + 2 * m :]):
                Gm[g, i, j] = Gm[g, j, i] = v
    with Timer("categorical x numeric"):
        for c in CAT:
            q = f"SELECT {gexpr} AS g, {c}, count(*), sum(y), {', '.join(f'sum({x})' for x in NUM)} FROM model_rows_dated GROUP BY ALL"
            for row in con.execute(q).fetchall():
                g, j, cnt, s_y = row[0], row[1], row[2], row[3]
                Gm[g, j, j] = cnt
                sx[g, j] = cnt
                sxy[g, j] = s_y
                for i, v in enumerate(row[4:]):
                    Gm[g, i, j] = Gm[g, j, i] = v
    with Timer("categorical x categorical"):
        for a, b in itertools.combinations(CAT, 2):
            for g, i, j, cnt in con.execute(
                f"SELECT {gexpr} AS g, {a}, {b}, count(*) FROM model_rows_dated GROUP BY ALL"
            ).fetchall():
                Gm[g, i, j] = Gm[g, j, i] = cnt
    return {"n": n, "sy": sy, "syy": syy, "sx": sx, "sxy": sxy, "G": Gm}


def subset(s: dict, groups) -> dict:
    groups = list(groups)
    return {k: v[groups].sum(axis=0) for k, v in s.items()}


def fit_ols_reference(s: dict, labels: list[dict]):
    """Unpenalised OLS with an intercept, all numeric columns and one reference level dropped per block."""
    counts = np.diag(s["G"]).copy()
    n = s["n"]
    var = np.diag(s["G"])[: len(NUM)] / n - (s["sx"][: len(NUM)] / n) ** 2
    assert np.all(var > 0), "every numeric column varies"
    cols = list(range(len(NUM)))
    refs = {}
    for name, start, size in BLOCKS[1:]:
        lv = [start + k for k in range(size) if counts[start + k] > 0]
        ref = max(lv, key=lambda j: (counts[j], -j))  # most frequent level is the reference
        refs[name] = {"index": ref, "label": labels[ref]["label"], "trips": int(counts[ref])}
        cols += [j for j in lv if j != ref]
    cols = np.array(cols)
    p = 1 + len(cols)
    XtX = np.empty((p, p))
    XtX[0, 0] = n
    XtX[0, 1:] = XtX[1:, 0] = s["sx"][cols]
    XtX[1:, 1:] = s["G"][np.ix_(cols, cols)]
    Xty = np.r_[s["sy"], s["sxy"][cols]]
    d = 1.0 / np.sqrt(np.diag(XtX))
    A = np.linalg.inv(XtX * np.outer(d, d)) * np.outer(d, d)
    beta = A @ Xty
    resid_ne = np.max(np.abs(XtX @ beta - Xty) / np.maximum(1.0, np.abs(Xty)))
    assert resid_ne < 1e-6, f"normal equations residual {resid_ne}"
    sse = s["syy"] - 2 * beta @ Xty + beta @ XtX @ beta
    sst = s["syy"] - s["sy"] ** 2 / n
    full = np.zeros(P)
    full[cols] = beta[1:]
    return {
        "cols": cols,
        "p": p,
        "A": A,
        "beta": beta,
        "beta_full": full,
        "intercept": float(beta[0]),
        "sse": float(sse),
        "r2": float(1 - sse / sst),
        "n": float(n),
        "refs": refs,
        "cond": float(np.linalg.cond(XtX * np.outer(d, d))),
    }


def route_hour_baseline(con) -> tuple[np.ndarray, dict]:
    """Median minutes per (pickup zone, drop-off zone, hour) on Jan-Oct folds 1-9, with fallbacks."""
    where = f"day < {NOV1} AND fold <> 0"
    glob = con.execute(f"SELECT median(y) FROM model_rows_dated WHERE {where}").fetchone()[0]
    table = np.full((258, 259, 24), np.nan)
    route = np.full((258, 259), np.nan)
    puh = np.full((258, 24), np.nan)
    used = {"route_hour": 0, "route": 0, "pickup_hour": 0, "global": 0}
    with Timer("route x hour medians"):
        for a, b, h, med, cnt in con.execute(
            f"SELECT c_pickup - 57, c_dropoff - 318, c_hour - 19, median(y), count(*) FROM model_rows_dated WHERE {where} GROUP BY ALL"
        ).fetchall():
            if cnt >= MIN_CELL:
                table[a, b, h] = med
        for a, b, med, cnt in con.execute(
            f"SELECT c_pickup - 57, c_dropoff - 318, median(y), count(*) FROM model_rows_dated WHERE {where} GROUP BY ALL"
        ).fetchall():
            if cnt >= MIN_CELL:
                route[a, b] = med
        for a, h, med in con.execute(
            f"SELECT c_pickup - 57, c_hour - 19, median(y) FROM model_rows_dated WHERE {where} GROUP BY ALL"
        ).fetchall():
            puh[a, h] = med
    level = np.zeros(table.shape, dtype=np.int8)  # 0 route-hour, 1 route, 2 pickup-hour, 3 global
    fill = np.isnan(table)
    level[fill] = 1
    table[fill] = np.broadcast_to(route[:, :, None], table.shape)[fill]
    fill = np.isnan(table)
    level[fill] = 2
    table[fill] = np.broadcast_to(puh[:, None, :], table.shape)[fill]
    fill = np.isnan(table)
    level[fill] = 3
    table[fill] = glob
    return table, {"global_median": glob, "level": level, "min_cell": MIN_CELL}


def predict(beta: np.ndarray, b0: float, Xn: np.ndarray, C: np.ndarray) -> np.ndarray:
    return b0 + Xn @ beta[: len(NUM)] + beta[C].sum(axis=1)


class Diag:
    """Residual diagnostics accumulated over all rows for one model."""

    def __init__(self):
        self.nf = int((FIT_HI - FIT_LO) / FIT_STEP)
        self.nr = int((RES_HI - RES_LO) / RES_STEP)
        self.nfine = int((FINE_HI - FINE_LO) / FINE_STEP)
        self.h2 = np.zeros(self.nf * self.nr)
        self.fine = np.zeros(self.nf * self.nfine)
        self.fit_n = np.zeros(self.nf)
        self.fit_s1 = np.zeros(self.nf)
        self.groups = {k: np.zeros((5, n)) for k, n in (("borough", 6), ("hour", 24), ("borough_hour", 144))}
        self.tot = np.zeros(5)

    def add(self, yhat, e, bor, hour):
        fi = np.clip(((yhat - FIT_LO) / FIT_STEP).astype(np.int64), 0, self.nf - 1)
        ri = np.clip(((e - RES_LO) / RES_STEP).astype(np.int64), 0, self.nr - 1)
        qi = np.clip(((e - FINE_LO) / FINE_STEP).astype(np.int64), 0, self.nfine - 1)
        self.h2 += np.bincount(fi * self.nr + ri, minlength=self.h2.size)
        self.fine += np.bincount(fi * self.nfine + qi, minlength=self.fine.size)
        self.fit_n += np.bincount(fi, minlength=self.nf)
        self.fit_s1 += np.bincount(fi, weights=e, minlength=self.nf)
        e2 = e * e
        moments_ = (np.ones_like(e), e, e2, np.abs(e), e2 * e2)
        keys = {"borough": bor, "hour": hour, "borough_hour": bor * 24 + hour}
        for k, idx in keys.items():
            size = self.groups[k].shape[1]
            for r, w in enumerate(moments_):
                self.groups[k][r] += np.bincount(idx, weights=w, minlength=size)
        self.tot += [len(e), e.sum(), e2.sum(), np.abs(e).sum(), (e2 * e2).sum()]

    def summary(self) -> dict:
        h2 = self.h2.reshape(self.nf, self.nr)
        fine = self.fine.reshape(self.nf, self.nfine)
        cells = [
            {
                "fitted_lo": FIT_LO + i * FIT_STEP,
                "resid_lo": RES_LO + j * RES_STEP,
                "trips": int(h2[i, j]),
            }
            for i, j in zip(*np.nonzero(h2))
        ]

        def q_from_hist(counts: np.ndarray, ps) -> list[float]:
            cum = np.cumsum(counts)
            total = cum[-1]
            out = []
            for p in ps:
                target = p * total
                k = int(np.searchsorted(cum, target, side="left"))
                prev = cum[k - 1] if k > 0 else 0.0
                frac = (target - prev) / counts[k] if counts[k] > 0 else 0.5
                out.append(FINE_LO + (k + frac) * FINE_STEP)
            return out

        bins = []
        for i in range(self.nf):
            if self.fit_n[i] < 200:
                continue
            p10, p50, p90 = q_from_hist(fine[i], (0.1, 0.5, 0.9))
            bins.append(
                {
                    "fitted_lo": FIT_LO + i * FIT_STEP,
                    "fitted_hi": FIT_LO + (i + 1) * FIT_STEP,
                    "trips": int(self.fit_n[i]),
                    "mean_resid": float(self.fit_s1[i] / self.fit_n[i]),
                    "p10": p10,
                    "p50": p50,
                    "p90": p90,
                }
            )
        n, s1, s2, sa, s4 = self.tot
        mean = s1 / n
        sd = math.sqrt(s2 / n - mean**2)
        ps = [0.001, 0.0025, 0.005, 0.01, 0.025] + [round(x, 3) for x in np.arange(0.05, 0.951, 0.025)]
        ps += [0.975, 0.99, 0.995, 0.9975, 0.999]
        overall = fine.sum(axis=0)
        sample = q_from_hist(overall, ps)
        qq = [
            {"p": p, "sample_q": sq, "normal_q": float(mean + sd * sps.norm.ppf(p))}
            for p, sq in zip(ps, sample)
        ]
        groups = {}
        for k, arr in self.groups.items():
            rows = []
            for g in range(arr.shape[1]):
                gn = arr[0, g]
                if gn < 1:
                    continue
                gm = arr[1, g] / gn
                rows.append(
                    {
                        "group": g,
                        "trips": int(gn),
                        "mean_resid": float(gm),
                        "sd_resid": float(math.sqrt(max(arr[2, g] / gn - gm**2, 0.0))),
                        "mae": float(arr[3, g] / gn),
                    }
                )
            groups[k] = rows
        # Share of the variation in squared residuals explained by borough x hour (an effect size for
        # heteroscedasticity; n * eta2 is the Breusch-Pagan-style LM statistic on group dummies).
        bh = self.groups["borough_hour"]
        ok = bh[0] > 0
        between = np.sum(bh[2, ok] ** 2 / bh[0, ok]) - s2**2 / n
        total_ss = s4 - s2**2 / n
        eta2 = float(between / total_ss)
        return {
            "trips": int(n),
            "mean_resid": float(mean),
            "sd_resid": float(sd),
            "mae": float(sa / n),
            "hist2d": cells,
            "fitted_bins": bins,
            "qq": qq,
            "groups": groups,
            "eta2_sq_resid_borough_hour": eta2,
            "bp_lm_borough_hour": float(n * eta2),
            "bp_df": int(ok.sum() - 1),
        }


def mulberry32(seed: int, count: int) -> np.ndarray:
    """The first `count` draws of mulberry32(seed), bit-for-bit the generator in web/src/lib/stats/rng.ts.

    mulberry32 is counter-based (state k is seed + k * 0x6D2B79F5 mod 2^32), so it vectorises.
    """
    M = np.uint64(0xFFFFFFFF)
    k = np.arange(1, count + 1, dtype=np.uint64)
    a = (np.uint64(seed) + k * np.uint64(0x6D2B79F5)) & M
    t = ((a ^ (a >> np.uint64(15))) * (a | np.uint64(1))) & M
    t = t ^ ((t + (((t ^ (t >> np.uint64(7))) * (t | np.uint64(61))) & M)) & M)
    return ((t ^ (t >> np.uint64(14))) & M).astype(np.float64) / 4294967296.0


# first draws of mulberry32(20190101) in JavaScript (node, web/src/lib/stats/rng.ts)
assert np.allclose(mulberry32(20190101, 3), [0.70984389539808035, 0.41209807479754090, 0.49334556492976844], rtol=0, atol=1e-16)


def day_weights(n_days: int, B: int = BOOT_B, seed: int = BOOT_SEED) -> np.ndarray:
    """B x n_days multiplicities of a bootstrap that resamples days, identical to `bootstrap()` in
    web/src/lib/stats/bootstrap.ts for the same n and seed (n draws per resample, in order)."""
    u = mulberry32(seed, B * n_days).reshape(B, n_days)
    idx = np.floor(u * n_days).astype(np.int64)
    w = np.zeros((B, n_days))
    np.add.at(w, (np.repeat(np.arange(B), n_days), idx.ravel()), 1.0)
    return w


def ratio_ci(W: np.ndarray, num: np.ndarray, den: np.ndarray) -> tuple[float, float]:
    """95% percentile interval (type-7 quantiles, as in the website) of sum(w*num) / sum(w*den)."""
    with np.errstate(invalid="ignore", divide="ignore"):
        reps = (W @ num) / (W @ den)
    reps = reps[np.isfinite(reps)]
    lo, hi = np.quantile(reps, [0.025, 0.975])
    return float(lo), float(hi)


def _split_quantiles(eb: np.ndarray, alpha: float) -> tuple[float, float]:
    """Lower and upper split-conformal offsets from sorted signed residuals (alpha/2 in each tail)."""
    nb = len(eb)
    k_lo = math.floor((nb + 1) * alpha / 2)
    k_hi = math.ceil((nb + 1) * (1 - alpha / 2))
    lo = float(eb[k_lo - 1]) if k_lo >= 1 else -math.inf
    hi = float(eb[k_hi - 1]) if k_hi <= nb else math.inf
    return lo, hi


def conformal(edge_yhat, edge_bor, cal_yhat, cal_e, cal_bor, test_yhat, test_y, test_bor, test_hour, test_day) -> dict:
    """Split-conformal intervals with three taxonomies.

    * global: one symmetric |residual| quantile for every trip;
    * mondrian: asymmetric quantiles of signed residuals within deciles of the prediction;
    * mondrian_borough: the same within pickup borough x prediction quantile bins (fewer bins where a
      borough has few calibration trips: one bin per 1,000, at most 10).

    Bin edges come from a separate fold (features only), never from the calibration labels.

    Coverage intervals resample whole test days (BOOT_B resamples, seed BOOT_SEED): trips on the same
    day share weather, traffic and events, so their coverage is correlated and a Wilson interval that
    treats millions of trips as independent would be far too narrow. Every group and method sees the
    same resampled days.
    """
    days = np.unique(test_day)
    day_pos = np.searchsorted(days, test_day)
    D = len(days)
    W = day_weights(D)
    edges = np.quantile(edge_yhat, np.linspace(0, 1, N_BINS + 1)[1:-1])
    cal_bin = np.searchsorted(edges, cal_yhat, side="right")
    test_bin = np.searchsorted(edges, test_yhat, side="right")
    abs_sorted = np.sort(np.abs(cal_e))
    by_bin = [np.sort(cal_e[cal_bin == b]) for b in range(N_BINS)]
    # borough x quantile-bin taxonomy
    nbor = len(BOROUGHS)
    b_edges: list[np.ndarray] = []
    for g in range(nbor):
        n_cal_g = int(np.sum(cal_bor == g))
        nb = max(1, min(N_BINS, n_cal_g // 1000))
        eg = edge_yhat[edge_bor == g]
        b_edges.append(np.quantile(eg, np.linspace(0, 1, nb + 1)[1:-1]) if nb > 1 and len(eg) else np.array([]))
    offsets = np.cumsum([0] + [len(e) + 1 for e in b_edges])

    def bor_bin(yh, bor):
        out = np.empty(len(yh), dtype=np.int64)
        for g in range(nbor):
            m = bor == g
            out[m] = offsets[g] + np.searchsorted(b_edges[g], yh[m], side="right")
        return out

    cal_bb = bor_bin(cal_yhat, cal_bor)
    test_bb = bor_bin(test_yhat, test_bor)
    by_bb = [np.sort(cal_e[cal_bb == k]) for k in range(int(offsets[-1]))]

    out_levels = []
    for level in LEVELS:
        alpha = 1 - level
        n = len(abs_sorted)
        k = math.ceil((n + 1) * level)
        q = float(abs_sorted[k - 1]) if k <= n else math.inf
        bins = []
        q_lo = np.empty(N_BINS)
        q_hi = np.empty(N_BINS)
        for b in range(N_BINS):
            eb = by_bin[b]
            nb = len(eb)
            q_lo[b], q_hi[b] = _split_quantiles(eb, alpha)
            bins.append(
                {
                    "bin": b,
                    "pred_lo": None if b == 0 else float(edges[b - 1]),
                    "pred_hi": None if b == N_BINS - 1 else float(edges[b]),
                    "n_cal": int(nb),
                    "q_lo": float(q_lo[b]),
                    "q_hi": float(q_hi[b]),
                }
            )
        bb_lo = np.full(len(by_bb), -math.inf)
        bb_hi = np.full(len(by_bb), math.inf)
        borough_bins = []
        for g in range(nbor):
            e = b_edges[g]
            for j in range(len(e) + 1):
                k = int(offsets[g] + j)
                eb = by_bb[k]
                if len(eb):
                    bb_lo[k], bb_hi[k] = _split_quantiles(eb, alpha)
                borough_bins.append(
                    {
                        "borough": g,
                        "bin": j,
                        "pred_lo": None if j == 0 else float(e[j - 1]),
                        "pred_hi": None if j == len(e) else float(e[j]),
                        "n_cal": int(len(eb)),
                        "q_lo": float(bb_lo[k]) if len(eb) else None,
                        "q_hi": float(bb_hi[k]) if len(eb) else None,
                    }
                )
        methods = {}
        daily = {}
        for method in ("global", "mondrian", "mondrian_borough"):
            if method == "global":
                lo, hi = test_yhat - q, test_yhat + q
            elif method == "mondrian":
                lo, hi = test_yhat + q_lo[test_bin], test_yhat + q_hi[test_bin]
            else:
                lo, hi = test_yhat + bb_lo[test_bb], test_yhat + bb_hi[test_bb]
            covered = (test_y >= lo) & (test_y <= hi)
            width = hi - np.maximum(lo, 0.0)  # trip times are positive, so the lower end is clipped at 0
            groups = {
                "all": np.zeros(len(test_y), dtype=np.int64),
                "bin": test_bin,
                "borough": test_bor,
                "hour": test_hour,
                "borough_bin": test_bb,
            }
            res = {}
            for gk, gi in groups.items():
                size = int(gi.max()) + 1
                cnt = np.bincount(gi, minlength=size)
                cov = np.bincount(gi, weights=covered, minlength=size)
                wid = np.bincount(gi, weights=width, minlength=size)
                # per day x group counts for the day-cluster bootstrap
                cell = day_pos * size + gi
                cnt_dg = np.bincount(cell, minlength=D * size).reshape(D, size).astype(np.float64)
                cov_dg = np.bincount(cell, weights=covered, minlength=D * size).reshape(D, size)
                rows = []
                for g in range(size):
                    if cnt[g] == 0:
                        continue
                    ci_lo, ci_hi = ratio_ci(W, cov_dg[:, g], cnt_dg[:, g])
                    rows.append(
                        {
                            "group": g,
                            "trips": int(cnt[g]),
                            "covered": int(cov[g]),
                            "mean_width": float(wid[g] / cnt[g]),
                            "days": int(np.count_nonzero(cnt_dg[:, g])),
                            "ci_low": ci_lo,
                            "ci_high": ci_hi,
                        }
                    )
                res[gk] = rows
                if gk == "all":
                    daily[method] = [
                        {"day": int(days[d]), "trips": int(cnt_dg[d, 0]), "covered": int(cov_dg[d, 0])} for d in range(D)
                    ]
            methods[method] = res
        out_levels.append(
            {
                "level": level,
                "global_q": q,
                "bins": bins,
                "borough_bins": borough_bins,
                "coverage": methods,
                "daily": daily,
            }
        )
    return {
        "edges": [float(x) for x in edges],
        "n_edge": int(len(edge_yhat)),
        "n_cal": int(len(cal_e)),
        "n_test": int(len(test_y)),
        "test_days": int(D),
        "bootstrap": {"unit": "test day", "B": BOOT_B, "seed": BOOT_SEED, "confidence": 0.95},
        "levels": out_levels,
    }


def main() -> None:
    with Timer("sparse OLS self-check against statsmodels"):
        check = sparse_ols.self_check()
        print(f"     {check}")

    con = duckdb.connect(str(WORK_DB))
    con.execute("SET memory_limit = '20GB'")
    build_dated(con)
    labels = json.loads((OUT / "feature_labels.json").read_text())
    model = json.loads((OUT / "model.json").read_text())

    # groups: g = fold (Jan-Oct) or 10 + fold (Nov-Dec)
    stats = moments(con, f"(CASE WHEN day >= {NOV1} THEN 10 ELSE 0 END) + fold", 20)
    train = subset(stats, range(1, 10))
    full = subset(stats, range(20))
    test_nd = subset(stats, range(10, 20))
    cal_jo = subset(stats, [0])
    print(f"     train {int(train['n']):,} | Jan-Oct fold 0 {int(cal_jo['n']):,} | Nov-Dec {int(test_nd['n']):,}")

    with Timer("elastic net on Jan-Oct, regParam 0.3 (the 2021 specification)"):
        b1, i1, info1 = fit_spark_elastic_net(train)
    with Timer("elastic net on Jan-Oct, regParam 0.01"):
        b2, i2, info2 = fit_spark_elastic_net(train, reg=0.01)
    with Timer("OLS on all 2019 model rows"):
        ols = fit_ols_reference(full, labels)
        print(f"     OLS p = {ols['p']}, R2 = {ols['r2']:.4f}, condition number (equilibrated) {ols['cond']:.3g}")
    rh_table, rh_info = route_hour_baseline(con)
    mean_train = float(train["sy"] / train["n"])

    b21 = np.array(model["original"]["coefficients"])
    i21 = float(model["original"]["intercept"])
    MODELS = {
        "mean": "Jan-Oct mean (no features)",
        "route_hour_median": "Route x hour median (Jan-Oct lookup)",
        "en_2021_spec": "2021 specification refit on Jan-Oct (regParam 0.3)",
        "en_light": "Same features, lighter penalty (regParam 0.01), Jan-Oct",
        "coef_2021": "2021 coefficients as published (trained on a random 90% of all 2019)",
    }

    # reduced index map for the OLS sparse machinery
    cols = ols["cols"]
    p = ols["p"]
    Q = p + 1
    dummy = p
    rmap = np.full(P, dummy, dtype=np.int64)
    rmap[cols] = np.arange(1, p)
    assert np.all(rmap[: len(NUM)] == np.arange(1, len(NUM) + 1))
    A_ext = np.zeros((Q, Q))
    A_ext[:p, :p] = ols["A"]

    meat = np.zeros((Q, Q))
    scores = np.zeros((365, Q))
    sse_ols = 0.0
    diags = {"coef_2021": Diag(), "ols": Diag()}
    splits = {"random": None, "temporal": None}
    daily = {s: {k: np.zeros(365) for k in ("n", "sy", "syy")} for s in splits}
    err = {s: {m: {k: np.zeros(365) for k in ("se", "se2", "sae")} for m in MODELS} for s in splits}
    s1_edge, s1_cal_yhat, s1_cal_e, s1_cal_bor, s1_test = [], [], [], [], []
    s2_edge, s2_cal_yhat, s2_cal_e, s2_cal_bor, s2_test = [], [], [], [], []

    sel = ", ".join(["fold", "day", "borough", "y", *NUM, *CAT])
    reader = con.execute(f"SELECT {sel} FROM model_rows_dated").to_arrow_reader(CHUNK)
    with Timer("streaming pass over every model row"):
        done = 0
        for batch in reader:
            cols_np = [batch.column(i).to_numpy(zero_copy_only=False) for i in range(batch.num_columns)]
            fold = cols_np[0].astype(np.int64)
            day = cols_np[1].astype(np.int64)
            bor = cols_np[2].astype(np.int64)
            y = cols_np[3].astype(np.float64)
            Xn = np.column_stack([c.astype(np.float64) for c in cols_np[4 : 4 + len(NUM)]])
            C = np.column_stack([c.astype(np.int64) for c in cols_np[4 + len(NUM) :]])
            hour = C[:, 1] - 19

            yh = {
                "mean": np.full(len(y), mean_train),
                "route_hour_median": rh_table[C[:, 4] - 57, C[:, 6] - 318, hour],
                "en_2021_spec": predict(b1, i1, Xn, C),
                "en_light": predict(b2, i2, Xn, C),
                "coef_2021": predict(b21, i21, Xn, C),
            }
            yh_ols = predict(ols["beta_full"], ols["intercept"], Xn, C)
            e_ols = y - yh_ols
            sse_ols += float(e_ols @ e_ols)

            # HC3 meat and day-cluster scores of the OLS fit
            Xa = np.column_stack([np.ones(len(y)), Xn])
            R = rmap[C]
            h = sparse_ols.leverage(Xa, R, A_ext)
            # a level seen in a single trip has leverage 1 and a zero residual; its HC3 weight is undefined,
            # so it is set to 0 (such coefficients are flagged by their trip count in the table)
            w = np.where(h < 1.0 - 1e-10, e_ols**2 / np.maximum(1.0 - h, 1e-300) ** 2, 0.0)
            meat += sparse_ols.outer_sum(Xa, R, w, Q)
            scores += sparse_ols.cluster_scores(Xa, R, e_ols, day, 365, Q)

            diags["coef_2021"].add(yh["coef_2021"], y - yh["coef_2021"], bor, hour)
            diags["ols"].add(yh_ols, e_ols, bor, hour)

            masks = {"random": (day < NOV1) & (fold == 0), "temporal": day >= NOV1}
            for s, mk in masks.items():
                if not mk.any():
                    continue
                d = day[mk]
                ys = y[mk]
                daily[s]["n"] += np.bincount(d, minlength=365)
                daily[s]["sy"] += np.bincount(d, weights=ys, minlength=365)
                daily[s]["syy"] += np.bincount(d, weights=ys * ys, minlength=365)
                for m in MODELS:
                    e = ys - yh[m][mk]
                    err[s][m]["se"] += np.bincount(d, weights=e, minlength=365)
                    err[s][m]["se2"] += np.bincount(d, weights=e * e, minlength=365)
                    err[s][m]["sae"] += np.bincount(d, weights=np.abs(e), minlength=365)

            # conformal scheme 1: 2021 coefficients, random 2019 folds (edges fold 2, calibrate fold 0, test fold 1)
            y21 = yh["coef_2021"]
            mk = fold == 2
            s1_edge.append(np.column_stack([y21[mk], bor[mk]])[::4])
            mk = fold == 0
            s1_cal_yhat.append(y21[mk])
            s1_cal_e.append((y - y21)[mk])
            s1_cal_bor.append(bor[mk])
            mk = fold == 1
            s1_test.append(np.column_stack([y21[mk], y[mk], bor[mk], hour[mk], day[mk]]))
            # conformal scheme 2: 2021 specification refit on Jan-Oct, tested on Nov-Dec
            y1 = yh["en_2021_spec"]
            mk = (day < NOV1) & (fold == 2)
            s2_edge.append(np.column_stack([y1[mk], bor[mk]])[::4])
            mk = (day < NOV1) & (fold == 0)
            s2_cal_yhat.append(y1[mk])
            s2_cal_e.append((y - y1)[mk])
            s2_cal_bor.append(bor[mk])
            mk = day >= NOV1
            s2_test.append(np.column_stack([y1[mk], y[mk], bor[mk], hour[mk], day[mk]]))

            done += len(y)
            if done % 10_000_000 < CHUNK:
                print(f"     {done:,} rows", flush=True)

    # ---------------------------------------------------------------- cross-checks
    rel = abs(sse_ols - ols["sse"]) / ols["sse"]
    print(f"     OLS SSE: streaming {sse_ols:.6g} vs sufficient statistics {ols['sse']:.6g} (rel diff {rel:.2e})")
    assert rel < 1e-6
    for m, (beta, b0) in {"en_2021_spec": (b1, i1), "en_light": (b2, i2), "coef_2021": (b21, i21)}.items():
        r2_ss, rmse_ss = score(test_nd, beta, b0)
        n = daily["temporal"]["n"].sum()
        rmse_stream = math.sqrt(err["temporal"][m]["se2"].sum() / n)
        print(f"     {m}: Nov-Dec RMSE streaming {rmse_stream:.6f} vs sufficient statistics {rmse_ss:.6f}")
        assert abs(rmse_stream - rmse_ss) < 1e-6 * rmse_ss

    # ---------------------------------------------------------------- inference table
    A = ols["A"]
    n_rows = ols["n"]
    sigma2 = ols["sse"] / (n_rows - p)
    V_classical = sigma2 * A
    V_hc3 = A @ meat[:p, :p] @ A
    S = scores[:, :p]
    active_days = int(np.sum(np.any(S != 0, axis=1)))
    adj = active_days / (active_days - 1) * (n_rows - 1) / (n_rows - p)
    V_cl = adj * (A @ (S.T @ S) @ A)
    z = float(sps.norm.ppf(0.975))
    t_cl = float(sps.t.ppf(0.975, active_days - 1))
    coef_rows = []
    names = [{"index": -1, "block": "intercept", "level": 0, "label": "Intercept"}] + [labels[j] for j in cols]
    level_trips = np.diag(full["G"])
    for k, lab in enumerate(names):
        est = float(ols["beta"][k])
        trips = int(n_rows) if k == 0 or lab["block"] == "numeric" else int(level_trips[lab["index"]])
        se_c, se_h, se_k = (float(math.sqrt(V[k, k])) for V in (V_classical, V_hc3, V_cl))
        coef_rows.append(
            {
                "feature_index": int(lab["index"]),
                "block": lab["block"],
                "level": int(lab["level"]),
                "label": lab["label"],
                "trips": trips,
                "estimate": est,
                "se_classical": se_c,
                "se_hc3": se_h,
                "se_cluster_day": se_k,
                "ci_low_hc3": est - z * se_h,
                "ci_high_hc3": est + z * se_h,
                "ci_low_cluster": est - t_cl * se_k,
                "ci_high_cluster": est + t_cl * se_k,
            }
        )

    # ---------------------------------------------------------------- hold-out summaries (point estimates)
    day_dates = [str(np.datetime64("2019-01-01") + np.timedelta64(d, "D")) for d in range(365)]
    holdout_daily = []
    holdout_summary = []
    for s in splits:
        dn = daily[s]["n"]
        n = dn.sum()
        sst = daily[s]["syy"].sum() - daily[s]["sy"].sum() ** 2 / n
        for m in MODELS:
            e = err[s][m]
            holdout_summary.append(
                {
                    "split": s,
                    "model": m,
                    "trips": int(n),
                    "days": int((dn > 0).sum()),
                    "rmse": float(math.sqrt(e["se2"].sum() / n)),
                    "mae": float(e["sae"].sum() / n),
                    "bias": float(e["se"].sum() / n),
                    "r2": float(1 - e["se2"].sum() / sst),
                }
            )
            for d in np.flatnonzero(dn > 0):
                holdout_daily.append(
                    {
                        "split": s,
                        "model": m,
                        "date": day_dates[d],
                        "trips": int(dn[d]),
                        "sum_err": float(e["se"][d]),
                        "sum_sq_err": float(e["se2"][d]),
                        "sum_abs_err": float(e["sae"][d]),
                        "sum_y": float(daily[s]["sy"][d]),
                        "sum_y2": float(daily[s]["syy"][d]),
                    }
                )
    for r in holdout_summary:
        print(f"     {r['split']:>8} {r['model']:<20} RMSE {r['rmse']:.3f} MAE {r['mae']:.3f} R2 {r['r2']:.4f}")

    # ---------------------------------------------------------------- conformal
    def cat(parts):
        return np.concatenate(parts)

    with Timer("conformal: 2021 coefficients, random 2019 folds"):
        t1, e1 = cat(s1_test), cat(s1_edge)
        conf1 = conformal(
            e1[:, 0], e1[:, 1].astype(np.int64), cat(s1_cal_yhat), cat(s1_cal_e), cat(s1_cal_bor),
            t1[:, 0], t1[:, 1], t1[:, 2].astype(np.int64), t1[:, 3].astype(np.int64), t1[:, 4].astype(np.int64),
        )
    with Timer("conformal: Jan-Oct refit, tested on Nov-Dec"):
        t2, e2 = cat(s2_test), cat(s2_edge)
        conf2 = conformal(
            e2[:, 0], e2[:, 1].astype(np.int64), cat(s2_cal_yhat), cat(s2_cal_e), cat(s2_cal_bor),
            t2[:, 0], t2[:, 1], t2[:, 2].astype(np.int64), t2[:, 3].astype(np.int64), t2[:, 4].astype(np.int64),
        )
    for name, c in (("random", conf1), ("temporal", conf2)):
        for lv in c["levels"]:
            for meth in ("global", "mondrian", "mondrian_borough"):
                a = lv["coverage"][meth]["all"][0]
                print(
                    f"     {name} {lv['level']:.2f} {meth:<8} coverage {a['covered'] / a['trips']:.4f} "
                    f"(day bootstrap {a['ci_low']:.4f} to {a['ci_high']:.4f}, {c['test_days']} days) width {a['mean_width']:.2f}"
                )

    level = rh_info["level"]
    report = {
        "self_check": check,
        "splits": {
            "train": "Jan-Oct 2019, folds 1-9",
            "random": "Jan-Oct 2019, fold 0 (in-period random hold-out)",
            "temporal": "Nov-Dec 2019, all folds (temporal hold-out)",
            "rows": {
                "train": int(train["n"]),
                "random": int(cal_jo["n"]),
                "temporal": int(test_nd["n"]),
                "all": int(full["n"]),
            },
        },
        "models": [{"key": k, "label": v} for k, v in MODELS.items()],
        "fits": {
            "en_2021_spec": {"intercept": i1, "nonzero": int(np.count_nonzero(b1)), "sweeps": info1["sweeps"]},
            "en_light": {"intercept": i2, "nonzero": int(np.count_nonzero(b2)), "sweeps": info2["sweeps"]},
            "route_hour_median": {
                "global_median": rh_info["global_median"],
                "min_cell": MIN_CELL,
                "cells_route_hour": int((level == 0).sum()),
            },
            "mean": {"value": mean_train},
        },
        "ols": {
            "rows": int(n_rows),
            "parameters": int(p),
            "r2": ols["r2"],
            "sigma": math.sqrt(sigma2),
            "condition_number": ols["cond"],
            "cluster_days": active_days,
            "t_cluster": t_cl,
            "z": z,
            "references": ols["refs"],
            "coefficients": coef_rows,
        },
        "holdout": {"summary": holdout_summary, "daily": holdout_daily},
        "diagnostics": {k: d.summary() for k, d in diags.items()},
        "conformal": {
            "random": {
                "model": "coef_2021",
                "label": "2021 coefficients; bins from fold 2, calibration fold 0, test fold 1 (all of 2019)",
                **conf1,
            },
            "temporal": {
                "model": "en_2021_spec",
                "label": "2021 specification refit on Jan-Oct; calibration Jan-Oct fold 0, test Nov-Dec",
                **conf2,
            },
        },
        "boroughs": BOROUGHS,
    }
    write_json(OUT / "rigour.json", report)
    con.close()


if __name__ == "__main__":
    main()
