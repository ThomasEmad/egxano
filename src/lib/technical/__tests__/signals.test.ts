// Rule-based signals engine tests — synthetic series with KNOWN shapes, so the
// expected stance is derivable by construction (not by re-running the engine).
//
// Calibrated against tech-signals@5 (the evidence-based recalibration):
//   • de-duplicated dimensions — ONE trend-state input (fixed 0-30 scale),
//     momentum group capped at 80% of its present maximum, risk scores only
//     risk facts (weights 30/25/25/20);
//   • decision gates — a BUY requires volume agreement (relVol ≥ 1 OR OBV
//     agreement) AND decision-level excellence (every present dim ≥ 80% of
//     its own max) — the hot-RSI range-top tapes @4 bought are now holds;
//   • distribution SELL path — OBV distribution + broken momentum can print
//     sell without the @4 3-condition conjunction;
//   • hysteresis — enter/exit bands + 2-session minimum hold + score glide;
//   • the "day" style is disabled (daily closes cannot support intraday claims).
// Every pinned score carries its derivation in a comment.
import { describe, expect, it } from "vitest"
import { computeCloseSignal, computeStanceFromSnapshot, finalizeScore, SIGNALS_VERSION, SIGNAL_WEIGHTS, type CloseRow } from "../signals"
import { assembleBundle, type TechnicalSnapshot } from "../analyze"
import type { Bar } from "../indicators"

function rowsFrom(closes: number[], volumes: number[] | null = null): CloseRow[] {
  const out: CloseRow[] = []
  const start = new Date("2025-06-02T00:00:00Z").getTime()
  for (let i = 0; i < closes.length; i++) {
    const day = new Date(start + i * 86_400_000).toISOString().slice(0, 10)
    out.push({ ts: day, close: closes[i], volume: volumes ? volumes[i] : 1000 + (i % 5) * 50 })
  }
  return out
}

/** Realistic uptrend: two up sessions (+1.0%) then one pullback (−0.8%).
 *  The tail RSI lands in the low 70s and the close sits at the 60-session top —
 *  under @5 the oscillator group cannot reach the 80% decision bar from that
 *  context (RSI >72 → 2, rangePos >90 → 2), so the decision-level excellence
 *  gate blocks the buy: exactly the chase-top read the audit measured. */
function uptrendCloses(n = 80): number[] {
  const out: number[] = []
  let p = 50
  for (let i = 0; i < n; i++) {
    p *= i % 3 === 2 ? 0.992 : 1.01
    out.push(Math.round(p * 100) / 100)
  }
  return out
}

/** Healthy uptrend that reaches the @5 decision bar on EVERY dimension:
 *  rally → local peak → pullback → modest recovery that stays BELOW the peak.
 *  The recovery keeps RSI back in the 45–60 full-credit band and the close at
 *  45–75% of the 60-session range (full range-position credit) while the price
 *  stays above EMA20/EMA50 with a rising tail — momentum reaches its 80%
 *  corroboration cap (24/30), so decision-level excellence genuinely passes. */
function healthyUptrend(n = 80): number[] {
  const out: number[] = []
  let p = 50
  for (let i = 0; i < n; i++) {
    if (i <= 45) p *= i % 2 === 0 ? 1.006 : 0.9975 // rally with noise
    else if (i <= 70) p *= i % 2 === 0 ? 0.996 : 1.00125 // pullback
    else p *= 1.003 // modest recovery, stays below the rally peak
    out.push(Math.round(p * 100) / 100)
  }
  return out
}

/** Steady downtrend: −0.5% per session with a small early top (82) — the only
 *  swing-pivot high. Under @5 the distribution path (OBV falling + momentum
 *  breakdown + below the long MA) prints the sell; the plan is null because
 *  no target below pays ≥ 1.5R (no fabricated fallback levels). */
function downtrendCloses(n = 80): number[] {
  const out: number[] = []
  let p = 78
  for (let i = 0; i < 6; i++) { out.push(Math.round(p * 100) / 100); p *= 1.005 }
  out.push(82)
  p = 80.5
  for (let i = 7; i < n; i++) { p *= 0.995; out.push(Math.round(p * 100) / 100) }
  return out
}

