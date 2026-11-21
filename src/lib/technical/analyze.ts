// =============================================================================
// Technical snapshot assembler — deterministic reading of real daily OHLCV
// bars stored in PriceBar. This is the FACT LAYER the AI interprets; the model
// never computes indicators. Sessions are never synthesized: if history is
// short or sparse, the affected indicators return null with a reason and the
// limitations are surfaced to the user and the model.
// =============================================================================

import { createHash } from "node:crypto"
import { db } from "@/lib/db"
import {
  atr,
  bollinger,
  emaCrossType,
  emaSeries,
  emaTrendInfo,
  historicalVolatility,
  macd,
  onBalanceVolume,
  perfN,
  round,
  rsi,
  stochastic,
  supportResistance,
  volumeStats,
  type Bar,
} from "./indicators"
import { analyzeStructure, type StructureSnapshot } from "./structure"
import { effectiveEgxSessionDate } from "@/lib/market/egx-session"
import { loadUnifiedHistoryOne } from "@/lib/market/unified-candles"
// VSA and the analytical quality score were REMOVED from the assembled bundle
// per owner directive (technical@4): the tab no longer renders them and the
// market-intelligence framing replaced them. The types stay imported so the
// payload shape keeps tolerating `null` (older cached payloads / compat).
import type { VsaSnapshot } from "./vsa"
import { analyzeZones, type ZonesSnapshot } from "./zones"
import type { QualityScore } from "./quality"
import { computeSignalTrail, type TrailRead } from "./signals"

export const TECHNICAL_VERSION = "technical@5"

/** Keep the prompt/cache JSON compact and stable: round every float to 2 decimals. */
function roundReplacer(_key: string, value: unknown): unknown {
  if (typeof value === "number" && Number.isFinite(value)) return Math.round(value * 100) / 100
  return value
}

/** Bars requested from the DB (EMA200 + swing context + cross detection). */
const MAX_BARS = 400
/** Median session gap above which the series is "sparse" (not daily). */
const SPARSE_GAP_DAYS = 7
/** Minimum daily sessions for the oscillator family to be meaningful. */
const MIN_OSCILLATOR_BARS = 35
/** Calendar-day gap that ends a contiguous segment (EGX holiday clusters can
 *  reach ~2 weeks; anything wider is a DATA GAP, not a holiday). */
export const TRIM_GAP_DAYS = 14

/**
 * The longest contiguous DAILY suffix of a bar series: walk backward from the
 * last bar and cut at the first calendar gap wider than TRIM_GAP_DAYS.
 * COMI 2026-11-16: the stored series mixed ~60 sparse bars from 2016-2017
 * with the recent daily segment — indicators and the chart must read the
 * LIVE segment, not a decade-wide scatter. Returns [trimmed bars, cutCount].
 */
export function contiguousSuffix(bars: Bar[], maxGapDays = TRIM_GAP_DAYS): { bars: Bar[]; cut: number } {
  if (bars.length <= 1) return { bars, cut: 0 }
  let start = bars.length - 1
  while (start > 0) {
    const gapDays = (Date.parse(bars[start].ts) - Date.parse(bars[start - 1].ts)) / 86_400_000
    if (gapDays > maxGapDays) break
    start--
  }
  return { bars: bars.slice(start), cut: start }
}

/**
 * Calendar-anchored performance over N days: anchor = the latest bar at or
 * before (last − N calendar days), accepted only when it sits within a
 * bounded slack of the target — otherwise null. Index-based perfN on a
 * gapped series invents numbers (COMI showed "+469% in a week" across a
 * 9-year gap); a missing window must read "—" instead.
 */
export function perfByCalendarDays(bars: Bar[], days: number): number | null {
  if (bars.length < 2 || days <= 0) return null
  const last = bars[bars.length - 1]
  const lastT = Date.parse(last.ts)
  if (!Number.isFinite(lastT)) return null
  const target = lastT - days * 86_400_000
  let anchorIdx = -1
  for (let i = bars.length - 2; i >= 0; i--) {
    const t = Date.parse(bars[i].ts)
    if (Number.isFinite(t) && t <= target) {
      anchorIdx = i
      break
    }
  }
  if (anchorIdx < 0) return null
  const anchorT = Date.parse(bars[anchorIdx].ts)
  // slack: short windows tolerate a holiday cluster; long windows tolerate ~35%
  const slackDays = days <= 7 ? 6 : Math.max(10, days * 0.35)
  if ((target - anchorT) / 86_400_000 > slackDays) return null
  const base = bars[anchorIdx].close
  return base > 0 ? ((last.close - base) / base) * 100 : null
}

