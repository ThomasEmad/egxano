// =============================================================================
// EGXANO Technical Analysis Engine — deterministic indicator library
// =============================================================================
//
// Every function here is a PURE, server-side calculation over real OHLCV bars.
// No AI involvement: the LLM later only INTERPRETS the output of these
// functions, it never computes indicators itself.
//
// Conventions (documented per spec "initialization and smoothing conventions"):
//   SMA      — arithmetic mean of the last `n` closes.
//   EMA      — classic convention: seeded with the SMA of the first `n`
//              values, then k = 2/(n+1) exponential smoothing over the rest.
//   RSI      — Wilder (1978): first avgGain/avgLoss = SMA of the first `n`
//              changes, then Wilder smoothing (prev*(n-1) + x) / n.
//   MACD     — EMA(12) - EMA(26); signal = EMA(9) of the MACD line (same
//              seeding rule); histogram = macd - signal.
//   Bollinger— SMA(20) ± 2 × population standard deviation of the same window.
//   Stoch    — %K = (C - L14) / (H14 - L14) × 100 over 14 sessions;
//              %D = SMA(3) of %K.
//   ATR      — Wilder smoothing of True Range over 14 sessions; the first TR
//              uses the previous close when available.
//   OBV      — cumulative volume signed by close-to-close direction.
//   HistVol  — annualized standard deviation of log returns (× √252) over the
//              last `n` sessions.
//
// Insufficiency policy: every indicator that cannot be computed from the
// available VALID bars returns { value: null, reason } — missing data is never
// treated as zero and candles are never fabricated.

/** One observed trading session. `volume` may be null when the source does not report it. */
export interface Bar {
  ts: string // ISO date (UTC midnight of the session)
  open: number
  high: number
  low: number
  close: number
  volume: number | null
}

export interface IndicatorResult {
  value: number | null
  /** present when the value could not be computed (insufficient/invalid data) */
  reason?: string
}

const r = (value: number | null): IndicatorResult => ({ value })
const insuff = (reason: string): IndicatorResult => ({ value: null, reason })

export function round(x: number, digits = 4): number {
  const f = 10 ** digits
  return Math.round(x * f) / f
}

function finite(x: unknown): x is number {
  return typeof x === "number" && Number.isFinite(x)
}

// ---------------------------------------------------------------------------
// Moving averages
// ---------------------------------------------------------------------------

export function sma(values: number[], n: number): IndicatorResult {
  if (!Number.isInteger(n) || n < 1 || values.length < n) return insuff(`need ${n} values, have ${values.length}`)
  let sum = 0
  for (let i = values.length - n; i < values.length; i++) sum += values[i]
  return r(sum / n)
}

/** SMA series (ascending, aligned to input; first n-1 entries are null). */
export function smaSeries(values: number[], n: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null)
  let sum = 0
  for (let i = 0; i < values.length; i++) {
    sum += values[i]
    if (i >= n) sum -= values[i - n]
    if (i >= n - 1) out[i] = sum / n
  }
  return out
}

export function ema(values: number[], n: number): IndicatorResult {
  if (!Number.isInteger(n) || n < 1 || values.length < n) return insuff(`need ${n} values, have ${values.length}`)
  let acc = 0
  for (let i = 0; i < n; i++) acc += values[i]
  let prev = acc / n // seed = SMA of first n
  const k = 2 / (n + 1)
  for (let i = n; i < values.length; i++) prev = values[i] * k + prev * (1 - k)
  return r(prev)
}

/** EMA series; entries before the seed are null (classic chart alignment). */
export function emaSeries(values: number[], n: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null)
  if (values.length < n) return out
  let acc = 0
  for (let i = 0; i < n; i++) acc += values[i]
  out[n - 1] = acc / n
  const k = 2 / (n + 1)
  for (let i = n; i < values.length; i++) out[i] = values[i] * k + out[i - 1]! * (1 - k)
  return out
}

// ---------------------------------------------------------------------------
// Oscillators
// ---------------------------------------------------------------------------

/**
 * RSI (Wilder). Returns 100 when there are gains but zero average loss
 * (sustained uptrend), 0 when the mirror case, and null when no movement.
 */
