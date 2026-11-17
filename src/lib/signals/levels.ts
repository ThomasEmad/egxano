// =============================================================================
// Signal engine v2 — support/resistance zone map (PURE).
// Pivot-based zones with touch counting: swing highs/lows (window k) clustered
// by tolerance, each zone carrying its touches, recency and break state.
// Only REAL traded anatomy is used — no fabricated levels anywhere.
//
// DUAL LABELS (2026-11-18, OCPH «اكتوبر فارما» bug): every zone carries TWO
// kinds. `kind` is the HISTORICAL pivot origin (a swing-high cluster stays
// "resistance" forever) — the transition detectors (breakout / retest /
// support-break exit) read THIS one, because "the close just crossed a former
// ceiling" / "the price just fell through a former floor" are statements about
// history, not about today's position. `positionKind` is the label derived
// against the CURRENT last close — the truth any DISPLAY or nearest-level
// query must use: a zone fully under the close is structural support/history
// (an old ceiling the rally turned into a floor is NEVER a resistance again),
// a zone fully over the close is overhead supply (a just-broken support is a
// ceiling now), and a zone the close sits inside keeps its historical kind
// (the market is testing it right now). Evidence fields (touches, broken,
// lastTouchTs) are shared by both labels — classification changes the label,
// never the evidence.
// =============================================================================

import type { Bar } from "./types"

export interface PriceZone {
  /** HISTORICAL pivot origin: what the cluster was built from (swing-high
   *  cluster = "resistance", swing-low cluster = "support"). Transition
   *  detectors (breakout / retest / exit) read this one. */
  kind: "resistance" | "support"
  /** CURRENT-position label derived against the last close (see the header):
   *  fully below the close → "support", fully above → "resistance", close
   *  inside the zone → falls back to the historical `kind`. Always set by
   *  buildZoneMap; consumers must not fall back to `kind` for display. */
  positionKind: "resistance" | "support"
  low: number
  high: number
  /** distinct swing pivots merged into this zone */
  touches: number
  /** session (ts) of the most recent touch */
  lastTouchTs: string
  /** index of the most recent touch */
  lastTouchIdx: number
  /** a resistance the market later CLOSED above (retest structure) */
  broken: boolean
  /** session of the closing break (when broken) */
  brokenTs?: string
}

export interface ZoneMap {
  zones: PriceZone[]
  /** ATR used for the clustering tolerance (null when < 15 sessions) */
  atr: number | null
}

const PIVOT_K = 3 // sessions on each side for a pivot
const CLUSTER_TOL_PCT = 1.5 // zone merge tolerance (% of price)

function emitCluster(cluster: { kind: "resistance" | "support"; level: number; idx: number; ts: string }[], kind: "resistance" | "support", zones: PriceZone[]) {
  if (!cluster.length) return
  const lastTouch = cluster.reduce((a, b) => (b.idx > a.idx ? b : a))
  zones.push({
    kind,
    // provisional: re-derived against the last close below (derivePositionKind)
    positionKind: kind,
    low: Math.min(...cluster.map((p) => p.level)),
    high: Math.max(...cluster.map((p) => p.level)),
    touches: cluster.length,
    lastTouchTs: lastTouch.ts,
    lastTouchIdx: lastTouch.idx,
    broken: false,
  })
}

/** The current-position label of one zone against `lastClose` (OCPH rule):
 *  a zone whose HIGH is below the close can never be a resistance — it is
 *  structural support/history now; a zone whose LOW is above the close can
 *  never be a support — it is overhead supply now; a zone the close sits
 *  inside keeps its historical kind (the market is testing it right now). */
function derivePositionKind(z: PriceZone, lastClose: number): "resistance" | "support" {
  if (z.high < lastClose) return "support"
  if (z.low > lastClose) return "resistance"
  return z.kind
}

function isPivotHigh(bars: Bar[], i: number, k: number): boolean {
  const h = bars[i].high
  for (let j = Math.max(0, i - k); j <= Math.min(bars.length - 1, i + k); j++) {
    if (j !== i && bars[j].high > h) return false
    // strict: equal highs both count as touches via clustering, not duplicates
    if (j !== i && bars[j].high === h && j < i) return false
  }
  return true
}

function isPivotLow(bars: Bar[], i: number, k: number): boolean {
  const l = bars[i].low
  for (let j = Math.max(0, i - k); j <= Math.min(bars.length - 1, i + k); j++) {
    if (j !== i && bars[j].low < l) return false
    if (j !== i && bars[j].low === l && j < i) return false
  }
  return true
}

/** Build the zone map over the bar series. The last PIVOT_K sessions can't be
 *  pivots yet (the window is incomplete) — that's correct, no lookahead. */
