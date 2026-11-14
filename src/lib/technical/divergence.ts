// =============================================================================
// Divergence module — confirmed-swing divergence (price vs RSI/MACD-hist).
// =============================================================================
// ABLATION MODULE (2026-11-14, docs/notes/backtest-ablation.md): an ADDITIVE
// evidence layer for the tech-signals@5 close engine — not a decision rule.
// computeCloseSignal maps a confirmed divergence to a CAPPED score delta
// (±4 max) and an Arabic evidence reason; every @5 gate, weight, veto and the
// hysteresis state machine are untouched.
//
// DEFINITION (classic momentum divergence):
//   bullish — price prints a LOWER LOW pivot while the indicator prints a
//             HIGHER LOW (selling momentum fading into the new low);
//   bearish — price prints a HIGHER HIGH pivot while the indicator prints a
//             LOWER HIGH (buying momentum fading into the new high).
//
// PIVOTS + CONFIRMATION (the no-lookahead contract, documented):
//   • Pivot detection is the structure.ts R1 fractal rule with wing W = 3:
//     session i is a swing HIGH iff its price is STRICTLY greater than the
//     highs of sessions i−3..i+3 (equal extremes reject — same convention as
//     structure.ts; a double-top touch is not a pivot), swing LOW mirrored.
//   • A pivot at session i becomes DECLARED (reportable) at session i + K with
//     K = CONFIRMATION_SESSIONS = 3 — with wing 3 this is exactly the session
//     the fractal window closes, so the declared read uses bars ≤ i+K only and
//     there is ZERO lookahead beyond the documented K-session delay.
//   • Detection is prefix-pure: detectDivergence(rows[0..t]) is a function of
//     the prefix alone; appending future sessions can only ADD later-diverging
//     pivots, never change what was already declared.
//
// EVIDENCE LIFETIME: a divergence stays usable for ACTIVE_SESSIONS = 10
// sessions after its confirmation, then expires (stale divergence is not
// evidence).
//
// ABSTENTION (disclosed, never guessed): nulls when the series is thinner
// than MIN_SESSIONS (30 — two confirmed same-kind pivots plus RSI history),
// or when the RSI/MACD values at the pivots are not computable. MACD as a
// basis additionally needs ≥ 35 sessions (slow 26 + signal 9).
//
// BASIS PRECEDENCE: RSI(14) is evaluated first (the canonical momentum pivot
// oscillator); the MACD histogram is the fallback basis when RSI does not
// confirm the same divergence.
//
// STRENGTH 0..1 (documented, deterministic):
//   priceGapPct = |p2 − p1| / p1 × 100 (the two same-kind price pivots)
//   indGap      = signed indicator gap between the pivots, above a noise floor
//                 (RSI: 2 points; MACD: 5% of the mean |histogram| of the last
//                 60 sessions — scale-relative)
//   strength = min(1, 0.4 × min(1, priceGapPct / 3) + 0.6 × min(1, indGap / indScale))
//   with indScale = 10 RSI points, or 2 × mean|hist60| for MACD.
// =============================================================================

import { macdSeries, rsiSeries } from "./indicators"

export const DIVERGENCE_VERSION = "divergence@1"

/** Fractal wing W (structure.ts R1 convention). */
export const PIVOT_WING = 3
/** Confirmation sessions K: a pivot at i is DECLARED at i + K. */
export const CONFIRMATION_SESSIONS = 3
/** Sessions a confirmed divergence stays usable after its confirmation. */
export const ACTIVE_SESSIONS = 10
/** Minimum prefix length for any divergence read (RSI history + 2 pivots). */
export const DIVERGENCE_MIN_SESSIONS = 30
/** MACD-histogram basis needs slow(26) + signal(9) sessions. */
export const DIVERGENCE_MIN_SESSIONS_MACD = 35
/** RSI pivot-gap noise floor (indicator points). */
const RSI_NOISE_FLOOR = 2
/** MACD pivot-gap noise floor = 5% of mean |hist| over the last 60 sessions. */
const MACD_NOISE_FLOOR_SHARE = 0.05
/** Strength normalization scales. */
const PRICE_GAP_SCALE_PCT = 3
const RSI_GAP_SCALE = 10

export interface DivergenceRow {
  ts: string
  close: number
  /** optional real OHLC — when absent, price pivots are read off CLOSES */
  high?: number
  low?: number
}

export interface DivergenceSignal {
  kind: "bullish" | "bearish"
  basis: "rsi" | "macd"
  /** index of the SECOND (more recent) price pivot */
  pivotIndex: number
  /** first session index at which this divergence is reportable (pivotIndex + K) */
  confirmedAtIndex: number
  /** session date of the declaring session */
  confirmedAtSession: string
  /** 0..1 — documented strength formula above */
  strength: number
}

export interface DivergenceResult {
  available: boolean
  /** present when the module abstained (thin data) */
  reason?: string
  /** most recent STILL-ACTIVE confirmed divergence of each kind (null when none) */
  bullish: DivergenceSignal | null
  bearish: DivergenceSignal | null
}

interface Pivot {
  idx: number
  price: number
}

function usable(x: unknown): x is number {
  return typeof x === "number" && Number.isFinite(x)
}

