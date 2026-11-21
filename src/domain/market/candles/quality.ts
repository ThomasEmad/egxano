// Candle-quality validators — the single source of truth for whether a daily
// OHLCV candle is trustworthy enough to ground a technical statement.
//
// Pure functions only (no DB, no fetch): the ingestion pipeline, the analysis
// snapshot and the vitest corruption suite all call the exact same code, so a
// candle that enters MarketCandle.verified=true has passed these rules and
// nothing else.
//
// Design goals:
//   1. A corrupted or incomplete row is REJECTED, never coerced ("fix in
//      place" is how silent data corruption happens).
//   2. Every rejection is reported with a machine-readable reason so the
//      coverage report can be audited row by row.
//   3. History completeness is judged against the SOURCE's own first trade
//      date (meta.firstTradeDate), not against an arbitrary lookback window —
//      "reads all of the stock's data" means the stored series starts where
//      the exchange's history starts.
//   4. Staleness is judged against the EGX trading week (Sun–Thu, Cairo time):
//      a Friday/Saturday with no candle is normal, a Sun–Thu session missing
//      candles for more than the holiday tolerance is not.

export interface RawCandle {
  /** YYYY-MM-DD session date */
  date: string
  open: number | null
  high: number | null
  low: number | null
  close: number | null
  volume: number | null
}

export interface VerifiedCandle {
  date: string
  open: number
  high: number
  low: number
  close: number
  /** null when the source reported no volume — the OHLC is still real.
   *  Volume statistics (relVol, spike claims) skip null/0 rows. */
  volume: number | null
}

export interface CandleIssue {
  date: string
  field: string | null
  reason: string
}

export interface SessionGap {
  /** inclusive first missing expected-session date */
  from: string
  /** inclusive last missing expected-session date */
  to: string
  calendarDays: number
  /** true when the gap can be explained by Fri/Sat weekend only */
  weekendOnly: boolean
}

export interface CandleQualityOptions {
  /** YYYY-MM-DD — overrides "now" for deterministic tests */
  today?: string
  /** Reject candles dated after this. Default: today (Cairo trading day). */
  maxDate?: string
  /** history start claimed by the source (YYYY-MM-DD) for completeness check */
  sourceFirstTradeDate?: string
  /** live-quote cross-validation from the trading-day scanner */
  reconciliation?: { source: string; expectedClose: number; actualClose: number; tradeDate?: string } | null
}

export interface CandleQualityReport {
  ticker: string
  totalRaw: number
  verifiedCount: number
  rejectedCount: number
  /** holiday placeholder rows (all fields null) — skipped, not data */
  nonSessionRows: number
  verified: VerifiedCandle[]
  rejected: CandleIssue[]
  firstSession: string | null
  lastSession: string | null
  /** calendar days from lastSession to the most recent expected EGX session */
  stalenessCalendarDays: number | null
  unexpectedGaps: SessionGap[]
  recentWindow: {
    from: string
    sessions: number
    gaps: SessionGap[]
    rejectedRows: number
  }
  completeness: {
    sourceFirstTradeDate: string | null
    seriesStartsAt: string | null
    /** true when the stored series reaches back to the source's own history start */
    fullHistory: boolean | null
    note: string
  }
  reconciliation: {
    source: string
    expectedClose: number
    actualClose: number
    deviationPct: number
    passed: boolean
  } | null
  verdict: "FULL" | "DEGRADED" | "INSUFFICIENT"
  reasons: string[]
}

// ---------------------------------------------------------------------------
// Tunables (deliberately conservative — an EGX cap on the MAIN market is ±20%,
// so a >35% overnight move without a split record is treated as bad data)
// ---------------------------------------------------------------------------

