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
})

describe("stance-store contract constants", () => {
  it("versions and staleness bounds are documented values", () => {
    expect(STANCE_ENGINE_VERSION).toBe("stance@1")
    expect(STALE_AFTER_MS).toBe(20 * 60 * 60 * 1000)
    expect(BOARD_MAX_AGE_MS).toBeGreaterThan(STALE_AFTER_MS)
  })
})
