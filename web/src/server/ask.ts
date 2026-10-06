import "server-only";

import { cache } from "react";
import type { SchemaTable } from "@/lib/ai/sql-assistant";
import { GOLD_QUESTIONS, type ResultTable } from "@/lib/ai/sql-eval";
import { query } from "./db";
import { listTables } from "./records";
import { runReadOnly } from "./sql-guard";

/** Text columns with this many distinct values or fewer get their values listed in the prompt. */
const MAX_LISTED_VALUES = 8;

/** Every table of analytics.db as the prompt describes it (no key, no trips: aggregates only). */
export const getPromptSchema = cache(async (): Promise<SchemaTable[]> => {
  const tables = await listTables();
  const out: SchemaTable[] = [];
  for (const t of tables) {
    if (t.name === "meta_tables" || t.name === "evidence_meta") continue;
    const columns = [];
    for (const c of t.columns) {
      let values: string[] | undefined;
      if (/TEXT/i.test(c.type) && !/date/i.test(c.name)) {
        const [{ n }] = await query<{ n: number }>(
          `SELECT COUNT(DISTINCT "${c.name}") AS n FROM "${t.name}"`,
        );
        if (n > 0 && n <= MAX_LISTED_VALUES) {
          const rows = await query<{ v: string }>(
            `SELECT DISTINCT "${c.name}" AS v FROM "${t.name}" ORDER BY 1`,
          );
          values = rows.map((r) => String(r.v));
        }
      }
      columns.push({ name: c.name, type: c.type, ...(values ? { values } : {}) });
    }
    out.push({ name: t.name, title: t.title, description: t.description, rows: t.rows, columns });
  }
  return out;
});

export interface GoldReference {
  id: string;
  question: string;
  sql: string;
  ordered: boolean;
  difficulty: string;
  result: ResultTable;
}

/** The evaluation questions with their reference results, computed from the bundled database. */
export const getGoldReferences = cache(async (): Promise<GoldReference[]> => {
  const out: GoldReference[] = [];
  for (const q of GOLD_QUESTIONS) {
    const r = await runReadOnly(q.sql);
    out.push({ ...q, result: { columns: r.columns, rows: r.rows } });
  }
  return out;
});
