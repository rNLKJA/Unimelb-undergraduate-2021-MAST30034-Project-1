import type { Metadata } from "next";
import { ZoneExplorer, type ExplorerZone } from "@/components/explorer/zone-explorer";
import { getMapZones, getZoneVendor } from "@/server/analytics";

export const metadata: Metadata = {
  title: "Zone map",
  description:
    "Pickups, drop-offs and median trip minutes for every NYC taxi zone, by weekday and hour, 2019.",
};

export default async function MapPage() {
  const [zones, vp, vd] = await Promise.all([
    getMapZones(),
    getZoneVendor("pickup"),
    getZoneVendor("dropoff"),
  ]);
  const vendor = (rows: typeof vp, id: number): [number, number] => [
    rows.find((r) => r.location_id === id && r.vendor === 1)?.trips ?? 0,
    rows.find((r) => r.location_id === id && r.vendor === 2)?.trips ?? 0,
  ];
  const data: ExplorerZone[] = zones.map((z) => ({
    id: z.location_id,
    zone: z.zone,
    borough: z.borough,
    serviceZone: z.service_zone,
    pickups: z.pickups,
    dropoffs: z.dropoffs,
    vendor: { pickup: vendor(vp, z.location_id), dropoff: vendor(vd, z.location_id) },
  }));
  return <ZoneExplorer zones={data} />;
}
