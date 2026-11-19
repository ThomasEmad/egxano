import { NextRequest } from "next/server"
import { db } from "@/lib/db"
import { getSessionUser } from "@/lib/auth"
import { checkEndpointRateLimit, getClientIp } from "@/lib/rate-limit"
import { audit } from "@/lib/audit"
import { getFreshMarketSnapshot } from "@/lib/market/snapshot"
import { alertHit, deactivateAndNotify, resolveAlertPrices, fallbackPriceIsFresh, type TriggeredAlert } from "@/lib/alerts/evaluate"
import { deliveryInfoFromOutbox, type DeliveryStateInfo } from "@/lib/alerts/logic"
import { drainOutbox, OUTBOX_DRAIN_PRESETS } from "@/lib/alerts/outbox-dispatch"
import { getActivePlanId } from "@/lib/subscription"
import { PLANS, paidPlanCapMessageAr } from "@/lib/plans/entitlements"
import { withKeyLock } from "@/lib/key-lock"

// GET    /api/v1/alerts            — list the signed-in user's price alerts
//                                    (lazily evaluates active alerts against
//                                    the freshest recorded price, marks
//                                    newly-triggered ones and publishes their
//                                    delivery through the NotificationOutbox),
//                                    then drains THIS user's due outbox jobs
//                                    and reports honest per-alert DELIVERY
//                                    state (sent / retrying / pending / failed)
//                                    so "triggered" never implies "delivered".
// POST   /api/v1/alerts            — { companyId, direction: ABOVE|BELOW,
//                                    targetPrice } — capped per plan
//                                    (FREE 5 / PRO 30 active alerts — retired
//                                    PRO_PLUS resolves to PRO; entitlements).
// DELETE /api/v1/alerts?id=...     — owner-only removal.
//
// Evaluation model: alerts fire against RECORDED market prices (the same
// 15-minute-delayed snapshot the rest of the platform shows) — never against
// intraday guesses. Lazy evaluation on read keeps the model simple and the
// write load zero: the client polls while the session is open. The comparison
// + dedupe + transactional publish live in src/lib/alerts/evaluate.ts (shared
// with the snapshot-write hook and the cron route so they can't drift).
//
// Freshness guard (audit F-03): a hit resolved from the fallback DB price
// (not the session snapshot) only triggers when that price's asOf is within
// FALLBACK_PRICE_MAX_AGE_MS (7 days); a stale hit is skipped WITHOUT
// consuming the alert.
//
// Outbox drain (bounded, user-scoped): every GET also dispatches this user's
// due outbox jobs (retry ladder + abandoned-SENDING lease recovery), so an
// open /alerts page (60 s poll) keeps their own deliveries moving. Honest
// latency of the pipeline as a whole: minutes with traffic; up to ~24 h
// between attempts at zero traffic (the daily cron is the floor); DEAD after
// maxAttempts (see src/lib/alerts/outbox-logic.ts).

