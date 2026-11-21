// =============================================================================
// Board gates — conviction tier + market-regime gate + the "فرص اليوم" digest
// assembly. PURE functions only: no DB, no server imports, fully unit-tested.
//
// WHY (owner-approved design, deterministic — no AI): the board ranks by score
// alone, which conflates "how strong the reading is" with "how good the
// evidence behind it is" and ignores what the rest of the market is doing.
// This module separates the two:
//   • convictionTier  — QUALITY OF EVIDENCE for one row (score band, plan
//     quality, positive-reason dominance). Deliberately NOT direction: a
//     high-conviction short is as legitimate as a high-conviction long.
//   • marketRegime    — board-wide regime from aggregates the loader already
//     computes (technical breadth + median board score).
//   • applyRegimeGate — the anti-fighting-the-tape penalty: buy reads in a
//     bear regime and sell reads in a bull regime lose one tier.
//   • buildOpportunitiesDigest — the ordered, capped "فرص اليوم" digest.
//
// Every numeric threshold lives in one exported constant (CONVICTION_THRESHOLDS
// / REGIME_THRESHOLDS) and is pinned by boundary tests.
// =============================================================================

import type { MarketSignalRow, GatedSignalRow } from "@/lib/technical/signals-service"
import { gateRowForFree } from "./board-filters"

// ---------------------------------------------------------------------------
// Conviction tier
// ---------------------------------------------------------------------------

export type ConvictionTier = "A" | "B" | "C"

/**
 * Every conviction threshold in one place (documented + boundary-tested).
 *
 * Tier = the WEAKEST of three independent evidence pillars:
 *   1. score pillar   — the board score band (A ≥ 70, B ≥ 55, else C).
 *      70/55 match the board's own score filters (s70/s60) so the tier never
 *      contradicts the chip counts a user can already see.
 *   2. plan pillar    — risk/reward and stop-distance sanity of the tradable
 *      payload (confirmed rows: tradePlan; watching rows: the provisional
 *      watched-setup levels). A ≥ 2.0 RR (the classic "2-to-1" bar), B ≥ 1.5
 *      (exactly the plan builder's own honesty floor in trade-plan.ts), and a
 *      stop distance that is neither inside the noise band nor absurdly far.
 *   3. evidence pillar — positive-reason dominance (tone counts on reasons[]):
 *      A needs ≥ 2 positive reasons AND strictly more positives than
 *      negatives; B needs ≥ 1 positive and positives ≥ negatives; else C.
 */
export const CONVICTION_THRESHOLDS = {
  /** Score ≥ this earns the A band on the score pillar. */
  SCORE_A: 70,
  /** Score ≥ this (and < SCORE_A) earns the B band. */
  SCORE_B: 55,
  /** Risk/reward ≥ this earns the A band on the plan pillar. */
  RR_A: 2,
  /** Risk/reward ≥ this (and < RR_A) earns the B band — the plan builder's own floor. */
  RR_B: 1.5,
  /** Stop distance (|stopPct|, percent from close) sanity band — below this the
   *  stop lives inside intraday noise (a plan the daily engine cannot honor). */
  STOP_MIN_PCT: 1,
  /** Stop distance above this percent is structurally absurd for the daily engine. */
  STOP_MAX_PCT: 10,
  /** When the daily-volatility proxy (metrics.dailyVolPct) is known, the stop
   *  must sit at least this multiple of it away from the close — a 4%/day
   *  name with a 1% stop is noise, regardless of the absolute band. */
  NOISE_FACTOR: 0.5,
  /** Minimum positive-tone reasons for the A band on the evidence pillar. */
  POSITIVE_MIN_A: 2,
  /** Required dominance (positives − negatives) for the A band. */
  DOMINANCE_A: 1,
  /** Minimum positive-tone reasons for the B band. */
  POSITIVE_MIN_B: 1,
  /** Required dominance (positives − negatives) for the B band (ties allowed). */
  DOMINANCE_B: 0,
} as const

