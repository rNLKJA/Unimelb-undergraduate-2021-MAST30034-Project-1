# /// script
# requires-python = ">=3.11"
# dependencies = ["duckdb>=1.2", "pyshp>=2.3"]
# ///
"""Data-quality report: what each 2021 cleaning rule removes, and why.

    uv run scripts/data_quality.py      # after fetch_data.py and pipeline.py

pipeline.py records how many rows survive each rule *in sequence*. This script
adds, for the same rules:

* **missing values** per column and per source file (the January gap is the
  congestion surcharge, which TLC only started filling on 21 January 2019);
* **failing alone**: rows that break the rule on the dropna() data, whatever
  the other rules say, and **failing only this rule**: rows no other round-1
  rule would have caught, so the rule is the sole reason they go;
* the **most common offending values**, so each rule's reason can be checked
  against what it actually catches;
* **residual checks** on the final analysis dataset: implausible records the
  2021 rules let through (they are reported, not removed, so the analysis stays
  faithful to the notebook).

All numbers are full counts over the 2019 records, not samples, so they carry
no sampling uncertainty. Output: scripts/out/data_quality.json.
"""

from __future__ import annotations

import json

import duckdb

from common import CACHE, OUT, WORK_DB, Timer, write_json
from pipeline import COLS, ROUND1_RULES, TLC_GLOB

# Why each rule exists (the notebook's intent), keyed by the SQL condition used in pipeline.py.
REASONS = {
    "dropna": "The 2021 model needs every field. TLC left congestion_surcharge empty until 21 January 2019, so this one rule removes almost all of 1-20 January.",
    "trip_distance > 0": "A metered trip cannot cover zero or negative distance: these are cancelled rides, meter tests or voids.",
    "passenger_count BETWEEN 1 AND 6": "Drivers enter the passenger count by hand; 0 means it was not entered, and a yellow cab seats at most 5 adults plus a child.",
    "RatecodeID BETWEEN 1 AND 6": "TLC's data dictionary defines rate codes 1-6; 99 is an undocumented placeholder.",
    "fare_amount > 0": "Negative fares are reversals of an earlier charge, logged as separate rows; zero fares are not paid trips.",
    "extra >= 0": "Negative extras are reversals, like negative fares.",
    "mta_tax BETWEEN 0.5 AND 1": "Every metered trip in New York City pays the $0.50 MTA state surcharge; other values are reversals or out-of-city trips.",
    "tolls_amount >= 0": "Negative tolls are reversals.",
    "improvement_surcharge = 0.30": "The $0.30 improvement surcharge applied to every trip in 2019.",
    "total_amount > 0": "A trip with a non-positive total is a reversal or a void.",
    "congestion_surcharge >= 0": "Negative congestion surcharges are reversals.",
    "pickup_dt BETWEEN TIMESTAMP '2018-01-01 00:00:00' AND TIMESTAMP '2019-12-31 23:59:59'": "Meter clocks occasionally report years like 2003 or 2088. The notebook's window starts in 2018, a year early; the weather join later drops 2018 pickups anyway.",
    "dropoff_dt BETWEEN TIMESTAMP '2019-01-01 00:00:00' AND TIMESTAMP '2019-12-31 23:59:59'": "Drop-offs must fall in the year being studied.",
    "VendorID != 4": "Vendor 4 does not appear in TLC's 2019 data dictionary (1 = Creative Mobile Technologies, 2 = VeriFone).",
}

