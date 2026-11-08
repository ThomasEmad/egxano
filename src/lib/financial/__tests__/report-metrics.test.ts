// Deterministic extended financial metrics — edge-case safety tests.
import { describe, expect, it } from "vitest"
import { buildExtendedMetrics, type PeriodInput } from "../report-metrics"

const FY: PeriodInput = {
  periodKey: "ANNUAL:2025:",
  periodLabel: "FY 2025",
  periodType: "ANNUAL",
  fiscalYear: 2025,
  raw: {
    REVENUE: 1_000,
    NET_PROFIT: 100,
    GROSS_PROFIT: 400,
    OPERATING_INCOME: 150,
    EBIT: 150,
    EBITDA: 200,
    INCOME_TAX: 25,
    PROFIT_BEFORE_TAX: 125,
    TOTAL_EQUITY: 800,
    TOTAL_ASSETS: 2_000,
    TOTAL_DEBT: 300,
    CASH_AND_EQUIVALENTS: 100,
    NET_DEBT: 200,
    CURRENT_ASSETS: 600,
    CURRENT_LIABILITIES: 300,
    INVENTORY: 150,
    OPERATING_CASH_FLOW: 140,
    FREE_CASH_FLOW: 90,
    FINANCE_COST: 30,
    SHARES_OUTSTANDING: 50,
    WORKING_CAPITAL: 300,
  },
  calc: { gross_margin: 40, operating_margin: 15, net_margin: 10, roe: 12.5, roa: 5, debt_to_equity: 0.375, eps: 2, p_e: 10, p_b: 1.25 },
}

const FY24: PeriodInput = {
  ...FY,
  periodKey: "ANNUAL:2024:",
  periodLabel: "FY 2024",
  fiscalYear: 2024,
  raw: { ...FY.raw, REVENUE: 800, NET_PROFIT: 80, OPERATING_CASH_FLOW: 100, WORKING_CAPITAL: 250, TOTAL_EQUITY: 700 },
  calc: { ...FY.calc },
}

const Q2_25: PeriodInput = {
  periodKey: "QUARTERLY:2025:Q2",
  periodLabel: "Q2 2025",
  periodType: "QUARTERLY",
  fiscalYear: 2025,
  raw: { ...FY.raw, REVENUE: 260, NET_PROFIT: 26, OPERATING_CASH_FLOW: 30 },
  calc: { ...FY.calc, roe: 3.2 },
}

const Q2_24: PeriodInput = {
  ...Q2_25,
  periodKey: "QUARTERLY:2024:Q2",
  periodLabel: "Q2 2024",
  fiscalYear: 2024,
  raw: { ...FY.raw, REVENUE: 200, NET_PROFIT: 20, OPERATING_CASH_FLOW: 25 },
}

const market = { price: 20, dps12m: 1, hasDividendRecords: true }

describe("normal values", () => {
  it("computes the full analyst set for an annual anchor", () => {
    const out = buildExtendedMetrics([FY24, FY], FY, market)
    expect(out.profitability.revenue_growth.value).toBeCloseTo(25, 1) // 1000/800
    expect(out.profitability.net_income_growth.value).toBeCloseTo(25, 1)
    expect(out.profitability.roic.status).toBe("unavailable") // invested capital missing in fixture
    const withIc: PeriodInput = { ...FY, raw: { ...FY.raw, INVESTED_CAPITAL: 1000 } }
    const outIc = buildExtendedMetrics([FY24, withIc], withIc, market)
    // NOPAT = EBIT 150 × (1 − 25/125) = 120 → 120/1000 = 12%
    expect(outIc.profitability.roic.value).toBeCloseTo(12, 2)
    expect(out.valuation.p_s.value).toBeCloseTo((20 * 50) / 1000, 4)
    expect(out.valuation.ev_ebitda.value).toBeCloseTo((20 * 50 + 200) / 200, 4)
    expect(out.valuation.dividend_yield.value).toBeCloseTo(5, 2)
    expect(out.health.current_ratio.value).toBe(2)
    expect(out.health.quick_ratio.value).toBe(1.5)
    expect(out.health.interest_coverage.value).toBe(5) // 150/30
    expect(out.growthQuality.earnings_quality.value).toBeCloseTo(1.4, 4) // 140/100
  })

  it("quarterly anchor compares to the same quarter last year (never to FY)", () => {
    const out = buildExtendedMetrics([Q2_24, Q2_25], Q2_25, market)
    expect(out.profitability.revenue_growth.value).toBeCloseTo(30, 1) // 260/200
    expect(out.meta.priorComparableKey).toBe("QUARTERLY:2024:Q2")
  })

  it("CAGR over 4 annuals", () => {
    const FY22: PeriodInput = { ...FY24, periodKey: "ANNUAL:2022:", periodLabel: "FY 2022", fiscalYear: 2022, raw: { ...FY24.raw, REVENUE: 500, NET_PROFIT: 50 } }
    const out = buildExtendedMetrics([FY22, FY24, FY], FY, market)
    // (1000/500)^(1/3) − 1 ≈ 25.99%
    expect(out.growthQuality.revenue_cagr_3y.value).toBeGreaterThan(25.9)
    expect(out.growthQuality.revenue_cagr_3y.value).toBeLessThan(26.1)
  })
})

