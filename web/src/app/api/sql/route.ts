import { z } from "zod";
import { QueryRejected, runReadOnly } from "@/server/sql-guard";
import { SQL_RATE_LIMIT, takeToken } from "@/server/rate-limit";

/**
 * POST /api/sql  { "sql": "SELECT ..." }  ->  { columns, rows, truncated, shortenedCells, elapsedMs, estimatedRows }
 *
 * Runs one validated, cost-checked, read-only query against the bundled analytics database,
 * with a 3-second limit per query (src/server/sql-guard.ts). The request carries SQL only: AI
 * calls happen in the visitor's browser with their own key, and no key ever reaches this server.
 */
export const maxDuration = 10;

const body = z.object({ sql: z.string().min(1).max(4000) });

function clientKey(request: Request): string {
  const fwd = request.headers.get("x-forwarded-for");
  return fwd?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";
}

export async function POST(request: Request) {
  const wait = takeToken(clientKey(request), SQL_RATE_LIMIT.tokens, SQL_RATE_LIMIT.perMs);
  if (wait > 0) {
    return Response.json(
      { error: "Too many queries from this address. Wait a minute and try again." },
      { status: 429, headers: { "Retry-After": String(Math.ceil(wait / 1000)) } },
    );
  }
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
    if (e instanceof QueryRejected) {
      return Response.json(
        { error: e.message },
        { status: e.status, headers: e.status === 503 ? { "Retry-After": "2" } : undefined },
      );
    }
    return Response.json({ error: "The query could not be run." }, { status: 500 });
  }
}
