import { NextRequest } from "next/server"
import { cachedResponse } from "@/lib/public-cache"
import { cached } from "@/lib/server-cache"
import { db } from "@/lib/db"
import { CALC_METRIC_MAP, defaultRankingOrder } from "@/lib/financial/registry"
import {
  isStalePeriod,
  periodOrder,
  selectLatestByCompany,
  type LatestSelectionRow,
  type PeriodRef,
} from "@/lib/financial/latest-period"

// GET /api/v1/rankings?metric=roe&sector=Banks&order=desc&basis=latest
//
// basis=latest → each company's LATEST AVAILABLE value for the metric, with
//                 the period that supplied it. There is deliberately NO shared
//                 "2025 window": companies file on different calendars, and
//                 forcing everyone onto one year either hides a Q2 2026 filing
//                 or compares a stale annual ROE with a current quarter.
//                 For ROE/ROA, "latest" means the latest FULL period (TTM or
//                 annual): a Q1 return is not annualised, so it cannot be
//                 ranked against a TTM/annual return.
//                 Rows older than the market's freshest period by more than
//                 four quarters are flagged `stale` (shown with a badge) rather
//                 than silently dropped.
// basis=annual → each company's latest ANNUAL value.
// basis=ttm    → each company's latest TTM value (full-period, like-for-like
//                 for flow metrics such as ROE / margins / revenue).
// year=YYYY    → optional pin: rank on THAT fiscal year only (the same period
//                 for every ranked company, a like-for-like historical
//                 comparison). Rows without that year drop out; the full-period
//                 restriction still applies inside the year. The response
//                 carries `years` — every fiscal year the metric actually has
//                 data for, so the UI only offers valid choices.
//
// Every row displays its own periodLabel, so the basis of each figure is visible.

interface RankRow {
  companyId: string
  ticker: string
  nameEn: string
  nameAr: string | null
  sector: string
  value: number
  fiscalYear: number
  periodLabel: string
  periodType: string
  stale: boolean
}

// Egress diet (2026-11-10): the metric rows (5k+ for one code across ~20
// periods × 274 companies) are cached per metric for 6h — data changes once
// per trading day and the pipeline recompute invalidates the process cache.
// Every query variant (sector / order / basis / year) is then derived from
// that one cached row-set instead of re-pulling the table, and the response
// carries CDN edge-cache headers (public-cache) so most requests never reach
// a lambda at all.
// Valuation multiples and leverage ratios rank "lower is better": rank #1
// must be the CHEAPEST / least-leveraged company. Defaulting these to DESC
// put the most expensive stock on the #1 podium of a list users read as a
// quality ranking. Rule + regression test live in financial/registry.
export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const metric = url.searchParams.get("metric") ?? "roe"
  const sector = url.searchParams.get("sector")?.trim() || ""
  const orderParam = url.searchParams.get("order")
  const order: "ASC" | "DESC" =
    orderParam === "asc" ? "ASC"
    : orderParam === "desc" ? "DESC"
    : defaultRankingOrder(metric)
  const rawBasis = url.searchParams.get("basis")
  const basis: "latest" | "annual" | "ttm" = rawBasis === "annual" || rawBasis === "ttm" ? rawBasis : "latest"
  const rawYear = url.searchParams.get("year")
  const year = rawYear && /^\d{4}$/.test(rawYear) ? Number(rawYear) : null

  const def = CALC_METRIC_MAP[metric]
  if (!def) {
    return Response.json({ error: "UNKNOWN_METRIC", message: "metric must be one of the calculated metric codes" }, { status: 400 })
  }

  const key = `rankings:${metric}|${sector}|${order}|${basis}|${year ?? ""}`
  return cachedResponse(key, 10 * 60 * 1000, () => buildRankings(metric, sector, order, basis, year))
}

