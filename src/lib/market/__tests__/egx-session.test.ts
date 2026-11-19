import { describe, expect, it } from "vitest"
import { effectiveEgxSessionDate, isEgxTradingDayUTC } from "@/lib/market/egx-session"

/**
 * EGX SESSION ANCHORING — regression contract for phantom sessions: a quote
 * carries a NEW session only when its CAIRO clock sits inside/after the
 * session on a scheduled trading day (Sun–Thu). Weekend AND pre-open quotes
 * (before the 09:45 open) merely restate the previous close and anchor to the
 * PRIOR real session:
 *   Fri/Sat (Cairo)    → previous Thursday
 *   Sun pre-open       → previous Thursday
 *   Mon–Thu pre-open   → the previous calendar day (always a trading day)
 * Live (≥09:45) and after-close quotes anchor to their own day — including
 * after-close quotes past UTC midnight (a Thu 21:00 UTC quote still anchors
 * Thursday).
 *
 * Live incidents: the 2026-11-14 audit (Fri/Sat double phantom — COMI board
 * buy 71 → wait 50) and the 2026-11-19 follow-up finding that a Sun–Thu quote
 * before the 09:45 open minted a same-day flat bar from the 24/7 heartbeat
 * (e.g. a Thu 06:31 UTC = 08:31 Cairo pull became a phantom Thursday bucket).
 * November 2026 is UTC+2 in Cairo: HH:00 UTC == HH+2:00 Cairo.
 */
describe("effectiveEgxSessionDate", () => {
  it("keeps live and after-close quotes on scheduled trading days on their own date", () => {
    // 2026-11-08 Sun … 2026-11-12 Thu — scheduled EGX trading days.
    expect(effectiveEgxSessionDate("2026-11-08T09:00:00.000Z")).toBe("2026-11-08") // 11:00 Cairo — live
    expect(effectiveEgxSessionDate("2026-11-09T10:31:00.000Z")).toBe("2026-11-09") // 12:31 Cairo — live
    expect(effectiveEgxSessionDate("2026-11-10T12:00:00.000Z")).toBe("2026-11-10") // 14:00 Cairo — live
    expect(effectiveEgxSessionDate("2026-11-12T10:00:00.000Z")).toBe("2026-11-12") // 12:00 Cairo — mid-session
    // after close, crossing UTC midnight: 2026-11-11T23:50Z = Fri 01:50 Cairo
    // — restates (and stays keyed to) Thursday.
    expect(effectiveEgxSessionDate("2026-11-11T23:50:00.000Z")).toBe("2026-11-11")
    // after close, same UTC day: Thu 21:00 UTC = 23:00 Cairo — stays Thursday.
    expect(effectiveEgxSessionDate("2026-11-12T21:00:00.000Z")).toBe("2026-11-12")
  })

  it("anchors a pre-open quote on a trading day to the prior real session", () => {
    // 2026-11-12 Thu 06:31 UTC = 08:31 Cairo — BEFORE the 09:45 open: the
    // scanner still shows Wednesday's close, so the bar anchors Wednesday.
    // (This exact case was pinned to "2026-11-12" until 2026-11-19 — it
    // pinned the buggy half-rule that minted a same-day phantom bar pre-open.)
    expect(effectiveEgxSessionDate("2026-11-12T06:31:00.000Z")).toBe("2026-11-11")
    // Thursday 06:30 UTC = 08:30 Cairo — pre-open → prior Wednesday. (The
    // audit note suggested "Thu 08:00 UTC → prior Wednesday", but 08:00 UTC
    // is 10:00 Cairo — already past the 09:45 open — so 08:00 UTC anchors
    // Thursday; 06:30 UTC is the honest pre-open variant of that case.)
    expect(effectiveEgxSessionDate("2026-11-12T06:30:00.000Z")).toBe("2026-11-11")
    // Thursday 08:00 UTC = 10:00 Cairo — AFTER the open → same day.
    expect(effectiveEgxSessionDate("2026-11-12T08:00:00.000Z")).toBe("2026-11-12")
    // Monday 06:00 UTC = 08:00 Cairo — pre-open → restates Sunday.
    expect(effectiveEgxSessionDate("2026-11-09T06:00:00.000Z")).toBe("2026-11-08")
  })

  it("anchors a Sunday pre-open quote to the previous Thursday", () => {
    // 2026-11-08 Sun 06:00 UTC = 08:00 Cairo — before the open → Thursday.
    expect(effectiveEgxSessionDate("2026-11-08T06:00:00.000Z")).toBe("2026-11-05")
    // month boundary: Sunday 2026-03-01 04:00 UTC = 06:00 Cairo → Thursday 2026-02-26
    expect(effectiveEgxSessionDate("2026-03-01T04:00:00.000Z")).toBe("2026-02-26")
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

  it("accepts Date objects and bare date keys (a bare key is an ALREADY-ANCHORED session date)", () => {
    expect(effectiveEgxSessionDate(new Date("2026-11-13T06:31:00.000Z"))).toBe("2026-11-12")
    // A bare key carries no clock: trading-day keys are idempotent (the
    // technical mergeSessionSeries feeds bare-dated quotes — re-anchoring a
    // Monday key must not move it to Sunday), and a weekend key is never a
    // real session, so it walks back to the prior trading day.
    expect(effectiveEgxSessionDate("2026-11-13")).toBe("2026-11-12") // Friday key → Thursday
    expect(effectiveEgxSessionDate("2026-11-14")).toBe("2026-11-12") // Saturday key → Thursday
    expect(effectiveEgxSessionDate("2026-11-12")).toBe("2026-11-12") // Thursday key stays put
  })

  it("is idempotent on already-anchored keys carrying a live instant", () => {
    const anchored = effectiveEgxSessionDate("2026-11-14T00:50:00.000Z") // → 2026-11-12
    expect(effectiveEgxSessionDate(`${anchored}T12:00:00.000Z`)).toBe(anchored)
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
