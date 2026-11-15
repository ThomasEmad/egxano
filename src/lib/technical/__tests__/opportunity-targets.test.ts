// Opportunity target ladder tests — opportunity-targets@2 contract:
//   • CONSERVATIVE EDGE + PRE-WALL BUFFER: a buy rung prints the supply band's
//     LOWER edge MINUS 0.5% (rounded DOWN), a sell rung the demand band's UPPER
//     edge PLUS 0.5% (rounded UP) — the owner's "الهدف قبل الجدار بنص %";
//   • rungs sit on MEANINGFUL zones only (strength ≥ 20 or touches ≥ 2);
//   • T1 anchors to the NEAREST STRONG zone (strength ≥ 45) beyond the entry
//     band — weak near shelves (clearable in a session) are skipped BY DESIGN
//     and the skip count is disclosed in whyAr; the 5% horizon filters nothing
//     here (it is the caller's lens);
//   • T2 = next STRONGER rung (strength ≥ T1's, or the major confirmed swing
//     extreme) at ≥ 2% separation and strictly beyond the previous band;
//   • T3 ONLY on structural justification: a dominant zone (strength ≥ 60) or
//     the major swing extreme clearly beyond T2 — otherwise the ladder
//     honestly stops at T2;
//   • measured-move fallback ONLY when no STRONG zone exists on the target
//     side at all — strong zones always take precedence over projections; a
//     measured T1 is the whole ladder; whyAr always cites the real evidence.
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

const buy = (map: ResistanceMap, entryLow: number, entryHigh: number, tick?: typeof roundToTick, lastClose = 100): TargetLadder | null =>
  buildTargetLadder(map, "buy", entryLow, entryHigh, lastClose, tick ?? roundToTick)
const sell = (map: ResistanceMap, entryLow: number, entryHigh: number, tick?: typeof roundToTick, lastClose = 100): TargetLadder | null =>
  buildTargetLadder(map, "sell", entryLow, entryHigh, lastClose, tick ?? roundToTick)
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

describe("buildTargetLadder — conservative edge + pre-wall buffer + tick rounding (R1′)", () => {
  it("buy T1 prints the supply band's LOWER edge MINUS the 0.5% pre-wall buffer, never the far edge", () => {
    const map = mapOf([zone("supply", 109.89, 111.21, 5, 88, { rejections: 5, age: 9, volRatio: 1.8 })])
    const ladder = buy(map, 100, 101)
    expect(rungs(ladder)).toEqual([["T1", 109.34, "zone", 88]]) // 109.89 × 0.995 → down
    const t1 = ladder!.targets[0]
    expect(t1.price).toBeLessThan(109.89) // strictly before the wall's near edge
    expect(t1.price).toBe(roundToTick(109.89 * 0.995, 0.01, "down"))
    // Arabic note cites the REAL evidence: the wall bounds, the buffer, the
    // touches, last-touch age, wicks, failed breakout, volume ratio
    expect(t1.whyAr).toContain("109.89")
    expect(t1.whyAr).toContain("منطقة عرض")
    expect(t1.whyAr).toContain("0.5%")
    expect(t1.whyAr).toContain("5 جلسات")
    expect(t1.whyAr).toContain("9 جلسات مضت")
    expect(t1.whyAr).toContain("بذيول عليا واضحة")
  })

  it("rounds DOWN to the injected tick — 0.05 tick drops the buffered 109.34 to 109.30", () => {
    const map = mapOf([zone("supply", 109.89, 111.21, 5, 88)])
    const coarse: typeof roundToTick = (p, t, d) => roundToTick(p, 0.05, d)
    expect(buy(map, 100, 101, coarse)!.targets[0].price).toBe(109.3)
  })

  it("sell T1 prints the demand band's UPPER edge PLUS the buffer (cover before the bounce)", () => {
    const map = mapOf([zone("demand", 94.38, 95.52, 6, 63, { rejections: 6, age: 57 })])
    const ladder = sell(map, 100, 101)
    expect(rungs(ladder)).toEqual([["T1", 96, "zone", 63]]) // 95.52 × 1.005 → up
    expect(ladder!.targets[0].whyAr).toContain("منطقة طلب")
    expect(ladder!.targets[0].whyAr).toContain("ضغط شرائي")
    expect(ladder!.targets[0].whyAr).toContain("0.5%")
    expect(ladder!.targets[0].whyAr).toContain("57 جلسات مضت")
  })

  it("Arabic pluralization stays grammatical for 1 and 2 sessions", () => {
    const one = mapOf([zone("supply", 120, 121, 1, 50, { age: 3 })])
    expect(buy(one, 100, 101)!.targets[0].whyAr).toContain("جلسة واحدة")
    const two = mapOf([zone("supply", 120, 121, 2, 55, { age: 3 })])
    expect(buy(two, 100, 101)!.targets[0].whyAr).toContain("جلستين")
  })
})

