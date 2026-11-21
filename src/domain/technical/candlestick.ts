// =============================================================================
// Candlestick module — classical Japanese-candle patterns on REAL OHLC.
// =============================================================================
// ABLATION MODULE (2026-11-14, docs/notes/backtest-ablation.md): an ADDITIVE
// evidence layer for the tech-signals@5 close engine — not a decision rule.
// computeCloseSignal maps the strongest context-gated pattern on the LAST bar
// to a CAPPED score delta (±4 max) and an Arabic evidence reason; every @5
// gate, weight, veto and the hysteresis state machine are untouched.
//
// DATA HONESTY (2026-11-14 data audit directive):
//   • Patterns are computed on REAL open/high/low/close only. Any bar with
//     open == high == low == close (the scanner's flat placeholder bars) is
//     SKIPPED — a flat bar carries no candle anatomy and is never a pattern.
//   • The module ABSTAINS (null) on thin history: fewer than
//     CANDLE_MIN_SESSIONS = 21 sessions (the volume context needs a 20-session
//     baseline, the trend gate needs an EMA20), or when the OHLC fields are
//     absent (close-only replay keeps working — evidence is silently omitted).
//
// CONTEXT GATES (each pattern carries all three, documented):
//   1. TREND — emaTrendInfo on the closes: "down" when price < EMA20 and
//      (EMA50 missing or price < EMA50), "up" mirrored, else "range".
//   2. LOCATION — indicators.supportResistance zones (wing 5, merge 1.5%):
//      "atSupport" / "atResistance" when the nearest zone sits within 2% of
//      the close. A matching zone adds +0.1 strength (cap 1).
//   3. VOLUME — session volume vs the mean of the PRIOR 20 sessions:
//      ratio < 0.7 WEAKENS the pattern (strength × 0.5, disclosed in
//      contextAr). Missing/unknown volume → no weakening, disclosed.
//
// PATTERN SET + BASE STRENGTH (before gates; multi-bar > single-bar priority):
//   doji 0.3 (neutral marker, never a directional delta) · hammer /
//   hanging-man / inverted-hammer / shooting-star 0.6 · bullish/bearish
//   engulfing 0.7 · morning/evening star 0.8 · three white soldiers /
//   three black crows 0.85.
//   Trend factor: gate agrees ×1, range context ×0.7, contradicts ×0.4
//   (three soldiers/crows: continuation lens — up ×1, range ×0.8, down ×0.7).
//
// SHAPE/CONTEXT NAMING: the same wick shape flips its classical name with the
// trend — a hammer shape at the bottom of a decline is a "hammer" (bullish);
// at the top of an advance it is a "hanging-man" (bearish); the star shape
// mirrored gives "shooting-star" (bearish) / "inverted-hammer" (bullish).
// =============================================================================

import { emaTrendInfo, supportResistance, type Bar, type PriceZone } from "./indicators"

export const CANDLESTICK_VERSION = "candlestick@1"

/** Minimum prefix length: EMA20 + a 20-session volume baseline. */
export const CANDLE_MIN_SESSIONS = 21
/** Nearest S/R zone within this % of the close counts as "at the zone". */
export const NEAR_ZONE_PCT = 2
/** Volume below this ratio vs the prior-20 mean weakens the pattern. */
export const VOLUME_WEAK_RATIO = 0.7
/** Flat-bar epsilon (scanner placeholders: O = H = L = C). */
const FLAT_EPS = 1e-9
/** Doji body ceiling as a share of the range. */
const DOJI_BODY_SHARE = 0.1

export type CandlePattern =
  | "doji"
  | "hammer"
  | "hanging_man"
  | "inverted_hammer"
  | "shooting_star"
  | "engulfing_bull"
  | "engulfing_bear"
  | "morning_star"
  | "evening_star"
  | "three_white_soldiers"
  | "three_black_crows"

export interface CandleRow {
  ts: string
  close: number
  volume: number | null
  /** REAL OHLC of the session — required; absent ⇒ the module abstains. */
  open?: number
  high?: number
  low?: number
}

