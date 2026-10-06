import Link from "next/link";
import type { ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { docHref, slugify } from "@/lib/doc-links";
import { cn } from "@/lib/utils";

function textOf(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (node && typeof node === "object" && "props" in node)
    return textOf((node as { props: { children?: ReactNode } }).props.children);
  return "";
}

/**
 * Renders the repository's markdown docs in the site's editorial style. Headings get ids
 * (for anchors such as /methods#evaluation-design) and links between docs become routes.
 */
export function Markdown({
  source,
  hideTitle = false,
  idPrefix = "",
  className,
}: {
  source: string;
  hideTitle?: boolean;
  idPrefix?: string;
  className?: string;
}) {
  const id = (children: ReactNode) => `${idPrefix}${slugify(textOf(children))}`;
  const components: Components = {
    h1: ({ children }) =>
      hideTitle ? null : (
        <h2
          id={id(children)}
          className="font-condensed scroll-mt-20 border-b pb-2 text-3xl font-bold uppercase sm:text-4xl"
        >
          {children}
        </h2>
      ),
    h2: ({ children }) => (
      <h3 id={id(children)} className="font-condensed mt-8 scroll-mt-20 text-2xl font-bold uppercase">
        {children}
      </h3>
    ),
    h3: ({ children }) => (
      <h4 id={id(children)} className="mt-6 scroll-mt-20 text-lg font-semibold">
        {children}
      </h4>
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
    table: ({ children }) => (
      <div className="relative mt-4 overflow-x-auto">
        <table className="w-full min-w-[560px] text-left text-sm">{children}</table>
      </div>
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
