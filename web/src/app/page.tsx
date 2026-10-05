import { ArrowRight } from "lucide-react";
import { GithubIcon } from "@/components/icons";
import Link from "next/link";
import { HeroMap } from "@/components/landing/hero-map";
import { LineBullet } from "@/components/landing/line-bullet";
import { formatCompact, formatFixed, formatInt, formatPct } from "@/lib/format";
import { SITE, repoTree } from "@/lib/site";
import { hourLabel } from "@/lib/time";
import { getCoefficients, getHeadline, getWeekdayHourVendor } from "@/server/analytics";

const SECTIONS = [
  {
    href: "/map",
    glyph: "M",
    color: "var(--line-red)",
    title: "Zone map",
    text: "Pickups, drop-offs and median minutes for all 263 taxi zones, hour by hour. Press play and watch the city wake up.",
  },
  {
    href: "/routes",
    glyph: "R",
    color: "var(--line-blue)",
    title: "Route explorer",
    text: "Pick a zone and see its busiest destinations drawn like subway lines, with how long each ride really took.",
  },
  {
    href: "/conditions",
    glyph: "C",
    color: "var(--line-green)",
    title: "Weather, events, collisions",
    text: "Every day of 2019 next to Central Park weather, permitted events and NYPD collisions: the extra data the model used.",
  },
  {
    href: "/estimate",
    glyph: "E",
    color: "var(--line-purple)",
    title: "Estimate a trip",
    text: "Run the 2021 regression in your browser. Choose zones, a date and an hour; see the prediction and every term behind it.",
  },
  {
    href: "/method",
    glyph: "§",
    color: "var(--line-orange)",
    title: "Method",
    text: "The four cleaning rounds rule by rule, with the notebook's row counts next to the revived pipeline's.",
  },
  {
    href: "/records",
    glyph: "DB",
    color: "var(--line-grey)",
    title: "Records",
    text: "Browse, search and download every table of the analytics database behind this site.",
  },
] as const;

