import { bootstrap, DEFAULT_SEED } from "@/lib/stats/bootstrap";
import { mcnemarExact } from "@/lib/stats/paired";
import { quantile } from "@/lib/stats/quantile";
import { wilsonInterval, type Interval } from "@/lib/stats/wilson";

/**
 * Evaluation harness for "Ask the data": a fixed set of questions with hand-written
 * reference SQL. A model's query passes when its result contains the reference result
 * (execution accuracy), so the score measures answers, not SQL style.
 */

export type Difficulty = "easy" | "medium" | "hard";

export interface GoldQuestion {
  id: string;
  question: string;
  sql: string;
  /** the order of the rows matters (rankings) */
  ordered: boolean;
  difficulty: Difficulty;
}

/**
 * Questions whose answer depends on a fact stated in the "described" prompt's domain notes
 * (src/lib/ai/sql-assistant.ts). The notes were written with these questions in view, so
 * accuracy on them is optimistic for new questions; summaries report them separately.
 */
export const NOTE_TARGETS: Readonly<Record<string, string>> = {
  q09: "collisions_hourly.borough is upper case",
  q10: "route zone ids join to zones.location_id",
  q11: "route zone ids join to zones.location_id",
  q13: "isodow 0 and hour 24 mean all days and the whole day in zone_hourly",
  q14: "isodow numbering (5 = Friday)",
  q18: "isodow numbering and trip-weighted averages",
  q19: "vendor 0 means both vendors; trip-weighted averages",
};

export function targetedByNote(id: string): boolean {
  return id in NOTE_TARGETS;
}

