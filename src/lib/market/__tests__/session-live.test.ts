// isEgxSessionLive — the liquidity map's honesty flag: a snapshot inside EGX
// trading hours (Sun–Thu 09:30–15:00 Cairo) means today's cumulative total is
// still accumulating vs yesterday's FINAL total, so mid-session red is
// arithmetic, not a data bug (owner question 2026-11-17).
import { describe, expect, it } from "vitest"
import { isEgxSessionLive } from "../../../app/api/v1/market/liquidity-heatmap/route"

describe("isEgxSessionLive", () => {
  it("is live inside Sun–Thu 09:30–15:00 Cairo", () => {
    // 2026-11-16 is a Monday; 10:15 Cairo = 08:15Z
    expect(isEgxSessionLive("2026-11-16T08:15:00.000Z")).toBe(true)
    // 12:59 Cairo = 10:59Z — inside
    expect(isEgxSessionLive("2026-11-16T10:59:00.000Z")).toBe(true)
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