export function rsi(closes: number[], n = 14): IndicatorResult {
  if (closes.length < n + 1) return insuff(`need ${n + 1} closes, have ${closes.length}`)
  let gainSum = 0
  let lossSum = 0
  for (let i = 1; i <= n; i++) {
    const d = closes[i] - closes[i - 1]
    if (d >= 0) gainSum += d
    else lossSum -= d
  }
  let avgGain = gainSum / n
  let avgLoss = lossSum / n
  for (let i = n + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1]
    avgGain = (avgGain * (n - 1) + Math.max(d, 0)) / n
    avgLoss = (avgLoss * (n - 1) + Math.max(-d, 0)) / n
  }
  if (avgLoss === 0 && avgGain === 0) return insuff("no price movement in window")
  if (avgLoss === 0) return r(100)
  if (avgGain === 0) return r(0)
  return r(100 - 100 / (1 + avgGain / avgLoss))
}

export interface MacdResult {
  macd: number | null
  signal: number | null
  histogram: number | null
  reason?: string
}

export function macd(closes: number[], fast = 12, slow = 26, signalN = 9): MacdResult {
  if (closes.length < slow + signalN - 1) {
    return { macd: null, signal: null, histogram: null, reason: `need ${slow + signalN - 1} closes, have ${closes.length}` }
  }
  const fastLine = emaSeries(closes, fast)
  const slowLine = emaSeries(closes, slow)
  // MACD line exists from the index where BOTH EMAs exist.
  const macdLine: number[] = []
  for (let i = slow - 1; i < closes.length; i++) {
    const f = fastLine[i]
    const s = slowLine[i]
    if (f === null || s === null) continue
    macdLine.push(f - s)
  }
  if (macdLine.length < signalN) {
    return { macd: macdLine.length ? round(macdLine[macdLine.length - 1]) : null, signal: null, histogram: null, reason: `need ${signalN} macd points for signal` }
  }
  const macdValue = macdLine[macdLine.length - 1]
  const sig = ema(macdLine, signalN)
  return {
    macd: round(macdValue),
    signal: sig.value === null ? null : round(sig.value),
    histogram: sig.value === null ? null : round(macdValue - sig.value),
  }
}

export interface BollingerResult {
  upper: number | null
  middle: number | null
  lower: number | null
  widthPct: number | null // (upper-lower)/middle × 100
  percentB: number | null // where the last close sits inside the bands (0..1 typical)
  reason?: string
}

export function bollinger(closes: number[], n = 20, mult = 2): BollingerResult {
  const mid = sma(closes, n)
  if (mid.value === null) {
    return { upper: null, middle: null, lower: null, widthPct: null, percentB: null, reason: mid.reason }
  }
  let sq = 0
  for (let i = closes.length - n; i < closes.length; i++) sq += (closes[i] - mid.value) ** 2
  const sd = Math.sqrt(sq / n) // population std (classic Bollinger)
  const upper = mid.value + mult * sd
  const lower = mid.value - mult * sd
  const last = closes[closes.length - 1]
  const widthPct = mid.value !== 0 ? ((upper - lower) / mid.value) * 100 : null
  const percentB = upper !== lower ? (last - lower) / (upper - lower) : null
  return { upper: round(upper), middle: round(mid.value), lower: round(lower), widthPct: widthPct === null ? null : round(widthPct), percentB: percentB === null ? null : round(percentB) }
}

export interface StochasticResult {
  k: number | null
  d: number | null
  reason?: string
}

/** Stochastic %K over `n` sessions (needs high/low), %D = SMA(dN) of %K. */
export function stochastic(bars: Bar[], n = 14, dN = 3): StochasticResult {
  if (bars.length < n + dN - 1) return { k: null, d: null, reason: `need ${n + dN - 1} bars, have ${bars.length}` }
  const ks: number[] = []
  for (let i = n - 1; i < bars.length; i++) {
    let hh = -Infinity
    let ll = Infinity
    for (let j = i - n + 1; j <= i; j++) {
      if (bars[j].high > hh) hh = bars[j].high
      if (bars[j].low < ll) ll = bars[j].low
    }
    if (!finite(hh) || !finite(ll) || hh <= ll) continue // flat window — skip, never divide by zero
    ks.push(((bars[i].close - ll) / (hh - ll)) * 100)
  }
  if (ks.length < dN) return { k: null, d: null, reason: "no valid stochastic windows" }
  const k = ks[ks.length - 1]
  const dRes = sma(ks, dN)
  return { k: round(k), d: dRes.value === null ? null : round(dRes.value) }
}

// ---------------------------------------------------------------------------
// Volatility
// ---------------------------------------------------------------------------

