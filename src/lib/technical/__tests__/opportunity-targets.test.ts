// Opportunity target ladder tests — opportunity-targets@1 contract:
//   • CONSERVATIVE EDGE ONLY: a buy rung prints the supply band's LOWER edge
//     (never the optimistic far edge), a sell rung the demand band's UPPER
//     edge; every printed price passes roundToTick with direction "up";
//   • rungs sit on MEANINGFUL zones only (strength ≥ 20 or touches ≥ 2);
//   • T1 is the NEAREST meaningful zone beyond the entry band — the ladder
//     never skips a nearer meaningful zone to manufacture a farther target,
//     and the 5% horizon filters NOTHING here (it is the caller's lens);
//   • T2 = next STRONGER rung (strength ≥ T1's, or the major confirmed swing
//     extreme) at ≥ 2% separation and strictly beyond the previous band;
//   • T3 ONLY on structural justification: a dominant zone (strength ≥ 60) or
//     the major swing extreme clearly beyond T2 — otherwise the ladder
//     honestly stops at T2;
//   • measured-move fallback ONLY when no meaningful zone exists on the target
//     side at all — zones always take precedence over projections; a measured
//     T1 is the whole ladder; whyAr always cites the real computed evidence.
//
// Rung rules are pinned on hand-built ResistanceMap literals (the ladder's
// input contract); the end-to-end block runs the real Fixture A map from
// resistance-map.test.ts through buildResistanceMap → buildTargetLadder.
import { describe, expect, it } from "vitest"
import { buildTargetLadder, TARGET_RULES, type LadderTarget, type TargetLadder } from "../opportunity-targets"
import { buildResistanceMap, type ResistanceMap, type ResistanceZone } from "../resistance-map"
import { roundToTick } from "../trade-plan"
import type { Bar } from "../indicators"

// ---- hand-built map literals -------------------------------------------------

let zoneSeq = 0
function zone(
  kind: "supply" | "demand",
  low: number,
  high: number,
  touches: number,
  strength: number,
  opts: { age?: number; failed?: number; rejections?: number; volRatio?: number | null; ts?: string } = {},
): ResistanceZone {
  return {
    kind,
    low,
    high,
    touches,
    lastTouchTs: opts.ts ?? `2025-06-${String(1 + (zoneSeq++ % 20)).padStart(2, "0")}`,
    strength,
    failedBreakouts: opts.failed ?? 0,
    rejectionSessions: opts.rejections ?? 0,
    lastTouchAgeSessions: opts.age ?? 10,
    touchVolRatio: opts.volRatio === undefined ? null : opts.volRatio,
  }
}

function mapOf(
  zones: ResistanceZone[],
  extremes: ResistanceMap["extremes"] = { majorHigh: null, majorLow: null },
  measured: ResistanceMap["measured"] = { sessions: 40, low: null, high: null, height: null },
  sessions = 60,
): ResistanceMap {
  return {
    version: "resistance-map@1",
    available: zones.length > 0,
    ...(zones.length === 0 ? { reason: "no confirmed swing pivots in the retained window" } : {}),
    asOf: "2025-06-20",
    sessions,
    zones: [...zones].sort((a, b) => a.low - b.low),
    extremes,
    measured,
    medianVolume: 1000,
  }
}

const buy = (map: ResistanceMap, entryLow: number, entryHigh: number, tick?: typeof roundToTick): TargetLadder | null =>
  buildTargetLadder(map, "buy", entryLow, entryHigh, 100, tick ?? roundToTick)
const sell = (map: ResistanceMap, entryLow: number, entryHigh: number): TargetLadder | null =>
  buildTargetLadder(map, "sell", entryLow, entryHigh, 100, roundToTick)
const rungs = (l: TargetLadder | null): [string, number, string, number | null][] =>
  (l?.targets ?? []).map((t) => [t.label, t.price, t.kind, t.strength])

