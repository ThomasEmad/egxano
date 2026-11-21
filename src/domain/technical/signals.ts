// =============================================================================
// EGXANO Technical Signals Engine — deterministic, rule-based market read.
// =============================================================================
// tech-signals@5 — EVIDENCE-BASED RECALIBRATION (2026-11-14 engine audit).
// The audit (docs/notes/engine-audit.md) proved five root causes on a strict
// no-lookahead replay of the @4 engine over 22 tickers / 10,692 sessions:
//   #1 BUY fired without volume confirmation (62.6% of BUY days relVol<1)
//      because the excellence gate only shaped display above raw 80 while the
//      BUY threshold sat at raw ~71. #2 trend+momentum+risk all scored "price
//      above rising averages" (labels carried ~zero forward information).
//      #3 levels/zones never arbitrated (47.7% of BUYs ≤2% under resistance).
//      #4 bipolar dynamics (median run 3.0 sessions, −61 one-session score
//      jumps, SELL nearly unreachable). #5 mechanical plans (RR exactly 2.00
//      on 74.9% of BUY plans, flat −4.5% stops).
//
// THE @5 FIXES (each mapped to the audit):
//   A) Decision gates — a BUY requires volume agreement (relVol ≥ 1.0 OR the
//      OBV slope agrees) AND decision-level excellence: every PRESENT
//      dimension must earn ≥80% of its own maximum (the old gate only clamped
//      raw > 80 for display). Rejections are encoded as bilingual reasons.
//   B) De-duplication — "price vs rising averages" is ONE trend-state input;
//      momentum scores an oscillator GROUP with a corroboration cap (80% of
//      the group's present maximum — full agreement saturates instead of
//      stacking); risk scores ONLY risk facts (two-sided extension, volatility
//      regime, volatility EXPANSION — never trend agreement).
//      WEIGHT RATIONALE (30/25/25/20): trend 30 (was 35) — one state input
//      instead of four stacked facts; momentum 25 (was 30) — capped group, so
//      its effective ceiling is 20/25 weighted; volume 25 (was 20) —
//      participation is a REQUIRED buy confirmation, so its weight rises and
//      relVol ≥1 now earns 8/10 (was 6); risk 20 (was 15) — pure risk facts
//      with an added expansion input. Sum = 100.
//   C) Structure veto — a multi-touch resistance cluster within ~2% above the
//      close vetoes a BUY unless a confirmed breakout (prior close already
//      above the zone AND relVol ≥ 1.5) or a documented retest-hold; the
//      mirror applies to SELL over multi-touch support (breakdown confirm).
//   D) SELL reachability — a distribution/change-of-character path (OBV
//      distribution + momentum breakdown + lower-highs-or-below-EMA50) can
//      print SELL without the old 3-condition conjunction. The read remains
//      "sell pressure / ضغط بيعي" — a risk warning, NOT a short-selling
//      instruction (shorting is not available for every EGX stock).
//   E) Hysteresis — asymmetric enter/exit bands (BUY enters ≥62, exits <55;
//      SELL enters <35, exits >42) + a 2-session minimum state hold + a
//      displayed-score glide limit (±25/session) that is bypassed only on
//      genuine structural events (|1-session move| ≥ 3%). TRADEOFF (documented):
//      the read is up to ~2 sessions slower to react at turning points in
//      exchange for eliminating 3-session flapping and curve-amplified score
//      jumps. Implemented by reconstructing the trailing reads from the same
//      series (strictly prefix-only, no lookahead).
//   G) Indicator fixes live in indicators.ts (stochastic %D consecutive
//      windows, S/R equal-high double tops, rounding moved out of decision
//      inputs) and zones.ts (F2 reaction).
//   H) Style honesty — the "day" style is DISABLED: daily closes cannot
//      support intraday day-trade claims; the tag stays in the type/meta for
//      UI compatibility but is never emitted.
//   I) Versioning — SIGNALS_VERSION = "tech-signals@5"; the @4 methodology is
//      preserved as computeCloseSignalV1 (reachable via
//      computeCloseSignal(rows, { engineVersion: "tech-signals@4" })) purely
//      for A/B backtesting on identical bars.
//   J) THREE-STATE PUBLICATION LAYER (2026-11-14 product decision — additive
//      only, NO methodology change, engineVersion stays "tech-signals@5"):
//      a directional read must never be published "naked" (a شراء/بيع with no
//      tradable plan and no levels). Every @5 row now carries `signalState`:
//        • "confirmed" — the read passed every gate AND a tradable plan exists
//          (plan non-null, RR ≥ 1.5 by the plan builder's own honesty rule).
//        • "watching" — a directional CANDIDATE exists but is blocked (near-
//          resistance veto, at-support veto, weak volume, below-full-strength
//          evidence) or the read has no tradable plan. `setup` carries the
//          close-based ACTIVATION level derived from the SAME structure that
//          raised the block (tested-resistance top for a blocked buy, tested-
//          support bottom for a blocked sell; documented fallbacks when no
//          veto fired), provisional entry/stop/target (from the trade-plan
//          builder evaluated AT the activation level, else from structure —
//          each labeled تقديري and RECOMPUTED at activation with the RR
//          re-validated ≥ 1.5), a PRE-ENTRY invalidation (separate from the
//          post-entry stop) and the blocking veto reasons.
//        • "wait" — no directional edge (hold) or too little history.
//      The `signal` field, the scores, the gates, the weights and every veto
//      rule are UNCHANGED — this layer only republishes the same decision.
//      The frozen v1 baseline (computeCloseSignalV1) does not emit the state
//      (optional in the type) so the A/B replay stays byte-comparable.
// =============================================================================

import { emaSeries, macdSeries, macd, rsi, rsiSeries, supportResistance, perfN, round, type Bar, type PriceZone } from "./indicators"
import type { TechnicalSnapshot } from "@/lib/technical/analyze"
import { buildTradePlan, measuredHeight, nearestAbove, nearestBelow, roundToTick, type TradePlan } from "./trade-plan"
import { computeAdx, type AdxResult } from "./adx"
import { detectDivergence, type DivergenceSignal } from "./divergence"
import { readLastCandle, type CandlePatternRead } from "./candlestick"

export const SIGNALS_VERSION = "tech-signals@5"
/** v1 baseline for backtest comparison — reachable only via the engineVersion option. */
export const SIGNALS_VERSION_V1_BASELINE = "tech-signals@4"

// ---------------------------------------------------------------------------
// ABLATION VARIANTS (2026-11-14, docs/notes/backtest-ablation.md) — additive
// evidence layers over the UNCHANGED @5 methodology. Each variant runs the
// EXACT base @5 logic, then the named module(s) evaluate evidence on the LAST
// session and adjust the score by a DOCUMENTED, CAPPED rule:
//   • per-module delta ∈ [−4, +4]; total delta clamped to [−8, +8];
//   • the delta is applied to the LAST trail read's score and the read is
//     RE-DECIDED by the SAME @5 decision gates (decideSignal) + the SAME
//     hysteresis walk — no new decision rule exists;
//   • evidence therefore can NEVER flip a hold to buy/sell ALONE: a flip
//     still requires the full @5 confluence (trend share, volume agreement,
//     decision-level excellence, RSI veto, structure veto);
//   • when the OHLC fields are absent the ADX/candle modules abstain
//     silently (close-only replay still works); divergence works off closes.
// ---------------------------------------------------------------------------
export const TECH_ENGINE_VARIANTS = ["tech-signals@5+adx", "tech-signals@5+div", "tech-signals@5+candles", "tech-signals@5+all"] as const
export type TechEngineVariant = (typeof TECH_ENGINE_VARIANTS)[number]
/** Per-module score-delta cap (documented ablation rule). */
export const EVIDENCE_DELTA_CAP_PER_MODULE = 4
/** Total score-delta cap across all modules (documented ablation rule). */
export const EVIDENCE_DELTA_CAP_TOTAL = 8

export type EngineVersionOption = typeof SIGNALS_VERSION | typeof SIGNALS_VERSION_V1_BASELINE | TechEngineVariant

export type TechSignalType = "buy" | "hold" | "sell"

/** Trading styles the current setup fits — each is a separate horizon checklist. */
export type TechStyleTag = "day" | "swing" | "trend" | "reversal"

export const STYLE_TAG_META: Record<TechStyleTag, { ar: string; en: string }> = {
  day: { ar: "صفقة يوم", en: "Day trade" },
  swing: { ar: "صفقة أيام", en: "Days trade" },
  trend: { ar: "صفقة أسابيع", en: "Weeks trade" },
  reversal: { ar: "انعكاس محتمل", en: "Reversal watch" },
}

/** One-line Arabic hint per style. The day hint DISCLOSES why the style is
 *  disabled: the engine reads DAILY closes, which cannot support intraday
 *  day-trade claims (style honesty fix H). */
export const STYLE_TAG_HINT_AR: Record<TechStyleTag, string> = {
  day: "معطّل — بيانات الإغلاق اليومي لا تدعم مطالبة تداول داخل الجلسة",
  swing: "صفقة من يومين لأسبوعين",
  trend: "صفقة مع الاتجاه من أسابيع لشهور",
  reversal: "السهم قرب قيعانه وممكن ينعكس لفوق",
}

export const SIGNAL_META: Record<TechSignalType, { ar: string; en: string }> = {
  buy: { ar: "قراءة شراء", en: "Buy read" },
  hold: { ar: "انتظار", en: "Wait" },
  sell: { ar: "ضغط بيعي", en: "Sell pressure" },
}

export interface SignalReason {
  code: string
  tone: "positive" | "negative" | "neutral"
  ar: string
  en: string
}

export interface StyleFit {
  tag: TechStyleTag
  earned: number
  total: number
}

// ---------------------------------------------------------------------------
// Three-state publication layer (header fix J) — types. ADDITIVE ONLY: the
// legacy fields (signal/score/tradePlan/…) keep their exact semantics.
// ---------------------------------------------------------------------------

/** Pre-entry publication state of a row:
 *  • confirmed — the directional read passed every gate AND a tradable plan
 *    exists (plan non-null, RR ≥ 1.5 by the plan builder's honesty rule);
 *  • watching — a directional candidate is blocked (structural veto, weak
 *    volume, below-full-strength evidence) or the read has no tradable plan;
 *    `setup` carries the close-based activation;
 *  • wait — no directional edge (hold) or too little history. */
export type SignalState = "confirmed" | "watching" | "wait"

export const SIGNAL_STATE_META: Record<SignalState, { ar: string; en: string }> = {
  confirmed: { ar: "قراءة مؤكدة", en: "Confirmed read" },
  watching: { ar: "فرصة تحت المراقبة", en: "Watched setup" },
  wait: { ar: "انتظار", en: "Wait" },
}

/** Close-based activation of a watched setup — the DAILY CLOSE decides,
 *  never an intraday touch. */
export interface SetupActivation {
  kind: "close_above" | "close_below"
  /** tick-rounded trigger level (EGX tick 0.01 — roundToTick) */
  level: number
  /** documented source of the level (Arabic, per-level basis) */
  basisAr: string
  /** required participation on the activation close (Arabic) */
  volumeConditionAr: string
}

export interface ProvisionalEntry { low: number; high: number; basisAr: string }
export interface ProvisionalStop { level: number; basisAr: string }
export interface ProvisionalTarget { low: number; high: number; basisAr: string }

/** Pre-entry invalidation — a DIFFERENT object from the post-entry stop: it
 *  kills the OPPORTUNITY before activation. After activation and entry the
 *  active trade's exit is the recomputed plan's stop, never this level. */
export interface PreEntryInvalidation {
  level: number
  conditionAr: string
  reasonAr: string
}

/** The watching-setup payload (fix J) — everything a blocked candidate needs
 *  to become actionable, with every level's basis disclosed. Provisional
 *  levels are labeled تقديري and RECOMPUTED at activation; RR is RE-VALIDATED
 *  (≥ 1.5) at activation — below that the setup does NOT confirm. */
export interface WatchingSetup {
  direction: "buy" | "sell"
  activation: SetupActivation
  provisionalEntry: ProvisionalEntry | null
  provisionalStop: ProvisionalStop | null
  provisionalTarget: ProvisionalTarget | null
  /** provisional RR from CURRENT structure — re-validated ≥ 1.5 at activation */
  provisionalRiskReward: number | null
  /** where the provisional levels came from (Arabic) */
  provisionalBasisAr: string
  /** the "تُعاد الحسابات عند التفعيل" disclosure (Arabic) */
  recomputeNoteAr: string
  preEntryInvalidation: PreEntryInvalidation
  /** prose note: after activation the trade's exit is the stop, not the
   *  pre-entry invalidation (Arabic) */
  postEntryNoteAr: string
  /** the existing veto/rejection reason objects that caused the block */
  vetoReasons: SignalReason[]
}

export interface TechStance {
  version: string
  /** null when history is too short — "weak data" bucket, never a fake score */
  score: number | null
  signal: TechSignalType | null
  /** per-dimension earned/max in the dimension's own scale (pre-weight) */
  dimensions: { key: "trend" | "momentum" | "volume" | "risk"; earned: number; max: number }[]
  reasons: SignalReason[]
  styleFits: StyleFit[]
  /** nearest technical invalidation level for the current stance (close-only engine: null) */
  invalidation: { side: "below" | "above"; level: number; labelAr: string; labelEn: string } | null
  /** deterministic entry/stop/target zones derived from the signal (null when
   *  no honest plan can be anchored — hold, or no reachable structural target) */
  tradePlan: TradePlan | null
  limitations: string[]
  /** Three-state publication layer (header fix J — additive; optional in the
   *  TYPE only because the frozen v1 A/B baseline does not emit it; every @5
   *  path always sets it, pinned by tests). */
  signalState?: SignalState
  /** the watched-setup payload — present iff signalState === "watching" */
  setup?: WatchingSetup | null
  /** CANONICAL METRIC SNAPSHOT (remediation 2026-11-15 — parity fix).
   *  The board's metric chips used to read the close-only engine's `metrics`
   *  while the company tab read the full OHLC bundle, so the SAME stock showed
   *  two different RSI / range / relVol numbers on two pages. This block is
   *  computed from the canonical full-OHLC snapshot and is the ONLY source the
   *  board may display for an overlaid row. Optional in the TYPE because the
   *  frozen v1 A/B baseline does not emit it; every @5 snapshot path sets it.
   *  A metric that the snapshot cannot honestly produce is `null` — never
   *  substituted from a different calculation source. */
  metrics?: CanonicalMetrics
}

/**
 * The canonical metric block shared by every surface (remediation 2026-11-15).
 *
 * DEFINITIONS ARE PINNED TO THE CLOSE-ENGINE NAMES so the two surfaces are
 * directly comparable, but every value is computed from the FULL OHLC snapshot:
 *   rsi14      — Wilder RSI(14) on adjusted closes
 *   ema20/50   — EMA of adjusted closes
 *   macdLine   — MACD(12,26) line; macdHist — MACD histogram (line − signal)
 *   relVol     — last-session volume ÷ prior-20 average volume
 *   perfW1/M1/M3 — % change over 5 / 21 / 63 sessions
 *   rangePos60 — position inside the observed 60-session high/low (0-100)
 *   dailyVolPct — σ of the last 20 close-to-close % moves
 *   obvSlope20 — OBV slope over the last 20 sessions
 * `null` means "this snapshot cannot produce it honestly" — the UI must render
 * it as unavailable rather than borrowing the close-only number.
 */
export interface CanonicalMetrics {
  rsi14: number | null
  ema20: number | null
  ema50: number | null
  macdLine: number | null
  macdHist: number | null
  relVol: number | null
  perfW1: number | null
  perfM1: number | null
  perfM3: number | null
  rangePos60: number | null
  dailyVolPct: number | null
  obvSlope20: number | null
}

// ---------------------------------------------------------------------------
// Weight table — the single source of truth for both entry points (@5).
// ---------------------------------------------------------------------------

export const SIGNAL_WEIGHTS = {
  trend: 30,
  momentum: 25,
  volume: 25,
  risk: 20,
} as const

/** v1 baseline weights (tech-signals@4) — preserved for A/B replay only. */
const V1_WEIGHTS = { trend: 35, momentum: 30, volume: 20, risk: 15 } as const

const BUY_SCORE = 62
/** Sell reads must EARN conviction: a low score AND bearish momentum (RSI<45).
 *  A weak-lean balanced tape (RSI ~50) stays "wait" — noise is not pressure. */
const SELL_SCORE = 35
const SELL_RSI_MAX = 45
const BUY_TREND_SHARE = 0.55
const SELL_TREND_SHARE = 0.45
/** RSI veto for a buy read: a truly blown-off tape (>78) is not an entry read. */
const BUY_RSI_MAX = 78
/** 21 sessions = SMA20 + range position become computable — below that the
 *  trend share (the stance's anchor) cannot be formed, so the read is "weak". */
const MIN_SESSIONS = 21
const WEAK_SESSIONS = 15

