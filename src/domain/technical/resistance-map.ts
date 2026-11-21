// =============================================================================
// Resistance Map — swing-pivot supply/demand bands with documented strength.
// =============================================================================
// resistance-map@1 — deterministic, evidence-first, additive to zones.ts.
// zones.ts finds FORMATION zones (consolidation breaks / pivot rejections with
// self-invalidation); THIS module maps every historically-rejected LEVEL into a
// clustered band and scores how hard it resisted, so the target ladder can
// walk the real obstacle path. No AI, no randomness, no probability claims.
//
// FORMATION RULES (all documented in RESISTANCE_THRESHOLDS):
//   P1 Valid bars only: a session enters the map when all four OHLC values are
//      finite and > 0 and high >= low, AND it is not a FLAT scanner placeholder
//      (O = H = L = C within 1e-9 — the candlestick.ts flat-bar convention;
//      a flat bar carries no intraday anatomy and must not seed zones).
//   P2 Swing pivots: fractal with PIVOT_WING = 3 sessions on each side (a pivot
//      needs wing bars on BOTH sides — confirmed late, the last wing sessions
//      can never hold one; same no-repaint rule as structure.ts R1). The
//      comparison is LOOSE (an equal high does not disqualify the pivot) — the
//      tech-signals@5 EQUAL-EXTREME FIX from indicators.ts supportResistance:
//      an equal high is a TOUCH of the level, not a rejection of the pivot.
//   P3 Clustering: pivots of one kind are sorted by price and greedily grouped;
//      a pivot joins the current cluster only if it stays within
//      CLUSTER_TOL_PCT (1.5%) of the cluster MEAN (indicators.ts/zones.ts
//      mergePct convention) AND the cluster span stays <= MAX_CLUSTER_SPAN_PCT
//      (2%) of its low (the max-width rule — a "zone" wider than that is two
//      levels, not one). Otherwise a new cluster starts.
//   P4 Band: low = cluster min × (1 − BAND_BUFFER_PCT/100), high = cluster max
//      × (1 + BAND_BUFFER_PCT/100) — the zones.ts F2 ±0.6% buffer convention.
//      Max band width ≈ 2% span + 1.2% buffer ≈ 3.2% by construction.
//   P5 Touch: a session TOUCHES a supply band when its high reaches into the
//      band (high >= zone.low) while its close stays under the ceiling
//      (close < zone.high) — probed the level, did not clear it. A session
//      closing above the ceiling is a BREAKOUT session, never a touch. Demand
//      mirrors (low <= zone.high, close > zone.low). The founding pivots are
//      touches too — the scan runs over every valid session.
//   P6 Rejection session: a touch session whose wick against the band shows
//      decisive rejection — upper wick >= WICK_REJECT_RATIO (40%) of the range
//      at supply, lower wick >= 40% at demand.
//   P7 Failed breakout: an EPISODE opens on the first close beyond the band
//      (above zone.high for supply / below zone.low for demand) and FAILS when
//      some session within FAILED_BREAKOUT_WINDOW (5) sessions of that first
//      breakout close closes back on the original side (below zone.low for
//      supply). A sustained pierce with no return inside the window is an
//      abandoned (live) breakout — it earns no strength credit and the whole
//      above-run is consumed so one pierce can never count twice.
//   P8 Recency/age are SESSION counts (index distance in the valid series),
//      not calendar days — EGX sessions are the engine's time unit everywhere.
//
// STRENGTH (0-100, weights sum to 100 — every term hand-checkable):
//   + touch count      TOUCH_WEIGHT×min(touches, TOUCH_CAP)/TOUCH_CAP   (max 30)
//   + recency          RECENCY_WEIGHT×max(0, (FADE−age)/FADE) on the LAST
//                      touch age in sessions (linear fade to zero at
//                      RECENCY_FADE_SESSIONS = 120 ≈ half a trading year) (25)
//   + rejection        REJECTION_WEIGHT×min(rejectionSessions, CAP)/CAP (20)
//   + volume           VOLUME_WEIGHT×(touch-volume ratio vs the series MEDIAN
//                      volume: ≥ VOL_HIGH_RATIO → full, 1.0..1.5 linear,
//                      < 1 or unknown → 0)                                 (15)
//   + failed breakouts FAILED_BREAKOUT_WEIGHT×min(n, CAP)/CAP              (10)
//   A single stale one-touch zone therefore scores 5; a fresh single touch 30;
//   a six-touch fresh ceiling with wicks, volume and a failed breakout 100.
//
// HONESTY: every zone field is derived from real OHLC of the passed bars.
// Empty/insufficient input (< MIN_SESSIONS valid sessions) → an UNAVAILABLE
// map — never a fabricated level. No probability is attached anywhere.
// =============================================================================

