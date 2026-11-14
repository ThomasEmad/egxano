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
// The fix is one honest rule: a quote that does not arrive on a scheduled EGX
// trading day carries NO new session — it merely re-states the previous
// session's close. So its bar anchors to the most recent scheduled session
// (Friday → Thursday, Saturday → Thursday). Scheduled holidays (Sunday etc.)
// cannot be detected without an external calendar; the quote then legitimately
// belongs to that weekday and is deduped by the normal per-day bucketing.
//
// Pure functions only — unit-tested in egx-session.test.ts.

/** JS getUTCDay() values the EGX is scheduled open: Sunday(0) … Thursday(4). */
export const EGX_TRADING_UTCDAYS = [0, 1, 2, 3, 4] as const

/** True when the UTC date is a scheduled EGX trading day (Sun–Thu). */
export function isEgxTradingDayUTC(d: Date): boolean {
  return (EGX_TRADING_UTCDAYS as readonly number[]).includes(d.getUTCDay())
}

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10)
}

/**
 * Anchor a quote instant to the session it belongs to.
 *
 * - Quote on a scheduled trading day (Sun–Thu, any hour) → that UTC date.
 *   (A Thursday 23:50 UTC pull is Friday 01:50 in Cairo but still belongs to
 *   the Thursday session — anchoring on UTC dates keeps this pure and stable.)
 * - Quote on Friday → the previous Thursday.
 * - Quote on Saturday → the previous Thursday.
 *
 * Returns a `YYYY-MM-DD` UTC session key.
 */
export function effectiveEgxSessionDate(input: Date | string): string {
  const d = typeof input === "string" ? new Date(`${input.slice(0, 10)}T00:00:00.000Z`) : new Date(input.getTime())
  const dow = d.getUTCDay()
  if (dow === 5) {
    // Friday — the session it restates is Thursday.
    d.setUTCDate(d.getUTCDate() - 1)
  } else if (dow === 6) {
    // Saturday — ditto.
    d.setUTCDate(d.getUTCDate() - 2)
  }
  return isoDay(d)
}