describe("buildTargetLadder — rung walk on a three-tier map (R2-R5)", () => {
  // Z1 → T1 (strength 50 ≥ 45 = strong), Z2 → T2 (55 ≥ 50, 105 ≥ 99.5×1.02),
  // Z3 → T3 (70 ≥ 60); every rung prints edge × 0.995 rounded DOWN
  const threeTier = () =>
    mapOf([
      zone("supply", 100, 102, 4, 50, { age: 30 }),
      zone("supply", 105, 107, 4, 55, { age: 20 }),
      zone("supply", 111, 113, 4, 70, { age: 15 }),
    ])

  it("walks T1 < T2 < T3 ascending with zone rungs", () => {
    const ladder = buy(threeTier(), 96, 97, undefined, 96)
    expect(rungs(ladder)).toEqual([
      ["T1", 99.5, "zone", 50],
      ["T2", 104.47, "zone", 55],
      ["T3", 110.44, "zone", 70],
    ])
    expect(ladder!.targets.map((t) => t.price)).toEqual([...ladder!.targets.map((t) => t.price)].sort((a, b) => a - b))
  })

  it("minimum separation: a stronger zone only 1.5% past T1 is the SAME level, not a rung", () => {
    // 101.5 is ≥ T1's strength and beyond its band edge in price terms is
    // 99.5×1.02 = 101.49 → 101.5 fails separation (and overlaps T1's band)
    const map = mapOf([
      zone("supply", 100, 102, 4, 50, { age: 30 }),
      zone("supply", 101.5, 103, 6, 90, { age: 5 }),
      zone("supply", 105, 107, 4, 55, { age: 20 }),
    ])
    expect(rungs(buy(map, 96, 97, undefined, 96))).toEqual([
      ["T1", 99.5, "zone", 50],
      ["T2", 104.47, "zone", 55], // the too-close 101.5 zone is skipped
    ])
  })

  it("T2 strength gate: a weaker zone beyond T1 is not a rung; the major swing high is", () => {
    const weakOnly = mapOf(
      [zone("supply", 100, 102, 4, 50, { age: 30 }), zone("supply", 105, 107, 4, 30, { age: 20 })],
      { majorHigh: null, majorLow: null },
    )
    expect(rungs(buy(weakOnly, 96, 97, undefined, 96))).toEqual([["T1", 99.5, "zone", 50]])

    const withExtreme = mapOf(
      [zone("supply", 100, 102, 4, 50, { age: 30 }), zone("supply", 105, 107, 4, 30, { age: 20 })],
      { majorHigh: { price: 106.5, ts: "2025-05-02" }, majorLow: null },
    )
    const ladder = buy(withExtreme, 96, 97, undefined, 96)
    expect(rungs(ladder)).toEqual([
      ["T1", 99.5, "zone", 50],
      ["T2", 105.96, "major_high", 30], // 106.5 × 0.995 → down; strength from the CONTAINING band
    ])
    expect(ladder!.targets[1].whyAr).toContain("105.96")
    expect(ladder!.targets[1].whyAr).toContain("2025-05-02")
    expect(ladder!.targets[1].whyAr).toContain("القمة الهيكلية")
  })

  it("the major high inside T1's band is the same ceiling, not a farther rung", () => {
    const map = mapOf([zone("supply", 100, 102, 4, 50, { age: 30 })], {
      majorHigh: { price: 101.5, ts: "2025-05-02" },
      majorLow: null,
    })
    expect(rungs(buy(map, 96, 97, undefined, 96))).toEqual([["T1", 99.5, "zone", 50]])
  })

  it("T3 gate: a meaningful (55) but non-dominant zone beyond T2 does NOT justify a third rung", () => {
    const map = mapOf([
      zone("supply", 100, 102, 4, 50, { age: 30 }),
      zone("supply", 105, 107, 4, 55, { age: 20 }),
      zone("supply", 111, 113, 4, 55, { age: 10 }),
    ])
    expect(rungs(buy(map, 96, 97, undefined, 96))).toEqual([
      ["T1", 99.5, "zone", 50],
      ["T2", 104.47, "zone", 55],
    ])
  })

  it("T3 fires on a dominant zone (≥ 60) or the major swing high clearly beyond T2", () => {
    const dominant = mapOf([
      zone("supply", 100, 102, 4, 50, { age: 30 }),
      zone("supply", 105, 107, 4, 55, { age: 20 }),
      zone("supply", 111, 113, 6, 70, { age: 5 }),
    ])
    expect(rungs(buy(dominant, 96, 97, undefined, 96))[2]).toEqual(["T3", 110.44, "zone", 70])

    const viaExtreme = mapOf(
      [
        zone("supply", 100, 102, 4, 50, { age: 30 }),
        zone("supply", 105, 107, 4, 55, { age: 20 }),
        zone("supply", 111, 113, 4, 55, { age: 10 }), // not dominant
      ],
      { majorHigh: { price: 119, ts: "2024-12-15" }, majorLow: null },
    )
    const ladder = buy(viaExtreme, 96, 97, undefined, 96)
    expect(rungs(ladder)).toEqual([
      ["T1", 99.5, "zone", 50],
      ["T2", 104.47, "zone", 55],
      ["T3", 118.4, "major_high", null], // 119 × 0.995 → down; no containing supply band → strength null
    ])
    expect(ladder!.targets[2].whyAr).toContain("118.4")
    expect(ladder!.targets[2].whyAr).toContain("2024-12-15")
  })
})

  it("R3\u2033 last-price anchoring: a wall the price already reached is support, never a target", () => {
    // close = 100 sits AT the first wall's lower edge → T1 skips to the NEXT wall
    const atPrice = mapOf([
      zone("supply", 100, 102, 4, 50, { age: 30 }),
      zone("supply", 105, 107, 4, 55, { age: 20 }),
    ])
    expect(rungs(buy(atPrice, 96, 97, undefined, 100))).toEqual([["T1", 104.47, "zone", 55]])
    // and with ONLY the at-price wall available there is NO rung at all —
    // never a target below the live price (the owner's 13.21-vs-24.47 bug)
    const onlyAtPrice = mapOf([zone("supply", 100, 102, 4, 50, { age: 30 })])
    expect(buy(onlyAtPrice, 96, 97, undefined, 100)).toBeNull()
    // the measured-move projection must clear the close or print nothing
    const clearable = mapOf([zone("supply", 98, 99, 1, 10, { age: 40 })], { majorHigh: null, majorLow: null }, {
      sessions: 40,
      low: 90,
      high: 96,
      height: 6,
    })
    expect(rungs(buy(clearable, 96, 97, undefined, 100))).toEqual([["T1", 102.5, "measured_move", null]])
    const short = mapOf([zone("supply", 98, 99, 1, 10, { age: 40 })], { majorHigh: null, majorLow: null }, {
      sessions: 40,
      low: 90,
      high: 96,
      height: 3,
    })
    expect(buy(short, 96, 97, undefined, 100)).toBeNull()
  })

