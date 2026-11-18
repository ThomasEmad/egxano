// =============================================================================
// market-lexicon — the EGX analyst phrasebook tests (OWNER MANDATE
// 2026-11-18: «متعلم من كل محللين الفيس بوك الخبراء»). The phrasebook fires
// ONLY on its own trigger, cites real context numbers, ends with the
// watch-next clause, stays silent ([]) on an honestly-null context, and —
// through narrativeLinesAr — never exceeds 4 lines with the veteran entries
// first, the lexicon after, and the VSA passthrough last.
// =============================================================================

import { describe, expect, it } from "vitest"
import { lexiconLinesAr } from "../market-lexicon"
import { narrativeLinesAr, veteranLinesAr, NARRATIVE_MAX_LINES, type VeteranOpts } from "../review"
import { buildMarketContext, type MarketContext } from "../market-context"

const nullCtx = (): MarketContext => buildMarketContext([], null)
const ctxOver = (over: Partial<MarketContext>): MarketContext => ({ ...nullCtx(), ...over })
const opts = (over: Partial<VeteranOpts> = {}): VeteranOpts => ({
  branch: "hold",
  avgBuyPrice: 100,
  close: 208.18,
  trendAr: "صاعد — السعر فوق EMA50 وEMA20 فوق EMA50 (ترتيب صحي)",
  ...over,
})
const downTrendAr = "هابط — السعر تحت EMA50 وEMA20 تحت EMA50 (ترتيب سلبي)"
const words = (s: string): number => s.trim().split(/\s+/).length