export interface CandlePatternRead {
  pattern: CandlePattern
  tone: "bullish" | "bearish" | "neutral"
  /** 0..1 after the context gates (trend factor, location boost, volume weakening) */
  strength: number
  /** Arabic one-liner: WHY the pattern counts here, or why it is weakened */
  contextAr: string
  /** context detail (deterministic diagnostics) */
  context: {
    trend: "up" | "down" | "range"
    atSupport: boolean
    atResistance: boolean
    volumeRatio: number | null
    volumeWeakened: boolean
    trendFactor: number
  }
}

export interface CandleReadResult {
  available: boolean
  /** present when the module abstained */
  reason?: string
  /** strongest context-gated pattern on the LAST bar (null when none matches) */
  read: CandlePatternRead | null
}

interface Anatomy {
  open: number
  high: number
  low: number
  close: number
  body: number
  range: number
  upper: number
  lower: number
  flat: boolean
  bullishBody: boolean
}

function anatomyOf(b: { open?: number; high?: number; low?: number; close: number }): Anatomy | null {
  const o = b.open
  const h = b.high
  const l = b.low
  const c = b.close
  if (typeof o !== "number" || typeof h !== "number" || typeof l !== "number" || !Number.isFinite(o) || !Number.isFinite(h) || !Number.isFinite(l) || !Number.isFinite(c)) return null
  const body = Math.abs(c - o)
  const range = h - l
  return {
    open: o, high: h, low: l, close: c,
    body,
    range,
    upper: h - Math.max(o, c),
    lower: Math.min(o, c) - l,
    flat: range <= FLAT_EPS && body <= FLAT_EPS,
    bullishBody: c > o,
  }
}

function isDoji(a: Anatomy): boolean {
  return a.range > FLAT_EPS && a.body <= DOJI_BODY_SHARE * a.range
}

function isHammerShape(a: Anatomy): boolean {
  return !a.flat && a.range > FLAT_EPS && a.body > FLAT_EPS && a.lower >= 2 * a.body && a.upper <= a.body
}

function isStarShape(a: Anatomy): boolean {
  return !a.flat && a.range > FLAT_EPS && a.body > FLAT_EPS && a.upper >= 2 * a.body && a.lower <= a.body
}

/** Trend gate over the closes (emaTrendInfo — the engine's EMA lens). */
function trendOf(closes: number[]): "up" | "down" | "range" {
  const t = emaTrendInfo(closes)
  if (t.priceVsEma20 === "below" && (t.priceVsEma50 === null || t.priceVsEma50 === "below")) return "down"
  if (t.priceVsEma20 === "above" && (t.priceVsEma50 === null || t.priceVsEma50 === "above")) return "up"
  return "range"
}

/** Volume gate: session volume vs the mean of the PRIOR 20 sessions. */
function volumeRatioAt(rows: CandleRow[], i: number): number | null {
  const v = rows[i].volume
  if (v === null || !Number.isFinite(v) || v <= 0) return null
  const prior: number[] = []
  for (let j = i - 20; j < i; j++) {
    if (j < 0) return null // the full 20-session baseline must exist
    const pv = rows[j].volume
    if (pv !== null && Number.isFinite(pv) && pv > 0) prior.push(pv)
  }
  if (prior.length < 10) return null // thin volume history — unknown, disclosed
  const mean = prior.reduce((s, x) => s + x, 0) / prior.length
  if (!(mean > 0)) return null
  return v / mean
}

function zonesFor(rows: CandleRow[], i: number): { supports: PriceZone[]; resistances: PriceZone[] } {
  const bars: Bar[] = []
  for (let k = 0; k <= i; k++) {
    const a = anatomyOf(rows[k])
    if (!a || a.flat) continue
    bars.push({ ts: rows[k].ts, open: a.open, high: a.high, low: a.low, close: a.close, volume: rows[k].volume })
  }
  return supportResistance(bars, 5, 1.5, 4)
}

