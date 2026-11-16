// =============================================================================
// EGXANO Technical Signals Engine v2 — types (tech-signals@7)
// =============================================================================
// A COMPLETE rebuild of the signal logic (the 2026-11-15 owner mandate): the
// old pipeline (close-engine + stance overlay + opportunity layer + gates)
// produced incoherent boards (targets below the live price, provisional
// levels anchored on dead geometry, garbled reason text). This engine:
//   • reads REAL daily bars only (PriceBar OHLCV + freshest scanner closes);
//   • detects five diverse buy archetypes (breakout / retest / bounce /
//     continuation / reversal) — evidence POINTS, never a conjunctive gate
//     that requires every indicator to agree;
//   • scores additively 0–100 with five interpretable groups and publishes
//     every contributing fact as evidence;
//   • separates STATE (buy / near / wait / exit) from STRENGTH (score) and
//     from the ENTRY itself (levels), each computed and validated on its own;
//   • never emits a short-selling plan — "exit" closes a long, nothing else;
//   • hard math invariants enforced in the plan builder AND re-checked by
//     tests: for a buy, stop < entry ≤ close-band, T1 > close, T2 > T1,
//     RR = (T1 − entryMid) / (entryMid − stop) exactly.
// Everything here is PURE — DB access lives in board-service.ts only.
// =============================================================================

/** One observed trading session (same shape as src/lib/technical/indicators.ts Bar). */
export interface Bar {
  ts: string
  open: number
  high: number
  low: number
  close: number
  volume: number | null
}

/** The four published states (the owner's trading-logic spec):
 *  buy  — a buy opportunity whose conditions are MET and executable now;
 *  near — a promising setup whose entry condition is NOT yet met
 *         (activation level + provisional levels, honestly labeled);
 *  wait — no suitable opportunity right now;
 *  exit — close an existing LONG (never an open-short invitation). */
export type SignalState = "buy" | "near" | "wait" | "exit"

/** Which structural opportunity the engine detected (one per row, best-of). */
export type OpportunityType =
  | "breakout" // اختراق مقاومة — close crossed a multi-touch resistance with volume
  | "retest" // إعادة اختبار اختراق — pullback to a broken level that held
  | "bounce" // ارتداد من دعم — rejection off a tested support zone
  | "continuation" // استمرار اتجاه — pullback ending inside an intact uptrend
  | "reversal" // انعكاس مؤكد — change of character confirmed by volume/structure
  | "exit_support" // خروج — close below multi-touch support with participation
  | "exit_trend" // خروج — trend break (close below EMA50 with dead EMAs)

export const OPPORTUNITY_TYPE_AR: Record<OpportunityType, string> = {
  breakout: "اختراق مقاومة",
  retest: "إعادة اختبار اختراق",
  bounce: "ارتداد من دعم",
  continuation: "استمرار اتجاه صاعد",
  reversal: "انعكاس صاعد مؤكد",
  exit_support: "كسر دعم — خروج من مركز شراء",
  exit_trend: "كسر اتجاه — خروج من مركز شراء",
}

export const OPPORTUNITY_TYPE_EN: Record<OpportunityType, string> = {
  breakout: "Resistance breakout",
  retest: "Breakout retest",
  bounce: "Support bounce",
  continuation: "Uptrend continuation",
  reversal: "Confirmed bullish reversal",
  exit_support: "Support breakdown — exit long",
  exit_trend: "Trend break — exit long",
}

/** One cited fact behind a signal — the numbers ARE the argument. */
export interface Evidence {
  /** Arabic text (the board's primary language) */
  ar: string
  /** English text */
  en: string
  /** which score group this fact feeds (null = pure disclosure, no points) */
  group: ScoreGroup | null
  /** points this fact contributed to the score (0 when group is null) */
  points?: number
}

export type ScoreGroup = "trend" | "momentum" | "volume" | "structure" | "quality"

export const SCORE_GROUP_AR: Record<ScoreGroup, string> = {
  trend: "الاتجاه",
  momentum: "الزخم",
  volume: "المشاركة والتداول",
  structure: "البنية والمستويات",
  quality: "جودة التنفيذ والبيانات",
}

/** Fixed, documented group maxima — sum = 100. */
export const SCORE_GROUP_MAX: Record<ScoreGroup, number> = {
  trend: 25,
  momentum: 20,
  volume: 15,
  structure: 25,
  quality: 15,
}

/** Per-group sub-scores + the total (0–100). Every point is traceable to a
 *  listed Evidence item — nothing hidden, nothing invented. */