/** A candle must have at least this many sessions before ANY technical claim */
export const MIN_SESSIONS_FOR_TECHNICALS = 60
/** Volume-average claims (e.g. "2.5× average") need a 20-session base + today */
export const MIN_SESSIONS_FOR_VOLUME_STATS = 21
/** Max |close/prevClose − 1| before the row is treated as a data error */
export const MAX_OVERNIGHT_MOVE_PCT = 35
/** Max |open/close − 1| within one row before the open is called corrupt */
export const MAX_OPEN_DRIFT_PCT = 45
/** Max |close/prevClose − 1| within a session (high vs low span guard) */
export const MAX_INTRADAY_SPAN_PCT = 45
/** Calendar days after the last expected EGX session before data is "stale" */
export const STALE_TOLERANCE_CALENDAR_DAYS = 5
/** Reconciliation tolerance vs the delayed scanner quote: ≤2.5٪ passes — a
 *  15-min-delayed quote vs the official close moves within feed noise on EGX
 *  (verified backfill 2026-11-21: 185 names reconciled ≤2.4٪, the wrong-series
 *  catch printed 91٪). Anything wider is a wrong-series signal (verified=false,
 *  audit only) — the old 0.5٪ gate rejected healthy series on rounding noise. */
export const RECONCILIATION_TOLERANCE_PCT = 2.5
/** No candle may be dated after today (Cairo) — future rows are corrupt */
const EET_OFFSET_MINUTES = 120

// ---------------------------------------------------------------------------
// Date helpers (local, deterministic — no timezone-dependence in tests)
// ---------------------------------------------------------------------------

export function parseDate(s: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null
  const d = new Date(`${s}T00:00:00Z`)
  return Number.isNaN(d.getTime()) ? null : d
}

export function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

/** Today in Cairo (EET, UTC+2) as YYYY-MM-DD. `todayOverride` for tests. */
export function cairoToday(todayOverride?: string): string {
  if (todayOverride) return todayOverride
  const now = new Date(Date.now() + EET_OFFSET_MINUTES * 60_000)
  return isoDate(now)
}

/** Day of week 0=Sun..6=Sat for YYYY-MM-DD. */
function dow(s: string): number {
  return parseDate(s)!.getUTCDay()
}

/** Add n days to YYYY-MM-DD. */
export function addDays(s: string, n: number): string {
  const d = parseDate(s)!
  d.setUTCDate(d.getUTCDate() + n)
  return isoDate(d)
}

/** Most recent EGX session day at or before `ref` (Fri/Sat are non-trading). */
export function lastExpectedSession(ref: string): string {
  let d = ref
  for (let i = 0; i < 7; i++) {
    const w = dow(d)
    if (w !== 5 && w !== 6) return d // 5=Fri, 6=Sat
    d = addDays(d, -1)
  }
  return ref
}

/**
 * Walk the calendar between the first and last verified session and list
 * missing Mon–Thu/Sun runs longer than `tolerance` days (short gaps are EGX
 * holidays — recorded only when severe).
 */
export function findUnexpectedGaps(datesAsc: string[], tolerance = STALE_TOLERANCE_CALENDAR_DAYS): SessionGap[] {
  if (datesAsc.length < 2) return []
  const gaps: SessionGap[] = []
  for (let i = 1; i < datesAsc.length; i++) {
    const prev = datesAsc[i - 1]
    const cur = datesAsc[i]
    // count expected (non-weekend) sessions strictly between prev and cur
    const missing: string[] = []
    for (let d = addDays(prev, 1); d < cur; d = addDays(d, 1)) {
      const w = dow(d)
      if (w !== 5 && w !== 6) missing.push(d)
    }
    if (missing.length > tolerance) {
      gaps.push({
        from: missing[0],
        to: missing[missing.length - 1],
        calendarDays: missing.length,
        weekendOnly: false,
      })
    }
  }
  return gaps
}

// ---------------------------------------------------------------------------
// Per-row validation
// ---------------------------------------------------------------------------

