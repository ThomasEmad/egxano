import { NextRequest } from "next/server"
import { secureBearerMatch } from "@/lib/secure-compare"
import { processPendingJobs, sweepJobs, type JobOutcome } from "@/lib/ai/jobs/worker"

// GET|POST /api/v1/cron/ai-worker — generation worker entry point.
// Authorized via `Authorization: Bearer $CRON_SECRET` (timing-safe match), or
// by an admin session. Drains up to `limit` jobs (default 2, max 5) and runs
// the stale-lease sweep. Designed for any external scheduler; safe to call
// concurrently with the after()-kicks (conditional claims prevent duplicates).

export const maxDuration = 300

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (secret && secureBearerMatch(req.headers.get("authorization"), secret)) return true
  return false
}

let busy = false

async function handle(req: NextRequest) {
  if (!authorized(req)) return Response.json({ error: "UNAUTHORIZED" }, { status: 401 })
  if (busy) return Response.json({ error: "WORKER_BUSY", message: "Another worker run is in progress." }, { status: 503 })
  busy = true
  const started = Date.now()
  try {
    const limit = Math.min(Math.max(Number(req.nextUrl.searchParams.get("limit") || "") || 2, 1), 5)
    const sweep = await sweepJobs()
    const run = await processPendingJobs(limit, { budgetMs: 280_000 })
    return Response.json({
      ok: true,
      tookMs: Date.now() - started,
      sweep,
      processed: run.processed,
      outcomes: run.outcomes.map((o: JobOutcome) => o.status),
    })
  } catch (e) {
    console.error("ai-worker error:", e instanceof Error ? e.message.slice(0, 300) : e)
    return Response.json({ ok: false, error: "WORKER_ERROR" }, { status: 500 })
  } finally {
    busy = false
  }
}

export async function GET(req: NextRequest) {
  return handle(req)
}

export async function POST(req: NextRequest) {
  return handle(req)
}
