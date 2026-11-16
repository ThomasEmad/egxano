// =============================================================================
// حلل سهمي (Position Review) — decision-ladder tests. The rows are hand-built
// SignalRowV2 objects over engineered bar series (bars-fixture.ts): the
// ladder's branches are asserted against exact zone geometry.
// =============================================================================

import { describe, expect, it } from "vitest"
import { buildZoneMap } from "@/lib/signals/levels"
import { computeMetrics, toSignalMetrics } from "@/lib/signals/metrics"
import type { SignalRowV2, SignalState, SignalMetrics } from "@/lib/signals/types"
import { reviewPosition } from "../review"
import { cushionSeries, decliningSeries } from "./bars-fixture"

function rowOver(bars: ReturnType<typeof cushionSeries>, over: Partial<SignalRowV2> & { state: SignalState }): SignalRowV2 {
  const m = computeMetrics(bars)!
  const metrics: SignalMetrics = toSignalMetrics(m)
  return {
    companyId: "c1",
    ticker: "TEST",
    nameEn: "Test Co",
    nameAr: "شركة الاختبار",
    sector: "Tests",
    marketTier: "EGX30",
    type: null,
    asOf: "2026-03-12",
    lastClose: bars[bars.length - 1].close,
    changePct: null,
    score: 50,
    scoreGroups: null,
    evidence: [],
    plan: null,
    setup: null,
    invalidationAr: null,
    metrics,
    quality: { bars: bars.length, ohlc: true, liquidity: "normal", avgTradedValueEgp: null, dataAgeSessions: 0, notesAr: [] },
    warnings: [],
    engine: "test",
    ...over,
  }
}

describe("reviewPosition — the decision ladder", () => {
  it("support break + far cushion → EXIT with the P/L and the cushion distance spelled out", () => {
    const bars = cushionSeries(97) // cushion 97–97.4, close 103 → gap 5.44%
    const map = buildZoneMap(bars)
    const r = reviewPosition({ row: rowOver(bars, { state: "exit" }), bars, map, avgBuyPrice: 105 })
    expect(r.decision).toBe("exit")
    expect(r.pnlPct).toBeLessThan(0)
    expect(r.reasonsAr.some((x) => x.includes("مساحة الهبوط مفتوحة") || x.includes("بعيد"))).toBe(true)
    expect(r.invalidationAr).toContain("104.00") // the broken zone's low
    // the cushion zone is listed among the supports with its exact distance
    const cushionLine = r.supports.find((s) => s.high === 97.4)
    expect(cushionLine).toBeDefined()
    expect(cushionLine!.distFromPricePct).toBeCloseTo(-5.6, 1)
  })

  it("support break + close cushion (gap 2.5%) → WAIT, not a forced sell", () => {
    const bars = cushionSeries(100)
    const map = buildZoneMap(bars)
    const r = reviewPosition({ row: rowOver(bars, { state: "wait" }), bars, map, avgBuyPrice: 105 })
    expect(r.decision).toBe("wait")
    expect(r.headlineAr).toContain("أسوأ مكان") // the friend's verdict line
    expect(r.invalidationAr).toContain("100.40") // the cushion activation
    expect(r.decisionAr).toBe("انتظر وراقب")
  })

  it("borderline band (3–4%) → WAIT with the tighter-stop note", () => {
    const bars = cushionSeries(99)
    const map = buildZoneMap(bars)
    const r = reviewPosition({ row: rowOver(bars, { state: "wait" }), bars, map, avgBuyPrice: 105 })
    expect(r.decision).toBe("wait")
    expect(r.reasonsAr.some((x) => x.includes("الحدّية"))).toBe(true)
  })

  it("in profit, no break → HOLD with the trailing line at the nearest support", () => {
    const bars = cushionSeries(100, 106.5) // close above the 104 zone → no break
    const map = buildZoneMap(bars)
    const r = reviewPosition({ row: rowOver(bars, { state: "wait" }), bars, map, avgBuyPrice: 100 })
    expect(r.decision).toBe("hold")
    expect(r.pnlPct).toBeGreaterThan(0)
    expect(r.invalidationAr).toContain("104.40") // the nearest support's edge
    // both reference distances are on every level line
    const z104 = r.supports.find((s) => s.high === 104.4)
    expect(z104).toBeDefined()
    expect(z104!.distFromAvgPct).toBeCloseTo(((104.2 - 100) / 100) * 100, 1)
  })

  it("at a loss on a support → WAIT (the close cushion argument), never a panic sell", () => {
    const bars = cushionSeries(100, 106.5)
    const map = buildZoneMap(bars)
    const r = reviewPosition({ row: rowOver(bars, { state: "wait" }), bars, map, avgBuyPrice: 110 })
    expect(r.decision).toBe("wait")
    expect(r.pnlPct).toBeLessThan(0)
    expect(r.reasonsAr.some((x) => x.includes("الأرقام") || x.includes("الأمل"))).toBe(true)
  })

  it("at a loss, broken trend, open field below → EXIT (protect the remaining capital)", () => {
    const bars = decliningSeries() // no supports at all
    const map = buildZoneMap(bars)
    const r = reviewPosition({
      row: rowOver(bars, {
        state: "wait",
        metrics: { ...toSignalMetrics(computeMetrics(bars)!), ema20: 104, ema50: 107 }, // close 100 < ema50, ema20 < ema50
      }),
      bars,
      map,
      avgBuyPrice: 115,
    })
    expect(r.decision).toBe("exit")
    expect(r.pnlPct).toBeLessThan(0)
    expect(r.reasonsAr.some((x) => x.includes("مفيش أي دعم مسجل"))).toBe(true)
  })

  it("every decision carries the full disclosure set (basis, warnings channel, snapshot)", () => {
    for (const [base, buy] of [[97, 105], [100, 105], [100, 100], [110, 110]] as const) {
      const bars = cushionSeries(base, base === 110 ? 106.5 : undefined)
      const map = buildZoneMap(bars)
      const r = reviewPosition({ row: rowOver(bars, { state: "wait" }), bars, map, avgBuyPrice: buy })
      expect(r.levelsBasisAr.length).toBeGreaterThan(20)
      expect(r.snapshot.bars).toBe(bars.length)
      expect(r.reasonsAr.length).toBeGreaterThanOrEqual(4)
    }
  })
})

