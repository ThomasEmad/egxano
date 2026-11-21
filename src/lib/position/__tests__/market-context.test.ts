// =============================================================================
// MarketContext tests — the honest-input layer for حلل سهمي. Fixtures are
// synthetic bar series with ENGINEERED geometry (mirroring bars-fixture.ts
// style): every asserted value is either an exact integer/string or pinned
// with toBeCloseTo at FP-safe precision. The global honesty gate (21 bars),
// the warm-up rules (EMA20 → 40, EMA50 → 100) and every module abstention
// (ADX 28, divergence 30, candles 21, VSA volume baseline) are asserted as
// NULLS — the context never invents a number.
// =============================================================================

import { describe, expect, it } from "vitest"
import type { Bar } from "@/lib/signals/types"
import { buildMarketContext, type MarketContext, type MetricsLike } from "../market-context"

// ---- fixture helpers -------------------------------------------------------

let seq = 0
function mkBar(open: number, high: number, low: number, close: number, volume: number | null = 1000): Bar {
  seq++
  return { ts: `2026-01-01#${String(seq).padStart(4, "0")}`, open, high, low, close, volume }
}

function metrics(over: Partial<MetricsLike> = {}): MetricsLike {
  return { rsi14: null, ema20: null, ema50: null, atr14: null, relVol: null, rangePos60: null, ...over }
}

/** Monotone trend series: closes = start + step·i, open = previous close,
 *  wicks ±`wick` around the open/close extremes. With step > 0 the geometry
 *  gives +DM every bar and −DM = 0 (perfect uptrend → ADX ≈ 100). */
function trendSeries(count: number, start: number, step: number, wick = 0.15, volume: number | null = 1000): Bar[] {
  const closes: number[] = Array.from({ length: count }, (_, i) => start + step * i)
  return closes.map((c, i) => {
    const o = i === 0 ? c + step : closes[i - 1]
    return mkBar(o, Math.max(o, c) + wick, Math.min(o, c) - wick, c, volume)
  })
}

/** Sideways series: every session closes at `close`, ±`wick` range. */
function flatSeries(count: number, close = 10, wick = 0.15, volume: number | null = 1000): Bar[] {
  return Array.from({ length: count }, () => mkBar(close, close + wick, close - wick, close, volume))
}

// =============================================================================
// (a) spike-volume day closing at its high
// =============================================================================

describe("buildMarketContext — last-bar anatomy + volume character", () => {
  it("(a) spike volume + close AT the high → volCharacter «spike», closeLocationPct = 100, zero upper shadow", () => {
    const bars = trendSeries(59, 10, 0.01, 0.2)
    bars.push(mkBar(10.55, 10.6, 10.0, 10.6, 5000)) // close = high, range 0.6
    const ctx = buildMarketContext(bars, metrics({ relVol: 3.0 }))
    expect(ctx.volCharacter).toBe("spike") // 3.0 ≥ 2.5
    expect(ctx.closeLocationPct).toBe(100) // (high − low) / (high − low) — exact
    expect(ctx.upperShadowPct).toBe(0) // high = max(open, close)
  })

  it("(g) doji-shaped flat bar (high === low) → closeLocationPct + shadows null, no candle pattern", () => {
    const bars = trendSeries(24, 10, 0.02, 0.15)
    bars.push(mkBar(10.5, 10.5, 10.5, 10.5)) // scanner-style placeholder: O = H = L = C
    const ctx = buildMarketContext(bars, metrics({ atr14: 0.4 }))
    expect(ctx.closeLocationPct).toBeNull()
    expect(ctx.upperShadowPct).toBeNull()
    expect(ctx.lowerShadowPct).toBeNull()
    expect(ctx.bodyVsAtr).toBe(0) // zero body over a valid ATR — honest zero, not null
    expect(ctx.candlePatternAr).toBeNull() // the candle module skips flat bars
  })
})

// =============================================================================
// (b) hammer-shaped bar after a decline → «مطرقة»
// =============================================================================

