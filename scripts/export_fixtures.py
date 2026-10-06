# /// script
# requires-python = ">=3.11"
# dependencies = ["duckdb>=1.2", "numpy>=2"]
# ///
"""Export parity fixtures for the TypeScript port (web/src/lib/__fixtures__).

    uv run scripts/export_fixtures.py   # after fit_model.py and build_analytics.py

model-rows.json: 40 encoded rows of the revived model table (feature indices as
Spark's VectorAssembler laid them out, numeric values and the label) together
with the prediction of the 2021 fold-1 coefficients and of the refit, computed
here with numpy. web/src/lib/model.test.ts decodes each row back into a trip
context, re-encodes it with the TypeScript port and checks indices and
predictions match.
"""

from __future__ import annotations

import json

import duckdb
import numpy as np

from common import WEB, WORK_DB, write_json

NUM = ["precipitation", "snow", "snow_depth", "tavg", "wt01", "wt02", "wt03", "wt06", "wt08", "number_of_event", "number_of_collision"]
CAT = ["c_weekday", "c_hour", "c_ratecode", "c_passenger", "c_pickup", "c_vendor", "c_dropoff", "c_flag"]


def main() -> None:
    model = json.loads((WEB / "src" / "lib" / "data" / "model.json").read_text())
    orig = np.array(model["original"]["coefficients"])
    refit = np.array(model["refit"]["coefficients"])
    con = duckdb.connect(str(WORK_DB), read_only=True)
    rows = con.execute(
        f"""
        SELECT y, {", ".join(NUM)}, {", ".join(CAT)} FROM model_rows
        WHERE fold = 3 ORDER BY hash(y, c_pickup, c_dropoff, c_hour, tavg) LIMIT 40
        """
    ).fetchall()
    out = []
    for r in rows:
        y = r[0]
        nums = list(r[1 : 1 + len(NUM)])
        cats = list(r[1 + len(NUM) :])
        x = np.zeros(579)
        x[: len(NUM)] = nums
        for c in cats:
            x[c] = 1.0
        out.append(
            {
                "y": y,
                "numeric": nums,
                "indices": sorted(int(c) for c in cats),
                "context": {
                    "sparkWeekday": cats[0] - 11,
                    "hour": cats[1] - 19,
                    "ratecode": cats[2] - 43,
                    "passengers": cats[3] - 50,
                    "pickupZone": model["pickupZones"][cats[4] - 57],
                    "vendor": cats[5] - 315,
                    "dropoffZone": model["dropoffZones"][cats[6] - 318],
                    "flag": model["flags"][cats[7] - 577],
                },
                "predictOriginal": float(model["original"]["intercept"] + orig @ x),
                "predictRefit": float(model["refit"]["intercept"] + refit @ x),
            }
        )
    write_json(WEB / "src" / "lib" / "__fixtures__" / "model-rows.json", out)


if __name__ == "__main__":
    main()
