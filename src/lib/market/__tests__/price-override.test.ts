// =============================================================================
// Admin manual price override — the read-time layer (owner mandate 2026-11-16).
// The owner's value IS the site's price: patched onto the last bar of every
// merged series so indicators, plans and charts see it consistently; the
// implied-previous-close math keeps change% honest. Users never see a marker.
// =============================================================================

import { describe, expect, it } from "vitest"
import {
  adjustedChangePctForOverride,
  applyAdminPriceOverrideToLastBar,
  unitMultiplier,
} from "@/lib/market/price-override"

describe("applyAdminPriceOverrideToLastBar", () => {
  it("patches the LAST bar's close and widens high/low to contain the override", () => {
    const bars = [
      { open: 100, high: 101, low: 99, close: 100.5, volume: 1000 },
      { open: 100.5, high: 101.5, low: 100, close: 101, volume: 1200 },
    ]
    applyAdminPriceOverrideToLastBar(bars, { price: 105, volume: null, updatedAt: "2026-11-16" })
    expect(bars[0].close).toBe(100.5) // earlier bars untouched
    expect(bars[1].close).toBe(105)
    expect(bars[1].high).toBe(105) // ceiling widened
    expect(bars[1].low).toBe(100) // floor untouched
  })

  it("lowers the floor when the override is below the range (no invented wick)", () => {
    const bars = [{ open: 50, high: 51, low: 49, close: 50, volume: null }]
    applyAdminPriceOverrideToLastBar(bars, { price: 47.5, volume: null, updatedAt: "2026-11-16" })
    expect(bars[0].close).toBe(47.5)
    expect(bars[0].low).toBe(47.5)
    expect(bars[0].high).toBe(51)
  })

  it("carries the owner-set volume and ignores a null/no-op override", () => {
    const bars = [{ open: 10, high: 10.2, low: 9.8, close: 10, volume: 500 }]
    applyAdminPriceOverrideToLastBar(bars, { price: 10.4, volume: 9000, updatedAt: "2026-11-16" })
    expect(bars[0].volume).toBe(9000)
    const before = { ...bars[0] }
    applyAdminPriceOverrideToLastBar(bars, null)
    expect(bars[0]).toMatchObject(before)
  })
})

describe("adjustedChangePctForOverride", () => {
  it("preserves the feed's implied previous close", () => {
    // feed: 100 with +2% → implied prev ≈ 98.039; override 110 → +12.19%
    const pct = adjustedChangePctForOverride(100, 2, 110)
    expect(pct).toBeCloseTo(((110 / (100 / 1.02)) - 1) * 100, 6)
  })

  it("passes the feed change through when the math degenerates", () => {
    expect(adjustedChangePctForOverride(100, -100, 110)).toBe(-100)
  })
})

describe("unitMultiplier", () => {
  it("maps the four unit conventions to plain EGP", () => {
    expect(unitMultiplier("UNIT")).toBe(1)
    expect(unitMultiplier("THOUSAND")).toBe(1_000)
    expect(unitMultiplier("MILLION")).toBe(1_000_000)
    expect(unitMultiplier("BILLION")).toBe(1_000_000_000)
  })
})
