// =============================================================================
// Honest intraday context — Yahoo chart API, 5-minute bars, evidence ONLY.
// (Opportunity Intelligence Engine, owner directive 2026-11-15.)
//
// WHAT THIS IS: a delayed-data DESCRIPTION of the current session from real
// Yahoo 5m bars — last price, VWAP-ish average, volume expansion ratio, and a
// breakout ATTEMPT flag against a caller-supplied trigger level. Every output
// is a factual measurement of bars that actually arrived.
//
// WHAT THIS IS NOT: never a buy/sell signal, never a confirmation. The delay
// note and the disclaimer ("لا يُعد هذا تأكيد تفعيل رسمي") are ALWAYS present
// on an available context. The daily close decides activation upstream (the
// @5 close-based activation rule) — an intraday breakout attempt NEVER
// confirms anything.
//
// FETCH POLICY (same pattern as live-bars.ts — that file is NOT modified):
//   • Yahoo chart API: range = 5d (~5 sessions cap), interval = "5m".
//   • FALLBACK (implemented and documented): if the 5m attempt fails to
//     produce an available context (transport failure, empty payload, or too
//     few usable bars), ONE 15m attempt is made. The fallback's outcome wins
//     whenever it parses; if the fallback itself fails at the transport level
//     after the 5m attempt already parsed a payload, the 5m parsed outcome is
//     reported. No further retries.
//   • User-Agent header + AbortSignal.timeout(12s), like live-bars.ts.
//   • In-memory TTL cache of 5 minutes keyed by ticker. Network/transport
//     failures are NEVER cached (next request retries). A parsed "no usable
//     data" answer IS cached (it is Yahoo's real answer, and it is cheap to
//     serve for 5 minutes).
//   • No DB writes ever. No AI. Deterministic parsing only.
//
// ABSTENTION (honesty rules — never fabricate):
//   • unreachable Yahoo / HTTP failure / unparseable body → null
//     (transport-integrity failure — retryable, never cached).
//   • empty chart / zero usable bars → { available: false, reasonAr }.
//   • fewer than MIN_USABLE_BARS (3) usable bars → { available: false }.
//   • all-flat garbage (every bar o==h==l==c AND volume 0/null — Yahoo
//     placeholder rows) → { available: false }. Flat bars WITH real volume
//     are REAL thin-name trading and are kept.
//   • Bars are NEVER synthesized from daily closes — if no real intraday bars
//     arrive, the module abstains. (The directive forbids constructing
//     artificial intraday OHLC.)
//
// PARSING (documented):
//   • keep a bar only when open/high/low/close are finite numbers > 0 and
//     high ≥ low; volume kept as number ≥ 0 else null.
//   • sort ascending by timestamp (handles out-of-order payloads); exact
//     duplicate timestamps are dropped, keeping the FIRST occurrence.
//   • sessions are grouped by the Africa/Cairo calendar date of the bar
//     (UTC-date fallback if Intl time zones are unavailable); "today" is the
//     latest session present.
//
// DEFINITIONS of the derived measurements:
//   • vwapToday — session VWAP-ish: Σ(typicalPrice × volume) / Σ(volume) over
//     TODAY's bars that carry a numeric positive volume, typicalPrice =
//     (h + l + c) / 3. Real bars only; null when no volume evidence exists.
//   • volumeExpansion — mean 5m-bar volume of the LAST N=6 bars of today
//     (last 30 minutes; VOLUME_EXPANSION_RECENT_BARS) ÷ baseline. Baseline =
//     mean per-bar volume of the PRIOR sessions in the window when it has ≥ 3
//     volume-carrying bars (BASELINE_MIN_BARS), else the documented fallback:
//     today's earlier bars (excluding the last N) when they have ≥ 3 samples.
//     The note states which baseline was used. null when either side cannot
//     be computed honestly (e.g. session younger than N bars).
//   • breakoutAttempt — caller passes a trigger level (its roundToTick'd
//     activation). active = the LAST intraday close of TODAY is STRICTLY
//     above the level (equal → not active). It is an attempt, not a
//     confirmation, and it is evaluated on delayed data.
// =============================================================================

