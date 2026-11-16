import { NextRequest } from "next/server"
import { db } from "@/lib/db"
import { cached } from "@/lib/server-cache"
import { effectiveEgxSessionDate } from "@/lib/market/egx-session"

// GET /api/v1/market/liquidity-heatmap — per-sector DAILY LIQUIDITY change
// (owner feature request 2026-11-16: "خريطة حرارية لتغير سيولة القطاعات كل يوم
// زي خريطة الشركات كده ... زي fundalens بس مجانية").
//
// Liquidity = value traded (EGP): MarketPrice.valueTraded when present,
// falling back to price × volume when the column is empty. Sessions are the
// effective EGX session dates (the same cutoff the signals board uses), so a
// session that ran past 18:00 still counts to its own day.
//
// Per sector the API returns:
//   valueToday  — Σ value traded on the latest recorded session
//   valuePrev   — Σ value traded on the previous distinct session (null when
//                 the window only holds one session)
//   changePct   — day-over-day change (null when valuePrev is 0/absent —
//                 never fabricated)
//   sharePct    — today's share of total market liquidity (tile size)
//   companies   — how many names actually traded today in that sector
//
// Cached 60s (same cadence as the market treemap).

export const maxDuration = 30

export interface LiquiditySector {
  sector: string
  valueToday: number
  valuePrev: number | null
  changePct: number | null
  sharePct: number
  companies: number
}

export async function GET(_req: NextRequest) {
  const payload = await cached("market-liquidity-heatmap", 60_000, async () => {
    // one bounded window: the last 10 distinct session days is plenty to find
    // the previous session even after long weekends / Eid closures
    const windowStart = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    const rows = await db.marketPrice.findMany({
      where: {
        asOf: { gte: windowStart },
        price: { gt: 0 },
        isDemoData: false,
        company: { isActive: true, listingStatus: "LISTED" },
      },
      select: {
        asOf: true,
        price: true,
        volume: true,
        valueTraded: true,
        company: { select: { sector: true } },
      },
      orderBy: { asOf: "desc" },
      take: 20_000,
    })

    // per effective session day per sector: Σ value traded
    const daySector = new Map<string, Map<string, number>>()
    for (const r of rows) {
      const day = effectiveEgxSessionDate(r.asOf)
      const value = r.valueTraded ?? (r.volume != null && r.volume > 0 ? r.price * r.volume : 0)
      if (!(value > 0)) continue
      const sectorMap = daySector.get(day) ?? new Map<string, number>()
      sectorMap.set(r.company.sector, (sectorMap.get(r.company.sector) ?? 0) + value)
      daySector.set(day, sectorMap)
    }

    // distinct session days sorted newest-first (a day with any value > 0)
    const days = [...daySector.keys()].sort((a, b) => (a < b ? 1 : -1))
    const today = days[0]
    const prev = days[1]
    if (!today) return { asOf: null, prevAsOf: null, sectors: [] as LiquiditySector[] }

    const todayMap = daySector.get(today)!
    const prevMap = prev ? daySector.get(prev) : undefined
    const totalToday = [...todayMap.values()].reduce((a, b) => a + b, 0)

    const sectors: LiquiditySector[] = [...todayMap.entries()]
      .map(([sector, valueToday]) => {
        const valuePrev = prevMap ? (prevMap.get(sector) ?? null) : null
        const changePct = valuePrev != null && valuePrev > 0 ? Math.round(((valueToday / valuePrev - 1) * 100) * 10) / 10 : null
        return {
          sector,
          valueToday,
          valuePrev,
          changePct,
          sharePct: totalToday > 0 ? Math.round((valueToday / totalToday) * 1000) / 10 : 0,
          companies: 0,
        }
      })
      .sort((a, b) => b.valueToday - a.valueToday)

    // companies per sector on the latest day: count distinct rows
    const sectorCounts = new Map<string, number>()
    for (const r of rows) {
      if (effectiveEgxSessionDate(r.asOf) !== today) continue
      const value = r.valueTraded ?? (r.volume != null && r.volume > 0 ? r.price * r.volume : 0)
      if (!(value > 0)) continue
      sectorCounts.set(r.company.sector, (sectorCounts.get(r.company.sector) ?? 0) + 1)
    }
    for (const s of sectors) s.companies = sectorCounts.get(s.sector) ?? 0

    return { asOf: today, prevAsOf: prev ?? null, sectors }
  })

  return Response.json(payload, {
    headers: { "cache-control": "public, max-age=60, stale-while-revalidate=300" },
  })
}
