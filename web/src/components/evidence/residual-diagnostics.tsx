"use client";

import { useState } from "react";
import { Segmented } from "@/components/controls/segmented";
import { formatFixed, formatInt, formatPct } from "@/lib/format";

export interface DiagnosticsData {
  model: string;
  label: string;
  /** aggregated cells: fitted and residual lower edges (minutes) and trip counts */
  cells: { x: number; y: number; n: number }[];
  cellW: number;
  cellH: number;
  bins: { x: number; trips: number; mean: number; p10: number; p50: number; p90: number }[];
  qq: { p: number; normal: number; sample: number }[];
  borough: { label: string; trips: number; sd: number; mean: number }[];
  hour: { hour: number; sd: number; mean: number }[];
  summary: { trips: number; sd: number; mae: number; eta2: number; bp: number; df: number };
}

const X0 = 0;
const X1 = 60;
const MIN_LINE_TRIPS = 20_000;
const Y0 = -40;
const Y1 = 80;

function Heatmap({ d }: { d: DiagnosticsData }) {
  const W = 560;
  const H = 330;
  const m = { l: 44, r: 12, t: 10, b: 34 };
  const sx = (v: number) => m.l + ((v - X0) / (X1 - X0)) * (W - m.l - m.r);
  const sy = (v: number) => m.t + (1 - (v - Y0) / (Y1 - Y0)) * (H - m.t - m.b);
  const visible = d.cells.filter((c) => c.x >= X0 && c.x < X1 && c.y >= Y0 && c.y < Y1);
  // five log-scale classes spanning four orders of magnitude below the densest cell
  const maxLog = Math.log10(Math.max(...visible.map((c) => c.n)));
  const shade = (n: number) => {
    const k = Math.ceil(((Math.log10(n) - (maxLog - 4)) / 4) * 5);
    return k < 1 ? null : `var(--seq-${Math.min(5, k)})`;
  };
  // quantile lines only where a 1-minute band holds enough trips to be stable
  const line = (key: "p10" | "p50" | "p90" | "mean") =>
    d.bins
      .filter((b) => b.x >= X0 && b.x <= X1 && b.trips >= MIN_LINE_TRIPS)
      .map(
        (b, i) =>
          `${i ? "L" : "M"}${sx(b.x).toFixed(1)},${sy(Math.max(Y0, Math.min(Y1, b[key]))).toFixed(1)}`,
      )
      .join("");
  const xt = [0, 10, 20, 30, 40, 50, 60];
  const yt = [-40, -20, 0, 20, 40, 60, 80];
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="h-auto w-full"
      role="img"
      aria-label={`Residuals against fitted values for ${d.label}`}
    >
      {yt.map((v) => (
        <g key={v}>
          <line
            x1={m.l}
            x2={W - m.r}
            y1={sy(v)}
            y2={sy(v)}
            className="stroke-border"
            strokeDasharray={v === 0 ? undefined : "2 4"}
          />
          <text
            x={m.l - 6}
            y={sy(v) + 3}
            textAnchor="end"
            className="fill-muted-foreground font-mono text-[10px]"
          >
            {v}
          </text>
        </g>
      ))}
      {xt.map((v) => (
        <text
          key={v}
          x={sx(v)}
          y={H - m.b + 14}
          textAnchor="middle"
          className="fill-muted-foreground font-mono text-[10px]"
        >
          {v}
        </text>
      ))}
      {visible.map((c) => {
        const fill = shade(c.n);
        return fill ? (
          <rect
            key={`${c.x}:${c.y}`}
            x={sx(c.x)}
            y={sy(c.y + d.cellH)}
            width={sx(c.x + d.cellW) - sx(c.x) + 0.3}
            height={sy(c.y) - sy(c.y + d.cellH) + 0.3}
            fill={fill}
          />
        ) : null;
      })}
      <line x1={m.l} x2={W - m.r} y1={sy(0)} y2={sy(0)} className="stroke-foreground/60" />
      <path d={line("p10")} fill="none" stroke="var(--foreground)" strokeWidth={1.5} strokeDasharray="4 3" />
      <path d={line("p90")} fill="none" stroke="var(--foreground)" strokeWidth={1.5} strokeDasharray="4 3" />
      <path d={line("p50")} fill="none" stroke="var(--foreground)" strokeWidth={2} />
      <path d={line("mean")} fill="none" stroke="var(--line-red)" strokeWidth={2} />
      <text
        x={(m.l + W - m.r) / 2}
        y={H - 4}
        textAnchor="middle"
        className="fill-muted-foreground text-[11px]"
      >
        Fitted minutes
      </text>
      <text
        x={12}
        y={(m.t + H - m.b) / 2}
        textAnchor="middle"
        transform={`rotate(-90 12 ${(m.t + H - m.b) / 2})`}
        className="fill-muted-foreground text-[11px]"
      >
        Residual (observed − fitted), minutes
      </text>
    </svg>
  );
}

