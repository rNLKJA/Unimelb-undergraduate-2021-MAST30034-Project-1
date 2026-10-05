# /// script
# requires-python = ">=3.11"
# dependencies = ["duckdb>=1.2", "numpy>=2"]
# ///
"""Refit the original trip-duration regression and score the 2021 coefficients.

    uv run scripts/fit_model.py        # after scripts/pipeline.py

The notebook (cells 250-297) one-hot encoded weekday, hour, rate code, passenger
count, pickup/drop-off zone names, vendor and the store-and-forward flag, kept 11
numeric columns (weather, events, collisions) and fitted Spark MLlib's
``LinearRegression(maxIter=10, regParam=0.3, elasticNetParam=0.8)`` inside a
hand-written 10-fold cross-validation. The 579-long coefficient vectors of every
fold were saved to coursework/10-folds-linear-regression.csv.

This script does two things with the revived ``model_rows`` table:

1. **Scores the original 2021 coefficients** (fold k of the CSV) on the revived
   fold k. If the cleaning, the feature layout and the zone-name indexing all
   match the notebook, R^2 and RMSE should land on the notebook's 0.366 / 9.17.
2. **Refits the same model** with the same objective as Spark: features and label
   standardised, penalty ``regParam / std(y) * (alpha * |w|_1 + (1 - alpha) / 2 * |w|^2)``.
   Spark stopped OWL-QN after 10 iterations; we solve the same objective to
   convergence with coordinate descent on the Gram matrix, so the refit is the
   model the notebook was aiming for, not a byte-identical copy.

Exact sufficient statistics (X'X, X'y per fold) come from GROUP BY queries, so
no sampling is involved. Folds are a deterministic hash of each trip (Spark's
``randomSplit`` partition sampling cannot be replayed).
"""

from __future__ import annotations

import csv
import itertools
import json

import duckdb
import numpy as np

from common import COURSEWORK, OUT, WORK_DB, Timer, write_json

