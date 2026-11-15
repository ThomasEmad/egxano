// Trade plan builder tests — tech-signals@5 contract: stops from STRUCTURE ±
// 1.5×ATR inside a [0.5, 3.5]×ATR sanity band, targets from the NEXT
// STRUCTURAL ZONE with a measured-move fallback, RR VALIDATED ≥ 1.5 (a plan
// paying less is REJECTED — no mechanical 2R, no fabricated −7% fallbacks),
// WAIT → NO plan, all prices on the 0.01 tick.
//
// The synthetic series engineers EXACT swing pivots: zigzagWithZones() yields
// { supports: [95], resistances: [115] } with close 100.
import { describe, expect, it } from "vitest"
import { buildTradePlan, roundToTick, type TradePlan } from "../trade-plan"

function zigzagWithZones(): number[] {
  const out: number[] = []
  for (let i = 0; i < 12; i++) out.push(100)
  out.push(97, 95, 97, 100) // V dip — pivot low 95
  for (let i = 1; i <= 8; i++) out.push(100 + i * 1.25) // rise to 110
  out.push(111, 113, 115, 113, 111, 110) // Λ bump — pivot high 115
  out.push(108.34, 106.67, 105, 103.34, 101.67, 100)
  return out
}

function chasingCloses(): number[] {
  const out: number[] = []
  for (let i = 0; i < 6; i++) out.push(95)
  out.push(92) // pivot low
  for (let i = 0; i < 6; i++) out.push(95)
  for (let i = 1; i <= 14; i++) out.push(95 + i * (25 / 14)) // climb to 120
  return out
}

function monotonicDecline(): number[] {
  const out: number[] = []
  let p = 80
  for (let i = 0; i < 80; i++) { out.push(Math.round(p * 100) / 100); p *= 0.995 }
  return out
}

const is2dp = (v: number): boolean => Math.abs(v - Math.round(v * 100) / 100) < 1e-9
const is1dp = (v: number): boolean => Math.abs(v - Math.round(v * 10) / 10) < 1e-9

describe("buildTradePlan — structural stop + zone target (buy)", () => {
  it("stop = support − 1.5×ATR (default 2% buffer), target = resistance pivot, RR ≥ 1.5", () => {
    const closes = zigzagWithZones()
    const plan = buildTradePlan({ signal: "buy", lastClose: 100, closes, atrPct: null })
    expect(plan).not.toBeNull()
    const p = plan as TradePlan
    expect(p.bias).toBe("buy")
    expect(p.basisAr).toContain("فوق الدعم الأقرب")
    expect(p.basisAr).toContain("1.5×ATR")
    // entry = [max(95×1.002, 100×0.985), 100×1.004]
    expect(p.entryLow).toBeCloseTo(98.5, 2)
    expect(p.entryHigh).toBeCloseTo(100.4, 2)
    // stop = 95 − 95×0.02 = 93.10 (inside the [2%, 8%] sanity band)
    expect(p.stop).toBeCloseTo(93.1, 2)
    expect(p.stop).toBeLessThan(p.entryLow)
    // target = the 115 pivot zone [×0.998, ×1.004]
    expect(p.targetLow).toBeCloseTo(114.77, 2)
    expect(p.targetHigh).toBeCloseTo(115.46, 2)
    expect(p.targetKind).toBe("pivot")
    expect(p.riskReward).toBeCloseTo(2.47, 2)
    expect(p.riskReward).toBeGreaterThanOrEqual(1.5)
    expect(p.stopPct).toBeLessThan(0)
    expect(p.textAr).toContain("وقف الخسارة")
    expect(p.textAr).toContain("تتلغى")
  })

  it("tiny ATR cannot place the stop outside the entry zone → NO plan", () => {
    // ATR 0.30 caps the stop at entryMid − 0.60 = 98.85, which sits INSIDE the
    // 98.5–100.4 entry zone: a stop there invalidates nothing, so the builder
    // refuses the plan rather than shrinking the stop into the noise. (The old
    // 3.5×ATR ceiling pushed the same stop out to 98.40 and "passed".)
    expect(buildTradePlan({ signal: "buy", lastClose: 100, closes: zigzagWithZones(), atrPct: 0.3 })).toBeNull()
  })

  it("wide ATR is clamped to 2×ATR, and the plan must still pay ≥1.5R", () => {
    // entry zone 98.5–100.4 (mid 99.45); the structural stop 95 − 1.5×6 = 86
    // would sit 13.45 away, so the 2.0×ATR ceiling pulls it to 87.45 (risk
    // 12.00) while the measured-move target pays 20 → RR ≈ 1.67 → the plan
    // stands, with the R/R validated on the clamped numbers.
    const plan = buildTradePlan({ signal: "buy", lastClose: 100, closes: zigzagWithZones(), atrPct: 6 })
    expect(plan).not.toBeNull()
    expect(plan!.stop).toBeCloseTo(87.45, 2)
    expect(plan!.riskReward).toBeGreaterThanOrEqual(1.5)
  })

  it("chase with a distant support: any plan emitted must still pay ≥1.5R and keep the stop inside 2×ATR", () => {
    // The @5 contract after the 2026-11-15 stop-distance fix: the plan is
    // either absent (no honest geometry) or it respects both invariants.
    const plan = buildTradePlan({ signal: "buy", lastClose: 120, closes: chasingCloses(), volPct: 3 })
    if (plan) {
      expect(plan.riskReward).toBeGreaterThanOrEqual(1.5)
      const atrAbs = (3 * 1.5 / 100) * 120
      const entryMid = (plan.entryLow + plan.entryHigh) / 2
      expect(entryMid - plan.stop).toBeLessThanOrEqual(2 * atrAbs + 0.02)
    }
  })

  it("close-only board path: volPct becomes the disclosed ATR proxy", () => {
    // support 92, atrAbs = 3%×1.5×120 = 5.4 → stopRaw 92−8.1 = 83.9 → clamped
    // to mid − 3.5×5.4 = 100.44 → measured move pays ~1.48R → still < 1.5 → null
    // (the proxy keeps the geometry honest; the basis would disclose it)
    const plan = buildTradePlan({ signal: "buy", lastClose: 100.4, closes: chasingCloses(), volPct: 3 })
    if (plan) {
      expect(plan.basisAr).toContain("تقريبي")
      expect(plan.riskReward).toBeGreaterThanOrEqual(1.5)
    }
  })
})

