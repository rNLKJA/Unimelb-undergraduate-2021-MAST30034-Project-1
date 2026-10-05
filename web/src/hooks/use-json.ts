"use client";

import { useEffect, useState } from "react";

const cache = new Map<string, Promise<unknown>>();

/** Fetch JSON once per URL per session (shared promise cache), with loading and error states. */
export function fetchJson<T>(url: string): Promise<T> {
  let p = cache.get(url) as Promise<T> | undefined;
  if (!p) {
    p = fetch(url).then((r) => {
      if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
      return r.json() as Promise<T>;
    });
    cache.set(url, p);
    p.catch(() => cache.delete(url));
  }
  return p;
}

export function useJson<T>(url: string | null): { data: T | null; error: Error | null; loading: boolean } {
  const [state, setState] = useState<{ url: string | null; data: T | null; error: Error | null }>({
    url: null,
    data: null,
    error: null,
  });
  useEffect(() => {
    if (!url) return;
    let alive = true;
    fetchJson<T>(url)
      .then((data) => alive && setState({ url, data, error: null }))
      .catch((error: Error) => alive && setState({ url, data: null, error }));
    return () => {
      alive = false;
    };
  }, [url]);
  const fresh = state.url === url;
  return {
    data: fresh ? state.data : null,
    error: fresh ? state.error : null,
    loading: !!url && (!fresh || (!state.data && !state.error)),
  };
}
