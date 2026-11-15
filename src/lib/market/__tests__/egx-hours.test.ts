import { describe, expect, it } from "vitest"
import { EGX_PULSE_CLOSE_MINUTES, egxMarketStatus, isEgxMarketLive, isEgxPulseWindow } from "@/lib/market/egx-hours"

// The 30-second auto-refresh pulse window (owner requirement: "تحديث كل 30
// ثانية … اقفله بعد الساعة 3"): trading days (Sun–Thu) 09:45 → 15:00 Cairo,
// INCLUSIVE at 15:00, OFF from 15:01, weekends always off. November dates are
// UTC+2 in Cairo (DST ended late October), so HH:00 UTC == HH+2:00 Cairo.
describe("isEgxPulseWindow — the 30s pulse stops after 15:00 Cairo", () => {
  it("is OFF one minute before the open and ON at 09:45", () => {
    expect(isEgxPulseWindow(new Date("2026-11-08T07:44:00.000Z"))).toBe(false) // Sun 09:44 Cairo
    expect(isEgxPulseWindow(new Date("2026-11-08T07:45:00.000Z"))).toBe(true) // Sun 09:45 Cairo
  })

  it("stays ON through the session and at exactly 15:00, OFF at 15:01", () => {
    expect(isEgxPulseWindow(new Date("2026-11-08T12:59:00.000Z"))).toBe(true) // 14:59 Cairo
    expect(isEgxPulseWindow(new Date("2026-11-08T13:00:00.000Z"))).toBe(true) // 15:00 Cairo — the owner's cutoff, inclusive
    expect(isEgxPulseWindow(new Date("2026-11-08T13:01:00.000Z"))).toBe(false) // 15:01 Cairo — STOPPED
  })

  it("is OFF on Friday/Saturday regardless of time", () => {
    expect(isEgxPulseWindow(new Date("2026-11-13T08:00:00.000Z"))).toBe(false) // Friday
    expect(isEgxPulseWindow(new Date("2026-11-14T08:00:00.000Z"))).toBe(false) // Saturday
  })

  it("keeps the badge's live semantics 09:45–14:45 (the pulse may outlive live)", () => {
    expect(isEgxMarketLive(new Date("2026-11-08T12:46:00.000Z"))).toBe(false) // 14:46 — session done
    expect(isEgxMarketLive(new Date("2026-11-08T13:00:00.000Z"))).toBe(false) // 15:00 — closed
    expect(isEgxPulseWindow(new Date("2026-11-08T13:00:00.000Z"))).toBe(true) // pulse still refreshing the closing trickle
  })

  it("exposes pulse on the market status in both open and closed states", () => {
    const open = egxMarketStatus(new Date("2026-11-08T08:00:00.000Z")) // 10:00 Cairo
    expect(open.live).toBe(true)
    expect(open.pulse).toBe(true)
    const afterCutoff = egxMarketStatus(new Date("2026-11-08T13:01:00.000Z")) // 15:01 Cairo
    expect(afterCutoff.live).toBe(false)
    expect(afterCutoff.pulse).toBe(false)
    expect(EGX_PULSE_CLOSE_MINUTES).toBe(15 * 60)
  })
})