describe("buildMarketContext — candle pattern (last session only)", () => {
  it("(b) hammer shape after a decline → «مطرقة» with exact shadow percentages", () => {
    // 24 declining sessions (trend gate reads "down"), then the hammer:
    // body 0.5, lower shadow 1.0, upper shadow 0.1, range 1.6
    const closes: number[] = Array.from({ length: 24 }, (_, i) => 12 - 0.08 * i)
    const bars = closes.map((c, i) => {
      const o = i === 0 ? c + 0.08 : closes[i - 1]
      return mkBar(o, Math.max(o, c) + 0.15, Math.min(o, c) - 0.15, c)
    })
    bars.push(mkBar(10.5, 10.6, 9.0, 10.0))
    const ctx = buildMarketContext(bars, metrics())
    expect(ctx.candlePatternAr).toBe("مطرقة")
    expect(ctx.lowerShadowPct).toBeCloseTo(62.5, 8) // 1.0 / 1.6 × 100
    expect(ctx.upperShadowPct).toBeCloseTo(6.25, 8) // 0.1 / 1.6 × 100
    expect(ctx.closeLocationPct).toBeCloseTo(62.5, 8) // (10.0 − 9.0) / 1.6 × 100
  })
})

// =============================================================================
// (c) rolling-EMA fields on a 40-bar uptrend (warm-up boundary pinned)
// =============================================================================

describe("buildMarketContext — rolling EMA stretch + days above/below", () => {
  it("(c) 40-bar uptrend → daysAboveEma20 = 1 (warm-up = 40), stretch positive, EMA50 fields still null", () => {
    const bars = trendSeries(40, 10, 0.1, 0.25)
    const ctx = buildMarketContext(bars, metrics({ atr14: 0.5 }))
    expect(ctx.daysAboveEma20).toBe(1) // only session 40 (index 39) is past the warm-up
    expect(ctx.emaStretch20Atr).not.toBeNull()
    expect(ctx.emaStretch20Atr!).toBeGreaterThan(0) // a rising close sits above its own EMA20
    expect(ctx.emaStretch50Atr).toBeNull() // EMA50 warm-up is 100 sessions
    expect(ctx.daysBelowEma50).toBeNull()
    expect(ctx.bodyVsAtr).toBeCloseTo(0.2, 8) // |13.9 − 13.8| / 0.5
  })

  it("(k) ADX adapter: perfect uptrend → ADX ≈ 100 «strong»; perfect standoff → ADX 0 «weak»", () => {
    const up = buildMarketContext(trendSeries(40, 10, 0.1, 0.25), metrics())
    expect(up.adx).toBeCloseTo(100, 6) // DI+ only → DX = 100 every session
    expect(up.adxStrength).toBe("strong")
    // alternating up/down closes with EVERY bar sharing the SAME high/low
    // (10.5 / 9.9): DM+ = DM− = 0 on every transition → DI± = 0 → DX = 0
    const standoff: Bar[] = []
    for (let i = 0; i < 30; i++) {
      const c = i % 2 === 0 ? 10.0 : 10.4
      const o = i === 0 ? c : standoff[i - 1].close
      standoff.push(mkBar(o, 10.5, 9.9, c))
    }
    const flat = buildMarketContext(standoff, metrics())
    expect(flat.adx).toBe(0)
    expect(flat.adxStrength).toBe("weak") // < 20 per the contract ladder
  })
})

// =============================================================================
// (d) streak counting
// =============================================================================

describe("buildMarketContext — streaks", () => {
  it("(d) three green closes after a flat one → streakUp = 3, streakDown = 0", () => {
    const closes: number[] = [...Array.from({ length: 18 }, (_, i) => 9.0 + 0.05 * i), 9.9, 10.0, 10.0, 10.2, 10.4, 10.6]
    const bars = closes.map((c, i) => mkBar(i === 0 ? c : closes[i - 1], c + 0.2, c - 0.2, c))
    const ctx = buildMarketContext(bars, metrics())
    expect(ctx.streakUp).toBe(3) // 10.0→10.2→10.4→10.6; the unchanged close ends the walk
    expect(ctx.streakDown).toBe(0)
  })
})

