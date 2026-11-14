import { describe, expect, it } from "vitest"
import { effectiveEgxSessionDate, isEgxTradingDayUTC } from "@/lib/market/egx-session"

/**
 * EGX SESSION ANCHORING (2026-11-14 audit) — regression contract for the
 * phantom-weekend-session defect: quotes pulled on Friday/Saturday restate the
 * previous close and must never mint a new candle session.
 *
 * Live incident this guards against: the daily cron ingested a Friday 06:31
 * UTC quote and the public /market/sync added a Saturday one — both became
 * O=H=L=C phantom sessions in the technical series (COMI session count +2,
 * day change flattened to 0.00%, board score moved buy 71 → wait 50).
 */
describe("effectiveEgxSessionDate", () => {
  it("keeps quotes on scheduled trading days (Sun–Thu) on their own date", () => {
    // 2026-11-08 Sun … 2026-11-12 Thu — all scheduled EGX trading days.
    expect(effectiveEgxSessionDate("2026-11-08T09:00:00.000Z")).toBe("2026-11-08")
    expect(effectiveEgxSessionDate("2026-11-09T10:31:00.000Z")).toBe("2026-11-09")
    expect(effectiveEgxSessionDate("2026-11-10T12:00:00.000Z")).toBe("2026-11-10")
    expect(effectiveEgxSessionDate("2026-11-11T23:50:00.000Z")).toBe("2026-11-11")
    expect(effectiveEgxSessionDate("2026-11-12T06:31:00.000Z")).toBe("2026-11-12")
  })

  it("anchors Friday quotes to the previous Thursday", () => {
    // 2026-11-13 was a Friday; the cron pulled a quote at 06:31 UTC.
    expect(effectiveEgxSessionDate("2026-11-13T06:31:00.000Z")).toBe("2026-11-12")
    expect(effectiveEgxSessionDate("2026-11-13T23:59:00.000Z")).toBe("2026-11-12")
    // month boundary: Friday 2026-10-02 → Thursday 2026-10-01
    expect(effectiveEgxSessionDate("2026-10-02T10:00:00.000Z")).toBe("2026-10-01")
  })

  it("anchors Saturday quotes to the previous Thursday", () => {
    // 2026-11-14 was a Saturday; the public sync wrote a 00:50 UTC quote.
    expect(effectiveEgxSessionDate("2026-11-14T00:50:00.000Z")).toBe("2026-11-12")
    // month boundary: Saturday 2026-10-03 → Thursday 2026-10-01
    expect(effectiveEgxSessionDate("2026-10-03T12:00:00.000Z")).toBe("2026-10-01")
  })

  it("accepts Date objects and bare date strings", () => {
    expect(effectiveEgxSessionDate(new Date("2026-11-13T06:31:00.000Z"))).toBe("2026-11-12")
    expect(effectiveEgxSessionDate("2026-11-13")).toBe("2026-11-12")
  })

  it("is idempotent on already-anchored keys", () => {
    const anchored = effectiveEgxSessionDate("2026-11-14T00:50:00.000Z")
    expect(effectiveEgxSessionDate(anchored)).toBe(anchored)
  })
})

describe("isEgxTradingDayUTC", () => {
  it("accepts Sun(0)–Thu(4) and rejects Fri(5)/Sat(6)", () => {
    expect(isEgxTradingDayUTC(new Date("2026-11-08T00:00:00.000Z"))).toBe(true) // Sun
    expect(isEgxTradingDayUTC(new Date("2026-11-12T00:00:00.000Z"))).toBe(true) // Thu
    expect(isEgxTradingDayUTC(new Date("2026-11-13T00:00:00.000Z"))).toBe(false) // Fri
    expect(isEgxTradingDayUTC(new Date("2026-11-14T00:00:00.000Z"))).toBe(false) // Sat
  })
})
