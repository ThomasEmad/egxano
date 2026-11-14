// =============================================================================
// ADX module — Wilder Average Directional Index (+ DI+/DI−) — deterministic.
// =============================================================================
// ABLATION MODULE (2026-11-14, docs/notes/backtest-ablation.md): an ADDITIVE
// evidence layer for the tech-signals@5 close engine. It is NOT a new decision
// rule: computeCloseSignal only maps its output to a CAPPED score delta
// (±4 max) and Arabic evidence reasons; every @5 gate, weight, veto and the
// hysteresis state machine are untouched.
//
// Algorithm — Wilder (1978), the same smoothing conventions indicators.ts
// documents for RSI/ATR:
//   TR[i]  = max(h−l, |h−pc|, |l−pc|)                      (i ≥ 1)
//   +DM[i] = (h−h_prev) > (l_prev−l) AND (h−h_prev) > 0 ? h−h_prev : 0
//   −DM[i] = (l_prev−l) > (h−h_prev) AND (l_prev−l) > 0 ? l_prev−l : 0
//   first smoothed value = SMA of the first `period` TR/+DM/−DM values,
//   then Wilder smoothing: prev = prev − prev/period + x.
//   DI± = 100 × smoothed(DM±) / smoothed(TR); DX = 100 × |DI+ − DI−| / (DI+ + DI−)
//   ADX = SMA of the first `period` DX values, then Wilder smoothing.
//
// ABSTENTION (disclosed, never guessed): nulls when
//   • any bar is missing high/low/close (close-only rows carry no H/L), or
//   • sessions < 2 × period (the first ADX seed needs period DX values, and
//     the first DX needs `period` smoothed TR/DM values → 2×period − 1 bars
//     minimum; 2×period is the conservative bar and also the documented rule).
//
// Classification (documented thresholds, classic Wilder reading):
//   trendStrength = "strong" when ADX ≥ 25, "weak" when 20 ≤ ADX < 25,
//                   "none" when ADX < 20.
//   direction     = "up" when DI+ > DI−, "down" when DI− > DI+, "none" on a tie.
// =============================================================================

export const ADX_VERSION = "adx@1"

/** Default smoothing period (classic Wilder ADX(14)). */
export const ADX_PERIOD = 14
/** ADX ≥ 25 = strong trend. */
export const ADX_STRONG = 25
/** ADX ≥ 20 (below 25) = weak trend; below 20 = no trend. */
export const ADX_WEAK = 20

export interface AdxBar {
  high: number
  low: number
  close: number
}

export interface AdxResult {
  adx: number | null
  plusDI: number | null
  minusDI: number | null
  trendStrength: "strong" | "weak" | "none"
  direction: "up" | "down" | "none"
  /** true when the module abstained — the values are nulls and MUST NOT be
   *  read as "no trend"; the reason string discloses why. */
  abstained: boolean
  reason?: string
}

function usable(x: unknown): x is number {
  return typeof x === "number" && Number.isFinite(x)
}

/**
 * Wilder ADX over the LAST `period`-complete portion of the prefix bars.
 * Pure and prefix-only: the result at session t is a function of bars[0..t].
 */
export function computeAdx(bars: AdxBar[], period = ADX_PERIOD): AdxResult {
  const none: AdxResult = { adx: null, plusDI: null, minusDI: null, trendStrength: "none", direction: "none", abstained: true }
  if (!Number.isInteger(period) || period < 2) return { ...none, reason: "invalid period" }
  if (!bars || bars.length < 2 * period) {
    return { ...none, reason: `need ${2 * period} sessions with high/low/close, have ${bars?.length ?? 0}` }
  }
  for (const b of bars) {
    if (!usable(b.high) || !usable(b.low) || !usable(b.close)) {
      return { ...none, reason: "missing or non-finite high/low/close — ADX abstains on close-only rows" }
    }
  }

  // TR / +DM / −DM per bar transition
  const trs: number[] = []
  const pdms: number[] = []
  const ndms: number[] = []
  for (let i = 1; i < bars.length; i++) {
    const h = bars[i].high
    const l = bars[i].low
    const c = bars[i].close
    const pc = bars[i - 1].close
    trs.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)))
    const up = h - bars[i - 1].high
    const dn = bars[i - 1].low - l
    pdms.push(up > dn && up > 0 ? up : 0)
    ndms.push(dn > up && dn > 0 ? dn : 0)
  }

  // first smoothing = SMA over the first `period` values (index period-1)
  let atr = 0
  let sPdm = 0
  let sNdm = 0
  for (let i = 0; i < period; i++) {
    atr += trs[i]
    sPdm += pdms[i]
    sNdm += ndms[i]
  }
  atr /= period
  sPdm /= period
  sNdm /= period

  // Wilder-smooth forward, collecting DX per session
  const di = (dm: number, tr: number): number => (tr > 0 ? (100 * dm) / tr : 0)
  const dxs: number[] = []
  let plusDI: number | null = null
  let minusDI: number | null = null
  for (let i = period; i < trs.length; i++) {
    atr = atr - atr / period + trs[i]
    sPdm = sPdm - sPdm / period + pdms[i]
    sNdm = sNdm - sNdm / period + ndms[i]
    plusDI = di(sPdm, atr)
    minusDI = di(sNdm, atr)
    const denom = plusDI + minusDI
    dxs.push(denom > 0 ? (100 * Math.abs(plusDI - minusDI)) / denom : 0)
  }

  if (dxs.length < period) {
    // DI± are computable but the ADX seed is not — abstain per the 2×period rule
    return { ...none, plusDI: null, minusDI: null, reason: `ADX seed needs ${period} DX values, have ${dxs.length}` }
  }

  let adx = 0
  for (let i = 0; i < period; i++) adx += dxs[i]
  adx /= period
  for (let i = period; i < dxs.length; i++) adx = (adx * (period - 1) + dxs[i]) / period

  const trendStrength = adx >= ADX_STRONG ? "strong" : adx >= ADX_WEAK ? "weak" : "none"
  const direction = plusDI !== null && minusDI !== null ? (plusDI > minusDI ? "up" : minusDI > plusDI ? "down" : "none") : "none"
  return {
    adx,
    plusDI: plusDI ?? null,
    minusDI: minusDI ?? null,
    trendStrength,
    direction,
    abstained: false,
  }
}
