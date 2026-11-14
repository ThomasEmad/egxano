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
import {
  adjustedChangePct,
  adjustPrevClose,
  loadSessionActionsByTicker,
  yahooPrevCloseBefore,
  type CorporateActionTerms,
} from "./corporate-actions"

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
  /** scanner `market_cap_basic` when present — real market cap for weighting */
  cap?: number
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
 *
 * `actionsByTicker` — corporate actions whose ex-date equals the session the
 * scanner currently prices (see corporate-actions.ts).
 * `prevCloseByTicker` — the adjusted previous-session close from Yahoo's
 * split-adjusted bars for those same tickers: across an ex-date TradingView's
 * own `change` is unreliable in both directions (CANA: −31.9% unadjusted at
 * the close, then +53.2% with the factor applied twice), so the honest base
 * for action companies is Yahoo's back-adjusted close — the scanner's change
 * field is the FALLBACK (adjusted by our action terms), never the truth.
 */
export function buildSnapshotFromScanner(
  stockRows: ScanRow[],
  indexRows: ScanRow[],
  fetchedAt: string,
  actionsByTicker?: Map<string, CorporateActionTerms[]>,
  prevCloseByTicker?: Map<string, number>,
): { snapshot: MarketSnapshot; movers: SnapshotMoverRow[] } {
  const movers: SnapshotMoverRow[] = []
  for (const row of stockRows) {
    const d = row?.d
    if (!Array.isArray(d)) continue
    const ticker = str(d[0])
    const price = num(d[2])
    const changePct = num(d[3])
    const volume = num(d[4])
    const cap = num(d[6]) // market_cap_basic (added to the column list)
    if (!ticker || price === null || price <= 0 || changePct === null) continue
    const key = ticker.toUpperCase()
    const actions = actionsByTicker?.get(key)
    let realChangePct: number
    const yahooPrev = prevCloseByTicker?.get(key)
    if (actions && actions.length && yahooPrev !== undefined && yahooPrev > 0) {
      // Authoritative path: Yahoo's adjusted prev (current trading units) —
      // only cash/rights still move that base (Yahoo does not adjust for them).
      const cashRights = actions.filter((a) => a.actionType === "cash_dividend" || a.actionType === "rights")
      const base = cashRights.length ? adjustPrevClose(yahooPrev, cashRights) : yahooPrev
      realChangePct = ((price - base) / base) * 100
    } else {
      // Fallback: scanner change with our own ex-date terms divided out.
      realChangePct = adjustedChangePct(price, changePct, actions)
    }
    // The plausibility cap applies to the REAL move (after adjustment), so a
    // 1:1 bonus (−50% raw) reaches the board instead of being discarded.
    if (Math.abs(realChangePct) > 50) continue
    movers.push({
      ticker,
      price,
      changePct: realChangePct,
      ...(volume !== null && volume > 0 ? { volume } : {}),
      ...(cap !== null && cap > 0 ? { cap } : {}),
    })
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
        columns: ["name", "description", "close", "change", "volume", "update_mode", "market_cap_basic", "total_shares_outstanding"],
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
  // Ex-date adjustments for the session the scanner prices (bonus/split/
  // rights/cash): CANA-style mechanical drops must not reach the board. For
  // action companies the previous close comes from Yahoo's adjusted bars
  // (the scanner's change field double-adjusts across ex-dates); Yahoo is
  // best-effort — on failure the scanner math with our action terms applies.
  let actionsByTicker: Map<string, CorporateActionTerms[]> | undefined
  let prevCloseByTicker: Map<string, number> | undefined
  try {
    const loaded = await loadSessionActionsByTicker()
    actionsByTicker = loaded.byTicker
    if (actionsByTicker.size > 0) {
      const exDay = new Date(`${loaded.sessions.latest}T00:00:00.000Z`)
      const tickers = [...actionsByTicker.keys()].slice(0, 8)
      const prevs = await Promise.all(tickers.map((t) => yahooPrevCloseBefore(t, exDay)))
      prevCloseByTicker = new Map()
      for (let i = 0; i < tickers.length; i++) {
        const v = prevs[i]
        if (v !== null && v > 0) prevCloseByTicker.set(tickers[i], v)
      }
    }
  } catch {
    actionsByTicker = undefined // raw change — never fabricated
  }
  const { snapshot, movers } = buildSnapshotFromScanner(stockRows, indexRows, fetchedAt, actionsByTicker, prevCloseByTicker)
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
          // Liquidity columns (market-intelligence upgrade): session share
          // volume and price × volume. Null when the scanner omits volume —
          // never fabricated.
          volume: m.volume ?? null,
          valueTraded: m.volume !== undefined && m.volume > 0 ? m.volume * m.price : null,
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

    // Best-effort: evaluate active price alerts against THIS snapshot and
    // deliver Web Push — the hook that makes alerts fire even when the site
    // is closed (runs on every snapshot write). Dedupe is the evaluator's
    // atomic active→false claim, so the lazy GET path / cron can never
    // double-notify. Failures here never fail the price refresh itself.
    try {
      const { evaluateAndNotifyAllAlerts } = await import("@/lib/alerts/evaluate")
      await evaluateAndNotifyAllAlerts(snapshot)
    } catch (e) {
      console.warn("alert push evaluation failed:", e instanceof Error ? e.message.slice(0, 160) : String(e))
    }

    // Best-effort: rebuild the whole-market intelligence snapshot from the
    // fresh data. Failures here never fail the price refresh itself.
    try {
      const { rebuildIntelligence } = await import("./intelligence/service")
      await rebuildIntelligence()
    } catch {
      // intelligence rebuild is best-effort; the next refresh retries
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
