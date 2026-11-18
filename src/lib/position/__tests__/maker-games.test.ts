// =============================================================================
// maker-games tests — the 100-year EGX maker playbook (OWNER MANDATE
// 2026-11-18). Each detector is pinned against a hand-built evidence set:
// bars + zone map + the whole-market section. Honesty is the contract: a
// game with missing evidence stays SILENT ([]), never guessed.
// =============================================================================

import { describe, expect, it } from "vitest"
import { makerGamesAr, marketMapAr, MAKER_MAX_LINES, type MakerOpts } from "../maker-games"
import { buildMarketContext, type MarketContext } from "../market-context"
import type { MarketContextSection } from "@/lib/technical/analyze"
import type { Bar } from "@/lib/signals/types"
import type { PriceZone, ZoneMap } from "@/lib/signals/levels"

const nullCtx = (): MarketContext => buildMarketContext([], null)
const ctxOver = (over: Partial<MarketContext>): MarketContext => ({ ...nullCtx(), ...over })

/** Hand-built support zone (the map is the evidence source for G1/G4). */
const sup = (low: number, high: number, touches = 2): PriceZone => ({
  kind: "support",
  positionKind: "support",
  low,
  high,
  touches,
  lastTouchTs: "2026-03-01-000",
  lastTouchIdx: 3,
  broken: false,
})
const zoneMap = (...zones: PriceZone[]): ZoneMap => ({ atr: null, zones })

let seq = 0
/** One bar with open=close; the day's anatomy (high/low) overridable. */
function barAt(close: number, over: Partial<Bar> = {}): Bar {
  seq++
  const ts = `2026-03-${String((seq % 28) + 1).padStart(2, "0")}-${String(seq).padStart(3, "0")}`
  return { ts, open: close, high: close + 0.35, low: close - 0.35, close, volume: 1000, ...over }
}

const makerOpts = (over: Partial<MakerOpts> = {}): MakerOpts => ({
  branch: "hold",
  avgBuyPrice: 100,
  close: 101.8,
  trendAr: "متذبذب — السعر تحت EMA50 بدون كسر ترتيب كامل",
  cushion: null,
  nearestSupportLow: null,
  prevClose: null,
  bars: [],
  map: null,
  mctx: null,
  ...over,
})

const fullMctx = (over: Partial<MarketContextSection> = {}): MarketContextSection => ({
  available: true,
  asOf: "2026-03-12",
  marketRegime: "correction",
  marketRegimeAr: "سوق تصحيح",
  marketPulse: -1.2,
  breadth: { advancing: 10, declining: 40, unchanged: 5, ratio: 0.25 },
  aboveEma20: 12,
  aboveEma50: 18,
  aboveEma200: 30,
  sector: { name: "بنوك", dayChangePct: 1.0, advancing: 3, declining: 12, turnoverSharePct: 22.5, turnoverShareDelta5d: 1.1 },
  relVolRankPct: 55,
  limitations: [],
  ...over,
})

// =============================================================================
// G1 «الكسر الكاذب لجمع السيولة» — break inside the window + recovery above
// =============================================================================

describe("makerGamesAr — G1: the fake break (liquidity collection)", () => {
  it("closed below a trusted support one session ago, latest close back ABOVE the level → the game is named with the level and the close", () => {
    // zone 100.00–100.50 (2×); break at idx 6 (99.40), recovery at idx 7 (101.80)
    const bars = [
      barAt(101), barAt(101.2), barAt(101.4), barAt(101.3),
      barAt(101.5), barAt(101.4), barAt(99.4), barAt(101.8),
    ]
    const lines = makerGamesAr(nullCtx(), makerOpts({ bars, map: zoneMap(sup(100, 100.5)), close: 101.8 }))
    expect(lines.length).toBe(1)
    const l = lines[0]!
    expect(l).toContain("الكسر الكاذب لجمع السيولة") // the game's name
    expect(l).toContain("جمع سيولة") // the maker's plan
    expect(l).toContain("100.00") // the broken level, 2-decimal
    expect(l).toContain("101.80") // the recovery close
    expect(l).toContain("من جلسة واحدة") // the break is one session back
    expect(l).toContain("هو الحكم مش اللمسة") // the safe response
  })

  it("the break still LIVE (latest close below the zone, far from the level) → G1 and G4 stay silent (no recovery, no retest)", () => {
    const bars = [barAt(101), barAt(101.2), barAt(101.4), barAt(101.3), barAt(101.5), barAt(101.4), barAt(101.6), barAt(97.0)]
    const lines = makerGamesAr(nullCtx(), makerOpts({ bars, map: zoneMap(sup(100, 100.5)), close: 97.0 }))
    expect(lines).toEqual([])
  })
})