const TIER_RANK: Record<ConvictionTier, number> = { A: 0, B: 1, C: 2 }

function weakest(a: ConvictionTier, b: ConvictionTier): ConvictionTier {
  return TIER_RANK[a] >= TIER_RANK[b] ? a : b
}

/** Score pillar: null score (weak data) can never be evidence-grade. */
function scorePillar(row: MarketSignalRow): ConvictionTier {
  const s = row.score
  if (s === null || !Number.isFinite(s)) return "C"
  if (s >= CONVICTION_THRESHOLDS.SCORE_A) return "A"
  if (s >= CONVICTION_THRESHOLDS.SCORE_B) return "B"
  return "C"
}

/**
 * Stop-distance sanity: the plan's stop percent must clear the absolute band
 * AND, when daily volatility is known, the noise floor (NOISE_FACTOR × dailyVolPct).
 * Missing inputs (no close / no stop) mean NOT sane — conservative by design.
 */
export function stopDistanceSane(stopPct: number | null, dailyVolPct: number | null): boolean {
  if (stopPct === null || !Number.isFinite(stopPct)) return false
  const dist = Math.abs(stopPct)
  if (dist < CONVICTION_THRESHOLDS.STOP_MIN_PCT || dist > CONVICTION_THRESHOLDS.STOP_MAX_PCT) return false
  if (dailyVolPct !== null && Number.isFinite(dailyVolPct) && dailyVolPct > 0) {
    if (dist < CONVICTION_THRESHOLDS.NOISE_FACTOR * dailyVolPct) return false
  }
  return true
}

/** Risk/reward + stop sanity pillar over a (rr, stopPct) pair. */
function rrPillar(rr: number | null, stopPct: number | null, dailyVolPct: number | null): ConvictionTier {
  if (rr === null || !Number.isFinite(rr)) return "C"
  if (!stopDistanceSane(stopPct, dailyVolPct)) return "C"
  if (rr >= CONVICTION_THRESHOLDS.RR_A) return "A"
  if (rr >= CONVICTION_THRESHOLDS.RR_B) return "B"
  return "C"
}

/** Plan pillar: confirmed rows read the trade plan, watching rows the
 *  watched-setup provisional levels (the only levels a watching row has). */
function planPillar(row: MarketSignalRow): ConvictionTier {
  if (row.tradePlan) {
    return rrPillar(row.tradePlan.riskReward, row.tradePlan.stopPct, row.metrics.dailyVolPct)
  }
  if (row.setup) {
    const rr = row.setup.provisionalRiskReward
    const stop = row.setup.provisionalStop
    const lastClose = row.lastClose
    let stopPct: number | null = null
    if (stop && lastClose !== null && lastClose > 0) {
      stopPct = ((stop.level - lastClose) / lastClose) * 100
    }
    return rrPillar(rr, stopPct, row.metrics.dailyVolPct)
  }
  // No tradable payload at all (degraded row / hold): no plan quality to vouch for.
  return "C"
}

/** Evidence pillar: positive-tone dominance across reasons[]. */
function evidencePillar(row: MarketSignalRow): ConvictionTier {
  let pos = 0
  let neg = 0
  for (const r of row.reasons) {
    if (r.tone === "positive") pos++
    else if (r.tone === "negative") neg++
  }
  const t = CONVICTION_THRESHOLDS
  if (pos >= t.POSITIVE_MIN_A && pos - neg >= t.DOMINANCE_A) return "A"
  if (pos >= t.POSITIVE_MIN_B && pos - neg >= t.DOMINANCE_B) return "B"
  return "C"
}

/**
 * Conviction tier of one board row — QUALITY OF EVIDENCE, not direction.
 * The row's tier is the weakest of the score, plan and evidence pillars:
 * a single weak pillar caps the tier, by design (a 90-score read with a
 * 1.2 RR plan is a B, not an A).
 */
