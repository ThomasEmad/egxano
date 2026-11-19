// =============================================================================
// server-cache — the bounded-store fix (2026-11-19): the cache is fed
// user-controlled keys (the position-review key embeds the caller's price),
// so the map must not grow forever. The cap (500) evicts oldest-by-insertion;
// the cached()/invalidate/peek API and the stale-while-revalidate semantics
// are unchanged.
// =============================================================================

import { afterEach, describe, expect, it } from "vitest"
import { cached, invalidateServerCache, peekCacheAgeMs } from "../server-cache"

afterEach(() => invalidateServerCache())

describe("server-cache — bounded store", () => {
  it("filling 501 entries caps the store: the oldest insertion is gone, the newest stays cached", async () => {
    let builds = 0
    for (let i = 0; i < 501; i++) {
      await cached(`k${i}`, 60_000, async () => {
        builds++
        return i
      })
    }
    expect(builds).toBe(501) // every key built exactly once
    expect(peekCacheAgeMs("k0")).toBeNull() // evicted (oldest)
    expect(peekCacheAgeMs("k1")).not.toBeNull() // 500 entries remain: k1..k500
    expect(peekCacheAgeMs("k500")).not.toBeNull() // the newest survives
    // the live newest entry is served from the cache, not rebuilt
    const again = await cached("k500", 60_000, async () => {
      builds++
      return -1
    })
    expect(again).toBe(500)
    expect(builds).toBe(501)
  })

  it("further inserts keep evicting strictly oldest-first", async () => {
    for (let i = 0; i < 502; i++) await cached(`j${i}`, 60_000, async () => i)
    expect(peekCacheAgeMs("j0")).toBeNull()
    expect(peekCacheAgeMs("j1")).toBeNull()
    expect(peekCacheAgeMs("j2")).not.toBeNull()
    expect(peekCacheAgeMs("j501")).not.toBeNull()
  })

  it("stale-while-revalidate semantics are unchanged under the cap", async () => {
    let n = 0
    expect(await cached("swr", 30, async () => ++n)).toBe(1) // fresh build
    await new Promise((r) => setTimeout(r, 40)) // stale, but within maxStale (5×)
    expect(await cached("swr", 30, async () => ++n)).toBe(1) // served stale, refreshed in background
    await new Promise((r) => setTimeout(r, 10)) // let the background refresh land
    expect(await cached("swr", 30, async () => ++n)).toBe(2) // the refreshed value
  })
})
