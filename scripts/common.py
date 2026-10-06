"""Shared paths and helpers for the revival scripts (imported by the uv scripts in this folder)."""

from __future__ import annotations

import json
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / "data-cache"
RAW = CACHE / "raw"
WORK_DB = CACHE / "work.duckdb"
OUT = ROOT / "scripts" / "out"
WEB = ROOT / "web"
ANALYTICS_DB = WEB / "data" / "analytics.db"
PUBLIC_DATA = WEB / "public" / "data"
COURSEWORK = ROOT / "coursework"

# Row counts printed by the original notebook (coursework/Project 1 1118472.ipynb).
# Each value is quoted from the cell output named in the comment.
NOTEBOOK_COUNTS = {
    "raw": 84_399_019,  # cell 18: taxi_df.count()
    "dropna": 79_296_437,  # cell 21: taxi_df.dropna().count()
    "round1": 76_487_438,  # cell 23: describe() count after the round-1 filter
    "zscore": 76_486_691,  # cell 54: taxi_df_3.count() after the fare z-score filter
    "dedup": 76_486_688,  # cell 58: summary count after dropDuplicates()
    "min_fare": 76_486_337,  # cell 66: fare_amount >= 2.5
    "speed": 76_475_571,  # cell 75: after duration > 0, passengers <= 6 and the speed rule
    "max_duration": 76_269_392,  # cell 79: travel_time <= 180
    "tip": 75_673_363,  # cell 84: fare_amount >= 2 * tip_amount
    "merge": 75_183_226,  # cell 159: after zone filters + weather and event joins
    "final": 74_908_426,  # cell 251: final_stage_file count
}

# Fare z-score statistics from cell 30 (summary of the round-1 output).
NOTEBOOK_FARE_MEAN = 13.025828555402784
NOTEBOOK_FARE_STD = 94.37330125809798

# Events per borough-day from the 2021 export (2,823,378 rows in 2019, cell 130).
NOTEBOOK_EVENT_ROWS_2019 = 2_823_378
# Collision rows with a known borough (cell 115).
NOTEBOOK_COLLISION_ROWS = 134_821


class Timer:
    def __init__(self, label: str):
        self.label = label

    def __enter__(self):
        self.t = time.time()
        print(f"[..] {self.label}", flush=True)
        return self

    def __exit__(self, *exc):
        print(f"[ok] {self.label} ({time.time() - self.t:.1f}s)", flush=True)


def write_json(path: Path, obj) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, indent=2, ensure_ascii=False) + "\n")
    print(f"     wrote {path.relative_to(ROOT)} ({path.stat().st_size / 1024:.1f} KB)")
