# /// script
# requires-python = ">=3.11"
# dependencies = ["duckdb>=1.2", "pyshp>=2.3", "pyproj>=3.6", "shapely>=2.0"]
# ///
"""Aggregate the revived 2019 analysis dataset into the web app's artefacts.

    uv run scripts/build_analytics.py   # after pipeline.py and fit_model.py

Writes
* web/data/analytics.db      read-only SQLite, aggregates only (no trip rows)
* web/public/data/zones.geojson     simplified taxi-zone polygons (WGS84)
* web/public/data/boroughs.geojson  borough outlines, the offline basemap
* web/src/lib/data/hero-map.json    pre-projected SVG paths for the landing page
* web/src/lib/data/model.json       coefficients + zone indexes for the estimator
* the evidence tables of build_evidence_tables.py (when scripts/out holds their inputs)

Every number in analytics.db is derived from data-cache/work.duckdb (built by
pipeline.py from public TLC/NOAA/NYC Open Data files) and scripts/out/*.json.
"""

from __future__ import annotations

import json
import math
import sqlite3

import duckdb
import shapefile
from pyproj import CRS, Transformer
from shapely.geometry import mapping, shape
from shapely.ops import transform, unary_union

import build_evidence_tables
from common import ANALYTICS_DB, OUT, PUBLIC_DATA, RAW, WEB, WORK_DB, Timer, write_json

BOROUGHS = ["Manhattan", "Brooklyn", "Queens", "Bronx", "Staten Island", "EWR"]

TABLE_DOCS = {
    "zones": (
        "Taxi zones",
        "One row per TLC taxi zone: borough, service zone, the zone name the 2021 model used, map centroid and yearly pickups/drop-offs.",
    ),
    "zone_hourly": (
        "Zone x weekday x hour",
        "Trips and trip-duration statistics per zone, ISO weekday (1 = Monday, 0 = all days) and hour (24 = all day), for pickups (pickup time) and drop-offs (drop-off time).",
    ),
    "zone_vendor": ("Zone x vendor", "Yearly trips per zone and vendor, the data behind the 2021 vendor choropleths."),
    "routes": (
        "Zone-to-zone routes",
        "Every pickup zone to drop-off zone pair seen in 2019 with trips, median and mean minutes, distance, fare and speed.",
    ),
    "route_hourly": (
        "Route x hour",
        "Hourly trips and median minutes for zone pairs with at least 1,000 trips in 2019.",
    ),
    "borough_flows": ("Borough flows", "Trips between boroughs (the 2021 'route' feature), with median minutes."),
    "daily": (
        "Daily series",
        "One row per day of 2019: trips, duration statistics, NOAA Central Park weather, permitted events and collisions (summed over boroughs).",
    ),
    "daily_borough": ("Daily x borough", "Pickups, median minutes, permitted events and collisions per day and borough."),
    "weekday_hour_vendor": (
        "Weekday x hour x vendor",
        "Mean and median trip minutes per ISO weekday, pickup hour and vendor (0 = both), as in the 2021 vendor line charts.",
    ),
    "weather": ("NOAA weather", "Daily Central Park weather after the notebook's cleaning: TAVG = (TMAX + TMIN) / 2, gaps filled with 0, WT04 dropped."),
    "events_daily": ("Permitted events", "Permitted events starting each day per borough (NYC Open Data bkfu-528j, current version)."),
    "collisions_hourly": ("Collisions", "NYPD motor-vehicle collisions per borough, day and hour (2021 BigQuery export)."),
    "cleaning_funnel": (
        "Cleaning funnel",
        "Rows left after every cleaning rule, revived pipeline next to the counts printed by the 2021 notebook.",
    ),
    "model_folds": (
        "Cross-validation folds",
        "R^2 and RMSE per fold: the 2021 notebook, the 2021 coefficients scored on the revived folds, and the 2026 refit.",
    ),
    "model_path": (
        "Regularisation path",
        "Mean 10-fold R^2, RMSE and number of non-zero coefficients for several regParam values at the notebook's elasticNetParam = 0.8.",
    ),
    "model_coefficients": (
        "Model coefficients",
        "All 579 regression coefficients in VectorAssembler order: 2021 fold 1 next to the 2026 refit.",
    ),
    "model_zone_index": (
        "Zone name index",
        "Spark StringIndexer order of pickup and drop-off zone names (most trips first), rebuilt from the revived data.",
    ),
}


