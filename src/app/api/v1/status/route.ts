import { db } from "@/lib/db"
import { getFreshMarketSnapshot } from "@/lib/market/snapshot"
import { cachedResponse } from "@/lib/public-cache"

// GET /api/v1/status — public, machine-readable platform status: what the
// site serves, how fresh the data is, and whether everything is healthy.
// Backs the /status trust page. 60s cache (cheap counts, no secrets).

export async function GET() {
  return cachedResponse("platform-status", 5 * 60 * 1000, async () => {
    const [companies, activeCompanies, reports, prices, latestPrice, latestReport, alerts] =
      await Promise.all([
        db.company.count(),
        db.company.count({ where: { isActive: true } }),
        db.financialReport.count(),
        db.marketPrice.count(),
        db.marketPrice.findFirst({ orderBy: { asOf: "desc" }, select: { asOf: true } }),
        db.financialReport.findFirst({ orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
        db.priceAlert.count({ where: { active: true } }),
      ])

    const snapshot = await getFreshMarketSnapshot()

    return {
      status: "ok",
      time: new Date().toISOString(),
      market: {
        pricesAsOf: snapshot?.pricesAsOf ?? latestPrice?.asOf.toISOString() ?? null,
        delayMinutes: snapshot?.delayMinutes ?? null,
        trackedPrices: snapshot?.movers.length ?? null,
      },
      data: {
        companiesTotal: companies,
        companiesActive: activeCompanies,
        financialReports: reports,
        marketPricePoints: prices,
        latestReportImportedAt: latestReport?.createdAt.toISOString() ?? null,
      },
      // Documented import cadence (2026-11-21 reviewer pass): a freshness gap
      // read as broken data — publishing the schedule turns it into a set
      // expectation. Prices sync every 15 min (GitHub Actions); daily candles
      // import 13:30 UTC after the EGX close; statements have no fixed
      // schedule — they are imported as companies publish disclosures.
      schedule: {
        priceSyncMinutes: 15,
        candlesDailyUtc: "13:30",
        auditDailyUtc: "06:00",
        alertsPushUtc: "14:00",
        statements: "as filings publish — imported via ops jobs, no fixed cadence",
      },
      usage: { activePriceAlerts: alerts },
    }
  })
}