export interface TechSignal {
  code: string
  tone: "positive" | "negative" | "neutral"
  severity?: "warning" | "info"
  text: string
  textAr: string
}

/** Market/sector context section — injected by the market-intelligence layer.
 * Defined structurally here so the technical engine stays dependency-free. */
export interface MarketContextSection {
  available: boolean
  asOf: string | null
  marketRegime: string | null
  marketRegimeAr: string | null
  marketPulse: number | null
  breadth: { advancing: number; declining: number; unchanged: number; ratio: number | null } | null
  /** Whole-market share of tickers trading above each EMA (percent) —
   *  computed by the intelligence enrichment; null when it has not run. */
  aboveEma20: number | null
  aboveEma50: number | null
  aboveEma200: number | null
  sector: {
    name: string | null
    dayChangePct: number | null
    advancing: number | null
    declining: number | null
    turnoverSharePct: number | null
    turnoverShareDelta5d: number | null
  } | null
  relVolRankPct: number | null
  limitations: string[]
}

export interface TechnicalSnapshot {
  version: string
  available: boolean
  asOf: string | null // last session date
  sessions: number // valid sessions used
  firstSession: string | null
  lastClose: number | null
  currency: string
  sparse: boolean
  /** Number of corporate-action ex-dates the series was rebuilt across
   *  (bonus/split/cash/rights) — null when no adjustment was applied. */
  adjustedActions: number | null
  limitations: string[]
  perf: { d1: number | null; w1: number | null; m1: number | null; m3: number | null; m6: number | null; y1: number | null }
  /** Trend is EMA-first (technical@4): every exposed reading is EMA-based;
   *  SMA is kept strictly internal (e.g. Bollinger's middle band). */
  trend: {
    ema20: number | null
    ema50: number | null
    ema200: number | null
    priceVsEma20: string | null
    priceVsEma50: string | null
    priceVsEma200: string | null
    ema20VsEma50: string | null
    ema50VsEma200: string | null
    alignment: string | null
    cross50200: string | null // golden | death — EMA50/EMA200 cross
    cross50200Age: number | null
  }
  momentum: {
    rsi14: number | null
    macd: { macd: number | null; signal: number | null; histogram: number | null }
    stochastic: { k: number | null; d: number | null }
  }
  volume: {
    obv: number | null
    obvSlope20: number | null
    volMa20: number | null
    relVol: number | null
    /** length of the volume-complete suffix actually used (null = n/a) */
    volumeWindow: number | null
  }
  volatility: {
    atr14: number | null
    atrPct: number | null
    bollinger: { upper: number | null; middle: number | null; lower: number | null; widthPct: number | null; percentB: number | null }
    histVol20: number | null
  }
  levels: {
    supports: { price: number; touches: number; distPct: number }[]
    resistances: { price: number; touches: number; distPct: number }[]
  }
  structure: StructureSnapshot | null
  /** Removed per owner directive (technical@4) — always null; typed for
   *  payload compatibility with older cached payloads. */
  vsa: VsaSnapshot | null
  zones: ZonesSnapshot | null
  context: MarketContextSection | null
  /** Removed per owner directive (technical@4) — always null; typed for
   *  payload compatibility with older cached payloads. */
  quality: QualityScore | null
  /** Trailing raw signal reads (tech-signals@5) computed by the SAME
   *  close-series core the board engine uses — this is what lets the company
   *  tab apply the same hysteresis as the board and print the SAME reading
   *  on the same data. Additive, optional for payload compatibility. */
  trail?: TrailRead[] | null
  /** Observed 60-session range (replaces the removed 52-week block): the
   *  highest high / lowest low actually printed by the market over the last
   *  60 stored sessions, and where the last close sits inside that range
   *  (0 = at the low, 100 = at the high). Raw observed extremes only. */
  range60: { high: number | null; low: number | null; posPct: number | null; sessions: number }
  signals: TechSignal[]
}

/** Drop invalid observations — never repair or interpolate them. */
export function sanitizeBars(raw: { ts: Date | string; open: number; high: number; low: number; close: number; volume: number | null }[]): Bar[] {
  const out: Bar[] = []
  for (const b of raw) {
    const { open, high, low, close, volume } = b
    if (![open, high, low, close].every((x) => Number.isFinite(x) && x > 0)) continue
    if (high < low) continue
    if (close > high * 1.0001 || close < low * 0.9999) continue
    if (high < Math.max(open, close) * 0.9999 || low > Math.min(open, close) * 1.0001) continue
    out.push({
      ts: (b.ts instanceof Date ? b.ts.toISOString() : String(b.ts)).slice(0, 10),
      open,
      high,
      low,
      close,
      volume: volume !== null && Number.isFinite(volume) && volume >= 0 ? volume : null,
    })
  }
  return out
}

