// Rule-based signals engine tests — synthetic series with KNOWN shapes, so the
// expected stance is derivable by construction (not by re-running the engine).
//
// Calibrated against tech-signals@3:
//   • missing-evidence caps — no volume evidence → 70, no risk evidence → 75,
//     and NO trend evidence → null score (the anchor is gone, not rescaled);
//   • excellence gate — raw > 85 needs every present dim ≥ 80% AND relVol ≥ 1.2;
//   • high-end compression — final = round(100 × (raw/100)^1.25);
//   • tightened bands — trend 8/7/8/7 (max 30), RSI full credit only 45-60,
//     OBV 8, relVol 2-3× on an up day = 10 / >3× = 4, extension ≤4/≤8, daily
//     vol ≤3/≤5.
// Every pinned score carries its raw arithmetic in a comment so a future
// recalibration can re-derive it.
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

/** Realistic uptrend: two up sessions (+1.0%) then one pullback (-0.8%).
 *  Net drift ~ +0.4%/session with a Wilder-RSI that lands in the low 70s —
 *  the honest shape of a tradable EGX uptrend, unlike a monotonic ramp.
 *  Under @3 that hot RSI (>72 → 2 pts) and the range-top position (>90 → 2)
 *  are exactly what keep momentum from maxing: a stretched tape cannot score
 *  like a fresh one. */
function uptrendCloses(n = 80): number[] {
  const out: number[] = []
  let p = 50
  for (let i = 0; i < n; i++) {
    p *= i % 3 === 2 ? 0.992 : 1.01
    out.push(Math.round(p * 100) / 100)
  }
  return out
}

/** Steady downtrend: −0.5% per session. A small early top (82, ~70 sessions
 *  before the tail) is a documented minimal adjustment: the sell trade plan
 *  needs a usable resistance ABOVE the last close, and a strictly monotonic
 *  decline produces no swing pivots at all. The bump sits far outside every
 *  momentum window (RSI 14, EMA20) and does not move the score across any
 *  threshold — the read stays a low-score sell-press. */
function downtrendCloses(n = 80): number[] {
  const out: number[] = []
  let p = 78
  for (let i = 0; i < 6; i++) { out.push(Math.round(p * 100) / 100); p *= 1.005 }
  out.push(82) // early local top → the only swing-pivot high in the series
  p = 80.5
  for (let i = 7; i < n; i++) { p *= 0.995; out.push(Math.round(p * 100) / 100) }
  return out
}

