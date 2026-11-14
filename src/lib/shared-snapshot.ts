// =============================================================================
// Shared read-model snapshots — the persisted fallback for hot dashboard reads.
//
// The in-memory `cached()` SWR layer lives per serverless instance: every
// freshly-scaled instance re-pays the cold build (the market valuation screen
// alone measured ~14–29s on hosted Postgres). This helper persists every
// successful build into the existing `Setting` table (the same pattern as
// market_ticker_snapshot_v1) and lets a cold instance serve that snapshot
// instantly while the real build refreshes in the background.
//
// Honesty: a snapshot is only served within an explicit maxAge; `asOf`/
// computedAt stay inside the payload; the response header Server-Timing
// carries the serving source so field measurements distinguish memory /
// snapshot / compute.
// =============================================================================

import { db } from "@/lib/db"
import { cached, peekCacheAgeMs } from "@/lib/server-cache"

/** Write-behind persist. Never throws — a failed write must not break the read. */
export async function persistSharedSnapshot(key: string, value: unknown): Promise<boolean> {
  try {
    const json = JSON.stringify(value)
    await db.setting.upsert({
      where: { key },
      create: { key, value: json, type: "json", description: `Shared read-model snapshot: ${key}` },
      update: { value: json },
    })
    return true
  } catch {
    return false
  }
}

/** Read a persisted snapshot if it exists and is fresh enough. Null otherwise. */
export async function readSharedSnapshot<T>(key: string, maxAgeMs: number): Promise<T | null> {
  try {
    const row = await db.setting.findUnique({ where: { key }, select: { value: true } })
    if (!row) return null
    const parsed = JSON.parse(row.value) as { savedAt?: string; payload?: T }
    // Payloads persisted by this helper wrap {savedAt, payload}; bare legacy
    // values are accepted as-is (their freshness is then unknown → rejected).
    if (parsed && typeof parsed === "object" && "payload" in parsed && parsed.payload !== undefined) {
      const savedAt = parsed.savedAt ? new Date(parsed.savedAt).getTime() : NaN
      if (!Number.isFinite(savedAt) || Date.now() - savedAt > maxAgeMs) return null
      return parsed.payload
    }
    return null
  } catch {
    return null
  }
}

export interface ServedWithSnapshot<T> {
  value: T
  /** memory = fresh/stale in-process cache, snapshot = persisted read model, compute = built now */
  source: "memory" | "stale-memory" | "snapshot" | "compute"
}

/**
 * Serve `build()` through the in-memory SWR cache with a persisted-snapshot
 * fallback for cold instances. The persisted copy is written inside the
 * single-flight build (write-behind — never fails or slows the build path
 * beyond its awaited upsert).
 */
export async function serveWithSnapshot<T>(opts: {
  cacheKey: string
  ttlMs: number
  settingKey: string
  /** max age of a persisted snapshot we are willing to serve on a cold start */
  snapshotMaxAgeMs: number
  build: () => Promise<T>
}): Promise<ServedWithSnapshot<T>> {
  const { cacheKey, ttlMs, settingKey, snapshotMaxAgeMs, build } = opts
  const age = peekCacheAgeMs(cacheKey)
  if (age !== null) {
    // In-process value exists (fresh or within the SWR staleness bound) — the
    // normal cached() path serves it and refreshes in the background.
    const value = await cached(cacheKey, ttlMs, build)
    return { value, source: age < ttlMs ? "memory" : "stale-memory" }
  }
  // Cold instance: try the persisted snapshot, refresh in the background.
  const snap = await readSharedSnapshot<T>(settingKey, snapshotMaxAgeMs)
  if (snap !== null) {
    void cached(cacheKey, ttlMs, async () => {
      const value = await build()
      await persistSharedSnapshot(settingKey, { savedAt: new Date().toISOString(), payload: value })
      return value
    }).catch(() => {})
    return { value: snap, source: "snapshot" }
  }
  // Nothing persisted yet — pay the build (single-flight) and persist it.
  const value = await cached(cacheKey, ttlMs, async () => {
    const built = await build()
    await persistSharedSnapshot(settingKey, { savedAt: new Date().toISOString(), payload: built })
    return built
  })
  return { value, source: "compute" }
}
