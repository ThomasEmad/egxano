// =============================================================================
// EGXANO Technical Signals Engine — deterministic, rule-based market read.
// =============================================================================
//
// This is the FACT-LAYER synthesis that turns the already-computed indicator
// readings into a single, explainable technical stance per company:
//   • score        0-100 confluence score (documented, versioned weights)
//   • signal       "buy" | "hold" | "sell" — a DETERMINISTIC READING of the
//                  rules, disclosed as such everywhere it is shown. It is a
//                  factual statement about which way the evidence points, not
//                  a personalized investment recommendation.
//   • styleTags    which trading styles the current setup fits (day / swing /
//                  trend / reversal) — the SAME facts, evaluated per horizon.
//   • reasons      the top evidence lines that moved the score (bilingual).
//
// HONESTY RULES (mirroring the whole technical engine):
//   • Missing history is never treated as zero. A dimension that cannot be
//     computed is excluded from the weighted average AND caps the score
//     ceiling (no volume evidence → 70, no risk evidence → 75) — thin data
//     can never look excellent. The limitation is still disclosed.
//   • Every weight change requires bumping SIGNALS_VERSION.
//   • Two entry points share the same weight table and label maps:
//       - computeCloseSignal(): light close-based engine over MarketPrice
//         day-rows (the whole-market screen — close-only bars are the
//         documented precedent for the freshest sessions).
//       - computeStanceFromSnapshot(): the per-company reading from the FULL
//         TechnicalSnapshot (real OHLC, structure, VSA) used on the company
//         technical tab.
// =============================================================================

import { ema, emaSeries, macd, perfN, rsi } from "./indicators"
import type { TechnicalSnapshot } from "./analyze"
import { buildTradePlan, type TradePlan } from "./trade-plan"

export const SIGNALS_VERSION = "tech-signals@4"

export type TechSignalType = "buy" | "hold" | "sell"

/** Trading styles the current setup fits — each is a separate horizon checklist. */
export type TechStyleTag = "day" | "swing" | "trend" | "reversal"

export const STYLE_TAG_META: Record<TechStyleTag, { ar: string; en: string }> = {
  day: { ar: "صفقة يوم", en: "Day trade" },
  swing: { ar: "صفقة أيام", en: "Days trade" },
  trend: { ar: "صفقة أسابيع", en: "Weeks trade" },
  reversal: { ar: "انعكاس محتمل", en: "Reversal watch" },
}

/** One-line Arabic hint per style — what the horizon actually means. */
export const STYLE_TAG_HINT_AR: Record<TechStyleTag, string> = {
  day: "تدخل وتخرج في نفس الجلسة",
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
  /** earned checklist items / total applicable for this style */
  earned: number
  total: number
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
   *  no honest plan can be anchored — hold, or a sell with no usable resistance) */
  tradePlan: TradePlan | null
  limitations: string[]
}

// ---------------------------------------------------------------------------
// Weight table — the single source of truth for both entry points.
// ---------------------------------------------------------------------------

export const SIGNAL_WEIGHTS = {
  trend: 35,
  momentum: 30,
  volume: 20,
  risk: 15,
} as const

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