# Round 2 and 3 rules, applied on the round-1 survivors (z-score threshold from pipeline_report.json).
LATER_RULES = [
    ("fare_zscore", "Fare z-score at most 3", "Fares more than three standard deviations above the mean are treated as keying errors. The standard deviation is inflated by fares up to $671,123, so the cut-off ends up at about $296.", None),
    ("min_fare", "Fare at least $2.50", "$2.50 was the flag-drop charge in 2019, so a metered fare cannot be lower.", "fare_amount >= 2.5"),
    ("positive_duration", "Drop-off after pick-up", "A trip that ends before it starts is a clock error.", "travel_time > 0"),
    ("speed", "Distance / minutes at most 50", "Meant to remove trips faster than 50 mph. The code divides by minutes, so only trips faster than 50 miles a minute go (a quirk kept on purpose).", "trip_distance / travel_time <= 50"),
    ("max_duration", "Trip at most 180 minutes", "Trips over three hours are almost always meters left running.", "travel_time <= 180"),
    ("tip", "Tip at most half the fare", "The comment says 'tips more than twice the fare'; the code keeps tips up to half the fare, and the code is what ran.", "fare_amount >= 2 * tip_amount"),
]

PARTS_NO_CS = "fare_amount + extra + mta_tax + tip_amount + tolls_amount + improvement_surcharge"

# Plausibility checks the 2021 rules did not have, run on the final analysis dataset.
RESIDUAL_CHECKS = [
    ("speed_over_60mph", "Average speed above 60 mph", "trip_distance / (travel_time / 60.0) > 60", "New York City's top speed limit is 50 mph; an average above 60 over a whole trip points to a distance or clock error."),
    ("under_one_minute", "Shorter than one minute", "travel_time < 1", "Rides under a minute are usually cancelled at the kerb or a meter started by mistake."),
    ("tiny_distance_long_time", "Under 0.1 mile but over 30 minutes", "trip_distance < 0.1 AND travel_time > 30", "A meter that recorded time but almost no distance: a stuck odometer or a waiting fare."),
    ("over_50_miles", "Longer than 50 miles", "trip_distance > 50", "Possible for out-of-town fares, but rare enough to check."),
    ("total_excludes_congestion", "Total leaves out the congestion surcharge", f"congestion_surcharge > 0 AND abs(total_amount - ({PARTS_NO_CS})) <= 0.01", "The total equals every other charge but not the $2.50 congestion surcharge recorded on the same row. A vendor reporting convention rather than a pricing error, but any analysis of total fares by vendor would be off by $2.50."),
    ("total_other_mismatch", "Total differs from the sum of its parts (other)", f"abs(total_amount - ({PARTS_NO_CS} + congestion_surcharge)) > 0.01 AND NOT (congestion_surcharge > 0 AND abs(total_amount - ({PARTS_NO_CS})) <= 0.01)", "The total should equal fare + extra + MTA tax + tip + tolls + improvement + congestion surcharges."),
    ("jfk_flat_fare_not_52", "Rate code 2 (JFK) fare not $52", "RatecodeID = 2 AND fare_amount <> 52", "The Manhattan-JFK flat fare was $52 throughout 2019."),
    ("high_fare_per_mile", "Standard rate above $25 per mile (1 mile or more)", "RatecodeID = 1 AND trip_distance >= 1 AND fare_amount / trip_distance > 25", "At $2.50 a mile plus waiting time, a standard-rate fare far above $25 a mile is unlikely."),
]


