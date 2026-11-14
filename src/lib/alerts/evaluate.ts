import { db } from "@/lib/db"
import { latestPricesPerCompany } from "@/lib/market/latest-price"
import { moverMap, type MarketSnapshot } from "@/lib/market/snapshot"
import { sendPushToUser } from "@/lib/web-push"

// Shared price-alert evaluation — the ONE place that compares alerts against
// recorded prices and delivers Web Push. Three callers share it so the
// comparison logic can never drift:
//   * GET /api/v1/alerts          — lazy per-user evaluation while the site is open
//   * src/lib/market/refresh.ts   — every successful snapshot write (the hook
//                                   that makes alerts fire with the site CLOSED)
//   * GET /api/v1/cron/alerts-push — safety-net re-run every 10 minutes
//
// Dedupe (why there is no PushLog table): PriceAlert already models a one-shot
// trigger lifecycle — `active: true` until it hits, then `active: false` +
// `triggeredAt` stamped (the alerts UI shows fired alerts as "تنبيهات مُطلقة"
// and the user re-arms by creating a new alert). Firing therefore notifies AT
// MOST ONCE per trigger — strictly stronger than any 12h cooldown; a re-notify
// requires the user to reset the alert first. Racing evaluators (lazy GET vs
// snapshot hook vs cron) are arbitrated by an atomic claim: each hit is
// deactivated with a conditional updateMany (`active: true` in the WHERE) and
// only the caller whose update matched 1 row sends the push.

/** Exact comparison used everywhere (was inlined in GET /api/v1/alerts). */
export function alertHit(direction: string, targetPrice: number, price: number): boolean {
  return (direction === "ABOVE" && price >= targetPrice) || (direction === "BELOW" && price <= targetPrice)
}

export interface ResolvedPrice {
  price: number
  asOf: string | null
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
    out.set(ref.companyId, { price, asOf })
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

/**
 * Atomically deactivate every triggered alert and push-notify the winners.
 * The conditional update (`WHERE active = true`) is the dedupe: of all the
 * racing evaluators, exactly one flips the flag — that one sends the push.
 * Push send itself is best-effort (sendPushToUser never throws).
 */
export async function deactivateAndNotify(hits: TriggeredAlert[]): Promise<{ triggered: number; sent: number }> {
  let sent = 0
  const now = new Date()
  await Promise.allSettled(
    hits.map(async (hit) => {
      const claim = await db.priceAlert.updateMany({
        where: { id: hit.id, active: true },
        data: { active: false, triggeredAt: now },
      })
      if (claim.count !== 1) return // another evaluator already fired this alert
      const res = await sendPushToUser(hit.userId, pushPayloadFor(hit))
      sent += res.sent
    })
  )
  return { triggered: hits.length, sent }
}

export interface AlertEvalSummary {
  checked: number
  triggered: number
  sent: number
}

/** Evaluate ALL active alerts against a snapshot (hook + cron path). */
export async function evaluateAndNotifyAllAlerts(snapshot: MarketSnapshot | null): Promise<AlertEvalSummary> {
  const active = await db.priceAlert.findMany({
    where: { active: true },
    include: { company: { select: { id: true, ticker: true } } },
  })
  if (active.length === 0) return { checked: 0, triggered: 0, sent: 0 }

  const prices = await resolveAlertPrices(
    active.map((a) => ({ companyId: a.companyId, ticker: a.company.ticker })),
    snapshot,
  )
  const hits: TriggeredAlert[] = []
  for (const a of active) {
    const p = prices.get(a.companyId)
    if (p && alertHit(a.direction, a.targetPrice, p.price)) {
      hits.push({ id: a.id, userId: a.userId, ticker: a.company.ticker, direction: a.direction, targetPrice: a.targetPrice, price: p.price })
    }
  }
  if (hits.length === 0) return { checked: active.length, triggered: 0, sent: 0 }
  const { sent } = await deactivateAndNotify(hits)
  return { checked: active.length, triggered: hits.length, sent }
}
