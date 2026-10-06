import { ArrowRight } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Markdown } from "@/components/markdown";
import { PageHeader } from "@/components/page-header";
import { repoTree } from "@/lib/site";
import { listDecisions, readDoc } from "@/server/content";

export const metadata: Metadata = {
  title: "Methods and decisions",
  description:
    "Data provenance, methods, evaluation design, assumptions, limitations, decision records, the model card and the AI use statement of the NYC Taxi 2019 revival.",
};

const LINKS = [
  {
    href: "/method",
    title: "Cleaning and the 2021 model",
    text: "Every 2021 rule with both sets of row counts, the rule tester and cross-validation parity.",
  },
  {
    href: "/data-quality",
    title: "Data quality",
    text: "What each rule catches, missing values by month and what the rules let through.",
  },
  {
    href: "/evaluation",
    title: "Evaluation",
    text: "Temporal hold-out, robust standard errors, residual diagnostics and conformal intervals.",
  },
  {
    href: "/effects",
    title: "Rain and events",
    text: "Like-for-like comparisons with intervals, effect sizes and caveats.",
  },
  {
    href: "/ask/eval",
    title: "Text-to-SQL evaluation",
    text: "24 questions with reference answers, accuracy with Wilson intervals, paired comparisons.",
  },
  {
    href: "/ai-log",
    title: "AI audit log",
    text: "Every AI call from this browser, with the human decision, exportable.",
  },
];

export default function MethodsPage() {
  const decisions = listDecisions();
  return (
    <>
      <PageHeader kicker="Methods" title="Methods and decisions">
        <p>
          How the numbers on this site were made, what they assume and where they fall short, with the
          decisions behind them written down. The same documents live in the repository&apos;s{" "}
          <a href={repoTree("docs")}>docs/ folder</a>.
        </p>
      </PageHeader>

      <nav aria-label="Evidence pages" className="mx-auto max-w-7xl px-4 pt-10 sm:px-6">
        <ul className="bg-border grid gap-px overflow-hidden rounded-lg border sm:grid-cols-2 lg:grid-cols-3">
          {LINKS.map((l) => (
            <li key={l.href} className="bg-background">
              <Link
                href={l.href}
                className="group hover:bg-card flex h-full flex-col gap-1 p-5 transition-colors"
              >
                <span className="font-condensed flex items-center gap-1.5 text-xl font-bold uppercase">
                  {l.title}
                  <ArrowRight
                    className="size-4 opacity-0 transition-opacity group-hover:opacity-100"
                    aria-hidden
                  />
                </span>
                <span className="text-muted-foreground font-serif text-[15px] leading-snug">{l.text}</span>
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      <section className="mx-auto max-w-7xl scroll-mt-20 px-4 pt-14 sm:px-6" id="methods">
        <Markdown source={readDoc("methods")} />
      </section>

      <section
        id="decisions"
        aria-labelledby="decisions-h"
        className="mx-auto max-w-7xl scroll-mt-20 px-4 pt-14 sm:px-6"
      >
        <h2
          id="decisions-h"
          className="font-condensed border-b pb-2 text-3xl font-bold uppercase sm:text-4xl"
        >
          Decision records
        </h2>
        <p className="text-muted-foreground mt-3 max-w-3xl font-serif text-[16px]">
          Each record gives the context, the decision, the options considered, why, what happened (weak
          numbers included) and what I would change. Past records are never edited. A changed decision gets a
          new record that supersedes the old one.
        </p>
        <ol className="mt-6 grid gap-3 md:grid-cols-2">
          {decisions.map((d) => (
            <li key={d.slug}>
              <Link
                href={`/methods/decisions/${d.slug}`}
                className="bg-card hover:border-foreground/40 flex h-full flex-col gap-2 rounded-lg border p-5 transition-colors"
              >
                <span className="kicker text-taxi-text">
                  {d.id} · {d.status} · {d.date}
                </span>
                <span className="font-condensed text-2xl leading-tight font-bold uppercase">{d.title}</span>
                <span className="text-muted-foreground font-serif text-[15px] leading-snug">
                  {d.decision}
                </span>
              </Link>
            </li>
          ))}
        </ol>
      </section>

      <section id="model-card" className="mx-auto max-w-7xl scroll-mt-20 px-4 pt-14 sm:px-6">
        <Markdown source={readDoc("model-card")} idPrefix="mc-" />
      </section>

      <section id="ai-use" className="mx-auto max-w-7xl scroll-mt-20 px-4 pt-14 sm:px-6">
        <Markdown source={readDoc("ai-use-statement")} idPrefix="ai-" />
      </section>
    </>
  );
}
