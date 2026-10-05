import type { NextRequest } from "next/server";
import { CACHE_HEADERS, paramsOf, routesParams } from "@/lib/api-params";
import { getRoutesFor } from "@/server/analytics";

/** Busiest routes from (or to) one zone. */
export async function GET(request: NextRequest) {
  const parsed = routesParams.safeParse(paramsOf(request.nextUrl));
  if (!parsed.success)
    return Response.json({ error: "zone must be a taxi zone id (1-265)" }, { status: 400 });
  const { zone, dir, limit } = parsed.data;
  const routes = await getRoutesFor(zone, dir, limit);
  return Response.json({ zone, dir, routes }, { headers: CACHE_HEADERS });
}
