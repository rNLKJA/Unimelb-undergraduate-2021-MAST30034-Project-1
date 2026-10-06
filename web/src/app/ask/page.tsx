import type { Metadata } from "next";
import Link from "next/link";
import { AskData } from "@/components/ask/ask-data";
import { Note, PageHeader } from "@/components/page-header";
import { getPromptSchema } from "@/server/ask";

export const metadata: Metadata = {
  title: "Ask the data",
  description:
    "Ask questions about the 2019 taxi aggregates in plain English with your own AI key, or write read-only SQL yourself. Every AI call is labelled and logged in your browser.",
};

export default async function AskPage() {
  const schema = await getPromptSchema();
  return (
    <>
      <PageHeader kicker="Ask the data · optional AI" title="Ask the database a question">
        <p>
          A language model turns your question into one SQL query over the site&apos;s read-only analytics
          database. You see the query before anything runs, and you decide: run it, edit it or discard it.
          Without an API key you can still write SQL yourself.
        </p>
      </PageHeader>
      <div className="mx-auto grid max-w-7xl gap-10 px-4 pt-8 sm:px-6 lg:grid-cols-[minmax(0,1fr)_300px]">
        <AskData schema={schema} />
        <aside className="grid content-start gap-4">
          <Note title="Where your data goes">
            Your question and the table descriptions go from your browser to the AI provider you chose, with
            your key. Only the SQL you choose to run is sent to this site&apos;s server, which checks that it
            is a single read-only query and refuses expensive ones. The key never reaches this site.
          </Note>
          <Note title="Every call is on the record">
            Each AI call is logged in this browser with its input, output, latency, token usage and your
            decision (accepted, edited or rejected). Review or export it in the{" "}
            <Link className="link-taxi" href="/ai-log">
              AI audit log
            </Link>
            .
          </Note>
          <Note title="How often is it right?">
            Measure it yourself: the{" "}
            <Link className="link-taxi" href="/ask/eval">
              evaluation harness
            </Link>{" "}
            runs the model on 24 questions with known answers and reports accuracy with confidence intervals.
          </Note>
          <Note title="Limits">
            The model can be confidently wrong, especially about units, weekday numbering and which table to
            use. Read the explanation and assumptions, and check the result against the{" "}
            <Link className="link-taxi" href="/records">
              records
            </Link>
            . See the{" "}
            <Link className="link-taxi" href="/methods#ai-use">
              AI use statement
            </Link>
            .
          </Note>
        </aside>
      </div>
    </>
  );
}