import type { Bar } from "./indicators"

export const RESISTANCE_MAP_VERSION = "resistance-map@1"

/** Every formation threshold and scoring weight, in one place (see header). */
export const RESISTANCE_THRESHOLDS = {
  // ---- formation ----
  /** fractal pivot lookback: sessions required on EACH side of a pivot */
  PIVOT_WING: 3,
  /** minimum VALID (non-flat, well-formed OHLC) sessions to build any map */
  MIN_SESSIONS: 40,
  /** flat-bar epsilon (candlestick.ts convention): O=H=L=C within this is a
   *  scanner placeholder and is skipped */
  FLAT_EPS: 1e-9,
  /** a pivot joins a cluster only within this % of the cluster mean */
  CLUSTER_TOL_PCT: 1.5,
  /** max-width rule: a cluster whose span exceeds this % of its low splits */
  MAX_CLUSTER_SPAN_PCT: 2,
  /** band buffer around the cluster min/max (zones.ts F2 convention) */
  BAND_BUFFER_PCT: 0.6,
  // ---- strength weights (sum = 100) ----
  /** weight of the (capped) touch count term */
  TOUCH_WEIGHT: 30,
  /** touch count cap for the touch term */
  TOUCH_CAP: 6,
  /** weight of the last-touch recency term */
  RECENCY_WEIGHT: 25,
  /** sessions after the last touch over which recency fades linearly to 0 */
  RECENCY_FADE_SESSIONS: 120,
  /** weight of the rejection-wick term */
  REJECTION_WEIGHT: 20,
  /** rejection-session cap for the rejection term */
  REJECTION_CAP: 4,
  /** wick share of the bar range that counts as rejection (40%) */
  WICK_REJECT_RATIO: 0.4,
  /** weight of the touch-volume term */
  VOLUME_WEIGHT: 15,
  /** touch-volume ratio vs series median that earns the full volume term */
  VOL_HIGH_RATIO: 1.5,
  /** weight of the failed-breakout term */
  FAILED_BREAKOUT_WEIGHT: 10,
  /** failed-breakout cap for its term */
  FAILED_BREAKOUT_CAP: 2,
  /** sessions after a breakout close within which a return-close fails it */
  FAILED_BREAKOUT_WINDOW: 5,
  /** measured-move window (last-N-session range height, trade-plan.ts
   *  MEASURED_WINDOW convention; needs >= 20 valid sessions) */
  MEASURED_WINDOW: 40,
  /** minimum valid sessions inside the measured window for a projection */
  MEASURED_MIN_SESSIONS: 20,
} as const

export interface ResistanceZone {
  kind: "supply" | "demand"
  low: number
  high: number
  /** sessions whose high/low probed the band without closing through it */
  touches: number
  /** session date of the most recent touch */
  lastTouchTs: string
  /** 0-100 documented evidence score (see RESISTANCE_THRESHOLDS) */
  strength: number
  /** breakout episodes that closed back inside within the window */
  failedBreakouts: number
  /** touch sessions with a >= 40% rejection wick against the band */
  rejectionSessions: number
  /** sessions between the last touch and the last valid session */
  lastTouchAgeSessions: number
  /** mean touch-session volume ÷ series median volume (null when unknown) */
  touchVolRatio: number | null
}

export interface SwingExtreme {
  price: number
  ts: string
}

