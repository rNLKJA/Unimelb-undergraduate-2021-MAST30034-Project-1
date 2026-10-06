import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Markdown } from "@/components/markdown";
import { repoPath } from "@/lib/site";
import { getDecision, listDecisions } from "@/server/content";

export const dynamicParams = false;

export function generateStaticParams() {
  return listDecisions().map((d) => ({ slug: d.slug }));
}

export async function generateMetadata({
  params,
}: PageProps<"/methods/decisions/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const d = getDecision(slug);
  return d ? { title: `${d.id}: ${d.title}`, description: d.decision } : { title: "Decision record" };
}

export default async function DecisionPage({ params }: PageProps<"/methods/decisions/[slug]">) {
  const { slug } = await params;
  const d = getDecision(slug);
  if (!d) notFound();
  const all = listDecisions();
  const i = all.findIndex((x) => x.slug === slug);
  const body = d.body.replace(/^# .+\n/, "").replace(/^- \*\*(Status|Date|Decision):\*\* .+\n/gm, "");
  return (
    <article className="mx-auto max-w-7xl px-4 pt-8 sm:px-6">
      <nav aria-label="Breadcrumb" className="text-muted-foreground text-sm">
        <Link href="/methods" className="link-taxi">
          Methods
        </Link>{" "}
        /{" "}
        <Link href="/methods#decisions" className="link-taxi">
          Decision records
        </Link>{" "}
        / <span className="font-mono">{d.id}</span>
      </nav>
      <p className="kicker text-taxi-text mt-6">
        {d.id} · {d.status} · {d.date}
      </p>
      <h1 className="font-condensed mt-2 max-w-5xl text-5xl leading-[0.95] font-extrabold uppercase sm:text-6xl">
        {d.title}
      </h1>
      <aside className="bg-card border-taxi mt-6 max-w-4xl rounded-r-md border-l-4 px-4 py-3">
        <p className="kicker text-muted-foreground">Decision</p>
        <p className="mt-1 font-serif text-[17px] leading-relaxed">{d.decision}</p>
      </aside>
      <div className="rule-double mt-8" />
      <Markdown source={body} className="mt-2" />
      <nav
        aria-label="Other decision records"
        className="mt-12 flex max-w-4xl flex-wrap justify-between gap-4 border-t pt-4 text-sm"
      >
        {i > 0 ? (
          <Link href={`/methods/decisions/${all[i - 1].slug}`} className="link-taxi">
            ← {all[i - 1].id}: {all[i - 1].title}
          </Link>
        ) : (
          <span />
        )}
        {i < all.length - 1 && (
          <Link href={`/methods/decisions/${all[i + 1].slug}`} className="link-taxi text-right">
            {all[i + 1].id}: {all[i + 1].title} →
          </Link>
        )}
      </nav>
      <p className="text-muted-foreground mt-6 text-xs">
        Source:{" "}
        <a className="link-taxi" href={repoPath(`docs/decisions/${d.slug}.md`)}>
          docs/decisions/{d.slug}.md
        </a>
      </p>
    </article>
  );
}
