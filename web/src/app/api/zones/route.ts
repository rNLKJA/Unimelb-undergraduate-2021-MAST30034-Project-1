import type { NextRequest } from "next/server";
import { CACHE_HEADERS, paramsOf, zoneSliceParams } from "@/lib/api-params";
import { getZoneSlice } from "@/server/analytics";

/** Trips and median minutes per zone and hour for one side (pickup/drop-off) and ISO weekday (0 = all). */
export async function GET(request: NextRequest) {
  const { side, dow } = zoneSliceParams.parse(paramsOf(request.nextUrl));
  const slice = await getZoneSlice(side, dow);
  return Response.json(slice, { headers: CACHE_HEADERS });
}