/** Version of the intraday-context contract. */
export const INTRADAY_CONTEXT_VERSION = "intraday-context@1"

/** The mandatory delayed-data note — ALWAYS present when available. */
export const INTRADAY_DELAY_NOTE_AR =
  "بيانات اليوم اللحظي مصدرها متأخر (~15 دقيقة) — ليست أسعارًا لحظية فورية"

/** The mandatory no-confirmation disclaimer — embedded in evidenceNoteAr. */
export const INTRADAY_DISCLAIMER_AR = "لا يُعد هذا تأكيد تفعيل رسمي"

/** Yahoo request shape (same endpoint family as live-bars.ts). */
const TTL_MS = 5 * 60_000
const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36"
const REQUEST_TIMEOUT_MS = 12_000
/** Range cap: ~5 sessions of intraday bars — never deeper history. */
export const INTRADAY_RANGE = "5d"
/** Minimum usable bars for ANY analysis (below → abstain). */
export const MIN_USABLE_BARS = 3
/** Recent-window size N for the volume-expansion ratio (6 × 5m = 30 min). */
export const VOLUME_EXPANSION_RECENT_BARS = 6
/** Minimum volume-carrying bars required for a baseline (documented). */
export const BASELINE_MIN_BARS = 3

/** Injectable fetcher — defaults to global fetch; tests inject (no network). */
export type IntradayFetcher = (input: string, init?: RequestInit) => Promise<Response>

export interface IntradayBar {
  ts: Date
  open: number
  high: number
  low: number
  close: number
  volume: number | null
}

export interface IntradayBreakoutAttempt {
  /** last intraday close of today STRICTLY above the trigger level */
  active: boolean
  level: number
  /** factual delayed-data note — never a confirmation claim */
  noteAr: string
}

export interface IntradayContext {
  available: true
  /** which granularity won (5m primary; 15m only after the documented fallback) */
  interval: "5m" | "15m"
  /** timestamp of the LAST usable bar */
  asOf: Date
  /** close of the last usable bar */
  lastPrice: number
  /** usable bars parsed across the whole window (all sessions) */
  barsAnalyzed: number
  /** usable bars belonging to today's session */
  todayBars: number
  /** calendar date (Africa/Cairo) of the last usable bar's session */
  lastSessionDate: string
  /** mandatory delayed-data note — always present when available */
  delayNoteAr: string
  /** session VWAP-ish average from real volume-carrying bars; null if none */
  vwapToday: number | null
  /** factual VWAP note from real bars only; null when vwapToday is null */
  vwapNoteAr: string | null
  /** last-N-bar mean volume ÷ baseline; null when not computable honestly */
  volumeExpansion: number | null
  /** documents N and which baseline was used; null with the ratio */
  volumeExpansionNoteAr: string | null
  /** breakout ATTEMPT vs the caller's trigger level; null without a level */
  breakoutAttempt: IntradayBreakoutAttempt | null
  /** factual scope note + the mandatory disclaimer */
  evidenceNoteAr: string
}

export interface IntradayUnavailable {
  available: false
  /** why the intraday layer abstains (Arabic) */
  reasonAr: string
}

export type IntradayContextOutcome = IntradayContext | IntradayUnavailable

export interface IntradayContextOptions {
  /** injected fetcher (tests; default global fetch) */
  fetcher?: IntradayFetcher
  /** caller's trigger level (e.g. the setup's roundToTick'd activation) */
  triggerLevel?: number
}

// ---------------------------------------------------------------------------
// In-memory TTL cache — payloads only; transport failures are never cached.
// ---------------------------------------------------------------------------
const cache = new Map<string, { payload: IntradayContextOutcome; at: number }>()

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

