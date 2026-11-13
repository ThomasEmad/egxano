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
//     computed is excluded from both earned and max (the score rescales), and
//     the limitation is disclosed.
//   • Every weight change requires bumping SIGNALS_VERSION.
//   • Two entry points share the same weight table and label maps:
//       - computeCloseSignal(): light close-based engine over MarketPrice
//         day-rows (the whole-market screen — close-only bars are the
//         documented precedent for the freshest sessions).
//       - computeStanceFromSnapshot(): the per-company reading from the FULL
//         TechnicalSnapshot (real OHLC, structure, VSA) used on the company
//         technical tab.
// =============================================================================

import { macd, perfN, rsi, sma, smaSeries } from "./indicators"
import type { TechnicalSnapshot } from "./analyze"

export const SIGNALS_VERSION = "tech-signals@1"

export type TechSignalType = "buy" | "hold" | "sell"

/** Trading styles the current setup fits — each is a separate horizon checklist. */
export type TechStyleTag = "day" | "swing" | "trend" | "reversal"

export const STYLE_TAG_META: Record<TechStyleTag, { ar: string; en: string }> = {
  day: { ar: "يومي", en: "Day" },
  swing: { ar: "سوينج", en: "Swing" },
  trend: { ar: "توجهي", en: "Trend" },
  reversal: { ar: "انعكاس", en: "Reversal" },
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
// Shared reason catalogue (bilingual) — reuse the exact line everywhere.
// ---------------------------------------------------------------------------

const R = {
  fullAlignmentUp: { code: "alignment_up", tone: "positive", ar: "السعر فوق SMA20 وSMA50 مع رصيف متوسطات صاعد.", en: "Price above SMA20 and SMA50 with a bullish moving-average stack." },
  fullAlignmentDown: { code: "alignment_down", tone: "negative", ar: "السعر تحت SMA20 وSMA50 مع رصيف متوسطات هابط.", en: "Price below SMA20 and SMA50 with a bearish moving-average stack." },
  aboveSma20: { code: "above_sma20", tone: "positive", ar: "السعر يتداول فوق متوسط 20 جلسة.", en: "Price is trading above its 20-session average." },
  belowSma20: { code: "below_sma20", tone: "negative", ar: "السعر يتداول تحت متوسط 20 جلسة.", en: "Price is trading below its 20-session average." },
  sma20SlopeUp: { code: "sma20_slope_up", tone: "positive", ar: "متوسط 20 جلسة مائل للصعود.", en: "The 20-session average is sloping up." },
  sma20SlopeDown: { code: "sma20_slope_down", tone: "negative", ar: "متوسط 20 جلسة مائل للهبوط.", en: "The 20-session average is sloping down." },
  macdBullish: { code: "macd_bullish", tone: "positive", ar: "MACD موجب مع هيستوجرام صاعد.", en: "MACD is positive with a rising histogram." },
  macdBearish: { code: "macd_bearish", tone: "negative", ar: "MACD سالب مع هيستوجرام هابط.", en: "MACD is negative with a falling histogram." },
  macdBullCross: { code: "macd_bull_cross", tone: "positive", ar: "تقاطع MACD فوق خط الإشارة (انعكاس مبكر محتمل).", en: "MACD crossing above its signal line (possible early reversal)." },
  macdBearCross: { code: "macd_bear_cross", tone: "negative", ar: "تقاطع MACD تحت خط الإشارة (انعكاس مبكر محتمل).", en: "MACD crossing below its signal line (possible early reversal)." },
  rsiNeutralUp: { code: "rsi_neutral_up", tone: "positive", ar: `RSI في منطقة الزخم الصحي (45-65) دون تشبع.`, en: "RSI sits in the healthy momentum band (45-65) without overextension." },
  rsiOverbought: { code: "rsi_overbought", tone: "negative", ar: "RSI في التشبع الشرائي — خطر تصحيح.", en: "RSI is overbought — correction risk." },
  rsiOversold: { code: "rsi_oversold", tone: "neutral", ar: "RSI في التشبع البيعي — مراقبة انعكاس.", en: "RSI is oversold — reversal watch." },
  obvUp: { code: "obv_up", tone: "positive", ar: "ميول تجميع في سلوك التداول (OBV صاعد).", en: "Accumulation tendency in volume behavior (OBV rising)." },
  obvDown: { code: "obv_down", tone: "negative", ar: "ميول توزيع في سلوك التداول (OBV هابط).", en: "Distribution tendency in volume behavior (OBV falling)." },
  volumeConfirmUp: { code: "volume_confirm", tone: "positive", ar: "حجم التداول مؤكد للحركة الصاعدة.", en: "Volume is confirming the upward move." },
  volumeChase: { code: "volume_chase", tone: "negative", ar: "حجم مرتفع جدًا — خطر مطاردة القمة.", en: "Volume is unusually high — chase-the-top risk." },
  notExtended: { code: "not_extended", tone: "positive", ar: "السعر ليس ممددًا فوق متوسطه القصير.", en: "Price is not extended above its short average." },
  extended: { code: "extended", tone: "negative", ar: "السعر ممدد بعيدًا فوق متوسط 20 جلسة — منطقة دخول سيئة.", en: "Price is stretched far above its 20-session average — poor entry zone." },
  stableVol: { code: "stable_vol", tone: "positive", ar: "تقلب يومي منضبط.", en: "Daily volatility is contained." },
  wildVol: { code: "wild_vol", tone: "negative", ar: "تقلب يومي مرتفع — مخاطرة سعرية كبيرة.", en: "Daily volatility is elevated — high price risk." },
  oversoldBounce: { code: "oversold_bounce", tone: "positive", ar: "أول إغلاق صاعد بعد تشبع بيعي.", en: "First positive close after an oversold reading." },
  atRangeTop: { code: "range_top", tone: "negative", ar: "السعر عند أعلى نطاق 60 جلسة.", en: "Price sits at the top of its 60-session range." },
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
    sma20: number | null
    sma50: number | null
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
    sma20: sma(closes, 20).value,
    sma50: sessions >= 50 ? sma(closes, 50).value : null,
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
  if (sessions < MIN_SESSIONS) limitations.push(`A full-score stance needs ${MIN_SESSIONS} sessions — dimensions with insufficient history are excluded and the score rescales.`)
  if (sessions < 50) limitations.push("SMA50 and slower structure checks are excluded below 50 sessions.")
  if (m.relVol === null) limitations.push("Volume history is too thin — volume checks are excluded.")
  if (medianGap(rows) > 7) limitations.push("Sessions are sparse (not daily) — oscillator readings are approximate.")

  // ---------- TREND (max 35 → rescaled over computable checks) ----------
  let trendEarned = 0
  let trendMax = 0
  if (m.sma20 !== null) {
    trendMax += 10
    const ok = lastClose !== null && lastClose > m.sma20
    if (ok) trendEarned += 10
  }
  if (m.sma50 !== null && lastClose !== null) {
    trendMax += 8
    const ok = lastClose > m.sma50
    if (ok) trendEarned += 8
  }
  if (m.sma20 !== null && m.sma50 !== null) {
    trendMax += 9
    const ok = m.sma20 > m.sma50
    if (ok) trendEarned += 9
  }
  const s20series = smaSeries(closes, 20)
  const s20Now = s20series[s20series.length - 1]
  const s20Prev = s20series[s20series.length - 6]
  let sma20SlopeUp: boolean | null = null
  if (s20Now !== null && s20Prev !== null && s20Prev > 0) {
    trendMax += 8
    sma20SlopeUp = s20Now > s20Prev
    if (sma20SlopeUp) trendEarned += 8
  }

  // ---------- MOMENTUM (max 30) ----------
  let momEarned = 0
  let momMax = 0
  if (m.rsi14 !== null) {
    momMax += 10
    let pts: number
    if (m.rsi14 >= 45 && m.rsi14 <= 65) pts = 10
    else if (m.rsi14 > 65 && m.rsi14 <= 70) pts = 6
    else if (m.rsi14 > 70) pts = 2
    else if (m.rsi14 >= 30 && m.rsi14 < 45) pts = (sma20SlopeUp === false ? 3 : 5)
    else pts = (sma20SlopeUp === false ? 3 : 6) // <30 oversold — contrarian credit only off a falling tape is small
    momEarned += pts
  }
  if (m.macdHist !== null && m.macdLine !== null) {
    momMax += 10
    // line + histogram together: above zero with rising hist is full credit
    const pts = m.macdLine > 0 && m.macdHist > 0 ? 10 : m.macdLine > 0 && m.macdHist <= 0 ? 5 : m.macdLine <= 0 && m.macdHist > 0 ? 7 : 1
    momEarned += pts
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
    const ok = m.obvSlope20 > 0
    if (ok) volEarned += 10
  }
  if (m.relVol !== null && changePct !== null) {
    volMax += 10
    let pts: number
    if (m.relVol >= 1.0 && m.relVol <= 3.0 && changePct > 0) pts = 10
    else if (m.relVol >= 0.7 && m.relVol < 1.0) pts = 5
    else if (m.relVol > 4) pts = 3
    else if (m.relVol < 0.5) pts = 4
    else if (changePct < 0 && m.relVol >= 1.5) pts = 2 // heavy down volume — distribution hint
    else pts = 6
    volEarned += pts
  }

  // ---------- RISK (max 15) ----------
  let riskEarned = 0
  let riskMax = 0
  if (m.sma20 !== null && lastClose !== null) {
    riskMax += 8
    const extPct = ((lastClose - m.sma20) / m.sma20) * 100
    const pts = extPct <= 8 ? 8 : extPct <= 15 ? 4 : 0
    riskEarned += pts
  }
  if (m.dailyVolPct !== null) {
    riskMax += 7
    const pts = m.dailyVolPct <= 4 ? 7 : m.dailyVolPct <= 7 ? 4 : 1
    riskEarned += pts
  }

  const dims = [
    { key: "trend" as const, earned: trendEarned, max: trendMax },
    { key: "momentum" as const, earned: momEarned, max: momMax },
    { key: "volume" as const, earned: volEarned, max: volMax },
    { key: "risk" as const, earned: riskEarned, max: riskMax },
  ]
  let score = 0
  let weightSum = 0
  for (const d of dims) {
    if (d.max <= 0) continue
    const w = SIGNAL_WEIGHTS[d.key]
    score += (d.earned / d.max) * w
    weightSum += w
  }
  const finalScore = weightSum > 0 ? Math.round((score / weightSum) * 100) : null

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
  const upStack = lastClose !== null && m.sma20 !== null && lastClose > m.sma20 && (m.sma50 === null || m.sma20 > m.sma50)
  const downStack = lastClose !== null && m.sma20 !== null && lastClose < m.sma20 && (m.sma50 === null || m.sma20 < m.sma50)
  if (upStack && m.sma50 !== null) push(reason("fullAlignmentUp"))
  else if (upStack) push(reason("aboveSma20"))
  else if (downStack && m.sma50 !== null) push(reason("fullAlignmentDown"))
  else if (downStack) push(reason("belowSma20"))
  if (sma20SlopeUp === true) push(reason("sma20SlopeUp"))
  else if (sma20SlopeUp === false) push(reason("sma20SlopeDown"))
  if (m.macdLine !== null && m.macdHist !== null) {
    if (m.macdLine > 0 && m.macdHist > 0) push(reason("macdBullish"))
    else if (m.macdLine < 0 && m.macdHist < 0) push(reason("macdBearish"))
    else if (m.macdHist > 0) push(reason("macdBullCross"))
    else push(reason("macdBearCross"))
  }
  if (m.rsi14 !== null) {
    if (m.rsi14 > 70) push(reason("rsiOverbought"))
    else if (m.rsi14 < 30) push(reason("rsiOversold"))
    else if (m.rsi14 >= 45 && m.rsi14 <= 65 && signal === "buy") push(reason("rsiNeutralUp"))
  }
  if (m.obvSlope20 !== null) push(m.obvSlope20 > 0 ? reason("obvUp") : reason("obvDown"))
  if (m.relVol !== null && changePct !== null) {
    if (m.relVol > 4) push(reason("volumeChase"))
    else if (m.relVol >= 1.0 && m.relVol <= 3.0 && changePct > 0) push(reason("volumeConfirmUp"))
  }
  if (m.sma20 !== null && lastClose !== null) {
    const extPct = ((lastClose - m.sma20) / m.sma20) * 100
    if (extPct > 15) push(reason("extended"))
    else if (extPct <= 8 && signal === "buy") push(reason("notExtended"))
  }
  if (m.rangePos60 !== null && m.rangePos60 > 90) push(reason("atRangeTop"))
  if (m.rsi14 !== null && m.rsi14 < 38 && changePct !== null && changePct > 0) push(reason("oversoldBounce"))

  // ---------- style fits ----------
  const styleFits = computeStyleFits({
    signal, changePct, rsi: m.rsi14, sma20: m.sma20, sma50: m.sma50,
    lastClose, macdHist: m.macdHist, relVol: m.relVol, obvSlope20: m.obvSlope20,
    rangePos60: m.rangePos60, dailyVolPct: m.dailyVolPct, sma20SlopeUp,
    volumePresent: m.relVol !== null,
  })

  return {
    version: SIGNALS_VERSION,
    score: finalScore,
    signal,
    dimensions: dims,
    reasons,
    styleFits,
    invalidation: null, // close-only engine has no reliable level map — full bundle supplies it
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
    limitations,
    sessions: base.sessions,
    lastClose: base.lastClose,
    asOf: base.asOf,
    changePct: base.changePct,
    metrics: {
      rsi14: null, sma20: null, sma50: null, macdLine: null, macdHist: null, relVol: null,
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
  sma20: number | null
  sma50: number | null
  lastClose: number | null
  macdHist: number | null
  relVol: number | null
  obvSlope20: number | null
  rangePos60: number | null
  dailyVolPct: number | null
  sma20SlopeUp: boolean | null
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
  if (x.lastClose !== null && x.sma20 !== null) {
    let earned = 0
    const checks: boolean[] = []
    checks.push(x.lastClose !== null && x.sma20 !== null && x.lastClose > x.sma20); if (checks[0]) earned++
    checks.push(x.sma50 === null ? false : x.sma20 > x.sma50); if (checks[1]) earned++
    checks.push(x.rsi !== null && x.rsi >= 40 && x.rsi <= 75); if (checks[2]) earned++
    checks.push(x.rangePos60 !== null && x.rangePos60 >= 25 && x.rangePos60 <= 85); if (checks[3]) earned++
    checks.push(x.macdHist !== null && x.macdHist > 0); if (checks[4]) earned++
    checks.push(x.signal === "buy" || (x.signal === "hold" && (x.sma20SlopeUp ?? false))); if (checks[5]) earned++
    fits.push({ tag: "swing", earned, total: checks.length })
  }

  // --- trend (multi-week position): durability of the uptrend ---
  if (x.sma50 !== null) {
    let earned = 0
    const checks: boolean[] = []
    checks.push(x.lastClose !== null && x.lastClose > x.sma50); if (checks[0]) earned++
    checks.push(x.sma20SlopeUp === true); if (checks[1]) earned++
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
      reasons: [], styleFits: [], invalidation: null,
      limitations: ["No daily price history is stored for this company yet."],
    }
  }

  const t = snap.trend
  const mo = snap.momentum
  const v = snap.volume
  const vol = snap.volatility

  // ---------- TREND ----------
  let trendEarned = 0
  let trendMax = 0
  const sma20ok = t.priceVsSma20 === "above"
  const sma50ok = t.priceVsSma50 === "above"
  const sma200ok = t.priceVsSma200 === "above"
  trendMax += 10; if (sma20ok) trendEarned += 10
  if (t.sma50 !== null) { trendMax += 8; if (sma50ok) trendEarned += 8 }
  if (t.sma200 !== null) { trendMax += 9; if (sma200ok) trendEarned += 9 }
  trendMax += 9; if (t.sma20VsSma50 === "above") trendEarned += 9
  let slopeUp: boolean | null = null
  if (t.sma20 !== null && t.sma50 !== null) slopeUp = sma20ok // proxy: stance of price vs its short average
  if (t.alignment === "aligned_uptrend") { trendMax += 4; trendEarned += 4 }
  else if (t.alignment === "aligned_downtrend") { trendMax += 4 }

  // ---------- MOMENTUM ----------
  let momEarned = 0
  let momMax = 0
  if (mo.rsi14 !== null) {
    momMax += 10
    const r = mo.rsi14
    const pts = r >= 45 && r <= 65 ? 10 : r > 65 && r <= 70 ? 6 : r > 70 ? 2 : r >= 30 && r < 45 ? 5 : 6
    momEarned += pts
  }
  if (mo.macd.histogram !== null && mo.macd.macd !== null) {
    momMax += 10
    const { macd: line, histogram } = mo.macd
    const pts = line > 0 && histogram > 0 ? 10 : line > 0 && histogram < 0 ? 5 : line < 0 && histogram > 0 ? 7 : 1
    momEarned += pts
  }
  if (mo.stochastic.k !== null && mo.stochastic.d !== null) {
    momMax += 10
    const { k, d } = mo.stochastic
    const pts = k > d && k >= 30 && k <= 75 ? 10 : k > d ? 7 : k < 20 ? 5 : 3
    momEarned += pts
  }

  // ---------- VOLUME ----------
  let volEarned = 0
  let volMax = 0
  if (v.obvSlope20 !== null) {
    volMax += 10; if (v.obvSlope20 > 0) volEarned += 10
  }
  if (v.relVol !== null) {
    volMax += 10
    const rel = v.relVol
    const pts = rel >= 1 && rel <= 3 ? 10 : rel >= 0.7 && rel < 1 ? 5 : rel > 4 ? 3 : rel < 0.5 ? 4 : 6
    volEarned += pts
  }

  // ---------- RISK ----------
  let riskEarned = 0
  let riskMax = 0
  if (t.sma20 !== null) {
    riskMax += 8
    const extPct = ((last - t.sma20) / t.sma20) * 100
    riskEarned += extPct <= 8 ? 8 : extPct <= 15 ? 4 : 0
  }
  if (vol.atrPct !== null) {
    riskMax += 7
    riskEarned += vol.atrPct <= 3 ? 7 : vol.atrPct <= 5.5 ? 4 : 1
  }

  const dims = [
    { key: "trend" as const, earned: trendEarned, max: trendMax },
    { key: "momentum" as const, earned: momEarned, max: momMax },
    { key: "volume" as const, earned: volEarned, max: volMax },
    { key: "risk" as const, earned: riskEarned, max: riskMax },
  ]
  let score = 0
  let weightSum = 0
  for (const d of dims) {
    if (d.max <= 0) continue
    const w = SIGNAL_WEIGHTS[d.key]
    score += (d.earned / d.max) * w
    weightSum += w
  }
  const finalScore = weightSum > 0 ? Math.round((score / weightSum) * 100) : null

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
  } else if (signal === "hold" && sma20ok) {
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
  if (t.alignment === "aligned_uptrend") push(reason("fullAlignmentUp"))
  else if (t.alignment === "aligned_downtrend") push(reason("fullAlignmentDown"))
  else if (sma20ok) push(reason("aboveSma20"))
  else push(reason("belowSma20"))
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
  if (t.sma20 !== null) {
    const extPct = ((last - t.sma20) / t.sma20) * 100
    if (extPct > 15) push(reason("extended"))
    else if (extPct <= 8 && signal === "buy") push(reason("notExtended"))
  }

  // ---------- style fits from full snapshot ----------
  const styleFits = computeStyleFits({
    signal,
    changePct: snap.perf.d1,
    rsi: mo.rsi14,
    sma20: t.sma20,
    sma50: t.sma50,
    lastClose: last,
    macdHist: mo.macd.histogram,
    relVol: v.relVol,
    obvSlope20: v.obvSlope20,
    rangePos60: null, // full path has zones instead; range check skipped
    dailyVolPct: vol.atrPct === null ? null : vol.atrPct,
    sma20SlopeUp: slopeUp,
    volumePresent: v.relVol !== null,
  })

  if (snap.sparse) limitations.push("Sessions are sparse — oscillator readings are approximate.")
  if (snap.sessions < MIN_SESSIONS) limitations.push(`Only ${snap.sessions} sessions — several checks are excluded and the score rescales.`)

  return {
    version: SIGNALS_VERSION,
    score: finalScore,
    signal,
    dimensions: dims,
    reasons,
    styleFits,
    invalidation,
    limitations,
  }
}