// =============================================================================
// (e) gap day
// =============================================================================

describe("buildMarketContext — gapPct", () => {
  it("(e) a +2% gap-up open is reported (signed); a 0.5% open is drift → null", () => {
    const gapped = flatSeries(24)
    gapped.push(mkBar(10.2, 10.45, 10.1, 10.3)) // prevClose 10.0, open 10.2
    expect(buildMarketContext(gapped, metrics()).gapPct).toBeCloseTo(2, 8)

    const drifted = flatSeries(24)
    drifted.push(mkBar(10.05, 10.2, 9.95, 10.1)) // +0.5% — below the 1% doctrine bar
    expect(buildMarketContext(drifted, metrics()).gapPct).toBeNull()
  })
})

// =============================================================================
// (f) honesty gates — short series / missing metrics
// =============================================================================

describe("buildMarketContext — honesty gates (nulls, never invented numbers)", () => {
  it("(f) 10 bars + null metrics → EVERY field null (below the 21-session honesty gate)", () => {
    const ctx = buildMarketContext(trendSeries(10, 10, 0.05, 0.15), null)
    for (const [key, value] of Object.entries(ctx)) {
      // lastSynthetic is a data-provenance FLAG, not a market reading — it is
      // always honestly computable from the bar itself (false = full OHLC).
      if (key === "lastSynthetic") {
        expect(value, key).toBe(false)
        continue
      }
      expect(value, key).toBeNull()
    }
  })

  it("(f2) null metrics on 25 bars → metric-derived + long-window fields null, bar anatomy still honest", () => {
    const ctx = buildMarketContext(trendSeries(25, 10, 0.05, 0.15), metrics())
    expect(ctx.bodyVsAtr).toBeNull()
    expect(ctx.volCharacter).toBeNull()
    expect(ctx.rsiZone).toBeNull()
    expect(ctx.nearRangeTop).toBeNull()
    expect(ctx.nearRangeBottom).toBeNull()
    expect(ctx.emaStretch20Atr).toBeNull() // EMA20 warm-up = 40
    expect(ctx.emaStretch50Atr).toBeNull()
    expect(ctx.daysAboveEma20).toBeNull()
    expect(ctx.daysBelowEma50).toBeNull()
    expect(ctx.adx).toBeNull() // computeAdx abstains below 28 sessions
    expect(ctx.adxStrength).toBeNull()
    expect(ctx.divergence).toBeNull() // divergence abstains below 30 sessions
    expect(ctx.vsaNoteAr).toBeNull() // VSA has no volume baseline yet
    expect(ctx.candlePatternAr).toBeNull() // no pattern matches this plain drift bar
    // the single-bar anatomy is still fully supported
    expect(ctx.closeLocationPct).not.toBeNull()
    expect(ctx.streakUp).toBe(24) // every close rises — 25 sessions, 24 up-moves
    expect(ctx.streakDown).toBe(0)
  })
})

// =============================================================================
// (h) VSA note — newest event, real number named
// =============================================================================

describe("buildMarketContext — vsaNoteAr", () => {
  it("(h) low-volume up-close at the high on the last session → the no_demand note with the real 0.5×", () => {
    const bars: Bar[] = []
    for (let i = 0; i < 44; i++) bars.push(mkBar(10, 10.05, 9.95, 10, i < 35 ? 1000 : 500))
    bars.push(mkBar(10, 10.5, 9.95, 10.5, 500)) // up close, closeLoc = 1.0, volRatio = 0.5
    const ctx = buildMarketContext(bars, metrics())
    expect(ctx.vsaNoteAr).toBe("صعود بفوليوم ضعيف (0.5× المتوسط فقط) — حركة غير موثوقة")
  })
})

