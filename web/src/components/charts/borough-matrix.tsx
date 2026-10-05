import { BOROUGHS, BOROUGH_VAR, boroughShort } from "@/lib/boroughs";
import { formatCompact, formatInt, formatMinutes } from "@/lib/format";

/**
 * Pickup borough x drop-off borough trips (the 2021 "Trip records among
 * different borough" heatmap, cell 218), on all cleaned trips instead of a 10% sample.
 */
export function BoroughMatrix({
  flows,
}: {
  flows: { pickup_borough: string; dropoff_borough: string; trips: number; median_min: number | null }[];
}) {
  const max = Math.max(...flows.map((f) => f.trips));
  const get = (a: string, b: string) => flows.find((f) => f.pickup_borough === a && f.dropoff_borough === b);
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[560px] border-separate border-spacing-[3px] text-sm">
        <caption className="text-muted-foreground mb-2 text-left text-xs">
          Rows: pickup borough. Columns: drop-off borough. Cell shade is log-scaled trips; the small figure is
          the median trip in minutes.
        </caption>
        <thead>
          <tr>
            <th scope="col" className="text-muted-foreground text-left text-xs font-normal">
              From \ To
            </th>
            {BOROUGHS.map((b) => (
              <th key={b} scope="col" className="px-1 pb-1 text-left text-xs font-semibold">
                <span
                  className="mr-1 inline-block size-2 rounded-full"
                  style={{ background: BOROUGH_VAR[b] }}
                />
                {boroughShort(b)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {BOROUGHS.map((a) => (
            <tr key={a}>
              <th scope="row" className="pr-2 text-left text-xs font-semibold whitespace-nowrap">
                <span
                  className="mr-1 inline-block size-2 rounded-full"
                  style={{ background: BOROUGH_VAR[a] }}
                />
                {boroughShort(a)}
              </th>
              {BOROUGHS.map((b) => {
                const f = get(a, b);
                const t = f ? Math.log10(f.trips) / Math.log10(max) : 0;
                const ramp = Math.min(5, Math.max(0, Math.round(t * 5)));
                const dark = ramp >= 4;
                return (
                  <td
                    key={b}
                    className="h-14 rounded-[3px] px-2 py-1 align-top"
                    style={{ background: f ? `var(--seq-${ramp})` : "var(--muted)" }}
                    title={
                      f
                        ? `${a} → ${b}: ${formatInt(f.trips)} trips, median ${formatMinutes(f.median_min)}`
                        : `${a} → ${b}: no trips`
                    }
                  >
                    <span
                      className={`block font-mono text-[13px] font-semibold tabular-nums ${dark ? "text-white" : ""}`}
                    >
                      {f ? formatCompact(f.trips) : "–"}
                    </span>
                    {f?.median_min != null && (
                      <span
                        className={`block font-mono text-[10px] ${dark ? "text-white/80" : "text-foreground/60"}`}
                      >
                        {f.median_min.toFixed(0)} min
                      </span>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
