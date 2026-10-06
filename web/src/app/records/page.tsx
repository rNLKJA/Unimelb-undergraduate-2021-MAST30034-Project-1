import { Database, Download } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { formatInt } from "@/lib/format";
import { repoPath } from "@/lib/site";
import { listTables } from "@/server/records";

export const metadata: Metadata = {
  title: "Records",
  description:
    "Every table of the read-only analytics database behind the site, with row counts, search and CSV export.",
};

export default async function RecordsPage() {
  const tables = await listTables();
  const total = tables.reduce((s, t) => s + t.rows, 0);
  return (
    <>
      <PageHeader kicker="Records" title="The analytics database">
        <p>
          Every chart on this site reads from one read-only SQLite file,{" "}
          <code className="font-mono text-base">web/data/analytics.db</code>, built by{" "}
          <a href={repoPath("scripts/build_analytics.py")}>scripts/build_analytics.py</a> from the cleaned
          trips, with the evidence and data-quality tables added by{" "}
          <a href={repoPath("scripts/build_evidence_tables.py")}>scripts/build_evidence_tables.py</a>. It
          holds {tables.length} tables and {formatInt(total)} rows of aggregates; no individual trip is
          stored.
        </p>
      </PageHeader>
      <div className="mx-auto max-w-7xl px-4 pt-8 sm:px-6">
        <ul className="bg-border grid gap-px overflow-hidden rounded-lg border md:grid-cols-2">
          {tables.map((t) => (
            <li key={t.name} className="bg-background flex flex-col gap-2 p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="font-condensed text-2xl font-bold uppercase">
                    <Link href={`/records/${t.name}`} className="hover:underline">
                      {t.title}
                    </Link>
                  </h2>
                  <p className="text-muted-foreground font-mono text-xs">
                    <Database className="mr-1 inline size-3" aria-hidden />
                    {t.name} · {formatInt(t.rows)} rows · {t.columns.length} columns
                  </p>
                </div>
                <a
                  href={`/records/${t.name}/csv`}
                  className="hover:bg-muted inline-flex shrink-0 items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium"
                  aria-label={`Download ${t.name} as CSV`}
                >
                  <Download className="size-3.5" aria-hidden /> CSV
                </a>
              </div>
              <p className="font-serif text-[15px] leading-snug">{t.description}</p>
              <p className="text-muted-foreground font-mono text-[11px] leading-relaxed">
                {t.columns.map((c) => c.name).join(" · ")}
              </p>
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}