// =============================================================================
// (i) divergence — bullish fixture (lower price low + higher RSI low)
// =============================================================================

describe("buildMarketContext — divergence", () => {
  // Same engineered closes as the divergence module's own fixture: crash to a
  // low @19, recover, grind to a LOWER low @42 → bullish RSI divergence
  // confirmed at index 45, still active at session 51.
  it("(i) confirmed bullish divergence is surfaced; a thin 29-session prefix abstains → null", () => {
    const closes: number[] = []
    let p = 100
    for (let i = 0; i < 10; i++) { p *= 1.012; closes.push(Math.round(p * 100) / 100) }
    for (let i = 10; i < 20; i++) { p *= 0.955; closes.push(Math.round(p * 100) / 100) }
    for (let i = 20; i < 28; i++) { p *= 1.02; closes.push(Math.round(p * 100) / 100) }
    for (let i = 28; i < 43; i++) { p *= 0.988; closes.push(Math.round(p * 100) / 100) }
    for (let i = 43; i < 51; i++) { p *= 1.01; closes.push(Math.round(p * 100) / 100) }
    const bars = closes.map((c, i) => mkBar(i === 0 ? c : closes[i - 1], c + 0.1, c - 0.1, c))
    expect(buildMarketContext(bars, metrics()).divergence).toBe("bullish")
    expect(buildMarketContext(bars.slice(0, 29), metrics()).divergence).toBeNull()
  })
})

// =============================================================================
// (j) metric-zone boundaries — the doctrine thresholds, both edges
// =============================================================================

describe("buildMarketContext — zone boundaries", () => {
  const base = () => flatSeries(25)

  it("(j1) rsiZone ladder: <30 oversold · <45 weak · ≤55 neutral · <70 strong · ≥70 overbought", () => {
    const cases: Array<[number, NonNullable<MarketContext["rsiZone"]>]> = [
      [25, "oversold"],
      [30, "weak"], // the boundary belongs to the upper band
      [44.9, "weak"],
      [45, "neutral"],
      [55, "neutral"],
      [55.1, "strong"],
      [69.9, "strong"],
      [70, "overbought"],
    ]
    for (const [rsi, zone] of cases) {
      expect(buildMarketContext(base(), metrics({ rsi14: rsi })).rsiZone, `rsi ${rsi}`).toBe(zone)
    }
  })

  it("(j2) volCharacter ladder: <0.7 dry · <1.3 normal · <2.5 elevated · ≥2.5 spike", () => {
    const cases: Array<[number, NonNullable<MarketContext["volCharacter"]>]> = [
      [0.69, "dry"],
      [0.7, "normal"],
      [1.29, "normal"],
      [1.3, "elevated"],
      [2.49, "elevated"],
      [2.5, "spike"],
    ]
    for (const [relVol, character] of cases) {
      expect(buildMarketContext(base(), metrics({ relVol })).volCharacter, `relVol ${relVol}`).toBe(character)
    }
  })

  it("(j3) range edges: ≥90 presses the top, ≤10 presses the bottom, in between is no claim", () => {
    const top = buildMarketContext(base(), metrics({ rangePos60: 90 }))
    expect(top.nearRangeTop).toBe(true)
    expect(top.nearRangeBottom).toBe(false)
    const bottom = buildMarketContext(base(), metrics({ rangePos60: 10 }))
    expect(bottom.nearRangeTop).toBe(false)
    expect(bottom.nearRangeBottom).toBe(true)
    const justOff = buildMarketContext(base(), metrics({ rangePos60: 10.1 }))
    expect(justOff.nearRangeTop).toBe(false)
    expect(justOff.nearRangeBottom).toBe(false)
    const middle = buildMarketContext(base(), metrics({ rangePos60: 50 }))
    expect(middle.nearRangeTop).toBe(false)
    expect(middle.nearRangeBottom).toBe(false)
  })
})

// =============================================================================
// (l) roundLevelNear — «الأرقام المستديرة»: grid ladder + 20%-step cap + 2% band
// =============================================================================