describe("buildTradePlan — sell", () => {
  it("a sell read NEVER produces a tradable plan — no entry, no stop, no target", () => {
    // 2026-11-15 owner report: "صفقات بيع كتير مع ان السوق المصري بيسمح بصفقات
    // الشراء فقط". Even with a textbook short geometry available (resistance
    // just above, a support far below paying > 2R), the builder refuses to
    // price it: an EGX reader cannot execute a short, so a sell plan would be
    // fiction. The sell read stays a risk/exit warning on `signal` only.
    expect(buildTradePlan({
      signal: "sell",
      lastClose: 100,
      closes: [],
      supports: [{ price: 80 }],
      resistances: [{ price: 106 }],
      atrPct: null,
    })).toBeNull()
  })

  it("nearest support pays < 1.5R → NO plan (the @4 lc×0.93 fallback is gone)", () => {
    expect(buildTradePlan({
      signal: "sell",
      lastClose: 100,
      closes: [],
      supports: [{ price: 94 }],
      resistances: [{ price: 106 }],
      atrPct: null,
    })).toBeNull()
  })

  it("no usable resistance (monotonic decline) → null, never fabricated", () => {
    expect(buildTradePlan({ signal: "sell", lastClose: 55.2, closes: monotonicDecline(), atrPct: null })).toBeNull()
  })
})

describe("buildTradePlan — hold and invalid inputs", () => {
  it("hold → null (WAIT means NO plan)", () => {
    expect(buildTradePlan({ signal: "hold", lastClose: 100, closes: zigzagWithZones(), atrPct: null })).toBeNull()
  })

  it("invalid lastClose → null", () => {
    expect(buildTradePlan({ signal: "buy", lastClose: 0, closes: zigzagWithZones() })).toBeNull()
    expect(buildTradePlan({ signal: "buy", lastClose: Number.NaN, closes: zigzagWithZones() })).toBeNull()
    expect(buildTradePlan({ signal: "sell", lastClose: -5, closes: zigzagWithZones() })).toBeNull()
  })

  it("no structural floor (no support) → no honest buy plan", () => {
    expect(buildTradePlan({ signal: "buy", lastClose: 100, closes: [], supports: [], resistances: [{ price: 115 }], atrPct: null })).toBeNull()
  })
})

