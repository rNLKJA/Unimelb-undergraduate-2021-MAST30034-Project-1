"use client";

import {
  Area,
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceArea,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatCompact, formatFixed, formatInt } from "@/lib/format";
import { formatDate, isoWeekdayName } from "@/lib/time";

export interface DailyPoint {
  date: string;
  isodow: number;
  trips: number | null;
  median: number | null;
  tavg: number;
  precipitation: number;
  snow: number;
  events: number;
  collisions: number;
}

const MONTH_TICKS = Array.from({ length: 12 }, (_, m) => `2019-${String(m + 1).padStart(2, "0")}-01`);
const tick = { fontSize: 10, fill: "var(--muted-foreground)", fontFamily: "var(--font-jetbrains)" };
const GAP_END = "2019-01-20";
/** Left and right axis widths shared by every panel, so the four plots line up day for day. */
const LEFT_AXIS = 44;
const RIGHT_AXIS = 34;

function Tip({ active, payload }: { active?: boolean; payload?: readonly { payload?: unknown }[] }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload as DailyPoint;
  return (
    <div className="bg-popover text-popover-foreground rounded-md border px-3 py-2 text-xs shadow-lg">
      <p className="font-semibold">
        {isoWeekdayName(d.isodow, true)}{" "}
        {formatDate(d.date, { day: "numeric", month: "short", year: "numeric" })}
      </p>
      <dl className="mt-1 grid grid-cols-[auto_auto] gap-x-3 font-mono text-[11px]">
        <dt className="text-muted-foreground">Trips</dt>
        <dd>{d.trips ? formatInt(d.trips) : "removed"}</dd>
        <dt className="text-muted-foreground">Median trip</dt>
        <dd>{d.median !== null ? `${formatFixed(d.median, 1)} min` : "–"}</dd>
        <dt className="text-muted-foreground">Avg temp</dt>
        <dd>{formatFixed(d.tavg, 1)} °F</dd>
        <dt className="text-muted-foreground">Rain / snow</dt>
        <dd>
          {formatFixed(d.precipitation, 2)} in / {formatFixed(d.snow, 1)} in
        </dd>
        <dt className="text-muted-foreground">Events</dt>
        <dd>{formatInt(d.events)}</dd>
        <dt className="text-muted-foreground">Collisions</dt>
        <dd>{formatInt(d.collisions)}</dd>
      </dl>
    </div>
  );
}

function Panel({ title, children, height }: { title: string; children: React.ReactElement; height: number }) {
  return (
    <div>
      <p className="kicker text-muted-foreground mb-1">{title}</p>
      <div style={{ height }} className="w-full">
        <ResponsiveContainer width="100%" height="100%">
          {children}
        </ResponsiveContainer>
      </div>
    </div>
  );
}

/** Four synchronised daily panels sharing one x axis (hover any to read the day). */
export function DailyCharts({ data }: { data: DailyPoint[] }) {
  const common = {
    data,
    syncId: "daily",
    margin: { top: 4, right: 8, bottom: 0, left: 0 },
  };
  // single-axis panels reserve the right axis's width as margin instead
  const single = { ...common, margin: { ...common.margin, right: 8 + RIGHT_AXIS } };
  const x = (
    <XAxis
      dataKey="date"
      ticks={MONTH_TICKS}
      tickFormatter={(d: string) => formatDate(d, { month: "short" })}
      tick={tick}
      tickLine={false}
      axisLine={{ stroke: "var(--border)" }}
      interval={0}
    />
  );
  const gap = (
    <ReferenceArea
      x1="2019-01-01"
      x2={GAP_END}
      fill="var(--foreground)"
      fillOpacity={0.06}
      ifOverflow="hidden"
    />
  );
  const grid = <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="2 4" />;
  const tip = (
    <Tooltip
      content={(p) => <Tip active={p.active} payload={p.payload} />}
      cursor={{ stroke: "var(--foreground)", strokeOpacity: 0.3 }}
    />
  );
  return (
    <div className="grid gap-6">
      <Panel title="Cleaned trips per day" height={190}>
        <ComposedChart {...single}>
          {grid}
          {gap}
          {x}
          <YAxis
            tick={tick}
            tickFormatter={(v: number) => formatCompact(v)}
            width={LEFT_AXIS}
            axisLine={false}
            tickLine={false}
          />
          {tip}
          <Area
            type="monotone"
            dataKey="trips"
            stroke="var(--taxi-text)"
            fill="var(--taxi)"
            fillOpacity={0.55}
            strokeWidth={1.2}
            isAnimationActive={false}
          />
        </ComposedChart>
      </Panel>
      <Panel title="Median trip minutes" height={130}>
        <ComposedChart {...single}>
          {grid}
          {gap}
          {x}
          <YAxis
            tick={tick}
            width={LEFT_AXIS}
            axisLine={false}
            tickLine={false}
            domain={["dataMin - 1", "dataMax + 1"]}
            tickFormatter={(v: number) => v.toFixed(0)}
          />
          {tip}
          <Line
            type="monotone"
            dataKey="median"
            stroke="var(--foreground)"
            dot={false}
            strokeWidth={1.4}
            isAnimationActive={false}
          />
        </ComposedChart>
      </Panel>
      <Panel title="Central Park: average temperature (°F, line) and precipitation (in, bars)" height={150}>
        <ComposedChart {...common}>
          {grid}
          {x}
          <YAxis yAxisId="t" tick={tick} width={LEFT_AXIS} axisLine={false} tickLine={false} />
          <YAxis
            yAxisId="p"
            orientation="right"
            tick={tick}
            width={RIGHT_AXIS}
            axisLine={false}
            tickLine={false}
          />
          {tip}
          <Bar yAxisId="p" dataKey="precipitation" fill="var(--line-blue)" isAnimationActive={false} />
          <Line
            yAxisId="t"
            type="monotone"
            dataKey="tavg"
            stroke="var(--line-red)"
            dot={false}
            strokeWidth={1.2}
            isAnimationActive={false}
          />
        </ComposedChart>
      </Panel>
      <Panel title="Permitted events (bars) and NYPD collisions (line), all boroughs" height={150}>
        <ComposedChart {...common}>
          {grid}
          {x}
          <YAxis yAxisId="e" tick={tick} width={LEFT_AXIS} axisLine={false} tickLine={false} />
          <YAxis
            yAxisId="c"
            orientation="right"
            tick={tick}
            width={RIGHT_AXIS}
            axisLine={false}
            tickLine={false}
          />
          {tip}
          <Bar
            yAxisId="e"
            dataKey="events"
            fill="var(--line-green)"
            fillOpacity={0.7}
            isAnimationActive={false}
          />
          <Line
            yAxisId="c"
            type="monotone"
            dataKey="collisions"
            stroke="var(--line-purple)"
            dot={false}
            strokeWidth={1.2}
            isAnimationActive={false}
          />
        </ComposedChart>
      </Panel>
    </div>
  );
}