/** Median calendar gap between sessions in days. */
function medianGapDays(bars: Bar[]): number {
  const gaps: number[] = []
  for (let i = 1; i < bars.length; i++) {
    const a = new Date(bars[i - 1].ts + "T00:00:00Z").getTime()
    const b = new Date(bars[i].ts + "T00:00:00Z").getTime()
    gaps.push((b - a) / 86_400_000)
  }
  if (!gaps.length) return 0
  gaps.sort((x, y) => x - y)
  return gaps[Math.floor(gaps.length / 2)]
}

function technicalSignals(bars: Bar[], snap: Omit<TechnicalSnapshot, "signals" | "version" | "available" | "limitations">): TechSignal[] {
  const signals: TechSignal[] = []
  const last = snap.lastClose
  if (last === null) return signals

  // --- Trend (EMA family — the engine's primary trend lens) ---
  if (snap.trend.alignment === "aligned_uptrend") {
    signals.push({ code: "trend_aligned_up", tone: "positive", text: "Price, EMA20, EMA50 and EMA200 are stacked in a full bullish alignment.", textAr: "السعر متداول فوق EMA20 وEMA50 وEMA200 مع رصيف متوسطات صاعد متكامل." })
  } else if (snap.trend.alignment === "aligned_downtrend") {
    signals.push({ code: "trend_aligned_down", tone: "negative", text: "Price, EMA20, EMA50 and EMA200 are stacked in a full bearish alignment.", textAr: "السعر متداول تحت EMA20 وEMA50 وEMA200 مع رصيف متوسطات هابط متكامل." })
  }
  if (snap.trend.cross50200 === "golden" && (snap.trend.cross50200Age ?? 99) <= 15) {
    signals.push({ code: "golden_cross", tone: "positive", text: `Golden cross: EMA50 crossed above EMA200 ${snap.trend.cross50200Age} sessions ago.`, textAr: `تقاطع ذهبي: تجاوز EMA50 لـ EMA200 منذ ${snap.trend.cross50200Age} جلسة — إشارة صعود طويل المدى.` })
  } else if (snap.trend.cross50200 === "death" && (snap.trend.cross50200Age ?? 99) <= 15) {
    signals.push({ code: "death_cross", tone: "negative", text: `Death cross: EMA50 crossed below EMA200 ${snap.trend.cross50200Age} sessions ago.`, textAr: `تقاطع سفلي: هبوط EMA50 تحت EMA200 منذ ${snap.trend.cross50200Age} جلسة — إشارة ضغط بيعي طويل المدى.` })
  }

  // --- Momentum ---
  const r = snap.momentum.rsi14
  if (r !== null) {
    if (r >= 70) signals.push({ code: "rsi_overbought", tone: "negative", severity: "warning", text: `RSI(14) is overbought at ${r}.`, textAr: `مؤشر القوة النسبية RSI(14) في منطقة التشبع الشرائي عند ${r}.` })
    else if (r <= 30) signals.push({ code: "rsi_oversold", tone: "positive", text: `RSI(14) is oversold at ${r}.`, textAr: `مؤشر القوة النسبية RSI(14) في منطقة التشبع البيعي عند ${r}.` })
  }
  const h = snap.momentum.macd.histogram
  const m = snap.momentum.macd.macd
  if (h !== null && m !== null) {
    if (m > 0 && h > 0) signals.push({ code: "macd_positive", tone: "positive", text: "MACD is above zero with a positive histogram.", textAr: "مؤشر MACD فوق الصفر مع هيستوجرام موجب." })
    else if (m < 0 && h < 0) signals.push({ code: "macd_negative", tone: "negative", text: "MACD is below zero with a negative histogram.", textAr: "مؤشر MACD تحت الصفر مع هيستوجرام سالب." })
    else if (h > 0) signals.push({ code: "macd_bull_cross", tone: "positive", text: "MACD just crossed above its signal line while below zero (early reversal watch).", textAr: "تقاطع MACD فوق خط الإشارة وهو تحت الصفر (مراقبة انعكاس مبكر)." })
    else signals.push({ code: "macd_bear_cross", tone: "negative", text: "MACD just crossed below its signal line while above zero (early reversal watch).", textAr: "تقاطع MACD تحت خط الإشارة وهو فوق الصفر (مراقبة انعكاس مبكر)." })
  }

  // --- Volume ---
  const rel = snap.volume.relVol
  if (rel !== null) {
    if (rel >= 2) signals.push({ code: "volume_spike", tone: "neutral", text: `Volume is ${rel}× its 20-session average — unusual activity.`, textAr: `حجم التداول ${rel} ضعف متوسط 20 جلسة — نشاط غير معتاد.` })
    else if (rel <= 0.5) signals.push({ code: "volume_dry", tone: "neutral", text: `Volume is thin at ${rel}× its 20-session average.`, textAr: `حجم تداول ضعيف عند ${rel} ضعف متوسط 20 جلسة.` })
  }

  // --- Volatility / bands ---
  const bb = snap.volatility.bollinger
  const pB = bb.percentB
  if (pB !== null) {
    if (pB > 1) signals.push({ code: "bb_above_upper", tone: "negative", severity: "warning", text: "Close is above the upper Bollinger band (extended move).", textAr: "الإغلاق فوق النطاق العلوي لبولينجر (حركة ممددة)." })
    else if (pB < 0) signals.push({ code: "bb_below_lower", tone: "positive", text: "Close is below the lower Bollinger band (stretched downside).", textAr: "الإغلاق تحت النطاق السفلي لبولينجر (هبوط ممدد)." })
  }

  // --- Range position (60-session) — the deterministic range-position read
  //  lives in the signals layer (rangePos60 / atRangeTop); no 52-week signal
  //  is emitted here anymore (52-week fields were removed per owner directive).

  // --- Levels proximity ---
  const nearestRes = snap.levels.resistances[0]
  const nearestSup = snap.levels.supports[0]
  if (nearestRes && nearestRes.distPct > 0 && nearestRes.distPct <= 2) {
    signals.push({ code: "at_resistance", tone: "negative", text: `Price is pressing the ${nearestRes.price} resistance zone (${nearestRes.distPct}% away).`, textAr: `السعر يلامس منطقة المقاومة ${nearestRes.price} (${nearestRes.distPct}% بعيداً).` })
  }
  if (nearestSup && nearestSup.distPct < 0 && nearestSup.distPct >= -2) {
    signals.push({ code: "at_support", tone: "positive", text: `Price is sitting on the ${nearestSup.price} support zone (${nearestSup.distPct}% away).`, textAr: `السعر يقف على منطقة الدعم ${nearestSup.price} (${nearestSup.distPct}% بعيداً).` })
  }
  void bars
  return signals
}

