import type { AuditStore, NewAuditEntry } from "./audit-log";
import { redactSecrets, withDecision } from "./audit-log";
import type { AuditEntry } from "./types";

export const FAKE_KEY = "sk-ant-test-0123456789abcdefghijklmnop";

export interface Captured {
  url: string;
  headers: Headers;
  body: Record<string, unknown>;
}

/** A fetch stand-in that records requests and replays canned responses in order. */
export function mockFetch(responses: (Response | Error)[]) {
  const calls: Captured[] = [];
  const queue = [...responses];
  const fn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    calls.push({
      url,
      headers: new Headers(init?.headers as HeadersInit),
      body: init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {},
    });
    const next = queue.shift();
    if (!next) throw new Error("no more mocked responses");
    if (next instanceof Error) throw next;
    return next;
  }) as typeof fetch;
  return { fetch: fn, calls };
}

export function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

export function anthropicMessage(text: string, extra: Record<string, unknown> = {}) {
  return {
    id: "msg_test",
    type: "message",
    role: "assistant",
    model: "claude-haiku-4-5",
    content: [{ type: "text", text }],
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: { input_tokens: 812, output_tokens: 64 },
    ...extra,
  };
}

/** In-memory AuditStore with the same redaction behaviour as the IndexedDB one. */
export function memoryAudit(): AuditStore & { entries: AuditEntry[] } {
  const entries: AuditEntry[] = [];
  let n = 0;
  return {
    entries,
    async add(e: NewAuditEntry, secrets: string[] = []) {
      const full = redactSecrets(
        {
          ...e,
          id: `e${++n}`,
          timestamp: new Date(2026, 0, n).toISOString(),
          decided_at: null,
          edited_output: null,
          decisions: [],
        },
        secrets,
      );
      entries.push(full);
      return full;
    },
    async setDecision(id, decision, edited) {
      const e = entries.find((x) => x.id === id);
      if (!e) return null;
      Object.assign(e, withDecision(e, decision, edited));
      return e;
    },
    async list() {
      return [...entries].reverse();
    },
    async clear() {
      entries.length = 0;
    },
  };
}