// ---- @5 decision-gate / hysteresis constants --------------------------------
/** Momentum corroboration cap: overlapping oscillators saturate at this share
 *  of the group's present maximum (80% = the decision-excellence bar). */
const MOMENTUM_GROUP_STRONG_SHARE = 0.8
/**
 * DECISION-LEVEL EXCELLENCE BAR (2026-11-15 owner report: buy opportunities
 * never confirmed, the whole board stayed "watching"). A BUY required EVERY
 * present dimension to earn >=80% of its own maximum, so on the EGX — thin
 * volume history, and a risk dimension that competes with trend by
 * construction — almost nothing could ever confirm.
 * 70% still forbids a weak dimension from passing (a 2/10 or 3/10 dim never
 * clears it) while making the confirmed state reachable for a genuinely strong
 * name. This is the DECISION bar; the DISPLAY excellence gate in finalizeScore
 * (>80 needs full strength) is a separate threshold and is unchanged, so the
 * published score keeps its meaning.
 */
const DECISION_STRENGTH_SHARE = 0.7
/** Structure veto distance (audit C): a multi-touch cluster within this % of
 *  the close vetoes the directional read unless breakout/breakdown is confirmed. */
const RESISTANCE_VETO_PCT = 2.0
const SUPPORT_VETO_PCT = 2.0
const VETO_MIN_TOUCHES = 2
/** Breakout/breakdown confirmation: prior close beyond the zone AND this relVol. */
const BREAKOUT_RELVOL = 1.5
/** Distribution path (audit D): sustained distribution can print SELL without
 *  the classic 3-condition conjunction holding at once. */
const SELL_DISTRIBUTION_TREND_SHARE = 0.5
const SELL_DISTRIBUTION_SCORE = 50
// Hysteresis (audit E): asymmetric enter/exit bands + minimum state hold.
const BUY_EXIT_SCORE = 55 // BUY enters at ≥62, exits below 55
const SELL_EXIT_SCORE = 42 // SELL enters at <35, exits above 42
const MIN_STATE_HOLD = 2 // sessions a state holds before a non-structural flip
/** Genuine structural event: bypasses hysteresis and the score glide limit. */
const STRUCTURAL_MOVE_PCT = 3.0
/** Displayed-score glide limit per session (audit E: no more −61 jumps). */
const SCORE_STEP_LIMIT = 25
/** Trailing reconstruction depth for the hysteresis state machine. The state
 *  boundary is documented: reads older than this cannot influence the label. */
const TRAIL_DEPTH = 24

// ---------------------------------------------------------------------------
// Score finalization (shared by BOTH engines) — unchanged from @4 (the audit
// confirmed the finalization math itself; the @5 fixes gate the DECISION).
// ---------------------------------------------------------------------------

export interface FinalizeContext {
  /** the volume dimension had computable inputs (volMax > 0) */
  volumeKnown: boolean
  /** the risk dimension had computable inputs (riskMax > 0) */
  riskKnown: boolean
  /** every present (max > 0) dimension earned ≥ 80% of its own max */
  allDimsStrong: boolean
  /** signal-day relative volume; null/unknown is treated as NOT strong */
  relVol: number | null
}

export function finalizeScore(rawPct: number, ctx: FinalizeContext): number {
  let s = Math.max(0, Math.min(100, rawPct))
  // 1. missing-evidence caps (volume missing dominates: 70 wins over 75)
  if (!ctx.volumeKnown) s = Math.min(s, 70)
  if (!ctx.riskKnown) s = Math.min(s, 75)
  // 2. display excellence gate (kept from @4): anything above 80 needs
  //    full-strength dimensions AND confirmed participation.
  // H-05 remediation: lowered from 1.3 to 1.2. The universal 1.3x threshold
  // was too strict for many EGX names that rarely achieve 1.3x relVol.
  // 1.2x still requires confirmed participation while being achievable for
  // a broader set of liquid names. Calibrated on training/validation periods.
  const relVolStrong = ctx.relVol !== null && ctx.relVol >= 1.2
  if (s > 80 && !(ctx.allDimsStrong && relVolStrong)) s = 80
  // 3. high-end compression curve (80 → 73, 75 → 67, 70 → 61)
  return Math.round(100 * Math.pow(s / 100, 1.4))
}

/** One scored dimension in its own (pre-weight) scale. */
export interface SignalDim {
  key: "trend" | "momentum" | "volume" | "risk"
  earned: number
  max: number
}

function rawWeightedWith(dims: SignalDim[], weights: Record<string, number>): {
  rawPct: number | null
  allDimsStrong: boolean
  volumeKnown: boolean
  riskKnown: boolean
} {
  let score = 0
  let weightSum = 0
  for (const d of dims) {
    if (d.max <= 0) continue
    score += (d.earned / d.max) * weights[d.key]
    weightSum += weights[d.key]
  }
  const present = dims.filter((d) => d.max > 0)
  const allDimsStrong = present.length > 0 && present.every((d) => d.earned / d.max >= DECISION_STRENGTH_SHARE)
  return {
    rawPct: weightSum > 0 ? (score / weightSum) * 100 : null,
    allDimsStrong,
    volumeKnown: dims.some((d) => d.key === "volume" && d.max > 0),
    riskKnown: dims.some((d) => d.key === "risk" && d.max > 0),
  }
}

/** Weighted raw percentage over the dimensions that actually have evidence. */
function rawWeightedPct(dims: SignalDim[]): ReturnType<typeof rawWeightedWith> {
  return rawWeightedWith(dims, SIGNAL_WEIGHTS)
}

// ---------------------------------------------------------------------------
// Shared band scorers — identical numbers in BOTH engines.
// ---------------------------------------------------------------------------

/** RSI band credit — widened healthy zone (45-65) with gradual taper above 65.
 *  This separates momentum strength from extension risk (which is handled in
 *  the risk dimension via extensionRiskPoints). The @4 engine over-penalized
 *  strong trends with RSI 65-75 by giving near-zero momentum credit. */
function rsiBandPoints(r: number): number {
  if (r >= 45 && r <= 65) return 10  // widened from 45-60: healthy momentum
  if (r > 65 && r <= 70) return 8   // slightly extended but still strong
  if (r > 70 && r <= 75) return 6   // extended but momentum present
  if (r > 75 && r <= 78) return 4   // very extended, near veto threshold
  if (r > 78) return 2              // overbought — vetoed for BUY anyway
  if (r >= 40) return 5
  if (r >= 30) return 3
  return 2 // <30 oversold
}

/** MACD line+histogram credit. */
function macdPoints(line: number, hist: number): number {
  return line > 0 && hist > 0 ? 10 : line > 0 && hist <= 0 ? 5 : line <= 0 && hist > 0 ? 7 : 1
}

/**
 * @5 signal-day relative-volume credit. Up-day bands: 2-3× = 10 (strongest
 * confirmation), ≥1× = 8 (CONFIRMED participation — raised from 6 because
 * participation is now a required buy confirmation), >3× = 4 (climax — NOT
 * auto-credit), <1× = 3 (unconfirmed move). A down day earns no up-band
 * credit: heavy down volume is a distribution hint (1), a quiet drift mild (3).
 */
function relVolBandPoints(relVol: number, upDay: boolean): number {
  if (!upDay) return relVol >= 1.5 ? 1 : 3
  if (relVol > 2 && relVol <= 3) return 10
  if (relVol >= 1 && relVol <= 2) return 8
  if (relVol > 3) return 4
  return 3
}

/** v1 baseline relVol bands (tech-signals@4) — preserved for A/B replay. */
function v1RelVolBandPoints(relVol: number, upDay: boolean): number {
  if (!upDay) return relVol >= 1.5 ? 1 : 3
  if (relVol > 2 && relVol <= 3) return 10
  if (relVol >= 1 && relVol <= 2) return 6
  if (relVol > 3) return 4
  return 3
}

/**
 * @5 extension risk — TWO-SIDED and trend-agnostic (audit B: the old risk dim
 * rewarded "price above rising averages", i.e. trend agreement). Above the
 * short average the risk is chase; far BELOW it the risk is dislocation:
 *   > +8%  → 0 (chase)   |  (+4%, +8%] → 5 (stretched)
 *   [−10%, +4%] → 8 (comfortable)  |  < −10% → 3 (dislocated / falling knife)
 */
function extensionRiskPoints(extPct: number): number {
  if (extPct > 8) return 0
  if (extPct > 4) return 5
  if (extPct >= -10) return 8
  return 3
}

/** v1 baseline extension credit (tech-signals@4) — for A/B replay only. */
function v1ExtensionPoints(extPct: number): number {
  return extPct <= 4 ? 8 : extPct <= 8 ? 5 : 0
}

/** Daily-volatility credit: ≤3% = 7, 3-5% = 4, >5% = 0. */
function dailyVolPoints(volPct: number): number {
  return volPct <= 3 ? 7 : volPct <= 5 ? 4 : 0
}

/** Volatility-expansion credit (new @5 risk fact): σ(recent 10 close-to-close
 *  moves) ÷ σ(prior 10) ≤ 2 → 5 (contained), > 2 → 2 (expanding — risk). */
function expansionPoints(ratio: number): number {
  return ratio <= 2 ? 5 : 2
}

/**
 * Stochastic credit with the OVERBOUGHT CONTEXT VETO (audit G): k ≥ 80 in a
 * strong trend must NOT earn max momentum points — the two oscillators used
 * to disagree systematically at tops (RSI >72 earned 2/10 while k=95 earned
 * 7/10). Now both are vetoed.
 */
function stochPoints(k: number, d: number): number {
  if (k >= 80) return 2 // overbought context — no momentum credit
  if (k > d && k >= 30 && k <= 75) return 10
  if (k > d && k >= 75) return 5
  if (k > d) return 7
  if (k < 20) return 5
  return 3
}

/** Range-position credit (60-session): 45-75 = 10, 20-45 = 7, 75-90 = 5,
 *  >90 = 2 (range top — no momentum credit at the very top), <20 = 3. */
function rangePosPoints(p: number): number {
  return p >= 45 && p <= 75 ? 10 : p >= 20 && p < 45 ? 7 : p >= 75 && p <= 90 ? 5 : p > 90 ? 2 : 3
}

/** Consecutive rising steps at the END of a series (v1 + reason building). */
function risingStreak(series: (number | null)[]): number | null {
  const n = series.length
  if (n < 2 || series[n - 1] === null || series[n - 2] === null) return null
  let streak = 0
  for (let i = n - 1; i > 0; i--) {
    const prev = series[i - 1]
    const cur = series[i]
    if (prev === null || cur === null) break
    if (cur > prev) streak++
    else break
  }
  return streak
}

// ---------------------------------------------------------------------------
// Shared reason catalogue (bilingual) — reuse the exact line everywhere.
// ---------------------------------------------------------------------------

const R = {
  fullAlignmentUp: { code: "alignment_up", tone: "positive", ar: "السعر فوق EMA20 وEMA50 مع رصيف متوسطات صاعدة.", en: "Price above EMA20 and EMA50 with a bullish moving-average stack." },
  fullAlignmentDown: { code: "alignment_down", tone: "negative", ar: "السعر تحت EMA20 وEMA50 مع رصيف متوسطات هابطة.", en: "Price below EMA20 and EMA50 with a bearish moving-average stack." },
  aboveSma20: { code: "above_sma20", tone: "positive", ar: "السعر يتداول فوق متوسط آخر 20 جلسة.", en: "Price is trading above its 20-session EMA." },
  belowSma20: { code: "below_sma20", tone: "negative", ar: "السعر يتداول تحت متوسط آخر 20 جلسة.", en: "Price is trading below its 20-session EMA." },
  sma20SlopeUp: { code: "sma20_slope_up", tone: "positive", ar: "متوسط آخر 20 جلسة اتجاهه صاعد.", en: "The 20-session EMA is sloping up." },
  sma20SlopeDown: { code: "sma20_slope_down", tone: "negative", ar: "متوسط آخر 20 جلسة اتجاهه هابط.", en: "The 20-session EMA is sloping down." },
  smaGoldenCross: { code: "ema_golden_cross", tone: "positive", ar: "تقاطع ذهبي: EMA50 فوق EMA200 — دليل اتجاه صاعد طويل المدى.", en: "Golden cross: EMA50 is above EMA200 — long-horizon uptrend evidence." },
  smaDeathCross: { code: "ema_death_cross", tone: "negative", ar: "تقاطع هابط: EMA50 تحت EMA200 — دليل ضغط بيعي طويل المدى.", en: "Death cross: EMA50 is below EMA200 — long-horizon sell-pressure evidence." },
  macdBullish: { code: "macd_bullish", tone: "positive", ar: "MACD موجب مع هيستوجرام صاعد — الزخم بيدعم الصعود.", en: "MACD is positive with a rising histogram." },
  macdBearish: { code: "macd_bearish", tone: "negative", ar: "MACD سالب مع هيستوجرام هابط — الزخم بيدعم الهبوط.", en: "MACD is negative with a falling histogram." },
  macdBullCross: { code: "macd_bull_cross", tone: "positive", ar: "تقاطع MACD فوق خط الإشارة — بداية انعكاس محتملة.", en: "MACD crossing above its signal line (possible early reversal)." },
  macdBearCross: { code: "macd_bear_cross", tone: "negative", ar: "تقاطع MACD تحت خط الإشارة — بداية ضعف محتملة.", en: "MACD crossing below its signal line (possible early reversal)." },
  rsiNeutralUp: { code: "rsi_neutral_up", tone: "positive", ar: `RSI في منطقة الزخم الصح (45-60) من غير تشبع شرائي.`, en: "RSI sits in the healthy momentum band (45-60) without overextension." },
  rsiOverbought: { code: "rsi_overbought", tone: "negative", ar: "RSI في تشبع شرائي — في خطر تصحيح.", en: "RSI is overbought — correction risk." },
  rsiOversold: { code: "rsi_oversold", tone: "neutral", ar: "RSI في تشبع بيعي — راقب احتمالية الانعكاس.", en: "RSI is oversold — reversal watch." },
  obvUp: { code: "obv_up", tone: "positive", ar: "ميول تجميع في سلوك التداول — OBV صاعد.", en: "Accumulation tendency in volume behavior (OBV rising)." },
  obvDown: { code: "obv_down", tone: "negative", ar: "ميول توزيع في سلوك التداول — OBV هابط.", en: "Distribution tendency in volume behavior (OBV falling)." },
  volumeConfirmUp: { code: "volume_confirm", tone: "positive", ar: "حجم التداول بيدعم الحركة الصاعدة.", en: "Volume is confirming the upward move." },
  volumeChase: { code: "volume_chase", tone: "negative", ar: "حجم تداول أعلى من المعتاد بكتير — خطر المطاردة عند القمة.", en: "Volume is unusually high — chase-the-top risk." },
  notExtended: { code: "not_extended", tone: "positive", ar: "السعر مش ممدد بعيد فوق متوسطه القصير.", en: "Price is not extended above its short EMA." },
  extended: { code: "extended", tone: "negative", ar: "السعر بعيد جدًا فوق متوسط 20 جلسة — منطقة دخول سيئة دلوقتي.", en: "Price is stretched far above its 20-session EMA — poor entry zone." },
  stableVol: { code: "stable_vol", tone: "positive", ar: "التقلب اليومي منضبط.", en: "Daily volatility is contained." },
  wildVol: { code: "wild_vol", tone: "negative", ar: "التقلب اليومي مرتفع — المخاطرة السعرية كبيرة.", en: "Daily volatility is elevated — high price risk." },
  oversoldBounce: { code: "oversold_bounce", tone: "positive", ar: "أول إغلاق صاعد بعد تشبع بيعي — محاولة ارتداد مبكرة.", en: "First positive close after an oversold reading." },
  atRangeTop: { code: "range_top", tone: "negative", ar: "السعر عند أعلى نطاق 60 جلسة — منطقة متشبعة.", en: "Price sits at the top of its 60-session range." },
  // ---- @5 decision-gate rejection reasons (audit A: explicit, bilingual) ----
  weakVolumeNoBuy: { code: "weak_volume_no_buy", tone: "negative", ar: "حجم تداول ضعيف — تأكيد غير كافٍ للقراءة الشرائية.", en: "Weak trading volume — insufficient confirmation for a buy read." },
  notFullStrength: { code: "not_full_strength", tone: "negative", ar: "الأدلة مش كاملة القوة على كل الأبعاد — قراءة الشراء محتاجة تأكيد كامل.", en: "Evidence is below the full-confirmation bar on at least one dimension — a buy read requires full-strength confluence." },
  nearResistanceVeto: { code: "near_resistance_veto", tone: "negative", ar: "السعر ملاصق لمقاومة مُختبرة — القراءة الشرائية موقوفة لحين كسر مؤكد أو إعادة اختبار ناجحة.", en: "Price is pressed against a tested resistance cluster — the buy read is held pending a confirmed breakout or a successful retest." },
  breakoutConfirmed: { code: "breakout_confirmed", tone: "positive", ar: "كسر مؤكد لمقاومة مُختبرة بحجم قوي — الفيتو الهيكلي مرفوع.", en: "Confirmed breakout above a tested resistance on strong volume — the structural veto is lifted." },
  atSupportVeto: { code: "at_support_veto", tone: "negative", ar: "السعر فوق دعم مُختبر مباشرة — ضغط البيع مؤجل لحين كسر مؤكد.", en: "Price sits directly on a tested support — the sell read is deferred pending a confirmed breakdown." },
  breakdownConfirmed: { code: "breakdown_confirmed", tone: "negative", ar: "كسر مؤكد لدعم مُختبر بحجم قوي.", en: "Confirmed breakdown of a tested support on strong volume." },
  distributionSell: { code: "distribution_sell", tone: "negative", ar: "توزيع واضح: تدفقات خارجة مع زخم مكسور — ضغط بيعي (مش أمر بيع قصير).", en: "Clear distribution: outflow with broken momentum — sell pressure (not a short-selling instruction)." },
  volExpanding: { code: "vol_expanding", tone: "negative", ar: "التقلب يتوسع مقارنة بالفترة السابقة — المخاطرة في ارتفاع.", en: "Volatility is expanding versus the prior window — risk is rising." },
  // ---- three-state publication layer (additive — a DISPLAY reason, never a
  // decision input: the plan builder's RR >= 1.5 honesty rule stays intact) ----
  noTradablePlan: { code: "no_tradable_plan", tone: "neutral", ar: "مفيش خطة تداول قابلة للتنفيذ من هيكل السعر الحالي — القراءة اتحولت لفرصة تحت المراقبة لحين تفعيل مستوى هيكلي بإغلاق يومي.", en: "No tradable plan can be anchored on the current structure — the read is published as a watched setup pending a structural close-based activation." },
} as const satisfies Record<string, { code: string; tone: SignalReason["tone"]; ar: string; en: string }>

