import type { Cell } from "@/lib/ai/sql-eval";

export interface SqlResult {
  columns: string[];
  rows: Cell[][];
  truncated: boolean;
  elapsedMs: number;
  estimatedRows: number;
}

export class SqlRunError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "SqlRunError";
    this.status = status;
  }
}

/** Send SQL (and only SQL: never a key) to the site's read-only query endpoint. */
export async function runSql(sql: string): Promise<SqlResult> {
  let res: Response;
  try {
    res = await fetch("/api/sql", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sql }),
    });
  } catch {
    throw new SqlRunError("Could not reach the query endpoint.", 0);
  }
  const body = (await res.json().catch(() => ({}))) as Partial<SqlResult> & { error?: string };
  if (!res.ok) throw new SqlRunError(body.error ?? `The query failed (HTTP ${res.status}).`, res.status);
  return body as SqlResult;
}
