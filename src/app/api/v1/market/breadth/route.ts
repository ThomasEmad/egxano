import { readMarketSnapshot } from "@/lib/market/snapshot"
import { latestTwoPerCompany } from "@/lib/market/latest-price"
import { cachedResponse } from "@/lib/public-cache"

// GET /api/v1/market/breadth — today's price breadth, not a fundamental screen.
//
// The previous implementation compared each company's latest NET PROFIT with
// the prior fiscal year and labelled the result "Advancing / Declining". That
// is a fundamental-growth measure, not market breadth, and it made the
// dashboard claim e.g. "124 advancing / 132 declining" while the market was
// actually up. Breadth must come from price changes.
//
// Primary source: the public 15-minute-delayed snapshot (all EGX rows, with
// volume). Fallback: the latest two MarketPrice points per company. Traded
// value is only reported when volume is available; otherwise it is null, never
// fabricated.

interface BreadthData {
  advancing: number
  declining: number
  unchanged: number
  tradedValue: number | null
  asOf: string | null
  pricedCount: number
  tradedValueCoverage: number | null
}

// 10-min SWR cache + CDN edge caching (public-cache) — breadth is hit by the
// dashboard on every visit and by the ticker poll; prices change once per
// trading day, so the DB-fallback path must not run per request. The fallback
// now reads only the latest two closes per company via SQL (~550 rows) instead
// of the whole MarketPrice table (13k+ rows).
export async function GET() {
  return cachedResponse("market-breadth", 10 * 60 * 1000, buildBreadth)
}

async function buildBreadth(): Promise<BreadthData> {
  const snapshot = readMarketSnapshot()

  if (snapshot && snapshot.movers.length > 0) {
    const valid = snapshot.movers
    const advancing = valid.filter((m) => m.changePct > 0).length
    const declining = valid.filter((m) => m.changePct < 0).length
    const unchanged = valid.filter((m) => m.changePct === 0).length

    const withVolume = valid.filter((m) => typeof m.volume === "number" && m.volume >= 0)
    const tradedValue = withVolume.length
      ? withVolume.reduce((sum, m) => sum + m.price * (m.volume as number), 0)
      : null

    return {
      advancing,
      declining,
      unchanged,
      tradedValue,
      asOf: snapshot.pricesAsOf ?? snapshot.asOf,
      pricedCount: valid.length,
      tradedValueCoverage: valid.length ? withVolume.length / valid.length : null,
    } satisfies BreadthData
  }

  // Fallback: durable price rows. There is no volume column, so traded value
  // stays null (the UI renders N/A).
  const twoRows = await latestTwoPerCompany(undefined, { includeDemo: false })
  if (twoRows.size === 0) {
    return {
      advancing: 0,
      declining: 0,
      unchanged: 0,
      tradedValue: null,
      asOf: null,
      pricedCount: 0,
      tradedValueCoverage: null,
    } satisfies BreadthData
  }

  let advancing = 0
  let declining = 0
  let unchanged = 0
  let pricedCount = 0
  let latestTs = 0
  for (const { last, prev } of twoRows.values()) {
    latestTs = Math.max(latestTs, last.asOf.getTime())
    if (!prev) continue
    if (!(prev.price > 0) || !(last.price > 0)) continue
    const changePct = ((last.price - prev.price) / prev.price) * 100
    if (Math.abs(changePct) > 50) continue
    pricedCount++
    if (changePct > 0.01) advancing++
    else if (changePct < -0.01) declining++
    else unchanged++
  }

  return {
    advancing,
    declining,
    unchanged,
    tradedValue: null,
    asOf: latestTs ? new Date(latestTs).toISOString() : null,
    pricedCount,
    tradedValueCoverage: null,
  } satisfies BreadthData
}
