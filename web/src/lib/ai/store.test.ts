import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it } from "vitest";
import { AUDIT_CSV_COLUMNS, auditToCsv, auditToJson } from "./audit-export";
import { indexedDbAuditStore, redactSecrets } from "./audit-log";
import { DEFAULT_SETTINGS } from "./models";
import { createAiStore, KEY_PREFIX, SETTINGS_KEY, type KeyValueStorage } from "./settings";
import { FAKE_KEY } from "./test-helpers";

function storage(): KeyValueStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}

describe("key and settings storage", () => {
  it("keeps the key in sessionStorage by default and moves it on 'remember'", () => {
    const session = storage();
    const local = storage();
    let changes = 0;
    const store = createAiStore(session, local, () => changes++);
    store.setKey("anthropic", `  ${FAKE_KEY}  `, false);
    expect(session.data.get(KEY_PREFIX + "anthropic")).toBe(FAKE_KEY);
    expect(local.data.has(KEY_PREFIX + "anthropic")).toBe(false);
    store.setKey("anthropic", FAKE_KEY, true);
    expect(local.data.get(KEY_PREFIX + "anthropic")).toBe(FAKE_KEY);
    expect(session.data.has(KEY_PREFIX + "anthropic")).toBe(false);
    expect(store.getKey("anthropic")).toBe(FAKE_KEY);
    expect(store.getKey("openai")).toBeNull();
    expect(changes).toBe(2);
  });
  it("forgets keys from both storages", () => {
    const session = storage();
    const local = storage();
    const store = createAiStore(session, local);
    store.setKey("anthropic", FAKE_KEY, true);
    store.setKey("openai", "sk-openai-0123456789", false);
    store.forgetKey("anthropic");
    expect(store.getKey("anthropic")).toBeNull();
    expect(store.getKey("openai")).not.toBeNull();
    store.forgetKey();
    expect([...session.data.keys(), ...local.data.keys()]).toEqual([]);
    store.setKey("openai", "   ", false);
    expect(store.getKey("openai")).toBeNull();
  });
  it("stores settings without the key and survives corrupt values", () => {
    const local = storage();
    const store = createAiStore(storage(), local);
    expect(store.getSettings()).toEqual(DEFAULT_SETTINGS);
    store.saveSettings({ ...DEFAULT_SETTINGS, provider: "openai", openaiModel: "gpt-x", remember: true });
    expect(store.getSettings()).toMatchObject({ provider: "openai", openaiModel: "gpt-x", remember: true });
    expect(local.data.get(SETTINGS_KEY)).not.toContain("sk-");
    local.data.set(SETTINGS_KEY, "{not json");
    expect(store.getSettings()).toEqual(DEFAULT_SETTINGS);
  });
});

describe("IndexedDB audit log", () => {
  const base = {
    feature: "ask-the-data",
    provider: "anthropic" as const,
    model: "claude-haiku-4-5",
    requestedModel: "claude-haiku-4-5",
    input: { question: 'How many zones, "quoted", with a comma?' },
    output: { sql: "SELECT count(*) FROM zones" },
    error: null,
    latency_ms: 950,
    usage: { inputTokens: 1000, outputTokens: 50 },
    human_decision: "pending" as const,
  };

  it("adds, lists newest first, records decisions and clears", async () => {
    const store = indexedDbAuditStore(new IDBFactory());
    const a = await store.add(base);
    await new Promise((r) => setTimeout(r, 5));
    const b = await store.add({ ...base, input: { question: "second" } });
    const all = await store.list();
    expect(all.map((e) => e.id)).toEqual([b.id, a.id]);
    const edited = await store.setDecision(a.id, "edited", { sql: "SELECT 1" });
    expect(edited).toMatchObject({ human_decision: "edited", edited_output: { sql: "SELECT 1" } });
    expect(edited!.decided_at).not.toBeNull();
    const rejected = await store.setDecision(b.id, "rejected", { ignored: true });
    expect(rejected!.edited_output).toBeNull();
    // decisions are appended, never overwritten: a later decision keeps the earlier one
    const again = await store.setDecision(a.id, "rejected");
    expect(again!.human_decision).toBe("rejected");
    expect(again!.decisions!.map((d) => d.decision)).toEqual(["edited", "rejected"]);
    expect(again!.decisions![0].edited_output).toEqual({ sql: "SELECT 1" });
    expect(await store.setDecision("missing", "accepted")).toBeNull();
    await store.clear();
    expect(await store.list()).toEqual([]);
  });

  it("redacts the key wherever it appears", async () => {
    const store = indexedDbAuditStore(new IDBFactory());
    await store.add({ ...base, input: { question: `my key is ${FAKE_KEY}`, nested: [FAKE_KEY] } }, [
      FAKE_KEY,
    ]);
    const [e] = await store.list();
    expect(JSON.stringify(e)).not.toContain(FAKE_KEY);
    expect(redactSecrets({ a: "short" }, ["short"])).toEqual({ a: "short" }); // too short to be a key
  });

  it("exports JSON and RFC 4180 CSV", async () => {
    const store = indexedDbAuditStore(new IDBFactory());
    await store.add(base);
    const entries = await store.list();
    const csv = auditToCsv(entries);
    const [header, row] = csv.trim().split("\r\n");
    expect(header).toBe(AUDIT_CSV_COLUMNS.join(","));
    expect(row).toContain('"{""question"":""How many zones, \\""quoted\\"", with a comma?""}"');
    expect(row).toContain(",1000,50,pending,");
    const parsed = JSON.parse(auditToJson(entries));
    expect(parsed.entries).toHaveLength(1);
    expect(parsed.entries[0].latency_ms).toBe(950);
  });
});
