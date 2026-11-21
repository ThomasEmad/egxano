// =============================================================================
// MarketContext — the "lived experience" input layer for the position review.
// Owner mandate (2026-11-18): «حلل سهمي» must read like a veteran who has
// traded EGX cycles, not an engine listing indicators. This contract is the
// single source of truth shared by the context computation and the narrative
// builder. EVERY field is honestly null when the data cannot support it —
// the narrative must never invent a number.
//
// IMPLEMENTATION NOTES (2026-11-18 context pass):
//   • Deterministic and pure: same (bars, metrics) ⇒ same context, no clock,
//     no randomness, no look-ahead (every module below is fed the full prefix
//     and is itself prefix-pure).
//   • Global honesty gate: below MIN_CONTEXT_BARS the WHOLE context is null.
//     A series too short to carry the smallest module reading (the
//     candlestick module's own 21-session minimum) cannot support ANY honest
//     reading of the "lived experience" — the review layer gets a coherent
//     context or nothing.
//   • Rolling EMA is computed HERE, seeded with the FIRST close (standard
//     k = 2/(period+1) smoothing) — deliberately not indicators.ts's SMA
//     seed: after the documented warm-up window the two conventions converge,
//     and the streak counters need a value defined from session 0 onward.
//   • Adapters: the technical modules are imported, NEVER edited. Bar
//     (signals/types) carries ts/OHLC/volume, so it maps structurally onto
//     AdxBar, DivergenceRow, CandleRow and the VSA bar without loss; the
//     divergence module computes its own RSI/MACD internally, so no indicator
//     series is fed in — only price rows with real OHLC (pivots read off the
//     real highs/lows, its documented preference).
// =============================================================================
import type { Bar } from "@/lib/signals/types"
import { computeAdx } from "@/lib/technical/adx"
import { readLastCandle, type CandlePattern, type CandleRow } from "@/lib/technical/candlestick"
import { detectDivergence, type DivergenceRow, type DivergenceSignal } from "@/lib/technical/divergence"
import { analyzeVsa, type VsaEvent } from "@/lib/technical/vsa"

/** Structural subset of the signal row's metrics — keeps the context builder
 *  decoupled from the row type while carrying exactly what it needs. */
export interface MetricsLike {
  rsi14: number | null
  ema20: number | null
  ema50: number | null
  atr14: number | null
  relVol: number | null
  rangePos60: number | null
}

