// =============================================================================
// EGX session calendar helpers — the Egyptian Exchange trades Sunday–Thursday.
// =============================================================================
// Why this exists: market refreshes (cron, opportunistic kicks, the public
// /market/sync endpoint) write a MarketPrice row for every scanner pull with
// the quote's instant as `asOf`. On weekends and pre-open hours the scanner
// still answers with the last close — and both technical consumers
// (analyze.ts, signals-service.ts) used to turn the quote's UTC DATE into a
// session day. Result: phantom Fri/Sat sessions with degenerate O=H=L=C bars
// that inflated the session count, flattened the day change to 0.00% and
// shifted every indicator (observed live 2026-11-14: COMI board buy 71 → wait
// 50 after a Friday/Saturday double phantom).
//
// The fix is one honest rule: a quote carries a NEW session only when its
// CAIRO clock is inside or after the session on a scheduled trading day.
// Anything else merely re-states the previous session's close — so its bar
// anchors to the most recent real session:
//   • Cairo Friday/Saturday → the previous Thursday.
//   • Cairo Sunday–Thursday BEFORE 09:45 (pre-open) → the prior real session
//     (Sunday pre-open → Thursday; Monday pre-open → Sunday; Thursday
//     pre-open → Wednesday). Same 09:45 pre-open cutoff as
//     scannerChangeSessions() in corporate-actions.ts (audit 2026-11-19: a
//     Sun–Thu quote before the open used to mint a same-day flat phantom bar
//     from the 24/7 heartbeat).
//   • Cairo Sunday–Thursday from 09:45 onward (live or after close) → that
//     day, which preserves the historical midnight/day-boundary behavior for
//     after-close quotes (a Thu 21:00 UTC quote still anchors Thursday).
// Scheduled holidays (Sunday etc.) cannot be detected without an external
// calendar; the quote then legitimately belongs to that weekday and is
// deduped by the normal per-day bucketing.
//
// Pure functions only — unit-tested in egx-session.test.ts.

/** JS getUTCDay() values the EGX is scheduled open: Sunday(0) … Thursday(4). */
export const EGX_TRADING_UTCDAYS = [0, 1, 2, 3, 4] as const

/** True when the UTC date is a scheduled EGX trading day (Sun–Thu). */
export function isEgxTradingDayUTC(d: Date): boolean {
  return (EGX_TRADING_UTCDAYS as readonly number[]).includes(d.getUTCDay())
}

/** The EGX session is underway from 09:45 Africa/Cairo (opening auction) —
 *  the same pre-open cutoff scannerChangeSessions() applies. */
const EGX_SESSION_OPEN_MINUTES = 9 * 60 + 45

// Module-level formatters: Intl construction is not free and this runs per
// MarketPrice row on the board/heatmap read paths.
const CAIRO_CLOCK_FMT = new Intl.DateTimeFormat("en-US", {
  timeZone: "Africa/Cairo",
  weekday: "short",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
})
const CAIRO_DAY_FMT = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Africa/Cairo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
})

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10)
}

/** Calendar date (YYYY-MM-DD) of the instant in Africa/Cairo. */
function cairoDayISO(d: Date): string {
  return CAIRO_DAY_FMT.format(d)
}

/** Cairo-clock readout: weekday (0=Sunday … 6=Saturday) + minutes since midnight. */
function cairoClock(d: Date): { weekday: number; minutes: number } {
  const parts = Object.fromEntries(CAIRO_CLOCK_FMT.formatToParts(d).map((p) => [p.type, p.value]))
  const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
  const hour = Number(parts.hour) % 24
  return { weekday: weekdays.indexOf(parts.weekday), minutes: hour * 60 + Number(parts.minute) }
}

/**
 * Anchor a quote instant to the session it belongs to.
 *
 * - Quote live/after-close on a scheduled trading day (Cairo Sun–Thu, ≥09:45)
 *   → that day's session key (`YYYY-MM-DD`).
 * - Quote before the 09:45 Cairo open on a scheduled trading day → the prior
 *   real session (Thursday pre-open → Wednesday, Monday pre-open → Sunday,
 *   Sunday pre-open → Thursday).
 * - Quote on Cairo Friday/Saturday → the previous Thursday.
 * - A bare `YYYY-MM-DD` key (no clock) is already a session date: trading-day
 *   keys return unchanged (idempotent), weekend keys walk back to Thursday.
 *
 * Returns a `YYYY-MM-DD` UTC session key.
 */
export function effectiveEgxSessionDate(input: Date | string): string {
  // A bare `YYYY-MM-DD` key is an ALREADY-ANCHORED session date — there is no
  // clock to read: trading-day keys are idempotent, weekend keys (never real
  // sessions) walk back to the prior trading day. Full ISO instants anchor by
  // the Cairo clock — slicing them to midnight (the pre-2026-11-19 bug this
  // file once shipped) turned a live 09:00 UTC pull into a 02:00 Cairo
  // "pre-open" and mis-anchored it to the prior session.
  if (typeof input === "string" && /^\d{4}-\d{2}-\d{2}$/.test(input.trim())) {
    const key = input.trim()
    const day = new Date(`${key}T00:00:00.000Z`)
    if (isEgxTradingDayUTC(day)) return key
    const cursor = new Date(day.getTime())
    for (let i = 0; i < 8; i++) {
      cursor.setUTCDate(cursor.getUTCDate() - 1)
      if (isEgxTradingDayUTC(cursor)) return isoDay(cursor)
    }
    return key // unreachable safety net — a week always holds a trading day
  }
  const d = typeof input === "string" ? new Date(input) : new Date(input.getTime())
  const cairo = cairoClock(d)
  // Live or after close on a scheduled trading day: the quote's day IS the
  // session (a Thu 21:00 UTC quote still anchors Thursday — behavior kept).
  if (cairo.weekday <= 4 && cairo.minutes >= EGX_SESSION_OPEN_MINUTES) return isoDay(d)
  // Weekend or pre-open: NO new session here — walk back one UTC day at a
  // time until the Cairo clock lands on a scheduled trading day, and key the
  // bar to that CAIRO calendar day (the session-key convention; e.g. a Fri
  // 23:50 UTC quote = Sat 01:50 Cairo walks Thu 23:50 UTC = Fri 01:50 Cairo
  // [skip] → Wed 23:50 UTC = Thu 01:50 Cairo → Thursday).
  const cursor = new Date(d.getTime())
  if (cairo.weekday <= 4) cursor.setUTCDate(cursor.getUTCDate() - 1) // pre-open: leave today's unopened session
  for (let i = 0; i < 8; i++) {
    if (cairoClock(cursor).weekday <= 4) return cairoDayISO(cursor)
    cursor.setUTCDate(cursor.getUTCDate() - 1)
  }
  return isoDay(d) // unreachable safety net — a week always holds a trading day
}
