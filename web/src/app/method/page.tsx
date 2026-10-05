import type { Metadata } from "next";
import { FoldsChart } from "@/components/method/folds-chart";
import { FunnelTable } from "@/components/method/funnel-table";
import { RuleTester } from "@/components/method/rule-tester";
import { Note, PageHeader, Section } from "@/components/page-header";
import { formatFixed, formatInt } from "@/lib/format";
import model from "@/lib/data/model.json";
import { BLOCKS } from "@/lib/model";
import { repoPath } from "@/lib/site";
import { getCoefficients, getFolds, getFunnel, getModelPath } from "@/server/analytics";

export const metadata: Metadata = {
  title: "Method",
  description:
    "The four cleaning rounds of MAST30034 Project 1, rule by rule, and the trip-duration regression with its cross-validation.",
};

const BLOCK_TEXT: Record<string, string> = {
  numeric:
    "Precipitation, snow, snow depth, TAVG, WT01, WT02, WT03, WT06, WT08, number_of_event, number_of_collision",
  weekday: "Spark dayofweek of the pickup date (1 = Sunday), one-hot, size max + 1",
  hour: "Pickup hour 0-23, one-hot",
  ratecode: "RatecodeID 1-6, one-hot",
  passenger_count: "1-6, one-hot",
  pickup_zone: "Shapefile zone name, StringIndexer by frequency, one-hot",
  vendor: "VendorID 1-2, one-hot",
  dropoff_zone: "Shapefile zone name, StringIndexer by frequency, one-hot",
  store_and_fwd_flag: "N / Y via StringIndexer, one-hot",
};