export interface ResistanceMap {
  version: string
  available: boolean
  /** present when the map could not be built (insufficient evidence) */
  reason?: string
  /** session date of the last valid bar (null on an empty map) */
  asOf: string | null
  /** number of valid sessions used */
  sessions: number
  /** all zones, ascending by low */
  zones: ResistanceZone[]
  /** the extreme CONFIRMED swing pivots (a pivot in the last wing sessions is
   *  not yet confirmed and is honestly absent) */
  extremes: { majorHigh: SwingExtreme | null; majorLow: SwingExtreme | null }
  /** last-N-session range (trade-plan.ts measured-move convention) */
  measured: { sessions: number; low: number | null; high: number | null; height: number | null }
  /** median session volume of the valid series (null when volume unknown) */
  medianVolume: number | null
}

interface Pivot {
  idx: number
  ts: string
  price: number
  kind: "high" | "low"
}

const round2 = (x: number): number => Math.round(x * 100) / 100

function finite(x: unknown): x is number {
  return typeof x === "number" && Number.isFinite(x)
}

/**
 * Validity + flat-skip gate (P1). Well-formed real OHLC only; a bar with
 * O = H = L = C within FLAT_EPS is a scanner placeholder and is skipped —
 * the candlestick.ts flat-bar convention, reused verbatim.
 */
function isValidBar(b: Bar): boolean {
  const { open, high, low, close } = b
  if (![open, high, low, close].every((x) => finite(x) && x > 0)) return false
  if (high < low) return false
  const eps = RESISTANCE_THRESHOLDS.FLAT_EPS
  if (Math.abs(open - high) <= eps && Math.abs(high - low) <= eps && Math.abs(low - close) <= eps) return false
  return true
}

/**
 * Fractal pivots (P2): loose comparisons per the tech-signals@5 EQUAL-EXTREME
 * FIX — an equal high is a touch, not a rejection, so equal-top sessions stay
 * pivot candidates (multi-touch ceilings must not vanish). No repaint: the
 * last PIVOT_WING sessions can never hold a pivot.
 */
function fractalPivots(bars: Bar[], wing: number): Pivot[] {
  const out: Pivot[] = []
  for (let i = wing; i < bars.length - wing; i++) {
    let isHigh = true
    let isLow = true
    for (let j = i - wing; j <= i + wing; j++) {
      if (j === i) continue
      if (bars[j].high > bars[i].high) isHigh = false
      if (bars[j].low < bars[i].low) isLow = false
      if (!isHigh && !isLow) break
    }
    if (isHigh) out.push({ idx: i, ts: bars[i].ts, price: bars[i].high, kind: "high" })
    if (isLow) out.push({ idx: i, ts: bars[i].ts, price: bars[i].low, kind: "low" })
  }
  return out
}

interface Cluster {
  prices: number[]
  min: number
  max: number
  sum: number
}

/**
 * Greedy same-price-kind clustering (P3): a pivot joins the current cluster
 * while it stays within CLUSTER_TOL_PCT of the cluster mean AND the span stays
 * within MAX_CLUSTER_SPAN_PCT of the cluster low; otherwise a new cluster
 * starts. Deterministic on the price-sorted pivot order.
 */
function clusterPivots(pivots: Pivot[]): Cluster[] {
  const sorted = [...pivots].sort((a, b) => a.price - b.price)
  const clusters: Cluster[] = []
  for (const p of sorted) {
    const cur = clusters[clusters.length - 1]
    if (cur) {
      // tolerance is measured against the CURRENT cluster mean (indicators.ts
      // anchor convention) — not the mean that would result from joining
      const mean = cur.sum / cur.prices.length
      const tolPct = (Math.abs(p.price - mean) / mean) * 100
      const newMin = Math.min(cur.min, p.price)
      const newMax = Math.max(cur.max, p.price)
      const spanPct = ((newMax - newMin) / newMin) * 100
      if (tolPct <= RESISTANCE_THRESHOLDS.CLUSTER_TOL_PCT && spanPct <= RESISTANCE_THRESHOLDS.MAX_CLUSTER_SPAN_PCT) {
        cur.prices.push(p.price)
        cur.min = newMin
        cur.max = newMax
        cur.sum += p.price
        continue
      }
    }
    clusters.push({ prices: [p.price], min: p.price, max: p.price, sum: p.price })
  }
  return clusters
}

