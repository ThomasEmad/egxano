import { db } from "@/lib/db"
import { getFreshMarketSnapshot, moverMap } from "@/lib/market/snapshot"
import { latestTwoPerCompany } from "@/lib/market/latest-price"
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

    // Fallback: when the scanner snapshot is missing or suspiciously thin
    // (upstream outage / throttling), derive today's change from the two
    // latest durable MarketPrice rows so the map never freezes. The window
    // between the two rows is checked for corporate actions (bonus/split/
    // rights/cash): a CANA-style mechanical ex-date drop is divided out
    // before the change is computed.
    const fallbackPrices = !snapshot || snapshot.movers.length < 50
      ? await latestTwoPerCompany(companies.map((c) => c.id), { includeDemo: false })
      : null
    const actionsBetween = fallbackPrices
      ? await import("@/lib/market/corporate-actions").then((m) =>
          m.loadActionsBetween(new Date(Date.now() - 10 * 86_400_000), new Date())
        )
      : null
    const { adjustPrevClose } = await import("@/lib/market/corporate-actions")

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
      let price = mover?.price ?? null
      let changePct = mover?.changePct ?? null
      if (price === null && fallbackPrices) {
        const p = fallbackPrices.get(c.id)
        if (p?.prev && p.prev.price > 0 && p.last.price > 0) {
          price = p.last.price
          // Corporate actions between the two rows: adjust the base close so
          // the ex-date mechanical drop is not reported as a loss.
          const acts = actionsBetween?.get(c.ticker.toUpperCase())
          const base = acts && acts.length ? adjustPrevClose(p.prev.price, acts) : p.prev.price
          const ch = ((p.last.price - base) / base) * 100
          changePct = Math.abs(ch) <= 50 ? ch : null
        }
      }
      // Market cap: the scanner's market_cap_basic tracks share-count changes
      // (e.g. bonus issues) at the source — it outranks our stored
      // sharesOutstanding × price, which goes stale after such actions.
      const cap =
        mover?.cap && mover.cap > 0
          ? mover.cap
          : price !== null && c.sharesOutstanding && c.sharesOutstanding > 0
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
