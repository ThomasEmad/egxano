// Tiny in-memory response cache for expensive, rarely-changing computations.
// stale-while-revalidate with a HARD staleness bound: an expired entry is
// served instantly while a single-flight background refresh runs, but past
// maxStaleMs the caller WAITS for the refresh — a failing refresh can never
// pin a poison value forever. All entries are invalidated whenever the data
// pipeline recomputes (recompute-all, financial-ops edits) — the DB stays the
// source of truth.

const store = new Map<
  string,
  { value: unknown; at: number; refreshing?: boolean; waiters?: ((v: unknown) => void)[] }
>()

export async function cached<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const maxStaleMs = ttlMs * 5
  const hit = store.get(key)
  if (hit) {
    const age = Date.now() - hit.at
    if (age < ttlMs) return hit.value as T
    if (age < maxStaleMs) {
      // stale but tolerable: serve it and refresh in the background (one
      // refresh at a time); late waiters receive the refreshed value.
      if (!hit.refreshing) {
        hit.refreshing = true
        fn()
          .then((value) => {
            const waiters = hit.waiters ?? []
            store.set(key, { value, at: Date.now() })
            for (const w of waiters) (w as (v: unknown) => void)(value)
          })
          .catch(() => {
            hit.refreshing = false
          })
      }
      return hit.value as T
    }
    // beyond the staleness bound: block on a single-flight refresh
    if (hit.refreshing && hit.waiters) {
      return new Promise<T>((resolve) => hit.waiters!.push((v) => resolve(v as T))) as T
    }
    hit.refreshing = true
    hit.waiters = []
    try {
      const value = await fn()
      const waiters = hit.waiters
      store.set(key, { value, at: Date.now() })
      for (const w of waiters ?? []) w(value as unknown)
      return value
    } catch (e) {
      hit.refreshing = false
      hit.waiters = []
      // refresh failed past the bound — serve the last known value rather
      // than erroring (the next call retries); if there is none, rethrow.
      if (hit.value !== undefined) return hit.value as T
      throw e
    }
  }
  const value = await fn()
  store.set(key, { value, at: Date.now() })
  return value
}

export function invalidateServerCache(): void {
  store.clear()
}

/** Age (ms) of the in-process value for `key`, or null when nothing is stored.
 *  Lets cold-start helpers decide between serving memory, a persisted
 *  snapshot, or paying the build. */
export function peekCacheAgeMs(key: string): number | null {
  const hit = store.get(key)
  if (!hit) return null
  return Date.now() - hit.at
}
