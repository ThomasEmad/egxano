// =============================================================================
// backfill-market-candles.mts — the SAME-SOURCE mandate (owner, 2026-11-21):
// fetch a full year+ of REAL daily OHLCV for every listed EGX company from
// Yahoo (full-history adapter with soft-block/truncation guards), validate
// through candle-quality, reconcile the newest close against the TradingView
// scanner quote, and store into MarketCandle (verified flag per the quality
// verdict). Symbol resolution is cached into MarketCandleSource so the daily
// refresh never re-pays the search cost.
//
// Run:  DATABASE_URL=... bun scripts/backfill-market-candles.mts [--min-year 2024] [--workers 4]
// Out:  /home/z/my-project/download/market-candles-coverage-<date>.json + stdout summary
// =============================================================================

import { PrismaClient } from "@prisma/client"
import { fetchYahooHistory, fetchTradingViewQuotesSafe, resolveYahooSymbol } from "@/lib/market/candle-source"
import { cairoToday, lastExpectedSession, validateCandleSet } from "@/lib/market/candle-quality"

const db = new PrismaClient()

const args = process.argv.slice(2)
function argOf(flag: string, fallback: string): string {
  const i = args.indexOf(flag)
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback
}
const MIN_YEAR = Number(argOf("--min-year", "2024"))
const WORKERS = Math.max(1, Math.min(8, Number(argOf("--workers", "4"))))
const TICKER_FILTER = argOf("--tickers", "") // comma-separated — smoke-test mode
const WINDOW_START = new Date(`${MIN_YEAR}-01-01T00:00:00Z`)
const SOURCE_NAME = "YAHOO_EGX_FULL"

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

interface CompanyRow { id: string; ticker: string; nameEn: string }

async function resolveAll(companies: CompanyRow[], existing: Map<string, { yahooSymbol: string; via: string }>) {
  const resolved = new Map<string, { yahooSymbol: string; via: string; firstTradeDate: string | null }>()
  for (const [companyId, src] of existing) resolved.set(companyId, { ...src, firstTradeDate: null })
  let idx = 0
  const pending = companies.filter((c) => !resolved.has(c.id))
  console.log(`[resolve] ${existing.size} cached, ${pending.length} to resolve`)
  const worker = async () => {
    while (idx < pending.length) {
      const c = pending[idx++]!
      try {
        const r = await resolveYahooSymbol(c.ticker, c.nameEn, 60)
        resolved.set(c.id, { yahooSymbol: r.symbol, via: r.via, firstTradeDate: r.firstTradeDate })
        await db.marketCandleSource.upsert({
          where: { companyId: c.id },
          create: { companyId: c.id, yahooSymbol: r.symbol, via: r.via, sourceFirstTradeDate: r.firstTradeDate ? new Date(`${r.firstTradeDate}T00:00:00Z`) : null },
          update: { yahooSymbol: r.symbol, via: r.via, sourceFirstTradeDate: r.firstTradeDate ? new Date(`${r.firstTradeDate}T00:00:00Z`) : null, lastError: null, lastFetchAt: new Date() },
        })
      } catch (err) {
        const msg = String((err as Error).message ?? err).slice(0, 300)
        await db.marketCandleSource.upsert({
          where: { companyId: c.id },
          create: { companyId: c.id, yahooSymbol: `UNRESOLVED:${c.ticker}`, via: "none", lastError: msg },
          update: { lastError: msg, lastFetchAt: new Date() },
        }).catch(() => {})
      }
      await sleep(200)
    }
  }
  await Promise.all(Array.from({ length: WORKERS }, worker))
  return resolved
}

async function fetchAndStore(
  c: CompanyRow,
  src: { yahooSymbol: string; via: string; firstTradeDate: string | null },
  tvClose: number | null,
  expectedSession: string,
) {
  const hist = await fetchYahooHistory(c.ticker, "max", src.yahooSymbol, MIN_YEAR)
  if (!hist.candles.length) throw new Error("empty candle series from source")
  const newest = hist.candles[hist.candles.length - 1]!
  const reconcile =
    tvClose !== null && newest.date === expectedSession && newest.close !== null
      ? { source: "tradingview-scanner", expectedClose: tvClose, actualClose: newest.close }
      : null
  const report = validateCandleSet(c.ticker, hist.candles, { sourceFirstTradeDate: null, reconciliation: reconcile })
  // rows keep their row-level validity; a FAILED reconciliation means the
  // resolved symbol serves the WRONG series — store verified=false (audit
  // only) so no wrong history ever reaches analysis.
  const setVerified = report.reconciliation ? report.reconciliation.passed : true
  const verified = setVerified
  const rows = report.verified.map((v) => ({
    companyId: c.id,
    tradeDate: new Date(`${v.date}T00:00:00Z`),
    open: v.open,
    high: v.high,
    low: v.low,
    close: v.close,
    volume: v.volume,
    sourceName: SOURCE_NAME,
    verified,
  }))
  // idempotent window write: replace the window, then bulk-insert
  await db.$transaction(async (tx) => {
    await tx.marketCandle.deleteMany({ where: { companyId: c.id, tradeDate: { gte: WINDOW_START } } })
    for (let i = 0; i < rows.length; i += 500) {
      await tx.marketCandle.createMany({ data: rows.slice(i, i + 500) })
    }
  })
  await db.marketCandleSource.updateMany({
    where: { companyId: c.id },
    data: { lastFetchAt: new Date(), lastError: verified ? null : `reconciliation failed: ${report.reconciliation?.deviationPct.toFixed(2)}%` },
  })
  return { report, verified }
}

