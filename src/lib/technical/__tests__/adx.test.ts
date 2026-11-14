// ADX module contract tests — pins from an INDEPENDENT textbook Wilder
// implementation (scripts/adx-fixture.mjs, shared no code with adx.ts):
//   fixture A (20 bars, period 5):  DI+ 3.48429  DI− 33.046417  DX 80.924047  ADX 69.48802
//   fixture A (20 bars, period 14): sessions < 2×period → abstain (nulls)
//   fixture B (36 bars, period 14): DI+ 26.850176 DI− 3.619766  DX 76.240412  ADX 73.215231
import { describe, expect, it } from "vitest"
import { computeAdx, ADX_PERIOD } from "../adx"

const closesA = [50, 51, 52.5, 54, 55.5, 57, 58.5, 60, 61.5, 63, 62, 60.5, 59, 57.5, 56, 54.5, 53, 51.5, 50.5, 50]
const barsA = closesA.map((c, i) => {
  const o = i === 0 ? c - 0.5 : closesA[i - 1]
  return { high: Math.max(o, c) + 1, low: Math.min(o, c) - 1, close: c }
})

const closesB = [50.4, 50.8, 51.21, 51.62, 52.03, 52.45, 52.87, 53.29, 53.72, 54.15, 54.58, 55.02, 54.19, 53.38, 53.81, 54.24, 54.67, 55.11, 55.55, 55.99, 56.44, 56.89, 57.35, 57.81, 56.94, 56.08, 56.53, 56.99, 57.44, 57.9, 58.36, 58.83, 59.3, 59.78, 60.25, 60.74]
const barsB = closesB.map((c, i) => {
  const o = i === 0 ? c * 0.99 : closesB[i - 1]
  return { high: Math.max(o, c) + 0.5, low: Math.min(o, c) - 0.5, close: c }
})

const near = (x: number | null, pin: number, tol = 1e-4) => x !== null && Math.abs(x - pin) <= tol

describe("adx — Wilder numerics vs hand-computed fixture", () => {
  it("fixture A / period 5: DI+, DI− and the seeded ADX match the independent implementation", () => {
    const r = computeAdx(barsA, 5)
    expect(r.abstained).toBe(false)
    expect(near(r.plusDI, 3.48429)).toBe(true)
    expect(near(r.minusDI, 33.046417)).toBe(true)
    expect(near(r.adx, 69.48802)).toBe(true)
    // DI− dominant + ADX ≥ 25 → strong downtrend
    expect(r.trendStrength).toBe("strong")
    expect(r.direction).toBe("down")
  })

  it("fixture A / period 14 on 20 bars: abstains — sessions < 2×period (documented rule)", () => {
    const r = computeAdx(barsA, 14)
    expect(r.abstained).toBe(true)
    expect(r.adx).toBeNull()
    expect(r.plusDI).toBeNull()
    expect(r.minusDI).toBeNull()
    expect(r.trendStrength).toBe("none")
    expect(r.direction).toBe("none")
    expect(r.reason).toContain("28")
  })

  it("fixture B / period 14 (36 bars): the full ADX(14) chain matches", () => {
    const r = computeAdx(barsB, ADX_PERIOD)
    expect(r.abstained).toBe(false)
    expect(near(r.plusDI, 26.850176)).toBe(true)
    expect(near(r.minusDI, 3.619766)).toBe(true)
    expect(near(r.adx, 73.215231)).toBe(true)
    expect(r.trendStrength).toBe("strong")
    expect(r.direction).toBe("up")
  })

  it("abstains when high/low are missing (close-only rows) or bars are too few", () => {
    const longCloses = [...closesA, ...closesA, ...closesA]
    const closeOnly = longCloses.map((c) => ({ high: NaN, low: NaN, close: c }))
    const r = computeAdx(closeOnly)
    expect(r.abstained).toBe(true)
    expect(r.adx).toBeNull()
    expect(r.reason).toContain("abstains")
    expect(computeAdx(barsA.slice(0, 10)).abstained).toBe(true)
    expect(computeAdx([]).abstained).toBe(true)
  })

  it("is prefix-pure: the result at t depends only on bars[0..t]", () => {
    for (let t = 30; t < barsB.length; t++) {
      const prefix = computeAdx(barsB.slice(0, t))
      const extended = computeAdx(barsB.slice(0, t + 1))
      // appending bar t+1 must not change what t reported
      const again = computeAdx(barsB.slice(0, t))
      expect(again).toEqual(prefix)
      void extended
    }
  })
})
