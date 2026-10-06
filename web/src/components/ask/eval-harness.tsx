"use client";

import { Download, FlaskConical, Loader2, Square, Trash2 } from "lucide-react";
import Link from "next/link";
import { useMemo, useRef, useState, useSyncExternalStore } from "react";
import { AiBadge } from "@/components/ai/ai-badge";
import { openAiSettings } from "@/components/ai/ai-settings";
import { Segmented } from "@/components/controls/segmented";
import { useAiSettings } from "@/hooks/use-ai-settings";
import { auditStore } from "@/lib/ai/audit-log";
import { runAudited } from "@/lib/ai/client";
import { AiError } from "@/lib/ai/errors";
import { activeModel, PROVIDER_LABEL } from "@/lib/ai/models";
import { aiStore } from "@/lib/ai/settings";
import {
  buildSqlRequest,
  PROMPT_VARIANTS,
  SQL_EVAL_FEATURE,
  SqlAnswerSchema,
  type PromptVariant,
  type SchemaTable,
} from "@/lib/ai/sql-assistant";
import {
  compareResults,
  compareRuns,
  estimateCostUsd,
  summariseRun,
  type EvalItemResult,
  type EvalRun,
  type Outcome,
  type ResultTable,
} from "@/lib/ai/sql-eval";
import { toCsv } from "@/lib/csv";
import { downloadText } from "@/lib/download";
import { formatFixed, formatInt, formatP, formatPct } from "@/lib/format";
import { cn } from "@/lib/utils";
import { runSql, SqlRunError } from "./run-sql";

export interface EvalQuestion {
  id: string;
  question: string;
  sql: string;
  ordered: boolean;
  difficulty: "easy" | "medium" | "hard";
  result: ResultTable;
}

const RUNS_KEY = "nyc-taxi-ai-eval-runs";
const RUNS_EVENT = "nyc-taxi-ai-eval-runs-change";
const MAX_RUNS = 12;
const QUESTION_SET = "gold-v1";

let cachedRaw: string | null = null;
let cachedRuns: EvalRun[] = [];
function readRuns(): EvalRun[] {
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(RUNS_KEY);
  } catch {
    raw = null;
  }
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    try {
      cachedRuns = raw ? (JSON.parse(raw) as EvalRun[]) : [];
    } catch {
      cachedRuns = [];
    }
  }
  return cachedRuns;
}
function writeRuns(runs: EvalRun[]) {
  try {
    window.localStorage.setItem(RUNS_KEY, JSON.stringify(runs.slice(0, MAX_RUNS)));
  } catch {
    // storage full or unavailable: the run still shows until the page closes
  }
  window.dispatchEvent(new Event(RUNS_EVENT));
}
const EMPTY: EvalRun[] = [];
function subscribeRuns(cb: () => void) {
  window.addEventListener(RUNS_EVENT, cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener(RUNS_EVENT, cb);
    window.removeEventListener("storage", cb);
  };
}

const OUTCOME_LABEL: Record<Outcome, string> = {
  pass: "Pass",
  wrong_result: "Wrong result",
  not_answerable: "Said unanswerable",
  rejected_by_guard: "Rejected by guard",
  sql_error: "SQL error",
  invalid_output: "Invalid output",
  provider_error: "Provider error",
};

const OUTCOME_CLASS: Record<Outcome, string> = {
  pass: "bg-line-green/15 text-line-green border-line-green/40",
  wrong_result: "bg-line-red/10 text-line-red border-line-red/40",
  not_answerable: "bg-muted text-muted-foreground",
  rejected_by_guard: "bg-line-orange/10 text-line-orange border-line-orange/40",
  sql_error: "bg-line-orange/10 text-line-orange border-line-orange/40",
  invalid_output: "bg-muted text-muted-foreground",
  provider_error: "bg-muted text-muted-foreground",
};

