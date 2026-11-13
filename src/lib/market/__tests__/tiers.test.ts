// Market-tier metadata + constituent seed lists — integrity tests.
// The lists are real EGX constituents (egxbot.com + egx.com.eg, November
// 2026); these tests guard against typos, duplicates across indices and
// silent drift.
import { describe, expect, it } from "vitest"
import {
  MARKET_TIERS,
  TIER_AR,
  EGX30_TICKERS,
  EGX70_TICKERS,
} from "@/lib/market/tiers"

describe("market tier labels", () => {
  it("TIER_AR covers exactly MARKET_TIERS — no missing entry, no extra key", () => {
    expect(Object.keys(TIER_AR).sort()).toEqual([...MARKET_TIERS].sort())
    for (const tier of MARKET_TIERS) {
      expect(TIER_AR[tier].short.length).toBeGreaterThan(0)
      expect(TIER_AR[tier].full.length).toBeGreaterThan(0)
      expect(TIER_AR[tier].en.length).toBeGreaterThan(0)
    }
  })

  it("NILEX is retired as a tier category (Nilex companies fold into MAIN)", () => {
    expect(MARKET_TIERS).not.toContain("NILEX")
    expect(Object.keys(TIER_AR)).not.toContain("NILEX")
  })
})

describe("constituent seed lists", () => {
  it("EGX30 and EGX70 share no ticker (index membership is exclusive)", () => {
    const overlap = EGX30_TICKERS.filter((t) => EGX70_TICKERS.includes(t))
    expect(overlap).toEqual([])
  })

  it("every constituent is a valid EGX ticker shape (/^[A-Z0-9]{2,6}$/)", () => {
    for (const t of [...EGX30_TICKERS, ...EGX70_TICKERS]) {
      expect(t).toMatch(/^[A-Z0-9]{2,6}$/)
    }
  })

  it("EGX30 has exactly 30 entries and EGX70 has 70 entries", () => {
    expect(EGX30_TICKERS).toHaveLength(30)
    expect(EGX70_TICKERS).toHaveLength(70)
  })

  it("EGX30 excludes CANA (in neither EGX30 nor EGX70) and the VLMR share class (only VLMRA is the primary listed class)", () => {
    expect(EGX30_TICKERS).not.toContain("CANA")
    expect(EGX70_TICKERS).not.toContain("CANA")
    expect(EGX30_TICKERS).not.toContain("VLMR")
    expect(EGX30_TICKERS).toContain("VLMRA")
  })
})
