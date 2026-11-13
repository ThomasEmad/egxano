import { findCompanyByKey } from "@/lib/company-lookup"
import { buildTechnicalBundleWithContext } from "@/lib/market/intelligence/context"
import { computeStanceFromSnapshot } from "@/lib/technical/signals"
import { getCachedMarketSignals } from "@/lib/technical/signals-service"
import { cached } from "@/lib/server-cache"

// GET /api/v1/companies/[id]/technical — deterministic technical analysis over
// the stored daily price bars (trend, momentum, volatility, volume, support /
// resistance zones, 52-week context, pre-flagged signals) + the rule-based
// stance synthesis (score / buy-wait-sell reading / style fits / invalidation
// level) + the market board's close-only read for the same ticker, so the
// company tab and the /signals board stay visibly in sync. Public: it is the
// same price-derived math the AI reports ground on — no user-specific data.
// Cached 10 minutes per company; a recompute/price import clears the cache.

export const maxDuration = 30

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const company = await findCompanyByKey(id, { id: true, ticker: true })
  if (!company) return Response.json({ error: "NOT_FOUND" }, { status: 404 })

  const payload = await cached(`technical-tab:${company.id}`, 10 * 60_000, async () => {
    const bundle = await buildTechnicalBundleWithContext(company.id)
    // The market board read for this ticker (10-min cached whole-market pass —
    // cheap to touch here). Used by the UI to show the sync strip: same
    // vocabulary, and any difference between the close-only board read and the
    // fuller snapshot stance is explained instead of silently contradicting.
    let boardSignal: { signal: "buy" | "hold" | "sell"; score: number; asOf: string | null } | null = null
    try {
      const board = await getCachedMarketSignals()
      const row = board.rows.find((r) => r.ticker === company.ticker)
      if (row?.signal && row.score !== null) {
        boardSignal = { signal: row.signal, score: row.score, asOf: row.asOf ?? null }
      }
    } catch {
      boardSignal = null
    }
    return {
      snapshot: bundle.snapshot,
      hash: bundle.hash.slice(0, 16),
      // Adjusted daily candles for the client chart (corporate-action
      // continuity) — compact series, already capped in the bundle.
      candles: bundle.candles,
      stance: computeStanceFromSnapshot(bundle.snapshot),
      boardSignal,
    }
  })

  return Response.json({ companyId: company.id, ticker: company.ticker, ...payload })
}