describe("buildMarketContext — roundLevelNear", () => {
  it("(l1) close 208.18: the 25/20 grids have nothing inside 2% → the walk lands on the 10-grid's 210 at ≈0.87%", () => {
    const ctx = buildMarketContext(flatSeries(25, 208.18), metrics())
    expect(ctx.roundLevelNear).not.toBeNull()
    expect(ctx.roundLevelNear!.level).toBe(210) // 21 × 10 — exact integer grid arithmetic
    expect(ctx.roundLevelNear!.distPct).toBeCloseTo((210 - 208.18) / 208.18 * 100, 10)
    expect(ctx.roundLevelNear!.distPct).toBeCloseTo(0.87, 2) // ≈ 0.874% — inside the 2% band
  })

  it("(l2) the largest-step-≤20% rule verified by hand at several magnitudes; 3.4 → null", () => {
    // 12.6: 20% = 2.52 → start step 2.5 → 12.5 at 0.79% ✓
    const mid = buildMarketContext(flatSeries(25, 12.6), metrics())
    expect(mid.roundLevelNear!.level).toBeCloseTo(12.5, 10)
    expect(mid.roundLevelNear!.distPct).toBeCloseTo(0.1 / 12.6 * 100, 10)
    // 96: 20% = 19.2 → start step 10 → 100 at 4.17% ✗ → step 5 → 95 at 1.04% ✓
    const high = buildMarketContext(flatSeries(25, 96), metrics())
    expect(high.roundLevelNear!.level).toBe(95)
    expect(high.roundLevelNear!.distPct).toBeCloseTo(1 / 96 * 100, 10)
    // 47.3: start step 5 → 45 at 4.86% ✗ → step 2.5 → 47.5 at 0.42% ✓
    const odd = buildMarketContext(flatSeries(25, 47.3), metrics())
    expect(odd.roundLevelNear!.level).toBeCloseTo(47.5, 10)
    expect(odd.roundLevelNear!.distPct).toBeCloseTo(0.2 / 47.3 * 100, 10)
    // 3.4: 20% = 0.68 → step 0.5 → 3.5 at 2.94% ✗ → step 0.25 → 3.5 again ✗ → null
    const tiny = buildMarketContext(flatSeries(25, 3.4), metrics())
    expect(tiny.roundLevelNear).toBeNull()
  })

  it("(l3) standing exactly on a level → distPct 0, at every magnitude (50 on the 10-grid · 8 on the 1-grid · 3.5 on the 0.5-grid)", () => {
    const closes = [50, 8, 3.5] // 50 pins the inclusive cap: step 10 = exactly 20% of the price
    for (const close of closes) {
      const ctx = buildMarketContext(flatSeries(25, close), metrics())
      expect(ctx.roundLevelNear, `close ${close}`).toEqual({ level: close, distPct: 0 })
    }
  })
})

// =============================================================================
// (m) consolidation — «التجميعة»: 5-session gate, backward walk, 20-session cap
// =============================================================================

