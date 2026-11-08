import { NextRequest } from "next/server"
import { after } from "next/server"
import { db } from "@/lib/db"
import { audit } from "@/lib/audit"
import { requireAuth, unauthorizedResponse } from "@/lib/access"
import { isPremiumUser } from "@/lib/subscription"
import { checkEndpointRateLimit } from "@/lib/rate-limit"
import { requestReport } from "@/lib/ai/jobs/enqueue"
import { processJob } from "@/lib/ai/jobs/worker"

// POST /api/v1/companies/[id]/ai-analysis/refresh
// Force a regeneration of the CURRENT report identity. Authorized = premium
// users (free users regenerate implicitly by requesting generation when data
// changed). Rate limited per user (premium: 6 / 10min) and charged against
// nothing — premium is unlimited — but the same dedup guarantees apply: if a
// job for this identity is already running, 202 is returned instead of a
// second generation.

export const maxDuration = 60

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireAuth(req)
    if (!userId) return unauthorizedResponse()
    const isPremium = await isPremiumUser(userId)
    if (!isPremium) {
      return Response.json(
        { error: "PREMIUM_REQUIRED", message: "Report refresh is a premium feature." },
        { status: 403 }
      )
    }
    const burst = await checkEndpointRateLimit("ai-analysis", userId)
    if (!burst.allowed) {
      const retryAfter = Math.ceil((burst.resetAt - Date.now()) / 1000)
      return Response.json(
        { error: "RATE_LIMITED", message: "Refresh is rate limited — try again shortly." },
        { status: 429, headers: { "Retry-After": String(retryAfter) } }
      )
    }

    const { id } = await params
    const body = (await req.json().catch(() => ({}))) as { lang?: string }
    const lang = ((body.lang ?? req.nextUrl.searchParams.get("lang") ?? "en").toLowerCase() === "ar" ? "ar" : "en") as "ar" | "en"

    // Premium: skip the free quota path entirely; dedup identical.
    const result = await requestReport(id, lang, { isPremium: true, requestedBy: userId, skipQuota: true })
    switch (result.kind) {
      case "not_found":
        return Response.json({ error: "NOT_FOUND" }, { status: 404 })
      case "no_data":
        return Response.json({ error: "NO_DATA" }, { status: 400 })
      case "cache_hit":
        // Same identity already complete — nothing to regenerate unless the
        // caller forces it; report the artifact.
        return Response.json({ status: "ready", reportKey: result.report.reportKey, cached: true })
      case "generating":
        return Response.json({ status: "generating", jobRef: result.job.id, reportKey: result.job.reportKey }, { status: 202 })
      case "queued":
        after(async () => {
          try {
            await processJob(result.job.id, { budgetMs: 45_000 })
          } catch (e) {
            console.error("refresh background job crashed:", e instanceof Error ? e.message.slice(0, 200) : e)
          }
        })
        await audit("AI_ANALYSIS", {
          actor: userId,
          entityType: "Company",
          entityId: result.ctx.company.id,
          details: `Premium refresh requested (${lang}) — key ${result.job.reportKey.slice(0, 12)}`,
        })
        return Response.json({ status: "generating", jobRef: result.job.id, reportKey: result.job.reportKey }, { status: 202 })
      case "quota_exhausted":
        return Response.json({ error: "USAGE_LIMIT_EXCEEDED" }, { status: 429 })
    }
  } catch (e) {
    console.error("ai-analysis refresh error:", e instanceof Error ? e.message.slice(0, 200) : e)
    return Response.json({ error: "REFRESH_TEMPORARILY_UNAVAILABLE" }, { status: 503 })
  }
}
