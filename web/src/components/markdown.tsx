import Link from "next/link";
import type { ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { ScrollRegion } from "@/components/scroll-region";
import { docHref, slugify } from "@/lib/doc-links";
import { markdownTableLabel } from "@/lib/table-label";
import { cn } from "@/lib/utils";

function textOf(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (node && typeof node === "object" && "props" in node)
    return textOf((node as { props: { children?: ReactNode } }).props.children);
  return "";
}

type Heading = "h1" | "h2" | "h3" | "h4" | "h5" | "h6";
const LEVELS: Heading[] = ["h1", "h2", "h3", "h4", "h5", "h6"];

/**
 * Renders the repository's markdown docs in the site's editorial style. Headings get ids
 * (for anchors such as /methods#evaluation-design) and links between docs become routes.
 *
 * `topLevel` is the HTML heading a markdown `#` becomes: h2 where the doc sits on a page with
 * its own h1 (the default, `##` then renders as h3), or h1 where the page has dropped the doc's
 * title and its `##` sections should be h2.
 */
export function Markdown({
  source,
  hideTitle = false,
  idPrefix = "",
  className,
  topLevel = 2,
}: {
  source: string;
  hideTitle?: boolean;
  idPrefix?: string;
  className?: string;
  topLevel?: 1 | 2;
}) {
  const id = (children: ReactNode) => `${idPrefix}${slugify(textOf(children))}`;
  // markdown level n (1-based) renders as heading level topLevel + n - 1
  const tag = (n: number): Heading => LEVELS[Math.min(LEVELS.length - 1, topLevel + n - 2)];
  const H1 = tag(1);
  const H2 = tag(2);
  const H3 = tag(3);
  const components: Components = {
    h1: ({ children }) =>
      hideTitle ? null : (
        <H1
          id={id(children)}
          className="font-condensed scroll-mt-20 border-b pb-2 text-3xl font-bold uppercase sm:text-4xl"
        >
          {children}
        </H1>
      ),
    h2: ({ children }) => (
      <H2 id={id(children)} className="font-condensed mt-8 scroll-mt-20 text-2xl font-bold uppercase">
        {children}
      </H2>
    ),
    h3: ({ children }) => (
      <H3 id={id(children)} className="mt-6 scroll-mt-20 text-lg font-semibold">
        {children}
      </H3>
    ),
    p: ({ children }) => <p className="mt-3 font-serif text-[16.5px] leading-relaxed">{children}</p>,
    ul: ({ children }) => (
      <ul className="mt-3 grid list-disc gap-1.5 pl-5 font-serif text-[16px] leading-relaxed">{children}</ul>
    ),
    ol: ({ children }) => (
      <ol className="mt-3 grid list-decimal gap-1.5 pl-5 font-serif text-[16px] leading-relaxed">
        {children}
      </ol>
    ),
    a: ({ href, children }) => {
      const to = docHref(href ?? "");
      return to.startsWith("/") ? (
        <Link href={to} className="link-taxi">
          {children}
        </Link>
      ) : (
        <a href={to} className="link-taxi" rel="noreferrer">
          {children}
        </a>
      );
    },
    code: ({ children }) => (
      <code className="bg-muted rounded px-1 py-0.5 font-mono text-[0.85em]">{children}</code>
    ),
    table: ({ node, children }) => (
      <ScrollRegion label={markdownTableLabel(node)} className="mt-4">
        <table className="w-full min-w-[560px] text-left text-sm">{children}</table>
      </ScrollRegion>
    ),
    thead: ({ children }) => <thead className="border-b">{children}</thead>,
    tbody: ({ children }) => <tbody className="divide-y">{children}</tbody>,
    th: ({ children, style }) => (
      <th scope="col" className="py-2 pr-3 align-bottom font-semibold" style={style}>
        {children}
      </th>
    ),
    td: ({ children, style }) => (
      <td className="py-2 pr-3 align-top" style={style}>
        {children}
      </td>
    ),
    strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
  };
  return (
    <div className={cn("max-w-4xl", className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {source}
      </ReactMarkdown>
    </div>
  );
}
