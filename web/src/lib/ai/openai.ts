import { AiError, kindFromStatus, scrubKey } from "./errors";
import type { CallOptions, ProviderResponse } from "./anthropic";
import type { StructuredRequest } from "./types";

export const OPENAI_URL = "https://api.openai.com/v1/chat/completions";

interface ChatCompletion {
  model?: string;
  choices?: {
    message?: { content?: string | null; refusal?: string | null };
    finish_reason?: string | null;
  }[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    prompt_tokens_details?: { cached_tokens?: number };
  } | null;
}

/** Structured JSON from OpenAI's Chat Completions API (json_schema response format), from the browser. */
export async function openaiStructured(
  key: string,
  model: string,
  req: StructuredRequest,
  opts: CallOptions = {},
): Promise<ProviderResponse> {
  const doFetch = opts.fetch ?? globalThis.fetch.bind(globalThis);
  let res: Response;
  try {
    res = await doFetch(OPENAI_URL, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model,
        max_completion_tokens: req.maxTokens ?? 2048,
        messages: [
          { role: "system", content: req.system },
          { role: "user", content: req.user },
        ],
        response_format: {
          type: "json_schema",
          json_schema: { name: req.schemaName, schema: req.jsonSchema, strict: true },
        },
      }),
    });
  } catch (e) {
    throw new AiError("network", { detail: e instanceof Error ? scrubKey(e.message, key) : null });
  }
  if (!res.ok) {
    let type: string | null = null;
    let detail: string | null = null;
    try {
      const body = (await res.json()) as { error?: { type?: string; code?: string; message?: string } };
      type = body.error?.code ?? body.error?.type ?? null;
      detail = body.error?.message ? scrubKey(body.error.message, key) : null;
    } catch {
      // non-JSON error body
    }
    const kind = type === "insufficient_quota" ? "rate_limit" : kindFromStatus(res.status, type);
    throw new AiError(kind, { status: res.status, detail });
  }
  const body = (await res.json()) as ChatCompletion;
  const choice = body.choices?.[0];
  if (choice?.message?.refusal)
    throw new AiError("refusal", { detail: scrubKey(choice.message.refusal, key) });
  if (choice?.finish_reason === "content_filter") throw new AiError("refusal");
  if (choice?.finish_reason === "length") throw new AiError("truncated");
  return {
    text: choice?.message?.content ?? "",
    model: body.model ?? model,
    usage: body.usage
      ? {
          inputTokens: body.usage.prompt_tokens ?? 0,
          outputTokens: body.usage.completion_tokens ?? 0,
          cachedInputTokens: body.usage.prompt_tokens_details?.cached_tokens ?? 0,
        }
      : null,
    stopReason: choice?.finish_reason ?? null,
  };
}