export const GOLD_QUESTIONS: readonly GoldQuestion[] = [
  {
    id: "q01",
    difficulty: "easy",
    ordered: false,
    question: "Which pickup zone had the most trips in 2019?",
    sql: "SELECT zone FROM zones ORDER BY pickups DESC LIMIT 1",
  },
  {
    id: "q02",
    difficulty: "easy",
    ordered: false,
    question: "How many taxi zones are in Staten Island?",
    sql: "SELECT count(*) FROM zones WHERE borough = 'Staten Island'",
  },
  {
    id: "q03",
    difficulty: "easy",
    ordered: false,
    question: "How many cleaned trips started in Manhattan and ended in Queens?",
    sql: "SELECT trips FROM borough_flows WHERE pickup_borough = 'Manhattan' AND dropoff_borough = 'Queens'",
  },
  {
    id: "q04",
    difficulty: "easy",
    ordered: false,
    question: "On which date in 2019 were there the most cleaned trips?",
    sql: "SELECT date FROM daily ORDER BY trips DESC LIMIT 1",
  },
  {
    id: "q05",
    difficulty: "easy",
    ordered: true,
    question:
      "List the five days of 2019 with the most precipitation, wettest first, with the precipitation in inches.",
    sql: "SELECT date, precipitation FROM weather ORDER BY precipitation DESC LIMIT 5",
  },
  {
    id: "q06",
    difficulty: "easy",
    ordered: false,
    question: "How many days in 2019 had at least one inch of precipitation?",
    sql: "SELECT count(*) FROM weather WHERE precipitation >= 1",
  },
  {
    id: "q07",
    difficulty: "easy",
    ordered: false,
    question: "What was the average daily TAVG temperature in July 2019, in degrees Fahrenheit?",
    sql: "SELECT avg(tavg) FROM weather WHERE date BETWEEN '2019-07-01' AND '2019-07-31'",
  },
  {
    id: "q08",
    difficulty: "easy",
    ordered: false,
    question: "How many permitted events started in Brooklyn in 2019?",
    sql: "SELECT sum(number_of_event) FROM events_daily WHERE borough = 'Brooklyn'",
  },
  {
    id: "q09",
    difficulty: "medium",
    ordered: false,
    question: "How many collisions were recorded in the Bronx in March 2019?",
    sql: "SELECT sum(collisions) FROM collisions_hourly WHERE borough = 'BRONX' AND date BETWEEN '2019-03-01' AND '2019-03-31'",
  },
  {
    id: "q10",
    difficulty: "medium",
    ordered: false,
    question: "What was the median trip time in minutes from JFK Airport to Times Sq/Theatre District?",
    sql: "SELECT r.median_min FROM routes r JOIN zones a ON a.location_id = r.pu_id JOIN zones b ON b.location_id = r.do_id WHERE a.zone = 'JFK Airport' AND b.zone = 'Times Sq/Theatre District'",
  },
  {
    id: "q11",
    difficulty: "medium",
    ordered: false,
    question: "Which drop-off zone received the most trips that started at LaGuardia Airport?",
    sql: "SELECT b.zone FROM routes r JOIN zones a ON a.location_id = r.pu_id JOIN zones b ON b.location_id = r.do_id WHERE a.zone = 'LaGuardia Airport' ORDER BY r.trips DESC LIMIT 1",
  },
  {
    id: "q12",
    difficulty: "medium",
    ordered: false,
    question: "What fraction (between 0 and 1) of all cleaned trips started and ended in Manhattan?",
    sql: "SELECT CAST(SUM(CASE WHEN pickup_borough = 'Manhattan' AND dropoff_borough = 'Manhattan' THEN trips ELSE 0 END) AS REAL) / SUM(trips) FROM borough_flows",
  },
  {
    id: "q13",
    difficulty: "medium",
    ordered: false,
    question:
      "At what hour of the day did JFK Airport have the most pickups, counting all days of the week together?",
    sql: "SELECT h.hour FROM zone_hourly h JOIN zones z ON z.location_id = h.location_id WHERE z.zone = 'JFK Airport' AND h.side = 'pickup' AND h.isodow = 0 AND h.hour < 24 ORDER BY h.trips DESC LIMIT 1",
  },
  {
    id: "q14",
    difficulty: "medium",
    ordered: false,
    question: "How many trips were picked up in Bronx zones on Fridays between 6 pm and 7 pm?",
    sql: "SELECT sum(h.trips) FROM zone_hourly h JOIN zones z ON z.location_id = h.location_id WHERE z.borough = 'Bronx' AND h.side = 'pickup' AND h.isodow = 5 AND h.hour = 18",
  },
  {
    id: "q15",
    difficulty: "medium",
    ordered: false,
    question:
      "Among trips that start and end in the same borough, which borough has the longest median trip time?",
    sql: "SELECT pickup_borough FROM borough_flows WHERE pickup_borough = dropoff_borough ORDER BY median_min DESC LIMIT 1",
  },
  {
    id: "q16",
    difficulty: "medium",
    ordered: false,
    question: "What was the 2021 notebook's mean R squared across its ten cross-validation folds?",
    sql: "SELECT avg(notebook_r2) FROM model_folds",
  },
  {
    id: "q17",
    difficulty: "medium",
    ordered: false,
    question: "How many of the 579 coefficients of the 2021 model are exactly zero?",
    sql: "SELECT count(*) FROM model_coefficients WHERE original_2021 = 0",
  },
  {
    id: "q18",
    difficulty: "hard",
    ordered: true,
    question:
      "For vendor 1, what was the trip-weighted mean trip time in minutes for each ISO weekday, Monday first?",
    sql: "SELECT isodow, SUM(trips * mean_min) / SUM(trips) FROM weekday_hour_vendor WHERE vendor = 1 GROUP BY isodow ORDER BY isodow",
  },
  {
    id: "q19",
    difficulty: "hard",
    ordered: false,
    question:
      "Which hour of the day has the longest trip-weighted mean trip time, across both vendors and all weekdays?",
    sql: "SELECT hour FROM weekday_hour_vendor WHERE vendor = 0 GROUP BY hour ORDER BY SUM(trips * mean_min) / SUM(trips) DESC LIMIT 1",
  },
  {
    id: "q20",
    difficulty: "hard",
    ordered: false,
    question:
      "Which step of the cleaning funnel removed the most rows compared with the step before it? Give its label.",
    sql: "SELECT label FROM (SELECT label, LAG(revived_rows) OVER (ORDER BY step) - revived_rows AS removed FROM cleaning_funnel) ORDER BY removed DESC LIMIT 1",
  },
  {
    id: "q21",
    difficulty: "hard",
    ordered: false,
    question: "In the OLS table with robust standard errors, which pickup zone has the largest coefficient?",
    sql: "SELECT label FROM ols_coefficients WHERE block = 'pickup_zone' ORDER BY estimate DESC LIMIT 1",
  },
  {
    id: "q22",
    difficulty: "hard",
    ordered: false,
    question:
      "What was the RMSE in minutes of the route x hour median baseline on the November-December temporal hold-out?",
    sql: "SELECT sqrt(SUM(sum_sq_err) / SUM(trips)) FROM holdout_daily WHERE split = 'temporal' AND model = 'route_hour_median'",
  },
  {
    id: "q23",
    difficulty: "hard",
    ordered: false,
    question:
      "What empirical coverage (a fraction) did the 90% Mondrian-by-borough conformal intervals reach on the random 2019 test fold, over all trips?",
    sql: "SELECT CAST(covered AS REAL) / trips FROM conformal_coverage WHERE scheme = 'random' AND method = 'mondrian_borough' AND level = 0.9 AND group_type = 'all'",
  },
  {
    id: "q24",
    difficulty: "hard",
    ordered: false,
    question:
      "Which residual data-quality check flagged the most trips in the final dataset? Give its label.",
    sql: "SELECT label FROM dq_residual_checks ORDER BY rows DESC LIMIT 1",
  },
];