export interface TechnicalBundle {
  snapshot: TechnicalSnapshot
  /** sha256 of the canonical snapshot JSON — part of the report cache identity */
  hash: string
  snapshotJson: string
  /** Adjusted daily candles (corporate-action continuity) for the client
   *  chart — compact, ascending, capped server-side before exposure. */
  candles: { t: string; o: number; h: number; l: number; c: number }[]
}

export interface RawPriceBarRow {
  ts: Date | string
  open: number
  high: number
  low: number
  close: number
  volume: number | null
}

export interface RawScannerRow {
  asOf: Date | string
  price: number
  volume: number | null
}

/** Pure merge of the session series into one daily series.
 *
 *  SAME-SOURCE MANDATE (2026-11-21): the history is the unified candle store
 *  (MarketCandle verified → provenance "yahoo"; legacy PriceBar fallback →
 *  "pricebar"). The scanner feed may touch ONLY the live, unsettled session —
 *  a close-only flat bar must never flatten or restate a settled candle
 *  (2026-11-14 audit; the 2026-11-21 AMES case made the rule absolute).
 *  Off-session (Fri/Sat) quotes are anchored onto the Sun–Thu session they
 *  restate and are skipped when that session is already settled.
 *
 *  STORED BARS ARE SANITIZED BEFORE THE MERGE: a degenerate imported row
 *  (0-valued OHLC from a partial import) must not occupy the day bucket —
 *  otherwise the anchored-skip would preserve it and the post-merge
 *  sanitizeBars would drop the session entirely (live incident: COMI lost
 *  its Thursday session exactly this way while ETEL kept it via the quote).
 */
