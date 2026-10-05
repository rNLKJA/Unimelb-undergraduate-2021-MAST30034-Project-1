import type { FoldRow } from "@/server/analytics";

type Key = "r2" | "rmse";

const SERIES = [
  { key: "notebook", label: "2021 notebook", color: "var(--foreground)", dash: "" },
  {
    key: "original_on_revived",
    label: "2021 coefficients, revived data",
    color: "var(--line-red)",
    dash: "",
  },
  { key: "refit", label: "2026 refit", color: "var(--taxi-text)", dash: "5 4" },
] as const;

/** R^2 or RMSE per fold for the three model/data combinations (like the notebook's r2_rmse.png). */
export function FoldsChart({ folds, metric }: { folds: FoldRow[]; metric: Key }) {
  const W = 520;
  const H = 220;
  const p = { l: 52, r: 14, t: 14, b: 30 };
  const val = (f: FoldRow, s: (typeof SERIES)[number]["key"]) =>
    f[`${s}_${metric}` as keyof FoldRow] as number;
  const all = folds.flatMap((f) => SERIES.map((s) => val(f, s.key)));
  const lo = Math.min(...all);
  const hi = Math.max(...all);
  const padv = (hi - lo) * 0.25 || 0.001;
  const y0 = lo - padv;
  const y1 = hi + padv;
  const sx = (i: number) => p.l + (i / (folds.length - 1)) * (W - p.l - p.r);
  const sy = (v: number) => p.t + (1 - (v - y0) / (y1 - y0)) * (H - p.t - p.b);
  const fmt = (v: number) => (metric === "r2" ? v.toFixed(4) : v.toFixed(3));
  const ticks = [0, 0.5, 1].map((t) => y0 + (y1 - y0) * t);
  return (
    <figure>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-auto w-full"
        role="img"
        aria-label={`${metric === "r2" ? "R squared" : "RMSE"} for each of the 10 folds`}
      >
        {ticks.map((v) => (
          <g key={v}>
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
              {fmt(v)}
            </text>
          </g>
        ))}
        {folds.map((f, i) => (
          <text
            key={f.fold}
            x={sx(i)}
            y={H - 10}
            textAnchor="middle"
            className="fill-muted-foreground font-mono text-[10px]"
          >
            {f.fold}
          </text>
        ))}
        {SERIES.map((s) => (
          <g key={s.key}>
            <path
              d={folds.map((f, i) => `${i ? "L" : "M"}${sx(i)},${sy(val(f, s.key))}`).join("")}
              fill="none"
              stroke={s.color}
              strokeWidth={2}
              strokeDasharray={s.dash}
            />
            {folds.map((f, i) => (
              <circle key={f.fold} cx={sx(i)} cy={sy(val(f, s.key))} r={3} fill={s.color} />
            ))}
          </g>
        ))}
      </svg>
      <figcaption className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs">
        {SERIES.map((s) => (
          <span key={s.key} className="inline-flex items-center gap-1.5">
            <span className="inline-block h-0.5 w-4" style={{ background: s.color }} />
            {s.label}
          </span>
        ))}
        <span className="text-muted-foreground">x axis: fold</span>
      </figcaption>
    </figure>
  );
}