/** Trend factor for reversal-class patterns (want the OPPOSITE prior trend). */
function reversalTrendFactor(trend: "up" | "down" | "range", tone: "bullish" | "bearish"): number {
  const wants = tone === "bullish" ? "down" : "up"
  if (trend === wants) return 1
  if (trend === "range") return 0.7
  return 0.4
}

/**
 * Evaluate every classical pattern on bar `i` with prefix context rows[0..i].
 * Returns ALL matches (each with gated strength); the caller picks the
 * strongest (multi-bar > single-bar > doji, deterministic order).
 */
function matchesAt(rows: CandleRow[], i: number): CandlePatternRead[] {
  const n = i + 1
  if (n < CANDLE_MIN_SESSIONS) return []
  const a = anatomyOf(rows[i])
  const a1 = i >= 1 ? anatomyOf(rows[i - 1]) : null
  const a2 = i >= 2 ? anatomyOf(rows[i - 2]) : null
  if (!a || a.flat) return [] // flat placeholder bar — skip everything
  const closes = rows.slice(0, i + 1).map((r) => r.close)
  const trend = trendOf(closes)
  const { supports, resistances } = zonesFor(rows, i)
  const last = rows[i].close
  const nearSupport = supports.some((z) => z.price < last && ((last - z.price) / last) * 100 <= NEAR_ZONE_PCT)
  const nearResistance = resistances.some((z) => z.price > last && ((z.price - last) / last) * 100 <= NEAR_ZONE_PCT)
  const volRatio = volumeRatioAt(rows, i)
  const volWeakened = volRatio !== null && volRatio < VOLUME_WEAK_RATIO
  const volFactor = volWeakened ? 0.5 : 1
  const volNote = volRatio === null
    ? "، وحجم التداول غير متاح للتحقق"
    : volWeakened
      ? `، لكن الحجم ${volRatio.toFixed(2)}× فقط من متوسط 20 جلسة — الدليل مُضعَّف`
      : ""

  const out: CandlePatternRead[] = []
  const push = (
    pattern: CandlePattern,
    tone: "bullish" | "bearish" | "neutral",
    base: number,
    trendFactor: number,
    locationBoost: number,
    contextAr: string,
  ) => {
    const strength = Math.max(0, Math.min(1, base * trendFactor * volFactor + locationBoost))
    out.push({
      pattern,
      tone,
      strength: Math.round(strength * 1000) / 1000,
      contextAr,
      context: { trend, atSupport: nearSupport, atResistance: nearResistance, volumeRatio: volRatio === null ? null : Math.round(volRatio * 100) / 100, volumeWeakened: volWeakened, trendFactor },
    })
  }
  const locBull = nearSupport ? "، وقرب دعم مُختبر (دليل إضافي)" : ""
  const locBear = nearResistance ? "، وقرب مقاومة مُختبرة (دليل إضافي)" : ""
  const weakContext = "، وسياق الاتجاه الحالي لا يؤكد النمط (دليل مُضعَّف)"

  // ---- single-bar wick shapes (context names the pattern) ----
  if (isHammerShape(a)) {
    if (trend === "down" || nearSupport) {
      const f = trend === "down" ? 1 : 0.7
      push("hammer", "bullish", 0.6, f, nearSupport ? 0.1 : 0,
        `مطرقة بعد اتجاه هابط${locBull} — ذيل سفلي طويل يأكد رفض الأسعار الأدنى وشمعة انعكاس صاعدة${volNote}`)
    } else if (trend === "up") {
      push("hanging_man", "bearish", 0.6, 1, nearResistance ? 0.1 : 0,
        `الرجل المشنوقة بعد اتجاه صاعد${locBear} — ذيل سفلي طويل عند القمة: تحذير من توقف الزخم وتوزيع محتمل${volNote}`)
    } else {
      push("hammer", "bullish", 0.6, 0.4, nearSupport ? 0.1 : 0,
        `شكل مطرقة في نطاق عرضي بلا اتجاه سابق${locBull}${weakContext}${volNote}`)
    }
  }
  if (isStarShape(a)) {
    if (trend === "up" || nearResistance) {
      const f = trend === "up" ? 1 : 0.7
      push("shooting_star", "bearish", 0.6, f, nearResistance ? 0.1 : 0,
        `نجمة مطلقة بعد اتجاه صاعد${locBear} — ذيل علوي طويل يأكد رفض الأسعار الأعلى${volNote}`)
    } else if (trend === "down") {
      push("inverted_hammer", "bullish", 0.6, 1, nearSupport ? 0.1 : 0,
        `مطرقة مقلوبة بعد اتجاه هابط${locBull} — محاولة ارتداد تحتاج تأكيد إغلاق صاعد لاحق${volNote}`)
    } else {
      push("shooting_star", "bearish", 0.6, 0.4, nearResistance ? 0.1 : 0,
        `شكل نجمة مطلقة في نطاق عرضي بلا اتجاه سابق${locBear}${weakContext}${volNote}`)
    }
  }

  // ---- two-bar engulfing ----
  if (a1 && !a1.flat && a.bullishBody && !a1.bullishBody && a.open < a1.close && a.close > a1.open && a.body > a1.body) {
    const f = reversalTrendFactor(trend, "bullish")
    push("engulfing_bull", "bullish", 0.7, f, nearSupport ? 0.1 : 0,
      `شمعة احتوائية صاعدة تغلف جسم الشمعة الهابطة السابقة بالكامل${locBull} — ${trend === "down" ? "انعكاس ضغط الشراء بعد هبوط" : trend === "range" ? "استرداد داخل نطاق" : "استمرار صاعد متأخر (دليل أضعف)"}${volNote}`)
  }
  if (a1 && !a1.flat && !a.bullishBody && a1.bullishBody && a.open > a1.close && a.close < a1.open && a.body > a1.body) {
    const f = reversalTrendFactor(trend, "bearish")
    push("engulfing_bear", "bearish", 0.7, f, nearResistance ? 0.1 : 0,
      `شمعة احتوائية هابطة تغلف جسم الشمعة الصاعدة السابقة بالكامل${locBear} — ${trend === "up" ? "انعكاس ضغط البيع بعد صعود" : trend === "range" ? "فقدان السيطرة داخل نطاق" : "استمرار هابط متأخر (دليل أضعف)"}${volNote}`)
  }

  // ---- three-bar stars ----
  if (a2 && a1 && !a2.flat && !a1.flat) {
    const mid1 = (a2.open + a2.close) / 2
    if (!a2.bullishBody && a2.body >= 0.5 * a2.range && a1.body <= 0.5 * a2.body && a.bullishBody && a.close > mid1) {
      const f = reversalTrendFactor(trend, "bullish")
      push("morning_star", "bullish", 0.8, f, nearSupport ? 0.1 : 0,
        `نجمة الصباح: شمعة هابطة قوية ثم جسم صغير متردد ثم إغلاق صاعد فوق منتصف الجسم الأول${locBull} — نمط انعكاس صاعد من ثلاث شموع${volNote}`)
    }
    if (a2.bullishBody && a2.body >= 0.5 * a2.range && a1.body <= 0.5 * a2.body && !a.bullishBody && a.close < mid1) {
      const f = reversalTrendFactor(trend, "bearish")
      push("evening_star", "bearish", 0.8, f, nearResistance ? 0.1 : 0,
        `نجمة المساء: شمعة صاعدة قوية ثم جسم صغير متردد ثم إغلاق هابط تحت منتصف الجسم الأول${locBear} — نمط انعكاس هابط من ثلاث شموع${volNote}`)
    }
  }

  // ---- three-bar soldier/crow momentum ----
  if (a2 && a1 && !a2.flat && !a1.flat) {
    const trio = [a2, a1, a]
    const bodies = trio.map((x) => x.body)
    const maxBody = Math.max(...bodies)
    const opensInPrior = (x: Anatomy, p: Anatomy) => x.open <= p.close && x.open >= p.open
    const smallUpper = (x: Anatomy) => x.upper <= 0.5 * x.body
    if (
      trio.every((x) => x.bullishBody) && a.close > a1.close && a1.close > a2.close &&
      a.body >= 0.6 * maxBody && a1.body >= 0.6 * maxBody &&
      opensInPrior(a1, a2) && opensInPrior(a, a1) && smallUpper(a2) && smallUpper(a1) && smallUpper(a)
    ) {
      const f = trend === "up" ? 1 : trend === "range" ? 0.8 : 0.7
      push("three_white_soldiers", "bullish", 0.85, f, nearSupport ? 0.1 : 0,
        `ثلاثة جنود بيض: ثلاث إغلاقات صاعدة متتالية بأجسام قوية وفتحات داخل الأجسام السابقة — زخم شرائي متواصل${locBull}${volNote}`)
    }
    if (
      trio.every((x) => !x.bullishBody) && a.close < a1.close && a1.close < a2.close &&
      a.body >= 0.6 * maxBody && a1.body >= 0.6 * maxBody &&
      opensInPrior(a1, a2) && opensInPrior(a, a1) && (a2.lower <= 0.5 * a2.body) && (a1.lower <= 0.5 * a1.body) && (a.lower <= 0.5 * a.body)
    ) {
      const f = trend === "down" ? 1 : trend === "range" ? 0.8 : 0.7
      push("three_black_crows", "bearish", 0.85, f, nearResistance ? 0.1 : 0,
        `ثلاثة غربان سود: ثلاث إغلاقات هابطة متتالية بأجسام قوية وفتحات داخل الأجسام السابقة — زخم بيعي متواصل${locBear}${volNote}`)
    }
  }

  // ---- doji (neutral marker, evaluated last) ----
  if (isDoji(a)) {
    push("doji", "neutral", 0.3, 1, 0,
      `دوجي: جسم شبه معدوم (${(a.body / a.range * 100).toFixed(0)}% من المدى) — توازن وتردد بين المشترين والبائعين، لا اتجاه مستقل${volNote}`)
  }

  return out
}

