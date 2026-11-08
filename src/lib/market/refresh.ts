// =============================================================================
// Market refresh — pull fresh prices from the public TradingView EGX scanner
// and persist them where serverless reads survive: the DATABASE.
// =============================================================================
// Why this exists: the classic refresher (scripts/refresh-market-snapshot.mjs)
// writes `public/data/market-ticker.json` — a FILE. On Vercel the function
// filesystem is ephemeral, so file-only refreshes never reached production
// readers and prices went stale until the next deploy. This module writes the
// exact same snapshot shape into the `Setting` table (key
// `market_ticker_snapshot_v1`) and upserts one `MarketPrice` row per company
// per UTC day (sourceName TRADINGVIEW_SCANNER, replacing only our own rows of
// the same day, so repeated intraday runs never bloat the table).
//
// Triggers:
//   * GET /api/v1/cron/market  — external scheduler with Bearer CRON_SECRET
//   * opportunistic kick from getFreshMarketSnapshot() when the best known
//     snapshot is >20 min stale inside the EGX session window (via after())
//   * chained at the tail of the daily audit cron (guaranteed daily refresh)
//
// Source: the same authorized public TradingView EGX scanner used by every
// other market import in this project (15-minute delayed, no paywall bypass).

import { db } from "@/lib/db"
import type { MarketSnapshot } from "./snapshot"

const SCANNER = "https://scanner.tradingview.com/egypt/scan"
const SCANNER_SOURCE = "TRADINGVIEW_SCANNER"
const FETCH_TIMEOUT_MS = 20_000

export const MARKET_SNAPSHOT_SETTING_KEY = "market_ticker_snapshot_v1"

const INDICES = [
  { symbol: "EGX:EGX30", name: "EGX30" },
  { symbol: "EGX:EGX70EWI", name: "EGX70 EWI" },
  { symbol: "EGX:EGX100EWI", name: "EGX100 EWI" },
  { symbol: "EGX:EGX30CAPPED", name: "EGX30CAPPED" },
]

/** One scanner row: `s` = symbol/ticker, `d` = column values. */
export interface ScanRow {
  s?: string
  d: unknown[]
}

export interface SnapshotMoverRow {
  ticker: string
  price: number
  changePct: number
  volume?: number
}

export interface MarketRefreshSummary {
  ok: boolean
  asOf?: string
  indices?: number
  pricesWritten?: number
  matched?: number
  reason?: "scanner-failed" | "scanner-empty" | "db-failed"
  error?: string
}

async function scan(body: Record<string, unknown>): Promise<ScanRow[]> {
  const res = await fetch(SCANNER, {
    method: "POST",
    headers: { "content-type": "application/json", "user-agent": "Mozilla/5.0" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    cache: "no-store",
  })
  if (!res.ok) throw new Error(`scanner HTTP ${res.status}`)
  const json = (await res.json()) as { data?: ScanRow[] }
  return Array.isArray(json.data) ? json.data : []
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : null
}

/**
 * Pure: scanner rows -> validated snapshot + per-company price rows.
 * Validation mirrors scripts/refresh-market-snapshot.mjs exactly.
 */
export function buildSnapshotFromScanner(
  stockRows: ScanRow[],
  indexRows: ScanRow[],
  fetchedAt: string,
): { snapshot: MarketSnapshot; movers: SnapshotMoverRow[] } {
  const movers: SnapshotMoverRow[] = []
  for (const row of stockRows) {
    const d = row?.d
    if (!Array.isArray(d)) continue
    const ticker = str(d[0])
    const price = num(d[2])
    const changePct = num(d[3])
    const volume = num(d[4])
    if (!ticker || price === null || price <= 0 || changePct === null || Math.abs(changePct) > 50) continue
    movers.push({ ticker, price, changePct, ...(volume !== null && volume > 0 ? { volume } : {}) })
  }

  const indexBySymbol = new Map(indexRows.map((r) => [r.s, r.d]))
  const indices = INDICES.map((i) => {
    const d = indexBySymbol.get(i.symbol)
    if (!Array.isArray(d)) return null
    const level = num(d[2])
    const changePct = num(d[3])
    return level !== null && changePct !== null ? { name: i.name, level, changePct } : null
  }).filter((v): v is { name: string; level: number; changePct: number } => v !== null)

  const snapshot: MarketSnapshot = {
    asOf: fetchedAt,
    indicesAsOf: fetchedAt,
    pricesAsOf: fetchedAt,
    delayMinutes: 15,
    indices,
    movers,
  }
  return { snapshot, movers }
}

/** UTC midnight of the given ISO timestamp (day bucket for MarketPrice rows). */
export function startOfUtcDay(iso: string): string {
  const d = new Date(iso)
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())).toISOString()
}

