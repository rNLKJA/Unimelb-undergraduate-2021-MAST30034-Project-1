# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""Load the rigour, effects and data-quality outputs into web/data/analytics.db.

    uv run scripts/build_evidence_tables.py   # after rigour.py, effects.py and data_quality.py

build_analytics.py calls this at the end, so a full rebuild reproduces every
table; running it on its own replaces only the tables listed in TABLE_DOCS below
(and their rows in meta_tables), leaving the 2021 tables untouched.

Also writes web/src/lib/data/conformal.json, the interval table the in-browser
estimator uses.
"""

from __future__ import annotations

import json
import sqlite3

from common import ANALYTICS_DB, OUT, WEB, write_json

TABLE_DOCS = {
    "evidence_meta": ("Evidence metadata", "Key-value summaries (JSON) of the regression, hold-out, effects and data-quality analyses: sample sizes, references, splits and self-checks."),
    "ols_coefficients": ("OLS coefficients with robust SEs", "Unpenalised OLS counterpart of the 2021 model on all 2019 model rows: estimates with classical, HC3 and day-clustered standard errors and 95% intervals. One reference level per block is omitted."),
    "holdout_models": ("Hold-out models", "The models compared on the temporal (Nov-Dec) and in-period (Jan-Oct fold 0) hold-outs."),
    "holdout_daily": ("Hold-out errors per day", "Per test day and model: trips and sums of errors, squared errors, absolute errors, y and y squared. The website bootstraps whole days from these."),
    "residual_hist2d": ("Residuals vs fitted (2D histogram)", "Trips per 1-minute fitted bin and 2-minute residual bin, for the 2021 coefficients and the OLS fit."),
    "residual_bins": ("Residuals by fitted value", "Mean and 10th/50th/90th percentile residual per 1-minute fitted bin (bins with at least 200 trips)."),
    "residual_qq": ("Residual quantiles (QQ)", "Residual quantiles against the normal quantiles with the same mean and standard deviation."),
    "residual_groups": ("Residual spread by group", "Trips, mean residual, residual SD and MAE per pickup borough, pickup hour and borough x hour."),
    "conformal_bins": ("Conformal interval table", "Split-conformal offsets per calibration bin: global symmetric, Mondrian by predicted decile, and Mondrian by pickup borough x predicted bin, at 80%, 90% and 95%."),
    "conformal_coverage": ("Conformal coverage", "Empirical coverage of each conformal method on held-out trips, overall and by bin, borough and hour, with mean interval width (lower end clipped at 0)."),
    "effects_daily": ("Daily duration index", "Per day: trips, mean minutes and the composition-adjusted duration index (mean log of minutes / route-hour median), with weather, events and collisions."),
    "effects_borough_daily": ("Borough-day duration index", "Per pickup borough and day: trips, the duration index, permitted events and collisions in that borough."),
    "dq_rules": ("Data-quality rules", "Every 2021 cleaning rule with its reason, rows removed in sequence, rows failing it on its own and rows failing only it."),
    "dq_rule_values": ("Offending values per rule", "The most common values each cleaning rule removes."),
    "dq_missing": ("Missing values by source file", "Missing values per column in each monthly TLC file of 2019."),
    "dq_january": ("January missing surcharge", "Rows and missing congestion surcharges per pickup day in the January 2019 file."),
    "dq_residual_checks": ("Residual plausibility checks", "Implausible records the 2021 rules let through, counted on the final analysis dataset by vendor (reported, not removed)."),
    "dq_surcharge_by_month": ("Congestion surcharge convention", "Per month and vendor: trips whose total leaves out the recorded congestion surcharge."),
}

BOROUGHS = ["Manhattan", "Brooklyn", "Queens", "Bronx", "Staten Island", "EWR"]


def main(db_path=ANALYTICS_DB) -> None:
    rig = json.loads((OUT / "rigour.json").read_text())
    eff = json.loads((OUT / "effects.json").read_text())
    dq = json.loads((OUT / "data_quality.json").read_text())

    db = sqlite3.connect(db_path)
    for name in TABLE_DOCS:
        db.execute(f"DROP TABLE IF EXISTS {name}")

    def put(name: str, ddl: str, rows) -> None:
        cols = ddl.count(",") + 1
        db.execute(f"CREATE TABLE {name} ({ddl})")
        db.executemany(f"INSERT INTO {name} VALUES ({', '.join('?' * cols)})", list(rows))
        print(f"     {name}: {db.execute(f'SELECT count(*) FROM {name}').fetchone()[0]:,} rows")

    ols = rig["ols"]
    meta = {
        "ols": {k: v for k, v in ols.items() if k != "coefficients"},
        "splits": rig["splits"],
        "fits": rig["fits"],
        "self_check": rig["self_check"],
        "diagnostics": {
            m: {k: v for k, v in d.items() if k not in ("hist2d", "fitted_bins", "qq", "groups")}
            for m, d in rig["diagnostics"].items()
        },
        "conformal": {
            s: {k: v for k, v in c.items() if k not in ("levels",)} for s, c in rig["conformal"].items()
        },
        "effects_reference": eff["reference"],
        "data_quality": {k: dq[k] for k in ("raw_rows", "dropna_rows", "round1_rows", "final_rows")},
    }
    put("evidence_meta", "key TEXT PRIMARY KEY, value TEXT", [(k, json.dumps(v)) for k, v in meta.items()])

    put(
        "ols_coefficients",
        "feature_index INTEGER, block TEXT, level INTEGER, label TEXT, trips INTEGER, estimate REAL, se_classical REAL, "
        "se_hc3 REAL, se_cluster_day REAL, ci_low_hc3 REAL, ci_high_hc3 REAL, ci_low_cluster REAL, ci_high_cluster REAL",
        [
            (
                c["feature_index"], c["block"], c["level"], c["label"], c["trips"], c["estimate"], c["se_classical"],
                c["se_hc3"], c["se_cluster_day"], c["ci_low_hc3"], c["ci_high_hc3"], c["ci_low_cluster"], c["ci_high_cluster"],
            )
            for c in ols["coefficients"]
        ],
    )

    put("holdout_models", "model TEXT PRIMARY KEY, label TEXT", [(m["key"], m["label"]) for m in rig["models"]])
    put(
        "holdout_daily",
        "split TEXT, model TEXT, date TEXT, trips INTEGER, sum_err REAL, sum_sq_err REAL, sum_abs_err REAL, sum_y REAL, sum_y2 REAL",
        [
            (r["split"], r["model"], r["date"], r["trips"], r["sum_err"], r["sum_sq_err"], r["sum_abs_err"], r["sum_y"], r["sum_y2"])
            for r in rig["holdout"]["daily"]
        ],
    )
    db.execute("CREATE INDEX holdout_daily_split ON holdout_daily (split, model)")

    diag = rig["diagnostics"]
    put(
        "residual_hist2d",
        "model TEXT, fitted_lo REAL, resid_lo REAL, trips INTEGER",
        [(m, c["fitted_lo"], c["resid_lo"], c["trips"]) for m, d in diag.items() for c in d["hist2d"]],
    )
    put(
        "residual_bins",
        "model TEXT, fitted_lo REAL, fitted_hi REAL, trips INTEGER, mean_resid REAL, p10 REAL, p50 REAL, p90 REAL",
        [(m, b["fitted_lo"], b["fitted_hi"], b["trips"], b["mean_resid"], b["p10"], b["p50"], b["p90"]) for m, d in diag.items() for b in d["fitted_bins"]],
    )
    put(
        "residual_qq",
        "model TEXT, p REAL, sample_q REAL, normal_q REAL",
        [(m, q["p"], q["sample_q"], q["normal_q"]) for m, d in diag.items() for q in d["qq"]],
    )

    def group_label(kind: str, g: int) -> str:
        if kind == "borough":
            return BOROUGHS[g]
        if kind == "hour":
            return f"{g:02d}"
        return f"{BOROUGHS[g // 24]} {g % 24:02d}"

    put(
        "residual_groups",
        "model TEXT, group_type TEXT, group_value TEXT, trips INTEGER, mean_resid REAL, sd_resid REAL, mae REAL",
        [
            (m, kind, group_label(kind, r["group"]), r["trips"], r["mean_resid"], r["sd_resid"], r["mae"])
            for m, d in diag.items()
            for kind, rows in d["groups"].items()
            for r in rows
        ],
    )

    bins, cov = [], []
    for scheme, c in rig["conformal"].items():
        for lv in c["levels"]:
            level = lv["level"]
            bins.append((scheme, "global", level, None, 0, None, None, c["n_cal"], -lv["global_q"], lv["global_q"]))
            for b in lv["bins"]:
                bins.append((scheme, "mondrian", level, None, b["bin"], b["pred_lo"], b["pred_hi"], b["n_cal"], b["q_lo"], b["q_hi"]))
            for b in lv["borough_bins"]:
                bins.append(
                    (scheme, "mondrian_borough", level, BOROUGHS[b["borough"]], b["bin"], b["pred_lo"], b["pred_hi"], b["n_cal"], b["q_lo"], b["q_hi"])
                )
            for method, groups in lv["coverage"].items():
                for kind, rows in groups.items():
                    for r in rows:
                        g = r["group"]
                        value = (
                            "all" if kind == "all"
                            else BOROUGHS[g] if kind == "borough"
                            else f"{g:02d}" if kind == "hour"
                            else str(g)
                        )
                        cov.append((scheme, method, level, kind, value, r["trips"], r["covered"], r["mean_width"]))
    put(
        "conformal_bins",
        "scheme TEXT, method TEXT, level REAL, borough TEXT, bin INTEGER, pred_lo REAL, pred_hi REAL, n_cal INTEGER, q_lo REAL, q_hi REAL",
        bins,
    )
    put(
        "conformal_coverage",
        "scheme TEXT, method TEXT, level REAL, group_type TEXT, group_value TEXT, trips INTEGER, covered INTEGER, mean_width REAL",
        cov,
    )

    put(
        "effects_daily",
        "date TEXT PRIMARY KEY, trips INTEGER, indexed_trips INTEGER, mean_min REAL, median_min REAL, mean_log_ratio REAL, "
        "sd_log_ratio REAL, precipitation REAL, snow REAL, snow_depth REAL, tavg REAL, events INTEGER, collisions INTEGER",
        [
            (
                r["date"], r["trips"], r["indexed_trips"], r["mean_min"], r["median_min"], r["mean_log_ratio"], r["sd_log_ratio"],
                r["precipitation"], r["snow"], r["snow_depth"], r["tavg"], r["events"], r["collisions"],
            )
            for r in eff["daily"]
        ],
    )
    put(
        "effects_borough_daily",
        "date TEXT, borough TEXT, trips INTEGER, indexed_trips INTEGER, mean_min REAL, median_min REAL, mean_log_ratio REAL, "
        "sd_log_ratio REAL, precipitation REAL, tavg REAL, events INTEGER, collisions INTEGER",
        [
            (
                r["date"], r["borough"], r["trips"], r["indexed_trips"], r["mean_min"], r["median_min"], r["mean_log_ratio"],
                r["sd_log_ratio"], r["precipitation"], r["tavg"], r["events"], r["collisions"],
            )
            for r in eff["borough_daily"]
        ],
    )

    put(
        "dq_rules",
        "step INTEGER, key TEXT, stage TEXT, label TEXT, rule TEXT, reason TEXT, applied_to TEXT, applied_rows INTEGER, "
        "removed_in_sequence INTEGER, fails_alone INTEGER, fails_only_this INTEGER",
        [
            (
                i + 1, r["key"], r["stage"], r["label"], r["rule"], r["reason"], r["applied_to"], r["applied_rows"],
                r["removed_in_sequence"], r["fails_alone"], r["fails_only_this"],
            )
            for i, r in enumerate(dq["rules"])
        ],
    )
    put(
        "dq_rule_values",
        "key TEXT, rank INTEGER, value TEXT, rows INTEGER",
        [(r["key"], j + 1, v["value"], v["rows"]) for r in dq["rules"] for j, v in enumerate(r["top_values"])],
    )
    put(
        "dq_missing",
        "source_file TEXT, column_name TEXT, missing INTEGER, rows INTEGER",
        [
            (f["source_file"], col, n, f["rows"])
            for f in dq["missing_by_file"]
            for col, n in [("any column", f["any_missing"]), *f["by_column"].items()]
        ],
    )
    put("dq_january", "date TEXT, rows INTEGER, missing_congestion INTEGER", [(r["date"], r["rows"], r["missing_congestion"]) for r in dq["january"]])
    put(
        "dq_residual_checks",
        "key TEXT, label TEXT, condition TEXT, reason TEXT, rows INTEGER, share REAL, vendor1_rows INTEGER, vendor2_rows INTEGER, vendor1_trips INTEGER, vendor2_trips INTEGER",
        [
            (
                r["key"], r["label"], r["condition"], r["reason"], r["rows"], r["share"],
                *[next((v["rows"] for v in r["by_vendor"] if v["vendor"] == k), 0) for k in (1, 2)],
                *[next((v["trips"] for v in r["by_vendor"] if v["vendor"] == k), 0) for k in (1, 2)],
            )
            for r in dq["residual_checks"]
        ],
    )
    put(
        "dq_surcharge_by_month",
        "month INTEGER, vendor INTEGER, rows INTEGER, trips INTEGER",
        [(r["month"], r["vendor"], r["rows"], r["trips"]) for r in dq["surcharge_by_month"]],
    )

    have_meta = db.execute("SELECT count(*) FROM sqlite_master WHERE name = 'meta_tables'").fetchone()[0]
    if have_meta:
        db.executemany("DELETE FROM meta_tables WHERE name = ?", [(k,) for k in TABLE_DOCS])
        db.executemany("INSERT INTO meta_tables VALUES (?, ?, ?)", [(k, t, d) for k, (t, d) in TABLE_DOCS.items()])
    db.commit()
    db.execute("VACUUM")
    db.close()
    print(f"     analytics.db: {db_path.stat().st_size / 1e6:.1f} MB")

    # interval table for the in-browser estimator: the 2021 coefficients, calibrated on random 2019 trips
    c = rig["conformal"]["random"]
    levels = []
    for lv in c["levels"]:
        cov_b = {r["group"]: r for r in lv["coverage"]["mondrian_borough"]["borough"]}
        cov_all = lv["coverage"]["mondrian_borough"]["all"][0]
        g_all = lv["coverage"]["global"]["all"][0]
        levels.append(
            {
                "level": lv["level"],
                "boroughs": [
                    {
                        "borough": name,
                        "edges": [b["pred_hi"] for b in lv["borough_bins"] if b["borough"] == g and b["pred_hi"] is not None],
                        "offsets": [[b["q_lo"], b["q_hi"]] for b in lv["borough_bins"] if b["borough"] == g],
                        "nCal": [b["n_cal"] for b in lv["borough_bins"] if b["borough"] == g],
                        "test": {"trips": cov_b[g]["trips"], "covered": cov_b[g]["covered"]} if g in cov_b else None,
                    }
                    for g, name in enumerate(BOROUGHS)
                    if any(b["borough"] == g and b["n_cal"] > 0 for b in lv["borough_bins"])
                ],
                "test": {"trips": cov_all["trips"], "covered": cov_all["covered"], "meanWidth": cov_all["mean_width"]},
                "globalHalfWidth": lv["global_q"],
                "globalTest": {"trips": g_all["trips"], "covered": g_all["covered"], "meanWidth": g_all["mean_width"]},
            }
        )
    write_json(
        WEB / "src" / "lib" / "data" / "conformal.json",
        {
            "description": "Split-conformal prediction intervals for the 2021 coefficients: Mondrian by pickup borough x predicted-duration bin. Bins from fold 2, calibration fold 0, coverage on fold 1 (all of 2019). Built by scripts/build_evidence_tables.py from scripts/out/rigour.json.",
            "calibrationTrips": c["n_cal"],
            "testTrips": c["n_test"],
            "levels": levels,
        },
    )


if __name__ == "__main__":
    main()
