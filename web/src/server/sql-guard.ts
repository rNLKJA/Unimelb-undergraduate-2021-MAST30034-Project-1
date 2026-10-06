import "server-only";

import Database from "libsql/promise";
import { analyticsDbPath } from "./db";

/**
 * Read-only SQL for "Ask the data". The SQL may come from a language model or be typed by
 * a visitor, so the server treats it as untrusted and checks it in four layers:
 *
 * 1. `validateSql`: one statement, starting with SELECT or WITH, no write/schema/pragma
 *    keywords, no RECURSIVE keyword, no quoted function names and no functions that touch
 *    files, build huge values or generate unbounded rows.
 * 2. `checkPlan`: SQLite's own query plan (EXPLAIN QUERY PLAN) must not contain a recursive
 *    step (a CTE that refers to itself is recursive even without the keyword) or an
 *    unapproved table-valued function.
 * 3. `estimateCost`: the plan turned into an estimate of rows visited. Lookups into stored
 *    tables use the most frequent value of the searched columns, an upper bound per lookup;
 *    lookups into intermediate results use a heuristic. Queries over the limit are refused
 *    before they run.
 * 4. Execution on a dedicated connection with `PRAGMA query_only = ON` and a 64 MB SQLite
 *    heap limit, one query at a time, stopped with `sqlite3_interrupt` after
 *    QUERY_TIMEOUT_MS. Planning and statistics use a second read-only connection, because
 *    libsql leaves EXPLAIN statements open, which would keep an interrupt pending. The result is materialised inside SQLite (at most MAX_ROWS + 1 rows)
 *    so the whole query runs off the event loop, then long text cells are shortened and
 *    oversized results refused.
 *
 * The API key never reaches this module: the browser calls the model and sends only SQL.
 */

export const MAX_SQL_LENGTH = 4000;
export const MAX_ROWS = 500;
/** Upper bound on estimated rows visited (well under a second of SQLite work on these tables). */
export const COST_LIMIT = 50_000_000;
/** Wall-clock limit for one query; the statement is interrupted when it is reached. */
export const QUERY_TIMEOUT_MS = 3000;
/** SQLite heap limit for the process (PRAGMA hard_heap_limit), so no query can build huge values. */
export const HEAP_LIMIT_BYTES = 64 * 1024 * 1024;
/** Text cells longer than this are shortened in the response. */
export const MAX_CELL_CHARS = 10_000;
/** Results whose JSON is larger than this are refused. */
export const MAX_RESULT_BYTES = 1_000_000;
/** Queries waiting for the connection before new ones are turned away as busy. */
export const MAX_QUEUED = 4;
/** Rows assumed per call of an approved table-valued function (json_each, json_tree, pragma_*). */
const VIRTUAL_TABLE_ROWS = 10_000;

export type Validation = { ok: true; sql: string } | { ok: false; error: string };

const DENIED_KEYWORDS = [
  "ATTACH",
  "DETACH",
  "PRAGMA",
  "INSERT",
  "UPDATE",
  "DELETE",
  "DROP",
  "CREATE",
  "ALTER",
  "VACUUM",
  "REINDEX",
  "ANALYZE",
  "TRIGGER",
  "BEGIN",
  "COMMIT",
  "ROLLBACK",
  "SAVEPOINT",
  "RELEASE",
  "TRANSACTION",
  "RECURSIVE",
  "UPSERT",
];
const DENIED_FUNCTIONS = [
  "load_extension",
  "readfile",
  "writefile",
  "edit",
  "fts3_tokenizer",
  "zeroblob",
  "randomblob",
  "printf",
  "format",
  "sqlite_offset",
  "generate_series",
];
/** Table-valued functions a query may scan: their output is bounded by their input. */
const ALLOWED_VIRTUAL_TABLES = /^(json_each|json_tree|pragma_\w+)$/;

