"use client";

import { AlertTriangle } from "lucide-react";
import { useMemo, useState } from "react";
import { Field, selectClass } from "@/components/controls/field";
import { Segmented } from "@/components/controls/segmented";
import { ZoneSelect } from "@/components/controls/zone-select";
import { LazyZoneMap } from "@/components/map/lazy-zone-map";
import { useJson } from "@/hooks/use-json";
import { useThemeName } from "@/hooks/use-theme-name";
import { predictionInterval, type ConformalTable } from "@/lib/conformal";
import conformalJson from "@/lib/data/conformal.json";
import modelJson from "@/lib/data/model.json";
import { formatFixed, formatInt, formatMinutes, formatPct, formatSigned } from "@/lib/format";
import { arc, haversineMiles } from "@/lib/geo";
import {
  BLOCKS,
  blockTotals,
  contributions,
  encode,
  predict,
  type BlockName,
  type ModelArtefact,
  type TripContext,
} from "@/lib/model";
import { INK_HEX, TAXI_HEX } from "@/lib/palette";
import { wilsonInterval } from "@/lib/stats/wilson";
import { hourLabel, isoToSparkWeekday, isoWeekdayName, isoWeekdayOf } from "@/lib/time";
import { cn } from "@/lib/utils";

const model = modelJson as unknown as ModelArtefact;
const conformal = conformalJson as unknown as ConformalTable;
const LEVELS = conformal.levels.map((l) => l.level);

export interface EstimatorZone {
  id: number;
  zone: string;
  borough: string;
  modelName: string | null;
  lon: number;
  lat: number;
}

export interface DayConditions {
  date: string;
  precipitation: number;
  snow: number;
  snow_depth: number;
  tavg: number;
  wt01: number;
  wt02: number;
  wt03: number;
  wt06: number;
  wt08: number;
  events: Record<string, number | null>;
  collisions: Record<string, number>;
}

const RATECODES = [
  { value: 1, label: "1 · Standard rate" },
  { value: 2, label: "2 · JFK flat fare" },
  { value: 3, label: "3 · Newark" },
  { value: 4, label: "4 · Nassau or Westchester" },
  { value: 5, label: "5 · Negotiated fare" },
  { value: 6, label: "6 · Group ride" },
];

const BLOCK_LABEL: Record<BlockName, string> = {
  numeric: "Weather, events, collisions",
  weekday: "Weekday",
  hour: "Hour",
  ratecode: "Rate code",
  passenger_count: "Passengers",
  pickup_zone: "Pickup zone",
  vendor: "Vendor",
  dropoff_zone: "Drop-off zone",
  store_and_fwd_flag: "Store-and-forward flag",
};

/** TLC rate code 2 is the flat fare between Manhattan and JFK; a trip on that route is billed with it. */
function isJfkFlatFareRoute(a: EstimatorZone | undefined, b: EstimatorZone | undefined): boolean {
  if (!a || !b) return false;
  const jfk = (z: EstimatorZone) => z.zone === "JFK Airport";
  return (jfk(a) && b.borough === "Manhattan") || (jfk(b) && a.borough === "Manhattan");
}

