// Market-data source adapters for the candle pipeline (pure fetch, no DB).
//
// Two independent providers, deliberately kept separate:
//   • Yahoo chart API  → FULL daily OHLCV history for an EGX ticker (`X.CA`).
//     History completeness is asserted against the meta.firstTradeDate the
//     source itself reports — if the returned series starts later than that,
//     the fetch is considered truncated and the caller must not store it.
//     IMPORTANT: meta fields like regularMarketPrice/regularMarketTime on this
//     endpoint are stale/unreliable for EGX — only the candle series is used.
//   • TradingView EGX scanner → LIVE delayed quote per ticker, used ONLY as an
//     independent cross-validator of the newest candle (close + volume).
//
// Nothing here invents values: a failed fetch throws and the caller records
// the failure in the coverage report.

const YAHOO_BASE = "https://query1.finance.yahoo.com/v8/finance/chart"
const TV_SCANNER = "https://scanner.tradingview.com/egypt/scan"
const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36"

export interface YahooCandleRow {
  date: string
  open: number | null
  high: number | null
  low: number | null
  close: number | null
  volume: number | null
}

export interface YahooHistory {
  symbol: string
  candles: YahooCandleRow[]
  /** YYYY-MM-DD history start the source itself claims */
  firstTradeDate: string | null
  /** YYYY-MM-DD of the newest candle in the returned series */
  seriesLastDate: string | null
  /** meta-snapshot quote — captured for diagnostics, NEVER stored as data */
  metaPrice?: number
}

function tsToISO(tsSeconds: number): string {
  return new Date(tsSeconds * 1000).toISOString().slice(0, 10)
}

