// =============================================================================
// Opportunity Quality Score (OQS 0-100) — deterministic ranking layer for the
// Opportunity Intelligence Engine (owner directive, 2026-11-15).
//
// WHAT THIS IS: a fixed-weight, rule-based composite that RANKS opportunities
// that are ALREADY eligible. Every component is a 0-1 sub-score computed from
// plain numbers the caller supplies (the OpportunityView row + target ladder),
// combined with the exported OQS_WEIGHTS (sum = 1) into a 0-100 score.
//
// WHAT THIS IS NOT: no AI, no probabilities, no expected-return claims, no
// market-success promises. The noteAr names the two strongest components by
// contribution — a factual attribution, never a prediction.
//
// ── HARD RULE (enforced by construction — do not weaken) ─────────────────────
// THE SCORE RANKS ELIGIBLE OPPORTUNITIES ONLY. `eligible` is an input, and an
// ineligible row returns oqs: null + components: null — it never enters (and
// can never win) any ranking. Eligibility is decided UPSTREAM by the
// opportunity layer (state / gates / rejections); this module CANNOT qualify
// anything. A 3%-upside setup that is ineligible therefore can never out-rank
// an eligible one on score, no matter how strong its other components are.
// ─────────────────────────────────────────────────────────────────────────────
//
// COMPONENTS, WEIGHTS AND EVERY THRESHOLD (documented; change only with an
// OQS_VERSION bump):
//
//   evidence             0.15 — the row's own scored confluence.
//        = 0.60·scoreShare + 0.20·reasonBalance + 0.20·signalStateShare
//        scoreShare bands follow the @5 engine's own decision numbers:
//          score ≥ 70 → 1.0 | ≥ 62 → 0.85 (the @5 BUY entry threshold)
//          | ≥ 55 → 0.60 (the @5 BUY exit band) | ≥ 45 → 0.40
//          | ≥ 35 → 0.25 (the @5 SELL entry threshold) | else 0.10.
//        reasonBalance = pos / (pos + neg); 0.5 when both counts are 0.
//        signalStateShare: confirmed = 1.0, watching = 0.5 (candidate exists
//        but is blocked upstream), wait/unknown = 0.2.
//   structure            0.12 — trend backdrop the setup rides (the row's
//        trendLabel): "up" = 1.0, "side" = 0.5, "down"/unknown = 0.1.
//   relativeStrength     0.10 — stock perf vs benchmark over the matched
//        window, piecewise-linear through (−10% → 0), (0% → 0.5), (+15% → 1),
//        clamped outside. null (no benchmark window) = neutral 0.5.
//   volumeConfirmation   0.12 — relVol bands mirroring the @5 up-day semantics:
//          relVol < 0.7 → 0.15 | 0.7 ≤ rv < 1.0 → 0.45
//          | 1.0 ≤ rv ≤ 2.0 → 0.80 (confirmed participation — the @5 gate)
//          | 2.0 < rv ≤ 3.0 → 1.00 (strongest band) | rv > 3.0 → 0.50
//          (climax — chase risk, mirrors the @5 climax down-weight).
//        null (unknown) = 0.40 — below the confirmed bar, never credited as
//        strong (mirrors finalizeScore treating unknown relVol as not strong).
//   resistanceClearance  0.12 — obstacles (structural levels) between entry
//        and T1: 0 → 1.0 | 1 → 0.65 | 2 → 0.40 | ≥ 3 → 0.20.
//   upside               0.10 — upsidePctToT1 ÷ UPSIDE_COMPONENT_CAP_PCT (15%),
//        clamped to [0, 1]. THE CAP IS THE POINT: 15%+ of upside to T1 earns
//        the FULL component — more upside ≠ proportionally more quality, so a
//        distant target cannot inflate the ranking (anti-chasing rule).
//        null (no T1 computed) = 0.30.
//   riskReward           0.12 — riskReward ÷ RISK_REWARD_COMPONENT_CAP (2.5),
//        clamped to [0, 1]; rr ≤ 0 → 0; null = 0.25. RR above 2.5 earns the
//        FULL component — the cap prevents an outlier ratio dominating.
//   liquidity            0.06 — caller's volume tier: liquid = 1.0,
//        normal = 0.65, thin/unknown = 0.20 (conservative for executability).
//   executionReadiness   0.05 — deterministic state map (see
//        EXECUTION_READINESS_BY_STATE): actionable = 1.0, conditional = 0.6,
//        observation = 0.35, early = 0.2, missed/invalidated = 0, unknown = 0.
//        Weight deliberately small: the state is already gated upstream
//        (eligibility), so a large weight would double-count it.
//   dataFreshness        0.06 — dataAgeSessions (0 = today): 0 → 1.0,
//        1 → 0.70, 2 → 0.45, 3 → 0.30, ≥ 4 → 0.15. Stale data discounts the
//        whole read but never dominates it.
//
// Determinism: same input → same output, always. Every numeric input is
// sanitized (non-finite → the documented null/conservative equivalent) and
// clamped before use. No DB access, no network, no clock.
// =============================================================================

