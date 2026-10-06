"use client";

import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { HourlyProfile } from "@/components/charts/hourly-profile";
import { Field } from "@/components/controls/field";
import { Segmented } from "@/components/controls/segmented";
import { ZoneSelect, type ZoneOption } from "@/components/controls/zone-select";
import { LazyZoneMap } from "@/components/map/lazy-zone-map";
import type { RouteLine, Station } from "@/components/map/zone-map";
import { useJson } from "@/hooks/use-json";
import { useThemeName } from "@/hooks/use-theme-name";
import { BOROUGH_VAR, LINE_HEX } from "@/lib/boroughs";
import { formatCompact, formatFixed, formatInt, formatMinutes } from "@/lib/format";
import { arc, haversineMiles } from "@/lib/geo";
import { SEQ_HEX, TAXI_HEX } from "@/lib/palette";
import { cn } from "@/lib/utils";

export interface RouteZone extends ZoneOption {
  lon: number;
  lat: number;
}

interface RouteRow {
  pu_id: number;
  do_id: number;
  trips: number;
  median_min: number | null;
  mean_miles: number | null;
  mean_fare: number | null;
  mean_mph: number | null;
}

type Dir = "from" | "to";

export function RouteExplorer({ zones, initialZone }: { zones: RouteZone[]; initialZone: number }) {
  const theme = useThemeName();
  const [zone, setZone] = useState<number>(initialZone);
  const [dir, setDir] = useState<Dir>("from");
  const [limit, setLimit] = useState(10);
  const [picked, setPicked] = useState<number | null>(null);
  const byId = useMemo(() => new Map(zones.map((z) => [z.id, z])), [zones]);

  const { data, loading, error } = useJson<{ routes: RouteRow[] }>(
    `/api/routes?zone=${zone}&dir=${dir}&limit=${limit}`,
  );
  const routes = useMemo(
    () => (data?.routes ?? []).filter((r) => byId.has(r.pu_id) && byId.has(r.do_id)),
    [data, byId],
  );
  const other = (r: RouteRow) => (dir === "from" ? r.do_id : r.pu_id);

  const pair = picked !== null ? routes.find((r) => other(r) === picked) : undefined;
  const pairKey = pair ? `/api/route-hourly?pu=${pair.pu_id}&do=${pair.do_id}` : null;
  const { data: hourly } = useJson<{ hourly: { hour: number; trips: number; median_min: number | null }[] }>(
    pairKey,
  );

  const origin = byId.get(zone);
  const maxTrips = Math.max(1, ...routes.map((r) => r.trips));
  const colorOf = (i: number) => LINE_HEX[i % LINE_HEX.length][theme === "dark" ? 1 : 0];

  const { lines, stations, fills } = useMemo(() => {
    const lines: RouteLine[] = [];
    const stations: Station[] = [];
    const fills: Record<number, string> = {};
    if (!origin) return { lines, stations, fills };
    const o: [number, number] = [origin.lon, origin.lat];
    routes.forEach((r, i) => {
      const id = other(r);
      const z = byId.get(id);
      if (!z || id === zone) return;
      const d: [number, number] = [z.lon, z.lat];
      const path = dir === "from" ? arc(o, d, 0.14) : arc(d, o, 0.14);
      const dim = picked !== null && picked !== id;
      lines.push({
        id: String(id),
        coords: path,
        color: dim ? (theme === "dark" ? "#3a3c42" : "#cfc8b8") : colorOf(i),
        width: 2 + 8 * Math.sqrt(r.trips / maxTrips),
      });
      stations.push({ id, coord: d, kind: "stop" });
      fills[id] = SEQ_HEX[theme][1];
    });
    stations.push({ id: zone, coord: o, kind: "origin" });
    fills[zone] = TAXI_HEX;
    return { lines, stations, fills };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routes, origin, byId, dir, picked, theme, zone, maxTrips]);

  const selfTrip = routes.find((r) => other(r) === zone);

  return (
    <div className="grid lg:h-[calc(100dvh-3.5rem)] lg:grid-cols-[minmax(0,1fr)_420px]">
      <div className="relative h-[60vh] min-h-[380px] lg:h-full">
        <LazyZoneMap
          className="h-full"
          fills={fills}
          fillOpacity={0.7}
          selected={zone}
          secondary={picked}
          lines={lines}
          stations={stations}
          focus={stations.map((st) => st.coord)}
          onSelect={(id) => {
            if (id === null) return;
            setZone(id);
            setPicked(null);
          }}
          describe={(id, name, borough) => {
            const r = routes.find((x) => other(x) === id);
            return {
              title: name,
              lines: r
                ? [
                    borough,
                    `${formatInt(r.trips)} trips ${dir === "from" ? "from" : "to"} ${origin?.zone}`,
                    `median ${formatMinutes(r.median_min)}`,
                  ]
                : [borough, "Click to make this the origin"],
            };
          }}
          ariaLabel={`Busiest taxi routes ${dir} ${origin?.zone ?? "the selected zone"}, drawn as lines on a map`}
        />
        {(loading || error) && (
          <div
            className="bg-card/95 absolute top-3 left-3 rounded-md border px-3 py-1.5 text-xs shadow-sm"
            role="status"
          >
            {error ? "Could not load routes for this zone." : "Loading routes…"}
          </div>
        )}
      </div>

      <aside
        className="bg-background grid content-start gap-5 overflow-y-auto border-l px-5 py-6"
        aria-label="Route controls"
      >
        <div>
          <p className="kicker text-taxi-text">Route explorer</p>
          <h1 className="font-condensed mt-1 text-4xl leading-none font-extrabold uppercase">
            {dir === "from" ? "Where riders went" : "Where riders came from"}
          </h1>
          <p className="text-muted-foreground mt-2 font-serif text-[15px] leading-snug">
            Pick a zone on the map or in the list. Lines are the busiest 2019 routes, thicker for more trips.
          </p>
        </div>
        <div className="grid gap-4">
          <Field label="Zone" htmlFor="route-zone">
            <ZoneSelect
              id="route-zone"
              zones={zones}
              value={zone}
              allowEmpty={false}
              onChange={(id) => {
                if (id === null) return;
                setZone(id);
                setPicked(null);
              }}
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Direction">
              <Segmented
                label="Direction"
                size="sm"
                value={dir}
                onChange={(d) => {
                  setDir(d);
                  setPicked(null);
                }}
                options={[
                  { value: "from", label: "From zone" },
                  { value: "to", label: "To zone" },
                ]}
              />
            </Field>
            <Field label="Lines">
              <Segmented
                label="Number of routes"
                size="sm"
                value={limit}
                onChange={setLimit}
                options={[
                  { value: 6, label: "6" },
                  { value: 10, label: "10" },
                  { value: 16, label: "16" },
                ]}
              />
            </Field>
          </div>
        </div>

        {origin && (
          <div className="border-t pt-4">
            <p className="kicker text-muted-foreground">
              {dir === "from" ? "Departing" : "Arriving at"} {origin.zone}
            </p>
            {/* subway strip map: one bullet per route */}
            <ol className="relative mt-3" aria-label={`Top routes ${dir} ${origin.zone}`}>
              {routes.map((r, i) => {
                const id = other(r);
                const z = byId.get(id)!;
                const isSelf = id === zone;
                const on = picked === id;
                const crow = haversineMiles([origin.lon, origin.lat], [z.lon, z.lat]);
                return (
                  <li key={id} className="relative pl-9">
                    <span
                      aria-hidden
                      className="absolute top-0 bottom-0 left-[13px] w-[5px]"
                      style={{ background: isSelf ? "transparent" : colorOf(i) }}
                    />
                    <span
                      aria-hidden
                      className="bg-background absolute top-3 left-[7px] size-[17px] rounded-full border-[3px]"
                      style={{ borderColor: isSelf ? TAXI_HEX : colorOf(i) }}
                    />
                    <button
                      type="button"
                      aria-pressed={on}
                      onClick={() => setPicked(on ? null : id)}
                      className={cn(
                        "w-full rounded-md px-2 py-2 text-left transition-colors",
                        on ? "bg-muted" : "hover:bg-muted/60",
                      )}
                    >
                      <span className="flex items-baseline justify-between gap-2">
                        <span className="truncate font-medium">
                          {isSelf ? `${z.zone} (within the zone)` : z.zone}
                        </span>
                        <span className="font-mono text-xs tabular-nums">{formatCompact(r.trips)}</span>
                      </span>
                      <span className="text-muted-foreground mt-0.5 flex flex-wrap gap-x-3 font-mono text-[11px]">
                        <span className="inline-flex items-center gap-1">
                          <span
                            className="inline-block size-2 rounded-full"
                            style={{ background: BOROUGH_VAR[z.borough] }}
                          />
                          {z.borough}
                        </span>
                        <span>median {formatMinutes(r.median_min)}</span>
                        <span>{formatFixed(r.mean_miles, 1)} mi driven</span>
                        {!isSelf && <span>{formatFixed(crow, 1)} mi as the crow flies</span>}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ol>
            {selfTrip && (
              <p className="text-muted-foreground mt-2 text-xs">
                Trips that start and end in the same zone are listed with a hollow yellow stop and have no
                line.
              </p>
            )}
          </div>
        )}

        {pair && (
          <div className="border-t pt-4">
            <p className="kicker text-muted-foreground">When to go</p>
            <h2 className="font-condensed mt-1 text-2xl leading-tight font-bold">
              {byId.get(pair.pu_id)?.zone} → {byId.get(pair.do_id)?.zone}
            </h2>
            <dl className="mt-3 grid grid-cols-3 gap-2 text-center">
              <Mini label="Trips" value={formatCompact(pair.trips)} />
              <Mini label="Median" value={formatMinutes(pair.median_min)} />
              <Mini label="Avg fare" value={`$${formatFixed(pair.mean_fare, 2)}`} />
            </dl>
            <div className="mt-3">
              {hourly && hourly.hourly.length ? (
                <HourlyProfile
                  points={hourly.hourly.map((h) => ({ hour: h.hour, trips: h.trips, median: h.median_min }))}
                />
              ) : hourly ? (
                <p className="text-muted-foreground text-sm">
                  Hourly detail is stored for routes with at least 1,000 trips in 2019.
                </p>
              ) : (
                <p className="text-muted-foreground animate-pulse text-sm">Loading hourly profile…</p>
              )}
            </div>
            <Link
              href={`/estimate?pu=${pair.pu_id}&do=${pair.do_id}`}
              className="bg-taxi text-taxi-ink mt-3 inline-flex items-center gap-1.5 rounded-md px-3 py-2 text-sm font-semibold"
            >
              Estimate this trip with the model <ArrowRight className="size-4" aria-hidden />
            </Link>
          </div>
        )}
      </aside>
    </div>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-card rounded-md border px-2 py-1.5">
      <dt className="text-muted-foreground text-[10px] uppercase">{label}</dt>
      <dd className="font-mono text-sm font-semibold tabular-nums">{value}</dd>
    </div>
  );
}
