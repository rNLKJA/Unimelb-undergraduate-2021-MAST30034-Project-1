/**
 * Token bucket per client key, held in memory. On serverless hosting each instance keeps its
 * own buckets, so this slows down a single noisy client rather than enforcing a global quota.
 */
interface Bucket {
  tokens: number;
  at: number;
}

/** /api/sql: queries per client address per minute, per server instance (best effort, not a firewall). */
export const SQL_RATE_LIMIT = { tokens: 20, perMs: 60_000 };

const buckets = new Map<string, Bucket>();
const MAX_KEYS = 10_000;

/**
 * Take one token for `key` from a bucket of `capacity` tokens that refills completely every
 * `perMs`. Returns 0 if the request may proceed, otherwise the milliseconds until a token is free.
 */
export function takeToken(key: string, capacity: number, perMs: number, now = Date.now()): number {
  const rate = capacity / perMs;
  const b = buckets.get(key) ?? { tokens: capacity, at: now };
  b.tokens = Math.min(capacity, b.tokens + (now - b.at) * rate);
  b.at = now;
  if (b.tokens < 1) {
    buckets.set(key, b);
    return Math.ceil((1 - b.tokens) / rate);
  }
  b.tokens -= 1;
  buckets.delete(key); // re-insert so the Map stays in least-recently-used order
  buckets.set(key, b);
  while (buckets.size > MAX_KEYS) buckets.delete(buckets.keys().next().value!);
  return 0;
}

/** Forget every bucket (tests). */
export function resetRateLimits(): void {
  buckets.clear();
}