function reason(key: keyof typeof R): SignalReason {
  const r = R[key]
  return { code: r.code, tone: r.tone, ar: r.ar, en: r.en }
}

// ---------------------------------------------------------------------------
// Decision gates (audit A/C/D) — ONE shared implementation for both engines.
// ---------------------------------------------------------------------------

export interface GateFlags {
  volumeAgreement: boolean
  allDimsStrong: boolean
  /** classical buy conditions EXCEPT the volume/excellence gates (for rejection reasons) */
  buyCandidate: boolean
  /** classical sell conditions (for rejection reasons) */
  sellCandidate: boolean
  vetoResistance: boolean
  vetoSupport: boolean
  breakoutConfirmed: boolean
  breakdownConfirmed: boolean
  distributionSell: boolean
}

interface DecideInput {
  finalScore: number | null
  trendShare: number | null
  rsi: number | null
  macdLine: number | null
  macdHist: number | null
  relVol: number | null
  obvSlope: number | null
  allDimsStrong: boolean
  lowerHighs: boolean | null
  belowLongMa: boolean
  close: number
  prevClose: number | null
  resistanceZone: { price: number; touches: number } | null
  supportZone: { price: number; touches: number } | null
}

/**
 * Shared @5 decision:
 *  • BUY = score ≥62 AND trendShare ≥0.55 AND volume agreement (relVol ≥1 OR
 *    OBV agrees) AND decision-level excellence (every present dim ≥80% of its
 *    own max) AND the RSI context veto AND no structure veto.
 *  • SELL = classic path (score <35 AND trendShare ≤0.45 AND bearish momentum)
 *    OR the distribution path (OBV falling + momentum breakdown + lower-highs
 *    or below the long MA, score <50) — mirrored structure veto applies.
 *  • SELL deliberately does NOT require the excellence gate: requiring
 *    full-strength bearish evidence on every dimension would recreate the
 *    unreachable-SELL failure the audit measured (ORAS: 467 straight holds).
 */
/** Exported for contract tests: the shared @5 decision gates (volume agreement,
 *  decision-level excellence, structure veto, distribution path). */
export function decideSignal(x: DecideInput): { signal: TechSignalType | null; gates: GateFlags } {
  const base: GateFlags = {
    volumeAgreement: false,
    allDimsStrong: x.allDimsStrong,
    buyCandidate: false,
    sellCandidate: false,
    vetoResistance: false,
    vetoSupport: false,
    breakoutConfirmed: false,
    breakdownConfirmed: false,
    distributionSell: false,
  }
  if (x.finalScore === null || x.trendShare === null) return { signal: null, gates: base }

  // volume agreement (audit A): relVol ≥ 1.0 OR the OBV slope agrees with the setup
  const volumeAgreement =
    x.relVol === null && x.obvSlope === null
      ? false
      : x.relVol !== null
        ? x.relVol >= 1.0 || (x.obvSlope ?? 0) > 0
        : (x.obvSlope ?? 0) > 0
  base.volumeAgreement = volumeAgreement

  const rsiOK = x.rsi === null || x.rsi <= BUY_RSI_MAX
  const sellMomentum = x.rsi !== null ? x.rsi < SELL_RSI_MAX : (x.macdLine ?? 0) < 0
  const momentumBreakdown = (x.macdLine !== null && x.macdHist !== null && x.macdLine < 0 && x.macdHist < 0) || (x.rsi !== null && x.rsi < 40)

  base.buyCandidate = x.finalScore >= BUY_SCORE && x.trendShare >= BUY_TREND_SHARE && rsiOK
  const buyPre = base.buyCandidate && volumeAgreement && x.allDimsStrong

  base.sellCandidate = x.finalScore < SELL_SCORE && x.trendShare <= SELL_TREND_SHARE && sellMomentum
  base.distributionSell =
    x.obvSlope !== null && x.obvSlope < 0 && momentumBreakdown && (x.lowerHighs === true || x.belowLongMa) &&
    x.trendShare <= SELL_DISTRIBUTION_TREND_SHARE && x.finalScore < SELL_DISTRIBUTION_SCORE
  const sellPre = base.sellCandidate || base.distributionSell

  // structure veto (audit C): multi-touch cluster within ~2% blocks the read
  // unless breakout/breakdown is confirmed (prior close beyond the zone AND
  // relVol ≥ 1.5) or a documented retest-hold is in place.
  let vetoResistance = false
  let vetoSupport = false
  if (buyPre && x.resistanceZone && x.resistanceZone.touches >= VETO_MIN_TOUCHES) {
    const breakout = x.prevClose !== null && x.prevClose > x.resistanceZone.price && (x.relVol ?? 0) >= BREAKOUT_RELVOL
    const retest = x.prevClose !== null && retestHoldAbove(x.resistanceZone.price, x.close, x.prevClose)
    base.breakoutConfirmed = breakout
    vetoResistance = !breakout && !retest
  }
  if (sellPre && x.supportZone && x.supportZone.touches >= VETO_MIN_TOUCHES) {
    const breakdown = x.prevClose !== null && x.prevClose < x.supportZone.price && (x.relVol ?? 0) >= BREAKOUT_RELVOL
    const retest = x.prevClose !== null && retestHoldBelow(x.supportZone.price, x.close, x.prevClose)
    base.breakdownConfirmed = breakdown
    vetoSupport = !breakdown && !retest
  }
  base.vetoResistance = vetoResistance
  base.vetoSupport = vetoSupport

  const signal: TechSignalType = buyPre && !vetoResistance ? "buy" : sellPre && !vetoSupport ? "sell" : "hold"
  return { signal, gates: base }
}

/** Retest-hold above a broken resistance: the prior close held above the zone. */
function retestHoldAbove(zonePrice: number, close: number, prevClose: number): boolean {
  return close > zonePrice && prevClose > zonePrice
}

/** Retest-hold below a broken support: the prior close held below the zone. */
function retestHoldBelow(zonePrice: number, close: number, prevClose: number): boolean {
  return close < zonePrice && prevClose < zonePrice
}

// ---------------------------------------------------------------------------
// Three-state publication layer (header fix J) — state derivation + the
// watched-setup builder. Reads ONLY the gate flags the decision already used;
// adds no evidence, no weight and no veto. The plan builder's honesty rules
// (RR >= 1.5 rejection) are untouched — provisional levels are labeled
// تقديري and re-derived at activation.
// ---------------------------------------------------------------------------

/** The gate outcomes that BLOCK a buy candidate (the audit A/C rejection
 *  codes, in the same priority the reasons section prints them). */
function blockedBuyReasons(g: GateFlags): SignalReason[] {
  if (!g.buyCandidate) return []
  const out: SignalReason[] = []
  if (!g.volumeAgreement) out.push(reason("weakVolumeNoBuy"))
  else if (!g.allDimsStrong) out.push(reason("notFullStrength"))
  if (g.vetoResistance) out.push(reason("nearResistanceVeto"))
  return out
}


interface StateDerivation {
  state: SignalState
  /** direction of the blocked candidate (watching) or of the read (confirmed) */
  direction: "buy" | "sell" | null
  vetoReasons: SignalReason[]
}

/**
 * Map (published signal, last-read gates, plan presence) → the publication
 * state. A vetoed/uncandified hold with a live blocked candidate is still a
 * WATCHED OPPORTUNITY (the candidate read exists, the structure just says
 * not-yet) — the `signal` field itself is never altered.
 */
function deriveSignalState(signal: TechSignalType | null, g: GateFlags, hasPlan: boolean): StateDerivation {
  const noPlanReason: SignalReason = reason("noTradablePlan")
  if (signal === "buy") {
    const blockers = blockedBuyReasons(g)
    if (blockers.length > 0) return { state: "watching", direction: "buy", vetoReasons: blockers }
    if (!hasPlan) return { state: "watching", direction: "buy", vetoReasons: [noPlanReason] }
    return { state: "confirmed", direction: "buy", vetoReasons: [] }
  }
  // SELL IS NEVER A SETUP (EGX reality, 2026-11-15 owner report): the Egyptian
  // Exchange has no retail short-selling, so a "sell opportunity" is a trade
  // nobody reading this can execute. A sell read stays the sell-pressure / risk
  // warning it already is (exit or avoid), published on `signal` alone — never
  // confirmed, never watched, and never carrying levels. `hasPlan` is always
  // false for a sell read now that the plan builder refuses to price one.
  if (signal === "sell") return { state: "wait", direction: null, vetoReasons: [] }
  // hold / null — a blocked BUY candidate still publishes a watched opportunity
  const buyBlockers = blockedBuyReasons(g)
  if (buyBlockers.length > 0) return { state: "watching", direction: "buy", vetoReasons: buyBlockers }
  return { state: "wait", direction: null, vetoReasons: [] }
}

const SETUP_VOLUME_CONDITION_AR = "حجم إغلاق ≥ 1.5× متوسط آخر 20 جلسة"
const SETUP_RECOMPUTE_NOTE_AR =
  "المستويات تقديرية (تقديري) وتُعاد الحسابات بالكامل لحظة التفعيل بإغلاق يومي — وعندها يُعاد التحقق من نسبة المخاطرة/العائد؛ لو كانت أقل من 1.5 الفرصة لا تتحول إلى قراءة مؤكدة."
const SETUP_POST_ENTRY_NOTE_AR =
  "ملحوظة: شرط الإلغاء يخص ما قبل الدخول فقط — بعد التفعيل والدخول، الخروج من الصفقة يتبع وقف الخسارة في الخطة المُعاد حسابها، وليس شرط الإلغاء."

/** Documented observed extremes used as the deterministic fallback anchors
 *  when no pivot structure exists (the close engine: last-20 closes; the
 *  snapshot path: the observed 60-session range). */
interface SetupExtremes {
  low: number | null
  lowBasisAr: string
  high: number | null
  highBasisAr: string
}

interface WatchingSetupInput {
  direction: "buy" | "sell"
  lastClose: number
  /** true when a structural veto raised the block — the activation level is
   *  then the veto structure itself (resistance top / support bottom) */
  structuralVeto: boolean
  /** the veto zone level (the SAME object the veto consumed; un-rounded) */
  vetoLevel: number | null
  vetoTouches: number | null
  /** zone band edges when the veto came from a supply/demand zone (snapshot) */
  vetoBand: { low: number; high: number } | null
  vetoReasons: SignalReason[]
  /** full close series (close engine) — [] on the snapshot path */
  closes: number[]
  supports: { price: number }[]
  resistances: { price: number }[]
  zones: { kind: "demand" | "supply"; low: number; high: number }[] | null
  atrPct: number | null
  volPct: number | null
  extremes: SetupExtremes
}

/**
 * Build the watched-setup payload for a blocked candidate.
 *
 * ACTIVATION LEVEL SOURCE (deterministic, no invented numbers):
 *   structural veto → the veto structure itself: for a blocked buy the TOP of
 *   the tested resistance cluster (supply-zone high / pivot price), for a
 *   blocked sell the BOTTOM of the tested support (demand-zone low / pivot);
 *   no veto → nearest structural pivot beyond the close, else the documented
 *   observed extreme of the series (last-20 closes / 60-session range).
 * PROVISIONAL LEVELS: the CURRENT trade-plan builder evaluated AT the
 *   activation level (lastClose := activation) — same honesty rules; when it
 *   cannot anchor a plan (RR < 1.5 or missing anchors) the levels fall back
 *   to raw structure, and every level carries its own basisAr.
 */
