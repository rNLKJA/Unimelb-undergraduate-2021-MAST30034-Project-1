import { describe, expect, it } from "vitest";
import { z } from "zod";
import { generateStructured, runAudited } from "./client";
import { DEFAULT_SETTINGS } from "./models";
import { FAKE_KEY, anthropicMessage, json, memoryAudit, mockFetch } from "./test-helpers";
import type { StructuredRequest } from "./types";

const schema = z.object({ a: z.string() });
const req: StructuredRequest = { system: "s", user: "u", jsonSchema: {}, schemaName: "x" };

describe("generateStructured", () => {
  it("needs a key", async () => {
    await expect(generateStructured(DEFAULT_SETTINGS, null, req, schema)).rejects.toMatchObject({
      kind: "no_key",
    });
  });
  it("validates the output with zod", async () => {
    const good = mockFetch([json(200, anthropicMessage('{"a":"ok"}'))]);
    const r = await generateStructured(DEFAULT_SETTINGS, FAKE_KEY, req, schema, {
      fetch: good.fetch,
      maxRetries: 0,
    });
    expect(r.output).toEqual({ a: "ok" });
    expect(r.provider).toBe("anthropic");
    expect(r.requestedModel).toBe("claude-haiku-4-5");
    expect(r.latencyMs).toBeGreaterThanOrEqual(0);
    const wrongShape = mockFetch([json(200, anthropicMessage('{"b":1}'))]);
    await expect(
      generateStructured(DEFAULT_SETTINGS, FAKE_KEY, req, schema, { fetch: wrongShape.fetch, maxRetries: 0 }),
    ).rejects.toMatchObject({
      kind: "invalid_output",
    });
    const notJson = mockFetch([json(200, anthropicMessage("SELECT 1"))]);
    await expect(
      generateStructured(DEFAULT_SETTINGS, FAKE_KEY, req, schema, { fetch: notJson.fetch, maxRetries: 0 }),
    ).rejects.toMatchObject({
      kind: "invalid_output",
    });
  });
  it("routes to OpenAI with the free-text model id", async () => {
    const m = mockFetch([
      json(200, {
        model: "my-model",
        choices: [{ message: { content: '{"a":"o"}' }, finish_reason: "stop" }],
      }),
    ]);
    const r = await generateStructured(
      { ...DEFAULT_SETTINGS, provider: "openai", openaiModel: " my-model " },
      FAKE_KEY,
      req,
      schema,
      { fetch: m.fetch },
    );
    expect(m.calls[0].body.model).toBe("my-model");
    expect(r.output.a).toBe("o");
  });
});

describe("runAudited", () => {
  it("logs successful calls with input, output, latency and usage, but never the key", async () => {
    const audit = memoryAudit();
    const m = mockFetch([json(200, anthropicMessage(`{"a":"${FAKE_KEY}"}`))]);
    const { entry } = await runAudited(
      audit,
      "test-feature",
      { question: `q ${FAKE_KEY}` },
      DEFAULT_SETTINGS,
      FAKE_KEY,
      req,
      schema,
      {
        fetch: m.fetch,
        maxRetries: 0,
      },
    );
    expect(entry).toMatchObject({
      feature: "test-feature",
      provider: "anthropic",
      model: "claude-haiku-4-5",
      usage: { inputTokens: 812, outputTokens: 64, cachedInputTokens: 0 },
      human_decision: "pending",
      error: null,
    });
    expect(JSON.stringify(audit.entries)).not.toContain(FAKE_KEY);
    expect(JSON.stringify(audit.entries)).toContain("[redacted]");
  });
  it("logs failures too, then rethrows", async () => {
    const audit = memoryAudit();
    const m = mockFetch([
      json(401, { type: "error", error: { type: "authentication_error", message: "bad key" } }),
    ]);
    await expect(
      runAudited(audit, "f", { q: 1 }, DEFAULT_SETTINGS, FAKE_KEY, req, schema, {
        fetch: m.fetch,
        maxRetries: 0,
      }),
    ).rejects.toMatchObject({ kind: "invalid_key" });
    expect(audit.entries).toHaveLength(1);
    expect(audit.entries[0].error).toMatch(/^invalid_key/);
    expect(audit.entries[0].human_decision).toBe("no_output");
  });
  it("keeps the model and billed tokens of an answer that failed validation", async () => {
    const audit = memoryAudit();
    const m = mockFetch([json(200, anthropicMessage('{"b":1}'))]);
    await expect(
      runAudited(audit, "f", { q: 1 }, DEFAULT_SETTINGS, FAKE_KEY, req, schema, {
        fetch: m.fetch,
        maxRetries: 0,
      }),
    ).rejects.toMatchObject({ kind: "invalid_output" });
    expect(audit.entries[0]).toMatchObject({
      model: "claude-haiku-4-5",
      usage: { inputTokens: 812, outputTokens: 64 },
      human_decision: "no_output",
    });
  });
  it("does not log a call that never happened (no key)", async () => {
    const audit = memoryAudit();
    await expect(runAudited(audit, "f", {}, DEFAULT_SETTINGS, null, req, schema)).rejects.toMatchObject({
      kind: "no_key",
    });
    expect(audit.entries).toHaveLength(0);
  });
});
