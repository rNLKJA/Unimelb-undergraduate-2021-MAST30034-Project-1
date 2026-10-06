import "server-only";

import { createClient, type Client } from "@libsql/client";
import { analyticsDbPath } from "./db";

/**
 * Read-only SQL for "Ask the data". The SQL may come from a language model or be typed by
 * a visitor, so the server treats it as untrusted and checks it in three layers:
 *
 * 1. `validateSql`: one statement, starting with SELECT or WITH, no write/schema/pragma
 *    keywords, no recursive CTEs and no functions that touch files or build huge values.
 * 2. `estimateCost`: SQLite's own query plan (EXPLAIN QUERY PLAN) turned into an upper
 *    bound on rows visited, so cartesian products and correlated subqueries over large
 *    tables are refused before they run (SQLite cannot be interrupted mid-statement here).
 * 3. Execution on a dedicated single connection with `PRAGMA query_only = ON`, wrapped
 *    in an outer LIMIT.
 *
 * The API key never reaches this module: the browser calls the model and sends only SQL.
 */

export const MAX_SQL_LENGTH = 4000;
export const MAX_ROWS = 500;
/** Upper bound on estimated rows visited (a few seconds of SQLite work at most). */
export const COST_LIMIT = 50_000_000;

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
];

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

const SUBQUERY_ONCE =
  /^(SCALAR SUBQUERY|LIST SUBQUERY|COMPOUND QUERY|LEFT-MOST SUBQUERY|UNION|INTERSECT|EXCEPT|MERGE)/;

/**
 * Upper bound on rows visited, from an EXPLAIN QUERY PLAN tree. Sibling SCAN/SEARCH steps
 * are nested loops (outer first), so their row factors multiply; correlated subqueries run
 * once per outer row; materialised CTEs and plain subqueries run once. Index searches are
 * assumed to return about sqrt(table rows) rows (1 for primary-key lookups).
 */
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

export function estimateCostFromPlan(
  plan: PlanRow[],
  tableRows: Record<string, number>,
  aliases: Record<string, string> = {},
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
    const key = name.replace(/^["`[]|["`\]]$/g, "");
    return tableRows[key] ?? tableRows[aliases[key] ?? ""] ?? derived.get(key) ?? fallback;
  }

  function factor(detail: string): number | null {
    let m = /^SCAN CONSTANT ROW/.exec(detail);
    if (m) return 1;
    m = /^SCAN (\S+)/.exec(detail);
    if (m) return rowsOf(m[1]);
    m = /^SEARCH (\S+)/.exec(detail);
    if (m) {
      if (/USING (INTEGER )?PRIMARY KEY|USING ROWID/.test(detail)) return 1;
      const n = rowsOf(m[1]);
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
        derived.set(mat[2].replace(/^["`[]|["`\]]$/g, ""), Math.max(1, inner));
        cost += c;
      } else if (/^CORRELATED/.test(d)) {
        cost += loop * c;
      } else if (SUBQUERY_ONCE.test(d)) {
        cost += c;
        maxLoop = Math.max(maxLoop, inner);
      } else {
        // USE TEMP B-TREE ..., etc.: bookkeeping without a loop of its own
        cost += c;
      }
    }
    return [cost, maxLoop];
  }
  return walk(0)[0];
}

let client: Client | null = null;
let ready: Promise<void> | null = null;

/** Dedicated single-connection client with writes switched off at the SQLite level. */
export async function userClient(): Promise<Client> {
  if (!client) {
    client = createClient({ url: `file:${analyticsDbPath()}`, concurrency: 1 });
    ready = client.execute("PRAGMA query_only = ON").then(() => undefined);
  }
  await ready;
  return client;
}

let tableRowsCache: Record<string, number> | null = null;

async function tableRows(c: Client): Promise<Record<string, number>> {
  if (tableRowsCache) return tableRowsCache;
  const names = await c.execute(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
  );
  const out: Record<string, number> = {};
  for (const r of names.rows) {
    const name = String(r.name);
    const n = await c.execute(`SELECT COUNT(*) AS n FROM "${name}"`);
    out[name] = Number(n.rows[0].n);
  }
  out.sqlite_master = names.rows.length;
  out.sqlite_schema = names.rows.length;
  tableRowsCache = out;
  return out;
}

export async function estimateCost(sql: string): Promise<CostEstimate> {
  const c = await userClient();
  const rs = await c.execute(`EXPLAIN QUERY PLAN ${sql}`);
  const plan: PlanRow[] = rs.rows.map((r) => ({
    id: Number(r.id),
    parent: Number(r.parent),
    detail: String(r.detail),
  }));
  const rows = await tableRows(c);
  return {
    rows: estimateCostFromPlan(plan, rows, tableAliases(sql, Object.keys(rows))),
    plan: plan.map((p) => p.detail),
  };
}

export interface QueryResult {
  columns: string[];
  rows: (string | number | null)[][];
  truncated: boolean;
  elapsedMs: number;
  estimatedRows: number;
}

export class QueryRejected extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QueryRejected";
  }
}

/** Validate, cost-check and run a query. Throws QueryRejected for anything the visitor should see. */
export async function runReadOnly(input: string): Promise<QueryResult> {
  const v = validateSql(input);
  if (!v.ok) throw new QueryRejected(v.error);
  let cost: CostEstimate;
  try {
    cost = await estimateCost(v.sql);
  } catch (e) {
    throw new QueryRejected(
      `SQLite could not plan this query: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  if (cost.rows > COST_LIMIT) {
    throw new QueryRejected(
      `This query would visit roughly ${Math.round(cost.rows).toLocaleString("en-AU")} rows (the limit is ${COST_LIMIT.toLocaleString("en-AU")}). Join on a key column, filter earlier or avoid comparing every row with every other row.`,
    );
  }
  const c = await userClient();
  const t0 = performance.now();
  let rs;
  try {
    rs = await c.execute(`SELECT * FROM (${v.sql}) LIMIT ${MAX_ROWS + 1}`);
  } catch (e) {
    throw new QueryRejected(
      `SQLite error: ${e instanceof Error ? e.message.replace(/^SQLITE_\w+:\s*/, "") : String(e)}`,
    );
  }
  const elapsedMs = Math.round(performance.now() - t0);
  const rows = rs.rows.slice(0, MAX_ROWS).map((r) =>
    rs.columns.map((col, i) => {
      const val = r[i] ?? r[col];
      if (typeof val === "bigint") return Number(val);
      if (val instanceof ArrayBuffer) return `<${val.byteLength} bytes>`;
      return (val ?? null) as string | number | null;
    }),
  );
  return {
    columns: rs.columns,
    rows,
    truncated: rs.rows.length > MAX_ROWS,
    elapsedMs,
    estimatedRows: Math.round(cost.rows),
  };
}
