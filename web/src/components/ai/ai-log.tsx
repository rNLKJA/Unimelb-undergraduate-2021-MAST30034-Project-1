"use client";

import { Download, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { auditToCsv, auditToJson } from "@/lib/ai/audit-export";
import { AUDIT_EVENT, auditStore } from "@/lib/ai/audit-log";
import type { AuditEntry, HumanDecision } from "@/lib/ai/types";
import { downloadText } from "@/lib/download";
import { formatInt, formatPct } from "@/lib/format";
import { wilsonInterval } from "@/lib/stats/wilson";
import { cn } from "@/lib/utils";
import { AiBadge } from "./ai-badge";
import { ScrollRegion } from "@/components/scroll-region";

const DECISION_LABEL: Record<HumanDecision, string> = {
  pending: "Pending",
  accepted: "Accepted",
  edited: "Edited",
  rejected: "Rejected",
  no_output: "No output",
  not_applicable: "n/a",
};

const DECISION_CLASS: Record<HumanDecision, string> = {
  pending: "bg-muted text-muted-foreground",
  accepted: "bg-line-green/15 text-line-green border-line-green/40",
  edited: "bg-line-blue/10 text-line-blue border-line-blue/40",
  rejected: "bg-line-red/10 text-line-red border-line-red/40",
  no_output: "bg-muted text-muted-foreground",
  not_applicable: "bg-muted text-muted-foreground",
};

export function AiLog() {
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [feature, setFeature] = useState("all");
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const load = () =>
      auditStore()
        .list()
        .then((e) => alive && setEntries(e))
        .catch(
          () =>
            alive &&
            setError(
              "This browser does not allow IndexedDB here (private mode?), so no AI calls can be logged or shown.",
            ),
        );
    load();
    window.addEventListener(AUDIT_EVENT, load);
    return () => {
      alive = false;
      window.removeEventListener(AUDIT_EVENT, load);
    };
  }, []);

  if (error) return <p className="bg-card rounded-md border px-4 py-3 text-sm">{error}</p>;
  if (!entries) return <p className="text-muted-foreground text-sm">Loading the log…</p>;

  const features = [...new Set(entries.map((e) => e.feature))].sort();
  const shown = feature === "all" ? entries : entries.filter((e) => e.feature === feature);
  const decided = shown.filter((e) => ["accepted", "edited", "rejected"].includes(e.human_decision));
  const accepted = decided.filter((e) => e.human_decision === "accepted").length;
  const acc = wilsonInterval(accepted, decided.length);
  const failures = shown.filter((e) => e.error).length;
  const stamp = new Date().toISOString().slice(0, 10);

  return (
    <div className="grid gap-6">
      <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          k="AI calls logged"
          v={formatInt(shown.length)}
          note={`${failures} failed (failures are logged too)`}
        />
        <Stat
          k="Human decisions"
          v={formatInt(decided.length)}
          note={`${shown.filter((e) => e.human_decision === "pending").length} pending, ${shown.filter((e) => e.human_decision === "no_output").length} with no output to decide on (failed calls), ${shown.filter((e) => e.human_decision === "not_applicable").length} evaluation calls`}
        />
        <Stat
          k="Accepted unchanged"
          v={decided.length ? formatPct(acc.estimate, 0) : "–"}
          note={
            decided.length
              ? `${accepted} of ${decided.length}, Wilson 95% CI ${formatPct(acc.lower, 0)} to ${formatPct(acc.upper, 0)}`
              : "no decisions yet"
          }
        />
        <Stat
          k="Tokens"
          v={formatInt(
            shown.reduce((s, e) => s + (e.usage ? e.usage.inputTokens + e.usage.outputTokens : 0), 0),
          )}
          note="input + output, as reported by the provider"
        />
      </dl>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <label className="flex items-center gap-2 text-sm">
          <span className="kicker text-muted-foreground">Feature</span>
          <select
            value={feature}
            onChange={(e) => setFeature(e.target.value)}
            className="border-input bg-card h-9 rounded-md border px-2 text-sm"
          >
            <option value="all">All ({entries.length})</option>
            {features.map((f) => (
              <option key={f} value={f}>
                {f} ({entries.filter((e) => e.feature === f).length})
              </option>
            ))}
          </select>
        </label>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={!shown.length}
            onClick={() => downloadText(`ai-audit-log-${stamp}.json`, auditToJson(shown), "application/json")}
            className="hover:bg-muted inline-flex items-center gap-1 rounded-md border px-2.5 py-1.5 text-xs font-medium disabled:opacity-50"
          >
            <Download className="size-3.5" aria-hidden /> JSON
          </button>
          <button
            type="button"
            disabled={!shown.length}
            onClick={() =>
              downloadText(`ai-audit-log-${stamp}.csv`, auditToCsv(shown), "text/csv;charset=utf-8")
            }
            className="hover:bg-muted inline-flex items-center gap-1 rounded-md border px-2.5 py-1.5 text-xs font-medium disabled:opacity-50"
          >
            <Download className="size-3.5" aria-hidden /> CSV
          </button>
          <button
            type="button"
            disabled={!entries.length}
            onClick={() => {
              if (
                window.confirm(
                  "Delete every entry of the AI audit log in this browser? This cannot be undone.",
                )
              )
                void auditStore().clear();
            }}
            className="hover:bg-muted inline-flex items-center gap-1 rounded-md border px-2.5 py-1.5 text-xs font-medium disabled:opacity-50"
          >
            <Trash2 className="size-3.5" aria-hidden /> Clear log
          </button>
        </div>
      </div>

      {shown.length === 0 ? (
        <p className="bg-card rounded-md border px-4 py-6 text-center text-sm">
          No AI calls from this browser yet. Every call made with your key on{" "}
          <a href="/ask" className="link-taxi">
            Ask the data
          </a>{" "}
          will appear here.
        </p>
      ) : (
        <ScrollRegion label="AI calls made from this browser" className="rounded-lg border">
          <table className="w-full min-w-[760px] text-sm">
            <caption className="sr-only">AI calls made from this browser, newest first</caption>
            <thead className="bg-card">
              <tr className="text-left">
                {["When", "Feature", "Model", "Input", "Latency", "Tokens", "Decision", ""].map((h) => (
                  <th key={h} scope="col" className="border-b px-3 py-2 font-semibold">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y">
              {shown.flatMap((e) => {
                const input = e.input as Record<string, unknown> | null;
                const summary =
                  typeof input?.question === "string" ? input.question : JSON.stringify(e.input).slice(0, 80);
                const isOpen = open === e.id;
                const rows = [
                  <tr key={e.id} className="align-top">
                    <td className="px-3 py-2 font-mono text-xs whitespace-nowrap">
                      {new Date(e.timestamp).toLocaleString("en-AU", {
                        dateStyle: "short",
                        timeStyle: "medium",
                      })}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">{e.feature}</td>
                    <td className="px-3 py-2 font-mono text-xs">
                      {e.model}
                      {e.model !== e.requestedModel && (
                        <span className="text-muted-foreground block">asked for {e.requestedModel}</span>
                      )}
                    </td>
                    <td className="max-w-[18rem] px-3 py-2">
                      {summary}
                      {e.error && <span className="text-destructive block text-xs">{e.error}</span>}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs whitespace-nowrap">
                      {formatInt(e.latency_ms)} ms
                    </td>
                    <td className="px-3 py-2 font-mono text-xs whitespace-nowrap">
                      {e.usage
                        ? `${formatInt(e.usage.inputTokens)} / ${formatInt(e.usage.outputTokens)}`
                        : "–"}
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={cn(
                          "inline-block rounded-full border px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap",
                          DECISION_CLASS[e.human_decision],
                        )}
                      >
                        {DECISION_LABEL[e.human_decision]}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <button
                        type="button"
                        className="link-taxi text-xs"
                        aria-expanded={isOpen}
                        onClick={() => setOpen(isOpen ? null : e.id)}
                      >
                        {isOpen ? "Hide" : "Details"}
                      </button>
                    </td>
                  </tr>,
                ];
                if (isOpen) {
                  rows.push(
                    // on small screens the details render below the table instead, at full width
                    <tr key={`${e.id}-d`} className="bg-card hidden md:table-row">
                      <td colSpan={8} className="px-3 py-3">
                        <Details e={e} />
                      </td>
                    </tr>,
                  );
                }
                return rows;
              })}
            </tbody>
          </table>
        </ScrollRegion>
      )}
      {shown
        .filter((e) => e.id === open)
        .map((e) => (
          <section
            key={e.id}
            aria-label="Details of the selected call"
            className="bg-card grid gap-3 rounded-lg border p-3 md:hidden"
          >
            <div className="flex items-center justify-between gap-2">
              <p className="font-mono text-xs">
                {new Date(e.timestamp).toLocaleString("en-AU", { dateStyle: "short", timeStyle: "medium" })}
              </p>
              <button type="button" className="link-taxi text-xs" onClick={() => setOpen(null)}>
                Hide
              </button>
            </div>
            <Details e={e} />
          </section>
        ))}
    </div>
  );
}

function Details({ e }: { e: AuditEntry }) {
  const history = e.decisions ?? [];
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <Json title="Logged input: your question and the prompt settings (never the key)" value={e.input} />
      <div className="grid content-start gap-2">
        {e.output !== null && (
          <>
            <AiBadge model={e.model} className="w-fit" />
            <Json title="Output" value={e.output} />
          </>
        )}
        {e.edited_output !== null && <Json title="What the human ran instead" value={e.edited_output} />}
        {history.length > 1 && (
          <div>
            <p className="kicker text-muted-foreground mb-1">Decision history</p>
            <ol className="grid gap-0.5 font-mono text-[11px]">
              {history.map((d) => (
                <li key={d.at}>
                  {new Date(d.at).toLocaleString("en-AU")} · {DECISION_LABEL[d.decision]}
                </li>
              ))}
            </ol>
          </div>
        )}
        <p className="text-muted-foreground font-mono text-[11px] break-words">
          id {e.id} · provider {e.provider}
          {e.decided_at ? ` · decided ${new Date(e.decided_at).toLocaleString("en-AU")}` : ""}
        </p>
      </div>
    </div>
  );
}

function Json({ title, value }: { title: string; value: unknown }) {
  return (
    <div>
      <p className="kicker text-muted-foreground mb-1">{title}</p>
      <pre className="bg-background max-h-72 overflow-auto rounded-md border p-2 font-mono text-[11px] leading-relaxed whitespace-pre-wrap">
        {JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
}

function Stat({ k, v, note }: { k: string; v: string; note: string }) {
  return (
    <div className="bg-card rounded-md border px-4 py-3">
      <dt className="text-muted-foreground text-xs">{k}</dt>
      <dd className="font-condensed mt-1 text-3xl font-extrabold tabular-nums">{v}</dd>
      <dd className="text-muted-foreground mt-1 text-[11px] leading-snug">{note}</dd>
    </div>
  );
}
