// Data validation + frozen corporate-actions cross-check tests.
import { describe, expect, it } from "vitest"
import { DEFAULT_BACKTEST_CONFIG } from "../constants"
import { crossCheckSplits, validateSeries, type CachedQuote, type RawBar } from "../data-quality"

function bar(ts: string, close: number, over: Partial<RawBar> = {}): RawBar {
  return {
    ts, open: close, high: close * 1.01, low: close * 0.99, close,
    volume: 1_000_000, adjClose: close, ...over,
  }
}

function quote(bars: RawBar[], splits: CachedQuote["splits"] = []): CachedQuote {
  return { ticker: "T", fetchedAt: "now", range: "1y", adjcloseUsed: true, bars, splits, dividends: [] }
}

describe("validateSeries", () => {
  it("accepts a clean 160-session series and builds adjusted rows", () => {
    // EGX week: Sun(0)..Thu(4); walk dates skipping Fri/Sat
    const bars: RawBar[] = []
    let d = Date.UTC(2025, 0, 5) // a Sunday
    for (let i = 0; i < 160; i++) {
      const dt = new Date(d)
      const wd = dt.getUTCDay()
      if (wd === 5 || wd === 6) { d += 86_400_000; i--; continue }
      bars.push(bar(dt.toISOString().slice(0, 10), 100 + i))
      d += 86_400_000
    }
    const v = validateSeries(quote(bars), DEFAULT_BACKTEST_CONFIG)
    expect(v.ok).toBe(true)
    expect(v.stats.sessions).toBe(160)
    expect(v.rows).toHaveLength(160)
    expect(v.rows[0].close).toBe(100)
    expect(v.stats.weekdayViolations).toBe(0)
  })

  it("skips a series shorter than minSessions", () => {
    const bars = Array.from({ length: 100 }, (_, i) => bar(`2025-01-${String((i % 28) + 1).padStart(2, "0")}`, 100 + i))
    const v = validateSeries(quote(bars), DEFAULT_BACKTEST_CONFIG)
    expect(v.ok).toBe(false)
    expect(v.reasons.some((r) => r.includes("sessions"))).toBe(true)
  })

  it("flags OHLC violations, Saturday sessions and duplicate dates", () => {
    const bars = [
      bar("2025-01-05", 100), // Sunday
      bar("2025-01-06", 101, { high: 90 }), // high < close -> violation
      bar("2025-01-07", 102),
      bar("2025-01-11", 103), // Saturday -> violation
      bar("2025-01-07", 102), // duplicate
    ]
    const v = validateSeries(quote(bars), DEFAULT_BACKTEST_CONFIG)
    expect(v.stats.ohlcViolations).toBe(1)
    expect(v.stats.weekdayViolations).toBe(1)
    expect(v.stats.duplicateDates).toBe(1)
    expect(v.stats.sessions).toBe(4)
    expect(v.ok).toBe(false)
  })

  it("adjusted rows use adjClose when present", () => {
    const bars = [bar("2025-01-05", 100, { adjClose: 95 }), bar("2025-01-06", 101, { adjClose: 96 })]
    const v = validateSeries(quote(bars), DEFAULT_BACKTEST_CONFIG)
    expect(v.rows[0].close).toBe(95)
    expect(v.rows[1].close).toBe(96)
  })
})

describe("crossCheckSplits — frozen corporate-actions math", () => {
  it("frozen adjustPrevClose matches rawPrev/ratio and Yahoo implied factor", () => {
    // 2-for-1 split on 2025-01-06: raw closes 200 -> 100; adjClose continuous at 100
    const bars = [
      bar("2025-01-05", 200, { adjClose: 100 }),
      bar("2025-01-06", 100, { adjClose: 100 }),
    ]
    const v = validateSeries(quote(bars), DEFAULT_BACKTEST_CONFIG)
    const checks = crossCheckSplits(quote(bars, [{ date: "2025-01-06", numerator: 2, denominator: 1 }]), v)
    expect(checks).toHaveLength(1)
    const c = checks[0]
    expect(c.splitRatio).toBe(2)
    expect(c.frozenMatch).toBe(true)
    expect(c.frozenAdjPrev).toBeCloseTo(100, 10) // 200 / 2
    expect(c.yahooMatch).toBe(true) // factor 0.5 -> 0.5/1 -> implied 2.0... see below
    expect(c.yahooImpliedRatio as number).toBeCloseTo(2, 10)
  })

  it("mismatch is detectable (wrong ratio in events)", () => {
    const bars = [
      bar("2025-01-05", 200, { adjClose: 100 }),
      bar("2025-01-06", 100, { adjClose: 100 }),
    ]
    const v = validateSeries(quote(bars), DEFAULT_BACKTEST_CONFIG)
    const checks = crossCheckSplits(quote(bars, [{ date: "2025-01-06", numerator: 3, denominator: 1 }]), v)
    expect(checks[0].frozenMatch).toBe(true) // frozen math still matches its own formula (200/3)
    expect(checks[0].frozenAdjPrev).toBeCloseTo(200 / 3, 10)
    expect(checks[0].yahooMatch).toBe(false) // but disagrees with the market factor
  })
})
