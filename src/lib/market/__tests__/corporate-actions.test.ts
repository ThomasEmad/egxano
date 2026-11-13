// Corporate-action ex-date adjustment — the CANA regression case.
// 2026-11-12: Suez Canal Bank (CANA) issued 0.5 bonus shares per share;
// TradingView's scanner showed −31.9% while the market's real move was ≈ +2%.
import { describe, expect, it } from "vitest"
import {
  adjustPrevClose,
  adjustedChangePct,
  actionOnSession,
  perShareRatio,
  scannerChangeSessions,
  type CorporateActionTerms,
} from "@/lib/market/corporate-actions"
import { buildSnapshotFromScanner, type ScanRow } from "@/lib/market/refresh"

const bonusHalf: CorporateActionTerms = {
  actionType: "stock_dividend",
  ratioNumerator: BigInt(5_000_000_000),
  ratioDenominator: BigInt(10_000_000_000),
  cashPerShare: null,
  subscriptionPrice: null,
}

describe("perShareRatio", () => {
  it("reads the CANA ratio (0.5) from the huge numerator/denominator pair", () => {
    expect(perShareRatio(bonusHalf)).toBeCloseTo(0.5, 12)
  })
  it("returns null for incomplete pairs", () => {
    expect(perShareRatio({ ratioNumerator: null, ratioDenominator: BigInt(10) })).toBeNull()
    expect(perShareRatio({ ratioNumerator: BigInt(1), ratioDenominator: BigInt(0) })).toBeNull()
  })
})

describe("adjustPrevClose", () => {
  it("CANA case: 51.02 prev with 0.5 bonus adjusts to ~34.01 — no fake crash", () => {
    const adj = adjustPrevClose(51.02, [bonusHalf])
    expect(adj).toBeCloseTo(51.02 / 1.5, 6)
    const real = adjustedChangePct(34.74, -31.909055272442178, [bonusHalf])
    expect(real).toBeGreaterThan(-1)
    expect(real).toBeLessThan(5)
  })

  it("1:1 bonus (raw −50%) survives the plausibility cap as ≈0%", () => {
    const oneToOne: CorporateActionTerms = { ...bonusHalf, ratioNumerator: BigInt(1), ratioDenominator: BigInt(1) }
    expect(adjustedChangePct(10, -50, [oneToOne])).toBeCloseTo(0, 6)
  })

  it("split s:1 divides the base by s", () => {
    const split: CorporateActionTerms = { ...bonusHalf, actionType: "split", ratioNumerator: BigInt(4), ratioDenominator: BigInt(1) }
    expect(adjustPrevClose(100, [split])).toBeCloseTo(25, 9)
  })

  it("cash dividend subtracts the amount", () => {
    const cash: CorporateActionTerms = { actionType: "cash_dividend", ratioNumerator: null, ratioDenominator: null, cashPerShare: 1.5, subscriptionPrice: null }
    expect(adjustPrevClose(20, [cash])).toBeCloseTo(18.5, 9)
  })

  it("rights issue uses the TERP formula", () => {
    const rights: CorporateActionTerms = { actionType: "rights", ratioNumerator: BigInt(1), ratioDenominator: BigInt(3), cashPerShare: null, subscriptionPrice: 10 }
    // prev 40, 1-for-3 at 10 → (40 + 10/3) / (4/3) = 32.5
    expect(adjustPrevClose(40, [rights])).toBeCloseTo(32.5, 9)
  })

  it("composes bonus + cash on the same ex-date", () => {
    const cash: CorporateActionTerms = { actionType: "cash_dividend", ratioNumerator: null, ratioDenominator: null, cashPerShare: 1, subscriptionPrice: null }
    // 51 → bonus 0.5 → 34 → cash −1 → 33
    expect(adjustPrevClose(51, [bonusHalf, cash])).toBeCloseTo(33, 9)
  })

  it("never divides into a negative and returns the input for unknown types", () => {
    const other: CorporateActionTerms = { actionType: "other", ratioNumerator: null, ratioDenominator: null, cashPerShare: null, subscriptionPrice: null }
    expect(adjustPrevClose(51, [other])).toBe(51)
    const hugeCash: CorporateActionTerms = { ...bonusHalf, actionType: "cash_dividend", ratioNumerator: null, ratioDenominator: null, cashPerShare: 100 }
    expect(adjustPrevClose(20, [hugeCash])).toBe(20) // cash > price — refuse to go negative
  })

  it("no actions → change passes through untouched", () => {
    expect(adjustedChangePct(34.74, -31.9, undefined)).toBe(-31.9)
    expect(adjustedChangePct(34.74, -31.9, [])).toBe(-31.9)
  })
})

describe("scannerChangeSessions", () => {
  it("Friday reports Thursday's session (weekend-aware)", () => {
    // 2026-11-13 is a Friday. The scanner still prices Thu 2026-11-12 vs Wed 2026-11-11.
    const { latest, previous } = scannerChangeSessions(new Date("2026-11-13T10:00:00Z"))
    expect(latest).toBe("2026-11-12")
    expect(previous).toBe("2026-11-11")
  })

  it("pre-open on a trading day still reports the previous session", () => {
    // Thursday 2026-11-12 06:00 Cairo (04:00 UTC) — before the 09:45 open.
    const { latest } = scannerChangeSessions(new Date("2026-11-12T04:00:00Z"))
    expect(latest).toBe("2026-11-11")
  })

  it("Sunday opens a fresh session (Fri/Sat are the weekend)", () => {
    // Sunday 2026-11-15 12:00 UTC (14:00 Cairo, in-session) → session = Sunday.
    const { latest, previous } = scannerChangeSessions(new Date("2026-11-15T12:00:00Z"))
    expect(latest).toBe("2026-11-15")
    expect(previous).toBe("2026-11-12") // the Thursday before the weekend
  })
})

