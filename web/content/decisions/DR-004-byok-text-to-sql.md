# DR-004: "Ask the data" uses the visitor's own key in the browser and validates SQL on the server

- **Status:** Accepted
- **Date:** 2026-10-06
- **Decision:** The optional "Ask the data" feature calls the language model from the visitor's browser with the visitor's own API key, shows the proposed SQL for a human to run, edit or discard, validates and runs that SQL read-only on the server, logs every call in the browser, and ships an evaluation harness that measures how often the model is right.

## Context

The site has no budget for AI. It is deployed on Vercel from a read-only SQLite file, with no user accounts and no writable database. I wanted one AI feature that shows how I would put a language model into a public-sector style workflow, with labelled outputs, a human decision, an audit trail and a measured error rate. Text-to-SQL over the site's own analytics database fits, because every answer can be checked against the database.

## Decision

The browser calls Anthropic (Claude Haiku 4.5 by default, Claude Sonnet 5.5 as an option) or OpenAI directly, using the official Anthropic SDK in browser mode or `fetch` for OpenAI. The key stays in sessionStorage unless the visitor ticks "remember on this device". The model returns structured JSON that is validated with zod. The SQL is shown and nothing runs until the visitor chooses. `/api/sql` receives only SQL. It accepts one SELECT or WITH statement without write, schema, pragma or recursive keywords, estimates the cost from SQLite's query plan, and runs the query on a dedicated connection with `PRAGMA query_only = ON` and a 500-row limit. Each AI call is written to an IndexedDB audit log with its input, output, model, latency, token usage and the human decision. A harness at `/ask/eval` runs 24 questions with hand-written reference queries and reports execution accuracy with Wilson intervals and paired McNemar comparisons.

## Options considered

- **A server-side proxy with my own key.** Visitors would need no key, but I would pay for every call and would have to defend the endpoint against abuse.
- **Running SQL in the browser with SQLite compiled to WebAssembly.** No server would be involved, but every visitor would download the 15.8 MB database, and I would lose a single point where every query is checked.
- **Bring your own key, with SQL checked on the server.** This costs me nothing and keeps the key away from my server, while every query still passes one guard.
- **No AI feature.** This is the safest option, but it shows nothing about how I would govern one.

## Why

The key never leaves the visitor's browser except to go to the provider they chose, and the server never sees it. The server treats SQL as untrusted whether a person or a model wrote it, so validation does not depend on the model behaving. A human decides before anything runs, and that decision is recorded next to the model's output, which makes the audit log useful for review rather than decorative. The harness turns "the model seems good" into a number with an interval.

## What happened

The validator, cost guard and read-only connection are covered by unit tests. They check that writes fail at the SQLite level even when validation is bypassed, that cartesian products and correlated subqueries over large tables are refused, and that all 24 reference queries pass. The cost guard first over-estimated joins written with table aliases, because SQLite's plan reports aliases rather than table names. Resolving aliases from the SQL fixed it. The schema prompt is about 15,500 characters in the described variant, roughly 4,000 tokens, and about 3,500 characters in the bare variant. Requests mark it for Anthropic's prompt caching, which only takes effect when a prompt is longer than the model's minimum cacheable length, so I did not count on it. Without caching, a full run of 24 questions costs roughly US$0.10 to US$0.20 on Claude Haiku 4.5.

I have not published an accuracy figure. Running the harness spends money on a key, and with 24 questions a single run's Wilson interval is roughly plus or minus 16 to 20 percentage points, which is too wide to support a claim. The harness exists so that anyone with a key can produce that figure and its interval for themselves.

## What I'd change

I would grow the question set to at least 100 questions with a second person writing reference answers, which would bring the interval down to about plus or minus 8 to 10 points. I would replace the plan-based cost estimate with an SQLite authorizer and a progress handler if the driver exposes them, so a runaway query could be stopped mid-statement. I would add rate limiting to `/api/sql` before the site gets real traffic.
