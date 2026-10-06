import { formatInt } from "@/lib/format";
import type { FunnelRow } from "@/server/analytics";

const STAGE_COLOR: Record<string, string> = {
  Raw: "var(--line-grey)",
  "Round 1": "var(--line-red)",
  "Round 2": "var(--line-blue)",
  "Round 3": "var(--line-green)",
  Merge: "var(--line-purple)",
  Model: "var(--line-orange)",
};

/** Every cleaning step with the rows it leaves, the rows it removes and the notebook's count where it printed one. */
export function FunnelTable({ rows }: { rows: FunnelRow[] }) {
  const removed = rows.map((r, i) => (i === 0 ? 0 : Math.max(0, rows[i - 1].revived_rows - r.revived_rows)));
  const maxRemoved = Math.max(...removed);
  return (
    <div>
      <p id="funnel-note" className="text-muted-foreground mb-3 text-xs">
        Steps run in notebook order; each &ldquo;removed&rdquo; bar is on a square-root scale so small rules
        stay visible. Model-stage rows differ from the analysis dataset because the shapefile join duplicates
        zones 56 and 103.
      </p>
      <div className="relative overflow-x-auto">
        <table className="w-full min-w-[760px] text-sm" aria-describedby="funnel-note">
          <caption className="sr-only">
            Cleaning funnel: rows left after each step, revived and notebook
          </caption>
          <thead>
            <tr className="border-b text-left">
              <th scope="col" className="py-2 pr-2 font-semibold">
                #
              </th>
              <th scope="col" className="py-2 pr-3 font-semibold">
                Step
              </th>
              <th scope="col" className="py-2 pr-3 font-semibold">
                Removed
              </th>
              <th scope="col" className="py-2 pr-3 text-right font-semibold">
                Rows left (revived)
              </th>
              <th scope="col" className="py-2 pr-3 text-right font-semibold">
                Notebook
              </th>
              <th scope="col" className="py-2 text-right font-semibold">
                Diff
              </th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.map((r, i) => (
              <tr key={r.step} className={r.notebook_rows !== null ? "bg-card" : undefined}>
                <td className="text-muted-foreground py-2 pr-2 font-mono text-xs">{r.step}</td>
                <td className="py-2 pr-3">
                  <span className="flex items-center gap-2">
                    <span
                      className="inline-block size-2.5 shrink-0 rounded-full"
                      style={{ background: STAGE_COLOR[r.stage] }}
                    />
                    <span>
                      <span className="text-muted-foreground mr-1.5 text-[11px] uppercase">{r.stage}</span>
                      {r.label}
                    </span>
                  </span>
                  {r.rule && (
                    <code className="text-muted-foreground mt-0.5 block pl-[18px] font-mono text-[11px]">
                      {r.rule}
                    </code>
                  )}
                </td>
                <td className="w-40 py-2 pr-3">
                  {removed[i] > 0 && (
                    <span className="flex items-center gap-2">
                      <span
                        className="h-2 rounded-full"
                        style={{
                          width: `${Math.max(3, Math.sqrt(removed[i] / maxRemoved) * 100)}px`,
                          background: STAGE_COLOR[r.stage],
                        }}
                      />
                      <span className="text-muted-foreground font-mono text-[11px]">
                        {formatInt(removed[i])}
                      </span>
                    </span>
                  )}
                </td>
                <td className="py-2 pr-3 text-right font-mono tabular-nums">{formatInt(r.revived_rows)}</td>
                <td className="text-muted-foreground py-2 pr-3 text-right font-mono tabular-nums">
                  {r.notebook_rows !== null ? formatInt(r.notebook_rows) : ""}
                </td>
                <td className="py-2 text-right font-mono text-xs tabular-nums">
                  {r.difference_pct !== null
                    ? `${r.difference_pct > 0 ? "+" : ""}${r.difference_pct.toFixed(3)}%`
                    : ""}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
