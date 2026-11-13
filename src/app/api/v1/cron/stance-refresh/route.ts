import { NextRequest } from "next/server"
import { secureBearerMatch } from "@/lib/secure-compare"
import { refreshOldestStances } from "@/lib/technical/stance-store"

/**
 * GET|POST /api/v1/cron/stance-refresh — recompute the OLDEST persisted
 * technical stances (chunked). The candles-refresh GitHub workflow calls this
 * after ingesting fresh bars (Vercel cannot fetch Yahoo directly), a few times
 * per run; each invocation re-computes up to `limit` companies so the whole
 * universe warms within the serverless time budget.
 */
function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  return secureBearerMatch(req.headers.get("authorization"), secret)
}

export async function GET(req: NextRequest) {
  return handle(req)
}
export async function POST(req: NextRequest) {
  return handle(req)
}

async function handle(req: NextRequest) {
  if (!authorized(req)) return Response.json({ error: "UNAUTHORIZED" }, { status: 401 })
  const url = new URL(req.url)
  const limit = Math.min(120, Math.max(1, Number(url.searchParams.get("limit") ?? 40) || 40))
  const started = Date.now()
  const { recomputed, skipped } = await refreshOldestStances(limit)
  return Response.json({
    ok: true,
    recomputed,
    skipped,
    elapsedMs: Date.now() - started,
    ranAt: new Date().toISOString(),
  })
}
