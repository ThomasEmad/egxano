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
  const t0 = Date.now()
  const data = await cached("dashboard:latest-results", 10 * 60_000, buildLatestResults)
  return Response.json(data, {
    headers: {
      "Cache-Control": publicCacheControl(600),
      "server-timing": `latest-results;dur=${Date.now() - t0}`,
    },
  })
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

  // dedupe: first (newest, preferred statement type) authoritative row per company.
  // Authoritative rows are also grouped per company (periodEnd desc) to back
  // the change-vs-prior-period calc below.
  const seen = new Set<string>()
  type ResultRow = {
    id: string; companyId: string; ticker: string; name: string; nameEn: string
    companyName: string; period: string
    periodLabel: string; periodType: string; fiscalYear: number
    asOf: Date; statementType: string; netProfit: number
    change: number | null; reportUrl: string
  }
  // minimal shape the change calc needs (the two queries below select different
  // report fields, so group them normalized)
  type CalcRow = { value: number; periodEnd: Date; statementType: string }
  const perCompany = new Map<string, CalcRow[]>()
  const isAuthoritative = (v: {
    normalizedValue: number; originalLabel: string | null; validationNotes: string | null
  }) =>
    isAuthoritativeValue({
      metricCode: "NET_PROFIT",
      normalizedValue: v.normalizedValue,
      validationStatus: "VALID",
      validationNotes: v.validationNotes,
      originalLabel: v.originalLabel,
    })
  const out: ResultRow[] = []
  for (const v of rows) {
    if (isFuturePeriodEnd(v.report.periodEnd)) continue
    if (!isAuthoritative(v)) continue
    const list = perCompany.get(v.companyId)
    const calc = { value: v.normalizedValue, periodEnd: v.report.periodEnd, statementType: v.report.statementType }
    if (list) list.push(calc)
    else perCompany.set(v.companyId, [calc])
    if (seen.has(v.companyId)) continue
    seen.add(v.companyId)
    out.push({
      id: v.companyId,
      companyId: v.companyId,
      ticker: v.company.ticker,
      name: v.company.nameAr || v.company.nameEn,
      nameEn: v.company.nameEn,
      companyName: v.company.nameAr || v.company.nameEn,
      period: v.report.periodLabel,
      periodLabel: v.report.periodLabel,
      periodType: v.report.periodType,
      fiscalYear: v.report.fiscalYear,
      asOf: v.report.periodEnd,
      statementType: v.report.statementType,
      netProfit: v.normalizedValue,
      change: null,
      reportUrl: `/company/${v.companyId}`,
    })
    if (out.length >= 12) break
  }

  // The 800-row market-wide window rarely reaches a company's previous period
  // (the newest market-wide periods dominate the take), so fetch the NET_PROFIT
  // history of just the selected companies — a tiny, targeted second query.
  const ids = out.map((r) => r.companyId)
  if (ids.length) {
    const history = await db.financialValue.findMany({
      where: {
        metricCode: "NET_PROFIT",
        validationStatus: "VALID",
        subPeriod: "CURRENT",
        companyId: { in: ids },
        report: {
          processingStatus: { in: TRUSTED },
          deletedAt: null,
          periodEnd: { lte: latestAnnouncedPeriodEnd() },
        },
      },
      orderBy: [
        { report: { periodEnd: "desc" } },
        { report: { statementType: "asc" } },
        { report: { createdAt: "desc" } },
      ],
      select: {
        normalizedValue: true,
        companyId: true,
        originalLabel: true,
        validationNotes: true,
        report: { select: { periodEnd: true, statementType: true } },
      },
      take: 240,
    })
    for (const v of history) {
      if (isFuturePeriodEnd(v.report.periodEnd)) continue
      if (!isAuthoritative(v)) continue
      const list = perCompany.get(v.companyId)
      const calc = { value: v.normalizedValue, periodEnd: v.report.periodEnd, statementType: v.report.statementType }
      if (list) list.push(calc)
      else perCompany.set(v.companyId, [calc])
    }
  }

  // change vs prior announced period. Only meaningful when the prior net
  // profit is a positive base — a % change against a loss base is misleading,
  // so it stays null.
  for (const row of out) {
    const list = perCompany.get(row.companyId)
    if (!list) continue
    const latestEnd = row.asOf.getTime()
    const prior = list
      .filter((r) => r.periodEnd.getTime() < latestEnd)
      .sort((a, b) => {
        const sameA = a.statementType === row.statementType ? 0 : 1
        const sameB = b.statementType === row.statementType ? 0 : 1
        return sameA - sameB || b.periodEnd.getTime() - a.periodEnd.getTime()
      })[0]
    if (prior && prior.value > 0) {
      row.change = Math.round(
        ((row.netProfit - prior.value) / prior.value) * 1000
      ) / 10
    }
  }

  return { results: out }
}