// ---------------------------------------------------------------------------
// Score finalization (shared by BOTH engines) — the @3 calibration layer.
// ---------------------------------------------------------------------------
//
// Owner calibration (tech-signals@3): high scores must be RARE and MEANINGFUL.
// Under @2 a plain uptrend with RSI 45-65, MACD>0, mid-range position, OBV up
// and 1-3x volume scored a flat 100/100 — nothing anchored 80 to a small tail.
// The final score is therefore produced in three ordered steps:
//   1. Missing-evidence caps — a dimension that cannot be computed (no volume
//      series with nonzero recent volume, no ATR) earns nothing, is EXCLUDED
//      from the weighted average, and its absence caps the ceiling:
//      no volume evidence → cap 70; no risk evidence → cap 75
//      (both missing → 70). Thin data can never look excellent.
//   2. Excellence gate — a raw score above 85 additionally requires every
//      present dimension to earn ≥80% of its own max AND a signal-day
//      relative volume ≥ 1.2× (relVol unknown = not strong). Otherwise the
//      raw score is clamped to 85.
//   3. High-end compression — final = round(100 × (raw/100)^1.25).
//      Rationale (owner calibration): the convex curve (exponent > 1) is
//      monotonic and keeps 0→0 and 100→100, but pushes the top tail down so
//      displayed 80+ demands a raw ≈ 84+ and displayed 90 a raw ≈ 91:
//      90→88, 85→82, 80→76, 75→70, 70→64. Combined with the caps and the
//      gate, a high score can only come from broad, volume-confirmed strength.
//   The BUY_SCORE / SELL_SCORE thresholds (62/35) are applied to the
//   compressed final, so a buy read now demands raw ≈ 68+ and a sell raw
//   ≤ ≈ 43 — the printed thresholds are unchanged; the effective bar is
//   raised by the curve, by design.

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
  // 2. excellence gate (tech-signals@4, tightened): anything above 80 needs
  //    full-strength dimensions AND confirmed participation — the owner saw
  //    too many 80+ reads, so the bar moved from 85 to 80 and relVol from 1.2
  //    to 1.3× the 20-day average.
  const relVolStrong = ctx.relVol !== null && ctx.relVol >= 1.3
  if (s > 80 && !(ctx.allDimsStrong && relVolStrong)) s = 80
  // 3. high-end compression curve (steeper @4: displayed 80 now demands a raw
  //    ≈ 86.6; 90 → 86, 85 → 80, 80 → 74, 75 → 68, 70 → 62)
  return Math.round(100 * Math.pow(s / 100, 1.4))
}

/** One scored dimension in its own (pre-weight) scale. */
export interface SignalDim {
  key: "trend" | "momentum" | "volume" | "risk"
  earned: number
  max: number
}

/**
 * Weighted raw percentage over the dimensions that actually have evidence
 * (max > 0). A dim without evidence is excluded — not silently rescaled —
 * and its absence is reported so finalizeScore() can cap the ceiling.
 */
function rawWeightedPct(dims: SignalDim[]): {
  rawPct: number | null
  allDimsStrong: boolean
  volumeKnown: boolean
  riskKnown: boolean
} {
  let score = 0
  let weightSum = 0
  for (const d of dims) {
    if (d.max <= 0) continue
    score += (d.earned / d.max) * SIGNAL_WEIGHTS[d.key]
    weightSum += SIGNAL_WEIGHTS[d.key]
  }
  const present = dims.filter((d) => d.max > 0)
  const allDimsStrong = present.length > 0 && present.every((d) => d.earned / d.max >= 0.8)
  return {
    rawPct: weightSum > 0 ? (score / weightSum) * 100 : null,
    allDimsStrong,
    volumeKnown: dims.some((d) => d.key === "volume" && d.max > 0),
    riskKnown: dims.some((d) => d.key === "risk" && d.max > 0),
  }
}

// ---------------------------------------------------------------------------
// Shared @3 band scorers — the exact same numbers in BOTH engines, so the
// whole-market screen and the company technical tab stay in one calibration.
// ---------------------------------------------------------------------------

/** RSI band credit — full credit ONLY inside 45-60; a hot-but-overextended
 *  tape (68+) earns almost nothing, so momentum cannot max while stretched. */
function rsiBandPoints(r: number): number {
  if (r >= 45 && r <= 60) return 10
  if (r > 60 && r <= 68) return 6
  if (r > 68 && r <= 72) return 3
  if (r > 72) return 2
  if (r >= 40) return 5
  if (r >= 30) return 3
  return 2 // <30 oversold
}

/** MACD line+histogram credit (identical wording in both engines). */
function macdPoints(line: number, hist: number): number {
  return line > 0 && hist > 0 ? 10 : line > 0 && hist <= 0 ? 5 : line <= 0 && hist > 0 ? 7 : 1
}

/**
 * Signal-day relative-volume credit. Up-day bands: 2-3× = 10 (strongest
 * confirmation), 1-2× = 6 (participation), >3× = 4 (climax/distribution risk —
 * NOT auto-full credit), <1× = 3 (unconfirmed move). A down day earns no
 * up-band credit at all: heavy down volume is a distribution hint (1), a
 * quiet drift is mild (3). Volume confirmation beyond these bands still
 * requires OBV accumulation (the OBV sub-check stays independent).
 */
function relVolBandPoints(relVol: number, upDay: boolean): number {
  if (!upDay) return relVol >= 1.5 ? 1 : 3
  if (relVol > 2 && relVol <= 3) return 10
  if (relVol >= 1 && relVol <= 2) return 6
  if (relVol > 3) return 4
  return 3
}

