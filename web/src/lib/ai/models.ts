import type { AiSettings, Provider } from "./types";

export interface AnthropicModelInfo {
  id: string;
  label: string;
  note: string;
  /** accepts a temperature parameter (Claude Sonnet 5.5 rejects non-default sampling values) */
  temperature: boolean;
  /** output_config.effort to send, or null where the model has no effort control */
  effort: "low" | "medium" | "high" | null;
  /** opt in to server-side refusal fallbacks (fallbacks: "default") */
  fallbacks: boolean;
}

/** Anthropic models offered in the settings dialog; the first is the default (cheapest). */
export const ANTHROPIC_MODELS: readonly AnthropicModelInfo[] = [
  {
    id: "claude-haiku-4-5",
    label: "Claude Haiku 4.5",
    note: "Default. Cheapest and fastest; $1 / $5 per million input / output tokens.",
    temperature: true,
    effort: null,
    fallbacks: false,
  },
  {
    id: "claude-sonnet-5-5",
    label: "Claude Sonnet 5.5",
    note: "Stronger on harder questions; $2 / $10 per million tokens. Runs at low effort with server-side refusal fallback.",
    temperature: false,
    effort: "low",
    fallbacks: true,
  },
];

export const DEFAULT_OPENAI_MODEL = "gpt-5-mini";

export const DEFAULT_SETTINGS: AiSettings = {
  provider: "anthropic",
  anthropicModel: ANTHROPIC_MODELS[0].id,
  openaiModel: DEFAULT_OPENAI_MODEL,
  remember: false,
};

export function anthropicModel(id: string): AnthropicModelInfo {
  return ANTHROPIC_MODELS.find((m) => m.id === id) ?? ANTHROPIC_MODELS[0];
}

export function activeModel(s: AiSettings): string {
  return s.provider === "anthropic"
    ? anthropicModel(s.anthropicModel).id
    : s.openaiModel.trim() || DEFAULT_OPENAI_MODEL;
}

export const PROVIDER_LABEL: Record<Provider, string> = { anthropic: "Anthropic", openai: "OpenAI" };

/** Where each provider's keys are created, for the settings dialog. */
export const KEY_HELP: Record<Provider, { url: string; prefix: string }> = {
  anthropic: { url: "https://platform.claude.com/settings/keys", prefix: "sk-ant-" },
  openai: { url: "https://platform.openai.com/api-keys", prefix: "sk-" },
};