export async function GET(req: NextRequest) {
  const token = req.headers.get("x-session-token")
  const userId = await getSessionUser(token)
  if (!userId) return Response.json({ error: "UNAUTHORIZED" }, { status: 401 })

  const alerts = await db.priceAlert.findMany({
    where: { userId },
    include: {
      company: { select: { id: true, ticker: true, nameEn: true, nameAr: true, sector: true } },
    },
    orderBy: [{ active: "desc" }, { createdAt: "desc" }],
  })

  // Delivery ledger (UI truth, audit F-07): left-join the outbox row of every
  // triggered alert so the page can show Delivered / Retrying / Pending /
  // Failed instead of implying delivery. Fetched AFTER the dispatch below so
  // the statuses reflect this very request's send attempts.
  const deliveryByAlertId = new Map<string, DeliveryStateInfo>()
  const attachDelivery = async () => {
    try {
      const ids = alerts.map((a) => a.id)
      if (ids.length === 0) return
      const rows = await db.notificationOutbox.findMany({ where: { alertId: { in: ids } } })
      for (const row of rows) {
        const info = deliveryInfoFromOutbox(row)
        if (info) deliveryByAlertId.set(row.alertId, info)
      }
    } catch (e) {
      // Decoration is best-effort — never fail the list over it.
      console.warn("outbox delivery join failed:", e instanceof Error ? e.message.slice(0, 160) : String(e))
    }
  }

  // lazy evaluation against the freshest recorded price
  const active = alerts.filter((a) => a.active)
  if (active.length > 0) {
    // Freshest snapshot (DB Setting + opportunistic refresh) — not the frozen
    // build-time file, so alerts evaluate against session-fresh prices.
    const snapshot = await getFreshMarketSnapshot()
    const prices = await resolveAlertPrices(
      active.map((a) => ({ companyId: a.companyId, ticker: a.company.ticker })),
      snapshot,
    )

    const now = new Date()
    const hits: TriggeredAlert[] = []
    let staleSkipped = 0
    const priced = active.map((a) => {
      const p = prices.get(a.companyId) ?? null
      const hitPrice = p !== null && alertHit(a.direction, a.targetPrice, p.price)
      // F-03 freshness guard: only the fallback DB-price path is age-gated;
      // the snapshot path keeps existing behavior (intraday data). A stale
      // hit is counted and skipped WITHOUT consuming the alert.
      const hit = hitPrice && (p.source === "snapshot" || fallbackPriceIsFresh(p.asOf, now))
      if (hitPrice && !hit) staleSkipped++
      if (hit) {
        hits.push({
          id: a.id,
          userId: a.userId,
          ticker: a.company.ticker,
          direction: a.direction,
          targetPrice: a.targetPrice,
          price: p.price,
        })
      }
      return {
        id: a.id,
        companyId: a.companyId,
        ticker: a.company.ticker,
        nameEn: a.company.nameEn,
        nameAr: a.company.nameAr,
        sector: a.company.sector,
        direction: a.direction,
        targetPrice: a.targetPrice,
        active: a.active,
        triggeredAt: a.triggeredAt?.toISOString() ?? null,
        currentPrice: p?.price ?? null,
        priceAsOf: p?.asOf ?? null,
        hitNow: hit,
        delivery: null as DeliveryStateInfo | null,
      }
    })

    // Fire the triggered alerts (deactivate + transactional outbox publish +
    // inline dispatch, deduped by the shared evaluator's atomic claim — see
    // src/lib/alerts/evaluate.ts). Then sweep this user's due outbox jobs so
    // pending/abandoned deliveries move while the page is open. Both are
    // bounded and best-effort.
    let drained = { drained: 0, sent: 0, dead: 0, retried: 0 }
    if (hits.length > 0) {
      await deactivateAndNotify(hits)
    }
    try {
      drained = await drainOutbox({ userId, ...OUTBOX_DRAIN_PRESETS.userGet })
    } catch (e) {
      console.warn("outbox user drain failed:", e instanceof Error ? e.message.slice(0, 160) : String(e))
    }
    await attachDelivery()
    for (const row of priced) {
      if (!row.active) row.delivery = deliveryByAlertId.get(row.id) ?? null
    }

    const inactive = alerts
      .filter((a) => !a.active)
      .map((a) => ({
        id: a.id,
        companyId: a.companyId,
        ticker: a.company.ticker,
        nameEn: a.company.nameEn,
        nameAr: a.company.nameAr,
        sector: a.company.sector,
        direction: a.direction,
        targetPrice: a.targetPrice,
        active: a.active,
        triggeredAt: a.triggeredAt?.toISOString() ?? null,
        currentPrice: null,
        priceAsOf: null,
        hitNow: false,
        // null = no outbox row: legacy trigger predating the outbox — delivery
        // state is honestly unknown (UI falls back to the trigger timestamp).
        delivery: (deliveryByAlertId.get(a.id) ?? null) as DeliveryStateInfo | null,
      }))

    return Response.json(
      { alerts: [...priced, ...inactive], outbox: drained, staleSkipped },
      { headers: { "Cache-Control": "no-store" } }
    )
  }

  // No active alerts: still sweep this user's due outbox jobs (recovery) and
  // attach delivery state to whatever fired earlier.
  let drained = { drained: 0, sent: 0, dead: 0, retried: 0 }
  try {
    drained = await drainOutbox({ userId, ...OUTBOX_DRAIN_PRESETS.userGet })
  } catch (e) {
    console.warn("outbox user drain failed:", e instanceof Error ? e.message.slice(0, 160) : String(e))
  }
  await attachDelivery()

  return Response.json(
    {
      alerts: alerts.map((a) => ({
        id: a.id,
        companyId: a.companyId,
        ticker: a.company.ticker,
        nameEn: a.company.nameEn,
        nameAr: a.company.nameAr,
        sector: a.company.sector,
        direction: a.direction,
        targetPrice: a.targetPrice,
        active: a.active,
        triggeredAt: a.triggeredAt?.toISOString() ?? null,
        currentPrice: null,
        priceAsOf: null,
        hitNow: false,
        delivery: (deliveryByAlertId.get(a.id) ?? null) as DeliveryStateInfo | null,
      })),
      outbox: drained,
    },
    { headers: { "Cache-Control": "no-store" } }
  )
}

