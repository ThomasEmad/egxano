import { NextRequest } from "next/server"
import { db } from "@/lib/db"
import { getSessionUser } from "@/lib/auth"
import { checkEndpointRateLimit, getClientIp } from "@/lib/rate-limit"
import { audit } from "@/lib/audit"
import { getFreshMarketSnapshot } from "@/lib/market/snapshot"
import { alertHit, deactivateAndNotify, resolveAlertPrices, type TriggeredAlert } from "@/lib/alerts/evaluate"
import { getActivePlanId } from "@/lib/subscription"
import { PLANS } from "@/lib/plans/entitlements"

// GET    /api/v1/alerts            — list the signed-in user's price alerts
//                                    (lazily evaluates active alerts against
//                                    the freshest recorded price, marks
//                                    newly-triggered ones and delivers their
//                                    Web Push notification).
// POST   /api/v1/alerts            — { companyId, direction: ABOVE|BELOW,
//                                    targetPrice } — capped per plan
//                                    (FREE 5 / PRO 30 / PRO_PLUS 100 active
//                                    alerts, from the plans entitlements).
// DELETE /api/v1/alerts?id=...     — owner-only removal.
//
// Evaluation model: alerts fire against RECORDED market prices (the same
// 15-minute-delayed snapshot the rest of the platform shows) — never against
// intraday guesses. Lazy evaluation on read keeps the model simple and the
// write load zero: the client polls while the session is open. The comparison
// + dedupe + push delivery live in src/lib/alerts/evaluate.ts (shared with
// the snapshot-write hook and the cron route so they can't drift).

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

    const hits: TriggeredAlert[] = []
    const priced = active.map((a) => {
      const p = prices.get(a.companyId) ?? null
      const hit = p !== null && alertHit(a.direction, a.targetPrice, p.price)
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
      }
    })

    // Fire the triggered alerts (deactivate + Web Push, deduped by the shared
    // evaluator's atomic claim — see src/lib/alerts/evaluate.ts).
    if (hits.length > 0) {
      await deactivateAndNotify(hits)
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
      }))

    return Response.json({ alerts: [...priced, ...inactive] }, { headers: { "Cache-Control": "no-store" } })
  }

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
      })),
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

  // per-plan active-alert cap (FREE 5 / PRO 30 / PRO_PLUS 100)
  const planId = await getActivePlanId(userId)
  const cap = PLANS[planId].limits.alerts
  const activeCount = await db.priceAlert.count({ where: { userId, active: true } })
  if (cap !== "UNLIMITED" && activeCount >= cap) {
    const message =
      planId === "FREE"
        ? `حد التنبيهات للمجانية ${cap} — متاح أكتر مع باقة برو.`
        : planId === "PRO"
          ? "حد التنبيهات لباقة برو 30 — متاح أكتر مع باقة برو بلس."
          : `وصلت الحد الأقصى للتنبيهات في باقة برو بلس (${cap}).`
    return Response.json(
      { error: "QUOTA", message, limit: cap, plan: planId },
      { status: 403 }
    )
  }

  const alert = await db.priceAlert.create({
    data: { userId, companyId, direction, targetPrice },
    select: { id: true },
  })
  await audit("ALERT_CREATED", {
    actor: userId,
    entityType: "PriceAlert",
    entityId: alert.id,
    details: `${direction} ${targetPrice} for company ${companyId}`,
  })

  return Response.json({ ok: true, id: alert.id }, { status: 201 })
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