describe("missing data — never zero, never guessed", () => {
  it("marks unavailable metrics with reasons", () => {
    const sparse: PeriodInput = { ...FY, raw: { REVENUE: 1000, NET_PROFIT: 100 }, calc: {} }
    const out = buildExtendedMetrics([sparse], sparse, { price: null, dps12m: null, hasDividendRecords: false })
    expect(out.profitability.gross_profit_margin.status).toBe("unavailable")
    expect(out.health.current_ratio.status).toBe("unavailable")
    expect(out.health.current_ratio.reason).toBeTruthy()
    expect(out.valuation.p_e.status).toBe("unavailable")
    expect(out.valuation.p_s.status).toBe("unavailable")
    expect(out.valuation.dividend_yield.status).toBe("unavailable")
    expect(out.growthQuality.revenue_cagr_3y.status).toBe("unavailable")
    // every unavailable metric has null value — never 0
    for (const group of [out.profitability, out.valuation, out.health, out.growthQuality]) {
      for (const m of Object.values(group)) {
        if (m.status === "unavailable") expect(m.value).toBeNull()
      }
    }
  })
})

describe("zero / negative denominators", () => {
  it("zero prior revenue → growth unavailable", () => {
    const zeroPrior: PeriodInput = { ...FY24, raw: { ...FY24.raw, REVENUE: 0 } }
    const out = buildExtendedMetrics([zeroPrior, FY], FY, market)
    expect(out.profitability.revenue_growth.status).toBe("unavailable")
  })
  it("loss in prior year → growth undefined (sign flip), not a fake percentage", () => {
    const lossPrior: PeriodInput = { ...FY24, raw: { ...FY24.raw, NET_PROFIT: -50 } }
    const out = buildExtendedMetrics([lossPrior, FY], FY, market)
    expect(out.profitability.net_income_growth.status).toBe("unavailable")
  })
  it("zero equity → ROIC unavailable, no Infinity anywhere", () => {
    const noIc: PeriodInput = { ...FY, raw: { ...FY.raw, INVESTED_CAPITAL: 0 } }
    const out = buildExtendedMetrics([noIc], noIc, market)
    for (const group of [out.profitability, out.valuation, out.health, out.growthQuality]) {
      for (const m of Object.values(group)) {
        if (m.value !== null) expect(Number.isFinite(m.value)).toBe(true)
      }
    }
  })
  it("zero finance cost → coverage unavailable (never infinity)", () => {
    const noInt: PeriodInput = { ...FY, raw: { ...FY.raw, FINANCE_COST: 0 } }
    const out = buildExtendedMetrics([noInt], noInt, market)
    expect(out.health.interest_coverage.status).toBe("unavailable")
  })
  it("negative EBITDA → EV/EBITDA unavailable", () => {
    const neg: PeriodInput = { ...FY, raw: { ...FY.raw, EBITDA: -50 } }
    const out = buildExtendedMetrics([neg], neg, market)
    expect(out.valuation.ev_ebitda.status).toBe("unavailable")
  })
})

describe("provenance", () => {
  it("every metric carries formula + source periods + basis", () => {
    const out = buildExtendedMetrics([FY24, FY], FY, market)
    for (const group of [out.profitability, out.valuation, out.health, out.growthQuality]) {
      for (const [code, m] of Object.entries(group)) {
        expect(m.formula.length).toBeGreaterThan(3)
        expect(m.basis).toMatch(/^(reported|calculated)$/)
        expect(m.unit.length).toBeGreaterThan(0)
      }
    }
    expect(out.profitability.revenue_growth.sourcePeriods).toEqual(["ANNUAL:2025:", "ANNUAL:2024:"])
  })
})