// =============================================================================
// G2 «اللمس تحت وإغلاق فوق» — long lower tail + close back above the support
// =============================================================================

describe("makerGamesAr — G2: the touch-under close-above sweep", () => {
  it("lower tail 83.3٪ of the day's range + close above the support low (tail verified piercing) → the sweep line", () => {
    const bars = [
      barAt(101), barAt(101.5), barAt(102), barAt(102.5), barAt(103), barAt(103),
      barAt(103, { high: 103.2, low: 102.0 }), // the tail's low pierces the 102.50 support
    ]
    const lines = makerGamesAr(
      ctxOver({ lowerShadowPct: 83.3 }),
      makerOpts({ bars, nearestSupportLow: 102.5, close: 103 }),
    )
    expect(lines.length).toBe(1)
    const l = lines[0]!
    expect(l).toContain("اللمس تحت وإغلاق فوق") // the game's name
    expect(l).toContain("83.3٪") // the real wick share
    expect(l).toContain("102.50") // the support level
    expect(l).toContain("103.00") // the close
    expect(l).toContain("ستوبات") // the maker's plan: stop sweep
  })

  it("no known support low → G2 stays silent (both sides must be known)", () => {
    const lines = makerGamesAr(ctxOver({ lowerShadowPct: 83.3 }), makerOpts({ nearestSupportLow: null, close: 103 }))
    expect(lines).toEqual([])
  })
})

// =============================================================================
// G3 «السهم المقفول بالسعر» — the frozen tape
// =============================================================================

describe("makerGamesAr — G3: the price-locked stock", () => {
  it("3 trailing sessions inside 0.2٪ of the close → the frozen line with the count and the spread bound", () => {
    const bars = [
      barAt(50.5), barAt(50.3), barAt(50.2), barAt(50.1), barAt(50.0), // normal spreads ~0.7٪
      barAt(50.0, { high: 50.04, low: 49.96 }),
      barAt(50.0, { high: 50.04, low: 49.96 }),
      barAt(50.0, { high: 50.04, low: 49.96 }),
    ]
    const lines = makerGamesAr(nullCtx(), makerOpts({ bars, close: 50.0 }))
    expect(lines.length).toBe(1)
    const l = lines[0]!
    expect(l).toContain("متجمد بالسعر") // the game's name
    expect(l).toContain("3 جلسات") // the real count
    expect(l).toContain("0.2٪") // the frozen bound
    expect(l).toContain("50.00") // the close
    expect(l).toContain("مفاجأة بفوليوم") // the safe response
  })

  it("2 frozen sessions only → silent (the lock must hold 3+)", () => {
    const bars = [barAt(50.3), barAt(50.2), barAt(50.1), barAt(50.0, { high: 50.04, low: 49.96 }), barAt(50.0, { high: 50.04, low: 49.96 })]
    expect(makerGamesAr(nullCtx(), makerOpts({ bars, close: 50.0 }))).toEqual([])
  })
})

// =============================================================================
// G4 «اختبار الكسر» — break inside the window + close within ±1٪ of the level
// =============================================================================

describe("makerGamesAr — G4: the retest of the broken level", () => {
  it("broken one session ago, close 0.4٪ BELOW the level → the retest line (no G1 — no recovery yet)", () => {
    const bars = [
      barAt(100.9), barAt(100.7), barAt(100.8), barAt(100.9),
      barAt(100.6), barAt(100.9), barAt(99.4), barAt(99.6),
    ]
    const lines = makerGamesAr(nullCtx(), makerOpts({ bars, map: zoneMap(sup(100, 100.5)), close: 99.6 }))
    expect(lines.length).toBe(1)
    const l = lines[0]!
    expect(l).toContain("اختبار الكسر") // the game's name
    expect(l).toContain("100.00") // the broken level
    expect(l).toContain("99.60") // the close
    expect(l).toContain("تأكيد الكسر") // volume under = confirmation
    expect(l).toContain("قلب أدوار") // holding above on dry volume = flip
    expect(l).not.toContain("جمع سيولة") // G1 silent: no recovery
  })

  it("close far from the broken level (2٪+) → silent (the retest is not live)", () => {
    const bars = [barAt(100.9), barAt(100.7), barAt(100.8), barAt(100.9), barAt(100.6), barAt(100.9), barAt(99.4), barAt(97.8)]
    expect(makerGamesAr(nullCtx(), makerOpts({ bars, map: zoneMap(sup(100, 100.5)), close: 97.8 }))).toEqual([])
  })
})

// =============================================================================
// G5 «القوة النسبية ضد السوق» — stock day change vs sector day change
// =============================================================================

