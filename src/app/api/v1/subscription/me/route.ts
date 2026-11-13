import { NextRequest } from "next/server"
import { requireAuth } from "@/lib/access"
import { getActivePlanId, getSubscriptionSummary } from "@/lib/subscription"
import { getSmartAnalysisUsage } from "@/lib/smart-analysis-usage"

// GET /api/v1/subscription/me — current user's subscription status + smart analysis usage.
// `plan` is the canonical PlanId ("FREE" | "PRO" | "PRO_PLUS") resolved from the
// user's ACTIVE subscription (FREE when none/expired); `isPremium` stays true
// for any paid plan (PRO and PRO_PLUS).
export async function GET(req: NextRequest) {
  const userId = await requireAuth(req)
  if (!userId) {
    return Response.json({ error: "UNAUTHENTICATED", message: "Authentication required." }, { status: 401 })
  }

  const summary = await getSubscriptionSummary(userId)
  const plan = await getActivePlanId(userId)
  const usage = await getSmartAnalysisUsage(userId)

  return Response.json({
    ...summary,
    plan,
    smartAnalysisUsage: usage,
  })
}