def main() -> None:
    con = duckdb.connect()
    con.execute("SET memory_limit = '16GB'")
    con.execute(f"SET temp_directory = '{CACHE / 'tmp'}'")
    report = json.loads((OUT / "pipeline_report.json").read_text())
    threshold = report["fare_zscore"]["threshold"]

    select = ", ".join(
        "tpep_pickup_datetime AS pickup_dt" if c == "pickup_dt" else "tpep_dropoff_datetime AS dropoff_dt" if c == "dropoff_dt" else c
        for c in COLS
    )
    with Timer("raw records"):
        con.execute(
            f"""
            CREATE TEMP TABLE raw AS
            SELECT {select}, regexp_extract(filename, '(2019-[0-9]{{2}})', 1) AS source_file
            FROM read_parquet('{TLC_GLOB}', union_by_name=true, filename=true)
            """
        )
        total = con.execute("SELECT count(*) FROM raw").fetchone()[0]
        print(f"     {total:,} raw rows")

    with Timer("missing values"):
        nulls = con.execute(f"SELECT {', '.join(f'count(*) FILTER (WHERE {c} IS NULL)' for c in COLS)} FROM raw").fetchone()
        missing = [{"column": c, "missing": int(n), "share": n / total} for c, n in zip(COLS, nulls)]
        any_null = " OR ".join(f"{c} IS NULL" for c in COLS)
        with_nulls = [c for c, n in zip(COLS, nulls) if n > 0]
        q = f"""
            SELECT source_file, count(*) AS rows, count(*) FILTER (WHERE {any_null}) AS any_missing,
                   {', '.join(f'count(*) FILTER (WHERE {c} IS NULL)' for c in with_nulls)}
            FROM raw GROUP BY 1 ORDER BY 1
        """
        by_file = []
        for r in con.execute(q).fetchall():
            by_file.append(
                {"source_file": r[0], "rows": r[1], "any_missing": r[2], "by_column": dict(zip(with_nulls, r[3:]))}
            )
        # The January gap: missing congestion surcharge by pickup day in the January file.
        jan = con.execute(
            """
            SELECT CAST(pickup_dt AS DATE) AS d, count(*), count(*) FILTER (WHERE congestion_surcharge IS NULL)
            FROM raw WHERE source_file = '2019-01' AND pickup_dt >= TIMESTAMP '2019-01-01' AND pickup_dt < TIMESTAMP '2019-02-01'
            GROUP BY 1 ORDER BY 1
            """
        ).fetchall()
        january = [{"date": str(d), "rows": n, "missing_congestion": m} for d, n, m in jan]

    with Timer("round 1 rules on the dropna() rows"):
        not_null = " AND ".join(f"{c} IS NOT NULL" for c in COLS)
        con.execute(f"CREATE TEMP TABLE dn AS SELECT * FROM raw WHERE {not_null}")
        dn_rows = con.execute("SELECT count(*) FROM dn").fetchone()[0]
        con.execute("DROP TABLE raw")
        fails = [f"(NOT ({r}))::INTEGER" for r, _ in ROUND1_RULES]
        n_fail = " + ".join(fails)
        parts = []
        for r, _ in ROUND1_RULES:
            parts.append(f"count(*) FILTER (WHERE NOT ({r}))")
            parts.append(f"count(*) FILTER (WHERE NOT ({r}) AND ({n_fail}) = 1)")
        row = con.execute(f"SELECT {', '.join(parts)} FROM dn").fetchone()
        seq = {f["note"]: f["revived_rows"] for f in report["funnel"] if f["stage"] == "Round 1" and f["note"]}
        rules = [
            {
                "key": "dropna",
                "stage": "Round 1",
                "label": "Drop rows with any missing value",
                "rule": "dropna()",
                "reason": REASONS["dropna"],
                "applied_to": "raw",
                "applied_rows": total,
                "removed_in_sequence": total - dn_rows,
                "fails_alone": total - dn_rows,
                "fails_only_this": None,
                "top_values": [{"value": f"missing {m['column']}", "rows": m["missing"]} for m in sorted(missing, key=lambda m: -m["missing"]) if m["missing"] > 0][:5],
            }
        ]
        prev = dn_rows
        cols_of = {
            "trip_distance > 0": "trip_distance",
            "passenger_count BETWEEN 1 AND 6": "passenger_count",
            "RatecodeID BETWEEN 1 AND 6": "RatecodeID",
            "fare_amount > 0": "fare_amount",
            "extra >= 0": "extra",
            "mta_tax BETWEEN 0.5 AND 1": "mta_tax",
            "tolls_amount >= 0": "tolls_amount",
            "improvement_surcharge = 0.30": "improvement_surcharge",
            "total_amount > 0": "total_amount",
            "congestion_surcharge >= 0": "congestion_surcharge",
            "pickup_dt BETWEEN TIMESTAMP '2018-01-01 00:00:00' AND TIMESTAMP '2019-12-31 23:59:59'": "year(pickup_dt)",
            "dropoff_dt BETWEEN TIMESTAMP '2019-01-01 00:00:00' AND TIMESTAMP '2019-12-31 23:59:59'": "year(dropoff_dt)",
            "VendorID != 4": "VendorID",
        }
        for i, (r, label) in enumerate(ROUND1_RULES):
            after = seq.get(r)
            if after is None:  # the last rule's survivors are the round-1 checkpoint
                after = next(f["revived_rows"] for f in report["funnel"] if f["key"] == "round1")
            col = cols_of[r]
            top = con.execute(
                f"SELECT CAST({col} AS VARCHAR) AS v, count(*) AS n FROM dn WHERE NOT ({r}) GROUP BY 1 ORDER BY 2 DESC, 1 LIMIT 5"
            ).fetchall()
            rules.append(
                {
                    "key": f"r1_{i + 1}",
                    "stage": "Round 1",
                    "label": label,
                    "rule": r,
                    "reason": REASONS[r],
                    "applied_to": "dropna",
                    "applied_rows": dn_rows,
                    "removed_in_sequence": prev - after,
                    "fails_alone": int(row[2 * i]),
                    "fails_only_this": int(row[2 * i + 1]),
                    "top_values": [{"value": f"{col} = {v}", "rows": int(n)} for v, n in top],
                }
            )
            prev = after

    with Timer("round 2 and 3 rules on the round-1 rows"):
        where1 = " AND ".join(f"({r})" for r, _ in ROUND1_RULES)
        con.execute(
            f"CREATE TEMP TABLE r1 AS SELECT *, (epoch(dropoff_dt) - epoch(pickup_dt)) / 60.0 AS travel_time FROM dn WHERE {where1}"
        )
        r1_rows = con.execute("SELECT count(*) FROM r1").fetchone()[0]
        con.execute("DROP TABLE dn")  # keep the in-memory footprint small
        funnel = {f["key"]: f["revived_rows"] for f in report["funnel"] if f["key"]}
        conds = {k: (c if c else f"fare_amount <= {threshold!r}") for k, _, _, c in LATER_RULES}
        n_fail = " + ".join(f"(NOT ({c}))::INTEGER" for c in conds.values())
        parts = []
        for c in conds.values():
            parts.append(f"count(*) FILTER (WHERE NOT ({c}))")
            parts.append(f"count(*) FILTER (WHERE NOT ({c}) AND ({n_fail}) = 1)")
        row = con.execute(f"SELECT {', '.join(parts)} FROM r1").fetchone()
        top_col = {
            "fare_zscore": "round(fare_amount, -2)",
            "min_fare": "fare_amount",
            "positive_duration": "round(travel_time, 1)",
            "speed": "CASE WHEN travel_time <= 0 THEN 'undefined (zero or negative duration)' ELSE CAST(round(trip_distance / travel_time, -1) AS VARCHAR) END",
            "max_duration": "round(travel_time / 60) || ' h'",
            "tip": "round(tip_amount / fare_amount, 1)",
        }
        top_label = {
            "fare_zscore": "fare (nearest $100)",
            "min_fare": "fare",
            "positive_duration": "minutes",
            "speed": "miles per minute (nearest 10)",
            "max_duration": "duration (hours)",
            "tip": "tip / fare",
        }
        # Rows each step removed in the pipeline's own sequence, keyed by checkpoint key or rule text.
        removed_by: dict[str, int] = {}
        prev_rows = None
        for f in report["funnel"]:
            if prev_rows is not None:
                removed_by[f["key"] or f["note"]] = prev_rows - f["revived_rows"]
            prev_rows = f["revived_rows"]
        seq_removed = {
            "fare_zscore": removed_by["zscore"],
            "min_fare": removed_by["min_fare"],
            "positive_duration": removed_by["travel_time > 0"],
            "speed": removed_by["speed"],
            "max_duration": removed_by["max_duration"],
            "tip": removed_by["tip"],
        }
        for i, (key, label, reason, _) in enumerate(LATER_RULES):
            c = conds[key]
            top = con.execute(
                f"SELECT CAST({top_col[key]} AS VARCHAR), count(*) FROM r1 WHERE NOT ({c}) GROUP BY 1 ORDER BY 2 DESC, 1 LIMIT 5"
            ).fetchall()
            rules.append(
                {
                    "key": key,
                    "stage": "Round 2" if key == "fare_zscore" else "Round 3",
                    "label": label,
                    "rule": c,
                    "reason": reason,
                    "applied_to": "round1",
                    "applied_rows": r1_rows,
                    "removed_in_sequence": seq_removed[key],
                    "fails_alone": int(row[2 * i]),
                    "fails_only_this": int(row[2 * i + 1]),
                    "top_values": [{"value": f"{top_label[key]} = {v}", "rows": int(n)} for v, n in top],
                }
            )
        dedup = removed_by["dedup"]
        rules.insert(
            next(i for i, r in enumerate(rules) if r["key"] == "min_fare"),
            {
                "key": "dedup",
                "stage": "Round 2",
                "label": "Drop exact duplicate rows",
                "rule": "SELECT DISTINCT *",
                "reason": "Identical rows in every field are double submissions from the meter.",
                "applied_to": "zscore",
                "applied_rows": funnel["zscore"],
                "removed_in_sequence": dedup,
                "fails_alone": None,
                "fails_only_this": None,
                "top_values": [],
            },
        )
    con.close()

    with Timer("residual checks on the final analysis dataset"):
        work = duckdb.connect(str(WORK_DB), read_only=True)
        final = work.execute("SELECT count(*) FROM trips").fetchone()[0]
        by_vendor = work.execute(
            f"SELECT VendorID, count(*), {', '.join(f'count(*) FILTER (WHERE {c})' for _, _, c, _ in RESIDUAL_CHECKS)} FROM trips GROUP BY 1 ORDER BY 1"
        ).fetchall()
        residual = []
        for i, (k, label, c, reason) in enumerate(RESIDUAL_CHECKS):
            n = sum(r[2 + i] for r in by_vendor)
            residual.append(
                {
                    "key": k,
                    "label": label,
                    "condition": c,
                    "reason": reason,
                    "rows": int(n),
                    "share": n / final,
                    "by_vendor": [{"vendor": int(r[0]), "rows": int(r[2 + i]), "trips": int(r[1])} for r in by_vendor],
                }
            )
        # When did the surcharge convention start? Monthly share of vendor-1 trips affected.
        monthly = work.execute(
            f"""
            SELECT month(pickup_dt) AS m, VendorID, count(*) FILTER (WHERE {RESIDUAL_CHECKS[4][2]}), count(*)
            FROM trips GROUP BY ALL ORDER BY 1, 2
            """
        ).fetchall()
        surcharge_by_month = [{"month": int(m), "vendor": int(v), "rows": int(a), "trips": int(t)} for m, v, a, t in monthly]
        work.close()
    for r in residual:
        print(f"     {r['label']}: {r['rows']:,} ({100 * r['share']:.3f}%)")

    write_json(
        OUT / "data_quality.json",
        {
            "raw_rows": total,
            "dropna_rows": dn_rows,
            "round1_rows": r1_rows,
            "final_rows": final,
            "missing": missing,
            "missing_by_file": by_file,
            "january": january,
            "rules": rules,
            "residual_checks": residual,
            "surcharge_by_month": surcharge_by_month,
        },
    )


if __name__ == "__main__":
    main()
