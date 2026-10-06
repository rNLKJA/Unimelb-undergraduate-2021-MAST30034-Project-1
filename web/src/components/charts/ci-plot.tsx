import { cn } from "@/lib/utils";

export interface CiPoint {
  estimate: number;
  lower?: number;
  upper?: number;
  color: string;
  name: string;
}

export interface CiRow {
  label: string;
  sub?: string;
  points: CiPoint[];
  value?: string;
  emphasis?: boolean;
}

function niceTicks(lo: number, hi: number, count = 5): number[] {
  const span = hi - lo || 1;
  const step0 = span / count;
  const mag = 10 ** Math.floor(Math.log10(step0));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= step0) ?? step0;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(Number(v.toPrecision(10)));
  return out;
}

/**
 * Estimates with confidence intervals as dots and whiskers, one row per item. Drawn with
 * percentage-positioned HTML so labels stay legible on a 375-pixel phone.
 */
export function CiPlot({
  rows,
  domain,
  reference,
  referenceLabel,
  format,
  axisLabel,
  caption,
  className,
}: {
  rows: CiRow[];
  domain?: [number, number];
  reference?: number;
  referenceLabel?: string;
  format: (v: number) => string;
  axisLabel: string;
  caption?: string;
  className?: string;
}) {
  const vals = rows.flatMap((r) =>
    r.points.flatMap((p) => [p.estimate, p.lower ?? p.estimate, p.upper ?? p.estimate]),
  );
  if (reference !== undefined) vals.push(reference);
  let [lo, hi] = domain ?? [Math.min(...vals), Math.max(...vals)];
  if (!domain) {
    const pad = (hi - lo) * 0.08 || Math.abs(hi) * 0.05 || 1;
    lo -= pad;
    hi += pad;
  }
  const pos = (v: number) => `${Math.min(100, Math.max(0, ((v - lo) / (hi - lo)) * 100))}%`;
  const ticks = niceTicks(lo, hi);
  const series = [...new Map(rows.flatMap((r) => r.points.map((p) => [p.name, p.color]))).entries()];
  const hasValues = rows.some((r) => r.value !== undefined);
  const cols = hasValues
    ? "grid-cols-[minmax(7rem,11rem)_minmax(0,1fr)] sm:grid-cols-[13rem_minmax(0,1fr)_12rem]"
    : "grid-cols-[minmax(7rem,11rem)_minmax(0,1fr)] sm:grid-cols-[13rem_minmax(0,1fr)]";
  return (
    <figure className={className}>
      <div role="img" aria-label={caption ?? axisLabel} className="grid gap-y-1.5">
        {rows.map((r) => (
          <div key={r.label} className={cn("grid items-center gap-3", cols)}>
            <div className={cn("text-sm leading-tight", r.emphasis && "font-semibold")}>
              {r.label}
              {r.sub && <span className="text-muted-foreground block text-[11px] font-normal">{r.sub}</span>}
            </div>
            <div className="bg-muted/60 relative h-6 rounded-sm">
              {ticks.map((t) => (
                <span
                  key={t}
                  className="bg-border absolute inset-y-0 w-px"
                  style={{ left: pos(t) }}
                  aria-hidden
                />
              ))}
              {reference !== undefined && (
                <span
                  className="bg-foreground/50 absolute -inset-y-1 w-px"
                  style={{ left: pos(reference) }}
                  aria-hidden
                />
              )}
              {r.points.map((p, i) => {
                const y = r.points.length > 1 ? `${((i + 1) / (r.points.length + 1)) * 100}%` : "50%";
                return (
                  <span key={p.name} aria-hidden>
                    {p.lower !== undefined && p.upper !== undefined && (
                      <span
                        className="absolute h-[2px] -translate-y-1/2 rounded-full"
                        style={{
                          left: pos(p.lower),
                          width: `calc(${pos(p.upper)} - ${pos(p.lower)})`,
                          top: y,
                          background: p.color,
                          minWidth: 2,
                        }}
                      />
                    )}
                    <span
                      className="ring-background absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2"
                      style={{ left: pos(p.estimate), top: y, background: p.color }}
                    />
                  </span>
                );
              })}
            </div>
            {r.value !== undefined && (
              <div className="col-span-2 -mt-1 text-right font-mono text-[11px] whitespace-nowrap tabular-nums sm:col-span-1 sm:mt-0 sm:text-xs">
                {r.value}
              </div>
            )}
          </div>
        ))}
        <div className={cn("grid gap-3", cols)}>
          <span />
          <div className="relative h-4">
            {ticks.map((t) => (
              <span
                key={t}
                className="text-muted-foreground absolute -translate-x-1/2 font-mono text-[10px]"
                style={{ left: pos(t) }}
              >
                {format(t)}
              </span>
            ))}
          </div>
        </div>
      </div>
      <figcaption className="text-muted-foreground mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
        {series.length > 1 &&
          series.map(([name, color]) => (
            <span key={name} className="text-foreground inline-flex items-center gap-1.5">
              <span className="inline-block size-2.5 rounded-full" style={{ background: color }} />
              {name}
            </span>
          ))}
        <span>{axisLabel}</span>
        {reference !== undefined && referenceLabel && <span>Vertical line: {referenceLabel}</span>}
      </figcaption>
    </figure>
  );
}
