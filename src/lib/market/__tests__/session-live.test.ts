// isEgxSessionLive — the liquidity map's honesty flag: a snapshot inside THE
// canonical EGX live window (Sun–Thu 09:45–14:45 Cairo — the single
// definition shared with the signals board via egx-hours; audit 2026-11-19
// unified the three conflicting "live" windows) means today's cumulative
// total is still accumulating vs yesterday's FINAL total, so mid-session red
// is arithmetic, not a data bug (owner question 2026-11-17).
// November dates are UTC+2 in Cairo: HH:00 UTC == HH+2:00 Cairo.
import { describe, expect, it } from "vitest"
import { isEgxSessionLive } from "../../../app/api/v1/market/liquidity-heatmap/route"

describe("isEgxSessionLive", () => {
  it("is live inside Sun–Thu 09:45–14:45 Cairo (the egx-hours live window)", () => {
    // 2026-11-16 is a Monday; 10:15 Cairo = 08:15Z
    expect(isEgxSessionLive("2026-11-16T08:15:00.000Z")).toBe(true)
    // 12:59 Cairo = 10:59Z — inside
    expect(isEgxSessionLive("2026-11-16T10:59:00.000Z")).toBe(true)
  })

  it("flips exactly at the canonical 09:45 open and 14:45 close", () => {
    expect(isEgxSessionLive("2026-11-16T07:44:00.000Z")).toBe(false) // 09:44 Cairo
    expect(isEgxSessionLive("2026-11-16T07:45:00.000Z")).toBe(true) // 09:45 Cairo — open
    expect(isEgxSessionLive("2026-11-16T12:45:00.000Z")).toBe(true) // 14:45 Cairo — close, inclusive
    expect(isEgxSessionLive("2026-11-16T12:46:00.000Z")).toBe(false) // 14:46 Cairo — done
  })

  it("is not live before the open, after the close, or on Fri/Sat", () => {
    expect(isEgxSessionLive("2026-11-16T06:00:00.000Z")).toBe(false) // 08:00 Cairo
    expect(isEgxSessionLive("2026-11-16T13:30:00.000Z")).toBe(false) // 15:30 Cairo
    expect(isEgxSessionLive("2026-11-13T08:15:00.000Z")).toBe(false) // Friday
    expect(isEgxSessionLive("2026-11-14T08:15:00.000Z")).toBe(false) // Saturday
  })

  it("rejects missing or malformed timestamps", () => {
    expect(isEgxSessionLive(null)).toBe(false)
    expect(isEgxSessionLive(undefined)).toBe(false)
    expect(isEgxSessionLive("garbage")).toBe(false)
  })
})
