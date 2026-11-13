// =============================================================================
// Market context builder — turns the whole-market intelligence snapshot into
// the per-company `context{}` section injected into the technical bundle (and
// therefore into the AI report payload and the Technical tab). Pure read of
// computed data — never fabricates: missing intelligence → null context.
// =============================================================================

import { db } from "@/lib/db"
import { getIntelligence } from "./service"
import type { MarketContextSection } from "@/lib/technical/analyze"

export async function buildMarketContext(companyId: string): Promise<MarketContextSection | null> {
  const intel = await getIntelligence()
  if (!intel) return null
  const company = await db.company.findUnique({
    where: { id: companyId },
    select: { ticker: true, sector: true },
  })
  if (!company) return null

  const sectorRow = intel.rotation.sectors.find((s) => s.sector === company.sector) ?? null

  // Market-relative liquidity rank: percentile of this ticker's relative
  // volume among all movers that carry one.
  const entries = Object.entries(intel.relVolByTicker)
  let relVolRankPct: number | null = null
  const mine = intel.relVolByTicker[company.ticker.toUpperCase()]
  if (mine !== undefined && entries.length > 1) {
    const below = entries.filter(([, v]) => v < mine).length
    relVolRankPct = Math.round((below / (entries.length - 1)) * 100)
  }

  const limitations: string[] = [...intel.limitations]
  if (intel.enrichment === null) {
    limitations.push("Daily enrichment (EMA breadth) has not run yet — those fields are withheld rather than approximated.")
  }
  if (!sectorRow) limitations.push(`No sector row for "${company.sector}" in the current intelligence snapshot.`)

  return {
    available: true,
    asOf: intel.asOf,
    marketRegime: intel.regime.code,
    marketRegimeAr: intel.regime.labelAr,
    marketPulse: intel.pulse.score,
    breadth: {
      advancing: intel.breadth.advancing,
      declining: intel.breadth.declining,
      unchanged: intel.breadth.unchanged,
      ratio: intel.breadth.ratio,
    },
    aboveEma20: intel.breadth.pctAboveEma20 ?? null,
    aboveEma50: intel.breadth.pctAboveEma50 ?? null,
    aboveEma200: intel.breadth.pctAboveEma200 ?? null,
    sector: sectorRow
      ? {
          name: sectorRow.sector,
          dayChangePct: sectorRow.capWeightedChangePct ?? sectorRow.dayChangePct,
          advancing: sectorRow.advancing,
          declining: sectorRow.declining,
          turnoverSharePct: sectorRow.turnoverSharePct,
          turnoverShareDelta5d: sectorRow.turnoverShareDelta5d,
        }
      : null,
    relVolRankPct,
    limitations,
  }
}

/** Technical bundle with market/sector context injected (used by the API and AI builder). */
export async function buildTechnicalBundleWithContext(companyId: string) {
  const { buildTechnicalBundle } = await import("@/lib/technical/analyze")
  const context = await buildMarketContext(companyId)
  return buildTechnicalBundle(companyId, context)
}
