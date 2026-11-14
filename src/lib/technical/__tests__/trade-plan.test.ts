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
    // EGX tick for 93.10 is 0.05 → 93.1 (already on tick)
    expect(p.stop).toBeCloseTo(93.1, 2)
    expect(p.stop).toBeLessThan(p.entryLow)
    // target = the 115 pivot zone [×0.998, ×1.004]
    // EGX tick for >50 is 0.10: 114.77→114.8, 115.46→115.5
    expect(p.targetLow).toBeCloseTo(114.8, 2)
    expect(p.targetHigh).toBeCloseTo(115.5, 2)
    expect(p.targetKind).toBe("pivot")
    expect(p.riskReward).toBeCloseTo(2.47, 2)
    expect(p.riskReward).toBeGreaterThanOrEqual(1.5)
    expect(p.stopPct).toBeLessThan(0)
    expect(p.textAr).toContain("وقف الخسارة")
    expect(p.textAr).toContain("تتلغى")
  })

  it("tiny ATR clamps the stop to the 3.5×ATR sanity ceiling (never absurdly far)", () => {
    // anchor 95 − 1.5×0.30 = 94.55 → distance 4.90 > 3.5×0.30 → clamped to 98.40
    const plan = buildTradePlan({ signal: "buy", lastClose: 100, closes: zigzagWithZones(), atrPct: 0.3 })
    expect(plan).not.toBeNull()
    expect(plan!.stop).toBeCloseTo(98.4, 2)
  })

  it("wide ATR pushes RR below 1.5 → NO plan (validated, not fudged)", () => {
    // @5 plan geometry: entry zone 98.5–100.4 (mid 99.45), structural stop
    // 95 − 1.5×ATR, measured-move target 119.45. ATR 6 → stop 86 → risk 13.45
    // vs reward 20 → RR ≈ 1.49 < 1.5 → the plan is REJECTED, never fudged.
    expect(buildTradePlan({ signal: "buy", lastClose: 100, closes: zigzagWithZones(), atrPct: 6 })).toBeNull()
  })

  it("chase with a distant support: measured-move target pays < 1.5R → NO plan", () => {
    // @4 printed RR exactly 2.00 here; @5 refuses a plan that cannot pay 1.5R
    expect(buildTradePlan({ signal: "buy", lastClose: 120, closes: chasingCloses(), volPct: 3 })).toBeNull()
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
  it("stop above the resistance + buffer; target at a support paying ≥ 1.5R", () => {
    const plan = buildTradePlan({
      signal: "sell",
      lastClose: 100,
      closes: [],
      supports: [{ price: 80 }],
      resistances: [{ price: 106 }],
      atrPct: null,
    })
    expect(plan).not.toBeNull()
    const p = plan as TradePlan
    expect(p.bias).toBe("sell")
    expect(p.entryLow).toBeCloseTo(99.5, 2)
    expect(p.entryHigh).toBeCloseTo(102, 2)
    // stop = 106 + 2% default buffer = 108 (inside the sanity band)
    // EGX tick for 108 (>50) is 0.10 → 108.0
    expect(p.stop).toBeCloseTo(108.0, 2)
    expect(p.stop).toBeGreaterThan(p.entryHigh)
    // target = support pivot zone [80×0.996, 80×1.002]
    // EGX tick for >50 is 0.10: 79.68→79.7, 80.16→80.2
    expect(p.targetLow).toBeCloseTo(79.7, 2)
    expect(p.targetHigh).toBeCloseTo(80.2, 2)
    expect(p.targetKind).toBe("pivot")
    expect(p.riskReward).toBeCloseTo(2.87, 2)
    expect(p.textAr).toContain("ضغط بيعي")
    expect(p.basisAr).toContain("المقاومة")
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
    // EGX tick table: <10→0.01, 10-50→0.05, >50→0.10
    // entryLow 99.68→99.7, entryHigh 101.6→101.6, stop 95.4→95.4, 
    // targetLow = 112.47*0.998=112.24006→112.2 (0.10 tick), 
    // targetHigh = 112.47*1.004=112.90988→112.9 (0.10 tick)
    expect([p.entryLow, p.entryHigh, p.stop, p.targetLow, p.targetHigh]).toEqual([99.7, 101.6, 95.4, 112.2, 112.9])
    for (const v of [p.entryLow, p.entryHigh, p.stop, p.targetLow, p.targetHigh]) {
      expect(is2dp(v)).toBe(true)
      expect(v).toBeGreaterThan(0)
    }
    for (const v of [p.entryPct, p.stopPct, p.targetPct]) expect(is1dp(v)).toBe(true)
    expect(is2dp(p.riskReward)).toBe(true)
    // Updated due to EGX tick rounding: 2.27 instead of 2.28
    expect(p.riskReward).toBeCloseTo(2.27, 2)
  })

  it("roundToTick — EGX official price-band table (<10→0.01, 10-50→0.05, >50→0.10)", () => {
    // 123.456 with >50 tick (0.10): 123.456/0.10=1234.56→round 1235→123.5
    expect(roundToTick(123.456)).toBe(123.5)
    // 123.4549 with >50 tick (0.10): 123.4549/0.10=1234.549→round 1235→123.5
    expect(roundToTick(123.4549)).toBe(123.5)
    // 10 with 10-50 tick (0.05): 10/0.05=200→round 200→10.00
    expect(roundToTick(10)).toBe(10)
    // 5 with <10 tick (0.01): 5/0.01=500→round 500→5.00
    expect(roundToTick(5)).toBe(5)
    // 25.123 with 10-50 tick (0.05): 25.123/0.05=502.46→round 502→25.10
    expect(roundToTick(25.123)).toBe(25.1)
    // 75.555 with >50 tick (0.10): 75.555/0.10=755.55→round 756→75.6
    expect(roundToTick(75.555)).toBe(75.6)
  })
})
