// Trade plan builder tests — deterministic zones with known shapes, derived by
// construction (not by re-running the engine).
//
// The synthetic series engineer EXACT swing pivots so the nearest support /
// resistance are known constants:
//   zigzagWithZones(): flat 100 base → V-dip to 95 (pivot low) → rise to 110 →
//   Λ-bump to 115 (pivot high) → decline back to 100. Close-only flat bars
//   yield pivots only at strict swing turns, so the derived zones are exactly
//   { supports: [95], resistances: [115] }.
import { describe, expect, it } from "vitest"
import { buildTradePlan, type TradePlan } from "../trade-plan"

/** Flat base → V-dip (pivot low 95) → rise → Λ-bump (pivot high 115) → back to 100. */
function zigzagWithZones(): number[] {
  const out: number[] = []
  for (let i = 0; i < 12; i++) out.push(100)
  out.push(97, 95, 97, 100) // V dip — the pivot low at 95
  for (let i = 1; i <= 8; i++) out.push(100 + i * 1.25) // rise 101.25 → 110
  out.push(111, 113, 115, 113, 111, 110) // Λ bump — the pivot high at 115
  out.push(108.34, 106.67, 105, 103.34, 101.67, 100) // decline back to 100
  return out
}

/** Flat 95 with a V-dip to 92, then a steady climb to 120 — the tail is far
 *  above the nearest support (>6%) → the chasing branch. */
function chasingCloses(): number[] {
  const out: number[] = []
  for (let i = 0; i < 6; i++) out.push(95)
  out.push(92) // pivot low
  for (let i = 0; i < 6; i++) out.push(95)
  for (let i = 1; i <= 14; i++) out.push(95 + i * (25 / 14)) // climb to 120
  return out
}

/** Strictly declining closes — no swing pivots → no usable resistance. */
function monotonicDecline(): number[] {
  const out: number[] = []
  let p = 80
  for (let i = 0; i < 80; i++) { out.push(Math.round(p * 100) / 100); p *= 0.995 }
  return out
}

const is2dp = (v: number): boolean => Math.abs(v - Math.round(v * 100) / 100) < 1e-9
const is1dp = (v: number): boolean => Math.abs(v - Math.round(v * 10) / 10) < 1e-9

describe("buildTradePlan — buy near support", () => {
  it("anchors entry above the nearest support, targets the resistance zone, RR ≥ 1", () => {
    const closes = zigzagWithZones()
    const plan = buildTradePlan({ signal: "buy", lastClose: 100, closes, atrPct: null })
    expect(plan).not.toBeNull()
    const p = plan as TradePlan
    expect(p.bias).toBe("buy")
    expect(p.basisAr).toBe("فوق الدعم الأقرب")
    // entry = [max(95×1.002, 100×0.985), 100×1.004] — the support floor 95.19
    // sits 5.3% below the close, so the pullback floor (−1.5%) is the lower bound
    expect(p.entryLow).toBeCloseTo(98.5, 2)
    expect(p.entryHigh).toBeCloseTo(100.4, 2)
    // stop = 95 × (1 − 2%) with the default 2% ATR buffer
    expect(p.stop).toBeCloseTo(92.72, 2)
    expect(p.stop).toBeLessThan(p.entryLow)
    expect(p.entryLow).toBeLessThanOrEqual(p.entryHigh)
    // r1 = 115 pays ≫ 1R → the target is the resistance zone
    expect(p.targetLow).toBeCloseTo(114.77, 2)
    expect(p.targetHigh).toBeCloseTo(115.46, 2)
    expect(p.targetLow).toBeGreaterThan(p.entryHigh)
    expect(p.riskReward).toBeGreaterThanOrEqual(1)
    expect(p.stopPct).toBeLessThan(0)
    // the voiding rule is stated in the plan text
    expect(p.textAr).toContain("وقف الخسارة")
    expect(p.textAr).toContain("تتلغي")
  })
})

describe("buildTradePlan — buy chasing", () => {
  it("price >6% above the nearest support → pullback entry, fixed −4.5% stop, 2R target", () => {
    const closes = chasingCloses()
    const plan = buildTradePlan({ signal: "buy", lastClose: 120, closes, atrPct: null })
    expect(plan).not.toBeNull()
    const p = plan as TradePlan
    expect(p.bias).toBe("buy")
    expect(p.basisAr).toBe("دخول على التصحيح مش المطاردة")
    expect(p.entryLow).toBeCloseTo(118.2, 2) // 120 × 0.985
    expect(p.entryHigh).toBeCloseTo(120.48, 2) // 120 × 1.004
    expect(p.stop).toBeCloseTo(114.6, 2) // 120 × 0.955
    expect(p.stopPct).toBeCloseTo(-4.5, 1)
    // no resistance above the tail → the 2R rule
    expect(p.targetLow).toBe(p.targetHigh)
    expect(p.targetLow).toBeGreaterThan(p.entryHigh)
    expect(p.riskReward).toBeCloseTo(2, 2)
  })

  it("wide-ATR chase widens the stop beyond the default", () => {
    const plan = buildTradePlan({ signal: "buy", lastClose: 120, closes: chasingCloses(), atrPct: 5 })
    expect(plan).not.toBeNull()
    const p = plan as TradePlan
    // stop = 120 × (1 − 2 × 0.05 × 1.2) = 120 × 0.88
    expect(p.stop).toBeCloseTo(105.6, 2)
  })
})