/** Average True Range with Wilder smoothing. */
export function atr(bars: Bar[], n = 14): IndicatorResult {
  if (bars.length < n + 1) return insuff(`need ${n + 1} bars, have ${bars.length}`)
  const trs: number[] = []
  for (let i = 1; i < bars.length; i++) {
    const b = bars[i]
    const pc = bars[i - 1].close
    trs.push(Math.max(b.high - b.low, Math.abs(b.high - pc), Math.abs(b.low - pc)))
  }
  let acc = 0
  for (let i = 0; i < n; i++) acc += trs[i]
  let prev = acc / n
  for (let i = n; i < trs.length; i++) prev = (prev * (n - 1) + trs[i]) / n
  return r(prev)
}

/** Annualized historical volatility from log returns over the last `n` sessions. */
export function historicalVolatility(closes: number[], n = 20): IndicatorResult {
  if (closes.length < n + 1) return insuff(`need ${n + 1} closes, have ${closes.length}`)
  const rets: number[] = []
  for (let i = closes.length - n; i < closes.length; i++) {
    if (closes[i - 1] <= 0 || closes[i] <= 0) return insuff("non-positive close in window")
    rets.push(Math.log(closes[i] / closes[i - 1]))
  }
  const mean = rets.reduce((a, b) => a + b, 0) / n
  let sq = 0
  for (const x of rets) sq += (x - mean) ** 2
  const sd = Math.sqrt(sq / (n - 1)) // sample std
  return r(sd * Math.sqrt(252) * 100) // percent, annualized
}

// ---------------------------------------------------------------------------
// Volume
// ---------------------------------------------------------------------------

export interface ObvResult {
  obv: number | null
  /** OBV change over the last `n` sessions, null when volume missing */
  slopeN: number | null
  reason?: string
}

export function onBalanceVolume(bars: Bar[], slopeN = 20): ObvResult {
  if (bars.length < 2) return { obv: null, slopeN: null, reason: "need ≥2 bars" }
  let obv = 0
  const series: number[] = [0]
  for (let i = 1; i < bars.length; i++) {
    const v = bars[i].volume
    if (v === null || !finite(v)) return { obv: null, slopeN: null, reason: "missing volume in series" }
    if (bars[i].close > bars[i - 1].close) obv += v
    else if (bars[i].close < bars[i - 1].close) obv -= v
    series.push(obv)
  }
  const slope = series.length > slopeN ? series[series.length - 1] - series[series.length - 1 - slopeN] : null
  return { obv, slopeN: slope }
}

export interface VolumeStatsResult {
  volMa: number | null
  relVol: number | null // last volume / volMa
  reason?: string
}

export function volumeStats(bars: Bar[], n = 20): VolumeStatsResult {
  const vols: number[] = []
  for (const b of bars) {
    if (b.volume === null || !finite(b.volume)) return { volMa: null, relVol: null, reason: "missing volume in series" }
    vols.push(b.volume)
  }
  const ma = sma(vols.slice(0, -1), n) // average of the PRIOR n sessions (excludes the latest)
  if (ma.value === null || ma.value <= 0) return { volMa: ma.value, relVol: null, reason: ma.reason ?? "volume MA not positive" }
  const last = vols[vols.length - 1]
  return { volMa: round(ma.value), relVol: round(last / ma.value) }
}

// ---------------------------------------------------------------------------
// Support & Resistance — reproducible swing-pivot clustering
// ---------------------------------------------------------------------------

export interface PriceZone {
  price: number
  touches: number
  kind: "support" | "resistance"
  /** distance from the last close in percent (signed) */
  distPct: number
}

/**
 * Swing pivots (fractal, `wing` sessions on each side), clustered into zones
 * within `mergePct` of each other. Zones AT the last close are dropped; the
 * rest are labeled support/resistance relative to the last close.
 */
