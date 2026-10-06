import type { Metadata } from "next";
import Link from "next/link";
import { CiPlot } from "@/components/charts/ci-plot";
import { ResidualDiagnostics, type DiagnosticsData } from "@/components/evidence/residual-diagnostics";
import { Note, PageHeader, Section } from "@/components/page-header";
import { formatFixed, formatInt, formatInterval, formatPct, formatPctTick } from "@/lib/format";
import type { ModelRow } from "@/lib/holdout";
import { repoPath } from "@/lib/site";
import { wilsonInterval } from "@/lib/stats/wilson";
import {
  BOOTSTRAP_SEED,
  getConformalBins,
  getConformalCoverage,
  getConformalCoverageDaily,
  getEvidenceMeta,
  getHoldout,
  getOlsCoefficients,
  getResiduals,
  HOLDOUT_B,
  type ConformalCoverageRow,
  type OlsCoefficient,
} from "@/server/evidence";
import { ScrollRegion } from "@/components/scroll-region";

export const metadata: Metadata = {
  title: "Evaluation",
  description:
    "How good is the 2021 trip-duration model? Temporal hold-out with bootstrap intervals, robust standard errors, residual diagnostics and split-conformal prediction intervals.",
};

const MODEL_LABEL: Record<string, { label: string; sub: string; color: string }> = {
  route_hour_median: {
    label: "Route × hour median",
    sub: "lookup table, no model",
    color: "var(--line-green)",
  },
  en_light: {
    label: "Same features, lighter penalty",
    sub: "elastic net, regParam 0.01",
    color: "var(--line-blue)",
  },
  en_2021_spec: {
    label: "2021 specification",
    sub: "refit on Jan–Oct (reference)",
    color: "var(--foreground)",
  },
  coef_2021: {
    label: "2021 coefficients",
    sub: "as published, not a true hold-out",
    color: "var(--line-grey)",
  },
  mean: { label: "Mean only", sub: "no features", color: "var(--line-red)" },
};

const BOROUGH_ORDER = ["Manhattan", "Brooklyn", "Queens", "Bronx", "Staten Island"];
const OLS_CSV = "/records/ols_coefficients/csv";

function holdoutRows(rows: ModelRow[]) {
  return [...rows].sort((a, b) => a.rmse.estimate - b.rmse.estimate);
}

function coverageOf(
  rows: ConformalCoverageRow[],
  scheme: string,
  method: string,
  level: number,
  groupType: string,
  value = "all",
) {
  return rows.find(
    (r) =>
      r.scheme === scheme &&
      r.method === method &&
      Math.abs(r.level - level) < 1e-9 &&
      r.group_type === groupType &&
      r.group_value === value,
  );
}

const METHODS = [
  { key: "global", label: "Global, symmetric", color: "var(--line-red)" },
  { key: "mondrian", label: "Mondrian by predicted decile", color: "var(--line-blue)" },
  { key: "mondrian_borough", label: "Mondrian by borough × decile", color: "var(--line-green)" },
] as const;

