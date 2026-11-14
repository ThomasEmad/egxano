// Position sizing tests — the fixed contract of the paid sizing module:
//   • shares = floor(riskBudget / (|entry − stop| + perShareCosts)), then a
//     DOWNWARD-only constraint cascade (lot → liquidity cap → portfolio cap →
//     minShares). The risk budget is never rounded up through.
//   • buy/sell symmetry with mirrored inputs (identical numbers, sign-flipped
//     geometry, direction-aware break-even).
//   • costs shrink the size (they enter the DENOMINATOR), the percent-cost
//     circularity resolves by fixed-point iteration (max 3, tol 1e-9).
//   • mandatory Arabic disclosures on every ok result: gap-risk + costs note.
//   • every invalid input → ok:false with an Arabic message and a typed code;
//     NaN/Infinity never leak into any output field.
//
// All expected numbers below were hand-computed and re-verified with node
// (see scripts/verify-sizing.mjs run before these tests were finalized).
import { describe, expect, it } from "vitest"
import {
  computePositionSizing,
  DEFAULT_MAX_PORTFOLIO_RISK_PCT,
  DEFAULT_RISK_PCT,
  type PositionSizingInput,
  type PositionSizingOk,
  type PositionSizingResult,
  type SizingDirection,
  type SizingErrorCode,
} from "../position-sizing"

function buyBase(): PositionSizingInput {
  return {
    capital: 100_000,
    riskPct: 0.01,
    direction: "buy",
    entry: { low: 9.8, high: 10.2 }, // mid 10.00
    stop: 9, // price risk 1.00
    target: { low: 11.5, high: 12.5 }, // mid 12.00
    tickSize: 0.01,
  }
}

function sellMirror(): PositionSizingInput {
  return {
    capital: 100_000,
    riskPct: 0.01,
    direction: "sell",
    entry: { low: 9.8, high: 10.2 }, // mid 10.00
    stop: 11, // price risk 1.00 above
    target: { low: 7.5, high: 8.5 }, // mid 8.00 below
    tickSize: 0.01,
  }
}

const ok = (r: PositionSizingResult): PositionSizingOk => {
  if (!r.ok) throw new Error(`expected ok:true, got code=${r.code} — ${r.errorAr}`)
  return r
}

const hasArabic = (s: string): boolean => /[\u0600-\u06FF]/.test(s)

describe("computePositionSizing — buy base case, no costs (hand-computed)", () => {
  const r = ok(computePositionSizing(buyBase()))

  it("sizes floor(riskBudget / priceRiskPerShare) exactly", () => {
    expect(r.shares).toBe(1000) // floor(1000 / 1)
    expect(r.riskBudget).toBe(1000) // 100_000 × 0.01
    expect(r.riskPctUsed).toBe(0.01)
    expect(r.priceRiskPerShare).toBe(1)
    expect(r.riskPerShare).toBe(1)
    expect(r.riskAmount).toBe(1000)
    expect(r.riskAmountWithCosts).toBe(1000)
    expect(r.positionValue).toBe(10000)
    expect(r.perShareCosts).toBe(0)
  })

  it("exposes the entry zone and the tick-rounded effective entry", () => {
    expect(r.effectiveEntry).toBe(10) // mid of [9.8, 10.2]
    expect(r.entrySource).toBe("zone_mid")
    expect(r.entryZone).toEqual({ low: 9.8, high: 10.2 })
    expect(r.stop).toBe(9)
    expect(r.targetZone).toEqual({ low: 11.5, high: 12.5 })
    expect(r.targetMid).toBe(12)
  })

  it("computes R-multiples over breakEven / priceRiskPerShare", () => {
    expect(r.breakEven).toBe(10)
    expect(r.rTargetLow).toBe(1.5) // (11.5 − 10) / 1
    expect(r.rTargetMid).toBe(2) // (12.0 − 10) / 1
    expect(r.rTargetHigh).toBe(2.5) // (12.5 − 10) / 1
  })

  it("carries the mandatory disclosures: gap risk + costs not included", () => {
    expect(r.warnings.some((w) => w.includes("فجوة سعرية عند الافتتاح"))).toBe(true)
    expect(r.warnings.some((w) => w.includes("التكاليف غير مضمنة"))).toBe(true)
    for (const w of r.warnings) expect(hasArabic(w)).toBe(true)
  })
})

