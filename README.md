<div align="center">

# Predicting New York City Yellow Taxi Trip Duration

### MAST30034 Applied Data Science &middot; Project 1 &middot; University of Melbourne

A quantitative analysis of the 2019 NYC Yellow Taxi trip records, building a PySpark linear regression model to predict trip duration from trip, weather, event and collision data.

[![Python](https://img.shields.io/badge/Python-3.8.3-3776AB?style=flat&logo=python&logoColor=white)](https://www.python.org/)
[![Jupyter](https://img.shields.io/badge/Jupyter-Notebook-F37626?style=flat&logo=jupyter&logoColor=white)](https://jupyter.org/)
[![Apache Spark](https://img.shields.io/badge/Apache%20Spark-PySpark%203.1.2-E25A1C?style=flat&logo=apachespark&logoColor=white)](https://spark.apache.org/)
[![University of Melbourne](https://img.shields.io/badge/University%20of%20Melbourne-MAST30034-094183?style=flat)](https://handbook.unimelb.edu.au/2021/subjects/mast30034)

</div>

---

## Overview

This project is a quantitative analysis of the New York City Taxi and Limousine Commission (TLC) Yellow Taxi trip records for 2019.

**Research question:** can we predict the trip duration (travel time in minutes) of a New York City yellow taxi journey from trip attributes and surrounding conditions, so that vendors can set better expectations and improve the customer experience?

To answer this, the project cleans the large 2019 TLC trip dataset and enriches it with four supporting sources, then fits a linear regression model to predict `time_duration_minutes`.

**Datasets used:**

| Dataset | Source | Role |
|---|---|---|
| 2019 Yellow Taxi trip records | [NYC TLC Trip Record Data](https://www1.nyc.gov/site/tlc/about/tlc-trip-record-data.page) | Core dataset (one CSV per month, around 84 million rows before cleaning) |
| Taxi Zone lookup and shapefile | NYC TLC | Maps location IDs to zones and boroughs, and supports the choropleth maps |
| Daily weather summary | [NOAA National Centers for Environmental Information](https://www.ncdc.noaa.gov/cdo-web/) (Central Park station) | Adds temperature, precipitation, snow and weather-type features |
| NYC permitted events (historical) | [NYC Open Data](https://data.cityofnewyork.us/City-Government/NYC-Permitted-Event-Information-Historical/bkfu-528j) | Adds a daily count of permitted events per borough |
| NYC motor vehicle collisions | Google BigQuery `nypd_mv_collisions` (mirrored to a CSV) | Adds an hourly count of collisions per borough |

The full report is available on Overleaf (view only): [https://www.overleaf.com/read/jtyhjwsdsvcn](https://www.overleaf.com/read/jtyhjwsdsvcn).

## Approach and Pipeline

The work follows a download, preprocess, analyse, model sequence, run end to end in a single Jupyter notebook on Apache Spark (PySpark).

1. **Download** each raw dataset using the scripts in `Download scripts/`.
2. **Clean the taxi data** across four passes, removing invalid and extreme records. This includes filtering out unknown vendor and rate codes, negative and null values, passenger counts above six, fares below the $2.50 minimum, trips faster than 50 miles per hour, trips longer than two hours, dropoff times before pickup, and tips greater than twice the fare. This reduces roughly 84 million rows to about 76 million.
3. **Engineer features** by splitting timestamps into date and time parts, deriving driving speed, trip duration, tip rate and a pickup-to-dropoff route.
4. **Join the supporting data** onto each trip: taxi zones by location ID, weather and event counts by pickup date, and collision counts by date and hour.
5. **Explore and visualise** the merged dataset, including pickup and dropoff choropleth maps by zone and vendor (Folium), average trip time by weekday and hour, busiest routes, and a feature correlation matrix.
6. **Model** trip duration with a Spark MLlib `LinearRegression`. Categorical fields are indexed and one-hot encoded, then assembled into a feature vector. Because Spark's built-in `CrossValidator` would not run on the local machine, a manual k-fold cross-validation loop was written, evaluating each fold on R&sup2; and RMSE.

The model explains around 37% of the variance in trip duration (mean R&sup2; close to 0.37) with an RMSE of roughly 9 minutes across folds.

## Repository Structure

| Path | Description |
|---|---|
| `Project 1 1118472.ipynb` | Main notebook covering the full pipeline from download to model evaluation |
| `Download scripts/` | Standalone scripts to fetch each raw dataset (taxi, events, collisions, taxi zones) |
| `init.py` | Notebook setup: warning filters and multiline output settings |
| `library.py` | All shared imports (PySpark, pandas, geopandas, Folium, Bokeh, Plotly, Spark ML) |
| `Preprocess/preprocess_readme.md` | Detailed record of every cleaning and merge decision, with the final schema |
| `plot/` | Saved figures and interactive maps produced during analysis |
| `10-folds-linear-regression.csv` | Per-fold cross-validation results (R&sup2;, RMSE, intercepts and coefficients) |
| `requirements.txt` | Pinned Python dependencies |
| `_archive/` | Original README kept for reference |

## Getting Started

### Prerequisites

- Python 3.8.3
- Apache Spark with PySpark 3.1.2 (a Linux or WSL environment is recommended)
- Install the Python dependencies:

```bash
pip install -r requirements.txt
```

### Obtaining the data

The raw datasets are not stored in this repository. Download them with the scripts in `Download scripts/`, which save into a local `Data/` folder:

- `2019 yellow taxi data download.py` fetches the monthly Yellow Taxi CSVs from the NYC TLC S3 bucket.
- `Taxi Zone LookUp table and Shape File.py` fetches the zone lookup table and shapefile.
- `2019 NYC Permitted Event Information download.py` fetches the permitted events CSV from NYC Open Data.
- `2019 New York Car Collision.py` fetches the collision query results (mirrored from BigQuery to Google Drive).

The weather summary is downloaded manually from the NOAA portal linked above.

### Running the analysis

1. Open `Project 1 1118472.ipynb` in Jupyter.
2. Run `init.py` and `library.py` first so the environment and imports are ready before any other cell.
3. Make sure every directory referenced in the notebook exists and that your `SparkConf` matches your machine's resources.
4. Run the cells in order: download, preprocess, analyse, then model.

## Notes

- `Preprocess/preprocess_readme.md` is the best place to understand the cleaning logic. It records every filtering rule, the reasoning behind it, and the final 40-column schema.
- The original assignment repository was private to the MAST30034 teaching group. This is a standalone copy preserved as a portfolio reference.
- This project was completed in 2021 as part of the Bachelor of Science (Data Science) at the University of Melbourne.

---

<div align="center">

**Author:** Sunchuangyu (Rin) Huang &middot; Student ID 1118472

</div>
