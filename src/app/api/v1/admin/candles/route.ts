import { NextRequest } from "next/server"
import { isAdmin, unauthorizedResponse } from "@/lib/admin-auth"
import { audit } from "@/lib/audit"
import { ingestCandlesChunk, getCandleStorageStats } from "@/lib/market/candles"

// Admin candle-ingest API (unfreezes PriceBar as a durable ~1y history).
//
// POST /api/v1/admin/candles  { limit? }   — run ONE ingest chunk (max 40
//   companies); chain with the returned nextCursor until done=true.
// GET  /api/v1/admin/candles               — storage stats only.
export const maxDuration = 60

export async function POST(req: NextRequest) {
  if (!(await isAdmin(req))) return await unauthorizedResponse()
  const body = await req.json().catch(() => null)
  const limit = typeof body?.limit === "number" && Number.isFinite(body.limit) ? Math.min(Math.max(Math.floor(body.limit), 1), 40) : undefined
  // Cursor chaining: the admin UI loops POST calls with nextCursor until done=true.
  const cursor = typeof body?.cursor === "string" && body.cursor.length > 0 ? body.cursor : undefined

  const result = await ingestCandlesChunk({ ...(limit !== undefined ? { limit } : {}), ...(cursor !== undefined ? { cursor } : {}) })

  await audit("CANDLES_INGEST", {
    actor: "admin",
    entityType: "PriceBar",
    details: `chunk processed=${result.processed} succeeded=${result.succeeded} done=${result.done} errors=${result.errors.length}`,
  })

  const stats = await getCandleStorageStats()
  return Response.json({ ok: true, ...result, stats })
}

export async function GET(req: NextRequest) {
  if (!(await isAdmin(req))) return await unauthorizedResponse()
  const stats = await getCandleStorageStats()
  return Response.json({ ok: true, stats })
}