export interface ScoreBreakdown {
  total: number
  groups: Record<ScoreGroup, number>
}

/** A tradable plan — the ONLY shape that may carry levels. All invariants
 *  are enforced in plan.ts (buildBuyPlan) and re-asserted by the engine. */
export interface TradePlanV2 {
  side: "buy" | "exit"
  /** executable entry band, rounded to tick; entryLow ≤ entryHigh */
  entryLow: number
  entryHigh: number
  /** technical stop — a STRUCTURE level (below the invalidated zone), never a flat % */
  stop: number
  /** first target (always above entryHigh for a buy; above the LIVE close;
   *  never beyond the +20% upside cap — TARGET_MAX_UPSIDE_PCT) */
  target1: number
  /** second target when structure justifies it AND it stays inside the +20%
   *  upside cap (strictly above T1); null otherwise */
  target2: number | null
  /** exact risk/reward on the entry mid vs T1, rounded to 2dp */
  riskReward: number
  /** approximate expected return, entry MID → target (%, 1dp, buy side) —
   *  the number the investor reads as "what do I make if T1 hits" */
  target1ReturnPct: number
  /** same math to target 2; null when no T2 */
  target2ReturnPct: number | null
  /** approximate risk from the entry MID to the stop (%, 1dp) — shown next
   *  to the return so the two ends of the trade are always visible together */
  stopRiskPct: number
  /** what the target level IS (evidence-based, Arabic) */
  target1BasisAr: string
  target2BasisAr: string | null
  /** what the stop level IS (Arabic) */
  stopBasisAr: string
}

/** A near-activation setup — the entry condition is NOT met yet. The
 *  provisional plan is recomputed AT the activation price (never at a stale
 *  anchor) and must still validate, or the setup is dropped entirely. */
export interface NearSetup {
  /** the close-based trigger — e.g. "close above 23.30" */
  activation: number
  /** Arabic condition text */
  activationAr: string
  /** % distance from the last close to the activation (positive = above) */
  activationGapPct: number
  /** provisional plan validated AT the activation price (honestly labeled) */
  provisional: TradePlanV2
  /** pre-entry invalidation — the scenario dies BEFORE money is committed */
  preEntryInvalidationAr: string
}

/** Per-company output of the engine (one row of the board). */
export interface SignalRowV2 {
  companyId: string
  ticker: string
  nameEn: string
  nameAr: string | null
  sector: string
  /** EGX30 | EGX70 | MAIN (index-membership/listing tier) */
  marketTier: string
  /** the published state (buy / near / wait / exit) */
  state: SignalState
  /** the detected structure (null for wait) */
  type: OpportunityType | null
  /** last real session date the row was computed on (YYYY-MM-DD) */
  asOf: string | null
  /** last close for that session */
  lastClose: number | null
  /** % change vs the prior session's close (corporate-action adjusted) */
  changePct: number | null
  /** the 0–100 additive score (null when data is insufficient) */
  score: number | null
  scoreGroups: ScoreBreakdown["groups"] | null
  /** cited facts (Arabic primary) — the reason the signal exists */
  evidence: Evidence[]
  /** executable plan (buy / exit rows only) */
  plan: TradePlanV2 | null
  /** near-activation setup (near rows only) */
  setup: NearSetup | null
  /** post-entry invalidation — what kills the scenario after entry */
  invalidationAr: string | null
  /** displayed metrics (null when the bar anatomy is insufficient) */
  metrics: SignalMetrics | null
  /** Liquidity + data-quality disclosure */
  quality: RowQuality
  /** fundamental / liquidity warnings the user must see next to the signal
   *  (negative profit, expensive multiple, thin traded value). Empty when
   *  nothing applies — warnings NEVER gate a signal out; they disclose. */
  warnings: SignalWarning[]
  /** engine version for this row */
  engine: string
}

/** A disclosed risk next to the recommendation. Wording rule (owner mandate):
 *  factual, mechanics-based, and never accusatory — the site states what the
 *  DATA shows (a negative profit, a thin order book), it does not speculate
 *  about any party or intent. Valuation-multiple warnings were removed at the
 *  owner's request (2026-11-17). */
export interface SignalWarning {
  kind: "negative_profit" | "thin_liquidity"
  /** short Arabic warning shown on the card itself */
  ar: string
  /** longer Arabic detail shown in the expanded view */
  detailAr: string
  /** English mirror */
  en: string
  detailEn: string
}

/** Fundamentals snapshot fed into the engine by the board service (batched
 *  from the calculated-metrics read model). All nullable — absent data
 *  simply produces no warning, never an invented one. */
