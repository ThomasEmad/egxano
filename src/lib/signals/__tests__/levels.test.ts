// =============================================================================
// Signal engine v2 — the zone-map classification tests (PURE).
// OWNER BUG (2026-11-18, OCPH «اكتوبر فارما»): a stock that rallied ~100 → 208
// kept its base ceiling cluster (97.44–101.00, swing HIGH pivots) labeled
// "resistance" forever — the position review then printed it as «أقرب مقاومة»
// at −52٪ UNDER the live close. The map now carries a DUAL label: `kind` stays
// the historical pivot origin (the transition detectors' evidence), and
// `positionKind` is re-derived against the CURRENT last close at build time.
// The OCPH-shaped series below replays that exact anatomy: a ~97–101 base,
// a two-leg rally with real pullback floors, a 230–240 double top, and a final
// session closing at 208.18.
// =============================================================================

import { describe, expect, it } from "vitest"
import { buildZoneMap, nearestResistanceAbove, nearestSupportBelow } from "../levels"
import type { Bar } from "../types"

/** Fresh per-series session stamp factory (deterministic within one series). */
function makeStamps() {
  let seq = 0
  return () => `2026-S${String(++seq).padStart(4, "0")}`
}

/** OCPH anatomy: ~97–101 base (swing-high cluster 100.8–101.0 + swing-low
 *  cluster 97.44–97.6), a two-leg rally with 150 and 180 pullback floors, a
 *  230–240 double top with a 231 dip floor, then a slide to the last close
 *  208.18. Ramps/declines are strictly monotone so they never plant pivots. */
export function ocphRallySeries(): Bar[] {
  const stamp = makeStamps()
  const bar = (open: number, high: number, low: number, close: number, volume = 1000): void => {
    bars.push({ ts: stamp(), open, high: Math.max(high, open, close), low: Math.min(low, open, close), close, volume })
  }
  const ramp = (from: number, to: number, n: number): number => {
    const step = (to - from) / n
    let prev = from
    for (let i = 0; i < n; i++) {
      const c = prev + step
      bar(prev, c + 0.15, c - 0.15, c)
      prev = c
    }
    return prev
  }
  const decline = (from: number, to: number, n: number): number => {
    const step = (to - from) / n
    let prev = from
    for (let i = 0; i < n; i++) {
      const c = prev + step
      bar(prev, prev + 0.15, c - 0.15, c)
      prev = c
    }
    return prev
  }
  /** 10 sessions planting pivot LOWS at `level` and `level+0.4` (≥4 sessions
   *  apart so both survive the PIVOT_K=3 window) → ONE 2× support zone. */
  const plantDoubleBottom = (level: number, entry: number): number => {
    const rows: [number, number, number][] = [
      [entry, entry + 0.3, level + 0.6],
      [level + 0.5, level + 0.8, level + 0.2],
      [level + 0.3, level + 0.6, level], // pivot low #1
      [level + 0.8, level + 1.1, level + 0.5],
      [level + 1.0, level + 1.3, level + 0.7],
      [level + 0.8, level + 1.1, level + 0.5],
      [level + 0.9, level + 1.2, level + 0.4], // pivot low #2
      [level + 1.2, level + 1.5, level + 0.8],
      [level + 1.6, level + 1.9, level + 1.2],
      [level + 2.0, level + 2.3, level + 1.6],
    ]
    for (const [c, h, l] of rows) bar(c, h, l, c)
    return level + 2.0
  }

  const bars: Bar[] = []
  // ---- the base (sessions 0–13): 4 hand-planted pivots
  const base: [number, number, number][] = [
    [98.0, 98.4, 97.6],
    [99.0, 99.4, 98.6],
    [99.8, 100.2, 99.4],
    [100.6, 101.0, 100.2], // pivot high 101.0
    [99.4, 99.8, 99.0],
    [98.2, 98.6, 97.8],
    [97.9, 98.3, 97.44], // pivot low 97.44
    [98.6, 99.0, 98.2],
    [99.6, 100.0, 99.2],
    [100.4, 100.8, 100.0], // pivot high 100.8
    [99.0, 99.4, 98.6],
    [98.0, 98.4, 97.6], // pivot low 97.6
    [98.6, 99.0, 98.2],
    [99.4, 99.8, 99.0],
  ]
  for (const [c, h, l] of base) bar(c, h, l, c)
  // ---- the rally: leg 1 to 160, pullback floor at 150, leg 2 to 195,
  //      pullback floor at 180, final leg into the 230–240 top
  ramp(99.4, 160, 18)
  decline(160, 150.6, 6)
  plantDoubleBottom(150.0, 150.6)
  ramp(152.0, 195, 13)
  decline(195, 180.6, 6)
  plantDoubleBottom(180.0, 180.6)
  ramp(182.0, 232.0, 15)
  // ---- the top: double top 236.5 / 239.5 with a dip floor at 231.0
  const top: [number, number, number][] = [
    [233.0, 233.4, 232.6],
    [235.0, 235.4, 234.6],
    [236.2, 236.5, 235.9], // pivot high 236.5
    [234.0, 234.4, 233.6],
    [232.0, 232.4, 231.6],
    [231.2, 231.6, 231.0], // pivot low 231.0 (the dip floor)
    [233.0, 233.4, 232.6],
    [235.5, 235.9, 235.1],
    [239.0, 239.5, 238.6], // pivot high 239.5
    [236.0, 236.4, 235.6],
    [233.5, 233.9, 233.1],
    [231.5, 231.9, 231.1],
  ]
  for (const [c, h, l] of top) bar(c, h, l, c)
  // ---- the slide to the last close (never pivots: monotone)
  decline(231.5, 208.18, 6)
  return bars
}