// ---- end-to-end: the real Fixture A map (see resistance-map.test.ts) --------

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
const A_VOL_BOOST = new Set([25, 26])
let daySeq = 0
/** SAME calendar-day helper as resistance-map.test.ts — the end-to-end pins
 *  reference the fixture's real ts strings (e.g. the 2025-02-26 major high). */
function fixtureDay(): string {
  return new Date(Date.UTC(2025, 0, 1 + daySeq++)).toISOString().slice(0, 10)
}
function buildABars(): Bar[] {
  daySeq = 0
  const bars: Bar[] = []
  let i = 0
  for (const segment of A) {
    for (const mid of segment) {
      bars.push({ ts: fixtureDay(), open: mid, high: mid + 0.05, low: mid - 0.05, close: mid, volume: A_VOL_BOOST.has(i) ? 3000 : 1000 })
      i++
    }
  }
  return bars
}

describe("buildTargetLadder — conservative edge + tick rounding (R1)", () => {
  it("buy T1 prints the supply band's LOWER edge, never the far edge", () => {
    const map = mapOf([zone("supply", 109.89, 111.21, 5, 88, { rejections: 5, age: 9, volRatio: 1.8 })])
    const ladder = buy(map, 100, 101)
    expect(rungs(ladder)).toEqual([["T1", 109.89, "zone", 88]])
    const t1 = ladder!.targets[0]
    expect(t1.price).toBeLessThan(111.21) // never the optimistic far edge
    expect(t1.price).toBe(roundToTick(109.89, 0.01, "up"))
    // Arabic note cites the REAL evidence: touches, last-touch age, wicks,
    // failed breakout, volume ratio, band bounds
    expect(t1.whyAr).toContain("109.89")
    expect(t1.whyAr).toContain("منطقة عرض")
    expect(t1.whyAr).toContain("5 جلسات")
    expect(t1.whyAr).toContain("9 جلسات مضت")
    expect(t1.whyAr).toContain("بذيول عليا واضحة")
  })

  it("rounds UP to the injected tick — 0.05 tick lifts 109.89 to 109.90", () => {
    const map = mapOf([zone("supply", 109.89, 111.21, 5, 88)])
    const coarse: typeof roundToTick = (p, t, d) => roundToTick(p, 0.05, d)
    expect(buy(map, 100, 101, coarse)!.targets[0].price).toBe(109.9)
  })

  it("sell T1 prints the demand band's UPPER edge (the first bounce shelf)", () => {
    const map = mapOf([zone("demand", 94.38, 95.52, 6, 63, { rejections: 6, age: 57 })])
    const ladder = sell(map, 100, 101)
    expect(rungs(ladder)).toEqual([["T1", 95.52, "zone", 63]])
    expect(ladder!.targets[0].whyAr).toContain("منطقة طلب")
    expect(ladder!.targets[0].whyAr).toContain("ضغط شرائي")
    expect(ladder!.targets[0].whyAr).toContain("الحافة العليا")
    expect(ladder!.targets[0].whyAr).toContain("57 جلسات مضت")
  })

  it("Arabic pluralization stays grammatical for 1 and 2 sessions", () => {
    const one = mapOf([zone("supply", 120, 121, 1, 25, { age: 3 })])
    expect(buy(one, 100, 101)!.targets[0].whyAr).toContain("جلسة واحدة")
    const two = mapOf([zone("supply", 120, 121, 2, 30, { age: 3 })])
    expect(buy(two, 100, 101)!.targets[0].whyAr).toContain("جلستين")
  })
})

