import { NextRequest } from "next/server"
import { db } from "@/lib/db"
import { getSessionUser } from "@/lib/auth"
import { CALC_METRIC_MAP } from "@/lib/financial/registry"
import { fetchCalcMany } from "@/lib/financial/statement-pref"
import { latestAndBaselinePerCompany } from "@/lib/market/latest-price"
import { getActivePlanId } from "@/lib/subscription"
import { PLANS } from "@/lib/plans/entitlements"

// GET /api/v1/watchlist?ids=a,b,c — snapshot per watched company: latest recorded
// price + 1Y change, latest verified ANNUAL metrics. The ids come from the
// client-side watchlist store (a user preference, not server state).
//
// Per-plan watchlist cap (from the plans entitlements): FREE 10 / PRO 50 /
// PRO_PLUS unlimited. Requests exceeding the caller's cap get a 403 with the
// upgrade path named. Anonymous visitors get the FREE cap. The unlimited plan
// still passes a generous abuse bound (500 ids) — there are only ~200 EGX
// listings, so this never binds for real usage, it just protects the query.
//
// Calculated metrics are fetched through the shared statement-preference helper
// (CONSOLIDATED when a company has consolidated rows, otherwise STANDALONE), so
// the watchlist can never mix the two bases. Prices are fetched in one query
// instead of one query per company.

const METRICS = ["revenue", "net_profit", "net_margin", "roe", "p_e", "dividend_yield"] as const
const UNLIMITED_ABUSE_BOUND = 500

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const ids = (url.searchParams.get("ids") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 10)

  // resolve the caller's plan (anonymous → FREE cap)
  const token = req.headers.get("x-session-token") ?? req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? null
  const userId = token ? await getSessionUser(token) : null
  const planId = userId ? await getActivePlanId(userId) : "FREE"
  const cap = PLANS[planId].limits.watchlist

  if (cap !== "UNLIMITED" && ids.length > cap) {
    const message =
      planId === "FREE"
        ? `حد قائمة المراقبة للمجانية ${cap} سهم — متاح أكتر مع باقة برو.`
        : `حد قائمة المراقبة لباقة برو ${cap} سهم — القائمة بلا حدود مع باقة برو بلس.`
    return Response.json({ error: "QUOTA", message, limit: cap, plan: planId }, { status: 403 })
  }

  const boundedIds = cap === "UNLIMITED" ? ids.slice(0, UNLIMITED_ABUSE_BOUND) : ids.slice(0, cap)
  if (boundedIds.length === 0) return Response.json({ companies: [] })

  const companies = await db.company.findMany({
    where: { id: { in: boundedIds }, isActive: true },
    select: { id: true, ticker: true, nameEn: true, nameAr: true, sector: true },
  })

  // latest ANNUAL metrics per company (each company's own latest year, one
  // statement basis per company)
  const { filtered } = await fetchCalcMany(boundedIds, {
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
  const pricesByCompany = await latestAndBaselinePerCompany(boundedIds, new Date(Date.now() - 365 * 24 * 3600 * 1000))

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
