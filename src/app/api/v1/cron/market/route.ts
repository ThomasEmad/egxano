import { NextRequest } from "next/server"
import { secureBearerMatch } from "@/lib/secure-compare"
import { refreshMarketSnapshot } from "@/lib/market/refresh"

// GET /api/v1/cron/market — refresh market prices into the DATABASE.
//
// Pulls the public TradingView EGX scanner (15-minute delayed, same authorized
// source as every other market import) and writes:
//   * the ticker snapshot into `Setting.market_ticker_snapshot_v1`
//   * one `MarketPrice` row per company per UTC day (TRADINGVIEW_SCANNER)
// Filesystem writes never survive on serverless — the DB does. Readers
// (companies list/detail, ticker, sectors) pick it up via
// getFreshMarketSnapshot() within seconds.
//
// Auth: `Authorization: Bearer $CRON_SECRET` (timing-safe), same contract as
// cron/audit and cron/maintenance. Wire any external scheduler to it:
//   curl -H "Authorization: Bearer $CRON_SECRET" https://host/api/v1/cron/market
//
// Every run is idempotent: the scanner is 2 POSTs, the write replaces only
// today's own rows, and concurrent invocations share one in-flight promise.

export const maxDuration = 60

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false // disabled unless explicitly configured
  return secureBearerMatch(req.headers.get("authorization"), secret)
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) {
    return Response.json({ error: "UNAUTHORIZED" }, { status: 401 })
  }
  try {
    const summary = await refreshMarketSnapshot()
    return Response.json(summary, { status: summary.ok ? 200 : 502 })
  } catch (e) {
    return Response.json(
      { ok: false, error: "MARKET_REFRESH_FAILED", message: e instanceof Error ? e.message.slice(0, 200) : String(e) },
      { status: 500 },
    )
  }
}
