// Piotroski F-Score unit tests — pure evaluation contract (piotroski@1):
//   * perfect / failing fixtures produce 9/9 and 0/9
//   * missing inputs → NOT_EVALUABLE and they never count toward the score
//   * fallbacks and tolerance rules are labeled notes, never silent
import { describe, expect, it } from "vitest"
import { evaluatePiotroski, type PeriodValues } from "../piotroski"

const base: PeriodValues = {
  REVENUE: 1000,
  GROSS_PROFIT: 300,
  NET_PROFIT: 100,
  TOTAL_ASSETS: 1000,
  TOTAL_LIABILITIES: 400,
  LONG_TERM_DEBT: 200,
  CURRENT_ASSETS: 500,
  CURRENT_LIABILITIES: 250,
  OPERATING_CASH_FLOW: 140,
  SHARES_OUTSTANDING: 100,
}

describe("evaluatePiotroski — perfect improvement fixture", () => {
  const current: PeriodValues = {
    ...base,
    NET_PROFIT: 120, // ROA up (120/1000 > 100/1000)
    OPERATING_CASH_FLOW: 150, // > profit (accruals pass)
    LONG_TERM_DEBT: 150, // leverage down (150/1000 < 200/1000)
    CURRENT_ASSETS: 560, // current ratio up (560/250 > 500/250)
    SHARES_OUTSTANDING: 100, // flat
    GROSS_PROFIT: 360, // margin up (360/1100 > 300/1000)
    REVENUE: 1100, // turnover up (1100/1000 > 1000/1000)
  }
  const r = evaluatePiotroski(current, base)

  it("scores 9/9 with all criteria evaluated", () => {
    expect(r.score).toBe(9)
    expect(r.evaluated).toBe(9)
    expect(r.criteria.every((c) => c.status === "PASS")).toBe(true)
  })

  it("carries evidence inputs on every criterion", () => {
    const roa = r.criteria.find((c) => c.id === "roa_positive")
    expect(roa?.inputs.some((i) => i.code === "NET_PROFIT" && i.value === 120)).toBe(true)
    expect(roa?.inputs.some((i) => i.code === "TOTAL_ASSETS" && i.period === "current")).toBe(true)
  })
})

describe("evaluatePiotroski — deterioration fixture", () => {
  const current: PeriodValues = {
    ...base,
    NET_PROFIT: -100, // ROA negative → c1 FAIL; ΔROA down → c3 FAIL
    OPERATING_CASH_FLOW: -150, // OCF negative → c2 FAIL; below profit → c4 FAIL
    LONG_TERM_DEBT: 400, // leverage up
    CURRENT_ASSETS: 400, // current ratio down
    SHARES_OUTSTANDING: 130, // +30% dilution
    GROSS_PROFIT: 200, // margin down
    REVENUE: 900, // turnover down
  }
  const r = evaluatePiotroski(current, base)
  it("scores 0/9", () => {
    expect(r.score).toBe(0)
    expect(r.evaluated).toBe(9)
    expect(r.criteria.every((c) => c.status === "FAIL")).toBe(true)
  })
})

describe("evaluatePiotroski — missing inputs are NOT_EVALUABLE, never guessed", () => {
  it("missing OCF disables criteria 2 and 4 only", () => {
    const current: PeriodValues = { ...base, OPERATING_CASH_FLOW: undefined as unknown as number }
    delete (current as Record<string, unknown>).OPERATING_CASH_FLOW
    const r = evaluatePiotroski(current, base)
    expect(r.criteria.find((c) => c.id === "ocf_positive")?.status).toBe("NOT_EVALUABLE")
    expect(r.criteria.find((c) => c.id === "ocf_above_profit")?.status).toBe("NOT_EVALUABLE")
    expect(r.evaluated).toBe(7)
    expect(r.score).toBeLessThanOrEqual(7)
    expect(r.warningsEn.some((w) => w.includes("could not be evaluated"))).toBe(true)
  })

  it("zero total assets never divides — ROA criteria become NOT_EVALUABLE", () => {
    const r = evaluatePiotroski({ ...base, TOTAL_ASSETS: 0 }, { ...base, TOTAL_ASSETS: 0 })
    expect(r.criteria.find((c) => c.id === "roa_positive")?.status).toBe("NOT_EVALUABLE")
    expect(r.criteria.find((c) => c.id === "roa_improving")?.status).toBe("NOT_EVALUABLE")
    expect(r.criteria.find((c) => c.id === "asset_turnover_up")?.status).toBe("NOT_EVALUABLE")
  })
})

describe("evaluatePiotroski — labeled fallbacks and tolerances", () => {
  it("falls back to TOTAL_LIABILITIES when long-term debt is absent, with a disclosed note", () => {
    const current: PeriodValues = { ...base, LONG_TERM_DEBT: undefined as unknown as number, TOTAL_LIABILITIES: 380 }
    delete (current as Record<string, unknown>).LONG_TERM_DEBT
    const previous: PeriodValues = { ...base }
    delete (previous as Record<string, unknown>).LONG_TERM_DEBT
    const r = evaluatePiotroski(current, previous)
    const lev = r.criteria.find((c) => c.id === "leverage_down")
    expect(lev?.status).toBe("PASS") // 380 < 400
    expect(lev?.noteEn).toContain("total liabilities")
    expect(lev?.inputs.some((i) => i.code === "TOTAL_LIABILITIES" && i.value === 380)).toBe(true)
  })

  it("treats sub-1% dilution as unchanged (PASS with note)", () => {
    const r = evaluatePiotroski({ ...base, SHARES_OUTSTANDING: 100.9 }, base)
    const dil = r.criteria.find((c) => c.id === "no_dilution")
    expect(dil?.status).toBe("PASS")
    expect(dil?.noteEn).toContain("under 1%")
  })

  it("marks ≥1% dilution as FAIL", () => {
    const r = evaluatePiotroski({ ...base, SHARES_OUTSTANDING: 103 }, base)
    expect(r.criteria.find((c) => c.id === "no_dilution")?.status).toBe("FAIL")
  })
})
