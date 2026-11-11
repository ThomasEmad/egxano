// Regression test — rebrand audit (2026-11-11):
// P/E rankings previously defaulted to DESC, putting the MOST EXPENSIVE
// company at rank #1 of a list users read as a quality ranking. Valuation
// multiples and leverage must rank from cheapest / least-leveraged first.
import { describe, expect, it } from "vitest"
import { RANKING_LOWER_IS_BETTER, defaultRankingOrder } from "../registry"

describe("rankings default order", () => {
  it("ranks valuation multiples and leverage from cheapest (ASC)", () => {
    expect(defaultRankingOrder("p_e")).toBe("ASC")
    expect(defaultRankingOrder("p_b")).toBe("ASC")
    expect(defaultRankingOrder("liabilities_to_equity")).toBe("ASC")
  })

  it("ranks returns, margins and size from strongest (DESC)", () => {
    for (const m of ["roe", "roa", "net_margin", "market_cap", "revenue", "net_profit"]) {
      expect(defaultRankingOrder(m)).toBe("DESC")
    }
  })

  it("defines the lower-is-better family explicitly (no accidental members)", () => {
    expect([...RANKING_LOWER_IS_BETTER].sort()).toEqual(["liabilities_to_equity", "p_b", "p_e"])
  })
})
