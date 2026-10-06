import type { Metadata } from "next";
import Link from "next/link";
import { Note, PageHeader, Section } from "@/components/page-header";
import { formatInt, formatPct } from "@/lib/format";
import { repoPath } from "@/lib/site";
import { cn } from "@/lib/utils";
import { getDataQuality, getEvidenceMeta } from "@/server/evidence";
import { ScrollRegion } from "@/components/scroll-region";

export const metadata: Metadata = {
  title: "Data quality",
  description:
    "Every 2021 cleaning rule with the rows it removes and why, missing values by month, and the implausible records the rules let through.",
};

const STAGE_COLOR: Record<string, string> = {
  "Round 1": "var(--line-red)",
  "Round 2": "var(--line-blue)",
  "Round 3": "var(--line-green)",
};

/** Shares as percentages, with "< 0.001%" for the very rare. */
function share(x: number): string {
  if (x > 0 && x < 0.00001) return "< 0.001%";
  return formatPct(x, x < 0.01 ? 3 : 1);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export default async function DataQualityPage() {
  const [dq, meta] = await Promise.all([getDataQuality(), getEvidenceMeta()]);
  const totals = meta.data_quality;
  const files = [...new Set(dq.missing.map((m) => m.source_file))];
  const miss = (file: string, col: string) =>
    dq.missing.find((m) => m.source_file === file && m.column_name === col)?.missing ?? 0;
  const rowsOf = (file: string) => dq.missing.find((m) => m.source_file === file)?.rows ?? 0;
  const janMax = Math.max(...dq.january.map((d) => d.rows));
  const redundant = dq.rules.filter((r) => r.fails_only_this === 0 && (r.fails_alone ?? 0) > 0);
  const surcharge = dq.residual.find((r) => r.key === "total_excludes_congestion");
  const v1 = dq.surcharge.filter((r) => r.vendor === 1);

  return (
    <>
      <PageHeader kicker="Data quality" title="What each rule removes, and why">
        <p>
          The 2021 notebook cleaned {formatInt(totals.raw_rows)} raw records down to{" "}
          {formatInt(totals.final_rows)}.{" "}
          <Link className="link-taxi" href="/method#funnel">
            The method page
          </Link>{" "}
          shows how many rows survive each rule in order. This report asks the follow-up questions: what each
          rule actually catches, which rules matter on their own, and what got through. Every figure is a full
          count over the 2019 records, not a sample, so there is no sampling error to report. The uncertainty
          is whether a rule is right. Reproduce it with{" "}
          <a className="link-taxi" href={repoPath("scripts/data_quality.py")}>
            scripts/data_quality.py
          </a>
          .
        </p>
      </PageHeader>

      <Section
        id="missing"
        kicker="Missing values"
        title="The January gap is one column"
        intro={
          <p>
            The notebook&apos;s first step, <code className="font-mono text-sm">dropna()</code>, removes any
            row with a missing field. {formatInt(totals.raw_rows - totals.dropna_rows)} rows go, and almost
            all of them are missing only the congestion surcharge, which TLC started recording on 21 January
            2019.
          </p>
        }
      >
        <div className="grid gap-10 lg:grid-cols-2">
          <ScrollRegion label="Missing values per monthly TLC file">
            <table className="w-full min-w-[480px] text-sm">
              <caption className="sr-only">Missing values per monthly TLC file</caption>
              <thead>
                <tr className="border-b text-left">
                  <th scope="col" className="py-2 pr-3 font-semibold">
                    File
                  </th>
                  <th scope="col" className="py-2 pr-3 text-right font-semibold">
                    Rows
                  </th>
                  <th scope="col" className="py-2 pr-3 text-right font-semibold">
                    Any missing
                  </th>
                  <th scope="col" className="py-2 pr-3 text-right font-semibold">
                    Surcharge
                  </th>
                  <th scope="col" className="py-2 text-right font-semibold">
                    Passengers, rate code, flag
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y font-mono text-[13px]">
                {files.map((f) => (
                  <tr key={f} className={f === "2019-01" ? "bg-card font-semibold" : undefined}>
                    <th scope="row" className="py-1.5 pr-3 text-left font-normal whitespace-nowrap">
                      {f}
                    </th>
                    <td className="py-1.5 pr-3 text-right">{formatInt(rowsOf(f))}</td>
                    <td className="py-1.5 pr-3 text-right whitespace-nowrap">
                      {formatInt(miss(f, "any column"))}{" "}
                      <span className="text-muted-foreground text-[11px]">
                        ({formatPct(miss(f, "any column") / rowsOf(f), 1)})
                      </span>
                    </td>
                    <td className="py-1.5 pr-3 text-right">{formatInt(miss(f, "congestion_surcharge"))}</td>
                    <td className="py-1.5 text-right">{formatInt(miss(f, "passenger_count"))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-muted-foreground mt-2 text-xs">
              Passenger count, rate code and store-and-forward flag are always missing together: about 0.4% of
              each month, the same rows each time.
            </p>
          </ScrollRegion>
          <figure>
            <h3 className="kicker text-muted-foreground mb-3">
              January 2019: rows per pickup day, missing surcharge shaded
            </h3>
            <div
              className="flex h-44 items-end gap-[3px]"
              role="img"
              aria-label="Rows per day in January 2019 with the share missing the congestion surcharge"
            >
              {dq.january.map((d) => (
                <div
                  key={d.date}
                  className="bg-muted relative flex-1 rounded-t-[2px]"
                  style={{ height: `${(d.rows / janMax) * 100}%` }}
                  title={`${d.date}: ${formatInt(d.rows)} rows, ${formatInt(d.missing_congestion)} missing the surcharge`}
                >
                  <div
                    className="bg-line-red absolute inset-x-0 bottom-0 rounded-t-[2px]"
                    style={{ height: `${(d.missing_congestion / d.rows) * 100}%` }}
                  />
                </div>
              ))}
            </div>
            <div className="text-muted-foreground mt-1 flex justify-between font-mono text-[10px]">
              <span>1 Jan</span>
              <span>21 Jan</span>
              <span>31 Jan</span>
            </div>
            <figcaption className="text-muted-foreground mt-2 text-xs">
              Red: rows missing the congestion surcharge. Every row up to 20 January lacks it, and from 21
              January almost none do.
            </figcaption>
          </figure>
        </div>
      </Section>

      <Section
        id="rules"
        kicker="Rule by rule"
        title="Removed in sequence, failing alone, failing only this rule"
        intro={
          <p>
            Rules run in the notebook&apos;s order, so a rule only removes what earlier rules left.
            &ldquo;Fails alone&rdquo; counts rows breaking the rule whatever else is true of them (round 1
            rules on the {formatInt(totals.dropna_rows)} complete rows, later rules on the{" "}
            {formatInt(totals.round1_rows)} round-1 rows). &ldquo;Only this rule&rdquo; counts rows that no
            other rule in the same set would catch: the rows the rule is solely responsible for.
          </p>
        }
      >
        <ol className="grid grid-cols-[minmax(0,1fr)] gap-4 md:grid-cols-2">
          {dq.rules.map((r) => {
            const vals = dq.values.filter((v) => v.key === r.key);
            return (
              <li key={r.key} className="bg-card flex min-w-0 flex-col gap-3 rounded-lg border p-4">
                <div className="flex items-start gap-2.5">
                  <span
                    className="mt-1.5 inline-block size-2.5 shrink-0 rounded-full"
                    style={{ background: STAGE_COLOR[r.stage] ?? "var(--line-grey)" }}
                    aria-hidden
                  />
                  <div className="min-w-0">
                    <p className="text-muted-foreground text-[11px] uppercase">
                      Step {r.step} · {r.stage}
                    </p>
                    <h3 className="font-semibold">{r.label}</h3>
                    <code className="text-muted-foreground mt-0.5 block font-mono text-[11px] break-words">
                      {r.rule}
                    </code>
                  </div>
                </div>
                <p className="font-serif text-[15px] leading-snug">{r.reason}</p>
                <dl className="grid grid-cols-3 gap-2 text-center">
                  <Num k="Removed in sequence" v={r.removed_in_sequence} />
                  <Num k="Fails alone" v={r.fails_alone} />
                  <Num k="Only this rule" v={r.fails_only_this} highlight={r.fails_only_this === 0} />
                </dl>
                {vals.length > 0 && (
                  <div>
                    <p className="kicker text-muted-foreground">Most common offending values</p>
                    <ul className="mt-1 space-y-0.5 font-mono text-[12px]">
                      {vals.map((v) => (
                        <li key={v.rank} className="flex justify-between gap-3">
                          <span className="min-w-0 truncate">{v.value}</span>
                          <span className="text-muted-foreground shrink-0 tabular-nums">
                            {formatInt(v.rows)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </li>
            );
          })}
        </ol>
        {redundant.length > 0 && (
          <div className="mt-6">
            <Note title="Rules that never act on their own">
              <p>
                Every row these {redundant.length} rules catch is also caught by another rule,{" "}
                {formatInt(redundant.reduce((s, r) => s + (r.fails_alone ?? 0), 0))} rows in total. Most are
                reversals, which break several charge rules at once. The rules are harmless, but they are not
                doing any work.
              </p>
              <ul className="mt-2 list-disc pl-5">
                {redundant.map((r) => (
                  <li key={r.key}>
                    {r.label} ({formatInt(r.fails_alone ?? 0)} rows)
                  </li>
                ))}
              </ul>
            </Note>
          </div>
        )}
      </Section>

      <Section
        id="residual"
        kicker="What got through"
        title="Implausible records in the final dataset"
        intro={
          <p>
            Checks the 2021 rules did not have, counted on the {formatInt(totals.final_rows)} trips of the
            final analysis dataset. They are reported, not removed: removing them would change the 2021
            results this site reproduces.
          </p>
        }
      >
        {/* small screens: one card per check, numbers first */}
        <ul className="grid gap-3 md:hidden">
          {dq.residual.map((r) => (
            <li
              key={r.key}
              className={`rounded-lg border p-3 ${r.key === "total_excludes_congestion" ? "bg-card" : ""}`}
            >
              <p className="font-medium">{r.label}</p>
              <dl className="mt-2 grid grid-cols-3 gap-2 font-mono text-[13px]">
                <div>
                  <dt className="text-muted-foreground font-sans text-[11px]">Trips</dt>
                  <dd className="whitespace-nowrap">{formatInt(r.rows)}</dd>
                  <dd className="text-muted-foreground text-[11px] whitespace-nowrap">{share(r.share)}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground font-sans text-[11px]">Vendor 1</dt>
                  <dd className="whitespace-nowrap">{formatInt(r.vendor1_rows)}</dd>
                  <dd className="text-muted-foreground text-[11px] whitespace-nowrap">
                    {share(r.vendor1_rows / r.vendor1_trips)}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground font-sans text-[11px]">Vendor 2</dt>
                  <dd className="whitespace-nowrap">{formatInt(r.vendor2_rows)}</dd>
                  <dd className="text-muted-foreground text-[11px] whitespace-nowrap">
                    {share(r.vendor2_rows / r.vendor2_trips)}
                  </dd>
                </div>
              </dl>
              <p className="text-muted-foreground mt-2 font-serif text-[13px] leading-snug">{r.reason}</p>
            </li>
          ))}
        </ul>
        <ScrollRegion label="Residual plausibility checks by vendor" className="hidden md:block">
          <table className="w-full min-w-[760px] text-sm">
            <caption className="sr-only">Residual plausibility checks by vendor</caption>
            <thead>
              <tr className="border-b text-left">
                <th scope="col" className="py-2 pr-3 font-semibold">
                  Check
                </th>
                <th scope="col" className="py-2 pr-3 text-right font-semibold">
                  Trips
                </th>
                <th scope="col" className="py-2 pr-3 text-right font-semibold">
                  Share
                </th>
                <th scope="col" className="py-2 pr-3 text-right font-semibold">
                  Vendor 1 (CMT)
                </th>
                <th scope="col" className="py-2 text-right font-semibold">
                  Vendor 2 (VeriFone)
                </th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {dq.residual.map((r) => (
                <tr key={r.key} className={r.key === "total_excludes_congestion" ? "bg-card" : undefined}>
                  <th scope="row" className="py-2 pr-3 text-left align-top font-normal">
                    <span className="font-medium">{r.label}</span>
                    <span className="text-muted-foreground block font-serif text-[13px] leading-snug">
                      {r.reason}
                    </span>
                  </th>
                  <td className="py-2 pr-3 text-right align-top font-mono text-[13px] whitespace-nowrap">
                    {formatInt(r.rows)}
                  </td>
                  <td className="py-2 pr-3 text-right align-top font-mono text-[13px] whitespace-nowrap">
                    {share(r.share)}
                  </td>
                  <td className="py-2 pr-3 text-right align-top font-mono text-[13px] whitespace-nowrap">
                    {formatInt(r.vendor1_rows)}
                    <span className="text-muted-foreground block text-[11px]">
                      {share(r.vendor1_rows / r.vendor1_trips)}
                    </span>
                  </td>
                  <td className="py-2 text-right align-top font-mono text-[13px] whitespace-nowrap">
                    {formatInt(r.vendor2_rows)}
                    <span className="text-muted-foreground block text-[11px]">
                      {share(r.vendor2_rows / r.vendor2_trips)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollRegion>
        {surcharge && (
          <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,1fr)_340px]">
            <figure>
              <h3 className="kicker text-muted-foreground mb-3">
                Vendor 1 trips whose total leaves out the congestion surcharge, by month
              </h3>
              <div
                className="flex h-36 items-end gap-1.5"
                role="img"
                aria-label="Share of vendor 1 trips whose total excludes the congestion surcharge, by month"
              >
                {v1.map((r) => {
                  const share = r.trips ? r.rows / r.trips : 0;
                  return (
                    <div key={r.month} className="flex flex-1 flex-col items-center gap-1">
                      <span className="font-mono text-[10px] tabular-nums">{formatPct(share, 0)}</span>
                      <div className="bg-muted relative h-24 w-full rounded-t-[2px]">
                        <div
                          className={cn("bg-line-orange absolute inset-x-0 bottom-0 rounded-t-[2px]")}
                          style={{ height: `${share * 100}%` }}
                        />
                      </div>
                      <span className="text-muted-foreground font-mono text-[10px]">
                        {MONTHS[r.month - 1]}
                      </span>
                    </div>
                  );
                })}
              </div>
            </figure>
            <Note title="A vendor convention hiding in plain sight">
              From February 2019, Creative Mobile Technologies (vendor 1) leaves the $2.50 congestion
              surcharge out of <code className="font-mono text-[13px]">total_amount</code> on{" "}
              {formatPct(surcharge.vendor1_rows / surcharge.vendor1_trips, 0)} of its trips, while VeriFone
              includes it ({formatInt(surcharge.vendor2_rows)} exceptions). The trip-duration model never uses
              the total, so the 2021 results are unaffected, but any comparison of fares by vendor would be
              off by $2.50 a trip.
            </Note>
          </div>
        )}
        <p className="text-muted-foreground mt-6 text-sm">
          All of these tables are in the database:{" "}
          {[
            "dq_rules",
            "dq_rule_values",
            "dq_missing",
            "dq_january",
            "dq_residual_checks",
            "dq_surcharge_by_month",
          ].map((t, i) => (
            <span key={t}>
              {i > 0 && ", "}
              <Link className="link-taxi font-mono text-xs" href={`/records/${t}`}>
                {t}
              </Link>
            </span>
          ))}
          .
        </p>
      </Section>
    </>
  );
}

function Num({ k, v, highlight }: { k: string; v: number | null; highlight?: boolean }) {
  return (
    <div className={cn("rounded-md border px-2 py-1.5", highlight && "border-dashed")}>
      <dt className="text-muted-foreground text-[10px] leading-tight">{k}</dt>
      <dd className="font-mono text-sm font-semibold tabular-nums">{v === null ? "–" : formatInt(v)}</dd>
    </div>
  );
}
