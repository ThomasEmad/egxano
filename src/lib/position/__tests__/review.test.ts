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