export function mergeSessionSeries(
  priceBars: RawPriceBarRow[],
  scannerRows: RawScannerRow[],
  yahooBars: RawPriceBarRow[] | null,
  todaySession?: string,
): { bars: Bar[]; sourceByDay: Map<string, "yahoo" | "scanner" | "pricebar">; syntheticCount: number } {
  let syntheticCount = 0
  const today = todaySession ?? effectiveEgxSessionDate(new Date())
  const scannerByDay = new Map<string, Bar>()
  const anchoredFromOffSession = new Set<string>()
  for (const r of scannerRows) {
    const rawDay = (r.asOf instanceof Date ? r.asOf.toISOString() : new Date(r.asOf).toISOString()).slice(0, 10)
    const day = effectiveEgxSessionDate(r.asOf)
    if (day !== rawDay) anchoredFromOffSession.add(day)
    scannerByDay.set(day, {
      ts: day,
      open: r.price,
      high: r.price,
      low: r.price,
      close: r.price,
      volume: r.volume !== null && Number.isFinite(r.volume) && r.volume > 0 ? r.volume : null,
    })
    syntheticCount++
  }

  const byDay = new Map<string, Bar>()
  const sourceByDay = new Map<string, "yahoo" | "scanner" | "pricebar">()
  for (const b of priceBars) {
    // provenance read BEFORE sanitize (sanitizeBars returns the plain Bar
    // shape): unified candle rows are Yahoo-sourced (split-adjusted) — the
    // corporate-action engine's phase-1 de-adjustment keys on "yahoo"
    const prov = (b as RawPriceBarRow & { barSource?: string }).barSource === "candle" ? "yahoo" : "pricebar"
    for (const s of sanitizeBars([b])) {
      byDay.set(s.ts, s)
      sourceByDay.set(s.ts, prov)
    }
  }
  for (const [day, bar] of scannerByDay) {
    if (day !== today) continue // settled sessions keep their stored candle
    if (anchoredFromOffSession.has(day) && byDay.has(day)) continue
    byDay.set(day, bar)
    sourceByDay.set(day, "scanner")
  }

  const newestDay = [...byDay.keys()].sort().pop() ?? null
  if (yahooBars) {
    for (const b of yahooBars) {
      const day = (b.ts instanceof Date ? b.ts.toISOString() : new Date(b.ts).toISOString()).slice(0, 10)
      if (day === newestDay) continue // the freshest scanner row stays authoritative
      byDay.set(day, { ts: day, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume })
      sourceByDay.set(day, "yahoo")
      syntheticCount = Math.max(0, syntheticCount - 1)
    }
  }

  const merged = [...byDay.values()]
    .sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime())
    .slice(-MAX_BARS)
  return { bars: sanitizeBars(merged), sourceByDay, syntheticCount }
}

/** Build the technical snapshot from the unified candle store:
 *
 *   1. MarketCandle (verified) — THE history (owner same-source mandate
 *      2026-11-21): quality-gated daily OHLCV refreshed after every EGX
 *      close by the candles cron. Legacy PriceBar rows serve only companies
 *      the unified store does not cover at all.
 *   2. MarketPrice day-rows from the TradingView EGX scanner — for the LIVE,
 *      unsettled session only (close-only synthetic bar, disclosed via the
 *      snapshot limitations). Settled sessions are never restated.
 *
 * Nothing is fetched per-request anymore: the old on-demand Yahoo pull
 * duplicated ~2y of candles on every cold lambda and never fed any other
 * feature. Nothing new is written to the DB here. */
