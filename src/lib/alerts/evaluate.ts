import { db } from "@/lib/db"
import { ensureNotificationOutboxTable } from "@/lib/db-schema-bootstrap"
import { latestPricesPerCompany } from "@/lib/market/latest-price"
import { moverMap, type MarketSnapshot } from "@/lib/market/snapshot"
import { drainOutbox, OUTBOX_DRAIN_PRESETS } from "@/lib/alerts/outbox-dispatch"
import { publishDecision } from "@/lib/alerts/outbox-logic"
import { alertHit, fallbackPriceIsFresh } from "@/lib/alerts/logic"

// Shared price-alert evaluation — the ONE place that compares alerts against
// recorded prices and enqueues delivery. Three callers share it so the
// comparison logic can never drift:
//   * GET /api/v1/alerts          — lazy per-user evaluation while the site is open
//   * src/lib/market/refresh.ts   — every successful snapshot write (the hook
//                                   that makes alerts fire with the site CLOSED)
//   * GET /api/v1/cron/alerts-push — daily safety-net re-run (Vercel Hobby
//                                   allows daily crons only; 14:00 UTC = after
//                                   EGX close + delayed data has landed)
//
// Delivery model (Transactional Outbox — docs/notes/notification-audit.md §5,
// closing audit findings F-01/F-02): claiming an alert and publishing its
// delivery task happen in ONE database transaction. PriceAlert still models
// the one-shot trigger lifecycle — `active: true` until it hits, then
// `active: false` + `triggeredAt` stamped — but the notification is no longer
// fire-and-forget: a NotificationOutbox row (event key = alertId, UNIQUE)
// records the owed delivery, and outbox-dispatch.ts drains those rows with
// retries/backoff/dead-lettering. A crash between claim and send therefore
// loses nothing: either both the deactivation and the outbox row commit, or
// neither does, and the row is delivered by the next drain (lease expiry
// recovers kills mid-send). Duplicate events are impossible: the outbox
// alertId UNIQUE constraint rejects a second publish for the same trigger.
//
// Racing evaluators (lazy GET vs snapshot hook vs cron) are still arbitrated
// by the atomic claim: each hit is deactivated with a conditional updateMany
// (`active: true` in the WHERE) and only the caller whose update matched 1 row
// publishes the outbox event.

// Re-exports keep the historical import surface (`@/lib/alerts/evaluate`)
// stable for the route/refresh callers while the implementations live in the
// db-free, unit-tested modules (src/lib/alerts/logic.ts).
export { alertHit, alertEvaluationGate, fallbackPriceIsFresh, FALLBACK_PRICE_MAX_AGE_MS } from "@/lib/alerts/logic"

export interface ResolvedPrice {
  price: number
  asOf: string | null
  /** Where this price came from: the session snapshot's movers (intraday,
   *  freshness-exempt) or the latest MarketPrice row (fallback — subject to
   *  the F-03 freshness guard before triggering). */
  source: "snapshot" | "fallback"
}

/**
 * Freshest recorded price per alert company: the session snapshot's mover
 * rows win, the latest MarketPrice row (DISTINCT ON) is the fallback — the
 * same precedence the alerts GET route always used.
 *
 * `snapshot` is passed in by the caller (refresh.ts already holds the one it
 * just wrote; the cron/GET routes call getFreshMarketSnapshot()). Reading it
 * again here would race the 15s lambda cache and evaluate against stale
 * prices right after a refresh.
 */
export async function resolveAlertPrices(
  refs: { companyId: string; ticker: string }[],
  snapshot: MarketSnapshot | null,
): Promise<Map<string, ResolvedPrice>> {
  const out = new Map<string, ResolvedPrice>()
  if (refs.length === 0) return out
  const ids = [...new Set(refs.map((r) => r.companyId))]
  const movers = moverMap(snapshot)
  const snapAsOf = snapshot?.pricesAsOf ?? snapshot?.asOf ?? null
  const dbLatest = await latestPricesPerCompany(ids)
  for (const ref of refs) {
    const snap = movers.get(ref.ticker.toUpperCase())
    const row = dbLatest.get(ref.companyId)
    const price = snap?.price ?? row?.price ?? null
    if (price === null) continue
    const asOf = snap ? snapAsOf : (row?.asOf?.toISOString() ?? null)
    out.set(ref.companyId, { price, asOf, source: snap ? "snapshot" : "fallback" })
  }
  return out
}

export interface TriggeredAlert {
  id: string
  userId: string
  ticker: string
  direction: string
  targetPrice: number
  price: number
}

/** OS-notification copy (Arabic-first — the product's primary audience). */
function pushPayloadFor(hit: TriggeredAlert): { title: string; body: string; url: string } {
  const dirAr = hit.direction === "ABOVE" ? "فوق" : "تحت"
  return {
    title: `تنبيه سعر ${hit.ticker}`,
    body: `السعر بلغ ${hit.price} ج.م — هدفك كان ${dirAr} ${hit.targetPrice} ج.م`,
    url: `/company/${hit.ticker}`,
  }
}

export interface DeactivateSummary {
  triggered: number
  /** Alerts that published an outbox event (won the claim race). */
  published: number
  /** Outbox jobs confirmed SENT by the inline post-commit dispatch. */
  sent: number
}

