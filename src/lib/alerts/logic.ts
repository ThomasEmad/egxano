// =============================================================================
// Pure alert-evaluation logic — no DB, no clock reads, no I/O.
// =============================================================================
// Everything here is unit-tested in src/lib/alerts/__tests__/alert-logic.test.ts
// and shared by evaluate.ts (the transactional publish) and the alerts GET
// route, so the guards can never drift between callers.
//
// Contents:
//   * alertHit               — the exact comparison semantics (equality fires)
//   * fallbackPriceIsFresh   — F-03 freshness guard for the DB-price fallback
//   * alertEvaluationGate    — F-04 weekend guard (phantom Fri/Sat sessions)
//   * deliveryInfoFromOutbox — honest UI delivery state mapping (audit F-07)

import { isEgxTradingDay } from "@/lib/market/egx-hours"
import { effectiveEgxSessionDate } from "@/lib/market/egx-session"

/** Exact comparison used everywhere (was inlined in GET /api/v1/alerts).
 *  Equality FIRES: an ABOVE target of 50.00 triggers at exactly 50.00. */
export function alertHit(direction: string, targetPrice: number, price: number): boolean {
  return (direction === "ABOVE" && price >= targetPrice) || (direction === "BELOW" && price <= targetPrice)
}

// ---------------------------------------------------------------------------
// F-03 freshness guard
// ---------------------------------------------------------------------------
// resolveAlertPrices falls back to the latest recorded MarketPrice row, which
// has NO age bound in SQL (latest-price.ts picks the newest row whatever its
// age). Triggering on an unbounded-stale price fires alerts on prices that are
// not current (suspended/halted companies, scanner gaps, missed imports).
//
// MAX AGE: 7 calendar days. Rationale: EGX suspensions can legitimately keep a
// security untraded for several sessions, and Egyptian weekend (Fri/Sat) +
// public holidays mean 3-4 quiet days is NORMAL — a 48h gate would skip
// suspended-but-still-relevant securities. Anything older than a week is
// treated as ancient and never triggers. The snapshot path (movers row from
// the session snapshot) is exempt by design: it is refreshed intraday and the
// cron/refresh paths kick a refresh long before 7 days.
//
// Disclosed in code here, in evaluate.ts's evaluation loop, and in the audit
// report. Changing it changes trigger behavior — keep it a named constant.
export const FALLBACK_PRICE_MAX_AGE_MS = 7 * 24 * 3_600_000

/**
 * True when the fallback DB price is fresh enough to trigger on.
 * `asOf` is the ISO timestamp of the resolved price (from MarketPrice row).
 * Unknown/unparseable age → treated as STALE (fail-closed: never fire blind).
 */
export function fallbackPriceIsFresh(asOf: string | null | undefined, now: Date): boolean {
  if (!asOf) return false
  const t = Date.parse(asOf)
  if (!Number.isFinite(t)) return false
  return now.getTime() - t <= FALLBACK_PRICE_MAX_AGE_MS
}

// ---------------------------------------------------------------------------
// F-04 weekend guard
// ---------------------------------------------------------------------------
// Why: on Fri/Sat (Cairo) the TradingView scanner still answers — with
// THURSDAY's close. runRefresh stamps `fetchedAt` as asOf/pricesAsOf, so a
// Friday/Saturday run re-stamps Thursday's prices as "fresh". Evaluating
// against that would fire alerts created Thursday evening / Friday on data
// that claims to be new but is the same already-seen close (phantom
// Friday/Saturday sessions — the same defect egx-session.ts fixed for bars).
//
// Rule (using the existing egx-session helpers, no invented calendar):
//   * Cairo trading day (Sun–Thu) → always evaluate.
//   * Fri/Sat → skip UNLESS the data about to be evaluated belongs to a
//     DIFFERENT (older) session than the session today restates:
//       - refresh path: compare the session of the data just fetched with the
//         session of the previously stored snapshot. Friday fetch (restating
//         Thursday) after a Thursday snapshot → same session → skip. If
//         Thursday's refreshes all failed and the previous snapshot is
//         Wednesday, the Friday fetch carries genuinely NEW Thursday-session
//         data → evaluate (first recording, not a re-stamp).
//       - cron path (no "previous" snapshot concept): skip only when the
//         stored data's session === the session today restates (the phantom);
//         genuinely older data still evaluates, bounded by the freshness
//         guard above (its asOf is honestly old, not re-stamped).
//   * Unknown previous snapshot on the refresh path → fail CLOSED (skip on
//     Fri/Sat): the phantom re-stamp is the audited harm; a first-ever Friday
//     deployment skipping one evaluation is harmless.
//
// This guard gates only the TRIGGER evaluation (price comparison). It must
// NEVER gate outbox draining — delivering an already-triggered alert is
// correct on any day of the week.

