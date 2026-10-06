import { BOROUGHS, BOROUGH_VAR, boroughShort } from "@/lib/boroughs";
import { formatCompact, formatInt, formatMinutes } from "@/lib/format";

/**
 * Text colour per ramp step so every cell keeps at least 4.5:1 contrast.
 * Light ramp (paper -> burnt umber): ink on 0-3, white on 4-5.
 * Dark ramp (charcoal -> bright yellow): the theme's light text on 0-1, white on 2, dark ink on 3-5.
 */
const CELL_TEXT = [
  "",
  "",
  "dark:text-white",
  "dark:text-taxi-ink",
  "text-white dark:text-taxi-ink",
  "text-white dark:text-taxi-ink",
] as const;

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
    <div>
      <p id="borough-matrix-note" className="text-muted-foreground mb-2 text-xs">
        Rows: pickup borough. Columns: drop-off borough. Cell shade is log-scaled trips; the small figure is
        the median trip in minutes.
      </p>
      <div className="relative overflow-x-auto">
        <table
          className="w-full min-w-[560px] border-separate border-spacing-[3px] text-sm"
          aria-describedby="borough-matrix-note"
        >
          <caption className="sr-only">Trips between boroughs, 2019</caption>
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
                  const ink = f ? CELL_TEXT[ramp] : "";
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
                      <span className={`block font-mono text-[13px] font-semibold tabular-nums ${ink}`}>
                        {f ? formatCompact(f.trips) : "–"}
                      </span>
                      {f?.median_min != null && (
                        <span className={`block font-mono text-[11px] ${ink}`}>
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
    </div>
  );
}
