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
// 208.18 (+0.1٪), decision "احتفظ" — yet reason #4 said: «الحلم فوق: أقرب
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
    expect(all).toContain("الحلم فوق: أول منطقة تستحق قرار أرباح جزئي عند 236.00–240.00 على بعد +13.5٪ من متوسطك")
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
      `الحلم فوق: مفيش مقاومة مسجلة فوق متوسطك بـ ${PROFIT_TARGET_MIN_GAP_PCT}٪ أو أكثر في نافذة البيانات — السهم في أرض جديدة، والأرباح الجزئية هنا بيتقررها خط المتوسطات (EMA20/EMA50) مش سقف قديم`,
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

  it("integration: the wiring APPENDS — the pre-wiring hold snapshot stands intact as the prefix, at most 2 veteran lines follow", () => {
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
      "الحلم فوق: أول منطقة تستحق قرار أرباح جزئي عند 112.85–112.85 على بعد +12.8٪ من متوسطك.",
      "الخلاصة بصوت واضح: احتفظ. البيع يبقى قرار لما يفلخط الدفاع، مش لما القلق يعلو.",
    ])
    // and whatever the (now live) MarketContext produces, the cap holds: ≤ 2
    expect(r.reasonsAr.length).toBeLessThanOrEqual(7)
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
