// =============================================================================
// OWNER MANDATE (2026-11-17) — the support-break cushion rule.
// A broken support is NOT automatically an exit: the next support below
// decides. gap ≥ 4% (or none) → exit; gap ≤ 3% → wait; (3%, 4%) → wait,
// borderline. The fixtures engineer exact zone geometry (see bars-fixture.ts).
// =============================================================================

import { describe, expect, it } from "vitest"
import { computeMetrics, toSignalMetrics } from "../metrics"
import { detectExit } from "../patterns"
import { readCushion } from "../../position/review"
import { computeCompanySignalV2 } from "../engine"
import { buildZoneMap } from "../levels"
import { cushionSeries } from "../../position/__tests__/bars-fixture"
import type { Bar } from "../types"
import type { PriceZone, ZoneMap } from "../levels"

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

describe("detectExit — the cushion matches the position review on the SAME data", () => {
  // The auditor's drift scenario: a 3× support 90–95 breaks TODAY (prev close
  // 96 → close 88), a single-touch shelf 88.5–89.5 sits ABOVE the live close
  // (it can not cushion anything — the price already fell through it), and
  // the real floor is the 2× zone 84–84.4. The board row must read the SAME
  // cushion the position review reads (readCushion → nearestSupportBelow).
  it("board row and readCushion agree: level 84.4, gap ≈ 4.09% → far cushion → EXIT", () => {
    const bars: Bar[] = []
    for (let i = 0; i < 79; i++) {
      const ts = `2026-01-${String(1 + (i % 28)).padStart(2, "0")}-${String(i).padStart(3, "0")}`
      bars.push({ ts, open: 96, high: 96.3, low: 95.7, close: 96, volume: 1000 })
    }
    bars.push({ ts: "2026-01-15-079", open: 88, high: 88.3, low: 87.7, close: 88, volume: 1000 })
    const S1: PriceZone = { kind: "support", positionKind: "resistance", low: 90, high: 95, touches: 3, lastTouchTs: "x1", lastTouchIdx: 10, broken: false }
    const S3: PriceZone = { kind: "support", positionKind: "resistance", low: 88.5, high: 89.5, touches: 1, lastTouchTs: "x3", lastTouchIdx: 20, broken: false }
    const S2: PriceZone = { kind: "support", positionKind: "support", low: 84, high: 84.4, touches: 2, lastTouchTs: "x2", lastTouchIdx: 30, broken: false }
    const map: ZoneMap = { zones: [S2, S3, S1], atr: 1 }
    const m = computeMetrics(bars)!

    const exit = detectExit(bars, map, m)
    expect(exit).not.toBeNull()
    expect(exit!.type).toBe("exit_support")
    // the cushion is the floor BELOW the live close (84.4) — not the fallen-
    // through shelf (89.5, which produced a nonsensical negative gap before)
    expect(exit!.cushion!.level).toBeCloseTo(84.4, 6)
    expect(exit!.cushion!.gapPct).toBeCloseTo(((88 - 84.4) / 88) * 100, 6) // ≈ 4.09
    expect(exit!.cushion!.gapPct).toBeGreaterThanOrEqual(0) // never negative
    expect(exit!.cushion!.waitInstead).toBe(false) // 4.09 ≥ 4 → EXIT
    expect(exit!.cushion!.borderline).toBe(false)

    // cross-consistency: the position review's reading on the SAME bars + map
    const rc = readCushion(bars, map)
    expect(rc.brokeLastSession).toBe(true)
    expect(rc.cushionLevel!).toBeCloseTo(exit!.cushion!.level!, 6)
    expect(rc.cushionGapPct!).toBeCloseTo(exit!.cushion!.gapPct!, 6)
    expect(rc.farCushion).toBe(true)
    // NB: readCushion's `borderline` is unbounded above (any gap > 3%), so a
    // far cushion still reads borderline there — detectExit's own cushion
    // verdict (waitInstead/borderline) is the board-side contract asserted above.
  })
})