export interface AlertEvaluationGateInput {
  /** Current instant (Cairo weekday decides trading day). */
  now: Date
  /** Instant of the data about to be evaluated (fetch time or snapshot pricesAsOf). */
  dataAsOf: string | Date | null
  /**
   * Refresh path only: instant of the previously STORED snapshot's data.
   * Omit entirely on the cron path. `null` = unknown/first-ever snapshot.
   */
  prevDataAsOf?: string | Date | null
}

export function alertEvaluationGate(input: AlertEvaluationGateInput): { evaluate: boolean; reason: string } {
  if (isEgxTradingDay(input.now)) return { evaluate: true, reason: "trading-day" }

  const dataSession = input.dataAsOf ? effectiveEgxSessionDate(input.dataAsOf) : null
  if (dataSession === null) return { evaluate: false, reason: "weekend-no-data" }

  const restatedSession = effectiveEgxSessionDate(input.now)
  if (input.prevDataAsOf === undefined) {
    // Cron path: skip only the phantom re-stamp (stored session == restated).
    return dataSession === restatedSession
      ? { evaluate: false, reason: "weekend-restated-close" }
      : { evaluate: true, reason: "weekend-older-data" }
  }

  // Refresh path: compare with the previously stored snapshot's session.
  if (input.prevDataAsOf === null) return { evaluate: false, reason: "weekend-prev-unknown" }
  const prevSession = effectiveEgxSessionDate(input.prevDataAsOf)
  return prevSession === dataSession
    ? { evaluate: false, reason: "weekend-restated-close" }
    : { evaluate: true, reason: "weekend-new-session-data" }
}

// ---------------------------------------------------------------------------
// F-07 UI truth: delivery state derived from the outbox row
// ---------------------------------------------------------------------------
// "Triggered" must not imply "delivered". The alerts GET route left-joins the
// NotificationOutbox row for each triggered alert; this pure mapper turns it
// into the honest state the UI renders (Arabic-first labels live in the page).

export type DeliveryState = "SENT" | "RETRYING" | "PENDING" | "FAILED"

export interface OutboxDeliveryRow {
  status: string
  attempts: number
  sentAt: Date | string | null
  nextAttemptAt: Date | string | null
}

export interface DeliveryStateInfo {
  state: DeliveryState
  attempts: number
  /** ISO timestamp when the push was accepted by the provider (state=SENT). */
  sentAt: string | null
  /** ISO timestamp of the next scheduled retry (state=RETRYING/PENDING). */
  nextRetryAt: string | null
}

function toIso(d: Date | string | null): string | null {
  if (!d) return null
  const t = d instanceof Date ? d.getTime() : Date.parse(d)
  return Number.isFinite(t) ? new Date(t).toISOString() : null
}

/**
 * Map an outbox row to the user-facing delivery state. Returns null when
 * there is no row — which for a triggered alert means it predates the outbox
 * (legacy): delivery state is honestly UNKNOWN and the UI falls back to the
 * plain trigger timestamp.
 */
export function deliveryInfoFromOutbox(row: OutboxDeliveryRow | null | undefined): DeliveryStateInfo | null {
  if (!row) return null
  const attempts = Number.isFinite(row.attempts) ? row.attempts : 0
  const nextRetryAt = toIso(row.nextAttemptAt)
  switch (row.status) {
    case "SENT":
      return { state: "SENT", attempts, sentAt: toIso(row.sentAt), nextRetryAt: null }
    case "PENDING":
    case "SENDING":
      // PENDING with attempts=0 = claimed, first dispatch not yet attempted.
      // PENDING/SENDING with attempts>0 = at least one failed attempt → retrying.
      return {
        state: attempts > 0 ? "RETRYING" : "PENDING",
        attempts,
        sentAt: null,
        nextRetryAt,
      }
    case "DEAD":
      return { state: "FAILED", attempts, sentAt: null, nextRetryAt: null }
    default:
      return null
  }
}
