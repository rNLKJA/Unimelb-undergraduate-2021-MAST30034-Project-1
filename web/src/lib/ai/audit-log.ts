import type { AuditEntry, HumanDecision } from "./types";

/**
 * The AI audit log: every AI call made on this site from this browser, stored in IndexedDB
 * (the site has no writable server-side database). Viewable and exportable at /ai-log.
 */

export type NewAuditEntry = Omit<AuditEntry, "id" | "timestamp" | "decided_at" | "edited_output">;

export interface AuditStore {
  add(entry: NewAuditEntry, secrets?: string[]): Promise<AuditEntry>;
  setDecision(id: string, decision: HumanDecision, editedOutput?: unknown): Promise<AuditEntry | null>;
  list(): Promise<AuditEntry[]>;
  clear(): Promise<void>;
}

export const AUDIT_DB = "nyc-taxi-2019-ai-audit";
const STORE = "entries";
export const AUDIT_EVENT = "nyc-taxi-ai-audit-change";

/** Replace any occurrence of a secret (the API key) anywhere in a value, deeply. */
export function redactSecrets<T>(value: T, secrets: readonly string[]): T {
  const live = secrets.filter((s) => s && s.length >= 8);
  if (!live.length) return value;
  const walk = (v: unknown): unknown => {
    if (typeof v === "string") return live.reduce((s, k) => s.split(k).join("[redacted]"), v);
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object")
      return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    return v;
  };
  return walk(value) as T;
}

function newId(): string {
  const c = globalThis.crypto;
  if (c?.randomUUID) return c.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

function notify() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(AUDIT_EVENT));
}

export function indexedDbAuditStore(factory: IDBFactory = globalThis.indexedDB): AuditStore {
  let opened: Promise<IDBDatabase> | null = null;
  const open = () => {
    opened ??= new Promise((resolve, reject) => {
      const r = factory.open(AUDIT_DB, 1);
      r.onupgradeneeded = () => {
        const store = r.result.createObjectStore(STORE, { keyPath: "id" });
        store.createIndex("timestamp", "timestamp");
      };
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    return opened;
  };

  return {
    async add(entry, secrets = []) {
      const full: AuditEntry = redactSecrets(
        { ...entry, id: newId(), timestamp: new Date().toISOString(), decided_at: null, edited_output: null },
        secrets,
      );
      const db = await open();
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(full);
      await done(tx);
      notify();
      return full;
    },
    async setDecision(id, decision, editedOutput) {
      const db = await open();
      const tx = db.transaction(STORE, "readwrite");
      const store = tx.objectStore(STORE);
      const current = (await req(store.get(id))) as AuditEntry | undefined;
      if (!current) {
        await done(tx);
        return null;
      }
      const next: AuditEntry = {
        ...current,
        human_decision: decision,
        decided_at: new Date().toISOString(),
        edited_output: decision === "edited" ? (editedOutput ?? null) : null,
      };
      store.put(next);
      await done(tx);
      notify();
      return next;
    },
    async list() {
      const db = await open();
      const tx = db.transaction(STORE, "readonly");
      const all = (await req(tx.objectStore(STORE).index("timestamp").getAll())) as AuditEntry[];
      return all.reverse();
    },
    async clear() {
      const db = await open();
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).clear();
      await done(tx);
      notify();
    },
  };
}

let shared: AuditStore | null = null;

/** The browser's audit store (one per page). */
export function auditStore(): AuditStore {
  shared ??= indexedDbAuditStore();
  return shared;
}
