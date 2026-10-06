import { z } from "zod";
import type { StructuredRequest } from "./types";

/**
 * "Ask the data": a language model, called from the visitor's browser with their own key,
 * turns a question into one read-only SQLite query over the site's analytics database. The
 * query is shown to the visitor, who decides whether to run it; the server validates it
 * again before running it (src/server/sql-guard.ts).
 */

export const SQL_FEATURE = "ask-the-data";
export const SQL_EVAL_FEATURE = "ask-the-data-eval";

export const SqlAnswerSchema = z
  .object({
    answerable: z.boolean(),
    sql: z.string().max(4000),
    explanation: z.string().max(2000),
    tables_used: z.array(z.string().max(64)).max(20),
    assumptions: z.array(z.string().max(500)).max(10),
  })
  .refine((a) => !a.answerable || a.sql.trim().length > 0, {
    message: "an answerable question needs SQL",
    path: ["sql"],
  });

export type SqlAnswer = z.infer<typeof SqlAnswerSchema>;

/** The same contract as JSON Schema, for the providers' structured-output modes. */
export const SQL_ANSWER_JSON_SCHEMA = {
  type: "object",
  properties: {
    answerable: {
      type: "boolean",
      description: "false when the question cannot be answered from these tables",
    },
    sql: {
      type: "string",
      description: "one SQLite SELECT statement (empty when not answerable)",
    },
    explanation: {
      type: "string",
      description: "one or two plain-English sentences on how the query answers the question",
    },
    tables_used: { type: "array", items: { type: "string" } },
    assumptions: {
      type: "array",
      items: { type: "string" },
      description: "interpretations you had to make, e.g. which weekday numbering or which table",
    },
  },
  required: ["answerable", "sql", "explanation", "tables_used", "assumptions"],
  additionalProperties: false,
} as const;

export interface SchemaColumn {
  name: string;
  type: string;
  /** a few distinct values, for low-cardinality text columns */
  values?: string[];
}

export interface SchemaTable {
  name: string;
  title: string;
  description: string;
  rows: number;
  columns: SchemaColumn[];
}

/** "described": descriptions, row counts, sample values and domain notes. "bare": names only. */
export type PromptVariant = "described" | "bare";

export const PROMPT_VARIANTS: { value: PromptVariant; label: string; note: string }[] = [
  {
    value: "described",
    label: "Described schema",
    note: "Table descriptions, column types, sample values and domain notes.",
  },
  { value: "bare", label: "Bare schema", note: "Table and column names only (an ablation)." },
];

const DOMAIN_NOTES = `Domain notes:
- Every table holds 2019 aggregates of New York yellow-taxi trips after the 2021 cleaning rules; there are no individual trips.
- Dates are TEXT 'YYYY-MM-DD'. Trips from 1 to 20 January 2019 were removed by cleaning, so those days have (almost) no trips.
- isodow is the ISO weekday: 1 = Monday ... 7 = Sunday; 0 means "all days" in zone_hourly and weekday_hour_vendor.
- In zone_hourly, hour 24 means "the whole day" and side is 'pickup' or 'dropoff'.
- routes.pu_id / routes.do_id and route_hourly.pu_id / do_id are zone ids that join to zones.location_id.
- weekday_hour_vendor.vendor is 1 (Creative Mobile Technologies), 2 (VeriFone) or 0 (both).
- Minutes columns (median_min, mean_min) are trip durations in minutes. precipitation and snow are inches; tavg is degrees Fahrenheit.
- collisions_hourly.borough is upper case (e.g. 'BRONX'); other borough columns use title case (e.g. 'Bronx').
- Weighted averages: when combining rows that each have trips and mean_min, weight by trips.`;

export function describeSchema(tables: readonly SchemaTable[], variant: PromptVariant): string {
  if (variant === "bare") {
    return tables.map((t) => `${t.name}(${t.columns.map((c) => c.name).join(", ")})`).join("\n");
  }
  return tables
    .map((t) => {
      const cols = t.columns
        .map(
          (c) =>
            `  - ${c.name} ${c.type}${c.values?.length ? ` (values: ${c.values.map((v) => `'${v}'`).join(", ")})` : ""}`,
        )
        .join("\n");
      return `${t.name}: ${t.title}, ${t.rows.toLocaleString("en-US")} rows. ${t.description}\n${cols}`;
    })
    .join("\n\n");
}

export function buildSqlRequest(
  question: string,
  tables: readonly SchemaTable[],
  variant: PromptVariant,
): StructuredRequest {
  const system = `You write SQLite queries for a public, read-only analytics database about New York City yellow-taxi trips in 2019.

Rules:
- Answer with exactly one SQLite SELECT statement (a WITH clause is fine). Never write to the database.
- Use only the tables and columns listed below. Do not use PRAGMA, ATTACH, recursive CTEs or printf().
- Return only the columns needed to answer the question, with readable aliases.
- Add ORDER BY when the question asks for a ranking, and LIMIT 200 or less unless the result is a single row.
- If the question cannot be answered from these tables, set answerable to false and sql to an empty string.
- Put any interpretation you had to choose in assumptions.

${variant === "described" ? `${DOMAIN_NOTES}\n\n` : ""}Schema:
${describeSchema(tables, variant)}`;
  return {
    system,
    user: `Question: ${question.trim()}`,
    jsonSchema: SQL_ANSWER_JSON_SCHEMA as unknown as Record<string, unknown>,
    schemaName: "sql_answer",
    maxTokens: 1500,
  };
}