// =============================================================================
// OWNER MANDATE (2026-11-17) — the deep-loss regime: at −20% or deeper the
// exit verdict collapses into انتظار للارتداد, the recovery math is spelled
// out, and the follow-up question refines the plan.
// =============================================================================

import { DEEP_LOSS_PCT, recoveryNeededPct } from "../review"

describe("recoveryNeededPct — the compounding math", () => {
  it("matches the owner's table: −50%→+100%, −25%→+33.3%, −20%→+25%, −10%→+11.1%", () => {
    expect(recoveryNeededPct(200, 100)).toBeCloseTo(100, 6)
    expect(recoveryNeededPct(400 / 3, 100)).toBeCloseTo(100 / 3, 6)
    expect(recoveryNeededPct(125, 100)).toBeCloseTo(25, 6)
    expect(recoveryNeededPct(1000 / 9, 100)).toBeCloseTo(100 / 9, 6)
  })
})

describe("reviewPosition — the deep-loss regime (pnl ≤ −20%)", () => {
  it("far-cushion break + deep loss → WAIT (never exit) + recovery math + the question", () => {
    const bars = cushionSeries(97) // close 103, far cushion 5.44%
    const map = buildZoneMap(bars)
    const r = reviewPosition({ row: rowOver(bars, { state: "exit" }), bars, map, avgBuyPrice: 130 }) // pnl −20.8%
    expect(r.decision).toBe("wait")
    expect(r.pnlPct).toBeCloseTo(-20.8, 1)
    expect(r.recoveryPct).toBeCloseTo(26.2, 1)
    expect(r.question).not.toBeNull()
    expect(r.question!.answeredAr).toBeNull()
    expect(r.reasonsAr.some((x) => x.includes("+26.2٪"))).toBe(true) // the user's OWN number
    expect(r.reasonsAr.some((x) => x.includes("+100٪"))).toBe(true) // the −50% example
    expect(r.closingAr).toContain("قرار مؤكد")
    // the cushion line is still the invalidation (waiting has a stop)
    expect(r.invalidationAr).toContain("97.40")
  })

  it("the question answer refines the plan: yes → sell on the first rebound", () => {
    const bars = cushionSeries(97)
    const map = buildZoneMap(bars)
    const r = reviewPosition({ row: rowOver(bars, { state: "exit" }), bars, map, avgBuyPrice: 130, downsideAnswer: "yes" })
    expect(r.decision).toBe("wait") // still holding NOW — the plan is the rebound exit
    expect(r.planAr).toContain("أول ارتداد")
    expect(r.question!.answeredAr).toBe(r.question!.yesOutcomeAr)
    expect(r.headlineAr).toContain("أول ارتداد")
  })

  it("the question answer no → waiting is reasonable (with the stop intact)", () => {
    const bars = cushionSeries(97)
    const map = buildZoneMap(bars)
    const r = reviewPosition({ row: rowOver(bars, { state: "exit" }), bars, map, avgBuyPrice: 130, downsideAnswer: "no" })
    expect(r.decision).toBe("wait")
    expect(r.planAr).toContain("الانتظار")
    expect(r.invalidationAr).toContain("97.40")
  })

  it("the −20% boundary: −19.8% stays in the normal ladder (no question), −20.1% enters the regime", () => {
    const bars = cushionSeries(100, 106.5) // close 106.5, no break
    const map = buildZoneMap(bars)
    const above = reviewPosition({ row: rowOver(bars, { state: "wait" }), bars, map, avgBuyPrice: 132.8 }) // pnl −19.8%
    expect(above.decision).toBe("wait")
    expect(above.question).toBeNull()
    const below = reviewPosition({ row: rowOver(bars, { state: "wait" }), bars, map, avgBuyPrice: 133.2 }) // pnl −20.1%
    expect(below.decision).toBe("wait")
    expect(below.question).not.toBeNull()
    expect(below.recoveryPct).toBeGreaterThan(20)
  })

  it(`the threshold constant is exactly ${DEEP_LOSS_PCT}`, () => {
    expect(DEEP_LOSS_PCT).toBe(20)
  })
})

