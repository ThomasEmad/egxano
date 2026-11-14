// Backtest data fetcher — 1y daily candles per candidate ticker from Yahoo's
// chart API, the SAME endpoint + User-Agent + parsing policy production uses
// (src/lib/technical/live-bars.ts, range=2y there, range=1y here per the
// backtest mandate; adjclose + split/div events added for adjustment).
//
// Rate-limit policy (Yahoo 429s aggressively): ~1 request per 1.7s baseline,
// exponential backoff on 429/5xx (2s, 4s, 8s, 16s, 32s — 5 tries max), and
// every successful response is cached to .cache/bt/<TICKER>.json. A cached
// ticker is NEVER re-fetched — reruns are free and deterministic.
//
// IMPORTANT (empirically verified 2026-11-14): Yahoo's chart endpoint 429s
// every request carrying a browser-style User-Agent from this sandbox, but
// returns 200 with NO User-Agent header at all (node's default). Production's
// UA string is therefore NOT mirrored here — a documented, required deviation.
//
// Usage: npx tsx scripts/backtest/fetch-data.ts
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname, "../..")
const OUT = path.join(ROOT, ".cache/bt")
const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36"
const BASE_DELAY_MS = 1_700
const BACKOFFS = [2_000, 4_000, 8_000, 16_000, 32_000]

interface CachedQuote {
  ticker: string
  fetchedAt: string
  range: string
  adjcloseUsed: boolean
  bars: { ts: string; open: number; high: number; low: number; close: number; volume: number | null }[]
  splits: { date: string; numerator: number; denominator: number }[]
  dividends: { date: string; amount: number }[]
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function fetchChart(ticker: string): Promise<CachedQuote | null> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}.CA?range=1y&interval=1d&includeAdjustedClose=true&events=div%2Csplits`
  for (let attempt = 0; attempt <= BACKOFFS.length; attempt++) {
    try {
      const res = await fetch(url, {
        // NO User-Agent header — see comment above (browser-style UA => 429).
        signal: AbortSignal.timeout(15_000),
      })
      if (res.status === 429 || res.status >= 500) {
        const wait = BACKOFFS[Math.min(attempt, BACKOFFS.length - 1)]
        console.log(`  ${ticker}: HTTP ${res.status}, backing off ${wait / 1000}s (attempt ${attempt + 1})`)
        await sleep(wait)
        continue
      }
      if (!res.ok) {
        console.log(`  ${ticker}: HTTP ${res.status} — skipped (no retry)`)
        return null
      }
      const j = (await res.json()) as {
        chart?: {
          result?: Array<{
            timestamp?: number[]
            events?: {
              splits?: Record<string, { numerator: number; denominator: number }>
              dividends?: Record<string, { amount: number }>
            }
            indicators?: {
              adjclose?: Array<{ adjclose?: (number | null)[] }>
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
      const r = j?.chart?.result?.[0]
      const ts = r?.timestamp
      const q = r?.indicators?.quote?.[0]
      const adj = r?.indicators?.adjclose?.[0]?.adjclose
      if (!ts || !q) return null

      const bars: CachedQuote["bars"] = []
      for (let i = 0; i < ts.length; i++) {
        const o = q.open?.[i], h = q.high?.[i], l = q.low?.[i], c = q.close?.[i]
        // Same validity policy as production live-bars.ts: numeric, finite, > 0.
        if (![o, h, l, c].every((x) => typeof x === "number" && Number.isFinite(x) && x > 0)) continue
        const ac = typeof adj?.[i] === "number" && Number.isFinite(adj[i] as number) && (adj[i] as number) > 0
          ? (adj[i] as number)
          : (c as number)
        bars.push({
          ts: new Date(new Date(ts[i] * 1000).toISOString().slice(0, 10) + "T00:00:00Z").toISOString().slice(0, 10),
          open: o as number, high: h as number, low: l as number, close: c as number,
          volume: typeof q.volume?.[i] === "number" ? (q.volume[i] as number) : null,
        })
        // stash adjclose on the bar via closure array below
        ;(bars[bars.length - 1] as unknown as { adjClose: number }).adjClose = ac
      }
      bars.sort((a, b) => (a.ts < b.ts ? -1 : 1))

      const dateOf = (sec: number) => new Date(sec * 1000).toISOString().slice(0, 10)
      const splits = Object.entries(r?.events?.splits ?? {}).map(([sec, s]) => ({
        date: dateOf(Number(sec)), numerator: Number(s.numerator), denominator: Number(s.denominator),
      }))
      const dividends = Object.entries(r?.events?.dividends ?? {}).map(([sec, d]) => ({
        date: dateOf(Number(sec)), amount: Number(d.amount),
      }))
      return {
        ticker,
        fetchedAt: new Date().toISOString(),
        range: "1y",
        adjcloseUsed: Array.isArray(adj) && adj.length > 0,
        bars: bars as CachedQuote["bars"],
        splits,
        dividends,
      }
    } catch (e) {
      console.log(`  ${ticker}: ${e instanceof Error ? e.message.slice(0, 120) : e} — retrying`)
      await sleep(BACKOFFS[Math.min(attempt, BACKOFFS.length - 1)])
    }
  }
  return null
}

async function main() {
  mkdirSync(OUT, { recursive: true })
  const uni = JSON.parse(readFileSync(path.join(OUT, "universe.json"), "utf8")) as {
    candidates: { ticker: string }[][]
  }
  const tickers = uni.candidates.flat().map((c) => c.ticker)
  console.log(`fetching ${tickers.length} tickers, cached=${tickers.filter((t) => existsSync(path.join(OUT, `${t}.json`))).length}`)
  for (const t of tickers) {
    const cachePath = path.join(OUT, `${t}.json`)
    if (existsSync(cachePath)) {
      console.log(`${t}: cached`)
      continue
    }
    const q = await fetchChart(t)
    if (q && q.bars.length > 0) {
      writeFileSync(cachePath, JSON.stringify(q))
      console.log(`${t}: OK bars=${q.bars.length} adjclose=${q.adjcloseUsed} splits=${q.splits.length} divs=${q.dividends.length}`)
    } else {
      console.log(`${t}: NO DATA`)
    }
    await sleep(BASE_DELAY_MS)
  }
  console.log("done")
}

main().catch((e) => { console.error(e); process.exit(1) })
