// Resistance map tests — resistance-map@1 contract:
//   • zones come ONLY from real OHLC swing pivots (fractal wing 3, loose
//     comparisons per the tech-signals@5 equal-extreme fix), clustered within
//     1.5% of the cluster mean with a 2% max-span rule, banded ±0.6%;
//   • flat scanner placeholders (O=H=L=C) are skipped (candlestick.ts
//     convention) and never seed a zone;
//   • strength is the documented 30/25/20/15/10 weighted sum (touch count,
//     recency fade over 120 sessions, rejection wicks, touch volume vs the
//     series median, failed breakouts) — every number below is hand-computed;
//   • abstention on short/flat/corrupt series — never a fabricated level.
//
// The synthetic series engineers EXACT pivots: Fixture A (72 sessions) yields
// 8 zones; every strength below is traceable to RESISTANCE_THRESHOLDS.
import { describe, expect, it } from "vitest"
import {
  RESISTANCE_THRESHOLDS,
  RESISTANCE_MAP_VERSION,
  buildResistanceMap,
  nearestSupplyAbove,
  nearestSupportBelow,
  obstaclesBetween,
  majorResistance,
  majorSupport,
  strengthAt,
  type ResistanceMap,
  type ResistanceZone,
} from "../resistance-map"
import type { Bar } from "../indicators"

let seq = 0
function day(): string {
  return new Date(Date.UTC(2025, 0, 1 + seq++)).toISOString().slice(0, 10)
}
function resetDays(): void {
  seq = 0
}

/** Real-OHLC bar around `mid` (never flat: high > low). Symmetric 0.05 wicks
 *  mean every touch session shows a 0.5 wick ratio — rejection evidence. */
function bar(mid: number, vol: number | null = 1000): Bar {
  return { ts: day(), open: mid, high: mid + 0.05, low: mid - 0.05, close: mid, volume: vol }
}

/** Flat scanner placeholder: O = H = L = C. */
function flatBar(price: number): Bar {
  return { ts: day(), open: price, high: price, low: price, close: price, volume: 1000 }
}

// Fixture A segments (see scripts probe): engineered pivots at
//   demand 95×4 plateau, 107/104 pullback bottoms, 118 dip, supply 110.5×2,
//   113 pierce top, 120×3 plateau, 122 top — with one FAILED S1 breakout
//   (113 → 109) and two abandoned beyond-runs (113→122→112 collapse).
const A: number[][] = [
  [101, 100, 99, 98, 97, 96.5],
  [96, 95.8, 95.6, 95.5],
  [95, 95, 95, 95],
  [95.4, 96, 97, 98],
  [99, 100, 102, 104, 106, 108],
  [109.5],
  [110.5, 110.5],
  [109, 108, 107],
  [108, 109, 110],
  [113, 109],
  [107, 106, 105, 104],
  [104, 105, 106, 107, 108, 109],
  [113, 115, 117, 119],
  [120, 120, 120, 120],
  [118, 119, 121, 122],
  [117],
  [115, 114, 112, 111, 110],
  [108, 106, 105, 104, 103, 102, 101, 100, 99.5],
]
/** S1's founding plateau (series idx 25, 26) carries 3× volume. */
const A_VOL_BOOST = new Set([25, 26])

function buildA(): Bar[] {
  resetDays()
  const bars: Bar[] = []
  let i = 0
  for (const segment of A) for (const mid of segment) bars.push(bar(mid, A_VOL_BOOST.has(i++) ? 3000 : 1000))
  return bars
}

function firstN(n: number): Bar[] {
  resetDays()
  const bars: Bar[] = []
  let i = 0
  for (const segment of A) {
    for (const mid of segment) {
      if (bars.length >= n) return bars
      bars.push(bar(mid, A_VOL_BOOST.has(i++) ? 3000 : 1000))
    }
  }
  return bars
}

/** Compact zone tuple for pinned expectations. */
type ZonePin = [kind: string, low: number, high: number, touches: number, strength: number, failed: number, rejections: number, age: number]
const pin = (z: ResistanceZone): ZonePin => [z.kind, z.low, z.high, z.touches, z.strength, z.failedBreakouts, z.rejectionSessions, z.lastTouchAgeSessions]