/** Mean of the non-null volumes among the given session indices; null when none. */
function meanVolumeAt(bars: Bar[], idxs: number[]): number | null {
  let sum = 0
  let n = 0
  for (const i of idxs) {
    const v = bars[i].volume
    if (v !== null && finite(v) && v >= 0) {
      sum += v
      n++
    }
  }
  return n > 0 ? sum / n : null
}

/** Median of the non-null volumes (even count → mean of the two middle). */
function medianVolume(bars: Bar[]): number | null {
  const vols: number[] = []
  for (const b of bars) {
    const v = b.volume
    if (v !== null && finite(v) && v >= 0) vols.push(v)
  }
  if (!vols.length) return null
  vols.sort((a, b) => a - b)
  const mid = Math.floor(vols.length / 2)
  return vols.length % 2 === 1 ? vols[mid] : (vols[mid - 1] + vols[mid]) / 2
}

/**
 * Failed-breakout episodes (P7): an episode opens on the first close beyond
 * the band and fails when a close back on the original side occurs within
 * FAILED_BREAKOUT_WINDOW sessions of that first breakout close. A non-failed
 * episode consumes its whole beyond-run so one sustained pierce can never be
 * counted twice. `beyond` = close is beyond the ceiling (supply) / floor
 * (demand); `returned` = close is back on the original side.
 */
function countFailedBreakouts(bars: Bar[], beyond: (c: number) => boolean, returned: (c: number) => boolean): number {
  const n = bars.length
  const win = RESISTANCE_THRESHOLDS.FAILED_BREAKOUT_WINDOW
  let failed = 0
  let i = 0
  while (i < n) {
    if (beyond(bars[i].close)) {
      let failedEp = false
      let j = i + 1
      for (; j <= Math.min(n - 1, i + win); j++) {
        if (returned(bars[j].close)) {
          failedEp = true
          break
        }
      }
      if (failedEp) {
        failed++
        i = j + 1
      } else {
        while (i < n && beyond(bars[i].close)) i++
      }
    } else {
      i++
    }
  }
  return failed
}

/** Build one zone from a cluster and score it against the whole valid series. */
function buildZone(
  kind: "supply" | "demand",
  cluster: Cluster,
  bars: Bar[],
  medianVol: number | null,
): ResistanceZone {
  const buf = RESISTANCE_THRESHOLDS.BAND_BUFFER_PCT / 100
  const low = round2(cluster.min * (1 - buf))
  const high = round2(cluster.max * (1 + buf))

  // P5 touch scan + P6 rejection wicks + touch volumes, one chronological pass.
  let touches = 0
  let rejections = 0
  let lastTouchIdx = -1
  const touchIdxs: number[] = []
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i]
    const range = b.high - b.low
    if (kind === "supply") {
      if (b.high >= low && b.close < high) {
        touches++
        touchIdxs.push(i)
        lastTouchIdx = i
        const upperWick = (b.high - Math.max(b.open, b.close)) / range
        if (upperWick >= RESISTANCE_THRESHOLDS.WICK_REJECT_RATIO) rejections++
      }
    } else {
      if (b.low <= high && b.close > low) {
        touches++
        touchIdxs.push(i)
        lastTouchIdx = i
        const lowerWick = (Math.min(b.open, b.close) - b.low) / range
        if (lowerWick >= RESISTANCE_THRESHOLDS.WICK_REJECT_RATIO) rejections++
      }
    }
  }

  const failedBreakouts =
    kind === "supply"
      ? countFailedBreakouts(bars, (c) => c > high, (c) => c < low)
      : countFailedBreakouts(bars, (c) => c < low, (c) => c > high)

  // Strength terms (header STRENGTH block; every weight in RESISTANCE_THRESHOLDS).
  const t = RESISTANCE_THRESHOLDS
  const touchScore = (t.TOUCH_WEIGHT * Math.min(touches, t.TOUCH_CAP)) / t.TOUCH_CAP
  const age = lastTouchIdx >= 0 ? bars.length - 1 - lastTouchIdx : bars.length
  const recencyScore = (t.RECENCY_WEIGHT * Math.max(0, t.RECENCY_FADE_SESSIONS - age)) / t.RECENCY_FADE_SESSIONS
  const rejectionScore = (t.REJECTION_WEIGHT * Math.min(rejections, t.REJECTION_CAP)) / t.REJECTION_CAP
  const touchVol = meanVolumeAt(bars, touchIdxs)
  let volumeScore = 0
  let touchVolRatio: number | null = null
  if (touchVol !== null && medianVol !== null && medianVol > 0) {
    touchVolRatio = touchVol / medianVol
    if (touchVolRatio >= t.VOL_HIGH_RATIO) volumeScore = t.VOLUME_WEIGHT
    else if (touchVolRatio >= 1) volumeScore = (t.VOLUME_WEIGHT * (touchVolRatio - 1)) / (t.VOL_HIGH_RATIO - 1)
  }
  const failedScore = (t.FAILED_BREAKOUT_WEIGHT * Math.min(failedBreakouts, t.FAILED_BREAKOUT_CAP)) / t.FAILED_BREAKOUT_CAP
  const strength = Math.max(0, Math.min(100, Math.round(touchScore + recencyScore + rejectionScore + volumeScore + failedScore)))

  return {
    kind,
    low,
    high,
    touches,
    lastTouchTs: bars[lastTouchIdx].ts,
    strength,
    failedBreakouts,
    rejectionSessions: rejections,
    lastTouchAgeSessions: age,
    touchVolRatio: touchVolRatio === null ? null : round2(touchVolRatio),
  }
}

