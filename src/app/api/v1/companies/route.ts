import { NextRequest } from "next/server"
import { cachedResponse } from "@/lib/public-cache"
import type { Prisma } from "@prisma/client"
import { db } from "@/lib/db"
import { fetchCalcMany } from "@/lib/financial/statement-pref"
import { latestPricesPerCompany } from "@/lib/market/latest-price"
import { moverMap, getFreshMarketSnapshot } from "@/lib/market/snapshot"
import { buildScanContextsCached } from "@/lib/financial/scan-service"
import type { ScanContext } from "@/lib/financial/scanner"

type CompanyWithCounts = Prisma.CompanyGetPayload<{
  include: { _count: { select: { reports: true; events: true; dividends: true } } }
}>

// GET /api/v1/companies — paginated, searchable, sector-filterable company list
// with a snapshot of latest-annual key metrics and the freshest market price.
//
// Query params:
//   search, sector, page, pageSize, ids, status
//   tickers=COMI,ETEL     explicit ticker set (used by featured/editorial rows)
//
// Sorting (dir=asc|desc, default depends on the field):
//   sort=ticker        alphabetical ticker (default)
//   sort=marketCap     current price × shares outstanding
//   sort=changePct     today's move, from the 15-min-delayed snapshot
//   sort=p_e           cheapest earnings first (nulls last)
//   sort=dividend_yield fattest trailing yield first (nulls last)
//   sort=roe           return on equity (nulls last)
//   sort=net_margin    net margin (nulls last)
//   sort=name          English name
//
// Numeric filters (a company with a missing value never matches a filter —
// honest empty result beats a fake hit):
//   priceMin/priceMax        latest price, EGP
//   changeMin/changeMax      today's move, percent
//   peMin/peMax              P/E (annual EPS basis); negative-earnings firms have no P/E
//   dyMin                    trailing dividend yield, percent
//   roeMin/roeMax            return on equity, percent
//   netMarginMin             net margin, percent
//   capMin/capMax            market cap, EGP
//
// Snapshot metrics are statement-type aware: per company, CONSOLIDATED
// calculated rows are preferred and STANDALONE rows are used only when the
// company has no consolidated rows (the two bases are never mixed).
//
// Market price comes from the public 15-minute-delayed snapshot first, then
// the durable MarketPrice table. Missing price/shares stays null; it is never
// replaced with zero.
//
// The advanced path (any non-default sort or any numeric filter) evaluates the
// whole active universe (~280) in memory against the 30-min-cached scan
// contexts — the same infrastructure the custom scanner uses — then paginates.
// The plain default path (ticker sort, no filters) stays on SQL pagination.

// 5-min SWR cache keyed by the normalized query — the companies list is the
// busiest endpoint on the site (search + pagination + the snapshot merge).
// Data changes once per trading day; stale-while-revalidate + CDN edge
// caching (public-cache) keep it ~O(1) at 10k visitors.
export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const key = `companies:${url.searchParams.toString()}`
  return cachedResponse(key, 5 * 60 * 1000, () => listCompanies(url))
}

const ADVANCED_SORTS = new Set(["changePct", "p_e", "dividend_yield", "roe", "net_margin", "name"])

function numParam(url: URL, name: string): number | null {
  const raw = url.searchParams.get(name)
  if (raw === null || raw.trim() === "") return null
  const n = Number(raw)
  return Number.isFinite(n) ? n : null
}

