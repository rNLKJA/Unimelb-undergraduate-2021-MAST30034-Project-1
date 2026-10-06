import { z } from "zod";
import { QueryRejected, runReadOnly } from "@/server/sql-guard";

/**
 * POST /api/sql  { "sql": "SELECT ..." }  ->  { columns, rows, truncated, elapsedMs, estimatedRows }
 *
 * Runs one validated, cost-checked, read-only query against the bundled analytics database.
 * The request carries SQL only: AI calls happen in the visitor's browser with their own key,
 * and no key ever reaches this server.
 */
const body = z.object({ sql: z.string().min(1).max(4000) });

export async function POST(request: Request) {
  let parsed;
  try {
    parsed = body.safeParse(await request.json());
  } catch {
    return Response.json({ error: 'Send JSON: { "sql": "SELECT ..." }' }, { status: 400 });
  }
  if (!parsed.success) {
    return Response.json({ error: "Send JSON with a sql string of 1 to 4,000 characters." }, { status: 400 });
  }
  try {
    const result = await runReadOnly(parsed.data.sql);
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    if (e instanceof QueryRejected) return Response.json({ error: e.message }, { status: 422 });
    return Response.json({ error: "The query could not be run." }, { status: 500 });
  }
}
