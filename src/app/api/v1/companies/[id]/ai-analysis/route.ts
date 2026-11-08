import { NextRequest } from "next/server"
import { db } from "@/lib/db"
import { audit } from "@/lib/audit"
import { requireAuth, unauthorizedResponse } from "@/lib/access"
import { isPremiumUser } from "@/lib/subscription"
import { checkEndpointRateLimit } from "@/lib/rate-limit"
import { canUseSmartAnalysis, getSmartAnalysisUsage } from "@/lib/smart-analysis-usage"
import { requestReport, serializeReport } from "@/lib/ai/jobs/enqueue"
import { processJob } from "@/lib/ai/jobs/worker"
import { invalidateServerCache } from "@/lib/server-cache"
import { cachedRead } from "@/lib/hot-read"

// GET  /api/v1/companies/[id]/ai-analysis?lang=ar|en
//        → latest COMPLETED report for the company (language-preferred), plus
//          the generation status when one is being produced. Never triggers
//          inference — reading is decoupled from generation capacity.
// POST /api/v1/companies/[id]/ai-analysis
//        → request a report: 200 (ready, cache hit), 202 (generation started /
//          already running — poll the status endpoint), 429 (quota), 400
//          (NO_DATA). The response NEVER blocks on the LLM: the job is
//          processed in the background (after()) and shared by all users
//          requesting the same data identity.

export const maxDuration = 60

async function getHandler(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await requireAuth(req as unknown as NextRequest)
  if (!userId) return unauthorizedResponse()

  const isPremium = await isPremiumUser(userId)
  // GET only gates visibility — a 30s per-user cache keeps this off the DB hot
  // path (the POST generation path always checks quota for real).
  const canAccess = isPremium || (await cachedRead(`ai-gate:${userId}`, 30_000, () => canUseSmartAnalysis(userId, false)))
  if (!canAccess) {
    const usage = await getSmartAnalysisUsage(userId)
    return Response.json(
      { error: "USAGE_LIMIT_EXCEEDED", message: `Free tier limit: ${usage.limit} Smart Analyses per month. ${usage.remaining} remaining. Resets ${usage.resetAt}.`, usage },
      { status: 429 }
    )
  }

  const { id } = await params
  const raw = decodeURIComponent(id)
  const upper = raw.toUpperCase()
  // Company identity is stable — cache the resolution per raw input.
  const company = await cachedRead(`ai-company:${raw}`, 60_000, async () => {
    return db.company.findFirst({
      where: { OR: [{ id: raw }, { ticker: upper }, { isin: upper }] },
      select: { id: true },
    })
  })
  if (!company) return Response.json({ error: "NOT_FOUND" }, { status: 404 })

  const langParam = new URL(req.url).searchParams.get("lang")?.toLowerCase() === "ar" ? "ar" : "en"

  // The report payload is USER-INDEPENDENT (auth is checked above; the content
  // and generation status are shared by everyone on the same data identity).
  // A 15s single-flight cache absorbs read storms (10k users opening the same
  // company) at exactly ONE DB query per window instead of thousands.
  const payload = await cachedRead(`ai-report-latest:${company.id}:${langParam}`, 15_000, async () => {
    // Latest COMPLETED artifact, preferring the requested language.
    const latest = await db.aiAnalysisReport.findFirst({
      where: { companyId: company.id, status: "COMPLETED" },
      orderBy: [{ lang: langParam === "ar" ? "desc" : "asc" }, { createdAt: "desc" }],
    })
    const preferred =
      latest && latest.lang === langParam
        ? latest
        : (await db.aiAnalysisReport.findFirst({
            where: { companyId: company.id, status: "COMPLETED", lang: langParam },
            orderBy: { createdAt: "desc" },
          })) ?? latest

    // Active generation (for the status chip).
    const activeJob = await db.aiAnalysisJob.findFirst({
      where: { companyId: company.id, lang: langParam, status: { in: ["PENDING", "PROCESSING"] } },
      orderBy: { createdAt: "desc" },
      select: { id: true, status: true, reportKey: true, createdAt: true },
    })
    return {
      analysis: preferred
        ? {
            ...serializeReport(preferred),
          }
        : null,
      generation: activeJob
        ? {
            status: activeJob.status === "PROCESSING" ? "processing" : "pending",
            jobRef: activeJob.id,
            reportKey: activeJob.reportKey,
            startedAt: activeJob.createdAt,
          }
        : null,
    }
  })

  return Response.json(payload)
}

