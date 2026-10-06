"use client";

import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { useCallback, useMemo, useState } from "react";
import { Field } from "@/components/controls/field";
import { HourScrubber } from "@/components/controls/hour-scrubber";
import { Segmented } from "@/components/controls/segmented";
import { ZoneSelect, type ZoneOption } from "@/components/controls/zone-select";
import { LazyZoneMap } from "@/components/map/lazy-zone-map";
import { useJson } from "@/hooks/use-json";
import { useThemeName } from "@/hooks/use-theme-name";
import { BOROUGH_VAR } from "@/lib/boroughs";
import { formatCompact, formatInt, formatMinutes, formatPct } from "@/lib/format";
import { seqColor } from "@/lib/palette";
import { classify, quantileBreaks, rampIndex } from "@/lib/scale";
import { hourLabel, isoWeekdayName } from "@/lib/time";
import { cn } from "@/lib/utils";

export interface ExplorerZone extends ZoneOption {
  serviceZone: string;
  pickups: number;
  dropoffs: number;
  /** vendor 1 / vendor 2 trips, per side */
  vendor: { pickup: [number, number]; dropoff: [number, number] };
}

interface Slice {
  ids: number[];
  trips: number[][];
  median: (number | null)[][];
}

type Side = "pickup" | "dropoff";
type Metric = "trips" | "median";

const DOW_OPTIONS = [
  { value: 0, label: "All", title: "Every day of 2019" },
  ...[1, 2, 3, 4, 5, 6, 7].map((d) => ({
    value: d,
    label: isoWeekdayName(d, true),
    title: isoWeekdayName(d),
  })),
];