// =============================================================================
// OWNER MANDATE (2026-11-18) — round two:
//   • a support >15% away or touched only once is NOT a floor → EMA20 is the
//     practical support (EGX makers paint single-touch lows constantly)
//   • NO auto-stop advice: makers fake-break levels to grab liquidity — the
//     user watches the stock on screen and judges by the CLOSE
// =============================================================================

import { NEAR_SUPPORT_MAX_GAP_PCT, pickEffectiveSupport } from "../review"
import type { LevelLine } from "../types"

describe("pickEffectiveSupport — the EMA20 fallback rule", () => {
  const line = (overrides: Partial<LevelLine>): LevelLine => ({
    kind: "support", low: 90, high: 91, touches: 2, broken: false, lastTouchTs: "2026-03-01",
    distFromPricePct: 5, distFromAvgPct: 0, noteAr: "", ...overrides,
  })

  it(`a 2× support within ${NEAR_SUPPORT_MAX_GAP_PCT}٪ stays the floor`, () => {
    const eff = pickEffectiveSupport([line({ touches: 3, distFromPricePct: 6 })], 100, 95)
    expect(eff).not.toBeNull()
    expect(eff!.kind).toBe("zone")
    expect(eff!.level).toBe(91)
  })

  it("a single-touch support is replaced by EMA20", () => {
    const eff = pickEffectiveSupport([line({ touches: 1, distFromPricePct: 4 })], 100, 96.5)
    expect(eff!.kind).toBe("ema20")
    expect(eff!.level).toBe(96.5)
    expect(eff!.basisAr).toContain("لمسة واحدة")
    expect(eff!.basisAr).toContain("EMA20")
  })

  it("a support farther than 15٪ is replaced by EMA20", () => {
    const eff = pickEffectiveSupport([line({ touches: 4, distFromPricePct: 18 })], 100, 97)
    expect(eff!.kind).toBe("ema20")
    expect(eff!.basisAr).toContain("بعيد")
  })

  it("no EMA20 below the close → the raw zone survives, flagged weak", () => {
    const eff = pickEffectiveSupport([line({ touches: 1, distFromPricePct: 20 })], 100, null)
    expect(eff!.kind).toBe("zone")
    expect(eff!.basisAr).toContain("ضعيف")
  })
})

describe("the fake-break doctrine — no auto-stop advice", () => {
  it("the report teaches close-based judgment and names the makers' fake breaks", () => {
    const bars = cushionSeries(100, 106.5) // small loss, cushion right under
    const map = buildZoneMap(bars)
    const r = reviewPosition({ row: rowOver(bars, { state: "wait" }), bars, map, avgBuyPrice: 110 })
    const all = r.reasonsAr.join(" ") + " " + r.invalidationAr + " " + (r.planAr ?? "")
    expect(all).toContain("كاذب")
    expect(all).toContain("الصنّاع")
    expect(all).toContain("بالإغلاق")
    // zero auto-stop INSTRUCTIONS (the doctrine sentence itself names the trap)
    expect(all).not.toContain("خلي القرار آلي")
    expect(all).not.toContain("تنبيه آلي")
    expect(all).not.toContain("حط التنبيه")
    expect(all).toContain("الشاشة")
  })
})