describe("buildResistanceMap — abstention (honest insufficiency)", () => {
  it("abstains below the 40-valid-session minimum", () => {
    const map = buildResistanceMap(firstN(39))
    expect(map.available).toBe(false)
    expect(map.zones).toEqual([])
    // the reason discloses exactly what was seen — never a fabricated map
    expect(map.reason).toBe("needs >= 40 valid OHLC sessions, have 39")
    expect(map.sessions).toBe(0)
  })

  it("abstains on an all-flat scanner series (O=H=L=C carries no anatomy)", () => {
    resetDays()
    const bars: Bar[] = []
    for (let i = 0; i < 60; i++) bars.push(flatBar(100))
    const map = buildResistanceMap(bars)
    expect(map.available).toBe(false)
    expect(map.sessions).toBe(0)
    expect(map.zones).toEqual([])
  })

  it("skips interleaved flat placeholder bars without changing the real-bar map", () => {
    // the same 45 real sessions with 5 flat bars interleaved — flats are
    // filtered BEFORE pivots, so the map must be identical to the pure run
    resetDays()
    const real = firstN(45)
    resetDays()
    const mixed: Bar[] = []
    let pushed = 0
    const flatAt = new Set([5, 15, 25, 35, 44])
    let i = 0
    for (const segment of A) {
      for (const mid of segment) {
        if (pushed >= 45) break
        if (flatAt.has(i)) mixed.push(flatBar(mid))
        i++
        mixed.push(real[pushed++])
      }
    }
    const pure = buildResistanceMap(real)
    const withFlats = buildResistanceMap(mixed)
    expect(withFlats.sessions).toBe(45)
    expect(withFlats.available).toBe(true)
    expect(withFlats.zones).toEqual(pure.zones)
  })

  it("skips corrupt bars (high < low) from the session count", () => {
    const real = firstN(45)
    real[10] = { ...real[10], high: real[10].low - 1 } // corrupt one session
    const map = buildResistanceMap(real)
    expect(map.sessions).toBe(44)
  })
})

