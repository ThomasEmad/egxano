// POST /api/v1/position-review — حلل سهمي: the user's average buy price + a
// company → the hold/wait/exit verdict with full reasoning, every S/R level,
// and the technical snapshot.
// AUTH: required (mirrors the ai-analysis gating) — the quota is per user.
// QUOTA (owner mandate 2026-11-17): free plan = 2 stocks/day (EGX session
// day, Africa/Cairo), Premium = unlimited. The consume is atomic and runs
// only AFTER a successful build, so an invalid company never burns quota.
// downsideAnswer: the client's echo of the deep-loss question ("yes" | "no")
// — refines the plan wording without a second quota burn on the same report.
// Cache: 10 min per (company, avgBuy rounded to 2dp) — same cadence as the
// underlying signals caches.

import { NextResponse, type NextRequest } from "next/server"
import { cached } from "@/lib/server-cache"
import { requireAuth, unauthorizedResponse } from "@/lib/access"
import { isPremiumUser } from "@/lib/subscription"
import { buildPositionReview } from "@/lib/position/service"
import { consumePositionReviewUsage, getPositionReviewQuota } from "@/lib/position/usage"

export const maxDuration = 30

const CACHE_MS = 10 * 60_000

export async function POST(req: NextRequest) {
  const userId = await requireAuth(req)
  if (!userId) return unauthorizedResponse()

  let body: { companyId?: unknown; avgBuyPrice?: unknown; downsideAnswer?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "BAD_JSON" }, { status: 400 })
  }
  const companyId = typeof body.companyId === "string" ? body.companyId.trim() : ""
  const avgBuyPrice = typeof body.avgBuyPrice === "number" ? body.avgBuyPrice : Number(body.avgBuyPrice)
  const downsideAnswer = body.downsideAnswer === "yes" || body.downsideAnswer === "no" ? body.downsideAnswer : null
  if (!companyId || companyId.length > 64 || !/^[a-zA-Z0-9_-]+$/.test(companyId)) {
    return NextResponse.json({ error: "INVALID_COMPANY_ID" }, { status: 400 })
  }
  if (!Number.isFinite(avgBuyPrice) || avgBuyPrice <= 0 || avgBuyPrice > 1_000_000) {
    return NextResponse.json({ error: "INVALID_AVG_BUY_PRICE" }, { status: 400 })
  }

  const isPremium = await isPremiumUser(userId)

  // round the cache key to 2dp — the decision math never changes inside a pip
  const key = `position-review:${companyId}:${avgBuyPrice.toFixed(2)}:${downsideAnswer ?? "-"}`
  const result = await cached(key, CACHE_MS, () => buildPositionReview(companyId, avgBuyPrice, downsideAnswer))
  if (!result) {
    return NextResponse.json({ error: "COMPANY_NOT_FOUND" }, { status: 404 })
  }

  // quota only burns on a successfully built report (invalid input above never
  // reaches this line, so a typo never costs one of the user's two daily reads)
  const quota = await consumePositionReviewUsage(userId, isPremium, companyId)
  if (!quota) {
    return NextResponse.json(
      {
        error: "DAILY_LIMIT_REACHED",
        errorAr: "خلصت كمية التحليل المجانية النهاردة (سهمين) — اشترك في Premium للحل بلا حدود، أو جرّب تاني بكرة مع افتتاح السوق",
        upgradeUrl: "/premium",
      },
      { status: 429 },
    )
  }
  return NextResponse.json(
    { ...result, quota },
    { headers: { "Cache-Control": "private, max-age=300" } },
  )
}

// GET — quota snapshot only (the UI shows "متبقي لك X" without consuming)
export async function GET(req: NextRequest) {
  const userId = await requireAuth(req)
  if (!userId) return unauthorizedResponse()
  const isPremium = await isPremiumUser(userId)
  const quota = await getPositionReviewQuota(userId, isPremium)
  return NextResponse.json({ quota })
}
