# /// script
# requires-python = ">=3.11"
# dependencies = ["duckdb>=1.2"]
# ///
"""Day-level aggregates for the rain and event effects (the statistics run in web/src/lib/effects.ts).

    uv run scripts/effects.py           # after pipeline.py

Comparing raw trip times between rainy and dry days mixes two things: rain may
slow traffic, and rain changes *which* trips people take (more short hops,
fewer airport runs). To separate them, every trip is compared with the median
of its own route and hour:

    log_ratio = ln(minutes / median minutes of the same pickup zone -> drop-off zone at the same hour, 2019)

Only route-hours with at least 20 trips get a reference median. The mean of
log_ratio over a day (or a borough-day) is a composition-adjusted duration
index: exp(mean) - 1 is "how much longer than usual the same trips took".

Writes scripts/out/effects.json: one row per day (citywide, with weather and
totals) and one row per day and pickup borough (with that borough's permitted
events and collisions). No individual trip leaves the work database.
"""

from __future__ import annotations

import duckdb

from common import OUT, WORK_DB, Timer, write_json

MIN_CELL = 20


def main() -> None:
    con = duckdb.connect(str(WORK_DB), read_only=True)
    con.execute("SET memory_limit = '20GB'")
    with Timer("route x hour reference medians"):
        con.execute(
            f"""
            CREATE TEMP TABLE ref AS
            SELECT PULocationID, DOLocationID, pickup_hour, median(travel_time) AS ref_min
            FROM trips GROUP BY ALL HAVING count(*) >= {MIN_CELL}
            """
        )
        cells = con.execute("SELECT count(*) FROM ref").fetchone()[0]
    with Timer("daily and borough-daily indices"):
        rows = con.execute(
            """
            WITH t AS (
                SELECT t.pickup_date, t.pickup_borough, t.travel_time,
                       CASE WHEN r.ref_min > 0 THEN ln(t.travel_time / r.ref_min) END AS lr
                FROM trips t
                LEFT JOIN ref r USING (PULocationID, DOLocationID, pickup_hour)
            )
            SELECT pickup_date, coalesce(pickup_borough, '(all)') AS borough,
                   count(*) AS trips, count(lr) AS indexed_trips,
                   avg(travel_time) AS mean_min, median(travel_time) AS median_min,
                   avg(lr) AS mean_log_ratio, stddev_samp(lr) AS sd_log_ratio
            FROM t
            GROUP BY GROUPING SETS ((pickup_date), (pickup_date, pickup_borough))
            ORDER BY 1, 2
            """
        ).fetchall()
        weather = {
            str(r[0]): r[1:]
            for r in con.execute("SELECT date, precipitation, snow, snow_depth, tavg FROM weather").fetchall()
        }
        events = {
            (str(d), b): n for d, b, n in con.execute("SELECT date, borough, number_of_event FROM events_daily").fetchall()
        }
        collisions = {
            (str(d), b.lower()): n
            for d, b, n in con.execute("SELECT date, borough, number_of_collision FROM collisions_daily").fetchall()
        }
        total_trips, indexed = con.execute(
            "SELECT count(*), count(r.ref_min) FROM trips t LEFT JOIN ref r USING (PULocationID, DOLocationID, pickup_hour)"
        ).fetchone()
    con.close()

    daily, borough_daily = [], []
    for d, b, trips, idx, mean_min, med, mlr, sdlr in rows:
        date = str(d)
        w = weather[date]
        base = {
            "date": date,
            "trips": int(trips),
            "indexed_trips": int(idx),
            "mean_min": round(float(mean_min), 4),
            "median_min": round(float(med), 4),
            "mean_log_ratio": None if mlr is None else round(float(mlr), 6),
            "sd_log_ratio": None if sdlr is None else round(float(sdlr), 6),
        }
        if b == "(all)":
            daily.append(
                {
                    **base,
                    "precipitation": w[0],
                    "snow": w[1],
                    "snow_depth": w[2],
                    "tavg": w[3],
                    "events": int(sum(n for (dd, _), n in events.items() if dd == date)),
                    "collisions": int(sum(n for (dd, _), n in collisions.items() if dd == date)),
                }
            )
        else:
            borough_daily.append(
                {
                    **base,
                    "borough": b,
                    "precipitation": w[0],
                    "tavg": w[3],
                    "events": events.get((date, b)),
                    "collisions": int(collisions.get((date, b.lower()), 0)),
                }
            )
    print(f"     {len(daily)} days, {len(borough_daily)} borough-days, {indexed / total_trips:.4%} of trips indexed")
    write_json(
        OUT / "effects.json",
        {
            "reference": {"min_cell": MIN_CELL, "cells": cells, "trips": total_trips, "indexed_trips": indexed},
            "daily": daily,
            "borough_daily": borough_daily,
        },
    )


if __name__ == "__main__":
    main()