export type Cell = string | number | null;

export interface ResultTable {
  columns: string[];
  rows: Cell[][];
}

/** Numbers compare to 6 significant digits (floating-point sums differ in the last bits); text is trimmed. */
export function cellKey(v: Cell): string {
  if (v === null || v === undefined) return "null";
  if (typeof v === "number") {
    if (!Number.isFinite(v)) return `n:${v}`;
    if (Number.isInteger(v)) return `n:${v}`;
    return `n:${Number(v.toPrecision(6))}`;
  }
  return `s:${String(v).trim()}`;
}

export interface Comparison {
  /** every reference column is present with the same rows (extra columns allowed) */
  lenient: boolean;
  /** as lenient, and no extra columns */
  strict: boolean;
  reason: string;
}

/**
 * Execution-accuracy comparison. Columns are matched by their values, not their names, so
 * aliases don't matter. Unordered questions compare the multiset of row tuples.
 */
export function compareResults(expected: ResultTable, actual: ResultTable, ordered: boolean): Comparison {
  const n = expected.rows.length;
  if (actual.rows.length !== n) {
    return { lenient: false, strict: false, reason: `returned ${actual.rows.length} row(s), expected ${n}` };
  }
  const ek = expected.rows.map((r) => r.map(cellKey));
  const ak = actual.rows.map((r) => r.map(cellKey));
  const colSig = (rows: string[][], j: number) => {
    const col = rows.map((r) => r[j]);
    return (ordered ? col : [...col].sort()).join("\u0001");
  };
  const eCols = expected.columns.length;
  const aCols = actual.columns.length;
  const candidates = Array.from({ length: eCols }, (_, j) => {
    const sig = colSig(ek, j);
    return Array.from({ length: aCols }, (_, k) => k).filter((k) => colSig(ak, k) === sig);
  });
  const missing = candidates.findIndex((c) => c.length === 0);
  if (missing >= 0) {
    return {
      lenient: false,
      strict: false,
      reason: `no column matches reference column ${missing + 1} (${expected.columns[missing]})`,
    };
  }
  const expectedRows = (
    ordered ? ek.map((r) => r.join("\u0002")) : ek.map((r) => r.join("\u0002")).sort()
  ).join("\u0003");
  const used = new Set<number>();
  const pick: number[] = [];
  const search = (j: number): boolean => {
    if (j === eCols) {
      const proj = ak.map((r) => pick.map((k) => r[k]).join("\u0002"));
      return (ordered ? proj : proj.sort()).join("\u0003") === expectedRows;
    }
    for (const k of candidates[j]) {
      if (used.has(k)) continue;
      used.add(k);
      pick.push(k);
      if (search(j + 1)) return true;
      pick.pop();
      used.delete(k);
    }
    return false;
  };
  if (!search(0)) return { lenient: false, strict: false, reason: "the rows do not match the reference" };
  const strict = aCols === eCols;
  return {
    lenient: true,
    strict,
    reason: strict ? "exact match" : `match with ${aCols - eCols} extra column(s)`,
  };
}

