import { z } from "zod";

/** Query parameters of the read-only JSON endpoints (validated, with safe defaults). */
export const zoneSliceParams = z.object({
  side: z.enum(["pickup", "dropoff"]).catch("pickup"),
  dow: z.coerce.number().int().min(0).max(7).catch(0),
});

export const routesParams = z.object({
  zone: z.coerce.number().int().min(1).max(265),
  dir: z.enum(["from", "to"]).catch("from"),
  limit: z.coerce.number().int().min(1).max(40).catch(12),
});

export const routePairParams = z.object({
  pu: z.coerce.number().int().min(1).max(265),
  do: z.coerce.number().int().min(1).max(265),
});

export function paramsOf(url: URL): Record<string, string> {
  return Object.fromEntries(url.searchParams.entries());
}

/** Aggregates never change between deployments: let the CDN keep them. */
export const CACHE_HEADERS = {
  "Cache-Control": "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800",
};
