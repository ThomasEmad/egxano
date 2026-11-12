import { NextRequest } from "next/server"
import { after } from "next/server"
import { secureBearerMatch } from "@/lib/secure-compare"

// GET /api/v1/cron/audit?type=daily|weekly[&resumeRunId=…] — scheduled audit
// entry point. Vercel Cron calls this with `Authorization: Bearer $CRON_SECRET`
// when the CRON_SECRET env var is configured (timing-safe comparison). Also
// usable by any scheduler with the same bearer header.
//
// The audit runs in CHUNKS (resumable cursor per run). This invocation loops
// chunks until done OR until a safe deadline inside its window, then — if work
// remains — chains ONE more invocation via after() (a fresh lambda window),
// passing the run id. Completion is therefore independent of data growth.
// (runFullAudit owns the AuditRun lifecycle, including failure status.)

export const maxDuration = 300

// In-process single-flight: overlapping cron firings duplicated AuditRuns and
// doubled DB load. (Multi-node deployments would need a shared lock — out of
// scope for the single-node topology.)
let auditBusy = false

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false // cron disabled unless explicitly configured
  return secureBearerMatch(req.headers.get("authorization"), secret)
}

/** Fire one background continuation for an unfinished chunked run. */
function chainNextChunk(origin: string, type: string, runId: string): void {
  const secret = process.env.CRON_SECRET
  if (!secret) return
  after(() => {
    fetch(`${origin}/api/v1/cron/audit?type=${type}&resumeRunId=${encodeURIComponent(runId)}`, {
      headers: { authorization: `Bearer ${secret}` },
      // never let a slow continuation hold the after() budget of this window
      signal: AbortSignal.timeout(290_000),
    }).catch((e) => {
      console.error("audit chunk chain failed:", e instanceof Error ? e.message.slice(0, 200) : e)
    })
  })
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) {
    return Response.json({ error: "UNAUTHORIZED" }, { status: 401 })
  }

  const type = req.nextUrl.searchParams.get("type") === "weekly" ? "weekly" : "daily"
  const resumeRunId = req.nextUrl.searchParams.get("resumeRunId") ?? undefined

  if (auditBusy) {
    return Response.json(
      { ok: false, error: "AUDIT_IN_PROGRESS", message: "Another audit run is already in progress." },
      { status: 503, headers: { "Retry-After": "120" } }
    )
  }
  auditBusy = true
  try {
    const { startOrResumeChunkedAudit } = await import("@/lib/audit/audit-runner")
    const { invalidateServerCache } = await import("@/lib/server-cache")

    // keep a hard safety margin inside the 300s window: chunk processing stops
    // at the deadline and the remainder continues in a chained invocation.
    const deadline = Date.now() + 240_000
    const CHUNK = 120

    let runId = resumeRunId ?? ""
    let last: Awaited<ReturnType<typeof startOrResumeChunkedAudit>> | null = null
    do {
      last = await startOrResumeChunkedAudit({ type, chunkSize: CHUNK, resumeRunId: runId || undefined })
      runId = last.runId
    } while (last && !last.done && Date.now() < deadline)
    if (!last) throw new Error("chunked audit returned no result")

    invalidateServerCache()

    if (!last.done) {
      chainNextChunk(req.nextUrl.origin, type, last.runId)
      return Response.json({
        ok: true,
        chained: true,
        scheduledType: type,
        runId: last.runId,
        companiesChecked: last.checkedSoFar,
        issues: last.issuesSoFar,
        remaining: last.remaining,
      })
    }

    // Chain the AI job worker: the audit cron is a guaranteed daily invocation
    // with a large window — use its tail to drain queued report generations.
    // Budget note: 2 jobs (~80s) + market refresh (~30s) fit the remaining
    // window; jobs left behind are picked up by the next invocation.
    let aiWorker: { processed: number } | null = null
    try {
      const { processPendingJobs, sweepJobs } = await import("@/lib/ai/jobs/worker")
      await sweepJobs()
      aiWorker = await processPendingJobs(2, { budgetMs: 100_000 })
    } catch (e) {
      console.error("audit-chained ai-worker failed:", e instanceof Error ? e.message.slice(0, 200) : e)
    }
    // Chain a market refresh: the audit cron is a guaranteed daily invocation,
    // so this anchors at least one EOD price pull per day even with zero
    // visitors (the DB-based refresh survives serverless, unlike the old file).
    let market: { ok: boolean; asOf?: string; pricesWritten?: number } | null = null
    try {
      const { refreshMarketSnapshot } = await import("@/lib/market/refresh")
      market = await refreshMarketSnapshot()
    } catch (e) {
      console.error("audit-chained market refresh failed:", e instanceof Error ? e.message.slice(0, 200) : e)
    }
    // Chain the market-enrichment job (chunked + self-chaining): computes the
    // true 52-week / SMA200 breadth aggregates for the intelligence snapshot.
    // The chunk runner chains its own remaining windows via after(), so a
    // single daily anchor is enough — no extra platform cron required.
    let enrichment: { done: boolean; processed: number; remaining: number } | null = null
    try {
      const { runEnrichmentChunk } = await import("@/lib/market/intelligence/service")
      enrichment = await runEnrichmentChunk(40)
    } catch (e) {
      console.error("audit-chained market-enrich failed:", e instanceof Error ? e.message.slice(0, 200) : e)
    }
    return Response.json({
      ok: true,
      scheduledType: type,
      runId: last.runId,
      durationSec: last.summary?.durationSec ?? null,
      companiesChecked: last.checkedSoFar,
      issues: last.issuesSoFar,
      byCategory: last.summary?.byCategory ?? null,
      aiWorker,
      market,
      enrichment,
    })
  } catch (error) {
    return Response.json(
      { ok: false, error: "AUDIT_FAILED", message: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    )
  } finally {
    auditBusy = false
  }
}
