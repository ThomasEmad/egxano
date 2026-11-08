import { NextRequest } from "next/server"
import { secureBearerMatch } from "@/lib/secure-compare"

// Large window so the audit AND the chained AI worker drain both fit.
export const maxDuration = 300

// GET /api/v1/cron/audit?type=daily|weekly — scheduled audit entry point.
// Vercel Cron calls this with `Authorization: Bearer $CRON_SECRET` when the
// CRON_SECRET env var is configured (timing-safe comparison). Also usable by
// any scheduler with the same bearer header. Runs the full audit and returns
// the run summary.
// (runFullAudit owns the AuditRun lifecycle, including failure status.)

// In-process single-flight: overlapping cron firings duplicated AuditRuns and
// doubled DB load. (Multi-node deployments would need a shared lock — out of
// scope for the single-node topology.)
let auditBusy = false

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false // cron disabled unless explicitly configured
  return secureBearerMatch(req.headers.get("authorization"), secret)
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) {
    return Response.json({ error: "UNAUTHORIZED" }, { status: 401 })
  }

  const type = req.nextUrl.searchParams.get("type") === "weekly" ? "weekly" : "daily"

  if (auditBusy) {
    return Response.json(
      { ok: false, error: "AUDIT_IN_PROGRESS", message: "Another audit run is already in progress." },
      { status: 503, headers: { "Retry-After": "120" } }
    )
  }
  auditBusy = true
  try {
    const { runFullAudit } = await import("@/lib/audit/audit-runner")
    const summary = await runFullAudit({ type, persist: true })
    const { invalidateServerCache } = await import("@/lib/server-cache")
    invalidateServerCache()
    // Chain the AI job worker: the audit cron is a guaranteed daily invocation
    // with a large window — use its tail to drain queued report generations
    // (e.g. ones whose provider was congested during user requests).
    // Budget note: audit (~60-120s at current data volume) + 2 jobs (~80s) +
    // market refresh (~30s) must stay inside the 300s window — jobs left
    // behind are picked up by the next invocation, so under-running is safe.
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
    return Response.json({
      ok: true,
      scheduledType: type,
      runId: summary.runId,
      durationSec: summary.durationSec,
      companiesChecked: summary.companiesChecked,
      issues: summary.issuesFound,
      byCategory: summary.byCategory,
      aiWorker,
      market,
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