describe("lexiconLinesAr — the trigger set", () => {
  it("(a) roundLevelNear {210, 0.87٪} on hold → the round-number line names «210.00», the idiom, the ceiling and the watch-next", () => {
    const ctx = ctxOver({ roundLevelNear: { level: 210, distPct: 0.87 } })
    const lines = lexiconLinesAr(ctx, opts())
    expect(lines.length).toBe(1)
    const l = lines[0]!
    expect(l).toContain("الأرقام المستديرة أرضيات وسقوف") // the community idiom
    expect(l).toContain("210.00") // the real level (2-decimal helper style)
    expect(l).toContain("0.9٪") // the real distance, 1-decimal
    expect(l).toContain("سقف") // level ABOVE the close → ceiling
    expect(l).toContain("اللمسة مش كسر") // the touch-vs-break law
    expect(l).toContain("المتفرج عليه") // the watch-next clause
  })

  it("a round level BELOW the close reads as أرضية (with the role-reversal law in the watch-next)", () => {
    const ctx = ctxOver({ roundLevelNear: { level: 200, distPct: 1.4 } })
    const lines = lexiconLinesAr(ctx, opts({ trendAr: downTrendAr }))
    expect(lines.length).toBe(1)
    const l = lines[0]!
    expect(l).toContain("200.00")
    expect(l).toContain("أرضية")
    expect(l).not.toContain("كسر الغطاء")
    expect(l).toContain("المتفرج عليه")
  })

  it("standing exactly ON the round level → the standoff line (level === close, distPct 0)", () => {
    const ctx = ctxOver({ roundLevelNear: { level: 208.18, distPct: 0 } })
    const lines = lexiconLinesAr(ctx, opts())
    expect(lines.length).toBe(1)
    expect(lines[0]).toContain("208.18")
    expect(lines[0]).toContain("المتفرج عليه")
  })

  it("(b) consolidation {7 sessions, 2.1٪} + nearRangeTop on hold → the «تجميعة» line with both real numbers and the watch-next", () => {
    const ctx = ctxOver({ consolidation: { sessions: 7, tightnessPct: 2.1 }, nearRangeTop: true })
    const lines = lexiconLinesAr(ctx, opts())
    expect(lines.length).toBe(1)
    const l = lines[0]!
    expect(l).toContain("تجميعة")
    expect(l).toContain("7")
    expect(l).toContain("2.1٪")
    expect(l).toContain("وقود الحركة الجاية") // the community law, verbatim
    expect(l).toContain("المتفرج عليه")
  })

  it("the same consolidation at the range BOTTOM (deepLoss) → the capitulation line with the numbers", () => {
    const ctx = ctxOver({ consolidation: { sessions: 9, tightnessPct: 1.8 }, nearRangeBottom: true })
    const lines = lexiconLinesAr(ctx, opts({ branch: "deepLoss", trendAr: downTrendAr }))
    expect(lines.length).toBe(1)
    const l = lines[0]!
    expect(l).toContain("تجميعة")
    expect(l).toContain("9")
    expect(l).toContain("1.8٪")
    expect(l).toContain("القاع بيتصنع بالتدريج")
    expect(l).toContain("دفعة لمّية")
    expect(l).toContain("المتفرج عليه")
  })

  it("(c) volTrend5 falling + nearRangeTop on hold → the «سيولة مدّارة» line with the dry bound", () => {
    const ctx = ctxOver({ volTrend5: "falling", nearRangeTop: true })
    const lines = lexiconLinesAr(ctx, opts())
    expect(lines.length).toBe(1)
    const l = lines[0]!
    expect(l).toContain("سيولة مدّارة")
    expect(l).toContain("0.7×") // the context's own documented falling bound
    expect(l).toContain("الفوليوم بيكلم قبل السعر")
    expect(l).toContain("المتفرج عليه")
  })

  it("volTrend5 rising on a red exit → the documented-break line («الكسر الكاذب بيصطاد العجلة»)", () => {
    const ctx = ctxOver({ volTrend5: "rising" })
    const lines = lexiconLinesAr(ctx, opts({ branch: "farCushionExit", trendAr: downTrendAr }))
    expect(lines.length).toBe(1)
    const l = lines[0]!
    expect(l).toContain("1.3×") // the context's own documented rising bound
    expect(l).toContain("الكسر الكاذب بيصطاد العجلة")
    expect(l).toContain("المتفرج عليه")
  })

  it("volTrend5 rising in a loss wait → the first-injection («ضخ») hint line", () => {
    const ctx = ctxOver({ volTrend5: "rising" })
    const lines = lexiconLinesAr(ctx, opts({ branch: "cushionWait", trendAr: downTrendAr }))
    expect(lines.length).toBe(1)
    expect(lines[0]).toContain("ضخ")
    expect(lines[0]).toContain("1.3×")
    expect(lines[0]).toContain("المتفرج عليه")
  })

  it("branch gating: each trigger stays silent outside its branch family", () => {
    // ceiling consolidation is a profit-ride reading — never in a loss wait
    const top = ctxOver({ consolidation: { sessions: 7, tightnessPct: 2.1 }, nearRangeTop: true })
    expect(lexiconLinesAr(top, opts({ branch: "deepLoss", trendAr: downTrendAr }))).toEqual([])
    // bottom consolidation is a loss-wait reading — never in a profit ride
    const bottom = ctxOver({ consolidation: { sessions: 9, tightnessPct: 1.8 }, nearRangeBottom: true })
    expect(lexiconLinesAr(bottom, opts({ branch: "hold" }))).toEqual([])
    // the drying climb speaks only on hold, never on take-profit
    const dry = ctxOver({ volTrend5: "falling", nearRangeTop: true })
    expect(lexiconLinesAr(dry, opts({ branch: "takeProfit" }))).toEqual([])
    // the injection hint is a loss-wait reading — a red exit gets the
    // documented-break line instead, never the «ضخ» hint
    const rising = ctxOver({ volTrend5: "rising" })
    const exitLines = lexiconLinesAr(rising, opts({ branch: "engineExit", trendAr: downTrendAr }))
    expect(exitLines.length).toBe(1)
    expect(exitLines[0]).toContain("دخول لمّي")
    expect(exitLines[0]).not.toContain("ضخ محتمل")
    expect(lexiconLinesAr(rising, opts({ branch: "hold" }))).toEqual([])
  })

  it("(d) an honestly-null context keeps the phrasebook silent on every branch", () => {
    for (const branch of ["deepLoss", "farCushionExit", "cushionWait", "engineExit", "takeProfit", "hold"] as const) {
      expect(lexiconLinesAr(nullCtx(), opts({ branch, trendAr: "متذبذب" }))).toEqual([])
      expect(narrativeLinesAr(nullCtx(), opts({ branch, trendAr: "متذبذب" }))).toEqual([])
    }
  })
})

