import { after } from "next/server"
import { NextRequest } from "next/server"
import { secureBearerMatch } from "@/lib/secure-compare"
import { runEnrichmentChunk } from "@/lib/market/intelligence/service"

// GET /api/v1/cron/market-enrich — DAILY enrichment job for whole-market
// breadth: computes per-company SMA20/50/200 flags + new 52w high/low from
// runtime Yahoo bars (in-memory only — price bars are NOT re-stored, per the
// platform storage policy) and stores only the AGGREGATE block.
//
// Chunked + self-chaining (same pattern as the chunked audit runner): each
// invocation processes up to `limit` companies, persists its cursor, and —
// when work remains — chains the next lambda window via after().
//
// Auth: `Authorization: Bearer $CRON_SECRET` (timing-safe), same contract as
// cron/market and cron/audit. Idempotent; safe to hit repeatedly.

export const maxDuration = 280

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  return secureBearerMatch(req.headers.get("authorization"), secret)
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) {
    return Response.json({ error: "UNAUTHORIZED" }, { status: 401 })
  }
  const url = new URL(req.url)
  const limit = Math.min(120, Math.max(5, Number(url.searchParams.get("limit") ?? 40)))
  try {
    const result = await runEnrichmentChunk(limit)
    if (!result.done && result.remaining > 0) {
      // Chain the next chunk in a fresh lambda window.
      after(async () => {
        const base = process.env.NEXT_PUBLIC_SITE_URL ?? url.origin
        try {
          await fetch(`${base}/api/v1/cron/market-enrich?limit=${limit}`, {
            headers: { authorization: `Bearer ${process.env.CRON_SECRET ?? ""}` },
            signal: AbortSignal.timeout(270_000),
          }).catch(() => undefined)
        } catch {
          // chained chunk failure is retried by the next scheduled run
        }
      })
    }
    return Response.json(result)
  } catch (e) {
    return Response.json(
      { done: false, error: "ENRICH_FAILED", message: e instanceof Error ? e.message.slice(0, 200) : String(e) },
      { status: 500 },
    )
  }
}
