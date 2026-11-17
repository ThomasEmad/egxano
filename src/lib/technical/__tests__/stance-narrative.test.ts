// =============================================================================
// Stance vision narrative tests — the EMA-FIRST doctrine contract (2026-11-17).
//
// The owner's mandates pinned here:
//   1. the vision mentions EMA20/EMA50 explicitly (the reading's backbone);
//   2. no static-S/R-first phrasing anywhere in the paragraph/bullets — static
//      zones appear ONLY in the demotion footnote as «إشارات مرجعية»;
//   3. no contradictory pairs — a bullish story never coexists with an exit
//      plan's wording and vice versa (the state decides the action sentence);
//   4. the ONE close-based kill line is present in every measurable geometry;
//   5. real numbers only — levels render 2dp, distances signed 1dp.
// =============================================================================

import { describe, expect, it } from "vitest"
import { buildStanceVision, deriveEmaOrder } from "../stance-narrative"

const BULL = { state: "buy" as const, lastClose: 23.4, ema20: 22.85, ema50: 21.7 }
const BEAR = { state: "exit" as const, lastClose: 18.2, ema20: 19.1, ema50: 20.4 }

describe("deriveEmaOrder", () => {
  it("classifies a full bullish stack", () => {
    expect(deriveEmaOrder(23.4, 22.85, 21.7)).toBe("bullish")
  })
  it("classifies a full bearish stack", () => {
    expect(deriveEmaOrder(18.2, 19.1, 20.4)).toBe("bearish")
  })
  it("classifies close/order disagreement as transition", () => {
    // above EMA50 but the pair order is still negative
    expect(deriveEmaOrder(23.4, 21.0, 21.7)).toBe("transition")
    // below EMA50 while the pair order is still positive
    expect(deriveEmaOrder(21.0, 22.0, 21.7)).toBe("transition")
  })
  it("is honest when EMA50 or the close is missing", () => {
    expect(deriveEmaOrder(null, 22.0, 21.7)).toBe("unknown")
    expect(deriveEmaOrder(23.4, 22.0, null)).toBe("unknown")
  })
})

describe("buildStanceVision — bullish stance", () => {
  const v = buildStanceVision(BULL)

  it("names EMA20 and EMA50 explicitly with real 2dp levels", () => {
    expect(v.paraAr).toContain("EMA20")
    expect(v.paraAr).toContain("EMA50")
    expect(v.paraAr).toContain("21.70")
    expect(v.order).toBe("bullish")
  })

  it("carries the ONE close-based kill line on EMA50", () => {
    expect(v.killLineAr).toContain("إغلاق يومي تحت EMA50")
    expect(v.killLineAr).toContain("الخروج من القصة")
  })

  it("renders exactly three crisp bullets: الوضع / خط الحكم / ما بعد", () => {
    expect(v.bulletsAr.map((b) => b.label)).toEqual(["الوضع", "خط الحكم", "ما بعد"])
    expect(v.bulletsAr[2].text).toContain("شراء")
  })

  it("quotes real signed distances in the situation bullet", () => {
    // (23.4 − 22.85) / 22.85 = +2.4% ; (23.4 − 21.7) / 21.7 = +7.8%
    expect(v.bulletsAr[0].text).toContain("+2.4%")
    expect(v.bulletsAr[0].text).toContain("+7.8%")
    expect(v.bulletsAr[0].text).toContain("ترتيب صعودي")
  })

  it("contains no static-S/R-first phrasing and no conflict mush", () => {
    const body = [v.paraAr, ...v.bulletsAr.map((b) => b.text)].join(" ")
    expect(body).not.toContain("مقاومة")
    expect(body).not.toContain("دعم")
    expect(v.paraAr).not.toContain("متضاربة")
  })

  it("demotes static zones to reference signs in the footnote", () => {
    expect(v.footnoteAr).toContain("إشارات مرجعية")
    expect(v.footnoteAr).toContain("المتوسطات")
  })
})

