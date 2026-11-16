// =============================================================================
// Technical snapshot — the contiguous-suffix trim + calendar-anchored perf.
// COMI 2026-11-16 regression class: a series mixing sparse ancient bars with
// the recent daily segment produced a decade-wide chart, a "+469% week" and
// RSI 98.7. The live reading covers the contiguous daily segment only, and a
// performance window that does not actually exist reads null — never a
// fabricated number across a data gap.
// =============================================================================

import { describe, expect, it } from "vitest"
import { contiguousSuffix, perfByCalendarDays, TRIM_GAP_DAYS } from "@/lib/technical/analyze"
import type { Bar } from "@/lib/technical/indicators"

function bar(ts: string, close: number): Bar {
  return { ts, open: close, high: close, low: close, close, volume: null }
}

describe("contiguousSuffix — the live-segment trim", () => {
  it("keeps the recent daily segment and cuts sparse ancient bars (COMI shape)", () => {
    const bars = [
      bar("2016-03-01", 22), // sparse 2016-2017 scatter…
      bar("2016-06-15", 22.4),
      bar("2017-07-18", 23.33),
      bar("2026-09-01", 127), // …then the LIVE daily segment
      bar("2026-09-02", 127.6),
      bar("2026-09-03", 128.1),
      bar("2026-09-04", 128.51),
    ]
    const { bars: trimmed, cut } = contiguousSuffix(bars)
    expect(cut).toBe(3)
    expect(trimmed).toHaveLength(4)
    expect(trimmed[0].ts).toBe("2026-09-01")
    expect(trimmed[3].close).toBe(128.51)
  })

  it("keeps holiday clusters (≤14 calendar days) inside one segment", () => {
    const bars = [bar("2026-04-20", 100), bar("2026-04-21", 100.5), bar("2026-05-04", 101)] // 13-day Eid-like gap
    const { bars: trimmed, cut } = contiguousSuffix(bars)
    expect(cut).toBe(0)
    expect(trimmed).toHaveLength(3)
  })

  it("cuts exactly at the configured gap width", () => {
    const bars = [bar("2026-01-01", 50), bar("2026-02-20", 51)] // 50-day gap
    const { cut } = contiguousSuffix(bars)
    expect(cut).toBe(1)
    expect(TRIM_GAP_DAYS).toBe(14)
  })
})

describe("perfByCalendarDays — calendar-anchored performance", () => {
  it("computes the 1-week performance from the session ~7 days back", () => {
    const bars = [
      bar("2026-11-05", 100),
      bar("2026-11-08", 101),
      bar("2026-11-09", 102),
      bar("2026-11-10", 103),
      bar("2026-11-12", 105),
    ]
    // last = Nov 12; target = Nov 5 → anchor = Nov 5 (100) → +5%
    expect(perfByCalendarDays(bars, 7)).toBeCloseTo(5, 6)
  })

  it("returns null when the window does not exist (no fabricated perf across a gap)", () => {
    const bars = [bar("2017-07-18", 22.5), bar("2026-11-11", 128.4), bar("2026-11-12", 128.51)]
    // a 1-week window simply does not exist → "—", never "+469%"
    expect(perfByCalendarDays(bars, 7)).toBeNull()
  })

  it("rejects an anchor that sits far before the target (a sparse series reads null)", () => {
    const bars = [bar("2026-01-05", 90), bar("2026-11-12", 105)]
    // target ≈ Sep 14 — the only candidate is Jan 5, ~220 days before → null
    expect(perfByCalendarDays(bars, 182)).toBeNull()
  })
})
