// Daily OHLCV candle ingestion — unfreezes PriceBar as a durable ~1y history.
//
// Why: the technical bundle previously ran on Yahoo bars pulled on demand
// (memory-only, src/lib/technical/live-bars.ts) while PriceBar stayed frozen
// as an outage fallback. This ingest re-populates PriceBar from the SAME
// Yahoo chart endpoint with the SAME conventions (browser UA, 12s timeout,
// UTC-midnight session mapping), in small admin-triggered chunks.
//
// Adjustment policy: Yahoo's chart bars are split/bonus-adjusted (the `close`
// series reflects current trading units). Bars are stored AS-IS — never
// re-adjusted here. The corporate-actions engine re-adjusts the merged series
// at READ time (see applyCorporateActionAdjustments in
// src/lib/market/corporate-actions.ts), which is idempotent for Yahoo-sourced
// bars.
//
// MarketPrice ownership: today's MarketPrice row belongs to the TradingView
// scanner pipeline (sourceName "TRADINGVIEW_SCANNER"). This ingest never
// writes MarketPrice — see the guard inside the loop.
//
// Server-only (DB + outbound fetch). One chunk = up to 40 companies; callers
// chain chunks via nextCursor until done=true.

import { Prisma } from "@prisma/client"
import { db } from "@/lib/db"

const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36"
const FETCH_TIMEOUT_MS = 12_000
const PACING_MS = 250
/** Per-company retention: keep the newest N trading sessions. */
const KEEP_SESSIONS = 380
const SOURCE_NAME = "YAHOO_CANDLES_1Y"

export interface CandleChunkError {
  ticker: string
  code: string
}

export interface CandleChunkResult {
  processed: number
  succeeded: number
  nextCursor: string | null
  done: boolean
  errors: CandleChunkError[]
}

export interface CandleStorageStats {
  totalBars: number
  /** Companies holding ≥200 stored sessions — a real year of EGX trading is
   * ~250 sessions, so 200+ means "deep history actually present". */
  companiesWith200Plus: number
  oldestBar: string | null
  newestBar: string | null
}

interface IngestBar {
  ts: Date
  open: number
  high: number
  low: number
  close: number
  volume: number | null
}