describe("narrativeLinesAr — the merged pass (veteran → lexicon → VSA, cap 4)", () => {
  it("(e) rich context → exactly 4 lines: veteran traps first, lexicon after, no duplicates", () => {
    const ctx = ctxOver({
      divergence: "bearish",
      volCharacter: "spike",
      closeLocationPct: 88.1,
      roundLevelNear: { level: 210, distPct: 0.87 },
      consolidation: { sessions: 7, tightnessPct: 2.1 },
      nearRangeTop: true,
      volTrend5: "falling",
    })
    const lines = narrativeLinesAr(ctx, opts())
    expect(lines.length).toBe(4)
    expect(lines[0]).toContain("انحراف سلبي") // trap before confirmation
    expect(lines[1]).toContain("فوليوم Spike") // the veteran spike confirmation
    expect(lines[2]).toContain("الأرقام المستديرة") // the first lexicon entry
    expect(lines[3]).toContain("تجميعة") // the next lexicon entry filled the 4th slot
    expect(new Set(lines).size).toBe(lines.length) // no duplicates
    // the lexicon entry that did not fit is dropped, not reordered in
    expect(lines.filter((l) => l.includes("سيولة مدّارة")).length).toBe(0)
  })

  it("the VSA passthrough stays LAST — it fills only a remaining slot", () => {
    const vsa = "جلسة بتبيع على فوليوم عالي بعد صعود طويل (توزيع محتمل)."
    const ctx = ctxOver({
      divergence: "bearish",
      roundLevelNear: { level: 210, distPct: 0.87 },
      vsaNoteAr: vsa,
    })
    const lines = narrativeLinesAr(ctx, opts())
    expect(lines.length).toBe(3)
    expect(lines[0]).toContain("انحراف سلبي")
    expect(lines[1]).toContain("الأرقام المستديرة")
    expect(lines[2]).toBe(vsa)
  })

  it("when a slot remains under the 4-line cap, the VSA note fills it", () => {
    const vsa = "ملاحظة VSA لن تُطبع."
    const ctx = ctxOver({
      divergence: "bearish",
      volCharacter: "spike",
      closeLocationPct: 88.1,
      roundLevelNear: { level: 210, distPct: 0.87 },
      vsaNoteAr: vsa,
    })
    const lines = narrativeLinesAr(ctx, opts())
    expect(lines.length).toBe(4) // veteran 2 + lexicon 1 + VSA filler
    expect(lines[3]).toBe(vsa)
  })

  it("the standalone veteranLinesAr keeps its ≤ 2-line contract untouched", () => {
    const ctx = ctxOver({
      divergence: "bearish",
      volCharacter: "spike",
      closeLocationPct: 88.1,
      roundLevelNear: { level: 210, distPct: 0.87 },
    })
    const lines = veteranLinesAr(ctx, opts())
    expect(lines.length).toBe(2) // lexicon never leaks into the standalone view
    expect(new Set(lines).size).toBe(lines.length)
  })

  it("NARRATIVE_MAX_LINES is exactly 4 (2026-11-18 maker-games mandate)", () => {
    expect(NARRATIVE_MAX_LINES).toBe(4)
  })
})

// =============================================================================
// (f) KNOWLEDGE DENSITY — every emitted lexicon line carries observation
// (real number) + market law + watch-next: at least 12 Arabic words.
// =============================================================================