describe("buy/sell symmetry with mirrored inputs", () => {
  const b = ok(computePositionSizing(buyBase()))
  const s = ok(computePositionSizing(sellMirror()))

  it("produces identical sizing numbers", () => {
    expect(s.shares).toBe(b.shares)
    expect(s.effectiveEntry).toBe(b.effectiveEntry)
    expect(s.priceRiskPerShare).toBe(b.priceRiskPerShare)
    expect(s.riskBudget).toBe(b.riskBudget)
    expect(s.riskAmount).toBe(b.riskAmount)
    expect(s.riskAmountWithCosts).toBe(b.riskAmountWithCosts)
    expect(s.positionValue).toBe(b.positionValue)
    expect(s.riskPerShare).toBe(b.riskPerShare)
  })

  it("mirrors R-multiples across the direction-aware break-even", () => {
    expect(s.breakEven).toBe(10)
    expect(s.rTargetMid).toBe(b.rTargetMid)
    expect(s.rTargetMid).toBe(2)
    expect(s.rTargetLow).toBe(b.rTargetHigh) // sell target-low sits where buy target-high does
    expect(s.rTargetLow).toBe(2.5)
    expect(s.rTargetHigh).toBe(b.rTargetLow)
    expect(s.rTargetHigh).toBe(1.5)
  })

  it("keeps the same disclosure surface", () => {
    expect(s.warnings.some((w) => w.includes("فجوة سعرية"))).toBe(true)
    expect(s.warnings.length).toBe(b.warnings.length)
  })
})

describe("costs enter the denominator and shrink shares", () => {
  it("per-share cost estimate: 1000 / 1.10 → 909 shares, breakEven shifts", () => {
    const r = ok(computePositionSizing({ ...buyBase(), costsPerShare: 0.1 }))
    expect(r.shares).toBe(909)
    expect(r.perShareCosts).toBe(0.1)
    expect(r.riskPerShare).toBeCloseTo(1.1, 12)
    expect(r.riskAmount).toBe(909) // price risk only
    expect(r.riskAmountWithCosts).toBeCloseTo(999.9, 9) // 909 × 1.1
    expect(r.riskAmountWithCosts).toBeLessThanOrEqual(r.riskBudget + 1e-9)
    expect(r.breakEven).toBeCloseTo(10.1, 12)
    expect(r.rTargetMid).toBeCloseTo(1.9, 12) // (12 − 10.1) / 1
    expect(r.warnings.some((w) => w.includes("التكاليف غير مضمنة"))).toBe(false)
  })

  it("percent costs resolve the circularity by fixed point (0.3%/side)", () => {
    // iter0: shares 1000 → value 10000 → 30/side → 0.06/share
    // iter1: shares floor(1000/1.06) = 943 → value 9430 → 28.29/side → 0.06/share (converged)
    const r = ok(
      computePositionSizing({ ...buyBase(), entry: undefined, entryPrice: 10, costs: { perSidePct: 0.003, minPerSide: 0 } }),
    )
    expect(r.shares).toBe(943)
    expect(r.perShareCosts).toBeCloseTo(0.06, 10)
    expect(r.riskAmountWithCosts).toBeCloseTo(999.58, 6)
    expect(r.riskAmountWithCosts).toBeLessThanOrEqual(r.riskBudget + 1e-9)
    expect(r.entrySource).toBe("single_price")
    expect(r.entryZone).toEqual({ low: 10, high: 10 })
  })

  it("a punitive minimum commission on a tiny budget honestly sizes to 0 shares", () => {
    // budget 20; spiral: 20 → cost 2.5 → 5 → cost 10 → 1 → cost 50 → 0 shares (3 iterations)
    const r = ok(
      computePositionSizing({
        capital: 2000,
        riskPct: 0.01,
        direction: "buy",
        entryPrice: 10,
        stop: 9,
        tickSize: 0.01,
        costs: { perSidePct: 0.003, minPerSide: 25 },
      }),
    )
    expect(r.ok).toBe(true)
    expect(r.shares).toBe(0)
    expect(r.riskAmount).toBe(0)
    expect(r.warnings.some((w) => w.includes("الحجم المحسوب صفر"))).toBe(true)
  })
})