async function listCompanies(url: URL): Promise<unknown> {
  const search = url.searchParams.get("search")?.trim() || ""
  const sector = url.searchParams.get("sector")?.trim() || ""
  const page = Math.max(1, Number(url.searchParams.get("page") ?? 1) || 1)
  const pageSize = Math.min(50, Math.max(1, Number(url.searchParams.get("pageSize") ?? 9) || 9))
  const sortRaw = url.searchParams.get("sort")?.trim() || "ticker"
  const sort = ADVANCED_SORTS.has(sortRaw) ? sortRaw : sortRaw === "marketCap" ? "marketCap" : "ticker"
  const dirRaw = url.searchParams.get("dir")?.trim().toLowerCase()
  const dir = dirRaw === "asc" || dirRaw === "desc" ? dirRaw : null

  // Numeric filters — any presence flips the route into the advanced path.
  const filters = {
    priceMin: numParam(url, "priceMin"),
    priceMax: numParam(url, "priceMax"),
    changeMin: numParam(url, "changeMin"),
    changeMax: numParam(url, "changeMax"),
    peMin: numParam(url, "peMin"),
    peMax: numParam(url, "peMax"),
    dyMin: numParam(url, "dyMin"),
    roeMin: numParam(url, "roeMin"),
    roeMax: numParam(url, "roeMax"),
    netMarginMin: numParam(url, "netMarginMin"),
    capMin: numParam(url, "capMin"),
    capMax: numParam(url, "capMax"),
  }
  const hasFilters = Object.values(filters).some((v) => v !== null)
  const advanced = hasFilters || (sort !== "ticker" && sort !== "marketCap")

  const idsParam = url.searchParams.get("ids")
  const filterIds = idsParam
    ? [...new Set(idsParam.split(",").map((s) => s.trim()).filter((s) => s.length > 10))].slice(0, 200)
    : []

  const tickersParam = url.searchParams.get("tickers")
  const filterTickers = tickersParam
    ? [...new Set(tickersParam.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean))].slice(0, 50)
    : []

  const where: Record<string, unknown> = { isActive: true }
  if (sector) where.sector = sector
  if (idsParam !== null) where.id = { in: filterIds }
  if (filterTickers.length > 0) where.ticker = { in: filterTickers }

  const listingStatus = url.searchParams.get("status")?.trim().toUpperCase() || ""
  if (["LISTED", "SUSPENDED", "DELISTED"].includes(listingStatus)) where.listingStatus = listingStatus
  if (search) {
    where.OR = [
      { ticker: { contains: search, mode: "insensitive" } },
      { nameEn: { contains: search, mode: "insensitive" } },
      { nameAr: { contains: search } },
    ]
  }

  const snapshot = await getFreshMarketSnapshot()
  const movers = moverMap(snapshot)

  const includeCounts = { _count: { select: { reports: true, events: true, dividends: true } } } as const

  interface Ranked {
    company: CompanyWithCounts
    price: number | null
    priceAsOf: string | null
    changePct: number | null
    marketCap: number | null
    metrics: { p_e: number | null; dividend_yield: number | null; roe: number | null; roa: number | null; net_margin: number | null; eps: number | null }
  }
  let total: number
  let ranked: Ranked[]

  if (advanced) {
    // ---- Advanced path: whole universe in memory against cached scan contexts.
    const [all, contexts, latestDb] = await Promise.all([
      db.company.findMany({ where, orderBy: { ticker: "asc" }, take: 500, include: includeCounts }),
      buildScanContextsCached("LATEST_ANNUAL"),
      db.company
        .findMany({ where, select: { id: true }, take: 500 })
        .then((rows) => latestPricesPerCompany(rows.map((r) => r.id))),
    ])
    const ctxByCompany = new Map<string, ScanContext>()
    for (const entry of contexts) ctxByCompany.set(entry.company.id, entry.context)

    const mval = (ctx: ScanContext | undefined, code: string): number | null => {
      const m = ctx?.metrics?.[code]
      return m && m.status === "OK" && typeof m.value === "number" ? m.value : null
    }

    ranked = all.map((company) => {
      const mover = movers.get(company.ticker.toUpperCase())
      const dbPrice = latestDb.get(company.id)
      const price = mover?.price ?? dbPrice?.price ?? null
      const marketCap =
        price !== null && company.sharesOutstanding && company.sharesOutstanding > 0
          ? price * company.sharesOutstanding
          : null
      const ctx = ctxByCompany.get(company.id)
      return {
        company,
        price,
        priceAsOf: mover
          ? (snapshot?.pricesAsOf ?? snapshot?.asOf ?? null)
          : (dbPrice?.asOf.toISOString() ?? null),
        changePct: mover?.changePct ?? null,
        marketCap,
        metrics: {
          p_e: mval(ctx, "p_e"),
          dividend_yield: mval(ctx, "dividend_yield"),
          roe: mval(ctx, "roe"),
          roa: mval(ctx, "roa"),
          net_margin: mval(ctx, "net_margin"),
          eps: mval(ctx, "eps"),
        },
      }
    })

    const passes = (r: Ranked): boolean => {
      const f = filters
      if (f.priceMin !== null && (r.price === null || r.price < f.priceMin)) return false
      if (f.priceMax !== null && (r.price === null || r.price > f.priceMax)) return false
      if (f.changeMin !== null && (r.changePct === null || r.changePct < f.changeMin)) return false
      if (f.changeMax !== null && (r.changePct === null || r.changePct > f.changeMax)) return false
      if (f.peMin !== null && (r.metrics.p_e === null || r.metrics.p_e < f.peMin)) return false
      if (f.peMax !== null && (r.metrics.p_e === null || r.metrics.p_e > f.peMax)) return false
      if (f.dyMin !== null && (r.metrics.dividend_yield === null || r.metrics.dividend_yield < f.dyMin)) return false
      if (f.roeMin !== null && (r.metrics.roe === null || r.metrics.roe < f.roeMin)) return false
      if (f.roeMax !== null && (r.metrics.roe === null || r.metrics.roe > f.roeMax)) return false
      if (f.netMarginMin !== null && (r.metrics.net_margin === null || r.metrics.net_margin < f.netMarginMin)) return false
      if (f.capMin !== null && (r.marketCap === null || r.marketCap < f.capMin)) return false
      if (f.capMax !== null && (r.marketCap === null || r.marketCap > f.capMax)) return false
      return true
    }

    ranked = ranked.filter(passes)

    const dirOf = (defaultDesc: boolean) => (dir ?? (defaultDesc ? "desc" : "asc")) === "desc"
    const cmpNum = (a: number | null, b: number | null, desc: boolean, tieA: string, tieB: string): number => {
      if (a === null && b === null) return tieA.localeCompare(tieB)
      if (a === null) return 1 // nulls last, always
      if (b === null) return -1
      return desc ? b - a || tieA.localeCompare(tieB) : a - b || tieA.localeCompare(tieB)
    }

    const tie = (r: Ranked) => r.company.ticker
    const desc1 = dirOf(true)
    switch (sort) {
      case "marketCap":
        ranked.sort((a, b) => cmpNum(a.marketCap, b.marketCap, dirOf(true), tie(a), tie(b)))
        break
      case "changePct":
        ranked.sort((a, b) => cmpNum(a.changePct, b.changePct, desc1, tie(a), tie(b)))
        break
      case "p_e":
        ranked.sort((a, b) => cmpNum(a.metrics.p_e, b.metrics.p_e, dirOf(false), tie(a), tie(b)))
        break
      case "dividend_yield":
        ranked.sort((a, b) => cmpNum(a.metrics.dividend_yield, b.metrics.dividend_yield, desc1, tie(a), tie(b)))
        break
      case "roe":
        ranked.sort((a, b) => cmpNum(a.metrics.roe, b.metrics.roe, desc1, tie(a), tie(b)))
        break
      case "net_margin":
        ranked.sort((a, b) => cmpNum(a.metrics.net_margin, b.metrics.net_margin, desc1, tie(a), tie(b)))
        break
      case "name":
        ranked.sort((a, b) => (a.company.nameEn ?? "").localeCompare(b.company.nameEn ?? "") * (dirOf(false) ? -1 : 1) || tie(a).localeCompare(tie(b)))
        break
      default:
        ranked.sort((a, b) => tie(a).localeCompare(tie(b)) * (dirOf(false) ? -1 : 1))
    }

    total = ranked.length
  } else if (sort === "marketCap") {
    // The active universe is small (~276). Fetch it, compute market cap from
    // the freshest price × shares, then paginate in memory. This is the only
    // way to sort by a value that is not a stored column.
    const all = await db.company.findMany({
      where,
      orderBy: { ticker: "asc" },
      take: 500,
      include: includeCounts,
    })

    const ids = all.map((c) => c.id)
    // Latest close per company via DISTINCT ON — one row per company (~275)
    // instead of the whole price history (13k+ rows).
    const latestDb = ids.length ? await latestPricesPerCompany(ids) : new Map()

    ranked = all.map((company) => {
      const mover = movers.get(company.ticker.toUpperCase())
      const price = mover?.price ?? latestDb.get(company.id)?.price ?? null
      const marketCap =
        price !== null && company.sharesOutstanding && company.sharesOutstanding > 0
          ? price * company.sharesOutstanding
          : null
      return {
        company,
        price,
        priceAsOf: mover
          ? (snapshot?.pricesAsOf ?? snapshot?.asOf ?? null)
          : (latestDb.get(company.id)?.asOf.toISOString() ?? null),
        changePct: mover?.changePct ?? null,
        marketCap,
        metrics: { p_e: null, dividend_yield: null, roe: null, roa: null, net_margin: null, eps: null },
      }
    })
    ranked.sort((a, b) => {
      if (a.marketCap === null && b.marketCap === null) return a.company.ticker.localeCompare(b.company.ticker)
      if (a.marketCap === null) return 1
      if (b.marketCap === null) return -1
      return b.marketCap - a.marketCap || a.company.ticker.localeCompare(b.company.ticker)
    })
    total = ranked.length
  } else {
    const [count, companies] = await Promise.all([
      db.company.count({ where }),
      db.company.findMany({
        where,
        orderBy: { ticker: "asc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: includeCounts,
      }),
    ])
    total = count
    const latestDb = companies.length
      ? await latestPricesPerCompany(companies.map((c) => c.id))
      : new Map<string, { companyId: string; price: number; asOf: Date }>()
    ranked = companies.map((company) => {
      const mover = movers.get(company.ticker.toUpperCase())
      const dbPrice = latestDb.get(company.id)
      const price = mover?.price ?? dbPrice?.price ?? null
      const marketCap =
        price !== null && company.sharesOutstanding && company.sharesOutstanding > 0
          ? price * company.sharesOutstanding
          : null
      return {
        company,
        price,
        priceAsOf: mover
          ? (snapshot?.pricesAsOf ?? snapshot?.asOf ?? null)
          : (dbPrice?.asOf.toISOString() ?? null),
        changePct: mover?.changePct ?? null,
        marketCap,
        metrics: { p_e: null, dividend_yield: null, roe: null, roa: null, net_margin: null, eps: null },
      }
    })
  }

  const pageCompanies = ranked.slice((page - 1) * pageSize, page * pageSize)
  const ids = pageCompanies.map((r) => r.company.id)

  // Statement snapshot (annual) for the returned page — same as before.
  const [{ filtered: metrics }] = await Promise.all([
    ids.length
      ? fetchCalcMany(ids, {
          periodType: "ANNUAL",
          code: { in: ["revenue", "net_profit", "roe", "total_assets"] },
        })
      : Promise.resolve({ filtered: [] as Awaited<ReturnType<typeof fetchCalcMany>>["filtered"] }),
  ])

  const snapshotMetrics: Record<string, Record<string, { value: number | null; status: string; periodLabel: string; fiscalYear: number }>> = {}
  for (const m of metrics) {
    if (m.valueStatus !== "OK" || m.value === null) continue
    snapshotMetrics[m.companyId] ??= {}
    const existing = snapshotMetrics[m.companyId][m.code]
    if (!existing || m.fiscalYear > existing.fiscalYear) {
      snapshotMetrics[m.companyId][m.code] = {
        value: m.value,
        status: m.valueStatus,
        periodLabel: m.periodLabel,
        fiscalYear: m.fiscalYear,
      }
    }
  }

  return {
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
    sort,
    dir: dir ?? (sort === "ticker" || sort === "name" || sort === "p_e" ? "asc" : "desc"),
    appliedFilters: hasFilters ? filters : undefined,
    marketAsOf: snapshot?.pricesAsOf ?? snapshot?.asOf ?? null,
    delayMinutes: snapshot?.delayMinutes ?? null,
    companies: pageCompanies.map((r) => {
      const c = r.company
      const dbPrice = { asOf: r.priceAsOf }
      const price = r.price
      const mover = movers.get(c.ticker.toUpperCase())
      return {
        id: c.id,
        ticker: c.ticker,
        isin: c.isin,
        nameEn: c.nameEn,
        nameAr: c.nameAr,
        sector: c.sector,
        industry: c.industry,
        listingStatus: c.listingStatus,
        egxCategory: c.egxCategory,
        irUrl: c.irUrl,
        isDemoData: c.isDemoData,
        counts: c._count,
        snapshot: snapshotMetrics[c.id] ?? {},
        metrics: advanced ? r.metrics : undefined,
        marketPrice: price !== null
          ? {
              price,
              asOf: mover ? (snapshot?.pricesAsOf ?? snapshot?.asOf ?? null) : dbPrice.asOf,
              currency: "EGP",
              changePct: r.changePct,
            }
          : null,
        marketCap: r.marketCap,
      }
    }),
  }
}