describe("buildTargetLadder — strong-wall anchoring (R3′, owner directive)", () => {
  it("T1 SKIPS weak near shelves and anchors to the nearest STRONG zone, disclosing the skip", () => {
    // the owner's example: a soft 104-106 shelf (25 < 45) the stock can clear
    // in a session is not a target — the 110-112 wall (80) anchors T1
    const map = mapOf([zone("supply", 104, 106, 2, 25, { age: 40 }), zone("supply", 110, 112, 6, 80, { age: 2 })])
    const ladder = buy(map, 96, 97)
    expect(rungs(ladder)).toEqual([["T1", 109.45, "zone", 80]]) // 110 × 0.995 → down
    expect(ladder!.targets[0].whyAr).toContain("بعد تخطي منطقة واحدة أضعف قربها")
    expect(ladder!.targets[0].whyAr).toContain("قابلة للعبور في جلسة واحدة")
  })

  it("weak zones ONLY → no zone rung at all → the measured-move fallback (or honest null)", () => {
    const weakOnly = mapOf(
      [zone("supply", 104, 106, 1, 15, { age: 40 }), zone("supply", 110, 112, 2, 25, { age: 2 })],
      { majorHigh: null, majorLow: null },
    )
    expect(buy(weakOnly, 96, 97)).toBeNull() // no measured window on the default map → abstain
    const withMeasured = mapOf(
      [zone("supply", 104, 106, 1, 15, { age: 40 }), zone("supply", 110, 112, 2, 25, { age: 2 })],
      { majorHigh: null, majorLow: null },
      { sessions: 40, low: 96, high: 116, height: 20 },
    )
    expect(rungs(buy(withMeasured, 96, 97))).toEqual([["T1", 116.5, "measured_move", null]]) // 96.5 + 20
  })

  it("a STRONG zone beyond the horizon still wins over the projection (the lens filters nothing)", () => {
    // measured height would print 120.5 — the real strong wall at 130 wins
    const map = mapOf([zone("supply", 130, 132, 3, 50, { age: 20 })], {
      majorHigh: null,
      majorLow: null,
    }, { sessions: 40, low: 100, high: 120, height: 20 })
    expect(rungs(buy(map, 100, 101))).toEqual([["T1", 129.35, "zone", 50]]) // 130 × 0.995 → down
  })

  it("a boundary-strength zone (exactly 45) is STRONG and anchors T1", () => {
    const map = mapOf([zone("supply", 104, 106, 3, 45, { age: 10 })])
    expect(rungs(buy(map, 96, 97))).toEqual([["T1", 103.48, "zone", 45]]) // 104 × 0.995 → down
  })
})

