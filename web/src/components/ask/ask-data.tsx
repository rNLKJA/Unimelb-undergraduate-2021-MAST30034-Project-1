"use client";

import { AlertTriangle, Check, Download, Loader2, Pencil, Play, Sparkles, X } from "lucide-react";
import Link from "next/link";
import { useId, useState } from "react";
import { AiBadge } from "@/components/ai/ai-badge";
import { openAiSettings } from "@/components/ai/ai-settings";
import { useAiSettings } from "@/hooks/use-ai-settings";
import { auditStore } from "@/lib/ai/audit-log";
import { runAudited } from "@/lib/ai/client";
import { AiError } from "@/lib/ai/errors";
import { activeModel, PROVIDER_LABEL } from "@/lib/ai/models";
import { aiStore } from "@/lib/ai/settings";
import {
  buildSqlRequest,
  SQL_FEATURE,
  SqlAnswerSchema,
  type SchemaTable,
  type SqlAnswer,
} from "@/lib/ai/sql-assistant";
import { toCsv } from "@/lib/csv";
import { downloadText } from "@/lib/download";
import { formatInt } from "@/lib/format";
import { cn } from "@/lib/utils";
import { runSql, type SqlResult } from "./run-sql";

const EXAMPLES = [
  "Which ten routes between different zones had the most trips?",
  "How did the median trip time change from month to month?",
  "Which borough had the most collisions in July 2019?",
  "On how many days of 2019 did it rain at least half an inch?",
  "Which hour has the slowest trips out of Midtown Center on weekdays?",
];

const STARTER_SQL = `-- Any read-only SQLite query over the tables below
SELECT z.zone, z.borough, z.pickups
FROM zones z
ORDER BY z.pickups DESC
LIMIT 10`;

interface Proposal {
  question: string;
  answer: SqlAnswer;
  model: string;
  entryId: string;
  latencyMs: number;
}