/** Extension-from-the-short-average credit (% above the 20-session average).
 *  ≤4% = comfortable, 4-8% = stretched, >8% = 0. Below the average counts as
 *  not-extended (the risk here is being stretched ABOVE it). */
function extensionPoints(extPct: number): number {
  return extPct <= 4 ? 8 : extPct <= 8 ? 5 : 0
}

/** Daily-volatility credit: ≤3% = 7, 3-5% = 4, >5% = 0. */
function dailyVolPoints(volPct: number): number {
  return volPct <= 3 ? 7 : volPct <= 5 ? 4 : 0
}

/** Consecutive rising steps at the END of a series. ≥3 consecutive rises is a
 *  real slope, not one-session noise. null = not computable (need the last
 *  two points to exist) — unknown is never scored as false. */
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
} as const satisfies Record<string, { code: string; tone: SignalReason["tone"]; ar: string; en: string }>

function reason(key: keyof typeof R): SignalReason {
  const r = R[key]
  return { code: r.code, tone: r.tone, ar: r.ar, en: r.en }
}

// ---------------------------------------------------------------------------
// Entry point 1 — light close-based engine (whole-market screen).
// ---------------------------------------------------------------------------

/** Minimal bar the light engine needs: one row per session, ascending. */
export interface CloseRow {
  ts: string
  close: number
  volume: number | null
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

/** OBV slope proxy over the last n rows with volume (null when too thin). */
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
  // positive when the recent half carries more net up-volume than the earlier half
  return obv - obvFirst
}

/** Relative volume: last session vs the mean of the prior 20 volume-complete rows. */
function relVol(rows: CloseRow[]): number | null {
  const withVol = rows.filter((r) => r.volume !== null && r.volume > 0)
  if (withVol.length < 11) return null
  const last = withVol[withVol.length - 1]
  const prior = withVol.slice(-21, -1)
  const mean = prior.reduce((s, r) => s + (r.volume as number), 0) / prior.length
  if (!(mean > 0)) return null
  return (last.volume as number) / mean
}

/** Annualization-free daily volatility proxy: std of close-to-close % moves (last 20). */
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

/** Close-based range position: where the last close sits in the trailing range (0-100). */
function rangePos(closes: number[], n = 60): number | null {
  const win = closes.slice(-n)
  if (win.length < 20) return null
  const hi = Math.max(...win)
  const lo = Math.min(...win)
  if (!(hi > lo)) return 50
  return ((win[win.length - 1] - lo) / (hi - lo)) * 100
}

/**
 * Deterministic light signal over close-only day-rows (ascending).
 * Missing history → null score with disclosed limitations — never a fake read.
 */