/**
 * Atomically deactivate every triggered alert AND publish its delivery task
 * (NotificationOutbox row) in ONE transaction per hit — closing the audit's
 * F-01 crash window: a kill at any point leaves either both absent (a later
 * evaluator re-claims) or both present (the drain delivers). After the
 * commit, an inline bounded dispatch attempts immediate delivery (seconds in
 * the common case); anything it cannot finish is retried by the outbox
 * ladder (see outbox-dispatch.ts for the honest latency contract).
 */
export async function deactivateAndNotify(hits: TriggeredAlert[]): Promise<DeactivateSummary> {
  let published = 0
  let sent = 0
  if (hits.length === 0) return { triggered: 0, published: 0, sent: 0 }
  const now = new Date()

  // The outbox table must exist before the claim transaction runs (runtime
  // self-heal, memoized). Doing it here keeps the transaction itself free of
  // DDL and means a bootstrap failure cannot consume an alert.
  await ensureNotificationOutboxTable()

  await Promise.allSettled(
    hits.map(async (hit) => {
      try {
        const outcome = await db.$transaction(async (tx) => {
          // 1. Atomic claim — of all racing evaluators, exactly one flips the
          //    flag; everyone else gets count !== 1 and stops here.
          const claim = await tx.priceAlert.updateMany({
            where: { id: hit.id, active: true },
            data: { active: false, triggeredAt: now },
          })
          if (publishDecision(claim.count) !== "published") return "lost-race" as const
          // 2. Publish the delivery task IN THE SAME TRANSACTION. alertId is
          //    UNIQUE (the event key): even a hypothetical second publish path
          //    is rejected by the DB — duplicate trigger events are impossible.
          await tx.notificationOutbox.create({
            data: {
              alertId: hit.id,
              userId: hit.userId,
              ticker: hit.ticker,
              direction: hit.direction,
              targetPrice: hit.targetPrice,
              triggerPrice: hit.price,
              payload: pushPayloadFor(hit),
              status: "PENDING",
            },
          })
          return "published" as const
        })
        if (outcome !== "published") return // another evaluator already fired this alert

        published++
        // 3. Inline post-commit dispatch — best-effort, bounded (preset
        //    budget), never fails the host request. drainOutbox swallows its
        //    own errors; the guard is belt-and-braces for the call itself.
        try {
          const drain = await drainOutbox({ userId: hit.userId, ...OUTBOX_DRAIN_PRESETS.inline })
          sent += drain.sent
        } catch (e) {
          console.warn(
            "outbox inline dispatch failed:",
            e instanceof Error ? e.message.slice(0, 160) : String(e)
          )
        }
      } catch (e) {
        // Transaction failed (DB hiccup / unique-key rejection): the claim
        // rolled back WITH the outbox insert — the alert stays active and a
        // later evaluation retries the whole publish. Nothing is lost.
        console.warn(
          `outbox publish failed for alert ${hit.id}:`,
          e instanceof Error ? e.message.slice(0, 160) : String(e)
        )
      }
    })
  )
  return { triggered: hits.length, published, sent }
}

export interface AlertEvalSummary {
  checked: number
  triggered: number
  sent: number
  /** Alerts whose hit was resolved from a fallback DB price older than
   *  FALLBACK_PRICE_MAX_AGE_MS (F-03): skipped WITHOUT consuming the alert. */
  staleSkipped: number
}

/** Evaluate ALL active alerts against a snapshot (hook + cron path). */
export async function evaluateAndNotifyAllAlerts(snapshot: MarketSnapshot | null): Promise<AlertEvalSummary> {
  const active = await db.priceAlert.findMany({
    where: { active: true },
    include: { company: { select: { id: true, ticker: true } } },
  })
  if (active.length === 0) return { checked: 0, triggered: 0, sent: 0, staleSkipped: 0 }

  const prices = await resolveAlertPrices(
    active.map((a) => ({ companyId: a.companyId, ticker: a.company.ticker })),
    snapshot,
  )
  const now = new Date()
  const hits: TriggeredAlert[] = []
  let staleSkipped = 0
  for (const a of active) {
    const p = prices.get(a.companyId)
    if (!p || !alertHit(a.direction, a.targetPrice, p.price)) continue
    // F-03 freshness guard: a hit resolved from the fallback DB price may be
    // arbitrarily old (suspended security, missed import). Only trigger when
    // the price's asOf is within FALLBACK_PRICE_MAX_AGE_MS (7 days). Snapshot
    // path keeps existing behavior (intraday data). A stale hit is counted
    // and SKIPPED — the alert is NOT consumed and can still fire later.
    if (p.source === "fallback" && !fallbackPriceIsFresh(p.asOf, now)) {
      staleSkipped++
      continue
    }
    hits.push({ id: a.id, userId: a.userId, ticker: a.company.ticker, direction: a.direction, targetPrice: a.targetPrice, price: p.price })
  }
  if (hits.length === 0) return { checked: active.length, triggered: 0, sent: 0, staleSkipped }
  const { sent } = await deactivateAndNotify(hits)
  return { checked: active.length, triggered: hits.length, sent, staleSkipped }
}
