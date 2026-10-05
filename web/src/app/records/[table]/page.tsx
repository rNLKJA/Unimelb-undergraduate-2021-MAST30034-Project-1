import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Download } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { formatInt } from "@/lib/format";
import { getTable, queryTable, tableParamsSchema, type TableParams } from "@/server/records";

export async function generateMetadata({ params }: PageProps<"/records/[table]">): Promise<Metadata> {
  const { table } = await params;
  const t = await getTable(table);
  return { title: t ? `${t.title} · Records` : "Records" };
}

function href(table: string, p: Partial<TableParams>) {
  const q = new URLSearchParams();
  if (p.q) q.set("q", p.q);
  if (p.page && p.page > 1) q.set("page", String(p.page));
  if (p.sort) q.set("sort", p.sort);
  if (p.sort && p.dir === "desc") q.set("dir", "desc");
  const s = q.toString();
  return `/records/${table}${s ? `?${s}` : ""}`;
}

export default async function TablePage({ params, searchParams }: PageProps<"/records/[table]">) {
  const { table } = await params;
  const t = await getTable(table);
  if (!t) notFound();
  const sp = await searchParams;
  const flat = Object.fromEntries(Object.entries(sp).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]));
  const p = tableParamsSchema.parse(flat);
  const { rows, total, page, pages } = await queryTable(t, p);
  const csv = `/records/${t.name}/csv${p.q ? `?q=${encodeURIComponent(p.q)}` : ""}`;
  return (
    <div className="mx-auto max-w-7xl px-4 pt-8 sm:px-6">
      <nav aria-label="Breadcrumb" className="text-muted-foreground text-sm">
        <Link href="/records" className="link-taxi">
          Records
        </Link>{" "}
        / <span className="font-mono">{t.name}</span>
      </nav>
      <h1 className="font-condensed mt-2 text-5xl font-extrabold uppercase">{t.title}</h1>
      <p className="text-muted-foreground mt-2 max-w-3xl font-serif">{t.description}</p>

      <div className="mt-6 flex flex-wrap items-end justify-between gap-3">
        <form action={`/records/${t.name}`} method="get" className="flex gap-2" role="search">
          <label htmlFor="q" className="sr-only">
            Search {t.name}
          </label>
          <input
            id="q"
            name="q"
            defaultValue={p.q}
            placeholder="Search any column…"
            className="border-input bg-card h-9 w-64 rounded-md border px-3 text-sm"
          />
          {p.sort && <input type="hidden" name="sort" value={p.sort} />}
          {p.sort && <input type="hidden" name="dir" value={p.dir} />}
          <button
            type="submit"
            className="bg-foreground text-background h-9 rounded-md px-3 text-sm font-semibold"
          >
            Search
          </button>
          {p.q && (
            <Link
              href={href(t.name, { sort: p.sort, dir: p.dir })}
              className="text-muted-foreground self-center text-sm underline"
            >
              Clear
            </Link>
          )}
        </form>
        <div className="flex items-center gap-3 text-sm">
          <span className="text-muted-foreground font-mono text-xs">
            {formatInt(total)} {p.q ? "matching " : ""}rows
          </span>
          <a
            href={csv}
            className="hover:bg-muted inline-flex items-center gap-1 rounded-md border px-2.5 py-1.5 text-xs font-medium"
          >
            <Download className="size-3.5" aria-hidden /> Download CSV
          </a>
        </div>
      </div>

      <div className="mt-4 overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <caption className="sr-only">
            {t.name}, page {page} of {pages}
          </caption>
          <thead className="bg-card">
            <tr>
              {t.columns.map((c) => {
                const active = p.sort === c.name;
                const nextDir = active && p.dir === "asc" ? "desc" : "asc";
                return (
                  <th
                    key={c.name}
                    scope="col"
                    className="border-b px-3 py-2 text-left font-semibold whitespace-nowrap"
                    aria-sort={active ? (p.dir === "asc" ? "ascending" : "descending") : undefined}
                  >
                    <Link
                      href={href(t.name, { q: p.q, sort: c.name, dir: nextDir })}
                      className="inline-flex items-center gap-1 hover:underline"
                    >
                      {c.name}
                      {active &&
                        (p.dir === "asc" ? (
                          <ArrowUp className="size-3" aria-hidden />
                        ) : (
                          <ArrowDown className="size-3" aria-hidden />
                        ))}
                    </Link>
                    <span className="text-muted-foreground block font-mono text-[10px] font-normal">
                      {c.type}
                    </span>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody className="divide-y font-mono text-[12px]">
            {rows.length === 0 && (
              <tr>
                <td
                  colSpan={t.columns.length}
                  className="text-muted-foreground px-3 py-8 text-center font-sans"
                >
                  No rows match &ldquo;{p.q}&rdquo;.
                </td>
              </tr>
            )}
            {rows.map((r, i) => (
              <tr key={i} className="hover:bg-muted/50">
                {t.columns.map((c) => (
                  <td
                    key={c.name}
                    className="max-w-[28rem] truncate px-3 py-1.5 whitespace-nowrap"
                    title={String(r[c.name] ?? "")}
                  >
                    {r[c.name] === null ? (
                      <span className="text-muted-foreground">null</span>
                    ) : (
                      String(r[c.name])
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <nav aria-label="Pagination" className="mt-4 flex items-center justify-between text-sm">
        {page > 1 ? (
          <Link
            href={href(t.name, { ...p, page: page - 1 })}
            className="hover:bg-muted inline-flex items-center gap-1 rounded-md border px-3 py-1.5"
          >
            <ChevronLeft className="size-4" aria-hidden /> Previous
          </Link>
        ) : (
          <span />
        )}
        <span className="text-muted-foreground font-mono text-xs">
          Page {page} of {formatInt(pages)}
        </span>
        {page < pages ? (
          <Link
            href={href(t.name, { ...p, page: page + 1 })}
            className="hover:bg-muted inline-flex items-center gap-1 rounded-md border px-3 py-1.5"
          >
            Next <ChevronRight className="size-4" aria-hidden />
          </Link>
        ) : (
          <span />
        )}
      </nav>
    </div>
  );
}
