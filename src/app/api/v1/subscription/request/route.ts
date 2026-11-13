import { NextRequest } from "next/server"
import { db } from "@/lib/db"
import { requireAuth } from "@/lib/access"
import { audit } from "@/lib/audit"
import { checkEndpointRateLimit, getClientIp } from "@/lib/rate-limit"
import { withKeyLock } from "@/lib/key-lock"
import { planFirstMonthAmount } from "@/lib/subscription"

// POST /api/v1/subscription/request — user requests a paid subscription
// (body { planId: "PRO" | "PRO_PLUS" }; a missing planId defaults to PRO for
// back-compat with old clients that only knew the single paid plan).
//
// Race safety: the whole flow runs under a per-user key lock, so parallel
// submissions from the same account are serialized (the old code's
// find-then-create could race two requests into a duplicate PaymentRequest
// or even a unique-violation on Subscription.userId). The subscription write
// is an upsert keyed by the unique userId, and the payment-request dedup
// check runs inside the same lock as the subscription write.
//
// Pricing integrity: the amount to transfer is ALWAYS computed server-side
// from the Plan row (offer price when the first-month offer is active, full
// price otherwise). The client never sends or edits an amount.
const REQUESTABLE_PLAN_NAMES = ["PRO", "PRO_PLUS"] as const

export async function POST(req: NextRequest) {
  const userId = await requireAuth(req)
  if (!userId) {
    return Response.json({ error: "UNAUTHENTICATED", message: "Authentication required." }, { status: 401 })
  }

  const ip = getClientIp(req)
  const rateLimit = await checkEndpointRateLimit("subscription-request", ip)
  if (!rateLimit.allowed) {
    const retryAfter = Math.ceil((rateLimit.resetAt - Date.now()) / 1000)
    return Response.json(
      { error: "RATE_LIMITED", message: "Too many subscription requests. Please try again later.", retryAfter },
      { status: 429, headers: { "Retry-After": String(retryAfter) } }
    )
  }

  const body = (await req.json().catch(() => ({}))) as { notes?: string; planId?: string }

  const requestedPlanName =
    typeof body.planId === "string" && REQUESTABLE_PLAN_NAMES.includes(body.planId.trim() as (typeof REQUESTABLE_PLAN_NAMES)[number])
      ? (body.planId.trim() as (typeof REQUESTABLE_PLAN_NAMES)[number])
      : "PRO"

  const outcome = await withKeyLock(`sub-req:${userId}`, async () => {
    const plan = await db.plan.findFirst({
      where: { name: requestedPlanName, isActive: true },
      select: { id: true, name: true, price: true, offerActive: true, offerPrice: true, currency: true, durationDays: true },
    })
    if (!plan) {
      return {
        error: "VALIDATION",
        status: 404,
        message: `الباقة المطلوبة (${requestedPlanName}) غير متاحة حاليًا.`,
      } as const
    }

    const existing = await db.subscription.findUnique({ where: { userId } })
    if (existing) {
      if (existing.status === "ACTIVE") {
        return { error: "ALREADY_PREMIUM", status: 400, message: "You already have an active subscription." } as const
      }
      if (existing.status === "PENDING") {
        return { error: "REQUEST_PENDING", status: 400, message: "Your subscription request is already pending approval.", subscriptionId: existing.id } as const
      }
      await db.subscription.update({
        where: { id: existing.id },
        data: { status: "PENDING", planId: plan.id, notes: body.notes ?? existing.notes },
      })
    } else {
      await db.subscription.create({
        data: {
          userId,
          planId: plan.id,
          status: "PENDING",
        },
      })
    }

    // create/refresh the PaymentRequest so the request surfaces on /admin/payments
    const existingPr = await db.paymentRequest.findFirst({
      where: { userId, planId: plan.id, status: "PENDING" },
      orderBy: { createdAt: "desc" },
    })
    if (!existingPr) {
      await db.paymentRequest.create({
        data: {
          userId,
          planId: plan.id,
          amount: planFirstMonthAmount(plan),
          currency: plan.currency,
          paymentMethod: "MANUAL_TRANSFER",
          status: "PENDING",
        },
      })
    }
    return { ok: true as const, plan }
  })

  if ("error" in outcome) {
    return Response.json(
      { error: outcome.error, message: outcome.message, ...(outcome.subscriptionId ? { subscriptionId: outcome.subscriptionId } : {}) },
      { status: outcome.status }
    )
  }

  await audit("SUBSCRIPTION_REQUESTED", { actor: userId, entityType: "Subscription", details: `${outcome.plan.name} subscription requested by ${userId}` })
  return Response.json({
    success: true,
    status: "PENDING",
    plan: { id: outcome.plan.id, name: outcome.plan.name, durationDays: outcome.plan.durationDays },
    amountToPay: planFirstMonthAmount(outcome.plan),
    currency: outcome.plan.currency,
  })
}