export interface MarketContext {
  /** (close − low) / (high − low) × 100 of the LAST bar — where the day
   *  actually closed inside its own range. null when high === low. */
  closeLocationPct: number | null
  /** |close − open| / atr14 — candle body size in volatility units. */
  bodyVsAtr: number | null
  /** Upper shadow as % of the day's range — rejection from above. */
  upperShadowPct: number | null
  /** Lower shadow as % of the day's range — rejection from below. */
  lowerShadowPct: number | null
  /** Consecutive bullish closes ending at the last bar (close > prev close). */
  streakUp: number | null
  /** Consecutive bearish closes ending at the last bar. */
  streakDown: number | null
  /** (close − ema20) / atr14 — how stretched the price is off its line. */
  emaStretch20Atr: number | null
  /** (close − ema50) / atr14. */
  emaStretch50Atr: number | null
  /** Consecutive closes above their OWN day's EMA20 (rolling, computed over
   *  the bars — not the current value applied retroactively). */
  daysAboveEma20: number | null
  /** Consecutive closes below their OWN day's EMA50 (rolling). */
  daysBelowEma50: number | null
  /** relVol < 0.7 dry · < 1.3 normal · < 2.5 elevated · ≥ 2.5 spike. */
  volCharacter: "dry" | "normal" | "elevated" | "spike" | null
  /** RSI: <30 oversold · <45 weak · ≤55 neutral · <70 strong · ≥70 overbought. */
  rsiZone: "oversold" | "weak" | "neutral" | "strong" | "overbought" | null
  /** rangePos60 ≥ 90 — sitting on the top of the 60-session range. */
  nearRangeTop: boolean | null
  /** rangePos60 ≤ 10 — sitting on the bottom of the 60-session range. */
  nearRangeBottom: boolean | null
  /** (open − prevClose) / prevClose × 100 of the last bar, when |gap| ≥ 1%. */
  gapPct: number | null
  /** true = the LAST bar is a close-only scanner row (open/high/low mirror
   *  the close — never observed). Body/gap/shadow/range anatomy is
   *  UNVERIFIABLE on it: the narrative must refuse to invent it and should
   *  disclose the thinner data basis instead. */
  lastSynthetic: boolean
  /** Last ADX value (computeAdx) + strength: <20 weak · <25 developing · ≥25 strong. */
  adx: number | null
  adxStrength: "weak" | "developing" | "strong" | null
  /** Active RSI divergence inside the confirmation window (divergence.ts). */
  divergence: "bullish" | "bearish" | null
  /** Arabic name of the last detected candle pattern (candlestick.ts), e.g.
   *  «مطرقة» · «ابتلاع هابط» — null when the last bar carries no pattern. */
  candlePatternAr: string | null
  /** One Arabic sentence for the newest active VSA event (vsa.ts), or null. */
  vsaNoteAr: string | null
  /** Nearest «رقم مستدير» — the round-number floors/ceilings of EGX chatter —
   *  within ROUND_NEAR_PCT of the close: { level, distPct } (distPct ≥ 0,
   *  signed direction lives in the caller's arithmetic). Grid steps
   *  [0.25 · 0.5 · 1 · 2 · 2.5 · 5 · 10 · 20 · 25 · 50 · 100 · 200], the
   *  largest step ≤ 20% of the price wins; null when nothing is close enough
   *  (standing EXACTLY on the level reports distPct 0 — that is a fact too). */
  roundLevelNear: { level: number; distPct: number } | null
  /** Trailing flat stretch («التجميعة»): non-null when the CONSOL_WINDOW
   *  trailing closes spread ≤ CONSOL_TIGHT_PCT of the close; sessions counts
   *  how many consecutive trailing sessions the tightness has held (≥ window,
   *  capped), tightnessPct is the current spread. Null when the tape is
   *  moving — a «تجميعة» that isn't flat would be a lie. */
  consolidation: { sessions: number; tightnessPct: number } | null
  /** Mean volume of the last 5 sessions vs the 30-session baseline:
   *  ≥1.3 rising · ≤0.7 falling · else flat — «الفوليوم بيكلم قبل السعر». */
  volTrend5: "rising" | "falling" | "flat" | null
}

// ---------------------------------------------------------------------------
// Named thresholds — each with its owner doctrine. NO magic numbers below.
// ---------------------------------------------------------------------------

/** GLOBAL HONESTY GATE (owner doctrine, 2026-11-18): a context built on fewer
 *  than 21 sessions is noise pretending to be experience — the candle module's
 *  own CANDLE_MIN_SESSIONS is the smallest honest window in the codebase, so
 *  nothing below it may be narrated. Every field is null under this gate. */
const MIN_CONTEXT_BARS = 21
/** A streak needs a previous close to compare against. */
const STREAK_MIN_BARS = 2

/** Rolling-EMA periods (the engine's own lens lengths). */
const EMA20_PERIOD = 20
const EMA50_PERIOD = 50
/** OWNER DOCTRINE (warm-up): an EMA read before max(2×period, 30) sessions is
 *  a seed artifact, not market memory — stretch/streak counting starts only
 *  AFTER that many bars (a day at index i is countable iff i + 1 ≥ warm-up,
 *  i.e. the day itself is at least the warm-up-th session of the series). */
const EMA_WARMUP_FLOOR = 30
const emaWarmupBars = (period: number): number => Math.max(2 * period, EMA_WARMUP_FLOOR)
/** Resolved warm-ups: EMA20 → 40 countable days, EMA50 → 100. */
const EMA20_WARMUP_BARS = emaWarmupBars(EMA20_PERIOD)
const EMA50_WARMUP_BARS = emaWarmupBars(EMA50_PERIOD)