function runLabel(r: EvalRun) {
  return `${r.model} · ${r.variant} · ${new Date(r.startedAt).toLocaleString("en-AU", { dateStyle: "short", timeStyle: "short" })}`;
}

function itemsCsv(run: EvalRun): string {
  return toCsv(
    [
      "run_id",
      "provider",
      "model",
      "variant",
      "question_id",
      "difficulty",
      "outcome",
      "lenient",
      "strict",
      "detail",
      "latency_ms",
      "input_tokens",
      "output_tokens",
      "sql",
      "audit_id",
    ],
    run.items.map((i) => ({
      run_id: run.id,
      provider: run.provider,
      model: run.model,
      variant: run.variant,
      question_id: i.id,
      difficulty: i.difficulty,
      outcome: i.outcome,
      lenient: i.lenient ? 1 : 0,
      strict: i.strict ? 1 : 0,
      detail: i.detail,
      latency_ms: i.latencyMs ?? "",
      input_tokens: i.inputTokens ?? "",
      output_tokens: i.outputTokens ?? "",
      sql: i.sql ?? "",
      audit_id: i.auditId ?? "",
    })),
  );
}

export function EvalHarness({ questions, schema }: { questions: EvalQuestion[]; schema: SchemaTable[] }) {
  const { settings, keyHint } = useAiSettings();
  const hasKey = keyHint[settings.provider] !== null;
  const runs = useSyncExternalStore(subscribeRuns, readRuns, () => EMPTY);
  const [variant, setVariant] = useState<PromptVariant>("described");
  const [live, setLive] = useState<EvalRun | null>(null);
  const [stopped, setStopped] = useState<string | null>(null);
  const stop = useRef(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [pair, setPair] = useState<[string, string] | null>(null);

  const promptChars = useMemo(() => buildSqlRequest("x", schema, variant).system.length, [schema, variant]);
  const model = activeModel(settings);
  const approxInput = Math.round(promptChars / 4) + 40;
  // conservative: assumes no prompt-cache hits
  const estCost = estimateCostUsd(model, approxInput * questions.length, 250 * questions.length);

  async function start() {
    stop.current = false;
    setStopped(null);
    const s = aiStore();
    const st = s.getSettings();
    const key = s.getKey(st.provider);
    const run: EvalRun = {
      id: `run-${Date.now().toString(36)}`,
      startedAt: new Date().toISOString(),
      finishedAt: null,
      provider: st.provider,
      model: activeModel(st),
      variant,
      questionSet: QUESTION_SET,
      items: [],
    };
    setLive({ ...run });
    for (const q of questions) {
      if (stop.current) {
        setStopped("Stopped before the end. The partial run is saved.");
        break;
      }
      const item: EvalItemResult = {
        id: q.id,
        difficulty: q.difficulty,
        outcome: "provider_error",
        lenient: false,
        strict: false,
        detail: "",
        sql: null,
        latencyMs: null,
        inputTokens: null,
        outputTokens: null,
        cachedInputTokens: null,
        auditId: null,
      };
      try {
        const { result, entry } = await runAudited(
          auditStore(),
          SQL_EVAL_FEATURE,
          {
            run_id: run.id,
            question_id: q.id,
            question: q.question,
            prompt_variant: variant,
            question_set: QUESTION_SET,
          },
          st,
          key,
          buildSqlRequest(q.question, schema, variant),
          SqlAnswerSchema,
          { decision: "not_applicable" },
        );
        item.auditId = entry.id;
        item.latencyMs = result.latencyMs;
        item.inputTokens = result.usage?.inputTokens ?? null;
        item.outputTokens = result.usage?.outputTokens ?? null;
        item.cachedInputTokens = result.usage?.cachedInputTokens ?? null;
        item.sql = result.output.answerable ? result.output.sql : null;
        if (!result.output.answerable) {
          item.outcome = "not_answerable";
          item.detail = result.output.explanation;
        } else {
          try {
            const r = await runSql(result.output.sql);
            const c = compareResults(q.result, { columns: r.columns, rows: r.rows }, q.ordered);
            item.lenient = c.lenient;
            item.strict = c.strict;
            item.outcome = c.lenient ? "pass" : "wrong_result";
            item.detail = c.reason;
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            item.outcome =
              e instanceof SqlRunError && /^SQLite/.test(msg) ? "sql_error" : "rejected_by_guard";
            item.detail = msg;
          }
        }
      } catch (e) {
        const err = e instanceof AiError ? e : new AiError("unknown");
        item.outcome = err.kind === "invalid_output" ? "invalid_output" : "provider_error";
        item.detail = err.message;
        if (
          ["no_key", "invalid_key", "permission", "rate_limit", "network", "bad_request"].includes(err.kind)
        ) {
          run.items.push(item);
          setStopped(`Stopped: ${err.message}`);
          break;
        }
      }
      run.items.push(item);
      setLive({ ...run, items: [...run.items] });
    }
    run.finishedAt = new Date().toISOString();
    setLive(null);
    if (run.items.length) {
      writeRuns([run, ...readRuns()]);
      setSelected(run.id);
    }
  }

  const shown = live ?? runs.find((r) => r.id === selected) ?? runs[0] ?? null;
  const summary = shown ? summariseRun(shown.items) : null;
  const comparison = useMemo(() => {
    if (!pair) return null;
    const a = runs.find((r) => r.id === pair[0]);
    const b = runs.find((r) => r.id === pair[1]);
    return a && b ? { a, b, c: compareRuns(a.items, b.items) } : null;
  }, [pair, runs]);

  return (
    <div className="grid gap-10">
      <section aria-labelledby="run-h" className="bg-card overflow-hidden rounded-lg border">
        <div className="checker h-1.5 opacity-80" aria-hidden />
        <div className="grid gap-4 p-5 sm:p-6">
          <h2 id="run-h" className="font-condensed flex items-center gap-2 text-3xl font-bold uppercase">
            <FlaskConical className="text-line-purple size-6" aria-hidden /> Run the evaluation
          </h2>
          <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <div className="grid gap-1.5">
              <span className="kicker text-muted-foreground">Prompt</span>
              <Segmented
                label="Prompt variant"
                value={variant}
                onChange={setVariant}
                options={PROMPT_VARIANTS.map((v) => ({ value: v.value, label: v.label }))}
              />
              <p className="text-muted-foreground text-xs">
                {PROMPT_VARIANTS.find((v) => v.value === variant)!.note} About {formatInt(approxInput)} input
                tokens per question.
              </p>
            </div>
            <div className="grid content-start gap-1.5 text-sm">
              <span className="kicker text-muted-foreground">Model</span>
              <p>
                {hasKey ? (
                  <>
                    {PROVIDER_LABEL[settings.provider]} · <span className="font-mono">{model}</span>{" "}
                    <button type="button" className="link-taxi text-xs" onClick={openAiSettings}>
                      change
                    </button>
                  </>
                ) : (
                  "No key yet."
                )}
              </p>
              <p className="text-muted-foreground text-xs">
                {questions.length} calls, one per question, billed to your key
                {estCost !== null ? `: roughly US$${formatFixed(estCost, 2)} at list prices` : ""}.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {live ? (
              <button
                type="button"
                onClick={() => {
                  stop.current = true;
                }}
                className="hover:bg-muted inline-flex items-center gap-2 rounded-md border px-4 py-2 text-sm font-semibold"
              >
                <Square className="size-4" aria-hidden /> Stop
              </button>
            ) : (
              <button
                type="button"
                onClick={() => (hasKey ? void start() : openAiSettings())}
                className="bg-taxi text-taxi-ink inline-flex items-center gap-2 rounded-md px-4 py-2 text-sm font-semibold"
              >
                <FlaskConical className="size-4" aria-hidden />{" "}
                {hasKey ? `Run ${questions.length} questions` : "Add an API key to run"}
              </button>
            )}
            {live && (
              <span
                className="text-muted-foreground inline-flex items-center gap-2 text-sm"
                aria-live="polite"
              >
                <Loader2 className="size-4 animate-spin" aria-hidden /> Question {live.items.length + 1} of{" "}
                {questions.length}
              </span>
            )}
            {stopped && <span className="text-sm">{stopped}</span>}
          </div>
        </div>
      </section>

      {shown && summary && (
        <section aria-labelledby="results-h" className="grid gap-5">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 id="results-h" className="font-condensed text-3xl font-bold uppercase">
                {live ? "Running…" : "Results"}
              </h2>
              <p className="text-muted-foreground mt-1 text-xs">
                <AiBadge model={shown.model} className="mr-2" />
                {shown.variant} prompt · {shown.items.length} of {questions.length} questions · started{" "}
                {new Date(shown.startedAt).toLocaleString("en-AU")}
              </p>
            </div>
            {!live && (
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="hover:bg-muted inline-flex items-center gap-1 rounded-md border px-2.5 py-1.5 text-xs font-medium"
                  onClick={() => downloadText(`${shown.id}.csv`, itemsCsv(shown), "text/csv;charset=utf-8")}
                >
                  <Download className="size-3.5" aria-hidden /> CSV
                </button>
                <button
                  type="button"
                  className="hover:bg-muted inline-flex items-center gap-1 rounded-md border px-2.5 py-1.5 text-xs font-medium"
                  onClick={() =>
                    downloadText(
                      `${shown.id}.json`,
                      JSON.stringify({ run: shown, summary }, null, 2),
                      "application/json",
                    )
                  }
                >
                  <Download className="size-3.5" aria-hidden /> JSON
                </button>
              </div>
            )}
          </div>
          <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat
              k="Execution accuracy (lenient)"
              v={`${summary.lenient.passes} / ${summary.n}`}
              note={`${formatPct(summary.lenient.estimate, 0)}, Wilson 95% CI ${formatPct(summary.lenient.lower, 0)} to ${formatPct(summary.lenient.upper, 0)}`}
            />
            <Stat
              k="Exact columns too (strict)"
              v={`${summary.strict.passes} / ${summary.n}`}
              note={`${formatPct(summary.strict.estimate, 0)}, Wilson 95% CI ${formatPct(summary.strict.lower, 0)} to ${formatPct(summary.strict.upper, 0)}`}
            />
            <Stat
              k="Median latency"
              v={
                summary.medianLatencyMs === null ? "–" : `${formatFixed(summary.medianLatencyMs / 1000, 1)} s`
              }
              note="per question, model call only"
            />
            <Stat
              k="Tokens"
              v={formatInt(summary.inputTokens + summary.outputTokens)}
              note={`${formatInt(summary.inputTokens)} in (${formatInt(summary.cachedInputTokens)} cached), ${formatInt(summary.outputTokens)} out${
                estimateCostUsd(
                  shown.model,
                  summary.inputTokens,
                  summary.outputTokens,
                  summary.cachedInputTokens,
                ) !== null
                  ? ` · about US$${formatFixed(estimateCostUsd(shown.model, summary.inputTokens, summary.outputTokens, summary.cachedInputTokens)!, 3)}`
                  : ""
              }`}
            />
          </dl>
          <p className="text-muted-foreground text-xs">
            By difficulty:{" "}
            {summary.byDifficulty
              .filter((d) => d.n)
              .map(
                (d) =>
                  `${d.difficulty} ${d.passes}/${d.n} (${formatPct(d.ci.lower, 0)}–${formatPct(d.ci.upper, 0)})`,
              )
              .join(" · ")}
            . Outcomes:{" "}
            {Object.entries(summary.outcomes)
              .filter(([, n]) => n)
              .map(([k, n]) => `${OUTCOME_LABEL[k as Outcome].toLowerCase()} ${n}`)
              .join(", ")}
            . With {summary.n} questions the intervals are wide: treat small differences between runs as
            noise.
          </p>
          <div className="relative overflow-x-auto rounded-lg border">
            <table className="w-full min-w-[760px] text-sm">
              <caption className="sr-only">Per-question results</caption>
              <thead className="bg-card">
                <tr className="text-left">
                  <th scope="col" className="border-b px-3 py-2 font-semibold">
                    #
                  </th>
                  <th scope="col" className="border-b px-3 py-2 font-semibold">
                    Question
                  </th>
                  <th scope="col" className="border-b px-3 py-2 font-semibold">
                    Outcome
                  </th>
                  <th scope="col" className="border-b px-3 py-2 font-semibold">
                    Model SQL (AI-generated)
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {shown.items.map((i) => {
                  const q = questions.find((x) => x.id === i.id);
                  return (
                    <tr key={i.id} className="align-top">
                      <td className="text-muted-foreground px-3 py-2 font-mono text-xs">{i.id}</td>
                      <td className="px-3 py-2">
                        {q?.question}
                        <span className="text-muted-foreground block text-[11px]">{i.difficulty}</span>
                      </td>
                      <td className="px-3 py-2">
                        <span
                          className={cn(
                            "inline-block rounded-full border px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap",
                            OUTCOME_CLASS[i.outcome],
                          )}
                        >
                          {OUTCOME_LABEL[i.outcome]}
                        </span>
                        <span className="text-muted-foreground mt-1 block max-w-[16rem] text-[11px] leading-snug">
                          {i.detail}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        {i.sql ? (
                          <code className="block max-w-[28rem] font-mono text-[11px] break-words whitespace-pre-wrap">
                            {i.sql}
                          </code>
                        ) : (
                          <span className="text-muted-foreground text-xs">none</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {runs.length > 0 && (
        <section aria-labelledby="runs-h" className="grid gap-4">
          <h2 id="runs-h" className="font-condensed text-3xl font-bold uppercase">
            Saved runs and paired comparison
          </h2>
          <p className="text-muted-foreground max-w-3xl font-serif">
            Runs are kept in this browser (up to {MAX_RUNS}). Pick two to compare them question by question:
            the same questions answered by two models or two prompts are paired data, so the test looks only
            at questions where they disagree (exact McNemar), and the accuracy difference gets a paired
            bootstrap interval over questions (B = 4,000, seed 20190101).
          </p>
          <ul className="grid gap-2">
            {runs.map((r) => {
              const s = summariseRun(r.items);
              return (
                <li
                  key={r.id}
                  className="bg-card flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm"
                >
                  <button type="button" className="link-taxi text-left" onClick={() => setSelected(r.id)}>
                    {runLabel(r)}
                  </button>
                  <span className="font-mono text-xs">
                    {s.lenient.passes}/{s.n} ({formatPct(s.lenient.estimate, 0)})
                  </span>
                  <span className="flex gap-1">
                    {(["A", "B"] as const).map((slot, k) => (
                      <button
                        key={slot}
                        type="button"
                        aria-pressed={pair?.[k] === r.id}
                        onClick={() => {
                          const next: [string, string] = pair ? [...pair] : [r.id, r.id];
                          next[k] = r.id;
                          setPair(next);
                        }}
                        className={cn(
                          "rounded border px-2 py-0.5 text-xs",
                          pair?.[k] === r.id && "bg-foreground text-background",
                        )}
                      >
                        {slot}
                      </button>
                    ))}
                    <button
                      type="button"
                      aria-label={`Delete run ${runLabel(r)}`}
                      onClick={() => writeRuns(readRuns().filter((x) => x.id !== r.id))}
                      className="hover:bg-muted rounded border px-1.5"
                    >
                      <Trash2 className="size-3.5" aria-hidden />
                    </button>
                  </span>
                </li>
              );
            })}
          </ul>
          {comparison && comparison.a.id !== comparison.b.id && (
            <div className="bg-card grid gap-3 rounded-lg border p-4">
              <p className="text-sm">
                <strong>A</strong> {runLabel(comparison.a)} vs <strong>B</strong> {runLabel(comparison.b)}, on{" "}
                {comparison.c.n} shared questions.
              </p>
              <dl className="grid gap-3 sm:grid-cols-3">
                <Stat
                  k="Accuracy difference, A − B"
                  v={`${comparison.c.difference.estimate >= 0 ? "+" : "−"}${formatFixed(Math.abs(comparison.c.difference.estimate) * 100, 0)} pts`}
                  note={`paired bootstrap 95% CI ${formatFixed(comparison.c.difference.lower * 100, 0)} to ${formatFixed(comparison.c.difference.upper * 100, 0)} points`}
                />
                <Stat
                  k="Disagreements"
                  v={`${comparison.c.onlyA} vs ${comparison.c.onlyB}`}
                  note={`only A right vs only B right · both right ${comparison.c.bothPass}, neither ${comparison.c.neither}`}
                />
                <Stat
                  k="Exact McNemar test"
                  v={`p ${formatP(comparison.c.mcnemarP)}`}
                  note="two-sided, discordant questions only"
                />
              </dl>
              <button
                type="button"
                className="hover:bg-muted inline-flex w-fit items-center gap-1 rounded-md border px-2.5 py-1.5 text-xs font-medium"
                onClick={() =>
                  downloadText(
                    `comparison-${comparison.a.id}-${comparison.b.id}.json`,
                    JSON.stringify({ a: comparison.a, b: comparison.b, comparison: comparison.c }, null, 2),
                    "application/json",
                  )
                }
              >
                <Download className="size-3.5" aria-hidden /> Export comparison (JSON)
              </button>
            </div>
          )}
        </section>
      )}

      <section aria-labelledby="gold-h">
        <h2 id="gold-h" className="font-condensed text-3xl font-bold uppercase">
          The {questions.length} questions and their reference answers
        </h2>
        <p className="text-muted-foreground mt-1 max-w-3xl font-serif">
          Written by hand before any model was run, each with a reference query checked against the database
          in the test suite. A model passes when its result contains the reference result: columns are matched
          by value, so aliases and extra columns are fine (strict accuracy also requires no extra columns);
          rankings must keep their order, and numbers agree to six significant figures. See the{" "}
          <Link href="/methods#evaluation-design" className="link-taxi">
            evaluation design
          </Link>
          .
        </p>
        <div className="mt-4 grid gap-2">
          {questions.map((q) => (
            <details key={q.id} className="bg-card rounded-md border px-3 py-2">
              <summary className="cursor-pointer text-sm">
                <span className="text-muted-foreground font-mono text-xs">{q.id}</span> {q.question}{" "}
                <span className="text-muted-foreground text-[11px]">({q.difficulty})</span>
              </summary>
              <code className="mt-2 block font-mono text-[12px] break-words whitespace-pre-wrap">
                {q.sql}
              </code>
              <p className="text-muted-foreground mt-1 font-mono text-[12px]">
                →{" "}
                {q.result.rows
                  .slice(0, 7)
                  .map((r) =>
                    r
                      .map((v) =>
                        typeof v === "number" && !Number.isInteger(v) ? Number(v.toPrecision(6)) : v,
                      )
                      .join(", "),
                  )
                  .join(" | ")}
              </p>
            </details>
          ))}
        </div>
      </section>
    </div>
  );
}

function Stat({ k, v, note }: { k: string; v: string; note: string }) {
  return (
    <div className="bg-background rounded-md border px-4 py-3">
      <dt className="text-muted-foreground text-xs">{k}</dt>
      <dd className="font-condensed mt-1 text-3xl font-extrabold tabular-nums">{v}</dd>
      <dd className="text-muted-foreground mt-1 text-[11px] leading-snug">{note}</dd>
    </div>
  );
}
