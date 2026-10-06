# DR-002: Keep the 2021 cleaning thresholds as they ran, and report what they miss

- **Status:** Accepted
- **Date:** 2026-10-06
- **Decision:** Run every 2021 cleaning rule exactly as the notebook's code ran it, including the rules whose code disagrees with their comments, and publish a data-quality report of what each rule catches and what got through instead of quietly fixing them.

## Context

The 2021 rules have several quirks. The "miles per hour" rule divides miles by minutes, so it only removes trips faster than 50 miles a minute. The tip rule keeps tips up to half the fare, while its comment talks about tips more than twice the fare. The fare z-score uses a standard deviation of $94.37 that is inflated by fares up to $671,123, so the cut-off ends up at $296.15. The opening `dropna()` removes almost all of 1 to 20 January because TLC left the congestion surcharge empty until 21 January 2019. The zone rule only removes trips from zone 264 to zone 265.

Each of these could be fixed in a line of SQL. Fixing them would also change every downstream number on the site, including the comparison with the counts the notebook printed.

## Decision

The revival keeps the thresholds and the quirks. `scripts/data_quality.py` adds a report alongside them. For every rule it counts the rows removed in sequence, the rows that fail the rule on their own, and the rows that no other rule would catch, and it lists the most common offending values. It also runs plausibility checks the 2021 rules did not have on the final dataset and reports those counts by vendor without removing anything. The report is on the website at `/data-quality` and in the `dq_*` tables of the analytics database.

## Options considered

- **Fix the rules.** This would apply a real speed limit, a minimum duration and an outlier rule that is robust to extreme fares. It produces cleaner data, but the result is no longer the 2021 project and it can no longer be checked against the notebook.
- **Keep the rules and say nothing.** This is faithful but hides problems that a careful reader would want to know about.
- **Keep the rules and report.** This stays faithful and makes the size of every problem visible, so a reader can judge whether it matters for a given question.

## Why

The point of the revival is to show the 2021 work as it was, so that the upgrades can be judged against it. Counts are also the right currency here. Every figure in the report is a full count over the 2019 records rather than a sample, so it carries no sampling error, and the open question is whether a rule is right, not how precise its count is. Reporting by vendor turned out to matter, because one of the problems is a vendor convention.

## What happened

Most of `dropna()`'s 5,300,601 removals are rows missing only the congestion surcharge. Passenger count, rate code and store-and-forward flag are missing together on 444,383 rows, about 0.4% of each month. The passenger-count rule fails on its own for 1,454,347 rows, almost all with a count of zero. The speed rule removes 6,454 trips in sequence, and 2,238 of the trips it catches have a duration of exactly zero, so they fail through a division by zero rather than a speed.

Four rules never act on their own. The rules on negative tolls, non-positive totals, negative congestion surcharges and the pickup window catch only rows that other rules also catch, mostly fare reversals that break several charge rules at once.

The final dataset still contains 33,474 trips averaging more than 60 mph (0.045%) and 191,992 trips shorter than one minute (0.256%). The largest finding was unexpected. From February 2019, vendor 1 (Creative Mobile Technologies) leaves the $2.50 congestion surcharge out of `total_amount` on about 90% of its trips, while VeriFone includes it. That is 23,397,653 trips, or 31.2% of the final dataset. The trip-duration model never uses the total, so the 2021 results are unaffected, but any comparison of fares by vendor would be off by $2.50 a trip.

## What I'd change

I would run a sensitivity analysis that refits the model under corrected rules, with a 1 to 60 mph speed window, a one-minute minimum duration and a `dropna()` restricted to the model's own columns. That would show how much the quirks move R² and RMSE, rather than leaving the question open. I would also impute the January congestion surcharge as zero before 21 January instead of dropping three weeks of data, because the surcharge did not exist yet.
