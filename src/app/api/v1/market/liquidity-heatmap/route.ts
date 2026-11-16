import { NextRequest } from "next/server"
import { db } from "@/lib/db"
import { cached } from "@/lib/server-cache"
import { effectiveEgxSessionDate } from "@/lib/market/egx-session"

// GET /api/v1/market/liquidity-heatmap — per-sector DAILY LIQUIDITY change +
// the signed NET per sector (owner feature request 2026-11-17: "على كل قطاع
// صافي السيولة — لو داخلة يبقى موجب لو خارجة يبقى عامل سالب بقيمة الفلوس
// اللي خرجت صافي").
//
// Liquidity = value traded (EGP): MarketPrice.valueTraded when present,
// falling back to price × volume when the column is empty. Sessions are the
// effective EGX session dates (the same cutoff the signals board uses).
//
// DEDUPE (owner bug report 2026-11-17: "القطاعات كلها في التغيرات احمر"):
// the market pipeline writes a MarketPrice row per scanner pull and the
// scanner's volume is CUMULATIVE for the session — summing every row counted
// the same money once per refresh, inflating the totals and distorting the
// day-over-day comparison. Only the LAST pull per company per session day is
// the day's real total: rows arrive newest-first, so the first hit per
// (day, companyId) wins and earlier pulls of the same session are discarded.
// companies counts DISTINCT issuers, not rows.
//
// sessionLive: a snapshot inside EGX trading hours (Sun–Thu 09:30–15:00
// Cairo) means today's total is still ACCUMULATING while the previous
// session's total is final — an all-red map mid-session is arithmetic, not a
// data bug. The UI surfaces this honestly instead of hiding it.
//
// Per sector the API returns:
//   valueToday  — Σ last-pull value traded on the latest recorded session
//   valuePrev   — same, previous distinct session (null when the window only
//                 holds one session)
//   netValue    — valueToday − valuePrev, SIGNED (positive = entered,
//                 negative = left by that amount); null without a prior day
//   changePct   — day-over-day change % (null when valuePrev is 0/absent)
//   sharePct    — today's share of total market liquidity (tile size)
//   companies   — how many DISTINCT names traded today in that sector
//
// Cached 60s (same cadence as the market treemap).

export const maxDuration = 30

export interface LiquiditySector {
  sector: string
  valueToday: number
  valuePrev: number | null
  netValue: number | null
  changePct: number | null
  sharePct: number
  companies: number
}

/** EGX trades Sun–Thu, 09:30–15:00 Cairo (DST handled by the tz database). */
export function isEgxSessionLive(iso: string | null | undefined): boolean {
  if (!iso) return false
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return false
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Cairo",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(d)
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? ""
  if (["Fri", "Sat"].includes(get("weekday"))) return false
  const minutes = Number(get("hour")) * 60 + Number(get("minute"))
  return minutes >= 9 * 60 + 30 && minutes <= 15 * 60
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
        companyId: true,
        asOf: true,
        price: true,
        volume: true,
        valueTraded: true,
        company: { select: { sector: true } },
      },
      orderBy: { asOf: "desc" },
      take: 20_000,
    })

    // last pull per company per session day wins: rows are ordered newest-
    // first, so the FIRST hit per (day, companyId) is that company's newest
    // snapshot of the session — its cumulative volume IS the day total
    const lastPull = new Map<string, { day: string; sector: string; value: number }>()
    for (const r of rows) {
      const day = effectiveEgxSessionDate(r.asOf)
      const value = r.valueTraded ?? (r.volume != null && r.volume > 0 ? r.price * r.volume : 0)
      if (!(value > 0)) continue
      const key = `${day}|${r.companyId}`
      if (lastPull.has(key)) continue
      lastPull.set(key, { day, sector: r.company.sector, value })
    }

    // per session day per sector: Σ last-pull values + distinct issuer count
    const daySector = new Map<string, Map<string, number>>()
    for (const { day, sector, value } of lastPull.values()) {
      const sectorMap = daySector.get(day) ?? new Map<string, number>()
      sectorMap.set(sector, (sectorMap.get(sector) ?? 0) + value)
      daySector.set(day, sectorMap)
    }

    // distinct ISSUERS per sector on a day — rewalk lastPull keyed by sector
    const issuerPerSectorDay = new Map<string, Set<string>>()
    for (const [key, entry] of lastPull) {
      const sectorDay = `${entry.day}|${entry.sector}`
      const set = issuerPerSectorDay.get(sectorDay) ?? new Set<string>()
      set.add(key) // key = day|companyId — unique per issuer
      issuerPerSectorDay.set(sectorDay, set)
    }

    // distinct session days sorted newest-first (a day with any value > 0)
    const days = [...daySector.keys()].sort((a, b) => (a < b ? 1 : -1))
    const today = days[0]
    const prev = days[1]
    if (!today) return { asOf: null, prevAsOf: null, sessionLive: false, sectors: [] as LiquiditySector[] }

    const todayMap = daySector.get(today)!
    const prevMap = prev ? daySector.get(prev) : undefined
    const totalToday = [...todayMap.values()].reduce((a, b) => a + b, 0)

    const round1 = (v: number) => Math.round(v * 10) / 10
    const sectors: LiquiditySector[] = [...todayMap.entries()]
      .map(([sector, valueToday]) => {
        const valuePrev = prevMap ? (prevMap.get(sector) ?? null) : null
        const netValue = valuePrev !== null ? valueToday - valuePrev : null
        const changePct = valuePrev !== null && valuePrev > 0 ? round1((valueToday / valuePrev - 1) * 100) : null
        const companies = issuerPerSectorDay.get(`${today}|${sector}`)?.size ?? 0
        return {
          sector,
          valueToday,
          valuePrev,
          netValue: netValue !== null ? Math.round(netValue) : null,
          changePct,
          sharePct: totalToday > 0 ? round1((valueToday / totalToday) * 100) : 0,
          companies,
        }
      })
      .sort((a, b) => b.valueToday - a.valueToday)

    return { asOf: today, prevAsOf: prev ?? null, sessionLive: isEgxSessionLive(new Date().toISOString()), sectors }
  })

  return Response.json(payload, {
    headers: { "cache-control": "public, max-age=60, stale-while-revalidate=300" },
  })
}