def round_or_none(v, nd=3):
    return None if v is None else round(float(v), nd)


def load_geometry():
    """Shapefile polygons, reprojected to WGS84 and keyed by the *corrected* LocationID.

    The TLC shapefile labels OBJECTID 57 as LocationID 56 and OBJECTIDs 104/105 as
    103. For the map we key polygons by OBJECTID (which equals the intended
    LocationID), so zones 57, 104 and 105 get their own shapes. The model stage
    keeps the original (duplicated) labels, as the notebook did.
    """
    prj = (RAW / "taxi_zones" / "taxi_zones.prj").read_text()
    tf = Transformer.from_crs(CRS.from_wkt(prj), CRS.from_epsg(4326), always_xy=True)
    reader = shapefile.Reader(str(RAW / "taxi_zones" / "taxi_zones.shp"))
    polys = {}
    for sr in reader.shapeRecords():
        rec = sr.record
        geom = transform(tf.transform, shape(sr.shape.__geo_interface__))
        polys[int(rec["OBJECTID"])] = geom
    return polys


def round_coords(geom_json, nd=5):
    def r(c):
        if isinstance(c[0], (int, float)):
            return [round(c[0], nd), round(c[1], nd)]
        return [r(x) for x in c]

    geom_json["coordinates"] = r(geom_json["coordinates"])
    return geom_json


def write_geo(polys, lookup):
    features = []
    by_borough: dict[str, list] = {}
    for oid, geom in sorted(polys.items()):
        meta = lookup[oid]
        simple = geom.simplify(0.00012, preserve_topology=True)
        features.append(
            {
                "type": "Feature",
                "id": oid,
                "properties": {"id": oid, "zone": meta["zone"], "borough": meta["borough"]},
                "geometry": round_coords(dict(mapping(simple))),
            }
        )
        by_borough.setdefault(meta["borough"], []).append(geom.buffer(0.0002))
    PUBLIC_DATA.mkdir(parents=True, exist_ok=True)
    (PUBLIC_DATA / "zones.geojson").write_text(
        json.dumps({"type": "FeatureCollection", "features": features}, separators=(",", ":"))
    )
    print(f"     wrote zones.geojson ({(PUBLIC_DATA / 'zones.geojson').stat().st_size / 1024:.0f} KB)")
    bfeat = []
    for b, geoms in by_borough.items():
        merged = unary_union(geoms).buffer(-0.0002).simplify(0.0004, preserve_topology=True)
        bfeat.append(
            {"type": "Feature", "properties": {"borough": b}, "geometry": round_coords(dict(mapping(merged)), 4)}
        )
    (PUBLIC_DATA / "boroughs.geojson").write_text(
        json.dumps({"type": "FeatureCollection", "features": bfeat}, separators=(",", ":"))
    )
    print(f"     wrote boroughs.geojson ({(PUBLIC_DATA / 'boroughs.geojson').stat().st_size / 1024:.0f} KB)")