function buildWatchingSetup(inp: WatchingSetupInput): WatchingSetup {
  const dir = inp.direction
  const fmt = (v: number): string => v.toFixed(2)

  // ---- activation level -------------------------------------------------------
  let rawLevel: number | null = null
  // Every path below either assigns this or the rawLevel === null fallback
  // overwrites it — the empty default satisfies definite assignment only.
  let activationBasisAr = ""
  if (inp.structuralVeto && inp.vetoLevel !== null) {
    if (dir === "buy") {
      rawLevel = inp.vetoBand ? inp.vetoBand.high : inp.vetoLevel
      activationBasisAr = `أعلى مجموعة المقاومة المُختبرة التي أوقفت القراءة${inp.vetoTouches !== null ? ` (${inp.vetoTouches} اختبارات)` : ""}`
    } else {
      rawLevel = inp.vetoBand ? inp.vetoBand.low : inp.vetoLevel
      activationBasisAr = `قاع مجموعة الدعم المُختبرة التي أوقفت القراءة${inp.vetoTouches !== null ? ` (${inp.vetoTouches} اختبارات)` : ""}`
    }
  } else if (dir === "buy") {
    const res = nearestAbove(inp.resistances.map((r) => r.price), inp.lastClose)
    if (res !== null) {
      rawLevel = res
      activationBasisAr = "أقرب مقاومة هيكلية فوق السعر"
    } else if (inp.extremes.high !== null) {
      rawLevel = inp.extremes.high
      activationBasisAr = inp.extremes.highBasisAr
    }
  } else {
    const sup = nearestBelow(inp.supports.map((s) => s.price), inp.lastClose)
    if (sup !== null) {
      rawLevel = sup
      activationBasisAr = "أقرب دعم هيكلي تحت السعر"
    } else if (inp.extremes.low !== null) {
      rawLevel = inp.extremes.low
      activationBasisAr = inp.extremes.lowBasisAr
    }
  }
  // Total by construction (a blocked candidate always has a veto structure, a
  // pivot, or an observed extreme of its own series); the last-resort anchor
  // is the last close itself and the basis says so honestly.
  const activationLevel = roundToTick(rawLevel ?? inp.lastClose)
  if (rawLevel === null) activationBasisAr = "آخر إغلاق متاح — لا هيكل سعري مرصود في هذه اللقطة"

  const activation: SetupActivation = {
    kind: dir === "buy" ? "close_above" : "close_below",
    level: activationLevel,
    basisAr: activationBasisAr,
    volumeConditionAr: SETUP_VOLUME_CONDITION_AR,
  }

  // ---- provisional levels: the plan builder AT the activation level ----------
  const plan = buildTradePlan({
    signal: dir,
    lastClose: activationLevel,
    closes: inp.closes,
    supports: inp.supports,
    resistances: inp.resistances,
    zones: inp.zones,
    atrPct: inp.atrPct,
    volPct: inp.volPct,
  })

  const supBelowActivation = nearestBelow(inp.supports.map((s) => s.price), activationLevel)
  const resAboveActivation = nearestAbove(inp.resistances.map((r) => r.price), activationLevel)

  // a sell read carries no geometry (no retail short selling on the EGX)
  const sellNoLevels = dir === "sell"
  const provisionalEntry: ProvisionalEntry | null = sellNoLevels ? null : plan
    ? { low: plan.entryLow, high: plan.entryHigh, basisAr: `خطة تقديرية محسوبة على مستوى التفعيل — ${plan.basisAr}` }
    : dir === "buy"
      ? { low: activationLevel, high: roundToTick(activationLevel * 1.004), basisAr: "منطقة ما بعد التفعيل حول مستوى الكسر (تقديري)" }
      : { low: roundToTick(activationLevel * 0.996), high: activationLevel, basisAr: "منطقة ما بعد التفعيل حول مستوى الكسر (تقديري)" }

  const stopAtrNoteAr = " (تقديري — يُثبت بـ 1.5×ATR عند التفعيل)"
  const provisionalStop: ProvisionalStop | null = sellNoLevels ? null : plan
    ? { level: plan.stop, basisAr: `وقف تقديري — ${plan.basisAr}` }
    : dir === "buy"
      ? supBelowActivation !== null
        ? { level: roundToTick(supBelowActivation), basisAr: `أقرب دعم هيكلي تحت مستوى التفعيل${stopAtrNoteAr}` }
        : inp.extremes.low !== null && inp.extremes.low < activationLevel
          ? { level: roundToTick(inp.extremes.low), basisAr: `${inp.extremes.lowBasisAr}${stopAtrNoteAr}` }
          : null
      : resAboveActivation !== null
        ? { level: roundToTick(resAboveActivation), basisAr: `أقرب مقاومة هيكلية فوق مستوى التفعيل${stopAtrNoteAr}` }
        : inp.extremes.high !== null && inp.extremes.high > activationLevel
          ? { level: roundToTick(inp.extremes.high), basisAr: `${inp.extremes.highBasisAr}${stopAtrNoteAr}` }
          : null

  let provisionalTarget: ProvisionalTarget | null = null
  if (sellNoLevels) {
    // deliberately empty — a short setup keeps its trigger, never its levels
  } else if (plan) {
    provisionalTarget = {
      low: plan.targetLow,
      high: plan.targetHigh,
      basisAr: `هدف تقديري — مصدر الخطة (${plan.targetKind ?? "هيكلي"})`,
    }
  } else if (dir === "buy") {
    if (resAboveActivation !== null) {
      provisionalTarget = { low: roundToTick(resAboveActivation), high: roundToTick(resAboveActivation), basisAr: "أقرب مقاومة هيكلية فوق مستوى التفعيل (تقديري)" }
    } else {
      const mm = measuredHeight(inp.closes)
      if (mm !== null) {
        provisionalTarget = {
          low: roundToTick(activationLevel + mm),
          high: roundToTick(activationLevel + mm),
          basisAr: "حركة مقاسة: ارتفاع نطاق آخر 40 جلسة مسقطًا من مستوى التفعيل (تقديري)",
        }
      }
    }
  } else {
    if (supBelowActivation !== null) {
      provisionalTarget = { low: roundToTick(supBelowActivation), high: roundToTick(supBelowActivation), basisAr: "أقرب دعم هيكلي تحت مستوى التفعيل (تقديري)" }
    } else {
      const mm = measuredHeight(inp.closes)
      if (mm !== null) {
        provisionalTarget = {
          low: roundToTick(activationLevel - mm),
          high: roundToTick(activationLevel - mm),
          basisAr: "حركة مقاسة: ارتفاع نطاق آخر 40 جلسة مسقطًا من مستوى التفعيل (تقديري)",
        }
      }
    }
  }

  const provisionalRiskReward = (() => {
    if (plan) return plan.riskReward
    if (provisionalEntry === null || provisionalStop === null || provisionalTarget === null) return null
    const entryMid = (provisionalEntry.low + provisionalEntry.high) / 2
    const targetMid = (provisionalTarget.low + provisionalTarget.high) / 2
    const risk = dir === "buy" ? entryMid - provisionalStop.level : provisionalStop.level - entryMid
    const reward = dir === "buy" ? targetMid - entryMid : entryMid - targetMid
    if (!(risk > 0) || !(reward > 0)) return null
    return Math.round((reward / risk) * 100) / 100
  })()

  // ---- pre-entry invalidation (separate from the post-entry stop) ------------
  const preEntryInvalidation: PreEntryInvalidation = (() => {
    if (dir === "buy") {
      const floor = nearestBelow(inp.supports.map((s) => s.price), inp.lastClose) ?? inp.extremes.low
      const level = roundToTick(floor ?? inp.lastClose)
      return {
        level,
        conditionAr: `إغلاق يومي تحت ${fmt(level)} يلغي الفرصة قبل الدخول.`,
        reasonAr: "الكسر الهيكلي قبل التفعيل يجعل سيناريو الاستمرار غير صالح — تُلغى الفرصة وتُعاد القراءة من الصفر.",
      }
    }
    const ceiling = nearestAbove(inp.resistances.map((r) => r.price), inp.lastClose) ?? inp.extremes.high
    const level = roundToTick(ceiling ?? inp.lastClose)
    return {
      level,
      conditionAr: `إغلاق يومي فوق ${fmt(level)} يلغي الفرصة قبل الدخول.`,
      reasonAr: "الاستعادة الهيكلية قبل التفعيل تلغي سيناريو الانهيار — تُلغى الفرصة وتُعاد القراءة من الصفر.",
    }
  })()

  return {
    direction: dir,
    activation,
    provisionalEntry,
    provisionalStop,
    provisionalTarget,
    provisionalRiskReward,
    provisionalBasisAr: plan
      ? "مشتقة من مُنشئ الخطط الحتمي مُقيَّمًا عند مستوى التفعيل (تقديري)"
      : "مشتقة من هيكل السعر مباشرة لأن الخطة لا تُثبَّت على الهيكل الحالي (تقديري)",
    recomputeNoteAr: SETUP_RECOMPUTE_NOTE_AR,
    preEntryInvalidation,
    postEntryNoteAr: SETUP_POST_ENTRY_NOTE_AR,
    vetoReasons: inp.vetoReasons,
  }
}

// ---------------------------------------------------------------------------
// Style checklists — the SAME facts evaluated per trading horizon.
// The "day" style is DISABLED (@5 style honesty): daily closes cannot support
// intraday claims. The tag stays in the type/meta for UI compatibility.
// ---------------------------------------------------------------------------

function computeStyleFits(
  x: {
    signal: TechSignalType | null
    changePct: number | null
    rsi: number | null
    ema20: number | null
    ema50: number | null
    lastClose: number | null
    macdHist: number | null
    relVol: number | null
    obvSlope20: number | null
    rangePos60: number | null
    dailyVolPct: number | null
    ema20SlopeUp: boolean | null
    volumePresent: boolean
  },
  includeDay: boolean,
): StyleFit[] {
  const fits: StyleFit[] = []

  // --- day: DISABLED on daily data (see module header, fix H). v1 A/B replay
  //  still computes it (includeDay) so before/after style coverage compares. ---
  if (includeDay && x.volumePresent && x.relVol !== null) {
    let earned = 0
    const checks: boolean[] = []
    checks.push(x.relVol >= 1.3); if (checks[0]) earned++
    checks.push(x.changePct !== null && Math.abs(x.changePct) >= 1.5); if (checks[1]) earned++
    checks.push(x.dailyVolPct !== null && x.dailyVolPct >= 1.5); if (checks[2]) earned++
    checks.push(x.signal === "buy" || x.signal === "hold"); if (checks[3]) earned++
    fits.push({ tag: "day", earned, total: checks.length })
  }

  // --- swing (days-to-weeks): momentum inside an intact trend ---
  if (x.lastClose !== null && x.ema20 !== null) {
    let earned = 0
    const checks: boolean[] = []
    checks.push(x.lastClose !== null && x.ema20 !== null && x.lastClose > x.ema20); if (checks[0]) earned++
    checks.push(x.ema50 === null ? false : x.ema20 > x.ema50); if (checks[1]) earned++
    checks.push(x.rsi !== null && x.rsi >= 40 && x.rsi <= 75); if (checks[2]) earned++
    checks.push(x.rangePos60 !== null && x.rangePos60 >= 25 && x.rangePos60 <= 85); if (checks[3]) earned++
    checks.push(x.macdHist !== null && x.macdHist > 0); if (checks[4]) earned++
    checks.push(x.signal === "buy" || (x.signal === "hold" && (x.ema20SlopeUp ?? false))); if (checks[5]) earned++
    fits.push({ tag: "swing", earned, total: checks.length })
  }

  // --- trend (multi-week position): durability of the uptrend ---
  if (x.ema50 !== null) {
    let earned = 0
    const checks: boolean[] = []
    checks.push(x.lastClose !== null && x.lastClose > x.ema50); if (checks[0]) earned++
    checks.push(x.ema20SlopeUp === true); if (checks[1]) earned++
    checks.push(x.macdHist !== null && x.macdHist > 0); if (checks[2]) earned++
    checks.push(x.obvSlope20 !== null && x.obvSlope20 > 0); if (checks[3]) earned++
    checks.push(x.signal === "buy"); if (checks[4]) earned++
    fits.push({ tag: "trend", earned, total: checks.length })
  }

  // --- reversal: oversold with the first sign of life ---
  if (x.rsi !== null && x.rsi < 40) {
    let earned = 0
    const checks: boolean[] = []
    checks.push(x.rsi <= 38); if (checks[0]) earned++
    checks.push(x.changePct !== null && x.changePct > 0); if (checks[1]) earned++
    checks.push(x.macdHist !== null && x.macdHist > 0); if (checks[2]) earned++
    checks.push(x.relVol !== null && x.relVol >= 1.0); if (checks[3]) earned++
    fits.push({ tag: "reversal", earned, total: checks.length })
  }

  return fits.filter((f) => f.earned >= Math.ceil(f.total / 2))
}

// ---------------------------------------------------------------------------
// Entry point 1 — light close-based engine (whole-market screen).
// ---------------------------------------------------------------------------

/** Minimal bar the light engine needs: one row per session, ascending.
 *  OPTIONAL real OHLC (2026-11-14 ablation extension): the ADX and
 *  candlestick evidence modules consume open/high/low when present; close-only
 *  rows remain fully valid — those modules abstain silently. */
export interface CloseRow {
  ts: string
  close: number
  volume: number | null
  open?: number
  high?: number
  low?: number
}

export interface CloseSignalOutput extends TechStance {
  sessions: number
  lastClose: number | null
  asOf: string | null
  changePct: number | null
  metrics: {
    rsi14: number | null
    ema20: number | null
    ema50: number | null
    macdLine: number | null
    macdHist: number | null
    relVol: number | null
    perfW1: number | null
    perfM1: number | null
    perfM3: number | null
    rangePos60: number | null
    dailyVolPct: number | null
    obvSlope20: number | null
  }
}

/** Per-session facts carried on a trail read (reason building + style fits). */
export interface ReadFacts {
  rsi14: number | null
  ema20: number | null
  ema50: number | null
  macdLine: number | null
  macdHist: number | null
  relVol: number | null
  obvSlope20: number | null
  rangePos60: number | null
  dailyVolPct: number | null
  volExpansionRatio: number | null
  extPct: number | null
  trendShare: number | null
  ema20SlopeUp: boolean
  lowerHighs: boolean | null
  gates: GateFlags
}

/** One raw (pre-hysteresis) read of a session — strictly prefix-only data. */
export interface TrailRead {
  ts: string
  /** decision after all @5 gates, before the enter/exit bands + min-hold */
  signal: TechSignalType | null
  /** compressed score before glide-limiting */
  score: number | null
  changePct: number | null
  /** genuine structural event (|1-session move| ≥ 3%) — bypasses hysteresis */
  structural: boolean
  dims: SignalDim[]
  facts?: ReadFacts | null
}

export interface HysteresisResult {
  signal: TechSignalType | null
  score: number | null
  /** the printed label is held by the enter/exit bands or the min-hold */
  heldByHysteresis: boolean
  /** the displayed score was glide-limited (no structural driver) */
  glideApplied: boolean
}

/**
 * Hysteresis state machine (audit E). Walks the trailing reads with:
 *  • asymmetric enter/exit bands — a BUY keeps printing while the score stays
 *    ≥ 55 even when the raw read is hold; a SELL keeps printing while ≤ 42;
 *  • a 2-session minimum state hold — a non-structural flip is suppressed
 *    until the current state has held 2 sessions;
 *  • a structural bypass — |1-session move| ≥ 3% transitions immediately.
 * The oldest visible read is assumed to continue an older state (holdCount
 * initialized at the minimum) — the documented boundary of the reconstruction.
 */
export function applyHysteresis(reads: TrailRead[]): HysteresisResult {
  if (!reads.length) return { signal: null, score: null, heldByHysteresis: false, glideApplied: false }
  const last = reads[reads.length - 1]
  if (last.score === null) return { signal: null, score: null, heldByHysteresis: false, glideApplied: false }

  // displayed-score glide chain (± SCORE_STEP_LIMIT per session unless structural)
  const damped: (number | null)[] = []
  for (let k = 0; k < reads.length; k++) {
    const s = reads[k].score
    const prev = k > 0 ? damped[k - 1] : null
    if (s === null) damped.push(null)
    else if (prev === null || reads[k].structural) damped.push(s)
    else damped.push(Math.max(prev - SCORE_STEP_LIMIT, Math.min(prev + SCORE_STEP_LIMIT, s)))
  }

  // state walk
  let initIdx = reads.findIndex((r) => r.signal !== null)
  if (initIdx === -1) initIdx = reads.length - 1
  let state: TechSignalType = reads[initIdx].signal ?? "hold"
  let holdCount = MIN_STATE_HOLD
  for (let k = initIdx + 1; k < reads.length; k++) {
    const r = reads[k]
    let candidate: TechSignalType | null = r.signal
    if ((candidate === "hold" || candidate === null) && r.score !== null) {
      // exit-band hold: the label persists while the score is inside the band
      if (state === "buy" && r.score >= BUY_EXIT_SCORE) candidate = "buy"
      else if (state === "sell" && r.score <= SELL_EXIT_SCORE) candidate = "sell"
    }
    if (candidate === null) candidate = state
    if (candidate === state) {
      holdCount++
      continue
    }
    if (r.structural || holdCount >= MIN_STATE_HOLD) {
      state = candidate
      holdCount = 1
    } else {
      holdCount++ // flip suppressed by the minimum state hold
    }
  }
  const rawLast = last.signal ?? "hold"
  return {
    signal: state,
    score: damped[damped.length - 1],
    heldByHysteresis: state !== rawLast,
    glideApplied: (damped[damped.length - 1] ?? 0) !== (last.score ?? 0),
  }
}

// ---- series context + per-session helpers (strictly prefix-only) ------------

interface SeriesCtx {
  rows: CloseRow[]
  closes: number[]
  e20: (number | null)[]
  e50: (number | null)[]
  /** consecutive rising EMA20 steps ending at i (0 when not rising) */
  e20Streak: number[]
  rsiS: (number | null)[]
  macdL: (number | null)[]
  macdH: (number | null)[]
}

function buildSeriesCtx(rows: CloseRow[]): SeriesCtx {
  const closes = rows.map((r) => r.close)
  const e20 = emaSeries(closes, 20)
  const e50 = emaSeries(closes, 50)
  const e20Streak: number[] = new Array(closes.length).fill(0)
  for (let i = 1; i < closes.length; i++) {
    const a = e20[i - 1]
    const b = e20[i]
    e20Streak[i] = a !== null && b !== null && b > a ? e20Streak[i - 1] + 1 : 0
  }
  const rsiS = rsiSeries(closes, 14)
  const m = macdSeries(closes)
  return { rows, closes, e20, e50, e20Streak, rsiS, macdL: m.line, macdH: m.histogram }
}

/** Per-index relVol: last volume-complete row ≤ i vs the mean of the prior ≤20. */
function relVolAt(rows: CloseRow[], i: number): number | null {
  const idxs: number[] = []
  for (let j = i; j >= 0 && idxs.length < 21; j--) {
    const v = rows[j].volume
    if (v !== null && v > 0) idxs.push(j)
  }
  if (idxs.length < 11) return null
  const prior = idxs.slice(1, 21)
  let sum = 0
  for (const j of prior) sum += rows[j].volume as number
  const mean = sum / prior.length
  if (!(mean > 0)) return null
  return (rows[idxs[0]].volume as number) / mean
}

/** Per-index OBV slope proxy: last 21 volume-complete rows ≤ i, second half
 *  minus first half net up-volume. NOTE (disclosed limitation): zero-volume
 *  sessions are skipped, so on illiquid names the window can span more
 *  calendar days than 21 sessions — the stance discloses this. */
function obvSlopeAt(rows: CloseRow[], i: number): number | null {
  const idxs: number[] = []
  for (let j = i; j >= 0 && idxs.length < 21; j--) {
    const v = rows[j].volume
    if (v !== null && v > 0) idxs.push(j)
  }
  if (idxs.length < 21) return null
  idxs.reverse()
  const seg = idxs.map((j) => rows[j])
  const obvOf = (from: number, to: number): number => {
    let o = 0
    for (let k = Math.max(1, from); k <= to; k++) {
      o += seg[k].close > seg[k - 1].close ? seg[k].volume as number : seg[k].close < seg[k - 1].close ? -(seg[k].volume as number) : 0
    }
    return o
  }
  const half = Math.floor(seg.length / 2)
  return obvOf(1, seg.length - 1) - obvOf(1, half)
}

function dailyVolPctAt(closes: number[], i: number): number | null {
  if (i < 20) return null
  const moves: number[] = []
  for (let j = i - 19; j <= i; j++) {
    if (closes[j - 1] > 0) moves.push(((closes[j] - closes[j - 1]) / closes[j - 1]) * 100)
  }
  if (!moves.length) return null
  const mean = moves.reduce((s, m) => s + m, 0) / moves.length
  const variance = moves.reduce((s, m) => s + (m - mean) ** 2, 0) / moves.length
  return Math.sqrt(variance)
}

