// =============================================================================
// synthetic-tape tests — the 2026-11-21 AMES honesty fix. A close-only
// scanner row (open=high=low=close) is MISSING INTRADAY DATA, not a locked
// session. The pipeline used to narrate fabricated anatomy off it:
// «متجمد بالسعر على 7 جلسات بمدى 0.0٪ / امتصاص حقيقي» over a −16٪ close
// staircase, «فجوة نزول فاتحة الشمعة» from a mirrored open, «بجسم شبه
// معدوم» from a body that never existed. Contract here: on a synthetic
// trailing tape the anatomy claims are SILENT, the volume/close reads stay
// real, and the card opens with the data-basis disclosure.
// =============================================================================

import { describe, expect, it } from "vitest"
import { buildMarketContext } from "../market-context"
import { makerGamesAr } from "../maker-games"
import { narrativeLinesAr } from "../review"
import type { Bar } from "@/lib/signals/types"

let daySeq = 0
const nextDay = (): string => {
  daySeq++
  return `2026-09-${String((daySeq % 28) + 1).padStart(2, "0")}`
}

/** Real OHLC session: the day traded, high/low were observed. */
function realBar(close: number): Bar {
  return { ts: nextDay(), open: close + 0.4, high: close + 0.9, low: close - 0.9, close, volume: 1_000_000 }
}

/** Close-only scanner row (the AMES post-2026-11-05 tape shape). */
function synthBar(close: number, volume: number | null = null): Bar {
  return { ts: nextDay(), open: close, high: close, low: close, close, volume, synthetic: true }
}

const metrics = { rsi14: 44.6, ema20: 37.2, ema50: 50.18, atr14: 1.9, relVol: 3.19, rangePos60: 8 }

/** The AMES shape: real history, then 7 close-only rows stepping down ~16٪. */
function amesTape(): Bar[] {
  const bars: Bar[] = []
  for (let i = 0; i < 60; i++) bars.push(realBar(55 - i * 0.1))
  for (const c of [50.1, 45.78, 48.67, 47.55, 50.1, 43.99, 39.51, 38.59]) bars.push(synthBar(c))
  return bars
}

const veteranOpts = {
  branch: "engineExit" as const,
  avgBuyPrice: 38.4,
  close: 38.59,
  trendAr: "هابط",
  lastBarFinal: true,
}

describe("buildMarketContext — the synthetic last bar", () => {
  it("flags lastSynthetic and nulls the anatomy reads, keeps the close reads real", () => {
    const bars = amesTape()
    const ctx = buildMarketContext(bars, metrics)
    expect(ctx.lastSynthetic).toBe(true)
    // anatomy that never existed → null (close-to-close move was −2.33٪ and
    // the old code called it a "gap at open")
    expect(ctx.gapPct).toBeNull()
    expect(ctx.bodyVsAtr).toBeNull()
    expect(ctx.closeLocationPct).toBeNull()
    // close-based reads stay real
    expect(ctx.streakDown).toBeGreaterThan(0)
    expect(ctx.volCharacter).toBe("spike") // relVol 3.19 ≥ 2.5 — real volume
  })

  it("a real doji session (high=low, full OHLC observed) is NOT synthetic", () => {
    const bars: Bar[] = []
    for (let i = 0; i < 25; i++) bars.push(realBar(50))
    bars.push({ ts: nextDay(), open: 50, high: 50, low: 50, close: 50, volume: 1_000 })
    const ctx = buildMarketContext(bars, metrics)
    expect(ctx.lastSynthetic).toBe(false)
  })
})

