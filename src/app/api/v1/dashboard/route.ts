import { NextRequest } from "next/server"
import { db } from "@/lib/db"
import { getPresetScannerCards } from "@/lib/financial/scan-service"
import type { ScanCondition } from "@/lib/financial/scanner"
import { getOptionalUser } from "@/lib/optional-auth"
import { latestAnnouncedPeriodEnd } from "@/lib/financial/period-validity"
import { cached } from "@/lib/server-cache"

const TRUSTED = ["VALIDATED", "APPROVED", "EXTRACTED"]

// GET /api/v1/dashboard — discovery-first dashboard (spec #43/#44):
// preset scanner counts, recent events, dividend calendar, portfolio stats.
// Public endpoints only; admin-only stats are served from /api/v1/admin/dashboard.
// Company Events (recentEvents) are premium-only.

export async function GET(req: NextRequest) {
  const { isPremium } = await getOptionalUser(req)

  // Dashboard counters must use the same trust boundary as the read paths:
  // deleted reports and reports outside the trusted processing states are not
  // "verified" data. Values from future-dated periods are excluded as well —
  // they cannot be announced actuals.
  const trustedReportWhere = {
    processingStatus: { in: TRUSTED },
    deletedAt: null,
  }

  // Public, user-independent stats + scanner cards: cached for 60s (the four
  // counts include a large joined value count that took seconds cold).
  const base = await cached("dashboard:public", 60_000, async () => {
    const [companyCount, reportCount, valueCount, eventCount, upcomingDividends, scannerCards] = await Promise.all([
      db.company.count({ where: { isActive: true } }),
      db.financialReport.count({ where: trustedReportWhere }),
      db.financialValue.count({
        where: {
          validationStatus: "VALID",
          report: {
            ...trustedReportWhere,
            periodEnd: { lte: latestAnnouncedPeriodEnd() },
          },
        },
      }),
      db.financialEvent.count(),
      db.dividend.findMany({
        where: { status: { in: ["ANNOUNCED", "UPCOMING", "ELIGIBLE"] } },
        include: { company: { select: { ticker: true, nameEn: true, nameAr: true } } },
        orderBy: { announcementDate: "asc" },
        take: 6,
      }),
      getPresetScannerCards(),
    ])
    return {
      stats: { companies: companyCount, reports: reportCount, validValues: valueCount, events: eventCount },
      scannerCards,
      upcomingDividends: upcomingDividends.map((d) => ({
        id: d.id,
        status: d.status,
        announcementDate: d.announcementDate,
        eligibilityDate: d.eligibilityDate,
        exDividendDate: d.exDividendDate,
        distributionDate: d.distributionDate,
        dividendPerShare: d.dividendPerShare,
        notes: d.notes,
        company: d.company,
      })),
    }
  })

  // Premium-only recent events stay per-user (never cached). FRESHNESS: only
  // events detected from periods of the last two fiscal years surface here —
  // the old unfiltered query happily served a 2022 "turned profitable" story
  // as news. The events library regenerates rows per period; detectedAt being
  // recent does NOT mean the underlying event is recent, hence the fiscalYear
  // floor (the honest, period-based filter).
  const EVENT_FRESH_FY = new Date().getFullYear() - 1
  const recentEvents = isPremium
    ? await db.financialEvent.findMany({
        where: { fiscalYear: { gte: EVENT_FRESH_FY } },
        include: { company: { select: { id: true, ticker: true, nameEn: true, nameAr: true, isDemoData: true } } },
        orderBy: [{ fiscalYear: "desc" }, { detectedAt: "desc" }],
        take: 8,
      })
    : []

  return Response.json({
    ...base,
    recentEvents: recentEvents.map((e) => ({
      id: e.id,
      eventType: e.eventType,
      explanationEn: e.explanationEn,
      explanationAr: e.explanationAr,
      company: e.company,
    })),
  })
}
