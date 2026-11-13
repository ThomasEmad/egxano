// =============================================================================
// Market-wide technical signals service — DB plumbing around the pure
// close-based signal engine (src/lib/technical/signals.ts).
//
// Data source: MarketPrice day-rows (one row per company per UTC day, from the
// public TradingView EGX scanner pull) + PriceBar deep history. Close-only
// bars are the SAME documented precedent the per-company technical engine uses
// for its freshest sessions — here they are the whole input, and that
// limitation is disclosed on every response rather than hidden. Nothing is
// written to the DB.
//
// Corporate-action continuity: the board computes its own changePct from the
// merged series (last vs prior close), so bonus/split/cash ex-dates inside the
// window are rebuilt through applyCorporateActionAdjustments() — the SAME
// engine the per-company technical bundle uses — before any indicator runs.
// Without this pass an ex-date shows up as a fake cliff (CANA 2026-11-12:
// −31.9% displayed for a real ≈ +2% session) and poisons every reading.
//
// Cost shape: ~250 active companies × a 420-calendar-day trailing window —
// one cached pass every 10 minutes (prices move intraday, the stance follows).
// Actions ride ONE batched query for the whole universe (see loadSeriesActionsByCompany).
// =============================================================================

import { db } from "@/lib/db"
import { cached } from "@/lib/server-cache"
import { applyCorporateActionAdjustments, loadSeriesActionsByCompany, type SeriesBar } from "@/lib/market/corporate-actions"
import { computeCloseSignal, SIGNALS_VERSION, type CloseSignalOutput } from "./signals"

/** Calendar-day cutoff for the trailing window (~280 sessions where history exists). */
const WINDOW_DAYS = 420
const CACHE_MS = 10 * 60_000

export interface MarketSignalRow extends CloseSignalOutput {
  companyId: string
  ticker: string
  nameEn: string
  nameAr: string | null
  sector: string
  /** EGX30 | EGX70 | MAIN | NILEX | OTC (see src/lib/market/tiers.ts) */
  marketTier: string
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
  /** % of scored companies whose price sits above EMA20 — technical breadth */
  pctAboveEma20: number | null
  rows: MarketSignalRow[]
  computedAt: string
}

async function buildMarketSignalsUncached(): Promise<MarketSignalsOutput> {
  const companies = await db.company.findMany({
    where: { isActive: true },
    select: { id: true, ticker: true, nameEn: true, nameAr: true, sector: true, marketTier: true },
    orderBy: { ticker: "asc" },
  })

  const cutoff = new Date(Date.now() - WINDOW_DAYS * 86_400_000)
  const ids = companies.map((c) => c.id)

  // Source 1 — PriceBar: the deep stored history.
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

  // BATCHED action load: one pass over the whole universe (2 indexed queries),
  // replacing the per-company lookups that made the cold compute pay ~500 DB
  // round trips and blew the function timeout on the new deployment.
  const allSeries: { companyId: string; firstTs: string; lastTs: string }[] = []
  for (const [companyId, byDay] of byDayAll) {
    const days = [...byDay.keys()]
    if (days.length >= 2 && days.length === byDay.size) {
      allSeries.push({ companyId, firstTs: days[0], lastTs: days[days.length - 1] })
    }
  }
  const actionsByCompany =
    allSeries.length > 0
      ? await loadSeriesActionsByCompany(
          allSeries.map((s) => s.companyId),
          allSeries.reduce((min, s) => (s.firstTs < min ? s.firstTs : min), allSeries[0].firstTs),
          allSeries.reduce((max, s) => (s.lastTs > max ? s.lastTs : max), allSeries[0].lastTs)
        )
      : new Map()

  for (const [companyId, byDay] of byDayAll) {
    const c = companyById.get(companyId)
    if (!c) continue
    for (const day of byDay.keys()) {
      if (!pricedAsOf || day > pricedAsOf) pricedAsOf = day
    }
    let series = [...byDay.values()].sort((a, b) => a.ts.localeCompare(b.ts))

    // Corporate-action continuity over the merged series (best-effort): the
    // close-only rows become flat bars, the shared adjustment engine rescales
    // every session before the first ex-date, and the resulting series is
    // continuous across bonus/split/cash events — so the board's own
    // changePct and every indicator read the REAL market move.
    try {
      if (series.length >= 2) {
        const actions = actionsByCompany.get(companyId) ?? []
        if (actions.length > 0) {
          const bars: SeriesBar[] = series.map((r) => ({
            ts: r.ts,
            open: r.close,
            high: r.close,
            low: r.close,
            close: r.close,
            volume: r.volume,
            source: "scanner", // PriceBar/scanner rows are RAW prices (documented)
          }))
          const adjusted = applyCorporateActionAdjustments(bars, actions)
          series = adjusted.bars.map((b) => ({ ts: b.ts, close: b.close, volume: b.volume }))
        }
      }
    } catch {
      // Adjustment is best-effort — the raw series remains the honest fallback.
    }

    const sig = computeCloseSignal(series)
    rows.push({
      ...sig,
      companyId,
      ticker: c.ticker,
      nameEn: c.nameEn,
      nameAr: c.nameAr,
      sector: c.sector,
      marketTier: (c as { marketTier?: string }).marketTier ?? "MAIN",
    })
    if (sig.signal === null) weakData++
  }

  const distribution = { buy: 0, hold: 0, sell: 0 }
  let aboveEma20 = 0
  let ema20Count = 0
  for (const r of rows) {
    if (r.signal) distribution[r.signal]++
    if (r.metrics.ema20 !== null && r.lastClose !== null) {
      ema20Count++
      if (r.lastClose > r.metrics.ema20) aboveEma20++
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
    pctAboveEma20: ema20Count > 0 ? Math.round((aboveEma20 / ema20Count) * 1000) / 10 : null,
    rows,
    computedAt: new Date().toISOString(),
  }
}

/** Cached whole-market signal computation (10 min — follows the intraday price refresh). */
export function getCachedMarketSignals(): Promise<MarketSignalsOutput> {
  // v2: adjusted series (corporate actions) + EMA metrics + marketTier —
  // the bump invalidates any stale v1 board payload still in memory.
  return cached("technical-signals:market:v2", CACHE_MS, () => buildMarketSignalsUncached())
}