describe("buildStanceVision — bearish stance", () => {
  const v = buildStanceVision(BEAR)

  it("names EMA20 and EMA50 explicitly with the negative order", () => {
    expect(v.paraAr).toContain("EMA20")
    expect(v.paraAr).toContain("EMA50")
    expect(v.paraAr).toContain("ترتيب سلبي")
    expect(v.order).toBe("bearish")
  })

  it("never claims a bullish story while the state is exit", () => {
    expect(v.paraAr).not.toContain("القصة الصاعدة شغالة")
    expect(v.paraAr).not.toContain("متضاربة")
    expect(v.bulletsAr[2].text).toContain("خروج")
  })

  it("carries the close-based line that ENDS the bearish story", () => {
    expect(v.killLineAr).toContain("إغلاق يومي فوق EMA50")
  })

  it("keeps the narrative EMA-only (no static S/R in the body)", () => {
    const body = [v.paraAr, ...v.bulletsAr.map((b) => b.text)].join(" ")
    expect(body).not.toContain("مقاومة")
    expect(body).not.toContain("دعم")
  })
})

describe("buildStanceVision — transitional (conflicting) geometry", () => {
  // close above EMA50 while EMA20 is still under EMA50 — the owner's exact
  // example of a conflict that must be stated CLEARLY, not mushily.
  const v = buildStanceVision({ state: "wait", lastClose: 23.4, ema20: 21.0, ema50: 21.7 })

  it("says the picture is conflicted in explicit words", () => {
    expect(v.paraAr).toContain("متضاربة")
    expect(v.paraAr).toContain("مرحلة انتقالية")
    expect(v.paraAr).toContain("EMA50")
    expect(v.paraAr).toContain("EMA20")
    expect(v.paraAr).toContain("الإغلاق اليومي هو الحكم")
  })

  it("still publishes the close-based kill line", () => {
    expect(v.killLineAr).toContain("إغلاق يومي تحت EMA50")
  })

  it("keeps the wait state honest in the action bullet", () => {
    expect(v.bulletsAr[2].text).toContain("انتظار")
  })
})

describe("buildStanceVision — no contradictory state/geometry pairs", () => {
  it("a BUY on a bearish stack is stated as a signal ahead of the story, never a bullish story", () => {
    const v = buildStanceVision({ state: "buy", lastClose: 18.2, ema20: 19.1, ema50: 20.4 })
    expect(v.paraAr).toContain("سبقت")
    expect(v.paraAr).not.toContain("القصة الصاعدة شغالة")
    // the kill line remains the close-based EMA judge
    expect(v.killLineAr).toContain("إغلاق يومي")
    expect(v.killLineAr).toContain("EMA50")
  })

  it("an EXIT on a bullish stack is stated as a re-evaluation, never a flat bullish story", () => {
    const v = buildStanceVision({ state: "exit", lastClose: 23.4, ema20: 22.85, ema50: 21.7 })
    expect(v.paraAr).toContain("إعادة تقييم")
    // the conflict is expressed, not hidden
    expect(v.paraAr).toContain("خروج")
    expect(v.killLineAr).toContain("إغلاق يومي")
  })

  it("a WAIT on a bullish stack keeps the bullish story without inventing a buy", () => {
    const v = buildStanceVision({ state: "wait", lastClose: 23.4, ema20: 22.85, ema50: 21.7 })
    expect(v.paraAr).toContain("القصة الصاعدة شغالة")
    expect(v.bulletsAr[2].text).toContain("انتظار")
    expect(v.bulletsAr[2].text).not.toContain("شراء —")
  })
})

describe("buildStanceVision — degraded data honesty", () => {
  it("without EMA50 the vision says so plainly and has no kill line", () => {
    const v = buildStanceVision({ state: null, lastClose: 23.4, ema20: 22.85, ema50: null })
    expect(v.order).toBe("unknown")
    expect(v.killLineAr).toBeNull()
    expect(v.paraAr).toContain("EMA50")
    expect(v.bulletsAr[1].text).toContain("متاح")
  })

  it("without an engine reading the action bullet says so honestly", () => {
    const v = buildStanceVision({ state: null, lastClose: 23.4, ema20: 22.85, ema50: 21.7 })
    expect(v.bulletsAr[2].text).toContain("مفيش قراءة محرك")
  })

  it("handles non-finite inputs as missing (never prints NaN)", () => {
    const v = buildStanceVision({ state: "wait", lastClose: Number.NaN, ema20: Number.NaN, ema50: 21.7 })
    expect(v.paraAr).not.toContain("NaN")
    expect(v.bulletsAr[0].text).not.toContain("NaN")
    expect(v.order).toBe("unknown")
  })
})
