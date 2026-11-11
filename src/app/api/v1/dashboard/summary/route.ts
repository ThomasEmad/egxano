import { db } from "@/lib/db"
import { cachedResponse } from "@/lib/public-cache"

// GET /api/v1/dashboard/summary — market breadth and summary statistics.
//
// Egress rewrite (2026-11-10): the previous implementation pulled the ENTIRE
// MarketPrice table twice (ORDER BY "asOf" DESC and ASC) per cache miss and
// grouped it in JS — ~26k rows of egress every 60s per serverless instance.
// The window query below returns only the latest two closes per company
// (~550 rows) and derives the identical counters.
//
// The fabricated "total traded value" (price × 1,000,000 per company — an
// invented constant, MarketPrice carries no volume) is now null: missing data
// is never fabricated into a number.

export async function GET() {
  // Prices change at most once per trading day; the snapshot row updates on
  // the market cron. 10 minutes is invisible to users and cuts cold builds ~10x.
  return cachedResponse("dashboard-summary", 10 * 60 * 1000, buildSummary)
}

interface SummaryRow {
  ticker: string
  nameEn: string
  nameAr: string | null
  sector: string
  price: number
  asOf: Date
  rn: number
}

async function buildSummary(): Promise<unknown> {
  try {
    const [totalCompanies, rows] = await Promise.all([
      db.company.count({ where: { isActive: true } }),
      db.$queryRawUnsafe<SummaryRow[]>(
        `SELECT c.ticker, c."nameEn", c."nameAr", c.sector, t.price, t."asOf", t.rn::int AS rn
         FROM (
           SELECT mp."companyId" AS "companyId", mp.price, mp."asOf" AS "asOf",
                  ROW_NUMBER() OVER (PARTITION BY mp."companyId" ORDER BY mp."asOf" DESC) AS rn
           FROM "MarketPrice" mp
           WHERE mp.price IS NOT NULL AND mp.price > 0
         ) t
         JOIN "Company" c ON c.id = t."companyId" AND c."isActive" = true
         WHERE t.rn <= 2
         ORDER BY c.ticker, t.rn`
      ),
    ])

    interface CoInfo {
      price: number
      asOf: Date
      ticker: string
      nameEn: string
      nameAr: string | null
      sector: string
      prev: number | null
    }
    const latestByCompany = new Map<string, CoInfo>()
    for (const row of rows) {
      if (row.rn === 1) {
        latestByCompany.set(row.ticker, {
          price: row.price,
          asOf: row.asOf,
          ticker: row.ticker,
          nameEn: row.nameEn,
          nameAr: row.nameAr,
          sector: row.sector,
          prev: null,
        })
      } else {
        const entry = latestByCompany.get(row.ticker)
        if (entry) entry.prev = row.price
      }
    }

    const companies = Array.from(latestByCompany.values())
    const total = companies.length

    let gainers = 0
    let losers = 0
    let unchanged = 0

    const changePctOf = (data: CoInfo): number | null => {
      if (data.prev === null || !(data.prev > 0)) return null
      return ((data.price - data.prev) / data.prev) * 100
    }

    const sectorGainers = new Map<string, number>()
    const sectorLosers = new Map<string, number>()
    const sectorTotal = new Map<string, number>()
    let latestAsOf: Date | null = null

    for (const data of companies) {
      sectorTotal.set(data.sector, (sectorTotal.get(data.sector) ?? 0) + 1)
      if (!latestAsOf || data.asOf > latestAsOf) latestAsOf = data.asOf
      const changePct = changePctOf(data)
      if (changePct === null) {
        unchanged++
        continue
      }
      if (changePct > 0.01) {
        gainers++
        sectorGainers.set(data.sector, (sectorGainers.get(data.sector) ?? 0) + 1)
      } else if (changePct < -0.01) {
        losers++
        sectorLosers.set(data.sector, (sectorLosers.get(data.sector) ?? 0) + 1)
      } else {
        unchanged++
      }
    }

    const topSectors = Array.from(sectorGainers.entries())
      .map(([sector, g]) => ({
        sector,
        gainers: g,
        losers: sectorLosers.get(sector) ?? 0,
        total: sectorTotal.get(sector) ?? 0,
      }))
      .sort((a, b) => b.gainers - a.gainers)
      .slice(0, 5)

    // Market status in Cairo time (the exchange's clock) — the previous
    // version used the lambda's local hours, which on Vercel is UTC.
    const cairo = new Intl.DateTimeFormat("en-US", {
      timeZone: "Africa/Cairo",
      hour: "numeric",
      hour12: false,
      weekday: "short",
    }).formatToParts(new Date())
    const hour = Number(cairo.find((p) => p.type === "hour")?.value ?? "0") % 24
    const weekday = cairo.find((p) => p.type === "weekday")?.value ?? ""
    // EGX session: Sunday–Thursday 10:00–14:30 Cairo time
    const isMarketOpen = ["Sun", "Mon", "Tue", "Wed", "Thu"].includes(weekday) && hour >= 10 && hour < 14.5

    return {
      stats: {
        totalCompanies,
        companiesWithPrices: total,
        gainers,
        losers,
        unchanged,
        totalValue: null as number | null,
        marketOpen: isMarketOpen,
        lastUpdate: latestAsOf?.toISOString() ?? new Date().toISOString(),
      },
      sectorBreadth: topSectors,
      breadth: {
        gainers,
        losers,
        unchanged,
        total,
      },
      asOf: new Date().toISOString(),
    }
  } catch (e) {
    console.error("dashboard-summary-error", e)
    throw e instanceof Error ? e : new Error("dashboard summary failed")
  }
}
