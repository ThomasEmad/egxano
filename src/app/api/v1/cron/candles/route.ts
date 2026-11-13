import { NextRequest } from "next/server"
import { secureBearerMatch } from "@/lib/secure-compare"
import { audit } from "@/lib/audit"
import { invalidateServerCache } from "@/lib/server-cache"
import { ingestCandlesChunk, getCandleStorageStats } from "@/lib/market/candles"

// POST /api/v1/cron/candles — ingest ONE chunk (≤40 companies) of daily OHLCV
// candles into PriceBar. Same engine as the admin endpoint
// (/api/v1/admin/candles → ingestCandlesChunk): Yahoo chart with browser UA,
// 12s timeout, UTC-midnight session mapping, bulk upsert, 380-session
// retention. The external scheduler (GitHub Actions candles-refresh.yml —
// Vercel Hobby allows only 2 crons) chains chunks by POSTing the returned
// nextCursor back until done=true:
//   curl -X POST https://host/api/v1/cron/candles \
//        -H "Authorization: Bearer $CRON_SECRET" \
//        -d '{"limit":40,"cursor":"<nextCursor>"}'
//
// GET /api/v1/cron/candles — storage stats only (same auth).
//
// Auth: `Authorization: Bearer $CRON_SECRET` (timing-safe), identical
// contract to cron/market, cron/audit and cron/maintenance.
export const maxDuration = 60

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false // disabled unless explicitly configured
  return secureBearerMatch(req.headers.get("authorization"), secret)
}

export async function POST(req: NextRequest) {
  if (!authorized(req)) {
    return Response.json({ error: "UNAUTHORIZED" }, { status: 401 })
  }
  const body = await req.json().catch(() => null)
  // limit clamped 1..40, default 40 — the chunker's own default is 25, but
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
    const result = await ingestCandlesChunk({
      limit,
      ...(cursor !== undefined ? { cursor } : {}),
    })
    // Success: drop the in-memory caches so readers see the fresh bars.
    invalidateServerCache()

    await audit("CANDLES_INGEST", {
      actor: "cron",
      entityType: "PriceBar",
      details: `chunk limit=${limit}${cursor ? ` cursor=${cursor}` : " (head)"} processed=${result.processed} succeeded=${result.succeeded} done=${result.done} errors=${result.errors.length}`,
    })

    const stats = await getCandleStorageStats()
    return Response.json({
      ok: true,
      processed: result.processed,
      succeeded: result.succeeded,
      nextCursor: result.nextCursor,
      done: result.done,
      errors: result.errors,
      stats,
    })
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
  try {
    const stats = await getCandleStorageStats()
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