/** Light rows for one metric — cached per metric (NOT per variant). */
async function metricRows(metric: string): Promise<LatestSelectionRow[]> {
  return cached(`rankings:rows:${metric}`, 6 * 60 * 60_000, async () =>
    db.calculatedMetric.findMany({
      where: { code: metric, valueStatus: "OK", value: { not: null } },
      select: {
        companyId: true,
        code: true,
        periodKey: true,
        periodType: true,
        fiscalYear: true,
        periodLabel: true,
        value: true,
        valueStatus: true,
        statementType: true,
      },
    })
  )
}

async function activeCompanies(sector: string) {
  return db.company.findMany({
    where: { isActive: true, ...(sector ? { sector } : {}) },
    select: { id: true, ticker: true, nameEn: true, nameAr: true, sector: true },
  })
}

const sectorsList = () =>
  cached("sectors:distinct", 24 * 60 * 60_000, async () => {
    const rows = await db.company.findMany({
      where: { isActive: true },
      select: { sector: true },
      distinct: ["sector"],
      orderBy: { sector: "asc" },
    })
    return rows.map((s) => s.sector)
  })

async function buildRankings(
  metric: string,
  sector: string,
  order: "ASC" | "DESC",
  basis: "latest" | "annual" | "ttm",
  year: number | null
): Promise<unknown> {
  const [companies, rows] = await Promise.all([activeCompanies(sector), metricRows(metric)])
  if (companies.length === 0) {
    return { metric: metricInfo(metric), basis, results: [], sectors: await sectorsList(), total: 0 }
  }

  const companyIds = new Set(companies.map((c) => c.id))
  const scoped0 = rows.filter((r) => companyIds.has(r.companyId))

  const filtered = basis === "latest"
    ? scoped0
    : scoped0.filter((r) => r.periodType === (basis === "annual" ? "ANNUAL" : "TTM"))

  // Years the metric actually covers (basis-filtered, sector-independent) —
  // the UI period dropdown renders exactly this list. Sector-independent by
  // design: derive from the unfiltered metric rows.
  const yearsForBasis = basis === "latest"
    ? rows
    : rows.filter((r) => r.periodType === (basis === "annual" ? "ANNUAL" : "TTM"))
  const years = [...new Set(yearsForBasis.map((r) => r.fiscalYear))].sort((a, b) => b - a)

  // A pinned year scopes every company to one period window.
  const scoped = year ? filtered.filter((r) => r.fiscalYear === year) : filtered

  const latest = selectLatestByCompany(scoped, [metric], {
    // Full-period restriction for ratio AND absolute flow metrics: ranking a
    // single quarter's revenue/profit against TTM/annual figures of other
    // companies is apples-to-oranges (a bank's one quarter can exceed another
    // company's year). Flow metrics rank on TTM or annual only — the row's
    // periodLabel always states which.
    fullPeriodCodes: ["roe", "roa", "roic", "roce", "revenue", "net_profit"],
  })
  const anchors = [...latest.values()]
    .map((v) => v.periods[metric])
    .filter((p): p is PeriodRef => p !== null)
  const freshestOrder = anchors.reduce((m, p) => Math.max(m, periodOrder(p.type, p.fiscalYear, p.label)), 0)

  const results: RankRow[] = []
  for (const c of companies) {
    const row = latest.get(c.id)
    const value = row?.values[metric]
    const period = row?.periods[metric]
    if (value === null || value === undefined || !period) continue
    results.push({
      companyId: c.id,
      ticker: c.ticker,
      nameEn: c.nameEn,
      nameAr: c.nameAr,
      sector: c.sector,
      value,
      fiscalYear: period.fiscalYear,
      periodLabel: period.label,
      periodType: period.type,
      stale: isStalePeriod(period, freshestOrder),
    })
  }
  results.sort((a, b) =>
    Number(a.stale) - Number(b.stale) ||
    (order === "ASC" ? a.value - b.value : b.value - a.value)
  )

  return {
    metric: metricInfo(metric),
    basis,
    year,
    years,
    results,
    sectors: await sectorsList(),
    total: results.length,
  }
}

function metricInfo(code: string) {
  const def = CALC_METRIC_MAP[code]
  return { code, labelEn: def.labelEn, labelAr: def.labelAr, unit: def.unit }
}

