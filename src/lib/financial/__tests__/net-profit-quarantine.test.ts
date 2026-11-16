// quarantineImpossibleNetProfits — a NET_PROFIT above its own GROSS_PROFIT is
// physically impossible (owner report 2026-11-16: gross-profit values surfaced
// as صافي الربح in the peers comparison). The bucket value must be removed so
// niOf falls back to NET_PROFIT_PARENT, and the hit must be reported.
import { describe, expect, it } from "vitest"
import { quarantineImpossibleNetProfits, type PeriodBucket } from "../recompute"

function bucket(over: Partial<PeriodBucket>): PeriodBucket {
  return {
    statementType: "CONSOLIDATED",
    periodKey: "2025|ANNUAL",
    periodType: "ANNUAL",
    fiscalYear: 2025,
    periodLabel: "FY2025",
    values: {},
    sourcePeriodKeys: ["2025|ANNUAL"],
    version: 1,
    ...over,
  }
}

describe("quarantineImpossibleNetProfits", () => {
  it("removes NET_PROFIT when it exceeds GROSS_PROFIT beyond tolerance", () => {
    const b = bucket({ values: { GROSS_PROFIT: 100, NET_PROFIT: 150, REVENUE: 500, NET_PROFIT_PARENT: 40 } })
    const hits = quarantineImpossibleNetProfits([b])
    expect(hits).toHaveLength(1)
    expect(hits[0]).toMatchObject({ periodKey: "2025|ANNUAL", net: 150, gross: 100 })
    expect(b.values["NET_PROFIT"]).toBeUndefined()
    expect(b.values["GROSS_PROFIT"]).toBe(100) // untouched
  })

  it("keeps legitimate net profit below gross profit", () => {
    const b = bucket({ values: { GROSS_PROFIT: 100, NET_PROFIT: 60 } })
    expect(quarantineImpossibleNetProfits([b])).toHaveLength(0)
    expect(b.values["NET_PROFIT"]).toBe(60)
  })

  it("keeps net profit within the 5% rounding tolerance", () => {
    const b = bucket({ values: { GROSS_PROFIT: 100, NET_PROFIT: 103 } })
    expect(quarantineImpossibleNetProfits([b])).toHaveLength(0)
  })

  it("never fires without a positive GROSS_PROFIT in the same bucket (banks)", () => {
    const noGross = bucket({ values: { NET_PROFIT: 900 } })
    const zeroGross = bucket({ values: { NET_PROFIT: 900, GROSS_PROFIT: 0 } })
    const negatives = bucket({ values: { NET_PROFIT: -50, GROSS_PROFIT: 20 } })
    expect(quarantineImpossibleNetProfits([noGross, zeroGross, negatives])).toHaveLength(0)
  })

  it("also quarantines synthetic TTM buckets (metrics protected, no row to flag)", () => {
    const ttm = bucket({ values: { GROSS_PROFIT: 100, NET_PROFIT: 400 }, periodType: "TTM", periodKey: "2025|TTM" })
    const hits = quarantineImpossibleNetProfits([ttm])
    expect(hits).toHaveLength(1)
    expect(hits[0].periodType).toBe("TTM")
    expect(ttm.values["NET_PROFIT"]).toBeUndefined()
  })
})
