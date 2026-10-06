import Anthropic from "@anthropic-ai/sdk";
import { AiError, kindFromStatus, scrubKey } from "./errors";
import { anthropicModel } from "./models";
import type { StructuredRequest, TokenUsage } from "./types";

export interface ProviderResponse {
  text: string;
  model: string;
  usage: TokenUsage | null;
  stopReason: string | null;
}

export interface CallOptions {
  /** injected in tests; defaults to the browser's fetch */
  fetch?: typeof fetch;
  maxRetries?: number;
}

/**
 * Structured JSON from the Anthropic Messages API, called directly from the browser with the
 * visitor's own key. `dangerouslyAllowBrowser` makes the SDK send the
 * `anthropic-dangerous-direct-browser-access` header that browser calls require.
 *
 * Claude Sonnet 5.5 requests opt in to server-side refusal fallbacks (`fallbacks: "default"`),
 * so a false-positive safety decline is retried on Anthropic's recommended model instead of
 * failing; the served model is reported back and logged.
 */
export async function anthropicStructured(
  key: string,
  modelId: string,
  req: StructuredRequest,
  opts: CallOptions = {},
): Promise<ProviderResponse> {
  const info = anthropicModel(modelId);
  const client = new Anthropic({
    apiKey: key,
    dangerouslyAllowBrowser: true,
    maxRetries: opts.maxRetries ?? 1,
    timeout: 90_000,
    ...(opts.fetch ? { fetch: opts.fetch } : {}),
  });
  const format = { type: "json_schema" as const, schema: req.jsonSchema };
  const common = {
    model: info.id,
    max_tokens: req.maxTokens ?? 2048,
    // the long schema prompt repeats across questions (and across the 24 evaluation calls): cache it
    cache_control: { type: "ephemeral" as const },
    system: req.system,
    messages: [{ role: "user" as const, content: req.user }],
  };
  try {
    const msg = info.fallbacks
      ? await client.beta.messages.create({
          ...common,
          betas: ["server-side-fallback-2026-07-01"],
          fallbacks: "default",
          output_config: { format, ...(info.effort ? { effort: info.effort } : {}) },
        })
      : await client.messages.create({
          ...common,
          ...(info.temperature ? { temperature: 0 } : {}),
          output_config: { format, ...(info.effort ? { effort: info.effort } : {}) },
        });
    if (msg.stop_reason === "refusal") {
      const details = (msg as { stop_details?: { category?: string | null } | null }).stop_details;
      throw new AiError("refusal", { detail: details?.category ?? null });
    }
    if (msg.stop_reason === "max_tokens") throw new AiError("truncated");
    const text = msg.content
      .filter((b): b is Extract<typeof b, { type: "text" }> => b.type === "text")
      .map((b) => b.text)
      .join("");
    return {
      text,
      model: msg.model,
      usage: msg.usage
        ? {
            inputTokens:
              msg.usage.input_tokens +
              (msg.usage.cache_read_input_tokens ?? 0) +
              (msg.usage.cache_creation_input_tokens ?? 0),
            outputTokens: msg.usage.output_tokens,
            cachedInputTokens: msg.usage.cache_read_input_tokens ?? 0,
          }
        : null,
      stopReason: msg.stop_reason ?? null,
    };
  } catch (e) {
    throw toAiError(e, key);
  }
}

function toAiError(e: unknown, key: string): AiError {
  if (e instanceof AiError) return e;
  // APIConnectionError (network, CORS, timeout) is a subclass of APIError in the TypeScript SDK: check it first
  if (e instanceof Anthropic.APIConnectionError)
    return new AiError("network", { detail: scrubKey(e.message, key) });
  if (e instanceof Anthropic.APIError) {
    const type = (e as { type?: string | null }).type ?? null;
    return new AiError(kindFromStatus(e.status ?? 0, type), {
      status: e.status ?? null,
      detail: scrubKey(e.message, key),
    });
  }
  return new AiError("unknown", { detail: e instanceof Error ? scrubKey(e.message, key) : null });
}
