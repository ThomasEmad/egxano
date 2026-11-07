import { db } from "@/lib/db"
import { buildScanContextsCached } from "@/lib/financial/scan-service"
import { latestCalcPeriodKeys } from "@/lib/financial/statement-pref"
import { getLatestPrice } from "@/lib/financial/market"
import { readMarketSnapshot, moverMap } from "@/lib/market/snapshot"
import { latestAnnouncedPeriodEnd } from "@/lib/financial/period-validity"
import { evaluateRule, type ScanCondition } from "@/lib/financial/scanner"

// GET /api/v1/companies/[id] — company profile + which preset scanners it matches
// (on all period bases) + latest period keys + latest market price point.
// Preset matching builds the scan context ONCE per basis and evaluates every rule
// against it (cheap) instead of running a full scan per rule (42 full scans).
// latestPeriods comes from the company's preferred statement-type set
// (CONSOLIDATED when available, else STANDALONE — never mixed).
//
// Price freshness parity (owner report: list pages showed the fresh
// 15-minute-delayed snapshot price while the company page showed a stale
// MarketPrice row): the SAME snapshot-first chain as the companies list —
// public market-ticker snapshot by ticker, then the durable MarketPrice table.

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const raw = decodeURIComponent(id)
  // CUIDs are lower-case and case-sensitive; only upper-case ticker/ISIN keys.
  const upper = raw.toUpperCase()
  const company = await db.company.findFirst({
    where: { OR: [{ id: raw }, { ticker: upper }, { isin: upper }] },
    include: {
      _count: { select: { reports: true, events: true, dividends: true, values: true } },
    },
  })
  if (!company) return Response.json({ error: "NOT_FOUND" }, { status: 404 })
  const companyId = company.id

  // snapshot first (the freshest source the platform has), durable table second
  const snapshot = readMarketSnapshot()
  const mover = moverMap(snapshot).get(company.ticker.toUpperCase())
  const snapshotAsOf = snapshot?.pricesAsOf ?? snapshot?.asOf ?? null
  const price = mover
    ? {
        price: mover.price,
        asOf: snapshotAsOf ? new Date(snapshotAsOf) : new Date(),
        currency: "EGP",
        sourceName: "market-ticker (15-min delayed)",
        isDemoData: false,
      }
    : await getLatestPrice(companyId)
  const [presets, periods, latestReport] = await Promise.all([
    db.scannerRule.findMany({ where: { isPreset: true, isActive: true } }),
    latestCalcPeriodKeys(companyId),
    // freshness: latest period-end across trusted filings (data-as-of display)
    db.financialReport.findFirst({
      where: {
        companyId,
        processingStatus: { in: ["VALIDATED", "APPROVED", "EXTRACTED"] },
        deletedAt: null,
        // a future period-end is not a filing that can be "data as of" today
        periodEnd: { lte: latestAnnouncedPeriodEnd() },
      },
      orderBy: { periodEnd: "desc" },
      select: { periodEnd: true, periodLabel: true },
    }),
  ])

  const matchedPresets: { presetKey: string; name: string; nameAr: string | null; basis: string }[] = []
  // the three bases are independent — build/scan them in parallel (each
  // buildScanContexts scans every company, so serial ×3 dominated this route)
  // buildScanContexts scans EVERY company — ~1.4s per basis per request. The
  // result is market-wide and only changes on recompute, so cache per basis.
  const contextsByBasis = await Promise.all(
    (["LATEST_ANNUAL", "LATEST_QUARTERLY", "LATEST_TTM"] as const).map((basis) =>
      buildScanContextsCached(basis).then((contexts) => ({ basis, contexts }))
    )
  )
  for (const { basis, contexts } of contextsByBasis) {
    const mine = contexts.find((c) => c.company.id === companyId)
    if (!mine) continue
    for (const preset of presets) {
      const evaluation = evaluateRule(JSON.parse(preset.conditions) as ScanCondition[], mine.context)
      if (evaluation.matched) {
        matchedPresets.push({
          presetKey: preset.presetKey ?? preset.name,
          name: preset.name,
          nameAr: preset.nameAr,
          basis,
        })
      }
    }
  }

  return Response.json({
    company: {
      id: company.id,
      ticker: company.ticker,
      nameEn: company.nameEn,
      nameAr: company.nameAr,
      sector: company.sector,
      industry: company.industry,
      listingStatus: company.listingStatus,
      isDemoData: company.isDemoData,
      sharesOutstanding: company.sharesOutstanding,
      descriptionEn: company.descriptionEn,
      descriptionAr: company.descriptionAr,
      counts: company._count,
    },
    latestPeriods: periods,
    dataAsOf: latestReport
      ? { periodEnd: latestReport.periodEnd.toISOString(), periodLabel: latestReport.periodLabel }
      : null,
    matchedPresets,
    marketPrice: price
      ? {
          price: price.price,
          asOf: price.asOf.toISOString(),
          currency: price.currency,
          sourceName: price.sourceName,
          isDemoData: price.isDemoData,
        }
      : null,
  })
}
