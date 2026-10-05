import type { Metadata } from "next";
import { BoroughMatrix } from "@/components/charts/borough-matrix";
import { TopRoutes } from "@/components/charts/top-routes";
import { RouteExplorer, type RouteZone } from "@/components/explorer/route-explorer";
import { getBoroughFlows, getMapZones, getTopRoutes, getZones } from "@/server/analytics";

export const metadata: Metadata = {
  title: "Routes",
  description: "The busiest NYC yellow-taxi routes of 2019 from and to every zone, drawn like subway lines.",
};

/** Midtown Center: the second-busiest pickup zone and a good first view. */
const DEFAULT_ZONE = 161;

export default async function RoutesPage({ searchParams }: PageProps<"/routes">) {
  const sp = await searchParams;
  const [zones, all, top, flows] = await Promise.all([
    getMapZones(),
    getZones(),
    getTopRoutes(30),
    getBoroughFlows(),
  ]);
  const data: RouteZone[] = zones
    .filter((z) => z.centroid_lon !== null && z.centroid_lat !== null)
    .map((z) => ({
      id: z.location_id,
      zone: z.zone,
      borough: z.borough,
      lon: z.centroid_lon!,
      lat: z.centroid_lat!,
    }));
  const requested = Number(Array.isArray(sp.zone) ? sp.zone[0] : sp.zone);
  const initial = data.some((z) => z.id === requested) ? requested : DEFAULT_ZONE;
  const byId = new Map(all.map((z) => [z.location_id, z]));
  return (
    <>
      <RouteExplorer zones={data} initialZone={initial} />
      <section className="mx-auto max-w-7xl px-4 pt-16 sm:px-6" aria-labelledby="citywide">
        <div className="rule-double" />
        <h2 id="citywide" className="font-condensed mt-4 text-4xl font-extrabold uppercase">
          Citywide, the whole year
        </h2>
        <p className="text-muted-foreground mt-2 max-w-3xl font-serif">
          The two route charts of the 2021 notebook, which used a 10% sample, recomputed on all{" "}
          {flows.reduce((s, f) => s + f.trips, 0).toLocaleString("en-AU")} cleaned trips.
        </p>
        <div className="mt-8 grid gap-12 lg:grid-cols-[1fr_1.1fr]">
          <div>
            <h3 className="kicker text-muted-foreground mb-3">Top 30 zone-to-zone routes</h3>
            <TopRoutes
              routes={top.map((r) => ({
                from: byId.get(r.pu_id)?.zone ?? String(r.pu_id),
                to: byId.get(r.do_id)?.zone ?? String(r.do_id),
                fromBorough: byId.get(r.pu_id)?.borough ?? "",
                toBorough: byId.get(r.do_id)?.borough ?? "",
                trips: r.trips,
                median: r.median_min,
              }))}
            />
          </div>
          <div>
            <h3 className="kicker text-muted-foreground mb-3">Trips between boroughs</h3>
            <BoroughMatrix flows={flows} />
          </div>
        </div>
      </section>
    </>
  );
}
