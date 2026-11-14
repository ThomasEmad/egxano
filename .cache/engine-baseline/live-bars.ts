// Live daily bars from Yahoo's chart API — in-memory cache ONLY.
//
// Policy (2026-11-12): the platform no longer stores its own price history
// (PriceBar is frozen as a fallback). Technical analysis must run on the
// LATEST session, so we pull ~2y of daily bars on demand per ticker and cache
// them in lambda memory for 15 minutes. Nothing here is ever written to the DB.
import { db } from "@/lib/db"

export interface RawBar {
  ts: Date
  open: number
  high: number
  low: number
  close: number
  volume: number | null
}

const TTL_MS = 15 * 60_000
const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36"
const cache = new Map<string, { bars: RawBar[]; at: number }>()

/** Fetch recent daily bars for an EGX ticker (TICKER.CA). Returns null when
 * Yahoo is unreachable or the ticker has no chart — callers fall back to the
 * stored PriceBar history. */
export async function fetchRecentBarsYahoo(ticker: string): Promise<RawBar[] | null> {
  const key = ticker.toUpperCase()
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < TTL_MS) return hit.bars

  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(key)}.CA?range=2y&interval=1d`
    const res = await fetch(url, {
      headers: { "User-Agent": UA },
      signal: AbortSignal.timeout(12_000),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const j = (await res.json()) as {
      chart?: { result?: Array<{ timestamp?: number[]; indicators?: { quote?: Array<{ open?: (number | null)[]; high?: (number | null)[]; low?: (number | null)[]; close?: (number | null)[]; volume?: (number | null)[] }> } }> }
    }
    const r = j?.chart?.result?.[0]
    const ts = r?.timestamp
    const q = r?.indicators?.quote?.[0]
    if (!ts || !q) return null

    const bars: RawBar[] = []
    for (let i = 0; i < ts.length; i++) {
      const o = q.open?.[i], h = q.high?.[i], l = q.low?.[i], c = q.close?.[i]
      if (typeof o !== "number" || typeof h !== "number" || typeof l !== "number" || typeof c !== "number") continue
      if (![o, h, l, c].every((x) => Number.isFinite(x) && x > 0)) continue
      // Daily timestamps are session instants — normalize to UTC midnight so
      // dates align with stored PriceBar rows for the merge.
      bars.push({
        ts: new Date(new Date(ts[i] * 1000).toISOString().slice(0, 10) + "T00:00:00Z"),
        open: o, high: h, low: l, close: c,
        volume: typeof q.volume?.[i] === "number" ? (q.volume[i] as number) : null,
      })
    }
    bars.sort((a, b) => a.ts.getTime() - b.ts.getTime())
    cache.set(key, { bars, at: Date.now() })
    return bars
  } catch {
    // Do not cache failures — next request retries.
    return null
  }
}

/** Refresh the ticker for a company id (small helper for callers that only
 * have the id). Null when the company or its chart is unavailable. */
export async function fetchRecentBarsForCompany(companyId: string): Promise<RawBar[] | null> {
  const company = await db.company.findUnique({ where: { id: companyId }, select: { ticker: true } })
  return company?.ticker ? fetchRecentBarsYahoo(company.ticker) : null
}