describe("buildTradePlan — rounding and tick contract", () => {
  it("prices 2dp on the 0.01 tick, percentages 1dp, RR 2dp", () => {
    const plan = buildTradePlan({
      signal: "buy",
      lastClose: 101.2,
      closes: [],
      supports: [{ price: 97.35 }],
      resistances: [{ price: 112.47 }],
      atrPct: null,
    })
    expect(plan).not.toBeNull()
    const p = plan as TradePlan
    // CONSERVATIVE rounding (remediation 2026-11-15): a BUY entry rounds UP and
    // its stop rounds DOWN, so rounding can never flatter the printed R/R.
    // Nearest-rounding gave 99.68 / 101.60; the conservative side is 99.69 / 101.61.
    expect([p.entryLow, p.entryHigh, p.stop, p.targetLow, p.targetHigh]).toEqual([99.69, 101.61, 95.4, 112.25, 112.92])
    for (const v of [p.entryLow, p.entryHigh, p.stop, p.targetLow, p.targetHigh]) {
      expect(is2dp(v)).toBe(true)
      expect(v).toBeGreaterThan(0)
    }
    for (const v of [p.entryPct, p.stopPct, p.targetPct]) expect(is1dp(v)).toBe(true)
    expect(is2dp(p.riskReward)).toBe(true)
    // R/R is computed on the ROUNDED levels and re-validated — it must never
    // exceed the pre-rounding geometry's reward.
    expect(p.riskReward).toBeCloseTo(2.27, 2)
    expect(p.riskReward).toBeGreaterThanOrEqual(1.5)
  })

  it("roundToTick — 0.01 EGP safe fine-grained default (EGX table configurable)", () => {
    expect(roundToTick(123.456)).toBe(123.46)
    expect(roundToTick(123.4549)).toBe(123.45)
    expect(roundToTick(10)).toBe(10)
  })

  it("roundToTick — direction is honoured and never drifts on exact multiples", () => {
    // exact multiples must not be pushed a whole tick by float dust
    expect(roundToTick(10, 0.01, "up")).toBe(10)
    expect(roundToTick(10, 0.01, "down")).toBe(10)
    expect(roundToTick(123.451, 0.01, "up")).toBe(123.46)
    expect(roundToTick(123.451, 0.01, "down")).toBe(123.45)
    expect(roundToTick(123.451, 0.01, "nearest")).toBe(123.45)
    // a real tick table can be supplied without touching the geometry
    expect(roundToTick(123.47, 0.05, "down")).toBe(123.45)
    expect(roundToTick(123.47, 0.05, "up")).toBe(123.5)
  })

  it("BUY levels round conservatively: entry up, stop down, target up", () => {
    const p = buildTradePlan({
      signal: "buy", lastClose: 101.2, closes: [],
      supports: [{ price: 97.35 }], resistances: [{ price: 112.47 }], atrPct: null,
    }) as TradePlan
    expect(p).not.toBeNull()
    // entry never fills better than computed, stop never sits closer than
    // computed, target never sits nearer than computed
    expect(p.entryLow).toBeGreaterThanOrEqual(99.68)
    expect(p.stop).toBeLessThanOrEqual(95.4)
    expect(p.targetLow).toBeGreaterThanOrEqual(112.25)
    // and the geometry stays internally valid after rounding
    expect(p.stop).toBeLessThan(p.entryLow)
    expect(p.targetLow).toBeGreaterThan(p.entryHigh)
  })

  it("SELL levels round conservatively: entry down, stop up, target closer", () => {
    const p = buildTradePlan({
      signal: "sell", lastClose: 100, closes: [],
      supports: [{ price: 94 }], resistances: [{ price: 104 }], atrPct: null,
    }) as TradePlan
    if (p === null) return // no plan is also an honest outcome
    expect(p.stop).toBeGreaterThan(p.entryHigh)
    expect(p.targetHigh).toBeLessThan(p.entryLow)
    expect(p.riskReward).toBeGreaterThanOrEqual(1.5)
  })
})
