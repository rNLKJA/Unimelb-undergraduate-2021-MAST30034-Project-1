"use client";

import { Eye, EyeOff, KeyRound, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { selectClass } from "@/components/controls/field";
import { Segmented } from "@/components/controls/segmented";
import { useAiSettings } from "@/hooks/use-ai-settings";
import { ANTHROPIC_MODELS, DEFAULT_OPENAI_MODEL, KEY_HELP, PROVIDER_LABEL } from "@/lib/ai/models";
import { aiStore } from "@/lib/ai/settings";
import type { AiSettings, Provider } from "@/lib/ai/types";
import { cn } from "@/lib/utils";

const OPEN_EVENT = "nyc-taxi-open-ai-settings";

/** Open the settings dialog from anywhere (e.g. an "Add a key" button on a feature page). */
export function openAiSettings() {
  window.dispatchEvent(new Event(OPEN_EVENT));
}

/** Header button + dialog. The key is kept in this browser and sent only to the chosen provider. */
export function AiSettingsButton() {
  const { settings, keyHint } = useAiSettings();
  const dialog = useRef<HTMLDialogElement>(null);
  const [openCount, setOpenCount] = useState(0);
  const has = keyHint[settings.provider] !== null;
  useEffect(() => {
    const open = () => setOpenCount((n) => n + 1);
    window.addEventListener(OPEN_EVENT, open);
    return () => window.removeEventListener(OPEN_EVENT, open);
  }, []);
  // open the dialog only after the fresh form has mounted, so showModal() moves focus into it
  // (opening first and remounting afterwards would remove the focused element)
  useEffect(() => {
    if (openCount > 0 && !dialog.current?.open) dialog.current?.showModal();
  }, [openCount]);
  return (
    <>
      <button
        type="button"
        onClick={openAiSettings}
        aria-haspopup="dialog"
        className="text-foreground/80 hover:text-foreground hover:bg-muted relative grid size-9 place-items-center rounded-md transition-colors"
        aria-label={
          has
            ? `AI settings (${PROVIDER_LABEL[settings.provider]} key saved)`
            : "AI settings (optional, bring your own key)"
        }
        title="AI settings: bring your own key"
      >
        <KeyRound className="size-4" aria-hidden />
        {has && <span className="bg-line-green absolute top-1.5 right-1.5 size-2 rounded-full" aria-hidden />}
      </button>
      <dialog
        ref={dialog}
        aria-labelledby="ai-settings-title"
        className="bg-background text-foreground m-auto w-[min(34rem,calc(100vw-1.5rem))] rounded-lg border p-0 shadow-2xl backdrop:bg-black/50"
        onClick={(e) => {
          // a click on the backdrop closes the dialog
          if (e.target === dialog.current) dialog.current.close();
        }}
      >
        {/* remount the form on each opening so it starts from the stored settings */}
        <SettingsForm key={openCount} onClose={() => dialog.current?.close()} />
      </dialog>
    </>
  );
}

/** A typed key whose prefix belongs to the other provider. */
function keyLooksWrong(p: Provider, key: string): boolean {
  const k = key.trim();
  if (!k) return false;
  return p === "anthropic"
    ? !k.startsWith(KEY_HELP.anthropic.prefix)
    : k.startsWith(KEY_HELP.anthropic.prefix);
}

function SettingsForm({ onClose }: { onClose: () => void }) {
  const { settings, keyHint, keyPlace } = useAiSettings();
  const [draft, setDraft] = useState<AiSettings>(settings);
  const [key, setKey] = useState("");
  const [show, setShow] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const keyId = useId();
  const modelId = useId();
  const rememberId = useId();
  const p = draft.provider;
  const store = aiStore();

  const save = () => {
    store.saveSettings(draft);
    if (key.trim()) store.setKey(p, key, draft.remember);
    else if (keyHint[p] && keyPlace[p] !== (draft.remember ? "device" : "session")) {
      // move an existing key to the newly chosen storage
      const current = store.getKey(p);
      if (current) store.setKey(p, current, draft.remember);
    }
    setKey("");
    setMessage(
      key.trim()
        ? `${PROVIDER_LABEL[p]} key saved ${draft.remember ? "on this device" : "for this tab"}.`
        : "Settings saved.",
    );
  };

  return (
    <form
      method="dialog"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
      className="grid gap-5 p-5 sm:p-6"
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="kicker text-taxi-text">Optional</p>
          <h2 id="ai-settings-title" className="font-condensed text-3xl font-extrabold uppercase">
            AI settings
          </h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="hover:bg-muted grid size-9 place-items-center rounded-md"
          aria-label="Close AI settings"
        >
          <X className="size-4" aria-hidden />
        </button>
      </div>
      <p className="text-muted-foreground font-serif text-[15px] leading-relaxed">
        Everything on this site works without AI. To try &ldquo;Ask the data&rdquo;, paste your own API key.
        Your browser sends it straight to the provider you pick. It is never sent to this site&apos;s server,
        never logged, and calls are billed to your account.
      </p>

      <div className="grid gap-1.5">
        <span className="kicker text-muted-foreground">Provider</span>
        <Segmented<Provider>
          label="AI provider"
          value={p}
          onChange={(v) => {
            setDraft({ ...draft, provider: v });
            // a key typed for one provider must not be saved under the other
            setKey("");
            setShow(false);
          }}
          options={[
            { value: "anthropic", label: "Anthropic (default)" },
            { value: "openai", label: "OpenAI" },
          ]}
        />
      </div>

      <div className="grid gap-1.5">
        <label htmlFor={modelId} className="kicker text-muted-foreground">
          Model
        </label>
        {p === "anthropic" ? (
          <>
            <select
              id={modelId}
              className={selectClass}
              value={draft.anthropicModel}
              onChange={(e) => setDraft({ ...draft, anthropicModel: e.target.value })}
            >
              {ANTHROPIC_MODELS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label} ({m.id})
                </option>
              ))}
            </select>
            <p className="text-muted-foreground text-xs">
              {ANTHROPIC_MODELS.find((m) => m.id === draft.anthropicModel)?.note}
            </p>
          </>
        ) : (
          <>
            <input
              id={modelId}
              className={cn(selectClass, "font-mono")}
              value={draft.openaiModel}
              spellCheck={false}
              onChange={(e) => setDraft({ ...draft, openaiModel: e.target.value })}
              placeholder={DEFAULT_OPENAI_MODEL}
            />
            <p className="text-muted-foreground text-xs">
              Any Chat Completions model that supports JSON-schema output.
            </p>
          </>
        )}
      </div>

      <div className="grid gap-1.5">
        <label htmlFor={keyId} className="kicker text-muted-foreground">
          {PROVIDER_LABEL[p]} API key
        </label>
        <div className="flex gap-2">
          <input
            id={keyId}
            type={show ? "text" : "password"}
            autoComplete="off"
            spellCheck={false}
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder={keyHint[p] ? `Saved key ends in …${keyHint[p]}` : `${KEY_HELP[p].prefix}…`}
            className={cn(selectClass, "font-mono")}
          />
          <button
            type="button"
            onClick={() => setShow((s) => !s)}
            className="hover:bg-muted grid size-9 shrink-0 place-items-center rounded-md border"
            aria-label={show ? "Hide key" : "Show key"}
            aria-pressed={show}
          >
            {show ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
          </button>
        </div>
        {keyLooksWrong(p, key) && (
          <p className="text-line-orange text-xs font-medium" role="status">
            This does not look like {p === "anthropic" ? "an Anthropic" : "an OpenAI"} key (
            {p === "anthropic" ? "they start with sk-ant-" : "sk-ant- keys belong to Anthropic"}).
          </p>
        )}
        <p className="text-muted-foreground text-xs">
          {keyHint[p]
            ? `A key ending in …${keyHint[p]} is saved ${keyPlace[p] === "device" ? "on this device (localStorage)" : "for this tab (sessionStorage)"}.`
            : "No key saved for this provider."}{" "}
          Create one at{" "}
          <a className="link-taxi" href={KEY_HELP[p].url} target="_blank" rel="noreferrer">
            {new URL(KEY_HELP[p].url).host}
          </a>
          . A key with a low spending limit is a good idea.
        </p>
      </div>

      <label htmlFor={rememberId} className="flex items-start gap-2.5 text-sm">
        <input
          id={rememberId}
          type="checkbox"
          checked={draft.remember}
          onChange={(e) => setDraft({ ...draft, remember: e.target.checked })}
          className="accent-foreground mt-0.5 size-4"
        />
        <span>
          Remember on this device
          <span className="text-muted-foreground block text-xs">
            Off: the key is kept in sessionStorage and forgotten when you close this tab. On: it stays in this
            browser&apos;s localStorage until you forget it.
          </span>
        </span>
      </label>

      {message && (
        <p role="status" className="bg-card rounded-md border px-3 py-2 text-sm">
          {message}
        </p>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="hover:bg-muted rounded-md border px-3 py-2 text-sm font-medium disabled:opacity-50"
            disabled={!keyHint[p]}
            onClick={() => {
              store.forgetKey(p);
              setKey("");
              setMessage(`${PROVIDER_LABEL[p]} key forgotten.`);
            }}
          >
            Forget key
          </button>
          <Link href="/ai-log" onClick={onClose} className="link-taxi self-center text-sm">
            AI audit log
          </Link>
          <Link href="/methods#ai-use" onClick={onClose} className="link-taxi self-center text-sm">
            AI use statement
          </Link>
        </div>
        <button type="submit" className="bg-taxi text-taxi-ink rounded-md px-4 py-2 text-sm font-semibold">
          Save
        </button>
      </div>
    </form>
  );
}