export function convictionTier(row: MarketSignalRow): ConvictionTier {
  return weakest(scorePillar(row), weakest(planPillar(row), evidencePillar(row)))
}

// ---------------------------------------------------------------------------
// Market regime
// ---------------------------------------------------------------------------

export type MarketRegime = "bull" | "neutral" | "bear"

/** Board-wide regime input — aggregates the loader (signals-service) supplies
 *  from the cached universe; the function itself stays pure. */
export interface MarketRegimeInput {
  /** Share (0..1) of MEASURED companies whose 20-EMA is rising and whose
   *  close sits above their EMA50. null when no company is measurable. */
  breadthBullishShare: number | null
  /** Median board score across the scored universe. null when nothing is scored. */
  medianScore: number | null
}

/** The honest "unknown" input — an unknown regime is neutral, never a penalty. */
export const EMPTY_REGIME_INPUT: MarketRegimeInput = { breadthBullishShare: null, medianScore: null }

/**
 * Regime thresholds (owner-approved):
 *   bull    — breadth ≥ 60% bullish AND median score ≥ 55;
 *   bear    — breadth ≤ 35% bullish OR median score ≤ 40;
 *   neutral — everything else, and null inputs degrade to neutral.
 * Bull and bear are mutually exclusive by construction; bull is evaluated
 * first so the precedence is deterministic even at degenerate inputs.
 */
export const REGIME_THRESHOLDS = {
  BULL_BREADTH: 0.6,
  BULL_MEDIAN_SCORE: 55,
  BEAR_BREADTH: 0.35,
  BEAR_MEDIAN_SCORE: 40,
} as const

export function marketRegime(input: MarketRegimeInput): MarketRegime {
  const breadth = input.breadthBullishShare
  const median = input.medianScore
  if (breadth === null || !Number.isFinite(breadth) || median === null || !Number.isFinite(median)) {
    return "neutral"
  }
  const t = REGIME_THRESHOLDS
  if (breadth >= t.BULL_BREADTH && median >= t.BULL_MEDIAN_SCORE) return "bull"
  if (breadth <= t.BEAR_BREADTH || median <= t.BEAR_MEDIAN_SCORE) return "bear"
  return "neutral"
}

/** Board-wide Arabic note per regime (travels with every digest response). */
export const REGIME_META: Record<MarketRegime, { noteAr: string; labelAr: string; labelEn: string }> = {
  bull: {
    noteAr: "بوابة السوق: الاتجاه العام صاعد — قراءات البيع مُخفّضة قناعتها درجة واحدة",
    labelAr: "صاعد",
    labelEn: "Bull",
  },
  bear: {
    noteAr: "بوابة السوق: الاتجاه العام هابط — قراءات الشراء مُخفّضة قناعتها درجة واحدة",
    labelAr: "هابط",
    labelEn: "Bear",
  },
  neutral: {
    noteAr: "بوابة السوق: الاتجاه العام محايد — لا تخفيض على قناعة القراءات",
    labelAr: "محايد",
    labelEn: "Neutral",
  },
}

// ---------------------------------------------------------------------------
// Regime gate (direction-aware downgrade)
// ---------------------------------------------------------------------------

export type GateDirection = "buy" | "sell"

export interface RegimeGateResult {
  tier: ConvictionTier
  /** true only when the gate actually reduced the tier (a C row cannot be reduced further). */
  gated: boolean
  /** Arabic note for gated rows; null when untouched. */
  noteAr: string | null
}

/** Exact owner-approved note for a regime-gated row. */
export const REGIME_GATE_NOTE_AR = {
  buy: "بوابة السوق: الاتجاه العام هابط — خُفّضت قناعة هذه القراءة درجة",
  sell: "بوابة السوق: الاتجاه العام صاعد — خُفّضت قناعة هذه القراءة درجة",
} as const

