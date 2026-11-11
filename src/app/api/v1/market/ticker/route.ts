import { NextRequest } from "next/server"
import { db } from "@/lib/db"
import { getFreshMarketSnapshot } from "@/lib/market/snapshot"
import { latestTwoPerCompany } from "@/lib/market/latest-price"

// GET /api/v1/market/ticker — index levels + top movers.
//
// The snapshot comes from getFreshMarketSnapshot(): the DB `Setting` row
// written by /api/v1/cron/market when it is newer (serverless-safe intraday
// refresh), falling back to the build-time `public/data/market-ticker.json`.
// It carries `indices`, `movers`, `indicesAsOf` and `pricesAsOf`, so the strip
// does not need a second database query and does not derive a previous close
// from a month-old row.
//
// The database path remains as a fallback for snapshots without movers; it
// compares the latest two price points per company (SQL window query, ~550
// rows — was a full-table scan) with a ±50% cap so splits / legacy bad-scale
// rows do not render as movers.
//
// Egress (2026-11-10): the client polls this every 90s; the response is also
// CDN-edge-cacheable (public, s-maxage=60) so 10k visitors collapse into a
// handful of origin fetches. Prices change once per trading day.

let cache: { data: unknown; at: number } | null = null
const TTL_MS = 60_000

type SnapshotMover = { ticker: string; price: number; changePct: number }

export async function GET(req: NextRequest) {
  // Allow bypassing cache with ?fresh=true
  const isFresh = req.nextUrl.searchParams.get("fresh") === "true"
  const headers = { "Cache-Control": "public, max-age=30, s-maxage=60, stale-while-revalidate=600" }
  if (!isFresh && cache && Date.now() - cache.at < TTL_MS) return Response.json(cache.data, { headers })
  try {
    // Freshest of (DB Setting row, build-time file) — validated shape.
    const parsed = await getFreshMarketSnapshot()
    if (!parsed) throw new Error("no market snapshot available")
    const snap = {
      asOf: parsed.asOf ?? "",
      indicesAsOf: parsed.indicesAsOf ?? undefined,
      pricesAsOf: parsed.pricesAsOf ?? undefined,
      delayMinutes: parsed.delayMinutes,
      indices: parsed.indices,
      movers: parsed.movers,
    }

    let gainers: SnapshotMover[] = []
    let losers: SnapshotMover[] = []
    let breadth = { gainers: 0, losers: 0 }
    let pricesAsOf: string | null = snap.pricesAsOf ?? null

    if (Array.isArray(snap.movers) && snap.movers.length > 0) {
      const valid = snap.movers.filter(
        (m) => Number.isFinite(m.price) && m.price > 0 && Number.isFinite(m.changePct) && Math.abs(m.changePct) <= 50,
      )
      gainers = [...valid].sort((a, b) => b.changePct - a.changePct).slice(0, 8)
      losers = [...valid].sort((a, b) => a.changePct - b.changePct).slice(0, 8)
      breadth = {
        gainers: valid.filter((m) => m.changePct > 0).length,
        losers: valid.filter((m) => m.changePct < 0).length,
      }
      pricesAsOf = pricesAsOf ?? snap.asOf
    } else {
      // DB fallback: latest two closes per company via a SQL window query
      // (~550 rows; was a full-table scan of 13k+ rows), joined to tickers.
      const [twoRows, companies] = await Promise.all([
        latestTwoPerCompany(undefined, { includeDemo: false }),
        db.company.findMany({ where: { isActive: true }, select: { id: true, ticker: true } }),
      ])
      const tickerOf = new Map(companies.map((c) => [c.id, c.ticker]))
      const movers: SnapshotMover[] = []
      let latestTs = 0
      for (const { last, prev } of twoRows.values()) {
        if (last.asOf.getTime() > latestTs) latestTs = last.asOf.getTime()
        const ticker = tickerOf.get(last.companyId)
        if (!ticker || !prev) continue
        if (prev.price > 0 && last.price > 0) {
          const changePct = +(((last.price - prev.price) / prev.price) * 100).toFixed(2)
          if (Math.abs(changePct) > 0.01 && Math.abs(changePct) <= 50) {
            movers.push({ ticker, price: last.price, changePct })
          }
        }
      }
      gainers = [...movers].sort((a, b) => b.changePct - a.changePct).slice(0, 8)
      losers = [...movers].sort((a, b) => a.changePct - b.changePct).slice(0, 8)
      breadth = {
        gainers: movers.filter((m) => m.changePct > 0).length,
        losers: movers.filter((m) => m.changePct < 0).length,
      }
      pricesAsOf = latestTs ? new Date(latestTs).toISOString() : null
    }

    const indicesAsOf = snap.indicesAsOf ?? snap.asOf ?? null
    const clocks = [indicesAsOf, pricesAsOf].filter((v): v is string => Boolean(v)).sort()
    const asOf = clocks.length ? clocks[clocks.length - 1] : null
    const data = {
      asOf,
      indicesAsOf,
      pricesAsOf,
      delayMinutes: snap.delayMinutes ?? null,
      indices: snap.indices,
      gainers,
      losers,
      breadth,
    }
    cache = { data, at: Date.now() }
    return Response.json(data, { headers })
  } catch (e) {
    console.error("ticker-error", e)
    return Response.json({
      asOf: null,
      indicesAsOf: null,
      pricesAsOf: null,
      delayMinutes: null,
      indices: [],
      gainers: [],
      losers: [],
      breadth: { gainers: 0, losers: 0 },
    }, { headers: { "Cache-Control": "no-store" } })
  }
}