/**
 * Build the resistance map from real daily OHLC bars (ascending by ts).
 * Returns an UNAVAILABLE map — never a fabricated level — when fewer than
 * MIN_SESSIONS valid sessions survive the flat-skip gate.
 */
export function buildResistanceMap(bars: Bar[]): ResistanceMap {
  const empty: ResistanceMap = {
    version: RESISTANCE_MAP_VERSION,
    available: false,
    asOf: null,
    sessions: 0,
    zones: [],
    extremes: { majorHigh: null, majorLow: null },
    measured: { sessions: 0, low: null, high: null, height: null },
    medianVolume: null,
  }
  const valid = (Array.isArray(bars) ? bars : []).filter(isValidBar)
  if (valid.length < RESISTANCE_THRESHOLDS.MIN_SESSIONS) {
    return { ...empty, reason: `needs >= ${RESISTANCE_THRESHOLDS.MIN_SESSIONS} valid OHLC sessions, have ${valid.length}` }
  }

  const pivots = fractalPivots(valid, RESISTANCE_THRESHOLDS.PIVOT_WING)
  const highPivots = pivots.filter((p) => p.kind === "high")
  const lowPivots = pivots.filter((p) => p.kind === "low")
  const medianVol = medianVolume(valid)

  const zones: ResistanceZone[] = [
    ...clusterPivots(highPivots).map((c) => buildZone("supply", c, valid, medianVol)),
    ...clusterPivots(lowPivots).map((c) => buildZone("demand", c, valid, medianVol)),
  ].sort((a, b) => a.low - b.low || a.high - b.high)

  // Extreme confirmed pivots (ties → the most recent session wins).
  const byHigh = (a: Pivot, b: Pivot) => b.price - a.price || b.idx - a.idx
  const byLow = (a: Pivot, b: Pivot) => a.price - b.price || b.idx - a.idx
  const top = [...highPivots].sort(byHigh)[0]
  const bottom = [...lowPivots].sort(byLow)[0]

  // Measured window (trade-plan.ts MEASURED_WINDOW convention).
  const mw = valid.slice(-RESISTANCE_THRESHOLDS.MEASURED_WINDOW)
  let measured: ResistanceMap["measured"] = { sessions: mw.length, low: null, high: null, height: null }
  if (mw.length >= RESISTANCE_THRESHOLDS.MEASURED_MIN_SESSIONS) {
    const lo = Math.min(...mw.map((b) => b.low))
    const hi = Math.max(...mw.map((b) => b.high))
    if (hi > lo) measured = { sessions: mw.length, low: round2(lo), high: round2(hi), height: round2(hi - lo) }
  }

  return {
    version: RESISTANCE_MAP_VERSION,
    available: zones.length > 0,
    ...(zones.length === 0 ? { reason: "no confirmed swing pivots in the retained window" } : {}),
    asOf: valid[valid.length - 1].ts,
    sessions: valid.length,
    zones,
    extremes: {
      majorHigh: top ? { price: round2(top.price), ts: top.ts } : null,
      majorLow: bottom ? { price: round2(bottom.price), ts: bottom.ts } : null,
    },
    measured,
    medianVolume: medianVol === null ? null : round2(medianVol),
  }
}

