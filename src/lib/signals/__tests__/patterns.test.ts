// =============================================================================
// Pattern detector regression tests (2026-11-19 audit fixes):
//   • detectBreakout — a SAME-DAY cross must fire: buildZoneMap marks the zone
//     broken on the crossing bar itself, so the old `!z.broken` guard made the
//     breakout archetype dead code (every fresh break was misfiled as retest
//     structure and no candidate was ever produced).
//   • detectContinuation — the pullback leg + resumption conjunction compared
//     the same two closes in OPPOSITE directions (empty conjunction); the
//     archetype never fired.
// =============================================================================

import { describe, expect, it } from "vitest"
import { detectBreakout, detectContinuation, detectOpportunities } from "../patterns"
import { computeMetrics } from "../metrics"
import { buildZoneMap } from "../levels"
import type { Bar } from "../types"

/** One controlled session with a UNIQUE ts (buildZoneMap matches brokenTs === last.ts). */
function bar(i: number, open: number, high: number, low: number, close: number, volume = 1000): Bar {
  return { ts: `2026-${String(Math.floor(i / 28) + 1).padStart(2, "0")}-${String((i % 28) + 1).padStart(2, "0")}`, open, high, low, close, volume }
}

/** A smooth uptrend ending at `p` (deterministic wobble, like engine.test). */
function uptrend(n: number, from = 60, step = 0.35): Bar[] {
  const out: Bar[] = []
  let p = from
  for (let i = 0; i < n; i++) {
    const noise = i % 3 === 0 ? -0.2 : i % 3 === 1 ? 0.15 : 0
    const c = p + step + noise
    out.push(bar(i, p, Math.max(p, c) + 0.15, Math.min(p, c) - 0.15, c))
    p = c
  }
  return out
}

describe("detectBreakout — the same-day cross IS the breakout", () => {
  // two touches of ~100 → a 2× resistance zone; price holds under it, then
  // TODAY's close (103) crosses. buildZoneMap marks the zone broken on that
  // very bar — the detector must still fire (the old code returned null).
  function breakoutSeries(): Bar[] {
    const closes = [90, 92, 95, 98, 100, 97, 95, 96, 98, 100.2, 97, 95, 96, 97, 103]
    const bars: Bar[] = []
    for (let i = 0; i < closes.length; i++) {
      const open = i === 0 ? closes[0] : closes[i - 1]
      bars.push(bar(i, open, Math.max(open, closes[i]) + 0.15, Math.min(open, closes[i]) - 0.15, closes[i]))
    }
    return bars
  }

  it("detectBreakout fires directly on a 2-touch zone crossed by today's close", () => {
    const bars = breakoutSeries()
    const m = computeMetrics(bars)!
    const map = buildZoneMap(bars)
    const zone = map.zones.find((z) => z.kind === "resistance" && z.touches >= 2)
    expect(zone).toBeDefined()
    expect(zone!.broken).toBe(true) // buildZoneMap already flags the crossing day
    const d = detectBreakout(bars, map, m)
    expect(d).not.toBeNull()
    expect(d!.type).toBe("breakout")
    expect(d!.level).toBeCloseTo(zone!.high, 6)
    expect(d!.facts[0].ar).toContain("اخترق منطقة مقاومة 2×")
  })

  it("integration: detectOpportunities publishes a breakout buy candidate", () => {
    const bars = breakoutSeries()
    const m = computeMetrics(bars)!
    const { buyCandidates } = detectOpportunities(bars, m)
    expect(buyCandidates.some((d) => d.type === "breakout")).toBe(true)
  })
})

describe("detectContinuation — pullback + resumption fires", () => {
  // textbook uptrend, ONE pullback close (yesterday), resumption today
  function continuationSeries(): Bar[] {
    const bars = uptrend(70)
    const n = bars.length
    const p = bars[n - 1].close
    bars[n - 1] = bar(n - 1, p, p + 0.15, p - 2.5, p - 2) // the pullback day
    bars.push(bar(n, p - 2, p + 0.6, p - 2.4, p + 0.5)) // resumption today
    return bars
  }

  it("detectContinuation fires after a single pullback close inside an intact uptrend", () => {
    const bars = continuationSeries()
    const m = computeMetrics(bars)!
    const d = detectContinuation(bars, buildZoneMap(bars), m)
    expect(d).not.toBeNull()
    expect(d!.type).toBe("continuation")
    expect(d!.strength).toBeGreaterThanOrEqual(0.45)
  })

  it("integration: detectOpportunities publishes a continuation candidate", () => {
    const bars = continuationSeries()
    const m = computeMetrics(bars)!
    const { buyCandidates } = detectOpportunities(bars, m)
    expect(buyCandidates.some((d) => d.type === "continuation")).toBe(true)
  })
})