describe("buildTargetLadder — rung walk on a three-tier map (R2-R5)", () => {
  // Z1 → T1 (strength 40), Z2 → T2 (50 ≥ 40, 105 ≥ 100×1.02), Z3 → T3 (65 ≥ 60)
  const threeTier = () =>
    mapOf([
      zone("supply", 100, 102, 4, 40, { age: 30 }),
      zone("supply", 105, 107, 4, 50, { age: 20 }),
      zone("supply", 111, 113, 4, 65, { age: 15 }),
    ])

  it("walks T1 < T2 < T3 ascending with zone rungs", () => {
    const ladder = buy(threeTier(), 96, 97)
    expect(rungs(ladder)).toEqual([
      ["T1", 100, "zone", 40],
      ["T2", 105, "zone", 50],
      ["T3", 111, "zone", 65],
    ])
    expect(ladder!.targets.map((t) => t.price)).toEqual([...ladder!.targets.map((t) => t.price)].sort((a, b) => a - b))
  })

  it("minimum separation: a stronger zone only 1.5% past T1 is the SAME level, not a rung", () => {
    // 101.5 is ≥ T1's strength and beyond its band edge in price terms is
    // 100×1.02 = 102 → 101.5 fails separation (and overlaps T1's band)
    const map = mapOf([
      zone("supply", 100, 102, 4, 40, { age: 30 }),
      zone("supply", 101.5, 103, 6, 90, { age: 5 }),
      zone("supply", 105, 107, 4, 50, { age: 20 }),
    ])
    expect(rungs(buy(map, 96, 97))).toEqual([
      ["T1", 100, "zone", 40],
      ["T2", 105, "zone", 50], // the too-close 101.5 zone is skipped
    ])
  })

  it("T2 strength gate: a weaker zone beyond T1 is not a rung; the major swing high is", () => {
    const weakOnly = mapOf(
      [zone("supply", 100, 102, 4, 40, { age: 30 }), zone("supply", 105, 107, 4, 30, { age: 20 })],
      { majorHigh: null, majorLow: null },
    )
    expect(rungs(buy(weakOnly, 96, 97))).toEqual([["T1", 100, "zone", 40]])

    const withExtreme = mapOf(
      [zone("supply", 100, 102, 4, 40, { age: 30 }), zone("supply", 105, 107, 4, 30, { age: 20 })],
      { majorHigh: { price: 106.5, ts: "2025-05-02" }, majorLow: null },
    )
    const ladder = buy(withExtreme, 96, 97)
    expect(rungs(ladder)).toEqual([
      ["T1", 100, "zone", 40],
      ["T2", 106.5, "major_high", 30], // strength from the CONTAINING band
    ])
    expect(ladder!.targets[1].whyAr).toContain("106.5")
    expect(ladder!.targets[1].whyAr).toContain("2025-05-02")
    expect(ladder!.targets[1].whyAr).toContain("القمة الهيكلية")
  })

  it("the major high inside T1's band is the same ceiling, not a farther rung", () => {
    const map = mapOf([zone("supply", 100, 102, 4, 40, { age: 30 })], {
      majorHigh: { price: 101.5, ts: "2025-05-02" },
      majorLow: null,
    })
    expect(rungs(buy(map, 96, 97))).toEqual([["T1", 100, "zone", 40]])
  })

  it("T3 gate: a meaningful (55) but non-dominant zone beyond T2 does NOT justify a third rung", () => {
    const map = mapOf([
      zone("supply", 100, 102, 4, 40, { age: 30 }),
      zone("supply", 105, 107, 4, 45, { age: 20 }),
      zone("supply", 111, 113, 4, 55, { age: 10 }),
    ])
    expect(rungs(buy(map, 96, 97))).toEqual([
      ["T1", 100, "zone", 40],
      ["T2", 105, "zone", 45],
    ])
  })

  it("T3 fires on a dominant zone (≥ 60) or the major swing high clearly beyond T2", () => {
    const dominant = mapOf([
      zone("supply", 100, 102, 4, 40, { age: 30 }),
      zone("supply", 105, 107, 4, 45, { age: 20 }),
      zone("supply", 111, 113, 6, 70, { age: 5 }),
    ])
    expect(rungs(buy(dominant, 96, 97))[2]).toEqual(["T3", 111, "zone", 70])

    const viaExtreme = mapOf(
      [
        zone("supply", 100, 102, 4, 40, { age: 30 }),
        zone("supply", 105, 107, 4, 45, { age: 20 }),
        zone("supply", 111, 113, 4, 55, { age: 10 }), // not dominant
      ],
      { majorHigh: { price: 119, ts: "2024-12-15" }, majorLow: null },
    )
    const ladder = buy(viaExtreme, 96, 97)
    expect(rungs(ladder)).toEqual([
      ["T1", 100, "zone", 40],
      ["T2", 105, "zone", 45],
      ["T3", 119, "major_high", null], // no containing supply band → strength null
    ])
    expect(ladder!.targets[2].whyAr).toContain("119")
    expect(ladder!.targets[2].whyAr).toContain("2024-12-15")
  })
})

