# The original 2021 submission

This folder is the MAST30034 Applied Data Science Project 1 submission (University of Melbourne, 2021 Semester 2), kept as it was handed in so the revival in the rest of the repository can be checked against it. The files were moved here with `git mv`, so their history is intact. Nothing inside was edited apart from this README.

## What is inside

| Path | What it is |
| --- | --- |
| `Project 1 1118472.ipynb` | The full analysis in one PySpark notebook (302 cells, outputs included): download, four cleaning rounds, the weather, event and collision joins, the Folium maps and charts, and the linear regression with a hand-written 10-fold cross-validation |
| `Project 1 1118472 - copy.ipynb` | A working copy of the notebook from the same week |
| `init.py`, `library.py` | Notebook set-up (warning filters, multi-line output) and every import the notebook uses |
| `Download scripts/` | The four download scripts (taxi trips, taxi zones, permitted events, collisions), adapted from MAST30034 tutorial material |
| `Preprocess/preprocess_readme.md` | A written record of every cleaning and merge rule, with the unique values seen in each column and the final 40-column schema |
| `plot/` | Figures saved by the notebook: PNG charts and four Folium choropleth HTML files |
| `10-folds-linear-regression.csv` | R², RMSE, intercept and all 579 coefficients of each of the 10 cross-validation folds |
| `mast30034_2021_s2_project_1-chuangyu-hscy-main.zip` | A snapshot of the GitHub Classroom repository, including its `Data/` folder (NYPD collisions export, NOAA Central Park weather and the TLC taxi-zone lookup and shapefile) |
| `requirements.txt`, `pyproject.toml` | The pinned Python 3.8 environment and the formatter settings |
| `GitHub_How_To.md` | The Git cheat sheet that came with the classroom template |
| `_archive/README.original.md` | The README submitted in 2021 |

The written report was produced on Overleaf (view-only link in `_archive/README.original.md`). The assignment brief belongs to the subject and is not included.

## Running it today

The notebook expects to run with this folder as its working directory, since it reads and writes `./Data`, `./Preprocess`, `./plot` and `./tmp`. It was written for Python 3.8.3 and PySpark 3.1.2 on Linux or WSL with about 32 GB of driver memory.

```bash
cd coursework
python3.8 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
unzip -q mast30034_2021_s2_project_1-chuangyu-hscy-main.zip 'mast30034_2021_s2_project_1-chuangyu-hscy-main/Data/*'
mv mast30034_2021_s2_project_1-chuangyu-hscy-main/Data ./Data && rmdir mast30034_2021_s2_project_1-chuangyu-hscy-main
jupyter notebook "Project 1 1118472.ipynb"
```

Two inputs cannot be fetched the 2021 way any more.

- **Taxi trips.** The S3 bucket used by `Download scripts/2019 yellow taxi data download.py` is gone. TLC now publishes the same months as Parquet. Fetch them with `uv run scripts/fetch_data.py` from the repository root, then write the CSVs the notebook expects. Leave out the `airport_fee` column, which did not exist in 2019 and is always empty; otherwise `dropna()` would remove every row.

  ```bash
  # from the repository root
  mkdir -p "coursework/Data/2019 yellow taxi data"
  uv run --with duckdb python -c "
  import duckdb
  for m in range(1, 13):
      src = f'data-cache/tlc/yellow_tripdata_2019-{m:02d}.parquet'
      dst = f'coursework/Data/2019 yellow taxi data/yellow_tripdata_2019-{m:02d}.csv'
      duckdb.sql(f\"COPY (SELECT * EXCLUDE (airport_fee) FROM '{src}') TO '{dst}' (HEADER)\")
  "
  ```

- **Permitted events.** The NYC Open Data CSV export (`bkfu-528j`) still works, but the dataset has been revised since 2021 and now holds far fewer 2019 events than the notebook saw. Because the 2021 model gave events a coefficient of zero, this does not change its predictions.

Stamen map tiles, used by the Folium maps, have been discontinued, so those cells need a different `tiles=` argument.

## How the revival uses this folder

The revived pipeline in `../scripts` does not run this notebook. It re-implements every cleaning rule in DuckDB SQL and checks itself against the row counts printed in the notebook's outputs and the coefficients in `10-folds-linear-regression.csv`. The collision, weather and taxi-zone inputs are extracted byte for byte from the snapshot zip. See the root `README.md` for the results.