describe("liquidity cap", () => {
  it("binds and floors the cap (never rounds shares up)", () => {
    const r = ok(computePositionSizing({ ...buyBase(), avgDailyVolume: 500 }))
    expect(r.shares).toBe(50) // floor(500 × 0.1)
    expect(r.riskAmount).toBe(50)
    expect(r.warnings.some((w) => w.includes("حد السيولة") && w.includes("50"))).toBe(true)
  })

  it("floors a fractional cap: 1234 × 0.1 → 123 shares", () => {
    const r = ok(computePositionSizing({ ...buyBase(), avgDailyVolume: 1234 }))
    expect(r.shares).toBe(123)
  })

  it("honors a custom capPct and warns when ADV is missing", () => {
    const capped = ok(computePositionSizing({ ...buyBase(), avgDailyVolume: 1000, liquidityCapPct: 0.25 }))
    expect(capped.shares).toBe(250)
    const ignored = ok(computePositionSizing({ ...buyBase(), liquidityCapPct: 0.25 }))
    expect(ignored.shares).toBe(1000) // no ADV → no cap applied
    expect(ignored.warnings.some((w) => w.includes("تم تجاهل حد السيولة"))).toBe(true)
  })
})

describe("portfolio total-risk cap", () => {
  it("shrinks the new trade to the remaining allowance, with a warning", () => {
    // riskPct 0.05 → budget 5000 → 5000 shares; allowance = 100k×0.06 − 4000 = 2000 → 2000 shares
    const r = ok(
      computePositionSizing({ ...buyBase(), riskPct: 0.05, currentOpenRiskAmount: 4000, maxTotalPortfolioRiskPct: 0.06 }),
    )
    expect(r.shares).toBe(2000)
    expect(r.riskAmountWithCosts).toBe(2000)
    expect(r.riskAmountWithCosts).toBeLessThanOrEqual(100_000 * 0.06 - 4000 + 1e-9)
    expect(r.warnings.some((w) => w.includes("الحد الأقصى لمخاطرة المحفظة"))).toBe(true)
  })

  it("fits WITH costs when costs are configured (the honest portfolio figure)", () => {
    // budget 1000, risk/share 1.1 → 909; allowance 2000 → floor(2000/1.1) = 1818
    const r = ok(
      computePositionSizing({ ...buyBase(), costsPerShare: 0.1, currentOpenRiskAmount: 4000, maxTotalPortfolioRiskPct: 0.06 }),
    )
    expect(r.shares).toBe(909) // risk-budget binding, portfolio cap not reached
    const r2 = ok(
      computePositionSizing({
        ...buyBase(),
        riskPct: 0.05,
        costsPerShare: 0.1,
        currentOpenRiskAmount: 4000,
        maxTotalPortfolioRiskPct: 0.06,
      }),
    )
    expect(r2.shares).toBe(1818) // floor(2000 / 1.1)
    expect(r2.riskAmountWithCosts).toBeCloseTo(1999.8, 6)
  })

  it("an exhausted portfolio allowance sizes to 0 shares + warning", () => {
    const r = ok(computePositionSizing({ ...buyBase(), currentOpenRiskAmount: 6000, maxTotalPortfolioRiskPct: 0.06 }))
    expect(r.shares).toBe(0)
    expect(r.warnings.some((w) => w.includes("الحد الأقصى لمخاطرة المحفظة"))).toBe(true)
    expect(r.warnings.some((w) => w.includes("الحجم المحسوب صفر"))).toBe(true)
  })

  it("uses the 6% default when maxTotalPortfolioRiskPct is omitted", () => {
    // allowance = 6000 − 5500 = 500 → 500 shares (budget allows 1000)
    const r = ok(computePositionSizing({ ...buyBase(), currentOpenRiskAmount: 5500 }))
    expect(r.shares).toBe(500)
    expect(DEFAULT_MAX_PORTFOLIO_RISK_PCT).toBe(0.06)
  })
})