describe("makerGamesAr — G3 on the synthetic tape", () => {
  it("7 close-only trailing rows → NO locked-tape fabrication (the AMES bug)", () => {
    const bars = amesTape()
    const ctx = buildMarketContext(bars, metrics)
    const lines = makerGamesAr(ctx, {
      branch: "engineExit",
      avgBuyPrice: 38.4,
      close: 38.59,
      trendAr: "هابط",
      lastBarFinal: true,
      cushion: null,
      nearestSupportLow: null,
      prevClose: 39.51,
      bars,
      map: null,
      mctx: null,
    })
    expect(lines.every((l) => !l.includes("متجمد بالسعر"))).toBe(true)
    expect(lines.every((l) => !l.includes("امتصاص حقيقي"))).toBe(true)
  })

  it("a REAL locked tape (observed high=low, no synthetic flag) still narrates the freeze", () => {
    const bars: Bar[] = []
    for (let i = 0; i < 10; i++) bars.push(realBar(50.3))
    for (let i = 0; i < 3; i++) bars.push({ ts: nextDay(), open: 50, high: 50.04, low: 49.96, close: 50, volume: 1_000 })
    const ctx = buildMarketContext(bars, metrics)
    const lines = makerGamesAr(ctx, {
      branch: "hold",
      avgBuyPrice: 49,
      close: 50,
      trendAr: "متذبذب",
      lastBarFinal: true,
      cushion: null,
      nearestSupportLow: null,
      prevClose: 50,
      bars,
      map: null,
      mctx: null,
    })
    expect(lines.some((l) => l.includes("متجمد بالسعر"))).toBe(true)
  })

  it("synthetic rows break the trailing stretch even after a real lock", () => {
    const bars: Bar[] = []
    for (let i = 0; i < 10; i++) bars.push(realBar(50.3))
    for (let i = 0; i < 3; i++) bars.push({ ts: nextDay(), open: 50, high: 50.04, low: 49.96, close: 50, volume: 1_000 })
    bars.push(synthBar(38.59)) // unobserved session in between — the lock is no longer trailing
    bars.push({ ts: nextDay(), open: 38.59, high: 38.63, low: 38.55, close: 38.59, volume: 1_000 })
    const ctx = buildMarketContext(bars, metrics)
    const lines = makerGamesAr(ctx, {
      branch: "hold",
      avgBuyPrice: 49,
      close: 38.59,
      trendAr: "متذبذب",
      lastBarFinal: true,
      cushion: null,
      nearestSupportLow: null,
      prevClose: 38.59,
      bars,
      map: null,
      mctx: null,
    })
    expect(lines.every((l) => !l.includes("متجمد بالسعر"))).toBe(true)
  })
})

describe("narrativeLinesAr — the data-basis disclosure", () => {
  it("opens with the disclosure and carries NO fabricated gap/body anatomy", () => {
    const bars = amesTape()
    const ctx = buildMarketContext(bars, metrics)
    const lines = narrativeLinesAr(ctx, veteranOpts, { bars, map: null, mctx: null, prevClose: 39.51 })
    expect(lines.length).toBeGreaterThan(0)
    expect(lines[0]!.includes("شفافية البيانات")).toBe(true)
    expect(lines.some((l) => l.includes("فوليوم Spike"))).toBe(true) // volume read stays
    expect(lines.every((l) => !l.includes("فجوة نزول"))).toBe(true)
    expect(lines.every((l) => !l.includes("بجسم شبه معدوم"))).toBe(true)
    expect(lines.every((l) => !l.includes("معركة حجم حقيقية"))).toBe(true)
  })

  it("a real-OHLC tape keeps the old behavior (no disclosure, anatomy allowed)", () => {
    const bars: Bar[] = []
    for (let i = 0; i < 60; i++) bars.push(realBar(55 - i * 0.1))
    bars.push(realBar(38.59))
    const ctx = buildMarketContext(bars, metrics)
    expect(ctx.lastSynthetic).toBe(false)
    const lines = narrativeLinesAr(ctx, veteranOpts, { bars, map: null, mctx: null, prevClose: 39.09 })
    expect(lines.every((l) => !l.includes("شفافية البيانات"))).toBe(true)
  })
})
