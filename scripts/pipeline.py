# /// script
# requires-python = ">=3.11"
# dependencies = ["duckdb>=1.2", "pyshp>=2.3"]
# ///
"""Re-run the original cleaning and merge pipeline with DuckDB.

    uv run scripts/pipeline.py          # needs `uv run scripts/fetch_data.py` first

The notebook (coursework/Project 1 1118472.ipynb, cells 17-176) cleaned the 2019
yellow-taxi trips in four PySpark rounds and merged weather, events and
collisions. Every rule below is a line-for-line translation of a notebook cell,
including its quirks (they are kept on purpose and documented in
scripts/out/pipeline_report.json and on the /method page):

* the "miles per hour" rule divides miles by *minutes* (cell 74), so it only
  drops trips faster than 50 miles per minute;
* the tip rule keeps trips whose tip is at most half the fare (cell 81:
  ``fare_amount >= 2 * tip_amount``), not "tips more than twice the fare";
* the zone rule after the lookup join only drops PU=264 *and* DO=265 (cell 103);
* the model stage joins the shapefile's zone names, where LocationID 56 appears
  twice and 103 three times (57, 104, 105 are missing), so those trips are
  duplicated or dropped exactly as in cell 255.

Outputs (git-ignored, in data-cache/work.duckdb): ``trips`` (the 2019 analysis
dataset = the notebook's final_stage_file) and ``model_rows`` (the regression
input with fold ids), plus scripts/out/pipeline_report.json (committed).
"""

from __future__ import annotations

import duckdb
import shapefile

from common import (
    CACHE,
    NOTEBOOK_COLLISION_ROWS,
    NOTEBOOK_COUNTS,
    NOTEBOOK_EVENT_ROWS_2019,
    NOTEBOOK_FARE_MEAN,
    NOTEBOOK_FARE_STD,
    OUT,
    RAW,
    WORK_DB,
    Timer,
    write_json,
)

TLC_GLOB = str(CACHE / "tlc" / "yellow_tripdata_2019-*.parquet")
COLS = [
    "VendorID",
    "pickup_dt",
    "dropoff_dt",
    "passenger_count",
    "trip_distance",
    "RatecodeID",
    "store_and_fwd_flag",
    "PULocationID",
    "DOLocationID",
    "payment_type",
    "fare_amount",
    "extra",
    "mta_tax",
    "tip_amount",
    "tolls_amount",
    "improvement_surcharge",
    "total_amount",
    "congestion_surcharge",
]

# Round 1 (cell 22). Applied after dropna() (cell 21); listed separately so the
# report can show how many rows each condition removes when applied in order.
ROUND1_RULES = [
    ("trip_distance > 0", "Trip distance must be positive"),
    ("passenger_count BETWEEN 1 AND 6", "Passenger count between 1 and 6"),
    ("RatecodeID BETWEEN 1 AND 6", "Known rate code (drops 99)"),
    ("fare_amount > 0", "Fare must be positive"),
    ("extra >= 0", "Extra charge cannot be negative"),
    ("mta_tax BETWEEN 0.5 AND 1", "MTA tax of $0.50 to $1"),
    ("tolls_amount >= 0", "Tolls cannot be negative"),
    ("improvement_surcharge = 0.30", "Improvement surcharge equals $0.30"),
    ("total_amount > 0", "Total amount must be positive"),
    ("congestion_surcharge >= 0", "Congestion surcharge cannot be negative"),
    (
        "pickup_dt BETWEEN TIMESTAMP '2018-01-01 00:00:00' AND TIMESTAMP '2019-12-31 23:59:59'",
        "Pickup between 2018-01-01 and 2019-12-31",
    ),
    (
        "dropoff_dt BETWEEN TIMESTAMP '2019-01-01 00:00:00' AND TIMESTAMP '2019-12-31 23:59:59'",
        "Drop-off within 2019",
    ),
    ("VendorID != 4", "Drop unknown vendor 4"),
]