export async function buildTechnicalBundle(companyId: string, context: MarketContextSection | null = null): Promise<TechnicalBundle> {
  const raw = await loadUnifiedHistoryOne(companyId, new Date(0))

  // Scanner day-rows for the live-session overlay only — a recent window is
  // enough (older scanner rows can never touch a settled session anymore).
  const priceRows = await db.marketPrice.findMany({
    where: { companyId, sourceName: "TRADINGVIEW_SCANNER", isDemoData: false, price: { gt: 0 }, asOf: { gte: new Date(Date.now() - 7 * 86_400_000) } },
    orderBy: { asOf: "asc" },
    select: { asOf: true, price: true, volume: true },
  })

  const merged = mergeSessionSeries(raw, priceRows, null)
  // Contiguous-suffix trim: sparse ancient bars (COMI 2016-2017 scatter) must
  // never dilute the live reading — indicators and the chart read the LIVE
  // daily segment, and the trim is disclosed.
  const trimmed = contiguousSuffix(merged.bars)
  const bars = trimmed.bars
  // owner manual price override (2026-11-16): patched onto the last bar so the
  // chart, indicators and every level reflect the owner's value live
  try {
    const { getAdminPriceOverride, applyAdminPriceOverrideToLastBar } = await import("@/lib/market/price-override")
    const ov = await getAdminPriceOverride(companyId)
    if (ov) applyAdminPriceOverrideToLastBar(bars, ov)
  } catch {
    // best-effort — the feed remains the fallback
  }
  const trimNote =
    trimmed.cut > 0
      ? `${trimmed.cut} pre-gap session${trimmed.cut === 1 ? "" : "s"} before a >${TRIM_GAP_DAYS}-calendar-day data gap were excluded — the reading covers the contiguous daily segment only.`
      : null
  const sourceByDay = merged.sourceByDay
  let syntheticCount = merged.syntheticCount
  if (bars.length > 0) {
    // Corporate-action continuity: a bonus/split/cash ex-date mechanically
    // moves the price — without the rebuild below the series shows a fake
    // cliff (CANA 2026-11-12: −31.9% displayed for a real ≈ +2% session).
    // The pass normalizes the mixed-source series to raw terms, then applies
    // our own ex-date math — source-agnostic and Yahoo-independent.
    let adjustedBars = bars
    let eventsApplied: { exDateISO: string; actionType: string; factor: number }[] = []
    let eventsSkipped: { exDateISO: string; actionType: string; factor: number }[] = []
    try {
      const { applyCorporateActionAdjustments, loadCompanySeriesActions } = await import("@/lib/market/corporate-actions")
      const actions = await loadCompanySeriesActions(companyId, bars[0].ts, bars[bars.length - 1].ts)
      if (actions.length > 0) {
        const result = applyCorporateActionAdjustments(
          bars.map((b) => ({ ...b, source: sourceByDay.get(b.ts) ?? "pricebar" })),
          actions,
        )
        adjustedBars = result.bars.map(({ source: _s, ...rest }) => rest)
        eventsApplied = result.eventsApplied
        eventsSkipped = result.eventsSkipped
      }
    } catch {
      // Adjustment is best-effort — the raw series remains the honest fallback.
    }
    const bundle = assembleBundle(adjustedBars, context)
    if (eventsApplied.length > 0) {
      bundle.snapshot.adjustedActions = eventsApplied.length
      bundle.snapshot.limitations.push(
        `${eventsApplied.length} corporate-action ex-date${eventsApplied.length === 1 ? "" : "s"} (bonus/split/cash/rights) rescaled the series so ex-date mechanical moves are not read as market losses.`,
      )
    }
    if (eventsSkipped.length > 0) {
      const worst = eventsSkipped.reduce((a, b) => (Math.abs(b.factor - 1) > Math.abs(a.factor - 1) ? b : a))
      bundle.snapshot.limitations.push(
        `${eventsSkipped.length} recorded corporate-action event${eventsSkipped.length === 1 ? "" : "s"} with implausible terms (implied mechanical repricing ×${worst.factor.toFixed(2)}) were SKIPPED — the series stays raw rather than rescaled by a suspected data-entry error.`,
      )
    }
    if (trimNote) bundle.snapshot.limitations.push(trimNote)
    bundle.candles = adjustedBars.slice(-260).map((b) => ({ t: b.ts, o: b.open, h: b.high, l: b.low, c: b.close }))
    // Honest disclosure: how many of the trailing sessions are close-only
    // scanner bars (no intraday high/low), and whether the freshest bar is
    // intraday data from today's scanner pull.
    if (syntheticCount > 0) {
      const lastBarDay = String(bars[bars.length - 1].ts).slice(0, 10)
      const today = new Date().toISOString().slice(0, 10)
      bundle.snapshot.limitations.push(
        `${syntheticCount} recent session${syntheticCount === 1 ? "" : "s"} use scanner close-only bars (no intraday high/low) — range-based indicators are approximated for those days.`,
      )
      if (lastBarDay === today) {
        bundle.snapshot.limitations.push(
          `The last bar is the current session's latest scanner price (${lastBarDay}), not a final close.`,
        )
      }
    }
    return bundle
  }

  const fallbackTrim = contiguousSuffix(sanitizeBars(raw))
  const fallback = fallbackTrim.bars
  const fallbackTrimNote =
    fallbackTrim.cut > 0
      ? `${fallbackTrim.cut} pre-gap session${fallbackTrim.cut === 1 ? "" : "s"} before a >${TRIM_GAP_DAYS}-calendar-day data gap were excluded — the reading covers the contiguous daily segment only.`
      : null
  const bundle = assembleBundle(fallback, context)
  if (fallbackTrimNote) bundle.snapshot.limitations.push(fallbackTrimNote)
  bundle.candles = fallback.slice(-260).map((b) => ({ t: b.ts, o: b.open, h: b.high, l: b.low, c: b.close }))
  return bundle
}

/** Pure assembly (also used by tests): bars must be ascending by ts.
 * `context` — optional market/sector section injected by the intelligence layer. */