function validateRow(c: RawCandle, idx: number, today: string): CandleIssue | null {
  const fail = (field: string | null, reason: string): CandleIssue => ({ date: c.date, field, reason })
  const parsed = parseDate(c.date)
  if (!parsed) return fail("date", `unparseable date "${c.date}"`)
  const num = (v: number | null) => v !== null && Number.isFinite(v)
  // Known Yahoo EGX artifacts (verified 2026-11):
  //  • holiday rows arrive with EVERY field null — they are non-sessions,
  //    not corruption, and must never count as rejected data;
  //  • the `open` field is a previous-close carryover on most sessions, so it
  //    must NOT be bounds-checked against high/low (that rule rejected 37% of
  //    COMI's healthy rows). high/low/close are internally coherent and are
  //    the fields every technical reading actually uses.
  if (c.open === null && c.high === null && c.low === null && c.close === null && c.volume === null) {
    return fail("__nonSession", "non-session placeholder row (holiday)")
  }
  if (!num(c.close) || c.close! <= 0) return fail("close", "close missing/non-positive")
  if (!num(c.high) || c.high! <= 0) return fail("high", "high missing/non-positive")
  if (!num(c.low) || c.low! <= 0) return fail("low", "low missing/non-positive")
  // VOLUME POLICY (2026-11-21, same-source mandate): EGX has many one-print
  // sessions — a coherent OHLC row with missing/zero volume carries the REAL
  // official close and must NOT be dropped (dropping it punched holes into
  // illiquid names' series and tripped the staleness gate). The row is kept
  // with volume=null; volume-average claims skip null/0 rows downstream.
  if (c.volume !== null && (!Number.isFinite(c.volume) || c.volume! < 0)) return fail("volume", "volume negative/non-finite")
  const h = c.high!, l = c.low!, cl = c.close!
  if (h < l - 1e-6) return fail("high/low", "high < low")
  if (h < cl - 1e-6) return fail("high", `high < close`)
  if (l > cl + 1e-6) return fail("low", `low > close`)
  if (num(c.open)) {
    const o = c.open!
    if (o <= 0) return fail("open", "open non-positive")
    const openDriftPct = Math.abs((o - cl) / cl) * 100
    if (openDriftPct > MAX_OPEN_DRIFT_PCT) return fail("open", `open drifts ${openDriftPct.toFixed(1)}% from close — corrupt open`)
  }
  const spanPct = ((h - l) / cl) * 100
  if (spanPct > MAX_INTRADAY_SPAN_PCT) return fail("high/low", `intraday span ${spanPct.toFixed(1)}% exceeds ${MAX_INTRADAY_SPAN_PCT}%`)
  if (c.date > today) return fail("date", "future-dated candle")
  if (c.date < "1995-01-01") return fail("date", "pre-history date")
  void idx
  return null
}

// ---------------------------------------------------------------------------
// Main entry
// ---------------------------------------------------------------------------

