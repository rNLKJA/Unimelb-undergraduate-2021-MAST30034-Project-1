import "server-only";

import { cache } from "react";
import { z } from "zod";
import { query } from "./db";

export interface TableInfo {
  name: string;
  title: string;
  description: string;
  rows: number;
  columns: { name: string; type: string }[];
}

/** Every table in analytics.db with its row count and the description stored in meta_tables. */
export const listTables = cache(async (): Promise<TableInfo[]> => {
  const names = await query<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
  );
  const docs = await query<{ name: string; title: string; description: string }>(
    "SELECT name, title, description FROM meta_tables",
  );
  const docOf = new Map(docs.map((d) => [d.name, d]));
  const out: TableInfo[] = [];
  for (const { name } of names) {
    const [{ n }] = await query<{ n: number }>(`SELECT COUNT(*) AS n FROM "${name}"`);
    const cols = await query<{ name: string; type: string }>(`PRAGMA table_info("${name}")`);
    const doc = docOf.get(name);
    out.push({
      name,
      title: doc?.title ?? (name === "meta_tables" ? "Table descriptions" : name),
      description: doc?.description ?? (name === "meta_tables" ? "The descriptions shown on this page." : ""),
      rows: n,
      columns: cols.map((c) => ({ name: c.name, type: c.type || "TEXT" })),
    });
  }
  return out;
});

export async function getTable(name: string): Promise<TableInfo | null> {
  const tables = await listTables();
  return tables.find((t) => t.name === name) ?? null;
}

export const PAGE_SIZE = 25;

/**
 * Query-string parameters. Each field falls back on its own (`.catch`), so one
 * bad value never discards the others; an over-long search is truncated.
 */
export const tableParamsSchema = z.object({
  q: z
    .string()
    .trim()
    .transform((v) => v.slice(0, 80))
    .catch(""),
  page: z.coerce.number().int().min(1).max(1_000_000).catch(1),
  sort: z.string().max(64).optional().catch(undefined),
  dir: z.enum(["asc", "desc"]).catch("asc"),
});

export type TableParams = z.infer<typeof tableParamsSchema>;

function whereClause(t: TableInfo, q: string): { sql: string; args: string[] } {
  if (!q) return { sql: "", args: [] };
  const parts = t.columns.map((c) => `CAST("${c.name}" AS TEXT) LIKE ? ESCAPE '\\'`);
  const pattern = `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
  return { sql: `WHERE ${parts.join(" OR ")}`, args: t.columns.map(() => pattern) };
}

export async function queryTable(t: TableInfo, params: TableParams) {
  const where = whereClause(t, params.q);
  const sortCol = t.columns.find((c) => c.name === params.sort)?.name;
  const order = sortCol
    ? `ORDER BY "${sortCol}" ${params.dir === "desc" ? "DESC" : "ASC"}`
    : "ORDER BY rowid";
  const [{ n }] = await query<{ n: number }>(
    `SELECT COUNT(*) AS n FROM "${t.name}" ${where.sql}`,
    where.args,
  );
  const pages = Math.max(1, Math.ceil(n / PAGE_SIZE));
  const page = Math.min(params.page, pages);
  const rows = await query<Record<string, string | number | null>>(
    `SELECT * FROM "${t.name}" ${where.sql} ${order} LIMIT ${PAGE_SIZE} OFFSET ${(page - 1) * PAGE_SIZE}`,
    where.args,
  );
  return { rows, total: n, page, pages };
}

/** Every row of a table, optionally filtered, for CSV export. */
export async function allRows(t: TableInfo, q = "") {
  const where = whereClause(t, q);
  return query<Record<string, string | number | null>>(
    `SELECT * FROM "${t.name}" ${where.sql} ORDER BY rowid`,
    where.args,
  );
}