describe("buildResistanceMap — Fixture A zones (hand-computed)", () => {
  const map = buildResistanceMap(buildA())

  it("carries the documented metadata", () => {
    expect(map.version).toBe(RESISTANCE_MAP_VERSION)
    expect(map.available).toBe(true)
    expect(map.sessions).toBe(72)
    expect(map.asOf).toBe("2025-03-13")
    expect(map.medianVolume).toBe(1000) // 70×1000 + 2×3000 → median 1000
    expect(map.measured).toEqual({ sessions: 40, low: 99.45, high: 122.05, height: 22.6 })
    expect(map.extremes.majorHigh).toEqual({ price: 122.05, ts: "2025-02-26" })
    expect(map.extremes.majorLow).toEqual({ price: 94.95, ts: "2025-01-14" }) // latest of the 4 equal lows
  })

  it("produces exactly 8 zones ascending by low", () => {
    expect(map.zones.length).toBe(8)
    const lows = map.zones.map((z) => z.low)
    expect([...lows].sort((a, b) => a - b)).toEqual(lows)
  })

  it("S1 — the 110.5 double-top ceiling: 5 touches, strength 88, one failed breakout, 1.8× volume", () => {
    const s1 = map.zones.find((z) => z.kind === "supply" && z.low === 109.89)
    expect(s1).toBeDefined()
    // band = 110.55 × (1 ∓ 0.006) — pivot price is the bar HIGH (110.55)
    expect(s1!.low).toBe(109.89)
    expect(s1!.high).toBe(111.21)
    // touches: 2 plateau pivots + the 110 revisit + 111 + 110 tail bars;
    // the 113/112 closes sit ABOVE the ceiling → breakout sessions, not touches
    expect(s1!.touches).toBe(5)
    expect(s1!.rejectionSessions).toBe(5) // every touch bar has a 0.5 upper wick
    // failed breakout: 113 (idx 33) closed above, 109 (idx 34) closed back
    // below within the 5-session window → 1 episode. The 113→122→112 collapse
    // is ONE sustained beyond-run with no return below 109.89 → abandoned,
    // earns nothing (and can never double-count).
    expect(s1!.failedBreakouts).toBe(1)
    expect(s1!.lastTouchTs).toBe("2025-03-04") // idx 62
    expect(s1!.lastTouchAgeSessions).toBe(9)
    expect(s1!.touchVolRatio).toBe(1.8) // (3000+3000+1000+1000+1000)/5 ÷ 1000
    // strength: 30×5/6 + 25×(120−9)/120 + 20×min(5,4)/4 + 15 (1.8 ≥ 1.5) + 10×1/2
    //         = 25 + 23.125 + 20 + 15 + 5 = 88.125 → 88
    expect(s1!.strength).toBe(88)
  })

  it("D1 — the 95×4 equal-low plateau: loose pivots merge into ONE demand zone, strength 63", () => {
    const d1 = map.zones.find((z) => z.kind === "demand" && z.low === 94.38)
    expect(d1).toBeDefined()
    expect(map.zones.filter((z) => z.low === 94.38).length).toBe(1) // merged, not per-pivot
    // 94.95 × (1 ∓ 0.006); touches: 95.5 approach + 4 plateau + 95.4 exit
    // (the 95.6 bar's low 95.55 sits above the 95.52 band edge → not a touch)
    expect(d1!.touches).toBe(6)
    expect(d1!.rejectionSessions).toBe(6)
    expect(d1!.failedBreakouts).toBe(0) // never closed below 94.38
    // strength: 30×6/6 + 25×(120−57)/120 + 20 + 0 (ratio 1.0 → 0) + 0 = 63.125 → 63
    expect(d1!.strength).toBe(63)
    expect(d1!.lastTouchTs).toBe("2025-01-15")
  })

  it("every zone's evidence fields match the hand-computed table", () => {
    // [kind, low, high, touches, strength, failed, rejections, age]
    const expected: ZonePin[] = [
      ["demand", 94.38, 95.52, 6, 63, 0, 6, 57],
      ["demand", 103.33, 104.57, 4, 64, 0, 4, 5],
      ["demand", 106.31, 107.59, 3, 49, 0, 3, 29],
      ["supply", 109.89, 111.21, 5, 88, 1, 5, 9],
      ["supply", 112.37, 113.73, 2, 40, 0, 2, 26],
      ["demand", 117.24, 118.66, 1, 31, 0, 1, 18],
      ["supply", 119.33, 120.77, 4, 66, 1, 4, 19],
      ["supply", 121.32, 122.78, 1, 32, 0, 1, 15],
    ]
    expect(map.zones.map(pin)).toEqual(expected)
    // recency term spot-checks behind two of the rounded strengths:
    //   104.57 zone: 20 + 25×115/120 + 20 = 63.958 → 64
    //   120.77 zone: 20 + 25×101/120 + 20 + 0 + 5 (1 failed) = 66.04 → 66
    expect(RESISTANCE_THRESHOLDS.RECENCY_FADE_SESSIONS).toBe(120)
  })
})