export function AskData({ schema }: { schema: SchemaTable[] }) {
  const { settings, keyHint } = useAiSettings();
  const hasKey = keyHint[settings.provider] !== null;
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState<"ai" | "sql" | null>(null);
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [draft, setDraft] = useState("");
  const [decision, setDecision] = useState<"accepted" | "edited" | "rejected" | null>(null);
  const [aiError, setAiError] = useState<AiError | null>(null);
  const [manual, setManual] = useState(STARTER_SQL);
  const [result, setResult] = useState<SqlResult | null>(null);
  const [sqlError, setSqlError] = useState<string | null>(null);
  const qId = useId();
  const draftId = useId();
  const manualId = useId();

  async function ask() {
    const q = question.trim();
    if (!q) return;
    setBusy("ai");
    setAiError(null);
    setProposal(null);
    setResult(null);
    setSqlError(null);
    setDecision(null);
    try {
      const s = aiStore();
      const settingsNow = s.getSettings();
      const { result: r, entry } = await runAudited(
        auditStore(),
        SQL_FEATURE,
        { question: q, prompt_variant: "described", tables_in_prompt: schema.length },
        settingsNow,
        s.getKey(settingsNow.provider),
        buildSqlRequest(q, schema, "described"),
        SqlAnswerSchema,
      );
      setProposal({
        question: q,
        answer: r.output,
        model: r.model,
        entryId: entry.id,
        latencyMs: r.latencyMs,
      });
      setDraft(r.output.sql);
    } catch (e) {
      setAiError(e instanceof AiError ? e : new AiError("unknown"));
    } finally {
      setBusy(null);
    }
  }

  async function execute(sql: string) {
    setBusy("sql");
    setSqlError(null);
    setResult(null);
    try {
      setResult(await runSql(sql));
    } catch (e) {
      setSqlError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function runProposal() {
    if (!proposal) return;
    const edited = draft.trim() !== proposal.answer.sql.trim();
    const d = edited ? "edited" : "accepted";
    setDecision(d);
    await auditStore().setDecision(proposal.entryId, d, edited ? { sql: draft } : undefined);
    await execute(draft);
  }

  async function reject() {
    if (!proposal) return;
    setDecision("rejected");
    await auditStore().setDecision(proposal.entryId, "rejected");
  }

  return (
    <div className="grid gap-10">
      {/* ------------------------------------------------------------ AI question */}
      <section aria-labelledby="ask-h" className="bg-card overflow-hidden rounded-lg border">
        <div className="checker h-1.5 opacity-80" aria-hidden />
        <div className="grid gap-4 p-5 sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 id="ask-h" className="font-condensed flex items-center gap-2 text-3xl font-bold uppercase">
              <Sparkles className="text-line-purple size-6" aria-hidden /> Ask in plain English
            </h2>
            <p className="text-muted-foreground text-xs">
              {hasKey ? (
                <>
                  {PROVIDER_LABEL[settings.provider]} ·{" "}
                  <span className="font-mono">{activeModel(settings)}</span> ·{" "}
                  <button type="button" onClick={openAiSettings} className="link-taxi">
                    change
                  </button>
                </>
              ) : (
                "Optional: needs your own API key"
              )}
            </p>
          </div>
          <form
            className="grid gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (hasKey) void ask();
              else openAiSettings();
            }}
          >
            <label htmlFor={qId} className="sr-only">
              Your question about the 2019 taxi data
            </label>
            <textarea
              id={qId}
              rows={2}
              maxLength={500}
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) e.currentTarget.form?.requestSubmit();
              }}
              placeholder="e.g. Which pickup zones have the slowest trips at 5 pm?"
              className="border-input bg-background w-full rounded-md border px-3 py-2 text-base"
            />
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="submit"
                disabled={busy !== null || (hasKey && !question.trim())}
                className="bg-taxi text-taxi-ink inline-flex items-center gap-2 rounded-md px-4 py-2 text-sm font-semibold disabled:opacity-50"
              >
                {busy === "ai" ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                ) : (
                  <Sparkles className="size-4" aria-hidden />
                )}
                {hasKey ? (busy === "ai" ? "Writing SQL…" : "Write the SQL") : "Add an API key to ask"}
              </button>
              <span className="text-muted-foreground text-xs">Examples:</span>
              {EXAMPLES.map((ex) => (
                <button
                  key={ex}
                  type="button"
                  onClick={() => setQuestion(ex)}
                  className="hover:bg-muted rounded-full border px-2.5 py-1 text-xs"
                >
                  {ex}
                </button>
              ))}
            </div>
          </form>

          {aiError && (
            <p
              role="alert"
              className="border-destructive/40 bg-destructive/5 flex gap-2 rounded-md border px-3 py-2 text-sm"
            >
              <AlertTriangle className="text-destructive mt-0.5 size-4 shrink-0" aria-hidden />
              <span>
                {aiError.message}
                {aiError.detail && (
                  <span className="text-muted-foreground block text-xs">{aiError.detail}</span>
                )}
                {(aiError.kind === "invalid_key" ||
                  aiError.kind === "no_key" ||
                  aiError.kind === "permission") && (
                  <button type="button" onClick={openAiSettings} className="link-taxi mt-1 block text-xs">
                    Open AI settings
                  </button>
                )}
              </span>
            </p>
          )}

          {proposal && (
            <div className="grid gap-3 rounded-md border border-dashed p-4" aria-live="polite">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <AiBadge model={proposal.model} />
                <span className="text-muted-foreground font-mono text-[11px]">
                  {formatInt(proposal.latencyMs)} ms · logged in the{" "}
                  <Link href="/ai-log" className="link-taxi">
                    AI audit log
                  </Link>
                </span>
              </div>
              <p className="font-serif text-[15px]">{proposal.answer.explanation}</p>
              {proposal.answer.assumptions.length > 0 && (
                <ul className="text-muted-foreground list-disc pl-5 text-sm">
                  {proposal.answer.assumptions.map((a) => (
                    <li key={a}>{a}</li>
                  ))}
                </ul>
              )}
              {proposal.answer.answerable ? (
                <>
                  <label htmlFor={draftId} className="kicker text-muted-foreground">
                    Proposed SQL: review or edit before running
                  </label>
                  <textarea
                    id={draftId}
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    rows={Math.min(14, Math.max(4, draft.split("\n").length + 1))}
                    spellCheck={false}
                    className="border-input bg-background w-full rounded-md border px-3 py-2 font-mono text-[13px]"
                  />
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => void runProposal()}
                      disabled={busy !== null || !draft.trim() || decision === "rejected"}
                      className="bg-foreground text-background inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-semibold disabled:opacity-50"
                    >
                      {draft.trim() !== proposal.answer.sql.trim() ? (
                        <Pencil className="size-4" aria-hidden />
                      ) : (
                        <Play className="size-4" aria-hidden />
                      )}
                      {draft.trim() !== proposal.answer.sql.trim() ? "Run my edited query" : "Run this query"}
                    </button>
                    <button
                      type="button"
                      onClick={() => void reject()}
                      // once a query has run, discarding it would contradict the audit trail
                      disabled={busy !== null || decision !== null}
                      className="hover:bg-muted inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm disabled:opacity-50"
                    >
                      <X className="size-4" aria-hidden /> Discard
                    </button>
                    {decision && <DecisionNote decision={decision} />}
                  </div>
                </>
              ) : (
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm">The model judged this question unanswerable from these tables.</p>
                  <button
                    type="button"
                    onClick={() => void reject()}
                    disabled={decision === "rejected"}
                    className="hover:bg-muted rounded-md border px-3 py-1.5 text-sm disabled:opacity-50"
                  >
                    Dismiss
                  </button>
                  {decision && <DecisionNote decision={decision} />}
                </div>
              )}
            </div>
          )}
        </div>
      </section>

      {/* ------------------------------------------------------------ manual SQL */}
      <section aria-labelledby="manual-h" className="grid gap-3">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <h2 id="manual-h" className="font-condensed text-3xl font-bold uppercase">
            Or write SQL yourself
          </h2>
          <p className="text-muted-foreground text-xs">
            No key needed. Read-only, one statement, at most 500 rows.
          </p>
        </div>
        <label htmlFor={manualId} className="sr-only">
          SQL query
        </label>
        <textarea
          id={manualId}
          value={manual}
          onChange={(e) => setManual(e.target.value)}
          rows={7}
          spellCheck={false}
          className="border-input bg-card w-full rounded-md border px-3 py-2 font-mono text-[13px]"
        />
        <div>
          <button
            type="button"
            onClick={() => void execute(manual)}
            disabled={busy !== null || !manual.trim()}
            className="bg-foreground text-background inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-semibold disabled:opacity-50"
          >
            {busy === "sql" ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : (
              <Play className="size-4" aria-hidden />
            )}{" "}
            Run SQL
          </button>
        </div>
      </section>

      {/* ------------------------------------------------------------ results */}
      <section aria-labelledby="result-h" aria-live="polite" className="grid gap-3">
        <h2 id="result-h" className="kicker text-muted-foreground">
          Result
        </h2>
        {sqlError && (
          <p
            role="alert"
            className="border-destructive/40 bg-destructive/5 flex gap-2 rounded-md border px-3 py-2 text-sm"
          >
            <AlertTriangle className="text-destructive mt-0.5 size-4 shrink-0" aria-hidden />
            {sqlError}
          </p>
        )}
        {busy === "sql" && <p className="text-muted-foreground text-sm">Running…</p>}
        {!result && !sqlError && busy !== "sql" && (
          <p className="text-muted-foreground text-sm">Run a query to see rows here.</p>
        )}
        {result && <ResultTable result={result} />}
      </section>

      <SchemaBrowser schema={schema} />
    </div>
  );
}

