"use client";

import { useState } from "react";
import { Segmented } from "@/components/controls/segmented";
import { useThemeName } from "@/hooks/use-theme-name";
import { formatFixed, formatInt } from "@/lib/format";
import { seqColor } from "@/lib/palette";
import { hourLabel, isoWeekdayName } from "@/lib/time";

export interface WhvRow {
  vendor: number;
  isodow: number;
  hour: number;
  trips: number;
  mean_min: number;
  median_min: number;
}

/**
 * Mean trip minutes by weekday and pickup hour: the 2021 "Average trip time vs.
 * hours in each weekday" line charts per vendor (cell 234), as a heatmap.
 */
export function WeekdayHourHeatmap({ rows }: { rows: WhvRow[] }) {
  const theme = useThemeName();
  const [vendor, setVendor] = useState(0);
  const [cell, setCell] = useState<WhvRow | null>(null);
  const sel = rows.filter((r) => r.vendor === vendor);
  const vals = sel.map((r) => r.mean_min);
  const lo = Math.min(...vals);
  const hi = Math.max(...vals);
  const get = (d: number, h: number) => sel.find((r) => r.isodow === d && r.hour === h);
  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <Segmented
          className="w-72"
          label="Vendor"
          size="sm"
          value={vendor}
          onChange={setVendor}
          options={[
            { value: 0, label: "Both vendors" },
            { value: 1, label: "Vendor 1" },
            { value: 2, label: "Vendor 2" },
          ]}
        />
        <p className="text-muted-foreground font-mono text-xs" aria-live="polite">
          {cell ? (
            `${isoWeekdayName(cell.isodow)} ${hourLabel(cell.hour)}: mean ${formatFixed(cell.mean_min, 2)} min, median ${formatFixed(cell.median_min, 1)} min, ${formatInt(cell.trips)} trips`
          ) : (
            <>
              Mean minutes from {formatFixed(lo, 1)} (<span className="dark:hidden">lightest</span>
              <span className="hidden dark:inline">dimmest</span>) to {formatFixed(hi, 1)} (
              <span className="dark:hidden">darkest</span>
              <span className="hidden dark:inline">brightest</span>)
            </>
          )}
        </p>
      </div>
      <div className="relative mt-3 overflow-x-auto">
        <table className="w-full min-w-[640px] table-fixed border-separate border-spacing-[2px]">
          <caption className="sr-only">Mean trip minutes by weekday (rows) and pickup hour (columns)</caption>
          <thead>
            <tr>
              <th scope="col" className="w-10">
                <span className="sr-only">Weekday</span>
              </th>
              {Array.from({ length: 24 }, (_, h) => (
                <th
                  key={h}
                  scope="col"
                  className="text-muted-foreground overflow-visible text-left font-mono text-[9px] font-normal whitespace-nowrap"
                >
                  {h % 3 === 0 ? hourLabel(h).replace(" ", "") : ""}
                  <span className="sr-only">{hourLabel(h)}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {[1, 2, 3, 4, 5, 6, 7].map((d) => (
              <tr key={d}>
                <th scope="row" className="pr-1 text-left text-xs font-medium">
                  {isoWeekdayName(d, true)}
                </th>
                {Array.from({ length: 24 }, (_, h) => {
                  const r = get(d, h);
                  const t = r ? (r.mean_min - lo) / (hi - lo || 1) : -1;
                  return (
                    <td
                      key={h}
                      className="h-7 rounded-[2px]"
                      style={{ background: seqColor(theme, t < 0 ? -1 : Math.round(t * 5)) }}
                      onMouseEnter={() => r && setCell(r)}
                      onMouseLeave={() => setCell(null)}
                    >
                      <span className="sr-only">
                        {r ? `${formatFixed(r.mean_min, 1)} minutes` : "no data"}
                      </span>
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