describe("makerGamesAr — G5: relative strength vs the sector", () => {
  it("stock −2.5٪ while the sector is +1.0٪ green → the hidden-selling line (the most dangerous selling)", () => {
    const mctx = fullMctx({ sector: { name: "بنوك", dayChangePct: 1.0, advancing: 3, declining: 12, turnoverSharePct: 22.5, turnoverShareDelta5d: 1.1 } })
    const lines = makerGamesAr(nullCtx(), makerOpts({ close: 97.5, prevClose: 100, mctx, branch: "cushionWait" }))
    expect(lines.length).toBe(1)
    const l = lines[0]!
    expect(l).toContain("بيع مستتر") // the game's name
    expect(l).toContain("-2.5٪") // the stock's real day change
    expect(l).toContain("+1.0٪") // the sector's real day change
    expect(l).toContain("أخطر بيع في السوق") // the plan named
  })

  it("stock +2.0٪ while the sector is −1.0٪ red → the relative-strength line", () => {
    const mctx = fullMctx({
      sector: { name: "بنوك", dayChangePct: -1.0, advancing: 3, declining: 12, turnoverSharePct: 22.5, turnoverShareDelta5d: 1.1 },
      breadth: { advancing: 30, declining: 10, unchanged: 5, ratio: 3 }, // keep G6 out of this pin
    })
    const lines = makerGamesAr(nullCtx(), makerOpts({ close: 102, prevClose: 100, mctx, branch: "hold" }))
    expect(lines.length).toBe(1)
    const l = lines[0]!
    expect(l).toContain("قوة نسبية") // the game's name
    expect(l).toContain("+2.0٪")
    expect(l).toContain("-1.0٪")
    expect(l).toContain("القطاع بينزّل") // the plan named
  })

  it("a sub-1.5pp gap or a missing sector day change → silent", () => {
    const weak = fullMctx({ sector: { name: "بنوك", dayChangePct: 1.0, advancing: 3, declining: 12, turnoverSharePct: 22.5, turnoverShareDelta5d: 1.1 } })
    expect(makerGamesAr(nullCtx(), makerOpts({ close: 100.6, prevClose: 100, mctx: weak, branch: "cushionWait" }))).toEqual([]) // −0.4pp, and G6 is hold-gated
    const noSector = fullMctx({ sector: null, breadth: { advancing: 30, declining: 10, unchanged: 5, ratio: 3 } })
    expect(makerGamesAr(nullCtx(), makerOpts({ close: 97.5, prevClose: 100, mctx: noSector }))).toEqual([])
  })
})

// =============================================================================
// G6 «السهم تحت أمطار السوق» — wide red breadth + a stock holding ≥ 0 (hold)
// =============================================================================

describe("makerGamesAr — G6: the stock standing in the market's rain", () => {
  it("breadth 10 advancing / 40 declining (2× rule) + stock flat on hold → the protection line", () => {
    const lines = makerGamesAr(nullCtx(), makerOpts({ close: 100.5, prevClose: 100, mctx: fullMctx(), branch: "hold" }))
    expect(lines.length).toBe(1)
    const l = lines[0]!
    expect(l).toContain("بيصبّ") // the game's name
    expect(l).toContain("40 هابط") // the real declining count
    expect(l).toContain("10 صاعد") // the real advancing count
    expect(l).toContain("حماية بتتشترى") // the plan named
  })

  it("the G6 gate: not the hold branch, or the stock red, or breadth not 2× → silent", () => {
    expect(makerGamesAr(nullCtx(), makerOpts({ close: 100.5, prevClose: 100, mctx: fullMctx(), branch: "cushionWait" }))).toEqual([])
    // the stock red (−0.5٪) vs a −0.5٪ sector: no G6 (stock < 0), no G5 (pp 0)
    const redSector = fullMctx({ sector: { name: "بنوك", dayChangePct: -0.5, advancing: 3, declining: 12, turnoverSharePct: 22.5, turnoverShareDelta5d: 1.1 } })
    expect(makerGamesAr(nullCtx(), makerOpts({ close: 99.5, prevClose: 100, mctx: redSector, branch: "hold" }))).toEqual([])
    const calm = fullMctx({ breadth: { advancing: 30, declining: 10, unchanged: 5, ratio: 3 } })
    expect(makerGamesAr(nullCtx(), makerOpts({ close: 100.5, prevClose: 100, mctx: calm, branch: "hold" }))).toEqual([])
  })
})

// =============================================================================
// cap + honesty — the playbook speaks at most MAKER_MAX_LINES lines, in the
// playbook's own order G1→G6; an all-null evidence set stays silent.
// =============================================================================

