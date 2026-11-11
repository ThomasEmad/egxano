import { NextRequest } from "next/server"
import { getClientIp, checkEndpointRateLimit } from "@/lib/rate-limit"
import { refreshMarketSnapshot } from "@/lib/market/refresh"

// POST /api/v1/market/sync — user-facing "refresh now" for the dashboard.
// Public (any visitor can nudge one refresh), but strictly rate-limited per IP
// (5 per 10 min) and single-flight inside refreshMarketSnapshot(). Unlike the
// admin /market/refresh (which spawns the local script), this runs the
// serverless-safe library path: TradingView scanner → Setting + MarketPrice.
// The dashboard calls this then invalidates its queries so prices, breadth,
// sector aggregates and the treemap all refetch against fresh data.

export const maxDuration = 60

export async function POST(req: NextRequest) {
  const ip = getClientIp(req)
  const rl = await checkEndpointRateLimit("market-sync", ip)
  if (!rl.allowed) {
    const retryAfter = Math.ceil((rl.resetAt - Date.now()) / 1000)
    return Response.json(
      { ok: false, error: "RATE_LIMITED", message: "Too many refreshes — try again shortly.", retryAfter },
      { status: 429, headers: { "Retry-After": String(retryAfter) } }
    )
  }

  const result = await refreshMarketSnapshot()
  if (!result.ok) {
    return Response.json(
      { ok: false, error: "SYNC_FAILED", reason: result.reason },
      { status: 503 }
    )
  }

  return Response.json({
    ok: true,
    asOf: result.asOf ?? null,
    indices: result.indices ?? 0,
    pricesWritten: result.pricesWritten ?? 0,
  })
}
