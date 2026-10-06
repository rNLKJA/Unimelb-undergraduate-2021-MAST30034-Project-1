"use client";

import { AlertTriangle, CheckCircle2, XCircle } from "lucide-react";
import { useState } from "react";
import { judge, notebookSpeed, travelTimeMinutes, type TripRecord } from "@/lib/cleaning";
import { formatFixed } from "@/lib/format";

const BASE: TripRecord = {
  vendorId: 2,
  pickup: "2019-06-12 08:15:00",
  dropoff: "2019-06-12 08:33:20",
  passengerCount: 1,
  tripDistance: 2.4,
  ratecodeId: 1,
  storeAndFwdFlag: "N",
  puLocationId: 236,
  doLocationId: 161,
  paymentType: 1,
  fareAmount: 13.5,
  extra: 0,
  mtaTax: 0.5,
  tipAmount: 3.36,
  tollsAmount: 0,
  improvementSurcharge: 0.3,
  totalAmount: 20.16,
  congestionSurcharge: 2.5,
};

const PRESETS: { label: string; trip: TripRecord }[] = [
  { label: "An ordinary trip", trip: BASE },
  {
    label: "The 30-day ride (cell 77)",
    trip: {
      ...BASE,
      vendorId: 1,
      pickup: "2019-01-01 07:01:20",
      dropoff: "2019-01-31 14:29:21",
      tripDistance: 1.2,
      fareAmount: 6.5,
      tipAmount: 0,
      totalAmount: 7.3,
      congestionSurcharge: 0,
    },
  },
  {
    label: "2.5 miles in 3 seconds (kept!)",
    trip: {
      ...BASE,
      vendorId: 1,
      pickup: "2019-07-19 12:51:28",
      dropoff: "2019-07-19 12:51:31",
      tripDistance: 2.5,
      ratecodeId: 2,
      fareAmount: 52,
      extra: 2.5,
      tipAmount: 0,
      totalAmount: 55.3,
    },
  },
  { label: "A generous tip", trip: { ...BASE, tipAmount: 8, totalAmount: 24.8 } },
  {
    label: "Before 21 January",
    trip: {
      ...BASE,
      pickup: "2019-01-10 09:00:00",
      dropoff: "2019-01-10 09:20:00",
      congestionSurcharge: null,
    },
  },
];

const FIELDS: { key: keyof TripRecord; label: string; type: "text" | "number"; step?: string }[] = [
  { key: "pickup", label: "Pickup", type: "text" },
  { key: "dropoff", label: "Drop-off", type: "text" },
  { key: "tripDistance", label: "Distance (mi)", type: "number", step: "0.01" },
  { key: "passengerCount", label: "Passengers", type: "number", step: "1" },
  { key: "ratecodeId", label: "Rate code", type: "number", step: "1" },
  { key: "vendorId", label: "Vendor", type: "number", step: "1" },
  { key: "fareAmount", label: "Fare ($)", type: "number", step: "0.5" },
  { key: "tipAmount", label: "Tip ($)", type: "number", step: "0.01" },
  { key: "extra", label: "Extra ($)", type: "number", step: "0.5" },
  { key: "mtaTax", label: "MTA tax ($)", type: "number", step: "0.5" },
  { key: "totalAmount", label: "Total ($)", type: "number", step: "0.01" },
  { key: "congestionSurcharge", label: "Congestion ($)", type: "number", step: "0.5" },
];

/** Run one hand-edited trip through the ported cleaning rules (src/lib/cleaning.ts). */
export function RuleTester() {
  const [trip, setTrip] = useState<TripRecord>(BASE);
  const v = judge(trip);
  const invalid = new Set<keyof TripRecord>(v.kept === false && v.reason === "invalid" ? v.fields : []);
  const timesOk = trip.pickup !== null && trip.dropoff !== null && invalid.size === 0;
  const minutes = timesOk ? travelTimeMinutes(trip.pickup!, trip.dropoff!) : Number.NaN;
  const speed = timesOk && trip.tripDistance !== null ? notebookSpeed(trip as never) : Number.NaN;
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="min-w-0">
        <div className="flex flex-wrap gap-2">
          {PRESETS.map((p) => (
            <button
              key={p.label}
              type="button"
              onClick={() => setTrip(p.trip)}
              className="hover:bg-muted rounded-full border px-3 py-1 text-xs font-medium"
            >
              {p.label}
            </button>
          ))}
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {FIELDS.map((f) => {
            const value = trip[f.key];
            return (
              <label key={f.key} className="grid min-w-0 gap-1 text-xs">
                <span className="text-muted-foreground">{f.label}</span>
                <input
                  type={f.type}
                  step={f.step}
                  value={value === null ? "" : String(value)}
                  placeholder="missing"
                  aria-invalid={invalid.has(f.key) || undefined}
                  onChange={(e) => {
                    const raw = e.target.value;
                    setTrip((t) => ({
                      ...t,
                      [f.key]: raw === "" ? null : f.type === "number" ? Number(raw) : raw,
                    }));
                  }}
                  className="border-input bg-card aria-invalid:border-destructive h-8 w-full min-w-0 rounded-md border px-2 font-mono text-[13px]"
                />
              </label>
            );
          })}
        </div>
        <p className="text-muted-foreground mt-3 text-xs">
          Clear a field to make it missing. Timestamps are New York wall time, &ldquo;YYYY-MM-DD
          HH:MM:SS&rdquo;.
        </p>
      </div>
      <div className="bg-card grid content-start gap-3 rounded-lg border p-4" aria-live="polite">
        {v.kept ? (
          <p className="flex items-center gap-2 text-lg font-semibold">
            <CheckCircle2 className="text-line-green size-6" aria-hidden /> Kept
          </p>
        ) : v.reason === "invalid" ? (
          <p className="flex items-center gap-2 text-lg font-semibold">
            <AlertTriangle className="text-taxi-text size-6" aria-hidden /> Check the timestamps
          </p>
        ) : (
          <p className="flex items-center gap-2 text-lg font-semibold">
            <XCircle className="text-line-red size-6" aria-hidden /> Removed
          </p>
        )}
        <p className="font-serif text-[15px]">
          {v.kept
            ? "This trip passes every cleaning rule of rounds 1 to 3."
            : v.reason === "missing"
              ? `dropna() drops it: missing ${v.fields.join(", ")}.`
              : v.reason === "invalid"
                ? `Write the ${v.fields.map((k) => (k === "pickup" ? "pickup" : "drop-off")).join(" and ")} time as \u201cYYYY-MM-DD HH:MM:SS\u201d, e.g. 2019-06-12 08:15:00. Real TLC records always use this form, so no cleaning rule is applied until it parses.`
                : `${v.rule.round}: ${v.rule.label}.`}
        </p>
        {!v.kept && v.reason === "rule" && (
          <code className="bg-muted rounded px-2 py-1 font-mono text-[11px]">{v.rule.code}</code>
        )}
        <dl className="grid grid-cols-2 gap-2 border-t pt-3 font-mono text-xs">
          <dt className="text-muted-foreground">travel_time</dt>
          <dd className="text-right">{Number.isFinite(minutes) ? `${formatFixed(minutes, 2)} min` : "–"}</dd>
          <dt className="text-muted-foreground">&ldquo;mph&rdquo; (mi/min)</dt>
          <dd className="text-right">{Number.isFinite(speed) ? formatFixed(speed, 2) : "–"}</dd>
        </dl>
      </div>
    </div>
  );
}
