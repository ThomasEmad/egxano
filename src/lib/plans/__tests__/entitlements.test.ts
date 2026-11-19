import { describe, expect, it } from "vitest"
import { PLANS, paidPlanCapMessageAr, effectiveFirstMonthPrice } from "@/lib/plans/entitlements"

// Audit P1: the PRO_3M sales copy claimed «خصم 50%» while 375/450 is a 17%
// first-month discount. offerPrice 375 is the owner's real price — the COPY
// must match the math (17%), and no rendered string may claim 50 again.
describe("PRO_3M offer copy matches the real math", () => {
  const plan = PLANS.PRO_3M

  it("375/450 rounds to a 17% first-month discount, and the copy says 17", () => {
    expect(plan.price).toBe(450)
    expect(plan.offerPrice).toBe(375)
    const pct = Math.round((1 - plan.offerPrice! / plan.price) * 100)
    expect(pct).toBe(17)
    // "450" contains the substring "50" — assert on the discount CLAIM, not the bare digits
    expect(plan.offerLabelAr).toMatch(/17\s*[%٪]/)
    expect(plan.offerLabelAr).not.toMatch(/50\s*[%٪]|خصم\s*50/)
    expect(plan.offerLabelAr).toContain("375")
  })

  it("no rendered PRO_3M feature bullet claims a 50% discount", () => {
    const joined = plan.featuresAr.join(" | ")
    expect(joined).toMatch(/17\s*[%٪]/)
    expect(joined).not.toMatch(/50\s*[%٪]|خصم\s*50/)
  })

  it("the payment flow charges the owner's offer price (unchanged)", () => {
    expect(effectiveFirstMonthPrice(plan)).toBe(375)
  })

  it("the sibling PRO offer (40% off 150 → 90) still matches its own math", () => {
    const pro = PLANS.PRO
    expect(pro.offerPrice).toBe(90)
    expect(Math.round((1 - pro.offerPrice! / pro.price) * 100)).toBe(40)
  })
})

// Audit P2: cap errors must name the caller's CURRENT plan and its REAL cap —
// legacy PRO_PLUS subscribers resolve to PRO, so "upgrade to Pro Plus" was a
// dead-end upsell to a plan that no longer exists.
describe("paidPlanCapMessageAr — honest cap copy", () => {
  it("names the current plan and its real cap, never the retired Pro Plus", () => {
    const alertsMsg = paidPlanCapMessageAr("PRO", 30, "تنبيه نشط")
    expect(alertsMsg).toContain("30")
    expect(alertsMsg).toContain("برو")
    expect(alertsMsg).toMatch(/برو(?!\s*بلس)/)
    expect(alertsMsg).not.toContain("برو بلس")
    expect(alertsMsg).not.toContain("Pro Plus")

    const watchMsg = paidPlanCapMessageAr("PRO", 50, "سهم")
    expect(watchMsg).toContain("50")
    expect(watchMsg).toContain("سهم")
    expect(watchMsg).not.toContain("برو بلس")
  })

  it("uses the TRIAL plan's own name for trial users", () => {
    const msg = paidPlanCapMessageAr("TRIAL", 30, "تنبيه نشط")
    expect(msg).toContain("30")
    expect(msg).toContain(PLANS.TRIAL.nameAr)
    expect(msg).not.toContain("برو بلس")
  })
})