/** OWNER DOCTRINE (volume character): relVol < 0.7 is a dry tape (no
 *  participation), < 1.3 a normal day, < 2.5 elevated participation, and ≥ 2.5
 *  a SPIKE — the only band where "the market showed up" may be said aloud. */
const VOL_DRY_MAX = 0.7
const VOL_NORMAL_MAX = 1.3
const VOL_ELEVATED_MAX = 2.5

/** OWNER DOCTRINE (RSI zones): <30 oversold (a floor may form), <45 weak,
 *  ≤55 neutral (the honest middle), <70 strong, ≥70 overbought (a ceiling
 *  may form — never an automatic sell). Boundaries belong to the upper band:
 *  exactly 30 is weak, 45/55 neutral, 70 overbought. */
const RSI_OVERSOLD_MAX = 30
const RSI_WEAK_MAX = 45
const RSI_NEUTRAL_MAX = 55
const RSI_OVERBOUGHT_MIN = 70

/** OWNER DOCTRINE (60-session range position): ≥ 90 = pressing the top of the
 *  range (breakout pressure), ≤ 10 = pressed onto the bottom (capitulation
 *  zone). Between the two the price is just "inside its range" — no claim. */
const RANGE_TOP_MIN = 90
const RANGE_BOTTOM_MAX = 10

/** OWNER DOCTRINE (gaps): a sub-1% open is overnight drift, not information.
 *  Only a gap of 1% or more deserves a sentence; the value stays SIGNED so
 *  the narrative can say "gapped up" or "gapped down" honestly. */
const GAP_MIN_PCT = 1

/** OWNER DOCTRINE (ADX strength, per the contract): <20 weak (no trend worth
 *  respecting), <25 developing (a trend may be forming), ≥25 strong (the
 *  trend is a fact). NOTE: this intentionally differs from adx.ts's own
 *  strong/weak/none labels (its "none" = our "weak") — the review contract
 *  wants a three-band ladder, not a two-band one. */
const ADX_DEVELOPING_MIN = 20
const ADX_STRONG_MIN = 25

/** OWNER DOCTRINE (round levels, «الأرقام المستديرة», per the contract): EGX
 *  chatter quotes floors/ceilings on a step ladder that scales with the price
 *  — piaster tickers talk 0.25/0.5, mid-caps talk 1/2.5/5, heavyweights talk
 *  10/25/50. That ladder is below; a step may only be used while it stays
 *  ≤ 20% of the price (a 25-grid on a 3.4-pound stock would be nonsense), and
 *  the level must sit within 2% of the close to be worth a sentence. */
const ROUND_GRID_STEPS = [0.25, 0.5, 1, 2, 2.5, 5, 10, 20, 25, 50, 100, 200]
const ROUND_STEP_MAX_SHARE = 0.2
const ROUND_NEAR_PCT = 2

/** OWNER DOCTRINE (consolidation, «التجميعة», per the contract): a flat
 *  stretch is 5 sessions whose closes spread ≤ 3% of the close — tighter is a
 *  coiled spring, wider is just drift. The count walks backward while the
 *  trailing window keeps fitting inside the band, capped at 20: a 20-session
 *  base is the longest «تجميعة» the narrative may name as one stretch. */
const CONSOL_WINDOW = 5
const CONSOL_TIGHT_PCT = 3
const CONSOL_MAX_SESSIONS = 20

/** OWNER DOCTRINE (volume trend, «الفوليوم بيكلم قبل السعر», per the
 *  contract): mean volume of the last 5 sessions against the 30-session
 *  baseline right before them — ≥ 1.3× rising (participation arriving),
 *  ≤ 0.7× falling (the tape draining), else flat. Both windows must be
 *  complete: under 35 volume-carrying sessions, or over an all-zero baseline,
 *  the read is refused — a ratio without a denominator is an invented number. */
