// =============================================================================
// Canonical metric parity — remediation 2026-11-15.
//
// THE DEFECT THIS PINS: the signals board's metric chips (RSI, Vol×, Range,
// 1M perf) were read from the close-only engine's `metrics` object while the
// company technical tab rendered the full OHLC snapshot. The same stock could
// therefore show two different RSI numbers on two pages of the same product.
//
// THE CONTRACT NOW: the canonical stance carries a `metrics` block built from
// the FULL OHLC snapshot (buildCanonicalMetrics). The board overlays that block
// onto its row, so board chips and tab values come from one computation.
//
// These tests assert the contract at the pure-function level (no DB, no HTTP):
//   1. every metric is read from the snapshot, not re-derived
//   2. a metric the snapshot cannot produce is null — never substituted
//   3. the block is stable and definitionally pinned
// =============================================================================

import { describe, expect, it } from "vitest"
import { buildCanonicalMetrics, computeStanceFromSnapshot, type CanonicalMetrics } from "../signals"
import type { TechnicalSnapshot } from "../analyze"

const emptySnapshot = (over: Partial<TechnicalSnapshot> = {}): TechnicalSnapshot =>
  ({
    version: "technical@4",
    available: true,
    asOf: "2026-11-13",
    sessions: 250,
    firstSession: "2025-11-01",
    lastClose: 110,
    currency: "EGP",
    sparse: false,
    adjustedActions: null,
    limitations: [],
    perf: { d1: 1.5, w1: 3.2, m1: 8.4, m3: 21.0, m6: null, y1: null },
    trend: {
      ema20: 107, ema50: 100, ema200: 90,
      priceVsEma20: "above", priceVsEma50: "above", priceVsEma200: "above",
      ema20VsEma50: "above", ema50VsEma200: "above",
      alignment: "aligned_uptrend", cross50200: "golden", cross50200Age: 30,
    },
    momentum: { rsi14: 55, macd: { macd: 2, signal: 1, histogram: 1 }, stochastic: { k: 60, d: 40 } },
    volume: { obv: 1, obvSlope20: 500, volMa20: 1000, relVol: 2.5, volumeWindow: 20 },
    volatility: {
      atr14: 2.7, atrPct: 2.5,
      bollinger: { upper: null, middle: null, lower: null, widthPct: null, percentB: null },
      histVol20: null,
    },
    levels: { supports: [], resistances: [] },
    structure: null,
    vsa: null,
    zones: null,
    context: null,
    quality: null,
    range60: { high: 112, low: 105, posPct: 71.4, sessions: 60 },
    signals: [],
    ...over,
  }) as TechnicalSnapshot

describe("buildCanonicalMetrics — every value comes from the snapshot", () => {
  it("reads RSI / EMA / MACD / relVol / perf / range straight off the snapshot", () => {
    const m = buildCanonicalMetrics(emptySnapshot())
    expect(m.rsi14).toBe(55)
    expect(m.ema20).toBe(107)
    expect(m.ema50).toBe(100)
    expect(m.macdLine).toBe(2)
    expect(m.macdHist).toBe(1)
    expect(m.relVol).toBe(2.5)
    expect(m.perfW1).toBe(3.2)
    expect(m.perfM1).toBe(8.4)
    expect(m.perfM3).toBe(21.0)
    expect(m.rangePos60).toBe(71.4)
    expect(m.obvSlope20).toBe(500)
  })

  it("a metric the snapshot cannot produce is null — never substituted", () => {
    const m = buildCanonicalMetrics(
      emptySnapshot({
        momentum: { rsi14: null, macd: { macd: null, signal: null, histogram: null }, stochastic: { k: null, d: null } },
        volume: { obv: null, obvSlope20: null, volMa20: null, relVol: null, volumeWindow: null },
        range60: { high: null, low: null, posPct: null, sessions: 0 },
      }),
    )
    expect(m.rsi14).toBeNull()
    expect(m.macdLine).toBeNull()
    expect(m.macdHist).toBeNull()
    expect(m.relVol).toBeNull()
    expect(m.rangePos60).toBeNull()
    expect(m.obvSlope20).toBeNull()
  })

  it("dailyVolPct is null unless the caller supplies the SAME statistic", () => {
    // the snapshot exposes histVol20 (annualized log-return sd) which is a
    // DIFFERENT number — it must never be silently substituted
    expect(buildCanonicalMetrics(emptySnapshot()).dailyVolPct).toBeNull()
    expect(buildCanonicalMetrics(emptySnapshot(), 1.87).dailyVolPct).toBe(1.87)
  })

  it("non-finite and undefined inputs degrade to null, never NaN", () => {
    const m = buildCanonicalMetrics(
      emptySnapshot({
        momentum: { rsi14: Number.NaN, macd: { macd: Number.POSITIVE_INFINITY, signal: null, histogram: null }, stochastic: { k: null, d: null } },
      }),
    )
    expect(m.rsi14).toBeNull()
    expect(m.macdLine).toBeNull()
    for (const v of Object.values(m) as (number | null)[]) {
      expect(v === null || Number.isFinite(v)).toBe(true)
    }
  })
})

describe("canonical stance carries the metric block (board ⇄ tab parity)", () => {
  it("computeStanceFromSnapshot emits metrics matching the snapshot it read", () => {
    const snap = emptySnapshot()
    const stance = computeStanceFromSnapshot(snap)
    expect(stance.metrics).toBeDefined()
    const m = stance.metrics as CanonicalMetrics
    // the board overlays exactly this block — so board chip == tab value
    expect(m.rsi14).toBe(snap.momentum.rsi14)
    expect(m.relVol).toBe(snap.volume.relVol)
    expect(m.rangePos60).toBe(snap.range60.posPct)
    expect(m.ema20).toBe(snap.trend.ema20)
    expect(m.perfM1).toBe(snap.perf.m1)
  })

  it("the metric block is identical across two computations of the same snapshot", () => {
    const snap = emptySnapshot()
    const a = computeStanceFromSnapshot(snap).metrics
    const b = computeStanceFromSnapshot(snap).metrics
    expect(a).toEqual(b)
  })

  it("an unavailable snapshot yields no metric block to display", () => {
    const stance = computeStanceFromSnapshot(
      emptySnapshot({ available: false, lastClose: null }),
    )
    expect(stance.score).toBeNull()
    expect(stance.signal).toBeNull()
    // no fabricated numbers for a company with no history
    expect(stance.metrics ?? null).toBeNull()
  })
})