describe("lot and minimum-position constraints", () => {
  it("rounds shares DOWN to the lot multiple after flooring", () => {
    // 1000 / 1.1 → 909 → lot 100 → 900; risk 900 × 1.1 = 990 ≤ 1000
    const r = ok(computePositionSizing({ ...buyBase(), costsPerShare: 0.1, lotSize: 100 }))
    expect(r.shares).toBe(900)
    expect(r.riskAmountWithCosts).toBeCloseTo(990, 9)
    expect(r.riskAmountWithCosts).toBeLessThanOrEqual(r.riskBudget + 1e-9)
  })

  it("below minShares the result is ZERO shares + warning (no fractional trade)", () => {
    const r = ok(computePositionSizing({ ...buyBase(), minShares: 1500 }))
    expect(r.shares).toBe(0)
    expect(r.warnings.some((w) => w.includes("الحد الأدنى") && w.includes("1500"))).toBe(true)
  })

  it("minShares above the liquidity cap also yields zero", () => {
    const r = ok(computePositionSizing({ ...buyBase(), avgDailyVolume: 500, minShares: 100 }))
    expect(r.shares).toBe(0) // capped to 50 < 100 → no trade
    expect(r.warnings.some((w) => w.includes("الحد الأدنى"))).toBe(true)
    expect(r.warnings.some((w) => w.includes("حد السيولة"))).toBe(true)
  })
})

describe("riskPct clamping and stop sanity", () => {
  it("clamps riskPct into [0.002, 0.05] with a warning", () => {
    const hi = ok(computePositionSizing({ ...buyBase(), riskPct: 0.5 }))
    expect(hi.riskPctUsed).toBe(0.05)
    expect(hi.riskBudget).toBe(5000)
    expect(hi.shares).toBe(5000)
    expect(hi.warnings.some((w) => w.includes("النطاق المسموح"))).toBe(true)
    const lo = ok(computePositionSizing({ ...buyBase(), riskPct: 0.0005 }))
    expect(lo.riskPctUsed).toBe(0.002)
    expect(lo.riskBudget).toBe(200)
    expect(lo.warnings.some((w) => w.includes("النطاق المسموح"))).toBe(true)
  })

  it("flags a stop inside the noise band (1% of entry) but still sizes", () => {
    // entry 10, stop 9.95 → distance 0.05 = 0.5% of entry < 1% → warning, not error
    const r = ok(computePositionSizing({ ...buyBase(), stop: 9.95 }))
    expect(r.warnings.some((w) => w.includes("ستوب قريب جدًا"))).toBe(true)
    expect(r.priceRiskPerShare).toBeCloseTo(0.05, 12)
    // floor(1000 / 0.05) — asserted as the floor-consistency property because
    // 10 − 9.95 carries an IEEE-754 tail that shifts the exact quotient
    expect(r.shares).toBe(Math.floor(1000 / r.priceRiskPerShare))
    expect(r.shares).toBeGreaterThanOrEqual(19999)
    expect(r.riskAmountWithCosts).toBeLessThanOrEqual(r.riskBudget + 1e-9)
  })

  it("flags a stop closer than one tick (defensive clause) or under 1% of entry", () => {
    // entry 10, stop 9.97 with tick 0.05: the tick-rounded distance is 0.05 —
    // the tick clause itself is defensive (side validation + rounding keep the
    // distance ≥ 1 tick), here the 1%-of-entry clause (0.05 < 0.1) fires.
    const r = ok(computePositionSizing({ ...buyBase(), stop: 9.97, tickSize: 0.05 }))
    expect(r.warnings.some((w) => w.includes("ستوب قريب جدًا"))).toBe(true)
  })

  it("normalizes entry and stop onto the tick grid", () => {
    const r = ok(
      computePositionSizing({ ...buyBase(), entry: undefined, entryPrice: 10.004, stop: 8.996 }),
    )
    expect(r.effectiveEntry).toBe(10) // roundToTick(10.004, 0.01)
    expect(r.stop).toBe(9) // roundToTick(8.996, 0.01)
    expect(r.entrySource).toBe("single_price")
  })

  it("defaults: riskPct 1%, and the module never invents costs", () => {
    const { riskPct: _omit, ...noRiskPct } = buyBase()
    const r = ok(computePositionSizing(noRiskPct))
    expect(r.riskPctUsed).toBe(DEFAULT_RISK_PCT)
    expect(r.riskPctUsed).toBe(0.01)
    expect(r.perShareCosts).toBe(0)
    expect(r.warnings.some((w) => w.includes("التكاليف غير مضمنة"))).toBe(true)
  })
})