/** Blank out comments and single-quoted string literals so keywords inside them don't count. */
export function stripLiteralsAndComments(sql: string): string {
  let out = "";
  let i = 0;
  while (i < sql.length) {
    const ch = sql[i];
    const next = sql[i + 1];
    if (ch === "-" && next === "-") {
      const end = sql.indexOf("\n", i);
      i = end === -1 ? sql.length : end;
      out += " ";
    } else if (ch === "/" && next === "*") {
      const end = sql.indexOf("*/", i + 2);
      i = end === -1 ? sql.length : end + 2;
      out += " ";
    } else if (ch === "'") {
      let j = i + 1;
      while (j < sql.length) {
        if (sql[j] === "'" && sql[j + 1] === "'") j += 2;
        else if (sql[j] === "'") break;
        else j++;
      }
      out += "''";
      i = j + 1;
    } else {
      out += ch;
      i++;
    }
  }
  return out;
}

export function validateSql(input: string): Validation {
  if (typeof input !== "string") return { ok: false, error: "SQL must be text." };
  let sql = input.trim();
  while (sql.endsWith(";")) sql = sql.slice(0, -1).trimEnd();
  if (!sql) return { ok: false, error: "The query is empty." };
  if (sql.length > MAX_SQL_LENGTH)
    return { ok: false, error: `Queries are limited to ${MAX_SQL_LENGTH} characters.` };
  const bare = stripLiteralsAndComments(sql);
  if (bare.includes(";")) return { ok: false, error: "Only one statement is allowed." };
  if (!/^\s*(select|with)\b/i.test(bare))
    return { ok: false, error: "Only SELECT queries (optionally starting with WITH) are allowed." };
  for (const k of DENIED_KEYWORDS) {
    if (new RegExp(`\\b${k}\\b`, "i").test(bare))
      return { ok: false, error: `${k} is not allowed: the database is read-only.` };
  }
  // REPLACE is a statement and a string function; only the function form is allowed
  if (/\breplace\b(?!\s*\()/i.test(bare))
    return { ok: false, error: "REPLACE is only allowed as the replace() function." };
  // "printf"(...), [printf](...) and `printf`(...) call the same function as printf(...)
  if (/["`\]]\s*\(/.test(bare))
    return {
      ok: false,
      error: "Quoted names cannot be followed by a bracket: write function names without quotes.",
    };
  for (const f of DENIED_FUNCTIONS) {
    if (new RegExp(`\\b${f}\\s*\\(`, "i").test(bare))
      return { ok: false, error: `The function ${f}() is not allowed.` };
  }
  return { ok: true, sql };
}

export interface PlanRow {
  id: number;
  parent: number;
  detail: string;
}

export interface CostEstimate {
  rows: number;
  /** human-readable plan, one line per step */
  plan: string[];
}

/** Refuse plans the cost estimate cannot bound. Returns a reason, or null if the plan is acceptable. */
export function checkPlan(plan: readonly PlanRow[]): string | null {
  for (const { detail } of plan) {
    const d = detail.trim();
    if (/^RECURSIVE STEP/.test(d))
      return "Recursive queries are not allowed: a WITH clause may not refer to itself.";
    const v = /^SCAN (\S+) VIRTUAL TABLE/.exec(d);
    if (v && !ALLOWED_VIRTUAL_TABLES.test(v[1])) return `The table-valued function ${v[1]} is not allowed.`;
  }
  return null;
}

const SUBQUERY_ONCE =
  /^(SCALAR SUBQUERY|LIST SUBQUERY|COMPOUND QUERY|LEFT-MOST SUBQUERY|UNION|INTERSECT|EXCEPT|MERGE)/;

const NOT_ALIASES = new Set(
  "where join on using left right inner outer cross natural full group order limit having union intersect except window as select from and or not".split(
    " ",
  ),
);

/** Table aliases from FROM / JOIN clauses (`routes r`, `zones AS z`), which query plans report by alias. */
export function tableAliases(sql: string, tables: Iterable<string>): Record<string, string> {
  const known = new Set(tables);
  const out: Record<string, string> = {};
  const re = /(?:\bfrom\b|\bjoin\b|,)\s*"?([A-Za-z_]\w*)"?\s+(?:as\s+)?"?([A-Za-z_]\w*)"?/gi;
  for (const m of stripLiteralsAndComments(sql).matchAll(re)) {
    const [, table, alias] = m;
    if (known.has(table) && !NOT_ALIASES.has(alias.toLowerCase())) out[alias] = table;
  }
  return out;
}

function unquote(name: string): string {
  return name.replace(/^["`[]|["`\]]$/g, "");
}

/** Equality-constrained columns of a SEARCH step: `(a=? AND b>?)` gives ["a"]; null if none are listed. */
export function searchEqualityColumns(detail: string): string[] {
  const m = /\((.*)\)\s*$/.exec(detail);
  if (!m) return [];
  return m[1]
    .split(/\s+AND\s+/)
    .map((c) => /^(\w+)=\?$/.exec(c.trim())?.[1])
    .filter((c): c is string => !!c);
}

/** The base table a plan step refers to (resolving aliases), or null for CTEs and subqueries. */
function baseTable(
  name: string,
  tableRows: Record<string, number>,
  aliases: Record<string, string>,
): string | null {
  const key = unquote(name);
  if (key in tableRows) return key;
  const a = aliases[key];
  return a && a in tableRows ? a : null;
}

/** Base-table SEARCH steps and their equality columns, for which `maxRowsPerValue` is needed. */
export function searchedColumns(
  plan: readonly PlanRow[],
  tableRows: Record<string, number>,
  aliases: Record<string, string> = {},
): { table: string; column: string }[] {
  const out = new Map<string, { table: string; column: string }>();
  for (const { detail } of plan) {
    const m = /^SEARCH (\S+)/.exec(detail.trim());
    if (!m) continue;
    const table = baseTable(m[1], tableRows, aliases);
    if (!table) continue;
    for (const column of searchEqualityColumns(detail)) {
      if (column !== "rowid") out.set(`${table}.${column}`, { table, column });
    }
  }
  return [...out.values()];
}

/**
 * Estimated rows visited, from an EXPLAIN QUERY PLAN tree. Sibling SCAN/SEARCH steps are
 * nested loops (outer first), so their row factors multiply; correlated subqueries run once
 * per outer row; materialised CTEs and plain subqueries run once.
 *
 * Rows per SEARCH step: 1 for a rowid lookup. For a stored table, the largest number of rows
 * sharing one value of any equality-constrained column (`maxRowsPerValue`, keyed
 * "table.column"), which bounds every lookup; the whole table for range-only searches. For
 * CTEs and subqueries, whose columns have no statistics, about sqrt(n) rows (a heuristic: the
 * execution time limit catches what it misses).
 */
export function estimateCostFromPlan(
  plan: PlanRow[],
  tableRows: Record<string, number>,
  aliases: Record<string, string> = {},
  maxRowsPerValue: Record<string, number> = {},
): number {
  const children = new Map<number, PlanRow[]>();
  for (const r of plan) {
    const list = children.get(r.parent) ?? [];
    list.push(r);
    children.set(r.parent, list);
  }
  const derived = new Map<string, number>(); // CTE / subquery name -> output upper bound
  const fallback = Math.max(10_000, ...Object.values(tableRows));

  function rowsOf(name: string): number {
    const key = unquote(name);
    const t = baseTable(key, tableRows, aliases);
    return t ? tableRows[t] : (derived.get(key) ?? fallback);
  }

  function factor(detail: string): number | null {
    if (/^SCAN CONSTANT ROW/.test(detail)) return 1;
    if (/^SCAN \S+ VIRTUAL TABLE/.test(detail)) return VIRTUAL_TABLE_ROWS;
    let m = /^SCAN (\S+)/.exec(detail);
    if (m) return rowsOf(m[1]);
    m = /^SEARCH (\S+)/.exec(detail);
    if (m) {
      const eq = searchEqualityColumns(detail);
      if (eq.includes("rowid")) return 1;
      const n = rowsOf(m[1]);
      const table = baseTable(m[1], tableRows, aliases);
      if (table) {
        const bounds = eq.map((c) => maxRowsPerValue[`${table}.${c}`] ?? n);
        return bounds.length ? Math.min(n, ...bounds) : n;
      }
      return Math.min(n, Math.max(1, Math.round(Math.sqrt(n))));
    }
    return null;
  }

  /** returns [cost, max loop size] of a list of sibling steps */
  function walk(parent: number): [number, number] {
    let loop = 1;
    let cost = 0;
    let maxLoop = 1;
    for (const node of children.get(parent) ?? []) {
      const d = node.detail.trim();
      const f = factor(d);
      if (f !== null) {
        loop *= f;
        cost += loop;
        maxLoop = Math.max(maxLoop, loop);
        // a step may own children (e.g. a correlated subquery listed under it)
        const [c] = walk(node.id);
        cost += loop * c;
        continue;
      }
      const mat = /^(MATERIALIZE|CO-ROUTINE) (\S+)/.exec(d);
      const [c, inner] = walk(node.id);
      if (mat) {
        derived.set(unquote(mat[2]), Math.max(1, inner));
        cost += c;
      } else if (/^CORRELATED/.test(d)) {
        cost += loop * c;
      } else if (SUBQUERY_ONCE.test(d)) {
        cost += c;
        maxLoop = Math.max(maxLoop, inner);
      } else {
        // USE TEMP B-TREE ..., BLOOM FILTER ..., etc.: bookkeeping without a loop of its own
        cost += c;
      }
    }
    return [cost, maxLoop];
  }
  return walk(0)[0];
}

// ---------------------------------------------------------------- connection

interface Statement {
  raw(toggle?: boolean): Statement;
  all(...params: unknown[]): Promise<unknown[]>;
  columns(): { name: string }[];
}
interface Connection {
  prepare(sql: string): Promise<Statement>;
  exec(sql: string): Promise<void>;
  interrupt(): void;
}

export class QueryRejected extends Error {
  /** HTTP status for the API: 422 for the query itself, 503 when the server is busy */
  readonly status: number;
  constructor(message: string, status = 422) {
    super(message);
    this.name = "QueryRejected";
    this.status = status;
  }
}

interface Connections {
  /** runs visitor SQL; the only connection that is ever interrupted */
  runner: Connection;
  /** EXPLAIN QUERY PLAN and table statistics */
  planner: Connection;
}

let connections: Promise<Connections> | null = null;

async function openReadOnly(): Promise<Connection> {
  const db = new Database(analyticsDbPath(), {}) as unknown as Connection;
  await db.exec("PRAGMA query_only = ON");
  return db;
}

/**
 * Dedicated connections for visitor SQL, opened through libsql's promise API so statements run
 * off the Node event loop and can be interrupted. Writes are switched off at the SQLite level,
 * and the heap limit (process-wide) stops any query from building huge strings or blobs.
 */
function userConnections(): Promise<Connections> {
  connections ??= (async () => {
    const [runner, planner] = await Promise.all([openReadOnly(), openReadOnly()]);
    await runner.exec(`PRAGMA hard_heap_limit = ${HEAP_LIMIT_BYTES}`);
    return { runner, planner };
  })().catch((e: unknown) => {
    connections = null; // let the next request try again
    throw e;
  });
  return connections;
}

/** The connection visitor SQL runs on (exported for the write-protection test). */
export async function userConnection(): Promise<Connection> {
  return (await userConnections()).runner;
}

let tail: Promise<void> = Promise.resolve();
let queued = 0;

/** Run `fn` with the connections, one query at a time; refuse new work when too many are waiting. */
async function exclusive<T>(fn: (db: Connections) => Promise<T>): Promise<T> {
  if (queued >= MAX_QUEUED)
    throw new QueryRejected("The query service is busy. Try again in a few seconds.", 503);
  queued++;
  const previous = tail;
  let release!: () => void;
  tail = new Promise<void>((resolve) => (release = resolve));
  try {
    await previous;
    return await fn(await userConnections());
  } finally {
    queued--;
    release();
  }
}

function sqliteMessage(e: unknown): string {
  return e instanceof Error ? e.message.replace(/^SQLITE_\w+:\s*/, "") : String(e);
}

/**
 * Run one statement and return raw rows. With `timeoutMs`, the connection is interrupted when
 * the time is up (only used on the runner connection; planner statements are cheap and bounded).
 */
async function allRows(
  db: Connection,
  sql: string,
  timeoutMs: number | null = null,
): Promise<{ columns: string[]; rows: unknown[][] }> {
  let timedOut = false;
  const timer =
    timeoutMs === null
      ? undefined
      : setTimeout(() => {
          timedOut = true;
          db.interrupt();
        }, timeoutMs);
  try {
    const stmt = await db.prepare(sql);
    stmt.raw(true);
    const rows = (await stmt.all()) as unknown[][];
    return { columns: stmt.columns().map((c) => c.name), rows };
  } catch (e) {
    if (timedOut && timeoutMs !== null)
      throw new QueryRejected(
        `The query ran for more than ${timeoutMs / 1000} seconds and was stopped. Filter earlier, aggregate first or join on a key column.`,
      );
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------- table statistics

let tableRowsCache: Record<string, number> | null = null;
const columnsCache = new Map<string, Set<string>>();
const maxRowsCache = new Map<string, number>();

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

async function tableRows(db: Connection): Promise<Record<string, number>> {
  if (tableRowsCache) return tableRowsCache;
  const { rows: names } = await allRows(
    db,
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
  );
  const out: Record<string, number> = {};
  for (const [n] of names) {
    const name = String(n);
    const { rows } = await allRows(db, `SELECT COUNT(*) FROM ${quoteIdent(name)}`);
    out[name] = Number(rows[0][0]);
  }
  out.sqlite_master = names.length;
  out.sqlite_schema = names.length;
  tableRowsCache = out;
  return out;
}

/** Largest number of rows sharing one value of `table.column` (cached; the database never changes). */
async function maxRowsPerValue(db: Connection, table: string, column: string): Promise<number | null> {
  const key = `${table}.${column}`;
  const hit = maxRowsCache.get(key);
  if (hit !== undefined) return hit;
  let cols = columnsCache.get(table);
  if (!cols) {
    const { rows } = await allRows(db, `SELECT name FROM pragma_table_info('${table.replace(/'/g, "''")}')`);
    cols = new Set(rows.map((r) => String(r[0])));
    columnsCache.set(table, cols);
  }
  if (!cols.has(column)) return null;
  const { rows } = await allRows(
    db,
    `SELECT max(n) FROM (SELECT count(*) AS n FROM ${quoteIdent(table)} GROUP BY ${quoteIdent(column)})`,
  );
  const n = Number(rows[0]?.[0] ?? 0);
  maxRowsCache.set(key, n);
  return n;
}

async function planOf(db: Connection, sql: string): Promise<PlanRow[]> {
  try {
    const { rows } = await allRows(db, `EXPLAIN QUERY PLAN ${sql}`);
    return rows.map(([id, parent, , detail]) => ({
      id: Number(id),
      parent: Number(parent),
      detail: String(detail),
    }));
  } catch (e) {
    if (e instanceof QueryRejected) throw e;
    throw new QueryRejected(`SQLite could not plan this query: ${sqliteMessage(e)}`);
  }
}

async function costOf(db: Connection, sql: string): Promise<CostEstimate> {
  const plan = await planOf(db, sql);
  const problem = checkPlan(plan);
  if (problem) throw new QueryRejected(problem);
  const rows = await tableRows(db);
  const aliases = tableAliases(sql, Object.keys(rows));
  const freq: Record<string, number> = {};
  for (const { table, column } of searchedColumns(plan, rows, aliases)) {
    const n = await maxRowsPerValue(db, table, column);
    if (n !== null) freq[`${table}.${column}`] = n;
  }
  return { rows: estimateCostFromPlan(plan, rows, aliases, freq), plan: plan.map((p) => p.detail) };
}

/** Plan check and cost estimate for already-validated SQL (throws QueryRejected for a bad plan). */
export function estimateCost(sql: string): Promise<CostEstimate> {
  return exclusive(({ planner }) => costOf(planner, sql));
}

// ---------------------------------------------------------------- execution

export interface QueryResult {
  columns: string[];
  rows: (string | number | null)[][];
  truncated: boolean;
  /** text cells longer than MAX_CELL_CHARS that were shortened */
  shortenedCells: number;
  elapsedMs: number;
  estimatedRows: number;
}

function toCell(v: unknown): string | number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "bigint") return Number(v);
  if (typeof v === "number" || typeof v === "string") return v;
  if (v instanceof ArrayBuffer) return `<${v.byteLength} bytes>`;
  if (ArrayBuffer.isView(v)) return `<${v.byteLength} bytes>`;
  return String(v);
}

export interface RunOptions {
  /** wall-clock limit in milliseconds (tests use a shorter one) */
  timeoutMs?: number;
}

/** Validate, plan-check, cost-check and run a query. Throws QueryRejected for anything the visitor should see. */
export async function runReadOnly(
  input: string,
  { timeoutMs = QUERY_TIMEOUT_MS }: RunOptions = {},
): Promise<QueryResult> {
  const v = validateSql(input);
  if (!v.ok) throw new QueryRejected(v.error);
  return exclusive(async ({ runner, planner }) => {
    const cost = await costOf(planner, v.sql);
    if (cost.rows > COST_LIMIT) {
      throw new QueryRejected(
        `This query would visit roughly ${Math.round(cost.rows).toLocaleString("en-AU")} rows (the limit is ${COST_LIMIT.toLocaleString("en-AU")}). Join on a key column, filter earlier or avoid comparing every row with every other row.`,
      );
    }
    const t0 = performance.now();
    let rs;
    try {
      // MATERIALIZED makes SQLite compute the whole (limited) result in the first step, which
      // runs off the event loop and can be interrupted; later steps only read it back
      rs = await allRows(
        runner,
        `WITH __result AS MATERIALIZED (SELECT * FROM (${v.sql}) LIMIT ${MAX_ROWS + 1}) SELECT * FROM __result`,
        timeoutMs,
      );
    } catch (e) {
      if (e instanceof QueryRejected) throw e;
      const msg = sqliteMessage(e);
      if (/out of memory|too big/i.test(msg))
        throw new QueryRejected(
          "The query tried to build a value larger than the server allows. Return shorter text.",
        );
      throw new QueryRejected(`SQLite error: ${msg}`);
    }
    const elapsedMs = Math.round(performance.now() - t0);
    let shortenedCells = 0;
    const rows = rs.rows.slice(0, MAX_ROWS).map((r) =>
      r.map((val) => {
        const cell = toCell(val);
        if (typeof cell === "string" && cell.length > MAX_CELL_CHARS) {
          shortenedCells++;
          return `${cell.slice(0, MAX_CELL_CHARS)}… [shortened]`;
        }
        return cell;
      }),
    );
    const result: QueryResult = {
      columns: rs.columns,
      rows,
      truncated: rs.rows.length > MAX_ROWS,
      shortenedCells,
      elapsedMs,
      estimatedRows: Math.round(cost.rows),
    };
    if (Buffer.byteLength(JSON.stringify(result)) > MAX_RESULT_BYTES)
      throw new QueryRejected(
        `The result is larger than ${MAX_RESULT_BYTES / 1_000_000} MB. Select fewer columns or rows.`,
      );
    return result;
  });
}
