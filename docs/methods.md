# Methods

This page sets out where the data comes from, what was done to it, how the results were evaluated, what the analysis assumes and where it falls short. The 2021 notebook's own cleaning and model are documented rule by rule on [the method page](/method). The decision records linked below explain the larger choices.

## Data provenance

| Source | Used for | Version and notes |
| --- | --- | --- |
| NYC TLC yellow-taxi trip records, 2019 | every trip-level number | TLC's 2022 Parquet re-issue, 12 monthly files, 84,598,444 rows. The 2021 notebook read the original CSVs, which TLC no longer publishes. |
| NOAA GHCN-Daily, Central Park station | daily weather features and the rain analysis | the file the 2021 notebook used, from the 2021 project snapshot |
| NYPD motor-vehicle collisions | daily collision counts | a 2021 BigQuery export that ends on 23 December 2019 |
| NYC Open Data permitted events (`bkfu-528j`) | daily event counts per borough | the current version, which is about ten times smaller than the 2021 export |
| TLC taxi-zone lookup and shapefile | zone names, boroughs and map polygons | the 2021 snapshot |

`scripts/fetch_data.py` downloads the trips and extracts the other files. `scripts/pipeline.py` applies the 2021 rules and writes a DuckDB work file that is not committed. Five later scripts fit the model, run the rigour, effects and data-quality analyses, and build the database. They write the committed outputs in `scripts/out/` and the read-only database `web/data/analytics.db`, which holds aggregates only and no individual trip. The README lists the order to run them in.

## Method

- **Cleaning.** The 2021 rules run exactly as the notebook ran them, quirks included ([DR-001](decisions/DR-001-pyspark-to-duckdb.md), [DR-002](decisions/DR-002-cleaning-thresholds.md)). The [data-quality report](/data-quality) shows what each rule catches and what got through.
- **The 2021 model.** An elastic-net linear regression on 579 features, unchanged. The 2026 refit solves the same objective to convergence from exact sufficient statistics.
- **Inference.** Penalised coefficients have no honest standard errors, so the [evaluation page](/evaluation) reports the unpenalised OLS counterpart on the same design with classical, HC3 and day-clustered standard errors. The day-clustered errors matter because weather, events and collisions are shared by every trip on a day.
- **Prediction intervals.** Split-conformal intervals with a Mondrian taxonomy by pickup borough and predicted duration ([DR-003](decisions/DR-003-conformal-intervals.md)).
- **Effects.** Rain and permitted events are compared through a composition-adjusted duration index, the mean of log(minutes ÷ median minutes of the same route and hour). Rain uses a two-sample comparison and a day-level regression with month, weekday and holiday effects. Events use a matched comparison of borough-days within the same weekday, four-week window and weather. See the [effects page](/effects).
- **Ask the data.** A language model drafts SQL in the visitor's browser with the visitor's key, and the server validates and runs it read-only ([DR-004](decisions/DR-004-byok-text-to-sql.md)).

## Evaluation design

- **Splits.** Folds are a deterministic hash of each trip, because Spark's `randomSplit` cannot be replayed. The temporal hold-out fits on January to October (folds 1 to 9) and tests on all of November and December. The in-period hold-out tests on January to October fold 0.
- **Baselines.** Every model is compared with two baselines. One predicts the January to October mean for every trip. The other looks up the January to October median of the same pickup zone, drop-off zone and hour, falling back to the route and then the pickup zone and hour when a cell has fewer than 20 trips.
- **Uncertainty.** Hold-out metrics get a cluster bootstrap that resamples whole days (B = 2,000, seed 20190101), because trips on the same day share weather and traffic. Differences between models are paired, using the same resampled days for both. Interval coverage is a proportion of trips, but coverage also moves together within a day, so it gets the same day bootstrap rather than a Wilson interval, which would be 6 to 12 times too narrow. `scripts/rigour.py` ports the website's random number generator, so its intervals match the website's bootstrap exactly. Text-to-SQL accuracy, where questions are independent, gets Wilson intervals. The rain regression uses HC3 standard errors with t-based intervals, checked against Newey–West errors with 7 lags because neighbouring days are correlated. The matched event comparison resamples dates, because several boroughs can be event-heavy on the same date. Effect sizes are reported as Hedges' g or d_z alongside the intervals.
- **Text-to-SQL.** The 24 evaluation questions and their reference queries were written before any model was run. The domain notes in the "described" prompt were written with these questions in view, and 7 questions depend on a fact a note states, so accuracy is also reported on the other 17. A model passes when its result contains the reference result, with columns matched by value, row order checked only for rankings, and numbers compared to six significant figures. Strict accuracy also requires no extra columns. Two runs are compared with an exact McNemar test and a paired bootstrap interval.
- **Checked code.** The TypeScript statistics helpers in `web/src/lib/stats/` are unit-tested against values computed with scipy, statsmodels and R (`scripts/stats_reference.py`). The sparse NumPy code that computes HC3 and clustered standard errors over 75 million rows is checked against statsmodels on a dense test problem before every run.

## Assumptions

- Calibration and test trips are exchangeable relative to the fixed model. This holds for random 2019 trips and fails for later months, which is why coverage is also reported on November and December.
- Days are independent units for the cluster bootstrap. Consecutive days are correlated through weather systems and seasons, so the day-level intervals are, if anything, a little narrow. For the rain regression, Newey–West errors allow for this and barely change the interval.
- The 2019 median of each route and hour is a fair yardstick for "usual", and trips that share a route and hour are comparable.
- Central Park's daily precipitation stands in for rain across the city and across the day.

## Limitations

- One year of data cannot separate seasonal drift from the particular character of November and December traffic.
- The effects are associations after the stated adjustments. Rain and permits were not randomly assigned.
- The 2021 model has no notion of distance between zones, which caps its accuracy well below a simple lookup table.
- The events feature cannot be reproduced exactly, because NYC Open Data revised the 2019 events after 2021.
- The cleaning quirks are kept on purpose, so some implausible trips remain in every number on the site. Their counts are on the data-quality page.
- Rebuilding the data needs about 20 GB of memory and 40 GB of disk.

## What I'd change

- Replace the point model with a route-by-hour lookup or a gradient-boosted model, and wrap it in the same conformal intervals. That would narrow the intervals far more than any change to the interval method.
- Refit under corrected cleaning rules as a sensitivity analysis, so the cost of each quirk is a number rather than a caveat.
- Use a block bootstrap over weeks to allow for correlation between neighbouring days.
- Grow the text-to-SQL question set to at least 100 questions, with a second person writing reference answers.