export default async function MethodPage() {
  const [funnel, folds, path, coefs] = await Promise.all([
    getFunnel(),
    getFolds(),
    getModelPath(),
    getCoefficients(),
  ]);
  const s = model.summary;
  const nonZero = coefs.filter((c) => c.original_2021 !== 0).length;
  return (
    <>
      <PageHeader kicker="Method" title="Four rounds of cleaning, one regression">
        <p>
          Everything on this site comes from re-running the 2021 notebook&apos;s rules, unchanged, on
          TLC&apos;s current copy of the 2019 data. This page lists every rule with the row counts side by
          side, then the model and how closely the revival reproduces it.
        </p>
      </PageHeader>

      <Section
        id="funnel"
        kicker="Cleaning"
        title="The funnel, rule by rule"
        intro={
          <p>
            Rows the notebook printed are shaded. The raw count differs by 0.24% because TLC&apos;s 2022
            Parquet re-issue holds about 199,000 extra rows, almost all with missing values; after{" "}
            <code className="font-mono text-sm">dropna()</code> the two pipelines agree to within 0.003% at
            every checkpoint.
          </p>
        }
      >
        <FunnelTable rows={funnel} />
      </Section>

      <Section id="quirks" kicker="Kept on purpose" title="Quirks of the 2021 rules">
        <div className="grid gap-4 md:grid-cols-2">
          <Note title="The “miles per hour” rule is miles per minute">
            Cell 74 divides trip distance by <em>minutes</em> and keeps values up to 50, so it only removes
            trips faster than 3,000 mph. A 2.5-mile trip logged in three seconds survives. The revival keeps
            the rule as written.
          </Note>
          <Note title="“Tips more than twice the fare” keeps tips up to half the fare">
            The comment says one thing, the code (
            <code className="font-mono text-[13px]">fare_amount &gt;= 2 * tip_amount</code>) another: it
            removes tips above half the fare. The code is what ran, so the code is what we run.
          </Note>
          <Note title="1–20 January disappear">
            TLC left <code className="font-mono text-[13px]">congestion_surcharge</code> empty until 21
            January 2019, so the opening <code className="font-mono text-[13px]">dropna()</code> removed
            almost every trip before then.
          </Note>
          <Note title="The fare z-score uses a huge standard deviation">
            Fares of up to $671,123 in round 1 push the standard deviation to $94.37, so &ldquo;z &le;
            3&rdquo; means a fare of at most $296.15 and removes only 747 trips in the notebook.
          </Note>
          <Note title="Zone 264 to 265 only">
            Cell 103 is meant to drop unknown zones but its condition only removes trips from 264 <em>and</em>{" "}
            to 265. The unknown zones fall out later, when the merge drops NA/NV names and
            &ldquo;Unknown&rdquo; boroughs.
          </Note>
          <Note title="Duplicated shapefile zones in the model">
            The TLC shapefile labels three polygons with existing ids (56 twice, 103 three times), so the
            model-stage join duplicates those trips and drops ids 57, 104 and 105. The model table reproduces
            this; the maps use corrected ids.
          </Note>
        </div>
      </Section>

      <Section
        id="tester"
        kicker="Try the rules"
        title="Would your trip survive?"
        intro={
          <p>
            The same rules, ported to TypeScript and unit-tested against rows printed in the notebook, run in
            your browser. Pick a preset or edit any field.
          </p>
        }
      >
        <RuleTester />
      </Section>

      <Section
        id="model"
        kicker="Model"
        title="Elastic-net regression on 579 features"
        intro={
          <p>
            Spark MLlib&apos;s{" "}
            <code className="font-mono text-sm">
              LinearRegression(maxIter=10, regParam=0.3, elasticNetParam=0.8)
            </code>{" "}
            predicting <code className="font-mono text-sm">time_duration_minutes</code>, evaluated with a
            hand-written 10-fold cross-validation (cells 291-297). Features, in the order Spark assembled
            them:
          </p>
        }
      >
        <div className="grid gap-10 lg:grid-cols-2">
          <table className="w-full text-sm">
            <caption className="sr-only">Feature blocks of the model</caption>
            <thead>
              <tr className="border-b text-left">
                <th scope="col" className="py-2 font-semibold">
                  Block
                </th>
                <th scope="col" className="py-2 font-semibold">
                  Indices
                </th>
                <th scope="col" className="py-2 font-semibold">
                  Encoding
                </th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {BLOCKS.map((b) => (
                <tr key={b.name}>
                  <th scope="row" className="py-2 pr-3 text-left align-top font-mono text-[13px] font-normal">
                    {b.name}
                  </th>
                  <td className="py-2 pr-3 align-top font-mono text-xs whitespace-nowrap">
                    {b.start}–{b.start + b.size - 1}
                  </td>
                  <td className="text-muted-foreground py-2 align-top">{BLOCK_TEXT[b.name]}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="grid content-start gap-4">
            <dl className="grid grid-cols-2 gap-3">
              <Stat k="Training rows (revived)" v={formatInt(s.rows)} />
              <Stat k="Non-zero coefficients" v={`${nonZero} of 579`} />
              <Stat
                k="2021 mean R² / RMSE"
                v={`${formatFixed(s.notebook_mean_r2, 4)} / ${formatFixed(s.notebook_mean_rmse, 3)}`}
              />
              <Stat
                k="2021 coefficients on revived folds"
                v={`${formatFixed(s.original_coefficients_on_revived_mean_r2, 4)} / ${formatFixed(s.original_coefficients_on_revived_mean_rmse, 3)}`}
              />
              <Stat
                k="2026 refit, same objective"
                v={`${formatFixed(s.refit_mean_r2, 4)} / ${formatFixed(s.refit_mean_rmse, 3)}`}
              />
              <Stat
                k="Zone coefficients, 2021 vs refit"
                v={`r = ${formatFixed(s.zone_coefficient_correlation, 4)}`}
              />
            </dl>
            <p className="text-muted-foreground font-serif text-[15px] leading-relaxed">
              Scoring the 2021 coefficients on the revived folds only works if the cleaning, the feature order
              and the frequency-ordered zone index all match the notebook; they do, to the third decimal of
              R². The refit solves Spark&apos;s standardised objective to convergence with coordinate descent
              on exact X&apos;X sums (
              <a className="link-taxi" href={repoPath("scripts/fit_model.py")}>
                scripts/fit_model.py
              </a>
              ) and lands on the same model. Folds are a hash of each trip, because Spark&apos;s{" "}
              <code className="font-mono text-[13px]">randomSplit</code> cannot be replayed.
            </p>
          </div>
        </div>
        <div className="mt-10 grid gap-10 lg:grid-cols-2">
          <div>
            <h3 className="kicker text-muted-foreground mb-2">R² by fold</h3>
            <FoldsChart folds={folds} metric="r2" />
          </div>
          <div>
            <h3 className="kicker text-muted-foreground mb-2">RMSE by fold (minutes)</h3>
            <FoldsChart folds={folds} metric="rmse" />
          </div>
        </div>
      </Section>

      <Section
        id="penalty"
        kicker="Hindsight"
        title="The penalty did most of the talking"
        intro={
          <p>
            Same features and elastic-net mix, different <code className="font-mono text-sm">regParam</code>.
            The 2021 choice of 0.3 kept 83 coefficients; a penalty thirty times lighter keeps most zones and
            lifts cross-validated R² from 0.37 to about 0.45. The revival reports this rather than changing
            the model.
          </p>
        }
      >
        <table className="w-full max-w-2xl text-sm">
          <caption className="sr-only">
            Regularisation path: mean 10-fold R², RMSE and non-zero coefficients
          </caption>
          <thead>
            <tr className="border-b text-left">
              <th scope="col" className="py-2 font-semibold">
                regParam
              </th>
              <th scope="col" className="py-2 text-right font-semibold">
                CV R²
              </th>
              <th scope="col" className="py-2 text-right font-semibold">
                CV RMSE
              </th>
              <th scope="col" className="py-2 pl-4 font-semibold">
                Non-zero coefficients
              </th>
            </tr>
          </thead>
          <tbody className="divide-y font-mono text-[13px]">
            {path.map((r) => (
              <tr key={r.reg_param} className={r.reg_param === 0.3 ? "bg-card font-semibold" : undefined}>
                <th scope="row" className="py-2 text-left font-normal">
                  {r.reg_param}
                  {r.reg_param === 0.3 && (
                    <span className="text-taxi-text ml-2 font-sans text-xs">2021 choice</span>
                  )}
                </th>
                <td className="py-2 text-right">{formatFixed(r.cv_r2, 4)}</td>
                <td className="py-2 text-right">{formatFixed(r.cv_rmse, 3)}</td>
                <td className="py-2 pl-4">
                  <span className="flex items-center gap-2">
                    <span
                      className="bg-taxi h-2 rounded-full"
                      style={{ width: `${(r.nonzero / 579) * 160}px` }}
                    />
                    {formatInt(Math.round(r.nonzero))}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>
    </>
  );
}

function Stat({ k, v }: { k: string; v: string }) {
  return (
    <div className="bg-card rounded-md border px-3 py-2">
      <dt className="text-muted-foreground text-[11px]">{k}</dt>
      <dd className="font-mono text-sm font-semibold tabular-nums">{v}</dd>
    </div>
  );
}
