import { describe, expect, it } from "vitest";
import { anthropicStructured } from "./anthropic";
import { AiError } from "./errors";
import { OPENAI_URL, openaiStructured } from "./openai";
import { FAKE_KEY, anthropicMessage, json, mockFetch } from "./test-helpers";
import type { StructuredRequest } from "./types";

const req: StructuredRequest = {
  system: "system prompt",
  user: "Question: how many zones?",
  jsonSchema: {
    type: "object",
    properties: { a: { type: "string" } },
    required: ["a"],
    additionalProperties: false,
  },
  schemaName: "answer",
  maxTokens: 500,
};

async function anthropicError(status: number, body: unknown, headers: Record<string, string> = {}) {
  const m = mockFetch([json(status, body, headers)]);
  try {
    await anthropicStructured(FAKE_KEY, "claude-haiku-4-5", req, { fetch: m.fetch, maxRetries: 0 });
  } catch (e) {
    return e as AiError;
  }
  throw new Error("expected an error");
}

describe("Anthropic adapter (official SDK, browser mode, fetch mocked)", () => {
  it("calls the Messages API directly with the browser header, the key and structured output", async () => {
    const m = mockFetch([json(200, anthropicMessage('{"a":"x"}'))]);
    const r = await anthropicStructured(FAKE_KEY, "claude-haiku-4-5", req, { fetch: m.fetch, maxRetries: 0 });
    expect(r).toEqual({
      text: '{"a":"x"}',
      model: "claude-haiku-4-5",
      usage: { inputTokens: 812, outputTokens: 64, cachedInputTokens: 0 },
      stopReason: "end_turn",
    });
    const call = m.calls[0];
    expect(call.url).toBe("https://api.anthropic.com/v1/messages");
    expect(call.headers.get("anthropic-dangerous-direct-browser-access")).toBe("true");
    expect(call.headers.get("x-api-key")).toBe(FAKE_KEY);
    expect(call.headers.get("anthropic-version")).toBeTruthy();
    expect(call.body).toMatchObject({
      model: "claude-haiku-4-5",
      max_tokens: 500,
      temperature: 0,
      system: "system prompt",
      cache_control: { type: "ephemeral" },
      messages: [{ role: "user", content: "Question: how many zones?" }],
      output_config: { format: { type: "json_schema", schema: req.jsonSchema } },
    });
    expect(call.body).not.toHaveProperty("fallbacks");
  });

  it("sends Claude Sonnet 5.5 with low effort, no temperature and server-side fallbacks", async () => {
    const m = mockFetch([json(200, anthropicMessage('{"a":"x"}', { model: "claude-sonnet-5-5" }))]);
    const r = await anthropicStructured(FAKE_KEY, "claude-sonnet-5-5", req, {
      fetch: m.fetch,
      maxRetries: 0,
    });
    expect(r.model).toBe("claude-sonnet-5-5");
    const call = m.calls[0];
    expect(call.url).toContain("/v1/messages");
    expect(call.headers.get("anthropic-beta")).toContain("server-side-fallback-2026-07-01");
    expect(call.body).toMatchObject({
      model: "claude-sonnet-5-5",
      fallbacks: "default",
      output_config: { effort: "low" },
    });
    expect(call.body).not.toHaveProperty("temperature");
    expect(call.body).not.toHaveProperty("betas");
  });

  it("counts cached prompt tokens as input and reports them separately", async () => {
    const m = mockFetch([
      json(
        200,
        anthropicMessage('{"a":"x"}', {
          usage: {
            input_tokens: 20,
            output_tokens: 30,
            cache_read_input_tokens: 6000,
            cache_creation_input_tokens: 0,
          },
        }),
      ),
    ]);
    const r = await anthropicStructured(FAKE_KEY, "claude-haiku-4-5", req, { fetch: m.fetch, maxRetries: 0 });
    expect(r.usage).toEqual({ inputTokens: 6020, outputTokens: 30, cachedInputTokens: 6000 });
  });

  it("falls back to the default model for an unknown id", async () => {
    const m = mockFetch([json(200, anthropicMessage('{"a":"x"}'))]);
    await anthropicStructured(FAKE_KEY, "not-a-model", req, { fetch: m.fetch, maxRetries: 0 });
    expect(m.calls[0].body.model).toBe("claude-haiku-4-5");
  });

  it("maps HTTP errors to visitor-facing kinds without echoing the key", async () => {
    const auth = await anthropicError(401, {
      type: "error",
      error: { type: "authentication_error", message: `invalid x-api-key ${FAKE_KEY}` },
    });
    expect(auth).toBeInstanceOf(AiError);
    expect(auth.kind).toBe("invalid_key");
    expect(auth.status).toBe(401);
    expect(`${auth.message} ${auth.detail}`).not.toContain(FAKE_KEY);
    expect(
      (
        await anthropicError(
          429,
          { type: "error", error: { type: "rate_limit_error", message: "slow down" } },
          { "retry-after": "0" },
        )
      ).kind,
    ).toBe("rate_limit");
    expect(
      (await anthropicError(529, { type: "error", error: { type: "overloaded_error", message: "busy" } }))
        .kind,
    ).toBe("overloaded");
    expect(
      (await anthropicError(403, { type: "error", error: { type: "permission_error", message: "no" } })).kind,
    ).toBe("permission");
    expect(
      (await anthropicError(404, { type: "error", error: { type: "not_found_error", message: "model" } }))
        .kind,
    ).toBe("bad_request");
    expect(
      (await anthropicError(500, { type: "error", error: { type: "api_error", message: "boom" } })).kind,
    ).toBe("server");
  });

  it("reports network and CORS failures as network errors", async () => {
    const m = mockFetch([new TypeError("Failed to fetch")]);
    await expect(
      anthropicStructured(FAKE_KEY, "claude-haiku-4-5", req, { fetch: m.fetch, maxRetries: 0 }),
    ).rejects.toMatchObject({
      kind: "network",
    });
  });

  it("treats refusals and truncation as errors, never as answers", async () => {
    const refused = mockFetch([
      json(
        200,
        anthropicMessage("", {
          stop_reason: "refusal",
          stop_details: { type: "refusal", category: "cyber", explanation: null },
        }),
      ),
    ]);
    await expect(
      anthropicStructured(FAKE_KEY, "claude-haiku-4-5", req, { fetch: refused.fetch, maxRetries: 0 }),
    ).rejects.toMatchObject({
      kind: "refusal",
      detail: "cyber",
    });
    const cut = mockFetch([json(200, anthropicMessage('{"a":', { stop_reason: "max_tokens" }))]);
    await expect(
      anthropicStructured(FAKE_KEY, "claude-haiku-4-5", req, { fetch: cut.fetch, maxRetries: 0 }),
    ).rejects.toMatchObject({
      kind: "truncated",
    });
  });
});