/**
 * Anti-fighting-the-tape gate: buys in a bear regime and sells in a bull
 * regime lose ONE tier (A→B, B→C). Neutral never penalizes; a direction that
 * agrees with the regime is untouched. A row already at C stays C and reports
 * gated:false — nothing was actually reduced, so the note must not claim it was.
 */
export function applyRegimeGate(tier: ConvictionTier, regime: MarketRegime, direction: GateDirection): RegimeGateResult {
  const penalized = (direction === "buy" && regime === "bear") || (direction === "sell" && regime === "bull")
  if (!penalized) return { tier, gated: false, noteAr: null }
  if (tier === "C") return { tier: "C", gated: false, noteAr: null }
  const downgraded: ConvictionTier = tier === "A" ? "B" : "C"
  return { tier: downgraded, gated: true, noteAr: REGIME_GATE_NOTE_AR[direction] }
}

// ---------------------------------------------------------------------------
// "فرص اليوم" digest — ordered, capped, regime-gated
// ---------------------------------------------------------------------------

/** Max rows the digest ever returns (the gate decides how many qualify; never padded). */
export const OPPORTUNITIES_CAP = 5

export type OpportunityState = "confirmed" | "watching"

/**
 * The digest row — an ALLOWLIST projection of a board row (server-side
 * redaction, same philosophy as gateRowForFree): identity + the exact fields
 * the strip renders. Nothing else from MarketSignalRow crosses the wire.
 */
export interface OpportunityRow {
  companyId: string
  ticker: string
  nameEn: string
  nameAr: string | null
  sector: string
  marketTier: string
  lastClose: number | null
  changePct: number | null
  asOf: string | null
  signalState: OpportunityState
  direction: GateDirection
  /** final conviction tier AFTER the regime gate */
  tier: ConvictionTier
  /** true when the regime gate reduced the tier for this row */
  gated: boolean
  /** the regime-gate Arabic note when gated, else null */
  noteAr: string | null
  score: number | null
  /** confirmed rows — the deterministic plan levels (null for watching rows) */
  entryLow: number | null
  entryHigh: number | null
  stop: number | null
  targetLow: number | null
  targetHigh: number | null
  riskReward: number | null
  /** watching rows — the close-based activation (null for confirmed rows) */
  activationKind: "close_above" | "close_below" | null
  activationLevel: number | null
  activationVolumeAr: string | null
}

export interface OpportunitiesDigest {
  /** rows that qualified (confirmed+watching, actionable) BEFORE the cap —
   *  travels with the response so a short digest is never mistaken for a bug. */
  qualifying: number
  /** paid callers: full OpportunityRow projections; free callers:
   *  gateRowForFree identity rows (locked:true). The route's response type
   *  carries the same union — the caller discriminates on `locked`. */
  rows: (OpportunityRow | GatedSignalRow)[]
}

/** The route's response shape: full digest rows for paid callers, gated
 *  identity rows (exactly the board's locked shape) for free/anonymous. */
export interface OpportunitiesResponse {
  version: string
  regime: MarketRegime
  regimeNoteAr: string
  /** breadth as a display percent (0-100, 1dp); null when not measurable */
  breadthPct: number | null
  medianScore: number | null
  asOf: string | null
  computedAt: string | null
  qualifying: number
  rows: (OpportunityRow | GatedSignalRow)[]
  plan?: string
}

/**
 * Publication state of a row for digest purposes, with the documented legacy
 * fallback: rows computed before the three-state layer (signalState undefined)
 * qualify as confirmed/watching from the payload they carry — a row with
 * neither a plan nor a setup qualifies for nothing.
 */
function digestState(row: MarketSignalRow): OpportunityState | null {
  if (row.signalState === "confirmed" || row.signalState === "watching") return row.signalState
  if (row.signalState === undefined) {
    if (row.setup) return "watching"
    if (row.tradePlan) return "confirmed"
  }
  return null
}

