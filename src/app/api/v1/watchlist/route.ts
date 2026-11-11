import { NextRequest } from "next/server"
import { db } from "@/lib/db"
import { CALC_METRIC_MAP } from "@/lib/financial/registry"
import { fetchCalcMany } from "@/lib/financial/statement-pref"
import { latestAndBaselinePerCompany } from "@/lib/market/latest-price"

// GET /api/v1/watchlist?ids=a,b,c — snapshot per watched company: latest recorded
// price + 1Y change, latest verified ANNUAL metrics. The ids come from the
// client-side watchlist store (a user preference, not server state).
//
// Calculated metrics are fetched through the shared statement-preference helper
// (CONSOLIDATED when a company has consolidated rows, otherwise STANDALONE), so
// the watchlist can never mix the two bases. Prices are fetched in one query
// instead of one query per company.

const METRICS = ["revenue", "net_profit", "net_margin", "roe", "p_e", "dividend_yield"] as const

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const ids = (url.searchParams.get("ids") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 10)
    .slice(0, 50)
  if (ids.length === 0) return Response.json({ companies: [] })

  const companies = await db.company.findMany({
    where: { id: { in: ids }, isActive: true },
    select: { id: true, ticker: true, nameEn: true, nameAr: true, sector: true },
  })

  // latest ANNUAL metrics per company (each company's own latest year, one
  // statement basis per company)
  const { filtered } = await fetchCalcMany(ids, {
    periodType: "ANNUAL",
    code: { in: [...METRICS] },
  })
  const metricByCompany = new Map<string, { fiscalYear: number; periodLabel: string; metrics: Record<string, number> }>()
  for (const r of filtered) {
    if (r.valueStatus !== "OK" || r.value === null) continue
    let e = metricByCompany.get(r.companyId)
    if (!e || r.fiscalYear > e.fiscalYear) {
      e = { fiscalYear: r.fiscalYear, periodLabel: r.periodLabel, metrics: {} }
      metricByCompany.set(r.companyId, e)
    }
    if (r.fiscalYear === e.fiscalYear && e.metrics[r.code] === undefined) {
      e.metrics[r.code] = r.value
    }
  }

  // prices: latest + ≈1y-ago baseline for the change badge — two DISTINCT ON
  // queries returning one row per company each (was the full price history).
  const pricesByCompany = await latestAndBaselinePerCompany(ids, new Date(Date.now() - 365 * 24 * 3600 * 1000))

  const result: {
    id: string
    ticker: string
    nameEn: string
    nameAr: string | null
    sector: string
    price: number | null
    priceAsOf: string | null
    change1y: number | null
    fiscalYear: number | null
    periodLabel: string | null
    metrics: Record<string, number>
  }[] = []
  for (const c of companies) {
    const entry = pricesByCompany.get(c.id)
    let price: number | null = null
    let asOf: string | null = null
    let change1y: number | null = null
    if (entry) {
      price = entry.last.price
      asOf = entry.last.asOf.toISOString()
      if (entry.base && entry.base.price > 0) {
        change1y = ((entry.last.price - entry.base.price) / entry.base.price) * 100
      }
    }
    const m = metricByCompany.get(c.id)
    result.push({
      ...c,
      price,
      priceAsOf: asOf,
      change1y,
      fiscalYear: m?.fiscalYear ?? null,
      periodLabel: m?.periodLabel ?? null,
      metrics: m?.metrics ?? {},
    })
  }

  const metricDefs = METRICS.map((code) => ({
    code,
    labelEn: CALC_METRIC_MAP[code]?.labelEn ?? code,
    labelAr: CALC_METRIC_MAP[code]?.labelAr ?? code,
    unit: CALC_METRIC_MAP[code]?.unit ?? "RATIO",
  }))

  return Response.json({ companies: result, metricDefs })
}
