import type { NextRequest } from "next/server";
import { CACHE_HEADERS, paramsOf, routePairParams } from "@/lib/api-params";
import { getRoute, getRouteHourly } from "@/server/analytics";

/** One zone pair: yearly stats and (for pairs with 1,000+ trips) the hourly profile. */
export async function GET(request: NextRequest) {
  const parsed = routePairParams.safeParse(paramsOf(request.nextUrl));
  if (!parsed.success)
    return Response.json({ error: "pu and do must be taxi zone ids (1-265)" }, { status: 400 });
  const { pu, do: doId } = parsed.data;
  const [route, hourly] = await Promise.all([getRoute(pu, doId), getRouteHourly(pu, doId)]);
  return Response.json({ pu, do: doId, route, hourly }, { headers: CACHE_HEADERS });
}
