import { NextRequest } from "next/server"
import { db } from "@/lib/db"
import { isAdmin, unauthorizedResponse } from "@/lib/admin-auth"
import { audit } from "@/lib/audit"

// POST /api/v1/admin/payment-requests/{id}/verify — mark the payment verified
// and activate the user's pending subscription.
//
// The subscription duration comes from the PAYMENT REQUEST'S PLAN row (e.g.
// 30 days for PRO/PRO_PLUS) — never a hardcoded constant, so a different
// plan duration applies automatically.
//
// Race safety: the PENDING check and the status flip are ONE conditional
// updateMany ({ id, status: "PENDING" }), so of two concurrent verify/reject
// calls exactly one wins the claim — the loser gets 409 and never touches the
// subscription. The whole mutation runs in a single transaction so the
// payment row and the subscription upsert commit atomically (the old
// find-then-create sequence could race into two subscription rows).
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isAdmin(req))) return await unauthorizedResponse()
  const { id } = await params

  const now = new Date()

  try {
    const result = await db.$transaction(async (tx) => {
      // Atomic claim: only the first concurrent reviewer flips PENDING.
      const claim = await tx.paymentRequest.updateMany({
        where: { id, status: "PENDING" },
        data: { status: "VERIFIED", reviewedAt: now },
      })
      if (claim.count === 0) {
        const pr = await tx.paymentRequest.findUnique({ where: { id }, select: { status: true } })
        if (!pr) return { conflict: "NOT_FOUND" as const }
        return { conflict: "ALREADY_REVIEWED" as const, status: pr.status }
      }

      const pr = await tx.paymentRequest.findUnique({
        where: { id },
        select: { userId: true, planId: true, plan: { select: { name: true, durationDays: true } } },
      })
      if (!pr) return { conflict: "NOT_FOUND" as const }

      const durationDays = pr.plan?.durationDays ?? 30
      const endsAt = new Date(now.getTime() + durationDays * 24 * 60 * 60 * 1000)

      // Upsert keyed by the unique userId column — cannot duplicate.
      await tx.subscription.upsert({
        where: { userId: pr.userId },
        create: {
          userId: pr.userId,
          planId: pr.planId,
          status: "ACTIVE",
          startDate: now,
          endDate: endsAt,
          activatedAt: now,
        },
        update: {
          status: "ACTIVE",
          planId: pr.planId,
          startDate: now,
          endDate: endsAt,
          activatedAt: now,
        },
      })
      return { userId: pr.userId, durationDays, planName: pr.plan?.name ?? "" }
    })

    if ("conflict" in result) {
      if (result.conflict === "NOT_FOUND") {
        return Response.json({ error: "NOT_FOUND" }, { status: 404 })
      }
      return Response.json({ error: "ALREADY_REVIEWED", status: result.status }, { status: 409 })
    }

    await audit("PAYMENT_VERIFIED", { actor: "admin", entityType: "PaymentRequest", entityId: id, details: `Payment verified — ${result.planName} subscription activated for user ${result.userId} (${result.durationDays}d)` })
    return Response.json({ ok: true, id, status: "VERIFIED", durationDays: result.durationDays })
  } catch (e) {
    console.error("payment verify error", e)
    return Response.json({ error: "INTERNAL_ERROR" }, { status: 500 })
  }
}
