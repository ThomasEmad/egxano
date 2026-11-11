import { NextRequest } from "next/server"
import { requireAuth, unauthorizedResponse } from "@/lib/access"
import { buildReportContext, resolveCompany } from "@/lib/ai/report/builder"

// GET /api/v1/companies/[id]/ai-analysis/metadata?lang=ar|en
// Analysis metadata WITHOUT generating anything: data completeness, as-of
// dates, technical-data availability. Used by the UI to show freshness and
// limitations before/around the report.

export const maxDuration = 30

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireAuth(req)
    if (!userId) return unauthorizedResponse()

    const { id } = await params
    const company = await resolveCompany(id)
    if (!company) return Response.json({ error: "NOT_FOUND" }, { status: 404 })

    const langParam = req.nextUrl.searchParams.get("lang")?.toLowerCase() === "ar" ? "ar" : "en"
    const ctx = await buildReportContext(company, langParam)

    return Response.json(
      {
        company: { id: company.id, ticker: company.ticker, nameEn: company.nameEn, sector: company.sector },
        hasFinancialData: ctx.hasFinancialData,
        currentReportKey: ctx.reportKey,
        priceAsOf: ctx.priceAsOf,
        financialAsOf: ctx.financialAsOf,
        periodKey: ctx.periodKey,
        promptPeriodCount: ctx.promptPeriodCount,
        completeness: ctx.completeness,
        technical: ctx.technical
          ? {
              available: ctx.technical.snapshot.available,
              sessions: ctx.technical.snapshot.sessions,
              asOf: ctx.technical.snapshot.asOf,
              sparse: ctx.technical.snapshot.sparse,
              coveragePct: ctx.completeness.technicalCoveragePct,
            }
          : { available: false, sessions: 0, asOf: null, sparse: false, coveragePct: null },
      },
      { headers: { "Cache-Control": "private, max-age=30" } }
    )
  } catch (e) {
    console.error("ai-analysis metadata error:", e instanceof Error ? e.message.slice(0, 200) : e)
    return Response.json({ error: "METADATA_TEMPORARILY_UNAVAILABLE" }, { status: 503 })
  }
}