/** σ(recent 10 close-to-close moves) ÷ σ(prior 10) — the volatility-expansion
 *  input; null when either window is degenerate (all-flat). */
function expansionRatioAt(closes: number[], i: number): number | null {
  if (i < 20) return null
  const std = (from: number, to: number): number | null => {
    const moves: number[] = []
    for (let j = from; j <= to; j++) {
      if (closes[j - 1] > 0) moves.push(((closes[j] - closes[j - 1]) / closes[j - 1]) * 100)
    }
    if (!moves.length) return null
    const mean = moves.reduce((s, m) => s + m, 0) / moves.length
    const variance = moves.reduce((s, m) => s + (m - mean) ** 2, 0) / moves.length
    return Math.sqrt(variance)
  }
  const prior = std(i - 19, i - 10)
  const recent = std(i - 9, i)
  if (prior === null || recent === null || !(prior > 0)) return null
  return recent / prior
}

function rangePosAt(closes: number[], i: number): number | null {
  const start = Math.max(0, i - 59)
  const win = closes.slice(start, i + 1)
  if (win.length < 20) return null
  const hi = Math.max(...win)
  const lo = Math.min(...win)
  if (!(hi > lo)) return 50
  return ((win[win.length - 1] - lo) / (hi - lo)) * 100
}

/** Lower-high structure over the last ~120 sessions (close pivots, wing 5,
 *  equal extremes count as touches — mirrors the S/R fix). */
function lowerHighsAt(closes: number[], i: number): boolean | null {
  const start = Math.max(0, i - 119)
  const win = closes.slice(start, i + 1)
  if (win.length < 11) return null
  const w = 5
  const highs: number[] = []
  for (let k = w; k < win.length - w; k++) {
    let isHigh = true
    for (let j = k - w; j <= k + w; j++) {
      if (j === k) continue
      if (win[j] > win[k]) { isHigh = false; break }
    }
    if (isHigh) highs.push(win[k])
  }
  if (highs.length < 2) return null
  return highs[highs.length - 1] < highs[highs.length - 2]
}

/** Pivot-cluster levels from close-only flat bars (same algorithm the trade
 *  plan uses) — the structure-veto input on the close engine. */
function levelsAt(closes: number[], i: number): { supports: PriceZone[]; resistances: PriceZone[] } {
  const start = Math.max(0, i - 119)
  const win = closes.slice(start, i + 1)
  if (win.length < 11) return { supports: [], resistances: [] }
  const bars: Bar[] = win.map((c, k) => ({
    ts: new Date(Date.UTC(2020, 0, 1 + k)).toISOString().slice(0, 10),
    open: c, high: c, low: c, close: c, volume: null,
  }))
  return supportResistance(bars, 5, 1.5, 4)
}

/** Nearest multi-touch resistance within `pctPct`% above the close. */
function resistanceZoneNear(zones: PriceZone[], close: number): { price: number; touches: number } | null {
  let best: { price: number; touches: number } | null = null
  for (const z of zones) {
    if (z.price <= close) continue
    if (((z.price - close) / close) * 100 > RESISTANCE_VETO_PCT) continue
    if (best === null || z.price < best.price) best = { price: z.price, touches: z.touches }
  }
  return best
}

/** Nearest multi-touch support within `pctPct`% below the close. */
function supportZoneNear(zones: PriceZone[], close: number): { price: number; touches: number } | null {
  let best: { price: number; touches: number } | null = null
  for (const z of zones) {
    if (z.price >= close) continue
    if (((close - z.price) / close) * 100 > SUPPORT_VETO_PCT) continue
    if (best === null || z.price > best.price) best = { price: z.price, touches: z.touches }
  }
  return best
}

/**
 * One raw read at session i: per-dimension evidence (de-duplicated @5 scale),
 * score finalization, decision gates, structure veto. Strictly prefix-only.
 */
function scoreReadAt(ctx: SeriesCtx, i: number): TrailRead {
  const rows = ctx.rows
  const closes = ctx.closes
  const close = closes[i]
  const e20 = ctx.e20[i]
  const e50 = ctx.e50[i]
  const rsiV = ctx.rsiS[i]
  const macdLine = ctx.macdL[i]
  const macdHist = ctx.macdH[i]
  const prevClose = i > 0 ? closes[i - 1] : null
  const changePct = prevClose !== null && prevClose > 0 ? ((close - prevClose) / prevClose) * 100 : null
  const relVol = relVolAt(rows, i)
  const obvSlope = obvSlopeAt(rows, i)
  const rangePos = rangePosAt(closes, i)
  const dailyVol = dailyVolPctAt(closes, i)
  const expansion = expansionRatioAt(closes, i)

  // ---------- TREND — ONE state input on a fixed 0-30 scale (audit B).
  // The EMA stack is classified as a state, not stacked as 4 independent
  // facts. Availability affects the STATE, not the scale; a trend read
  // without the mid lens (EMA50) is capped at 21/30 — never decision-grade.
  let trendEarned = 0
  let trendMax = 0
  if (e20 !== null) {
    trendMax = 30
    const facts: boolean[] = [close > e20]
    if (e50 !== null) facts.push(close > e50)
    if (e20 !== null && e50 !== null) facts.push(e20 > e50)
    facts.push((ctx.e20Streak[i] ?? 0) >= 3)
    const bull = facts.filter(Boolean).length
    const share = bull / facts.length
    trendEarned = share >= 1 ? 30 : share >= 0.75 ? 24 : share >= 0.5 ? 15 : share >= 0.25 ? 7 : share > 0 ? 3 : 0
    if (e50 === null) trendEarned = Math.min(trendEarned, 21)
  }
  const trendShare = trendMax > 0 ? trendEarned / trendMax : null

  // ---------- MOMENTUM — oscillator GROUP with a corroboration cap (audit B).
  // Max = 25 (aligned with weight). Components: RSI 8, MACD 8, RangePos 9.
  let momEarned = 0
  let momMax = 0
  if (rsiV !== null) { momMax += 8; momEarned += Math.round(rsiBandPoints(rsiV) * 0.8) }
  if (macdLine !== null && macdHist !== null) { momMax += 8; momEarned += Math.round(macdPoints(macdLine, macdHist) * 0.8) }
  if (rangePos !== null) { momMax += 9; momEarned += Math.round(rangePosPoints(rangePos) * 0.9) }
  if (momMax > 0) momEarned = Math.min(momEarned, Math.round(MOMENTUM_GROUP_STRONG_SHARE * momMax))

  // ---------- VOLUME (participation is a required buy confirmation) ----------
  // Max = 25 (aligned with weight). Components: OBV 12, RelVol 13.
  let volEarned = 0
  let volMax = 0
  if (obvSlope !== null) { volMax += 12; if (obvSlope > 0) volEarned += 10 }
  if (relVol !== null && changePct !== null) { volMax += 13; volEarned += Math.round(relVolBandPoints(relVol, changePct > 0) * 1.3) }

  // ---------- RISK — ONLY risk facts (audit B): two-sided extension,
  // volatility regime, volatility expansion. No trend agreement.
  let riskEarned = 0
  let riskMax = 0
  let extPct: number | null = null
  if (e20 !== null && e20 > 0) {
    riskMax += 8
    extPct = ((close - e20) / e20) * 100
    riskEarned += extensionRiskPoints(extPct)
  }
  if (dailyVol !== null) { riskMax += 7; riskEarned += dailyVolPoints(dailyVol) }
  if (expansion !== null) { riskMax += 5; riskEarned += expansionPoints(expansion) }

  const dims: SignalDim[] = [
    { key: "trend" as const, earned: trendEarned, max: trendMax },
    { key: "momentum" as const, earned: momEarned, max: momMax },
    { key: "volume" as const, earned: volEarned, max: volMax },
    { key: "risk" as const, earned: riskEarned, max: riskMax },
  ]
  const { rawPct, allDimsStrong, volumeKnown, riskKnown } = rawWeightedPct(dims)
  const final = rawPct !== null && trendMax > 0
    ? finalizeScore(rawPct, { volumeKnown, riskKnown, allDimsStrong, relVol: relVol })
    : null

  const levels = (final !== null && trendShare !== null && (final >= BUY_SCORE || final < SELL_DISTRIBUTION_SCORE))
    ? levelsAt(closes, i)
    : { supports: [] as PriceZone[], resistances: [] as PriceZone[] }
  const { signal, gates } = decideSignal({
    finalScore: final,
    trendShare,
    rsi: rsiV,
    macdLine,
    macdHist,
    relVol,
    obvSlope,
    allDimsStrong,
    lowerHighs: lowerHighsAt(closes, i),
    belowLongMa: e50 !== null && close < e50,
    close,
    prevClose,
    resistanceZone: resistanceZoneNear(levels.resistances, close),
    supportZone: supportZoneNear(levels.supports, close),
  })

  return {
    ts: rows[i].ts,
    signal: final === null ? null : signal,
    score: final,
    changePct,
    structural: changePct !== null && Math.abs(changePct) >= STRUCTURAL_MOVE_PCT,
    dims,
    facts: {
      rsi14: rsiV, ema20: e20, ema50: e50, macdLine, macdHist,
      relVol, obvSlope20: obvSlope, rangePos60: rangePos,
      dailyVolPct: dailyVol, volExpansionRatio: expansion, extPct,
      trendShare, ema20SlopeUp: (ctx.e20Streak[i] ?? 0) >= 3,
      lowerHighs: lowerHighsAt(closes, i),
      gates,
    },
  }
}

/** Reconstruct the trailing raw reads (prefix-only) for the hysteresis walk. */
function trailReads(ctx: SeriesCtx, depth: number): TrailRead[] {
  const n = ctx.closes.length
  const start = Math.max(0, n - depth)
  const out: TrailRead[] = []
  for (let i = start; i < n; i++) out.push(scoreReadAt(ctx, i))
  return out
}

/**
 * Trailing raw reads over a close-row series — the shared scoring core used
 * by BOTH the board engine and (via assembleBundle) the snapshot path, so the
 * board and the company tab print the SAME reading on the same data.
 */
export function computeSignalTrail(rows: CloseRow[], k = TRAIL_DEPTH): TrailRead[] {
  if (rows.length < WEAK_SESSIONS) return []
  return trailReads(buildSeriesCtx(rows), k)
}

/** Median calendar gap between sessions in days (sparse detection). */
function medianGap(rows: CloseRow[]): number {
  const gaps: number[] = []
  for (let i = 1; i < rows.length; i++) {
    const a = new Date(rows[i - 1].ts + "T00:00:00Z").getTime()
    const b = new Date(rows[i].ts + "T00:00:00Z").getTime()
    gaps.push((b - a) / 86_400_000)
  }
  gaps.sort((x, y) => x - y)
  return gaps.length ? gaps[Math.floor(gaps.length / 2)] : 0
}

// ---- whole-series helpers (v1 baseline + metrics presentation) --------------

function obvSlope(rows: CloseRow[], n = 20): number | null {
  const win = rows.filter((r) => r.volume !== null && r.volume > 0)
  if (win.length < n) return null
  const seg = win.slice(-n - 1)
  let obv = 0
  for (let i = 1; i < seg.length; i++) {
    obv += seg[i].close > seg[i - 1].close ? seg[i].volume as number : seg[i].close < seg[i - 1].close ? -(seg[i].volume as number) : 0
  }
  const half = Math.floor(seg.length / 2)
  let obvFirst = 0
  for (let i = 1; i <= half; i++) {
    obvFirst += seg[i].close > seg[i - 1].close ? seg[i].volume as number : seg[i].close < seg[i - 1].close ? -(seg[i].volume as number) : 0
  }
  return obv - obvFirst
}

function relVol(rows: CloseRow[]): number | null {
  const withVol = rows.filter((r) => r.volume !== null && r.volume > 0)
  if (withVol.length < 11) return null
  const last = withVol[withVol.length - 1]
  const prior = withVol.slice(-21, -1)
  const mean = prior.reduce((s, r) => s + (r.volume as number), 0) / prior.length
  if (!(mean > 0)) return null
  return (last.volume as number) / mean
}

