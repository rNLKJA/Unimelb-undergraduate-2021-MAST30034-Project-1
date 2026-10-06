import type { ZodType } from "zod";
import { anthropicStructured, type CallOptions } from "./anthropic";
import type { AuditStore } from "./audit-log";
import { AiError } from "./errors";
import { activeModel } from "./models";
import { openaiStructured } from "./openai";
import type { AiResult, AiSettings, AuditEntry, StructuredRequest } from "./types";

/**
 * Call the visitor's chosen provider for structured output and validate it with zod.
 * The key goes only to the provider's API, straight from the browser.
 */
export async function generateStructured<T>(
  settings: AiSettings,
  key: string | null,
  req: StructuredRequest,
  schema: ZodType<T>,
  opts: CallOptions = {},
): Promise<AiResult<T>> {
  if (!key) throw new AiError("no_key");
  const requestedModel = activeModel(settings);
  const t0 = performance.now();
  const raw =
    settings.provider === "anthropic"
      ? await anthropicStructured(key, requestedModel, req, opts)
      : await openaiStructured(key, requestedModel, req, opts);
  const latencyMs = Math.round(performance.now() - t0);
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.text);
  } catch {
    throw new AiError("invalid_output", {
      detail: "The response was not valid JSON.",
      model: raw.model,
      usage: raw.usage,
    });
  }
  const checked = schema.safeParse(parsed);
  if (!checked.success) {
    throw new AiError("invalid_output", {
      detail: checked.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
      model: raw.model,
      usage: raw.usage,
    });
  }
  return {
    output: checked.data,
    provider: settings.provider,
    model: raw.model,
    requestedModel,
    usage: raw.usage,
    latencyMs,
    stopReason: raw.stopReason,
  };
}

/**
 * Run an AI feature and append the call to the audit log, success or failure. The entry
 * records the input (never the key), the output, latency and token usage; the human
 * decision starts as "pending" (or "not_applicable" for evaluation runs), and a failed call is
 * logged as "no_output" with whatever usage the provider reported (an unusable answer is billed).
 */
export async function runAudited<T>(
  audit: AuditStore,
  feature: string,
  input: unknown,
  settings: AiSettings,
  key: string | null,
  req: StructuredRequest,
  schema: ZodType<T>,
  opts: CallOptions & { decision?: AuditEntry["human_decision"] } = {},
): Promise<{ result: AiResult<T>; entry: AuditEntry }> {
  const requestedModel = activeModel(settings);
  const t0 = performance.now();
  const secrets = key ? [key] : [];
  try {
    const result = await generateStructured(settings, key, req, schema, opts);
    const entry = await audit.add(
      {
        feature,
        provider: result.provider,
        model: result.model,
        requestedModel,
        input,
        output: result.output,
        error: null,
        latency_ms: result.latencyMs,
        usage: result.usage,
        human_decision: opts.decision ?? "pending",
      },
      secrets,
    );
    return { result, entry };
  } catch (e) {
    const err =
      e instanceof AiError ? e : new AiError("unknown", { detail: e instanceof Error ? e.message : null });
    if (err.kind !== "no_key") {
      await audit.add(
        {
          feature,
          provider: settings.provider,
          model: err.model ?? requestedModel,
          requestedModel,
          input,
          output: null,
          error: `${err.kind}: ${err.message}${err.detail ? ` (${err.detail})` : ""}`,
          latency_ms: Math.round(performance.now() - t0),
          usage: err.usage,
          human_decision: "no_output",
        },
        secrets,
      );
    }
    throw err;
  }
}