describe("buildZoneMap — the OCPH classification (rally ~100 → 208.18)", () => {
  it("the base ceiling cluster is structural support/history now — never a resistance again", () => {
    const bars = ocphRallySeries()
    const map = buildZoneMap(bars)
    const close = bars[bars.length - 1].close
    expect(close).toBeCloseTo(208.18, 6)
    // the old ceiling: swing-HIGH pivots at 100.8–101.0 — the exact zone the
    // bug surfaced as «أقرب مقاومة» at −52٪ under the close
    const ceiling = map.zones.find((z) => z.low === 100.8 && z.high === 101)
    expect(ceiling).toBeDefined()
    expect(ceiling!.kind).toBe("resistance") // the historical origin is evidence — kept
    expect(ceiling!.positionKind).toBe("support") // the CURRENT truth: high < close
    // every 97–101 cluster (ceiling + base floor) is support-positioned now
    const baseClusters = map.zones.filter((z) => z.low >= 97 && z.high <= 101)
    expect(baseClusters.length).toBeGreaterThanOrEqual(2)
    expect(baseClusters.every((z) => z.positionKind === "support")).toBe(true)
    expect(baseClusters.some((z) => z.positionKind === "resistance")).toBe(false)
  })

  it("every current-position resistance sits fully above the close — and the old top floor flips to resistance", () => {
    const bars = ocphRallySeries()
    const map = buildZoneMap(bars)
    const close = bars[bars.length - 1].close
    const resistances = map.zones.filter((z) => z.positionKind === "resistance")
    expect(resistances.length).toBeGreaterThan(0)
    expect(resistances.every((z) => z.low > close)).toBe(true)
    const supports = map.zones.filter((z) => z.positionKind === "support")
    expect(supports.every((z) => z.high < close)).toBe(true)
    // the unbroken 236.5–239.5 top zone stays a resistance (origin + position agree)
    const top = resistances.find((z) => z.low === 236.5 && z.high === 239.5)
    expect(top).toBeDefined()
    expect(top!.kind).toBe("resistance")
    expect(top!.broken).toBe(false)
    // THE MIRROR RULE: the 231.0 dip floor (a swing-LOW cluster) now sits fully
    // ABOVE the close — it can never be a support again
    const topFloor = map.zones.find((z) => z.low === 231 && z.high === 231)
    expect(topFloor).toBeDefined()
    expect(topFloor!.kind).toBe("support") // historical origin kept
    expect(topFloor!.positionKind).toBe("resistance") // overhead supply now
  })

  it("nearestSupportBelow returns the nearest structural floor under the query price", () => {
    const bars = ocphRallySeries()
    const map = buildZoneMap(bars)
    // under the 208.18 close the nearest shelf is the cleared 195 leg-top
    // (a real swing high the rally turned into a floor)
    const near = nearestSupportBelow(map, 208.18)
    expect(near).not.toBeNull()
    expect(near!.low).toBeCloseTo(195.15, 6)
    expect(near!.positionKind).toBe("support")
    expect(near!.broken).toBe(true)
    // deeper query: under 190 the nearest floor is the 2× pullback base
    const deep = nearestSupportBelow(map, 190)
    expect(deep).not.toBeNull()
    expect(deep!.low).toBe(180)
    expect(deep!.high).toBe(180.4)
    expect(deep!.touches).toBe(2)
  })

  it("nearestSupportBelow treats a fresh breakout's base as the floor just below", () => {
    const bars = ocphRallySeries()
    const map = buildZoneMap(bars)
    // 103.5 = the first sessions after the rally left the 97–101 base: the
    // breakout base (old ceiling cluster) IS the nearest shelf under the price
    const floor = nearestSupportBelow(map, 103.5)
    expect(floor).not.toBeNull()
    expect(floor!.low).toBe(100.8)
    expect(floor!.high).toBe(101)
  })

  it("nearestResistanceAbove still finds the unbroken overhead zone above the close", () => {
    const bars = ocphRallySeries()
    const map = buildZoneMap(bars)
    const over = nearestResistanceAbove(map, 208.18)
    expect(over).not.toBeNull()
    expect(over!.low).toBe(236.5)
    expect(over!.high).toBe(239.5)
    expect(over!.broken).toBe(false)
  })

  it("evidence survives relabeling (touches / broken / lastTouchTs untouched)", () => {
    const bars = ocphRallySeries()
    const map = buildZoneMap(bars)
    const ceiling = map.zones.find((z) => z.low === 100.8 && z.high === 101)!
    expect(ceiling.touches).toBe(2)
    expect(ceiling.lastTouchIdx).toBe(9)
    expect(ceiling.lastTouchTs).toBe(bars[9].ts)
    expect(ceiling.broken).toBe(true)
    // the break session is the first close above the zone top — unchanged
    const firstAbove = bars.find((b) => b.close > 101)!.ts
    expect(ceiling.brokenTs).toBe(firstAbove)
  })
})

