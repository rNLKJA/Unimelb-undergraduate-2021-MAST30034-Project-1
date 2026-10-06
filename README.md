<div align="center">

# NYC Taxi 2019: Where, When and How Long

### MAST30034 Applied Data Science · Project 1 · University of Melbourne · 2021 Semester 2

Every New York yellow-cab trip of 2019, cleaned with the rules of a 2021 data-science project, joined to weather, permitted events and collisions, mapped by taxi zone and modelled to predict how long a ride takes. Revived in 2026 as an interactive website.

**Live demo:** [mast30034-nyc-taxi.vercel.app](https://mast30034-nyc-taxi.vercel.app)

[![CI](https://github.com/rNLKJA/Unimelb-undergraduate-2021-MAST30034-Project-1/actions/workflows/ci.yml/badge.svg)](https://github.com/rNLKJA/Unimelb-undergraduate-2021-MAST30034-Project-1/actions/workflows/ci.yml)
![Next.js 16](https://img.shields.io/badge/Next.js-16-000?logo=nextdotjs)
![DuckDB](https://img.shields.io/badge/DuckDB-pipeline-FFF000?logo=duckdb&logoColor=000)
![MapLibre](https://img.shields.io/badge/MapLibre-OpenFreeMap-396CB2?logo=maplibre)

</div>

---

## Showcase

<p align="center">
  <img src="docs/showcase/where-and-when.gif" alt="Where and when walkthrough: scrubbing the hour and weekday on the zone choropleth, opening JFK Airport and following its busiest routes" width="960">
</p>

**[Take the guided tour](https://mast30034-nyc-taxi.vercel.app/tour)**: three short captioned walkthroughs (MP4 with WebVTT captions and a written transcript) and every screenshot below in a lightbox. All of it was recorded by a reproducible Playwright script, [`web/e2e/showcase.spec.ts`](web/e2e/showcase.spec.ts) (`cd web && pnpm showcase`), which doubles as an end-to-end test: it asserts the figures each step quotes (the hourly pickup totals, JFK's median trip at two hours, the prediction and its conformal interval at two levels, the rain and event effects with their confidence intervals, the data-quality counts), so a broken feature or a changed number fails the recording. Every figure is a full count over the 2019 trips or uses the site's fixed bootstrap seed, 20190101. The walkthroughs use no AI. No real API key was used for the two "Ask the data" screenshots either: the key is a placeholder and the model's reply is a clearly labelled mock, while the SQL it proposes still goes through the real validator and runs on the real read-only database.

### Key features

| | |
| --- | --- |
| <img src="docs/showcase/01-landing-light.png" alt="Landing page" width="440"><br>**Landing page.** The question, the key numbers and a map of 2019 pickups by taxi zone. | <img src="docs/showcase/02-landing-dark.png" alt="Landing page, dark mode" width="440"><br>**Landing page, dark mode.** The same page in the asphalt dark theme. |
| <img src="docs/showcase/03-zone-map.png" alt="Zone map" width="440"><br>**Zone map.** Median minutes by pickup zone at 3 pm, with JFK Airport's 24-hour profile. | <img src="docs/showcase/04-routes.png" alt="Route explorer" width="440"><br>**Route explorer.** JFK Airport's busiest destinations, drawn like subway lines. |
| <img src="docs/showcase/05-conditions.png" alt="Weather, events, collisions" width="440"><br>**Weather, events, collisions.** Every day of 2019 next to the extra data the 2021 model used. | <img src="docs/showcase/06-estimate.png" alt="Estimate a trip" width="440"><br>**Estimate a trip.** The 2021 regression in the browser, with a split-conformal prediction interval. |
| <img src="docs/showcase/07-evaluation.png" alt="Evaluation" width="440"><br>**Evaluation.** A temporal hold-out with day-bootstrap intervals: a lookup table beats the regression. | <img src="docs/showcase/08-effects.png" alt="Rain and events" width="440"><br>**Rain and events.** Wet days are 3.4% slower (95% CI 1.9% to 4.8%), with every comparison's interval. |
| <img src="docs/showcase/09-data-quality.png" alt="Data quality" width="440"><br>**Data quality.** Each cleaning rule: removed in sequence, failing alone and failing only that rule. | <img src="docs/showcase/10-methods.png" alt="Methods and decisions" width="440"><br>**Methods and decisions.** Data provenance, evaluation design, decision records, the model card and the AI use statement. |
| <img src="docs/showcase/11-ai-settings.png" alt="Bring your own key" width="440"><br>**Bring your own key.** Optional AI settings: Anthropic by default, the key stays in this browser. | <img src="docs/showcase/12-ask-mocked.png" alt="Ask the data (mocked reply)" width="440"><br>**Ask the data (mocked reply).** Proposed SQL labelled AI-generated, run only after a human accepts it. The reply is mocked. |
| <img src="docs/showcase/13-ask-eval.png" alt="Text-to-SQL evaluation" width="440"><br>**Text-to-SQL evaluation.** 24 questions with reference answers, Wilson intervals and an exact McNemar test. | <img src="docs/showcase/14-ai-log.png" alt="AI audit log" width="440"><br>**AI audit log.** Every AI call from this browser with the human decision; JSON and CSV export. |
| <img src="docs/showcase/15-records.png" alt="Records" width="440"><br>**Records.** Every table of the read-only analytics database, searchable and downloadable. | <img src="docs/showcase/16-mobile-landing.png" alt="Mobile: landing" width="220"><br>**Mobile: landing.** The landing page on a 390 px phone. |
| <img src="docs/showcase/17-mobile-map.png" alt="Mobile: zone map" width="220"><br>**Mobile: zone map.** The zone map and its controls on a phone. | <img src="docs/showcase/18-mobile-estimate.png" alt="Mobile: estimate" width="220"><br>**Mobile: estimate.** A prediction and its interval on a phone. |

### Workflow walkthrough

The steps below are the on-screen captions of each recording, in order.

#### 1. Where and when (`/map` → `/routes`)

The zone choropleth of 74.9 million cleaned 2019 trips: scrub the hour, switch the weekday, recolour by median minutes, open JFK Airport's detail and its 24-hour profile, play the day, then follow JFK's busiest routes.

The GIF at the top of this section is this walkthrough.

1. The zone map: 74.9 million cleaned 2019 trips by taxi zone, here pickups from 6 to 7 pm
2. Scrub the hour: 4 am is the quietest, 558,493 pickups in 2019 against 4.9 million at 6 pm
3. 8 am: the morning peak starts on the Upper East Side
4. Saturday, 1 am: the East Village and the Lower East Side lead the night
5. All days at 3 pm, coloured by median minutes: the airports and the outer zones are slowest
6. Open JFK Airport: its pickups, median trip, 24-hour profile and vendor split
7. A JFK pickup takes a median 26.2 min at 1 am and 51.8 min at 3 pm
8. Play the day: the hour advances and the whole map follows
9. Routes from JFK Airport: the busiest destinations, drawn like subway lines

*Setup:* Pickups, starting from the map's defaults (all days, 6 pm). No sampling and no randomness: every figure is a full count over the cleaned 2019 trips.

#### 2. Estimate a trip (`/estimate` → `/evaluation`)

The 2021 regression running in the browser: pick a pickup and a drop-off zone, a date and an hour, read the prediction with its split-conformal interval next to what riders actually saw, change the interval level and the hour, see every term of the sum, then check how the intervals were validated.

<img src="docs/showcase/estimate-a-trip.gif" alt="Estimate a trip walkthrough" width="960">

1. Estimate a trip: the 2021 regression runs in your browser, all 579 features of it
2. Pick a pickup zone: Penn Station/Madison Sq West
3. And a drop-off: Times Sq/Theatre District, on Wednesday 9 October 2019 at 5 pm
4. The 2021 model predicts 14.2 min, with a 90% split-conformal interval of 3.9 to 31.5 min
5. Riders saw a median of 13.3 min at 5 pm, over 9,856 trips: the dashed blue line
6. At 95% the interval widens to 3.1 to 36.7 min, and 95.0% of held-out trips like these fell inside
7. Change the hour to 8 am: 13.2 min, and the interval moves with the prediction
8. Why that number: a linear model is a sum, and each bar is one part of the trip
9. How the intervals were checked: coverage on 7.5 million held-out trips, with day-bootstrap CIs

*Setup:* Penn Station/Madison Sq West to Times Sq/Theatre District, Wednesday 9 October 2019, 1 passenger, vendor 2, rate code 1. The intervals are fixed quantiles from the calibration fold; their coverage intervals resample whole test days (B = 2,000, seed 20190101).

#### 3. What changes trip time (`/effects` → `/data-quality`)

Does rain or a street event slow a taxi down? A composition-adjusted duration index, the rain regression with bootstrap, HC3 and Newey–West intervals, a matched comparison for permitted events, the caveats, then the data-quality report behind the cleaned data.

<img src="docs/showcase/what-changes-trip-time.gif" alt="What changes trip time walkthrough" width="960">

1. What changes trip time? Each trip is compared with its own route and hour
2. One dot per day: how much longer than usual the day's trips took, against Central Park rain
3. Rain: the same trips are 3.4% slower on wet days (95% CI 1.9% to 4.8%), over 333 days
4. Every comparison with its interval: two-sample, regression and rain bins
5. Permitted events: 31 matched pairs on 16 dates, −0.6% (95% CI −2.8% to +1.8%), no detectable effect
6. The caveats: observational data, one rain gauge, collisions as a mediator
7. The data-quality report: what each 2021 cleaning rule removes, and why
8. Missing values: until 21 January 2019 almost every row lacks the congestion surcharge
9. Rule by rule: removed in sequence, failing alone and failing only this rule
10. What got through: vendor 1 leaves the $2.50 surcharge out of the total on 23.4 million trips

*Setup:* Bootstrap intervals resample days (rain) or dates (events), B = 4,000, seed 20190101. Wet means at least 0.1 inch at Central Park. Data-quality figures are full counts over the 2019 records, not samples.

## What the project is

Project 1 of MAST30034 was an individual quantitative analysis of the New York Taxi and Limousine Commission (TLC) trip records. Students picked a question, cleaned a very large real dataset, explored it visually and backed the answer with a statistical model.

The question here: **can we tell a passenger how long a yellow-cab ride will take**, from where and when it starts and what the city is doing that day?

In 2021 I answered it with one PySpark notebook (now in [`coursework/`](coursework/)). It took the 84 million trips of 2019 through four rounds of cleaning and joined NOAA Central Park weather, NYC permitted events and NYPD collisions to each trip. It drew Folium choropleths of every taxi zone and fitted an elastic-net linear regression with a hand-written 10-fold cross-validation.

The revival keeps those methods as they were. It re-runs every cleaning rule with DuckDB on TLC's current copy of the data and checks each step against the row counts the notebook printed. It scores the 2021 coefficients on the revived data and puts the results on a website you can explore.

## Results: 2021 notebook vs the revival

| Checkpoint | 2021 notebook | Revived (DuckDB) | Difference |
| --- | ---: | ---: | ---: |
| Raw 2019 records | 84,399,019 | 84,598,444 | +0.236% ¹ |
| After `dropna()` | 79,296,437 | 79,297,843 | +0.002% |
| End of round 1 (value ranges, vendor 4) | 76,487,438 | 76,488,807 | +0.002% |
| Fare z-score ≤ 3 | 76,486,691 | 76,488,060 | +0.002% |
| Duplicates removed | 76,486,688 | 76,488,057 | +0.002% |
| Fare ≥ $2.50 | 76,486,337 | 76,487,706 | +0.002% |
| Distance / minutes ≤ 50 | 76,475,571 | 76,478,068 | +0.003% |
| Trip ≤ 180 minutes | 76,269,392 | 76,271,886 | +0.003% |
| Tip ≤ half the fare | 75,673,363 | 75,675,844 | +0.003% |
| Zones, weather and events joined | 75,183,226 | 75,185,703 | +0.003% |
| **Final analysis dataset** | **74,908,426** | **74,910,889** | **+0.003%** |

¹ TLC's 2022 Parquet re-issue of 2019 has about 199,000 extra rows, almost all with missing fields, so they fall out at `dropna()`.

| Trip-duration model (10-fold CV, mean of folds) | R² | RMSE (min) |
| --- | ---: | ---: |
| 2021 notebook, as printed | 0.3665 | 9.175 |
| 2021 coefficients scored on the revived folds | 0.3681 | 9.179 |
| 2026 refit, same features and penalty, solved to convergence | 0.3680 | 9.180 |

The model is Spark MLlib `LinearRegression(regParam=0.3, elasticNetParam=0.8)` on 579 features: 11 weather, event and collision columns plus one-hot weekday, hour, rate code, passenger count, pickup zone, vendor, drop-off zone and store-and-forward flag. The penalty kept 83 of them. Every weather variable shrank to zero; airports, rate codes and zones did the work. The refit's zone coefficients correlate with the 2021 ones at r = 0.99996.

## The 2026 upgrade: rigour, decisions and governed AI

The revival reproduced the 2021 results. The upgrade asks how good they are, how sure we can be, and what a careful reviewer would want to see next to them. Every quantitative result now comes with its uncertainty, its sample size and, where resampling is involved, its seed.

| Question | Answer | Where |
| --- | --- | --- |
| How does the 2021 specification do on months it never saw? | Fitted on January to October and tested on November and December, RMSE 9.47 min (95% CI 9.18 to 9.73) and R² 0.353 (0.341 to 0.365). The intervals come from a bootstrap over 61 test days (B = 2,000, seed 20190101). | `/evaluation` |
| Is it better than a lookup table? | No. The January to October median for the same route and hour scores RMSE 6.24 min, 3.23 minutes better (paired 95% CI 3.10 to 3.34). The model adds zone effects, so it cannot know how far apart two zones are. | `/evaluation` |
| How sure are the coefficients? | The unpenalised OLS counterpart on 74,941,355 rows gets classical, HC3 and day-clustered standard errors. Clustering by day makes the weather intervals 30 to 52 times wider, because weather varies over 351 days, not 75 million trips. | `/evaluation` |
| How wide is an honest prediction interval? | Split-conformal intervals, Mondrian by pickup borough and predicted duration, cover 90.0% of 7,497,013 held-out trips (95% CI 89.9% to 90.1%, resampling 347 test days) with a mean width of 26.4 min. They cover 90% in every borough and 88% to 92% in every decile, and coverage slips to 88.8% (88.4% to 89.2%) on November and December. Coverage moves together within a day, so these intervals resample days: treating the trips as independent would make them about 6 to 12 times too narrow. | `/estimate`, `/evaluation`, [DR-003](docs/decisions/DR-003-conformal-intervals.md) |
| Does rain slow taxis? | Comparing each trip with its own route and hour, wet days are 3.4% slower (95% CI 1.9% to 4.8%) after month, weekday and holiday effects, over 333 days. Neighbouring days are alike (Durbin–Watson 0.88), and Newey–West errors with 7 lags give 2.0% to 4.8%, so the estimate holds. | `/effects` |
| Do permitted events? | In 31 matched pairs of event-heavy and ordinary borough-days, which fall on 16 dates, the difference is −0.6% (95% CI −2.8% to +1.8%, resampling dates rather than pairs). There is no detectable effect, which agrees with the 2021 model's zero coefficient. | `/effects` |
| What do the cleaning rules catch, and what gets through? | Every rule's removals, its failures on its own and its sole responsibility, with reasons. One finding is that vendor 1 leaves the $2.50 congestion surcharge out of `total_amount` on 23.4 million trips. | `/data-quality`, [DR-002](docs/decisions/DR-002-cleaning-thresholds.md) |

### Methods, decision records and the model card

`/methods` renders the documents in [`docs/`](docs/), which cover data provenance, method, evaluation design, assumptions, limitations and what I would change. It also renders the [model card](docs/model-card.md), the [AI use statement](docs/ai-use-statement.md) and four decision records:

- [DR-001](docs/decisions/DR-001-pyspark-to-duckdb.md): re-run the 2021 pipeline with DuckDB instead of PySpark.
- [DR-002](docs/decisions/DR-002-cleaning-thresholds.md): keep the 2021 cleaning thresholds as they ran, and report what they miss.
- [DR-003](docs/decisions/DR-003-conformal-intervals.md): split-conformal prediction intervals, Mondrian by borough and predicted duration.
- [DR-004](docs/decisions/DR-004-byok-text-to-sql.md): "Ask the data" uses the visitor's own key in the browser and validates SQL on the server.

Each record states the decision first, then the context, the options considered, why, what happened (weak numbers included) and what I would change. Past records are never edited. A changed decision gets a new record that supersedes the old one. The website reads copies in `web/content/`, kept in step by `pnpm docs:sync` and checked by a test.

### Optional AI: bring your own key

"Ask the data" (`/ask`) turns a question into one SQL query over the analytics database. It is optional, and the rest of the site works without it.

- **Your key, your browser.** Open the key icon in the header to choose Anthropic (Claude Haiku 4.5 by default, or Claude Sonnet 5.5) or OpenAI, and paste your own API key. The key is kept in sessionStorage, or in localStorage if you tick "remember on this device", and "Forget key" removes it. Your browser calls the provider directly. The key is never sent to this site's server, never logged and never committed.
- **A human decides.** The proposed SQL, its explanation and its assumptions are shown, labelled "AI-generated". Nothing runs until you choose to run it, edit it or discard it.
- **The server checks every query.** `/api/sql` receives only SQL. It accepts one read-only SELECT, refuses recursive and expensive plans, and runs on a connection with `PRAGMA query_only = ON`, a 64 MB SQLite memory limit and a 3-second time limit, one query at a time. Long text values are shortened, results over 1 MB are refused, and each address gets 20 queries a minute. You can also write SQL yourself without a key.
- **Measured, not trusted.** `/ask/eval` runs your chosen model on 24 questions with hand-written reference answers. It reports execution accuracy with Wilson intervals, separately for the 7 questions the prompt's domain notes were written for, and compares two runs (two models, or two prompts) with an exact McNemar test.

### Viewing the AI audit log

Every AI call made on the site is logged in your browser's IndexedDB. Each entry holds the time, the feature, the provider, the requested and the answering model, the input (never the key), the output, the latency, the token usage and every decision you made, in order (accepted, edited or rejected; "no output" for failed calls and "not applicable" for evaluation runs). Later decisions are appended, never overwritten. Open [`/ai-log`](https://mast30034-nyc-taxi.vercel.app/ai-log) to review it, filter it, export it as JSON or CSV, or clear it. The site keeps no server-side copy, so the log only ever shows calls from your own browser.

## The website

| Route | What it does |
| --- | --- |
| `/` | The story in plain language, key numbers, and the "About this project" section |
| `/map` | MapLibre choropleth of all 263 taxi zones: pickups or drop-offs, trips or median minutes, any weekday and hour, with a "play the day" animation and per-zone details |
| `/routes` | Route explorer: the busiest destinations from (or origins to) any zone, drawn as subway-style lines; the top 30 routes and the borough-to-borough matrix for the whole year |
| `/conditions` | Every day of 2019 next to weather, permitted events and collisions; a day-level scatter explorer; the weekday-by-hour trip-time heatmap per vendor; the fate of the 11 numeric features |
| `/estimate` | The 2021 regression running in the browser: pick zones, a 2019 date and an hour, and see the prediction with an 80%, 90% or 95% split-conformal interval, the refit, the observed median and every term of the sum |
| `/evaluation` | Temporal hold-out with day-bootstrap intervals and baselines, OLS coefficients with classical, HC3 and day-clustered standard errors, residual diagnostics and conformal coverage |
| `/effects` | Rain and permitted-event effects on a composition-adjusted duration index, with bootstrap, HC3 and Newey–West intervals, effect sizes, a matched comparison and caveats |
| `/data-quality` | Every cleaning rule with rows removed in sequence, failing alone and failing only that rule, missing values by month and the implausible records that got through |
| `/ask`, `/ask/eval` | Optional bring-your-own-key text-to-SQL with human review, and its evaluation harness |
| `/ai-log` | The AI audit log of this browser, with JSON and CSV export |
| `/methods`, `/methods/decisions/…` | Data provenance, evaluation design, assumptions, limitations, decision records, the model card and the AI use statement |
| `/method` | The cleaning funnel rule by rule with both sets of counts, the quirks of the 2021 rules, a "would your trip survive?" rule tester, fold-by-fold parity charts and the regularisation path |
| `/records` | Browse, search, sort and download (CSV) every table of the analytics database |
| `/tour` | The guided tour: three captioned walkthrough videos with written transcripts, and every screenshot in a lightbox |
| `/api/zones`, `/api/routes`, `/api/route-hourly` | Read-only JSON used by the interactive pages |
| `/api/sql` | POST one read-only SQL query and get rows back (validated, cost-checked, stopped after 3 seconds, at most 500 rows, rate-limited) |

Everything is static or served from a bundled read-only SQLite file. There is no database server, no account and no API key of mine. The optional AI feature uses the visitor's own key from their browser. Map tiles come from [OpenFreeMap](https://openfreemap.org) (free, no key). If they fail to load, the maps fall back to bundled borough outlines.

## Tech stack

| Layer | 2021 | 2026 revival |
| --- | --- | --- |
| Trip data | 12 monthly CSVs from TLC's S3 bucket (now gone) | TLC's 2019 Parquet re-issue on CloudFront |
| Engine | PySpark 3.1.2 under WSL | DuckDB in [uv](https://docs.astral.sh/uv/) scripts with inline (PEP 723) dependencies |
| Model | Spark MLlib elastic net, `maxIter=10`, manual 10-fold CV | NumPy coordinate descent on exact sufficient statistics, same objective as Spark |
| Maps | Folium with Stamen tiles (discontinued) | MapLibre GL JS 6 with OpenFreeMap vector tiles and a bundled GeoJSON fallback |
| App | A 22 MB notebook | Next.js 16 (App Router, Server Components), React 19, TypeScript (strict), Tailwind CSS 4 with shadcn/ui theme tokens, Recharts, next-themes, zod |
| Data at runtime | n/a | `web/data/analytics.db` (16.1 MB, 37 tables of aggregates) read with `@libsql/client`, and with libsql's promise API for visitor SQL so a query can be interrupted |
| Statistics | Spark's `RegressionEvaluator` | A small TypeScript library (`web/src/lib/stats/`: Wilson, bootstrap, t and normal quantiles, OLS with HC3 and Newey–West, McNemar, effect sizes) tested against scipy, statsmodels and R. HC3 and clustered SEs over 75 million rows in NumPy (`scripts/sparse_ols.py`) |
| AI (optional) | n/a | Bring your own key: the official Anthropic SDK in browser mode or `fetch` to OpenAI, zod-validated structured output, an IndexedDB audit log |
| Quality | n/a | Vitest unit and parity tests (226), ESLint, Prettier, GitHub Actions CI |

## Repository structure

```
.
├── README.md
├── .github/workflows/ci.yml     lint, format, typecheck, test and build of web/
├── coursework/                  the original 2021 submission, unchanged (see coursework/README.md)
│   ├── Project 1 1118472.ipynb
│   ├── Download scripts/  Preprocess/  plot/  _archive/
│   ├── 10-folds-linear-regression.csv
│   └── requirements.txt  pyproject.toml  init.py  library.py  ...
├── docs/                        methods, model card, AI use statement, decision records (rendered on /methods)
│   ├── methods.md  model-card.md  ai-use-statement.md
│   ├── decisions/DR-001 … DR-004
│   └── showcase/                README screenshots and walkthrough GIFs (pnpm showcase)
├── scripts/                     reproducible data pipeline (uv + DuckDB)
│   ├── fetch_data.py            raw inputs -> data-cache/ (git-ignored)
│   ├── pipeline.py              the 2021 cleaning and merge rules -> data-cache/work.duckdb
│   ├── fit_model.py             scores the 2021 coefficients, refits the model
│   ├── rigour.py                OLS with HC3 and day-clustered SEs, hold-out, residuals, conformal intervals
│   ├── sparse_ols.py            sparse-design OLS helpers, self-checked against statsmodels
│   ├── effects.py               day and borough-day duration indices for the rain and event analyses
│   ├── data_quality.py          what each cleaning rule catches, missing values, residual checks
│   ├── build_analytics.py       aggregates -> web/data/analytics.db + GeoJSON + model JSON
│   ├── build_evidence_tables.py rigour, effects and data-quality outputs -> analytics.db + conformal.json
│   ├── stats_reference.py       scipy, statsmodels and R reference values for the TypeScript tests
│   ├── export_fixtures.py       parity fixtures for the TypeScript tests
│   ├── common.py                paths and the notebook's printed counts
│   └── out/                     pipeline, model, rigour, effects and data-quality reports (JSON)
└── web/                         the Next.js app (Vercel root directory)
    ├── content/                 copies of docs/ for the website (pnpm docs:sync)
    ├── data/analytics.db        read-only aggregates (built by scripts/build_analytics.py)
    ├── public/data/             zones.geojson, boroughs.geojson
    ├── public/showcase/         walkthrough MP4s, captions, posters and screenshots for /tour
    ├── e2e/                     the Playwright guided tour (pnpm showcase), which is also an end-to-end test
    ├── scripts/                 runs the tour on the system Chrome and encodes the media with ffmpeg and sharp
    ├── tools/                   copies the MapLibre worker and syncs docs/ at dev/build time
    └── src/
        ├── app/                 routes: /, map, routes, conditions, estimate, evaluation, effects, data-quality,
        │                        ask, ai-log, method, methods, records, tour, api
        ├── components/          layout/, ai/, ask/, evidence/, map/, explorer/, charts/, controls/, ...
        ├── hooks/               theme, reduced motion, JSON fetch, AI settings
        ├── lib/                 framework-free code: model, cleaning, metrics, holdout, effects, conformal,
        │   ├── stats/           Wilson, bootstrap, distributions, OLS with HC3 and Newey–West, McNemar, effect sizes
        │   └── ai/              provider adapters, key storage, audit log, text-to-SQL prompt and evaluation
        └── server/              server-only: analytics.db access, records, evidence, SQL guard, docs
```

## Local development

Requirements: Node 20.9 or newer and pnpm 10 (`corepack enable`).

```bash
cd web
pnpm install
pnpm dev            # http://localhost:3000
pnpm lint && pnpm format:check && pnpm typecheck && pnpm test && pnpm build
pnpm start -p 3303  # serve the production build
```

`pnpm typecheck` runs `next typegen` first, because the global route types (`PageProps`, `LayoutProps`, `RouteContext`) only exist after type generation.

### Recording the showcase

```bash
cd web
pnpm showcase                                   # tour the production site, then rebuild docs/showcase/ and public/showcase/
BASE_URL=http://localhost:3303 pnpm showcase    # tour a local `pnpm build` (the server is started for you)
pnpm showcase:test                              # the journeys as a quick end-to-end test: no pauses, no video
```

The tour runs on the system Google Chrome (Playwright channel `chrome`) and the `ffmpeg` on your PATH; no browser or ffmpeg build is downloaded. It writes raw screenshots and recordings to `web/.showcase/` (git-ignored), and `scripts/showcase-media.mjs` turns them into optimised PNGs (under 600 KB), WebP copies, H.264 MP4s and GIFs (under 8 MB each) and WebVTT captions. The captions come from `web/src/lib/showcase.ts`, which `src/lib/showcase.test.ts` checks against the README and the caption files.

No environment variables are needed (see `web/.env.example`), and no AI key is needed to build, test or run the site. AI keys are entered in the browser only. Metadata and Open Graph URLs use `NEXT_PUBLIC_SITE_URL` when it is set; otherwise they follow Next.js's own fallback: the Vercel production domain on production deploys, the branch URL on previews and `http://localhost:$PORT` locally.

### Deploying

Production runs on Vercel as the project `mast30034-nyc-taxi` ([mast30034-nyc-taxi.vercel.app](https://mast30034-nyc-taxi.vercel.app)), deployed from `web/` with `vercel deploy --prod`. To deploy your own copy, point a Vercel project at the `web/` directory. `next.config.ts` traces `data/analytics.db` into every server function (`outputFileTracingIncludes`). On Vercel the file is copied to `/tmp` once per cold start and opened read-only.

## How the data artefacts are generated

The website ships only aggregates. The raw trips (1.2 GB of Parquet) and the DuckDB work file (about 27 GB) live in the git-ignored `data-cache/`. To rebuild everything from public sources, install [uv](https://docs.astral.sh/uv/), then run from the repository root:

```bash
uv run scripts/fetch_data.py       # 12 TLC Parquet files, 2019 events from NYC Open Data, and the
                                   # collision/weather/taxi-zone files extracted from the 2021 snapshot zip
uv run scripts/pipeline.py         # the notebook's cleaning rounds and joins; writes scripts/out/pipeline_report.json
uv run scripts/fit_model.py        # 10-fold scoring of the 2021 coefficients + converged refit + regularisation path
uv run scripts/rigour.py           # OLS with HC3/clustered SEs, hold-out, residuals, conformal with day-bootstrap
                                   # coverage intervals (about 4 minutes)
uv run scripts/effects.py          # day and borough-day duration indices for the rain and event analyses
uv run scripts/data_quality.py     # what each cleaning rule catches, missing values, residual checks
uv run scripts/build_analytics.py  # web/data/analytics.db (calls build_evidence_tables.py), GeoJSON, model JSON
uv run scripts/export_fixtures.py  # web/src/lib/__fixtures__/model-rows.json for the parity tests
uv run scripts/stats_reference.py  # scipy/statsmodels/R values for the statistics tests (no data needed)
```

`scripts/build_evidence_tables.py` can also run on its own. It replaces only the evidence tables in an existing `analytics.db` and rewrites `web/src/lib/data/conformal.json`, the interval table the estimator uses.

Each script declares its own dependencies (DuckDB, NumPy, pyshp, pyproj, Shapely) in a PEP 723 header, so there is no environment to set up. The pipeline needs about 20 GB of memory and 40 GB of free disk.

Sources and provenance:

- **Taxi trips:** NYC TLC Trip Record Data, yellow taxi 2019 (Parquet, `d37ci6vzurychx.cloudfront.net`).
- **Weather, collisions, taxi zones:** the exact files the 2021 notebook used, taken from `coursework/mast30034_2021_s2_project_1-chuangyu-hscy-main.zip`. These are NOAA GHCN-Daily for Central Park, the NYPD motor-vehicle collisions BigQuery export, and the TLC zone lookup and shapefile.
- **Permitted events:** NYC Open Data `bkfu-528j`, events starting in 2019. The dataset has been revised since 2021 and is much smaller now. This does not affect the model, which gave events a zero coefficient.

`analytics.db` has 37 tables. The 18 from the revival hold zones, zone-by-hour and zone-by-vendor counts, every zone-to-zone route, hourly profiles of busy routes, borough flows, the daily series, weekday-by-hour-by-vendor times, weather, events, collisions, the cleaning funnel, the model's folds, coefficients, regularisation path and zone index, and the table descriptions. The 19 evidence tables added in the upgrade hold the OLS coefficients with their standard errors, the per-day hold-out errors, the residual diagnostics, the conformal bins, coverage and coverage per test day, the duration indices behind `/effects` and the data-quality report (`dq_*`). No individual trip is stored.

### Viewing the records

The site is read-only, so there is no admin login or hosted database: every visitor sees the same bundled `web/data/analytics.db`. Three ways to look inside it:

- **On the website:** [`/records`](https://mast30034-nyc-taxi.vercel.app/records) lists all 37 tables with row counts and descriptions. Each table page has search, sortable columns, pagination and a CSV download.
- **Locally:** open `web/data/analytics.db` in any SQLite browser (DB Browser for SQLite, Datasette, the `sqlite3` shell). For example: `sqlite3 web/data/analytics.db "select * from routes order by trips desc limit 5"`.
- **As JSON:** the read-only API routes `/api/zones`, `/api/routes` and `/api/route-hourly` serve the slices the interactive pages use.

### The cleaning rules, quirks included

The revival runs the rules as the notebook ran them, not as its comments describe them. `/method` documents each quirk:

- the "miles per hour" rule divides miles by *minutes*, so it only removes trips faster than 50 miles per minute;
- the tip rule keeps tips up to half the fare (`fare_amount >= 2 * tip_amount`);
- `dropna()` removes 1 to 20 January, because TLC left `congestion_surcharge` empty until 21 January 2019;
- the zone filter only removes trips from zone 264 to zone 265;
- the model joins the shapefile's zone names, where LocationIDs 56 and 103 appear more than once.

## Tests and parity

`pnpm test` runs 226 Vitest tests. No test calls an AI provider: every provider call is made against a mocked `fetch`. The suites cover the TypeScript ports of 2021, the statistics behind the upgrade and the AI client:

- `model.ts`: the 579-feature VectorAssembler layout, one-hot encoding and prediction. The shipped coefficients must equal fold 1 of `coursework/10-folds-linear-regression.csv` (read from the original file), the coefficients printed in notebook cell 296 and the zone order the notebook's StringIndexer produced (pickup 125 is Borough Park, drop-off 20 is Sutton Place/Turtle Bay North, so coefficients 64 and 70 are JFK and LaGuardia). For 40 real rows of the revived model table, the TypeScript port must also reproduce the feature indices and both predictions (2021 and refit) computed in Python with NumPy to 9 decimal places.
- `cleaning.ts`: every cleaning rule as a predicate, tested against rows and thresholds printed in the notebook, such as the z-score bound 13.0258 + 3 × 94.3733. Malformed timestamps typed into the `/method` rule tester are reported as input errors instead of being blamed on a rule.
- `metrics.ts`: R² and RMSE as Spark's `RegressionEvaluator` computes them, and scoring from sufficient statistics as `fit_model.py` does.
- `server/analytics.test.ts`: the bundled database against the notebook. It checks the funnel counts, the vendor-by-weekday mean trip times and the borough matrix from the notebook's 10% sample, and the 2021 fold results.
- `server/records.test.ts`: the records browser's default order, sorting and search escaping.
- `lib/stats/`: the normal, t and binomial distributions, Wilson intervals, type-7 and conformal quantiles, Welch and paired t tests, Cohen's d, Hedges' g, OLS with classical, HC0, HC1, HC3 and Newey–West standard errors, the Durbin–Watson statistic, and the exact McNemar test. Each is checked against values computed with scipy, statsmodels and R by `scripts/stats_reference.py`, mostly to 1e-10 or better. The seeded bootstrap is checked for reproducibility and against t intervals.
- `lib/effects.test.ts`, `lib/holdout.ts`, `lib/conformal.ts`: the rain analysis recovers a planted 5% effect, the matched event comparison pairs only same-weekday days within four weeks, skips holidays and treats dates rather than pairs as the independent units, day-bootstrap metrics match metrics computed from the trips, and the estimator's interval lookup bins predictions as numpy does and reports coverage for the same borough and bin.
- `server/evidence.test.ts`: the coverage intervals that `scripts/rigour.py` computes (it ports the website's mulberry32 generator) match the website's own day bootstrap to 1e-10, and they are much wider than Wilson intervals that treat trips as independent.
- `lib/ai/`: the Anthropic adapter sends the browser-access header, the key and structured-output settings, and the Sonnet requests carry server-side fallbacks. Errors map to visitor messages (invalid key, rate limit, overloaded, network or CORS, refusal, truncation) without echoing the key. The OpenAI adapter, zod validation, key storage (sessionStorage by default, localStorage on request, forget), the IndexedDB audit log (through `fake-indexeddb`), key redaction, JSON and CSV export, the execution-accuracy comparison and the paired run comparison are tested too.
- `server/sql-guard.test.ts`, `server/ask.test.ts`: the SQL validator rejects writes, pragmas, multiple statements, the RECURSIVE keyword, dangerous functions (also when their names are quoted) and `generate_series`. The plan check refuses recursive CTEs written without the keyword. The cost guard refuses cartesian products, runaway correlated subqueries and joins on low-cardinality columns. Queries that build huge strings hit the 64 MB heap limit, slow queries are interrupted without blocking the event loop, long cells are shortened, results over 1 MB are refused, a full queue answers "busy" and a noisy client is rate-limited. Writes fail even if validation is bypassed (`PRAGMA query_only`). All 24 evaluation reference queries pass the guard and have no ties at their cut-off.
- `server/content.test.ts`: `web/content/` matches `docs/` exactly, and every decision record has the six sections in order.

## Credits

- **Author:** Sunchuangyu (Rin) Huang, student 1118472. Individual project.
- The download scripts were adapted from MAST30034 tutorial material. The manual cross-validation loop was adapted from the Anant CaSparkExtension notebook. Both are noted in the original notebook.
- Data: NYC Taxi & Limousine Commission, NOAA National Centers for Environmental Information, NYC Open Data, NYPD.
- Basemap © OpenStreetMap contributors, vector tiles by OpenFreeMap / OpenMapTiles.

## Academic integrity

The 2021 notebook, scripts, figures and per-fold results are kept unchanged in [`coursework/`](coursework/) for reference. The written report is on Overleaf (link in `coursework/_archive/README.original.md`). The assignment brief and other subject material are not reproduced here or on the website. If you are taking MAST30034, please do your own project.