// ---------------------------------------------------------------------------
// Price-relative queries — standalone pure helpers (the repo's convention:
// plain snapshot data + helpers, cf. nearestBelow/nearestAbove in trade-plan).
// ---------------------------------------------------------------------------

/** Nearest supply band strictly ABOVE `price` (a band containing the price is
 *  not above it). Nearest by band low; ties → the stronger band. */
export function nearestSupplyAbove(map: ResistanceMap, price: number): ResistanceZone | null {
  if (!finite(price)) return null
  let best: ResistanceZone | null = null
  for (const z of map.zones) {
    if (z.kind !== "supply" || z.low <= price) continue
    if (best === null || z.low < best.low || (z.low === best.low && z.strength > best.strength)) best = z
  }
  return best
}

/** Nearest demand band strictly BELOW `price`. Nearest by band high; ties →
 *  the stronger band. */
export function nearestSupportBelow(map: ResistanceMap, price: number): ResistanceZone | null {
  if (!finite(price)) return null
  let best: ResistanceZone | null = null
  for (const z of map.zones) {
    if (z.kind !== "demand" || z.high >= price) continue
    if (best === null || z.high > best.high || (z.high === best.high && z.strength > best.strength)) best = z
  }
  return best
}

/**
 * Every zone (either kind) whose band intersects the inclusive price path
 * between `fromPrice` and `toPrice`, ordered ascending by band low. A
 * zero-length path (from === to) crosses nothing.
 */
export function obstaclesBetween(map: ResistanceMap, fromPrice: number, toPrice: number): ResistanceZone[] {
  if (!finite(fromPrice) || !finite(toPrice) || fromPrice === toPrice) return []
  const lo = Math.min(fromPrice, toPrice)
  const hi = Math.max(fromPrice, toPrice)
  return map.zones.filter((z) => z.low <= hi && z.high >= lo).sort((a, b) => a.low - b.low)
}

/** Highest-strength supply band; ties → more touches, then the lower band. */
export function majorResistance(map: ResistanceMap): ResistanceZone | null {
  let best: ResistanceZone | null = null
  for (const z of map.zones) {
    if (z.kind !== "supply") continue
    if (
      best === null ||
      z.strength > best.strength ||
      (z.strength === best.strength && (z.touches > best.touches || (z.touches === best.touches && z.low < best.low)))
    )
      best = z
  }
  return best
}

/** Highest-strength demand band; ties → more touches, then the higher band. */
export function majorSupport(map: ResistanceMap): ResistanceZone | null {
  let best: ResistanceZone | null = null
  for (const z of map.zones) {
    if (z.kind !== "demand") continue
    if (
      best === null ||
      z.strength > best.strength ||
      (z.strength === best.strength && (z.touches > best.touches || (z.touches === best.touches && z.high > best.high)))
    )
      best = z
  }
  return best
}

/**
 * Strength of the evidence AT a price: the strongest band containing it
 * (band edges inclusive), null when no band contains the price. Used to give
 * major-high/major-low ladder rungs their real, non-fabricated strength.
 */
export function strengthAt(map: ResistanceMap, kind: "supply" | "demand", price: number): number | null {
  if (!finite(price)) return null
  let best: number | null = null
  for (const z of map.zones) {
    if (z.kind !== kind || z.low > price || z.high < price) continue
    if (best === null || z.strength > best) best = z.strength
  }
  return best
}