describe("buildZoneMap — overlapping zones keep their historical kind", () => {
  it("a zone the close sits INSIDE keeps its historical label (the market is testing it now)", () => {
    // 14 sessions around 102–103.5 ending INSIDE the 2× resistance 103.5–103.9
    const stamp = makeStamps()
    const bars: Bar[] = []
    const b = (c: number, h: number, l: number) => bars.push({ ts: stamp(), open: c, high: Math.max(h, c), low: Math.min(l, c), close: c, volume: 1000 })
    const rows: [number, number, number][] = [
      [102.0, 102.3, 101.7],
      [102.8, 103.1, 102.5],
      [103.2, 103.4, 102.9],
      [103.2, 103.5, 102.9], // pivot high 103.5
      [102.5, 102.8, 102.2],
      [102.0, 102.3, 101.7], // pivot low 101.7
      [102.5, 102.8, 102.2],
      [103.0, 103.3, 102.7],
      [103.3, 103.6, 103.0],
      [103.6, 103.9, 103.3], // pivot high 103.9
      [103.5, 103.8, 103.2],
      [103.7, 103.85, 103.4],
      [103.75, 103.85, 103.5],
      [103.7, 103.8, 103.5], // final close INSIDE [103.5, 103.9]
    ]
    for (const [c, h, l] of rows) b(c, h, l)
    const map = buildZoneMap(bars)
    const zone = map.zones.find((z) => z.low === 103.5 && z.high === 103.9)
    expect(zone).toBeDefined()
    expect(zone!.kind).toBe("resistance")
    expect(zone!.positionKind).toBe("resistance") // overlap → historical kind kept
    // the fully-below support keeps its position label
    const floor = map.zones.find((z) => z.low === 101.7 && z.high === 101.7)
    expect(floor).toBeDefined()
    expect(floor!.positionKind).toBe("support")
    expect(nearestSupportBelow(map, 103.7)!.high).toBe(101.7)
  })

  it("a close inside a support zone keeps that zone's support label (the mirror case)", () => {
    // 14 sessions around 102–103 ending INSIDE the 2× support 101.8–102.2
    const stamp = makeStamps()
    const bars: Bar[] = []
    const b = (c: number, h: number, l: number) => bars.push({ ts: stamp(), open: c, high: Math.max(h, c), low: Math.min(l, c), close: c, volume: 1000 })
    const rows: [number, number, number][] = [
      [103.0, 103.3, 102.7],
      [102.5, 102.8, 102.2],
      [102.3, 102.6, 102.1],
      [102.1, 102.45, 101.8], // pivot low 101.8
      [102.7, 103.0, 102.4],
      [103.0, 103.3, 102.7],
      [102.8, 103.1, 102.5],
      [102.9, 103.2, 102.6],
      [102.7, 103.0, 102.45],
      [102.5, 102.8, 102.2], // pivot low 102.2
      [102.7, 103.0, 102.5],
      [102.6, 102.9, 102.4],
      [102.5, 102.8, 102.3],
      [102.0, 102.15, 101.9], // final close INSIDE [101.8, 102.2]
    ]
    for (const [c, h, l] of rows) b(c, h, l)
    const map = buildZoneMap(bars)
    const zone = map.zones.find((z) => z.low === 101.8 && z.high === 102.2)
    expect(zone).toBeDefined()
    expect(zone!.kind).toBe("support")
    expect(zone!.positionKind).toBe("support") // overlap → historical kind kept
    // and no zone fully below the close exists here — the floor is UNDER TEST
    expect(nearestSupportBelow(map, bars[bars.length - 1].close)).toBeNull()
  })
})