describe("buildMarketContext — consolidation", () => {
  function closesSeries(closes: number[]): Bar[] {
    return closes.map((c, i) => mkBar(i === 0 ? c : closes[i - 1], c + 0.2, c - 0.2, c))
  }

  it("(m1) six flat closes after a stretch far below → {sessions: 6, tightnessPct: 0}; a trending tape → null", () => {
    const flat6 = buildMarketContext(closesSeries([...Array.from({ length: 19 }, () => 9.5), ...Array.from({ length: 6 }, () => 11)]), metrics())
    expect(flat6.consolidation).toEqual({ sessions: 6, tightnessPct: 0 }) // the 7th-back (9.5) breaks the walk
    const trending = buildMarketContext(trendSeries(25, 10, 0.2, 0.15), metrics())
    expect(trending.consolidation).toBeNull() // last-5 spread 0.8 / 14.8 ≈ 5.4% > 3%
  })

  it("(m2) the walk caps at 20 sessions on a 30-session flat tape; a broken 6th-back pins sessions 5 with the real spread", () => {
    const capped = buildMarketContext(flatSeries(30, 10), metrics())
    expect(capped.consolidation).toEqual({ sessions: 20, tightnessPct: 0 })
    // last 5 closes spread 0.2 (10.1 − 9.9) over close 10.05 ≈ 1.99% ✓; the 6th-back (12.0) blows it
    const pinned = buildMarketContext(closesSeries([...Array.from({ length: 19 }, () => 12), 12, 9.9, 10.1, 10, 10.1, 10.05]), metrics())
    expect(pinned.consolidation).not.toBeNull()
    expect(pinned.consolidation!.sessions).toBe(5)
    expect(pinned.consolidation!.tightnessPct).toBeCloseTo((10.1 - 9.9) / 10.05 * 100, 10)
    expect(pinned.consolidation!.tightnessPct).toBeCloseTo(1.99, 2)
  })
})

// =============================================================================
// (n) volTrend5 — «الفوليوم بيكلم قبل السعر»: 5× recent vs 30× baseline
// =============================================================================

describe("buildMarketContext — volTrend5", () => {
  /** Flat tape with an exact per-session volume script — closes irrelevant. */
  function volSeries(volumes: Array<number | null>, close = 10): Bar[] {
    return volumes.map((v) => mkBar(close, close + 0.15, close - 0.15, close, v))
  }
  const base30 = (): Array<number | null> => Array.from({ length: 30 }, () => 1000)

  it("(n1) ratio ladder: 1.5× rising · 0.5× falling · 1.0× flat; boundaries inclusive (1.3 rising, 0.7 falling), 1.29/0.71 flat", () => {
    const cases: Array<[number, NonNullable<MarketContext["volTrend5"]>]> = [
      [1500, "rising"],
      [1300, "rising"], // exactly 1.3 → the boundary belongs to "rising"
      [1290, "flat"], // 1.29 — between the bands
      [1000, "flat"], // 1.0
      [710, "flat"], // 0.71
      [700, "falling"], // exactly 0.7 → the boundary belongs to "falling"
      [500, "falling"],
    ]
    for (const [vol, trend] of cases) {
      expect(buildMarketContext(volSeries([...base30(), ...Array.from({ length: 5 }, () => vol)]), metrics()).volTrend5, `recent vol ${vol}`).toBe(trend)
    }
  })

  it("(n2) honesty: 34 bars → null · a null-volume hole in the window → null · all-zero baseline → null · zero recent over a live baseline → falling", () => {
    expect(buildMarketContext(volSeries(Array.from({ length: 34 }, () => 1000)), metrics()).volTrend5).toBeNull()
    const holed = [...base30(), ...Array.from({ length: 5 }, () => 1500)] // 35 complete...
    holed[10] = null // ...but one baseline session missing its volume voids the read
    expect(buildMarketContext(volSeries(holed), metrics()).volTrend5).toBeNull()
    expect(buildMarketContext(volSeries([...Array.from({ length: 30 }, () => 0), ...Array.from({ length: 5 }, () => 5000)]), metrics()).volTrend5).toBeNull()
    expect(buildMarketContext(volSeries([...base30(), ...Array.from({ length: 5 }, () => 0)]), metrics()).volTrend5).toBe("falling") // ratio 0 ≤ 0.7
  })
})

// =============================================================================
// (o) the global honesty gate covers the lexicon trio too
// =============================================================================

describe("buildMarketContext — lexicon trio vs the 21-session gate", () => {
  it("(o) 10 bars → roundLevelNear, consolidation, volTrend5 all null (never invented)", () => {
    const ctx = buildMarketContext(trendSeries(10, 10, 0.05, 0.15), metrics())
    expect(ctx.roundLevelNear).toBeNull()
    expect(ctx.consolidation).toBeNull()
    expect(ctx.volTrend5).toBeNull()
  })
})