/** Fractal pivots (wing W, strict comparisons — structure.ts R1), prefix-safe:
 *  a pivot is returned only when its full window [i−W, i+W] exists. */
function fractalPivots(prices: number[], wing: number, kind: "high" | "low"): Pivot[] {
  const out: Pivot[] = []
  for (let i = wing; i < prices.length - wing; i++) {
    let isPivot = true
    for (let j = i - wing; j <= i + wing; j++) {
      if (j === i) continue
      if (kind === "high" ? prices[j] >= prices[i] : prices[j] <= prices[i]) { isPivot = false; break }
    }
    if (isPivot) out.push({ idx: i, price: prices[i] })
  }
  return out
}

/**
 * Detect confirmed-swing divergences as of the LAST session of `rows`.
 * Pure and prefix-only: same rows[0..t] ⇒ same result.
 */
export function detectDivergence(rows: DivergenceRow[]): DivergenceResult {
  const empty: DivergenceResult = { available: false, bullish: null, bearish: null }
  if (!rows || rows.length < DIVERGENCE_MIN_SESSIONS) {
    return { ...empty, reason: `need ${DIVERGENCE_MIN_SESSIONS} sessions, have ${rows?.length ?? 0}` }
  }
  const n = rows.length
  const closes = rows.map((r) => r.close)
  // price series for pivots: real highs/lows when present, closes otherwise
  const priceHigh = rows.map((r) => (usable(r.high) ? r.high : r.close))
  const priceLow = rows.map((r) => (usable(r.low) ? r.low : r.close))

  const highs = fractalPivots(priceHigh, PIVOT_WING, "high")
  const lows = fractalPivots(priceLow, PIVOT_WING, "low")

  const rsiS = rsiSeries(closes, 14)
  const macdS = macdSeries(closes)
  // MACD histogram scale (mean |hist| over the last 60 sessions, when computable)
  const hists = macdS.histogram.slice(-60).filter((h): h is number => h !== null)
  const meanAbsHist = hists.length ? hists.reduce((s, h) => s + Math.abs(h), 0) / hists.length : null

  const evalPair = (
    p1: Pivot,
    p2: Pivot,
    kind: "bullish" | "bearish",
    basis: "rsi" | "macd",
  ): DivergenceSignal | null => {
    const ind1 = basis === "rsi" ? rsiS[p1.idx] : macdS.histogram[p1.idx]
    const ind2 = basis === "rsi" ? rsiS[p2.idx] : macdS.histogram[p2.idx]
    if (ind1 === null || ind2 === null || !usable(ind1) || !usable(ind2)) return null
    const price1 = kind === "bullish" ? priceLow[p1.idx] : priceHigh[p1.idx]
    const price2 = kind === "bullish" ? priceLow[p2.idx] : priceHigh[p2.idx]
    // price condition: bullish = lower low, bearish = higher high (strict)
    if (kind === "bullish" ? !(price2 < price1) : !(price2 > price1)) return null
    // indicator condition: bullish = higher low, bearish = lower high, above the noise floor
    const indGap = kind === "bullish" ? ind2 - ind1 : ind1 - ind2
    const floor = basis === "rsi"
      ? RSI_NOISE_FLOOR
      : meanAbsHist !== null && meanAbsHist > 0 ? MACD_NOISE_FLOOR_SHARE * meanAbsHist : Infinity
    if (!(indGap > floor)) return null
    const priceGapPct = price1 > 0 ? (Math.abs(price2 - price1) / price1) * 100 : 0
    const indScale = basis === "rsi" ? RSI_GAP_SCALE : meanAbsHist !== null && meanAbsHist > 0 ? 2 * meanAbsHist : 1
    const strength = Math.min(1, 0.4 * Math.min(1, priceGapPct / PRICE_GAP_SCALE_PCT) + 0.6 * Math.min(1, indGap / indScale))
    const confirmedAtIndex = p2.idx + CONFIRMATION_SESSIONS
    return {
      kind,
      basis,
      pivotIndex: p2.idx,
      confirmedAtIndex,
      confirmedAtSession: rows[confirmedAtIndex]?.ts ?? "",
      strength: Math.round(strength * 1000) / 1000,
    }
  }

  // newest passing pair per (kind, basis); RSI basis first, MACD fallback
  const findFor = (pivots: Pivot[], kind: "bullish" | "bearish"): DivergenceSignal | null => {
    for (let k = pivots.length - 1; k >= 1; k--) {
      const rsi = evalPair(pivots[k - 1], pivots[k], kind, "rsi")
      if (rsi) return rsi
      if (n >= DIVERGENCE_MIN_SESSIONS_MACD) {
        const macd = evalPair(pivots[k - 1], pivots[k], kind, "macd")
        if (macd) return macd
      }
    }
    return null
  }

  const bullishRaw = findFor(lows, "bullish")
  const bearishRaw = findFor(highs, "bearish")

  // active-window filter: declared ≤ last session < declared + ACTIVE_SESSIONS
  const active = (d: DivergenceSignal | null): DivergenceSignal | null =>
    d && d.confirmedAtIndex <= n - 1 && n - 1 < d.confirmedAtIndex + ACTIVE_SESSIONS ? d : null

  return {
    available: true,
    bullish: active(bullishRaw),
    bearish: active(bearishRaw),
  }
}
