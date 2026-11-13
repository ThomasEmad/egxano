// =============================================================================
// Market-wide technical signals service — DB plumbing around the pure
// close-based signal engine (src/lib/technical/signals.ts).
//
// Data source: MarketPrice day-rows (one row per company per UTC day, from the
// public TradingView EGX scanner pull). Close-only bars are the SAME documented
// precedent the per-company technical engine uses for its freshest sessions —
// here they are the whole input, and that limitation is disclosed on every
// response rather than hidden. Nothing is written to the DB.
//
// Cost shape: ~250 active companies × ~120 trailing day-rows ≈ 30k rows — one
// cached pass every 10 minutes (prices move intraday, the stance follows).
// =============================================================================

import { db } from "@/lib/db"
import { cached } from "@/lib/server-cache"
import { computeCloseSignal, SIGNALS_VERSION, type CloseSignalOutput, type TechSignalType } from "./signals"

/** Calendar-day cutoff for the trailing window (~120 sessions comfortably covers 80+). */
const WINDOW_DAYS = 180
const CACHE_MS = 10 * 60_000

export interface MarketSignalRow extends CloseSignalOutput {
  companyId: string
  ticker: string
  nameEn: string
  nameAr: string | null
  sector: string
}

export interface MarketSignalsOutput {
  version: string
  asOf: string | null
  /** freshest session date used across the universe */
  pricedAsOf: string | null
  universe: number
  scored: number
  weakData: number
  distribution: { buy: number; hold: number; sell: number }
  /** % of scored companies whose price sits above SMA20 — the technical breadth line */
  pctAboveSma20: number | null
  rows: MarketSignalRow[]
  computedAt: string
}

async function buildMarketSignalsUncached(): Promise<MarketSignalsOutput> {
  const companies = await db.company.findMany({
    where: { isActive: true },
    select: { id: true, ticker: true, nameEn: true, nameAr: true, sector: true },
    orderBy: { ticker: "asc" },
  })

  const cutoff = new Date(Date.now() - WINDOW_DAYS * 86_400_000)
  const ids = companies.map((c) => c.id)

  // Source 1 — PriceBar: the deep stored history (~80 sessions per name).
  // Source 2 — MarketPrice day-rows: the freshest scanner sessions (the
  // intraday refreshes rewrite the same UTC day). Precedence mirrors
  // buildTechnicalBundle: the scanner day-row WINS for its day (it carries the
  // latest recorded price), PriceBar fills the deep history behind it.
  const [barRows, priceRows] = await Promise.all([
    ids.length
      ? db.priceBar.findMany({
          where: { companyId: { in: ids }, ts: { gte: cutoff } },
          orderBy: { ts: "asc" },
          select: { companyId: true, ts: true, close: true, volume: true },
        })
      : Promise.resolve([] as { companyId: string; ts: Date; close: number; volume: number | null }[]),
    ids.length
      ? db.marketPrice.findMany({
          where: { companyId: { in: ids }, sourceName: "TRADINGVIEW_SCANNER", isDemoData: false, asOf: { gte: cutoff }, price: { gt: 0 } },
          orderBy: { asOf: "asc" },
          select: { companyId: true, asOf: true, price: true, volume: true },
        })
      : Promise.resolve([] as { companyId: string; asOf: Date; price: number; volume: number | null }[]),
  ])

  // Day-bucket per company: PriceBar first, then MarketPrice overlays its days.
  const byDayAll = new Map<string, Map<string, { ts: string; close: number; volume: number | null }>>()
  for (const b of barRows) {
    let m = byDayAll.get(b.companyId)
    if (!m) { m = new Map(); byDayAll.set(b.companyId, m) }
    const day = b.ts.toISOString().slice(0, 10)
    m.set(day, { ts: day, close: b.close, volume: b.volume !== null && Number.isFinite(b.volume) && b.volume > 0 ? b.volume : null })
  }
  for (const r of priceRows) {
    let m = byDayAll.get(r.companyId)
    if (!m) { m = new Map(); byDayAll.set(r.companyId, m) }
    const day = r.asOf.toISOString().slice(0, 10)
    m.set(day, { ts: day, close: r.price, volume: r.volume !== null && Number.isFinite(r.volume) && r.volume > 0 ? r.volume : null })
  }
  const companyById = new Map(companies.map((c) => [c.id, c]))

  const rows: MarketSignalRow[] = []
  let weakData = 0
  let pricedAsOf: string | null = null

  for (const [companyId, byDay] of byDayAll) {
    const c = companyById.get(companyId)
    if (!c) continue
    for (const day of byDay.keys()) {
      if (!pricedAsOf || day > pricedAsOf) pricedAsOf = day
    }
    const series = [...byDay.values()].sort((a, b) => a.ts.localeCompare(b.ts))
    const sig = computeCloseSignal(series)
    rows.push({
      ...sig,
      companyId,
      ticker: c.ticker,
      nameEn: c.nameEn,
      nameAr: c.nameAr,
      sector: c.sector,
    })
    if (sig.signal === null) weakData++
  }

  const distribution = { buy: 0, hold: 0, sell: 0 }
  let aboveSma20 = 0
  let sma20Count = 0
  for (const r of rows) {
    if (r.signal) distribution[r.signal]++
    if (r.metrics.sma20 !== null && r.lastClose !== null) {
      sma20Count++
      if (r.lastClose > r.metrics.sma20) aboveSma20++
    }
    if (!r.asOf) continue
  }

  rows.sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || a.ticker.localeCompare(b.ticker))

  return {
    version: SIGNALS_VERSION,
    asOf: pricedAsOf,
    pricedAsOf,
    universe: companies.length,
    scored: rows.length - weakData,
    weakData,
    distribution,
    pctAboveSma20: sma20Count > 0 ? Math.round((aboveSma20 / sma20Count) * 1000) / 10 : null,
    rows,
    computedAt: new Date().toISOString(),
  }
}

/** Cached whole-market signal computation (10 min — follows the intraday price refresh). */
export function getCachedMarketSignals(): Promise<MarketSignalsOutput> {
  return cached("technical-signals:market", CACHE_MS, () => buildMarketSignalsUncached())
}