export default async function Home() {
  const [h, coefs, whv] = await Promise.all([getHeadline(), getCoefficients(), getWeekdayHourVendor()]);
  const coef = (label: string, block: string) =>
    coefs.find((c) => c.label === label && c.block === block)?.original_2021 ?? 0;
  const both = whv.filter((r) => r.vendor === 0);
  const byHour = Array.from({ length: 24 }, (_, hr) => {
    const rows = both.filter((r) => r.hour === hr);
    const n = rows.reduce((s, r) => s + r.trips, 0);
    return { hr, mean: rows.reduce((s, r) => s + r.trips * r.mean_min, 0) / n };
  });
  const slowest = byHour.reduce((a, b) => (b.mean > a.mean ? b : a));
  const fastest = byHour.reduce((a, b) => (b.mean < a.mean ? b : a));
  const nonZero = coefs.filter((c) => c.original_2021 !== 0).length;

  return (
    <>
      {/* ---------------------------------------------------------------- hero */}
      <section className="mx-auto max-w-7xl px-4 pt-10 sm:px-6 lg:pt-14">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b pb-2">
          <p className="kicker text-muted-foreground">
            MAST30034 Applied Data Science · Project 1 · University of Melbourne
          </p>
          <p className="kicker text-muted-foreground">2021 Semester 2 · revived 2026</p>
        </div>
        <div className="rule-double mt-1" />
        <div className="grid items-center gap-10 py-10 lg:grid-cols-[1.05fr_1fr]">
          <div>
            <h1 className="font-condensed text-display font-extrabold uppercase">
              Where, when <br className="hidden sm:block" />
              and how long<span className="text-taxi">.</span>
            </h1>
            <p className="prose-news text-foreground/85 mt-6 max-w-xl text-lg">
              Every New York yellow-cab ride of 2019, all {formatCompact(h.rawRows)} of them, cleaned with the
              rules I wrote for a 2021 data-science project, joined to weather, street events and car crashes,
              and fitted with a regression that predicts how many minutes a trip will take.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link
                href="/map"
                className="bg-taxi text-taxi-ink inline-flex items-center gap-2 rounded-md px-4 py-2.5 font-semibold shadow-[inset_0_-3px_0_rgba(0,0,0,0.15)] transition-transform hover:-translate-y-px"
              >
                Open the zone map <ArrowRight className="size-4" aria-hidden />
              </Link>
              <Link
                href="/estimate"
                className="hover:bg-muted inline-flex items-center gap-2 rounded-md border px-4 py-2.5 font-semibold"
              >
                Estimate a trip
              </Link>
            </div>
          </div>
          <figure className="relative">
            <HeroMap className="h-auto w-full" />
            <figcaption className="text-muted-foreground mt-2 flex items-center justify-between gap-2 text-xs">
              <span>
                2019 pickups by taxi zone, <span className="dark:hidden">darker</span>
                <span className="hidden dark:inline">brighter</span> = busier
              </span>
              <span className="font-mono">{formatInt(h.finalRows)} trips</span>
            </figcaption>
          </figure>
        </div>
      </section>

      {/* ---------------------------------------------------------- numbers */}
      <section aria-label="Key numbers" className="bg-card border-y">
        <dl className="mx-auto grid max-w-7xl grid-cols-2 lg:grid-cols-4 [&>div]:border-b lg:[&>div]:border-r lg:[&>div]:border-b-0 lg:[&>div:last-child]:border-r-0 [&>div:nth-child(odd)]:border-r">
          <KeyNumber
            label="Raw trip records"
            value={formatCompact(h.rawRows)}
            note="12 monthly TLC files, 2019"
          />
          <KeyNumber
            label="After four cleaning rounds"
            value={formatCompact(h.finalRows)}
            note={`notebook: ${formatCompact(h.finalRowsNotebook)}`}
          />
          <KeyNumber
            label="Variance explained (R²)"
            value={formatFixed(h.notebookR2, 3)}
            note="10-fold CV, 2021 notebook"
          />
          <KeyNumber
            label="Typical error (RMSE)"
            value={`${formatFixed(h.notebookRmse, 2)} min`}
            note="same folds"
          />
        </dl>
      </section>

      {/* ---------------------------------------------------------- story */}
      <section className="mx-auto grid max-w-7xl gap-10 px-4 py-16 sm:px-6 md:grid-cols-3">
        <Column kicker="The brief" title="What the coursework asked">
          <p>
            Project 1 of MAST30034 was an individual quantitative analysis of the New York Taxi &amp;
            Limousine Commission trip records: pick a question, clean a very large real dataset, explore it
            visually and back the answer with a statistical model.
          </p>
          <p>
            I chose 2019 and a practical question:{" "}
            <em>can we tell a passenger how long a yellow-cab ride will take</em>, from where and when it
            starts and what the city is doing that day?
          </p>
        </Column>
        <Column kicker="The build" title="What I built in 2021">
          <p>
            A PySpark notebook that cleaned 84 million rows in four documented rounds, joined NOAA Central
            Park weather, NYC permitted events and NYPD collisions, drew Folium choropleths of every zone and
            fitted an elastic-net linear regression with a hand-written 10-fold cross-validation, because
            Spark&apos;s own CrossValidator would not run on my laptop.
          </p>
          <p>
            This site re-runs those exact rules with DuckDB on TLC&apos;s current files. After the first step
            it lands within 0.003% of every row count the notebook printed.
          </p>
        </Column>
        <Column kicker="The findings" title="What the data said">
          <p>
            Manhattan is the taxi system: {formatPct(h.manhattanShare, 0)} of cleaned trips start and end
            there, and the busiest pickup zone is {h.busiest.zone}. Rides are slowest from{" "}
            {hourLabel(slowest.hr)} (mean {formatFixed(slowest.mean, 1)} min) and quickest from{" "}
            {hourLabel(fastest.hr)} ({formatFixed(fastest.mean, 1)} min).
          </p>
          <p>
            The model kept {nonZero} of 579 features. Airports dominate it: a LaGuardia pickup adds{" "}
            {formatFixed(coef("LaGuardia Airport", "pickup_zone"), 1)} minutes and JFK{" "}
            {formatFixed(coef("JFK Airport", "pickup_zone"), 1)}. Every weather variable was shrunk to zero;
            only collisions (+{formatFixed(coef("number_of_collision", "numeric"), 3)} min each) survived. It
            explains about 37% of the variance, an honest result for a straight-line model.
          </p>
        </Column>
      </section>

      {/* ---------------------------------------------------------- sections */}
      <section className="mx-auto max-w-7xl px-4 sm:px-6" aria-labelledby="explore-heading">
        <div className="flex items-end justify-between gap-4 border-b pb-3">
          <h2 id="explore-heading" className="font-condensed text-4xl font-extrabold uppercase">
            Explore the lines
          </h2>
          <p className="text-muted-foreground hidden text-sm sm:block">Six stops, all running on 2019 data</p>
        </div>
        <ul className="bg-border grid gap-px overflow-hidden rounded-b-lg border border-t-0 sm:grid-cols-2 lg:grid-cols-3">
          {SECTIONS.map((s) => (
            <li key={s.href} className="bg-background">
              <Link href={s.href} className="group hover:bg-card flex h-full gap-4 p-6 transition-colors">
                <LineBullet glyph={s.glyph} color={s.color} className={s.glyph.length > 1 ? "text-xs" : ""} />
                <span>
                  <span className="font-condensed flex items-center gap-1.5 text-2xl font-bold uppercase">
                    {s.title}
                    <ArrowRight
                      className="size-4 opacity-0 transition-opacity group-hover:opacity-100"
                      aria-hidden
                    />
                  </span>
                  <span className="text-muted-foreground mt-1.5 block font-serif text-[15px] leading-snug">
                    {s.text}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      {/* ---------------------------------------------------------- about */}
      <section
        id="about"
        className="mx-auto mt-20 max-w-7xl scroll-mt-20 px-4 sm:px-6"
        aria-labelledby="about-heading"
      >
        <div className="rule-double" />
        <div className="grid gap-10 pt-8 lg:grid-cols-[1fr_1.2fr]">
          <div>
            <p className="kicker text-taxi-text">About this project</p>
            <h2
              id="about-heading"
              className="font-condensed mt-2 text-5xl leading-[0.95] font-extrabold uppercase"
            >
              A 2021 notebook, <br />
              back on the road
            </h2>
            <dl className="mt-6 grid gap-3 text-sm">
              <Fact k="Subject">MAST30034 Applied Data Science</Fact>
              <Fact k="University">The University of Melbourne</Fact>
              <Fact k="When">2021 Semester 2, Project 1 (submitted August 2021)</Fact>
              <Fact k="Team">Individual project by {SITE.author}</Fact>
              <Fact k="Credits">
                Download scripts adapted from MAST30034 tutorial material; the manual cross-validation loop
                adapted from the Anant CaSparkExtension notebook (both noted in the original).
              </Fact>
            </dl>
            <div className="mt-6 flex flex-wrap gap-3">
              <a
                href={SITE.repo}
                className="bg-foreground text-background inline-flex items-center gap-2 rounded-md px-4 py-2 text-sm font-semibold"
              >
                <GithubIcon className="size-4" /> Source on GitHub
              </a>
              <a
                href={repoTree("coursework")}
                className="hover:bg-muted inline-flex items-center rounded-md border px-4 py-2 text-sm font-semibold"
              >
                The original submission
              </a>
            </div>
          </div>
          <div>
            <table className="w-full text-left text-sm">
              <caption className="kicker text-muted-foreground mb-3 text-left">
                Original stack vs revived stack
              </caption>
              <thead>
                <tr className="border-b">
                  <th scope="col" className="py-2 pr-3 font-semibold">
                    Layer
                  </th>
                  <th scope="col" className="py-2 pr-3 font-semibold">
                    2021
                  </th>
                  <th scope="col" className="py-2 font-semibold">
                    2026
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {[
                  [
                    "Trip data",
                    "12 monthly CSVs from TLC's S3 bucket (now gone)",
                    "TLC's 2019 Parquet re-issue on CloudFront",
                  ],
                  [
                    "Engine",
                    "PySpark 3.1.2 on a laptop under WSL, 32 GB driver",
                    "DuckDB in uv scripts: minutes on a laptop, not hours",
                  ],
                  [
                    "Cleaning",
                    "Notebook cells with staged CSVs",
                    "The same rules in SQL, every count logged next to the notebook's",
                  ],
                  [
                    "Maps",
                    "Folium with Stamen tiles (discontinued)",
                    "MapLibre GL with OpenFreeMap tiles and a bundled fallback",
                  ],
                  [
                    "Model",
                    "Spark MLlib elastic net, maxIter 10, manual 10-fold CV",
                    "2021 coefficients scored on the revived folds, plus a converged refit",
                  ],
                  ["Delivery", "A 22 MB notebook", "Next.js 16, a 15 MB read-only SQLite file, Vercel"],
                ].map(([layer, a, b]) => (
                  <tr key={layer}>
                    <th scope="row" className="py-2.5 pr-3 align-top font-medium">
                      {layer}
                    </th>
                    <td className="text-muted-foreground py-2.5 pr-3 align-top">{a}</td>
                    <td className="py-2.5 align-top">{b}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-muted-foreground border-taxi mt-6 border-l-2 pl-4 font-serif text-[15px] leading-relaxed">
              Academic integrity: the 2021 notebook, scripts and figures are preserved unchanged in the
              repository&apos;s <code className="font-mono text-[13px]">coursework/</code> folder for
              reference. The assignment brief and the course-provided material are not reproduced here. If you
              are taking MAST30034, please do your own project.
            </p>
          </div>
        </div>
      </section>
    </>
  );
}

function KeyNumber({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="px-4 py-6 sm:px-6">
      <dt className="kicker text-muted-foreground">{label}</dt>
      <dd className="font-condensed mt-1 text-4xl font-extrabold tabular-nums sm:text-5xl">{value}</dd>
      <dd className="text-muted-foreground mt-0.5 text-xs">{note}</dd>
    </div>
  );
}

function Column({ kicker, title, children }: { kicker: string; title: string; children: React.ReactNode }) {
  return (
    <article>
      <p className="kicker text-taxi-text">{kicker}</p>
      <h2 className="font-condensed mt-1 border-b pb-2 text-3xl font-bold uppercase">{title}</h2>
      <div className="prose-news mt-4">{children}</div>
    </article>
  );
}

function Fact({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[6.5rem_1fr] gap-3 border-b pb-3">
      <dt className="text-muted-foreground">{k}</dt>
      <dd>{children}</dd>
    </div>
  );
}