async function postHandler(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const postT0 = Date.now()
  const userId = await requireAuth(req as unknown as NextRequest)
  if (!userId) return unauthorizedResponse()

  const isPremium = await isPremiumUser(userId)

  // Cheap shields first: per-user burst limit before any DB or LLM work.
  const burst = await checkEndpointRateLimit("ai-analysis", userId)
  if (!burst.allowed) {
    const retryAfter = Math.ceil((burst.resetAt - Date.now()) / 1000)
    return Response.json(
      { error: "RATE_LIMITED", message: "AI analysis is limited to 10 requests per 10 minutes." },
      { status: 429, headers: { "Retry-After": String(retryAfter) } }
    )
  }

  const { id } = await params
  const body = (await req.json().catch(() => ({}))) as { lang?: string; refresh?: boolean }
  const lang = ((body.lang ?? new URL(req.url).searchParams.get("lang") ?? "en").toLowerCase() === "ar" ? "ar" : "en") as "ar" | "en"

  const result = await requestReport(id, lang, { isPremium, requestedBy: userId })

  switch (result.kind) {
    case "not_found":
      return Response.json({ error: "NOT_FOUND" }, { status: 404 })
    case "no_data":
      return Response.json(
        {
          error: "NO_DATA",
          message: "No verified financial data available for this company yet. Upload and approve financial statements first.",
        },
        { status: 400 }
      )
    case "quota_exhausted": {
      const usage = await getSmartAnalysisUsage(userId)
      return Response.json(
        { error: "USAGE_LIMIT_EXCEEDED", message: `Free tier limit: ${usage.limit} Smart Analyses per month. ${usage.remaining} remaining. Resets ${usage.resetAt}.`, usage: result.usage },
        { status: 429 }
      )
    }
    case "cache_hit": {
      await db.aiAnalysisEvent.create({
        data: { reportKey: result.report.reportKey, kind: "CACHE_HIT", actor: userId },
      }).catch(() => {})
      // a new artifact invalidates the read cache window
      invalidateServerCache()
      return Response.json({ analysis: serializeReport(result.report), cached: true })
    }
    case "queued": {
      // The requesting invocation carries the generation: it is the ONE
      // serverless window that is guaranteed large (60s cap) and attached to
      // a user. Concurrent requesters of the same identity receive 202 and
      // poll — they share this report the moment it lands. If the inline
      // window cannot finish, the job stays queued for the health-cron /
      // cron-worker windows (50s / 280s) and the poll shows "generating".
      const inlineBudget = Math.max(18_000, 46_000 - (Date.now() - postT0))
      const outcome = await processJob(result.job.id, { budgetMs: inlineBudget }).catch((e) => {
        console.error("ai-analysis inline generation crashed:", e instanceof Error ? e.message.slice(0, 200) : e)
        return { status: "failed_permanent", error: "inline crash" } as const
      })
      if (outcome.status === "completed") {
        const report = await db.aiAnalysisReport.findUnique({ where: { reportKey: result.job.reportKey } })
        if (report) {
          return Response.json({ analysis: serializeReport(report), cached: false })
        }
      }
      return Response.json(
        {
          status: "generating",
          jobRef: result.job.id,
          reportKey: result.job.reportKey,
          message: "Report generation continues in the background — poll the status endpoint.",
        },
        { status: 202 }
      )
    }
    case "generating": {
      // Another invocation (a concurrent user) owns this generation.
      return Response.json(
        {
          status: "generating",
          jobRef: result.job.id,
          reportKey: result.job.reportKey,
          message: "Report generation already running — poll the status endpoint.",
        },
        { status: 202 }
      )
    }
  }
}

// ---------- Hardened public wrappers (any uncaught failure → JSON 503) ----------

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    return await getHandler(req, ctx)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error("ai-analysis GET error:", msg.slice(0, 200))
    return Response.json(
      {
        error: "AI_ANALYSIS_TEMPORARILY_UNAVAILABLE",
        message: "Temporary database hiccup — please try again shortly. | خلل مؤقت في قاعدة البيانات — حاول بعد قليل.",
      },
      { status: 503 }
    )
  }
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    return await postHandler(req, ctx)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error("ai-analysis POST error:", msg.slice(0, 200))
    try {
      await audit("AI_ANALYSIS", {
        actor: "system",
        entityType: "Company",
        entityId: "unknown",
        details: `Generation request crashed before completion: ${msg.slice(0, 200)}`,
      })
    } catch {
      // auditing must never mask the original failure
    }
    return Response.json(
      {
        error: "AI_ANALYSIS_TEMPORARILY_UNAVAILABLE",
        message: "Temporary database hiccup — حاول بعد قليل. | Temporary database hiccup — please try again shortly.",
      },
      { status: 503 }
    )
  }
}