function DecisionNote({ decision }: { decision: "accepted" | "edited" | "rejected" }) {
  const text = {
    accepted: "Recorded: accepted as proposed",
    edited: "Recorded: edited before running",
    rejected: "Recorded: rejected",
  }[decision];
  return (
    <span className="text-muted-foreground inline-flex items-center gap-1 text-xs">
      <Check className="size-3.5" aria-hidden /> {text}
    </span>
  );
}

export function ResultTable({ result }: { result: SqlResult }) {
  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <span className="text-muted-foreground font-mono">
          {formatInt(result.rows.length)} row{result.rows.length === 1 ? "" : "s"}
          {result.truncated ? " (first 500 shown)" : ""}
          {result.shortenedCells
            ? ` · ${formatInt(result.shortenedCells)} long text value${result.shortenedCells === 1 ? "" : "s"} shortened`
            : ""}{" "}
          · {formatInt(result.elapsedMs)} ms · plan estimate {formatInt(result.estimatedRows)} rows visited
        </span>
        <button
          type="button"
          onClick={() =>
            downloadText(
              "query-result.csv",
              toCsv(
                result.columns,
                result.rows.map((r) => Object.fromEntries(result.columns.map((c, i) => [c, r[i]]))),
              ),
              "text/csv;charset=utf-8",
            )
          }
          className="hover:bg-muted inline-flex items-center gap-1 rounded-md border px-2 py-1 font-medium"
        >
          <Download className="size-3.5" aria-hidden /> CSV
        </button>
      </div>
      <div className="relative max-h-[28rem] overflow-auto rounded-lg border">
        <table className="w-full text-sm">
          <caption className="sr-only">Query result</caption>
          <thead className="bg-card sticky top-0">
            <tr>
              {result.columns.map((c, i) => (
                <th
                  key={`${c}-${i}`}
                  scope="col"
                  className="border-b px-3 py-2 text-left font-semibold whitespace-nowrap"
                >
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y font-mono text-[13px]">
            {result.rows.map((r, i) => (
              <tr key={i}>
                {r.map((v, j) => (
                  <td
                    key={j}
                    className={cn(
                      "px-3 py-1.5 whitespace-nowrap",
                      typeof v === "number" && "text-right tabular-nums",
                    )}
                  >
                    {v === null ? (
                      <span className="text-muted-foreground">null</span>
                    ) : typeof v === "number" ? (
                      formatCell(v)
                    ) : (
                      v
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function formatCell(v: number): string {
  return Number.isInteger(v) ? String(v) : Number(v.toPrecision(8)).toString();
}

function SchemaBrowser({ schema }: { schema: SchemaTable[] }) {
  return (
    <section aria-labelledby="schema-h">
      <h2 id="schema-h" className="font-condensed text-3xl font-bold uppercase">
        The tables
      </h2>
      <p className="text-muted-foreground mt-1 max-w-3xl font-serif">
        {schema.length} tables of aggregates (no individual trips). The model sees exactly this description.
        Click a name to browse the table.
      </p>
      <div className="mt-4 grid gap-2 md:grid-cols-2">
        {schema.map((t) => (
          <details key={t.name} className="bg-card rounded-md border px-3 py-2">
            <summary className="cursor-pointer">
              <span className="font-mono text-sm font-semibold">{t.name}</span>{" "}
              <span className="text-muted-foreground text-xs">
                {t.title} · {formatInt(t.rows)} rows
              </span>
            </summary>
            <p className="text-muted-foreground mt-2 font-serif text-[14px] leading-snug">{t.description}</p>
            <ul className="mt-2 grid gap-0.5 font-mono text-[12px]">
              {t.columns.map((c) => (
                <li key={c.name}>
                  {c.name} <span className="text-muted-foreground">{c.type}</span>
                  {c.values && <span className="text-muted-foreground"> · {c.values.join(", ")}</span>}
                </li>
              ))}
            </ul>
            <Link href={`/records/${t.name}`} className="link-taxi mt-2 inline-block text-xs">
              Browse {t.name}
            </Link>
          </details>
        ))}
      </div>
    </section>
  );
}
