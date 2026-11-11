import { NextRequest } from "next/server"
import { db } from "@/lib/db"
import { EVENT_TYPE_MAP } from "@/lib/financial/registry"
import { requirePremium, forbiddenResponse } from "@/lib/access"

// GET /api/v1/events?companyIds=id1,id2&limit=15 — latest detected financial events
// with company info. Used by the watchlist alerts digest (filter to watched
// companies) and available as a general recent-events feed.
// Premium-only access.

export async function GET(req: NextRequest) {
  const premiumUserId = await requirePremium(req)
  if (!premiumUserId) return forbiddenResponse("Premium subscription required for Company Events.")

  const { searchParams } = new URL(req.url)
  const companyIdsParam = searchParams.get("companyIds")
  const limit = Math.min(Math.max(Number(searchParams.get("limit") ?? 15) || 15, 1), 50)
  const eventType = searchParams.get("eventType")

  const companyIds = (companyIdsParam ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 100)

  // Freshness: the feed is "what happened lately" — events detected on periods
  // from the last two fiscal years only. detectedAt being recent does not make
  // a 2022 filing event news.
  const FRESH_FY = new Date().getFullYear() - 1
  const events = await db.financialEvent.findMany({
    where: {
      fiscalYear: { gte: FRESH_FY },
      ...(companyIds.length ? { companyId: { in: companyIds } } : {}),
      ...(eventType && EVENT_TYPE_MAP[eventType] ? { eventType } : {}),
    },
    // Latest REPORTING periods first, then the most recent detection.
    // Ordering by detectedAt alone floats old-period events (re-detected
    // during later backfills) to the top of a feed the user reads as
    // "latest events" — e.g. FY2022 rows appearing above FY2025 ones.
    orderBy: [{ fiscalYear: "desc" }, { detectedAt: "desc" }],
    take: limit,
    include: {
      company: { select: { id: true, ticker: true, nameEn: true, nameAr: true, isDemoData: true } },
    },
  })

  return Response.json({
    events: events.map((e) => {
      const meta = EVENT_TYPE_MAP[e.eventType]
      return {
        id: e.id,
        eventType: e.eventType,
        labelEn: meta?.labelEn ?? e.eventType,
        labelAr: meta?.labelAr ?? e.eventType,
        tone: meta?.tone ?? "neutral",
        periodLabel: e.periodLabel,
        periodType: e.periodType,
        fiscalYear: e.fiscalYear,
        currentPeriodKey: e.currentPeriodKey,
        previousPeriodKey: e.previousPeriodKey,
        explanationEn: e.explanationEn,
        explanationAr: e.explanationAr,
        ruleVersion: e.ruleVersion,
        detectedAt: e.detectedAt.toISOString(),
        company: e.company,
      }
    }),
  })
}