describe("makerGamesAr — the cap and the all-null honesty gate", () => {
  it("every game firing at once → exactly 2 lines, playbook order (G1 then G2)", () => {
    // zone 100–100.5 (2×): break at idx 6 (99.40), recovery to 100.40 — the
    // last 3 bars frozen (≤ 0.2٪ spreads) so G3 fires too; G2 on ctx; G5/G6
    // on the market section (sector red + wide red breadth).
    const bars = [
      barAt(101), barAt(101.2), barAt(101.4), barAt(101.3),
      barAt(101.5), barAt(101.4),
      barAt(99.4, { high: 99.42, low: 99.38 }),
      barAt(100.4, { high: 100.44, low: 100.36 }),
    ]
    const lines = makerGamesAr(
      ctxOver({ lowerShadowPct: 60 }),
      makerOpts({
        bars,
        map: zoneMap(sup(100, 100.5)),
        close: 100.4,
        prevClose: 99.4,
        nearestSupportLow: 100,
        mctx: fullMctx({ sector: { name: "بنوك", dayChangePct: -1.0, advancing: 3, declining: 12, turnoverSharePct: 22.5, turnoverShareDelta5d: 1.1 } }),
        branch: "hold",
      }),
    )
    expect(lines.length).toBe(MAKER_MAX_LINES)
    expect(lines[0]).toContain("الكسر الكاذب لجمع السيولة") // G1
    expect(lines[1]).toContain("ذيل سفلي") // G2 (tail did not pierce here → the honest non-pierce wording)
    expect(lines.every((l) => !l.includes("متجمد") && !l.includes("قوة نسبية"))).toBe(true) // G3/G5 capped out
  })

  it("an all-null evidence set (empty bars, no map, no cushion, no marketCtx) → []", () => {
    for (const branch of ["deepLoss", "farCushionExit", "cushionWait", "engineExit", "takeProfit", "hold"] as const) {
      expect(makerGamesAr(nullCtx(), makerOpts({ branch }))).toEqual([])
    }
  })

  it("MAKER_MAX_LINES is exactly 2", () => {
    expect(MAKER_MAX_LINES).toBe(2)
  })
})

// =============================================================================
// marketMapAr — «خريطة السوق النهاردة»: one line, whole-market read + the
// branch-tailored implication; all-null → [].
// =============================================================================

describe("marketMapAr — the day's market map", () => {
  it("a full market section → ONE line naming the regime, the breadth, the sector's day change, the bottoms environment and the hold implication", () => {
    const lines = marketMapAr(fullMctx(), { close: 106.5, branch: "hold" })
    expect(lines.length).toBe(1)
    const l = lines[0]!
    expect(l).toContain("خريطة السوق النهاردة") // the map's name
    expect(l).toContain("سوق تصحيح") // the regime
    expect(l).toContain("10 صاعد") // the breadth's advancing
    expect(l).toContain("40 هابط") // the breadth's declining
    expect(l).toContain("(نسبة 0.25)") // the breadth ratio as carried
    expect(l).toContain("بنوك") // the company's sector
    expect(l).toContain("+1.0٪") // the sector's day change
    expect(l).toContain("بيئة قيعان") // aboveEma20 = 12 ≤ 15 → bottoms regime
    expect(l).toContain("الاحتفاظ") // the branch-tailored implication
    expect(l).not.toContain("حدود الخريطة") // a complete map needs no disclaimer
  })

  it("a partial map (breadth missing) quotes ONE honest limitation clause", () => {
    const mctx = fullMctx({
      breadth: null,
      limitations: ["بيانات الاتساع مش متاحة للجلسة دي"],
    })
    const lines = marketMapAr(mctx, { close: 106.5, branch: "hold" })
    expect(lines.length).toBe(1)
    expect(lines[0]).toContain("حدود الخريطة: بيانات الاتساع مش متاحة للجلسة دي")
    expect(lines[0]).toContain("سوق تصحيح") // what the map CAN see stays
  })

  it("null / undefined / available=false → []", () => {
    expect(marketMapAr(null, { close: 106.5, branch: "hold" })).toEqual([])
    expect(marketMapAr(undefined, { close: 106.5, branch: "hold" })).toEqual([])
    expect(marketMapAr(fullMctx({ available: false }), { close: 106.5, branch: "hold" })).toEqual([])
  })

  it("available with everything null inside → [] (no clauses, no invented map)", () => {
    const mctx = fullMctx({
      marketRegimeAr: null,
      breadth: null,
      sector: null,
      aboveEma20: null,
    })
    expect(marketMapAr(mctx, { close: 106.5, branch: "hold" })).toEqual([])
  })

  it("the implications follow the branch (exit → the with-the-tape clause)", () => {
    const lines = marketMapAr(fullMctx({ aboveEma20: 88 }), { close: 103, branch: "farCushionExit" })
    expect(lines.length).toBe(1)
    expect(lines[0]).toContain("بيئة قمم") // aboveEma20 = 88 ≥ 85 → tops regime
    expect(lines[0]).toContain("عكس التيار") // the exit implication
  })
})