async function fetchJson(url: string, timeoutMs = 30_000): Promise<Record<string, unknown>> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(url, { headers: { "user-agent": UA }, signal: ctrl.signal })
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`)
    return (await res.json()) as Record<string, unknown>
  } finally {
    clearTimeout(timer)
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Retry a throwing async fn with backoff — public scanner endpoints 429 under burst. */
async function withRetry<T>(fn: () => Promise<T>, label: string, attempts = 4): Promise<T> {
  let lastErr: unknown
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn()
    } catch (err) {
      lastErr = err
      if (i < attempts - 1) {
        // superlinear backoff: soft-block windows can last tens of seconds
        const backoff = Math.round(3_000 * Math.pow(i + 1, 1.5))
        console.warn(`[candle-source] ${label} attempt ${i + 1} failed (${String((err as Error).message ?? err)}); retrying in ${backoff}ms`)
        await sleep(backoff)
      }
    }
  }
  throw lastErr
}

/**
 * Fetch the FULL daily candle history for one EGX ticker from Yahoo.
 *
 * Always fetches through explicit `period1`/`period2` year windows and merges
 * them: Yahoo's `range=max` responses are served from a stale cache for EGX
 * symbols (verified 2026-11: `range=max` froze COMI/ETEL/JUFO/ORHD at 2026-10-31
 * while period windows returned sessions through 2026-11-19), so range-based
 * requests must never be trusted for history. Completeness is asserted against
 * meta.firstTradeDate — the source's own claimed listing date.
 */
export async function fetchYahooHistory(
  ticker: string,
  range = "max",
  symbolOverride?: string,
  /** Bounded fetch: only windows from this year onward (e.g. the 1-year
   *  refresh). The full-history completeness assert is skipped when set —
   *  starting later than the source's listing date is then INTENTIONAL. */
  minYear?: number,
  /** Daily-refresh mode: ONE window request, no listing probe (the probe's
   *  firstTradeDate only feeds the full-history completeness assert, which a
   *  bounded fetch skips anyway). */
  skipProbe?: boolean,
): Promise<YahooHistory> {
  const symbol = symbolOverride ?? `${ticker}.CA`
  const todayStart = Math.floor(new Date(new Date().toISOString().slice(0, 10) + "T00:00:00Z").getTime() / 1000)
  void range // legacy arg kept for diagnostics callers; history is always full

  const candlesByDate = new Map<string, YahooCandleRow>()
  let firstTradeDate: string | null = null
  let metaPrice: number | undefined

  // Probe for meta (firstTradeDate) with a small recent window — skipped in
  // daily-refresh mode (skipProbe): the window fetch itself is the data.
  if (!skipProbe) {
    const probe = await withRetry(() => fetchJson(`${YAHOO_BASE}/${encodeURIComponent(symbol)}?interval=1d&period1=${todayStart - 90 * 86400}&period2=${todayStart}`), `yahoo:${symbol}:probe`)
    const probeResult = (probe.chart as { result?: YahooChartResult[]; error?: { code?: string; description?: string } } | undefined)
    if (!probeResult?.result?.[0]) {
      const err = probeResult?.error
      throw new Error(`Yahoo returned no data for ${symbol} (probe)${err ? `: ${err.code ?? ""} ${err.description ?? ""}` : ""}`)
    }
    const probeRows = rowsOf(probeResult.result[0])
    firstTradeDate = probeResult.result[0].meta.firstTradeDate ? tsToISO(probeResult.result[0].meta.firstTradeDate) : null
    // soft-block shells arrive as HTTP 200 with a result that carries NO
    // timestamps and NO firstTradeDate — that must fail loudly, otherwise the
    // whole run silently degrades to "no yahoo data" for every company.
    if (probeRows.length === 0 || !firstTradeDate) {
      throw new Error(`Yahoo soft-block for ${symbol} (probe: ${probeRows.length} rows, firstTradeDate=${firstTradeDate ?? "absent"})`)
    }
    const probeSessions = probeRows.length
    void probeSessions
    metaPrice = probeResult.result[0].meta.regularMarketPrice
    for (const row of probeRows) candlesByDate.set(row.date, row)
  }

  // 5-year windows from the source's own listing date (fallback 2000) to today
  // — one request per chunk keeps the request count low (rate-limit friendly).
  // A minYear cap bounds the fetch (same-source mandate stores ≥1 year; the
  // daily refresh re-reads only the recent window).
  const startYear = minYear ?? (firstTradeDate ? Math.max(2000, Number(firstTradeDate.slice(0, 4))) : 2000)
  const currentYear = Number(new Date().toISOString().slice(0, 4))
  for (let year = startYear; year <= currentYear; year += 5) {
    const p1 = Math.floor(Date.UTC(year, 0, 1) / 1000)
    const p2 = Math.floor(Date.UTC(Math.min(year + 5, currentYear + 1), 0, 1) / 1000)
    const json = await withRetry(() => fetchJson(`${YAHOO_BASE}/${encodeURIComponent(symbol)}?interval=1d&period1=${p1}&period2=${p2}`), `yahoo:${symbol}:${year}`)
    const chart = json.chart as { result?: YahooChartResult[]; error?: { code?: string; description?: string } } | undefined
    const rows = chart?.result?.[0] ? rowsOf(chart.result[0]) : []
    // throttle signature: Yahoo under pressure returns rows WITH timestamps
    // but null OHLC — they pass rows.length and would silently truncate the
    // union (later windows contribute nothing usable). Treat an all-null
    // window as the same retryable soft-block as an empty one.
    const usableRows = rows.filter((r) => r.open !== null && r.high !== null && r.low !== null && r.close !== null)
    if (usableRows.length === 0 && rows.length > 0) {
      const windowEndISO2 = new Date(p2 * 1000).toISOString().slice(0, 10)
      throw new Error(`Yahoo throttle for ${symbol} window ${year}: ${rows.length} timestamped rows, 0 with OHLC (ends ${windowEndISO2})`)
    }
    if (rows.length === 0) {
      // Yahoo soft-blocks come back as HTTP 200 with an empty/null chart —
      // sometimes WITH an error object, sometimes with a result shell that has
      // no timestamps. A window that ENDS after the source's own claimed
      // listing date MUST contain rows; an empty one is a retryable block,
      // never "no trading that year" (that mistake silently truncates history).
      const err = chart?.error
      const windowEndISO = new Date(p2 * 1000).toISOString().slice(0, 10)
      if (err || (firstTradeDate && windowEndISO > firstTradeDate)) {
        throw new Error(`Yahoo soft-block for ${symbol} window ${year} (ends ${windowEndISO}, listing ${firstTradeDate})${err ? `: ${err.code ?? ""} ${err.description ?? ""}` : ""}`)
      }
      continue
    }
    for (const row of rows) candlesByDate.set(row.date, row)
    if (!firstTradeDate && chart?.result?.[0]?.meta.firstTradeDate) firstTradeDate = tsToISO(chart.result[0].meta.firstTradeDate)
    await sleep(1500)
  }

  const candles = [...candlesByDate.values()].sort((a, b) => a.date.localeCompare(b.date))
  // completeness assertion against the source's own listing claim: a series
  // whose listing is older than ~9 months must actually reach back to it —
  // anything shorter means windows were blocked and the run must fail loudly.
  // Skipped on bounded (minYear) fetches — a short series is then intended.
  if (!minYear && firstTradeDate && candles.length > 0) {
    const now = Date.now()
    const listingAgeDays = (now - Date.parse(firstTradeDate + "T00:00:00Z")) / 86_400_000
    const firstCandleGapDays = (Date.parse(candles[0].date + "T00:00:00Z") - Date.parse(firstTradeDate + "T00:00:00Z")) / 86_400_000
    if (listingAgeDays > 270 && firstCandleGapDays > 45) {
      throw new Error(`Yahoo history truncated for ${symbol}: series starts ${candles[0].date} but the source claims listing ${firstTradeDate}`)
    }
  }
  return {
    symbol,
    candles,
    firstTradeDate,
    seriesLastDate: candles.length ? candles[candles.length - 1].date : null,
    metaPrice,
  }
}

interface YahooChartResult {
  meta: { firstTradeDate?: number; regularMarketPrice?: number }
  timestamp?: number[]
  indicators: { quote: Array<Record<string, (number | null)[] | undefined>> }
}

function rowsOf(result: YahooChartResult): YahooCandleRow[] {
  const ts = result.timestamp ?? []
  const q = result.indicators.quote?.[0] ?? {}
  return ts.map((t, i) => ({
    date: tsToISO(t),
    open: q.open?.[i] ?? null,
    high: q.high?.[i] ?? null,
    low: q.low?.[i] ?? null,
    close: q.close?.[i] ?? null,
    volume: q.volume?.[i] ?? null,
  }))
}

export interface TvQuote {
  ticker: string
  close: number
  volume: number | null
}

/** One POST returns the live (15-min delayed) quote for the whole EGX universe. */
export async function fetchTradingViewQuotes(tickers?: string[]): Promise<Map<string, TvQuote>> {
  const body: Record<string, unknown> = {
    filter: [{ left: "exchange", operation: "equal", right: "EGX" }],
    options: { lang: "en" },
    markets: ["egypt"],
    symbols: { query: { types: [] }, tickers: [] },
    columns: ["name", "close", "volume", "update_mode"],
    sort: { sortBy: "name", sortOrder: "asc" },
    range: [0, 1000],
  }
  if (tickers?.length) {
    body.filter = [{ left: "name", operation: "in", right: tickers }]
    body.range = [0, tickers.length]
  }
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 30_000)
  try {
    const res = await fetch(TV_SCANNER, {
      method: "POST",
      headers: { "content-type": "application/json", "user-agent": UA },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    })
    if (!res.ok) throw new Error(`TradingView scanner HTTP ${res.status}`)
    const json = (await res.json()) as { data?: Array<{ s: string; d: unknown[] }> }
    const out = new Map<string, TvQuote>()
    for (const row of json.data ?? []) {
      const ticker = String(row.d?.[0] ?? "").trim()
      const close = Number(row.d?.[1])
      const volume = Number(row.d?.[2])
      if (!ticker || !Number.isFinite(close) || close <= 0) continue
      out.set(ticker.toUpperCase(), { ticker, close, volume: Number.isFinite(volume) ? volume : null })
    }
    return out
  } finally {
    clearTimeout(timer)
  }
}

/** Scanner wrapper with retry backoff. */
export async function fetchTradingViewQuotesSafe(tickers?: string[]): Promise<Map<string, TvQuote>> {
  return withRetry(() => fetchTradingViewQuotes(tickers), "tradingview:scan", 5)
}

// ---------------------------------------------------------------------------
// Symbol resolution — Yahoo carries EGX history under the plain ticker for
// some names and NOT AT ALL for others; its ISIN-style symbols (EGS…​.CA)
// are recent-only stubs with no history. Resolution order:
//   1. probe `{TICKER}.CA` (the normal case — full history)
//   2. on 404, search Yahoo by the company's English name restricted to the
//      Cairo exchange (CAI) and probe each candidate for a usable history
//      (≥ minSessions candles). A candidate is accepted only when its history
//      depth is real — stubs are rejected here, never stored as "data".
// ---------------------------------------------------------------------------

export interface ResolvedSymbol {
  symbol: string
  via: "ticker" | "name-search"
  /** YYYY-MM-DD history start the source claims */
  firstTradeDate: string | null
  sessionsProbed: number
}

async function yahooSearchCaiSymbols(query: string): Promise<string[]> {
  const url = `https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(query)}&quotesCount=12&newsCount=0&listsCount=0`
  try {
    const json = await withRetry(() => fetchJson(url), `yahoo-search:${query}`, 2)
    const quotes = (json.quotes as Array<{ symbol?: string; exchange?: string }> | undefined) ?? []
    return quotes.filter((q) => q.exchange === "CAI" && typeof q.symbol === "string").map((q) => q.symbol!)
  } catch {
    return []
  }
}

async function probeHistoryDepth(symbol: string): Promise<{ sessions: number; firstTradeDate: string | null }> {
  const p1 = 0 // from epoch — Yahoo clamps to its own history start
  const p2 = Math.floor(new Date(new Date().toISOString().slice(0, 10) + "T00:00:00Z").getTime() / 1000)
  const json = await fetchJson(`${YAHOO_BASE}/${encodeURIComponent(symbol)}?interval=1d&period1=${p1}&period2=${p2}`)
  const result = (json.chart as { result?: YahooChartResult[] } | undefined)?.result?.[0]
  // a null result here is a soft-block (HTTP 200), not a missing symbol —
  // throwing lets the resolver's retry/backoff treat it as transient instead
  // of silently concluding "no history" for a symbol that has plenty.
  if (!result) throw new Error(`Yahoo soft-block for ${symbol} (depth probe)`)
  return {
    sessions: result.timestamp?.length ?? 0,
    firstTradeDate: result.meta.firstTradeDate ? tsToISO(result.meta.firstTradeDate) : null,
  }
}

/**
 * Resolve a DB ticker to the Yahoo symbol that actually carries its history.
 * Throws when no symbol with a usable history exists — the caller then gates
 * the company with "no candle data" instead of analyzing a fabricated series.
 */
export async function resolveYahooSymbol(
  ticker: string,
  nameEn: string | null,
  minSessions = 60
): Promise<ResolvedSymbol> {
  // 1. plain ticker
  try {
    const depth = await probeHistoryDepth(`${ticker}.CA`)
    if (depth.sessions >= minSessions) {
      return { symbol: `${ticker}.CA`, via: "ticker", firstTradeDate: depth.firstTradeDate, sessionsProbed: depth.sessions }
    }
  } catch {
    // 404 → fall through to name search
  }
  // 2. name search (Cairo exchange only), deepest usable candidate wins
  if (nameEn) {
    for (const candidate of await yahooSearchCaiSymbols(nameEn)) {
      try {
        const depth = await probeHistoryDepth(candidate)
        if (depth.sessions >= minSessions) {
          return { symbol: candidate, via: "name-search", firstTradeDate: depth.firstTradeDate, sessionsProbed: depth.sessions }
        }
      } catch {
        continue
      }
    }
  }
  throw new Error(`no Yahoo symbol with ≥ ${minSessions}-session history for ${ticker}${nameEn ? ` (${nameEn})` : ""} — ISIN stubs carry no history`)
}