describe("buildTargetLadder — measured-move fallback (R6)", () => {
  const measured = { sessions: 40, low: 100, high: 120, height: 20 }

  it("fires only when no STRONG zone exists on the target side; labeled, strength null, no T2", () => {
    const map = mapOf([zone("demand", 94.38, 95.52, 1, 25, { age: 57 })], {
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
    const zero = mapOf([zone("demand", 94.38, 95.52, 1, 25)], { majorHigh: null, majorLow: null }, { sessions: 40, low: 100, high: 100, height: null })
    expect(buy(zero, 100, 101)).toBeNull()
  })
})

describe("buildTargetLadder — sell-side mirroring (R1′-R5)", () => {
  const demandLadder = () =>
    mapOf([
      zone("demand", 94.38, 95.52, 6, 63, { age: 57 }),
      zone("demand", 88, 90, 5, 63, { age: 70 }),
      zone("demand", 80, 82, 6, 70, { age: 90 }),
    ])

  it("walks T1 > T2 > T3 descending on demand bands, upper edges + buffer only", () => {
    const ladder = sell(demandLadder(), 100, 101)
    expect(rungs(ladder)).toEqual([
      ["T1", 96, "zone", 63], // 95.52 × 1.005 → up
      ["T2", 90.45, "zone", 63], // 90 × 1.005 → up; strength ≥ T1's, ≤ 96×0.98, below T1's band
      ["T3", 82.41, "zone", 70], // dominant (70 ≥ 60), 82 × 1.005 → up
    ])
    const prices = ladder!.targets.map((t) => t.price)
    expect(prices).toEqual([...prices].sort((a, b) => b - a))
    expect(ladder!.targets[0].price).toBeGreaterThan(95.52) // printed ABOVE the wall — cover before the bounce
  })

  it("a non-dominant deep demand zone does not justify a sell T3", () => {
    const map = mapOf([
      zone("demand", 94.38, 95.52, 6, 63, { age: 57 }),
      zone("demand", 88, 90, 5, 55, { age: 70 }),
    ])
    expect(rungs(sell(map, 100, 101))).toEqual([["T1", 96, "zone", 63]]) // 55 < T1's 63 → no T2 either
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

  it("buy [100, 101]: strong-zone T1 at the buffered edge + major-high T2, no fabricated T3", () => {
    const ladder = buy(map, 100, 101)
    expect(rungs(ladder)).toEqual([
      ["T1", 109.34, "zone", 88], // 109.89 × 0.995 → down
      ["T2", 121.43, "major_high", 32], // 122.05 × 0.995 → down
    ])
    expect(ladder!.targets[0].whyAr).toContain("وصمدت أمام 1 محاولة اختراق فاشلة")
    expect(ladder!.targets[0].whyAr).toContain("1.8 ضعف وسط السلسلة")
    expect(ladder!.targets[1].whyAr).toContain("2025-02-26")
  })

  it("buy above every zone: the measured-move projection is the whole ladder", () => {
    expect(rungs(buy(map, 124, 125))).toEqual([["T1", 147.1, "measured_move", null]]) // 124.5 + 22.6
  })

  it("buy just under the top band: the top band is weak (32 < 45) → measured-move fallback", () => {
    expect(rungs(buy(map, 120, 120.5))).toEqual([["T1", 142.85, "measured_move", null]]) // 120.25 + 22.6
  })

  it("sell [100, 101]: one demand rung buffered above the wall (no demand below 96×0.98 exists)", () => {
    expect(rungs(sell(map, 100, 101))).toEqual([["T1", 96, "zone", 63]])
  })

  it("sell above the 104.57 band: it is not BELOW the entry (strict edge) → skipped", () => {
    expect(rungs(sell(map, 104, 105))).toEqual([["T1", 96, "zone", 63]])
  })

  it("exports the documented rung rules", () => {
    expect(TARGET_RULES.MIN_TARGET_STRENGTH).toBe(20)
    expect(TARGET_RULES.MIN_TARGET_TOUCHES).toBe(2)
    expect(TARGET_RULES.STRONG_TARGET_STRENGTH).toBe(45)
    expect(TARGET_RULES.PREWALL_BUFFER_PCT).toBe(0.5)
    expect(TARGET_RULES.SEPARATION_PCT).toBe(2)
    expect(TARGET_RULES.T3_MIN_STRENGTH).toBe(60)
    expect(TARGET_RULES.HORIZON_PCT).toBe(5)
  })
})