export function computeCloseSignal(rows: CloseRow[]): CloseSignalOutput {
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

  const m = {
    rsi14: sessions >= 16 ? rsi(closes, 14).value : null,
    ema20: ema(closes, 20).value,
    ema50: sessions >= 50 ? ema(closes, 50).value : null,
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

  // ---------- TREND (max 30 in the 35-weight dim — full credit ONLY when all
  // four EMA facts align: price>EMA20, price>EMA50, EMA20>EMA50, real slope) ----------
  let trendEarned = 0
  let trendMax = 0
  if (m.ema20 !== null && lastClose !== null) {
    trendMax += 8
    if (lastClose > m.ema20) trendEarned += 8
  }
  if (m.ema50 !== null && lastClose !== null) {
    trendMax += 7
    if (lastClose > m.ema50) trendEarned += 7
  }
  if (m.ema20 !== null && m.ema50 !== null) {
    trendMax += 8
    if (m.ema20 > m.ema50) trendEarned += 8
  }
  const e20series = emaSeries(closes, 20)
  const slopeStreak = risingStreak(e20series)
  let ema20SlopeUp: boolean | null = null
  if (slopeStreak !== null) {
    trendMax += 7
    ema20SlopeUp = slopeStreak >= 3 // ≥3 consecutive rising EMA steps = a real slope
    if (ema20SlopeUp) trendEarned += 7
  }

  // ---------- MOMENTUM (max 30) ----------
  let momEarned = 0
  let momMax = 0
  if (m.rsi14 !== null) {
    momMax += 10
    // @3: full credit only inside 45-60 — a hot-but-overextended tape can't max momentum
    momEarned += rsiBandPoints(m.rsi14)
  }
  if (m.macdHist !== null && m.macdLine !== null) {
    momMax += 10
    // line + histogram together: above zero with rising hist is full credit
    momEarned += macdPoints(m.macdLine, m.macdHist)
  }
  if (m.rangePos60 !== null) {
    momMax += 10
    const p = m.rangePos60
    const pts = p >= 45 && p <= 75 ? 10 : p >= 20 && p < 45 ? 7 : p >= 75 && p <= 90 ? 5 : p > 90 ? 2 : 3
    momEarned += pts
  }

  // ---------- VOLUME (max 20) ----------
  let volEarned = 0
  let volMax = 0
  if (m.obvSlope20 !== null) {
    volMax += 10
    // accumulation alone is 8, not 10 — OBV is tendency evidence, not proof
    if (m.obvSlope20 > 0) volEarned += 8
  }
  if (m.relVol !== null && changePct !== null) {
    volMax += 10
    // signal-day bands; a down day earns no up-band credit regardless of how
    // heavy the tape is — confirmation beyond bands still requires OBV > 0
    volEarned += relVolBandPoints(m.relVol, changePct > 0)
  }

  // ---------- RISK (max 15) ----------
  let riskEarned = 0
  let riskMax = 0
  if (m.ema20 !== null && lastClose !== null) {
    riskMax += 8
    const extPct = ((lastClose - m.ema20) / m.ema20) * 100
    riskEarned += extensionPoints(extPct)
  }
  if (m.dailyVolPct !== null) {
    riskMax += 7
    riskEarned += dailyVolPoints(m.dailyVolPct)
  }

  const dims: SignalDim[] = [
    { key: "trend" as const, earned: trendEarned, max: trendMax },
    { key: "momentum" as const, earned: momEarned, max: momMax },
    { key: "volume" as const, earned: volEarned, max: volMax },
    { key: "risk" as const, earned: riskEarned, max: riskMax },
  ]
  // @3: dims without evidence are excluded from the average AND cap the
  // ceiling (70/75) instead of silently rescaling the score upward.
  // A stance with NO trend evidence at all (trendMax 0 — below 20 sessions)
  // has no anchor: the score stays null (weak-data bucket), never a fake read.
  const { rawPct, allDimsStrong, volumeKnown, riskKnown } = rawWeightedPct(dims)
  const finalScore = rawPct !== null && trendMax > 0
    ? finalizeScore(rawPct, { volumeKnown, riskKnown, allDimsStrong, relVol: m.relVol })
    : null

  // ---------- signal mapping ----------
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

  // ---------- reasons (top evidence, capped at 4) ----------
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
    if (m.relVol > 3) push(reason("volumeChase")) // @3: climax band starts above 3x, matching the volume dim
    else if (m.relVol >= 1.0 && m.relVol <= 3.0 && changePct > 0) push(reason("volumeConfirmUp"))
  }
  if (m.ema20 !== null && lastClose !== null) {
    const extPct = ((lastClose - m.ema20) / m.ema20) * 100
    // thresholds match the @3 risk bands: >8% scores 0 (extended), ≤4% scores full (not extended)
    if (extPct > 8) push(reason("extended"))
    else if (extPct <= 4 && signal === "buy") push(reason("notExtended"))
  }
  if (m.rangePos60 !== null && m.rangePos60 > 90) push(reason("atRangeTop"))
  if (m.rsi14 !== null && m.rsi14 < 38 && changePct !== null && changePct > 0) push(reason("oversoldBounce"))

  // ---------- style fits ----------
  const styleFits = computeStyleFits({
    signal, changePct, rsi: m.rsi14, ema20: m.ema20, ema50: m.ema50,
    lastClose, macdHist: m.macdHist, relVol: m.relVol, obvSlope20: m.obvSlope20,
    rangePos60: m.rangePos60, dailyVolPct: m.dailyVolPct, ema20SlopeUp,
    volumePresent: m.relVol !== null,
  })

  // ---------- deterministic trade plan (entry / stop / target zones) ----------
  const tradePlan = signal !== null && lastClose !== null
    ? buildTradePlan({ signal, lastClose, closes, atrPct: null })
    : null

  return {
    version: SIGNALS_VERSION,
    score: finalScore,
    signal,
    dimensions: dims,
    reasons,
    styleFits,
    invalidation: null, // close-only engine has no reliable level map — full bundle supplies it
    tradePlan,
    limitations,
    sessions,
    lastClose,
    asOf,
    changePct,
    metrics: m,
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
// Style checklists — the SAME facts evaluated per trading horizon.
// ---------------------------------------------------------------------------

function computeStyleFits(x: {
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
}): StyleFit[] {
  const fits: StyleFit[] = []

  // --- day (short horizon): needs liquidity + an active session ---
  if (x.volumePresent && x.relVol !== null) {
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
// Entry point 2 — per-company stance from the FULL technical snapshot.
// Same weight table, richer evidence (real OHLC, structure, VSA, levels).
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
      limitations: ["No daily price history is stored for this company yet."],
    }
  }

  const t = snap.trend
  const mo = snap.momentum
  const v = snap.volume
  const vol = snap.volatility

  // ---------- TREND — EMA facts (same 8/7/8/7 component scale as the close
  // engine; ema200 may be absent — score what's present, defensively) ----------
  let trendEarned = 0
  let trendMax = 0
  const emaAvailable = t.ema20 !== null
  // price vs the short average — drives the flat-tape invalidation and reasons
  let priceAboveShort: boolean | null = null
  if (t.ema20 !== null) {
    trendMax += 8
    priceAboveShort = last > t.ema20
    if (priceAboveShort) trendEarned += 8
  }
  if (t.ema50 !== null) {
    trendMax += 7
    if (last > t.ema50) trendEarned += 7
  }
  if (t.ema20 !== null && t.ema50 !== null) {
    trendMax += 8
    if (t.ema20 > t.ema50) trendEarned += 8
  }
  if (t.ema200 !== null) {
    trendMax += 7
    if (last > t.ema200) trendEarned += 7
  }
  // No EMA series exists on a point snapshot — the 20-EMA slope is UNKNOWN,
  // never guessed from price stance (the @2 SMA-flag proxy is gone).

  // ---------- MOMENTUM ----------
  let momEarned = 0
  let momMax = 0
  if (mo.rsi14 !== null) {
    momMax += 10
    momEarned += rsiBandPoints(mo.rsi14) // @3 shared bands
  }
  if (mo.macd.histogram !== null && mo.macd.macd !== null) {
    momMax += 10
    momEarned += macdPoints(mo.macd.macd, mo.macd.histogram)
  }
  if (mo.stochastic.k !== null && mo.stochastic.d !== null) {
    momMax += 10
    const { k, d } = mo.stochastic
    const pts = k > d && k >= 30 && k <= 75 ? 10 : k > d ? 7 : k < 20 ? 5 : 3
    momEarned += pts
  }

  // ---------- VOLUME (signal-day direction = perf.d1, same bands as close engine) ----------
  let volEarned = 0
  let volMax = 0
  if (v.obvSlope20 !== null) {
    volMax += 10; if (v.obvSlope20 > 0) volEarned += 8 // accumulation alone is 8, not 10
  }
  if (v.relVol !== null && snap.perf.d1 !== null) {
    volMax += 10
    volEarned += relVolBandPoints(v.relVol, snap.perf.d1 > 0)
  }

  // ---------- RISK ----------
  let riskEarned = 0
  let riskMax = 0
  const extBase = t.ema20 // the risk band is defined against the short EMA; null → check excluded
  if (extBase !== null && extBase > 0) {
    riskMax += 8
    riskEarned += extensionPoints(((last - extBase) / extBase) * 100)
  }
  if (vol.atrPct !== null) {
    riskMax += 7
    riskEarned += dailyVolPoints(vol.atrPct)
  }

  const dims: SignalDim[] = [
    { key: "trend" as const, earned: trendEarned, max: trendMax },
    { key: "momentum" as const, earned: momEarned, max: momMax },
    { key: "volume" as const, earned: volEarned, max: volMax },
    { key: "risk" as const, earned: riskEarned, max: riskMax },
  ]
  // @3: shared finalize — dims without evidence cap the ceiling (70/75)
  // instead of silently rescaling the score upward. No trend evidence at all
  // (trendMax 0) → no anchor → null score, matching the no-mapping rule.
  const { rawPct, allDimsStrong, volumeKnown, riskKnown } = rawWeightedPct(dims)
  const finalScore = rawPct !== null && trendMax > 0
    ? finalizeScore(rawPct, { volumeKnown, riskKnown, allDimsStrong, relVol: v.relVol })
    : null

  const trendShare = trendMax > 0 ? trendEarned / trendMax : null
  let signal: TechSignalType | null = null
  if (finalScore !== null && trendShare !== null) {
    const sellMomentum = mo.rsi14 !== null ? mo.rsi14 < SELL_RSI_MAX : (mo.macd.macd ?? 0) < 0
    if (finalScore >= BUY_SCORE && trendShare >= BUY_TREND_SHARE && (mo.rsi14 === null || mo.rsi14 <= BUY_RSI_MAX)) signal = "buy"
    else if (finalScore < SELL_SCORE && trendShare <= SELL_TREND_SHARE && sellMomentum) signal = "sell"
    else signal = "hold"
  }

  // ---------- invalidation level (nearest real level against the stance) ----------
  let invalidation: StanceInvalidation | null = null
  if (signal === "buy") {
    const sup = snap.levels.supports[0]
    if (sup) {
      invalidation = {
        side: "below", level: sup.price,
        labelAr: `الإبطال الفني للقراءة: كسر دعم ${sup.price} إغلاقًا.`,
        labelEn: `Technical invalidation: a close below the ${sup.price} support.`,
      }
    }
  } else if (signal === "hold" && priceAboveShort === true) {
    const sup = snap.levels.supports[0]
    if (sup) {
      invalidation = {
        side: "below", level: sup.price,
        labelAr: `تفقد القراءة قوتها تحت دعم ${sup.price}.`,
        labelEn: `The read weakens below the ${sup.price} support.`,
      }
    }
  } else if (signal === "sell") {
    const res = snap.levels.resistances[0]
    if (res) {
      invalidation = {
        side: "above", level: res.price,
        labelAr: `تتغير القراءة فوق مقاومة ${res.price}.`,
        labelEn: `The read changes above the ${res.price} resistance.`,
      }
    }
  }

  // ---------- reasons ----------
  const reasons: SignalReason[] = []
  const push = (r: SignalReason) => { if (reasons.length < 4 && !reasons.some((x) => x.code === r.code)) reasons.push(r) }
  // EMA wording only — mirrors what the trend dim actually scored. When NO EMA
  // fact exists (priceAboveShort null, short history) no trend reason is
  // pushed at all: an honest gap, disclosed in limitations. The 50/200 cross
  // reason appears only as a fallback when the short EMA is missing entirely.
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
  if (extBase !== null) {
    const extPct = ((last - extBase) / extBase) * 100
    // thresholds match the @3 risk bands: >8% scores 0 (extended), ≤4% scores full (not extended)
    if (extPct > 8) push(reason("extended"))
    else if (extPct <= 4 && signal === "buy") push(reason("notExtended"))
  }

  // ---------- style fits from full snapshot ----------
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
    rangePos60: null, // full path has zones instead; range check skipped
    dailyVolPct: vol.atrPct === null ? null : vol.atrPct,
    ema20SlopeUp: null, // point snapshot carries no EMA series — slope unknown, never guessed
    volumePresent: v.relVol !== null || v.obvSlope20 !== null,
  })

  if (snap.sparse) limitations.push("Sessions are sparse — oscillator readings are approximate.")
  if (snap.sessions < MIN_SESSIONS) limitations.push(`Only ${snap.sessions} sessions — several checks are excluded and missing evidence caps the score (no volume evidence → 70, no risk evidence → 75).`)
  if (!emaAvailable) limitations.push("Short EMA data unavailable — trend checks are excluded, not guessed.")
  if (trendMax <= 0) limitations.push("Trend checks could not be computed — no stance mapping.")

  return {
    version: SIGNALS_VERSION,
    score: finalScore,
    signal,
    dimensions: dims,
    reasons,
    styleFits,
    invalidation,
    tradePlan: signal !== null
      ? buildTradePlan({
          signal,
          lastClose: last,
          closes: [], // the snapshot carries levels, not raw bars — zones come from levels below
          supports: snap.levels.supports,
          resistances: snap.levels.resistances,
          atrPct: vol.atrPct ?? null,
        })
      : null,
    limitations,
  }
}