describe("actionOnSession", () => {
  it("matches the ex-date to the session day (UTC-date equality)", () => {
    const ex = new Date("2026-11-12T00:00:00.000Z")
    expect(actionOnSession({ exDate: ex }, "2026-11-12")).toBe(true)
    expect(actionOnSession({ exDate: ex }, "2026-11-11")).toBe(false)
    expect(actionOnSession({ exDate: ex }, "2026-11-13")).toBe(false)
  })
})

describe("buildSnapshotFromScanner — ex-date handling end to end", () => {
  const canaRow: ScanRow = { s: "EGX:CANA", d: ["CANA", "Suez Canal Bank SAE", 34.74, 53.20493579292055, 739024, "delayed_streaming_900", 51020024786, 1500000000] }

  it("uses Yahoo's adjusted prev close (34.01) — TV's +53.2% double-adjusted change is overridden", () => {
    const actions = new Map([["CANA", [bonusHalf]]])
    const prevs = new Map([["CANA", 34.01333236694336]])
    const { movers } = buildSnapshotFromScanner([canaRow], [], "2026-11-13T03:00:00Z", actions, prevs)
    expect(movers).toHaveLength(1)
    expect(movers[0].changePct).toBeGreaterThan(1.5)
    expect(movers[0].changePct).toBeLessThan(3)
  })

  it("fallback: scanner −31.9% unadjusted with our action terms → ≈+2%", () => {
    const raw: ScanRow = { s: "EGX:CANA", d: ["CANA", "Suez Canal Bank SAE", 34.74, -31.909055272442178, 739024, "delayed_streaming_900", 51020024786, 1500000000] }
    const actions = new Map([["CANA", [bonusHalf]]])
    const { movers } = buildSnapshotFromScanner([raw], [], "2026-11-13T00:00:00Z", actions, undefined)
    expect(movers).toHaveLength(1)
    expect(movers[0].changePct).toBeGreaterThan(-1)
    expect(movers[0].changePct).toBeLessThan(5)
  })

  it("1:1 bonus raw −50% survives the plausibility gate via Yahoo prev", () => {
    const row: ScanRow = { s: "EGX:XXX", d: ["XXX", "X Co", 10, -50, 1000, "delayed_streaming_900", null, null] }
    const oneToOne: CorporateActionTerms = { ...bonusHalf, ratioNumerator: BigInt(1), ratioDenominator: BigInt(1) }
    const actions = new Map([["XXX", [oneToOne]]])
    const prevs = new Map([["XXX", 10]]) // Yahoo adjusted prev in current units
    const { movers } = buildSnapshotFromScanner([row], [], "2026-11-13T03:00:00Z", actions, prevs)
    expect(movers).toHaveLength(1)
    expect(movers[0].changePct).toBeCloseTo(0, 6)
  })

  it("cash dividend on ex-date: Yahoo cum-dividend prev minus the amount", () => {
    const row: ScanRow = { s: "EGX:YYY", d: ["YYY", "Y Co", 19, -5, 5000, "delayed_streaming_900", null, null] }
    const cash: CorporateActionTerms = { actionType: "cash_dividend", ratioNumerator: null, ratioDenominator: null, cashPerShare: 1, subscriptionPrice: null }
    const actions = new Map([["YYY", [cash]]])
    const prevs = new Map([["YYY", 20]]) // cum-dividend close
    const { movers } = buildSnapshotFromScanner([row], [], "2026-11-13T03:00:00Z", actions, prevs)
    expect(movers).toHaveLength(1)
    expect(movers[0].changePct).toBeCloseTo(0, 6) // 19 vs (20−1)
  })

  it("bonus already in Yahoo prev is NOT re-applied (cash/rights only adjust the base)", () => {
    const row: ScanRow = { s: "EGX:CANA", d: ["CANA", "Suez Canal Bank SAE", 34.74, 53.20493579292055, 739024, "delayed_streaming_900", 51020024786, 1500000000] }
    const actions = new Map([["CANA", [bonusHalf]]])
    const prevs = new Map([["CANA", 34.01333236694336]])
    const { movers } = buildSnapshotFromScanner([row], [], "2026-11-13T03:00:00Z", actions, prevs)
    // 34.74 vs 34.01 ≈ +2.1% — if the bonus were re-applied it would be +53%.
    expect(movers[0].changePct).toBeLessThan(5)
  })

  it("non-action companies keep the scanner change untouched", () => {
    const row: ScanRow = { s: "EGX:ZZZ", d: ["ZZZ", "Z Co", 12, -2.5, 9000, "delayed_streaming_900", null, null] }
    const { movers } = buildSnapshotFromScanner([row], [], "2026-11-13T03:00:00Z", undefined, undefined)
    expect(movers[0].changePct).toBe(-2.5)
  })
})