interface YahooChartJson {
  chart?: {
    result?: Array<{
      meta?: { regularMarketPrice?: number; regularMarketTime?: number }
      timestamp?: number[]
      indicators?: {
        quote?: Array<{
          open?: (number | null)[]
          high?: (number | null)[]
          low?: (number | null)[]
          close?: (number | null)[]
          volume?: (number | null)[]
        }>
      }
    }>
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Fetch + parse the Yahoo chart for one ticker. Returns null on any
 * network/HTTP failure (callers record FETCH_FAILED and move on). */
async function fetchYahooChart(ticker: string): Promise<YahooChartJson["chart"] | null> {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}.CA?range=1y&interval=1d`
    const res = await fetch(url, {
      headers: { "User-Agent": UA },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      cache: "no-store",
    })
    if (!res.ok) return null
    const j = (await res.json()) as YahooChartJson
    return j.chart ?? null
  } catch {
    return null
  }
}

/** Bars with a valid OHLC quadruple only (a bar missing open/high/low is
 * dropped — never partially stored), timestamps mapped to UTC-midnight
 * session dates. volume=null stays null. Empty array when nothing is valid. */
function parseChartBars(chart: NonNullable<YahooChartJson["chart"]>): {
  bars: IngestBar[]
  meta: { regularMarketPrice: number | null; regularMarketTime: number | null }
} {
  const r = chart.result?.[0]
  const ts = r?.timestamp
  const q = r?.indicators?.quote?.[0]
  const bars: IngestBar[] = []
  if (!ts || !q) return { bars, meta: { regularMarketPrice: null, regularMarketTime: null } }
  for (let i = 0; i < ts.length; i++) {
    const o = q.open?.[i]
    const h = q.high?.[i]
    const l = q.low?.[i]
    const c = q.close?.[i]
    // Require the full OHLC quadruple: a null/<=0 close is unusable for any
    // downstream indicator, and close-only rows would corrupt range math.
    if (typeof o !== "number" || typeof h !== "number" || typeof l !== "number" || typeof c !== "number") continue
    if (![o, h, l, c].every((x) => Number.isFinite(x) && x > 0)) continue
    // Daily timestamps are session instants — normalize to UTC midnight so
    // session dates align with every other PriceBar row.
    bars.push({
      ts: new Date(new Date(ts[i] * 1000).toISOString().slice(0, 10) + "T00:00:00Z"),
      open: o,
      high: h,
      low: l,
      close: c,
      volume: typeof q.volume?.[i] === "number" && Number.isFinite(q.volume[i] as number) ? (q.volume[i] as number) : null,
    })
  }
  return {
    bars,
    meta: {
      regularMarketPrice: typeof r?.meta?.regularMarketPrice === "number" ? r.meta.regularMarketPrice : null,
      regularMarketTime: typeof r?.meta?.regularMarketTime === "number" ? r.meta.regularMarketTime : null,
    },
  }
}

/** Bulk upsert one company's bars in a single statement (per-row
 * ON CONFLICT — a re-run of the same session overwrites the old values and
 * keeps sourceName honest). Rows keep their DB defaults for currency (EGP),
 * isDemoData (false) and createdAt; id is generated in SQL because the
 * cuid default is applied by the Prisma client, not the database. */
async function storeBars(companyId: string, bars: IngestBar[]): Promise<void> {
  const rows = bars.map((b) =>
    Prisma.sql`(md5(random()::text), ${companyId}::text, ${b.ts}::timestamp(3), ${b.open}::double precision, ${b.high}::double precision, ${b.low}::double precision, ${b.close}::double precision, ${b.volume}::double precision, ${SOURCE_NAME}::text)`
  )
  await db.$executeRaw`
    INSERT INTO "PriceBar" ("id", "companyId", "ts", "open", "high", "low", "close", "volume", "sourceName")
    VALUES ${Prisma.join(rows)}
    ON CONFLICT ("companyId", "ts") DO UPDATE SET
      "open" = EXCLUDED."open",
      "high" = EXCLUDED."high",
      "low" = EXCLUDED."low",
      "close" = EXCLUDED."close",
      "volume" = EXCLUDED."volume",
      "sourceName" = EXCLUDED."sourceName"
  `
}

/** Retention: keep only the newest KEEP_SESSIONS sessions for one company
 * (rows are unique per (companyId, ts), so no tie-breaking needed). */
async function pruneOldSessions(companyId: string): Promise<number> {
  const boundary = await db.priceBar.findMany({
    where: { companyId },
    orderBy: { ts: "desc" },
    skip: KEEP_SESSIONS,
    take: 1,
    select: { ts: true },
  })
  if (boundary.length === 0) return 0
  return db.priceBar.deleteMany({ where: { companyId, ts: { lte: boundary[0].ts } } }).then((r) => r.count)
}

/**
 * Ingest one chunk of companies (listingStatus LISTED, ordered by id after
 * the cursor). Per-ticker failures are collected and never stop the chunk.
 * Paced between tickers (default PACING_MS) to stay polite to Yahoo.
 * `tickers` narrows the chunk to an explicit retry list (e.g. companies that
 * failed a previous run due to Yahoo 429 rate limits); pacing then defaults
 * higher via the caller.
 */
export async function ingestCandlesChunk(opts?: {
  limit?: number
  cursor?: string
  pacingMs?: number
  tickers?: string[]
}): Promise<CandleChunkResult> {
  const limit = Math.min(Math.max(Math.floor(opts?.limit ?? 25), 1), 40)
  const pacingMs = Math.max(opts?.pacingMs ?? PACING_MS, 0)
  const companies = await db.company.findMany({
    where: {
      listingStatus: "LISTED",
      ...(opts?.cursor ? { id: { gt: opts.cursor } } : {}),
      ...(opts?.tickers?.length ? { ticker: { in: opts.tickers } } : {}),
    },
    orderBy: { id: "asc" },
    take: limit,
    select: { id: true, ticker: true },
  })

  let succeeded = 0
  const errors: CandleChunkError[] = []

  for (let i = 0; i < companies.length; i++) {
    const co = companies[i]
    if (i > 0) await sleep(pacingMs)
    try {
      const chart = await fetchYahooChart(co.ticker)
      if (!chart) {
        errors.push({ ticker: co.ticker, code: "FETCH_FAILED" })
        continue
      }
      const { bars, meta } = parseChartBars(chart)
      if (bars.length === 0) {
        errors.push({ ticker: co.ticker, code: "NO_BARS" })
        continue
      }

      // --- MarketPrice ownership guard ------------------------------------
      // Yahoo's meta carries regularMarketPrice (the latest session price).
      // When meta reports a price for TODAY and no MarketPrice row exists for
      // today with sourceName "TRADINGVIEW_SCANNER", that empty gap is the
      // tempting one to fill from this same fetch — and it is DELIBERATELY
      // left empty: the TradingView scanner owns today's MarketPrice, and a
      // second writer would create conflicting same-session price points.
      // Whatever the check finds, NOTHING is written to MarketPrice here;
      // the scanner's next refresh owns that insert.
      const todayISO = new Date().toISOString().slice(0, 10)
      const metaDayISO = meta.regularMarketTime
        ? new Date(meta.regularMarketTime * 1000).toISOString().slice(0, 10)
        : null
      if (meta.regularMarketPrice !== null && meta.regularMarketPrice > 0 && metaDayISO === todayISO) {
        const dayStart = new Date(`${todayISO}T00:00:00Z`)
        await db.marketPrice.findFirst({
          where: {
            companyId: co.id,
            sourceName: "TRADINGVIEW_SCANNER",
            asOf: { gte: dayStart, lt: new Date(dayStart.getTime() + 86_400_000) },
          },
          select: { id: true },
        })
        // No write in either branch — skip. Scanner owns MarketPrice.
      }

      await storeBars(co.id, bars)
      await pruneOldSessions(co.id)
      succeeded++
    } catch {
      errors.push({ ticker: co.ticker, code: "STORE_FAILED" })
    }
  }

  const last = companies.length > 0 ? companies[companies.length - 1] : null
  return {
    processed: companies.length,
    succeeded,
    nextCursor: last ? last.id : null,
    done: companies.length < limit || (!opts?.cursor && !opts?.tickers && companies.length === 0),
    errors,
  }
}

/** Table-level storage facts for the admin panel (cheap aggregates). */
export async function getCandleStorageStats(): Promise<CandleStorageStats> {
  const [totalBars, groups, oldest, newest] = await Promise.all([
    db.priceBar.count(),
    db.priceBar.groupBy({ by: ["companyId"], _count: { _all: true } }),
    db.priceBar.findFirst({ orderBy: { ts: "asc" }, select: { ts: true } }),
    db.priceBar.findFirst({ orderBy: { ts: "desc" }, select: { ts: true } }),
  ])
  return {
    totalBars,
    companiesWith200Plus: groups.filter((g) => g._count._all >= 200).length,
    oldestBar: oldest ? oldest.ts.toISOString() : null,
    newestBar: newest ? newest.ts.toISOString() : null,
  }
}
