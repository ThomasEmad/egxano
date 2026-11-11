import { cached } from "@/lib/server-cache"

/**
 * Retry helper for POOL-TIMEOUT errors on idempotent hot-path reads.
 * Under request storms the small pgbouncer pool can momentarily saturate;
 * a single fast retry (after the burst drains) recovers most of those
 * without materially hurting p99. Anything else rethrows untouched.
 */
export async function readWithRetry<T>(fn: () => Promise<T>, attempts = 2, backoffMs = 250): Promise<T> {
  let lastErr: unknown
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn()
    } catch (e) {
      lastErr = e
      const msg = e instanceof Error ? e.message : String(e)
      if (!/connection pool|Timed out fetching/i.test(msg)) throw e
      if (i < attempts - 1) await new Promise((r) => setTimeout(r, backoffMs))
    }
  }
  throw lastErr
}

/** cached() + pool-timeout retry, for user-independent hot-path reads. */
export async function cachedRead<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  return cached(key, ttlMs, () => readWithRetry(fn))
}