interface YahooChartJson {
  chart?: {
    result?: Array<{
      timestamp?: number[]
      indicators?: {
        quote?: Array<{
          open?: (number | null)[]
          high?: (number | null)[]
          low?: (number | null)[]
          close?: (number | null)[]
          volume?: (number | null)[]
        }>
      }
    }>
  }
}

/** Parse a Yahoo chart payload into usable bars (possibly empty array).
 *  Throws only on body-integrity problems (caller treats as transport
 *  failure); an empty/invalid-shape payload yields [] — a real "no data"
 *  answer, not a transport failure. */
function parseChartBars(json: YahooChartJson): IntradayBar[] {
  const r = json?.chart?.result?.[0]
  const ts = r?.timestamp
  const q = r?.indicators?.quote?.[0]
  if (!ts || !q) return []

  const bars: IntradayBar[] = []
  for (let i = 0; i < ts.length; i++) {
    const o = q.open?.[i]
    const h = q.high?.[i]
    const l = q.low?.[i]
    const c = q.close?.[i]
    const t = ts[i]
    if (typeof t !== "number" || !Number.isFinite(t)) continue
    if (typeof o !== "number" || typeof h !== "number" || typeof l !== "number" || typeof c !== "number") continue
    if (![o, h, l, c].every((x) => Number.isFinite(x) && x > 0)) continue
    if (h < l) continue // malformed bar — drop
    const v = q.volume?.[i]
    bars.push({
      ts: new Date(t * 1000),
      open: o,
      high: h,
      low: l,
      close: c,
      volume: typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null,
    })
  }
  // Out-of-order payloads happen — sort ascending, then drop exact duplicate
  // timestamps keeping the FIRST occurrence (stable sort keeps payload order).
  bars.sort((a, b) => a.ts.getTime() - b.ts.getTime())
  const deduped: IntradayBar[] = []
  for (const b of bars) {
    if (deduped.length && deduped[deduped.length - 1].ts.getTime() === b.ts.getTime()) continue
    deduped.push(b)
  }
  return deduped
}

/** Calendar date (Africa/Cairo) of a bar timestamp — session grouping key.
 *  Falls back to the UTC date when Intl time-zone data is unavailable. */
let cairoDateFmt: Intl.DateTimeFormat | null | undefined
export function sessionDateOf(ts: Date): string {
  if (cairoDateFmt === undefined) {
    try {
      cairoDateFmt = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Africa/Cairo",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      })
    } catch {
      cairoDateFmt = null
    }
  }
  try {
    if (cairoDateFmt) return cairoDateFmt.format(ts)
  } catch {
    /* fall through to UTC */
  }
  return ts.toISOString().slice(0, 10)
}

// ---------------------------------------------------------------------------
// Fetch
// ---------------------------------------------------------------------------

