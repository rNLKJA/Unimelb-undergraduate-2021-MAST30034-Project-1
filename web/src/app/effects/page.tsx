import type { Metadata } from "next";
import Link from "next/link";
import { CiPlot } from "@/components/charts/ci-plot";
import { Note, PageHeader, Section } from "@/components/page-header";
import {
  formatFixed,
  formatPctTick,
  formatInt,
  formatInterval,
  formatP,
  formatPct,
  formatPctInterval,
  formatSigned,
  formatSignedPct,
} from "@/lib/format";
import {
  EVENT_RATIO,
  MATCH_WINDOW_DAYS,
  MIN_BOROUGH_DAY_TRIPS,
  MIN_DAY_TRIPS,
  WET_INCHES,
} from "@/lib/effects";
import {
  BOOTSTRAP_SEED,
  EFFECTS_B,
  getEffectsDaily,
  getEventAnalysis,
  getEvidenceMeta,
  getRainAnalysis,
} from "@/server/evidence";

export const metadata: Metadata = {
  title: "Rain and events",
  description:
    "Do rain and permitted street events slow New York taxis? Like-for-like comparisons with bootstrap and robust confidence intervals, effect sizes and caveats.",
};

export default async function EffectsPage() {
  const [rain, events, daily, meta] = await Promise.all([
    getRainAnalysis(),
    getEventAnalysis(),
    getEffectsDaily(),
    getEvidenceMeta(),
  ]);
  const ref = meta.effects_reference;
  const o = events.overall;
  const usable = daily.filter((d) => d.trips >= MIN_DAY_TRIPS && d.mean_log_ratio !== null && d.snow === 0);

  return (
    <>
      <PageHeader kicker="Effects" title="Does rain slow a taxi down?">
        <p>
          The 2021 penalty shrank every weather coefficient to zero. That says weather did not help{" "}
          <em>predict</em> a single trip once zones and hours were known. It does not say weather has no
          effect. This page asks the question directly, for rain and for permitted street events, with
          intervals, effect sizes and the confounders each comparison does and does not handle.
        </p>
      </PageHeader>

      <Section
        id="index"
        kicker="The outcome"
        title="Compare the same trips, not the same day"
        intro={
          <p>
            People ride differently in the rain (more short hops, fewer walks), so raw daily averages mix two
            things. Each trip is compared instead with the 2019 median of its own route and hour: the index is
            the mean of log(minutes ÷ that median) over a day, and exp(index) − 1 reads as &ldquo;the same
            trips took this much longer than usual&rdquo;. Route-hours with at least {ref.min_cell} trips (
            {formatInt(ref.cells)} of them) cover {formatPct(ref.indexed_trips / ref.trips, 1)} of the{" "}
            {formatInt(ref.trips)} trips.
          </p>
        }
      >
        <RainScatter days={usable} />
      </Section>

      <Section
        id="rain"
        kicker="Rain"
        title={`Rain days: about ${formatFixed(rain.regression.wetPct.estimate * 100, 0)}% slower`}
        intro={
          <p>
            {formatInt(rain.usableDays)} days with at least {formatInt(MIN_DAY_TRIPS)} trips and no snow (
            {rain.excluded.lowTrips} sparse days in early January and {rain.excluded.snow} snow days left
            out). A day is wet with at least {WET_INCHES} inch at Central Park. Bootstrap intervals resample
            days within each group (B = {formatInt(EFFECTS_B)}, seed {BOOTSTRAP_SEED}), and the regression
            uses HC3 standard errors, checked against Newey–West errors because neighbouring days are alike.
          </p>
        }
      >
        <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="grid content-start gap-8">
            <dl className="grid gap-3 sm:grid-cols-3">
              <Stat
                k={`Wet (${rain.wet.days} days) vs dry (${rain.dry.days} days), raw`}
                v={`${formatSigned(rain.rawMinutes.boot.estimate, 2)} min`}
                note={`95% CI ${formatSigned(rain.rawMinutes.boot.lower, 2)} to ${formatSigned(rain.rawMinutes.boot.upper, 2)} (bootstrap) · Welch ${formatSigned(rain.rawMinutes.welch.lower, 2)} to ${formatSigned(rain.rawMinutes.welch.upper, 2)}, p ${formatP(rain.rawMinutes.welch.p)} · Hedges' g ${formatFixed(rain.rawMinutes.hedgesG, 2)}`}
              />
              <Stat
                k="Same trips, wet vs dry"
                v={formatSignedPct(rain.adjusted.boot.estimate)}
                note={`95% CI ${formatSignedPct(rain.adjusted.boot.lower)} to ${formatSignedPct(rain.adjusted.boot.upper)} · Hedges' g ${formatFixed(rain.adjusted.hedgesG, 2)}`}
              />
              <Stat
                k="Same trips, adjusted for month, weekday and holidays"
                v={formatSignedPct(rain.regression.wetPct.estimate)}
                note={`95% CI ${formatSignedPct(rain.regression.wetPct.lower)} to ${formatSignedPct(rain.regression.wetPct.upper)} · OLS with HC3, n = ${rain.regression.n} days, ${rain.regression.p} parameters, R² ${formatFixed(rain.regression.r2, 2)} · Newey–West (${rain.regression.hacLags} lags) ${formatSignedPct(rain.regression.wetPctHac.lower)} to ${formatSignedPct(rain.regression.wetPctHac.upper)}`}
              />
            </dl>
            <CiPlot
              rows={[
                {
                  label: "Wet vs dry, two-sample",
                  sub: `${rain.wet.days} vs ${rain.dry.days} days`,
                  points: [{ name: "estimate", color: "var(--line-blue)", ...rain.adjusted.boot }],
                  value: formatPctInterval(rain.adjusted.boot),
                },
                {
                  label: "Wet vs dry, regression",
                  sub: "month, weekday, holiday fixed effects",
                  emphasis: true,
                  points: [{ name: "estimate", color: "var(--foreground)", ...rain.regression.wetPct }],
                  value: formatPctInterval(rain.regression.wetPct),
                },
                ...rain.dose
                  .filter((d) => d.boot)
                  .map((d) => ({
                    label: d.label,
                    sub: `${d.days} days vs dry`,
                    points: [{ name: "estimate", color: "var(--line-green)", ...d.boot! }],
                    value: formatPctInterval(d.boot!),
                  })),
              ]}
              reference={0}
              referenceLabel="no difference"
              format={formatPctTick}
              axisLabel="Change in duration index, % (95% CI)"
            />
          </div>
          <div className="grid content-start gap-4">
            <Note title="Raw minutes understate it">
              Wet days averaged {formatFixed(rain.wet.meanMinutes, 2)} minutes per trip and dry days{" "}
              {formatFixed(rain.dry.meanMinutes, 2)}. Comparing each trip with its own route and hour moves
              the estimate from {formatPct(rain.rawMinutes.boot.estimate / rain.dry.meanMinutes, 1)} to{" "}
              {formatPct(rain.adjusted.boot.estimate, 1)}, which suggests rain shifts riders towards shorter
              trips and so hides part of the slowdown in the raw average.
            </Note>
            <Note title="The regression is the headline">
              Rainy days cluster in some months, and both traffic and trip mix change by season and weekday.
              With those held fixed the estimate is {formatPctInterval(rain.regression.wetPct)}. Light rain
              (under {WET_INCHES} in) is estimated at{" "}
              {formatSignedPct(Math.expm1(rain.regression.light.estimate))} (
              {formatSignedPct(Math.expm1(rain.regression.light.lower))} to{" "}
              {formatSignedPct(Math.expm1(rain.regression.light.upper))}).
            </Note>
            <Note title="No clear dose response">
              Heavier rain is not clearly worse: the bins overlap and the heaviest has only{" "}
              {rain.dose[rain.dose.length - 1].days} days. These bins are exploratory and uncorrected for
              multiple comparisons.
            </Note>
          </div>
        </div>
      </Section>

      <Section
        id="events"
        kicker="Permitted events"
        title="Event-heavy days, matched"
        intro={
          <p>
            Permits follow the calendar (summer weekends are full of them), so comparing event days with all
            other days would mostly compare seasons. Each borough-day is compared only with days in its own
            window: same borough, same weekday, within {MATCH_WINDOW_DAYS / 7} weeks, same wet or dry weather.
            A day is event-heavy with at least {EVENT_RATIO}× the median permit count of its window, and its
            control is the nearest window day at or below that median. Holidays are excluded and controls may
            be reused. The outcome is the duration index for pickups in that borough (borough-days with at
            least {MIN_BOROUGH_DAY_TRIPS} indexed trips).
          </p>
        }
      >
        <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="grid content-start gap-8">
            <dl className="grid gap-3 sm:grid-cols-3">
              <Stat
                k={`${o.pairs} matched pairs on ${o.distinctDates} dates`}
                v={formatSignedPct(o.effect.estimate)}
                note={`95% CI ${formatSignedPct(o.effect.lower)} to ${formatSignedPct(o.effect.upper)} (bootstrap over dates, B = ${formatInt(EFFECTS_B)}, seed ${BOOTSTRAP_SEED})`}
              />
              <Stat
                k="Paired t test, one mean per date"
                v={`p ${formatP(o.ttest.p)}`}
                note={`mean difference in the log index ${formatInterval({ estimate: o.ttest.estimate, lower: o.ttest.lower, upper: o.ttest.upper }, 4)} · d_z ${formatFixed(o.dz, 2)}`}
              />
              <Stat
                k="Sign test, one mean per date"
                v={`${o.sign.positive} slower, ${o.sign.negative} faster`}
                note={`exact two-sided p ${formatP(o.sign.p)}`}
              />
            </dl>
            <CiPlot
              rows={[
                {
                  label: "All boroughs",
                  sub: `${o.pairs} pairs, ${o.distinctDates} dates`,
                  emphasis: true,
                  points: [{ name: "estimate", color: "var(--foreground)", ...o.effect }],
                  value: formatPctInterval(o.effect),
                },
                ...events.byBorough.map((b) => ({
                  label: b.borough,
                  sub: `${b.pairs} pairs`,
                  points: [{ name: "estimate", color: "var(--line-blue)", ...b.effect }],
                  value: formatPctInterval(b.effect),
                })),
              ]}
              reference={0}
              referenceLabel="no difference"
              format={formatPctTick}
              axisLabel="Event-heavy day minus matched control, duration index % (95% CI)"
            />
            <div className="relative overflow-x-auto">
              <table className="w-full min-w-[560px] text-sm">
                <caption className="text-muted-foreground mb-2 text-left text-xs">
                  Balance of the matched pairs (means)
                </caption>
                <thead>
                  <tr className="border-b text-left">
                    <th scope="col" className="py-2 pr-3 font-semibold">
                      Borough
                    </th>
                    <th scope="col" className="py-2 pr-3 text-right font-semibold">
                      Permits: heavy / control
                    </th>
                    <th scope="col" className="py-2 pr-3 text-right font-semibold">
                      Days apart
                    </th>
                    <th scope="col" className="py-2 pr-3 text-right font-semibold">
                      TAVG diff (°F)
                    </th>
                    <th scope="col" className="py-2 text-right font-semibold">
                      Rain diff (in)
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y font-mono text-[13px]">
                  {[o, ...events.byBorough].map((b) => (
                    <tr key={b.borough}>
                      <th scope="row" className="py-1.5 pr-3 text-left font-sans font-medium">
                        {b.borough}
                      </th>
                      <td className="py-1.5 pr-3 text-right">
                        {formatFixed(b.meanEvents.high, 0)} / {formatFixed(b.meanEvents.control, 0)}
                      </td>
                      <td className="py-1.5 pr-3 text-right">{formatFixed(b.balance.meanGapDays, 1)}</td>
                      <td className="py-1.5 pr-3 text-right">{formatSigned(b.balance.meanTavgDiff, 1)}</td>
                      <td className="py-1.5 text-right">
                        {formatSigned(b.balance.meanPrecipitationDiff, 2)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div className="grid content-start gap-4">
            <Note title="No detectable effect">
              Event-heavy days were {formatSignedPct(o.effect.estimate)} different from their matched
              controls, and the interval runs from {formatSignedPct(o.effect.lower)} to{" "}
              {formatSignedPct(o.effect.upper)}. That rules out a large citywide slowdown from permit volume.
              It does not rule out a big effect near one parade route, which a borough-wide index would
              dilute.
            </Note>
            <Note title="Small sample, stated plainly">
              Only {o.highDays} borough-days met the definition, {o.unmatched} found no control, and{" "}
              {o.distinctControls} distinct control days were used. The {o.pairs} pairs fall on{" "}
              {o.distinctDates} dates, and pairs on the same date share that day&apos;s citywide traffic, so
              the interval resamples dates rather than pairs.{" "}
              {events.excluded.length > 0 && (
                <>{events.excluded.join(" and ")} had too few indexed trips per day to compare. </>
              )}
              The 2021 model gave events a zero coefficient, and this agrees.
            </Note>
          </div>
        </div>
      </Section>

      <Section id="caveats" kicker="Caveats" title="What these comparisons cannot rule out">
        <ul className="prose-news grid max-w-4xl list-disc gap-2 pl-5">
          <li>
            <strong>Observational data.</strong> Rain and permits were not assigned at random. The estimates
            are associations after the stated adjustments, not causal effects.
          </li>
          <li>
            <strong>Selection within a route.</strong> The index fixes the route and hour, not who rides or
            why. If rain makes people take the same route at more congested moments within the hour, part of
            the &ldquo;slowdown&rdquo; is that.
          </li>
          <li>
            <strong>One rain gauge, one number a day.</strong> Precipitation is Central Park&apos;s daily
            total. It says nothing about when it rained or how wet Queens was.
          </li>
          <li>
            <strong>Collisions are a mediator.</strong> Rain causes crashes, and crashes cause delays.
            Adjusting for collisions would remove part of the effect being measured, so neither comparison
            does.
          </li>
          <li>
            <strong>Permits are not crowds.</strong> NYC Open Data has revised the 2019 events since 2021 (see{" "}
            <Link className="link-taxi" href="/conditions">
              conditions
            </Link>
            ), and a block party and a marathon each count as one permit.
          </li>
          <li>
            <strong>Neighbouring days are alike.</strong> Residuals of the day-level rain regression are
            serially correlated (lag-1 autocorrelation {formatFixed(rain.regression.lag1, 2)}, Durbin–Watson{" "}
            {formatFixed(rain.regression.durbinWatson, 2)}), which HC3 errors ignore. Newey–West errors with{" "}
            {rain.regression.hacLags} lags give {formatSignedPct(rain.regression.wetPctHac.lower)} to{" "}
            {formatSignedPct(rain.regression.wetPctHac.upper)}, so the headline holds.
          </li>
          <li>
            <strong>Exploratory cuts.</strong> The dose-response bins and the per-borough results are
            uncorrected for multiple comparisons. The two headline estimates are the rain regression and the
            overall matched event effect. I chose the wet-day threshold and the event definition while
            building the analysis, not in a plan written beforehand.
          </li>
        </ul>
      </Section>
    </>
  );
}

function Stat({ k, v, note }: { k: string; v: string; note: string }) {
  return (
    <div className="bg-card rounded-md border px-4 py-3">
      <dt className="text-muted-foreground text-xs">{k}</dt>
      <dd className="font-condensed mt-1 text-3xl font-extrabold tabular-nums">{v}</dd>
      <dd className="text-muted-foreground mt-1 text-[11px] leading-snug">{note}</dd>
    </div>
  );
}

type RainDay = { date: string; precipitation: number; mean_log_ratio: number | null };

function RainScatter({ days }: { days: RainDay[] }) {
  return (
    <figure>
      {/* a narrow layout below the sm breakpoint keeps the axis text readable on a phone */}
      <div className="sm:hidden">
        <RainScatterSvg days={days} compact />
      </div>
      <div className="hidden sm:block">
        <RainScatterSvg days={days} />
      </div>
      <figcaption className="text-muted-foreground mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs">
        <span className="text-foreground inline-flex items-center gap-1.5">
          <span className="bg-taxi-text inline-block size-2.5 rounded-full" /> dry
        </span>
        <span className="text-foreground inline-flex items-center gap-1.5">
          <span className="bg-line-grey inline-block size-2.5 rounded-full" /> light
        </span>
        <span className="text-foreground inline-flex items-center gap-1.5">
          <span className="bg-line-blue inline-block size-2.5 rounded-full" /> wet ({WET_INCHES} in or more,
          right of the dashed line)
        </span>
        <span>One dot per day: how much longer than its route-hour median the day&apos;s trips took.</span>
      </figcaption>
    </figure>
  );
}

function RainScatterSvg({ days, compact = false }: { days: RainDay[]; compact?: boolean }) {
  const W = compact ? 360 : 960;
  const H = compact ? 300 : 360;
  const m = compact ? { l: 40, r: 8, t: 10, b: 36 } : { l: 48, r: 12, t: 12, b: 38 };
  const tick = compact ? "font-mono text-[11px]" : "font-mono text-[10px]";
  const label = compact ? "text-[12px]" : "text-[11px]";
  const pts = days.map((d) => ({
    x: Math.sqrt(d.precipitation),
    y: Math.expm1(d.mean_log_ratio as number),
    d,
  }));
  const xMax = Math.ceil(Math.max(...pts.map((p) => p.x)) * 10) / 10;
  const yLo = Math.floor(Math.min(...pts.map((p) => p.y)) * 20) / 20;
  const yHi = Math.ceil(Math.max(...pts.map((p) => p.y)) * 20) / 20;
  const sx = (v: number) => m.l + (v / xMax) * (W - m.l - m.r);
  const sy = (v: number) => m.t + (1 - (v - yLo) / (yHi - yLo)) * (H - m.t - m.b);
  const xt = (compact ? [0, 0.25, 0.5, 1, 1.5] : [0, 0.1, 0.25, 0.5, 1, 1.5]).filter(
    (v) => Math.sqrt(v) <= xMax,
  );
  const yt: number[] = [];
  for (let v = yLo; v <= yHi + 1e-9; v += 0.05) yt.push(Math.round(v * 100) / 100 || 0);
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="h-auto w-full"
      role="img"
      aria-label="Daily duration index against precipitation"
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
          <text x={m.l - 6} y={sy(v) + 3} textAnchor="end" className={`fill-muted-foreground ${tick}`}>
            {formatPct(v, 0)}
          </text>
        </g>
      ))}
      {xt.map((v) => (
        <text
          key={v}
          x={sx(Math.sqrt(v))}
          y={H - m.b + 14}
          textAnchor="middle"
          className={`fill-muted-foreground ${tick}`}
        >
          {v}
        </text>
      ))}
      <line
        x1={sx(Math.sqrt(WET_INCHES))}
        x2={sx(Math.sqrt(WET_INCHES))}
        y1={m.t}
        y2={H - m.b}
        className="stroke-foreground/40"
        strokeDasharray="4 3"
      />
      {pts.map((p) => (
        <circle
          key={p.d.date}
          cx={sx(p.x)}
          cy={sy(p.y)}
          r={compact ? 2.4 : 2.6}
          fill={
            p.d.precipitation >= WET_INCHES
              ? "var(--line-blue)"
              : p.d.precipitation > 0
                ? "var(--line-grey)"
                : "var(--taxi-text)"
          }
          fillOpacity={0.75}
        >
          <title>{`${p.d.date}: ${p.d.precipitation} in, ${formatSignedPct(p.y)}`}</title>
        </circle>
      ))}
      <text
        x={(m.l + W - m.r) / 2}
        y={H - 4}
        textAnchor="middle"
        className={`fill-muted-foreground ${label}`}
      >
        {compact
          ? "Precipitation, inches (square-root scale)"
          : "Central Park precipitation, inches (square-root scale)"}
      </text>
    </svg>
  );
}
