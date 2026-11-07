import { NextRequest } from "next/server"
import { db } from "@/lib/db"
import { CALC_METRIC_MAP } from "@/lib/financial/registry"
import { preferConsolidatedRows, withinYearRank } from "@/lib/financial/statement-pref"

// GET /api/v1/compare?ids=a,b,c(,d) — side-by-side comparison of up to 4
// companies on their LATEST VERIFIED fiscal-year data. One batched query; best
// value per row is marked client-side.
// year=YYYY → optional pin: compare on THAT fiscal year for every selected
// company — a like-for-like historical comparison. Companies without annual
// filings for the pinned year fall back to their best INTERIM period of the
// same year (9M / H1 / latest quarter — exactly what the company page shows
// in its interim view), so a 2025 column is never empty while the company's
// own page displays 2025 interim data. The response carries `years`: every
// fiscal year where at least TWO of the selected companies have data, so the
// UI only offers comparisons that make sense. Each company's `periodLabel`
// states the exact basis (FY 2025 vs 9M 2025 vs Q3 2025) — the UI surfaces it
// per column and warns when bases differ.

const COMPARE_METRICS = [
  "revenue", "net_profit", "net_margin", "roe", "roa",
  "total_assets", "total_equity",
  "debt_to_equity", "eps", "p_e", "p_b", "market_cap",
] as const

const COMPARE_PERIOD_TYPES = ["ANNUAL", "NINE_MONTH", "SEMIANNUAL", "QUARTERLY"] as const

interface MetricRow {
  companyId: string
  code: string
  value: number
  fiscalYear: number
  periodLabel: string
  periodType: string
  periodKey: string
  statementType: string
}

interface Basis {
  fiscalYear: number
  periodLabel: string
  periodType: string
  metrics: Record<string, number>
}

/** Pick the most complete trusted basis for one company-year: the period with
 *  the MOST OK compare metrics wins (annual only breaks ties — the owner rule
 *  is "show the data the company page shows", so a sparse annual filing never
 *  outranks a fuller interim period; the response's periodLabel states the
 *  actual basis either way). */
function bestBasis(candidates: Basis[]): Basis | null {
  if (candidates.length === 0) return null
  const score = (b: Basis) => Object.keys(b.metrics).length
  const rank = (b: Basis) => withinYearRank(b.periodType, b.periodLabel)
  return [...candidates].sort((a, b) => {
    if (score(b) !== score(a)) return score(b) - score(a) // most complete data
    const aAnnual = a.periodType === "ANNUAL" ? 1 : 0
    const bAnnual = b.periodType === "ANNUAL" ? 1 : 0
    if (aAnnual !== bAnnual) return bAnnual - aAnnual // annual on equal footing
    return rank(b) - rank(a) // later period in the year
  })[0]
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const ids = (url.searchParams.get("ids") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .slice(0, 4)
  if (ids.length < 2) {
    return Response.json({ error: "INVALID_PAYLOAD", message: "Provide 2-4 company ids." }, { status: 400 })
  }
  const rawYear = url.searchParams.get("year")
  const year = rawYear && /^\d{4}$/.test(rawYear) ? Number(rawYear) : null

  const companies = await db.company.findMany({
    where: { id: { in: ids }, isActive: true },
    select: { id: true, ticker: true, nameEn: true, nameAr: true, sector: true },
  })
  if (companies.length < 2) {
    return Response.json({ error: "NOT_FOUND", message: "Fewer than 2 valid companies." }, { status: 404 })
  }

  // trusted (OK) metrics per company across ALL statement bases — annual AND
  // interim. Statement types are never mixed: per company, CONSOLIDATED wins
  // when any consolidated row exists (platform-wide preference).
  const rawRows = (await db.$queryRawUnsafe(
    `SELECT cm."companyId", cm.code, cm.value, cm."fiscalYear", cm."periodLabel",
            cm."periodType", cm."periodKey", cm."statementType"
     FROM "CalculatedMetric" cm
     WHERE cm."companyId" IN (${ids.map((_, i) => `$${i + 1}`).join(",")})
       AND cm."periodType" IN (${COMPARE_PERIOD_TYPES.map((_, i) => `$${ids.length + i + 1}`).join(",")})
       AND cm."valueStatus" = 'OK' AND cm.value IS NOT NULL
       AND cm.code IN (${COMPARE_METRICS.map((_, i) => `$${ids.length + COMPARE_PERIOD_TYPES.length + i + 1}`).join(",")})
     ORDER BY cm."fiscalYear" DESC`,
    ...ids, ...COMPARE_PERIOD_TYPES, ...COMPARE_METRICS
  )) as MetricRow[]

  const rows = preferConsolidatedRows(rawRows)

  // periodKey → one candidate basis per company
  const byKey = new Map<string, Map<string, Basis>>()
  for (const r of rows) {
    if (!byKey.has(r.companyId)) byKey.set(r.companyId, new Map())
    const companyMap = byKey.get(r.companyId)!
    let basis = companyMap.get(r.periodKey)
    if (!basis) {
      basis = { fiscalYear: r.fiscalYear, periodLabel: r.periodLabel, periodType: r.periodType, metrics: {} }
      companyMap.set(r.periodKey, basis)
    }
    if (!basis.metrics[r.code]) basis.metrics[r.code] = r.value
  }

  // Years where ≥2 of the selected companies have data on any trusted basis —
  // the only pins that produce a meaningful side-by-side.
  const yearCounts = new Map<number, Set<string>>()
  for (const [companyId, companyMap] of byKey) {
    for (const basis of companyMap.values()) {
      if (!yearCounts.has(basis.fiscalYear)) yearCounts.set(basis.fiscalYear, new Set())
      yearCounts.get(basis.fiscalYear)!.add(companyId)
    }
  }
  const years = [...yearCounts.entries()]
    .filter(([, cos]) => cos.size >= 2)
    .map(([y]) => y)
    .sort((a, b) => b - a)

  const result = companies.map((c) => {
    const companyMap = byKey.get(c.id)
    let basis: Basis | null = null
    if (companyMap && companyMap.size > 0) {
      if (year) {
        basis = bestBasis([...companyMap.values()].filter((b) => b.fiscalYear === year))
      } else {
        // auto: the company's own latest fiscal year with data, then its best
        // basis within that year (annual preferred, else best interim period)
        const latest = Math.max(...[...companyMap.values()].map((b) => b.fiscalYear))
        basis = bestBasis([...companyMap.values()].filter((b) => b.fiscalYear === latest))
      }
    }
    return {
      ...c,
      fiscalYear: basis?.fiscalYear ?? null,
      periodLabel: basis?.periodLabel ?? null,
      periodType: basis?.periodType ?? null,
      metrics: basis?.metrics ?? {},
    }
  })

  const metricDefs = COMPARE_METRICS.map((code) => ({
    code,
    labelEn: CALC_METRIC_MAP[code]?.labelEn ?? code,
    labelAr: CALC_METRIC_MAP[code]?.labelAr ?? code,
    unit: CALC_METRIC_MAP[code]?.unit ?? "RATIO",
  }))

  return Response.json({ companies: result, metricDefs, year, years })
}
