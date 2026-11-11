import { db } from "@/lib/db"
import { getFreshMarketSnapshot, moverMap } from "@/lib/market/snapshot"
import { cached } from "@/lib/server-cache"

// GET /api/v1/market/treemap — per-company tiles for the finviz-style market
// heatmap: every active listed company with today's % change (public 15-min
// delayed snapshot) and its market cap (snapshot price × shares outstanding).
// Tiles WITHOUT a live quote fall back to their stored market_cap metric and
// render grey (no invented price change). Cached 60s; snapshot reads kick a
// background refresh when stale inside the session window.

export const maxDuration = 30

export interface TreemapTile {
  ticker: string
  name: string
  nameAr: string | null
  sector: string
  price: number | null
  changePct: number | null
  cap: number | null
}

export async function GET() {
  const payload = await cached("market-treemap", 60_000, async () => {
    const companies = await db.company.findMany({
      where: { isActive: true, listingStatus: "LISTED" },
      select: {
        id: true,
        ticker: true,
        nameEn: true,
        nameAr: true,
        sector: true,
        sharesOutstanding: true,
      },
      orderBy: { ticker: "asc" },
    })

    const snapshot = await getFreshMarketSnapshot()
    const movers = moverMap(snapshot)

    // stored market_cap metric as fallback sizing for companies without shares
    const capRows = await db.calculatedMetric.findMany({
      where: { code: "market_cap", valueStatus: "OK", company: { isActive: true }, value: { gt: 0 } },
      select: { companyId: true, value: true },
      orderBy: { value: "desc" },
      take: 800,
    })
    const capByCompany = new Map<string, number>()
    for (const row of capRows) {
      if (typeof row.value === "number" && Number.isFinite(row.value) && row.value > 0) {
        if (!capByCompany.has(row.companyId)) capByCompany.set(row.companyId, row.value)
      }
    }


    const tiles: TreemapTile[] = []
    for (const c of companies) {
      const mover = movers.get(c.ticker.toUpperCase())
      const price = mover?.price ?? null
      const changePct = mover?.changePct ?? null
      const cap =
        price !== null && c.sharesOutstanding && c.sharesOutstanding > 0
          ? price * c.sharesOutstanding
          : (capByCompany.get(c.id) ?? null)
      if (cap === null && price === null) continue // nothing to draw
      tiles.push({
        ticker: c.ticker,
        name: c.nameEn,
        nameAr: c.nameAr,
        sector: c.sector,
        price,
        changePct,
        cap: cap !== null && cap > 0 ? cap : null,
      })
    }

    return { asOf: snapshot?.asOf ?? null, delayMinutes: snapshot?.delayMinutes ?? null, tiles }
  })

  return Response.json(payload, {
    headers: { "Cache-Control": "public, max-age=0, s-maxage=60, stale-while-revalidate=300" },
  })
}
