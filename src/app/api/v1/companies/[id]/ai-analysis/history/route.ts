import { NextRequest } from "next/server"
import { db } from "@/lib/db"
import { requireAuth, unauthorizedResponse } from "@/lib/access"

// GET /api/v1/companies/[id]/ai-analysis/history?limit=10&cursor=<iso>
// Paginated historical reports (newest first) — metadata only plus content
// when `withContent=1`. Reading is a single indexed query, no locks.

export const maxDuration = 30

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireAuth(req)
    if (!userId) return unauthorizedResponse()

    const { id } = await params
    const raw = decodeURIComponent(id)
    const upper = raw.toUpperCase()
    const company = await db.company.findFirst({
      where: { OR: [{ id: raw }, { ticker: upper }, { isin: upper }] },
      select: { id: true },
    })
    if (!company) return Response.json({ error: "NOT_FOUND" }, { status: 404 })

    const limit = Math.min(Math.max(Number(req.nextUrl.searchParams.get("limit") || "") || 10, 1), 50)
    const cursor = req.nextUrl.searchParams.get("cursor")
    const withContent = req.nextUrl.searchParams.get("withContent") === "1"

    const rows = await db.aiAnalysisReport.findMany({
      where: {
        companyId: company.id,
        status: "COMPLETED",
        ...(cursor && !isNaN(Date.parse(cursor)) ? { createdAt: { lt: new Date(cursor) } } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: limit + 1,
      select: {
        id: true, reportKey: true, lang: true, stance: true, model: true, degraded: true,
        dataHash: true, technicalHash: true, priceAsOf: true, financialAsOf: true, periodKey: true,
        dataCompleteness: true, wordCount: true, createdAt: true, completedAt: true,
        ...(withContent ? { content: true } : {}),
      },
    })
    const hasMore = rows.length > limit
    const page = hasMore ? rows.slice(0, limit) : rows

    return Response.json({
      reports: page.map((r) => ({
        ...r,
        completeness: r.dataCompleteness ? JSON.parse(r.dataCompleteness) : null,
        dataCompleteness: undefined,
      })),
      nextCursor: hasMore ? page[page.length - 1].createdAt.toISOString() : null,
    })
  } catch (e) {
    console.error("ai-analysis history error:", e instanceof Error ? e.message.slice(0, 200) : e)
    return Response.json({ error: "HISTORY_TEMPORARILY_UNAVAILABLE" }, { status: 503 })
  }
}