export function assembleBundle(bars: Bar[], context: MarketContextSection | null = null): TechnicalBundle {
  const limitations: string[] = []
  const base: TechnicalSnapshot = {
    version: TECHNICAL_VERSION,
    available: bars.length > 0,
    asOf: bars.length ? bars[bars.length - 1].ts : null,
    sessions: bars.length,
    firstSession: bars.length ? bars[0].ts : null,
    lastClose: bars.length ? bars[bars.length - 1].close : null,
    currency: "EGP",
    sparse: false,
    adjustedActions: null,
    limitations,
    perf: { d1: null, w1: null, m1: null, m3: null, m6: null, y1: null },
    trend: {
      ema20: null, ema50: null, ema200: null,
      priceVsEma20: null, priceVsEma50: null, priceVsEma200: null,
      ema20VsEma50: null, ema50VsEma200: null, alignment: null,
      cross50200: null, cross50200Age: null,
    },
    momentum: { rsi14: null, macd: { macd: null, signal: null, histogram: null }, stochastic: { k: null, d: null } },
    volume: { obv: null, obvSlope20: null, volMa20: null, relVol: null, volumeWindow: null },
    volatility: { atr14: null, atrPct: null, bollinger: { upper: null, middle: null, lower: null, widthPct: null, percentB: null }, histVol20: null },
    levels: { supports: [], resistances: [] },
    structure: null,
    vsa: null, // removed per owner directive (technical@4) — kept typed-null for payload compat
    zones: null,
    context: null,
    quality: null, // removed per owner directive (technical@4) — kept typed-null for payload compat
    range60: { high: null, low: null, posPct: null, sessions: 0 },
    signals: [],
  }

  if (!bars.length) {
    limitations.push("No daily price history is stored for this company yet.")
    return finalize(base)
  }

  const closes = bars.map((b) => b.close)
  const medianGap = medianGapDays(bars)
  const sparse = medianGap > SPARSE_GAP_DAYS
  base.sparse = sparse
  if (sparse) {
    limitations.push(`Stored sessions average one every ~${round(medianGap, 1)} calendar days — daily oscillators are suppressed because they would be misleading on non-daily data.`)
  }
  if (bars.length < MIN_OSCILLATOR_BARS) {
    limitations.push(`Only ${bars.length} sessions stored — several indicators require more history.`)
  }

  // --- Performance (calendar-anchored: a gapped window reads null, never a
  // fabricated number across a data gap; d1 stays the previous-session close) ---
  base.perf = {
    d1: perfN(closes, 1),
    w1: perfByCalendarDays(bars, 7),
    m1: perfByCalendarDays(bars, 30),
    m3: perfByCalendarDays(bars, 91),
    m6: perfByCalendarDays(bars, 182),
    y1: perfByCalendarDays(bars, 365),
  }

  // --- Trend (EMA-first: every exposed trend reading is EMA-based; SMA is
  //  internal-only from technical@4, e.g. Bollinger's middle band) ---
  const ti = emaTrendInfo(closes)
  const lastOfSeries = (series: (number | null)[]): number | null => (series.length ? (series[series.length - 1] ?? null) : null)
  base.trend = {
    ema20: lastOfSeries(emaSeries(closes, 20)),
    ema50: lastOfSeries(emaSeries(closes, 50)),
    ema200: lastOfSeries(emaSeries(closes, 200)),
    priceVsEma20: ti.priceVsEma20, priceVsEma50: ti.priceVsEma50, priceVsEma200: ti.priceVsEma200,
    ema20VsEma50: ti.ema20VsEma50, ema50VsEma200: ti.ema50VsEma200,
    alignment: ti.alignment,
    cross50200: emaCrossType(closes),
    cross50200Age: ti.crossAge50200,
  }

  // --- Oscillators (only on dense-enough daily data) ---
  if (!sparse && bars.length >= MIN_OSCILLATOR_BARS) {
    base.momentum.rsi14 = rsi(closes, 14).value
    base.momentum.macd = macd(closes)
    base.momentum.stochastic = stochastic(bars)
    base.volatility.atr14 = atr(bars, 14).value
    const lastClose = closes[closes.length - 1]
    base.volatility.atrPct = base.volatility.atr14 !== null && lastClose > 0 ? round((base.volatility.atr14 / lastClose) * 100, 2) : null
    base.volatility.bollinger = bollinger(closes, 20, 2)
    base.volatility.histVol20 = historicalVolatility(closes, 20).value
  } else if (sparse) {
    limitations.push("RSI, MACD, Stochastic, ATR, Bollinger and historical volatility require daily sessions.")
  }

  // --- Volume (volume-aware assembly: compute over the longest volume-complete
  // suffix of the series and DISCLOSE the window — never fabricate a baseline) ---
  let lastNullIdx = -1
  for (let i = bars.length - 1; i >= 0; i--) {
    if (bars[i].volume === null) {
      lastNullIdx = i
      break
    }
  }
  const volBars = bars.slice(lastNullIdx + 1)
  // H-04 remediation: raised minimum from 10 to 20 sessions. On illiquid EGX
  // names, 10 sessions may span months with gaps and produce unreliable OBV/
  // relVol. 20 sessions provides a more statistically meaningful baseline while
  // still allowing analysis for most actively traded names.
  if (volBars.length >= 20) {
    const obv = onBalanceVolume(volBars, 20)
    base.volume.obv = obv.obv
    base.volume.obvSlope20 = obv.slopeN
    const vs = volumeStats(volBars, 20)
    base.volume.volMa20 = vs.volMa
    base.volume.relVol = vs.relVol
    base.volume.volumeWindow = volBars.length
    if (volBars.length < bars.length) {
      limitations.push(`Volume indicators computed over the last ${volBars.length} sessions (the volume-complete window) — earlier sessions lack volume.`)
    }
  } else {
    limitations.push("Fewer than 20 volume-complete sessions — volume indicators are unavailable.")
  }

  // --- Levels ---
  const sr = supportResistance(bars, 5, 1.5, 4)
  base.levels = {
    supports: sr.supports.map(({ price, touches, distPct }) => ({ price, touches, distPct })),
    resistances: sr.resistances.map(({ price, touches, distPct }) => ({ price, touches, distPct })),
  }

  // --- 60-session observed range (replaces the removed 52-week block;
  //  raw printed highs/lows only, window disclosed when shorter than 60) ---
  const rangeBars = bars.slice(-60)
  const rangeHigh = round(Math.max(...rangeBars.map((b) => b.high)), 2)
  const rangeLow = round(Math.min(...rangeBars.map((b) => b.low)), 2)
  const rangeLastClose = closes[closes.length - 1]
  base.range60 = { high: rangeHigh, low: rangeLow, posPct: null, sessions: rangeBars.length }
  if (rangeBars.length < 60) limitations.push(`60-session range computed from ${rangeBars.length} sessions (less than 60).`)
  if (rangeHigh > rangeLow) {
    base.range60.posPct = round(((rangeLastClose - rangeLow) / (rangeHigh - rangeLow)) * 100, 2)
  }

  // --- Market structure (swing map, BOS/CHoCH, multi-timeframe) ---
  base.structure = analyzeStructure(bars)

  // --- Price action: Volume Spread Analysis — REMOVED per owner directive
  //  (technical@4). Always null; the type stays for payload compatibility.
  base.vsa = null

  // --- Supply & demand zones ---
  base.zones = analyzeZones(bars)

  // --- Market & sector context (injected; absent → scored as missing) ---
  base.context = context

  // --- Analytical quality score — REMOVED per owner directive (technical@4).
  //  Always null; the type stays for payload compatibility.
  base.quality = null

  // --- Deterministic signals ---
  const stripped: Omit<TechnicalSnapshot, "signals" | "version" | "available" | "limitations"> = {
    asOf: base.asOf, sessions: base.sessions, firstSession: base.firstSession,
    lastClose: base.lastClose, currency: base.currency, sparse: base.sparse, adjustedActions: base.adjustedActions,
    perf: base.perf, trend: base.trend, momentum: base.momentum, volume: base.volume,
    volatility: base.volatility, levels: base.levels,
    structure: base.structure, vsa: base.vsa, zones: base.zones, context: base.context, quality: base.quality,
    range60: base.range60,
  }
  base.signals = technicalSignals(bars, stripped)

  // --- Signal trail (tech-signals@5): trailing raw reads from the same
  //  close-series core as the board engine — the snapshot path's hysteresis
  //  input (computeStanceFromSnapshot applies enter/exit bands + min-hold). ---
  base.trail = computeSignalTrail(bars.map((b) => ({ ts: b.ts, close: b.close, volume: b.volume })))

  return finalize(base)
}

function finalize(snap: TechnicalSnapshot): TechnicalBundle {
  const snapshotJson = JSON.stringify(snap, roundReplacer)
  const hash = createHash("sha256").update(snapshotJson).digest("hex")
  return { snapshot: snap, hash, snapshotJson, candles: [] }
}