describe("buildResistanceMap — clustering rules", () => {
  /** Three swing-high groups with `tops` mids; 4-bar valleys keep every pivot
   *  inside its own fractal window. */
  function spanFixture(tops: [number, number, number]): Bar[] {
    resetDays()
    const mids = [
      96, 95, 94, 93,
      tops[0],
      tops[0] - 2, tops[0] - 3, tops[0] - 4, tops[0] - 5,
      tops[1], tops[1],
      tops[1] - 2, tops[1] - 3, tops[1] - 4, tops[1] - 5,
      tops[2], tops[2],
      ...Array.from({ length: 25 }, (_, k) => tops[2] - 2 - k),
    ]
    return mids.map((m) => bar(m))
  }

  it("splits a cluster whose span exceeds MAX_CLUSTER_SPAN_PCT (2%)", () => {
    // pivot highs 100.05, 101.4, 101.4, 102.15: greedy join of 101.4 lifts the
    // mean to 100.95 (tol 1.14% ✓) but the span hits 2.099% > 2% → split
    const map = buildResistanceMap(spanFixture([100, 101.35, 102.1]))
    const supply = map.zones.filter((z) => z.kind === "supply")
    expect(supply.map((z) => [z.low, z.high, z.touches])).toEqual([
      [99.45, 102.01, 4], // {100.05, 101.4, 101.4}
      [101.54, 102.76, 2], // {102.15, 102.15}
    ])
  })

  it("keeps one zone at a 1.999% span — the 2% boundary merges", () => {
    // same shape with a 102.05 top: span 1.999% ≤ 2 → ONE band [99.45, 102.66]
    const map = buildResistanceMap(spanFixture([100, 101.35, 102.0]))
    const supply = map.zones.filter((z) => z.kind === "supply")
    expect(supply.length).toBe(1)
    expect([supply[0].low, supply[0].high, supply[0].touches]).toEqual([99.45, 102.66, 6])
  })
})

describe("price-relative queries", () => {
  const map = buildResistanceMap(buildA())

  it("nearestSupplyAbove returns the nearest band strictly above the price", () => {
    const z = nearestSupplyAbove(map, 101)
    expect(z?.low).toBe(109.89)
    expect(z?.strength).toBe(88)
    expect(nearestSupplyAbove(map, 123)).toBeNull() // nothing above 122.78
  })

  it("a band containing the price is not ABOVE it (strict edge)", () => {
    // 110 sits inside [109.89, 111.21] → excluded; the next band wins
    expect(nearestSupplyAbove(map, 110)?.low).toBe(112.37)
  })

  it("nearestSupportBelow mirrors downward with the same strictness", () => {
    expect(nearestSupportBelow(map, 101)?.low).toBe(94.38)
    expect(nearestSupportBelow(map, 95)).toBeNull() // 95.52 band contains 95 → excluded; nothing below
  })

  it("obstaclesBetween returns intersecting zones ascending, path direction-free", () => {
    const up = obstaclesBetween(map, 100, 122)
    expect(up.map((z) => pin(z))).toEqual([
      ["demand", 103.33, 104.57, 4, 64, 0, 4, 5],
      ["demand", 106.31, 107.59, 3, 49, 0, 3, 29],
      ["supply", 109.89, 111.21, 5, 88, 1, 5, 9],
      ["supply", 112.37, 113.73, 2, 40, 0, 2, 26],
      ["demand", 117.24, 118.66, 1, 31, 0, 1, 18],
      ["supply", 119.33, 120.77, 4, 66, 1, 4, 19],
      ["supply", 121.32, 122.78, 1, 32, 0, 1, 15],
    ])
    expect(obstaclesBetween(map, 122, 100).map((z) => z.low)).toEqual(up.map((z) => z.low))
    expect(obstaclesBetween(map, 101, 101)).toEqual([]) // zero-length path
    expect(obstaclesBetween(map, 104, 105).map((z) => z.low)).toEqual([103.33])
    // boundary-inclusive intersection: the path endpoint 121.32 EQUALS the
    // band's lower edge → the band is on the path; 121 alone is not
    expect(obstaclesBetween(map, 120, 121).map((z) => z.low)).toEqual([119.33])
    expect(obstaclesBetween(map, 120, 121.32).map((z) => z.low)).toEqual([119.33, 121.32])
  })

  it("majorResistance/majorSupport pick by strength, not proximity", () => {
    expect(majorResistance(map)?.low).toBe(109.89) // strength 88 > 66
    expect(majorSupport(map)?.low).toBe(103.33) // strength 64 > 63 — NOT the deepest zone
  })

  it("strengthAt reads the strongest band containing a price", () => {
    expect(strengthAt(map, "supply", 122.05)).toBe(32) // inside [121.32, 122.78]
    expect(strengthAt(map, "supply", 118)).toBeNull() // no supply band contains 118
    expect(strengthAt(map, "demand", 95)).toBe(63)
  })
})