def hero_paths(polys, lookup, pickups: dict[int, int]):
    """Pre-projected SVG paths (Web Mercator, 1000 px wide) for the landing-page map."""
    zones = [(oid, g) for oid, g in polys.items() if lookup[oid]["borough"] != "EWR"]
    minx = min(g.bounds[0] for _, g in zones)
    maxx = max(g.bounds[2] for _, g in zones)
    miny = min(g.bounds[1] for _, g in zones)
    maxy = max(g.bounds[3] for _, g in zones)

    def merc(lon, lat):
        return lon, math.degrees(math.log(math.tan(math.pi / 4 + math.radians(lat) / 2)))

    x0, y0 = merc(minx, miny)
    x1, y1 = merc(maxx, maxy)
    width = 1000.0
    scale = width / (x1 - x0)
    height = (y1 - y0) * scale

    def proj(lon, lat):
        x, y = merc(lon, lat)
        return round((x - x0) * scale, 1), round((y1 - y) * scale, 1)

    out = []
    for oid, g in sorted(zones):
        simple = g.simplify(0.0006, preserve_topology=True)
        parts = list(simple.geoms) if simple.geom_type == "MultiPolygon" else [simple]
        d = []
        for p in parts:
            for ring in [p.exterior, *p.interiors]:
                pts = [proj(x, y) for x, y in ring.coords]
                if len(pts) < 4:
                    continue
                d.append("M" + "L".join(f"{x:g},{y:g}" for x, y in pts) + "Z")
        if d:
            out.append({"id": oid, "borough": lookup[oid]["borough"], "trips": pickups.get(oid, 0), "d": "".join(d)})
    return {"width": width, "height": round(height, 1), "zones": out}