const VOL_TREND_RECENT_SESSIONS = 5
const VOL_TREND_BASELINE_SESSIONS = 30
const VOL_TREND_MIN_BARS = VOL_TREND_RECENT_SESSIONS + VOL_TREND_BASELINE_SESSIONS
const VOL_TREND_RISING_MIN = 1.3
const VOL_TREND_FALLING_MAX = 0.7

/** Arabic names of the classical candle patterns (candlestick.ts ids) — the
 *  review speaks about "النهاردة", so only the LAST session's pattern counts
 *  (readLastCandle implements exactly that). */
const CANDLE_PATTERN_AR: Record<CandlePattern, string> = {
  doji: "دوجي",
  hammer: "مطرقة",
  hanging_man: "الرجل المشنوق",
  inverted_hammer: "مطرقة مقلوبة",
  shooting_star: "النجمة المطلقة",
  engulfing_bull: "ابتلاع صاعد",
  engulfing_bear: "ابتلاع هابط",
  morning_star: "نجمة الصباح",
  evening_star: "نجمة المساء",
  three_white_soldiers: "ثلاثة جنود بيض",
  three_black_crows: "ثلاثة غربان سود",
}

const fin = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x)

/** Rolling EMA over the closes, seeded with the FIRST close (see header):
 *  ema[0] = close[0]; ema[i] = k·close[i] + (1−k)·ema[i−1], k = 2/(n+1).
 *  Defined from session 0 so the streak counters can walk to the warm-up
 *  boundary; values before the warm-up window are treated as seed artifacts
 *  and never surfaced. */
function rollingEma(closes: number[], period: number): number[] {
  const k = 2 / (period + 1)
  const out: number[] = [closes[0]]
  for (let i = 1; i < closes.length; i++) out.push(k * closes[i] + (1 - k) * out[i - 1])
  return out
}

/** Nearest «رقم مستدير» for one close — the contract's grid rule, resolved
 *  deterministically: the walk starts at the LARGEST ladder step ≤ 20% of the
 *  price and descends to finer grids, and the first step whose nearest
 *  multiple sits within ROUND_NEAR_PCT of the price wins — the coarsest
 *  honest level is the one reported (208.18 reports the 10-grid's 210, not
 *  the 0.25-grid's 208.25; descending is what keeps "the largest step wins"
 *  true among the grids that actually produce a nearby level). Halfway ties
 *  round UP to the level above (Math.round) — deterministic. Nothing within
 *  the band even at the finest step → null: no level, no sentence. Standing
 *  exactly on a level reports distPct 0 — that is a fact too. */
function nearestRoundLevel(price: number): { level: number; distPct: number } | null {
  let start = -1
  for (let i = ROUND_GRID_STEPS.length - 1; i >= 0; i--) {
    if (ROUND_GRID_STEPS[i] <= price * ROUND_STEP_MAX_SHARE) {
      start = i
      break
    }
  }
  if (start < 0) return null // even 0.25 exceeds 20% of the price — no honest grid
  for (let i = start; i >= 0; i--) {
    const step = ROUND_GRID_STEPS[i]
    const level = Math.round(price / step) * step
    const distPct = (Math.abs(price - level) / price) * 100
    if (distPct <= ROUND_NEAR_PCT) return { level, distPct }
  }
  return null
}

function emptyContext(): MarketContext {
  return {
    closeLocationPct: null,
    bodyVsAtr: null,
    upperShadowPct: null,
    lowerShadowPct: null,
    streakUp: null,
    streakDown: null,
    emaStretch20Atr: null,
    emaStretch50Atr: null,
    daysAboveEma20: null,
    daysBelowEma50: null,
    volCharacter: null,
    rsiZone: null,
    nearRangeTop: null,
    nearRangeBottom: null,
    gapPct: null,
    lastSynthetic: false,
    adx: null,
    adxStrength: null,
    divergence: null,
    candlePatternAr: null,
    vsaNoteAr: null,
    roundLevelNear: null,
    consolidation: null,
    volTrend5: null,
  }
}