/** Direction of a digest-eligible row (watching rows carry it on the setup). */
function digestDirection(row: MarketSignalRow, state: OpportunityState): GateDirection | null {
  if (state === "watching") return row.setup?.direction ?? null
  return row.signal === "buy" || row.signal === "sell" ? row.signal : null
}

/**
 * Build the "فرص اليوم" digest from full board rows (PURE — the route only
 * supplies auth + the cached payload):
 *   1. keep confirmed + watching rows that are directional AND actionable
 *      (confirmed ⇒ tradePlan exists, watching ⇒ setup exists — a degraded
 *      row with no levels has nothing to show and is excluded);
 *   2. tier each row (convictionTier), apply the regime gate, downgrade;
 *   3. sort tier A first, then score desc (nulls last), then ticker asc;
 *   4. cap at OPPORTUNITIES_CAP — fewer qualify ⇒ fewer returned, never padded;
 *   5. free callers receive gateRowForFree(row) — the board's locked identity
 *      shape, the paid analysis never crosses the wire.
 */
export function buildOpportunitiesDigest(
  rows: MarketSignalRow[],
  regime: MarketRegime,
  opts: { cap?: number; free: boolean },
): OpportunitiesDigest {
  type Cand = { row: MarketSignalRow; state: OpportunityState; direction: GateDirection; tier: ConvictionTier; gated: boolean; noteAr: string | null }
  const candidates: Cand[] = []
  for (const row of rows) {
    const state = digestState(row)
    if (!state) continue
    const direction = digestDirection(row, state)
    if (!direction) continue
    // Actionability: a confirmed row without a plan or a watching row without
    // a setup is degraded (overlay outage) — it has no levels to publish.
    if (state === "confirmed" && !row.tradePlan) continue
    if (state === "watching" && !row.setup) continue
    const base = convictionTier(row)
    const gate = applyRegimeGate(base, regime, direction)
    candidates.push({ row, state, direction, tier: gate.tier, gated: gate.gated, noteAr: gate.noteAr })
  }

  const order: Record<ConvictionTier, number> = { A: 0, B: 1, C: 2 }
  candidates.sort(
    (a, b) =>
      order[a.tier] - order[b.tier] ||
      (b.row.score ?? -1) - (a.row.score ?? -1) ||
      a.row.ticker.localeCompare(b.row.ticker),
  )

  const cap = Math.max(0, opts.cap ?? OPPORTUNITIES_CAP)
  const qualifying = candidates.length
  const picked = candidates.slice(0, cap)

  if (opts.free) {
    // Free/anonymous: locked identity only — the SAME server-side redaction
    // the board uses (allowlist serialization, locked:true).
    return { qualifying, rows: picked.map((c) => gateRowForFree(c.row)) }
  }

  const outRows: OpportunityRow[] = picked.map((c) => {
    const tp = c.state === "confirmed" ? c.row.tradePlan : null
    const setup = c.state === "watching" ? c.row.setup : null
    return {
      companyId: c.row.companyId,
      ticker: c.row.ticker,
      nameEn: c.row.nameEn,
      nameAr: c.row.nameAr,
      sector: c.row.sector,
      marketTier: c.row.marketTier,
      lastClose: c.row.lastClose,
      changePct: c.row.changePct,
      asOf: c.row.asOf,
      signalState: c.state,
      direction: c.direction,
      tier: c.tier,
      gated: c.gated,
      noteAr: c.noteAr,
      score: c.row.score,
      entryLow: tp?.entryLow ?? null,
      entryHigh: tp?.entryHigh ?? null,
      stop: tp?.stop ?? null,
      targetLow: tp?.targetLow ?? null,
      targetHigh: tp?.targetHigh ?? null,
      riskReward: tp?.riskReward ?? null,
      activationKind: setup?.activation.kind ?? null,
      activationLevel: setup?.activation.level ?? null,
      activationVolumeAr: setup?.activation.volumeConditionAr ?? null,
    }
  })

  return { qualifying, rows: outRows }
}
