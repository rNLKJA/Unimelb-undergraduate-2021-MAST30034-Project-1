import Link from "next/link";
import { NAV, SITE } from "@/lib/site";

export function SiteFooter() {
  return (
    <footer className="mt-24 border-t">
      <div className="checker h-2 opacity-90" aria-hidden />
      <div className="mx-auto grid max-w-7xl gap-10 px-4 py-12 sm:px-6 md:grid-cols-[1.4fr_1fr_1fr]">
        <div className="max-w-md">
          <p className="font-condensed text-2xl font-bold uppercase">NYC Taxi 2019</p>
          <p className="text-muted-foreground mt-2 font-serif text-[15px] leading-relaxed">
            A revival of an individual MAST30034 Applied Data Science project (University of Melbourne, 2021
            Semester 2) by {SITE.author}. Trip data: NYC Taxi &amp; Limousine Commission. Weather: NOAA.
            Events and collisions: NYC Open Data / NYPD. Basemap © OpenStreetMap contributors, tiles by
            OpenFreeMap.
          </p>
        </div>
        <nav aria-label="Footer">
          <p className="kicker text-muted-foreground">Explore</p>
          <ul className="mt-3 grid gap-1.5 text-sm">
            {NAV.map((n) => (
              <li key={n.href}>
                <Link className="link-taxi" href={n.href}>
                  {n.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <div>
          <p className="kicker text-muted-foreground">Source</p>
          <ul className="mt-3 grid gap-1.5 text-sm">
            <li>
              <a className="link-taxi" href={SITE.repo}>
                GitHub repository
              </a>
            </li>
            <li>
              <Link className="link-taxi" href="/#about">
                About this project
              </Link>
            </li>
            <li>
              <Link className="link-taxi" href="/method">
                Cleaning rules and the 2021 model
              </Link>
            </li>
            <li>
              <Link className="link-taxi" href="/data-quality">
                Data-quality report
              </Link>
            </li>
            <li>
              <Link className="link-taxi" href="/methods#decisions">
                Decision records
              </Link>
            </li>
            <li>
              <Link className="link-taxi" href="/methods#model-card">
                Model card
              </Link>
            </li>
            <li>
              <Link className="link-taxi" href="/methods#ai-use">
                AI use statement
              </Link>
            </li>
            <li>
              <Link className="link-taxi" href="/ai-log">
                AI audit log
              </Link>
            </li>
          </ul>
          <p className="text-muted-foreground mt-6 text-xs leading-relaxed">
            The original 2021 notebook is preserved unchanged in the repository for reference. This site shows
            aggregates only and serves no trip-level records. AI features are optional and use your own key.
          </p>
        </div>
      </div>
    </footer>
  );
}
