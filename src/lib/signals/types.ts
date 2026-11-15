// =============================================================================
// EGXANO Technical Signals Engine v2 — types (tech-signals@6)
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
  /** first target (always above entryHigh for a buy; above the LIVE close) */
  target1: number
  /** second target when structure justifies it (strictly above T1); null otherwise */
  target2: number | null
  /** exact risk/reward on the entry mid vs T1, rounded to 2dp */
  riskReward: number
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
  /** liquidity + data-quality disclosure */
  quality: RowQuality
  /** engine version for this row */
  engine: string
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
  /** EGX sessions between asOf and the compute day (0 = today) */
  dataAgeSessions: number | null
  /** Arabic data-quality notes (insufficient history, missing volume, …) */
  notesAr: string[]
}

// ---- Engine-identifying constants (single source, imported by UI + API) ----
export const SIGNALS_V2_VERSION = "tech-signals@6"

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
