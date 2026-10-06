import { ArrowRight, Clapperboard } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader, Section } from "@/components/page-header";
import { LazyVideo } from "@/components/tour/lazy-video";
import { ScreenshotGallery } from "@/components/tour/screenshot-gallery";
import { MOCK_PREFIX, SCREENSHOTS, WALKTHROUGHS, type Walkthrough, walkthroughMedia } from "@/lib/showcase";
import { repoPath } from "@/lib/site";

export const metadata: Metadata = {
  title: "Guided tour",
  description:
    "Three short captioned walkthroughs (the zone map by hour and weekday, a trip estimate with a conformal prediction interval, rain and event effects with the data-quality report) and screenshots of every key feature.",
};

export default function TourPage() {
  return (
    <>
      <PageHeader kicker="Guided tour" title="The project in three short rides">
        <p>
          Each video follows one workflow from start to finish, with the step shown on screen and as captions.
          A Playwright script recorded them from this site and checked every figure it shows on the way (the
          hourly pickup totals, JFK&apos;s median trip at two hours, the prediction and its interval, the rain
          and event effects with their confidence intervals, the data-quality counts), so a broken feature
          fails the recording instead of producing a misleading video.
        </p>
        <nav aria-label="Walkthroughs" className="mt-4 flex flex-wrap gap-x-5 gap-y-1.5 font-sans text-base">
          {WALKTHROUGHS.map((w, i) => (
            <a key={w.id} href={`#${w.id}`} className="link-taxi">
              {i + 1}. {w.title}
            </a>
          ))}
          <a href="#screenshots" className="link-taxi">
            Screenshots
          </a>
        </nav>
      </PageHeader>

      {WALKTHROUGHS.map((w, i) => (
        <WalkthroughSection key={w.id} walkthrough={w} index={i} />
      ))}

      <Section
        id="screenshots"
        kicker="Screenshots"
        title="Every key feature at a glance"
        intro={
          <p>
            Captured by the same script in light mode at 1440 × 900 (the landing page also in dark mode) and
            on a 390 px phone. Select one to enlarge it; the arrow keys step through the set and Escape closes
            it.
          </p>
        }
      >
        <ScreenshotGallery items={SCREENSHOTS} />
      </Section>

      <section aria-labelledby="how-made" className="mx-auto max-w-7xl px-4 pt-14 sm:px-6">
        <div className="bg-card grid gap-4 rounded-lg border p-5 sm:p-6 md:grid-cols-[auto_1fr]">
          <Clapperboard className="text-taxi-text size-6" aria-hidden />
          <div className="grid gap-2">
            <h2 id="how-made" className="font-condensed text-2xl font-bold uppercase">
              How these were made
            </h2>
            <p className="text-muted-foreground font-serif text-[15px] leading-relaxed">
              <code className="font-mono text-[13px]">pnpm showcase</code> runs{" "}
              <a href={repoPath("web/e2e/showcase.spec.ts")} className="link-taxi">
                web/e2e/showcase.spec.ts
              </a>{" "}
              on the system Chrome. It plays each journey at a human pace with an on-screen caption and a
              visible cursor, asserts what it shows, and records it at 1280 × 800; ffmpeg then encodes the
              H.264 videos on this page and the GIFs in the README. The captions, the step lists here and the
              README walkthrough are the same text. Every figure is either a full count over the 2019 trips or
              uses the site&apos;s fixed bootstrap seed, so a re-run shows the same numbers.
            </p>
            <p className="text-muted-foreground font-serif text-[15px] leading-relaxed">
              The walkthroughs use no AI. The two &ldquo;Ask the data&rdquo; screenshots use no real API key
              either: the key is a placeholder, every request to the provider is intercepted in the browser,
              and the reply is a labelled mock whose text starts with &ldquo;{MOCK_PREFIX}&rdquo; and whose
              model is reported as a mock. The SQL it proposes still goes through this site&apos;s real
              validator and runs on the real read-only database once a person accepts it.
            </p>
          </div>
        </div>
      </section>
    </>
  );
}

function WalkthroughSection({ walkthrough: w, index }: { walkthrough: Walkthrough; index: number }) {
  const media = walkthroughMedia(w.id);
  const stepsId = `${w.id}-steps`;
  return (
    <Section
      id={w.id}
      kicker={`Walkthrough ${index + 1} of ${WALKTHROUGHS.length} · ${w.routes.join(" → ")}`}
      title={w.title}
      intro={<p>{w.summary}</p>}
    >
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_340px]">
        <figure className="grid min-w-0 content-start gap-3">
          <LazyVideo
            src={media.mp4}
            poster={media.poster}
            captions={media.captions}
            label={`${w.title}: a ${w.steps.length}-step walkthrough with captions`}
            width={1280}
            height={800}
          />
          <figcaption className="text-muted-foreground flex flex-wrap items-start gap-x-4 gap-y-1 text-xs leading-relaxed">
            <span className="min-w-0 flex-1">
              <span className="text-foreground font-medium">Setup:</span> {w.setup}
            </span>
            <a href={media.mp4} className="link-taxi">
              Open the MP4
            </a>
          </figcaption>
        </figure>

        <div className="grid content-start gap-4">
          <h3 id={stepsId} className="font-condensed text-2xl font-bold uppercase">
            Steps{" "}
            <span className="text-muted-foreground font-sans text-sm font-normal normal-case">
              (transcript)
            </span>
          </h3>
          <ol aria-labelledby={stepsId} className="grid gap-2">
            {w.steps.map((s, k) => (
              <li key={s} className="flex gap-3 text-sm">
                <span className="bg-taxi text-taxi-ink flex h-6 min-w-6 shrink-0 items-center justify-center rounded-md px-1 font-mono text-xs font-semibold">
                  {k + 1}
                </span>
                <span className="pt-0.5 leading-relaxed">{s}</span>
              </li>
            ))}
          </ol>
          <Link
            href={w.routes[0]}
            className="hover:bg-muted inline-flex w-fit items-center gap-2 rounded-md border px-4 py-2 text-sm font-semibold"
          >
            Try it yourself <ArrowRight className="size-4" aria-hidden />
          </Link>
        </div>
      </div>
    </Section>
  );
}