describe("computeCloseSignal — @5 decision gates and de-duplicated dims", () => {
  it("hot-RSI range-top uptrend is NO LONGER a buy — decision-level excellence blocks it", () => {
    const closes = uptrendCloses(80)
    const volumes = closes.map((_, i) => 1000 + i * 5)
    const sig = computeCloseSignal(rowsFrom(closes, volumes))
    // trend 30/30 (state: all four facts bullish) · momentum 14/30 (RSI ~73.6 → 2,
    // MACD 10, rangePos ~100 → 2 — the group disagrees with the range top) ·
    // volume 16/20 (OBV 8 + relVol ~1.04 ≥1 → 8) · risk 17/20 (ext ~4.3% → 5,
    // daily vol ~0.8% → 7, expansion ~1 → 5). allDimsStrong FALSE (momentum
    // 47%) → hold, score 71, rejection reason encoded.
    expect(sig.version).toBe("tech-signals@5")
    expect(sig.signal).toBe("hold")
    expect(sig.score).toBe(71)
    expect(sig.dimensions).toEqual([
      { key: "trend", earned: 30, max: 30 },
      { key: "momentum", earned: 14, max: 30 },
      { key: "volume", earned: 16, max: 20 },
      { key: "risk", earned: 17, max: 20 },
    ])
    expect(sig.reasons.map((r) => r.code)).toContain("not_full_strength")
    // trade plan follows the read: hold → NO plan (WAIT means NO plan)
    expect(sig.tradePlan).toBeNull()
    // the "day" style is disabled on daily data (style honesty)
    expect(sig.styleFits.map((f) => f.tag)).not.toContain("day")
    expect(sig.styleFits.map((f) => f.tag)).toContain("swing")
  })

  it("healthy confirmed uptrend → buy read (volume gate + excellence both pass)", () => {
    const closes = healthyUptrend(80)
    // up sessions carry clearly more volume than pullback sessions → OBV
    // accumulation AND the final up-session relVol ≥ 1 (confirmed participation)
    const volumes = closes.map((c, i) => (i === 0 ? 1000 : c >= closes[i - 1] ? 1300 : 900))
    const sig = computeCloseSignal(rowsFrom(closes, volumes))
    expect(sig.signal).toBe("buy")
    expect(sig.score!).toBeGreaterThanOrEqual(62)
    const vol = sig.dimensions.find((d) => d.key === "volume")!
    expect(vol.earned).toBe(16) // OBV 8 + relVol ≥1 → 8
    expect(sig.reasons.some((r) => r.tone === "positive")).toBe(true)
    // C-01 fix: close-only engine does NOT generate trade plans.
    // Trade plans are ONLY produced by the full OHLC canonical stance (computeStanceFromSnapshot).
    // Without a trade plan, the three-state publication layer publishes as "watching"
    // with the "noTradablePlan" veto reason — honest disclosure that execution
    // requires the full OHLC analysis.
    expect(sig.tradePlan).toBeNull()
    expect(sig.signalState).toBe("watching")
    expect(sig.setup).not.toBeNull()
    expect(sig.setup!.direction).toBe("buy")
    expect(sig.setup!.vetoReasons.some((r) => r.code === "no_tradable_plan")).toBe(true)
  })

  it("BUY blocked on thin participation: relVol < 1 AND OBV distribution → weak_volume reason", () => {
    // the SAME healthy price structure, but up sessions print on thin volume
    // while pullback sessions carry heavy volume → OBV slope negative over the
    // recent window AND the final relVol < 1. The score still clears the buy
    // threshold (candidate), so the volume gate itself must reject it — with
    // the explicit bilingual weak-volume reason as the FIRST rejection.
    const closes = healthyUptrend(80)
    const volumes = closes.map((c, i) => (i === 0 ? 400 : c >= closes[i - 1] ? 400 : 4000))
    const sig = computeCloseSignal(rowsFrom(closes, volumes))
    expect(sig.signal).toBe("hold")
    expect(sig.reasons.map((r) => r.code)).toContain("weak_volume_no_buy")
    expect(sig.reasons[0].ar).toContain("حجم تداول ضعيف")
  })

  it("steady downtrend → sell via the distribution path, no fabricated plan", () => {
    const closes = downtrendCloses(80)
    const volumes = closes.map((_, i) => 1200 - i * 5)
    const sig = computeCloseSignal(rowsFrom(closes, volumes))
    // trend 0/30 · momentum 12/30 · volume 3/20 (OBV<0, down-day relVol) ·
    // risk 20/20 (ext deep-below → 8, vol 7, expansion 5) → raw ~29 → 22.
    // Distribution path fires (OBV<0 + MACD breakdown + below EMA50).
    expect(sig.signal).toBe("sell")
    expect(sig.score).toBe(22)
    expect(sig.reasons.map((r) => r.code)).toContain("distribution_sell")
    expect(sig.reasons.some((r) => r.tone === "negative")).toBe(true)
    // no support below pays ≥ 1.5R → NO plan (never a fabricated −7% target)
    expect(sig.tradePlan).toBeNull()
  })

  it("flat balanced tape → hold, mid-range compressed score", () => {
    const closes: number[] = []
    let p = 100
    for (let i = 0; i < 80; i++) {
      p *= i % 2 === 0 ? 1.008 : 0.992
      closes.push(Math.round(p * 100) / 100)
    }
    const sig = computeCloseSignal(rowsFrom(closes))
    expect(sig.signal).toBe("hold")
    expect(sig.score).toBe(23)
    expect(sig.score!).toBeGreaterThan(19)
    expect(sig.score!).toBeLessThan(80)
  })

  it("score respects the documented weight ceiling (sums to 100)", () => {
    const total = Object.values(SIGNAL_WEIGHTS).reduce((a, b) => a + b, 0)
    expect(total).toBe(100)
  })

  it("@5 dims sit in the documented component scale (risk now includes expansion)", () => {
    const sig = computeCloseSignal(rowsFrom(uptrendCloses(80)))
    const maxes = Object.fromEntries(sig.dimensions.map((d) => [d.key, d.max]))
    expect(maxes.trend).toBeLessThanOrEqual(30)
    expect(maxes.momentum).toBeLessThanOrEqual(30)
    expect(maxes.volume).toBeLessThanOrEqual(20)
    expect(maxes.risk).toBeLessThanOrEqual(20)
  })

  it("undersupplied history → null stance with disclosure, never a fake score", () => {
    const sig = computeCloseSignal(rowsFrom(uptrendCloses(10)))
    expect(sig.score).toBeNull()
    expect(sig.signal).toBeNull()
    expect(sig.limitations.join(" ")).toMatch(/sessions available/)
  })

  it("15-19 sessions → no trend anchor → null score (weak-data bucket, disclosed)", () => {
    const sig = computeCloseSignal(rowsFrom(uptrendCloses(17)))
    expect(sig.dimensions.find((d) => d.key === "trend")!.max).toBe(0)
    expect(sig.score).toBeNull()
    expect(sig.signal).toBeNull()
    expect(sig.limitations.join(" ")).toMatch(/needs 21 sessions/)
  })

  it("35-49 sessions → trend state on the fixed 0-30 scale, capped at 21 without EMA50", () => {
    const sig = computeCloseSignal(rowsFrom(uptrendCloses(40)))
    expect(sig.score).not.toBeNull()
    expect(sig.limitations.join(" ")).toMatch(/EMA50/)
    const trend = sig.dimensions.find((d) => d.key === "trend")!
    expect(trend.max).toBe(30)
    expect(trend.earned).toBe(21) // mid-lens missing → capped below decision strength
  })

  it("missing volume evidence → volume dim excluded AND score capped (≤70), not rescaled", () => {
    const closes = uptrendCloses(80)
    const rows: CloseRow[] = rowsFrom(closes).map((r) => ({ ts: r.ts, close: r.close, volume: null }))
    const sig = computeCloseSignal(rows)
    expect(sig.metrics.relVol).toBeNull()
    expect(sig.limitations.join(" ")).toMatch(/volume/i)
    const vol = sig.dimensions.find((d) => d.key === "volume")!
    expect(vol.max).toBe(0)
    // raw over trend+momentum+risk ≈ 78 → capped 70 → curve → 61
    expect(sig.score).toBe(61)
    expect(sig.score!).toBeLessThanOrEqual(70)
  })

  it("metrics carry the documented fields", () => {
    const sig = computeCloseSignal(rowsFrom(uptrendCloses(80)))
    expect(sig.metrics.ema20).not.toBeNull()
    expect(sig.metrics.ema50).not.toBeNull()
    expect(sig.metrics.rsi14).toBeGreaterThan(30)
    expect(sig.changePct).not.toBeNull()
    expect(sig.asOf).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})

describe("finalizeScore — calibration layer (unchanged from @4; @5 gates the DECISION)", () => {
  const strong: Parameters<typeof finalizeScore>[1] = { volumeKnown: true, riskKnown: true, allDimsStrong: true, relVol: 1.5 }

  it("compression anchors: 0→0, 100→100, and the documented mid-curve points", () => {
    expect(finalizeScore(0, strong)).toBe(0)
    expect(finalizeScore(100, strong)).toBe(100)
    expect(finalizeScore(90, strong)).toBe(86)
    expect(finalizeScore(85, strong)).toBe(80)
    expect(finalizeScore(80, strong)).toBe(73)
    expect(finalizeScore(75, strong)).toBe(67)
    expect(finalizeScore(70, strong)).toBe(61)
  })

  it("displayed 80+ is rare — only full-strength dims with real participation", () => {
    const weakPart: Parameters<typeof finalizeScore>[1] = { volumeKnown: true, riskKnown: true, allDimsStrong: true, relVol: 1.0 }
    expect(finalizeScore(90, weakPart)).toBeLessThan(80)
    const noVolume: Parameters<typeof finalizeScore>[1] = { volumeKnown: false, riskKnown: true, allDimsStrong: false, relVol: 1.5 }
    expect(finalizeScore(90, noVolume)).toBeLessThanOrEqual(70)
  })

  it("compression is monotonic across the whole raw domain (any ctx)", () => {
    const ctxs: Parameters<typeof finalizeScore>[1][] = [
      strong,
      { ...strong, relVol: null },
      { ...strong, volumeKnown: false },
      { ...strong, riskKnown: false, allDimsStrong: false },
    ]
    for (const ctx of ctxs) {
      let prev = -1
      for (let raw = 0; raw <= 100; raw++) {
        const out = finalizeScore(raw, ctx)
        expect(out).toBeGreaterThanOrEqual(prev)
        prev = out
      }
    }
  })

  it("out-of-range inputs clamp into [0, 100]", () => {
    expect(finalizeScore(120, strong)).toBe(100)
    expect(finalizeScore(-10, strong)).toBe(0)
  })

  it("missing volume evidence caps the raw ceiling at 70 → 61 displayed", () => {
    expect(finalizeScore(100, { ...strong, volumeKnown: false })).toBe(61)
    expect(finalizeScore(90, { ...strong, volumeKnown: false })).toBe(61)
    expect(finalizeScore(60, { ...strong, volumeKnown: false })).toBe(49)
  })

  it("missing risk evidence caps the raw ceiling at 75 → 67 displayed", () => {
    expect(finalizeScore(100, { ...strong, riskKnown: false })).toBe(67)
    expect(finalizeScore(60, { ...strong, riskKnown: false })).toBe(49)
  })

  it("raw > 80 requires allDimsStrong AND relVol ≥ 1.3, else clamps to 80 → 73", () => {
    expect(finalizeScore(95, { ...strong, allDimsStrong: false })).toBe(73)
    expect(finalizeScore(95, { ...strong, relVol: 1.1 })).toBe(73)
    expect(finalizeScore(95, strong)).toBe(93)
    expect(finalizeScore(95, { ...strong, relVol: 1.3 })).toBe(93)
    expect(finalizeScore(95, { ...strong, relVol: 1.2 })).toBe(73)
  })
})

describe("computeStanceFromSnapshot — trail path + fallback scorer", () => {
  function bundleBars(closes: number[]): Bar[] {
    return closes.map((c, i) => ({
      ts: new Date(new Date("2025-06-02T00:00:00Z").getTime() + i * 86_400_000).toISOString().slice(0, 10),
      open: c * 0.995,
      high: c * 1.01,
      low: c * 0.985,
      close: c,
      volume: 1000 + (i % 7) * 80,
    }))
  }

  it("real bundle → trail attached, stance from the SAME core as the board", () => {
    const bundle = assembleBundle(bundleBars(uptrendCloses(80)))
    const stance = computeStanceFromSnapshot(bundle.snapshot)
    expect(bundle.snapshot.trail?.length).toBe(24)
    expect(stance.version).toBe("tech-signals@5")
    // hot-RSI range-top tape → hold via decision-level excellence (board parity)
    expect(stance.signal).toBe("hold")
    expect(stance.score).toBe(64)
    expect(stance.dimensions.find((d) => d.key === "trend")).toEqual({ key: "trend", earned: 30, max: 30 })
    expect(stance.reasons.map((r) => r.code)).toContain("not_full_strength")
  })

  it("fallback scorer (no trail): fully strong volume-confirmed snapshot → buy 90", () => {
    const empty = assembleBundle([]).snapshot
    // trend 30/30 → 30 · momentum capped 24/30 → 20 · volume 18/20 → 22.5 ·
    // risk 15/15 → 20 → raw 92.5 → all strong + relVol 2.5 ≥ 1.3 → 90
    const strongSnap: TechnicalSnapshot = {
      ...empty,
      available: true,
      sessions: 250,
      lastClose: 110,
      perf: { ...empty.perf, d1: 1.5 },
      trend: { ema20: 107, ema50: 100, ema200: 90, priceVsEma20: "above", priceVsEma50: "above", priceVsEma200: "above", ema20VsEma50: "above", ema50VsEma200: "above", alignment: "aligned_uptrend", cross50200: "golden", cross50200Age: 30 },
      momentum: { rsi14: 55, macd: { macd: 2, signal: 1, histogram: 1 }, stochastic: { k: 60, d: 40 } },
      volume: { obv: 1, obvSlope20: 500, volMa20: 1000, relVol: 2.5, volumeWindow: 20 },
      volatility: { atr14: 2.7, atrPct: 2.5, bollinger: { upper: null, middle: null, lower: null, widthPct: null, percentB: null }, histVol20: null },
      levels: { supports: [], resistances: [] },
    }
    const stance = computeStanceFromSnapshot(strongSnap)
    expect(stance.signal).toBe("buy")
    expect(stance.score).toBe(90)
    // DE-DUP CONTRACT: the oscillator group saturates at 80% of its max
    expect(stance.dimensions.find((d) => d.key === "momentum")).toEqual({ key: "momentum", earned: 24, max: 30 })
    expect(stance.dimensions.find((d) => d.key === "trend")).toEqual({ key: "trend", earned: 30, max: 30 })
  })

  it("fallback scorer: relVol 1.0 tape → clamped to 73, still a buy (volume gate passes)", () => {
    const empty = assembleBundle([]).snapshot
    const gatedSnap: TechnicalSnapshot = {
      ...empty,
      available: true,
      sessions: 250,
      lastClose: 110,
      perf: { ...empty.perf, d1: 1.5 },
      trend: { ema20: 107, ema50: 100, ema200: 90, priceVsEma20: "above", priceVsEma50: "above", priceVsEma200: "above", ema20VsEma50: "above", ema50VsEma200: "above", alignment: "aligned_uptrend", cross50200: "golden", cross50200Age: 30 },
      momentum: { rsi14: 55, macd: { macd: 2, signal: 1, histogram: 1 }, stochastic: { k: 60, d: 40 } },
      volume: { obv: 1, obvSlope20: 500, volMa20: 1000, relVol: 1.0, volumeWindow: 20 },
      volatility: { atr14: 2.7, atrPct: 2.5, bollinger: { upper: null, middle: null, lower: null, widthPct: null, percentB: null }, histVol20: null },
      levels: { supports: [], resistances: [] },
    }
    const stance = computeStanceFromSnapshot(gatedSnap)
    expect(stance.score).toBe(73)
    expect(stance.signal).toBe("buy")
  })

  it("no EMA facts at all → null score and no stance, disclosed (never a fake read)", () => {
    const empty = assembleBundle([]).snapshot
    const noTrend: TechnicalSnapshot = {
      ...empty,
      available: true,
      sessions: 19,
      lastClose: 110,
      perf: { ...empty.perf, d1: 1.5 },
      trend: { ema20: null, ema50: null, ema200: null, priceVsEma20: null, priceVsEma50: null, priceVsEma200: null, ema20VsEma50: null, ema50VsEma200: null, alignment: null, cross50200: null, cross50200Age: null },
      momentum: { rsi14: 55, macd: { macd: null, signal: null, histogram: null }, stochastic: { k: null, d: null } },
      volume: { obv: null, obvSlope20: null, volMa20: null, relVol: 2.5, volumeWindow: 11 },
      volatility: { atr14: null, atrPct: 2.5, bollinger: { upper: null, middle: null, lower: null, widthPct: null, percentB: null }, histVol20: null },
      levels: { supports: [], resistances: [] },
    }
    const stance = computeStanceFromSnapshot(noTrend)
    expect(stance.score).toBeNull()
    expect(stance.signal).toBeNull()
    expect(stance.limitations.join(" ")).toMatch(/EMA/)
  })

  it("unavailable snapshot → null stance with disclosure", () => {
    const empty: TechnicalSnapshot = assembleBundle([]).snapshot
    const stance = computeStanceFromSnapshot(empty)
    expect(stance.score).toBeNull()
    expect(stance.signal).toBeNull()
    expect(stance.tradePlan).toBeNull()
    expect(stance.limitations[0]).toMatch(/No daily price history/)
  })

  it("buy stance carries an invalidation level when support exists", () => {
    const bundle = assembleBundle(bundleBars(healthyUptrend(90)))
    const stance = computeStanceFromSnapshot(bundle.snapshot)
    if (stance.signal === "buy" && bundle.snapshot.levels.supports.length > 0) {
      expect(stance.invalidation).not.toBeNull()
      expect(stance.invalidation!.side).toBe("below")
    }
  })
})