async function fetchChartBars(ticker: string, interval: "5m" | "15m", fetcher: IntradayFetcher): Promise<IntradayBar[]> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}.CA?range=${INTRADAY_RANGE}&interval=${interval}`
  const res = await fetcher(url, {
    headers: { "User-Agent": UA },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return parseChartBars((await res.json()) as YahooChartJson)
}

// ---------------------------------------------------------------------------
// Context building
// ---------------------------------------------------------------------------

const fmt2 = (v: number): string => v.toFixed(2)
const round2 = (x: number): number => Math.round(x * 100) / 100
const mean = (xs: number[]): number => xs.reduce((s, x) => s + x, 0) / xs.length

function buildContext(
  bars: IntradayBar[],
  interval: "5m" | "15m",
  triggerLevel: number | undefined,
): IntradayContextOutcome {
  if (bars.length === 0) {
    return { available: false, reasonAr: "لا توجد بيانات لحظية متاحة لهذا الرمز من المصدر" }
  }
  if (bars.length < MIN_USABLE_BARS) {
    return {
      available: false,
      reasonAr: `بيانات لحظية غير كافية للتحليل (${bars.length} شمعة صالحة فقط — الحد الأدنى ${MIN_USABLE_BARS})`,
    }
  }
  // All-flat garbage: every bar o==h==l==c AND no real volume anywhere.
  const allFlatNoVolume = bars.every((b) => b.open === b.high && b.high === b.low && b.low === b.close) &&
    !bars.some((b) => b.volume !== null && b.volume > 0)
  if (allFlatNoVolume) {
    return {
      available: false,
      reasonAr: "بيانات لحظية مسطّرة بلا حجم تداول — تُرفض كبيانات غير صالحة (لا تُصنَّع شموع بديلة)",
    }
  }

  // ---- session grouping -----------------------------------------------------
  const bySession = new Map<string, IntradayBar[]>()
  for (const b of bars) {
    const key = sessionDateOf(b.ts)
    const arr = bySession.get(key)
    if (arr) arr.push(b)
    else bySession.set(key, [b])
  }
  const sessions = [...bySession.keys()].sort()
  const today = sessions[sessions.length - 1]
  const todayBars = bySession.get(today) as IntradayBar[]
  const lastBar = bars[bars.length - 1] // == last of today (today is the max session)
  const lastSessionDate = sessionDateOf(lastBar.ts)

  // ---- session VWAP-ish (real volume-carrying bars only) ---------------------
  let pvSum = 0
  let vSum = 0
  for (const b of todayBars) {
    if (b.volume === null || b.volume <= 0) continue
    pvSum += ((b.high + b.low + b.close) / 3) * b.volume
    vSum += b.volume
  }
  const vwapToday = vSum > 0 ? round2(pvSum / vSum) : null
  const vwapNoteAr =
    vwapToday === null
      ? null
      : `متوسط السعر المرجّح بالحجم لجلسة اليوم ≈ ${fmt2(vwapToday)} (من شموع اليوم ذات الحجم الحقيقي فقط) — آخر سعر داخل الجلسة ${fmt2(lastBar.close)}. وصف إحصائي وليس إشارة تداول.`

  // ---- volume expansion: last N bars vs a documented baseline ----------------
  let volumeExpansion: number | null = null
  let volumeExpansionNoteAr: string | null = null
  if (todayBars.length >= VOLUME_EXPANSION_RECENT_BARS) {
    const recentVolumes: number[] = []
    for (let i = todayBars.length - 1; i >= 0 && recentVolumes.length < VOLUME_EXPANSION_RECENT_BARS; i--) {
      const v = todayBars[i].volume
      if (v !== null && v > 0) recentVolumes.push(v)
    }
    const priorSessionVolumes: number[] = []
    for (const s of sessions) {
      if (s === today) continue
      for (const b of bySession.get(s) as IntradayBar[]) {
        if (b.volume !== null && b.volume > 0) priorSessionVolumes.push(b.volume)
      }
    }
    let baseline: number | null = null
    let baselineKindAr = ""
    if (priorSessionVolumes.length >= BASELINE_MIN_BARS) {
      baseline = mean(priorSessionVolumes)
      baselineKindAr = "متوسط شموع الجلسات السابقة في النافذة"
    } else {
      const earlierToday = todayBars.slice(0, todayBars.length - VOLUME_EXPANSION_RECENT_BARS)
      const earlierVolumes = earlierToday.map((b) => b.volume).filter((v): v is number => v !== null && v > 0)
      if (earlierVolumes.length >= BASELINE_MIN_BARS) {
        baseline = mean(earlierVolumes)
        baselineKindAr = "متوسط شموع بداية الجلسة نفسها"
      }
    }
    if (recentVolumes.length > 0 && baseline !== null && baseline > 0) {
      volumeExpansion = round2(mean(recentVolumes) / baseline)
      volumeExpansionNoteAr = `متوسط حجم آخر ${VOLUME_EXPANSION_RECENT_BARS} شموع (30 دقيقة) ÷ ${baselineKindAr} = ×${fmt2(volumeExpansion)} — قياس وصفي فقط.`
    }
  }

  // ---- breakout ATTEMPT vs the caller's trigger level -------------------------
  let breakoutAttempt: IntradayBreakoutAttempt | null = null
  if (typeof triggerLevel === "number" && Number.isFinite(triggerLevel)) {
    const lastClose = todayBars[todayBars.length - 1].close
    const active = lastClose > triggerLevel // strictly above — equal is NOT active
    breakoutAttempt = {
      active,
      level: triggerLevel,
      noteAr: active
        ? `آخر سعر داخل الجلسة (${fmt2(lastClose)}) أعلى من مستوى التفعيل ${fmt2(triggerLevel)} — محاولة اختراق جارية على بيانات متأخرة؛ ${INTRADAY_DISCLAIMER_AR} والقرار النهائي يبقى لإغلاق اليوم.`
        : `آخر سعر داخل الجلسة (${fmt2(lastClose)}) ليس أعلى من مستوى التفعيل ${fmt2(triggerLevel)} — لا محاولة اختراق نشطة الآن (بيانات متأخرة).`,
    }
  }

  const evidenceNoteAr =
    `تحليل وصفي لأحدث ${todayBars.length} شمعة من جلسة اليوم (${today}) ضمن نافذة ${INTRADAY_RANGE} ` +
    `بفاصل ${interval} — إجمالي الشموع الصالحة ${bars.length}. ${INTRADAY_DISCLAIMER_AR}.`

  return {
    available: true,
    interval,
    asOf: lastBar.ts,
    lastPrice: lastBar.close,
    barsAnalyzed: bars.length,
    todayBars: todayBars.length,
    lastSessionDate,
    delayNoteAr: INTRADAY_DELAY_NOTE_AR,
    vwapToday,
    vwapNoteAr,
    volumeExpansion,
    volumeExpansionNoteAr,
    breakoutAttempt,
    evidenceNoteAr,
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Fetch the honest intraday context for an EGX ticker (bare ticker, the
 * ".CA" suffix is appended here exactly like live-bars.ts).
 *
 * Returns an available context, an abstention ({ available: false, reasonAr })
 * when the source answered but nothing usable arrived, or null on a
 * transport-integrity failure (unreachable / HTTP error / unparseable body —
 * never cached, so the next call retries). Bars are NEVER fabricated from
 * daily closes.
 */
export async function fetchIntradayContext(
  ticker: string,
  opts: IntradayContextOptions = {},
): Promise<IntradayContext | IntradayUnavailable | null> {
  const key = ticker.trim().toUpperCase()
  if (!key) return null
  const fetcher = opts.fetcher ?? fetch

  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < TTL_MS) return hit.payload

  // Primary 5m attempt; the documented ONE-step 15m fallback fires whenever
  // the 5m attempt did not yield an available context. Both attempts failing
  // at the transport level → null (uncached).
  let outcome: IntradayContextOutcome | null = null
  try {
    const bars = await fetchChartBars(key, "5m", fetcher)
    outcome = buildContext(bars, "5m", opts.triggerLevel)
  } catch {
    // transport failure — the 5m attempt produced nothing
  }
  if (outcome === null || !outcome.available) {
    try {
      const bars = await fetchChartBars(key, "15m", fetcher)
      const fifteen = buildContext(bars, "15m", opts.triggerLevel)
      // The fallback outcome wins whenever it parses; if it is also an
      // abstention, the last attempt's reason is reported (or the primary
      // one when the fallback produced nothing at all).
      if (fifteen.available || outcome === null) outcome = fifteen
    } catch {
      if (outcome === null) return null // both attempts failed at transport → null, uncached
      // keep the primary parsed outcome (documented above)
    }
  }
  if (outcome === null) return null

  // A parsed outcome (available or a real "no usable data" answer) is cached;
  // transport failures were never cached (we return null above without set).
  cache.set(key, { payload: outcome, at: Date.now() })
  return outcome
}