export type Outcome =
  | "pass"
  | "wrong_result"
  | "not_answerable"
  | "rejected_by_guard"
  | "sql_error"
  | "invalid_output"
  | "provider_error";

export interface EvalItemResult {
  id: string;
  difficulty: Difficulty;
  outcome: Outcome;
  lenient: boolean;
  strict: boolean;
  detail: string;
  sql: string | null;
  latencyMs: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  cachedInputTokens?: number | null;
  auditId: string | null;
  /** the model the provider reports it used (a refusal fallback can differ from the run's model) */
  answeredBy?: string | null;
}

export interface EvalRun {
  id: string;
  startedAt: string;
  finishedAt: string | null;
  provider: string;
  model: string;
  variant: string;
  questionSet: string;
  items: EvalItemResult[];
}

export type Accuracy = Interval & { n: number; passes: number };

export interface RunSummary {
  n: number;
  lenient: Interval & { passes: number };
  strict: Interval & { passes: number };
  /** lenient accuracy on questions no domain note was written for, and on those that have one */
  untargeted: Accuracy;
  targeted: Accuracy;
  /** lenient accuracy leaving out provider errors (overloaded, truncated, ...), which say nothing about the model's SQL */
  excludingProviderErrors: Accuracy;
  /** distinct models that answered, as reported by the provider */
  answeredBy: string[];
  byDifficulty: { difficulty: Difficulty; n: number; passes: number; ci: Interval }[];
  outcomes: Record<Outcome, number>;
  medianLatencyMs: number | null;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
}

export function summariseRun(items: readonly EvalItemResult[]): RunSummary {
  const n = items.length;
  const lp = items.filter((i) => i.lenient).length;
  const sp = items.filter((i) => i.strict).length;
  const outcomes = {
    pass: 0,
    wrong_result: 0,
    not_answerable: 0,
    rejected_by_guard: 0,
    sql_error: 0,
    invalid_output: 0,
    provider_error: 0,
  } as Record<Outcome, number>;
  for (const i of items) outcomes[i.outcome]++;
  const lat = items.map((i) => i.latencyMs).filter((v): v is number => v !== null);
  const accuracy = (g: readonly EvalItemResult[]): Accuracy => {
    const passes = g.filter((i) => i.lenient).length;
    return { ...wilsonInterval(passes, g.length), n: g.length, passes };
  };
  return {
    n,
    lenient: { ...wilsonInterval(lp, n), passes: lp },
    strict: { ...wilsonInterval(sp, n), passes: sp },
    untargeted: accuracy(items.filter((i) => !targetedByNote(i.id))),
    targeted: accuracy(items.filter((i) => targetedByNote(i.id))),
    excludingProviderErrors: accuracy(items.filter((i) => i.outcome !== "provider_error")),
    answeredBy: [...new Set(items.map((i) => i.answeredBy).filter((m): m is string => !!m))].sort(),
    byDifficulty: (["easy", "medium", "hard"] as const).map((d) => {
      const g = items.filter((i) => i.difficulty === d);
      const p = g.filter((i) => i.lenient).length;
      return { difficulty: d, n: g.length, passes: p, ci: wilsonInterval(p, g.length) };
    }),
    outcomes,
    medianLatencyMs: lat.length ? quantile(lat, 0.5) : null,
    inputTokens: items.reduce((s, i) => s + (i.inputTokens ?? 0), 0),
    outputTokens: items.reduce((s, i) => s + (i.outputTokens ?? 0), 0),
    cachedInputTokens: items.reduce((s, i) => s + (i.cachedInputTokens ?? 0), 0),
  };
}