export function Estimator({
  zones,
  conditions,
  initial,
}: {
  zones: EstimatorZone[];
  conditions: DayConditions[];
  initial: { pu: number; do: number };
}) {
  const theme = useThemeName();
  const [pu, setPu] = useState(initial.pu);
  const [dropoff, setDropoff] = useState(initial.do);
  const [date, setDate] = useState("2019-10-09");
  const [hour, setHour] = useState(17);
  const [passengers, setPassengers] = useState(1);
  const [vendor, setVendor] = useState(2);
  const [ratecode, setRatecode] = useState(() =>
    isJfkFlatFareRoute(
      zones.find((z) => z.id === initial.pu),
      zones.find((z) => z.id === initial.do),
    )
      ? 2
      : 1,
  );
  const [flag, setFlag] = useState("N");
  const [clickSets, setClickSets] = useState<"pickup" | "dropoff">("dropoff");
  const [level, setLevel] = useState(0.9);

  const byId = useMemo(() => new Map(zones.map((z) => [z.id, z])), [zones]);
  const day = conditions.find((c) => c.date === date) ?? conditions[0];
  const p = byId.get(pu);
  const d = byId.get(dropoff);
  const borough = p?.borough ?? "Manhattan";
  const events = day.events[borough] ?? null;
  const collisions = day.collisions[borough] ?? 0;
  const iso = isoWeekdayOf(date);
  const removedDay = date <= "2019-01-20";
  const flatFareRoute = isJfkFlatFareRoute(p, d);

  const ctx: TripContext | null =
    p && d
      ? {
          numeric: {
            precipitation: day.precipitation,
            snow: day.snow,
            snowDepth: day.snow_depth,
            tavg: day.tavg,
            wt01: day.wt01,
            wt02: day.wt02,
            wt03: day.wt03,
            wt06: day.wt06,
            wt08: day.wt08,
            events: events ?? 0,
            collisions,
          },
          sparkWeekday: isoToSparkWeekday(iso),
          hour,
          ratecode,
          passengers,
          pickupZone: p.modelName ?? p.zone,
          dropoffZone: d.modelName ?? d.zone,
          vendor,
          flag,
        }
      : null;

  const features = ctx ? encode(ctx, model) : [];
  const yOrig = predict(model.original, features);
  const yRefit = predict(model.refit, features);
  const interval = ctx ? predictionInterval(conformal, level, borough, yOrig) : null;
  const contrib = contributions(model.original, features);
  const totals = blockTotals(contrib);
  const unseenPickup = ctx ? !model.pickupZones.includes(ctx.pickupZone) : false;
  const unseenDropoff = ctx ? !model.dropoffZones.includes(ctx.dropoffZone) : false;

  const { data: observed } = useJson<{
    route: { trips: number; median_min: number | null; mean_miles: number | null } | null;
    hourly: { hour: number; trips: number; median_min: number | null }[];
  }>(p && d ? `/api/route-hourly?pu=${p.id}&do=${d.id}` : null);
  const obsHour = observed?.hourly.find((h) => h.hour === hour);

  const lines =
    p && d && p.id !== d.id
      ? [
          {
            id: "trip",
            coords: arc([p.lon, p.lat], [d.lon, d.lat], 0.12),
            color: theme === "dark" ? TAXI_HEX : INK_HEX.light,
            width: 4,
          },
        ]
      : [];
  const stations =
    p && d
      ? [
          { id: p.id, coord: [p.lon, p.lat] as [number, number], kind: "origin" as const },
          { id: d.id, coord: [d.lon, d.lat] as [number, number], kind: "stop" as const },
        ]
      : [];
  const fills: Record<number, string> = {};
  if (p) fills[p.id] = TAXI_HEX;
  if (d) fills[d.id] = theme === "dark" ? "#87661d" : "#f6d77a";

  const maxAbs = Math.max(1, ...BLOCKS.map((b) => Math.abs(totals[b.name])));

  return (
    <div className="mx-auto grid max-w-7xl gap-8 px-4 pt-8 sm:px-6 lg:grid-cols-[360px_minmax(0,1fr)]">
      {/* ------------------------------------------------------------ inputs */}
      <form
        className="grid content-start gap-4"
        onSubmit={(e) => e.preventDefault()}
        aria-label="Trip details"
      >
        <Field label="Pickup zone" htmlFor="est-pu">
          <ZoneSelect
            id="est-pu"
            zones={zones}
            value={pu}
            allowEmpty={false}
            onChange={(v) => v !== null && setPu(v)}
          />
        </Field>
        <Field label="Drop-off zone" htmlFor="est-do">
          <ZoneSelect
            id="est-do"
            zones={zones}
            value={dropoff}
            allowEmpty={false}
            onChange={(v) => v !== null && setDropoff(v)}
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Date (2019)" htmlFor="est-date">
            <input
              id="est-date"
              type="date"
              min="2019-01-01"
              max="2019-12-31"
              value={date}
              onChange={(e) => e.target.value && e.target.value.startsWith("2019") && setDate(e.target.value)}
              className={selectClass}
            />
          </Field>
          <Field label="Pickup hour" htmlFor="est-hour">
            <select
              id="est-hour"
              className={selectClass}
              value={hour}
              onChange={(e) => setHour(Number(e.target.value))}
            >
              {Array.from({ length: 24 }, (_, h) => (
                <option key={h} value={h}>
                  {hourLabel(h)}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <Field
          label="Rate code"
          htmlFor="est-rate"
          hint={
            flatFareRoute ? (
              ratecode === 2 ? (
                "Manhattan–JFK rides are billed at the flat fare, rate code 2."
              ) : (
                <>
                  Manhattan–JFK rides are normally billed at rate code 2.{" "}
                  <button type="button" className="link-taxi font-medium" onClick={() => setRatecode(2)}>
                    Use rate code 2
                  </button>
                </>
              )
            ) : undefined
          }
        >
          <select
            id="est-rate"
            className={selectClass}
            value={ratecode}
            onChange={(e) => setRatecode(Number(e.target.value))}
          >
            {RATECODES.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Passengers" htmlFor="est-pax">
            <select
              id="est-pax"
              className={selectClass}
              value={passengers}
              onChange={(e) => setPassengers(Number(e.target.value))}
            >
              {[1, 2, 3, 4, 5, 6].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Vendor">
            <Segmented
              label="Vendor"
              size="sm"
              value={vendor}
              onChange={setVendor}
              options={[
                { value: 1, label: "1", title: "Creative Mobile Technologies" },
                { value: 2, label: "2", title: "VeriFone" },
              ]}
            />
          </Field>
        </div>
        <Field label="Store-and-forward" hint="Y when the meter stored the trip offline before sending it.">
          <Segmented
            label="Store and forward flag"
            size="sm"
            value={flag}
            onChange={setFlag}
            options={[
              { value: "N", label: "N" },
              { value: "Y", label: "Y" },
            ]}
          />
        </Field>
        <div className="bg-card rounded-md border p-3 text-xs">
          <p className="kicker text-muted-foreground">That day, {borough}</p>
          <p className="mt-1 font-mono leading-relaxed">
            {isoWeekdayName(iso)} · {formatFixed(day.tavg, 1)} °F · rain {formatFixed(day.precipitation, 2)}{" "}
            in · snow {formatFixed(day.snow, 1)} in · {events === null ? "no" : formatInt(events)} events ·{" "}
            {formatInt(collisions)} collisions
          </p>
        </div>
      </form>

      {/* ------------------------------------------------------------ result */}
      <div className="grid content-start gap-6">
        <section
          aria-labelledby="result-h"
          aria-live="polite"
          className="bg-card overflow-hidden rounded-lg border"
        >
          <div className="checker h-1.5 opacity-80" aria-hidden />
          <div className="grid gap-6 p-5 sm:grid-cols-[1.2fr_1fr] sm:p-6">
            <div>
              <p id="result-h" className="kicker text-muted-foreground">
                2021 model predicts
              </p>
              <p className="font-condensed mt-1 text-7xl leading-none font-extrabold tabular-nums">
                {yOrig < 1 ? "<1" : formatFixed(yOrig, 1)}
                <span className="text-muted-foreground ml-2 text-3xl font-bold">min</span>
              </p>
              <p className="text-muted-foreground mt-2 text-sm">
                {p?.zone} → {d?.zone}, {isoWeekdayName(iso)} at {hourLabel(hour)}
              </p>
              {obsHour?.median_min != null && Math.abs(obsHour.median_min - yOrig) > 5 && (
                <p className="mt-2 text-sm">
                  The model is {formatFixed(Math.abs(obsHour.median_min - yOrig), 1)} min{" "}
                  {obsHour.median_min > yOrig ? "below" : "above"} what riders saw at this hour: a single
                  straight line cannot stretch to every route.
                </p>
              )}
              {interval && (
                <PredictionBand
                  interval={interval}
                  level={level}
                  setLevel={setLevel}
                  prediction={yOrig}
                  observed={obsHour?.median_min ?? null}
                  borough={borough}
                />
              )}
              {yOrig < 1 && (
                <p className="mt-2 text-xs">
                  A straight-line model can predict very short or even negative times; the raw value is{" "}
                  {formatFixed(yOrig, 2)}.
                </p>
              )}
            </div>
            <dl className="grid content-start gap-2 text-sm">
              <Row k="2026 refit, same features" v={formatMinutes(yRefit)} />
              <Row
                k={`Observed median, ${hourLabel(hour)}`}
                v={
                  obsHour
                    ? `${formatMinutes(obsHour.median_min)} (${formatInt(obsHour.trips)} trips)`
                    : observed
                      ? "not enough trips"
                      : "…"
                }
              />
              <Row
                k="Observed median, any hour"
                v={
                  observed?.route
                    ? `${formatMinutes(observed.route.median_min)} (${formatInt(observed.route.trips)} trips)`
                    : observed
                      ? "no 2019 trips"
                      : "…"
                }
              />
              {p && d && p.id !== d.id && (
                <Row
                  k="Straight-line distance"
                  v={`${formatFixed(haversineMiles([p.lon, p.lat], [d.lon, d.lat]), 1)} mi`}
                />
              )}
            </dl>
          </div>
          {(removedDay || events === null || unseenPickup || unseenDropoff) && (
            <div className="border-t px-5 py-3 text-sm sm:px-6">
              {[
                removedDay &&
                  "1–20 January 2019 trips were removed by the notebook's dropna(), so the model never saw these days.",
                events === null &&
                  `No permitted event was recorded in ${borough} that day. The 2021 model dropped such trips (missing event count), so it is extrapolating here; events count as 0.`,
                (unseenPickup || unseenDropoff) &&
                  "This zone never appeared in the training data; its coefficient is taken as 0.",
              ]
                .filter(Boolean)
                .map((t) => (
                  <p key={String(t)} className="flex gap-2">
                    <AlertTriangle className="text-taxi-text mt-0.5 size-4 shrink-0" aria-hidden />
                    {t}
                  </p>
                ))}
            </div>
          )}
        </section>

        <section aria-labelledby="why-h">
          <h2 id="why-h" className="font-condensed text-3xl font-bold uppercase">
            Why that number
          </h2>
          <p className="text-muted-foreground mt-1 max-w-2xl font-serif">
            A linear model is a sum. The 2021 model starts from an intercept of{" "}
            {formatFixed(model.original.intercept, 2)} minutes and adds one coefficient per active feature.
            Bars show what each part of your trip adds or removes.
          </p>
          <ul className="mt-4 grid gap-1.5">
            {BLOCKS.map((b) => {
              const v = totals[b.name];
              const w = (Math.abs(v) / maxAbs) * 50;
              return (
                <li
                  key={b.name}
                  className="grid grid-cols-[10rem_minmax(0,1fr)_4.5rem] items-center gap-3 text-sm sm:grid-cols-[13rem_minmax(0,1fr)_5rem]"
                >
                  <span className="leading-tight">{BLOCK_LABEL[b.name]}</span>
                  <span className="bg-muted relative h-5 rounded-sm" aria-hidden>
                    <span className="bg-foreground/30 absolute top-0 bottom-0 left-1/2 w-px" />
                    <span
                      className={cn(
                        "absolute top-0.5 bottom-0.5 rounded-[2px]",
                        v >= 0 ? "bg-line-red" : "bg-line-blue",
                      )}
                      style={v >= 0 ? { left: "50%", width: `${w}%` } : { right: "50%", width: `${w}%` }}
                    />
                  </span>
                  <span
                    className={cn("text-right font-mono tabular-nums", v === 0 && "text-muted-foreground")}
                  >
                    {formatSigned(v, 2)}
                  </span>
                </li>
              );
            })}
            <li className="grid grid-cols-[10rem_minmax(0,1fr)_4.5rem] items-center gap-3 border-t pt-2 text-sm font-semibold sm:grid-cols-[13rem_minmax(0,1fr)_5rem]">
              <span>Intercept + all terms</span>
              <span className="text-muted-foreground text-xs font-normal">
                {formatFixed(model.original.intercept, 2)}{" "}
                {contrib.length ? `with ${contrib.length} non-zero terms` : ""}
              </span>
              <span className="text-right font-mono tabular-nums">{formatFixed(yOrig, 2)}</span>
            </li>
          </ul>
          <p className="text-muted-foreground mt-3 text-xs">
            Red adds minutes, blue removes them. Zones, hours and weekdays are relative to the categories the
            penalty set to zero. Coefficients:{" "}
            <code className="font-mono">coursework/10-folds-linear-regression.csv</code>, fold 1.
          </p>
        </section>

        <section aria-labelledby="map-h">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <h2 id="map-h" className="kicker text-muted-foreground">
              Map: click a zone to set the pickup or drop-off
            </h2>
            <Segmented
              className="w-56"
              label="Map click sets"
              size="sm"
              value={clickSets}
              onChange={setClickSets}
              options={[
                { value: "pickup", label: "Pickup" },
                { value: "dropoff", label: "Drop-off" },
              ]}
            />
          </div>
          <LazyZoneMap
            className="mt-2 h-[380px] overflow-hidden rounded-lg border"
            fills={fills}
            fillOpacity={0.75}
            selected={pu}
            secondary={dropoff}
            lines={lines}
            stations={stations}
            focus={stations.map((s) => s.coord)}
            onSelect={(id) => {
              if (id === null || !byId.has(id)) return;
              if (clickSets === "pickup") setPu(id);
              else setDropoff(id);
            }}
            ariaLabel="Map of the chosen pickup (solid outline) and drop-off (dashed outline) zones"
          />
        </section>
      </div>
    </div>
  );
}

function PredictionBand({
  interval,
  level,
  setLevel,
  prediction,
  observed,
  borough,
}: {
  interval: NonNullable<ReturnType<typeof predictionInterval>>;
  level: number;
  setLevel: (l: number) => void;
  prediction: number;
  observed: number | null;
  borough: string;
}) {
  const max = Math.max(30, Math.ceil((interval.upper * 1.08) / 10) * 10);
  const pos = (v: number) => `${Math.min(100, Math.max(0, (v / max) * 100))}%`;
  const cov = interval.test ? wilsonInterval(interval.test.covered, interval.test.trips) : null;
  return (
    <div className="mt-4 grid gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm">
          <span className="font-semibold">{formatPct(level, 0)} prediction interval:</span>{" "}
          <span className="font-mono tabular-nums">
            {formatFixed(interval.lower, 1)} to {formatFixed(interval.upper, 1)} min
          </span>
        </p>
        <Segmented
          className="w-40"
          label="Interval level"
          size="sm"
          value={level}
          onChange={setLevel}
          options={LEVELS.map((l) => ({ value: l, label: formatPct(l, 0) }))}
        />
      </div>
      <div
        className="bg-muted relative h-6 rounded-sm"
        role="img"
        aria-label={`Prediction ${formatFixed(prediction, 1)} minutes, ${formatPct(level, 0)} interval ${formatFixed(interval.lower, 1)} to ${formatFixed(interval.upper, 1)} minutes`}
      >
        <span
          className="bg-taxi/60 absolute inset-y-1 rounded-sm"
          style={{
            left: pos(interval.lower),
            width: `calc(${pos(interval.upper)} - ${pos(interval.lower)})`,
          }}
        />
        <span className="bg-foreground absolute inset-y-0 w-0.5" style={{ left: pos(prediction) }} />
        {observed !== null && (
          <span
            className="border-line-blue absolute inset-y-0 w-0 border-l-2 border-dashed"
            style={{ left: pos(observed) }}
          />
        )}
      </div>
      <div className="text-muted-foreground flex justify-between font-mono text-[10px]">
        <span>0</span>
        <span>{max / 2}</span>
        <span>{max} min</span>
      </div>
      <p className="text-muted-foreground text-xs leading-relaxed">
        Split-conformal, from {formatInt(interval.nCal)} held-out 2019 trips picked up in {interval.borough}{" "}
        with a similar prediction (bin {interval.bin + 1} of {interval.bins}).
        {interval.borough !== borough && ` ${borough} has no calibration trips, so Manhattan's are used.`}
        {cov && interval.test && (
          <>
            {" "}
            On {formatInt(interval.test.trips)} other {interval.borough} trips, {formatPct(cov.estimate, 1)}{" "}
            fell inside (95% CI {formatPct(cov.lower, 2)} to {formatPct(cov.upper, 2)}).
          </>
        )}{" "}
        Black: the prediction; dashed blue: the observed median at this hour.{" "}
        <a href="/evaluation#intervals" className="link-taxi">
          How the intervals are built
        </a>
      </p>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b pb-1.5">
      <dt className="text-muted-foreground">{k}</dt>
      <dd className="text-right font-mono tabular-nums">{v}</dd>
    </div>
  );
}
