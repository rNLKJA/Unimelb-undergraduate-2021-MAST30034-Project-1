import { DEFAULT_SETTINGS } from "./models";
import type { AiSettings, Provider } from "./types";

/**
 * Where the AI settings and the visitor's key live. Settings (provider, model) are not
 * secret and go to localStorage. The key goes to sessionStorage (cleared when the tab
 * closes) unless the visitor ticks "remember on this device", which moves it to
 * localStorage. It is never sent to this site's server.
 */

export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export const SETTINGS_KEY = "nyc-taxi-ai-settings";
export const KEY_PREFIX = "nyc-taxi-ai-key:";
export const SETTINGS_EVENT = "nyc-taxi-ai-settings-change";

export interface AiStore {
  getSettings(): AiSettings;
  saveSettings(s: AiSettings): void;
  getKey(provider: Provider): string | null;
  setKey(provider: Provider, key: string, remember: boolean): void;
  forgetKey(provider?: Provider): void;
}

export function createAiStore(
  session: KeyValueStorage,
  local: KeyValueStorage,
  onChange: () => void = () => {},
): AiStore {
  const providers: Provider[] = ["anthropic", "openai"];
  return {
    getSettings() {
      try {
        const raw = local.getItem(SETTINGS_KEY);
        if (!raw) return { ...DEFAULT_SETTINGS };
        const s = JSON.parse(raw) as Partial<AiSettings>;
        return {
          provider: s.provider === "openai" ? "openai" : "anthropic",
          anthropicModel:
            typeof s.anthropicModel === "string" ? s.anthropicModel : DEFAULT_SETTINGS.anthropicModel,
          openaiModel: typeof s.openaiModel === "string" ? s.openaiModel : DEFAULT_SETTINGS.openaiModel,
          remember: s.remember === true,
        };
      } catch {
        return { ...DEFAULT_SETTINGS };
      }
    },
    saveSettings(s) {
      local.setItem(SETTINGS_KEY, JSON.stringify(s));
      onChange();
    },
    getKey(provider) {
      return session.getItem(KEY_PREFIX + provider) ?? local.getItem(KEY_PREFIX + provider);
    },
    setKey(provider, key, remember) {
      const k = key.trim();
      if (!k) {
        this.forgetKey(provider);
        return;
      }
      const [keep, drop] = remember ? [local, session] : [session, local];
      keep.setItem(KEY_PREFIX + provider, k);
      drop.removeItem(KEY_PREFIX + provider);
      onChange();
    },
    forgetKey(provider) {
      for (const p of provider ? [provider] : providers) {
        session.removeItem(KEY_PREFIX + p);
        local.removeItem(KEY_PREFIX + p);
      }
      onChange();
    },
  };
}

const memory = (): KeyValueStorage => {
  const m = new Map<string, string>();
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
  };
};

let browserStore: AiStore | null = null;

/** The browser's store; falls back to memory where storage is unavailable (private modes, SSR). */
export function aiStore(): AiStore {
  if (browserStore) return browserStore;
  const safe = (get: () => Storage): KeyValueStorage => {
    try {
      const s = get();
      s.getItem("probe");
      return s;
    } catch {
      return memory();
    }
  };
  const hasWindow = typeof window !== "undefined";
  browserStore = createAiStore(
    hasWindow ? safe(() => window.sessionStorage) : memory(),
    hasWindow ? safe(() => window.localStorage) : memory(),
    () => hasWindow && window.dispatchEvent(new Event(SETTINGS_EVENT)),
  );
  return browserStore;
}