export function supportResistance(
  bars: Bar[],
  wing = 5,
  mergePct = 1.5,
  maxZones = 4
): { supports: PriceZone[]; resistances: PriceZone[] } {
  const last = bars[bars.length - 1]?.close
  if (!finite(last) || bars.length < wing * 2 + 1) return { supports: [], resistances: [] }
  const pivots: number[] = []
  for (let i = wing; i < bars.length - wing; i++) {
    let isHigh = true
    let isLow = true
    for (let j = i - wing; j <= i + wing; j++) {
      if (j === i) continue
      if (bars[j].high >= bars[i].high) isHigh = false
      if (bars[j].low <= bars[i].low) isLow = false
    }
    if (isHigh) pivots.push(bars[i].high)
    if (isLow) pivots.push(bars[i].low)
  }
  if (!pivots.length) return { supports: [], resistances: [] }
  // Cluster by proximity (mergePct of cluster anchor).
  pivots.sort((a, b) => a - b)
  const clusters: { sum: number; n: number }[] = []
  for (const p of pivots) {
    const lastC = clusters[clusters.length - 1]
    const anchor = lastC ? lastC.sum / lastC.n : null
    if (anchor !== null && (Math.abs(p - anchor) / anchor) * 100 <= mergePct) {
      lastC.sum += p
      lastC.n += 1
    } else {
      clusters.push({ sum: p, n: 1 })
    }
  }
  const zones: PriceZone[] = clusters
    .map((c) => {
      const price = c.sum / c.n
      return {
        price: round(price, 2),
        touches: c.n,
        kind: (price < last ? "support" : "resistance") as "support" | "resistance",
        distPct: round(((price - last) / last) * 100, 2),
      }
    })
    .filter((z) => z.price !== last)
  const supports = zones.filter((z) => z.kind === "support").sort((a, b) => b.price - a.price).slice(0, maxZones)
  const resistances = zones.filter((z) => z.kind === "resistance").sort((a, b) => a.price - b.price).slice(0, maxZones)
  return { supports, resistances }
}

// ---------------------------------------------------------------------------
// Trend structure
// ---------------------------------------------------------------------------

export interface TrendInfo {
  priceVsSma20: "above" | "below" | null
  priceVsSma50: "above" | "below" | null
  priceVsSma200: "above" | "below" | null
  sma20VsSma50: "above" | "below" | null
  sma50VsSma200: "above" | "below" | null
  /** aligned_uptrend | aligned_downtrend | mixed — null when any component missing */
  alignment: "aligned_uptrend" | "aligned_downtrend" | "mixed" | null
  /** sessions since the most recent SMA50/SMA200 cross (null when none found) */
  crossAge50200: number | null
}

export function trendInfo(closes: number[]): TrendInfo {
  const last = closes[closes.length - 1]
  const s20 = sma(closes, 20).value
  const s50 = sma(closes, 50).value
  const s200 = sma(closes, 200).value
  const cmp = (a: number | null, b: number | null): "above" | "below" | null =>
    a === null || b === null ? null : a >= b ? "above" : "below"
  let alignment: TrendInfo["alignment"] = null
  if (s20 !== null && s50 !== null && s200 !== null) {
    const up = last > s20 && s20 > s50 && s50 > s200
    const down = last < s20 && s20 < s50 && s50 < s200
    alignment = up ? "aligned_uptrend" : down ? "aligned_downtrend" : "mixed"
  }
  // Most recent SMA50/SMA200 cross (golden or death).
  let crossAge50200: number | null = null
  if (closes.length >= 201) {
    const s50s = smaSeries(closes, 50)
    const s200s = smaSeries(closes, 200)
    for (let i = closes.length - 1; i >= 200; i--) {
      const a = s50s[i]
      const b = s200s[i]
      const pa = s50s[i - 1]
      const pb = s200s[i - 1]
      if (a === null || b === null || pa === null || pb === null) continue
      if ((pa <= pb && a > b) || (pa >= pb && a < b)) {
        crossAge50200 = closes.length - 1 - i
        break
      }
    }
  }
  return {
    priceVsSma20: cmp(last, s20),
    priceVsSma50: cmp(last, s50),
    priceVsSma200: cmp(last, s200),
    sma20VsSma50: cmp(s20, s50),
    sma50VsSma200: cmp(s50, s200),
    alignment,
    crossAge50200,
  }
}

/** Session-based performance over `n` sessions back (percent), null when unavailable. */
export function perfN(closes: number[], n: number): number | null {
  if (closes.length < n + 1) return null
  const base = closes[closes.length - 1 - n]
  if (!finite(base) || base <= 0) return null
  return round(((closes[closes.length - 1] - base) / base) * 100, 2)
}

/** Type of the most recent SMA50/SMA200 cross: "golden" | "death" | null. */
export function crossType(closes: number[]): "golden" | "death" | null {
  if (closes.length < 201) return null
  const s50s = smaSeries(closes, 50)
  const s200s = smaSeries(closes, 200)
  for (let i = closes.length - 1; i >= 200; i--) {
    const a = s50s[i]
    const b = s200s[i]
    const pa = s50s[i - 1]
    const pb = s200s[i - 1]
    if (a === null || b === null || pa === null || pb === null) continue
    if (pa <= pb && a > b) return "golden"
    if (pa >= pb && a < b) return "death"
  }
  return null
}
