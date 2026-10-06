import type { Metadata } from "next";
import Link from "next/link";
import { EvalHarness, type EvalQuestion } from "@/components/ask/eval-harness";
import { PageHeader } from "@/components/page-header";
import { getGoldReferences, getPromptSchema } from "@/server/ask";

export const metadata: Metadata = {
  title: "Evaluate Ask the data",
  description:
    "An evaluation harness for text-to-SQL: 24 questions with reference answers, execution accuracy with Wilson intervals, and paired McNemar comparisons between models and prompts.",
};

export default async function EvalPage() {
  const [refs, schema] = await Promise.all([getGoldReferences(), getPromptSchema()]);
  const questions: EvalQuestion[] = refs.map((r) => ({
    id: r.id,
    question: r.question,
    sql: r.sql,
    ordered: r.ordered,
    difficulty: r.difficulty as EvalQuestion["difficulty"],
    result: r.result,
  }));
  return (
    <>
      <PageHeader kicker="Ask the data · evaluation" title="How often is the model right?">
        <p>
          A language model that writes SQL should be measured, not trusted. This harness asks your chosen
          model the same {questions.length} questions every time, runs its SQL through the same read-only
          guard, and compares the result with a hand-written reference answer. Accuracy comes with a Wilson
          interval, and two runs are compared question by question. Results stay in your browser, and every
          call is in the{" "}
          <Link className="link-taxi" href="/ai-log">
            AI audit log
          </Link>
          .
        </p>
      </PageHeader>
      <div className="mx-auto max-w-7xl px-4 pt-8 sm:px-6">
        <EvalHarness questions={questions} schema={schema} />
      </div>
    </>
  );
}
