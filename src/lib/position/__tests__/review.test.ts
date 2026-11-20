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
// BUG FIXES (2026-11-18, CRST review — the owner caught these in production):
// the far-support distance printed a + sign for a level UNDER the price; the
// technical line printed trendAr twice; and with the price already inside the
// 20–25% rebound band the headline kept promising a future rebound.
// =============================================================================

describe("CRST review fixes — deep loss already inside the rebound band", () => {
  it("in-band deep loss → the headline says the organized-exit plan is ACTIVE, not a future rebound", () => {
    const bars = cushionSeries(100)
    const map = buildZoneMap(bars)
    const r = reviewPosition({
      row: rowOver(bars, {
        state: "wait",
        metrics: { ...toSignalMetrics(computeMetrics(bars)!), ema20: 97, ema50: 101 }, // close 100 < ema50, ema20 < ema50
      }),
      bars,
      map,
      avgBuyPrice: 130, // close ~103 → −20.8٪ deep loss; band 97.5–104 → in-band
    })
    expect(r.pnlPct).toBeLessThanOrEqual(-DEEP_LOSS_PCT)
    expect(r.headlineAr).toContain("نطاق الخروج المنظم")
    expect(r.headlineAr).toContain("قرار التخفيف")
    expect(r.headlineAr).not.toContain("الانتظار للارتداد هو الأنسب")
    expect(r.reasonsAr.some((x) => x.includes("الخطة شغالة فعلًا"))).toBe(true)
  })

  it("the technical line states the trend ONCE (no duplicated EMA-order clause)", () => {
    const bars = decliningSeries() // no supports at all → no live break → trend-only technical line
    const map = buildZoneMap(bars)
    const r = reviewPosition({
      row: rowOver(bars, {
        state: "wait",
        metrics: { ...toSignalMetrics(computeMetrics(bars)!), ema20: 96, ema50: 101 }, // close 100 < ema50, ema20 < ema50
      }),
      bars,
      map,
      avgBuyPrice: 130, // close ~100 → −23.1٪ deep loss
    })
    const tech = r.reasonsAr.filter((x) => x.startsWith("التقنية بصراحة"))
    expect(tech.length).toBe(1)
    // trendFactAr only joins when a live break happened — no break here
    expect(tech[0]).not.toContain("الاتجاه:")
    expect((tech[0].match(/ترتيب سلبي/g) ?? []).length).toBeLessThanOrEqual(1)
  })

  it("the far-support distance carries NO plus sign — the level is UNDER the price", () => {
    const bars = cushionSeries(100)
    const map = buildZoneMap(bars)
    const r = reviewPosition({
      row: rowOver(bars, { state: "wait" }),
      bars,
      map,
      avgBuyPrice: 126,
    })
    const ofr = r.reasonsAr.find((x) => x.includes("الدعم التالي تحته"))
    if (ofr) {
      expect(ofr).toContain("تحت السعر")
      expect(ofr).not.toMatch(/على بعد \+/)
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

// =============================================================================
// OWNER MANDATE (2026-11-17) — the profitable-break rule: at a gain ≥ +6٪
// (PROFIT_TAKE_MIN_PCT) the RED-exit branches (far-cushion break / engine
// trend break) collapse into a GREEN partial take-profit — the snapshot's
// own posture picks the sizing (bearish → 50–75٪ off now, 25–50٪ runner;
// bullish → 20–40٪ off, the rest rides) and the runner trails a CLOSE-BASED
// line (effective support, else EMA50 under the price). Below +6٪ (or at a
// loss) the red exit stands unchanged.
// =============================================================================

import { PROFIT_TAKE_MIN_PCT } from "../review"

describe("reviewPosition — the profitable-break rule (pnl ≥ +6٪)", () => {
  const bearish = (bars: ReturnType<typeof cushionSeries>) => ({ ...toSignalMetrics(computeMetrics(bars)!), ema20: 104, ema50: 107 }) // close 103 < 107, EMA20 < EMA50
  const bullish = (bars: ReturnType<typeof cushionSeries>) => ({ ...toSignalMetrics(computeMetrics(bars)!), ema20: 100, ema50: 97 }) // close 103 > 97, EMA20 > EMA50

  it("broken far-cushion support at +8٪ (bearish posture) → TAKE_PROFIT with the 50–75٪ sizing, never a red exit", () => {
    const bars = cushionSeries(97) // close 103, far cushion 5.44%
    const map = buildZoneMap(bars)
    const r = reviewPosition({ row: rowOver(bars, { state: "exit", metrics: bearish(bars) }), bars, map, avgBuyPrice: 95.4 }) // pnl +8.0٪
    expect(r.decision).toBe("take_profit")
    expect(r.decisionAr).toBe("جني أرباح جزئي")
    expect(r.pnlPct).toBeCloseTo(8.0, 1)
    expect(r.planAr).toContain("50–75٪")
    expect(r.planAr).toContain("25–50٪")
    expect(r.planAr).not.toContain("20–40٪")
    expect(r.planAr).toContain("أنا بفكر معاك")
    expect(r.planAr!.startsWith("الخطة:")).toBe(false) // the UI renders the «الخطة:» prefix itself
    expect(r.headlineAr).toContain("أنا بفكر معاك")
    // the trailing line: the certified effective support (97.00–97.40), close-based
    expect(r.invalidationAr).toContain("97.40")
    expect(r.invalidationAr).toContain("الإغلاق")
    // the insight the user may not see from inside a green P/L
    expect(r.reasonsAr.some((x) => x.includes("سيولة بتخرج من السهم حتى لو إنت رابح"))).toBe(true)
  })

  it("broken far-cushion support at +8٪ (bullish posture) → the lighter 20–40٪ sizing", () => {
    const bars = cushionSeries(97)
    const map = buildZoneMap(bars)
    const r = reviewPosition({ row: rowOver(bars, { state: "exit", metrics: bullish(bars) }), bars, map, avgBuyPrice: 95.4 })
    expect(r.decision).toBe("take_profit")
    expect(r.planAr).toContain("20–40٪")
    expect(r.planAr).not.toContain("50–75٪")
    expect(r.planAr).toContain("مش شك في السهم") // the bullish rationale line
    expect(r.invalidationAr).toContain("97.40") // the same trailing line, formatted
  })

  it("engine exit state: +6.5٪ → TAKE_PROFIT (+6.0٪ boundary included); +2.4٪ → red EXIT unchanged", () => {
    const bars = cushionSeries(100, 106.5) // close above the 104 zone → no break, engine path only
    const map = buildZoneMap(bars)
    const inProfit = reviewPosition({ row: rowOver(bars, { state: "exit", metrics: bullish(bars) }), bars, map, avgBuyPrice: 100 }) // +6.5٪
    expect(inProfit.decision).toBe("take_profit")
    expect(inProfit.pnlPct).toBeCloseTo(6.5, 1)
    expect(inProfit.planAr).toContain("20–40٪")
    expect(inProfit.invalidationAr).toContain("104.40") // the trailing line at the effective support
    const boundary = reviewPosition({ row: rowOver(bars, { state: "exit", metrics: bullish(bars) }), bars, map, avgBuyPrice: 100.47 }) // +6.003٪
    expect(boundary.decision).toBe("take_profit")
    const smallGain = reviewPosition({ row: rowOver(bars, { state: "exit", metrics: bullish(bars) }), bars, map, avgBuyPrice: 104 }) // +2.4٪
    expect(smallGain.decision).toBe("exit")
    expect(smallGain.decisionAr).toBe("اخرج الآن")
    expect(smallGain.planAr).toBeNull()
  })

  it("far-cushion break at a loss stays the red EXIT (the green rule is profit-only)", () => {
    const bars = cushionSeries(97)
    const map = buildZoneMap(bars)
    const r = reviewPosition({ row: rowOver(bars, { state: "exit", metrics: bearish(bars) }), bars, map, avgBuyPrice: 105 }) // pnl −1.9٪
    expect(r.decision).toBe("exit")
    expect(r.decisionAr).toBe("اخرج الآن")
    expect(r.invalidationAr).toContain("104.00") // the broken zone's low — the exit path is untouched
  })

  it(`the threshold constant is exactly ${PROFIT_TAKE_MIN_PCT}`, () => {
    expect(PROFIT_TAKE_MIN_PCT).toBe(6)
  })

  it("no report anywhere in the ladder contains the «المشبِط» jargon", () => {
    const cases: Array<{ bars: ReturnType<typeof cushionSeries>; buy: number; state: SignalState }> = [
      { bars: cushionSeries(97), buy: 105, state: "exit" }, // branch 1 red exit
      { bars: cushionSeries(97), buy: 95.4, state: "exit" }, // branch 1 take-profit
      { bars: cushionSeries(97), buy: 130, state: "exit" }, // deep loss
      { bars: cushionSeries(100, 106.5), buy: 100, state: "wait" }, // hold
      { bars: cushionSeries(100, 106.5), buy: 110, state: "wait" }, // small-loss wait
      { bars: cushionSeries(100, 106.5), buy: 104, state: "exit" }, // branch 3 red exit
      { bars: cushionSeries(100, 106.5), buy: 100, state: "exit" }, // branch 3 take-profit
    ]
    for (const c of cases) {
      const map = buildZoneMap(c.bars)
      const r = reviewPosition({ row: rowOver(c.bars, { state: c.state }), bars: c.bars, map, avgBuyPrice: c.buy })
      expect(JSON.stringify(r)).not.toContain("المشبِط")
    }
  })
})

// =============================================================================
// OWNER BUG (2026-11-18, OCPH «اكتوبر فارما»): avg cost 208.00, last close
// 208.18 (+0.1٪), decision "احتفظ" — yet reason #4 said: «الهدف فوق: أقرب
// مقاومة عند 97.44–101.00 على بعد -52.3٪ — دي أول منطقة تستحق قرار أرباح
// جزئي». TWO absurdities: the "resistance" sat ~52٪ UNDER the price (the base
// ceiling the rally had already turned into history), and a profit-taking
// target must sit ABOVE the owner's average, at least +6٪ over it. The hold
// branch now picks the nearest zone fully above the close that clears the
// average by PROFIT_TARGET_MIN_GAP_PCT, reports the distance vs the AVERAGE
// (to the zone's entry edge), and says honestly when nothing qualifies.
// =============================================================================

import { PROFIT_TARGET_MIN_GAP_PCT } from "../review"
import type { PriceZone, ZoneMap } from "@/lib/signals/levels"
import type { Bar } from "@/lib/signals/types"

/** 80 sessions of a monotone rally 100 → 208.18 — the OCPH «اكتوبر فارما»
 *  closing tape (owner avg cost 208.00, last close 208.18, +0.1٪). No pivots:
 *  the tests hand-build the zone map (the old base ceiling + the live top),
 *  the bars only feed the metrics bundle and the cushion read. */
function ocphCloseSeries(): Bar[] {
  const bars: Bar[] = []
  const n = 80
  for (let i = 0; i < n; i++) {
    const close = 100 + ((208.18 - 100) * (i + 1)) / n
    const ts = `2026-${String(Math.floor(i / 28) + 1).padStart(2, "0")}-${String((i % 28) + 1).padStart(2, "0")}-${String(i).padStart(3, "0")}`
    bars.push({ ts, open: close - 0.2, high: close + 0.35, low: close - 0.35, close, volume: 1000 })
  }
  return bars
}

/** Hand-built zone map for the OCPH scenarios: the old base ceiling (a swing-
 *  HIGH cluster the rally broke — kind "resistance" forever, positionKind
 *  "support" now) and optional live zones. */
function ocphZones(...extra: PriceZone[]): ZoneMap {
  const oldCeiling: PriceZone = {
    kind: "resistance", // historical origin: swing-high cluster — kept as evidence
    positionKind: "support", // high 101.00 < close 208.18: structural support/history now
    low: 97.44,
    high: 101.0,
    touches: 2,
    lastTouchTs: "2026-06-10-000",
    lastTouchIdx: 5,
    broken: true, // the rally closed above it — retest structure
    brokenTs: "2026-07-02-020",
  }
  return { atr: null, zones: [oldCeiling, ...extra] }
}

describe("reviewPosition — the OCPH profit-target rule (hold branch, 2026-11-18)", () => {
  it("avg 208 / close 208.18: the old 97.44–101.00 ceiling is NEVER the profit target — the 236–240 zone is, at +13.5٪ vs the AVERAGE", () => {
    const bars = ocphCloseSeries()
    const map = ocphZones({
      kind: "resistance",
      positionKind: "resistance",
      low: 236,
      high: 240,
      touches: 3,
      lastTouchTs: "2026-11-01-070",
      lastTouchIdx: 70,
      broken: false,
    })
    const r = reviewPosition({ row: rowOver(bars, { state: "wait" }), bars, map, avgBuyPrice: 208.0 })
    expect(r.decision).toBe("hold")
    expect(r.pnlPct).toBeCloseTo(0.1, 1) // the owner's scenario: +0.1٪
    const all = r.reasonsAr.join(" ")
    expect(all).not.toContain("97.44") // the sub-close ceiling is gone from the reasons
    expect(all).not.toContain("-52.3") // the absurd negative distance is gone
    expect(all).toContain("236")
    expect(all).toContain("الهدف فوق: أول منطقة تستحق قرار أرباح جزئي عند 236.00–240.00 على بعد +13.5٪ من متوسطك")
    // the reported distance is vs the OWNER'S AVERAGE (positive), to the zone's
    // entry edge: (236 − 208) / 208 = +13.46٪ → printed at 1 decimal (+13.5٪)
    const m = all.match(/على بعد \+([\d.]+)٪ من متوسطك/)
    expect(m).not.toBeNull()
    const dist = parseFloat(m![1]!)
    expect(dist).toBeGreaterThan(0)
    expect(dist).toBeGreaterThanOrEqual(13.26) // 13.46 − 0.2
    expect(dist).toBeLessThanOrEqual(13.66) // 13.46 + 0.2
    // the RESULT's resistances carry only zones fully above the close
    expect(r.resistances.length).toBe(1)
    expect(r.resistances[0]!.low).toBe(236)
    expect(r.resistances[0]!.high).toBe(240)
    expect(r.resistances.every((z) => z.low > r.lastClose)).toBe(true)
  })

  it("a zone above the close but under avg+6٪ does NOT qualify — the honest «أرض جديدة» line instead", () => {
    const bars = ocphCloseSeries()
    const map = ocphZones({
      kind: "resistance",
      positionKind: "resistance",
      low: 209.5, // above the close 208.18, but only +0.7٪ over the 208 average
      high: 212,
      touches: 1,
      lastTouchTs: "2026-11-05-075",
      lastTouchIdx: 75,
      broken: false,
    })
    const r = reviewPosition({ row: rowOver(bars, { state: "wait" }), bars, map, avgBuyPrice: 208.0 })
    expect(r.decision).toBe("hold")
    // the close-based list guard keeps the zone listed (it IS above the close)…
    expect(r.resistances.length).toBe(1)
    expect(r.resistances[0]!.low).toBe(209.5)
    // …but the profit-target line tells the truth instead of pointing at noise
    const all = r.reasonsAr.join(" ")
    expect(all).not.toContain("97.44")
    expect(all).toContain(
      `الهدف فوق: مفيش مقاومة مسجلة فوق متوسطك بـ ${PROFIT_TARGET_MIN_GAP_PCT}٪ أو أكثر في نافذة البيانات — السهم في أرض جديدة، والأرباح الجزئية هنا بتحددها خط المتوسطات (EMA20/EMA50) مش سقف قديم`,
    )
  })

  it("only sub-close zones on the map → no resistance at all is surfaced, and the honest line stands", () => {
    const bars = ocphCloseSeries()
    const r = reviewPosition({ row: rowOver(bars, { state: "wait" }), bars, map: ocphZones(), avgBuyPrice: 208.0 })
    expect(r.decision).toBe("hold")
    expect(r.resistances.length).toBe(0) // the 97.44–101.00 ceiling is fully UNDER the close
    const all = r.reasonsAr.join(" ")
    expect(all).not.toContain("97.44")
    expect(all).toContain("أرض جديدة")
    expect(all).toContain("EMA20/EMA50")
  })

  it(`the threshold constant is exactly ${PROFIT_TARGET_MIN_GAP_PCT}`, () => {
    expect(PROFIT_TARGET_MIN_GAP_PCT).toBe(6)
  })
})

// =============================================================================
// OWNER MANDATE (2026-11-18) — the veteran's voice: the review now reads the
// candle, the volume character, the stretch and the traps like someone who
// has lived EGX cycles. veteranLinesAr fires ONLY on its data triggers,
// cites real numbers, caps at 2 lines, and stays SILENT ([]) on an honestly
// null MarketContext — every line is append-only after the existing reasons.
// =============================================================================

import { veteranLinesAr } from "../review"
import { buildMarketContext, type MarketContext } from "../market-context"

const nullCtx = (): MarketContext => buildMarketContext([], null)
const ctxOver = (over: Partial<MarketContext>): MarketContext => ({ ...nullCtx(), ...over })
const upTrendAr = "صاعد — السعر فوق EMA50 وEMA20 فوق EMA50 (ترتيب صحي)"

describe("veteranLinesAr — the veteran's reading of the last session", () => {
  it("spike volume closing at the top on hold → the buying-pressure line with the ×multiple and the real close location", () => {
    const ctx = ctxOver({ volCharacter: "spike", closeLocationPct: 82.4, bodyVsAtr: 1.8 })
    const lines = veteranLinesAr(ctx, { branch: "hold", avgBuyPrice: 100, close: 106.5, trendAr: upTrendAr })
    expect(lines.length).toBeGreaterThanOrEqual(1)
    expect(lines.length).toBeLessThanOrEqual(2)
    const spike = lines.find((x) => x.includes("فوليوم"))
    expect(spike).toBeDefined()
    expect(spike!).toContain("2.5×") // the volume class multiple (spike bound)
    expect(spike!).toContain("1.8×") // the body-vs-ATR multiple, real from ctx
    expect(spike!).toContain("82.4٪") // the real close location
  })

  it("a dry-volume rally into the range top on hold → the hollow-climb («هش») line with the dry bound and the streak", () => {
    const ctx = ctxOver({ volCharacter: "dry", streakUp: 4, nearRangeTop: true })
    const lines = veteranLinesAr(ctx, { branch: "hold", avgBuyPrice: 100, close: 106.5, trendAr: upTrendAr })
    expect(lines.length).toBeGreaterThanOrEqual(1)
    const hollow = lines.find((x) => x.includes("هش"))
    expect(hollow).toBeDefined()
    expect(hollow!).toContain("0.7×") // the dry bound
    expect(hollow!).toContain("4 جلسات صاعدة") // the real streak count
  })

  it("an honestly-null context keeps the veteran silent: [] on every branch (nothing invented)", () => {
    for (const branch of ["deepLoss", "farCushionExit", "cushionWait", "engineExit", "takeProfit", "hold"] as const) {
      expect(veteranLinesAr(nullCtx(), { branch, avgBuyPrice: 100, close: 100, trendAr: "متذبذب" })).toEqual([])
    }
  })

  it("integration: the wiring APPENDS — the pre-wiring hold snapshot stands intact as the prefix, at most 3 narrative lines follow", () => {
    const bars = cushionSeries(100, 106.5)
    const map = buildZoneMap(bars)
    const r = reviewPosition({ row: rowOver(bars, { state: "wait" }), bars, map, avgBuyPrice: 100 })
    expect(r.decision).toBe("hold")
    // the snapshot captured BEFORE the wiring landed — byte-identical, never
    // rewritten: the veteran only ever appends after the existing reasons
    expect(r.reasonsAr.slice(0, 5)).toEqual([
      "الأساسي أولًا: متوسطك 100.00 والسعر 106.50 — يعني إنت +6.5٪ (+6.50 جنيه/سهم). المركز مش في منطقة خطر.",
      "القراءة الفنية: هابط — السعر تحت EMA50 وEMA20 تحت EMA50 (ترتيب سلبي) وRSI 44.32 (منطقة متوازنة).",
      "خط الدفاع: دعم 2× مختبَر (104.00–104.40) على بعد +2.2٪ — طالما السعر فوقه بالإغلاق، القصة سليمة.",
      "الهدف فوق: أول منطقة تستحق قرار أرباح جزئي عند 112.85 على بعد +12.8٪ من متوسطك.",
      "الخلاصة بصوت واضح: احتفظ. البيع يبقى قرار لما يفشل خط الدفاع، مش لما القلق يعلو.",
    ])
    // and whatever the (now live) MarketContext produces, the merged
    // narrative cap holds: ≤ 3 (veteran + lexicon, NARRATIVE_MAX_LINES)
    expect(r.reasonsAr.length).toBeLessThanOrEqual(8)
  })

  it("bearish momentum divergence on take-profit → the «خُد شيئًا وشوف» line anchored at the real close", () => {
    const ctx = ctxOver({ divergence: "bearish" })
    const lines = veteranLinesAr(ctx, { branch: "takeProfit", avgBuyPrice: 95.4, close: 103.0, trendAr: upTrendAr })
    expect(lines.length).toBeGreaterThanOrEqual(1)
    const div = lines.find((x) => x.includes("انحراف سلبي"))
    expect(div).toBeDefined()
    expect(div!).toContain("103.00") // a real number: the close the divergence printed at
    expect(div!).toContain("خُد شيئًا وشوف")
  })

  it("several triggers at once → exactly 2 lines, and traps speak first (divergence before the spike confirmation)", () => {
    const ctx = ctxOver({ divergence: "bearish", volCharacter: "spike", closeLocationPct: 88.1 })
    const lines = veteranLinesAr(ctx, { branch: "hold", avgBuyPrice: 100, close: 106.5, trendAr: upTrendAr })
    expect(lines.length).toBe(2)
    expect(lines[0]).toContain("انحراف سلبي")
    expect(lines[1]).toContain("فوليوم")
  })

  it("the VSA note passes through verbatim when no higher-priority trigger took a slot", () => {
    const ctx = ctxOver({ vsaNoteAr: "جلسة بتبيع على فوليوم عالي بعد صعود طويل (توزيع محتمل)." })
    const lines = veteranLinesAr(ctx, { branch: "hold", avgBuyPrice: 100, close: 106.5, trendAr: upTrendAr })
    expect(lines).toEqual(["جلسة بتبيع على فوليوم عالي بعد صعود طويل (توزيع محتمل)."])
  })
})

// =============================================================================
// OWNER MANDATE (2026-11-18, round three) — «خبرة 100 سنة»: the maker games
// (maker-games.ts) + the whole-market map ride the merged narrative pass.
//   • input.marketCtx present → the «خريطة السوق النهاردة» line reaches the
//     report (regime + breadth + sector + the branch implication)
//   • input.marketCtx null + no maker evidence → BYTE-IDENTICAL output to the
//     pre-maker baseline (pinned against the captured hold fixture)
//   • the merged cap is NARRATIVE_MAX_LINES = 4, enforced end-to-end
// =============================================================================

import { narrativeLinesAr, NARRATIVE_MAX_LINES } from "../review"
import type { MarketContextSection } from "@/lib/technical/analyze"

const mctxFull = (over: Partial<MarketContextSection> = {}): MarketContextSection => ({
  available: true,
  asOf: "2026-03-12",
  marketRegime: "correction",
  marketRegimeAr: "سوق تصحيح",
  marketPulse: -1.2,
  breadth: { advancing: 10, declining: 40, unchanged: 5, ratio: 0.25 },
  aboveEma20: 12,
  aboveEma50: 18,
  aboveEma200: 30,
  sector: { name: "بنوك", dayChangePct: -1.0, advancing: 3, declining: 12, turnoverSharePct: 22.5, turnoverShareDelta5d: 1.1 },
  relVolRankPct: 55,
  limitations: [],
  ...over,
})

describe("reviewPosition — the maker games + the market map integration (2026-11-18)", () => {
  it("input.marketCtx present → the خريطة السوق line reaches the hold report LAST in the narrative", () => {
    const bars = cushionSeries(100, 106.5)
    const map = buildZoneMap(bars)
    const r = reviewPosition({ row: rowOver(bars, { state: "wait" }), bars, map, avgBuyPrice: 100, marketCtx: mctxFull() })
    expect(r.decision).toBe("hold")
    const mapLine = r.reasonsAr.find((x) => x.includes("خريطة السوق النهاردة"))
    expect(mapLine).toBeDefined()
    expect(mapLine!).toContain("سوق تصحيح") // the regime is named
    expect(mapLine!).toContain("40 هابط") // the breadth is cited
    expect(mapLine!).toContain("بنوك") // the company's sector day change
    expect(mapLine!).toContain("بيئة قيعان") // aboveEma20 = 12 ≤ 15 → bottoms regime
    expect(mapLine!).toContain("الاحتفاظ") // the hold-branch implication
    // the map speaks LAST in the narrative (no VSA note on this fixture)
    expect(r.reasonsAr[r.reasonsAr.length - 1]).toBe(mapLine)
    // the merged cap holds end-to-end: base reasons + ≤ NARRATIVE_MAX_LINES
    expect(r.reasonsAr.length).toBeLessThanOrEqual(5 + NARRATIVE_MAX_LINES)
  })

  it("the market map degrades honestly: available=false or a null section → no map line at all", () => {
    const bars = cushionSeries(100, 106.5)
    const map = buildZoneMap(bars)
    const row = rowOver(bars, { state: "wait" })
    for (const mctx of [null, mctxFull({ available: false })]) {
      const r = reviewPosition({ row, bars, map, avgBuyPrice: 100, marketCtx: mctx })
      expect(r.reasonsAr.some((x) => x.includes("خريطة السوق"))).toBe(false)
    }
  })

  it("PIN — marketCtx null + no maker evidence → the hold report is BYTE-IDENTICAL to the pre-maker baseline", () => {
    const bars = cushionSeries(100, 106.5)
    const map = buildZoneMap(bars)
    const r = reviewPosition({ row: rowOver(bars, { state: "wait" }), bars, map, avgBuyPrice: 100 })
    expect(r.reasonsAr).toEqual([
      "الأساسي أولًا: متوسطك 100.00 والسعر 106.50 — يعني إنت +6.5٪ (+6.50 جنيه/سهم). المركز مش في منطقة خطر.",
      "القراءة الفنية: هابط — السعر تحت EMA50 وEMA20 تحت EMA50 (ترتيب سلبي) وRSI 44.32 (منطقة متوازنة).",
      "خط الدفاع: دعم 2× مختبَر (104.00–104.40) على بعد +2.2٪ — طالما السعر فوقه بالإغلاق، القصة سليمة.",
      "الهدف فوق: أول منطقة تستحق قرار أرباح جزئي عند 112.85 على بعد +12.8٪ من متوسطك.",
      "الخلاصة بصوت واضح: احتفظ. البيع يبقى قرار لما يفشل خط الدفاع، مش لما القلق يعلو.",
      "دوجي عند 106.50 — الافتتاح والإغلاق تلاحقوا: تردد في منطقة أرباح معناه إن القرار معلق بين الطرفين، ومن تجارب السوق بيجي قبل انعطاف أو استراحة، والاتجاه المحيط هابط فالترجيح يميل للهبوط.",
      "«الأرقام المستديرة أرضيات وسقوف» — من كلام المحللين اللي بيتكتب كل يوم وبيتأكد على الشاشة: الرقم المستدير 105.00 قاعد تحت الإغلاق 106.50 بفارق 1.4٪، وده أرضية نفسية الطلبات بتتجمع عندها، وفي اتجاه هابط الأرضية دي بتتاختبر كل يوم — واللمسة مش كسر: اختبار الرقم وثباته بالإغلاق هو اللي بيحوله من رقم مكتوب لأرضية فعلية. اللي بنراقبه: أي إغلاق يومي تحت 105.00 — عشان الأرقام المستديرة لما بتتكسر بتقلب أدوار وبتدير سقف على الرحلة الجاية.",
    ])
    expect(r.reasonsAr.length).toBeLessThanOrEqual(8)
  })

  it("the merged cap: every trigger family firing at once → at most NARRATIVE_MAX_LINES lines, no duplicates", () => {
    // veteran 2 (divergence + spike), lexicon 3 (round + ceiling consolidation
    // + drying climb), maker games (frozen bars + market section), market map,
    // VSA — everything at once; the cap decides, dedup holds.
    const richCtx = ctxOver({
      divergence: "bearish",
      volCharacter: "spike",
      closeLocationPct: 88.1,
      roundLevelNear: { level: 210, distPct: 0.87 },
      consolidation: { sessions: 7, tightnessPct: 2.1 },
      nearRangeTop: true,
      volTrend5: "falling",
      vsaNoteAr: "ملاحظة VSA فاقدة الأولوية.",
    })
    const frozenBar = (close: number): Bar => ({ ts: "2026-03-12-000", open: close, high: close + 0.04, low: close - 0.04, close, volume: 1000 })
    const lines = narrativeLinesAr(
      richCtx,
      { branch: "hold", avgBuyPrice: 100, close: 208.18, trendAr: upTrendAr },
      {
        bars: [frozenBar(208.18), frozenBar(208.18), frozenBar(208.18)],
        map: null,
        cushion: null,
        nearestSupportLow: 200,
        prevClose: 208.0,
        mctx: mctxFull(),
      },
    )
    expect(lines.length).toBe(NARRATIVE_MAX_LINES)
    expect(lines.length).toBeLessThanOrEqual(4)
    expect(new Set(lines).size).toBe(lines.length)
    // traps first: the veteran entries open the pass
    expect(lines[0]).toContain("انحراف سلبي")
    expect(lines[1]).toContain("فوليوم Spike")
    // the market map + VSA never displace the traps
    expect(lines[0]).not.toContain("خريطة السوق")
    expect(lines[0]).not.toContain("ملاحظة VSA")
  })
})

// =============================================================================
// BUG FIXES (2026-11-19 audit round): the two-cache skew let a stale row
// lastClose print a price different from the zones the report reads; the
// branch-2 cushion distance printed a "+" on a below-price level again; RSI 0
// was skipped by a falsy-zero check; and the hanging-man AR name drifted off
// the review's substring classifiers (a top-distribution warning narrated as
// the neutral generic line).
// =============================================================================

describe("2026-11-19 audit fixes", () => {
  it("two-cache skew: the SERIES close wins over a stale row.lastClose (one price for the whole report)", () => {
    const bars = cushionSeries(97) // series-derived close 103, far cushion below
    const map = buildZoneMap(bars)
    const r = reviewPosition({
      row: rowOver(bars, { state: "exit", lastClose: 110 }), // the v2-row cache is stale
      bars,
      map,
      avgBuyPrice: 100, // close 103 → +3.0٪ exit; the stale 110 → +10٪ would flip to take_profit
    })
    expect(r.lastClose).toBe(103)
    expect(r.snapshot.lastClose).toBe(103)
    expect(r.pnlPct).toBeCloseTo(3.0, 1)
    expect(r.decision).toBe("exit")
    expect(JSON.stringify(r)).not.toContain("110.00") // the stale cache value never prints
    expect(r.reasonsAr.some((x) => x.includes("103.00"))).toBe(true)
  })

  it("branch-2 cushion distance carries NO plus sign — the cushion is UNDER the price", () => {
    const bars = cushionSeries(100) // close 103, cushion 100–100.4 → gap ≈ 2.5٪
    const map = buildZoneMap(bars)
    const r = reviewPosition({ row: rowOver(bars, { state: "wait" }), bars, map, avgBuyPrice: 105 })
    expect(r.decision).toBe("wait")
    const line = r.reasonsAr.find((x) => x.includes("لسه على بعد"))
    expect(line).toBeDefined()
    expect(line).toMatch(/على بعد 2\.5٪ بس/)
    expect(line).not.toMatch(/على بعد \+/)
  })

  it("RSI 0 is real data, not absence — the oversold-band note prints at rsi14 === 0", () => {
    const bars = cushionSeries(100, 106.5) // hold branch
    const map = buildZoneMap(bars)
    const r = reviewPosition({
      row: rowOver(bars, { state: "wait", metrics: { ...toSignalMetrics(computeMetrics(bars)!), rsi14: 0 } }),
      bars,
      map,
      avgBuyPrice: 100,
    })
    expect(r.decision).toBe("hold")
    const tech = r.reasonsAr.find((x) => x.startsWith("القراءة الفنية:"))
    expect(tech).toBeDefined()
    expect(tech).toContain("RSI 0.00")
    expect(tech).toContain("منطقة تشبع بيعي")
  })

  it("a hanging_man candle in ctx → the BEARISH hanging-man narration, never the neutral generic line", () => {
    // 40 rising sessions + a hanging-man-shaped last bar — the exact geometry
    // candlestick's own tests certify as hanging_man (long lower wick, small
    // body at the top, after an advance). Before the 2026-11-19 name fix the
    // mapped «رجل معلق» missed the review's «مشنوق» substring and fell through
    // to the neutral generic line.
    const bars: Bar[] = []
    let c = 20
    for (let i = 0; i < 40; i++) {
      const o = c
      c = Math.round(c * 1.005 * 100) / 100
      const ts = `2026-01-${String(i + 1).padStart(2, "0")}-${String(i).padStart(3, "0")}`
      bars.push({ ts, open: o, high: Math.max(o, c) + 0.05, low: Math.min(o, c) - 0.05, close: c, volume: 1000 })
    }
    bars.push({ ts: "2026-01-41-041", open: 44.0, high: 44.3, low: 42.0, close: 44.15, volume: 1200 })
    const map = buildZoneMap(bars)
    const r = reviewPosition({
      row: rowOver(bars, { state: "wait" }),
      bars,
      map,
      avgBuyPrice: 40, // +10.4٪ — the hold/profit branch
    })
    expect(r.decision).toBe("hold")
    const patternLine = r.reasonsAr.find((x) => x.includes("الرجل المشنوقة"))
    expect(patternLine).toBeDefined()
    expect(patternLine).toContain("شكل بيع عند القمة") // the BEARISH hanging-man narration
    expect(r.reasonsAr.some((x) => x.includes("الشمعة الأخيرة رسمت نمط"))).toBe(false) // no neutral fallback
    expect(JSON.stringify(r)).not.toContain("رجل معلق") // the drifted name is gone
  })
})

// =============================================================================
// 2026-11-19 AUDIT ROUND — the consistency guards (AMES & friends):
//   • the ANTI-FLIP rule: the open-field trend break gives ONE verdict for any
//     P/L sign (the old engine exited −0.03٪ while holding +0.23٪ on the
//     IDENTICAL tape — the P/L sign picked which exit detector applied)
//   • the LIVE-session gate: a detected break before the official close is
//     PROVISIONAL — انتظر + a two-sided close-based plan, no break certainty
//   • zero-body candles never narrate a direction («بجسم 0.0× ATR نازل»)
//   • the round-number watch trigger joins the OFFICIAL plan
//   • an established trend break (15%+ under EMA50) is not today's news
//   • the market map keeps a reserved narrative slot
// =============================================================================

import { isLastBarFinal } from "../review"
import { veteranLinesAr as vetLines } from "../review"

const downTrendAr19 = "هابط — السعر تحت EMA50 وEMA20 تحت EMA50 (ترتيب سلبي)"

function amesBars(): Bar[] {
  return decliningSeries() // open field: no support zones at all
}

function amesRow(bars: Bar[]): SignalRowV2 {
  return rowOver(bars as ReturnType<typeof decliningSeries>, {
    state: "wait",
    metrics: { ...toSignalMetrics(computeMetrics(bars)!), ema20: 104, ema50: 107 }, // close 100 < 107, EMA20 < EMA50 → trendBroken
  })
}

describe("2026-11-19 — the ANTI-FLIP rule (one verdict for any P/L sign)", () => {
  it("−0.02٪ and +0.02٪ on the identical open-field tape → the SAME exit verdict, headline and invalidation; only the P/L sentence differs", () => {
    const bars = amesBars()
    const map = buildZoneMap(bars)
    const lossSide = reviewPosition({ row: amesRow(bars), bars, map, avgBuyPrice: 100.02 }) // −0.02٪
    const gainSide = reviewPosition({ row: amesRow(bars), bars, map, avgBuyPrice: 99.98 }) // +0.02٪
    expect(lossSide.decision).toBe("exit")
    expect(gainSide.decision).toBe("exit")
    expect(lossSide.decisionAr).toBe("اخرج الآن")
    expect(gainSide.decisionAr).toBe("اخرج الآن")
    expect(lossSide.headlineAr).toBe(gainSide.headlineAr)
    expect(lossSide.invalidationAr).toBe(gainSide.invalidationAr)
    expect(lossSide.planAr).toBe(gainSide.planAr)
    // the ONLY allowed difference: the P/L echo itself
    expect(lossSide.reasonsAr.some((x) => x.includes("متوسط شراء 100.02"))).toBe(true)
    expect(gainSide.reasonsAr.some((x) => x.includes("متوسط شراء 99.98"))).toBe(true)
    // and the JSON P/L keeps its sign near zero (never ±0.0)
    expect(lossSide.pnlPct).toBe(-0.02)
    expect(gainSide.pnlPct).toBe(0.02)
    expect(JSON.stringify(lossSide)).not.toContain("-0.0٪")
    expect(JSON.stringify(gainSide)).not.toContain("+0.0٪")
  })

  it("profit ≥ +6٪ on the same open-field break → TAKE_PROFIT (the owner rule survives the symmetry)", () => {
    const bars = amesBars()
    const map = buildZoneMap(bars)
    const r = reviewPosition({ row: amesRow(bars), bars, map, avgBuyPrice: 94 }) // +6.38٪
    expect(r.decision).toBe("take_profit")
    expect(r.planAr).toContain("50–75٪") // bearish posture: EMA20 < EMA50, close < EMA50
    expect(r.invalidationAr).toContain("الإغلاق")
  })

  it("an established break is old news: 15%+ under EMA50 names the standing state, not today's candle", () => {
    const bars = decliningSeries()
    const map = buildZoneMap(bars)
    const r = reviewPosition({
      row: rowOver(bars, {
        state: "wait",
        metrics: { ...toSignalMetrics(computeMetrics(bars)!), ema20: 104, ema50: 130 }, // close 100 → −23٪ under EMA50
      }),
      bars,
      map,
      avgBuyPrice: 105,
    })
    expect(r.decision).toBe("exit")
    expect(r.reasonsAr.some((x) => x.includes("بيع عن EMA50"))).toBe(true)
    expect(r.reasonsAr.some((x) => x.includes("مش حدث شمعة النهاردة"))).toBe(true)
  })
})

describe("2026-11-19 — the LIVE-session gate (الحكم بالإغلاق)", () => {
  it("a detected break on a LIVE bar → PROVISIONAL: انتظر with the two-sided close-based plan, no exit yet", () => {
    const bars = cushionSeries(97) // far-cushion break: close 103 under the 104 zone
    const map = buildZoneMap(bars)
    const r = reviewPosition({ row: rowOver(bars, { state: "exit" }), bars, map, avgBuyPrice: 105, lastBarFinal: false })
    expect(r.decision).toBe("wait")
    expect(r.lastCloseProvisional).toBe(true)
    expect(r.headlineAr).toContain("مرشح مش محسوم")
    expect(r.headlineAr).toContain("القاضي")
    expect(r.planAr).toContain("قفل نهائي تحت مستوى الكسر (104.00)")
    expect(r.planAr).toContain("قفل نهائي فوق 104.00")
    expect(r.invalidationAr).toContain("الحكم بالإغلاق مش باللمسة")
  })

  it("the same break on a FINAL close keeps today's exit verdict (unchanged behavior)", () => {
    const bars = cushionSeries(97)
    const map = buildZoneMap(bars)
    const r = reviewPosition({ row: rowOver(bars, { state: "exit" }), bars, map, avgBuyPrice: 105 })
    expect(r.decision).toBe("exit")
    expect(r.lastCloseProvisional).toBe(false)
  })

  it("veteran slot 1 on a LIVE session → the certainty softens to close-based judgment", () => {
    const ctx = ctxOver({ volCharacter: "spike" })
    const live = vetLines(ctx, { branch: "farCushionExit", avgBuyPrice: 100, close: 103, trendAr: downTrendAr19, lastBarFinal: false })
    expect(live.length).toBe(1)
    expect(live[0]).toContain("بالإغلاق النهائي")
    expect(live[0]).not.toContain("سحب سيولة حقيقي مش")
    const final = vetLines(ctx, { branch: "farCushionExit", avgBuyPrice: 100, close: 103, trendAr: downTrendAr19 })
    expect(final[0]).toContain("سحب سيولة حقيقي مش كسر كاذب")
  })

  it("a zero body never narrates a direction — «شبه معدوم» replaces the 0.0× figure", () => {
    const ctx = ctxOver({ volCharacter: "spike", bodyVsAtr: 0 })
    const lines = vetLines(ctx, { branch: "farCushionExit", avgBuyPrice: 100, close: 103, trendAr: downTrendAr19 })
    expect(lines[0]).toContain("شبه معدوم")
    expect(lines[0]).not.toContain("0.0×")
    const realBody = vetLines(ctxOver({ volCharacter: "spike", bodyVsAtr: 1.8 }), { branch: "farCushionExit", avgBuyPrice: 100, close: 103, trendAr: downTrendAr19 })
    expect(realBody[0]).toContain("1.8×")
  })

  it("isLastBarFinal: yesterday final, today live until 15:00 Cairo, future never trusted", () => {
    expect(isLastBarFinal("2026-03-11-011", new Date("2026-03-12T09:00:00Z"))).toBe(true)
    expect(isLastBarFinal("2026-03-12-012", new Date("2026-03-12T09:00:00Z"))).toBe(false) // Cairo 11:00 — live
    expect(isLastBarFinal("2026-03-12-012", new Date("2026-03-12T14:00:00Z"))).toBe(true) // Cairo 16:00 — final
    expect(isLastBarFinal("2026-03-13-013", new Date("2026-03-12T14:00:00Z"))).toBe(false)
    expect(isLastBarFinal(null)).toBe(false)
  })
})

describe("2026-11-19 — the round-number trigger joins the OFFICIAL plan", () => {
  it("hold with the 105.00 round level above the defense line → the plan names the FIRST trigger explicitly", () => {
    const bars = cushionSeries(100, 106.5)
    const map = buildZoneMap(bars)
    const r = reviewPosition({ row: rowOver(bars, { state: "wait" }), bars, map, avgBuyPrice: 100 })
    expect(r.decision).toBe("hold")
    expect(r.planAr).toContain("المشغّل الأول للمراقبة")
    expect(r.planAr).toContain("105.00")
  })
})

describe("2026-11-19 — the market map keeps its reserved narrative slot", () => {
  it("every trigger family firing + the market section → the map STILL reaches the report (last line, no VSA displacement)", () => {
    const richCtx = ctxOver({
      divergence: "bearish",
      volCharacter: "spike",
      closeLocationPct: 88.1,
      roundLevelNear: { level: 210, distPct: 0.87 },
      consolidation: { sessions: 7, tightnessPct: 2.1 },
      nearRangeTop: true,
      volTrend5: "falling",
      vsaNoteAr: "ملاحظة VSA فاقدة الأولوية.",
    })
    const frozenBar = (close: number): Bar => ({ ts: "2026-03-12-000", open: close, high: close + 0.04, low: close - 0.04, close, volume: 1000 })
    const lines = narrativeLinesAr(
      richCtx,
      { branch: "hold", avgBuyPrice: 100, close: 208.18, trendAr: upTrendAr },
      {
        bars: [frozenBar(208.18), frozenBar(208.18), frozenBar(208.18)],
        map: null,
        cushion: null,
        nearestSupportLow: 200,
        prevClose: 208.0,
        mctx: mctxFull(),
      },
    )
    expect(lines.length).toBe(NARRATIVE_MAX_LINES)
    expect(lines[0]).toContain("انحراف سلبي") // traps still open the pass
    expect(lines[1]).toContain("فوليوم Spike")
    expect(lines[lines.length - 1]).toContain("خريطة السوق النهاردة") // the map made it
    expect(lines.every((l) => !l.includes("ملاحظة VSA"))).toBe(true) // the filler lost its slot to the map
  })
})
