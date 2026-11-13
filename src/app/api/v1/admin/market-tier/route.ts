import { NextRequest } from "next/server"
import { db } from "@/lib/db"
import { isAdmin, unauthorizedResponse } from "@/lib/admin-auth"
import { audit } from "@/lib/audit"
import { invalidateServerCache } from "@/lib/server-cache"
import {
  MARKET_TIERS,
  isMarketTier,
  EGX30_TICKERS,
  EGX70_TICKERS,
  NILEX_TICKERS,
  type MarketTier,
} from "@/lib/market/tiers"

// Admin market-tier management API.
//
// GET  /api/v1/admin/market-tier
//        → { counts: { EGX30, EGX70, MAIN, NILEX, OTC, <other> }, totalActive }
// POST /api/v1/admin/market-tier  { action: "seed" }
//        → assigns index membership from the seed lists + OTC sweep
// POST /api/v1/admin/market-tier  { action: "set", ticker, tier }
//        → sets one company's tier
// POST /api/v1/admin/market-tier  { action: "list", tier? }
//        → companies with (optional) tier filter

/** Seed lists keyed by tier — real constituents gathered from egxbot.com (Nov 2026). */
const SEED_LISTS: { tier: MarketTier; tickers: string[] }[] = [
  { tier: "EGX30", tickers: EGX30_TICKERS },
  { tier: "EGX70", tickers: EGX70_TICKERS },
  { tier: "NILEX", tickers: NILEX_TICKERS },
]

export async function GET(req: NextRequest) {
  if (!(await isAdmin(req))) return await unauthorizedResponse()
  const [groups, totalActive] = await Promise.all([
    db.company.groupBy({ by: ["marketTier"], _count: { _all: true } }),
    db.company.count({ where: { isActive: true } }),
  ])
  const counts: Record<string, number> = {}
  for (const tier of MARKET_TIERS) counts[tier] = 0
  for (const g of groups) counts[g.marketTier] = g._count._all
  return Response.json({ counts, totalActive, tiers: MARKET_TIERS })
}

export async function POST(req: NextRequest) {
  if (!(await isAdmin(req))) return await unauthorizedResponse()
  const body = await req.json().catch(() => null)

  if (body?.action === "seed") {
    const perList: Record<string, { matched: number; unmatched: string[] }> = {}
    for (const { tier, tickers } of SEED_LISTS) {
      const wanted = [...new Set(tickers.map((t) => t.toUpperCase()))]
      const existing = await db.company.findMany({
        where: { ticker: { in: wanted } },
        select: { ticker: true },
      })
      const found = existing.map((c) => c.ticker)
      // Only tickers that actually exist in Company are touched; the rest are
      // reported back as unmatched so the admin can import them first.
      if (found.length > 0) {
        await db.company.updateMany({
          where: { ticker: { in: found } },
          data: { marketTier: tier },
        })
      }
      perList[tier] = { matched: found.length, unmatched: wanted.filter((t) => !found.includes(t)) }
    }

    // OTC sweep: suspended/delisted companies whose current tier is still the
    // MAIN default. Index membership (EGX30/EGX70/NILEX) and any explicit
    // non-MAIN assignment are never overridden by this sweep.
    const otcSwept = await db.company.updateMany({
      where: { listingStatus: { in: ["SUSPENDED", "DELISTED"] }, marketTier: "MAIN" },
      data: { marketTier: "OTC" },
    })

    await audit("MARKET_TIER_SEED", {
      actor: "admin",
      entityType: "Company",
      details: `seeded tiers: EGX30=${perList.EGX30.matched}, EGX70=${perList.EGX70.matched}, NILEX=${perList.NILEX.matched}, otcSwept=${otcSwept.count}`,
    })
    await invalidateServerCache()
    return Response.json({ ok: true, seeded: perList, otcSwept: otcSwept.count })
  }

  if (body?.action === "set") {
    const ticker = typeof body.ticker === "string" ? body.ticker.trim().toUpperCase() : ""
    if (!ticker) return Response.json({ error: "VALIDATION", message: "ticker is required" }, { status: 400 })
    if (!isMarketTier(body.tier)) {
      return Response.json(
        { error: "VALIDATION", message: `tier must be one of: ${MARKET_TIERS.join(", ")}` },
        { status: 400 }
      )
    }
    const company = await db.company.findUnique({ where: { ticker }, select: { id: true, nameEn: true } })
    if (!company) return Response.json({ error: "NOT_FOUND", message: "Company not found" }, { status: 404 })

    await db.company.update({ where: { ticker }, data: { marketTier: body.tier } })
    await audit("MARKET_TIER_SET", {
      actor: "admin",
      entityType: "Company",
      entityId: company.id,
      details: `${ticker} marketTier → ${body.tier}`,
    })
    await invalidateServerCache()
    return Response.json({ ok: true, ticker, tier: body.tier })
  }

  if (body?.action === "list") {
    const tier = body.tier
    if (tier !== undefined && tier !== null && !isMarketTier(tier)) {
      return Response.json(
        { error: "VALIDATION", message: `tier must be one of: ${MARKET_TIERS.join(", ")}` },
        { status: 400 }
      )
    }
    const companies = await db.company.findMany({
      where: isMarketTier(tier) ? { marketTier: tier } : undefined,
      select: { ticker: true, nameAr: true, nameEn: true, marketTier: true },
      orderBy: { ticker: "asc" },
    })
    return Response.json({ ok: true, companies })
  }

  return Response.json(
    { error: "VALIDATION", message: "action must be one of: seed, set, list" },
    { status: 400 }
  )
}