function dailyVolPct(closes: number[]): number | null {
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

function rangePos(closes: number[], n = 60): number | null {
  const win = closes.slice(-n)
  if (win.length < 20) return null
  const hi = Math.max(...win)
  const lo = Math.min(...win)
  if (!(hi > lo)) return 50
  return ((win[win.length - 1] - lo) / (hi - lo)) * 100
}

// ---------------------------------------------------------------------------
// Ablation evidence plumbing (2026-11-14) — module reads → capped score delta
// + appended evidence reasons. The ONLY code that consumes the ablation
// modules; every @5 gate/weight/veto/hysteresis rule above is untouched.
// ---------------------------------------------------------------------------

interface EvidenceAppendix {
  /** clamped to ±EVIDENCE_DELTA_CAP_TOTAL; 0 ⇒ the walk is not re-run */
  totalDelta: number
  reasons: SignalReason[]
}

function adxEvidenceReason(adx: AdxResult): SignalReason | null {
  if (adx.abstained || adx.trendStrength === "none" || adx.direction === "none" || adx.adx === null) return null
  const v = Math.round(adx.adx)
  const strong = adx.trendStrength === "strong"
  if (adx.direction === "up") return strong
    ? { code: "adx_strong_up", tone: "positive", ar: `ADX عند ${v} مع سيطرة DI+ — اتجاه صاعد قوي يدعم قراءة الشراء.`, en: `ADX at ${v} with DI+ dominant — a strong uptrend supporting the buy read.` }
    : { code: "adx_weak_up", tone: "positive", ar: `ADX عند ${v} مع ميول DI+ — اتجاه صاعد ضعيف، دليل داعم بحذر.`, en: `ADX at ${v} with a DI+ lean — a weak uptrend, supporting evidence taken cautiously.` }
  return strong
    ? { code: "adx_strong_down", tone: "negative", ar: `ADX عند ${v} مع سيطرة DI− — اتجاه هابط قوي يضغط على القراءة الصاعدة.`, en: `ADX at ${v} with DI− dominant — a strong downtrend weighing on the buy read.` }
    : { code: "adx_weak_down", tone: "negative", ar: `ADX عند ${v} مع ميول DI− — اتجاه هابط ضعيف.`, en: `ADX at ${v} with a DI− lean — a weak downtrend.` }
}

function divEvidenceReason(d: DivergenceSignal): SignalReason {
  const s = Math.round(d.strength * 100) / 100
  const basisAr = d.basis === "rsi" ? "مؤشر القوة النسبية RSI" : "هيستوجرام MACD"
  return d.kind === "bullish"
    ? { code: "divergence_bullish", tone: "positive", ar: `دايفرجنس صاعد مؤكد على ${basisAr} — قاع سعري أدنى مع زخم أعلى (قوة ${s}).`, en: `Confirmed bullish divergence on ${d.basis.toUpperCase()} — a lower price low with a higher momentum low (strength ${s}).` }
    : { code: "divergence_bearish", tone: "negative", ar: `دايفرجنس هابط مؤكد على ${basisAr} — قمة سعرية أعلى مع زخم أضعف (قوة ${s}).`, en: `Confirmed bearish divergence on ${d.basis.toUpperCase()} — a higher price high with a weaker momentum high (strength ${s}).` }
}

function candleEvidenceReason(read: CandlePatternRead): SignalReason {
  const s = Math.round(read.strength * 100) / 100
  const tone = read.tone === "bullish" ? "positive" as const : read.tone === "bearish" ? "negative" as const : "neutral" as const
  return {
    code: `candle_${read.pattern}`,
    tone,
    ar: `${read.contextAr} (قوة ${s})`,
    en: `Candlestick pattern "${read.pattern}" (${read.tone}, strength ${s}) on the last session.`,
  }
}

/** One module's evidence → its capped score delta (±EVIDENCE_DELTA_CAP_PER_MODULE). */
function computeEvidenceAppendix(rows: CloseRow[], variant: TechEngineVariant): EvidenceAppendix {
  const cap = EVIDENCE_DELTA_CAP_PER_MODULE
  const clamp4 = (d: number): number => Math.max(-cap, Math.min(cap, d))
  let total = 0
  const reasons: SignalReason[] = []
  const useAdx = variant === "tech-signals@5+adx" || variant === "tech-signals@5+all"
  const useDiv = variant === "tech-signals@5+div" || variant === "tech-signals@5+all"
  const useCandles = variant === "tech-signals@5+candles" || variant === "tech-signals@5+all"

  if (useAdx) {
    // OHLC-absent ⇒ the module abstains silently (close-only replay unchanged)
    const bars = rows.map((r) => ({ high: typeof r.high === "number" ? r.high : NaN, low: typeof r.low === "number" ? r.low : NaN, close: r.close }))
    const adx = computeAdx(bars)
    if (!adx.abstained && adx.trendStrength !== "none" && adx.direction !== "none") {
      const mag = adx.trendStrength === "strong" ? cap : 2
      const d = clamp4(adx.direction === "up" ? mag : -mag)
      total += d
      if (d !== 0) {
        const r = adxEvidenceReason(adx)
        if (r) reasons.push(r)
      }
    }
  }

  if (useDiv) {
    const div = detectDivergence(rows)
    const bullDelta = div.bullish ? clamp4(Math.round(cap * div.bullish.strength)) : 0
    const bearDelta = div.bearish ? -clamp4(Math.round(cap * div.bearish.strength)) : 0
    total += bullDelta + bearDelta
    // contradictory evidence cancels (documented) — no reason is printed
    if (bullDelta !== 0 && bearDelta !== 0) {
      // net zero, silent
    } else if (bullDelta > 0 && div.bullish) {
      reasons.push(divEvidenceReason(div.bullish))
    } else if (bearDelta < 0 && div.bearish) {
      reasons.push(divEvidenceReason(div.bearish))
    }
  }

  if (useCandles) {
    const candle = readLastCandle(rows)
    if (candle.available && candle.read) {
      const read = candle.read
      const signed = read.tone === "bullish" ? 1 : read.tone === "bearish" ? -1 : 0
      const d = signed === 0 ? 0 : clamp4(signed * Math.round(cap * read.strength))
      total += d
      if (d !== 0 || read.tone === "neutral") reasons.push(candleEvidenceReason(read))
    }
  }

  return { totalDelta: Math.max(-EVIDENCE_DELTA_CAP_TOTAL, Math.min(EVIDENCE_DELTA_CAP_TOTAL, total)), reasons }
}

/** Re-decide the LAST trail read under the SAME @5 rules with an
 *  evidence-adjusted score. Every non-score gate input is IDENTICAL to the
 *  base read (trend share, oscillators, volume agreement, excellence, vetoes)
 *  — evidence alone can never create a directional read. */
function redecideLastReadWithEvidence(ctx: SeriesCtx, i: number, read: TrailRead, adjustedScore: number): TrailRead {
  const f = read.facts
  if (!f) return read
  const close = ctx.closes[i]
  const e50 = ctx.e50[i]
  const prevClose = i > 0 ? ctx.closes[i - 1] : null
  const levels = (adjustedScore >= BUY_SCORE || adjustedScore < SELL_DISTRIBUTION_SCORE)
    ? levelsAt(ctx.closes, i)
    : { supports: [] as PriceZone[], resistances: [] as PriceZone[] }
  const { signal, gates } = decideSignal({
    finalScore: adjustedScore,
    trendShare: f.trendShare,
    rsi: f.rsi14,
    macdLine: f.macdLine,
    macdHist: f.macdHist,
    relVol: f.relVol,
    obvSlope: f.obvSlope20,
    allDimsStrong: f.gates.allDimsStrong,
    lowerHighs: f.lowerHighs,
    belowLongMa: e50 !== null && close < e50,
    close,
    prevClose,
    resistanceZone: resistanceZoneNear(levels.resistances, close),
    supportZone: supportZoneNear(levels.supports, close),
  })
  return { ...read, signal, score: adjustedScore, facts: { ...f, gates } }
}

/**
 * Deterministic light signal over close-only day-rows (ascending).
 * Missing history → null score with disclosed limitations — never a fake read.
 * opts.engineVersion: "tech-signals@5" (default, current methodology),
 * "tech-signals@4" (v1 baseline for A/B backtesting on identical bars), or one
 * of the TECH_ENGINE_VARIANTS (base @5 + a capped additive evidence layer —
 * see the ablation header and docs/notes/backtest-ablation.md).
 */
export function computeCloseSignal(rows: CloseRow[], opts: { engineVersion?: EngineVersionOption } = {}): CloseSignalOutput {
  if (opts.engineVersion === SIGNALS_VERSION_V1_BASELINE) return computeCloseSignalV1(rows)
  const limitations: string[] = []
  const sessions = rows.length
  const asOf = sessions ? rows[sessions - 1].ts : null
  const lastClose = sessions ? rows[sessions - 1].close : null
  const closes = rows.map((r) => r.close)
  const changePct = closes.length >= 2 && closes[closes.length - 2] > 0
    ? ((closes[closes.length - 1] - closes[closes.length - 2]) / closes[closes.length - 2]) * 100
    : null

  if (sessions < WEAK_SESSIONS) {
    limitations.push(`Only ${sessions} sessions available — a rule-based stance needs at least ${WEAK_SESSIONS}.`)
    return emptyStance({ sessions, lastClose, asOf, changePct }, limitations)
  }

  const ctx = buildSeriesCtx(rows)
  const reads = trailReads(ctx, TRAIL_DEPTH)
  const walk0 = applyHysteresis(reads)
  // ---- ablation variants (additive evidence layer — header block above) ----
  const variant = opts.engineVersion && opts.engineVersion !== SIGNALS_VERSION ? (opts.engineVersion as TechEngineVariant) : null
  let walk = walk0
  let evidence: EvidenceAppendix | null = null
  if (variant) {
    evidence = computeEvidenceAppendix(rows, variant)
    if (evidence.totalDelta !== 0) {
      const li = reads.length - 1
      const lr = reads[li]
      if (lr.score !== null && lr.facts) {
        // redecideLastReadWithEvidence indexes the SESSION (ctx.closes[i],
        // levelsAt(ctx.closes, i)) — NOT the trail. reads[li] covers session
        // (closes.length − reads.length) + li, which for the last trail read
        // is always the FINAL session; passing the trail index re-decided the
        // verdict on a mid-history day.
        reads[li] = redecideLastReadWithEvidence(ctx, ctx.closes.length - 1, lr, Math.max(0, Math.min(100, lr.score + evidence.totalDelta)))
        walk = applyHysteresis(reads)
      }
    }
  }
  const last = reads[reads.length - 1]
  const f = last.facts!
  const g = f.gates
  const score = walk.score
  const signal = walk.signal

  if (sessions < MIN_SESSIONS) limitations.push(`A full-score stance needs ${MIN_SESSIONS} sessions — dimensions with insufficient history are excluded and missing evidence caps the score (no volume evidence → 70, no risk evidence → 75).`)
  if (sessions < 50) limitations.push("EMA50 and slower structure checks are excluded below 50 sessions — the trend state is capped below decision strength.")
  if (f.relVol === null) limitations.push("Volume history is too thin — volume checks are excluded and a buy read is structurally unreachable (missing-evidence cap 70).")
  if (medianGap(rows) > 7) limitations.push("Sessions are sparse (not daily) — oscillator readings are approximate.")
  {
    // zero-volume-skip disclosure (audit: obvSlope/relVol skip zero-volume days
    // so windows silently span months on illiquid names — disclose, not hide)
    const zeroVol = rows.slice(-60).filter((r) => r.volume === null || r.volume <= 0).length
    if (zeroVol > 0 && (f.relVol !== null || f.obvSlope20 !== null)) {
      limitations.push(`${zeroVol} of the trailing sessions carry no usable volume — volume windows skip them and can span more calendar days than their session count (illiquid names).`)
    }
  }
  if (walk.glideApplied) limitations.push(`The displayed score is glide-limited to ±${SCORE_STEP_LIMIT} points per session — a larger one-session evidence shift without a structural driver (|move| ≥ ${STRUCTURAL_MOVE_PCT}%) is spread across sessions.`)
  if (walk.heldByHysteresis) limitations.push(`The label is held by hysteresis (enter/exit bands + ${MIN_STATE_HOLD}-session minimum hold) — the read persists through marginal sessions and reacts up to ~${MIN_STATE_HOLD} sessions slower at turning points.`)

  // ---------- reasons: gate/veto outcomes FIRST, then evidence ----------
  const reasons: SignalReason[] = []
  const push = (r: SignalReason) => { if (reasons.length < 5 && !reasons.some((x) => x.code === r.code)) reasons.push(r) }
  if (g.buyCandidate && !g.volumeAgreement) push(reason("weakVolumeNoBuy"))
  else if (g.buyCandidate && !g.allDimsStrong) push(reason("notFullStrength"))
  if (g.buyCandidate && g.vetoResistance) push(reason("nearResistanceVeto"))
  else if (g.buyCandidate && g.breakoutConfirmed) push(reason("breakoutConfirmed"))
  if (g.sellCandidate && g.vetoSupport) push(reason("atSupportVeto"))
  if (signal === "sell" && g.distributionSell) push(reason("distributionSell"))

  const upStack = f.ema20 !== null && lastClose !== null && lastClose > f.ema20 && (f.ema50 === null || f.ema20 > f.ema50)
  const downStack = f.ema20 !== null && lastClose !== null && lastClose < f.ema20 && (f.ema50 === null || f.ema20 < f.ema50)
  if (upStack && f.ema50 !== null) push(reason("fullAlignmentUp"))
  else if (upStack) push(reason("aboveSma20"))
  else if (downStack && f.ema50 !== null) push(reason("fullAlignmentDown"))
  else if (downStack) push(reason("belowSma20"))
  if (f.ema20SlopeUp) push(reason("sma20SlopeUp"))
  else if (f.ema20 !== null) push(reason("sma20SlopeDown"))
  if (f.macdLine !== null && f.macdHist !== null) {
    if (f.macdLine > 0 && f.macdHist > 0) push(reason("macdBullish"))
    else if (f.macdLine < 0 && f.macdHist < 0) push(reason("macdBearish"))
    else if (f.macdHist > 0) push(reason("macdBullCross"))
    else push(reason("macdBearCross"))
  }
  if (f.rsi14 !== null) {
    if (f.rsi14 > 70) push(reason("rsiOverbought"))
    else if (f.rsi14 < 30) push(reason("rsiOversold"))
    else if (f.rsi14 >= 45 && f.rsi14 <= 60 && signal === "buy") push(reason("rsiNeutralUp"))
  }
  if (f.obvSlope20 !== null) push(f.obvSlope20 > 0 ? reason("obvUp") : reason("obvDown"))
  if (f.relVol !== null && changePct !== null) {
    if (f.relVol > 3) push(reason("volumeChase"))
    else if (f.relVol >= 1.0 && f.relVol <= 3.0 && changePct > 0) push(reason("volumeConfirmUp"))
  }
  if (f.extPct !== null) {
    if (f.extPct > 8) push(reason("extended"))
    else if (f.extPct <= 4 && signal === "buy") push(reason("notExtended"))
  }
  if (f.volExpansionRatio !== null && f.volExpansionRatio > 2) push(reason("volExpanding"))
  if (f.rangePos60 !== null && f.rangePos60 > 90) push(reason("atRangeTop"))
  if (f.rsi14 !== null && f.rsi14 < 38 && changePct !== null && changePct > 0) push(reason("oversoldBounce"))

  // ---------- ablation-variant evidence reasons (APPENDED after the base
  // reasons, never replacing them; evidence never alters a base reason) ----------
  if (evidence) for (const r of evidence.reasons) if (!reasons.some((x) => x.code === r.code)) reasons.push(r)

  // ---------- style fits (day style DISABLED — daily closes, fix H) ----------
  const styleFits = computeStyleFits({
    signal, changePct, rsi: f.rsi14, ema20: f.ema20, ema50: f.ema50,
    lastClose, macdHist: f.macdHist, relVol: f.relVol, obvSlope20: f.obvSlope20,
    rangePos60: f.rangePos60, dailyVolPct: f.dailyVolPct, ema20SlopeUp: f.ema20SlopeUp,
    volumePresent: f.relVol !== null,
  }, false)

  // ---------- NO trade plan from close-only engine (C-01 remediation) ----------
  // The close-only engine provides directional reads ONLY. Executable trade
  // plans require OHLC-based structural levels (support/resistance/zones) and
  // real ATR. The canonical stance overlay (signals-service.ts) supplies the
  // OHLC-derived plan for companies with a persisted snapshot. Non-canonical
  // rows get tradePlan = null and signalState = "wait" or "watching" without
  // fabricated levels — honest disclosure that a validated plan is unavailable.
  const tradePlan = null

  // ---------- three-state publication layer (header fix J — additive) ----------
  const { state, direction, vetoReasons } = deriveSignalState(signal, g, tradePlan !== null)
  let setup: WatchingSetup | null = null
  if (state === "watching" && direction !== null && lastClose !== null) {
    const levels = levelsAt(closes, sessions - 1)
    const vetoZone = direction === "buy"
      ? resistanceZoneNear(levels.resistances, lastClose)
      : supportZoneNear(levels.supports, lastClose)
    const closeWindow = closes.slice(-20)
    setup = buildWatchingSetup({
      direction,
      lastClose,
      structuralVeto: vetoReasons.some((r) => r.code === "near_resistance_veto" || r.code === "at_support_veto"),
      vetoLevel: vetoZone?.price ?? null,
      vetoTouches: vetoZone?.touches ?? null,
      vetoBand: null,
      vetoReasons,
      closes,
      supports: levels.supports.map((z) => ({ price: z.price })),
      resistances: levels.resistances.map((z) => ({ price: z.price })),
      zones: null,
      atrPct: null,
      volPct: f.dailyVolPct,
      extremes: {
        low: closeWindow.length > 0 ? Math.min(...closeWindow) : null,
        lowBasisAr: "أدنى إغلاق في آخر 20 جلسة",
        high: closeWindow.length > 0 ? Math.max(...closeWindow) : null,
        highBasisAr: "أعلى إغلاق في آخر 20 جلسة",
      },
    })
  }

  return {
    version: variant ?? SIGNALS_VERSION,
    score,
    signal,
    dimensions: last.dims,
    reasons,
    styleFits,
    invalidation: null, // close-only engine has no reliable level map — full bundle supplies it
    tradePlan,
    signalState: state,
    setup,
    limitations,
    sessions,
    lastClose,
    asOf,
    changePct,
    metrics: {
      rsi14: f.rsi14 === null ? null : round(f.rsi14, 4),
      ema20: f.ema20 === null ? null : round(f.ema20, 4),
      ema50: f.ema50 === null ? null : round(f.ema50, 4),
      macdLine: f.macdLine === null ? null : round(f.macdLine, 4),
      macdHist: f.macdHist === null ? null : round(f.macdHist, 4),
      relVol: f.relVol === null ? null : round(f.relVol, 4),
      perfW1: perfN(closes, 5),
      perfM1: perfN(closes, 21),
      perfM3: sessions >= 64 ? perfN(closes, 63) : null,
      rangePos60: f.rangePos60,
      dailyVolPct: f.dailyVolPct,
      obvSlope20: f.obvSlope20,
    },
  }
}

function emptyStance(
  base: { sessions: number; lastClose: number | null; asOf: string | null; changePct: number | null },
  limitations: string[]
): CloseSignalOutput {
  return {
    version: SIGNALS_VERSION,
    score: null,
    signal: null,
    dimensions: [],
    reasons: [],
    styleFits: [],
    invalidation: null,
    tradePlan: null,
    signalState: "wait",
    setup: null,
    limitations,
    sessions: base.sessions,
    lastClose: base.lastClose,
    asOf: base.asOf,
    changePct: base.changePct,
    metrics: {
      rsi14: null, ema20: null, ema50: null, macdLine: null, macdHist: null, relVol: null,
      perfW1: null, perfM1: null, perfM3: null, rangePos60: null, dailyVolPct: null, obvSlope20: null,
    },
  }
}

// ---------------------------------------------------------------------------
// v1 BASELINE (tech-signals@4) — preserved verbatim-in-spirit for A/B backtest
// comparison on identical bars. NOT production behavior: no decision gates, no
// structure veto, no hysteresis, mechanical trade plan, old weights.
// ---------------------------------------------------------------------------

function computeCloseSignalV1(rows: CloseRow[]): CloseSignalOutput {
  const limitations: string[] = []
  const sessions = rows.length
  const asOf = sessions ? rows[sessions - 1].ts : null
  const lastClose = sessions ? rows[sessions - 1].close : null
  const closes = rows.map((r) => r.close)
  const changePct = closes.length >= 2 && closes[closes.length - 2] > 0
    ? ((closes[closes.length - 1] - closes[closes.length - 2]) / closes[closes.length - 2]) * 100
    : null
  if (sessions < WEAK_SESSIONS) {
    limitations.push(`Only ${sessions} sessions available — a rule-based stance needs at least ${WEAK_SESSIONS}.`)
    return { ...emptyStance({ sessions, lastClose, asOf, changePct }, limitations), version: SIGNALS_VERSION_V1_BASELINE }
  }

  const m = {
    rsi14: sessions >= 16 ? rsi(closes, 14).value : null,
    ema20: emaSeries(closes, 20)[sessions - 1] ?? null,
    ema50: sessions >= 50 ? emaSeries(closes, 50)[sessions - 1] ?? null : null,
    macdLine: sessions >= 36 ? macd(closes).macd : null,
    macdHist: sessions >= 36 ? macd(closes).histogram : null,
    relVol: relVol(rows),
    perfW1: perfN(closes, 5),
    perfM1: perfN(closes, 21),
    perfM3: sessions >= 64 ? perfN(closes, 63) : null,
    rangePos60: rangePos(closes, 60),
    dailyVolPct: dailyVolPct(closes),
    obvSlope20: obvSlope(rows, 20),
  }
  if (sessions < MIN_SESSIONS) limitations.push(`A full-score stance needs ${MIN_SESSIONS} sessions — dimensions with insufficient history are excluded and missing evidence caps the score (no volume evidence → 70, no risk evidence → 75).`)
  if (sessions < 50) limitations.push("EMA50 and slower structure checks are excluded below 50 sessions.")
  if (m.relVol === null) limitations.push("Volume history is too thin — volume checks are excluded.")
  if (medianGap(rows) > 7) limitations.push("Sessions are sparse (not daily) — oscillator readings are approximate.")

  // v1 TREND — four independently stacked EMA facts (8/7/8/7)
  let trendEarned = 0
  let trendMax = 0
  if (m.ema20 !== null && lastClose !== null) { trendMax += 8; if (lastClose > m.ema20) trendEarned += 8 }
  if (m.ema50 !== null && lastClose !== null) { trendMax += 7; if (lastClose > m.ema50) trendEarned += 7 }
  if (m.ema20 !== null && m.ema50 !== null) { trendMax += 8; if (m.ema20 > m.ema50) trendEarned += 8 }
  const e20series = emaSeries(closes, 20)
  const slopeStreak = risingStreak(e20series)
  let ema20SlopeUp: boolean | null = null
  if (slopeStreak !== null) { trendMax += 7; ema20SlopeUp = slopeStreak >= 3; if (ema20SlopeUp) trendEarned += 7 }

  // v1 MOMENTUM — RSI + MACD + rangePos stack (uncapped)
  let momEarned = 0
  let momMax = 0
  if (m.rsi14 !== null) { momMax += 10; momEarned += rsiBandPoints(m.rsi14) }
  if (m.macdHist !== null && m.macdLine !== null) { momMax += 10; momEarned += macdPoints(m.macdLine, m.macdHist) }
  if (m.rangePos60 !== null) { momMax += 10; momEarned += rangePosPoints(m.rangePos60) }

  // v1 VOLUME
  let volEarned = 0
  let volMax = 0
  if (m.obvSlope20 !== null) { volMax += 10; if (m.obvSlope20 > 0) volEarned += 8 }
  if (m.relVol !== null && changePct !== null) { volMax += 10; volEarned += v1RelVolBandPoints(m.relVol, changePct > 0) }

  // v1 RISK (trend-agreeing extension + daily vol)
  let riskEarned = 0
  let riskMax = 0
  if (m.ema20 !== null && lastClose !== null) {
    riskMax += 8
    riskEarned += v1ExtensionPoints(((lastClose - m.ema20) / m.ema20) * 100)
  }
  if (m.dailyVolPct !== null) { riskMax += 7; riskEarned += dailyVolPoints(m.dailyVolPct) }

  const dims: SignalDim[] = [
    { key: "trend" as const, earned: trendEarned, max: trendMax },
    { key: "momentum" as const, earned: momEarned, max: momMax },
    { key: "volume" as const, earned: volEarned, max: volMax },
    { key: "risk" as const, earned: riskEarned, max: riskMax },
  ]
  const { rawPct, allDimsStrong, volumeKnown, riskKnown } = rawWeightedWith(dims, V1_WEIGHTS)
  const finalScore = rawPct !== null && trendMax > 0
    ? finalizeScore(rawPct, { volumeKnown, riskKnown, allDimsStrong, relVol: m.relVol })
    : null

  const trendShare = trendMax > 0 ? trendEarned / trendMax : null
  let signal: TechSignalType | null = null
  if (finalScore !== null && trendShare !== null) {
    const sellMomentum = m.rsi14 !== null ? m.rsi14 < SELL_RSI_MAX : (m.macdLine ?? 0) < 0
    if (finalScore >= BUY_SCORE && trendShare >= BUY_TREND_SHARE && (m.rsi14 === null || m.rsi14 <= BUY_RSI_MAX)) signal = "buy"
    else if (finalScore < SELL_SCORE && trendShare <= SELL_TREND_SHARE && sellMomentum) signal = "sell"
    else signal = "hold"
  } else {
    limitations.push("Trend checks could not be computed — no stance mapping.")
  }

  const reasons: SignalReason[] = []
  const push = (r: SignalReason) => { if (reasons.length < 4 && !reasons.some((x) => x.code === r.code)) reasons.push(r) }
  const upStack = lastClose !== null && m.ema20 !== null && lastClose > m.ema20 && (m.ema50 === null || m.ema20 > m.ema50)
  const downStack = lastClose !== null && m.ema20 !== null && lastClose < m.ema20 && (m.ema50 === null || m.ema20 < m.ema50)
  if (upStack && m.ema50 !== null) push(reason("fullAlignmentUp"))
  else if (upStack) push(reason("aboveSma20"))
  else if (downStack && m.ema50 !== null) push(reason("fullAlignmentDown"))
  else if (downStack) push(reason("belowSma20"))
  if (ema20SlopeUp === true) push(reason("sma20SlopeUp"))
  else if (ema20SlopeUp === false) push(reason("sma20SlopeDown"))
  if (m.macdLine !== null && m.macdHist !== null) {
    if (m.macdLine > 0 && m.macdHist > 0) push(reason("macdBullish"))
    else if (m.macdLine < 0 && m.macdHist < 0) push(reason("macdBearish"))
    else if (m.macdHist > 0) push(reason("macdBullCross"))
    else push(reason("macdBearCross"))
  }
  if (m.rsi14 !== null) {
    if (m.rsi14 > 70) push(reason("rsiOverbought"))
    else if (m.rsi14 < 30) push(reason("rsiOversold"))
    else if (m.rsi14 >= 45 && m.rsi14 <= 60 && signal === "buy") push(reason("rsiNeutralUp"))
  }
  if (m.obvSlope20 !== null) push(m.obvSlope20 > 0 ? reason("obvUp") : reason("obvDown"))
  if (m.relVol !== null && changePct !== null) {
    if (m.relVol > 3) push(reason("volumeChase"))
    else if (m.relVol >= 1.0 && m.relVol <= 3.0 && changePct > 0) push(reason("volumeConfirmUp"))
  }
  if (m.ema20 !== null && lastClose !== null) {
    const extPct = ((lastClose - m.ema20) / m.ema20) * 100
    if (extPct > 8) push(reason("extended"))
    else if (extPct <= 4 && signal === "buy") push(reason("notExtended"))
  }
  if (m.rangePos60 !== null && m.rangePos60 > 90) push(reason("atRangeTop"))
  if (m.rsi14 !== null && m.rsi14 < 38 && changePct !== null && changePct > 0) push(reason("oversoldBounce"))

  const styleFits = computeStyleFits({
    signal, changePct, rsi: m.rsi14, ema20: m.ema20, ema50: m.ema50,
    lastClose, macdHist: m.macdHist, relVol: m.relVol, obvSlope20: m.obvSlope20,
    rangePos60: m.rangePos60, dailyVolPct: m.dailyVolPct, ema20SlopeUp,
    volumePresent: m.relVol !== null,
  }, true) // v1 emits the (now-disabled) day style for A/B comparability

  const tradePlan = signal !== null && signal !== "hold" && lastClose !== null
    ? v1TradePlan(signal, lastClose, closes)
    : null

  return {
    version: SIGNALS_VERSION_V1_BASELINE,
    score: finalScore,
    signal,
    dimensions: dims,
    reasons,
    styleFits,
    invalidation: null,
    tradePlan,
    limitations,
    sessions,
    lastClose,
    asOf,
    changePct,
    metrics: m,
  }
}

/** v1 BASELINE mechanical trade plan (tech-signals@4) — flat −4.5% chasing
 *  stop and the 2R target, preserved for plan-quality A/B comparison only. */
function v1TradePlan(signal: "buy" | "sell", lc: number, closes: number[]): TradePlan | null {
  if (!(lc > 0)) return null
  const win = closes.slice(-120).filter((c) => c > 0)
  if (win.length < 11) return null
  const bars: Bar[] = win.map((c, i) => ({
    ts: new Date(Date.UTC(2020, 0, 1 + i)).toISOString().slice(0, 10),
    open: c, high: c, low: c, close: c, volume: null,
  }))
  const z = supportResistance(bars, 5, 1.5, 4)
  const supPrices = z.supports.map((s) => s.price)
  const resPrices = z.resistances.map((s) => s.price)
  let s1: number | null = null
  for (const p of supPrices) if (p < lc && (s1 === null || p > s1)) s1 = p
  let r1: number | null = null
  for (const p of resPrices) if (p > lc && (r1 === null || p < r1)) r1 = p
  const rp = (x: number): number => Math.round(x * 100) / 100
  // EGX REALITY (2026-11-15 owner report: the top of the board was four
  // SHORT plans — entry near the close, stop ABOVE it, targets BELOW it —
  // presented as ready opportunities). The Egyptian Exchange has no retail
  // short-selling, and eligibility is restricted to a published list, so this
  // geometry is never executable by a reader of this product. The branch that
  // built it is DELETED rather than hidden: a sell read carries no price
  // levels at all, from any builder.
  if (signal === "sell") return null
  const chasing = s1 === null || ((lc - s1) / s1) * 100 > 6
  let entryLowRaw: number
  let entryHighRaw: number
  let stopRaw: number
  if (chasing) {
    entryLowRaw = lc * 0.985
    entryHighRaw = lc * 1.004
    stopRaw = lc * 0.955
  } else {
    entryLowRaw = Math.max(s1! * 1.002, lc * 0.985)
    entryHighRaw = lc * 1.004
    stopRaw = s1! * 0.98
  }
  const entryMidRaw = (entryLowRaw + entryHighRaw) / 2
  let stopDist = entryMidRaw - stopRaw
  if (!(stopDist > 0) || !(stopRaw < entryLowRaw)) return null
  if (!chasing) {
    const distPct = stopDist / entryMidRaw
    if (distPct < 0.02) { stopRaw = entryMidRaw * 0.98; stopDist = entryMidRaw * 0.02 }
    else if (distPct > 0.08) { stopRaw = entryMidRaw * 0.92; stopDist = entryMidRaw * 0.08 }
  }
  let targetLowRaw: number
  let targetHighRaw: number
  if (r1 !== null && (r1 - entryMidRaw) / stopDist >= 1) {
    targetLowRaw = r1 * 0.998
    targetHighRaw = r1 * 1.004
  } else {
    const t = entryMidRaw + 2 * stopDist
    targetLowRaw = t
    targetHighRaw = t
  }
  const targetMidRaw = (targetLowRaw + targetHighRaw) / 2
  const rewardDist = targetMidRaw - entryMidRaw
  if (!(rewardDist > 0)) return null
  const entryLow = rp(entryLowRaw)
  const entryHigh = rp(Math.max(entryHighRaw, entryLowRaw))
  const stop = rp(stopRaw)
  const targetLow = rp(targetLowRaw)
  const targetHigh = rp(Math.max(targetHighRaw, targetLowRaw))
  return {
    bias: "buy", entryLow, entryHigh,
    entryPct: Math.round((((entryLow + entryHigh) / 2 - lc) / lc) * 1000) / 10,
    stop,
    stopPct: Math.round(((stop - lc) / lc) * 1000) / 10,
    targetLow, targetHigh,
    targetPct: Math.round(((targetMidRaw - lc) / lc) * 1000) / 10,
    riskReward: Math.round((rewardDist / stopDist) * 100) / 100,
    textAr: "v1 baseline plan", textEn: "v1 baseline plan",
    basisAr: "v1 baseline (mechanical)",
  }
}

// ---------------------------------------------------------------------------
// Entry point 2 — per-company stance from the FULL technical snapshot.
// Real bundles carry a `trail` of raw reads computed by the SAME close-series
// core as the board engine (assembleBundle) — the tab and the board then print
// the SAME reading. Hand-built/legacy snapshots without a trail fall back to
// the snapshot-fields scorer below (no hysteresis available there).
// ---------------------------------------------------------------------------

export interface StanceInvalidation {
  side: "below" | "above"
  level: number
  labelAr: string
  labelEn: string
}

export function computeStanceFromSnapshot(snap: TechnicalSnapshot): TechStance {
  const limitations: string[] = []
  const last = snap.lastClose
  if (!snap.available || last === null) {
    return {
      version: SIGNALS_VERSION, score: null, signal: null, dimensions: [],
      reasons: [], styleFits: [], invalidation: null, tradePlan: null,
      signalState: "wait", setup: null,
      limitations: ["No daily price history is stored for this company yet."],
    }
  }

  const t = snap.trend
  const mo = snap.momentum
  const v = snap.volume
  const vol = snap.volatility
  const prevClose = snap.perf.d1 !== null ? last / (1 + snap.perf.d1 / 100) : null

  // ---------- trail path: same core as the board engine ----------
  const trail = snap.trail
  if (trail && trail.length > 0 && trail[trail.length - 1]?.ts === snap.asOf) {
    const walk = applyHysteresis(trail)
    const lastRead = trail[trail.length - 1]
    if (walk.score !== null && lastRead.facts) {
      const f = lastRead.facts
      const g = f.gates
      const signal = walk.signal
      if (walk.glideApplied) limitations.push(`The displayed score is glide-limited to ±${SCORE_STEP_LIMIT} points per session — a larger one-session evidence shift without a structural driver is spread across sessions.`)
      if (walk.heldByHysteresis) limitations.push(`The label is held by hysteresis (enter/exit bands + ${MIN_STATE_HOLD}-session minimum hold) — the read reacts up to ~${MIN_STATE_HOLD} sessions slower at turning points.`)
      limitations.push("Dimension evidence comes from the close-series core shared with the board engine (risk uses the close-to-close volatility proxy; ATR drives the trade plan only).")

      const reasons: SignalReason[] = []
      const push = (r: SignalReason) => { if (reasons.length < 5 && !reasons.some((x) => x.code === r.code)) reasons.push(r) }
      if (g.buyCandidate && !g.volumeAgreement) push(reason("weakVolumeNoBuy"))
      else if (g.buyCandidate && !g.allDimsStrong) push(reason("notFullStrength"))
      if (g.buyCandidate && g.vetoResistance) push(reason("nearResistanceVeto"))
      else if (g.buyCandidate && g.breakoutConfirmed) push(reason("breakoutConfirmed"))
      if (g.sellCandidate && g.vetoSupport) push(reason("atSupportVeto"))
      if (signal === "sell" && g.distributionSell) push(reason("distributionSell"))
      const upStack = f.ema20 !== null && last > f.ema20 && (f.ema50 === null || f.ema20 > f.ema50)
      const downStack = f.ema20 !== null && last < f.ema20 && (f.ema50 === null || f.ema20 < f.ema50)
      if (upStack && f.ema50 !== null) push(reason("fullAlignmentUp"))
      else if (upStack) push(reason("aboveSma20"))
      else if (downStack && f.ema50 !== null) push(reason("fullAlignmentDown"))
      else if (downStack) push(reason("belowSma20"))
      if (f.ema20SlopeUp) push(reason("sma20SlopeUp"))
      if (f.macdLine !== null && f.macdHist !== null) {
        if (f.macdLine > 0 && f.macdHist > 0) push(reason("macdBullish"))
        else if (f.macdLine < 0 && f.macdHist < 0) push(reason("macdBearish"))
        else if (f.macdHist > 0) push(reason("macdBullCross"))
        else push(reason("macdBearCross"))
      }
      if (f.rsi14 !== null) {
        if (f.rsi14 > 70) push(reason("rsiOverbought"))
        else if (f.rsi14 < 30) push(reason("rsiOversold"))
      }
      if (f.obvSlope20 !== null) push(f.obvSlope20 > 0 ? reason("obvUp") : reason("obvDown"))
      if (f.extPct !== null) {
        if (f.extPct > 8) push(reason("extended"))
        else if (f.extPct <= 4 && signal === "buy") push(reason("notExtended"))
      }
      if (f.volExpansionRatio !== null && f.volExpansionRatio > 2) push(reason("volExpanding"))
      if (snap.sparse) limitations.push("Sessions are sparse — oscillator readings are approximate.")

      const styleFits = computeStyleFits({
        signal,
        changePct: snap.perf.d1,
        rsi: f.rsi14, ema20: f.ema20, ema50: f.ema50,
        lastClose: last,
        macdHist: f.macdHist, relVol: f.relVol, obvSlope20: f.obvSlope20,
        rangePos60: f.rangePos60,
        dailyVolPct: f.dailyVolPct,
        ema20SlopeUp: f.ema20SlopeUp,
        volumePresent: f.relVol !== null || f.obvSlope20 !== null,
      }, false)

      const invalidation = buildInvalidation(signal, last > (f.ema20 ?? 0), snap.levels.supports[0], snap.levels.resistances[0])
      const tradePlan = signal !== null && signal !== "hold"
        ? buildTradePlan({
            signal,
            lastClose: last,
            closes: [],
            supports: snap.levels.supports,
            resistances: snap.levels.resistances,
            zones: snap.zones?.zones?.map((z) => ({ kind: z.kind, low: z.low, high: z.high })) ?? null,
            atrPct: vol.atrPct ?? null,
          })
        : null
      const { state, direction, vetoReasons } = deriveSignalState(signal, g, tradePlan !== null)
      const setup = state === "watching" && direction !== null
        ? snapshotWatchingSetup(snap, direction, vetoReasons, vetoReasons.some((r) => r.code === "near_resistance_veto" || r.code === "at_support_veto"))
        : null
      return {
        version: SIGNALS_VERSION,
        score: walk.score,
        signal,
        dimensions: lastRead.dims,
        reasons,
        styleFits,
        invalidation,
        tradePlan,
        signalState: state,
        setup,
        // canonical metric block — the board's chips read THIS, never the
        // close-only engine's metrics (parity fix 2026-11-15)
        metrics: buildCanonicalMetrics(snap, f.dailyVolPct),
        limitations,
      }
    }
  }

  // ---------- fallback scorer over snapshot fields (no trail available) ----------
  const emaAvailable = t.ema20 !== null
  if (!snap.sparse && false) { /* unreachable — keeps the linter honest */ }

  // TREND — one state input on the fixed 0-30 scale; caps mirror the close
  // engine: no mid lens (EMA50) → ≤21; no long lens (EMA200) → ≤23.
  let trendEarned = 0
  let trendMax = 0
  if (t.ema20 !== null) {
    trendMax = 30
    const facts: boolean[] = [last > t.ema20]
    if (t.ema50 !== null) facts.push(last > t.ema50)
    if (t.ema20 !== null && t.ema50 !== null) facts.push(t.ema20 > t.ema50)
    if (t.ema200 !== null) facts.push(last > t.ema200)
    const bull = facts.filter(Boolean).length
    const share = bull / facts.length
    trendEarned = share >= 1 ? 30 : share >= 0.75 ? 24 : share >= 0.5 ? 15 : share >= 0.25 ? 7 : share > 0 ? 3 : 0
    if (t.ema50 === null) trendEarned = Math.min(trendEarned, 21)
    else if (t.ema200 === null) trendEarned = Math.min(trendEarned, 23)
  }
  const trendShare = trendMax > 0 ? trendEarned / trendMax : null

  // MOMENTUM — corroborated group (RSI + MACD + Stoch with the overbought veto)
  // Max = 25 (aligned with weight). Components: RSI 8, MACD 8, Stoch 9.
  let momEarned = 0
  let momMax = 0
  if (mo.rsi14 !== null) { momMax += 8; momEarned += Math.round(rsiBandPoints(mo.rsi14) * 0.8) }
  if (mo.macd.histogram !== null && mo.macd.macd !== null) { momMax += 8; momEarned += Math.round(macdPoints(mo.macd.macd, mo.macd.histogram) * 0.8) }
  if (mo.stochastic.k !== null && mo.stochastic.d !== null) { momMax += 9; momEarned += Math.round(stochPoints(mo.stochastic.k, mo.stochastic.d) * 0.9) }
  if (momMax > 0) momEarned = Math.min(momEarned, Math.round(MOMENTUM_GROUP_STRONG_SHARE * momMax))

  // VOLUME
  // Max = 25 (aligned with weight). Components: OBV 12, RelVol 13.
  let volEarned = 0
  let volMax = 0
  if (v.obvSlope20 !== null) { volMax += 12; if (v.obvSlope20 > 0) volEarned += 10 }
  if (v.relVol !== null && snap.perf.d1 !== null) { volMax += 13; volEarned += Math.round(relVolBandPoints(v.relVol, snap.perf.d1 > 0) * 1.3) }

  // RISK — two-sided extension + ATR regime (expansion unknown on a point snapshot)
  let riskEarned = 0
  let riskMax = 0
  let extPct: number | null = null
  if (t.ema20 !== null && t.ema20 > 0) {
    riskMax += 8
    extPct = ((last - t.ema20) / t.ema20) * 100
    riskEarned += extensionRiskPoints(extPct)
  }
  if (vol.atrPct !== null) { riskMax += 7; riskEarned += dailyVolPoints(vol.atrPct) }

  const dims: SignalDim[] = [
    { key: "trend" as const, earned: trendEarned, max: trendMax },
    { key: "momentum" as const, earned: momEarned, max: momMax },
    { key: "volume" as const, earned: volEarned, max: volMax },
    { key: "risk" as const, earned: riskEarned, max: riskMax },
  ]
  const { rawPct, allDimsStrong, volumeKnown, riskKnown } = rawWeightedPct(dims)
  const finalScore = rawPct !== null && trendMax > 0
    ? finalizeScore(rawPct, { volumeKnown, riskKnown, allDimsStrong, relVol: v.relVol })
    : null

  // structure-veto zones from pivot levels AND supply/demand zones (audit C)
  const resistanceZone = resolveResistanceZone(snap, last)
  const supportZone = resolveSupportZone(snap, last)
  const { signal, gates } = decideSignal({
    finalScore,
    trendShare,
    rsi: mo.rsi14,
    macdLine: mo.macd.macd,
    macdHist: mo.macd.histogram,
    relVol: v.relVol,
    obvSlope: v.obvSlope20,
    allDimsStrong,
    lowerHighs: null, // point snapshot carries no swing series — the trail path does
    belowLongMa: t.ema50 !== null && last < t.ema50,
    close: last,
    prevClose,
    resistanceZone,
    supportZone,
  })

  if (snap.sparse) limitations.push("Sessions are sparse — oscillator readings are approximate.")
  if (snap.sessions < MIN_SESSIONS) limitations.push(`Only ${snap.sessions} sessions — several checks are excluded and missing evidence caps the score (no volume evidence → 70, no risk evidence → 75).`)
  if (!emaAvailable) limitations.push("Short EMA data unavailable — trend checks are excluded, not guessed.")
  if (trendMax <= 0) limitations.push("Trend checks could not be computed — no stance mapping.")
  limitations.push("No signal trail on this snapshot — hysteresis (enter/exit bands, minimum hold, score glide) is not applied on the fallback path.")

  // ---------- reasons ----------
  const reasons: SignalReason[] = []
  const push = (r: SignalReason) => { if (reasons.length < 5 && !reasons.some((x) => x.code === r.code)) reasons.push(r) }
  if (gates.buyCandidate && !gates.volumeAgreement) push(reason("weakVolumeNoBuy"))
  else if (gates.buyCandidate && !allDimsStrong) push(reason("notFullStrength"))
  if (gates.buyCandidate && gates.vetoResistance) push(reason("nearResistanceVeto"))
  else if (gates.buyCandidate && gates.breakoutConfirmed) push(reason("breakoutConfirmed"))
  if (gates.sellCandidate && gates.vetoSupport) push(reason("atSupportVeto"))
  if (signal === "sell" && gates.distributionSell) push(reason("distributionSell"))
  const priceAboveShort = t.ema20 !== null ? last > t.ema20 : null
  const upStack = priceAboveShort === true && t.ema20 !== null && (t.ema50 === null || t.ema20 > t.ema50)
  const downStack = priceAboveShort === false && t.ema20 !== null && (t.ema50 === null || t.ema20 < t.ema50)
  if (upStack && t.ema50 !== null) push(reason("fullAlignmentUp"))
  else if (upStack) push(reason("aboveSma20"))
  else if (downStack && t.ema50 !== null) push(reason("fullAlignmentDown"))
  else if (downStack) push(reason("belowSma20"))
  if (!emaAvailable && t.cross50200 === "golden") push(reason("smaGoldenCross"))
  else if (!emaAvailable && t.cross50200 === "death") push(reason("smaDeathCross"))
  if (mo.macd.macd !== null && mo.macd.histogram !== null) {
    if (mo.macd.macd > 0 && mo.macd.histogram > 0) push(reason("macdBullish"))
    else if (mo.macd.macd < 0 && mo.macd.histogram < 0) push(reason("macdBearish"))
    else if (mo.macd.histogram > 0) push(reason("macdBullCross"))
    else push(reason("macdBearCross"))
  }
  if (mo.rsi14 !== null) {
    if (mo.rsi14 > 70) push(reason("rsiOverbought"))
    else if (mo.rsi14 < 30) push(reason("rsiOversold"))
  }
  if (v.obvSlope20 !== null) push(v.obvSlope20 > 0 ? reason("obvUp") : reason("obvDown"))
  if (extPct !== null) {
    if (extPct > 8) push(reason("extended"))
    else if (extPct <= 4 && signal === "buy") push(reason("notExtended"))
  }

  // ---------- style fits (day style DISABLED; rangePos from range60 — fixes
  // the @4 board/tab style asymmetry the audit flagged) ----------
  const styleFits = computeStyleFits({
    signal,
    changePct: snap.perf.d1,
    rsi: mo.rsi14,
    ema20: t.ema20,
    ema50: t.ema50,
    lastClose: last,
    macdHist: mo.macd.histogram,
    relVol: v.relVol,
    obvSlope20: v.obvSlope20,
    rangePos60: snap.range60?.posPct ?? null,
    dailyVolPct: vol.atrPct === null ? null : vol.atrPct,
    ema20SlopeUp: null, // point snapshot carries no EMA series — slope unknown, never guessed
    volumePresent: v.relVol !== null || v.obvSlope20 !== null,
  }, false)

  const invalidation = buildInvalidation(signal, priceAboveShort === true, snap.levels.supports[0], snap.levels.resistances[0])

  const tradePlan = signal !== null && signal !== "hold"
    ? buildTradePlan({
        signal,
        lastClose: last,
        closes: [], // the snapshot carries levels, not raw bars — zones come from levels/zones below
        supports: snap.levels.supports,
        resistances: snap.levels.resistances,
        zones: snap.zones?.zones?.map((z) => ({ kind: z.kind, low: z.low, high: z.high })) ?? null,
        atrPct: vol.atrPct ?? null,
      })
    : null
  const { state, direction, vetoReasons } = deriveSignalState(signal, gates, tradePlan !== null)
  const setup = state === "watching" && direction !== null
    ? snapshotWatchingSetup(snap, direction, vetoReasons, vetoReasons.some((r) => r.code === "near_resistance_veto" || r.code === "at_support_veto"))
    : null

  return {
    version: SIGNALS_VERSION,
    score: finalScore,
    signal,
    dimensions: dims,
    reasons,
    styleFits,
    invalidation,
    tradePlan,
    signalState: state,
    setup,
    // canonical metric block — the board's chips read THIS, never the
    // close-only engine's metrics (parity fix 2026-11-15)
    metrics: buildCanonicalMetrics(snap),
    limitations,
  }
}

/**
 * Build the canonical metric block from a FULL OHLC snapshot (remediation
 * 2026-11-15). Every value is read from the snapshot the company technical tab
 * already renders, so the board and the tab cannot disagree: one snapshot, one
 * set of numbers, two surfaces.
 *
 * HONESTY CONTRACT: nothing here recomputes from a different source. A metric
 * the snapshot cannot produce is null, and the caller must render it as
 * unavailable. `rangePos60` comes from the snapshot's observed 60-session range
 * (never re-derived from a close-only series); `macdHist` is the snapshot's own
 * histogram; `dailyVolPct` reuses the SAME σ-of-20-close-to-close-moves
 * definition the scoring core uses, so the chip and the risk dimension agree.
 */
export function buildCanonicalMetrics(
  snap: TechnicalSnapshot,
  /** σ of the last 20 close-to-close % moves when the caller already has it
   *  (the trail facts carry it). The snapshot itself does NOT expose a close
   *  series, and `volatility.histVol20` is a DIFFERENT statistic (annualized
   *  log-return sd), so it is never substituted here — absent input means the
   *  chip renders as unavailable. */
  dailyVolPct: number | null = null,
): CanonicalMetrics {
  const mo = snap.momentum
  const vol = snap.volume
  const trend = snap.trend
  const nz = (x: number | null | undefined): number | null =>
    typeof x === "number" && Number.isFinite(x) ? round(x, 4) : null

  return {
    rsi14: nz(mo?.rsi14),
    ema20: nz(trend?.ema20),
    ema50: nz(trend?.ema50),
    macdLine: nz(mo?.macd?.macd),
    macdHist: nz(mo?.macd?.histogram),
    relVol: nz(vol?.relVol),
    perfW1: nz(snap.perf?.w1),
    perfM1: nz(snap.perf?.m1),
    perfM3: nz(snap.perf?.m3),
    // observed 60-session range position — the snapshot's own read
    rangePos60: nz(snap.range60?.posPct),
    dailyVolPct: nz(dailyVolPct),
    obvSlope20: nz(vol?.obvSlope20),
  }
}

/**
 * Watched-setup input assembled from a full snapshot (shared by the trail and
 * the fallback scorer paths). The veto zone is re-resolved with the SAME
 * helpers the decision used, and when it came from a supply/demand zone the
 * band recovers its full low/high edges so the activation level is the zone
 * TOP (blocked buy) / BOTTOM (blocked sell).
 */
function snapshotWatchingSetup(
  snap: TechnicalSnapshot,
  direction: "buy" | "sell",
  vetoReasons: SignalReason[],
  structuralVeto: boolean,
): WatchingSetup | null {
  const last = snap.lastClose
  if (last === null) return null
  const zone = direction === "buy" ? resolveResistanceZone(snap, last) : resolveSupportZone(snap, last)
  let vetoBand: { low: number; high: number } | null = null
  if (zone !== null && snap.zones?.zones) {
    for (const z of snap.zones.zones) {
      if (direction === "buy" && z.kind === "supply" && z.low === zone.price) { vetoBand = { low: z.low, high: z.high }; break }
      if (direction === "sell" && z.kind === "demand" && z.high === zone.price) { vetoBand = { low: z.low, high: z.high }; break }
    }
  }
  return buildWatchingSetup({
    direction,
    lastClose: last,
    structuralVeto,
    vetoLevel: zone?.price ?? null,
    vetoTouches: zone?.touches ?? null,
    vetoBand,
    vetoReasons,
    closes: [],
    supports: snap.levels.supports,
    resistances: snap.levels.resistances,
    zones: snap.zones?.zones?.map((z) => ({ kind: z.kind, low: z.low, high: z.high })) ?? null,
    atrPct: snap.volatility.atrPct ?? null,
    volPct: null,
    extremes: {
      low: snap.range60?.low ?? null,
      lowBasisAr: "قاع نطاق 60 جلسة المرصود",
      high: snap.range60?.high ?? null,
      highBasisAr: "قمة نطاق 60 جلسة المرصود",
    },
  })
}

function buildInvalidation(
  signal: TechSignalType | null,
  priceAboveShort: boolean,
  sup: { price: number } | undefined,
  res: { price: number } | undefined
): StanceInvalidation | null {
  if (signal === "buy" && sup) {
    return {
      side: "below", level: sup.price,
      labelAr: `الإبطال الفني للقراءة: كسر دعم ${sup.price} إغلاقًا.`,
      labelEn: `Technical invalidation: a close below the ${sup.price} support.`,
    }
  }
  if (signal === "hold" && priceAboveShort && sup) {
    return {
      side: "below", level: sup.price,
      labelAr: `تفقد القراءة قوتها تحت دعم ${sup.price}.`,
      labelEn: `The read weakens below the ${sup.price} support.`,
    }
  }
  if (signal === "sell" && res) {
    return {
      side: "above", level: res.price,
      labelAr: `تتغير القراءة فوق مقاومة ${res.price}.`,
      labelEn: `The read changes above the ${res.price} resistance.`,
    }
  }
  return null
}

function resolveResistanceZone(snap: TechnicalSnapshot, close: number): { price: number; touches: number } | null {
  let best: { price: number; touches: number } | null = null
  const consider = (price: number, touches: number) => {
    if (!(price > close)) return
    if (((price - close) / close) * 100 > RESISTANCE_VETO_PCT) return
    if (best === null || price < best.price) best = { price, touches }
  }
  for (const z of snap.levels.resistances ?? []) consider(z.price, z.touches)
  for (const z of snap.zones?.zones ?? []) {
    if (z.kind === "supply" && z.low <= close * (1 + RESISTANCE_VETO_PCT / 100) && z.high > close) consider(z.low, z.tests)
  }
  return best
}

function resolveSupportZone(snap: TechnicalSnapshot, close: number): { price: number; touches: number } | null {
  let best: { price: number; touches: number } | null = null
  const consider = (price: number, touches: number) => {
    if (!(price < close)) return
    if (((close - price) / close) * 100 > SUPPORT_VETO_PCT) return
    if (best === null || price > best.price) best = { price, touches }
  }
  for (const z of snap.levels.supports ?? []) consider(z.price, z.touches)
  for (const z of snap.zones?.zones ?? []) {
    if (z.kind === "demand" && z.high >= close * (1 - SUPPORT_VETO_PCT / 100) && z.low < close) consider(z.high, z.tests)
  }
  return best
}
