import { toCsv } from "@/lib/csv";
import type { AuditEntry } from "./types";

export const AUDIT_CSV_COLUMNS = [
  "id",
  "timestamp",
  "feature",
  "provider",
  "model",
  "requested_model",
  "latency_ms",
  "input_tokens",
  "output_tokens",
  "human_decision",
  "decided_at",
  "error",
  "input",
  "output",
  "edited_output",
  "decision_history",
] as const;

const json = (v: unknown) => (v === null || v === undefined ? "" : JSON.stringify(v));

/** One flat row per call; structured fields are embedded as JSON text. */
export function auditToCsv(entries: readonly AuditEntry[]): string {
  return toCsv(
    AUDIT_CSV_COLUMNS,
    entries.map((e) => ({
      id: e.id,
      timestamp: e.timestamp,
      feature: e.feature,
      provider: e.provider,
      model: e.model,
      requested_model: e.requestedModel,
      latency_ms: e.latency_ms,
      input_tokens: e.usage?.inputTokens ?? "",
      output_tokens: e.usage?.outputTokens ?? "",
      human_decision: e.human_decision,
      decided_at: e.decided_at ?? "",
      error: e.error ?? "",
      input: json(e.input),
      output: json(e.output),
      edited_output: json(e.edited_output),
      decision_history: json(e.decisions ?? []),
    })),
  );
}

export function auditToJson(entries: readonly AuditEntry[]): string {
  return JSON.stringify(
    {
      exported_at: new Date().toISOString(),
      source: "NYC Taxi 2019 site, AI audit log (this browser)",
      entries,
    },
    null,
    2,
  );
}
