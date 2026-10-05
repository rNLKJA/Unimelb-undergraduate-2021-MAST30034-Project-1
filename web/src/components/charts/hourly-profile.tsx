"use client";

import { useId, useState } from "react";
import { formatInt, formatMinutes } from "@/lib/format";
import { hourLabel } from "@/lib/time";

export interface HourPoint {
  hour: number;
  trips: number;
  median: number | null;
}

/**
 * 24-hour profile: bars for trips, a line with dots for median minutes.
 * Hand-rolled SVG so it renders crisply in both themes; values are listed in
 * an accessible table for screen readers.
 */
export function HourlyProfile({ points, height = 170 }: { points: HourPoint[]; height?: number }) {
  const id = useId();
  const [hover, setHover] = useState<number | null>(null);
  const W = 480;
  const H = height;
  const pad = { l: 30, r: 34, t: 10, b: 22 };
  const iw = W - pad.l - pad.r;
  const ih = H - pad.t - pad.b;
  const byHour = Array.from(
    { length: 24 },
    (_, h) => points.find((p) => p.hour === h) ?? { hour: h, trips: 0, median: null },
  );
  const maxTrips = Math.max(1, ...byHour.map((p) => p.trips));
  const meds = byHour.map((p) => p.median).filter((m): m is number => m !== null);
  const maxMed = Math.max(5, ...meds) * 1.1;
  const bw = iw / 24;
  const x = (h: number) => pad.l + h * bw + bw / 2;
  const yMed = (m: number) => pad.t + ih - (m / maxMed) * ih;
  const line = byHour
    .filter((p) => p.median !== null)
    .map((p, i) => `${i ? "L" : "M"}${x(p.hour).toFixed(1)},${yMed(p.median!).toFixed(1)}`)
    .join("");
  const hp = hover !== null ? byHour[hover] : null;
  return (
    <figure className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" aria-labelledby={`${id}-cap`} role="img">
        {[0, 0.5, 1].map((t) => (
          <g key={t}>
            <line
              x1={pad.l}
              x2={W - pad.r}
              y1={pad.t + ih * (1 - t)}
              y2={pad.t + ih * (1 - t)}
              className="stroke-border"
            />
            <text
              x={W - pad.r + 4}
              y={pad.t + ih * (1 - t) + 3}
              className="fill-muted-foreground font-mono text-[9px]"
            >
              {Math.round(maxMed * t)}m
            </text>
          </g>
        ))}
        {byHour.map((p) => {
          const h = (p.trips / maxTrips) * ih;
          return (
            <rect
              key={p.hour}
              x={pad.l + p.hour * bw + 1}
              y={pad.t + ih - h}
              width={bw - 2}
              height={h}
              rx={1.5}
              className={hover === p.hour ? "fill-taxi" : "fill-foreground/15"}
              onMouseEnter={() => setHover(p.hour)}
              onMouseLeave={() => setHover(null)}
            />
          );
        })}
        <path d={line} fill="none" strokeWidth={2} className="stroke-foreground" strokeLinejoin="round" />
        {byHour
          .filter((p) => p.median !== null)
          .map((p) => (
            <circle
              key={p.hour}
              cx={x(p.hour)}
              cy={yMed(p.median!)}
              r={2.6}
              className="fill-background stroke-foreground"
              strokeWidth={1.5}
            />
          ))}
        {[0, 6, 12, 18, 23].map((h) => (
          <text
            key={h}
            x={x(h)}
            y={H - 6}
            textAnchor="middle"
            className="fill-muted-foreground font-mono text-[9px]"
          >
            {hourLabel(h)}
          </text>
        ))}
        <text
          x={pad.l - 4}
          y={pad.t + 8}
          textAnchor="end"
          className="fill-muted-foreground font-mono text-[9px]"
        >
          trips
        </text>
      </svg>
      <figcaption id={`${id}-cap`} className="text-muted-foreground mt-1 text-xs">
        {hp
          ? `${hourLabel(hp.hour)}: ${formatInt(hp.trips)} trips, median ${formatMinutes(hp.median)}`
          : "Bars: trips by pickup hour. Line: median minutes. Hover a bar for values."}
      </figcaption>
      <table className="sr-only">
        <caption>Trips and median minutes by pickup hour</caption>
        <thead>
          <tr>
            <th>Hour</th>
            <th>Trips</th>
            <th>Median minutes</th>
          </tr>
        </thead>
        <tbody>
          {byHour.map((p) => (
            <tr key={p.hour}>
              <td>{hourLabel(p.hour)}</td>
              <td>{p.trips}</td>
              <td>{p.median ?? "–"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
