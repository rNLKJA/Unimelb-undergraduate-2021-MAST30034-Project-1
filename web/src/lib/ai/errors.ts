/** Errors shown to the visitor. `kind` drives the message; `status` is the HTTP status when there was one. */
export type AiErrorKind =
  | "no_key"
  | "invalid_key"
  | "permission"
  | "rate_limit"
  | "overloaded"
  | "network"
  | "bad_request"
  | "refusal"
  | "truncated"
  | "invalid_output"
  | "server"
  | "unknown";

const MESSAGES: Record<AiErrorKind, string> = {
  no_key: "Add an API key in AI settings to use this feature.",
  invalid_key:
    "The provider rejected the API key. Check it in AI settings (keys are case-sensitive and easy to truncate).",
  permission:
    "This key is not allowed to use that model. Pick another model in AI settings or check the key's permissions.",
  rate_limit:
    "The provider's rate limit or spending limit was reached for this key. Wait a minute or check your plan.",
  overloaded: "The provider is temporarily overloaded. Try again in a moment.",
  network:
    "Could not reach the provider. Check your connection; browser extensions or a corporate network can also block direct calls to the API (CORS).",
  bad_request: "The provider rejected the request. The model id may be wrong or unavailable to this key.",
  refusal: "The model declined to answer this request.",
  truncated: "The answer was cut off before it finished. Try a shorter or simpler question.",
  invalid_output: "The model's answer did not match the expected format, so it was discarded.",
  server: "The provider returned a server error. Try again shortly.",
  unknown: "Something went wrong calling the AI provider.",
};

export class AiError extends Error {
  readonly kind: AiErrorKind;
  readonly status: number | null;
  readonly detail: string | null;

  constructor(kind: AiErrorKind, opts: { status?: number | null; detail?: string | null } = {}) {
    super(MESSAGES[kind]);
    this.name = "AiError";
    this.kind = kind;
    this.status = opts.status ?? null;
    this.detail = opts.detail ?? null;
  }
}

/** Map an HTTP status (and optional provider error type) to an error kind. */
export function kindFromStatus(status: number, type?: string | null): AiErrorKind {
  if (type === "overloaded_error" || status === 529) return "overloaded";
  if (status === 401) return "invalid_key";
  if (status === 403) return "permission";
  if (status === 429 || status === 402) return "rate_limit";
  if (status === 400 || status === 404 || status === 413 || status === 422) return "bad_request";
  if (status >= 500) return "server";
  return "unknown";
}

/** Keep provider error text out of the UI if it might echo the key back. */
export function scrubKey(text: string, key: string): string {
  if (!key || key.length < 8) return text;
  return text.split(key).join("[redacted]");
}
