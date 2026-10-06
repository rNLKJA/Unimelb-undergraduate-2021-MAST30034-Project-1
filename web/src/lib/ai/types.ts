/**
 * Bring-your-own-key AI: shared types. The visitor's key lives only in their browser
 * (sessionStorage, or localStorage when they opt in) and is sent only to the provider.
 */

export type Provider = "anthropic" | "openai";

export interface AiSettings {
  provider: Provider;
  /** Anthropic model id (one of ANTHROPIC_MODELS) */
  anthropicModel: string;
  /** OpenAI model id, free text */
  openaiModel: string;
  /** keep the key in localStorage instead of sessionStorage */
  remember: boolean;
}

export interface TokenUsage {
  /** all input tokens, cached or not */
  inputTokens: number;
  outputTokens: number;
  /** input tokens served from the provider's prompt cache, when reported */
  cachedInputTokens?: number;
}

/** A validated structured response from either provider. */
export interface AiResult<T> {
  output: T;
  provider: Provider;
  /** model the provider reports it used (may differ from the request when a fallback ran) */
  model: string;
  requestedModel: string;
  usage: TokenUsage | null;
  latencyMs: number;
  stopReason: string | null;
}

export interface StructuredRequest {
  system: string;
  user: string;
  /** JSON Schema of the expected output (objects must set additionalProperties: false) */
  jsonSchema: Record<string, unknown>;
  schemaName: string;
  maxTokens?: number;
}

export type HumanDecision = "pending" | "accepted" | "edited" | "rejected" | "not_applicable";

/** One row of the AI audit log (IndexedDB). Never holds the API key. */
export interface AuditEntry {
  id: string;
  timestamp: string;
  feature: string;
  provider: Provider;
  model: string;
  requestedModel: string;
  input: unknown;
  output: unknown;
  error: string | null;
  latency_ms: number;
  usage: TokenUsage | null;
  human_decision: HumanDecision;
  decided_at: string | null;
  /** what the human ran or kept instead, when they edited the output */
  edited_output: unknown;
}
