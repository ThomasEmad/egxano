// =============================================================================
// OWNER MANDATE (2026-11-17) — the support-break cushion rule.
// A broken support is NOT automatically an exit: the next support below
// decides. gap ≥ 4% (or none) → exit; gap ≤ 3% → wait; (3%, 4%) → wait,
// borderline. The fixtures engineer exact zone geometry (see bars-fixture.ts).
// =============================================================================

import { describe, expect, it } from "vitest"
import { computeMetrics, toSignalMetrics } from "../metrics"
import { detectExit } from "../patterns"
import { computeCompanySignalV2 } from "../engine"
import { buildZoneMap } from "../levels"
import { cushionSeries } from "../../position/__tests__/bars-fixture"

describe("detectExit — the cushion rule on a support break", () => {
  it("fires a full EXIT when the next support is far below (gap 5.4% ≥ 4%)", () => {
    const bars = cushionSeries(97) // cushion zone 97–97.4, close 103 → gap 5.44%
    const m = computeMetrics(bars)!
    const map = buildZoneMap(bars)
    const exit = detectExit(bars, map, m)
    expect(exit).not.toBeNull()
    expect(exit!.type).toBe("exit_support")
    expect(exit!.cushion).toMatchObject({ waitInstead: false, borderline: false })
    expect(exit!.cushion!.level).toBeCloseTo(97.4, 6)
    expect(exit!.cushion!.gapPct).toBeGreaterThan(4)
    // the far-cushion reason is disclosed in the evidence
    expect(exit!.facts.some((f) => f.ar.includes("مساحة الهبوط مفتوحة"))).toBe(true)
  })

  it("classifies WAIT when the next support sits right under the price (gap 2.5% ≤ 3%)", () => {
    const bars = cushionSeries(100) // cushion zone 100–100.4, close 103 → gap 2.52%
    const m = computeMetrics(bars)!
    const map = buildZoneMap(bars)
    const exit = detectExit(bars, map, m)
    expect(exit).not.toBeNull()
    expect(exit!.cushion).toMatchObject({ waitInstead: true, borderline: false })
    expect(exit!.cushion!.gapPct).toBeLessThan(3)
    expect(exit!.facts.some((f) => f.ar.includes("انتظار ومتابعة"))).toBe(true)
  })

  it("marks the 3–4% band as WAIT + borderline (tighter mental stop)", () => {
    const bars = cushionSeries(99) // cushion zone 99–99.4, close 103 → gap 3.50%
    const m = computeMetrics(bars)!
    const map = buildZoneMap(bars)
    const exit = detectExit(bars, map, m)
    expect(exit).not.toBeNull()
    expect(exit!.cushion).toMatchObject({ waitInstead: true, borderline: true })
    expect(exit!.cushion!.gapPct).toBeGreaterThan(3)
    expect(exit!.cushion!.gapPct).toBeLessThan(4)
    expect(exit!.facts.some((f) => f.ar.includes("وقف ذهني أضيق"))).toBe(true)
  })
})

describe("engine ladder — the downgraded break is published as WAIT, not EXIT", () => {
  it("state = wait (with the cushion activation disclosed) when the cushion is close", () => {
    const bars = cushionSeries(100)
    const row = computeCompanySignalV2({
      bars,
      identity: { companyId: "c1", ticker: "TEST", nameEn: "Test Co", nameAr: "شركة الاختبار", sector: "Tests", marketTier: "EGX30" },
      fundamentals: null,
      todaySession: "2026-03-13",
    })
    expect(row.state).toBe("wait")
    expect(row.type).toBeNull() // wait rows carry no opportunity type
    expect(row.invalidationAr).toContain("الخروج الفعلي")
    expect(row.quality.notesAr.some((n) => n.includes("كسر دعم مُصنَّف انتظار"))).toBe(true)
    // the break itself is still disclosed in the evidence — nothing is hidden
    expect(row.evidence.some((e) => e.ar.includes("كسر دعم"))).toBe(true)
  })

  it("state = exit when the cushion is far (the old behavior, preserved)", () => {
    const bars = cushionSeries(97)
    const row = computeCompanySignalV2({
      bars,
      identity: { companyId: "c1", ticker: "TEST", nameEn: "Test Co", nameAr: "شركة الاختبار", sector: "Tests", marketTier: "EGX30" },
      fundamentals: null,
      todaySession: "2026-03-13",
    })
    expect(row.state).toBe("exit")
    expect(row.type).toBe("exit_support")
  })

  it("both rows agree on the metrics bundle shape (no score/plan regressions)", () => {
    for (const base of [97, 100]) {
      const bars = cushionSeries(base)
      const m = computeMetrics(bars)!
      const row = computeCompanySignalV2({
        bars,
        identity: { companyId: "c1", ticker: "TEST", nameEn: "Test Co", nameAr: null, sector: "Tests", marketTier: "MAIN" },
        fundamentals: null,
        todaySession: "2026-03-13",
      })
      expect(toSignalMetrics(m)).toBeDefined()
      expect(row.plan).toBeNull() // wait AND exit rows never carry an entry plan
    }
  })
})
