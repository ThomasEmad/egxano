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
  crossType,
  historicalVolatility,
  macd,
  onBalanceVolume,
  perfN,
  round,
  rsi,
  sma,
  stochastic,
  supportResistance,
  trendInfo,
  volumeStats,
  type Bar,
} from "./indicators"
import { analyzeStructure, type StructureSnapshot } from "./structure"
import { analyzeVsa, type VsaSnapshot } from "./vsa"
import { analyzeZones, type ZonesSnapshot } from "./zones"
import { scoreQuality, type QualityScore } from "./quality"

export const TECHNICAL_VERSION = "technical@2"

/** Keep the prompt/cache JSON compact and stable: round every float to 2 decimals. */
function roundReplacer(_key: string, value: unknown): unknown {
  if (typeof value === "number" && Number.isFinite(value)) return Math.round(value * 100) / 100
  return value
}

/** Bars requested from the DB (SMA200 + swing context + cross detection). */
const MAX_BARS = 400
/** Median session gap above which the series is "sparse" (not daily). */
const SPARSE_GAP_DAYS = 7
/** Minimum daily sessions for the oscillator family to be meaningful. */
const MIN_OSCILLATOR_BARS = 35

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
  pctAboveSma20: number | null
  pctAboveSma50: number | null
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
  trend: {
    sma20: number | null
    sma50: number | null
    sma100: number | null
    sma200: number | null
    priceVsSma20: string | null
    priceVsSma50: string | null
    priceVsSma200: string | null
    sma20VsSma50: string | null
    sma50VsSma200: string | null
    alignment: string | null
    cross50200: string | null // golden | death
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
  vsa: VsaSnapshot | null
  zones: ZonesSnapshot | null
  context: MarketContextSection | null
  quality: QualityScore | null
  high52w: number | null
  low52w: number | null
  fromHigh52wPct: number | null
  fromLow52wPct: number | null
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

  // --- Trend ---
  if (snap.trend.alignment === "aligned_uptrend") {
    signals.push({ code: "trend_aligned_up", tone: "positive", text: "Price, SMA20, SMA50 and SMA200 are stacked in a full bullish alignment.", textAr: "السعر والمتوسطات 20/50/200 مرصوفة في اتجاه صاعد متكامل." })
  } else if (snap.trend.alignment === "aligned_downtrend") {
    signals.push({ code: "trend_aligned_down", tone: "negative", text: "Price, SMA20, SMA50 and SMA200 are stacked in a full bearish alignment.", textAr: "السعر والمتوسطات 20/50/200 مرصوفة في اتجاه هابط متكامل." })
  }
  if (snap.trend.cross50200 === "golden" && (snap.trend.cross50200Age ?? 99) <= 15) {
    signals.push({ code: "golden_cross", tone: "positive", text: `Golden cross: SMA50 crossed above SMA200 ${snap.trend.cross50200Age} sessions ago.`, textAr: `تقاطع ذهبي: تجاوز متوسط 50 لمتوسط 200 منذ ${snap.trend.cross50200Age} جلسة.` })
  } else if (snap.trend.cross50200 === "death" && (snap.trend.cross50200Age ?? 99) <= 15) {
    signals.push({ code: "death_cross", tone: "negative", text: `Death cross: SMA50 crossed below SMA200 ${snap.trend.cross50200Age} sessions ago.`, textAr: `تقاطع سفلي: هبوط متوسط 50 تحت متوسط 200 منذ ${snap.trend.cross50200Age} جلسة.` })
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

  // --- 52-week context ---
  if (snap.fromHigh52wPct !== null && snap.fromHigh52wPct >= -5) {
    signals.push({ code: "near_52w_high", tone: "positive", text: `Trading within 5% of the 52-week high.`, textAr: "التداول ضمن 5% من أعلى قمة في 52 أسبوعاً." })
  }
  if (snap.fromLow52wPct !== null && snap.fromLow52wPct <= 5) {
    signals.push({ code: "near_52w_low", tone: "negative", text: `Trading within 5% of the 52-week low.`, textAr: "التداول ضمن 5% من أدنى قاع في 52 أسبوعاً." })
  }

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

/** Build the technical snapshot from the FRESHEST available bars:
 *
 *   1. stored PriceBar rows (deep history, frozen fallback),
 *   2. Yahoo daily bars on demand (full OHLC, ~2y — best-effort: Yahoo
 *      rate-limits datacenter IPs, so it may be unavailable),
 *   3. MarketPrice day-rows from the public TradingView EGX scanner
 *      (one row per company per UTC day, refreshed intraday by
 *      /api/v1/cron/market + the in-session stale kick) — these carry the
 *      LATEST session price, which is what makes the analysis run on the
 *      last updated price instead of a stale import. Synthetic bars are
 *      O=H=L=C (close-only): RSI/MACD/SMA are close-based; ATR/Bollinger
 *      lose the day range for those few days and that is disclosed via the
 *      snapshot limitations rather than hidden.
 *
 * Precedence per session day: scanner day-row > Yahoo bar > stored row for
 * the most recent day; Yahoo OHLC wins for older days where it exists (real
 * high/low beats the flat synthetic bar). Nothing new is written to the DB. */
export async function buildTechnicalBundle(companyId: string, context: MarketContextSection | null = null): Promise<TechnicalBundle> {
  const raw = await db.priceBar.findMany({
    where: { companyId },
    orderBy: { ts: "asc" },
    take: MAX_BARS,
    select: { ts: true, open: true, high: true, low: true, close: true, volume: true },
  })

  // Scanner day-rows: latest row per UTC day (intraday refreshes rewrite the
  // same day bucket, so rows are naturally one-per-day, but dedupe anyway).
  const priceRows = await db.marketPrice.findMany({
    where: { companyId, sourceName: "TRADINGVIEW_SCANNER", isDemoData: false, price: { gt: 0 } },
    orderBy: { asOf: "asc" },
    select: { asOf: true, price: true, volume: true },
  })
  let syntheticCount = 0
  const scannerByDay = new Map<string, Bar>()
  for (const r of priceRows) {
    const day = r.asOf.toISOString().slice(0, 10)
    scannerByDay.set(day, {
      ts: day, // Bar.ts is an ISO date string (UTC midnight of the session)
      open: r.price, high: r.price, low: r.price, close: r.price,
      // Real session volume from the scanner pull (post-migration); null keeps
      // the volume-aware assembly honest instead of inventing a value.
      volume: r.volume !== null && Number.isFinite(r.volume) && r.volume > 0 ? r.volume : null,
    })
    syntheticCount++
  }

  const byDay = new Map<string, Bar>()
  const sourceByDay = new Map<string, "yahoo" | "scanner" | "pricebar">()
  for (const b of raw) {
    const day = b.ts.toISOString().slice(0, 10)
    byDay.set(day, b as unknown as Bar)
    sourceByDay.set(day, "pricebar")
  }
  for (const [day, bar] of scannerByDay) {
    byDay.set(day, bar)
    sourceByDay.set(day, "scanner")
  }

  // Yahoo (when reachable) restores real OHLC for older days — but never
  // overrides the most recent day, whose scanner row is authoritative.
  // NOTE on adjustment semantics: Yahoo's chart `close` for EGX is ALREADY
  // split/bonus-adjusted while scanner/PriceBar rows are raw — tracked in
  // sourceByDay so the corporate-action pass below can normalize first.
  const newestDay = [...byDay.keys()].sort().pop() ?? null
  const { fetchRecentBarsForCompany } = await import("./live-bars")
  const live = await fetchRecentBarsForCompany(companyId)
  if (live && live.length >= 30) {
    for (const b of live) {
      const day = b.ts.toISOString().slice(0, 10)
      if (day === newestDay) continue // the freshest scanner row stays authoritative
      byDay.set(day, { ts: day, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume })
      sourceByDay.set(day, "yahoo")
      syntheticCount = Math.max(0, syntheticCount - 1)
    }
  }

  const merged = [...byDay.values()].sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime()).slice(-MAX_BARS)
  const bars = sanitizeBars(merged)
  if (bars.length > 0) {
    // Corporate-action continuity: a bonus/split/cash ex-date mechanically
    // moves the price — without the rebuild below the series shows a fake
    // cliff (CANA 2026-11-12: −31.9% displayed for a real ≈ +2% session).
    // The pass normalizes the mixed-source series to raw terms, then applies
    // our own ex-date math — source-agnostic and Yahoo-independent.
    let adjustedBars = bars
    let eventsApplied: { exDateISO: string; actionType: string; factor: number }[] = []
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

  const fallback = sanitizeBars(raw)
  const bundle = assembleBundle(fallback, context)
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
      sma20: null, sma50: null, sma100: null, sma200: null,
      priceVsSma20: null, priceVsSma50: null, priceVsSma200: null,
      sma20VsSma50: null, sma50VsSma200: null, alignment: null,
      cross50200: null, cross50200Age: null,
    },
    momentum: { rsi14: null, macd: { macd: null, signal: null, histogram: null }, stochastic: { k: null, d: null } },
    volume: { obv: null, obvSlope20: null, volMa20: null, relVol: null, volumeWindow: null },
    volatility: { atr14: null, atrPct: null, bollinger: { upper: null, middle: null, lower: null, widthPct: null, percentB: null }, histVol20: null },
    levels: { supports: [], resistances: [] },
    structure: null,
    vsa: null,
    zones: null,
    context: null,
    quality: null,
    high52w: null,
    low52w: null,
    fromHigh52wPct: null,
    fromLow52wPct: null,
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

  // --- Performance ---
  base.perf = {
    d1: perfN(closes, 1),
    w1: perfN(closes, 5),
    m1: perfN(closes, 21),
    m3: perfN(closes, 63),
    m6: perfN(closes, 126),
    y1: perfN(closes, 252),
  }

  // --- Trend (SMAs work whenever the window exists; sparse flag governs interpretation) ---
  const s20 = sma(closes, 20).value
  const s50 = sma(closes, 50).value
  const s100 = sma(closes, 100).value
  const s200 = sma(closes, 200).value
  const ti = trendInfo(closes)
  base.trend = {
    sma20: s20, sma50: s50, sma100: s100, sma200: s200,
    priceVsSma20: ti.priceVsSma20, priceVsSma50: ti.priceVsSma50, priceVsSma200: ti.priceVsSma200,
    sma20VsSma50: ti.sma20VsSma50, sma50VsSma200: ti.sma50VsSma200,
    alignment: ti.alignment,
    cross50200: crossType(closes),
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
  if (volBars.length >= 10) {
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
    limitations.push("Fewer than 10 volume-complete sessions — volume indicators are unavailable.")
  }

  // --- Levels ---
  const sr = supportResistance(bars, 5, 1.5, 4)
  base.levels = {
    supports: sr.supports.map(({ price, touches, distPct }) => ({ price, touches, distPct })),
    resistances: sr.resistances.map(({ price, touches, distPct }) => ({ price, touches, distPct })),
  }

  // --- 52-week context (needs ~252 sessions; use what exists, label honestly) ---
  const lastBars = bars.slice(-252)
  const highs = lastBars.map((b) => b.high)
  const lows = lastBars.map((b) => b.low)
  const lastClose = closes[closes.length - 1]
  base.high52w = round(Math.max(...highs), 2)
  base.low52w = round(Math.min(...lows), 2)
  if (lastBars.length < 200) limitations.push(`52-week high/low computed from ${lastBars.length} sessions (less than a full year).`)
  if (base.high52w !== null) base.fromHigh52wPct = round(((lastClose - base.high52w) / base.high52w) * 100, 2)
  if (base.low52w !== null && base.low52w > 0) base.fromLow52wPct = round(((lastClose - base.low52w) / base.low52w) * 100, 2)

  // --- Market structure (swing map, BOS/CHoCH, multi-timeframe) ---
  base.structure = analyzeStructure(bars)

  // --- Price action: Volume Spread Analysis (needs the volume window) ---
  base.vsa = volBars.length >= 32 ? analyzeVsa(bars) : { version: "vsa@1", available: false, baselineVolume: null, baselineWindow: 0, events: [], limitations: [], reason: "volume-complete window too short for VSA" }

  // --- Supply & demand zones ---
  base.zones = analyzeZones(bars)

  // --- Market & sector context (injected; absent → scored as missing) ---
  base.context = context

  // --- Analytical quality score (computed LAST; reads every section) ---
  base.quality = scoreQuality(
    { ...base, signals: [] },
    { contextPresent: !!context && context.available, contextComplete: !!context && context.available && !context.limitations.length },
  )

  // --- Deterministic signals ---
  const stripped: Omit<TechnicalSnapshot, "signals" | "version" | "available" | "limitations"> = {
    asOf: base.asOf, sessions: base.sessions, firstSession: base.firstSession,
    lastClose: base.lastClose, currency: base.currency, sparse: base.sparse, adjustedActions: base.adjustedActions,
    perf: base.perf, trend: base.trend, momentum: base.momentum, volume: base.volume,
    volatility: base.volatility, levels: base.levels,
    structure: base.structure, vsa: base.vsa, zones: base.zones, context: base.context, quality: base.quality,
    high52w: base.high52w, low52w: base.low52w, fromHigh52wPct: base.fromHigh52wPct, fromLow52wPct: base.fromLow52wPct,
  }
  base.signals = technicalSignals(bars, stripped)

  return finalize(base)
}

function finalize(snap: TechnicalSnapshot): TechnicalBundle {
  const snapshotJson = JSON.stringify(snap, roundReplacer)
  const hash = createHash("sha256").update(snapshotJson).digest("hex")
  return { snapshot: snap, hash, snapshotJson, candles: [] }
}