# Round 3 (cells 64-84), in notebook order.
ROUND3_RULES = [
    ("fare_amount >= 2.5", "min_fare", "Fare at least the $2.50 flag-fall"),
    ("travel_time > 0", None, "Drop-off after pick-up"),
    ("passenger_count <= 6", None, "At most 6 passengers"),
    ("trip_distance / travel_time <= 50", "speed", "Distance / minutes at most 50 (the 'mph' rule)"),
    ("travel_time <= 180", "max_duration", "Trip at most 180 minutes"),
    ("fare_amount >= 2 * tip_amount", "tip", "Tip at most half the fare"),
]


def count(con: duckdb.DuckDBPyConnection, table: str) -> int:
    return con.execute(f"SELECT count(*) FROM {table}").fetchone()[0]


def sequential_counts(con, table: str, rules: list[str]) -> list[int]:
    """Rows left after applying rules[0..i] in order, in one scan."""
    parts = []
    for i in range(len(rules)):
        cond = " AND ".join(f"({r})" for r in rules[: i + 1])
        parts.append(f"count(*) FILTER (WHERE {cond})")
    return list(con.execute(f"SELECT {', '.join(parts)} FROM {table}").fetchone())


def load_side_tables(con) -> dict:
    info: dict = {}
    # Taxi zone lookup: read every field as text so 'NA', 'NV' and 'N/A' stay strings
    # (Spark's CSV reader kept them as strings too).
    con.execute(
        f"""
        CREATE OR REPLACE TABLE zone_lookup AS
        SELECT CAST(LocationID AS INTEGER) AS LocationID, Borough, Zone, service_zone
        FROM read_csv('{RAW / "taxi_zone_lookup.csv"}', header=true, all_varchar=true, nullstr='\\N')
        """
    )
    # Shapefile attribute table (LocationID, zone) as read by geopandas in cell 184.
    reader = shapefile.Reader(str(RAW / "taxi_zones" / "taxi_zones.shp"))
    recs = [(r["OBJECTID"], r["LocationID"], r["zone"], r["borough"]) for r in reader.records()]
    con.execute("CREATE OR REPLACE TABLE sf_zones (OBJECTID INTEGER, LocationID INTEGER, zone VARCHAR, borough VARCHAR)")
    con.executemany("INSERT INTO sf_zones VALUES (?, ?, ?, ?)", recs)

    # Weather (cells 134-148): drop station columns, TAVG = (TMAX + TMIN) / 2, fillna(0), drop WT04.
    con.execute(
        f"""
        CREATE OR REPLACE TABLE weather AS
        SELECT CAST("DATE" AS DATE) AS date,
               coalesce(PRCP, 0)::DOUBLE AS precipitation,
               coalesce(SNOW, 0)::DOUBLE AS snow,
               coalesce(SNWD, 0)::DOUBLE AS snow_depth,
               ((TMAX + TMIN) / 2.0)::DOUBLE AS tavg,
               TMAX::INTEGER AS tmax, TMIN::INTEGER AS tmin,
               coalesce(WT01, 0)::DOUBLE AS wt01, coalesce(WT02, 0)::DOUBLE AS wt02,
               coalesce(WT03, 0)::DOUBLE AS wt03, coalesce(WT06, 0)::DOUBLE AS wt06,
               coalesce(WT08, 0)::DOUBLE AS wt08
        FROM read_csv('{RAW / "weather.csv"}', header=true)
        """
    )
    # Events (cells 126-152): keep events whose start date is in 2019, count per borough and start date.
    con.execute(
        f"""
        CREATE OR REPLACE TABLE events_daily AS
        SELECT event_borough AS borough, CAST(CAST(start_date_time AS TIMESTAMP) AS DATE) AS date, count(*)::INTEGER AS number_of_event
        FROM read_csv('{RAW / "events_2019.csv"}', header=true, all_varchar=true)
        WHERE year(CAST(start_date_time AS TIMESTAMP)) = 2019 AND event_borough IS NOT NULL
        GROUP BY ALL
        """
    )
    info["event_rows_2019"] = con.execute(
        f"SELECT count(*) FROM read_csv('{RAW / 'events_2019.csv'}', header=true, all_varchar=true)"
    ).fetchone()[0]
    # Collisions (cells 108-124, 163): known borough only, count per borough/date/hour, then sum per day.
    con.execute(
        f"""
        CREATE OR REPLACE TABLE collisions_hourly AS
        SELECT borough, CAST(CAST("timestamp" AS TIMESTAMP) AS DATE) AS date, hour(CAST("timestamp" AS TIMESTAMP)) AS hour,
               count(*)::INTEGER AS collisions
        FROM read_csv('{RAW / "collision.csv"}', header=true, all_varchar=true)
        WHERE borough IS NOT NULL AND borough <> ''
        GROUP BY ALL
        """
    )
    con.execute(
        """
        CREATE OR REPLACE TABLE collisions_daily AS
        SELECT borough, date, sum(collisions)::INTEGER AS number_of_collision
        FROM collisions_hourly GROUP BY ALL
        """
    )
    info["collision_rows_known_borough"] = con.execute("SELECT sum(collisions) FROM collisions_hourly").fetchone()[0]
    return info


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    (CACHE / "tmp").mkdir(parents=True, exist_ok=True)
    con = duckdb.connect(str(WORK_DB))
    con.execute(f"SET temp_directory = '{CACHE / 'tmp'}'")
    con.execute("SET memory_limit = '20GB'")
    con.execute("SET preserve_insertion_order = false")

    funnel: list[dict] = []

    def record(key: str | None, stage: str, label: str, rows: int, note: str = "") -> None:
        original = NOTEBOOK_COUNTS.get(key) if key else None
        funnel.append(
            {
                "key": key,
                "stage": stage,
                "label": label,
                "revived_rows": int(rows),
                "notebook_rows": original,
                "difference_pct": None if original is None else round(100 * (rows - original) / original, 3),
                "note": note,
            }
        )
        extra = "" if original is None else f"  (notebook {original:,}, {100 * (rows - original) / original:+.3f}%)"
        print(f"     {label}: {rows:,}{extra}")

    with Timer("side tables"):
        side = load_side_tables(con)

    with Timer("raw trips"):
        select = ", ".join(
            "tpep_pickup_datetime AS pickup_dt"
            if c == "pickup_dt"
            else "tpep_dropoff_datetime AS dropoff_dt"
            if c == "dropoff_dt"
            else c
            for c in COLS
        )
        con.execute(f"CREATE OR REPLACE TABLE r0 AS SELECT {select} FROM read_parquet('{TLC_GLOB}', union_by_name=true)")
        record("raw", "Raw", "Raw 2019 yellow-taxi records", count(con, "r0"))

    with Timer("round 1"):
        not_null = " AND ".join(f"{c} IS NOT NULL" for c in COLS)
        con.execute(f"CREATE OR REPLACE TABLE r0n AS SELECT * FROM r0 WHERE {not_null}")
        record("dropna", "Round 1", "Drop rows with any missing value", count(con, "r0n"))
        seq = sequential_counts(con, "r0n", [r for r, _ in ROUND1_RULES])
        for (rule, label), n in zip(ROUND1_RULES[:-1], seq[:-1]):
            record(None, "Round 1", label, n, note=rule)
        where = " AND ".join(f"({r})" for r, _ in ROUND1_RULES)
        con.execute(f"CREATE OR REPLACE TABLE r1 AS SELECT * FROM r0n WHERE {where}")
        record("round1", "Round 1", ROUND1_RULES[-1][1] + " (end of round 1)", count(con, "r1"), note=ROUND1_RULES[-1][0])
        con.execute("DROP TABLE r0")

    with Timer("round 2"):
        mean, std = con.execute("SELECT avg(fare_amount), stddev_samp(fare_amount) FROM r1").fetchone()
        print(f"     fare mean {mean} (notebook {NOTEBOOK_FARE_MEAN}), std {std} (notebook {NOTEBOOK_FARE_STD})")
        threshold = mean + 3 * std
        con.execute(f"CREATE OR REPLACE TABLE r2z AS SELECT * FROM r1 WHERE (fare_amount - {mean!r}) / {std!r} <= 3")
        record(
            "zscore",
            "Round 2",
            "Fare z-score at most 3",
            count(con, "r2z"),
            note=f"fare <= mean + 3 sd = {threshold:.4f} (notebook {NOTEBOOK_FARE_MEAN + 3 * NOTEBOOK_FARE_STD:.4f})",
        )
        con.execute("CREATE OR REPLACE TABLE r2 AS SELECT DISTINCT * FROM r2z")
        record("dedup", "Round 2", "Drop exact duplicate rows", count(con, "r2"))
        con.execute("DROP TABLE r1; DROP TABLE r0n; DROP TABLE r2z")

    with Timer("round 3"):
        con.execute(
            "CREATE OR REPLACE TABLE r2t AS SELECT *, (epoch(dropoff_dt) - epoch(pickup_dt)) / 60.0 AS travel_time FROM r2"
        )
        seq = sequential_counts(con, "r2t", [r for r, _, _ in ROUND3_RULES])
        for (rule, key, label), n in zip(ROUND3_RULES, seq):
            record(key, "Round 3", label, n, note=rule)
        where = " AND ".join(f"({r})" for r, _, _ in ROUND3_RULES)
        con.execute(
            f"""
            CREATE OR REPLACE TABLE r3 AS
            SELECT *, trip_distance / travel_time AS driving_speed_miles_per_hour,
                   tip_amount / total_amount AS tip_rate
            FROM r2t WHERE {where}
            """
        )
        con.execute("DROP TABLE r2; DROP TABLE r2t")

    with Timer("zones and merge"):
        con.execute(
            """
            CREATE OR REPLACE TABLE r4 AS
            SELECT r.*, pu.Borough AS pickup_borough, pu.Zone AS pickup_zone, pu.service_zone AS pickup_service_zone,
                   dz.Borough AS dropoff_borough, dz.Zone AS dropoff_zone, dz.service_zone AS dropoff_service_zone,
                   CAST(r.pickup_dt AS DATE) AS pickup_date
            FROM r3 r
            JOIN zone_lookup pu ON r.PULocationID = pu.LocationID
            JOIN zone_lookup dz ON r.DOLocationID = dz.LocationID
            WHERE (r.PULocationID <> 264) OR (r.DOLocationID <> 265)
            """
        )
        record(None, "Merge", "Join taxi zones; drop trips from zone 264 to zone 265", count(con, "r4"))
        con.execute(
            """
            CREATE OR REPLACE TABLE r5 AS
            SELECT r.*, w.precipitation, w.snow, w.snow_depth, w.tavg, w.tmax, w.tmin,
                   w.wt01, w.wt02, w.wt03, w.wt06, w.wt08, e.number_of_event
            FROM r4 r
            JOIN weather w ON r.pickup_date = w.date
            LEFT JOIN events_daily e ON r.pickup_borough = e.borough AND r.pickup_date = e.date
            WHERE r.pickup_zone <> 'NA' AND r.dropoff_zone <> 'NV'
            """
        )
        record("merge", "Merge", "Drop zones NA/NV; join weather (2019 pickups) and events", count(con, "r5"))
        con.execute(
            """
            CREATE OR REPLACE TABLE trips AS
            SELECT r.* EXCLUDE (number_of_event),
                   r.number_of_event,
                   coalesce(c.number_of_collision, 0) AS number_of_collision,
                   r.pickup_borough || '-' || r.dropoff_borough AS route,
                   hour(r.pickup_dt) AS pickup_hour,
                   isodow(r.pickup_dt) AS pickup_isodow,
                   hour(r.dropoff_dt) AS dropoff_hour,
                   isodow(r.dropoff_dt) AS dropoff_isodow
            FROM r5 r
            LEFT JOIN collisions_daily c ON lower(r.pickup_borough) = lower(c.borough) AND r.pickup_date = c.date
            WHERE r.pickup_borough <> 'Unknown' AND r.dropoff_borough <> 'Unknown'
              AND r.pickup_zone <> 'NA' AND r.dropoff_zone <> 'NA'
              AND r.pickup_service_zone <> 'N/A' AND r.dropoff_service_zone <> 'N/A'
            """
        )
        record("final", "Merge", "Join collisions; drop Unknown boroughs (final analysis dataset)", count(con, "trips"))
        con.execute("DROP TABLE r3; DROP TABLE r4; DROP TABLE r5")

    with Timer("model rows"):
        # Cell 255: inner-join the shapefile's (LocationID, zone) on both ends.
        con.execute(
            """
            CREATE OR REPLACE TABLE model_pre AS
            SELECT t.VendorID::INTEGER AS vendor, t.passenger_count::INTEGER AS passenger_count,
                   t.RatecodeID::INTEGER AS ratecode, t.store_and_fwd_flag AS flag,
                   t.travel_time AS y,
                   t.precipitation, t.snow, t.snow_depth, t.tavg, t.wt01, t.wt02, t.wt03, t.wt06, t.wt08,
                   t.number_of_event, t.number_of_collision,
                   spu.zone AS pickup_zone, sdo.zone AS dropoff_zone,
                   hour(t.pickup_dt) AS hour,
                   dayofweek(t.pickup_dt) + 1 AS weekday,  -- Spark dayofweek: 1 = Sunday
                   (hash(t.pickup_dt, t.dropoff_dt, t.PULocationID, t.DOLocationID, t.VendorID,
                         t.total_amount, t.trip_distance) % 10)::INTEGER AS fold
            FROM trips t
            JOIN sf_zones spu ON t.PULocationID = spu.LocationID
            JOIN sf_zones sdo ON t.DOLocationID = sdo.LocationID
            """
        )
        record(None, "Model", "Join shapefile zone names (cell 255)", count(con, "model_pre"))
        # StringIndexer (cell 266) is fitted before dropna: frequency descending, ties alphabetical.
        for zside in ("pickup", "dropoff"):
            con.execute(
                f"""
                CREATE OR REPLACE TABLE {zside}_zone_index AS
                SELECT (row_number() OVER (ORDER BY n DESC, zone ASC) - 1)::INTEGER AS idx, zone, n
                FROM (SELECT {zside}_zone AS zone, count(*) AS n FROM model_pre GROUP BY 1)
                """
            )
        con.execute(
            """
            CREATE OR REPLACE TABLE flag_index AS
            SELECT (row_number() OVER (ORDER BY n DESC, flag ASC) - 1)::INTEGER AS idx, flag, n
            FROM (SELECT flag, count(*) AS n FROM model_pre GROUP BY 1)
            """
        )
        con.execute(
            """
            CREATE OR REPLACE TABLE model_rows AS
            SELECT m.fold, m.y,
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
            FROM model_pre m
            JOIN pickup_zone_index p ON m.pickup_zone = p.zone
            JOIN dropoff_zone_index d ON m.dropoff_zone = d.zone
            JOIN flag_index f ON m.flag = f.flag
            WHERE m.number_of_event IS NOT NULL
            """
        )
        record(None, "Model", "Drop rows without an event count (dropna, cell 269)", count(con, "model_rows"))
        sizes = con.execute(
            "SELECT (SELECT count(*) FROM pickup_zone_index), (SELECT count(*) FROM dropoff_zone_index), (SELECT count(*) FROM flag_index)"
        ).fetchone()
        print(f"     one-hot sizes: pickup {sizes[0]} (notebook 258), dropoff {sizes[1]} (notebook 259), flag {sizes[2]} (notebook 2)")
        con.execute("DROP TABLE model_pre")

    report = {
        "funnel": funnel,
        "fare_zscore": {
            "mean": mean,
            "std": std,
            "threshold": threshold,
            "notebook_mean": NOTEBOOK_FARE_MEAN,
            "notebook_std": NOTEBOOK_FARE_STD,
            "notebook_threshold": NOTEBOOK_FARE_MEAN + 3 * NOTEBOOK_FARE_STD,
        },
        "side_inputs": {
            "event_rows_2019": side["event_rows_2019"],
            "notebook_event_rows_2019": NOTEBOOK_EVENT_ROWS_2019,
            "collision_rows_known_borough": side["collision_rows_known_borough"],
            "notebook_collision_rows_known_borough": NOTEBOOK_COLLISION_ROWS,
        },
        "one_hot_sizes": {"pickup_zone": sizes[0], "dropoff_zone": sizes[1], "flag": sizes[2]},
    }
    write_json(OUT / "pipeline_report.json", report)
    con.execute("CHECKPOINT")
    con.close()


if __name__ == "__main__":
    main()