export interface PairedComparison {
  /** questions both runs answered */
  n: number;
  bothPass: number;
  onlyA: number;
  onlyB: number;
  neither: number;
  /** accuracy(A) - accuracy(B) with a paired bootstrap interval over questions */
  difference: Interval & { B: number; seed: number };
  /** exact McNemar test on the discordant questions */
  mcnemarP: number;
  /** the same counts and test on questions no domain note was written for */
  untargeted: { n: number; onlyA: number; onlyB: number; mcnemarP: number };
}

/** Paired comparison of two runs on the same questions (lenient execution accuracy). */
export function compareRuns(
  a: readonly EvalItemResult[],
  b: readonly EvalItemResult[],
  seed = DEFAULT_SEED,
): PairedComparison {
  const byId = new Map(b.map((i) => [i.id, i]));
  const shared = a.filter((i) => byId.has(i.id));
  const pairs = shared.map((i) => [i.lenient ? 1 : 0, byId.get(i.id)!.lenient ? 1 : 0] as const);
  const free = shared
    .filter((i) => !targetedByNote(i.id))
    .map((i) => [i.lenient, byId.get(i.id)!.lenient] as const);
  const freeA = free.filter(([x, y]) => x && !y).length;
  const freeB = free.filter(([x, y]) => !x && y).length;
  const n = pairs.length;
  const onlyA = pairs.filter(([x, y]) => x === 1 && y === 0).length;
  const onlyB = pairs.filter(([x, y]) => x === 0 && y === 1).length;
  const bothPass = pairs.filter(([x, y]) => x === 1 && y === 1).length;
  const B = 4000;
  const diff = bootstrap(
    n,
    (w) => {
      let s = 0;
      let m = 0;
      pairs.forEach(([x, y], i) => {
        s += w[i] * (x - y);
        m += w[i];
      });
      return s / m;
    },
    { B, seed },
  );
  return {
    n,
    bothPass,
    onlyA,
    onlyB,
    neither: n - bothPass - onlyA - onlyB,
    difference: { estimate: diff.estimate, lower: diff.lower, upper: diff.upper, B, seed },
    mcnemarP: mcnemarExact(onlyA, onlyB),
    untargeted: { n: free.length, onlyA: freeA, onlyB: freeB, mcnemarP: mcnemarExact(freeA, freeB) },
  };
}

/** Approximate cost in US dollars from token counts (Anthropic list prices; null when unknown). */
export const PRICE_PER_MTOK: Record<string, { input: number; output: number }> = {
  "claude-haiku-4-5": { input: 1, output: 5 },
  "claude-sonnet-5-5": { input: 2, output: 10 },
};

/** Cache reads are billed at a tenth of the input price; cache writes (1.25x) are ignored, so this is approximate. */
export function estimateCostUsd(
  model: string,
  inputTokens: number,
  outputTokens: number,
  cachedInputTokens = 0,
): number | null {
  const p = PRICE_PER_MTOK[model];
  if (!p) return null;
  return (
    ((inputTokens - cachedInputTokens) * p.input +
      cachedInputTokens * p.input * 0.1 +
      outputTokens * p.output) /
    1e6
  );
}