describe("invalid inputs → ok:false with Arabic error + typed code", () => {
  const wrongDirection = "hold" as unknown as SizingDirection
  const cases: Array<[string, PositionSizingInput, SizingErrorCode]> = [
    ["capital 0", { ...buyBase(), capital: 0 }, "INVALID_CAPITAL"],
    ["capital negative", { ...buyBase(), capital: -100 }, "INVALID_CAPITAL"],
    ["capital NaN", { ...buyBase(), capital: Number.NaN }, "INVALID_CAPITAL"],
    ["riskPct negative", { ...buyBase(), riskPct: -0.01 }, "INVALID_RISK_PCT"],
    ["riskPct NaN", { ...buyBase(), riskPct: Number.NaN }, "INVALID_RISK_PCT"],
    ["direction invalid", { ...buyBase(), direction: wrongDirection }, "INVALID_DIRECTION"],
    ["no entry at all", { ...buyBase(), entry: undefined, entryPrice: undefined }, "MISSING_ENTRY"],
    ["entry zone inverted", { ...buyBase(), entry: { low: 10.5, high: 9.5 } }, "INVALID_ENTRY_ZONE"],
    ["entry zone negative", { ...buyBase(), entry: { low: -1, high: 10 } }, "INVALID_ENTRY_ZONE"],
    ["entryPrice zero", { ...buyBase(), entry: undefined, entryPrice: 0 }, "INVALID_ENTRY_PRICE"],
    ["tickSize zero", { ...buyBase(), tickSize: 0 }, "INVALID_TICK_SIZE"],
    ["tickSize negative", { ...buyBase(), tickSize: -0.01 }, "INVALID_TICK_SIZE"],
    ["stop NaN", { ...buyBase(), stop: Number.NaN }, "INVALID_STOP"],
    ["buy stop above entry", { ...buyBase(), stop: 10.5 }, "STOP_WRONG_SIDE"],
    ["sell stop below entry", { ...sellMirror(), stop: 9 }, "STOP_WRONG_SIDE"],
    ["buy target below entry", { ...buyBase(), target: { low: 8, high: 9.5 } }, "TARGET_WRONG_SIDE"],
    ["sell target above entry", { ...sellMirror(), target: { low: 11, high: 12 } }, "TARGET_WRONG_SIDE"],
    ["target zone inverted", { ...buyBase(), target: { low: 12.5, high: 11.5 } }, "INVALID_TARGET_ZONE"],
    ["costs sources conflict", { ...buyBase(), costsPerShare: 0.1, costs: { perSidePct: 0.003, minPerSide: 0 } }, "COSTS_CONFLICT"],
    ["costsPerShare negative", { ...buyBase(), costsPerShare: -0.1 }, "INVALID_COSTS_PER_SHARE"],
    ["costs perSidePct absurd", { ...buyBase(), costs: { perSidePct: 0.5, minPerSide: 0 } }, "INVALID_COSTS"],
    ["costs minPerSide negative", { ...buyBase(), costs: { perSidePct: 0.003, minPerSide: -1 } }, "INVALID_COSTS"],
    ["ADV negative", { ...buyBase(), avgDailyVolume: -5 }, "INVALID_AVG_DAILY_VOLUME"],
    ["liquidityCapPct > 1", { ...buyBase(), avgDailyVolume: 500, liquidityCapPct: 1.5 }, "INVALID_LIQUIDITY_CAP_PCT"],
    ["currentOpenRisk negative", { ...buyBase(), currentOpenRiskAmount: -1 }, "INVALID_CURRENT_OPEN_RISK"],
    ["portfolio riskPct > 1", { ...buyBase(), maxTotalPortfolioRiskPct: 2 }, "INVALID_MAX_PORTFOLIO_RISK_PCT"],
    ["minShares negative", { ...buyBase(), minShares: -3 }, "INVALID_MIN_SHARES"],
    ["lotSize zero", { ...buyBase(), lotSize: 0 }, "INVALID_LOT_SIZE"],
    ["lotSize fractional", { ...buyBase(), lotSize: 33.5 }, "INVALID_LOT_SIZE"],
  ]

  for (const [label, input, code] of cases) {
    it(`${label} → ${code}`, () => {
      const r = computePositionSizing(input)
      expect(r.ok).toBe(false)
      if (r.ok) return // narrow for tsc
      expect(r.code).toBe(code)
      expect(r.errorAr.length).toBeGreaterThan(10)
      expect(hasArabic(r.errorAr)).toBe(true)
    })
  }
})

