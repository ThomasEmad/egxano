// =============================================================================
// Signal engine v2 — per-company metric bundle (PURE).
// Reuses the audited indicator library (src/lib/technical/indicators.ts) for
// EMA/RSI/MACD/ATR math and adds the board-specific facts. Every value is
// computed from the prefix passed in — callers slice for replay, so the
// engine is look-ahead-proof by construction.
// =============================================================================

import { emaSeries, rsi, macd, macdSeries, atr, perfN, type Bar } from "@/lib/technical/indicators"
import type { SignalMetrics } from "./types"

/** σ of the last 20 close-to-close % moves (the documented board convention). */
export function dailyVolPct(closes: number[]): number | null {
  if (closes.length < 21) return null
  const moves: number[] = []
  for (let i = closes.length - 20; i < closes.length; i++) {
    if (closes[i - 1] > 0) moves.push(((closes[i] - closes[i - 1]) / closes[i - 1]) * 100)
  }
  if (!moves.length) return null
  const mean = moves.reduce((s, m) => s + m, 0) / moves.length
  const variance = moves.reduce((s, m) => s + (m - mean) ** 2, 0) / moves.length
  return Math.sqrt(variance)
}

/** Last session volume vs the mean of the PRIOR 20 sessions (excludes the
 *  last bar itself so a huge day cannot dilute its own baseline). */
export function relVol(bars: Bar[]): number | null {
  if (bars.length < 21) return null
  const last = bars[bars.length - 1]
  if (last.volume === null || !Number.isFinite(last.volume) || last.volume <= 0) return null
  const prior: number[] = []
  for (let i = bars.length - 21; i < bars.length - 1; i++) {
    const v = bars[i].volume
    if (v !== null && Number.isFinite(v) && v > 0) prior.push(v)
  }
  if (prior.length < 10) return null
  const mean = prior.reduce((s, v) => s + v, 0) / prior.length
  if (mean <= 0) return null
  return last.volume / mean
}

/** Mean close × volume (plain EGP) over the last ≤20 sessions that carry a
 *  usable volume — the ABSOLUTE traded-value liquidity read. null when fewer
 *  than 5 sessions have volume data (the disclosure then stays "unknown"
 *  instead of inventing a liquidity verdict from thin data). */
export function avgTradedValueEgp(bars: Bar[], n = 20): number | null {
  const window: number[] = []
  for (let i = bars.length - 1; i >= 0 && window.length < n; i--) {
    const b = bars[i]
    if (b.volume !== null && Number.isFinite(b.volume) && b.volume > 0 && Number.isFinite(b.close) && b.close > 0) {
      window.push(b.close * b.volume)
    }
  }
  if (window.length < 5) return null
  return window.reduce((s, v) => s + v, 0) / window.length
}

/** Where the close sits in the 60-session high-low range, 0–100. */
export function rangePos(closes: number[], n = 60): number | null {
  if (closes.length < n) return null
  const win = closes.slice(-n)
  const hi = Math.max(...win)
  const lo = Math.min(...win)
  const last = win[win.length - 1]
  if (!Number.isFinite(hi) || !Number.isFinite(lo) || hi <= lo || !Number.isFinite(last)) return null
  return ((last - lo) / (hi - lo)) * 100
}

/** Higher-high / higher-low structure over the swing window (simple, honest):
 *  compare the last two completed swing windows of n sessions each. */
export function higherHighsLows(bars: Bar[], n = 10): { hh: boolean; hl: boolean } | null {
  if (bars.length < 2 * n + 1) return null
  const cur = bars.slice(-n)
  const prev = bars.slice(-2 * n, -n)
  const curHi = Math.max(...cur.map((b) => b.high))
  const curLo = Math.min(...cur.map((b) => b.low))
  const prevHi = Math.max(...prev.map((b) => b.high))
  const prevLo = Math.min(...prev.map((b) => b.low))
  return { hh: curHi > prevHi, hl: curLo > prevLo }
}

export interface MetricsBundle {
  lastClose: number
  prevClose: number
  rsi14: number | null
  ema20: number | null
  ema20Prev: number | null
  ema50: number | null
  atr14: number | null
  macdHist: number | null
  macdHistPrev: number | null
  relVol: number | null
  perfM1: number | null
  perfM3: number | null
  rangePos60: number | null
  dailyVolPct: number | null
  hhHl: { hh: boolean; hl: boolean } | null
  avgTradedValueEgp: number | null
}

/** Compute the full metric bundle for the CURRENT last bar of `bars`. */
export function computeMetrics(bars: Bar[]): MetricsBundle | null {
  if (bars.length < 2) return null
  const closes = bars.map((b) => b.close)
  const last = bars.length - 1
  const lastClose = closes[last]
  const prevClose = closes[last - 1]
  if (!Number.isFinite(lastClose) || lastClose <= 0 || prevClose <= 0) return null

  const ema20s = emaSeries(closes, 20)
  const ema50s = emaSeries(closes, 50)
  const r = rsi(closes, 14)
  const m = macd(closes, 12, 26, 9)
  const a = atr(bars, 14)
  const m1 = perfN(closes, 21)
  const m3 = perfN(closes, 63)
  // Previous histogram (one bar back) — for the rising/falling read.
  const ms = macdSeries(closes, 12, 26, 9)
  const macdHistPrev = ms.histogram[ms.histogram.length - 2] ?? null

  return {
    lastClose,
    prevClose,
    rsi14: r.value,
    ema20: ema20s[last] ?? null,
    ema20Prev: last >= 5 ? (ema20s[last - 5] ?? null) : null,
    ema50: ema50s[last] ?? null,
    atr14: a.value,
    macdHist: m.histogram,
    macdHistPrev,
    relVol: relVol(bars),
    perfM1: m1,
    perfM3: m3,
    rangePos60: rangePos(closes, 60),
    dailyVolPct: dailyVolPct(closes),
    hhHl: higherHighsLows(bars, 10),
    avgTradedValueEgp: avgTradedValueEgp(bars),
  }
}

/** The published metrics block (SignalMetrics) — same numbers, public shape. */
export function toSignalMetrics(bundle: MetricsBundle): SignalMetrics {
  return {
    rsi14: bundle.rsi14 === null ? null : round2(bundle.rsi14),
    ema20: bundle.ema20 === null ? null : round2(bundle.ema20),
    ema50: bundle.ema50 === null ? null : round2(bundle.ema50),
    atr14: bundle.atr14 === null ? null : round2(bundle.atr14),
    macdHist: bundle.macdHist === null ? null : round2(bundle.macdHist),
    relVol: bundle.relVol === null ? null : Math.round(bundle.relVol * 100) / 100,
    perfM1: bundle.perfM1 === null ? null : Math.round(bundle.perfM1 * 10) / 10,
    perfM3: bundle.perfM3 === null ? null : Math.round(bundle.perfM3 * 10) / 10,
    rangePos60: bundle.rangePos60 === null ? null : Math.round(bundle.rangePos60 * 10) / 10,
    dailyVolPct: bundle.dailyVolPct === null ? null : Math.round(bundle.dailyVolPct * 100) / 100,
  }
}

export function round2(x: number): number {
  return Math.round(x * 100) / 100
}