/** ONE honest Arabic sentence per VSA event type — semantics lifted verbatim
 *  from vsa.ts's own documented definitions (its textAr carries the full
 *  disclosure; this is the one-line lived-experience version). Every event
 *  carries volRatio (module-rounded to 2dp), so the real number is named.
 *  All six codes of vsa.ts@1 are documented there — none is left unmapped.
 *  The follow-through fact (recovered/failed) is appended when present. */
function vsaNoteFor(ev: VsaEvent): string {
  const vol = ev.volRatio
  const base =
    ev.code === "selling_climax"
      ? `ذروة بيع: حجم ${vol}× المتوسط بعد هبوط وإغلاق أعلى النطاق — ينسجم مع ضغط بيع يتم امتصاصه`
      : ev.code === "buying_climax"
        ? `ذروة شراء: حجم ${vol}× المتوسط بعد صعود وإغلاق أسفل النطاق — ينسجم مع شراء قوي يقابله عرض`
        : ev.code === "stopping_volume"
          ? `حجم راجع: ${vol}× المتوسط في جلسة هابطة أغلقت أعلى نطاقها — ينسجم مع دخول طلب بعد الهبوط`
          : ev.code === "no_demand"
            ? `صعود بفوليوم ضعيف (${vol}× المتوسط فقط) — حركة غير موثوقة`
            : ev.code === "no_supply"
              ? `هبوط ضيق بحجم ${vol}× المتوسط فقط — ضغط بيع محدود`
              : `جهد كبير بلا نتيجة: حجم ${vol}× المتوسط مع جسم ضيق — ينسجم مع امتصاص عند المستوى`
  const ft =
    ev.followThrough === "recovered"
      ? " والجلسة التالية استعادت نطاق الشمعة"
      : ev.followThrough === "failed"
        ? " والجلسة التالية فشلت في استعادة النطاق"
        : ""
  return base + ft
}

/**
 * Real computation (2026-11-18 context pass). Every field is honestly null
 * when its own data cannot support it: the global MIN_CONTEXT_BARS gate,
 * per-field finite checks, division guards (high === low, atr14 null/0,
 * prevClose ≤ 0), and each technical module's own documented abstention
 * (ADX ≥ 28 sessions, divergence ≥ 30, candles ≥ 21, VSA ≥ its volume
 * baseline) surface as nulls — never as invented readings.
 */
