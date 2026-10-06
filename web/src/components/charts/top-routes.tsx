import { BOROUGH_VAR } from "@/lib/boroughs";
import { formatCompact, formatMinutes } from "@/lib/format";

export interface TopRoute {
  from: string;
  to: string;
  fromBorough: string;
  toBorough: string;
  trips: number;
  median: number | null;
}

/** The 2021 "Top 30 routes" bar chart (cell 217), recomputed on every cleaned trip. */
export function TopRoutes({ routes }: { routes: TopRoute[] }) {
  const max = Math.max(...routes.map((r) => r.trips));
  return (
    <ol className="grid gap-1.5">
      {routes.map((r, i) => (
        <li
          key={`${r.from}-${r.to}`}
          className="grid grid-cols-[1.5rem_minmax(0,1fr)] items-center gap-2 text-sm"
        >
          <span className="text-muted-foreground text-right font-mono text-xs">{i + 1}</span>
          <div>
            <div className="flex items-baseline justify-between gap-2">
              <span className="truncate">
                <span
                  className="mr-1 inline-block size-2 rounded-full"
                  style={{ background: BOROUGH_VAR[r.fromBorough] }}
                />
                {r.from === r.to ? `Within ${r.from}` : `${r.from} → ${r.to}`}
              </span>
              <span className="text-muted-foreground shrink-0 font-mono text-[11px]">
                {formatCompact(r.trips)} · {formatMinutes(r.median, 0)}
              </span>
            </div>
            <div className="bg-muted mt-0.5 h-1.5 overflow-hidden rounded-full">
              <div className="bg-taxi h-full rounded-full" style={{ width: `${(r.trips / max) * 100}%` }} />
            </div>
          </div>
        </li>
      ))}
    </ol>
  );
}