async function main() {
  const companies = (
    await db.company.findMany({
      where: { listingStatus: "LISTED", isActive: true },
      select: { id: true, ticker: true, nameEn: true },
      orderBy: { ticker: "asc" },
    })
  ).filter((c) => !TICKER_FILTER || TICKER_FILTER.split(",").map((t) => t.trim().toUpperCase()).includes(c.ticker.toUpperCase()))
  console.log(`[backfill] ${companies.length} listed companies, window >= ${MIN_YEAR}-01-01, ${WORKERS} workers`)

  const existing = new Map<string, { yahooSymbol: string; via: string }>()
  const sources = await db.marketCandleSource.findMany({ where: { via: { not: "none" } } })
  for (const s of sources) existing.set(s.companyId, { yahooSymbol: s.yahooSymbol, via: s.via })

  const tvQuotes = await fetchTradingViewQuotesSafe().catch(() => new Map())
  console.log(`[tv] ${tvQuotes.size} live quotes for reconciliation`)
  const expectedSession = lastExpectedSession(cairoToday())
  console.log(`[tv] expected latest session: ${expectedSession}`)

  const resolved = await resolveAll(companies, existing)

  interface CompanyResult {
    ticker: string
    symbol: string | null
    via: string | null
    sessions: number
    first: string | null
    last: string | null
    verdict: string
    verified: boolean
    rejected: number
    reconciliation: string
    error: string | null
  }
  const results: CompanyResult[] = []
  let cursor = 0
  const worker = async () => {
    while (cursor < companies.length) {
      const c = companies[cursor++]!
      const src = resolved.get(c.id)
      const base: CompanyResult = {
        ticker: c.ticker, symbol: src?.yahooSymbol ?? null, via: src?.via ?? null,
        sessions: 0, first: null, last: null, verdict: "FAILED", verified: false,
        rejected: 0, reconciliation: "skipped", error: null,
      }
      try {
        if (!src || src.via === "none") throw new Error("no Yahoo symbol with usable history (resolution failed)")
        const tvClose = tvQuotes.get(c.ticker.toUpperCase())?.close ?? null
        const { report, verified } = await fetchAndStore(c, src, tvClose, expectedSession)
        results.push({
          ...base,
          sessions: report.verifiedCount,
          first: report.firstSession,
          last: report.lastSession,
          verdict: report.verdict,
          verified,
          rejected: report.rejectedCount,
          reconciliation: report.reconciliation
            ? (report.reconciliation.passed ? `passed ${report.reconciliation.deviationPct.toFixed(2)}%` : `FAILED ${report.reconciliation.deviationPct.toFixed(2)}%`)
            : "skipped",
        })
      } catch (err) {
        results.push({ ...base, error: String((err as Error).message ?? err).slice(0, 240) })
        await db.marketCandleSource.updateMany({ where: { companyId: c.id }, data: { lastError: String((err as Error).message ?? err).slice(0, 300), lastFetchAt: new Date() } }).catch(() => {})
      }
      await sleep(150)
    }
  }
  await Promise.all(Array.from({ length: WORKERS }, worker))

  // ---- coverage summary ----
  const ok = results.filter((r) => r.error === null)
  const failed = results.filter((r) => r.error !== null)
  const withYear = ok.filter((r) => r.sessions >= 240)
  const technical = ok.filter((r) => r.sessions >= 60)
  const lastDates = ok.map((r) => r.last).filter((v): v is string => v !== null).sort()
  const verdicts = { FULL: 0, DEGRADED: 0, INSUFFICIENT: 0, FAILED: 0 } as Record<string, number>
  for (const r of results) verdicts[r.error ? "FAILED" : r.verdict] = (verdicts[r.error ? "FAILED" : r.verdict] ?? 0) + 1
  const summary = {
    runAt: new Date().toISOString(),
    window: { minYear: MIN_YEAR },
    universe: companies.length,
    fetched: ok.length,
    failed: failed.length,
    resolutions: {
      tickerDirect: ok.filter((r) => r.via === "ticker").length,
      nameSearch: ok.filter((r) => r.via === "name-search").length,
    },
    sessions: { withFullYear240: withYear.length, technicalReady60: technical.length },
    verdicts,
    newestSessionCounts: Object.fromEntries(
      [...new Set(lastDates)].sort().reverse().slice(0, 5).map((d) => [d, lastDates.filter((x) => x === d).length]),
    ),
    reconciliation: {
      passed: results.filter((r) => r.reconciliation.startsWith("passed")).length,
      failed: results.filter((r) => r.reconciliation.startsWith("FAILED")).length,
      skipped: results.filter((r) => r.reconciliation === "skipped").length,
    },
  }
  const outPath = `/home/z/my-project/download/market-candles-coverage-${new Date().toISOString().slice(0, 10)}.json`
  await Bun.write(outPath, JSON.stringify({ summary, companies: results.sort((a, b) => a.ticker.localeCompare(b.ticker)) }, null, 2))
  console.log("\n=== SUMMARY ===")
  console.log(JSON.stringify(summary, null, 2))
  console.log(`\nreport: ${outPath}`)
  if (failed.length) {
    console.log("\n=== FAILED COMPANIES (first 15) ===")
    for (const f of failed.slice(0, 15)) console.log(`${f.ticker}: ${f.error}`)
  }
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1 })
  .finally(() => db.$disconnect())