export function buildZoneMap(bars: Bar[]): ZoneMap {
  // ATR for tolerance (simple 14-session mean of TR — enough for clustering)
  let atr: number | null = null
  if (bars.length >= 15) {
    const trs: number[] = []
    for (let i = 1; i < bars.length; i++) {
      const b = bars[i]
      const pc = bars[i - 1].close
      trs.push(Math.max(b.high - b.low, Math.abs(b.high - pc), Math.abs(b.low - pc)))
    }
    atr = trs.slice(-14).reduce((s, t) => s + t, 0) / Math.min(14, trs.length)
  }

  const pivots: { kind: "resistance" | "support"; level: number; idx: number; ts: string }[] = []
  const lastCompleteIdx = bars.length - 1 - PIVOT_K
  for (let i = PIVOT_K; i <= lastCompleteIdx; i++) {
    if (isPivotHigh(bars, i, PIVOT_K)) pivots.push({ kind: "resistance", level: bars[i].high, idx: i, ts: bars[i].ts })
    if (isPivotLow(bars, i, PIVOT_K)) pivots.push({ kind: "support", level: bars[i].low, idx: i, ts: bars[i].ts })
  }

  const zones: PriceZone[] = []
  const tolOf = (base: number) => (base * CLUSTER_TOL_PCT) / 100 + (atr ? atr * 0.35 : 0)
  for (const kind of ["resistance", "support"] as const) {
    const pts = pivots.filter((p) => p.kind === kind).sort((a, b) => a.level - b.level)
    // greedy clustering: consecutive levels within tolerance of the cluster base
    let cluster: typeof pts = []
    for (const p of pts) {
      if (!cluster.length) {
        cluster = [p]
        continue
      }
      if (p.level - cluster[0].level <= tolOf(cluster[0].level)) {
        cluster.push(p)
      } else {
        emitCluster(cluster, kind, zones)
        cluster = [p]
      }
    }
    emitCluster(cluster, kind, zones)
  }

  // Break detection: a resistance zone the market closed above AFTER its last
  // touch becomes "broken" retest structure (the break must come later).
  for (const z of zones) {
    if (z.kind !== "resistance") continue
    for (let i = z.lastTouchIdx + 1; i < bars.length; i++) {
      if (bars[i].close > z.high) {
        z.broken = true
        z.brokenTs = bars[i].ts
        break
      }
    }
  }

  // Position classification (2026-11-18, OCPH bug): re-derive each zone's
  // label against the CURRENT last close — the last session's close, the one
  // reference price the user actually stands at. Runs AFTER break detection
  // (the broken flag reads the historical resistance semantics). Evidence
  // (touches / broken / lastTouchTs / lastTouchIdx) is left untouched.
  if (bars.length > 0) {
    const lastClose = bars[bars.length - 1].close
    for (const z of zones) z.positionKind = derivePositionKind(z, lastClose)
  }

  zones.sort((a, b) => a.low - b.low)
  return { zones, atr }
}

/** Nearest UNBROKEN resistance strictly above `price` (for targets & vetoes).
 *  Deliberately reads the HISTORICAL `kind`: an entry/target is a structure the
 *  market has not claimed yet (a swing-high cluster), and the `z.low > price`
 *  guard already guarantees the zone sits overhead — it can never return a
 *  zone below the price. */
export function nearestResistanceAbove(map: ZoneMap, price: number): PriceZone | null {
  const cands = map.zones.filter((z) => z.kind === "resistance" && !z.broken && z.low > price)
  return cands.length ? cands[0] : null
}

/** Nearest support strictly below `price`. Reads the CURRENT-position label
 *  (falling back to the historical kind for hand-built maps): after a rally,
 *  the breakout base — an old swing-high cluster fully under the close — is
 *  structural support/history, so it IS the floor the user stands on. */
export function nearestSupportBelow(map: ZoneMap, price: number): PriceZone | null {
  const cands = map.zones.filter((z) => (z.positionKind ?? z.kind) === "support" && z.high < price)
  return cands.length ? cands[cands.length - 1] : null
}

/** Overhead room % from price to the nearest unbroken resistance low. */
export function overheadRoomPct(map: ZoneMap, price: number): number | null {
  const z = nearestResistanceAbove(map, price)
  return z ? ((z.low - price) / price) * 100 : null
}

/** Strongest multi-touch resistance overlapping or just above a level
 *  (used by breakout/retest detection). */
export function findZoneAround(map: ZoneMap, price: number, tolPct: number): PriceZone | null {
  let best: PriceZone | null = null
  for (const z of map.zones) {
    const mid = (z.low + z.high) / 2
    const gap = (Math.abs(mid - price) / price) * 100
    if (gap <= tolPct && (!best || z.touches > best.touches)) best = z
  }
  return best
}
