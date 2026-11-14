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
import { effectiveEgxSessionDate } from "@/lib/market/egx-session"
import { computeCloseSignal, SIGNALS_VERSION, type CloseSignalOutput, type TechStance } from "./signals"
import { readCanonicalStance, BOARD_MAX_AGE_MS, STANCE_ENGINE_VERSION } from "./stance-store"
import { persistBoardSnapshot } from "./board-snapshot"

/** Calendar-day cutoff for the trailing window. 300 days ≈ 200 EGX sessions —
 *  still ≥3× the longest indicator window (rangePos60) with corporate-action
 *  margin, and ~30% less DB egress on every cold compute. */
const WINDOW_DAYS = 300
const CACHE_MS = 10 * 60_000

export interface MarketSignalRow extends CloseSignalOutput {
  companyId: string
  ticker: string
  nameEn: string
  nameAr: string | null
  sector: string
  /** EGX30 | EGX70 | MAIN | OTC (see src/lib/market/tiers.ts) */
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
  /** rows whose displayed reading comes from the persisted canonical stance */
  canonicalCount?: number
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
    // EGX session anchoring (2026-11-14 audit): Fri/Sat quotes restate the
    // previous close — anchor them onto the session they belong to instead of
    // minting a phantom weekend session. Never clobber an existing close for
    // the anchored day (the real session bar stays authoritative).
    const rawDay = r.asOf.toISOString().slice(0, 10)
    const day = effectiveEgxSessionDate(r.asOf)
    if (day !== rawDay && m.has(day)) continue
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

  // ---- CANONICAL STANCE OVERLAY (single source of truth, 2026-11-14) ----
  // The close-only engine's own trade plan came from a DIFFERENT level source
  // than the company technical tab (close-based S/R vs OHLC zones) — the same
  // stock showed two different stop-losses on two pages. Every row that has a
  // persisted canonical stance now displays THAT reading (identical to the
  // company tab, same levels, same invalidation). Rows without one keep the
  // close-based READ but never show levels (no plan, no invalidation) — one
  // stock, one analysis, everywhere.
  //
  // DEGRADE, NEVER BLANK: if the snapshot store is unavailable (e.g. the
  // additive bootstrap DDL failed on a locked-down DB user), the board still
  // serves the close-based readings with levels withheld — an outage in the
  // overlay must never 500 the whole board again (2026-11-14 post-deploy fix).
  let canonicalCount = 0
  try {
    const canonicalRows = await db.stanceSnapshot.findMany({
      where: { company: { isActive: true } },
      select: { companyId: true, stanceJson: true, dataAsOf: true, computedAt: true, engineVersion: true },
    })
    const canonicalByCompany = new Map(
      canonicalRows
        .filter((s) => s.engineVersion === STANCE_ENGINE_VERSION && Date.now() - s.computedAt.getTime() <= BOARD_MAX_AGE_MS)
        .map((s) => {
          try {
            return [s.companyId, { stance: JSON.parse(s.stanceJson) as TechStance, dataAsOf: s.dataAsOf }]
          } catch {
            return [s.companyId, null]
          }
        })
        .filter(([, v]) => v !== null) as [string, { stance: TechStance; dataAsOf: Date }][],
    )
    for (const row of rows) {
      const canonical = canonicalByCompany.get(row.companyId)
      if (canonical) {
        canonicalCount++
        row.score = canonical.stance.score
        row.signal = canonical.stance.signal
        row.dimensions = canonical.stance.dimensions
        row.reasons = canonical.stance.reasons
        row.styleFits = canonical.stance.styleFits
        row.invalidation = canonical.stance.invalidation
        row.tradePlan = canonical.stance.tradePlan
        row.limitations = canonical.stance.limitations
      } else {
        // No canonical bundle (no candles / too few sessions): the close-based
        // reading stays, but LEVELS are withheld everywhere for consistency.
        row.tradePlan = null
        row.invalidation = null
      }
    }
  } catch (e) {
    console.error(
      "stance overlay unavailable — serving close-based rows without levels:",
      e instanceof Error ? e.message.slice(0, 200) : e,
    )
    for (const row of rows) {
      row.tradePlan = null
      row.invalidation = null
    }
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
    canonicalCount,
    distribution,
    pctAboveEma20: ema20Count > 0 ? Math.round((aboveEma20 / ema20Count) * 1000) / 10 : null,
    rows,
    computedAt: new Date().toISOString(),
  }
}

/** Cached whole-market signal computation (10 min — follows the intraday price refresh). */
export function getCachedMarketSignals(): Promise<MarketSignalsOutput> {
  // v3: tier model changed — NILEX merged into MAIN, OTC activity sweep,
  // fresh EGX30 constituents + free-tier board gating copy. The bump
  // invalidates stale v2 payloads whose tier labels/copy no longer match.
  return cached("technical-signals:market:v3", CACHE_MS, async () => {
    const payload = await buildMarketSignalsUncached()
    // Shared read model: every successful compute persists the payload so a
    // cold instance can serve instantly (write-behind — never fails the board).
    void persistBoardSnapshot(payload)
    return payload
  })
}

// =============================================================================
// Gated row shape for FREE callers — identity + public market price ONLY.
// The paid analysis (signal, score, dimensions, reasons, styleFits, metrics,
// trade plan) is removed server-side before serialization and never reaches
// the browser, the network response, or any client state.
// =============================================================================
export interface GatedSignalRow {
  companyId: string
  ticker: string
  nameEn: string
  nameAr: string | null
  sector: string
  marketTier: string
  lastClose: number | null
  changePct: number | null
  asOf: string | null
  locked: true
}

export type BoardRow = MarketSignalRow | GatedSignalRow

export interface BoardMatchedCounts {
  buy: number
  hold: number
  sell: number
  weak: number
  total: number
}

/** The route's response shape: full rows for paid callers, gated rows for free. */
export interface MarketSignalsResponse extends Omit<MarketSignalsOutput, "rows"> {
  rows: BoardRow[]
  /** distribution over the FILTERED set (true filter counts for every tier) */
  matched?: BoardMatchedCounts
  /** aggregate per-tier counts over the FILTERED set */
  tiers?: Record<string, number>
  /** aggregate per-style-tag counts over the FILTERED set */
  styles?: Record<string, number>
  /** locked identity rows omitted by the free slice cap */
  lockedRemaining?: number
  plan?: string
  upgradeHint?: { message: string; freeSetSize: number } | null
  hiddenCompanies?: number
  missingFreeTickers?: string[]
}
