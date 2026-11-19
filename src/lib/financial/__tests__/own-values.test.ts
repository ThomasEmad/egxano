import { describe, expect, it } from "vitest"
import { selectOwnValues } from "@/lib/financial/own-values"

const row = (metricCode: string, normalizedValue: number, subPeriod: string | null) => ({ metricCode, normalizedValue, subPeriod })

// The recompute engine's CURRENT-vs-comparative selection rule, extracted so
// the read-path maps (analytics gather, undervalued screen) apply it too.
describe("selectOwnValues", () => {
  it("CURRENT wins over any comparative column (order-independent)", () => {
    const chosen = selectOwnValues({
      periodType: "ANNUAL",
      periodLabel: "FY 2024",
      values: [row("REVENUE", 7, "Q3"), row("REVENUE", 99, "CURRENT")],
    })
    expect(chosen).toHaveLength(1)
    expect(chosen[0].normalizedValue).toBe(99)
    // and the same rows in the other order pick the same value
    const flipped = selectOwnValues({
      periodType: "ANNUAL",
      periodLabel: "FY 2024",
      values: [row("REVENUE", 99, "CURRENT"), row("REVENUE", 7, "Q3")],
    })
    expect(flipped[0].normalizedValue).toBe(99)
  })

  it("a quarterly report accepts the sub-period matching its label", () => {
    const chosen = selectOwnValues({
      periodType: "QUARTERLY",
      periodLabel: "Q2 2025",
      values: [row("NET_PROFIT", 5, "Q1"), row("NET_PROFIT", 8, "Q2")],
    })
    expect(chosen[0].normalizedValue).toBe(8)
  })

  it("accepts a single unambiguous value even without CURRENT", () => {
    const chosen = selectOwnValues({
      periodType: "ANNUAL",
      periodLabel: "FY 2024",
      values: [row("TOTAL_ASSETS", 42, null)],
    })
    expect(chosen[0].normalizedValue).toBe(42)
  })

  it("skips ambiguous multi-column rows with no CURRENT and no matching sub-period", () => {
    const chosen = selectOwnValues({
      periodType: "ANNUAL",
      periodLabel: "FY 2024",
      values: [row("REVENUE", 1, "Q1"), row("REVENUE", 2, "Q2")],
    })
    expect(chosen).toHaveLength(0)
  })

  it("an annual report never accepts a bare quarterly column when a CURRENT exists", () => {
    const chosen = selectOwnValues({
      periodType: "ANNUAL",
      periodLabel: "FY 2025",
      values: [row("DIVIDEND_PER_SHARE", 2, "CURRENT"), row("DIVIDEND_PER_SHARE", 98, "Q3")],
    })
    expect(chosen).toHaveLength(1)
    expect(chosen[0].normalizedValue).toBe(2)
  })

  it("resolves each metric independently", () => {
    const chosen = selectOwnValues({
      periodType: "QUARTERLY",
      periodLabel: "Q3 2025",
      values: [
        row("REVENUE", 100, "CURRENT"),
        row("NET_PROFIT", 4, "Q2"),
        row("NET_PROFIT", 6, "Q3"),
        row("EBIT", 9, null),
      ],
    })
    const byCode = new Map(chosen.map((c) => [c.metricCode, c.normalizedValue]))
    expect(byCode.get("REVENUE")).toBe(100)
    expect(byCode.get("NET_PROFIT")).toBe(6)
    expect(byCode.get("EBIT")).toBe(9)
  })
})