P = 579
K = 10
REG_PARAM = 0.3
ELASTIC_NET = 0.8
NUM = [
    "precipitation",
    "snow",
    "snow_depth",
    "tavg",
    "wt01",
    "wt02",
    "wt03",
    "wt06",
    "wt08",
    "number_of_event",
    "number_of_collision",
]
NUM_LABELS = [
    "Precipitation",
    "Snow",
    "Snow depth",
    "TAVG",
    "WT01",
    "WT02",
    "WT03",
    "WT06",
    "WT08",
    "number_of_event",
    "number_of_collision",
]
CAT = ["c_weekday", "c_hour", "c_ratecode", "c_passenger", "c_pickup", "c_vendor", "c_dropoff", "c_flag"]
# (block name, first index, size) in VectorAssembler order (cell 273/274)
BLOCKS = [
    ("numeric", 0, 11),
    ("weekday", 11, 8),
    ("hour", 19, 24),
    ("ratecode", 43, 7),
    ("passenger_count", 50, 7),
    ("pickup_zone", 57, 258),
    ("vendor", 315, 3),
    ("dropoff_zone", 318, 259),
    ("store_and_fwd_flag", 577, 2),
]
SPARK_WEEKDAYS = ["(unused)", "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]


def fold_stats(con) -> dict[str, np.ndarray]:
    n = np.zeros(K)
    sy = np.zeros(K)
    syy = np.zeros(K)
    sx = np.zeros((K, P))
    sxy = np.zeros((K, P))
    G = np.zeros((K, P, P))

    pairs = [(i, j) for i in range(len(NUM)) for j in range(i, len(NUM))]
    sel = ["fold", "count(*)", "sum(y)", "sum(y * y)"]
    sel += [f"sum({c})" for c in NUM]
    sel += [f"sum({c} * y)" for c in NUM]
    sel += [f"sum({NUM[i]} * {NUM[j]})" for i, j in pairs]
    with Timer("numeric moments"):
        for row in con.execute(f"SELECT {', '.join(sel)} FROM model_rows GROUP BY fold").fetchall():
            f = row[0]
            n[f], sy[f], syy[f] = row[1], row[2], row[3]
            m = len(NUM)
            sx[f, :m] = row[4 : 4 + m]
            sxy[f, :m] = row[4 + m : 4 + 2 * m]
            for (i, j), v in zip(pairs, row[4 + 2 * m :]):
                G[f, i, j] = G[f, j, i] = v

    with Timer("categorical x numeric"):
        for c in CAT:
            q = f"SELECT fold, {c}, count(*), sum(y), {', '.join(f'sum({x})' for x in NUM)} FROM model_rows GROUP BY ALL"
            for row in con.execute(q).fetchall():
                f, j, cnt, s_y = row[0], row[1], row[2], row[3]
                G[f, j, j] = cnt
                sx[f, j] = cnt
                sxy[f, j] = s_y
                for i, v in enumerate(row[4:]):
                    G[f, i, j] = G[f, j, i] = v

    with Timer("categorical x categorical"):
        for a, b in itertools.combinations(CAT, 2):
            for f, i, j, cnt in con.execute(f"SELECT fold, {a}, {b}, count(*) FROM model_rows GROUP BY ALL").fetchall():
                G[f, i, j] = G[f, j, i] = cnt
    return {"n": n, "sy": sy, "syy": syy, "sx": sx, "sxy": sxy, "G": G}


def subset(stats: dict[str, np.ndarray], folds: list[int]) -> dict[str, np.ndarray | float]:
    return {k: v[folds].sum(axis=0) for k, v in stats.items()}


def fit_spark_elastic_net(s: dict, reg: float = REG_PARAM, alpha: float = ELASTIC_NET, tol: float = 1e-10):
    """Spark's LinearRegression objective (standardization=True, fitIntercept=True), solved by coordinate descent."""
    n = s["n"]
    mu = s["sx"] / n
    ybar = s["sy"] / n
    var = (np.diag(s["G"]) - n * mu**2) / (n - 1)  # Spark's summarizer: unbiased variance
    var = np.where(var > 1e-12, var, 0.0)
    sd = np.sqrt(var)
    ysd = np.sqrt((s["syy"] - n * ybar**2) / (n - 1))
    active = sd > 0
    idx = np.flatnonzero(active)
    sda = sd[idx]
    # C = Z'Z / n and b = Z't / n for the standardised features Z and label t
    Gc = s["G"][np.ix_(idx, idx)] - n * np.outer(mu[idx], mu[idx])
    C = Gc / (n * np.outer(sda, sda))
    b = (s["sxy"][idx] - n * mu[idx] * ybar) / (n * sda * ysd)
    eff = reg / ysd
    l1, l2 = alpha * eff, (1 - alpha) * eff
    w = np.zeros(len(idx))
    grad = b.copy()  # b - C w
    diag = np.diag(C)
    for sweep in range(20000):
        max_delta = 0.0
        for j in range(len(idx)):
            rj = grad[j] + diag[j] * w[j]
            new = np.sign(rj) * max(abs(rj) - l1, 0.0) / (diag[j] + l2)
            d = new - w[j]
            if d != 0.0:
                grad -= C[:, j] * d
                w[j] = new
                max_delta = max(max_delta, abs(d))
        if max_delta < tol:
            break
    beta = np.zeros(P)
    beta[idx] = w * ysd / sda
    intercept = ybar - beta @ mu
    return beta, float(intercept), {"sweeps": sweep + 1, "y_std": float(ysd), "y_mean": float(ybar)}


def score(s: dict, beta: np.ndarray, intercept: float) -> tuple[float, float]:
    """R^2 and RMSE of a linear model on a fold, from sufficient statistics (as Spark's RegressionEvaluator)."""
    n, sy, syy = s["n"], s["sy"], s["syy"]
    sse = (
        syy
        - 2 * intercept * sy
        - 2 * beta @ s["sxy"]
        + n * intercept**2
        + 2 * intercept * beta @ s["sx"]
        + beta @ s["G"] @ beta
    )
    sst = syy - sy**2 / n
    return float(1 - sse / sst), float(np.sqrt(sse / n))


def feature_labels(pickup: list[str], dropoff: list[str], flags: list[str]) -> list[dict]:
    labels: list[dict] = []
    for block, start, size in BLOCKS:
        for k in range(size):
            if block == "numeric":
                lab = NUM_LABELS[k]
            elif block == "weekday":
                lab = SPARK_WEEKDAYS[k]
            elif block == "hour":
                lab = f"{k:02d}:00"
            elif block in ("ratecode", "passenger_count", "vendor"):
                lab = str(k)
            elif block == "pickup_zone":
                lab = pickup[k] if k < len(pickup) else "(unused)"
            elif block == "dropoff_zone":
                lab = dropoff[k] if k < len(dropoff) else "(unused)"
            else:
                lab = flags[k] if k < len(flags) else "(unused)"
            labels.append({"index": start + k, "block": block, "level": k, "label": lab})
    return labels


def main() -> None:
    con = duckdb.connect(str(WORK_DB), read_only=True)
    pickup = [z for (z,) in con.execute("SELECT zone FROM pickup_zone_index ORDER BY idx").fetchall()]
    dropoff = [z for (z,) in con.execute("SELECT zone FROM dropoff_zone_index ORDER BY idx").fetchall()]
    flags = [z for (z,) in con.execute("SELECT flag FROM flag_index ORDER BY idx").fetchall()]
    pickup_n = [int(n) for (n,) in con.execute("SELECT n FROM pickup_zone_index ORDER BY idx").fetchall()]
    dropoff_n = [int(n) for (n,) in con.execute("SELECT n FROM dropoff_zone_index ORDER BY idx").fetchall()]

    stats = fold_stats(con)
    total = subset(stats, list(range(K)))
    print(f"     model rows: {int(total['n']):,}")

    # original 2021 coefficients
    with open(COURSEWORK / "10-folds-linear-regression.csv") as f:
        original = [
            {
                "fold": int(r["test_split_nums"]),
                "r2": float(r["r2"]),
                "rmse": float(r["rmse"]),
                "intercept": float(r["intercepts"]),
                "coefficients": json.loads(r["coefficients"]),
            }
            for r in csv.DictReader(f)
        ]

    folds = []
    with Timer("10-fold refit"):
        for k in range(K):
            train = subset(stats, [i for i in range(K) if i != k])
            test = subset(stats, [k])
            beta, b0, info = fit_spark_elastic_net(train)
            r2, rmse = score(test, beta, b0)
            o = original[k]
            o_r2, o_rmse = score(test, np.array(o["coefficients"]), o["intercept"])
            folds.append(
                {
                    "fold": k,
                    "test_rows": int(test["n"]),
                    "refit_r2": r2,
                    "refit_rmse": rmse,
                    "refit_intercept": b0,
                    "refit_nonzero": int(np.count_nonzero(beta)),
                    "original_r2_2021": o["r2"],
                    "original_rmse_2021": o["rmse"],
                    "original_coefficients_on_revived_r2": o_r2,
                    "original_coefficients_on_revived_rmse": o_rmse,
                    "sweeps": info["sweeps"],
                }
            )
            print(
                f"     fold {k}: refit R2 {r2:.4f} RMSE {rmse:.3f} | 2021 coefs on revived fold R2 {o_r2:.4f} "
                f"RMSE {o_rmse:.3f} | 2021 notebook R2 {o['r2']:.4f} RMSE {o['rmse']:.3f}"
            )

    with Timer("full-data refit"):
        beta_all, b0_all, info_all = fit_spark_elastic_net(total)
    r2_all, rmse_all = score(total, beta_all, b0_all)
    o0 = original[0]
    o0_r2, o0_rmse = score(total, np.array(o0["coefficients"]), o0["intercept"])

    # Regularisation path at the notebook's elastic-net mix: how many coefficients survive each penalty.
    path = []
    with Timer("regularisation path"):
        for reg in (0.01, 0.03, 0.1, 0.3, 1.0, 3.0):
            r2s, rmses, nnz = [], [], []
            for k in range(K):
                train = subset(stats, [i for i in range(K) if i != k])
                beta_k, b0_k, _ = fit_spark_elastic_net(train, reg=reg)
                r2_k, rmse_k = score(subset(stats, [k]), beta_k, b0_k)
                r2s.append(r2_k)
                rmses.append(rmse_k)
                nnz.append(int(np.count_nonzero(beta_k)))
            path.append(
                {
                    "reg_param": reg,
                    "cv_r2": float(np.mean(r2s)),
                    "cv_rmse": float(np.mean(rmses)),
                    "nonzero": float(np.mean(nnz)),
                }
            )
            print(f"     regParam {reg}: CV R2 {np.mean(r2s):.4f}, RMSE {np.mean(rmses):.3f}, non-zero {np.mean(nnz):.0f}")

    labels = feature_labels(pickup, dropoff, flags)
    coef0 = np.array(o0["coefficients"])
    zone_rows = [i for i in range(57, 315)] + [i for i in range(318, 577)]
    agree = float(np.corrcoef(coef0[zone_rows], beta_all[zone_rows])[0, 1])
    print(f"     zone-coefficient correlation, 2021 fold 0 vs refit: {agree:.3f}")

    def mean(key: str) -> float:
        return float(np.mean([f[key] for f in folds]))

    summary = {
        "rows": int(total["n"]),
        "hyperparameters": {"regParam": REG_PARAM, "elasticNetParam": ELASTIC_NET, "standardization": True},
        "notebook_mean_r2": float(np.mean([o["r2"] for o in original])),
        "notebook_mean_rmse": float(np.mean([o["rmse"] for o in original])),
        "refit_mean_r2": mean("refit_r2"),
        "refit_mean_rmse": mean("refit_rmse"),
        "original_coefficients_on_revived_mean_r2": mean("original_coefficients_on_revived_r2"),
        "original_coefficients_on_revived_mean_rmse": mean("original_coefficients_on_revived_rmse"),
        "full_refit_in_sample_r2": r2_all,
        "full_refit_in_sample_rmse": rmse_all,
        "original_fold0_on_all_revived_r2": o0_r2,
        "original_fold0_on_all_revived_rmse": o0_rmse,
        "zone_coefficient_correlation": agree,
        "label_mean": info_all["y_mean"],
        "label_std": info_all["y_std"],
    }
    print(json.dumps(summary, indent=2))
    write_json(OUT / "model_report.json", {"summary": summary, "folds": folds, "path": path})

    model = {
        "description": "Trip-duration linear model of MAST30034 Project 1 (2021): 579 features in VectorAssembler order.",
        "blocks": [{"name": b, "start": s, "size": z} for b, s, z in BLOCKS],
        "pickupZones": [{"index": i, "zone": z, "trips": n} for i, (z, n) in enumerate(zip(pickup, pickup_n))],
        "dropoffZones": [{"index": i, "zone": z, "trips": n} for i, (z, n) in enumerate(zip(dropoff, dropoff_n))],
        "flags": flags,
        "original": {
            "label": "2021 notebook, fold 1 of 10 (coursework/10-folds-linear-regression.csv)",
            "intercept": o0["intercept"],
            "coefficients": o0["coefficients"],
            "folds": [{"fold": o["fold"], "r2": o["r2"], "rmse": o["rmse"], "intercept": o["intercept"]} for o in original],
        },
        "refit": {
            "label": "2026 refit on the revived data, same features and penalty, solved to convergence",
            "intercept": b0_all,
            "coefficients": [float(round(v, 10)) for v in beta_all],
        },
        "summary": summary,
        "folds": folds,
        "path": path,
    }
    write_json(OUT / "model.json", model)
    write_json(OUT / "feature_labels.json", labels)


if __name__ == "__main__":
    main()