export function validateCandleSet(
  ticker: string,
  raw: RawCandle[],
  opts: CandleQualityOptions = {}
): CandleQualityReport {
  const today = cairoToday(opts.today)
  const reasons: string[] = []
  const rejected: CandleIssue[] = []
  const verified: VerifiedCandle[] = []
  const seen = new Set<string>()
  let nonSessionRows = 0

  const sorted = [...raw].sort((a, b) => a.date.localeCompare(b.date))
  for (const c of sorted) {
    if (seen.has(c.date)) {
      rejected.push({ date: c.date, field: "date", reason: "duplicate session row" })
      continue
    }
    seen.add(c.date)
    const issue = validateRow(c, sorted.length, today)
    if (issue) {
      if (issue.field === "__nonSession") {
        nonSessionRows++
        continue
      }
      rejected.push(issue)
      continue
    }
    verified.push({
      date: c.date,
      open: c.open!,
      high: c.high!,
      low: c.low!,
      close: c.close!,
      volume: c.volume,
    })
  }

  // Overnight-move guard on the verified series (split-shaped discontinuities
  // without a split record are the classic silent-corruption pattern).
  for (let i = 1; i < verified.length; i++) {
    const prev = verified[i - 1].close
    const cur = verified[i].close
    const movePct = Math.abs((cur - prev) / prev) * 100
    if (movePct > MAX_OVERNIGHT_MOVE_PCT) {
      const d = verified[i].date
      rejected.push({ date: d, field: "close", reason: `overnight move ${movePct.toFixed(1)}% exceeds ${MAX_OVERNIGHT_MOVE_PCT}% (split-shaped discontinuity)` })
      verified.splice(i, 1)
      i--
    }
  }

  const firstSession = verified.length ? verified[0].date : null
  const lastSession = verified.length ? verified[verified.length - 1].date : null
  const lastExpected = lastExpectedSession(today)
  const stalenessCalendarDays = lastSession
    ? Math.round((parseDate(lastExpected)!.getTime() - parseDate(lastSession)!.getTime()) / 86_400_000)
    : null

  const unexpectedGaps = findUnexpectedGaps(verified.map((v) => v.date))
  // Integrity of the window technicals actually read: the most recent
  // sessions. Historical holes (dead trading periods years ago) are reported
  // for audit but do not gate today's readings.
  const RECENT_WINDOW = 120
  const recentFrom = verified.length > RECENT_WINDOW ? verified[verified.length - RECENT_WINDOW].date : (verified[0]?.date ?? "")
  const recentDates = verified.filter((v) => v.date >= recentFrom).map((v) => v.date)
  const recentGaps = findUnexpectedGaps(recentDates)
  const recentRejected = rejected.filter((r) => r.date >= recentFrom).length

  // Completeness vs the source's own claimed history start
  const sourceStart = opts.sourceFirstTradeDate ?? null
  const seriesStartsAt = firstSession
  const fullHistory =
    sourceStart && seriesStartsAt
      ? seriesStartsAt <= addDays(sourceStart, 45) // tolerate listing-week noise
      : null
  const completeness = {
    sourceFirstTradeDate: sourceStart,
    seriesStartsAt,
    fullHistory,
    note:
      fullHistory === null
        ? sourceStart
          ? "no verified sessions to compare against source history start"
          : "source history start unknown — completeness not asserted"
        : fullHistory
          ? `series reaches back to the source's own first trade date (${sourceStart})`
          : `series starts ${seriesStartsAt} but source history begins ${sourceStart} — history is TRUNCATED`,
  }

  // Reconciliation against the live scanner quote
  let reconciliation: CandleQualityReport["reconciliation"] = null
  if (opts.reconciliation && Number.isFinite(opts.reconciliation.actualClose) && Number.isFinite(opts.reconciliation.expectedClose) && opts.reconciliation.expectedClose > 0) {
    const { source, expectedClose, actualClose } = opts.reconciliation
    const deviationPct = Math.abs((actualClose - expectedClose) / expectedClose) * 100
    reconciliation = { source, expectedClose, actualClose, deviationPct, passed: deviationPct <= RECONCILIATION_TOLERANCE_PCT }
  }

  // Verdict
  let verdict: CandleQualityReport["verdict"] = "FULL"
  if (verified.length < MIN_SESSIONS_FOR_TECHNICALS) {
    verdict = "INSUFFICIENT"
    reasons.push(`only ${verified.length} verified sessions — technical statements need ≥ ${MIN_SESSIONS_FOR_TECHNICALS}`)
  }
  if (stalenessCalendarDays === null) {
    verdict = "INSUFFICIENT"
    reasons.push("no verified sessions at all")
  } else if (stalenessCalendarDays > STALE_TOLERANCE_CALENDAR_DAYS) {
    verdict = "INSUFFICIENT"
    reasons.push(`last session ${lastSession} is ${stalenessCalendarDays} calendar days behind expected session ${lastExpected} — feed is stale`)
  }
  if (reconciliation && !reconciliation.passed) {
    verdict = "INSUFFICIENT"
    reasons.push(`stored close ${reconciliation.actualClose} diverges ${reconciliation.deviationPct.toFixed(2)}% from ${reconciliation.source} live quote ${reconciliation.expectedClose} — reading the wrong series`)
  }
  if (verdict !== "INSUFFICIENT") {
    if (recentGaps.length > 0) reasons.push(`${recentGaps.length} unexplained session gaps in the recent ${RECENT_WINDOW}-session window`)
    else if (unexpectedGaps.length > 0) reasons.push(`${unexpectedGaps.length} historical session gaps (outside the recent window — informational)`)
    if (recentRejected > 0) reasons.push(`${recentRejected} recent source rows rejected by validation`)
    if (fullHistory === false) reasons.push("stored history does not reach the source's own first trade date")
    if (reasons.length > 0) verdict = "DEGRADED"
  }

  return {
    ticker,
    totalRaw: raw.length,
    verifiedCount: verified.length,
    rejectedCount: rejected.length,
    nonSessionRows,
    verified,
    rejected,
    firstSession,
    lastSession,
    stalenessCalendarDays,
    unexpectedGaps,
    recentWindow: { from: recentFrom, sessions: recentDates.length, gaps: recentGaps, rejectedRows: recentRejected },
    completeness,
    reconciliation,
    verdict,
    reasons,
  }
}
