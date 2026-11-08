import { NextRequest } from "next/server"
import { db } from "@/lib/db"
import { isAdmin } from "@/lib/admin-auth"
import { audit } from "@/lib/audit"
import { guardStatus, KILL_SWITCH_KEY, SPEND_CAP_KEY } from "@/lib/ai/orchestrator/orchestrate"
import { breakerSnapshot, activeGenerations } from "@/lib/ai/orchestrator/adapters"

// GET  /api/v1/admin/ai-ops — AI system operations dashboard (admin only):
//        guards (kill switch / spend cap), breaker state, queue + usage stats.
// POST /api/v1/admin/ai-ops — control actions:
//        { killSwitch?: boolean, spendCapUsd?: number | null }
//        Writes the Setting rows consumed by the orchestrator guards.

export const maxDuration = 30

export async function GET(req: NextRequest) {
  if (!(await isAdmin(req))) return Response.json({ error: "UNAUTHORIZED" }, { status: 401 })
  try {
    const guard = await guardStatus()
    const [queueCounts, usageByProvider, recentEvents, reportCount] = await Promise.all([
      db.aiAnalysisJob.groupBy({ by: ["status"], _count: true }),
      db.aiProviderUsage.groupBy({
        by: ["provider", "ok"],
        where: { createdAt: { gte: new Date(Date.now() - 24 * 3600_000) } },
        _count: true,
        _sum: { tokensIn: true, tokensOut: true, costUsdEst: true },
      }),
      db.aiAnalysisEvent.findMany({ orderBy: { createdAt: "desc" }, take: 20, select: { kind: true, details: true, createdAt: true, reportKey: true } }),
      db.aiAnalysisReport.count(),
    ])
    return Response.json({
      guard,
      breakers: breakerSnapshot(),
      activeGenerations: activeGenerations(),
      queue: Object.fromEntries(queueCounts.map((q) => [q.status, q._count])),
      reports: reportCount,
      usage24h: usageByProvider.map((u) => ({
        provider: u.provider,
        ok: u.ok,
        calls: u._count,
        tokensIn: u._sum.tokensIn ?? 0,
        tokensOut: u._sum.tokensOut ?? 0,
        costUsdEst: u._sum.costUsdEst ?? 0,
      })),
      recentEvents,
    })
  } catch (e) {
    console.error("ai-ops GET error:", e instanceof Error ? e.message.slice(0, 200) : e)
    return Response.json({ error: "AI_OPS_UNAVAILABLE" }, { status: 503 })
  }
}

export async function POST(req: NextRequest) {
  if (!(await isAdmin(req))) return Response.json({ error: "UNAUTHORIZED" }, { status: 401 })
  try {
    const body = (await req.json().catch(() => ({}))) as { killSwitch?: boolean; spendCapUsd?: number | null }
    const changes: string[] = []
    if (typeof body.killSwitch === "boolean") {
      await db.setting.upsert({
        where: { key: KILL_SWITCH_KEY },
        create: { key: KILL_SWITCH_KEY, value: String(body.killSwitch), type: "boolean", description: "Emergency AI kill switch — stops all AI generation instantly" },
        update: { value: String(body.killSwitch) },
      })
      changes.push(`killSwitch=${body.killSwitch}`)
      await audit("AI_ANALYSIS", { actor: "admin", entityType: "Setting", entityId: KILL_SWITCH_KEY, details: `Kill switch set to ${body.killSwitch}` })
    }
    if (body.spendCapUsd === null || typeof body.spendCapUsd === "number") {
      const value = body.spendCapUsd === null ? "" : String(body.spendCapUsd)
      await db.setting.upsert({
        where: { key: SPEND_CAP_KEY },
        create: { key: SPEND_CAP_KEY, value, type: "number", description: "Daily AI spend cap in estimated USD (empty = unlimited)" },
        update: { value },
      })
      changes.push(`spendCapUsd=${value || "off"}`)
      await audit("AI_ANALYSIS", { actor: "admin", entityType: "Setting", entityId: SPEND_CAP_KEY, details: `Spend cap set to ${value || "off"}` })
    }
    return Response.json({ ok: true, changes })
  } catch (e) {
    console.error("ai-ops POST error:", e instanceof Error ? e.message.slice(0, 200) : e)
    return Response.json({ error: "AI_OPS_UNAVAILABLE" }, { status: 503 })
  }
}
