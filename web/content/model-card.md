# Model card: 2019 NYC yellow-taxi trip-duration regression

This card describes the regression from the 2021 MAST30034 project as it runs on the revived website. The model itself is unchanged since 2021. The evaluation, intervals and caveats below were added in 2026.

## Model details

- **Type:** linear regression with an elastic-net penalty, fitted with Spark MLlib `LinearRegression(maxIter=10, regParam=0.3, elasticNetParam=0.8)` in August 2021.
- **Inputs:** 579 features. There are 11 numeric columns for weather, permitted events and collisions, plus one-hot encodings of weekday, pickup hour, rate code, passenger count, pickup zone, vendor, drop-off zone and the store-and-forward flag.
- **Output:** predicted trip duration in minutes.
- **Coefficients:** fold 1 of the notebook's 10-fold cross-validation (`coursework/10-folds-linear-regression.csv`). The penalty kept 83 of the 579 coefficients.
- **Owner:** Sunchuangyu (Rin) Huang. This was an individual university project.
- **Where it runs:** in the visitor's browser on `/estimate`, from `web/src/lib/data/model.json`.

## Intended use

The model shows how a 2021 coursework regression behaved, term by term. It gives a rough idea of how long a 2019 yellow-cab trip between two taxi zones took at a given hour, with a prediction interval.

It is not meant for real-time arrival estimates, fare or pricing decisions, dispatch, or any decision about drivers or passengers. It knows nothing after 2019 and nothing about green cabs or for-hire vehicles.

## Training data

- **Trips:** NYC Taxi and Limousine Commission yellow-taxi trip records for 2019. In 2021 these came from TLC's monthly CSVs. The revival uses TLC's 2022 Parquet re-issue of the same months, 84,598,444 raw records.
- **Cleaning:** four rounds of rules from the 2021 notebook, kept exactly as they ran (see [DR-002](decisions/DR-002-cleaning-thresholds.md) and `/data-quality`). They leave 74,910,889 trips and 74,941,355 model rows, because the shapefile join duplicates two zone names.
- **Joined data:** NOAA GHCN-Daily weather for Central Park, NYPD motor-vehicle collisions (a 2021 BigQuery export that ends on 23 December 2019) and NYC Open Data permitted events. The events dataset has been revised since 2021 and is now about ten times smaller.
- **Personal information:** TLC publishes trips without driver or passenger identifiers, with locations coarsened to 263 taxi zones. The website ships aggregates only and no individual trip.

## Evaluation

| Test | Result | Uncertainty |
| --- | --- | --- |
| 10-fold cross-validation, 2021 notebook | R² 0.3665, RMSE 9.175 min | folds range from R² 0.3655 to 0.3676 and RMSE 9.170 to 9.182 |
| 2021 coefficients on the revived folds | R² 0.3681, RMSE 9.179 min | folds range from R² 0.3670 to 0.3689 |
| 2021 specification refitted on Jan to Oct, tested on Nov to Dec | RMSE 9.47 min, MAE 6.79 min, R² 0.353 | 95% CIs 9.18 to 9.73, 6.61 to 6.95, and 0.341 to 0.365 (bootstrap over 61 test days, B = 2,000, seed 20190101) |
| Route-by-hour median lookup, same hold-out | RMSE 6.24 min, R² 0.719 | 95% CI 6.00 to 6.47 |
| 90% prediction intervals on 7,497,013 held-out 2019 trips | 90.0% coverage, 26.4 min mean width | 95% CI 89.9% to 90.1% (bootstrap over 347 test days); 90% in every borough, 88% to 92% in every predicted-duration decile |
| 90% prediction intervals, refitted on Jan to Oct, tested on Nov to Dec | 88.8% coverage | 95% CI 88.4% to 89.2% (bootstrap over 61 test days); 12,936,277 test trips |

The temporal hold-out and the intervals are produced by `scripts/rigour.py`. The hold-out bootstrap runs in `web/src/lib/holdout.ts`, and the coverage bootstrap runs in `scripts/rigour.py` with the same generator and seed, checked against the website's bootstrap by a test. The full tables are on `/evaluation`.

## Known failure modes

- **It cannot see distance.** The model adds a pickup-zone effect to a drop-off-zone effect, so it has no notion of how far apart two zones are. A plain lookup of the median trip time for the same route and hour beats it by 3.2 minutes of RMSE (95% CI 3.1 to 3.3).
- **Long trips are under-predicted.** In the top decile of predictions, a symmetric interval sized for the average trip covers only 64% of trips.
- **Outer boroughs get worse predictions.** The mean residual is +8.6 minutes for Bronx pickups and +29.6 minutes for Staten Island pickups, against −0.1 for Manhattan, and the residual SD is 1.6 to 3.6 times Manhattan's.
- **Very short trips can be predicted at under a minute or below zero,** because the model is a straight line.
- **The data has gaps.** 1 to 20 January 2019 were removed by cleaning, collisions stop on 23 December, and days without a permitted event in the pickup borough were dropped in 2021.
- **Seasons drift.** On November and December, after fitting on January to October, the RMSE is about 0.34 minutes worse than on a random January to October fold, and interval coverage slips below its target.

## Ethical considerations

Zone coefficients describe traffic, distance and demand. They are not a measure of a neighbourhood, and should not be read as one. The model serves outer-borough riders worst, because most of its training trips start in Manhattan (92% of model rows). Any use that affected people outside Manhattan would need a model that is evaluated separately for them. The website shows aggregates only. The environmental cost of the 2026 analysis was a few minutes of computation on one desktop computer.

## Recommendations

Read the prediction together with its interval and with the observed median shown beside it. Where a route-hour median from enough trips exists, it is the better estimate. Treat everything here as a description of 2019.
