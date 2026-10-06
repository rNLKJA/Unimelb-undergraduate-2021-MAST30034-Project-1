"use client";

import { useSyncExternalStore } from "react";
import { DEFAULT_SETTINGS } from "@/lib/ai/models";
import { aiStore, KEY_PREFIX, SETTINGS_EVENT } from "@/lib/ai/settings";
import type { AiSettings, Provider } from "@/lib/ai/types";

export interface AiSettingsSnapshot {
  settings: AiSettings;
  /** last four characters of the saved key per provider, or null (the key itself stays in storage) */
  keyHint: Record<Provider, string | null>;
  /** where the key is kept */
  keyPlace: Record<Provider, "session" | "device" | null>;
}

const SERVER: AiSettingsSnapshot = {
  settings: DEFAULT_SETTINGS,
  keyHint: { anthropic: null, openai: null },
  keyPlace: { anthropic: null, openai: null },
};

let last: { sig: string; snap: AiSettingsSnapshot } | null = null;

function read(): AiSettingsSnapshot {
  const store = aiStore();
  const settings = store.getSettings();
  const hint = (p: Provider) => {
    const k = store.getKey(p);
    return k ? k.slice(-4) : null;
  };
  const place = (p: Provider): "session" | "device" | null => {
    if (!store.getKey(p)) return null;
    try {
      return window.localStorage.getItem(KEY_PREFIX + p) ? "device" : "session";
    } catch {
      return "session";
    }
  };
  const snap: AiSettingsSnapshot = {
    settings,
    keyHint: { anthropic: hint("anthropic"), openai: hint("openai") },
    keyPlace: { anthropic: place("anthropic"), openai: place("openai") },
  };
  const sig = JSON.stringify(snap);
  if (last?.sig === sig) return last.snap;
  last = { sig, snap };
  return snap;
}

function subscribe(cb: () => void) {
  window.addEventListener(SETTINGS_EVENT, cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener(SETTINGS_EVENT, cb);
    window.removeEventListener("storage", cb);
  };
}

/** AI settings and whether a key is saved; reading the key itself is left to the call site. */
export function useAiSettings(): AiSettingsSnapshot {
  return useSyncExternalStore(subscribe, read, () => SERVER);
}
