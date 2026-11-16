// =============================================================================
// Merger corporate-action handling (owner mandate 2026-11-16 — القاهرة للدواجن
// 27/9): a share-for-share merger rescales the series exactly like a split
// (the exchange ratio REPLACES the held share), and a merger recorded WITHOUT
// a ratio is informational only — never rescales anything. Plus the admin
// ledger visibility contract: any past manual action must be reachable.
// =============================================================================

import { describe, expect, it } from "vitest"
import {
  adjustPrevClose,
  applyCorporateActionAdjustments,
  detectSuspiciousGaps,
  perShareRatio,
  type CorporateActionTerms,
  type SeriesBar,
} from "@/lib/market/corporate-actions"

const mergerWithRatio = (ratio: number): CorporateActionTerms => ({
  actionType: "merger",
  ratioNumerator: BigInt(Math.round(ratio * 100)),
  ratioDenominator: BigInt(100),
  cashPerShare: null,
  subscriptionPrice: null,
})

const mergerInformational: CorporateActionTerms = {
  actionType: "merger",
  ratioNumerator: null,
  ratioDenominator: null,
  cashPerShare: null,
  subscriptionPrice: null,
}

describe("merger — adjustPrevClose", () => {
  it("rescales like a split when an exchange ratio is recorded (0.5 old→new doubles the adj base)", () => {
    expect(adjustPrevClose(100, [mergerWithRatio(0.5)])).toBeCloseTo(200, 6)
  })

  it("shrinks the base for a ratio above 1 (2 new per 1 old)", () => {
    expect(adjustPrevClose(100, [mergerWithRatio(2)])).toBeCloseTo(50, 6)
  })

  it("NEVER rescales an informational merger (no ratio) — the drop stays honest", () => {
    expect(adjustPrevClose(100, [mergerInformational])).toBe(100)
  })

  it("composes with a cash dividend on the same ex-date", () => {
    const cash: CorporateActionTerms = { actionType: "cash_dividend", ratioNumerator: null, ratioDenominator: null, cashPerShare: 1.5, subscriptionPrice: null }
    // merger first (÷0.5 → 200), then cash −1.5 → 198.5
    expect(adjustPrevClose(100, [mergerWithRatio(0.5), cash])).toBeCloseTo(198.5, 6)
  })
})

describe("merger — applyCorporateActionAdjustments (series continuity)", () => {
  const bars: SeriesBar[] = [
    { ts: "2026-09-25", open: 40, high: 41, low: 39, close: 40, volume: null, source: "pricebar" },
    { ts: "2026-09-28", open: 80, high: 82, low: 79, close: 81, volume: null, source: "pricebar" },
  ]

  it("rescales the pre-ex-date bars by the exchange ratio across the 27/9 gap (2 new per 1 old → pre bars ÷2)", () => {
    const res = applyCorporateActionAdjustments(bars, [{ exDateISO: "2026-09-27", terms: mergerWithRatio(2) }])
    expect(res.eventsApplied).toHaveLength(1)
    expect(res.eventsApplied[0].factor).toBeCloseTo(0.5, 6)
    expect(res.bars[0].close).toBeCloseTo(20, 4) // 40 → 20 (÷2), continuity with 81
    expect(res.bars[1].close).toBeCloseTo(81, 4) // the ex-date bar itself untouched
  })

  it("leaves the whole series raw for an informational merger", () => {
    const res = applyCorporateActionAdjustments(bars, [{ exDateISO: "2026-09-27", terms: mergerInformational }])
    expect(res.eventsApplied).toHaveLength(0)
    expect(res.eventsSkipped).toHaveLength(0)
    expect(res.bars[0].close).toBe(40)
    expect(res.bars[1].close).toBe(81)
  })

  it("the gap detector hunts MECHANICAL DROPS only — a merger repricing UP (40→81) is not a loss", () => {
    const rise = detectSuspiciousGaps(
      [
        { ts: "2026-09-25", close: 40 },
        { ts: "2026-09-28", close: 81 },
      ],
      [] // no action recorded yet
    )
    expect(rise).toHaveLength(0)
  })

  it("detects an unrecorded cash-out merger COLLAPSE so the admin is prompted to record it", () => {
    const collapse = detectSuspiciousGaps(
      [
        { ts: "2026-09-25", close: 40 },
        { ts: "2026-09-28", close: 20 },
      ],
      []
    )
    expect(collapse).toHaveLength(1)
    expect(collapse[0].dropPct).toBe(50)
    expect(collapse[0].hasAction).toBe(false)
  })

  it("perShareRatio stays null for a ratio-less merger", () => {
    expect(perShareRatio(mergerInformational)).toBeNull()
    expect(perShareRatio(mergerWithRatio(0.5))).toBeCloseTo(0.5, 6)
  })
})