describe("OpenAI adapter (fetch mocked)", () => {
  const ok = {
    model: "gpt-5-mini-2026-01-01",
    choices: [{ message: { content: '{"a":"y"}', refusal: null }, finish_reason: "stop" }],
    usage: { prompt_tokens: 700, completion_tokens: 40 },
  };

  it("calls Chat Completions with a strict json_schema response format", async () => {
    const m = mockFetch([json(200, ok)]);
    const r = await openaiStructured(FAKE_KEY, "gpt-5-mini", req, { fetch: m.fetch });
    expect(r).toEqual({
      text: '{"a":"y"}',
      model: "gpt-5-mini-2026-01-01",
      usage: { inputTokens: 700, outputTokens: 40, cachedInputTokens: 0 },
      stopReason: "stop",
    });
    const call = m.calls[0];
    expect(call.url).toBe(OPENAI_URL);
    expect(call.headers.get("authorization")).toBe(`Bearer ${FAKE_KEY}`);
    expect(call.body).toMatchObject({
      model: "gpt-5-mini",
      max_completion_tokens: 500,
      messages: [
        { role: "system", content: "system prompt" },
        { role: "user", content: "Question: how many zones?" },
      ],
      response_format: {
        type: "json_schema",
        json_schema: { name: "answer", schema: req.jsonSchema, strict: true },
      },
    });
  });

  it("maps errors, quota, refusals and truncation", async () => {
    const run = async (r: Response | Error) => {
      const m = mockFetch([r]);
      try {
        await openaiStructured(FAKE_KEY, "gpt-5-mini", req, { fetch: m.fetch });
      } catch (e) {
        return e as AiError;
      }
      throw new Error("expected an error");
    };
    expect(
      (
        await run(
          json(401, {
            error: {
              type: "invalid_request_error",
              code: "invalid_api_key",
              message: `Incorrect API key ${FAKE_KEY}`,
            },
          }),
        )
      ).kind,
    ).toBe("invalid_key");
    const quota = await run(
      json(429, { error: { type: "insufficient_quota", code: "insufficient_quota", message: "quota" } }),
    );
    expect(quota.kind).toBe("rate_limit");
    expect((await run(new TypeError("NetworkError when attempting to fetch resource."))).kind).toBe(
      "network",
    );
    expect(
      (
        await run(
          json(200, {
            ...ok,
            choices: [{ message: { content: null, refusal: "I can't help" }, finish_reason: "stop" }],
          }),
        )
      ).kind,
    ).toBe("refusal");
    expect(
      (await run(json(200, { ...ok, choices: [{ message: { content: '{"a"' }, finish_reason: "length" }] })))
        .kind,
    ).toBe("truncated");
    const leaked = await run(
      json(401, { error: { code: "invalid_api_key", message: `Incorrect API key provided: ${FAKE_KEY}` } }),
    );
    expect(leaked.detail).not.toContain(FAKE_KEY);
  });
});
