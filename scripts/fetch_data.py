# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""Fetch every raw input the revived pipeline needs into ``data-cache/`` (git-ignored).

Run from the repository root::

    uv run scripts/fetch_data.py

What it fetches, and why each source differs from 2021:

* **2019 TLC yellow-taxi trips**: the S3 CSV bucket the original download script
  used (``s3.amazonaws.com/nyc-tlc``) is gone. TLC now publishes the same months
  as Parquet on its CloudFront CDN, so we pull the 12 monthly Parquet files.
* **Car collisions, NOAA weather, taxi-zone lookup and shapefile**: the exact
  files the notebook used are inside the original classroom snapshot
  ``coursework/mast30034_2021_s2_project_1-chuangyu-hscy-main.zip``. We extract
  them from there, so these inputs are byte-identical to 2021.
* **NYC permitted events**: the notebook downloaded the whole historical CSV and
  kept events whose start date is in 2019. We ask the NYC Open Data API for only
  those rows and the four columns the notebook used (id, start, end, borough).

Nothing here is served by the website: the web app only ships aggregates.
"""

from __future__ import annotations

import csv
import io
import json
import sys
import time
import urllib.parse
import urllib.request
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / "data-cache"
ZIP = ROOT / "coursework" / "mast30034_2021_s2_project_1-chuangyu-hscy-main.zip"
ZIP_PREFIX = "mast30034_2021_s2_project_1-chuangyu-hscy-main/Data/"

TLC_URL = "https://d37ci6vzurychx.cloudfront.net/trip-data/yellow_tripdata_2019-{m:02d}.parquet"
EVENTS_URL = "https://data.cityofnewyork.us/resource/bkfu-528j.json"
UA = "mast30034-nyc-taxi-revival/1.0 (+https://github.com/rNLKJA/Unimelb-undergraduate-2021-MAST30034-Project-1)"

# files to extract from the 2021 snapshot -> destination under data-cache/raw
FROM_ZIP = {
    "2019 car collision/collision.csv": "collision.csv",
    "2019 weather data/2019 weather data.csv": "weather.csv",
    "taxi_zone/taxi_zone_lookup.csv": "taxi_zone_lookup.csv",
    "taxi_zone/taxi_zones/taxi_zones.shp": "taxi_zones/taxi_zones.shp",
    "taxi_zone/taxi_zones/taxi_zones.shx": "taxi_zones/taxi_zones.shx",
    "taxi_zone/taxi_zones/taxi_zones.dbf": "taxi_zones/taxi_zones.dbf",
    "taxi_zone/taxi_zones/taxi_zones.prj": "taxi_zones/taxi_zones.prj",
}


def download(url: str, dest: Path) -> None:
    if dest.exists() and dest.stat().st_size > 0:
        print(f"  cached  {dest.relative_to(ROOT)}")
        return
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(dest.suffix + ".part")
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    for attempt in range(1, 4):
        try:
            with urllib.request.urlopen(req, timeout=120) as r, open(tmp, "wb") as f:
                while chunk := r.read(1 << 20):
                    f.write(chunk)
            tmp.rename(dest)
            print(f"  fetched {dest.relative_to(ROOT)} ({dest.stat().st_size / 1e6:.1f} MB)")
            return
        except Exception as exc:  # network hiccup: retry a couple of times
            print(f"  retry {attempt} for {url}: {exc}", file=sys.stderr)
            time.sleep(3 * attempt)
    raise SystemExit(f"could not download {url}")


def fetch_tlc() -> None:
    print("TLC 2019 yellow-taxi trips (Parquet)")
    for m in range(1, 13):
        download(TLC_URL.format(m=m), CACHE / "tlc" / f"yellow_tripdata_2019-{m:02d}.parquet")


def extract_snapshot() -> None:
    print("Collision, weather and taxi-zone files from the 2021 snapshot zip")
    with zipfile.ZipFile(ZIP) as z:
        for src, dst in FROM_ZIP.items():
            out = CACHE / "raw" / dst
            if out.exists():
                print(f"  cached  {out.relative_to(ROOT)}")
                continue
            out.parent.mkdir(parents=True, exist_ok=True)
            out.write_bytes(z.read(ZIP_PREFIX + src))
            print(f"  wrote   {out.relative_to(ROOT)}")


def fetch_events() -> None:
    """2019 permitted events (start date in 2019), paged through the SODA API."""
    print("NYC permitted events starting in 2019 (NYC Open Data bkfu-528j)")
    out = CACHE / "raw" / "events_2019.csv"
    if out.exists():
        print(f"  cached  {out.relative_to(ROOT)}")
        return
    rows: list[dict[str, str]] = []
    page = 50_000
    offset = 0
    while True:
        params = {
            "$select": "event_id,start_date_time,end_date_time,event_borough",
            "$where": "start_date_time >= '2019-01-01T00:00:00' AND start_date_time < '2020-01-01T00:00:00'",
            "$order": ":id",
            "$limit": str(page),
            "$offset": str(offset),
        }
        url = EVENTS_URL + "?" + urllib.parse.urlencode(params)
        req = urllib.request.Request(url, headers={"User-Agent": UA})
        with urllib.request.urlopen(req, timeout=120) as r:
            batch = json.load(r)
        rows.extend(batch)
        print(f"  {len(rows):,} rows")
        if len(batch) < page:
            break
        offset += page
    out.parent.mkdir(parents=True, exist_ok=True)
    buf = io.StringIO()
    w = csv.DictWriter(buf, fieldnames=["event_id", "start_date_time", "end_date_time", "event_borough"])
    w.writeheader()
    for row in rows:
        w.writerow({k: row.get(k, "") for k in w.fieldnames})
    out.write_text(buf.getvalue())
    print(f"  wrote   {out.relative_to(ROOT)}")


if __name__ == "__main__":
    extract_snapshot()
    fetch_events()
    fetch_tlc()
    print("done")
