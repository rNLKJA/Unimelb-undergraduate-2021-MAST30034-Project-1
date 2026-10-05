"use client";

import { useMemo, useState } from "react";
import { Field, selectClass } from "@/components/controls/field";
import { formatCompact, formatFixed } from "@/lib/format";
import { olsLine, pearson } from "@/lib/metrics";
import { formatDate } from "@/lib/time";
import type { DailyPoint } from "./daily-charts";

const X_VARS = {
  tavg: { label: "Average temperature (°F)", fmt: (v: number) => v.toFixed(0) },
  precipitation: { label: "Precipitation (in)", fmt: (v: number) => v.toFixed(1) },
  snow: { label: "Snowfall (in)", fmt: (v: number) => v.toFixed(1) },
  events: { label: "Permitted events (all boroughs)", fmt: (v: number) => formatCompact(v) },
  collisions: { label: "Collisions (all boroughs)", fmt: (v: number) => v.toFixed(0) },
} as const;
const Y_VARS = {
  trips: { label: "Trips that day", fmt: (v: number) => formatCompact(v) },
  median: { label: "Median trip minutes", fmt: (v: number) => v.toFixed(1) },
} as const;

type XKey = keyof typeof X_VARS;
type YKey = keyof typeof Y_VARS;

/** Day-level scatter of any condition against demand or trip time, with Pearson r and an OLS line. */
export function ScatterExplorer({ data }: { data: DailyPoint[] }) {
  const [xk, setXk] = useState<XKey>("tavg");
  const [yk, setYk] = useState<YKey>("trips");
  const [hover, setHover] = useState<DailyPoint | null>(null);
  const pts = useMemo(() => data.filter((d) => d.trips && d.trips > 1000 && d.median !== null), [data]);
  const xs = pts.map((d) => d[xk]);
  const ys = pts.map((d) => d[yk] as number);
  const r = pearson(xs, ys);
  const fit = olsLine(xs, ys);
  const W = 560;
  const H = 320;
  const p = { l: 52, r: 12, t: 12, b: 40 };
  const [x0, x1] = [Math.min(...xs), Math.max(...xs)];
  const [y0, y1] = [Math.min(...ys), Math.max(...ys)];
  const sx = (v: number) => p.l + ((v - x0) / (x1 - x0 || 1)) * (W - p.l - p.r);
  const sy = (v: number) => H - p.b - ((v - y0) / (y1 - y0 || 1)) * (H - p.t - p.b);
  const ticks = (a: number, b: number) => [0, 0.25, 0.5, 0.75, 1].map((t) => a + (b - a) * t);
  return (
    <div className="grid gap-4 lg:grid-cols-[240px_1fr]">
      <div className="grid content-start gap-4">
        <Field label="Across" htmlFor="sx">
          <select id="sx" className={selectClass} value={xk} onChange={(e) => setXk(e.target.value as XKey)}>
            {Object.entries(X_VARS).map(([k, v]) => (
              <option key={k} value={k}>
                {v.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Up" htmlFor="sy">
          <select id="sy" className={selectClass} value={yk} onChange={(e) => setYk(e.target.value as YKey)}>
            {Object.entries(Y_VARS).map(([k, v]) => (
              <option key={k} value={k}>
                {v.label}
              </option>
            ))}
          </select>
        </Field>
        <div className="bg-card rounded-md border p-3">
          <p className="kicker text-muted-foreground">Pearson r</p>
          <p className="font-condensed text-4xl font-extrabold tabular-nums">{formatFixed(r, 2)}</p>
          <p className="text-muted-foreground text-xs">
            {pts.length} days (1–20 January removed). Weekends in orange. Correlation is not effect: weekday,
            season and holidays move with the weather.
          </p>
        </div>
        <p className="text-muted-foreground min-h-10 font-mono text-xs" aria-live="polite">
          {hover
            ? `${formatDate(hover.date, { day: "numeric", month: "short" })}: ${X_VARS[xk].fmt(hover[xk])} · ${Y_VARS[yk].fmt(hover[yk] as number)}`
            : "Hover a dot to read the day."}
        </p>
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-auto w-full"
        role="img"
        aria-label={`Scatter of ${Y_VARS[yk].label} against ${X_VARS[xk].label}, Pearson r ${formatFixed(r, 2)}`}
      >
        {ticks(y0, y1).map((v) => (
          <g key={`y${v}`}>
            <line
              x1={p.l}
              x2={W - p.r}
              y1={sy(v)}
              y2={sy(v)}
              className="stroke-border"
              strokeDasharray="2 4"
            />
            <text
              x={p.l - 6}
              y={sy(v) + 3}
              textAnchor="end"
              className="fill-muted-foreground font-mono text-[10px]"
            >
              {Y_VARS[yk].fmt(v)}
            </text>
          </g>
        ))}
        {ticks(x0, x1).map((v) => (
          <text
            key={`x${v}`}
            x={sx(v)}
            y={H - p.b + 16}
            textAnchor="middle"
            className="fill-muted-foreground font-mono text-[10px]"
          >
            {X_VARS[xk].fmt(v)}
          </text>
        ))}
        <text x={(W + p.l) / 2} y={H - 6} textAnchor="middle" className="fill-muted-foreground text-[11px]">
          {X_VARS[xk].label}
        </text>
        {pts.map((d) => (
          <circle
            key={d.date}
            cx={sx(d[xk])}
            cy={sy(d[yk] as number)}
            r={hover?.date === d.date ? 5 : 3.2}
            fill={d.isodow >= 6 ? "var(--line-orange)" : "var(--foreground)"}
            fillOpacity={0.55}
            onMouseEnter={() => setHover(d)}
            onMouseLeave={() => setHover(null)}
          />
        ))}
        <line
          x1={sx(x0)}
          x2={sx(x1)}
          y1={sy(fit.a + fit.b * x0)}
          y2={sy(fit.a + fit.b * x1)}
          stroke="var(--taxi)"
          strokeWidth={3}
          strokeLinecap="round"
        />
      </svg>
    </div>
  );
}