describe("buildTargetLadder — anti-skip and meaningfulness (R2/R3)", () => {
  it("T1 is the NEAREST meaningful zone even when a much stronger one sits farther", () => {
    const map = mapOf([zone("supply", 104, 106, 2, 25, { age: 40 }), zone("supply", 110, 112, 6, 80, { age: 2 })])
    expect(rungs(buy(map, 96, 97))[0]).toEqual(["T1", 104, "zone", 25])
  })

  it("a non-meaningful nearer band (strength 15, 1 touch) is skipped by the R2 gate", () => {
    const map = mapOf([zone("supply", 104, 106, 1, 15, { age: 40 }), zone("supply", 110, 112, 2, 25, { age: 2 })])
    expect(rungs(buy(map, 96, 97))[0]).toEqual(["T1", 110, "zone", 25])
  })

  it("the 5% horizon filters nothing: a meaningful zone beyond it still wins over a projection", () => {
    // measured height would print 120.5 — the real (far) zone at 130 wins
    const map = mapOf([zone("supply", 130, 132, 3, 30, { age: 20 })], {
      majorHigh: null,
      majorLow: null,
    }, { sessions: 40, low: 100, high: 120, height: 20 })
    expect(rungs(buy(map, 100, 101))).toEqual([["T1", 130, "zone", 30]])
  })
})

describe("buildTargetLadder — measured-move fallback (R6)", () => {
  const measured = { sessions: 40, low: 100, high: 120, height: 20 }

  it("fires only when no meaningful zone exists on the target side; labeled, strength null, no T2", () => {
    const map = mapOf([zone("demand", 94.38, 95.52, 6, 63, { age: 57 })], {
      majorHigh: null,
      majorLow: null,
    }, measured)
    const ladder = buy(map, 100, 101)
    expect(rungs(ladder)).toEqual([["T1", 120.5, "measured_move", null]]) // 100.5 + 20
    const t1 = ladder!.targets[0] as LadderTarget
    expect(t1.whyAr).toContain("إسقاط محسوب")
    expect(t1.whyAr).toContain("40 جلسة")
    expect(t1.whyAr).toContain("من 100 إلى 120")
    expect(t1.whyAr).toContain("وليس مستوى هيكلي") // discloses the projection basis
  })

  it("sell mirror projects the range height BELOW the entry mid", () => {
    const map = mapOf([zone("supply", 130, 132, 3, 30, { age: 20 })], {
      majorHigh: null,
      majorLow: null,
    }, measured)
    expect(rungs(sell(map, 100, 101))).toEqual([["T1", 80.5, "measured_move", null]]) // 100.5 − 20
  })

  it("a zero/unknown measured height abstains instead of projecting", () => {
    const zero = mapOf([zone("demand", 94.38, 95.52, 6, 63)], { majorHigh: null, majorLow: null }, { sessions: 40, low: 100, high: 100, height: null })
    expect(buy(zero, 100, 101)).toBeNull()
  })
})

