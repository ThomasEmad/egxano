// POST /api/v1/cron/candles — refresh ONE chunk (≤40 companies) of the
// UNIFIED candle store (MarketCandle — owner same-source mandate 2026-11-21).
// Same engine contract the admin endpoint had, same external scheduler: the
// GitHub Actions candles-refresh workflow chains chunks by POSTing the
// returned nextCursor back until done=true:
//   curl -X POST https://host/api/v1/cron/candles \
//        -H "Authorization: Bearer $CRON_SECRET" \
//        -d '{"limit":40,"cursor":"<nextCursor>"}'
// Per company: recent-window Yahoo fetch (resolved symbol cached in
// MarketCandleSource) → candle-quality validation → TradingView
// reconciliation of the newest session → recent-window replace in
// MarketCandle. The old PriceBar ingestion is retired — PriceBar stays only
// as the unified reader's fallback for uncovered companies.
//
// GET /api/v1/cron/candles[?run=1] — with run=1 (or ?cursor=): run one
// refresh chunk server-side; plain GET returns storage stats only.
//
// Auth: `Authorization: Bearer $CRON_SECRET` (timing-safe), identical
// contract to cron/market, cron/audit and cron/maintenance.
import { NextRequest } from "next/server"
import { secureBearerMatch } from "@/lib/secure-compare"
import { audit } from "@/lib/audit"
import { invalidateServerCache } from "@/lib/server-cache"
import { refreshMarketCandlesChunk, getMarketCandleStorageStats } from "@/lib/market/candle-refresh"

export const maxDuration = 120

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false // disabled unless explicitly configured
  return secureBearerMatch(req.headers.get("authorization"), secret)
}

async function runChunkAndRespond(limit: number, cursor: string | undefined) {
  const result = await refreshMarketCandlesChunk({ limit, ...(cursor !== undefined ? { cursor } : {}) })
  // Success: drop the in-memory caches so readers see the fresh candles.
  invalidateServerCache()

  await audit("CANDLES_INGEST", {
    actor: "cron",
    entityType: "MarketCandle",
    details: `chunk limit=${limit}${cursor ? ` cursor=${cursor}` : " (head)"} processed=${result.processed} succeeded=${result.succeeded} done=${result.done} reconFailed=${result.reconciliationFailed} errors=${result.errors.length}`,
  })

  const stats = await getMarketCandleStorageStats()
  return Response.json({
    ok: true,
    processed: result.processed,
    succeeded: result.succeeded,
    nextCursor: result.nextCursor,
    done: result.done,
    reconciliationFailed: result.reconciliationFailed,
    errors: result.errors,
    stats,
  })
}

export async function POST(req: NextRequest) {
  if (!authorized(req)) {
    return Response.json({ error: "UNAUTHORIZED" }, { status: 401 })
  }
  const body = await req.json().catch(() => null)
  // limit clamped 1..40 — the chunker's own default is 25, but
  // the cron loop wants the full window per call to finish in ~7 chunks.
  const limit =
    typeof body?.limit === "number" && Number.isFinite(body.limit)
      ? Math.min(Math.max(Math.floor(body.limit), 1), 40)
      : 40
  // Cursor chaining: forward the caller's nextCursor so consecutive POSTs
  // walk the company table instead of restarting from the head every chunk.
  const cursor =
    typeof body?.cursor === "string" && body.cursor.length > 0 ? body.cursor : undefined

  try {
    return await runChunkAndRespond(limit, cursor)
  } catch (e) {
    return Response.json(
      {
        ok: false,
        error: "CANDLES_INGEST_FAILED",
        message: e instanceof Error ? e.message.slice(0, 200) : String(e),
      },
      { status: 500 },
    )
  }
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) {
    return Response.json({ error: "UNAUTHORIZED" }, { status: 401 })
  }
  // A scheduler hit (?run=1 or ?cursor=…) drives one chunk — the caller
  // chains via the returned nextCursor (POST or GET). Plain GET = stats.
  const run = req.nextUrl.searchParams.get("run") !== null || req.nextUrl.searchParams.get("cursor") !== null
  try {
    if (run) {
      const limitRaw = Number(req.nextUrl.searchParams.get("limit") ?? "40")
      const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(Math.floor(limitRaw), 1), 40) : 40
      const cursor = req.nextUrl.searchParams.get("cursor") ?? undefined
      return await runChunkAndRespond(limit, cursor ?? undefined)
    }
    const stats = await getMarketCandleStorageStats()
    return Response.json({ ok: true, stats })
  } catch (e) {
    return Response.json(
      {
        ok: false,
        error: "CANDLE_STATS_FAILED",
        message: e instanceof Error ? e.message.slice(0, 200) : String(e),
      },
      { status: 500 },
    )
  }
}