/** Version of the OQS methodology — bump on any weight/threshold change. */
export const OQS_VERSION = "oqs@1"

/** Fixed component weights — sum to exactly 1 (pinned by test). */
export const OQS_WEIGHTS = {
  evidence: 0.15,
  structure: 0.12,
  relativeStrength: 0.10,
  volumeConfirmation: 0.12,
  resistanceClearance: 0.12,
  upside: 0.10,
  riskReward: 0.12,
  liquidity: 0.06,
  executionReadiness: 0.05,
  dataFreshness: 0.06,
} as const

export type OqsComponentKey = keyof typeof OQS_WEIGHTS

/** Upside component ceiling (% to T1 earning the full 1.0) — anti-chasing cap. */
export const UPSIDE_COMPONENT_CAP_PCT = 15
/** Risk/reward component ceiling — RR ≥ 2.5 earns the full 1.0. */
export const RISK_REWARD_COMPONENT_CAP = 2.5

/** Deterministic publication-state → execution-readiness map (documented). */
export const EXECUTION_READINESS_BY_STATE: Record<string, number> = {
  actionable: 1.0,
  conditional: 0.6,
  observation: 0.35,
  early: 0.2,
  missed: 0,
  invalidated: 0,
}

/** Caller's liquidity tier → component score (documented). */
export const LIQUIDITY_TIER_SCORES: Record<string, number> = {
  liquid: 1.0,
  normal: 0.65,
  thin: 0.2,
}

/** dataAgeSessions → component score (documented; 0 = today). */
export function dataFreshnessScore(ageSessions: number): number {
  if (ageSessions <= 0) return 1.0
  if (ageSessions === 1) return 0.7
  if (ageSessions === 2) return 0.45
  if (ageSessions === 3) return 0.3
  return 0.15
}

/** relVol band map (documented; mirrors the @5 up-day semantics). */
export function volumeConfirmationScore(relVol: number | null): number {
  if (relVol === null || !Number.isFinite(relVol)) return 0.4
  if (relVol > 3.0) return 0.5 // climax
  if (relVol > 2.0) return 1.0 // strongest band (2, 3]
  if (relVol >= 1.0) return 0.8 // confirmed participation
  if (relVol >= 0.7) return 0.45
  return 0.15
}

/** Relative-strength piecewise map through (−10 → 0), (0 → 0.5), (+15 → 1). */
export function relativeStrengthScore(rsPct: number | null): number {
  if (rsPct === null || !Number.isFinite(rsPct)) return 0.5
  if (rsPct <= -10) return 0
  if (rsPct >= 15) return 1
  if (rsPct <= 0) return (rsPct + 10) / 20 // −10→0 … 0→0.5
  return 0.5 + rsPct / 30 // 0→0.5 … +15→1
}

/** Obstacle-count map between entry and T1 (documented). */
export function resistanceClearanceScore(obstacleCount: number): number {
  if (!Number.isFinite(obstacleCount) || obstacleCount < 0) return 0.2 // conservative: treat unknown as ≥3
  const n = Math.floor(obstacleCount)
  if (n === 0) return 1.0
  if (n === 1) return 0.65
  if (n === 2) return 0.4
  return 0.2
}

/** Risk/reward map with the 2.5 cap (documented). */
export function riskRewardScore(rr: number | null): number {
  if (rr === null || !Number.isFinite(rr)) return 0.25
  if (rr <= 0) return 0
  return Math.min(rr / RISK_REWARD_COMPONENT_CAP, 1)
}