describe("lexiconLinesAr — knowledge density (owner bar: law + number, not slogans)", () => {
  const battery: Array<{ ctx: MarketContext; o: VeteranOpts }> = [
    { ctx: ctxOver({ roundLevelNear: { level: 210, distPct: 0.87 } }), o: opts() },
    { ctx: ctxOver({ roundLevelNear: { level: 210, distPct: 0.87 } }), o: opts({ trendAr: downTrendAr }) },
    { ctx: ctxOver({ roundLevelNear: { level: 210, distPct: 0.87 } }), o: opts({ trendAr: "متذبذب — السعر تحت EMA50 بدون كسر ترتيب كامل" }) },
    { ctx: ctxOver({ roundLevelNear: { level: 200, distPct: 1.4 } }), o: opts() },
    { ctx: ctxOver({ roundLevelNear: { level: 208.18, distPct: 0 } }), o: opts() },
    { ctx: ctxOver({ consolidation: { sessions: 7, tightnessPct: 2.1 }, nearRangeTop: true }), o: opts({ branch: "takeProfit" }) },
    { ctx: ctxOver({ consolidation: { sessions: 9, tightnessPct: 1.8 }, nearRangeBottom: true }), o: opts({ branch: "deepLoss", trendAr: downTrendAr }) },
    { ctx: ctxOver({ consolidation: { sessions: 9, tightnessPct: 1.8 }, nearRangeBottom: true }), o: opts({ branch: "cushionWait", trendAr: downTrendAr }) },
    { ctx: ctxOver({ volTrend5: "falling", nearRangeTop: true }), o: opts() },
    { ctx: ctxOver({ volTrend5: "rising" }), o: opts({ branch: "engineExit", trendAr: downTrendAr }) },
    { ctx: ctxOver({ volTrend5: "rising" }), o: opts({ branch: "farCushionExit", trendAr: downTrendAr }) },
    { ctx: ctxOver({ volTrend5: "rising" }), o: opts({ branch: "cushionWait", trendAr: downTrendAr }) },
  ]
  it("every lexicon line in the battery is ≥ 12 Arabic words and ends with the watch-next clause", () => {
    for (const { ctx, o } of battery) {
      for (const line of lexiconLinesAr(ctx, o)) {
        expect(words(line)).toBeGreaterThanOrEqual(12)
        expect(line).toContain("المتفرج عليه")
      }
    }
  })
})

// =============================================================================
// INTEGRATION — the live context pass now computes the lexicon trio (the
// parallel context pass landed), so a real-bars review must carry REAL
// lexicon lines with REAL computed numbers. Graceful degradation for thin
// data is covered above by (d) (empty bars → all-null → [] on every branch).
// =============================================================================

import { reviewPosition } from "../review"
import { buildZoneMap } from "@/lib/signals/levels"
import { computeMetrics, toSignalMetrics } from "@/lib/signals/metrics"
import type { SignalRowV2, SignalState, SignalMetrics } from "@/lib/signals/types"
import { cushionSeries } from "./bars-fixture"

function rowOver(bars: ReturnType<typeof cushionSeries>, over: Partial<SignalRowV2> & { state: SignalState }): SignalRowV2 {
  const m = computeMetrics(bars)!
  const metrics: SignalMetrics = toSignalMetrics(m)
  return {
    companyId: "c1", ticker: "TEST", nameEn: "Test Co", nameAr: "شركة الاختبار", sector: "Tests",
    marketTier: "EGX30", type: null, asOf: "2026-03-12", lastClose: bars[bars.length - 1].close,
    changePct: null, score: 50, scoreGroups: null, evidence: [], plan: null, setup: null,
    invalidationAr: null, metrics,
    quality: { bars: bars.length, ohlc: true, liquidity: "normal", avgTradedValueEgp: null, dataAgeSessions: 0, notesAr: [] },
    warnings: [], engine: "test", ...over,
  }
}

describe("the lexicon pass — live integration over real bars", () => {
  it("close 106.50 with the 105.00 round level 1.4٪ below → the hold report names the floor with the real numbers", () => {
    const bars = cushionSeries(100, 106.5) // hold branch
    const map = buildZoneMap(bars)
    const r = reviewPosition({ row: rowOver(bars, { state: "wait" }), bars, map, avgBuyPrice: 100 })
    expect(r.decision).toBe("hold")
    const all = r.reasonsAr.join(" ")
    expect(all).toContain("الأرقام المستديرة") // the idiom reached the report
    expect(all).toContain("105.00") // the computed round level
    expect(all).toContain("أرضية") // level BELOW the close → floor
    expect(all).toContain("المتفرج عليه") // every lexicon line carries the watch-next
    // and the merged cap still holds end-to-end
    expect(r.reasonsAr.length).toBeLessThanOrEqual(5 + NARRATIVE_MAX_LINES)
  })
})