export async function POST(req: NextRequest) {
  const token = req.headers.get("x-session-token")
  const userId = await getSessionUser(token)
  if (!userId) return Response.json({ error: "UNAUTHORIZED" }, { status: 401 })

  const rl = await checkEndpointRateLimit("alerts-write", getClientIp(req))
  if (!rl.allowed) {
    return Response.json({ error: "RATE_LIMITED", message: "Too many changes — slow down a little." }, { status: 429 })
  }

  const body = await req.json().catch(() => ({}))
  const companyId = typeof body?.companyId === "string" ? body.companyId : ""
  const direction = body?.direction === "ABOVE" ? "ABOVE" : body?.direction === "BELOW" ? "BELOW" : null
  const targetPrice = Number(body?.targetPrice)

  if (!companyId || !direction || !Number.isFinite(targetPrice) || targetPrice <= 0) {
    return Response.json(
      { error: "VALIDATION", message: "companyId, direction (ABOVE|BELOW) and a positive targetPrice are required" },
      { status: 400 }
    )
  }

  const company = await db.company.findUnique({ where: { id: companyId }, select: { id: true, isActive: true } })
  if (!company || !company.isActive) {
    return Response.json({ error: "NOT_FOUND", message: "Unknown company" }, { status: 404 })
  }

  // per-plan active-alert cap (FREE 5 / PRO 30 — retired PRO_PLUS resolves to
  // PRO). Count + create run under the same per-user lock portfolio uses, so
  // two parallel adds cannot both observe count < cap and slip past it.
  const planId = await getActivePlanId(userId)
  const cap = PLANS[planId].limits.alerts
  const createdId = await withKeyLock(`alerts:${userId}`, async () => {
    const activeCount = await db.priceAlert.count({ where: { userId, active: true } })
    if (cap !== "UNLIMITED" && activeCount >= cap) return null
    const alert = await db.priceAlert.create({
      data: { userId, companyId, direction, targetPrice },
      select: { id: true },
    })
    return alert.id
  })
  if (!createdId) {
    // Honest copy: the caller's CURRENT plan and its real cap — never an
    // upsell to the retired "Pro Plus" tier (paidPlanCapMessageAr).
    const message =
      planId === "FREE"
        ? `حد التنبيهات للمجانية ${cap} — متاح أكتر مع باقة برو.`
        : paidPlanCapMessageAr(planId, cap, "تنبيه نشط")
    return Response.json(
      { error: "QUOTA", message, limit: cap, plan: planId },
      { status: 403 }
    )
  }

  await audit("ALERT_CREATED", {
    actor: userId,
    entityType: "PriceAlert",
    entityId: createdId,
    details: `${direction} ${targetPrice} for company ${companyId}`,
  })

  return Response.json({ ok: true, id: createdId }, { status: 201 })
}

export async function DELETE(req: NextRequest) {
  const token = req.headers.get("x-session-token")
  const userId = await getSessionUser(token)
  if (!userId) return Response.json({ error: "UNAUTHORIZED" }, { status: 401 })

  const id = new URL(req.url).searchParams.get("id") || ""
  const existing = await db.priceAlert.findUnique({ where: { id }, select: { userId: true } })
  if (!existing || existing.userId !== userId) {
    return Response.json({ error: "NOT_FOUND" }, { status: 404 })
  }
  await db.priceAlert.delete({ where: { id } })
  return Response.json({ ok: true })
}