/** Strongest context-gated pattern on the LAST bar (the engine's evidence).
 *  Pure and prefix-only. Priority: higher base class (3-bar > 2-bar >
 *  1-bar > doji), then earlier detection order on ties. */
export function readLastCandle(rows: CandleRow[]): CandleReadResult {
  const empty: CandleReadResult = { available: false, read: null }
  if (!rows || rows.length < CANDLE_MIN_SESSIONS) {
    return { ...empty, reason: `need ${CANDLE_MIN_SESSIONS} sessions with real OHLC, have ${rows?.length ?? 0}` }
  }
  const last = rows[rows.length - 1]
  if (typeof last.open !== "number" || typeof last.high !== "number" || typeof last.low !== "number") {
    return { ...empty, reason: "real OHLC missing on the last session — candlestick evidence abstains on close-only rows" }
  }
  const matches = matchesAt(rows, rows.length - 1)
  if (!matches.length) return { available: true, read: null }
  const order: CandlePattern[] = [
    "morning_star", "evening_star", "three_white_soldiers", "three_black_crows",
    "engulfing_bull", "engulfing_bear", "hammer", "hanging_man", "inverted_hammer", "shooting_star", "doji",
  ]
  const best = matches
    .map((m, k) => ({ m, k, cls: order.indexOf(m.pattern) }))
    .sort((x, y) => (y.m.strength - x.m.strength) || (x.cls - y.cls) || (x.k - y.k))[0]
  return { available: true, read: best.m }
}

/** Per-bar scan (tests/debug): evaluated with prefix context at every bar —
 *  each read at index i uses rows[0..i] only (no lookahead). */
export function scanCandlePatterns(rows: CandleRow[]): (CandlePatternRead | null)[] {
  const out: (CandlePatternRead | null)[] = []
  for (let i = 0; i < rows.length; i++) {
    const matches = matchesAt(rows, i)
    if (!matches.length) { out.push(null); continue }
    const best = matches.reduce((b, m) => (m.strength > b.strength ? m : b))
    out.push(best)
  }
  return out
}