function QQ({ d }: { d: DiagnosticsData }) {
  const W = 300;
  const H = 300;
  const m = { l: 40, r: 10, t: 10, b: 34 };
  const all = d.qq.flatMap((q) => [q.normal, q.sample]);
  const lo = Math.floor(Math.min(...all) / 10) * 10;
  const hi = Math.ceil(Math.max(...all) / 10) * 10;
  const s = (v: number, a: number, b: number) => a + ((v - lo) / (hi - lo)) * (b - a);
  const sx = (v: number) => s(v, m.l, W - m.r);
  const sy = (v: number) => s(v, H - m.b, m.t);
  const ticks = Array.from({ length: Math.floor((hi - lo) / 20) + 1 }, (_, i) => lo + i * 20);
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="h-auto w-full"
      role="img"
      aria-label={`Normal QQ plot of residuals for ${d.label}`}
    >
      {ticks.map((t) => (
        <g key={t}>
          <line x1={m.l} x2={W - m.r} y1={sy(t)} y2={sy(t)} className="stroke-border" strokeDasharray="2 4" />
          <text
            x={m.l - 5}
            y={sy(t) + 3}
            textAnchor="end"
            className="fill-muted-foreground font-mono text-[10px]"
          >
            {t}
          </text>
          <text
            x={sx(t)}
            y={H - m.b + 14}
            textAnchor="middle"
            className="fill-muted-foreground font-mono text-[10px]"
          >
            {t}
          </text>
        </g>
      ))}
      <line
        x1={sx(lo)}
        y1={sy(lo)}
        x2={sx(hi)}
        y2={sy(hi)}
        className="stroke-foreground/50"
        strokeDasharray="5 4"
      />
      {d.qq.map((q) => (
        <circle key={q.p} cx={sx(q.normal)} cy={sy(q.sample)} r={2.6} fill="var(--line-blue)" />
      ))}
      <text
        x={(m.l + W - m.r) / 2}
        y={H - 4}
        textAnchor="middle"
        className="fill-muted-foreground text-[11px]"
      >
        Normal quantile (same mean and SD)
      </text>
      <text
        x={11}
        y={(m.t + H - m.b) / 2}
        textAnchor="middle"
        transform={`rotate(-90 11 ${(m.t + H - m.b) / 2})`}
        className="fill-muted-foreground text-[11px]"
      >
        Residual quantile, minutes
      </text>
    </svg>
  );
}

function HourSpread({ d }: { d: DiagnosticsData }) {
  const W = 560;
  const H = 230;
  const m = { l: 34, r: 8, t: 10, b: 26 };
  const max = Math.ceil(Math.max(...d.hour.map((h) => h.sd)) / 2) * 2;
  const sx = (h: number) => m.l + (h / 23) * (W - m.l - m.r);
  const sy = (v: number) => m.t + (1 - v / max) * (H - m.t - m.b);
  const path = d.hour
    .map((h, i) => `${i ? "L" : "M"}${sx(h.hour).toFixed(1)},${sy(h.sd).toFixed(1)}`)
    .join("");
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="h-auto w-full"
      role="img"
      aria-label="Residual standard deviation by pickup hour"
    >
      {[0, max / 2, max].map((v) => (
        <g key={v}>
          <line x1={m.l} x2={W - m.r} y1={sy(v)} y2={sy(v)} className="stroke-border" strokeDasharray="2 4" />
          <text
            x={m.l - 5}
            y={sy(v) + 3}
            textAnchor="end"
            className="fill-muted-foreground font-mono text-[10px]"
          >
            {v}
          </text>
        </g>
      ))}
      {[0, 6, 12, 18, 23].map((h) => (
        <text
          key={h}
          x={sx(h)}
          y={H - m.b + 13}
          textAnchor="middle"
          className="fill-muted-foreground font-mono text-[10px]"
        >
          {String(h).padStart(2, "0")}
        </text>
      ))}
      <path d={path} fill="none" stroke="var(--line-blue)" strokeWidth={2} />
      {d.hour.map((h) => (
        <circle key={h.hour} cx={sx(h.hour)} cy={sy(h.sd)} r={2} fill="var(--line-blue)" />
      ))}
    </svg>
  );
}

