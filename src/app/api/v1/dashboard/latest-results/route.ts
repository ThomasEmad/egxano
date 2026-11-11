import { db } from "@/lib/db"
import { cached } from "@/lib/server-cache"
import { publicCacheControl } from "@/lib/public-cache"
import { isAuthoritativeValue } from "@/lib/financial/integrity-policy"
import { isFuturePeriodEnd, latestAnnouncedPeriodEnd } from "@/lib/financial/period-validity"

// GET /api/v1/dashboard/latest-results — the freshest announced results across
// the market: the most recent trusted NET_PROFIT per company, newest first.
// Serves the investor's primary goal: "what's the latest data available now?"
//
// Rules enforced here (the same rules the audit engine uses):
//   - only VALID, CURRENT-period values (comparative columns are not filings);
//   - only reports that are trusted and not soft-deleted;
//   - never a period that ends in the future — a future end date is a label
//     error or a forecast, not an announced actual;
//   - carried-forward copies and zero placeholders are excluded by the shared
//     integrity policy (missing data is never zero);
//   - CONSOLIDATED rows win over STANDALONE rows for the same period.

const TRUSTED = ["VALIDATED", "APPROVED", "EXTRACTED"]

// Egress diet (2026-11-10): results change only when the pipeline ingests a
// new filing; a 10-min SWR cache + CDN edge headers keep the 800-row probe
// (deduped to 12) from running per request.
export async function GET() {
  const data = await cached("dashboard:latest-results", 10 * 60_000, buildLatestResults)
  return Response.json(data, { headers: { "Cache-Control": publicCacheControl(600) } })
}

async function buildLatestResults(): Promise<{ results: unknown[] }> {
  const rows = await db.financialValue.findMany({
    where: {
      metricCode: "NET_PROFIT",
      validationStatus: "VALID",
      subPeriod: "CURRENT",
      report: {
        processingStatus: { in: TRUSTED },
        deletedAt: null,
        periodEnd: { lte: latestAnnouncedPeriodEnd() },
      },
    },
    // newest period first; for the same period prefer consolidated statements
    orderBy: [
      { report: { periodEnd: "desc" } },
      { report: { statementType: "asc" } },
      { report: { createdAt: "desc" } },
    ],
    take: 800,
    select: {
      normalizedValue: true,
      companyId: true,
      originalLabel: true,
      validationNotes: true,
      report: {
        select: {
          periodLabel: true,
          periodType: true,
          fiscalYear: true,
          periodEnd: true,
          statementType: true,
          createdAt: true,
        },
      },
      company: { select: { ticker: true, nameAr: true, nameEn: true } },
    },
  })

  // dedupe: first (newest, preferred statement type) authoritative row per company
  const seen = new Set<string>()
  const out: {
    companyId: string; ticker: string; name: string; nameEn: string
    periodLabel: string; periodType: string; fiscalYear: number
    asOf: Date; statementType: string; netProfit: number
  }[] = []
  for (const v of rows) {
    if (seen.has(v.companyId)) continue
    if (isFuturePeriodEnd(v.report.periodEnd)) continue
    if (!isAuthoritativeValue({
      metricCode: "NET_PROFIT",
      normalizedValue: v.normalizedValue,
      validationStatus: "VALID",
      validationNotes: v.validationNotes,
      originalLabel: v.originalLabel,
    })) continue
    seen.add(v.companyId)
    out.push({
      companyId: v.companyId,
      ticker: v.company.ticker,
      name: v.company.nameAr || v.company.nameEn,
      nameEn: v.company.nameEn,
      periodLabel: v.report.periodLabel,
      periodType: v.report.periodType,
      fiscalYear: v.report.fiscalYear,
      asOf: v.report.periodEnd,
      statementType: v.report.statementType,
      netProfit: v.normalizedValue,
    })
    if (out.length >= 12) break
  }

  return { results: out }
}