describe("buildTargetLadder — sell-side mirroring (R1-R5)", () => {
  const demandLadder = () =>
    mapOf([
      zone("demand", 94.38, 95.52, 6, 63, { age: 57 }),
      zone("demand", 88, 90, 5, 63, { age: 70 }),
      zone("demand", 80, 82, 6, 70, { age: 90 }),
    ])

  it("walks T1 > T2 > T3 descending on demand bands, upper edges only", () => {
    const ladder = sell(demandLadder(), 100, 101)
    expect(rungs(ladder)).toEqual([
      ["T1", 95.52, "zone", 63],
      ["T2", 90, "zone", 63], // strength ≥ T1's, ≤ 95.52×0.98, below T1's band
      ["T3", 82, "zone", 70], // dominant (70 ≥ 60), ≤ 90×0.98
    ])
    const prices = ladder!.targets.map((t) => t.price)
    expect(prices).toEqual([...prices].sort((a, b) => b - a))
    expect(ladder!.targets[0].price).toBeGreaterThan(94.38) // never the deep edge
  })

  it("a non-dominant deep demand zone does not justify a sell T3", () => {
    const map = mapOf([
      zone("demand", 94.38, 95.52, 6, 63, { age: 57 }),
      zone("demand", 88, 90, 5, 55, { age: 70 }),
    ])
    expect(rungs(sell(map, 100, 101))).toEqual([["T1", 95.52, "zone", 63]]) // 55 < T1's 63 → no T2 either
  })
})

describe("buildTargetLadder — abstention (honest insufficiency)", () => {
  it("refuses an unavailable map, bad inputs, and an entry zone crossing nothing", () => {
    const good = mapOf([zone("supply", 110, 112, 3, 30, { age: 10 })])
    expect(buildTargetLadder({ ...good, available: false, reason: "needs >= 40 valid OHLC sessions" }, "buy", 100, 101, 100, roundToTick)).toBeNull()
    expect(buildTargetLadder(good, "buy", 101, 100, 100, roundToTick)).toBeNull() // inverted entry
    expect(buildTargetLadder(good, "buy", 0, 101, 100, roundToTick)).toBeNull() // non-positive
    expect(buildTargetLadder(good, "buy", Number.NaN, 101, 100, roundToTick)).toBeNull()
    expect(buy(mapOf([], { majorHigh: null, majorLow: null }, { sessions: 40, low: 100, high: 120, height: 20 }), 100, 101)).toBeNull()
  })
})

describe("buildTargetLadder — end-to-end on the real Fixture A map", () => {
  const map = buildResistanceMap(buildABars())

  it("buy [100, 101]: zone T1 at the conservative edge + major-high T2, no fabricated T3", () => {
    const ladder = buy(map, 100, 101)
    expect(rungs(ladder)).toEqual([
      ["T1", 109.89, "zone", 88],
      ["T2", 122.05, "major_high", 32],
    ])
    expect(ladder!.targets[0].whyAr).toContain("وصمدت أمام 1 محاولة اختراق فاشلة")
    expect(ladder!.targets[0].whyAr).toContain("1.8 ضعف وسط السلسلة")
    expect(ladder!.targets[1].whyAr).toContain("2025-02-26")
  })

  it("buy above every zone: the measured-move projection is the whole ladder", () => {
    expect(rungs(buy(map, 124, 125))).toEqual([["T1", 147.1, "measured_move", null]]) // 124.5 + 22.6
  })

  it("buy just under the top band: the major high is inside T1's band → no T2", () => {
    expect(rungs(buy(map, 120, 120.5))).toEqual([["T1", 121.32, "zone", 32]])
  })

  it("sell [100, 101]: one demand rung (no demand below 95.52×0.98 exists)", () => {
    expect(rungs(sell(map, 100, 101))).toEqual([["T1", 95.52, "zone", 63]])
  })

  it("sell above the 104.57 band: it is not BELOW the entry (strict edge) → skipped", () => {
    expect(rungs(sell(map, 104, 105))).toEqual([["T1", 95.52, "zone", 63]])
  })

  it("exports the documented rung rules", () => {
    expect(TARGET_RULES.MIN_TARGET_STRENGTH).toBe(20)
    expect(TARGET_RULES.MIN_TARGET_TOUCHES).toBe(2)
    expect(TARGET_RULES.SEPARATION_PCT).toBe(2)
    expect(TARGET_RULES.T3_MIN_STRENGTH).toBe(60)
    expect(TARGET_RULES.HORIZON_PCT).toBe(5)
  })
})
