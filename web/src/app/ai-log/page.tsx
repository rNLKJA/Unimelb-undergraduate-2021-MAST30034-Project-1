import type { Metadata } from "next";
import Link from "next/link";
import { AiLog } from "@/components/ai/ai-log";
import { PageHeader } from "@/components/page-header";

export const metadata: Metadata = {
  title: "AI audit log",
  description:
    "Every AI call made on this site from this browser: input, output, model, latency, tokens and the human decision, exportable as JSON or CSV.",
};

export default function AiLogPage() {
  return (
    <>
      <PageHeader kicker="Transparency" title="AI audit log">
        <p>
          Every call to a language model made on this site from this browser, newest first: your question and
          the prompt settings (never the key), what came back, which model answered, how long it took, the
          tokens used and every decision you made about it, in order. The log lives in this browser&apos;s
          IndexedDB, and this site has no server-side copy. See the{" "}
          <Link className="link-taxi" href="/methods#ai-use">
            AI use statement
          </Link>
          .
        </p>
      </PageHeader>
      <div className="mx-auto max-w-7xl px-4 pt-8 sm:px-6">
        <AiLog />
      </div>
    </>
  );
}
