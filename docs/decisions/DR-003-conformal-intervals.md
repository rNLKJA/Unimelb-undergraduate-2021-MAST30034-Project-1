# DR-003: Split-conformal prediction intervals, Mondrian by borough and predicted duration

- **Status:** Accepted
- **Date:** 2026-10-06
- **Decision:** The trip estimator shows a split-conformal prediction interval around the 2021 model's prediction, calibrated separately within each pickup borough and band of predicted duration, at 80%, 90% or 95%, with its empirical coverage on held-out trips stated next to it.

## Context

Until this upgrade, "Estimate a trip" gave a single number. The model's cross-validated RMSE is about 9.2 minutes, and its residuals are far from normal. They are skewed to the right, their spread grows with the prediction, and they are much larger outside Manhattan. The residual SD of the 2021 coefficients is 8.5 minutes for Manhattan pickups, 16.9 for the Bronx and 30.8 for Staten Island. A point estimate on its own hides all of that.

The 2021 model had to stay as it was. The interval method had to wrap it without refitting it.

## Decision

Split-conformal prediction with a Mondrian taxonomy. Trips are grouped by pickup borough and, within each borough, into up to ten bins of the predicted duration, with one bin per 1,000 calibration trips. Within each group, the lower and upper interval offsets are order statistics of the signed residuals, with alpha/2 in each tail and the finite-sample index ceil((n + 1)(1 - alpha/2)). The lower end is clipped at zero because trip times are positive, which cannot reduce coverage.

The folds come from the pipeline's hash of each trip. Bin edges come from fold 2, using predictions only. Calibration uses fold 0 (7,493,562 trips) and coverage is measured on fold 1 (7,497,013 trips). A second scheme refits the 2021 specification on January to October and measures coverage on November and December, to see what happens when the future does not look like the calibration data.

## Options considered

- **Prediction plus or minus 1.96 times the RMSE.** This is easy, but it assumes normal, constant-variance errors, which the residual plots rule out.
- **Quantile regression.** It could give conditional intervals directly, but it means fitting new models rather than wrapping the 2021 one.
- **Bootstrap prediction intervals.** They are expensive at 75 million rows and still rest on modelling assumptions.
- **Global split-conformal.** This is distribution-free with a finite-sample guarantee, but the guarantee is only marginal, averaged over all trips.
- **Mondrian split-conformal.** It keeps the guarantee within each group I choose, at the cost of wider intervals for small groups.

## Why

Split-conformal needs only a fixed model and exchangeable calibration and test trips. It is cheap and has a coverage guarantee that does not depend on the error distribution. The 2021 coefficients were trained on a random 90% of 2019 in 2021, so they saw many calibration trips. A trip from 2019 that someone asks about had the same chance of being in that training set as a calibration trip did, so calibration and test trips stay exchangeable relative to the fixed model, which is what the guarantee needs. The temporal scheme tests the case where that argument breaks.

Mondrian grouping by borough and predicted duration targets the two places where the residual plots show the biggest differences.

## What happened

At the 90% level on the random test fold:

| Method | Overall | Range across predicted-duration deciles | Bronx | Staten Island | Mean width |
| --- | ---: | ---: | ---: | ---: | ---: |
| Global, symmetric | 90.0% | 64% to 97% | 68.7% | 35.3% | 25.0 min |
| Mondrian by decile | 90.0% | 90.0% in every decile | 68.5% | 35.3% | 26.6 min |
| Mondrian by borough and decile | 90.0% | 88% to 92% | 90.0% | 90.3% | 26.4 min |

My first draft put Wilson intervals on these coverages, which came out narrower than a tenth of a percentage point because they treated 7.5 million trips as independent. Coverage moves together within a day, though: the daily coverage of the global 90% interval ranges from 82.7% to 95.8% across the 345 test days with at least 1,000 test trips. The intervals now resample whole test days (B = 2,000, seed 20190101), as the hold-out metrics do. For the borough and decile method, 90.0% overall becomes 89.9% to 90.1%, about 6 times wider than the Wilson interval, and for the global method the factor is about 12. Staten Island has 258 test trips on 188 days, and its interval runs from 86.4% to 93.7%. The estimator now quotes coverage for the trip's own borough and bin, with the same kind of interval, rather than for the whole borough.

The weak numbers are worth stating plainly. The intervals are wide, 26 minutes on average at 90%, because the model's errors are large. Staten Island has only 238 calibration trips, so it gets a single bin and 90% intervals about 94 minutes wide, which is honest and not useful. On November and December, after refitting on January to October, coverage falls to 88.8% at the 90% level (95% CI 88.4% to 89.2% over 61 test days). That is what a broken exchangeability assumption looks like, since holiday traffic is not like the rest of the year.

## What I'd change

A better point model would narrow the intervals more than any interval method. The route-by-hour median lookup has an RMSE of 6.2 minutes against 9.5 for the 2021 specification on the November to December hold-out. I would wrap that lookup, or a gradient-boosted model, in the same conformal procedure. I would try conformalised quantile regression to get intervals whose width adapts within a bin. To handle drift, I would recalibrate on a rolling window of recent months and report coverage month by month.