describe("buildTradePlan — sell", () => {
  it("exit/re-entry shape: entry below the resistance, stop above it, target at support", () => {
    const plan = buildTradePlan({
      signal: "sell",
      lastClose: 100,
      closes: [],
      supports: [{ price: 94 }],
      resistances: [{ price: 106 }],
      atrPct: null,
    })
    expect(plan).not.toBeNull()
    const p = plan as TradePlan
    expect(p.bias).toBe("sell")
    expect(p.entryLow).toBeCloseTo(99.5, 2) // 100 × 0.995
    expect(p.entryHigh).toBeCloseTo(102, 2) // min(106, 100 × 1.02)
    expect(p.stop).toBeCloseTo(104, 2) // min(106 × 1.01, 100 × 1.04) — capped
    expect(p.stop).toBeGreaterThan(p.entryHigh)
    expect(p.targetLow).toBeCloseTo(94, 2)
    expect(p.targetHigh).toBeCloseTo(94, 2)
    expect(p.targetLow).toBeLessThan(p.entryLow)
    expect(p.riskReward).toBeGreaterThan(0)
    expect(p.textAr).toContain("ضغط بيعي")
    expect(p.basisAr).toContain("المقاومة")
  })

  it("derives the resistance from closes when zones are not passed", () => {
    const plan = buildTradePlan({ signal: "sell", lastClose: 100, closes: zigzagWithZones(), atrPct: null })
    expect(plan).not.toBeNull()
    const p = plan as TradePlan
    expect(p.bias).toBe("sell")
    expect(p.stop).toBeGreaterThan(p.entryHigh)
    expect(p.targetLow).toBeCloseTo(95, 2) // nearest support below the close
  })

  it("no usable resistance (monotonic decline) → null, never fabricated", () => {
    expect(buildTradePlan({ signal: "sell", lastClose: 55.2, closes: monotonicDecline(), atrPct: null })).toBeNull()
  })
})

describe("buildTradePlan — hold and invalid inputs", () => {
  it("hold → null", () => {
    expect(buildTradePlan({ signal: "hold", lastClose: 100, closes: zigzagWithZones(), atrPct: null })).toBeNull()
  })

  it("invalid lastClose → null", () => {
    expect(buildTradePlan({ signal: "buy", lastClose: 0, closes: zigzagWithZones() })).toBeNull()
    expect(buildTradePlan({ signal: "buy", lastClose: Number.NaN, closes: zigzagWithZones() })).toBeNull()
    expect(buildTradePlan({ signal: "sell", lastClose: -5, closes: zigzagWithZones() })).toBeNull()
  })
})

describe("buildTradePlan — empty closes with provided zones", () => {
  it("works when supports/resistances are passed and closes are empty", () => {
    const plan = buildTradePlan({
      signal: "buy",
      lastClose: 100,
      closes: [],
      supports: [{ price: 95 }],
      resistances: [{ price: 115 }],
      atrPct: null,
    })
    expect(plan).not.toBeNull()
    const p = plan as TradePlan
    expect(p.bias).toBe("buy")
    expect(p.entryLow).toBeCloseTo(98.5, 2) // pullback floor wins over the distant support
    expect(p.stop).toBeLessThan(p.entryLow)
    expect(p.riskReward).toBeGreaterThanOrEqual(1)
  })
})

describe("buildTradePlan — rounding contract", () => {
  it("prices 2dp, percentages 1dp, risk/reward 2dp", () => {
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
    for (const v of [p.entryLow, p.entryHigh, p.stop, p.targetLow, p.targetHigh]) {
      expect(is2dp(v)).toBe(true)
      expect(v).toBeGreaterThan(0)
    }
    for (const v of [p.entryPct, p.stopPct, p.targetPct]) expect(is1dp(v)).toBe(true)
    expect(is2dp(p.riskReward)).toBe(true)

    const sell = buildTradePlan({
      signal: "sell",
      lastClose: 100.31,
      closes: [],
      supports: [{ price: 93.17 }],
      resistances: [{ price: 104.89 }],
      atrPct: null,
    })
    expect(sell).not.toBeNull()
    const s = sell as TradePlan
    for (const v of [s.entryLow, s.entryHigh, s.stop, s.targetLow, s.targetHigh]) {
      expect(is2dp(v)).toBe(true)
      expect(v).toBeGreaterThan(0)
    }
    for (const v of [s.entryPct, s.stopPct, s.targetPct]) expect(is1dp(v)).toBe(true)
  })
})