export function ResidualDiagnostics({ data }: { data: DiagnosticsData[] }) {
  const [model, setModel] = useState(data[0].model);
  const d = data.find((x) => x.model === model) ?? data[0];
  const maxSd = Math.max(...d.borough.map((b) => b.sd));
  return (
    <div className="grid gap-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <Segmented
          className="w-full max-w-md"
          label="Model"
          value={model}
          onChange={setModel}
          options={data.map((x) => ({ value: x.model, label: x.label }))}
        />
        <p className="text-muted-foreground font-mono text-xs">
          {formatInt(d.summary.trips)} trips · residual SD {formatFixed(d.summary.sd, 2)} min · MAE{" "}
          {formatFixed(d.summary.mae, 2)} min
        </p>
      </div>
      <div className="grid gap-8 lg:grid-cols-[1.6fr_1fr]">
        <figure>
          <h3 className="kicker text-muted-foreground mb-2">Residuals against fitted values</h3>
          <Heatmap d={d} />
          <figcaption className="text-muted-foreground mt-2 text-xs leading-relaxed">
            Shading shows trips per cell on a log scale, with the strongest colour for the densest cells.
            Black lines show the 10th, 50th (solid) and 90th percentile of the residual in each 1-minute band
            of fitted values with at least 20,000 trips, and the red line the mean residual. Trips outside the
            plotted window are counted but not drawn.
          </figcaption>
        </figure>
        <figure>
          <h3 className="kicker text-muted-foreground mb-2">Normal QQ plot</h3>
          <QQ d={d} />
          <figcaption className="text-muted-foreground mt-2 text-xs leading-relaxed">
            {d.qq.length} quantiles from 0.1% to 99.9%. Points above the dashed line on the right are a long
            right tail: some rides take far longer than a normal error would allow.
          </figcaption>
        </figure>
      </div>
      <div className="grid gap-8 lg:grid-cols-2">
        <figure>
          <h3 className="kicker text-muted-foreground mb-3">Residual SD by pickup borough</h3>
          <ul className="grid gap-1.5">
            {d.borough.map((b) => (
              <li
                key={b.label}
                className="grid grid-cols-[6.5rem_minmax(0,1fr)_auto] items-center gap-3 text-sm sm:grid-cols-[8rem_minmax(0,1fr)_auto]"
              >
                <span>{b.label}</span>
                <span className="bg-muted relative h-4 rounded-sm" aria-hidden>
                  <span
                    className="bg-line-blue absolute inset-y-0.5 left-0 rounded-[2px]"
                    style={{ width: `${(b.sd / maxSd) * 100}%` }}
                  />
                </span>
                <span className="text-right font-mono text-xs leading-tight whitespace-nowrap tabular-nums">
                  {formatFixed(b.sd, 1)} min
                  <span className="text-muted-foreground block text-[10px]">n {formatInt(b.trips)}</span>
                </span>
              </li>
            ))}
          </ul>
          <figcaption className="text-muted-foreground mt-2 text-xs">
            Mean residual by borough:{" "}
            {d.borough
              .map((b) => `${b.label} ${b.mean >= 0 ? "+" : "−"}${formatFixed(Math.abs(b.mean), 1)}`)
              .join(", ")}{" "}
            minutes.
          </figcaption>
        </figure>
        <figure>
          <h3 className="kicker text-muted-foreground mb-2">Residual SD by pickup hour (minutes)</h3>
          <HourSpread d={d} />
          <figcaption className="text-muted-foreground mt-1 text-xs leading-relaxed">
            Borough × hour explains {formatPct(d.summary.eta2, 1)} of the variation in squared residuals
            (Breusch–Pagan-style LM = {formatInt(Math.round(d.summary.bp))} on {d.summary.df} df). At this
            sample size any test rejects constant variance, so the effect size is the useful number.
          </figcaption>
        </figure>
      </div>
    </div>
  );
}