describe("computeCloseSignal — stance mapping (@3 math)", () => {
  it("steady uptrend with confirmed volume → buy read at the @3 compressed score", () => {
    const closes = uptrendCloses(80)
    // rising volume — accumulation alongside price
    const volumes = closes.map((_, i) => 1000 + i * 5)
    const sig = computeCloseSignal(rowsFrom(closes, volumes))
    // raw: trend 30/30 × 35 = 35 · momentum 14/30 × 30 = 14 (RSI ~73.6 → 2,
    // MACD 10, rangePos 100 → 2) · volume 14/20 × 20 = 14 (OBV 8 + relVol
    // ~1.04 on an up day → 6) · risk 12/15 × 15 = 12 (ext ~4.3% → 5, daily
    // vol ~0.8% → 7) → raw 75 → curve → 70. Buy still reachable (≥ 62).
    expect(sig.version).toBe("tech-signals@3")
    expect(sig.signal).toBe("buy")
    expect(sig.score).toBe(70)
    expect(sig.dimensions.find((d) => d.key === "trend")).toEqual({ key: "trend", earned: 30, max: 30 })
    expect(sig.dimensions.find((d) => d.key === "momentum")).toEqual({ key: "momentum", earned: 14, max: 30 })
    expect(sig.dimensions.find((d) => d.key === "volume")).toEqual({ key: "volume", earned: 14, max: 20 })
    expect(sig.dimensions.find((d) => d.key === "risk")).toEqual({ key: "risk", earned: 12, max: 15 })
    expect(sig.styleFits.map((f) => f.tag)).toContain("trend")
    expect(sig.styleFits.map((f) => f.tag)).toContain("swing")
    expect(sig.reasons.length).toBeGreaterThan(0)
    // deterministic trade plan rides the buy read
    expect(sig.tradePlan).not.toBeNull()
    expect(sig.tradePlan!.bias).toBe("buy")
    expect(sig.tradePlan!.stop).toBeLessThan(sig.tradePlan!.entryLow)
    expect(sig.tradePlan!.entryLow).toBeLessThanOrEqual(sig.tradePlan!.entryHigh)
    expect(sig.tradePlan!.entryHigh).toBeLessThan(sig.tradePlan!.targetLow)
  })

  it("steady downtrend → sell-press read, low compressed score, sell-bias trade plan", () => {
    const closes = downtrendCloses(80)
    const volumes = closes.map((_, i) => 1200 - i * 5)
    const sig = computeCloseSignal(rowsFrom(closes, volumes))
    // raw: trend 0/30 · momentum 12/30 (RSI ~0.8 → 2, MACD line<0 but hist
    // converging up → 7, rangePos 0 → 3) · volume 3/20 (OBV<0 → 0, relVol
    // ~0.94 on a down day → 3) · risk 15/15 → raw 30 → curve → 22 < 35.
    expect(sig.signal).toBe("sell")
    expect(sig.score).toBe(22)
    expect(sig.reasons.some((r) => r.tone === "negative")).toBe(true)
    // the early top gives the plan a usable resistance → a real sell plan
    expect(sig.tradePlan).not.toBeNull()
    expect(sig.tradePlan!.bias).toBe("sell")
    expect(sig.tradePlan!.stop).toBeGreaterThan(sig.tradePlan!.entryHigh)
  })

  it("flat balanced tape → hold, mid-range compressed score", () => {
    // symmetric zigzag around 100: equal gains and losses, flat MAs, RSI ~50
    const closes: number[] = []
    let p = 100
    for (let i = 0; i < 80; i++) {
      p *= i % 2 === 0 ? 1.008 : 0.992
      closes.push(Math.round(p * 100) / 100)
    }
    const sig = computeCloseSignal(rowsFrom(closes))
    // raw: trend 0/30 (price under EMA20 after the last down-step, no rising
    // streak) · momentum 14/30 · volume 3/20 · risk 15/15 → raw 32 → 24.
    // Sell is vetoed: RSI ~50 is not sell momentum. Hold.
    expect(sig.signal).toBe("hold")
    expect(sig.score).toBe(24)
    expect(sig.score!).toBeGreaterThan(20)
    expect(sig.score!).toBeLessThan(80)
  })

  it("score respects the documented weight ceiling (sums to 100)", () => {
    const total = Object.values(SIGNAL_WEIGHTS).reduce((a, b) => a + b, 0)
    expect(total).toBe(100)
  })

  it("@3 dims sit in the documented component scale (trend max 30 ≤ its 35 weight)", () => {
    const sig = computeCloseSignal(rowsFrom(uptrendCloses(80)))
    const maxes = Object.fromEntries(sig.dimensions.map((d) => [d.key, d.max]))
    expect(maxes.trend).toBeLessThanOrEqual(30)
    expect(maxes.momentum).toBeLessThanOrEqual(30)
    expect(maxes.volume).toBeLessThanOrEqual(20)
    expect(maxes.risk).toBeLessThanOrEqual(15)
  })

  it("undersupplied history → null stance with disclosure, never a fake score", () => {
    const sig = computeCloseSignal(rowsFrom(uptrendCloses(10)))
    expect(sig.score).toBeNull()
    expect(sig.signal).toBeNull()
    expect(sig.limitations.join(" ")).toMatch(/sessions available/)
  })

  it("15-19 sessions → no trend anchor → null score (weak-data bucket, disclosed)", () => {
    // EMA20 needs 20 closes, so the trend dim has no evidence at all; under @2
    // the score silently rescaled over momentum+volume. @3 refuses to print
    // a score without its anchor — matching the "no stance mapping" rule.
    const sig = computeCloseSignal(rowsFrom(uptrendCloses(17)))
    expect(sig.dimensions.find((d) => d.key === "trend")!.max).toBe(0)
    expect(sig.score).toBeNull()
    expect(sig.signal).toBeNull()
    expect(sig.limitations.join(" ")).toMatch(/Trend checks could not be computed/)
  })

  it("35-49 sessions → EMA50 checks excluded, trend dim capped at 15 of its 30 scale", () => {
    const sig = computeCloseSignal(rowsFrom(uptrendCloses(40)))
    expect(sig.score).not.toBeNull()
    expect(sig.limitations.join(" ")).toMatch(/EMA50/)
    const trend = sig.dimensions.find((d) => d.key === "trend")!
    // price>EMA20 (8) + rising EMA20 slope (7); the two EMA50 checks are excluded
    expect(trend.max).toBe(15)
  })

  it("missing volume evidence → volume dim excluded AND score capped (≤70), not rescaled", () => {
    const closes = uptrendCloses(80)
    const rows: CloseRow[] = rowsFrom(closes).map((r) => ({ ts: r.ts, close: r.close, volume: null }))
    const sig = computeCloseSignal(rows)
    expect(sig.metrics.relVol).toBeNull()
    expect(sig.limitations.join(" ")).toMatch(/volume/i)
    const vol = sig.dimensions.find((d) => d.key === "volume")!
    expect(vol.max).toBe(0)
    // raw over trend+momentum+risk = (35 + 14 + 12)/80 → 76.25; @2 rescaled that
    // to a near-perfect display. @3 caps the ceiling at 70 → curve → 64.
    expect(sig.score).toBe(64)
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

describe("finalizeScore — @3 calibration layer", () => {
  const strong: Parameters<typeof finalizeScore>[1] = { volumeKnown: true, riskKnown: true, allDimsStrong: true, relVol: 1.5 }

  it("compression anchors: 0→0, 100→100, and the documented mid-curve points", () => {
    expect(finalizeScore(0, strong)).toBe(0)
    expect(finalizeScore(100, strong)).toBe(100)
    expect(finalizeScore(90, strong)).toBe(88)
    expect(finalizeScore(85, strong)).toBe(82)
    expect(finalizeScore(80, strong)).toBe(76)
    expect(finalizeScore(75, strong)).toBe(70)
    expect(finalizeScore(70, strong)).toBe(64)
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

  it("missing volume evidence caps the raw ceiling at 70 → 64 displayed", () => {
    expect(finalizeScore(100, { ...strong, volumeKnown: false })).toBe(64)
    expect(finalizeScore(90, { ...strong, volumeKnown: false })).toBe(64)
    expect(finalizeScore(60, { ...strong, volumeKnown: false })).toBe(53) // cap not binding
  })

  it("missing risk evidence caps the raw ceiling at 75 → 70 displayed", () => {
    expect(finalizeScore(100, { ...strong, riskKnown: false })).toBe(70)
    expect(finalizeScore(90, { ...strong, riskKnown: false })).toBe(70)
    expect(finalizeScore(60, { ...strong, riskKnown: false })).toBe(53) // cap not binding
  })

  it("both caps missing → volume cap dominates (70)", () => {
    expect(finalizeScore(100, { ...strong, volumeKnown: false, riskKnown: false })).toBe(64)
  })

  it("raw > 85 requires allDimsStrong AND relVol ≥ 1.2, else clamps to 85 → 82", () => {
    expect(finalizeScore(95, { ...strong, allDimsStrong: false })).toBe(82)
    expect(finalizeScore(95, { ...strong, relVol: 1.1 })).toBe(82)
    expect(finalizeScore(95, { ...strong, relVol: null })).toBe(82)
    // exactly at the 1.2 boundary the gate passes → raw 95 → 94
    expect(finalizeScore(95, strong)).toBe(94)
    expect(finalizeScore(95, { ...strong, relVol: 1.2 })).toBe(94)
  })
})

describe("computeStanceFromSnapshot — full-bundle stance (@3 EMA facts)", () => {
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

  it("produces a score in range and a valid signal from a real bundle", () => {
    const bundle = assembleBundle(bundleBars(uptrendCloses(80)))
    const stance = computeStanceFromSnapshot(bundle.snapshot)
    expect(stance.version).toBe("tech-signals@3")
    expect(stance.score).not.toBeNull()
    expect(stance.score!).toBeGreaterThanOrEqual(0)
    expect(stance.score!).toBeLessThanOrEqual(100)
    expect(["buy", "hold", "sell"]).toContain(stance.signal)
    expect(stance.dimensions.length).toBe(4)
    // trade plan follows the signal: null only where no honest plan exists
    if (stance.signal === "buy") expect(stance.tradePlan).not.toBeNull()
    if (stance.signal === "hold") expect(stance.tradePlan).toBeNull()
  })

  it("snapshot trend is scored on EMA facts with EMA-worded reasons (no SMA cross claims)", () => {
    const bundle = assembleBundle(bundleBars(uptrendCloses(80)))
    const stance = computeStanceFromSnapshot(bundle.snapshot)
    expect(bundle.snapshot.trend.ema20).not.toBeNull()
    const codes = stance.reasons.map((r) => r.code)
    // the trend dim mirrors the close engine's EMA stack: 8/7/8 present, ema200 absent
    expect(stance.dimensions.find((d) => d.key === "trend")).toEqual({ key: "trend", earned: 23, max: 23 })
    expect(codes).toContain("alignment_up") // "السعر فوق EMA20 وEMA50..."
    expect(codes).not.toContain("ema_golden_cross")
    expect(codes).not.toContain("ema_death_cross")
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
    expect(stance.limitations.join(" ")).toMatch(/Trend checks could not be computed/)
  })

  it("excellence gate passes on a fully strong, volume-confirmed snapshot (98/100 raw→98)", () => {
    const empty = assembleBundle([]).snapshot
    // hand-built with known facts: ext (110-107)/107 ≈ 2.8% → 8, atrPct 2.5 → 7,
    // RSI 55 → 10, MACD line/hist > 0 → 10, stoch k>d in band → 10,
    // OBV slope > 0 → 8, relVol 2.5 on an up day → 10, full EMA stack → 30/30.
    // raw = 35 + 30 + 18 + 15 = 98; all dims ≥ 80% and relVol ≥ 1.2 → no clamp.
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
    expect(stance.score).toBe(98)
    expect(stance.dimensions.find((d) => d.key === "trend")).toEqual({ key: "trend", earned: 30, max: 30 })
    expect(stance.reasons.map((r) => r.code)).toContain("alignment_up")
  })

  it("excellence gate blocks a 94-raw tape whose volume is unconfirmed (clamp 85 → 82)", () => {
    const empty = assembleBundle([]).snapshot
    const gatedSnap: TechnicalSnapshot = {
      ...empty,
      available: true,
      sessions: 250,
      lastClose: 110,
      perf: { ...empty.perf, d1: 1.5 },
      trend: { ema20: 107, ema50: 100, ema200: 90, priceVsEma20: "above", priceVsEma50: "above", priceVsEma200: "above", ema20VsEma50: "above", ema50VsEma200: "above", alignment: "aligned_uptrend", cross50200: "golden", cross50200Age: 30 },
      momentum: { rsi14: 55, macd: { macd: 2, signal: 1, histogram: 1 }, stochastic: { k: 60, d: 40 } },
      // relVol 1.0 on an up day → 6 pts → volume 14/20 = 70% < 80% → not all strong
      volume: { obv: 1, obvSlope20: 500, volMa20: 1000, relVol: 1.0, volumeWindow: 20 },
      volatility: { atr14: 2.7, atrPct: 2.5, bollinger: { upper: null, middle: null, lower: null, widthPct: null, percentB: null }, histVol20: null },
      levels: { supports: [], resistances: [] },
    }
    const stance = computeStanceFromSnapshot(gatedSnap)
    // raw = 35 + 30 + 14 + 15 = 94 → gate clamps to 85 → curve → 82
    expect(stance.score).toBe(82)
    expect(stance.signal).toBe("buy")
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
    const bundle = assembleBundle(bundleBars(uptrendCloses(90)))
    const stance = computeStanceFromSnapshot(bundle.snapshot)
    if (stance.signal === "buy" && bundle.snapshot.levels.supports.length > 0) {
      expect(stance.invalidation).not.toBeNull()
      expect(stance.invalidation!.side).toBe("below")
    }
  })
})
