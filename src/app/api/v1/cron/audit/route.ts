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
    // Chain the market-enrichment job: computes the true 52-week / SMA200
    // breadth aggregates for the intelligence snapshot. runEnrichmentChunk
    // does NOT self-chain — the after() chaining lives in the market-enrich
    // ROUTE, which no cron schedules — so one chunk per day meant the cursor
    // (which restarts when >6h stale) replayed the same first 40 alphabetical
    // companies forever while `universe` claimed the full count (audit
    // 2026-11-19: pctAboveSma20/50/200 and 52w breadth fed the regime
    // classifier from a biased slice). Loop chunks inside this window's
    // budget, then chain the remainder through the market-enrich endpoint
    // (fresh lambda window, same bearer auth).
    let enrichment: { done: boolean; processed: number; remaining: number } | null = null
    try {
      const { runEnrichmentChunk } = await import("@/lib/market/intelligence/service")
      const deadline = Date.now() + 180_000 // stay well inside maxDuration=300
      let chunk = await runEnrichmentChunk(40)
      enrichment = { ...chunk }
      while (!chunk.done && chunk.remaining > 0 && Date.now() < deadline) {
        chunk = await runEnrichmentChunk(40)
        enrichment = {
          done: chunk.done,
          processed: enrichment.processed + chunk.processed,
          remaining: chunk.remaining,
        }
      }
      if (!enrichment.done && enrichment.remaining > 0) {
        after(async () => {
          const base = process.env.NEXT_PUBLIC_SITE_URL ?? req.nextUrl.origin
          try {
            await fetch(`${base}/api/v1/cron/market-enrich?limit=40`, {
              headers: { authorization: `Bearer ${process.env.CRON_SECRET ?? ""}` },
              signal: AbortSignal.timeout(270_000),
            }).catch(() => undefined)
          } catch {
            // chained chunk failure is retried by the next scheduled run —
            // and the cursor is now fresh (<6h), so the next audit day
            // continues the sweep instead of restarting it.
          }
        })
      }
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