/** Upside map with the 15% cap (documented). */
export function upsideScore(upsidePctToT1: number | null): number {
  if (upsidePctToT1 === null || !Number.isFinite(upsidePctToT1)) return 0.3
  if (upsidePctToT1 <= 0) return 0
  return Math.min(upsidePctToT1 / UPSIDE_COMPONENT_CAP_PCT, 1)
}

/** Evidence sub-shares (documented above). */
function scoreShare(score: number): number {
  if (score >= 70) return 1.0
  if (score >= 62) return 0.85
  if (score >= 55) return 0.6
  if (score >= 45) return 0.4
  if (score >= 35) return 0.25
  return 0.1
}

function signalStateShare(state: string): number {
  if (state === "confirmed") return 1.0
  if (state === "watching") return 0.5
  return 0.2 // wait / unknown — no confirmed evidence
}

// ---------------------------------------------------------------------------
// Public types — OWN LOCAL structural inputs (plain numbers supplied by the
// caller; no imports from the parallel opportunity/targets modules).
// ---------------------------------------------------------------------------

/** The opportunity layer's publication state (caller-supplied). */
export type OpportunityState =
  | "actionable"
  | "conditional"
  | "observation"
  | "early"
  | "missed"
  | "invalidated"

/** The signals row's three-state publication label (@5 semantics). */
export type RowSignalState = "confirmed" | "watching" | "wait"

/** The row's trend label (from the daily read). */
export type TrendLabel = "up" | "side" | "down"

/** Caller's liquidity classification from its own volume data. */
export type LiquidityTier = "thin" | "normal" | "liquid"

export interface OpportunityScoreInput {
  /** HARD RULE input: only eligible rows are ranked at all. */
  eligible: boolean
  /** the row's technical score, 0-100 (clamped; non-finite → 0) */
  score: number
  /** counts of positive / negative reasons on the row (clamped ≥ 0) */
  positiveReasons: number
  negativeReasons: number
  /** the @5 publication state of the row */
  signalState: RowSignalState
  /** trend label from the row: "up" | "side" | "down" */
  trendLabel: TrendLabel
  /** stock perf vs benchmark over the matched window, % (null allowed) */
  relativeStrengthPct: number | null
  /** signal-day relative volume (null allowed) */
  relVol: number | null
  /** % upside from entry to the T1 target (null when no target) */
  upsidePctToT1: number | null
  /** plan risk/reward ratio (null when no plan) */
  riskReward: number | null
  /** structural obstacles between entry and T1 */
  obstacleCount: number
  /** caller's liquidity tier from its own volume data */
  liquidityTier: LiquidityTier
  /** the opportunity layer's publication state */
  state: OpportunityState
  /** sessions since the data's session (0 = today) */
  dataAgeSessions: number
}

export type OpportunityScoreComponents = Record<OqsComponentKey, number>

export interface OpportunityScoreResult {
  /** 0-100 for eligible rows; NULL for ineligible rows (hard rule). */
  oqs: number | null
  /** per-component 0-1 sub-scores; null for ineligible rows (by construction). */
  components: OpportunityScoreComponents | null
  /** one factual Arabic sentence — no probabilities, no promises. */
  noteAr: string
}

/** Arabic component labels for the noteAr attribution. */
const COMPONENT_LABEL_AR: Record<OqsComponentKey, string> = {
  evidence: "قوة الأدلة",
  structure: "بنية الاتجاه",
  relativeStrength: "الأداء النسبي",
  volumeConfirmation: "تأكيد الحجم",
  resistanceClearance: "مسافة المقاومة",
  upside: "المساحة للهدف الأول",
  riskReward: "نسبة المخاطرة/العائد",
  liquidity: "السيولة",
  executionReadiness: "جاهزية التنفيذ",
  dataFreshness: "حداثة البيانات",
}

const INELIGIBLE_NOTE_AR = "غير مؤهلة — لا يتم ترتيبها"

const clamp01 = (x: number): number => Math.max(0, Math.min(1, x))
const round3 = (x: number): number => Math.round(x * 1000) / 1000
const countOrZero = (v: number): number => (Number.isFinite(v) && v > 0 ? Math.floor(v) : 0)