describe("output hygiene and determinism", () => {
  it("no NaN/Infinity in any numeric output field", () => {
    const variants: PositionSizingInput[] = [
      buyBase(),
      sellMirror(),
      { ...buyBase(), costsPerShare: 0.1, avgDailyVolume: 500, minShares: 100 },
      { ...buyBase(), costs: { perSidePct: 0.003, minPerSide: 25 }, capital: 2000 },
      { ...buyBase(), currentOpenRiskAmount: 6000 },
      { ...buyBase(), target: undefined }, // null R-multiples path
    ]
    for (const v of variants) {
      const r = ok(computePositionSizing(v))
      const nums: number[] = [
        r.shares, r.effectiveEntry, r.stop, r.riskPctUsed, r.riskBudget,
        r.priceRiskPerShare, r.perShareCosts, r.riskPerShare, r.riskAmount,
        r.riskAmountWithCosts, r.positionValue, r.breakEven,
        ...r.entryZone ? [r.entryZone.low, r.entryZone.high] : [],
      ]
      for (const n of nums) {
        expect(Number.isFinite(n)).toBe(true)
        expect(Number.isNaN(n)).toBe(false)
      }
      for (const n of [r.targetMid, r.rTargetLow, r.rTargetMid, r.rTargetHigh]) {
        if (n !== null) {
          expect(Number.isFinite(n)).toBe(true)
          expect(Number.isNaN(n)).toBe(false)
        } else {
          expect(v.target).toBeUndefined() // null only where no target was given
        }
      }
    }
  })

  it("pure and deterministic: same input → deep-equal result", () => {
    const a = computePositionSizing({ ...buyBase(), costs: { perSidePct: 0.003, minPerSide: 0 }, avgDailyVolume: 4000 })
    const b = computePositionSizing({ ...buyBase(), costs: { perSidePct: 0.003, minPerSide: 0 }, avgDailyVolume: 4000 })
    expect(a).toEqual(b)
  })

  it("the risk budget is never rounded up through, across parameter sweeps", () => {
    for (const capital of [500, 10_000, 100_000, 1_000_000]) {
      for (const riskPct of [0.002, 0.01, 0.05]) {
        for (const stopDist of [0.25, 1, 3.33]) {
          const r = ok(
            computePositionSizing({
              capital,
              riskPct,
              direction: "buy",
              entryPrice: 50,
              stop: 50 - stopDist,
              tickSize: 0.01,
              costsPerShare: 0.07,
            }),
          )
          expect(r.riskAmountWithCosts).toBeLessThanOrEqual(r.riskBudget + 1e-6)
          expect(Number.isInteger(r.shares)).toBe(true)
          expect(r.shares).toBeGreaterThanOrEqual(0)
        }
      }
    }
  })

  it("entry zone precedence: a zone wins over entryPrice when both are passed", () => {
    const r = ok(computePositionSizing({ ...buyBase(), entryPrice: 99 }))
    expect(r.entrySource).toBe("zone_mid")
    expect(r.effectiveEntry).toBe(10)
  })
})
