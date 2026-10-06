# DR-004: "Ask the data" uses the visitor's own key in the browser and validates SQL on the server

- **Status:** Accepted
- **Date:** 2026-10-06
- **Decision:** The optional "Ask the data" feature calls the language model from the visitor's browser with the visitor's own API key, shows the proposed SQL for a human to run, edit or discard, validates and runs that SQL read-only on the server, logs every call in the browser, and ships an evaluation harness that measures how often the model is right.

## Context

The site has no budget for AI. It is deployed on Vercel from a read-only SQLite file, with no user accounts and no writable database. I wanted one AI feature that shows how I would put a language model into a public-sector style workflow, with labelled outputs, a human decision, an audit trail and a measured error rate. Text-to-SQL over the site's own analytics database fits, because every answer can be checked against the database.

## Decision

The browser calls Anthropic (Claude Haiku 4.5 by default, Claude Sonnet 5.5 as an option) or OpenAI directly, using the official Anthropic SDK in browser mode or `fetch` for OpenAI. The key stays in sessionStorage unless the visitor ticks "remember on this device". The model returns structured JSON that is validated with zod. The SQL is shown and nothing runs until the visitor chooses. `/api/sql` receives only SQL. It accepts one SELECT or WITH statement without write, schema, pragma or recursive keywords, quoted function names or functions that build huge values or rows. It refuses query plans with a recursive step or an unapproved table-valued function, and plans whose estimated cost is too high. It runs the query on a dedicated connection with `PRAGMA query_only = ON`, a 64 MB SQLite heap limit, a 3-second time limit and a 500-row limit, one query at a time, and refuses results over 1 MB. Each address gets 20 queries a minute. Each AI call is written to an IndexedDB audit log with its input, output, model, latency, token usage and the human decision. A harness at `/ask/eval` runs 24 questions with hand-written reference queries and reports execution accuracy with Wilson intervals and paired McNemar comparisons.

## Options considered

- **A server-side proxy with my own key.** Visitors would need no key, but I would pay for every call and would have to defend the endpoint against abuse.
- **Running SQL in the browser with SQLite compiled to WebAssembly.** No server would be involved, but every visitor would download the 15.8 MB database, and I would lose a single point where every query is checked.
- **Bring your own key, with SQL checked on the server.** This costs me nothing and keeps the key away from my server, while every query still passes one guard.
- **No AI feature.** This is the safest option, but it shows nothing about how I would govern one.

## Why

The key never leaves the visitor's browser except to go to the provider they chose, and the server never sees it. The server treats SQL as untrusted whether a person or a model wrote it, so validation does not depend on the model behaving. A human decides before anything runs, and that decision is recorded next to the model's output, which makes the audit log useful for review rather than decorative. The harness turns "the model seems good" into a number with an interval.

## What happened

The validator, cost guard and read-only connection are covered by unit tests. They check that writes fail at the SQLite level even when validation is bypassed, that cartesian products and correlated subqueries over large tables are refused, and that all 24 reference queries pass. The cost guard first over-estimated joins written with table aliases, because SQLite's plan reports aliases rather than table names. Resolving aliases from the SQL fixed it.

Review before release found that the first version of the guard was weaker than this record claimed. A function name in quotes, such as `"printf"(...)`, slipped past the function check. Nested `replace()` calls could build strings of hundreds of megabytes. SQLite treats a CTE that refers to itself as recursive even without the keyword, so the keyword check missed it, and `generate_series` could count to billions. The cost estimate assumed an index lookup returns about the square root of the table's rows, which badly under-counted joins on columns with few distinct values: a self-join on a two-valued column was estimated at 31 million rows and visited 4.8 billion. Because the driver ran SQLite on the main thread, one such query blocked every other request.

Each gap now has a fix and a test. Quoted function names are refused, the plan check catches recursion and `generate_series`, and lookups into stored tables are bounded by the most common value of the searched columns. The heap limit stops huge values. Visitor SQL now runs through libsql's promise API, so it runs off the event loop and a timer can interrupt it. The query is wrapped so that SQLite computes the whole result in its first step, which keeps all the work interruptible. Lookups into intermediate results still use the square-root heuristic, and the time limit is what catches those. The schema prompt is about 15,500 characters in the described variant, roughly 4,000 tokens, and about 3,500 characters in the bare variant. Requests mark it for Anthropic's prompt caching, which only takes effect when a prompt is longer than the model's minimum cacheable length, so I did not count on it. Without caching, a full run of 24 questions costs roughly US$0.10 to US$0.20 on Claude Haiku 4.5.

I have not published an accuracy figure. Running the harness spends money on a key, and with 24 questions a single run's Wilson interval is roughly plus or minus 16 to 20 percentage points, which is too wide to support a claim. The harness exists so that anyone with a key can produce that figure and its interval for themselves.

## What I'd change

I would grow the question set to at least 100 questions with a second person writing reference answers, which would bring the interval down to about plus or minus 8 to 10 points. I would add an SQLite authorizer with an allowlist of functions if the driver exposed one, instead of a list of refused names. The rate limit is held in memory on each server instance, so it slows a single noisy client but is not a global quota. Before the site gets real traffic I would add a firewall rule in front of `/api/sql`. I wrote the "described" prompt's domain notes with the 24 questions in view, and 7 questions depend on a fact a note states, so the harness reports accuracy with and without them. A fair test of the notes needs a frozen prompt and new questions written afterwards.