let inFlight: Promise<MarketRefreshSummary> | null = null

/**
 * Fetch the scanner and persist (Setting snapshot + MarketPrice day-rows) in
 * one transaction. Concurrent callers share the same in-flight promise.
 */
export async function refreshMarketSnapshot(): Promise<MarketRefreshSummary> {
  if (inFlight) return inFlight
  inFlight = runRefresh().finally(() => {
    inFlight = null
  })
  return inFlight
}

async function runRefresh(): Promise<MarketRefreshSummary> {
  let stockRows: ScanRow[]
  let indexRows: ScanRow[]
  try {
    ;[stockRows, indexRows] = await Promise.all([
      scan({
        filter: [{ left: "exchange", operation: "equal", right: "EGX" }],
        options: { lang: "en" },
        markets: ["egypt"],
        symbols: { query: { types: [] }, tickers: [] },
        columns: ["name", "description", "close", "change", "volume", "update_mode"],
        sort: { sortBy: "name", sortOrder: "asc" },
        range: [0, 1000],
      }),
      scan({
        symbols: { tickers: INDICES.map((i) => i.symbol), query: { types: [] } },
        columns: ["name", "description", "close", "change", "update_mode"],
      }),
    ])
  } catch (e) {
    return { ok: false, reason: "scanner-failed", error: e instanceof Error ? e.message.slice(0, 200) : String(e) }
  }

  const fetchedAt = new Date().toISOString()
  const { snapshot, movers } = buildSnapshotFromScanner(stockRows, indexRows, fetchedAt)
  if (movers.length === 0 && snapshot.indices.length === 0) {
    // Never wipe a good snapshot with an empty scanner answer.
    return { ok: false, reason: "scanner-empty" }
  }

  try {
    const tickers = [...new Set(movers.map((m) => m.ticker.toUpperCase()))]
    const companies = await db.company.findMany({
      where: { ticker: { in: tickers }, isActive: true },
      select: { id: true, ticker: true },
    })
    const idByTicker = new Map(companies.map((c) => [c.ticker.toUpperCase(), c.id]))

    // Minute-truncated timestamp, same convention as import-tradingview-market.
    const asOf = new Date(fetchedAt)
    asOf.setSeconds(0, 0)
    const dayStart = new Date(startOfUtcDay(asOf.toISOString()))
    const notes = `TradingView public scanner (delayed); fetched ${asOf.toISOString()}`

    const rows = movers
      .map((m) => {
        const companyId = idByTicker.get(m.ticker.toUpperCase())
        if (!companyId) return null
        return {
          companyId,
          asOf,
          price: m.price,
          currency: "EGP",
          sourceName: SCANNER_SOURCE,
          isDemoData: false,
          notes,
        }
      })
      .filter((r): r is NonNullable<typeof r> => r !== null)

    await db.$transaction([
      db.setting.upsert({
        where: { key: MARKET_SNAPSHOT_SETTING_KEY },
        update: { value: JSON.stringify(snapshot), type: "json" },
        create: {
          key: MARKET_SNAPSHOT_SETTING_KEY,
          value: JSON.stringify(snapshot),
          type: "json",
          description: "Latest market snapshot from the public TradingView EGX scanner (written by /api/v1/cron/market)",
        },
      }),
      // Replace only TODAY's TRADINGVIEW_SCANNER rows for matched companies —
      // other sources and older days are never touched.
      db.marketPrice.deleteMany({
        where: { companyId: { in: companies.map((c) => c.id) }, sourceName: SCANNER_SOURCE, asOf: { gte: dayStart } },
      }),
      db.marketPrice.createMany({ data: rows, skipDuplicates: true }),
    ])

    // Best-effort: drop hot-path caches so fresh prices are visible at once.
    try {
      const { invalidateServerCache } = await import("@/lib/server-cache")
      invalidateServerCache()
    } catch {
      // cache module unavailable in some runtimes — reads still self-heal via TTLs
    }

    return {
      ok: true,
      asOf: snapshot.asOf ?? undefined,
      indices: snapshot.indices.length,
      pricesWritten: rows.length,
      matched: companies.length,
    }
  } catch (e) {
    return { ok: false, reason: "db-failed", error: e instanceof Error ? e.message.slice(0, 200) : String(e) }
  }
}
