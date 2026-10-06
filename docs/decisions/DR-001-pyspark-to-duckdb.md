# DR-001: Re-run the 2021 pipeline with DuckDB instead of PySpark

- **Status:** Accepted
- **Date:** 2026-10-06
- **Decision:** Translate every cleaning rule of the 2021 PySpark notebook into DuckDB SQL, run it in single-file uv scripts, and fit and score the model from exact sufficient statistics instead of a Spark session.

## Context

The 2021 notebook (`coursework/Project 1 1118472.ipynb`) cleaned the 2019 yellow-taxi records with PySpark 3.1.2 on a laptop under WSL, with a 32 GB driver. Reviving it in 2026 ran into three problems. TLC's 2021 S3 bucket of monthly CSVs is gone, and only the 2022 Parquet re-issue is still published. A Spark session needs a JVM and a matching Python, which is a heavy dependency for a portfolio repository that other people should be able to run. Spark's `randomSplit` assigns rows to folds by partition-level sampling, so the notebook's ten folds cannot be replayed on different hardware anyway.

The goal of the revival was a faithful reproduction. Every rule had to run as the notebook ran it, quirks included, with every row count compared against the count the notebook printed.

## Decision

The rules live in `scripts/pipeline.py` as DuckDB SQL, one statement per notebook cell, with the notebook's printed counts stored next to them in `scripts/common.py`. The model is refitted in `scripts/fit_model.py` from exact X'X and X'y sums computed by GROUP BY queries, so no sampling is involved. Folds are a deterministic hash of each trip. Each script declares its own dependencies in a PEP 723 header and runs with `uv run`.

## Options considered

- **Run the original notebook again in a Spark container.** This is the most literal option, but it still needs the vanished CSVs, a JVM and about 32 GB of driver memory, and the folds would still differ from 2021.
- **pandas or Polars.** Both are pleasant for exploration, but 84.6 million rows with 19 columns do not fit comfortably in memory on one machine, and the cleaning rules would become dataframe code rather than the SQL-like expressions the notebook used.
- **DuckDB SQL in uv scripts.** It runs out of core on one machine, reads the TLC Parquet files directly, and lets each Spark filter become a WHERE clause that reads almost the same.
- **Spark on a hosted cluster.** It is faster at scale, but it costs money every time someone reproduces the work, and this dataset does not need a cluster.

## Why

DuckDB keeps the translation close to the original. A reviewer can put a notebook cell and the matching SQL side by side and check them line by line. It also makes exact statistics cheap. The full Gram matrix of the 579-feature model comes from about 40 GROUP BY queries, which means the refit and the scoring of the 2021 coefficients use every trip instead of a sample. Finally, `uv run scripts/pipeline.py` needs nothing installed beyond uv.

## What happened

After the opening `dropna()`, every checkpoint lands within 0.003% of the notebook's printed count. The raw count is 0.236% higher (84,598,444 against 84,399,019) because the Parquet re-issue holds about 199,000 extra rows, and almost all of them are missing fields and fall out at `dropna()`. The 2021 coefficients scored on the revived folds give a mean R² of 0.3681 against the notebook's 0.3665, and the converged refit gives 0.3680.

Some parts were weaker than I hoped. The pipeline needs about 20 GB of memory and 40 GB of free disk, and its DuckDB work file is 25.6 GB, so "runs on one machine" still means a well-equipped machine. The permitted-events dataset on NYC Open Data has been revised since 2021 and is about ten times smaller, so the events feature cannot be reproduced exactly. In October 2026 the data-quality script failed once with a corrupt temporary file while DuckDB was spilling three 80-million-row temporary tables to disk. Dropping each intermediate table as soon as it was no longer needed fixed it, but it shows the out-of-core path is less forgiving than the happy path. Spark's `maxIter=10` stopped short of convergence, so the 2026 refit is the model the notebook was aiming for rather than a byte-identical copy.

The same setup carried the 2026 rigour work. `scripts/rigour.py` streams all 74,941,355 model rows through NumPy in under four minutes to compute HC3 and day-clustered standard errors, hold-out errors and conformal intervals.

## What I'd change

I would write the final analysis dataset to partitioned Parquet instead of keeping a 25.6 GB DuckDB file, so later scripts could read it without holding a lock on the work database. I would pin the DuckDB version and record a checksum of each TLC file, so a future re-issue of the 2019 data would be detected instead of silently changing the counts. I would also add a small sample mode that runs the whole pipeline on one month in a few minutes, which would make continuous integration of the scripts possible.
