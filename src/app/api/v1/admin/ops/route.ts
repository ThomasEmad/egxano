import { NextRequest } from "next/server"
import { isAdmin, unauthorizedResponse } from "@/lib/admin-auth"
import { audit } from "@/lib/audit"
import { WHITELIST, startJob, killJob, listRuns, runningJobs, tailLog, anyRunning, opsHosting, listActionsRuns, actionsConfigured } from "@/lib/admin-ops"

// GET  /api/v1/admin/ops                 → whitelist metadata + running jobs + recent runs
// GET  /api/v1/admin/ops?log=<runId>     → tail a run's log
// POST /api/v1/admin/ops { job: "key" }  → start a whitelisted job
// POST /api/v1/admin/ops { stop: "runId" } → stop a running job (SIGTERM → SIGKILL / GH cancel)
//
// Only whitelisted jobs run (fixed argv, no user input in the command line),
// one at a time. Self-hosted: spawned as background children of this server.
// Serverless (Vercel): dispatched to GitHub Actions (ops-job.yml workflow) —
// a lambda cannot host a 5-45 min child, and Yahoo/TradingView block Vercel
// egress; the Actions runner writes straight to the production DB, exactly
// like the proven candles-refresh pipeline.
//
// maxDuration: bounded by the Hobby plan ceiling (300 s). Only relevant for
// the (fast) dispatch/stop/list handlers — the jobs themselves run on Actions
// or on a self-hosted server, not inside this function.

export const maxDuration = 300

export async function GET(req: NextRequest) {
  if (!(await isAdmin(req))) return await unauthorizedResponse()
  const url = new URL(req.url)
  const runId = url.searchParams.get("log")
  if (runId) {
    // Actions-plane runs: the log lives on GitHub — hand the UI a pointer
    if (runId.startsWith("gh-")) {
      const run = (await listActionsRuns(15)).find((r) => r.id === runId)
      if (!run) return Response.json({ ok: false, error: "run not found" }, { status: 404 })
      return Response.json({
        ok: true,
        text: `GITHUB_ACTIONS_LOG:${run.htmlUrl ?? ""}`,
        running: run.endedAt === null,
      })
    }
    const lines = Math.min(Number(url.searchParams.get("lines") ?? 120) || 120, 400)
    const res = tailLog(runId, lines)
    if (!res.ok) return Response.json(res, { status: 404 })
    return Response.json(res)
  }
  // Actions-plane runs: GitHub is the source of truth (the /tmp journal of a
  // lambda instance cannot see other instances). Merge and dedupe by job+minute.
  const actionsRuns = await listActionsRuns(10)
  const localRuns = listRuns(20)
  const seen = new Set(localRuns.map((r) => `${r.job}|${(r.startedAt || "").slice(0, 16)}`))
  const runs = [...localRuns, ...actionsRuns.filter((r) => !seen.has(`${r.job}|${(r.startedAt || "").slice(0, 16)}`))]
    .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt))
    .slice(0, 20)
  return Response.json({
    jobs: WHITELIST,
    running: runningJobs(),
    busy: anyRunning() || actionsRuns.some((r) => r.endedAt === null),
    runs,
    hosting: opsHosting(),
    actionsReady: actionsConfigured(),
  })
}

export async function POST(req: NextRequest) {
  if (!(await isAdmin(req))) return await unauthorizedResponse()
  const body = await req.json().catch(() => null) as { job?: string; stop?: string } | null

  // Stop a running job.
  if (body?.stop) {
    const res = killJob(body.stop, "admin")
    if (!res.ok) return Response.json({ ok: false, error: res.error }, { status: 409 })
    await audit("OPS_JOB_STOP", {
      actor: "admin",
      entityType: "AdminOpsJob",
      entityId: res.entry.id,
      details: `ops job stopped by admin: ${res.entry.job} (pid ${res.entry.pid})`,
    })
    return Response.json({ ok: true, run: res.entry })
  }

  const key = body?.job
  if (!key) return Response.json({ error: "job or stop is required" }, { status: 400 })

  const res = await startJob(key)
  if (!res.ok) return Response.json({ ok: false, error: res.error }, { status: 409 })

  await audit("OPS_JOB", {
    actor: "admin",
    entityType: "AdminOpsJob",
    entityId: res.entry.id,
    details: `ops job started (${res.entry.plane ?? "local"}): ${key} → ${res.entry.script} ${res.entry.args.join(" ")}`,
  })
  return Response.json({ ok: true, run: res.entry })
}
