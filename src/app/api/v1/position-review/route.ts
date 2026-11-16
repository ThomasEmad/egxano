// POST /api/v1/position-review — حلل سهمي: the user's average buy price + a
// company → the hold/wait/exit verdict with full reasoning, every S/R level,
// and the technical snapshot. Read-only, no persistence, no auth (the input
// is one number and one company id — nothing personal, nothing sensitive).
// Cache: 10 min per (company, avgBuy rounded to 2dp) — same cadence as the
// underlying signals caches.

import { NextResponse, type NextRequest } from "next/server"
import { cached } from "@/lib/server-cache"
import { buildPositionReview } from "@/lib/position/service"

export const maxDuration = 30

const CACHE_MS = 10 * 60_000

export async function POST(req: NextRequest) {
  let body: { companyId?: unknown; avgBuyPrice?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "BAD_JSON" }, { status: 400 })
  }
  const companyId = typeof body.companyId === "string" ? body.companyId.trim() : ""
  const avgBuyPrice = typeof body.avgBuyPrice === "number" ? body.avgBuyPrice : Number(body.avgBuyPrice)
  if (!companyId || companyId.length > 64 || !/^[a-zA-Z0-9_-]+$/.test(companyId)) {
    return NextResponse.json({ error: "INVALID_COMPANY_ID" }, { status: 400 })
  }
  if (!Number.isFinite(avgBuyPrice) || avgBuyPrice <= 0 || avgBuyPrice > 1_000_000) {
    return NextResponse.json({ error: "INVALID_AVG_BUY_PRICE" }, { status: 400 })
  }

  // round the cache key to 2dp — the decision math never changes inside a pip
  const key = `position-review:${companyId}:${avgBuyPrice.toFixed(2)}`
  const result = await cached(key, CACHE_MS, () => buildPositionReview(companyId, avgBuyPrice))
  if (!result) {
    return NextResponse.json({ error: "COMPANY_NOT_FOUND" }, { status: 404 })
  }
  return NextResponse.json(result, {
    headers: { "Cache-Control": "private, max-age=300" },
  })
}
