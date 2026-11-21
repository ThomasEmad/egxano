// =============================================================================
// candle-refresh.ts — the daily refresh of the UNIFIED candle store
// (owner same-source mandate 2026-11-21). Replaces the old PriceBar
// ingestion chunk-for-chunk: same external contract (limit + companyId
// cursor → nextCursor/done), same GitHub-Actions chaining, but the rows land
// in MarketCandle (quality-gated, TradingView-reconciled) instead of the
// retention-capped PriceBar.
// =============================================================================

import { db } from "@/infrastructure/db"
import { fetchYahooHistory, fetchTradingViewQuotesSafe } from "@/infrastructure/market/candle-source"
import { cairoToday, lastExpectedSession, validateCandleSet } from "@/domain/market/candles/quality"

export interface RefreshChunkResult {
  processed: number
  succeeded: number
  nextCursor: string | null
  done: boolean
  errors: { ticker: string; error: string }[]
  reconciliationFailed: number
}

const CONCURRENCY = 4

/**
 * Refresh ONE chunk of companies (ordered by companyId, `cursor` = the last
 * processed companyId or null for the head). Per company:
 *   1. fetch the current-year daily window from the resolved Yahoo symbol
 *      (one request — the symbol resolution is cached in MarketCandleSource),
 *   2. validate through candle-quality (row rules + overnight guard),
 *   3. reconcile the newest session's close against the TradingView scanner
 *      quote (when the newest candle IS the expected session) — a deviation
 *      beyond the tolerance means the series is NOT replaced (alarm recorded),
 *   4. replace the recent REFRESH_WINDOW_DAYS window in MarketCandle.
 *
 * History written by the backfill stays untouched — the refresh only ever
 * rewrites the recent window, so a transient bad fetch can never erase it.
 */
export async function refreshMarketCandlesChunk(opts: { limit?: number; cursor?: string } = {}): Promise<RefreshChunkResult> {
  const limit = Math.min(Math.max(Math.floor(opts.limit ?? 40), 1), 40)
  const sources = await db.marketCandleSource.findMany({
    where: { via: { not: "none" }, ...(opts.cursor ? { companyId: { gt: opts.cursor } } : {}) },
    orderBy: { companyId: "asc" },
    take: limit,
    select: { companyId: true, yahooSymbol: true, company: { select: { ticker: true } } },
  })

  const tvQuotes = await fetchTradingViewQuotesSafe().catch(() => new Map<string, { close: number; volume: number | null }>())
  const expectedSession = lastExpectedSession(cairoToday())
  const windowStart = new Date(Date.now() - REFRESH_WINDOW_DAYS * 86_400_000)
  const windowStartISO = windowStart.toISOString().slice(0, 10)

  const errors: { ticker: string; error: string }[] = []
  let succeeded = 0
  let reconciliationFailed = 0
  let idx = 0

  const runOne = async (s: { companyId: string; yahooSymbol: string; company: { ticker: string } }) => {
    try {
      const hist = await fetchYahooHistory(s.company.ticker, "max", s.yahooSymbol, new Date().getUTCFullYear(), true)
      const newest = hist.candles[hist.candles.length - 1]
      const tvClose = tvQuotes.get(s.company.ticker.toUpperCase())?.close ?? null
      const reconcile =
        tvClose !== null && newest && newest.date === expectedSession && newest.close !== null
          ? { source: "tradingview-scanner", expectedClose: tvClose, actualClose: newest.close }
          : null
      const report = validateCandleSet(s.company.ticker, hist.candles, { reconciliation: reconcile })
      if (report.reconciliation && !report.reconciliation.passed) {
        reconciliationFailed++
        errors.push({ ticker: s.company.ticker, error: `reconciliation ${report.reconciliation.deviationPct.toFixed(2)}% — rows NOT replaced (alarm, audit)` })
        await db.marketCandleSource.updateMany({
          where: { companyId: s.companyId },
          data: { lastFetchAt: new Date(), lastError: `reconciliation ${report.reconciliation.deviationPct.toFixed(2)}%` },
        })
        return
      }
      const rows = report.verified
        .filter((v) => v.date >= windowStartISO)
        .map((v) => ({
          companyId: s.companyId,
          tradeDate: new Date(`${v.date}T00:00:00Z`),
          open: v.open,
          high: v.high,
          low: v.low,
          close: v.close,
          volume: v.volume,
          sourceName: "YAHOO_EGX_FULL",
          verified: true,
        }))
      await db.$transaction(async (tx) => {
        await tx.marketCandle.deleteMany({ where: { companyId: s.companyId, tradeDate: { gte: windowStart } } })
        await tx.marketCandle.createMany({ data: rows })
      })
      succeeded++
      await db.marketCandleSource.updateMany({
        where: { companyId: s.companyId },
        data: { lastFetchAt: new Date(), lastError: null },
      })
    } catch (err) {
      const msg = String((err as Error).message ?? err).slice(0, 240)
      errors.push({ ticker: s.company.ticker, error: msg })
      await db.marketCandleSource.updateMany({
        where: { companyId: s.companyId },
        data: { lastFetchAt: new Date(), lastError: msg },
      }).catch(() => {})
    }
  }

  const worker = async () => {
    while (idx < sources.length) {
      const s = sources[idx++]
      if (!s) break
      await runOne(s)
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker))

  const last = sources[sources.length - 1]
  return {
    processed: sources.length,
    succeeded,
    nextCursor: last?.companyId ?? null,
    done: sources.length < limit,
    errors,
    reconciliationFailed,
  }
}

/** Table-level storage facts for the admin panel / cron diagnostics. */
export async function getMarketCandleStorageStats() {
  const [totalBars, verifiedBars, groups, newest] = await Promise.all([
    db.marketCandle.count(),
    db.marketCandle.count({ where: { verified: true } }),
    db.marketCandle.groupBy({ by: ["companyId"], where: { verified: true }, _count: { _all: true } }),
    db.marketCandle.findFirst({ where: { verified: true }, orderBy: { tradeDate: "desc" }, select: { tradeDate: true } }),
  ])
  return {
    totalBars,
    verifiedBars,
    companiesCovered: groups.length,
    companiesWith200Plus: groups.filter((g) => g._count._all >= 200).length,
    newestCandle: newest ? newest.tradeDate.toISOString().slice(0, 10) : null,
  }
}

export const REFRESH_WINDOW_DAYS = 45