export default async function EvaluationPage() {
  const [meta, holdout, coefs, residuals, coverage, conformalBins, coverageDaily] = await Promise.all([
    getEvidenceMeta(),
    getHoldout(),
    getOlsCoefficients(),
    getResiduals(),
    getConformalCoverage(),
    getConformalBins(),
    getConformalCoverageDaily(),
  ]);
  const temporal = holdoutRows(holdout.temporal);
  const random = holdoutRows(holdout.random);
  const get = (rows: ModelRow[], m: string) => rows.find((r) => r.model === m)!;
  const lookup = get(temporal, "route_hour_median");
  const spec = get(temporal, "en_2021_spec");
  const light = get(temporal, "en_light");
  const specRandom = get(random, "en_2021_spec");
  const rows = meta.splits.rows;

  const numeric = coefs.filter((c) => c.block === "numeric");
  const hours = coefs.filter((c) => c.block === "hour");
  const weekdays = coefs.filter((c) => c.block === "weekday");
  const zones = (block: string) => {
    const z = coefs.filter((c) => c.block === block && c.trips >= 1000);
    const sorted = [...z].sort((a, b) => b.estimate - a.estimate);
    return [...sorted.slice(0, 5), ...sorted.slice(-3)];
  };
  const refs = meta.ols.references;
  const collisions = numeric.find((c) => c.label === "number_of_collision")!;
  const ratios = numeric.map((c) => c.se_cluster_day / c.se_hc3);

  const randomCal = meta.conformal.random;

  const diagnostics: DiagnosticsData[] = (["coef_2021", "ols"] as const).map((model) => {
    const cellW = 2;
    const cellH = 4;
    const agg = new Map<string, { x: number; y: number; n: number }>();
    for (const c of residuals.hist.filter((h) => h.model === model)) {
      const x = Math.floor(c.fitted_lo / cellW) * cellW;
      const y = Math.floor(c.resid_lo / cellH) * cellH;
      const k = `${x}:${y}`;
      const cur = agg.get(k) ?? { x, y, n: 0 };
      cur.n += c.trips;
      agg.set(k, cur);
    }
    const g = residuals.groups.filter((r) => r.model === model);
    const s = meta.diagnostics[model];
    return {
      model,
      label: model === "coef_2021" ? "2021 coefficients" : "OLS, same features",
      cells: [...agg.values()],
      cellW,
      cellH,
      bins: residuals.bins
        .filter((b) => b.model === model)
        .map((b) => ({
          x: (b.fitted_lo + b.fitted_hi) / 2,
          trips: b.trips,
          mean: b.mean_resid,
          p10: b.p10,
          p50: b.p50,
          p90: b.p90,
        })),
      qq: residuals.qq
        .filter((q) => q.model === model)
        .map((q) => ({ p: q.p, normal: q.normal_q, sample: q.sample_q })),
      borough: BOROUGH_ORDER.map((name) =>
        g.find((r) => r.group_type === "borough" && r.group_value === name),
      )
        .filter((r): r is NonNullable<typeof r> => !!r)
        .map((r) => ({ label: r.group_value, trips: r.trips, sd: r.sd_resid, mean: r.mean_resid })),
      hour: g
        .filter((r) => r.group_type === "hour")
        .map((r) => ({ hour: Number(r.group_value), sd: r.sd_resid, mean: r.mean_resid }))
        .sort((a, b) => a.hour - b.hour),
      summary: {
        trips: s.trips,
        sd: s.sd_resid,
        mae: s.mae,
        eta2: s.eta2_sq_resid_borough_hour,
        bp: s.bp_lm_borough_hour,
        df: s.bp_df,
      },
    };
  });

  // coverage with its day-bootstrap 95% interval (trips on the same day are not independent)
  const cov = (scheme: string, method: string, level: number, groupType = "all", value = "all") => {
    const r = coverageOf(coverage, scheme, method, level, groupType, value);
    return r
      ? {
          estimate: r.covered / r.trips,
          lower: r.ci_low,
          upper: r.ci_high,
          trips: r.trips,
          days: r.days,
          width: r.mean_width,
          covered: r.covered,
        }
      : null;
  };
  // the same headline coverage as if every trip were independent, for contrast
  const headline = cov("random", "global", 0.9)!;
  const naive = wilsonInterval(headline.covered, headline.trips);
  // days with enough test trips for a daily coverage to mean something (two January days have 5 and 32)
  const headlineDays = coverageDaily
    .filter(
      (d) =>
        d.scheme === "random" && d.method === "global" && Math.abs(d.level - 0.9) < 1e-9 && d.trips >= 1000,
    )
    .map((d) => d.covered / d.trips);
  const boot = randomCal.bootstrap;
  const bins = [
    ...new Set(coverage.filter((r) => r.group_type === "bin").map((r) => Number(r.group_value))),
  ].sort((a, b) => a - b);
  const decileCov = bins.map((b) => cov("random", "mondrian_borough", 0.9, "bin", String(b))!.estimate);
  const siCal = conformalBins
    .filter(
      (b) =>
        b.scheme === "random" &&
        b.method === "mondrian_borough" &&
        Math.abs(b.level - 0.9) < 1e-9 &&
        b.borough === "Staten Island",
    )
    .reduce((s, b) => s + b.n_cal, 0);
  const temporalCal = meta.conformal.temporal;

  return (
    <>
      <PageHeader kicker="Evaluation" title="How good is the model, honestly?">
        <p>
          The 2021 notebook judged its regression by 10-fold cross-validation on a random split. This page
          asks harder questions: how it does on months it never saw, how sure we can be of each coefficient,
          where its errors pile up, and how wide an honest prediction interval has to be. Every interval
          states its method, sample size and seed.
        </p>
      </PageHeader>

      <Section
        id="holdout"
        kicker="Temporal hold-out"
        title="Train on January–October, test on November–December"
        intro={
          <p>
            Models fitted on {formatInt(rows.train)} trips from January to October (folds 1–9), scored on all{" "}
            {formatInt(rows.temporal)} trips of November and December. Intervals come from a cluster bootstrap
            that resamples whole days ({temporal[0].days} test days, B = {formatInt(HOLDOUT_B)}, seed{" "}
            {BOOTSTRAP_SEED}): trips on the same day share weather and traffic, so they are not independent.
          </p>
        }
      >
        <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_300px]">
          <div className="grid content-start gap-8">
            <CiPlot
              rows={temporal.map((r) => ({
                label: MODEL_LABEL[r.model].label,
                sub: MODEL_LABEL[r.model].sub,
                emphasis: r.model === "en_2021_spec",
                points: [
                  { name: "Nov–Dec (temporal)", color: "var(--foreground)", ...r.rmse },
                  {
                    name: "Jan–Oct fold 0 (random)",
                    color: "var(--taxi-text)",
                    ...get(random, r.model).rmse,
                  },
                ],
                value: formatInterval(r.rmse, 2),
              }))}
              format={(v) => formatFixed(v, 0)}
              axisLabel="RMSE in minutes, lower is better. Right-hand figures show Nov–Dec with its 95% interval"
            />
            <ScrollRegion label="Temporal hold-out metrics with 95% intervals">
              <table className="w-full min-w-[860px] text-sm">
                <caption className="sr-only">
                  Temporal hold-out metrics with 95% day-bootstrap intervals
                </caption>
                <thead>
                  <tr className="border-b text-left">
                    <th scope="col" className="py-2 pr-3 font-semibold">
                      Model (Nov–Dec)
                    </th>
                    <th scope="col" className="py-2 pr-3 text-right font-semibold">
                      RMSE (95% CI)
                    </th>
                    <th scope="col" className="py-2 pr-3 text-right font-semibold">
                      MAE (95% CI)
                    </th>
                    <th scope="col" className="py-2 pr-3 text-right font-semibold">
                      R² (95% CI)
                    </th>
                    <th scope="col" className="py-2 text-right font-semibold">
                      ΔRMSE vs 2021 spec (paired)
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y font-mono text-[13px]">
                  {temporal.map((r) => (
                    <tr key={r.model} className={r.model === "en_2021_spec" ? "bg-card" : undefined}>
                      <th scope="row" className="py-2 pr-3 text-left font-sans font-medium">
                        {MODEL_LABEL[r.model].label}
                      </th>
                      <td className="py-2 pr-3 text-right whitespace-nowrap">{formatInterval(r.rmse, 2)}</td>
                      <td className="py-2 pr-3 text-right whitespace-nowrap">{formatInterval(r.mae, 2)}</td>
                      <td className="py-2 pr-3 text-right whitespace-nowrap">{formatInterval(r.r2, 3)}</td>
                      <td className="py-2 text-right whitespace-nowrap">
                        {r.dRmse ? formatInterval(r.dRmse, 2) : "reference"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ScrollRegion>
          </div>
          <div className="grid content-start gap-4">
            <Note title="A lookup table beats the regression">
              Predicting the January–October median for the same pickup zone, drop-off zone and hour gives an
              RMSE of {formatFixed(lookup.rmse.estimate, 2)} minutes against{" "}
              {formatFixed(spec.rmse.estimate, 2)} for the 2021 specification:{" "}
              {formatFixed(-lookup.dRmse!.estimate, 2)} minutes better (95% CI{" "}
              {formatFixed(-lookup.dRmse!.upper, 2)} to {formatFixed(-lookup.dRmse!.lower, 2)}). The linear
              model adds a pickup effect to a drop-off effect, so it cannot know how far apart two zones are.
            </Note>
            <Note title="The penalty cost accuracy">
              The same 579 features with a 30 times lighter penalty cut RMSE by{" "}
              {formatFixed(-light.dRmse!.estimate, 2)} minutes ({formatFixed(-light.dRmse!.upper, 2)} to{" "}
              {formatFixed(-light.dRmse!.lower, 2)}), matching the regularisation path on{" "}
              <Link href="/method#penalty" className="link-taxi">
                the method page
              </Link>
              .
            </Note>
            <Note title="Out of season is harder">
              The 2021 specification scores {formatFixed(specRandom.rmse.estimate, 2)} on a random Jan–Oct
              fold and {formatFixed(spec.rmse.estimate, 2)} on Nov–Dec. Part of that gap is drift, part is
              that holiday traffic is simply harder to predict. One year of data cannot separate the two.
            </Note>
          </div>
        </div>
        <details className="bg-card mt-6 rounded-md border px-4 py-3 text-sm">
          <summary className="cursor-pointer font-semibold">
            In-period random hold-out (Jan–Oct fold 0)
          </summary>
          <p className="text-muted-foreground mt-2 font-serif">
            {formatInt(rows.random)} trips over {random[0].days} days, the same bootstrap. The 2021
            coefficients were trained on a random 90% of all of 2019, so on any 2019 test set they are not a
            true hold-out. The gap to the Jan–Oct refit is within noise.
          </p>
          <ul className="mt-2 grid gap-1 font-mono text-[13px]">
            {random.map((r) => (
              <li key={r.model}>
                {MODEL_LABEL[r.model].label}: RMSE {formatInterval(r.rmse, 2)}, R² {formatInterval(r.r2, 3)}
              </li>
            ))}
          </ul>
        </details>
      </Section>

      <Section
        id="coefficients"
        kicker="Inference"
        title="Coefficients with honest uncertainty"
        intro={
          <p>
            Penalised coefficients have no standard errors worth quoting, so this is the unpenalised OLS
            counterpart: the same 579-column design on all {formatInt(meta.ols.rows)} model rows, one
            reference level dropped per block ({meta.ols.parameters} parameters, in-sample R²{" "}
            {formatFixed(meta.ols.r2, 3)}). Three standard errors per coefficient: classical,
            heteroskedasticity-robust HC3, and clustered by pickup day ({meta.ols.cluster_days} days, t
            critical value {formatFixed(meta.ols.t_cluster, 3)}). The numpy code was checked against
            statsmodels before it ran (
            <a className="link-taxi" href={repoPath("scripts/sparse_ols.py")}>
              scripts/sparse_ols.py
            </a>
            ).
          </p>
        }
      >
        <ScrollRegion label="OLS coefficients for weather, events and collisions">
          <table className="w-full min-w-[820px] text-sm">
            <caption className="text-muted-foreground mb-3 text-left text-xs">
              Weather, events and collisions: minutes added per unit. Every trip on a day shares these values.
            </caption>
            <thead>
              <tr className="border-b text-left">
                <th scope="col" className="py-2 pr-3 font-semibold">
                  Feature
                </th>
                <th scope="col" className="py-2 pr-3 text-right font-semibold">
                  Estimate
                </th>
                <th scope="col" className="py-2 pr-3 text-right font-semibold">
                  SE classical
                </th>
                <th scope="col" className="py-2 pr-3 text-right font-semibold">
                  SE HC3
                </th>
                <th scope="col" className="py-2 pr-3 text-right font-semibold">
                  SE by day
                </th>
                <th scope="col" className="py-2 pr-3 text-right font-semibold">
                  Day / HC3
                </th>
                <th scope="col" className="py-2 text-right font-semibold">
                  95% CI, by day
                </th>
              </tr>
            </thead>
            <tbody className="divide-y font-mono text-[13px]">
              {numeric.map((c) => {
                const excludes0 = c.ci_low_cluster > 0 || c.ci_high_cluster < 0;
                return (
                  <tr key={c.feature_index}>
                    <th scope="row" className="py-2 pr-3 text-left font-sans font-medium">
                      {c.label}
                    </th>
                    <td className="py-2 pr-3 text-right">{fmtCoef(c.estimate)}</td>
                    <td className="py-2 pr-3 text-right">{fmtCoef(c.se_classical)}</td>
                    <td className="py-2 pr-3 text-right">{fmtCoef(c.se_hc3)}</td>
                    <td className="py-2 pr-3 text-right">{fmtCoef(c.se_cluster_day)}</td>
                    <td className="py-2 pr-3 text-right">{formatFixed(c.se_cluster_day / c.se_hc3, 0)}×</td>
                    <td
                      className={`py-2 text-right ${excludes0 ? "font-semibold" : "text-muted-foreground"}`}
                    >
                      {fmtCoef(c.ci_low_cluster)} to {fmtCoef(c.ci_high_cluster)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </ScrollRegion>
        <div className="mt-6 grid gap-4 md:grid-cols-2">
          <Note title="75 million trips, 351 independent days">
            HC3 intervals for the weather terms are hundredths of a minute wide, but clustering by day makes
            them {formatFixed(Math.min(...ratios), 0)} to {formatFixed(Math.max(...ratios), 0)} times wider.
            The information about weather comes from {meta.ols.cluster_days} days, not from{" "}
            {formatInt(meta.ols.rows)} trips. Intervals that exclude zero are in bold.
          </Note>
          <Note title="What survives">
            Collisions add {fmtCoef(collisions.estimate)} minutes each (day-clustered 95% CI{" "}
            {fmtCoef(collisions.ci_low_cluster)} to {fmtCoef(collisions.ci_high_cluster)}), the one
            weather-type term the 2021 penalty kept. Collisions are partly an outcome of busy, wet days, so
            this is an association, not a causal effect. For rain, see the{" "}
            <Link href="/effects" className="link-taxi">
              effects page
            </Link>
            , which compares like with like.
          </Note>
        </div>

        <div className="mt-10 grid gap-10 lg:grid-cols-2">
          <CiPlot
            rows={hours.map((c) => ({
              label: c.label,
              points: [
                {
                  name: "estimate",
                  color: "var(--line-blue)",
                  estimate: c.estimate,
                  lower: c.ci_low_cluster,
                  upper: c.ci_high_cluster,
                },
              ],
            }))}
            reference={0}
            referenceLabel={`the reference hour, ${refs.hour.label}`}
            format={(v) => formatFixed(v, 0)}
            axisLabel="Minutes relative to 18:00, day-clustered 95% CI"
          />
          <div className="grid content-start gap-8">
            <CiPlot
              rows={weekdays.map((c) => ({
                label: c.label,
                points: [
                  {
                    name: "estimate",
                    color: "var(--line-blue)",
                    estimate: c.estimate,
                    lower: c.ci_low_cluster,
                    upper: c.ci_high_cluster,
                  },
                ],
              }))}
              reference={0}
              referenceLabel={`the reference day, ${refs.weekday.label}`}
              format={(v) => formatFixed(v, 1)}
              axisLabel="Minutes relative to Thursday, day-clustered 95% CI"
            />
            <div>
              <h3 className="kicker text-muted-foreground mb-2">
                Largest zone effects (zones with 1,000+ trips)
              </h3>
              <ZoneTable title="Pickup zone" rows={zones("pickup_zone")} reference={refs.pickup_zone.label} />
              <ZoneTable
                title="Drop-off zone"
                rows={zones("dropoff_zone")}
                reference={refs.dropoff_zone.label}
              />
              <p className="text-muted-foreground mt-2 text-xs">
                All {formatInt(coefs.length)} coefficients with every standard error:{" "}
                {/* a route handler, not a page: a plain download link */}
                <a className="link-taxi" href={OLS_CSV} download>
                  CSV
                </a>{" "}
                or{" "}
                <Link className="link-taxi" href="/records/ols_coefficients">
                  browse
                </Link>
                .
              </p>
            </div>
          </div>
        </div>
      </Section>

      <Section
        id="residuals"
        kicker="Diagnostics"
        title="Where the errors pile up"
        intro={
          <p>
            Residuals of every 2019 model row, for the 2021 coefficients and for the OLS fit. A well-specified
            linear model would show a flat band around zero of constant width. These show a skewed, fanning
            band: long trips are under-predicted, and outer-borough pickups are far noisier than Manhattan
            ones.
          </p>
        }
      >
        <ResidualDiagnostics data={diagnostics} />
      </Section>

      <Section
        id="intervals"
        kicker="Prediction intervals"
        title="Intervals that hold their coverage"
        intro={
          <p>
            Split-conformal prediction wraps any model: hold back calibration trips, look at their residuals,
            and use the right order statistic as the interval. The guarantee is about coverage on average, so
            it says nothing about whether short and long trips are each covered. Conditioning on a group
            (Mondrian conformal) fixes that for the groups you choose. Scheme 1 calibrates the 2021
            coefficients on {formatInt(randomCal.n_cal)} random 2019 trips and tests on{" "}
            {formatInt(randomCal.n_test)} others. Scheme 2 refits on Jan–Oct and tests on{" "}
            {formatInt(temporalCal.n_test)} Nov–Dec trips. See{" "}
            <Link className="link-taxi" href="/methods/decisions/DR-003-conformal-intervals">
              DR-003
            </Link>
            .
          </p>
        }
      >
        <ScrollRegion label="Conformal coverage with 95% intervals">
          <table className="w-full min-w-[760px] text-sm">
            <caption className="text-muted-foreground mb-3 text-left text-xs">
              Empirical coverage with a 95% interval that resamples whole test days ({randomCal.test_days}{" "}
              days in scheme 1, {temporalCal.test_days} in scheme 2, B = {formatInt(boot.B)}, seed {boot.seed}
              ), and mean width in minutes (lower end clipped at 0).
            </caption>
            <thead>
              <tr className="border-b text-left">
                <th scope="col" className="py-2 pr-3 font-semibold">
                  Method
                </th>
                {[0.8, 0.9, 0.95].map((l) => (
                  <th key={l} scope="col" className="py-2 pr-3 text-right font-semibold">
                    {formatPct(l, 0)} target
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y font-mono text-[13px]">
              {(["random", "temporal"] as const).flatMap((scheme) => [
                <tr key={`${scheme}-h`} className="bg-card">
                  <th
                    colSpan={4}
                    scope="colgroup"
                    className="py-1.5 text-left font-sans text-xs font-semibold uppercase"
                  >
                    {scheme === "random"
                      ? "Scheme 1: 2021 coefficients, random 2019 test fold"
                      : "Scheme 2: Jan–Oct refit, tested on Nov–Dec"}
                  </th>
                </tr>,
                ...METHODS.map((m) => (
                  <tr key={`${scheme}-${m.key}`}>
                    <th scope="row" className="py-2 pr-3 text-left font-sans font-medium">
                      {m.label}
                    </th>
                    {[0.8, 0.9, 0.95].map((l) => {
                      const c = cov(scheme, m.key, l);
                      return (
                        <td key={l} className="py-2 pr-3 text-right">
                          {c ? (
                            <>
                              {formatPct(c.estimate, 1)}{" "}
                              <span className="text-muted-foreground whitespace-nowrap">
                                ({formatPct(c.lower, 1)} to {formatPct(c.upper, 1)}) ·{" "}
                                {formatFixed(c.width, 1)} min
                              </span>
                            </>
                          ) : (
                            "–"
                          )}
                        </td>
                      );
                    })}
                  </tr>
                )),
              ])}
            </tbody>
          </table>
        </ScrollRegion>
        <div className="mt-10 grid gap-10 lg:grid-cols-2">
          <CiPlot
            rows={bins.map((b) => {
              const edges = randomCal.edges;
              const lo = b === 0 ? null : edges[b - 1];
              const hi = b === edges.length ? null : edges[b];
              return {
                label: `Decile ${b + 1}`,
                sub:
                  lo === null
                    ? `predicted under ${formatFixed(hi, 1)} min`
                    : hi === null
                      ? `predicted ${formatFixed(lo, 1)}+ min`
                      : `${formatFixed(lo, 1)}–${formatFixed(hi, 1)} min`,
                points: METHODS.map((m) => {
                  const c = cov("random", m.key, 0.9, "bin", String(b))!;
                  return {
                    name: m.label,
                    color: m.color,
                    estimate: c.estimate,
                    lower: c.lower,
                    upper: c.upper,
                  };
                }),
              };
            })}
            reference={0.9}
            referenceLabel="90% target"
            format={formatPctTick}
            axisLabel="Coverage of 90% intervals by predicted-duration decile (scheme 1)"
          />
          <div className="grid content-start gap-8">
            <CiPlot
              rows={BOROUGH_ORDER.map((name) => ({
                label: name,
                sub: `n ${formatInt(cov("random", "global", 0.9, "borough", name)?.trips ?? 0)}`,
                points: METHODS.map((m) => {
                  const c = cov("random", m.key, 0.9, "borough", name)!;
                  return {
                    name: m.label,
                    color: m.color,
                    estimate: c.estimate,
                    lower: c.lower,
                    upper: c.upper,
                  };
                }),
              }))}
              reference={0.9}
              referenceLabel="90% target"
              format={formatPctTick}
              axisLabel="Coverage of 90% intervals by pickup borough (scheme 1)"
            />
            <Note title="Why the intervals resample days">
              Coverage moves together within a day: on the {headlineDays.length} test days of scheme 1 with at
              least 1,000 test trips, the global 90% interval covered between{" "}
              {formatPct(Math.min(...headlineDays), 1)} and {formatPct(Math.max(...headlineDays), 1)} of each
              day&apos;s trips. Treating the {formatInt(headline.trips)} test trips as independent gives a
              Wilson interval of {formatPct(naive.lower, 2)} to {formatPct(naive.upper, 2)}. Resampling whole
              days gives {formatPct(headline.lower, 2)} to {formatPct(headline.upper, 2)}, about{" "}
              {formatFixed((headline.upper - headline.lower) / (naive.upper - naive.lower), 0)} times wider.
              Every coverage interval on this page and in the estimator resamples days.
            </Note>
            <Note title="What this means for the estimator">
              <Link href="/estimate" className="link-taxi">
                Estimate a trip
              </Link>{" "}
              now shows the borough × decile interval. On held-out 2019 trips it covers{" "}
              {formatPct(cov("random", "mondrian_borough", 0.9)!.estimate, 1)} overall, 90% in every borough
              and between {formatPct(Math.min(...decileCov), 0)} and {formatPct(Math.max(...decileCov), 0)} in
              every decile. Staten Island has only {formatInt(siCal)} calibration trips, so it gets one bin
              and intervals about{" "}
              {formatFixed(cov("random", "mondrian_borough", 0.9, "borough", "Staten Island")!.width, 0)}{" "}
              minutes wide: honest, not useful. On Nov–Dec, months the model never saw, coverage slips to{" "}
              {formatPct(cov("temporal", "mondrian_borough", 0.9)!.estimate, 1)}: conformal guarantees assume
              the future looks like the calibration data.
            </Note>
          </div>
        </div>
      </Section>
    </>
  );
}

function fmtCoef(v: number): string {
  const a = Math.abs(v);
  const digits = a === 0 ? 2 : a < 0.001 ? 5 : a < 0.01 ? 4 : a < 1 ? 3 : 2;
  return v
    .toLocaleString("en-AU", { minimumFractionDigits: digits, maximumFractionDigits: digits })
    .replace("-", "−");
}

function ZoneTable({ title, rows, reference }: { title: string; rows: OlsCoefficient[]; reference: string }) {
  return (
    <table className="mb-4 w-full text-sm">
      <caption className="text-muted-foreground mb-1 text-left text-xs">
        {title}, minutes relative to {reference} (HC3 95% CI)
      </caption>
      <tbody className="divide-y">
        {rows.map((c, i) => (
          <tr key={c.feature_index} className={i === 5 ? "border-t-2" : undefined}>
            <th scope="row" className="py-1.5 pr-3 text-left font-normal">
              {c.label}
            </th>
            <td className="py-1.5 pr-3 text-right font-mono text-[13px] tabular-nums">
              {fmtCoef(c.estimate)}
            </td>
            <td className="text-muted-foreground py-1.5 text-right font-mono text-xs tabular-nums">
              {fmtCoef(c.ci_low_hc3)} to {fmtCoef(c.ci_high_hc3)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