export interface Fundamentals {
  /** latest net profit in plain EGP (TTM → annual → latest reported) */
  netProfitEgp: number | null
  /** latest earnings per share in EGP (TTM → annual → latest reported).
   *  The P/E warning is computed LIVE as lastClose / eps — a STORED p_e row
   *  goes stale whenever the market moves without a financials recompute
   *  (AXPH 2026-11-16: the stored row said 40+, the real multiple was 11). */
  epsEgp: number | null
}

export interface SignalMetrics {
  rsi14: number | null
  ema20: number | null
  ema50: number | null
  atr14: number | null
  macdHist: number | null
  /** session volume vs the 20-session mean (null when volumes are absent) */
  relVol: number | null
  perfM1: number | null
  perfM3: number | null
  /** where the close sits in the 60-session range (0–100) */
  rangePos60: number | null
  /** σ of the last 20 close-to-close % moves */
  dailyVolPct: number | null
}

export interface RowQuality {
  /** usable bars behind the reading */
  bars: number
  /** OHLC anatomy present (breakout/bounce zones need it)? */
  ohlc: boolean
  /** "liquid" (relVol ≥ 1.5) | "normal" (≥ 1) | "thin" (present but < 1) | "unknown" */
  liquidity: "liquid" | "normal" | "thin" | "unknown"
  /** mean close × volume over the last ≤20 sessions with volume, in plain
   *  EGP — the ABSOLUTE traded-value liquidity read (null when volume data
   *  is absent). Feeds the thin-liquidity warning. */
  avgTradedValueEgp: number | null
  /** EGX sessions between asOf and the compute day (0 = today) */
  dataAgeSessions: number | null
  /** Arabic data-quality notes (insufficient history, missing volume, …) */
  notesAr: string[]
}

// ---- Engine-identifying constants (single source, imported by UI + API) ----
// tech-signals@7 (2026-11-16): +20% target cap, return/risk figures on every
// plan, fundamentals/liquidity warnings on every row (new required fields) —
// the version bump also invalidates pre-deploy board snapshots whose rows
// lack the new fields (a stale snapshot must never render as v7).
export const SIGNALS_V2_VERSION = "tech-signals@7"

/** A BUY publishes only when the score clears this bar — a balanced gate the
 *  evidence can genuinely reach (the old stacked conditions made BUYs
 *  disappear for weeks; this threshold is met by design when the cited facts
 *  line up, and the score's math is unit-tested to be reachable). */
export const BUY_SCORE_MIN = 62
/** A NEAR setup publishes only when its activation sits within this % of the
 *  close — farther structures are stale geometry, not "near". */
export const NEAR_ACTIVATION_MAX_GAP_PCT = 8
/** Provisional/confirmed plan RR floor — below it the levels are not a trade. */
export const PLAN_RR_MIN = 1.2
/** Minimum usable sessions for ANY reading (indicators need 50; below this
 *  the row is honestly "wait" with a data note, never a confident signal). */
export const MIN_BARS = 60
/** OWNER MANDATE (2026-11-16): no published target may sit farther than +20%
 *  above the entry. A far-away resistance (e.g. a single-touch stale zone
 *  +235% above the close) is NOT a tradeable target — T1/T2 are capped at
 *  this horizon and a second target beyond it is dropped entirely. */
export const TARGET_MAX_UPSIDE_PCT = 20

// ---------------------------------------------------------------------------
// OWNER MANDATE (2026-11-17): a broken support is NOT automatically an exit.
// When a support breaks, the distance from the live close down to the NEXT
// support zone below (its nearest edge) decides the classification:
//   gap ≥ 4%  → no cushion nearby, downside room is open → EXIT fires;
//   gap ≤ 3%  → the next support sits right under the price → the break is
//               classified WAIT (selling here locks the loss at the worst
//               spot; the exit activates on a close below that cushion);
//   3% < gap < 4% → borderline: WAIT with an explicit tighter-stop note.
// No support below at all counts as an open field → EXIT.
// ---------------------------------------------------------------------------
export const EXIT_SUPPORT_CUSHION_EXIT_PCT = 4
export const EXIT_SUPPORT_CUSHION_WAIT_PCT = 3
/** Liquidity disclosure threshold: average daily traded VALUE (EGP, close ×
 *  volume, last 20 sessions) below this means a thin order book — the row
 *  carries a liquidity warning. The wording is factual mechanics only. */
export const THIN_TRADED_VALUE_EGP = 100_000
