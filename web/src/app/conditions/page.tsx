import type { Metadata } from "next";
import { WeekdayHourHeatmap } from "@/components/charts/weekday-hour-heatmap";
import { DailyCharts, type DailyPoint } from "@/components/conditions/daily-charts";
import { ScatterExplorer } from "@/components/conditions/scatter-explorer";
import { Note, PageHeader, Section } from "@/components/page-header";
import { formatFixed, formatInt } from "@/lib/format";
import { formatDate } from "@/lib/time";
import { getCoefficients, getDaily, getSideTotals, getWeekdayHourVendor } from "@/server/analytics";

export const metadata: Metadata = {
  title: "Weather, events and collisions",
  description:
    "Daily 2019 yellow-taxi demand and trip times next to Central Park weather, permitted events and NYPD collisions.",
};

const NOTEBOOK_EVENT_ROWS = 2_823_378;

export default async function ConditionsPage() {
  const [daily, whv, coefs, side] = await Promise.all([
    getDaily(),
    getWeekdayHourVendor(),
    getCoefficients(),
    getSideTotals(),
  ]);
  const points: DailyPoint[] = daily.map((d) => ({
    date: d.date,
    isodow: d.isodow,
    trips: d.trips > 1000 ? d.trips : null,
    median: d.trips > 1000 ? d.median_min : null,
    tavg: d.tavg,
    precipitation: d.precipitation,
    snow: d.snow,
    events: d.events,
    collisions: d.collisions,
  }));
  const kept = daily.filter((d) => d.trips > 1000);
  const busiest = kept.reduce((a, b) => (b.trips > a.trips ? b : a));
  const quietest = kept.reduce((a, b) => (b.trips < a.trips ? b : a));
  const removed = daily.filter((d) => d.date <= "2019-01-20").reduce((s, d) => s + d.trips, 0);
  const numeric = coefs.filter((c) => c.block === "numeric");

  return (
    <>
      <PageHeader kicker="Conditions" title="Weather, events and collisions">
        <p>
          The 2021 model joined each trip to that day&apos;s Central Park weather, the number of permitted
          street events in its pickup borough and the number of collisions there. Here is every day of 2019
          side by side.
        </p>
      </PageHeader>

      <Section id="daily" kicker="Daily series" title="A year, day by day">
        <div className="grid gap-10 lg:grid-cols-[1fr_300px]">
          <DailyCharts data={points} />
          <div className="grid content-start gap-4">
            <Note title="Where did 1–20 January go?">
              TLC only started filling the congestion surcharge on 21 January 2019. The notebook&apos;s first
              step, <code className="font-mono text-[13px]">dropna()</code>, removes any row with a missing
              field, so the first 20 days fell out of the analysis ({formatInt(removed)} trips survive from
              them). The revived pipeline keeps the same rule, so the shaded weeks are empty here too.
            </Note>
            <Note title="Busiest and quietest days">
              {formatDate(busiest.date, { weekday: "long", day: "numeric", month: "long" })} had the most
              cleaned trips ({formatInt(busiest.trips)});{" "}
              {formatDate(quietest.date, { weekday: "long", day: "numeric", month: "long" })} the fewest (
              {formatInt(quietest.trips)}).
            </Note>
            <Note title="Revised event records">
              NYC Open Data has revised its historical events dataset since 2021: 2019 now holds{" "}
              {formatInt(side.events)} permits against {formatInt(NOTEBOOK_EVENT_ROWS)} rows in the
              notebook&apos;s export, so daily counts are about ten times smaller than the model saw. The 2021
              model gave events a coefficient of zero either way.
            </Note>
            <Note title="Collision coverage">
              The 2021 BigQuery export holds {formatInt(side.collisions)} collisions with a known borough and
              stops on {formatDate(side.lastCollision, { day: "numeric", month: "long" })}; later days count
              as zero, as in the notebook.
            </Note>
          </div>
        </div>
      </Section>

      <Section
        id="scatter"
        kicker="Day-level relationships"
        title="Does the weather move the taxis?"
        intro={
          <p>
            Each dot is a day. Pick a condition and an outcome; the yellow line is a least-squares fit. Rain
            nudges demand up a little and temperature tracks the seasons, but none of these alone explains
            much.
          </p>
        }
      >
        <ScatterExplorer data={points} />
      </Section>

      <Section
        id="weekday-hour"
        kicker="The 2021 vendor charts"
        title="When trips take longest"
        intro={
          <p>
            Mean trip minutes for every weekday and pickup hour. Weekday afternoons are the slowest; early
            mornings and weekends are quick. The notebook drew this as one line chart per vendor from a 10%
            sample; this uses every cleaned trip.
          </p>
        }
      >
        <WeekdayHourHeatmap rows={whv} />
      </Section>

      <Section
        id="model"
        kicker="What the model made of it"
        title="Eleven numeric features, one survivor"
        intro={
          <p>
            The elastic-net penalty (regParam 0.3, elasticNetParam 0.8) shrank every weather and event
            coefficient to exactly zero. Only collisions kept a small positive weight, and the trip&apos;s
            zones, hour and rate code did the real work (see{" "}
            <a className="link-taxi" href="/estimate">
              the estimator
            </a>
            ).
          </p>
        }
      >
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] text-sm">
            <caption className="sr-only">Coefficients of the numeric features, minutes per unit</caption>
            <thead>
              <tr className="border-b text-left">
                <th scope="col" className="py-2 font-semibold">
                  Feature (notebook name)
                </th>
                <th scope="col" className="py-2 text-right font-semibold">
                  2021 coefficient
                </th>
                <th scope="col" className="py-2 text-right font-semibold">
                  2026 refit
                </th>
              </tr>
            </thead>
            <tbody className="divide-y font-mono text-[13px]">
              {numeric.map((c) => (
                <tr key={c.feature_index}>
                  <th scope="row" className="py-2 text-left font-normal">
                    {c.label}
                  </th>
                  <td
                    className={`py-2 text-right ${c.original_2021 ? "font-semibold" : "text-muted-foreground"}`}
                  >
                    {c.original_2021 ? formatFixed(c.original_2021, 4) : "0"}
                  </td>
                  <td
                    className={`py-2 text-right ${c.refit_2026 ? "font-semibold" : "text-muted-foreground"}`}
                  >
                    {c.refit_2026 ? formatFixed(c.refit_2026, 4) : "0"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
    </>
  );
}
