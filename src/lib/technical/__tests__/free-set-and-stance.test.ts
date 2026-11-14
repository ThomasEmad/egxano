import { describe, expect, it } from "vitest"
import { isFreeSignalTicker, FREE_SIGNAL_TICKERS, isPaidPlanId } from "../../plans/entitlements"
import { STANCE_ENGINE_VERSION, STALE_AFTER_MS, BOARD_MAX_AGE_MS } from "../stance-store"

/**
 * FREE-ACCESS UNIVERSE (2026-11-14) — the anti-bypass contract:
 * a free user's technical coverage is a FIXED set of 5 companies enforced
 * server-side, never "the first 5 rows of the current filter result".
 */
describe("free-signal fixed set", () => {
  it("has exactly five fixed tickers", () => {
    expect(FREE_SIGNAL_TICKERS.length).toBe(5)
    expect(new Set(FREE_SIGNAL_TICKERS).size).toBe(5)
  })

  it("matches case-insensitively and rejects everything else", () => {
    expect(isFreeSignalTicker("comi")).toBe(true)
    expect(isFreeSignalTicker(" ABUK ")).toBe(true)
    expect(isFreeSignalTicker("HRHO")).toBe(false)
    expect(isFreeSignalTicker("ORAS")).toBe(false)
    expect(isFreeSignalTicker("")).toBe(false)
  })

  it("paid plans bypass the set entirely", () => {
    expect(isPaidPlanId("PRO")).toBe(true)
    expect(isPaidPlanId("PRO_PLUS")).toBe(true)
    expect(isPaidPlanId("FREE")).toBe(false)
  })

  it("legacy/retired plan names keep FULL paid access (2026-11-14 live-bug contract)", () => {
    // A retired plan row (Pro Plus removed from sale, the legacy PREMIUM name)
    // must never resolve to the free tier — these are exactly the names the
    // production DB rows carry. Case/space variants normalize away in
    // isPaidPlanId, so "Pro Plus" from a live DB row still counts as paid.
    expect(isPaidPlanId("PRO PLUS")).toBe(true)
    expect(isPaidPlanId("PROPLUS")).toBe(true)
    expect(isPaidPlanId("pro_plus")).toBe(true)
    expect(isPaidPlanId("PREMIUM")).toBe(true)
    expect(isPaidPlanId("PREMIUM_PLUS")).toBe(true)
    expect(isPaidPlanId("PREMIUMPLUS")).toBe(true)
    expect(isPaidPlanId("PRO_3M")).toBe(true)
    expect(isPaidPlanId("")).toBe(false)
    expect(isPaidPlanId("STANDARD")).toBe(false)
  })
})

describe("stance-store contract constants", () => {
  it("versions and staleness bounds are documented values", () => {
    expect(STANCE_ENGINE_VERSION).toBe("stance@1")
    expect(STALE_AFTER_MS).toBe(20 * 60 * 60 * 1000)
    expect(BOARD_MAX_AGE_MS).toBeGreaterThan(STALE_AFTER_MS)
  })
})