export function buildMarketContext(_bars: readonly Bar[], _metrics: MetricsLike | null | undefined): MarketContext {
  const bars = _bars ?? []
  if (bars.length < MIN_CONTEXT_BARS) return emptyContext()
  const last = bars[bars.length - 1]
  const prev = bars.length >= 2 ? bars[bars.length - 2] : null
  const m = _metrics ?? null

  // ---- 1) last-bar anatomy ----
  // SYNTHETIC GUARD (2026-11-21, the AMES case): a close-only scanner row's
  // open mirrors its close — a "0.0 body" computed from it is MISSING DATA,
  // not a doji. On a synthetic last bar every anatomy reading below is
  // forced null; closes (streaks, EMAs, RSI) stay real and keep flowing.
  const lastSynthetic = last.synthetic === true
  const range = fin(last.high) && fin(last.low) ? last.high - last.low : NaN
  const hasRange = fin(range) && range > 0 // high === low (or crossed) → no anatomy
  const closeLocationPct = hasRange && fin(last.close) ? ((last.close - last.low) / range) * 100 : null
  const body = !lastSynthetic && fin(last.open) && fin(last.close) ? Math.abs(last.close - last.open) : null
  const upperShadow = fin(last.high) && fin(last.open) && fin(last.close) ? last.high - Math.max(last.open, last.close) : null
  const lowerShadow = fin(last.low) && fin(last.open) && fin(last.close) ? Math.min(last.open, last.close) - last.low : null
  const upperShadowPct = hasRange && upperShadow !== null ? (upperShadow / range) * 100 : null
  const lowerShadowPct = hasRange && lowerShadow !== null ? (lowerShadow / range) * 100 : null
  // atr14 must be a positive number — null or 0 cannot divide honestly
  const atr = m?.atr14 ?? null
  const atrOk = atr !== null && fin(atr) && atr > 0
  const bodyVsAtr = body !== null && atrOk ? body / (atr as number) : null

  // ---- 2) streaks (consecutive same-direction closes ending at the last bar)
  // An unchanged close ends BOTH streaks (it is neither bullish nor bearish);
  // a non-finite close stops the walk — the count so far is the verifiable one.
  let streakUp: number | null = null
  let streakDown: number | null = null
  if (bars.length >= STREAK_MIN_BARS && prev !== null) {
    streakUp = 0
    streakDown = 0
    for (let i = bars.length - 1; i >= 1; i--) {
      const c = bars[i].close
      const p = bars[i - 1].close
      if (!fin(c) || !fin(p)) break
      if (c > p) {
        if (streakDown > 0) break
        streakUp++
      } else if (c < p) {
        if (streakUp > 0) break
        streakDown++
      } else {
        break
      }
    }
  }

  // ---- 3) rolling EMA — stretch + days-above/below, warm-up gated
  // (the EMA chain needs every close finite; one corrupt close poisons it)
  let emaStretch20Atr: number | null = null
  let emaStretch50Atr: number | null = null
  let daysAboveEma20: number | null = null
  let daysBelowEma50: number | null = null
  if (bars.every((b) => fin(b.close))) {
    const closes = bars.map((b) => b.close)
    const ema20 = rollingEma(closes, EMA20_PERIOD)
    const ema50 = rollingEma(closes, EMA50_PERIOD)
    const n = bars.length
    // stretch needs the LAST EMA past its warm-up (a seed value is not a line)
    if (atrOk && n >= EMA20_WARMUP_BARS) emaStretch20Atr = (closes[n - 1] - ema20[n - 1]) / (atr as number)
    if (atrOk && n >= EMA50_WARMUP_BARS) emaStretch50Atr = (closes[n - 1] - ema50[n - 1]) / (atr as number)
    // streak counting starts at the first warm session (index warmUp − 1);
    // a tie (close === own-day EMA) is NOT above/below and ends the streak
    if (n >= EMA20_WARMUP_BARS) {
      let c = 0
      for (let i = n - 1; i >= EMA20_WARMUP_BARS - 1; i--) {
        if (closes[i] > ema20[i]) c++
        else break
      }
      daysAboveEma20 = c
    }
    if (n >= EMA50_WARMUP_BARS) {
      let c = 0
      for (let i = n - 1; i >= EMA50_WARMUP_BARS - 1; i--) {
        if (closes[i] < ema50[i]) c++
        else break
      }
      daysBelowEma50 = c
    }
  }

  // ---- 4) volume character / RSI zone / range position (metric-derived)
  const relVol = m?.relVol ?? null
  const volCharacter: MarketContext["volCharacter"] =
    relVol !== null && fin(relVol)
      ? relVol < VOL_DRY_MAX
        ? "dry"
        : relVol < VOL_NORMAL_MAX
          ? "normal"
          : relVol < VOL_ELEVATED_MAX
            ? "elevated"
            : "spike"
      : null

  const rsi = m?.rsi14 ?? null
  const rsiZone: MarketContext["rsiZone"] =
    rsi !== null && fin(rsi)
      ? rsi < RSI_OVERSOLD_MAX
        ? "oversold"
        : rsi < RSI_WEAK_MAX
          ? "weak"
          : rsi <= RSI_NEUTRAL_MAX
            ? "neutral"
            : rsi < RSI_OVERBOUGHT_MIN
              ? "strong"
              : "overbought"
      : null

  const rangePos = m?.rangePos60 ?? null
  const posOk = rangePos !== null && fin(rangePos)
  const nearRangeTop = posOk ? (rangePos as number) >= RANGE_TOP_MIN : null
  const nearRangeBottom = posOk ? (rangePos as number) <= RANGE_BOTTOM_MAX : null

  // ---- 5) gap of the last bar (signed; sub-1% opens are drift, not data)
  let gapPct: number | null = null
  if (prev !== null && !lastSynthetic && fin(last.open) && fin(prev.close) && prev.close > 0) {
    const gap = ((last.open - prev.close) / prev.close) * 100
    if (Math.abs(gap) >= GAP_MIN_PCT) gapPct = gap
  }

  // ---- 6) ADX — bars adapt verbatim onto AdxBar ({high, low, close}); the
  // module itself abstains (null adx) below 2×period = 28 sessions or on any
  // non-finite H/L/C, and that abstention IS the honest context value.
  const adxRes = computeAdx(bars.map((b) => ({ high: b.high, low: b.low, close: b.close })))
  let adx: number | null = null
  let adxStrength: MarketContext["adxStrength"] = null
  if (!adxRes.abstained && fin(adxRes.adx)) {
    adx = adxRes.adx
    adxStrength = adx >= ADX_STRONG_MIN ? "strong" : adx >= ADX_DEVELOPING_MIN ? "developing" : "weak"
  }

  // ---- 7) divergence — DivergenceRow[] = {ts, close, high?, low?}; the
  // module computes its own RSI/MACD internally (no indicator series is fed
  // in) and already applies the K=3 confirmation + 10-session active window,
  // so a non-null side here IS "active inside the confirmation window".
  // Real H/L are passed so pivots read off the real extremes (the module's
  // documented preference); a non-finite H/L is omitted → close fallback.
  // If BOTH sides are somehow active, the LATER-confirmed one is the live
  // evidence (tie → the stronger read) — deterministic, documented here.
  const divergenceRows: DivergenceRow[] = bars.map((b) => ({
    ts: b.ts,
    close: b.close,
    ...(fin(b.high) && fin(b.low) ? { high: b.high, low: b.low } : {}),
  }))
  const dRes = detectDivergence(divergenceRows)
  const activeSides = [dRes.bullish, dRes.bearish].filter((d): d is DivergenceSignal => d !== null)
  let divergence: MarketContext["divergence"] = null
  if (activeSides.length === 1) {
    divergence = activeSides[0].kind
  } else if (activeSides.length === 2) {
    const [a, b] = activeSides
    divergence =
      b.confirmedAtIndex > a.confirmedAtIndex || (b.confirmedAtIndex === a.confirmedAtIndex && b.strength > a.strength)
        ? b.kind
        : a.kind
  }

  // ---- 8) candle pattern — CandleRow[] maps structurally from Bar (ts,
  // close, volume, open, high, low). readLastCandle IS the "only النهاردة
  // counts" rule (strongest context-gated pattern on the LAST session), so
  // the per-bar scan is not needed here. The module skips flat placeholder
  // bars and abstains below 21 sessions — both surface as null.
  const candleRows: CandleRow[] = bars.map((b) => ({
    ts: b.ts,
    close: b.close,
    volume: b.volume,
    open: b.open,
    high: b.high,
    low: b.low,
  }))
  const candle = readLastCandle(candleRows)
  const candlePatternAr: string | null = candle.available && candle.read !== null ? CANDLE_PATTERN_AR[candle.read.pattern] : null

  // ---- 9) VSA — Bar maps structurally onto the vsa module's bar (ts/OHLC/
  // volume). The module scans only ITS last 10 sessions (that scan window is
  // the de-facto activity window — every returned event is inside it) and
  // needs its own volume baseline; abstention → no events → null.
  // The events array's ordering is NOT relied on: the newest event is picked
  // by its session's index in the bars array (last duplicate ts wins).
  const vsa = analyzeVsa(
    bars.map((b) => ({ ts: b.ts, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume })),
  )
  let vsaNoteAr: string | null = null
  if (vsa.available && vsa.events.length > 0) {
    const indexOfTs = new Map<string, number>()
    bars.forEach((b, i) => indexOfTs.set(b.ts, i))
    let newest: VsaEvent | null = null
    let newestIdx = -1
    for (const ev of vsa.events) {
      const idx = indexOfTs.get(ev.ts)
      if (idx !== undefined && idx > newestIdx) {
        newestIdx = idx
        newest = ev
      }
    }
    if (newest !== null) vsaNoteAr = vsaNoteFor(newest)
  }

  // ---- 10) the lexicon trio — round level / consolidation / volume trend.
  // Pure bar arithmetic, no module adapters; each field carries its own
  // honesty rule on top of the global MIN_CONTEXT_BARS gate.
  let roundLevelNear: MarketContext["roundLevelNear"] = null
  if (fin(last.close) && last.close > 0) roundLevelNear = nearestRoundLevel(last.close)

  let consolidation: MarketContext["consolidation"] = null
  const allCloses = bars.map((b) => b.close)
  if (bars.length >= CONSOL_WINDOW && allCloses.slice(bars.length - CONSOL_WINDOW).every(fin)) {
    const ref = allCloses[bars.length - 1]
    // trailing-window spread as % of the CURRENT close — the reference the
    // narrative speaks from, for every window in the walk
    const spreadPct = (win: readonly number[]): number => {
      const lo = Math.min(...win)
      const hi = Math.max(...win)
      return ((hi - lo) / ref) * 100
    }
    if (fin(ref) && ref > 0 && spreadPct(allCloses.slice(bars.length - CONSOL_WINDOW)) <= CONSOL_TIGHT_PCT) {
      let sessions = CONSOL_WINDOW
      // walk backward: the stretch grows while every LONGER trailing window
      // still fits inside the band; the first session that pushes the spread
      // past the threshold (or a non-finite close that makes it unverifiable)
      // ends the count. Cap: CONSOL_MAX_SESSIONS is the honest maximum.
      while (sessions < CONSOL_MAX_SESSIONS && sessions < bars.length) {
        const longer = allCloses.slice(bars.length - sessions - 1)
        if (!longer.every(fin) || spreadPct(longer) > CONSOL_TIGHT_PCT) break
        sessions++
      }
      consolidation = { sessions, tightnessPct: spreadPct(allCloses.slice(bars.length - sessions)) }
    }
  }

  let volTrend5: MarketContext["volTrend5"] = null
  if (bars.length >= VOL_TREND_MIN_BARS) {
    const recent = bars.slice(-VOL_TREND_RECENT_SESSIONS)
    const baseline = bars.slice(-VOL_TREND_MIN_BARS, -VOL_TREND_RECENT_SESSIONS)
    const volOk = (b: Bar): b is Bar & { volume: number } => b.volume !== null && fin(b.volume)
    // a hole anywhere in the 35-session window voids the read (the baseline
    // would silently mix sessions) — honest null over partial evidence
    if (recent.every(volOk) && baseline.every(volOk)) {
      const meanRecent = recent.reduce((s, b) => s + b.volume, 0) / VOL_TREND_RECENT_SESSIONS
      const meanBaseline = baseline.reduce((s, b) => s + b.volume, 0) / VOL_TREND_BASELINE_SESSIONS
      if (meanBaseline > 0) {
        const ratio = meanRecent / meanBaseline
        volTrend5 = ratio >= VOL_TREND_RISING_MIN ? "rising" : ratio <= VOL_TREND_FALLING_MAX ? "falling" : "flat"
      }
    }
  }

  return {
    closeLocationPct,
    bodyVsAtr,
    upperShadowPct,
    lowerShadowPct,
    streakUp,
    streakDown,
    emaStretch20Atr,
    emaStretch50Atr,
    daysAboveEma20,
    daysBelowEma50,
    volCharacter,
    rsiZone,
    nearRangeTop,
    nearRangeBottom,
    gapPct,
    lastSynthetic,
    adx,
    adxStrength,
    divergence,
    candlePatternAr,
    vsaNoteAr,
    roundLevelNear,
    consolidation,
    volTrend5,
  }
}