/** Fixed declaration order for deterministic tie-breaks in the noteAr. */
const COMPONENT_ORDER: OqsComponentKey[] = [
  "evidence",
  "structure",
  "relativeStrength",
  "volumeConfirmation",
  "resistanceClearance",
  "upside",
  "riskReward",
  "liquidity",
  "executionReadiness",
  "dataFreshness",
]

/**
 * Compute the Opportunity Quality Score for ONE row.
 *
 * HARD RULE: `eligible === false` → { oqs: null, components: null,
 * noteAr: "غير مؤهلة — لا يتم ترتيبها" }. This module ranks eligible
 * opportunities only and can never qualify an ineligible one.
 */
export function computeOpportunityScore(input: OpportunityScoreInput): OpportunityScoreResult {
  // ---- hard rule: ineligible rows are never ranked -------------------------
  if (!input.eligible) {
    return { oqs: null, components: null, noteAr: INELIGIBLE_NOTE_AR }
  }

  // ---- sanitized inputs -----------------------------------------------------
  const score = Number.isFinite(input.score) ? Math.max(0, Math.min(100, input.score)) : 0
  const pos = countOrZero(input.positiveReasons)
  const neg = countOrZero(input.negativeReasons)
  const rs = input.relativeStrengthPct !== null && Number.isFinite(input.relativeStrengthPct) ? input.relativeStrengthPct : null
  const relVol = input.relVol !== null && Number.isFinite(input.relVol) ? input.relVol : null
  const upside = input.upsidePctToT1 !== null && Number.isFinite(input.upsidePctToT1) ? input.upsidePctToT1 : null
  const rr = input.riskReward !== null && Number.isFinite(input.riskReward) ? input.riskReward : null
  const age = Number.isFinite(input.dataAgeSessions) ? Math.max(0, Math.floor(input.dataAgeSessions)) : 99

  // ---- components (each 0-1, every map documented in the header) ------------
  const reasonBalance = pos + neg > 0 ? pos / (pos + neg) : 0.5
  const evidence = clamp01(0.6 * scoreShare(score) + 0.2 * reasonBalance + 0.2 * signalStateShare(input.signalState))
  const structure = input.trendLabel === "up" ? 1.0 : input.trendLabel === "side" ? 0.5 : 0.1
  const relativeStrength = clamp01(relativeStrengthScore(rs))
  const volumeConfirmation = clamp01(volumeConfirmationScore(relVol))
  const resistanceClearance = clamp01(resistanceClearanceScore(input.obstacleCount))
  const upsideComponent = clamp01(upsideScore(upside))
  const riskReward = clamp01(riskRewardScore(rr))
  const liquidity = clamp01(LIQUIDITY_TIER_SCORES[input.liquidityTier] ?? LIQUIDITY_TIER_SCORES.thin)
  const executionReadiness = clamp01(EXECUTION_READINESS_BY_STATE[input.state] ?? 0)
  const dataFreshness = clamp01(dataFreshnessScore(age))

  const components: OpportunityScoreComponents = {
    evidence: round3(evidence),
    structure: round3(structure),
    relativeStrength: round3(relativeStrength),
    volumeConfirmation: round3(volumeConfirmation),
    resistanceClearance: round3(resistanceClearance),
    upside: round3(upsideComponent),
    riskReward: round3(riskReward),
    liquidity: round3(liquidity),
    executionReadiness: round3(executionReadiness),
    dataFreshness: round3(dataFreshness),
  }

  // ---- weighted composite ----------------------------------------------------
  let weighted = 0
  for (const key of COMPONENT_ORDER) weighted += OQS_WEIGHTS[key] * components[key]
  const oqs = Math.max(0, Math.min(100, Math.round(100 * weighted)))

  // ---- noteAr: the two strongest components by contribution ------------------
  // Contribution = weight × component. Ties resolve by the fixed declaration
  // order (deterministic). Factual attribution only — never a prediction.
  const contributions = COMPONENT_ORDER.map((key) => ({ key, contribution: OQS_WEIGHTS[key] * components[key] }))
    .sort((a, b) => b.contribution - a.contribution || COMPONENT_ORDER.indexOf(a.key) - COMPONENT_ORDER.indexOf(b.key))
  const noteAr = `الأقوى في التقييم: ${COMPONENT_LABEL_AR[contributions[0].key]} و${COMPONENT_LABEL_AR[contributions[1].key]}`

  return { oqs, components, noteAr }
}
