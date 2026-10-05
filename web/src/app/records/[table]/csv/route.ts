import type { NextRequest } from "next/server";
import { toCsv } from "@/lib/csv";
import { allRows, getTable } from "@/server/records";

/** CSV export of one analytics.db table (optionally filtered by ?q=). */
export async function GET(request: NextRequest, ctx: RouteContext<"/records/[table]/csv">) {
  const { table } = await ctx.params;
  const t = await getTable(table);
  if (!t) return new Response("Unknown table", { status: 404 });
  const q = (request.nextUrl.searchParams.get("q") ?? "").trim().slice(0, 80);
  const rows = await allRows(t, q);
  const body = toCsv(
    t.columns.map((c) => c.name),
    rows,
  );
  return new Response(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${t.name}${q ? "-filtered" : ""}.csv"`,
      "Cache-Control": "public, max-age=3600, s-maxage=86400",
    },
  });
}