export function ZoneExplorer({ zones }: { zones: ExplorerZone[] }) {
  const theme = useThemeName();
  const [side, setSide] = useState<Side>("pickup");
  const [metric, setMetric] = useState<Metric>("trips");
  const [dow, setDow] = useState(0);
  const [hour, setHour] = useState(18);
  const [playing, setPlaying] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);

  const { data: slice, error, loading } = useJson<Slice>(`/api/zones?side=${side}&dow=${dow}`);
  const byId = useMemo(() => new Map(zones.map((z) => [z.id, z])), [zones]);
  const pos = useMemo(() => new Map((slice?.ids ?? []).map((id, i) => [id, i])), [slice]);

  const values = useMemo(() => {
    if (!slice) return null;
    const row = metric === "trips" ? slice.trips[hour] : slice.median[hour];
    // medians from a handful of trips are noise: only map zones with 20+ trips in the slice
    return slice.ids.map((_, i) => (metric === "median" && slice.trips[hour][i] < 20 ? null : row[i]));
  }, [slice, hour, metric]);

  const breaks = useMemo(() => (values ? quantileBreaks(values) : []), [values]);
  const fills = useMemo(() => {
    const out: Record<number, string> = {};
    if (!slice || !values) return out;
    slice.ids.forEach((id, i) => {
      const cls = classify(values[i], breaks);
      if (cls >= 0) out[id] = seqColor(theme, rampIndex(cls, breaks.length + 1));
    });
    return out;
  }, [slice, values, breaks, theme]);

  const hourTotals = useMemo(
    () => (slice ? slice.trips.slice(0, 24).map((row) => row.reduce((a, b) => a + b, 0)) : null),
    [slice],
  );

  const describe = useCallback(
    (id: number, zone: string, borough: string) => {
      const i = pos.get(id);
      const trips = i === undefined || !slice ? 0 : slice.trips[hour][i];
      const med = i === undefined || !slice ? null : slice.median[hour][i];
      return {
        title: zone,
        lines: [
          borough,
          `${formatInt(trips)} ${side === "pickup" ? "pickups" : "drop-offs"}`,
          `median ${formatMinutes(med)}`,
        ],
      };
    },
    [pos, slice, hour, side],
  );

  const top = useMemo(() => {
    if (!slice) return [];
    return slice.ids
      .map((id, i) => ({ id, trips: slice.trips[hour][i], median: slice.median[hour][i] }))
      .filter((r) => byId.has(r.id))
      .sort((a, b) => (metric === "trips" ? b.trips - a.trips : (b.median ?? 0) - (a.median ?? 0)))
      .filter((r) => metric === "trips" || r.trips >= 20)
      .slice(0, 8);
  }, [slice, hour, metric, byId]);

  const sel = selected !== null ? byId.get(selected) : undefined;
  const selIdx = selected !== null ? pos.get(selected) : undefined;
  const selProfile = slice && selIdx !== undefined ? slice.trips.slice(0, 24).map((r) => r[selIdx]) : null;
  const selMedian = slice && selIdx !== undefined ? slice.median.slice(0, 24).map((r) => r[selIdx]) : null;

  const when = `${dow === 0 ? "all of 2019" : `${isoWeekdayName(dow)}s in 2019`}${hour === 24 ? "" : `, ${hourLabel(hour)}–${hourLabel((hour + 1) % 24)}`}`;

  return (
    <div className="grid lg:h-[calc(100dvh-3.5rem)] lg:grid-cols-[minmax(0,1fr)_400px]">
      <div className="relative h-[62vh] min-h-[380px] lg:h-full">
        <LazyZoneMap
          className="h-full"
          fills={fills}
          selected={selected}
          onSelect={setSelected}
          describe={describe}
          flyToSelected
          ariaLabel={`Choropleth of ${side === "pickup" ? "pickups" : "drop-offs"} by taxi zone, ${when}`}
        />
        <Legend breaks={breaks} metric={metric} theme={theme} />
        {(loading || error) && (
          <div
            className="bg-card/95 absolute top-3 left-3 rounded-md border px-3 py-1.5 text-xs shadow-sm"
            role="status"
          >
            {error ? "Could not load this slice. Try another weekday." : "Loading…"}
          </div>
        )}
      </div>

      <aside
        className="bg-background grid content-start gap-6 overflow-y-auto border-l px-5 py-6"
        aria-label="Map controls"
      >
        <div>
          <p className="kicker text-taxi-text">Zone map</p>
          <h1 className="font-condensed mt-1 text-4xl leading-none font-extrabold uppercase">
            Where the cabs go
          </h1>
          <p className="text-muted-foreground mt-2 font-serif text-[15px] leading-snug">
            74.9 million cleaned 2019 trips by TLC taxi zone. Pick a side, a weekday and an hour, or press
            play.
          </p>
        </div>

        <div className="grid gap-4">
          <Field label="Show">
            <Segmented
              label="Pickups or drop-offs"
              value={side}
              onChange={setSide}
              options={[
                { value: "pickup", label: "Pickups" },
                { value: "dropoff", label: "Drop-offs" },
              ]}
            />
          </Field>
          <Field label="Colour by">
            <Segmented
              label="Metric"
              value={metric}
              onChange={setMetric}
              options={[
                { value: "trips", label: "Trips" },
                { value: "median", label: "Median minutes" },
              ]}
            />
          </Field>
          <Field label="Weekday">
            <Segmented label="Weekday" size="sm" value={dow} onChange={setDow} options={DOW_OPTIONS} />
          </Field>
          <HourScrubber
            hour={hour}
            onHour={setHour}
            totals={hourTotals}
            playing={playing}
            onPlaying={setPlaying}
          />
        </div>

        <div className="border-t pt-5">
          <Field label="Zone" htmlFor="zone-pick">
            <ZoneSelect
              id="zone-pick"
              zones={zones}
              value={selected}
              onChange={setSelected}
              placeholder="Click the map or choose…"
            />
          </Field>
          {sel ? (
            <div className="mt-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="font-condensed text-2xl leading-tight font-bold">{sel.zone}</h2>
                  <p className="mt-1 flex items-center gap-2 text-sm">
                    <span
                      className="inline-block size-2.5 rounded-full"
                      style={{ background: BOROUGH_VAR[sel.borough] }}
                    />
                    {sel.borough} · {sel.serviceZone}
                  </p>
                </div>
                <button
                  type="button"
                  className="text-muted-foreground text-xs underline"
                  onClick={() => setSelected(null)}
                >
                  Clear
                </button>
              </div>
              <dl className="mt-4 grid grid-cols-2 gap-3">
                <Stat
                  label={side === "pickup" ? "Pickups in view" : "Drop-offs in view"}
                  value={formatInt(slice && selIdx !== undefined ? slice.trips[hour][selIdx] : 0)}
                />
                <Stat
                  label="Median trip"
                  value={formatMinutes(slice && selIdx !== undefined ? slice.median[hour][selIdx] : null)}
                />
                <Stat label="Pickups, 2019" value={formatCompact(sel.pickups)} />
                <Stat label="Drop-offs, 2019" value={formatCompact(sel.dropoffs)} />
              </dl>
              {selProfile && (
                <ZoneProfile
                  trips={selProfile}
                  median={selMedian ?? []}
                  hour={hour}
                  onHour={(h) => {
                    setPlaying(false);
                    setHour(h);
                  }}
                />
              )}
              <VendorSplit counts={sel.vendor[side]} />
              <Link
                href={`/routes?zone=${sel.id}`}
                className="bg-taxi text-taxi-ink mt-4 inline-flex items-center gap-1.5 rounded-md px-3 py-2 text-sm font-semibold"
              >
                Routes from {sel.zone} <ArrowRight className="size-4" aria-hidden />
              </Link>
            </div>
          ) : (
            <div className="mt-4">
              <p className="kicker text-muted-foreground">
                {metric === "trips" ? "Busiest zones" : "Slowest median trips"} · {when}
              </p>
              <ol className="mt-2 grid gap-1">
                {top.map((r, i) => {
                  const z = byId.get(r.id)!;
                  return (
                    <li key={r.id}>
                      <button
                        type="button"
                        onClick={() => setSelected(r.id)}
                        className="hover:bg-muted flex w-full items-baseline gap-2 rounded px-1.5 py-1 text-left text-sm"
                      >
                        <span className="text-muted-foreground w-4 font-mono text-xs">{i + 1}</span>
                        <span className="flex-1 truncate">{z.zone}</span>
                        <span className="font-mono text-xs tabular-nums">
                          {metric === "trips" ? formatCompact(r.trips) : formatMinutes(r.median)}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ol>
            </div>
          )}
        </div>
        <p className="text-muted-foreground border-t pt-4 text-xs leading-relaxed">
          Colours are quantile classes of the zones in view. Median minutes are shown only for zones with 20
          or more trips in the slice. Pickup side uses the pickup time; drop-off side uses the drop-off time.
        </p>
      </aside>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-card rounded-md border px-3 py-2">
      <dt className="text-muted-foreground text-[11px]">{label}</dt>
      <dd className="font-mono text-lg font-semibold tabular-nums">{value}</dd>
    </div>
  );
}

function Legend({ breaks, metric, theme }: { breaks: number[]; metric: Metric; theme: "light" | "dark" }) {
  if (!breaks.length) return null;
  const classes = breaks.length + 1;
  const fmt = (v: number) => (metric === "trips" ? formatCompact(Math.round(v)) : `${v.toFixed(1)}`);
  const labels = Array.from({ length: classes }, (_, i) =>
    i === 0
      ? `≤ ${fmt(breaks[0])}`
      : i === classes - 1
        ? `> ${fmt(breaks[i - 1])}`
        : `${fmt(breaks[i - 1])}–${fmt(breaks[i])}`,
  );
  const title = metric === "trips" ? "Trips" : "Median minutes";
  const colour = (i: number) => seqColor(theme, rampIndex(i, classes));
  return (
    <>
      {/* phones: a slim horizontal ramp that keeps the map visible */}
      <div className="bg-card/95 absolute bottom-8 left-2 max-w-[calc(100%-1rem)] rounded-md border px-2 py-1.5 shadow-sm sm:hidden">
        <p className="kicker text-muted-foreground mb-1 text-[0.6rem]">{title}</p>
        <div className="flex h-2 w-40 overflow-hidden rounded-[2px]" aria-hidden>
          {labels.map((l, i) => (
            <span key={l} className="flex-1" style={{ background: colour(i) }} />
          ))}
        </div>
        <p className="mt-0.5 flex w-40 justify-between font-mono text-[10px]">
          <span>{labels[0]}</span>
          <span>{labels[classes - 1]}</span>
        </p>
        <p className="sr-only">{labels.join(", ")}</p>
      </div>
      <div className="bg-card/95 absolute bottom-8 left-3 hidden rounded-md border px-3 py-2 shadow-sm sm:block">
        <p className="kicker text-muted-foreground mb-1.5">{title}</p>
        <ul className="grid gap-0.5">
          {labels.map((l, i) => (
            <li key={l} className="flex items-center gap-2 font-mono text-[11px]">
              <span className="inline-block h-3 w-5 rounded-[2px]" style={{ background: colour(i) }} />
              {l}
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}

function ZoneProfile({
  trips,
  median,
  hour,
  onHour,
}: {
  trips: number[];
  median: (number | null)[];
  hour: number;
  onHour: (h: number) => void;
}) {
  const max = Math.max(...trips, 1);
  return (
    <figure className="mt-4">
      <figcaption className="kicker text-muted-foreground mb-1.5">24-hour profile (bars: trips)</figcaption>
      <div className="flex h-20 items-end gap-[2px]">
        {trips.map((v, h) => (
          <button
            key={h}
            type="button"
            onClick={() => onHour(h)}
            className="flex h-full flex-1 items-end"
            title={`${hourLabel(h)}: ${formatInt(v)} trips, median ${formatMinutes(median[h])}`}
            aria-label={`${hourLabel(h)}: ${formatInt(v)} trips, median ${formatMinutes(median[h])}`}
          >
            <span
              className={cn(
                "block w-full rounded-t-[2px]",
                h === hour || hour === 24 ? "bg-taxi" : "bg-foreground/25",
              )}
              style={{ height: `${Math.max(3, (v / max) * 100)}%` }}
            />
          </button>
        ))}
      </div>
    </figure>
  );
}

function VendorSplit({ counts }: { counts: [number, number] }) {
  const total = counts[0] + counts[1];
  if (!total) return null;
  const v1 = counts[0] / total;
  return (
    <div className="mt-4">
      <p className="kicker text-muted-foreground mb-1.5">Vendor split, 2019 (the 2021 vendor maps)</p>
      <div className="flex h-2.5 overflow-hidden rounded-full" aria-hidden>
        <span className="bg-line-blue" style={{ width: `${v1 * 100}%` }} />
        <span className="bg-line-orange flex-1" />
      </div>
      <p className="mt-1 flex justify-between font-mono text-[11px]">
        <span>Vendor 1 (Creative Mobile) {formatPct(v1, 0)}</span>
        <span>Vendor 2 (VeriFone) {formatPct(1 - v1, 0)}</span>
      </p>
    </div>
  );
}