def main() -> None:
    con = duckdb.connect(str(WORK_DB), read_only=True)
    con.execute("SET memory_limit = '20GB'")
    report = json.loads((OUT / "pipeline_report.json").read_text())
    model_report = json.loads((OUT / "model.json").read_text())

    if ANALYTICS_DB.exists():
        ANALYTICS_DB.unlink()
    ANALYTICS_DB.parent.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(ANALYTICS_DB)
    db.execute("PRAGMA journal_mode = DELETE")

    def put(name: str, ddl: str, rows) -> None:
        cols = ddl.count(",") + 1
        db.execute(f"CREATE TABLE {name} ({ddl})")
        db.executemany(f"INSERT INTO {name} VALUES ({', '.join('?' * cols)})", rows)
        n = db.execute(f"SELECT count(*) FROM {name}").fetchone()[0]
        print(f"     {name}: {n:,} rows")

    with Timer("geometry"):
        polys = load_geometry()
        lookup_rows = con.execute("SELECT LocationID, Borough, Zone, service_zone FROM zone_lookup ORDER BY 1").fetchall()
        lookup = {r[0]: {"borough": r[1], "zone": r[2], "service_zone": r[3]} for r in lookup_rows}
        write_geo(polys, lookup)

    with Timer("zones"):
        sf_names = dict(con.execute("SELECT LocationID, any_value(zone) FROM sf_zones GROUP BY 1").fetchall())
        # zones 57, 104 and 105 share a name with 56/103 in the shapefile; the model sees those names
        sf_names.setdefault(57, sf_names.get(56))
        sf_names.setdefault(104, sf_names.get(103))
        sf_names.setdefault(105, sf_names.get(103))
        pickups = dict(con.execute("SELECT PULocationID, count(*) FROM trips GROUP BY 1").fetchall())
        dropoffs = dict(con.execute("SELECT DOLocationID, count(*) FROM trips GROUP BY 1").fetchall())
        rows = []
        for lid, meta in lookup.items():
            g = polys.get(lid)
            if g is None:
                c = None
            else:
                c = g.centroid if g.centroid.within(g) else g.representative_point()
            rows.append(
                (
                    lid,
                    meta["borough"],
                    meta["zone"],
                    meta["service_zone"],
                    sf_names.get(lid),
                    1 if g is not None else 0,
                    round(c.x, 5) if c else None,
                    round(c.y, 5) if c else None,
                    int(pickups.get(lid, 0)),
                    int(dropoffs.get(lid, 0)),
                )
            )
        put(
            "zones",
            "location_id INTEGER PRIMARY KEY, borough TEXT, zone TEXT, service_zone TEXT, model_zone_name TEXT, has_polygon INTEGER, centroid_lon REAL, centroid_lat REAL, pickups INTEGER, dropoffs INTEGER",
            rows,
        )
        write_json(WEB / "src" / "lib" / "data" / "hero-map.json", hero_paths(polys, lookup, pickups))

    with Timer("zone x weekday x hour"):
        rows = []
        for side, lid_col, ts in (("pickup", "PULocationID", "pickup"), ("dropoff", "DOLocationID", "dropoff")):
            q = f"""
                SELECT '{side}', {lid_col}, coalesce({ts}_isodow, 0) AS d, coalesce({ts}_hour, 24) AS h,
                       count(*), median(travel_time), avg(travel_time)
                FROM trips GROUP BY GROUPING SETS (
                    ({lid_col}, {ts}_isodow, {ts}_hour), ({lid_col}, {ts}_hour), ({lid_col}, {ts}_isodow), ({lid_col})
                )
            """
            for r in con.execute(q).fetchall():
                rows.append((r[0], r[1], r[2], r[3], r[4], round_or_none(r[5]), round_or_none(r[6])))
        put(
            "zone_hourly",
            "side TEXT, location_id INTEGER, isodow INTEGER, hour INTEGER, trips INTEGER, median_min REAL, mean_min REAL",
            rows,
        )
        db.execute("CREATE INDEX zone_hourly_slice ON zone_hourly (side, isodow)")
        rows = []
        for side, lid_col in (("pickup", "PULocationID"), ("dropoff", "DOLocationID")):
            for r in con.execute(f"SELECT {lid_col}, VendorID, count(*) FROM trips GROUP BY ALL").fetchall():
                rows.append((side, r[0], r[1], r[2]))
        put("zone_vendor", "side TEXT, location_id INTEGER, vendor INTEGER, trips INTEGER", rows)

    with Timer("routes"):
        q = """
            SELECT PULocationID, DOLocationID, count(*), median(travel_time), avg(travel_time),
                   avg(trip_distance), avg(fare_amount), avg(trip_distance / (travel_time / 60.0))
            FROM trips GROUP BY ALL
        """
        rows = [
            (r[0], r[1], r[2], round_or_none(r[3]), round_or_none(r[4]), round_or_none(r[5]), round_or_none(r[6], 2), round_or_none(r[7], 2))
            for r in con.execute(q).fetchall()
        ]
        put(
            "routes",
            "pu_id INTEGER, do_id INTEGER, trips INTEGER, median_min REAL, mean_min REAL, mean_miles REAL, mean_fare REAL, mean_mph REAL",
            rows,
        )
        db.execute("CREATE INDEX routes_pu ON routes (pu_id)")
        db.execute("CREATE INDEX routes_do ON routes (do_id)")
        q = """
            WITH big AS (SELECT PULocationID, DOLocationID FROM trips GROUP BY ALL HAVING count(*) >= 1000)
            SELECT t.PULocationID, t.DOLocationID, t.pickup_hour, count(*), median(t.travel_time)
            FROM trips t JOIN big USING (PULocationID, DOLocationID) GROUP BY ALL
        """
        rows = [(r[0], r[1], r[2], r[3], round_or_none(r[4])) for r in con.execute(q).fetchall()]
        put("route_hourly", "pu_id INTEGER, do_id INTEGER, hour INTEGER, trips INTEGER, median_min REAL", rows)
        db.execute("CREATE INDEX route_hourly_pair ON route_hourly (pu_id, do_id)")
        q = """
            SELECT pickup_borough, dropoff_borough, count(*), median(travel_time)
            FROM trips GROUP BY ALL ORDER BY 3 DESC
        """
        put(
            "borough_flows",
            "pickup_borough TEXT, dropoff_borough TEXT, trips INTEGER, median_min REAL",
            [(r[0], r[1], r[2], round_or_none(r[3])) for r in con.execute(q).fetchall()],
        )

    with Timer("daily"):
        q = """
            WITH d AS (
                SELECT pickup_date AS date, count(*) AS trips, median(travel_time) AS med, avg(travel_time) AS mean,
                       avg(trip_distance) AS miles, avg(fare_amount) AS fare
                FROM trips GROUP BY 1
            ),
            ev AS (SELECT date, sum(number_of_event) AS events FROM events_daily GROUP BY 1),
            co AS (SELECT date, sum(number_of_collision) AS collisions FROM collisions_daily GROUP BY 1)
            SELECT strftime(w.date, '%Y-%m-%d'), isodow(w.date), coalesce(d.trips, 0), d.med, d.mean, d.miles, d.fare,
                   w.precipitation, w.snow, w.snow_depth, w.tavg, w.tmax, w.tmin, w.wt01, w.wt02, w.wt03, w.wt06, w.wt08,
                   coalesce(ev.events, 0), coalesce(co.collisions, 0)
            FROM weather w LEFT JOIN d ON d.date = w.date LEFT JOIN ev ON ev.date = w.date LEFT JOIN co ON co.date = w.date
            ORDER BY 1
        """
        rows = []
        for r in con.execute(q).fetchall():
            rows.append(
                (r[0], r[1], r[2], round_or_none(r[3]), round_or_none(r[4]), round_or_none(r[5]), round_or_none(r[6], 2), *r[7:])
            )
        put(
            "daily",
            "date TEXT PRIMARY KEY, isodow INTEGER, trips INTEGER, median_min REAL, mean_min REAL, mean_miles REAL, mean_fare REAL, "
            "precipitation REAL, snow REAL, snow_depth REAL, tavg REAL, tmax INTEGER, tmin INTEGER, wt01 REAL, wt02 REAL, wt03 REAL, wt06 REAL, wt08 REAL, "
            "events INTEGER, collisions INTEGER",
            rows,
        )
        q = """
            WITH d AS (
                SELECT pickup_date AS date, pickup_borough AS borough, count(*) AS trips, median(travel_time) AS med
                FROM trips GROUP BY ALL
            ),
            keys AS (
                SELECT w.date, b.borough FROM weather w,
                (SELECT unnest(['Manhattan', 'Brooklyn', 'Queens', 'Bronx', 'Staten Island']) AS borough) b
            )
            SELECT strftime(k.date, '%Y-%m-%d'), k.borough, coalesce(d.trips, 0), d.med,
                   e.number_of_event, coalesce(c.number_of_collision, 0)
            FROM keys k
            LEFT JOIN d ON d.date = k.date AND d.borough = k.borough
            LEFT JOIN events_daily e ON e.date = k.date AND e.borough = k.borough
            LEFT JOIN collisions_daily c ON c.date = k.date AND lower(c.borough) = lower(k.borough)
            ORDER BY 1, 2
        """
        put(
            "daily_borough",
            "date TEXT, borough TEXT, pickups INTEGER, median_min REAL, events INTEGER, collisions INTEGER",
            [(r[0], r[1], r[2], round_or_none(r[3]), r[4], r[5]) for r in con.execute(q).fetchall()],
        )
        db.execute("CREATE INDEX daily_borough_date ON daily_borough (date)")
        q = """
            SELECT coalesce(VendorID, 0), pickup_isodow, pickup_hour, count(*), avg(travel_time), median(travel_time)
            FROM trips GROUP BY GROUPING SETS ((VendorID, pickup_isodow, pickup_hour), (pickup_isodow, pickup_hour))
            ORDER BY 1, 2, 3
        """
        put(
            "weekday_hour_vendor",
            "vendor INTEGER, isodow INTEGER, hour INTEGER, trips INTEGER, mean_min REAL, median_min REAL",
            [(r[0], r[1], r[2], r[3], round_or_none(r[4], 4), round_or_none(r[5])) for r in con.execute(q).fetchall()],
        )

    with Timer("side tables"):
        put(
            "weather",
            "date TEXT PRIMARY KEY, precipitation REAL, snow REAL, snow_depth REAL, tavg REAL, tmax INTEGER, tmin INTEGER, wt01 REAL, wt02 REAL, wt03 REAL, wt06 REAL, wt08 REAL",
            con.execute(
                "SELECT strftime(date, '%Y-%m-%d'), precipitation, snow, snow_depth, tavg, tmax, tmin, wt01, wt02, wt03, wt06, wt08 FROM weather ORDER BY 1"
            ).fetchall(),
        )
        put(
            "events_daily",
            "borough TEXT, date TEXT, number_of_event INTEGER",
            con.execute("SELECT borough, strftime(date, '%Y-%m-%d'), number_of_event FROM events_daily ORDER BY 2, 1").fetchall(),
        )
        put(
            "collisions_hourly",
            "borough TEXT, date TEXT, hour INTEGER, collisions INTEGER",
            con.execute(
                "SELECT borough, strftime(date, '%Y-%m-%d'), hour, collisions FROM collisions_hourly ORDER BY 2, 3, 1"
            ).fetchall(),
        )

    with Timer("funnel and model"):
        put(
            "cleaning_funnel",
            "step INTEGER, stage TEXT, label TEXT, rule TEXT, revived_rows INTEGER, notebook_rows INTEGER, difference_pct REAL",
            [
                (i + 1, f["stage"], f["label"], f["note"], f["revived_rows"], f["notebook_rows"], f["difference_pct"])
                for i, f in enumerate(report["funnel"])
            ],
        )
        put(
            "model_folds",
            "fold INTEGER, test_rows INTEGER, notebook_r2 REAL, notebook_rmse REAL, original_on_revived_r2 REAL, original_on_revived_rmse REAL, refit_r2 REAL, refit_rmse REAL, refit_nonzero INTEGER",
            [
                (
                    f["fold"] + 1,
                    f["test_rows"],
                    f["original_r2_2021"],
                    f["original_rmse_2021"],
                    f["original_coefficients_on_revived_r2"],
                    f["original_coefficients_on_revived_rmse"],
                    f["refit_r2"],
                    f["refit_rmse"],
                    f["refit_nonzero"],
                )
                for f in model_report["folds"]
            ],
        )
        put(
            "model_path",
            "reg_param REAL, elastic_net_param REAL, cv_r2 REAL, cv_rmse REAL, nonzero REAL",
            [(p["reg_param"], 0.8, p["cv_r2"], p["cv_rmse"], p["nonzero"]) for p in model_report["path"]],
        )
        labels = json.loads((OUT / "feature_labels.json").read_text())
        orig = model_report["original"]["coefficients"]
        refit = model_report["refit"]["coefficients"]
        put(
            "model_coefficients",
            "feature_index INTEGER PRIMARY KEY, block TEXT, level INTEGER, label TEXT, original_2021 REAL, refit_2026 REAL",
            [(l["index"], l["block"], l["level"], l["label"], orig[l["index"]], refit[l["index"]]) for l in labels],
        )
        rows = [("pickup", z["index"], z["zone"], z["trips"]) for z in model_report["pickupZones"]]
        rows += [("dropoff", z["index"], z["zone"], z["trips"]) for z in model_report["dropoffZones"]]
        put("model_zone_index", "side TEXT, idx INTEGER, zone TEXT, trips INTEGER", rows)

    put(
        "meta_tables",
        "name TEXT PRIMARY KEY, title TEXT, description TEXT",
        [(k, t, d) for k, (t, d) in TABLE_DOCS.items()],
    )
    db.commit()
    db.execute("VACUUM")
    db.close()
    print(f"     analytics.db: {ANALYTICS_DB.stat().st_size / 1e6:.1f} MB")

    # model artefact for the in-browser estimator (coefficients + zone indexes, no trips)
    est = {
        "blocks": model_report["blocks"],
        "pickupZones": [z["zone"] for z in model_report["pickupZones"]],
        "dropoffZones": [z["zone"] for z in model_report["dropoffZones"]],
        "flags": model_report["flags"],
        "original": {
            "label": model_report["original"]["label"],
            "intercept": model_report["original"]["intercept"],
            "coefficients": model_report["original"]["coefficients"],
        },
        "refit": {
            "label": model_report["refit"]["label"],
            "intercept": model_report["refit"]["intercept"],
            "coefficients": model_report["refit"]["coefficients"],
        },
        "summary": model_report["summary"],
    }
    write_json(WEB / "src" / "lib" / "data" / "model.json", est)

    # rigour, effects and data-quality tables (scripts/rigour.py, effects.py, data_quality.py)
    if all((OUT / f).exists() for f in ("rigour.json", "effects.json", "data_quality.json")):
        with Timer("evidence tables"):
            build_evidence_tables.main()
    else:
        print("     skipped the evidence tables: run rigour.py, effects.py and data_quality.py first")


if __name__ == "__main__":
    main()
