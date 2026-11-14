// =============================================================================
// EGXANO engine audit — no-lookahead replay of the REAL close-signal engine.
// Run:  npx tsx scripts/invest/sample-engine.ts
//
// What it does (strictly read-only, engine untouched):
//   1. Fetches the company universe from https://egxano.vercel.app
//      (/api/v1/companies?sort=marketCap) and picks a fixed 22-ticker
//      cross-sector sample (big caps + mid caps + low-liquidity names).
//   2. Per ticker, acquires daily history (cache under .cache/history/):
//        a. /api/v1/market/history?symbol=T&range=5Y  — production endpoint.
//           Learned response shape: { symbol, interval, range,
//           data: [{ timestamp, price }], asOf } — CLOSE-ONLY, no volume,
//           capped 500 rows, from MarketPrice day-rows (sparse monthly crawl
//           snapshots + the last few daily rows, incl. intraday instants).
//        b. /api/v1/companies/T/technical — 200 only for the 5 free tickers
//           (COMI ETEL TMGH ABUK EFID); returns production `candles`
//           [{t,o,h,l,c}] (corporate-action adjusted, no volume) + the live
//           snapshot/stance for cross-checking.
//        c. Yahoo chart API T.CA range=2y interval=1d — the engine's own live
//           source (live-bars.ts); full OHLCV. Datacenter IPs are rate-limited
//           (429) — attempted opportunistically, abandoned after 3 consecutive
//           failures to keep the run inside its time budget.
//   3. Replays computeCloseSignal() (imported from src/lib/technical/signals)
//      at EVERY session t, feeding ONLY bars with date <= t. Records signal,
//      score, dimensions, styleFits, tradePlan, metrics per day.
//   4. Computes the diagnostics requested by the audit brief + writes
//      .cache/history/replay-results.json and prints stats + concrete examples.
//
// Deterministic: fixed ticker order, fixed retry counts, no randomness.
// Production data itself moves intraday — reruns may shift by the last bar.
// =============================================================================
import fs from "node:fs"
import path from "node:path"
import { computeCloseSignal, finalizeScore, type CloseRow, type CloseSignalOutput } from "../../src/lib/technical/signals"
import { emaSeries, supportResistance, type Bar } from "../../src/lib/technical/indicators"

const BASE = "https://egxano.vercel.app"
const CACHE = path.resolve(__dirname, "../../.cache/history")
const OUT_JSON = path.join(CACHE, "replay-results.json")
const DEADLINE_MS = 4.5 * 60_000 // stay under the ~5-minute cap
const T0 = Date.now()

// Fixed cross-sector sample: big caps, mid caps, low-liquidity tail.
const UNIVERSE: { ticker: string; sector: string; bucket: "big" | "mid" | "small" }[] = [
  { ticker: "COMI", sector: "Banks", bucket: "big" },
  { ticker: "SWDY", sector: "Industrial", bucket: "big" },
  { ticker: "ETEL", sector: "Telecom", bucket: "big" },
  { ticker: "TMGH", sector: "Real Estate", bucket: "big" },
  { ticker: "EGAL", sector: "Basic Materials", bucket: "big" },
  { ticker: "HRHO", sector: "Financial Services", bucket: "big" },
  { ticker: "EAST", sector: "Food", bucket: "big" },
  { ticker: "ORAS", sector: "Construction", bucket: "big" },
  { ticker: "ABUK", sector: "Basic Materials", bucket: "big" },
  { ticker: "HDBK", sector: "Banks", bucket: "big" },
  { ticker: "AMOC", sector: "Energy", bucket: "mid" },
  { ticker: "PHAR", sector: "Healthcare", bucket: "mid" },
  { ticker: "ALCN", sector: "Transport", bucket: "mid" },
  { ticker: "RAYA", sector: "Financial Services", bucket: "mid" },
  { ticker: "CLHO", sector: "Healthcare", bucket: "mid" },
  { ticker: "JUFO", sector: "Food", bucket: "mid" },
  { ticker: "OCDI", sector: "Real Estate", bucket: "mid" },
  { ticker: "SCEM", sector: "Building Materials", bucket: "mid" },
  { ticker: "FWRY", sector: "Telecom", bucket: "mid" },
  { ticker: "ORWE", sector: "Textiles", bucket: "small" },
  { ticker: "NAPR", sector: "Paper", bucket: "small" },
  { ticker: "GTWL", sector: "Textiles", bucket: "small" },
  { ticker: "EFID", sector: "Food", bucket: "mid" },
]
const FREE_TICKERS = new Set(["COMI", "ETEL", "TMGH", "ABUK", "EFID"])

interface BarRow { ts: string; open: number; high: number; low: number; close: number; volume: number | null }

// ---------------------------------------------------------------- fetch utils

async function fetchJson(url: string, attempts = 2, timeoutMs = 12_000): Promise<unknown | null> {
  for (let a = 0; a < attempts; a++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), headers: { "User-Agent": "egxano-audit/1.0" } })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return await res.json()
    } catch {
      if (a === attempts - 1) return null
      await new Promise((r) => setTimeout(r, 1500))
    }
  }
  return null
}

function cachePath(name: string): string {
  return path.join(CACHE, name.replace(/[^A-Za-z0-9._-]/g, "_"))
}
function readCache(name: string): unknown | null {
  try {
    return JSON.parse(fs.readFileSync(cachePath(name), "utf8"))
  } catch {
    return null
  }
}
function writeCache(name: string, data: unknown): void {
  fs.writeFileSync(cachePath(name), JSON.stringify(data))
}

// ------------------------------------------------------------ source adapters

/** Source 1 — production /market/history (close-only; documents data depth). */
async function fetchHistoryCloses(ticker: string): Promise<{ ts: string; price: number }[]> {
  const key = `${ticker}-hist.json`
  const hit = readCache(key) as { data?: { timestamp: string; price: number }[] } | null
  let payload = hit
  if (!payload) {
    payload = (await fetchJson(`${BASE}/api/v1/market/history?symbol=${ticker}&range=5Y`)) as typeof hit
    if (payload) writeCache(key, payload)
  }
  const rows = Array.isArray(payload?.data) ? payload.data : []
  // Production day-bucket semantics: last row per calendar day wins, ascending.
  const byDay = new Map<string, number>()
  for (const r of rows) {
    if (typeof r?.timestamp !== "string" || typeof r?.price !== "number") continue
    byDay.set(r.timestamp.slice(0, 10), r.price)
  }
  return [...byDay.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([ts, price]) => ({ ts, price }))
}

/** Source 2 — production /technical candles (OHLC, no volume; free tickers only). */
async function fetchTechnicalCandles(ticker: string): Promise<{ candles: BarRow[]; snapshot: Record<string, unknown> | null; stance: Record<string, unknown> | null } | null> {
  const key = `${ticker}-technical.json`
  const hit = readCache(key) as { candles?: { t: string; o: number; h: number; l: number; c: number }[]; snapshot?: Record<string, unknown>; stance?: Record<string, unknown> } | null
  let payload = hit
  if (!payload) {
    payload = (await fetchJson(`${BASE}/api/v1/companies/${ticker}/technical`, 2, 20_000)) as typeof hit
    if (payload && Array.isArray((payload as { candles?: unknown }).candles)) writeCache(key, payload)
    else payload = null
  }
  if (!payload?.candles) return null
  const candles: BarRow[] = payload.candles
    .filter((c) => Number.isFinite(c?.c) && c.c > 0)
    .map((c) => ({ ts: String(c.t).slice(0, 10), open: c.o, high: c.h, low: c.l, close: c.c, volume: null }))
  return { candles, snapshot: payload.snapshot ?? null, stance: payload.stance ?? null }
}

/** Source 3 — Yahoo chart (the engine's own live source; OHLCV). */
let yahooDead = false
let yahooFailures = 0
async function fetchYahooBars(ticker: string): Promise<BarRow[] | null> {
  if (yahooDead) return null
  const key = `${ticker}-yahoo.json`
  const hit = readCache(key) as BarRow[] | null
  if (hit) return hit
  const j = (await fetchJson(
    `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}.CA?range=2y&interval=1d`,
    2,
    12_000,
  )) as {
    chart?: { result?: Array<{ timestamp?: number[]; indicators?: { quote?: Array<{ open?: (number | null)[]; high?: (number | null)[]; low?: (number | null)[]; close?: (number | null)[]; volume?: (number | null)[] }> } }> }
  } | null
  const r = j?.chart?.result?.[0]
  const ts = r?.timestamp
  const q = r?.indicators?.quote?.[0]
  if (!r || !ts || !q) {
    yahooFailures++
    if (yahooFailures >= 3) yahooDead = true // stop burning the time budget
    return null
  }
  const bars: BarRow[] = []
  for (let i = 0; i < ts.length; i++) {
    const o = q.open?.[i], h = q.high?.[i], l = q.low?.[i], c = q.close?.[i]
    if (typeof o !== "number" || typeof h !== "number" || typeof l !== "number" || typeof c !== "number") continue
    if (![o, h, l, c].every((x) => Number.isFinite(x) && x > 0)) continue
    const v = q.volume?.[i]
    bars.push({
      ts: new Date(ts[i] * 1000).toISOString().slice(0, 10),
      open: o, high: h, low: l, close: c,
      volume: typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null, // same >0 semantics as the engine
    })
  }
  bars.sort((a, b) => a.ts.localeCompare(b.ts))
  if (bars.length) writeCache(key, bars)
  return bars
}

// ------------------------------------------------------------------- replay

interface ReplayDay {
  ticker: string
  date: string
  sessions: number
  signal: string | null
  score: number | null
  dims: { key: string; earned: number; max: number }[]
  styleFits: { tag: string; earned: number; total: number }[]
  tradePlan: { bias: string; entryLow: number; entryHigh: number; stop: number; targetLow: number; targetHigh: number; riskReward: number; basisAr: string } | null
  invalidation: unknown
  // engine metrics
  rsi14: number | null
  ema20: number | null
  ema50: number | null
  relVol: number | null
  rangePos60: number | null
  obvSlope20: number | null
  changePct: number | null
  dailyVolPct: number | null
  // audit-computed (prefix-only, no lookahead)
  ema50Falling5: boolean | null // ema50[t] < ema50[t-5]
  nearestResPct: number | null // distance % to nearest derived resistance ABOVE the close (close-only pivots, same as trade-plan)
  fwd5: number | null // 5-session forward return (evaluation only)
  close: number
}

function toCloseRows(bars: BarRow[]): CloseRow[] {
  return bars.map((b) => ({ ts: b.ts, close: b.close, volume: b.volume }))
}

/** Nearest resistance above `ref` from close-only pivots — mirrors trade-plan deriveZones. */
function nearestResistancePct(bars: BarRow[]): number | null {
  const flat: Bar[] = bars.slice(-120).map((b, i) => ({
    ts: new Date(Date.UTC(2020, 0, 1 + i)).toISOString().slice(0, 10),
    open: b.close, high: b.close, low: b.close, close: b.close, volume: null,
  }))
  const z = supportResistance(flat, 5, 1.5, 4)
  const lc = bars[bars.length - 1].close
  let best: number | null = null
  for (const r of z.resistances) if (r.price > lc && (best === null || r.price < best)) best = r.price
  return best === null ? null : ((best - lc) / lc) * 100
}

async function replayTicker(ticker: string, bars: BarRow[], source: string): Promise<{ days: ReplayDay[]; source: string; volumeKnownAny: boolean }> {
  const closesAll = bars.map((b) => b.close)
  const e50series = emaSeries(closesAll, 50) // computed on the full series for INDEXING only;
  // per-day falling/trending test below uses only values at indices <= i (prefix values — no future data enters the engine or the test at day i)
  const days: ReplayDay[] = []
  let volumeKnownAny = false
  for (let i = 0; i < bars.length; i++) {
    const prefix = bars.slice(0, i + 1)
    const sig: CloseSignalOutput = computeCloseSignal(toCloseRows(prefix))
    if (sig.metrics.relVol !== null) volumeKnownAny = true
    // prefix-only diagnostics
    let ema50Falling5: boolean | null = null
    if (i >= 5 && e50series[i] !== null && e50series[i - 5] !== null) ema50Falling5 = (e50series[i] as number) < (e50series[i - 5] as number)
    const nearestResPct = i >= 11 ? nearestResistancePct(prefix) : null
    const fwd5 = i + 5 < bars.length && bars[i].close > 0 ? (bars[i + 5].close / bars[i].close - 1) * 100 : null
    days.push({
      ticker,
      date: bars[i].ts,
      sessions: sig.sessions,
      signal: sig.signal,
      score: sig.score,
      dims: sig.dimensions.map((d) => ({ key: d.key, earned: d.earned, max: d.max })),
      styleFits: sig.styleFits.map((f) => ({ tag: f.tag, earned: f.earned, total: f.total })),
      tradePlan: sig.tradePlan
        ? {
            bias: sig.tradePlan.bias, entryLow: sig.tradePlan.entryLow, entryHigh: sig.tradePlan.entryHigh,
            stop: sig.tradePlan.stop, targetLow: sig.tradePlan.targetLow, targetHigh: sig.tradePlan.targetHigh,
            riskReward: sig.tradePlan.riskReward, basisAr: sig.tradePlan.basisAr,
          }
        : null,
      invalidation: sig.invalidation,
      rsi14: sig.metrics.rsi14, ema20: sig.metrics.ema20, ema50: sig.metrics.ema50,
      relVol: sig.metrics.relVol, rangePos60: sig.metrics.rangePos60, obvSlope20: sig.metrics.obvSlope20,
      changePct: sig.changePct, dailyVolPct: sig.metrics.dailyVolPct,
      ema50Falling5, nearestResPct, fwd5, close: bars[i].close,
    })
    if (Date.now() - T0 > DEADLINE_MS) {
      console.log(`[deadline] stopping replay mid-run at ${ticker} day ${i} to respect the ~5min cap`)
      break
    }
  }
  return { days, source, volumeKnownAny }
}

// ---------------------------------------------------------------- statistics

const pct = (n: number, d: number): string => (d === 0 ? "n/a" : `${((n / d) * 100).toFixed(1)}%`)
const median = (xs: number[]): number | null => {
  if (!xs.length) return null
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}
const quantile = (xs: number[], q: number): number | null => {
  if (!xs.length) return null
  const s = [...xs].sort((a, b) => a - b)
  const idx = q * (s.length - 1)
  const lo = Math.floor(idx), hi = Math.ceil(idx)
  return s[lo] + (s[hi] - s[lo]) * (idx - lo)
}
const iqr = (xs: number[]): [number, number] | null => (xs.length ? [quantile(xs, 0.25) as number, quantile(xs, 0.75) as number] : null)
const f1 = (x: number | null): string => (x === null ? "n/a" : x.toFixed(1))

interface TickerStats {
  ticker: string
  sector: string
  bucket: string
  source: string
  bars: number
  firstDate: string | null
  lastDate: string | null
  scoredDays: number
  weakNullDays: number
  buyPctScored: number
  holdPctScored: number
  sellPctScored: number
  buyCount: number
  buyRangeTop80: number
  buyRelVolBelow1: number
  buyRelVolKnown: number
  buyObvNeg: number
  buyObvKnown: number
  buyEma50Falling: number
  buyEma50Known: number
  buyNearResistance2pct: number
  buyResKnown: number
  scoreDeltaAbsMean: number | null
  scoreDeltaAbsP90: number | null
  scoreFlatBigMove: number // |Δscore| <= 1 while |1d ret| >= 3% (both scored days)
  bigMoveDays: number
  runMedian: number | null
  runMax: number
  unchangedShare: number
  fwd5BuyMedian: number | null
  fwd5BuyIqr: [number, number] | null
  fwd5HoldMedian: number | null
  fwd5SellMedian: number | null
  planChasingShare: number // chasing-branch share among BUY plans
  planRR2Share: number // RR exactly 2.00 share among BUY plans (mechanical 2R target)
  stopPctMedian: number | null
  cap70Days: number // volume dim absent (max 0) among scored days
}

function perTickerStats(rows: ReplayDay[], meta: { ticker: string; sector: string; bucket: string; source: string }): TickerStats {
  const scored = rows.filter((d) => d.signal !== null)
  const buys = scored.filter((d) => d.signal === "buy")
  const holds = scored.filter((d) => d.signal === "hold")
  const sells = scored.filter((d) => d.signal === "sell")
  const deltas: number[] = []
  let scoreFlatBigMove = 0
  let bigMoveDays = 0
  for (let i = 1; i < rows.length; i++) {
    const a = rows[i - 1], b = rows[i]
    if (a.score !== null && b.score !== null) {
      const d = Math.abs(b.score - a.score)
      deltas.push(d)
      const ret = a.close > 0 ? (b.close - a.close) / a.close : 0
      if (Math.abs(ret) >= 0.03) {
        bigMoveDays++
        if (d <= 1) scoreFlatBigMove++
      }
    }
  }
  // runs of identical signal
  let runMax = 0, runs = 0, unchanged = 0
  let cur = 0
  for (let i = 0; i < rows.length; i++) {
    const s = rows[i].signal
    if (s === null) { if (cur > 0) { runMax = Math.max(runMax, cur); runs++; cur = 0 } continue }
    if (i > 0 && rows[i - 1].signal === s) { cur++; unchanged++ } else { if (cur > 0) { runMax = Math.max(runMax, cur); runs++ } cur = 1 }
  }
  if (cur > 0) { runMax = Math.max(runMax, cur); runs++ }
  const fwdBuy = buys.filter((d) => d.fwd5 !== null).map((d) => d.fwd5 as number)
  const fwdHold = holds.filter((d) => d.fwd5 !== null).map((d) => d.fwd5 as number)
  const fwdSell = sells.filter((d) => d.fwd5 !== null).map((d) => d.fwd5 as number)
  const plans = buys.filter((d) => d.tradePlan?.bias === "buy")
  const stopPcts = plans.map((d) => d.tradePlan ? ((d.tradePlan.stop - d.close) / d.close) * 100 : NaN).filter((x) => Number.isFinite(x))
  return {
    ticker: meta.ticker, sector: meta.sector, bucket: meta.bucket, source: meta.source,
    bars: rows.length,
    firstDate: rows[0]?.date ?? null, lastDate: rows[rows.length - 1]?.date ?? null,
    scoredDays: scored.length,
    weakNullDays: rows.length - scored.length,
    buyPctScored: scored.length ? (buys.length / scored.length) * 100 : 0,
    holdPctScored: scored.length ? (holds.length / scored.length) * 100 : 0,
    sellPctScored: scored.length ? (sells.length / scored.length) * 100 : 0,
    buyCount: buys.length,
    buyRangeTop80: buys.filter((d) => (d.rangePos60 ?? 0) > 80).length,
    buyRelVolBelow1: buys.filter((d) => d.relVol !== null && d.relVol < 1).length,
    buyRelVolKnown: buys.filter((d) => d.relVol !== null).length,
    buyObvNeg: buys.filter((d) => d.obvSlope20 !== null && d.obvSlope20 < 0).length,
    buyObvKnown: buys.filter((d) => d.obvSlope20 !== null).length,
    buyEma50Falling: buys.filter((d) => d.ema50Falling5 === true).length,
    buyEma50Known: buys.filter((d) => d.ema50Falling5 !== null).length,
    buyNearResistance2pct: buys.filter((d) => d.nearestResPct !== null && d.nearestResPct <= 2).length,
    buyResKnown: buys.filter((d) => d.nearestResPct !== null).length,
    scoreDeltaAbsMean: deltas.length ? deltas.reduce((a, b) => a + b, 0) / deltas.length : null,
    scoreDeltaAbsP90: quantile(deltas, 0.9),
    scoreFlatBigMove, bigMoveDays,
    runMedian: median((() => { const r: number[] = []; let c = 0; let prev: string | null = null; for (const d of rows) { if (d.signal === null) { if (c) r.push(c); c = 0; prev = null; continue } if (prev !== null && d.signal !== prev) { r.push(c); c = 1 } else c++; prev = d.signal } if (c) r.push(c); return r })()),
    runMax,
    unchangedShare: scored.length > 1 ? (unchanged / (scored.length - 1)) * 100 : 0,
    fwd5BuyMedian: median(fwdBuy), fwd5BuyIqr: iqr(fwdBuy),
    fwd5HoldMedian: median(fwdHold), fwd5SellMedian: median(fwdSell),
    planChasingShare: plans.length ? (plans.filter((d) => d.tradePlan?.basisAr === "دخول على التصحيح مش المطاردة").length / plans.length) * 100 : 0,
    planRR2Share: plans.length ? (plans.filter((d) => d.tradePlan?.riskReward === 2).length / plans.length) * 100 : 0,
    stopPctMedian: median(stopPcts),
    cap70Days: scored.filter((d) => d.dims.find((x) => x.key === "volume")?.max === 0).length,
  }
}

// ---------------------------------------------------------------------- main

async function main(): Promise<void> {
  fs.mkdirSync(CACHE, { recursive: true })
  console.log("=== EGXANO engine audit replay ===")
  console.log(`learned /api/v1/market/history contract: params symbol|interval|range; response {symbol,interval,range,data:[{timestamp,price}],asOf}; close-only, NO volume field; LIMIT ${500} rows by range cap`)

  // ---- live production board (anonymous) — real distribution + free-row metrics
  const board = (await fetchJson(`${BASE}/api/v1/technical/signals`, 2, 20_000)) as {
    distribution?: { buy: number; hold: number; sell: number }
    matched?: { buy: number; hold: number; sell: number; weak: number; total: number }
    universe?: number; scored?: number; weakData?: number; canonicalCount?: number; pctAboveEma20?: number | null
    rows?: Record<string, unknown>[]
  } | null
  if (board) {
    writeCache("board-anon.json", board)
    const m = board.matched ?? { buy: 0, hold: 0, sell: 0, weak: 0, total: 0 }
    console.log(`\n[live board] universe=${board.universe} matched=${m.total} distribution BUY ${m.buy} (${pct(m.buy, m.total)}) / HOLD ${m.hold} (${pct(m.hold, m.total)}) / SELL ${m.sell} (${pct(m.sell, m.total)}) / weak ${m.weak}; canonicalCount=${board.canonicalCount}; pctAboveEma20=${board.pctAboveEma20}; asOf=${board.asOf}`)
    const freeRows = (board.rows ?? []).filter((r) => "signal" in r) as Record<string, unknown>[]
    for (const r of freeRows.slice(0, 6)) {
      const met = r.metrics as Record<string, number | null> | undefined
      const dims = (r.dimensions as { key: string; earned: number; max: number }[] | undefined)?.map((d) => `${d.key}:${d.earned}/${d.max}`).join(", ")
      console.log(`  ${r.ticker}: ${r.signal} score=${r.score} relVol=${met?.relVol?.toFixed(2) ?? "n/a"} obvSlope20=${met?.obvSlope20 ?? "n/a"} rangePos60=${met?.rangePos60?.toFixed(1) ?? "n/a"} rsi=${met?.rsi14?.toFixed(1) ?? "n/a"} dims[${dims}] plan=${r.tradePlan ? "yes" : "null"}`)
    }
  }
  const allStats: TickerStats[] = []
  const allRows: ReplayDay[] = []
  const productionStances: Record<string, unknown>[] = []

  for (const u of UNIVERSE) {
    if (Date.now() - T0 > DEADLINE_MS) { console.log(`[deadline] skipping remaining tickers from ${u.ticker}`); break }
    try {
      // 1. production history endpoint — always fetched (documents depth)
      const hist = await fetchHistoryCloses(u.ticker)
      console.log(`\n[${u.ticker}] ${u.sector} (${u.bucket}) — history endpoint rows: ${hist.length}${hist.length ? `, ${hist[0].ts} → ${hist[hist.length - 1].ts}` : ""}`)

      // 2. best corpus: Yahoo OHLCV > production candles (free tickers) > skip replay
      let bars: BarRow[] | null = null
      let source = "none"
      const y = await fetchYahooBars(u.ticker)
      if (y && y.length >= 30) { bars = y; source = "yahoo-ohlcv" }
      if (!bars && FREE_TICKERS.has(u.ticker)) {
        const t = await fetchTechnicalCandles(u.ticker)
        if (t && t.candles.length >= 30) {
          bars = t.candles
          source = "egxano-technical-candles"
          const snap = t.snapshot as { volume?: { relVol?: number | null; obvSlope20?: number | null }; asOf?: string } | null
          if (t.stance && snap) {
            productionStances.push({
              ticker: u.ticker, asOf: snap.asOf ?? null,
              stance: t.stance,
              volume: snap.volume ?? null,
            })
          }
        }
      }
      if (!bars) {
        // 3. sparse close-only corpus from the history endpoint — replay it too (documents weak-data behavior)
        if (hist.length >= 15) {
          bars = hist.map((h) => ({ ts: h.ts, open: h.price, high: h.price, low: h.price, close: h.price, volume: null }))
          source = "egxano-history-closes(sparse)"
        } else {
          console.log(`  no replayable corpus (history ${hist.length} rows < 15 sessions; no yahoo, not a free ticker) — skipped`)
          allStats.push(perTickerStats([], { ...u, source: "none" }))
          continue
        }
      }
      console.log(`  replay corpus: ${source}, ${bars.length} bars ${bars[0].ts} → ${bars[bars.length - 1].ts}`)
      const { days } = await replayTicker(u.ticker, bars, source)
      allRows.push(...days)
      const st = perTickerStats(days, u)
      allStats.push(st)
      console.log(`  scored ${st.scoredDays}/${st.bars} days — BUY ${pct(st.buyPctScored, st.scoredDays)} | HOLD ${pct(st.holdPctScored, st.scoredDays)} | SELL ${pct(st.sellPctScored, st.scoredDays)} (null/weak ${st.weakNullDays})`)
    } catch (e) {
      console.log(`  [skip] ${u.ticker}: ${e instanceof Error ? e.message.slice(0, 160) : e}`)
    }
  }

  // ------------------------------------------------------------ mechanism checks
  // Deterministic checks with the REAL engine functions on synthetic series —
  // they prove calibration mechanisms, not market behavior. Labeled as such.
  console.log("\n================ MECHANISM CHECKS (real engine functions, synthetic series) ================")
  const strongCtx = { volumeKnown: true, riskKnown: true, allDimsStrong: true, relVol: 1.5 }
  console.log(`finalizeScore anchors (raw→displayed @gate-passing ctx): 70→${finalizeScore(70, strongCtx)}, 71→${finalizeScore(71, strongCtx)}, 75→${finalizeScore(75, strongCtx)}, 80→${finalizeScore(80, strongCtx)}, 85→${finalizeScore(85, strongCtx)}, 90→${finalizeScore(90, strongCtx)} | gate binds only above raw 80: raw 90 with relVol 1.0 → ${finalizeScore(90, { ...strongCtx, relVol: 1.0 })} | caps: raw 100 no-volume → ${finalizeScore(100, { ...strongCtx, volumeKnown: false })}, no-risk → ${finalizeScore(100, { ...strongCtx, riskKnown: false, allDimsStrong: false })}`)
  {
    // BUY-without-confirmation proof: uptrend tape with FALLING signal-day volume.
    const closes: number[] = []
    let p = 50
    for (let i = 0; i < 80; i++) { p *= i % 3 === 2 ? 0.992 : 1.01; closes.push(Math.round(p * 100) / 100) }
    const vols = closes.map((_, i) => Math.max(200, 3000 - i * 35))
    const mk = (volume: (number | null)[]): CloseRow[] => closes.map((c, i) => ({ ts: new Date(Date.UTC(2025, 0, 1) + i * 86_400_000).toISOString().slice(0, 10), close: c, volume: volume[i] }))
    const mech = computeCloseSignal(mk(vols))
    const dimTxt = mech.dimensions.map((d) => `${d.key}:${d.earned}/${d.max}`).join(", ")
    console.log(`BUY-gate-bypass proof: signal=${mech.signal} score=${mech.score} relVol=${mech.metrics.relVol?.toFixed(3)} rangePos60=${mech.metrics.rangePos60?.toFixed(1)} dims[${dimTxt}] — a BUY read with signal-day volume ${(mech.metrics.relVol ?? 0).toFixed(2)}x average and price at the 60-session top; the excellence gate never engages because raw stays ≤ 80 while compressed ≥ 62`)
    const mech2 = computeCloseSignal(mk(vols.map(() => null)))
    console.log(`volume-missing cap: the same tape with volume=null → signal=${mech2.signal} score=${mech2.score} (volume dim excluded, raw capped 70 → displayed 61 < 62 → BUY structurally unreachable without volume data)`)
  }

  // ------------------------------------------------------------ aggregate stats
  const agg = {
    tickers: allStats.filter((s) => s.scoredDays > 0),
    totalScored: allStats.reduce((a, s) => a + s.scoredDays, 0),
    totalWeakNull: allStats.reduce((a, s) => a + s.weakNullDays, 0),
    totalBuy: allStats.reduce((a, s) => a + s.buyCount, 0),
    totalBars: allStats.reduce((a, s) => a + s.bars, 0),
  }
  const sum = (f: (s: TickerStats) => number) => allStats.reduce((a, s) => a + f(s), 0)
  const buyAgg = {
    rangeTop80: sum((s) => s.buyRangeTop80),
    relVolBelow1: sum((s) => s.buyRelVolBelow1),
    relVolKnown: sum((s) => s.buyRelVolKnown),
    obvNeg: sum((s) => s.buyObvNeg),
    obvKnown: sum((s) => s.buyObvKnown),
    ema50Falling: sum((s) => s.buyEma50Falling),
    ema50Known: sum((s) => s.buyEma50Known),
    nearRes2: sum((s) => s.buyNearResistance2pct),
    resKnown: sum((s) => s.buyResKnown),
  }
  const fwdBuyAll: number[] = allRows.filter((d) => d.signal === "buy" && d.fwd5 !== null).map((d) => d.fwd5 as number)
  const fwdHoldAll: number[] = allRows.filter((d) => d.signal === "hold" && d.fwd5 !== null).map((d) => d.fwd5 as number)
  const fwdSellAll: number[] = allRows.filter((d) => d.signal === "sell" && d.fwd5 !== null).map((d) => d.fwd5 as number)

  console.log("\n================ AGGREGATE REPLAY STATS ================")
  console.log(`universe attempted: ${UNIVERSE.length}, tickers with scored days: ${agg.tickers.length}`)
  console.log(`replayed sessions total: ${agg.totalBars}; scored days: ${agg.totalScored}; weak/null-stance days: ${agg.totalWeakNull} (${pct(agg.totalWeakNull, agg.totalBars)})`)
  const dist = { buy: sum((s) => Math.round((s.buyPctScored / 100) * s.scoredDays)), hold: sum((s) => Math.round((s.holdPctScored / 100) * s.scoredDays)), sell: sum((s) => Math.round((s.sellPctScored / 100) * s.scoredDays)) }
  console.log(`signal distribution over scored days: BUY ${dist.buy} (${pct(dist.buy, agg.totalScored)}) | HOLD ${dist.hold} (${pct(dist.hold, agg.totalScored)}) | SELL ${dist.sell} (${pct(dist.sell, agg.totalScored)})`)
  console.log(`--- BUY quality diagnostics (n=${agg.totalBuy} BUY days) ---`)
  console.log(`BUY with rangePos60 > 80 (chasing tops):        ${buyAgg.rangeTop80} (${pct(buyAgg.rangeTop80, agg.totalBuy)})`)
  console.log(`BUY with relVol < 1 (weak participation):       ${buyAgg.relVolBelow1} of ${buyAgg.relVolKnown} relVol-known (${pct(buyAgg.relVolBelow1, buyAgg.relVolKnown)}); relVol unknown on ${agg.totalBuy - buyAgg.relVolKnown} BUY days (volume-less corpus)`)
  console.log(`BUY while OBV slope20 < 0 (volume conflict):    ${buyAgg.obvNeg} of ${buyAgg.obvKnown} known (${pct(buyAgg.obvNeg, buyAgg.obvKnown)})`)
  console.log(`BUY against a falling EMA50 (5-session):        ${buyAgg.ema50Falling} of ${buyAgg.ema50Known} known (${pct(buyAgg.ema50Falling, buyAgg.ema50Known)})`)
  console.log(`BUY <= 2% below derived resistance:             ${buyAgg.nearRes2} of ${buyAgg.resKnown} known (${pct(buyAgg.nearRes2, buyAgg.resKnown)})`)
  console.log(`--- stability ---`)
  const deltaMean = median(allStats.map((s) => s.scoreDeltaAbsMean).filter((x): x is number => x !== null))
  const allDeltas: number[] = []
  for (let i = 1; i < allRows.length; i++) {
    const a = allRows[i - 1], b = allRows[i]
    if (a.ticker === b.ticker && a.score !== null && b.score !== null) allDeltas.push(Math.abs(b.score - a.score))
  }
  console.log(`mean |Δscore| day-over-day (per-ticker mean of means): ${f1(deltaMean)}`)
  console.log(`P90 |Δscore|: ${f1(quantile(allDeltas, 0.9))} (cross-ticker P90 of per-ticker P90s: ${f1(quantile(allStats.map((s) => s.scoreDeltaAbsP90).filter((x): x is number => x !== null), 0.9))})`)
  console.log(`score unchanged (|Δ|<=1) while |1d move| >= 3%: ${sum((s) => s.scoreFlatBigMove)} of ${sum((s) => s.bigMoveDays)} such days (${pct(sum((s) => s.scoreFlatBigMove), sum((s) => s.bigMoveDays))})`)
  console.log(`signal persistence: median run length ${f1(median(allStats.map((s) => s.runMedian).filter((x): x is number => x !== null)))} sessions; max run ${Math.max(0, ...allStats.map((s) => s.runMax))}; share of scored days keeping previous signal: ${f1(median(allStats.map((s) => s.unchangedShare).filter((x) => x > 0)))}%`)
  console.log(`--- 5-session forward returns after signal (sanity evidence, NOT a backtest) ---`)
  console.log(`after BUY:  median ${f1(median(fwdBuyAll))}%  IQR [${f1(iqr(fwdBuyAll)?.[0] ?? null)}%, ${f1(iqr(fwdBuyAll)?.[1] ?? null)}%]  n=${fwdBuyAll.length}`)
  console.log(`after HOLD: median ${f1(median(fwdHoldAll))}%  IQR [${f1(iqr(fwdHoldAll)?.[0] ?? null)}%, ${f1(iqr(fwdHoldAll)?.[1] ?? null)}%]  n=${fwdHoldAll.length}`)
  console.log(`after SELL: median ${f1(median(fwdSellAll))}%  IQR [${f1(iqr(fwdSellAll)?.[0] ?? null)}%, ${f1(iqr(fwdSellAll)?.[1] ?? null)}%]  n=${fwdSellAll.length}`)
  console.log(`--- trade plans (BUY) ---`)
  console.log(`plans via chasing branch (flat -4.5% stop): ${pct(quantile(allStats.map((s) => s.planChasingShare), 0.5) ?? 0, 100)} median per ticker; RR exactly 2.00 (mechanical 2R): median ${f1(quantile(allStats.map((s) => s.planRR2Share), 0.5))}% per ticker; median stop distance ${f1(median(allStats.map((s) => s.stopPctMedian).filter((x): x is number => x !== null)))}%`)
  console.log(`volume-dimension absent (cap-70 path active) on ${sum((s) => s.cap70Days)} scored days`)

  // per-ticker table
  console.log("\n--- per-ticker table ---")
  console.log("ticker | src | bars | scored | BUY% | HOLD% | SELL% | BUY(n) | top80 | relVol<1 | obv<0 | e50fall | medRun | maxRun | fwd5 BUY med")
  for (const s of allStats) {
    console.log(`${s.ticker} | ${s.source} | ${s.bars} | ${s.scoredDays} | ${f1(s.buyPctScored)} | ${f1(s.holdPctScored)} | ${f1(s.sellPctScored)} | ${s.buyCount} | ${s.buyRangeTop80} | ${s.buyRelVolBelow1}/${s.buyRelVolKnown} | ${s.buyObvNeg}/${s.buyObvKnown} | ${s.buyEma50Falling}/${s.buyEma50Known} | ${f1(s.runMedian)} | ${s.runMax} | ${f1(s.fwd5BuyMedian)}`)
  }

  // ------------------------------------------------------------- examples
  const examples: Record<string, unknown>[] = []
  const push = (kind: string, d: ReplayDay, reason: string) => {
    examples.push({
      kind, ticker: d.ticker, date: d.date, signal: d.signal, score: d.score,
      dims: d.dims.map((x) => `${x.key}:${x.earned}/${x.max}`).join(", "),
      rsi14: d.rsi14, rangePos60: d.rangePos60, relVol: d.relVol, obvSlope20: d.obvSlope20,
      changePct: d.changePct, nearestResPct: d.nearestResPct, ema50Falling5: d.ema50Falling5,
      tradePlan: d.tradePlan, sessions: d.sessions, reason,
    })
  }
  // 1. BUY at the very top of the 60-session range
  for (const d of allRows.filter((x) => x.signal === "buy" && (x.rangePos60 ?? 0) >= 95).sort((a, b) => (b.rangePos60 ?? 0) - (a.rangePos60 ?? 0)).slice(0, 3)) push("buy-at-range-top", d, `BUY issued with rangePos60 ${d.rangePos60?.toFixed(1)}% — at/next to the 60-session high; momentum band grants only ${d.dims.find((x) => x.key === "momentum")?.earned}/${d.dims.find((x) => x.key === "momentum")?.max} yet the score still clears 62`)
  // 2. BUY with relVol < 1
  for (const d of allRows.filter((x) => x.signal === "buy" && x.relVol !== null && x.relVol < 1).sort((a, b) => (a.relVol ?? 1) - (b.relVol ?? 1)).slice(0, 3)) push("buy-weak-volume", d, `BUY on relVol ${d.relVol?.toFixed(2)}x — signal-day volume BELOW average; volume dim ${d.dims.find((x) => x.key === "volume")?.earned}/${d.dims.find((x) => x.key === "volume")?.max} still leaves room above the BUY threshold`)
  // 3. BUY while OBV falling
  for (const d of allRows.filter((x) => x.signal === "buy" && x.obvSlope20 !== null && x.obvSlope20 < 0).slice(0, 3)) push("buy-obv-conflict", d, `BUY while OBV slope20 is negative (${d.obvSlope20}) — distribution evidence ignored by the decision`)
  // 4. BUY against falling EMA50
  for (const d of allRows.filter((x) => x.signal === "buy" && x.ema50Falling5 === true).slice(0, 3)) push("buy-vs-falling-ema50", d, `BUY while EMA50 is below its level 5 sessions ago (falling mid-trend lens)`)
  // 5. BUY pressed under resistance
  for (const d of allRows.filter((x) => x.signal === "buy" && x.nearestResPct !== null && x.nearestResPct <= 2).slice(0, 3)) push("buy-under-resistance", d, `BUY issued ${d.nearestResPct?.toFixed(2)}% below the nearest derived resistance cluster — the mapping never looks at levels`)
  // 6. score instability
  const withDeltas: { d: ReplayDay; delta: number }[] = []
  for (let i = 1; i < allRows.length; i++) {
    const a = allRows[i - 1], b = allRows[i]
    if (a.ticker === b.ticker && a.score !== null && b.score !== null) withDeltas.push({ d: b, delta: b.score - a.score })
  }
  for (const { d, delta } of withDeltas.filter((x) => Math.abs(x.delta) >= 18).sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)).slice(0, 3)) push("score-jump", d, `score moved ${delta > 0 ? "+" : ""}${delta} in one session (to ${d.score}) — the 1.4 exponent curve converts small band crossings into large displayed swings`)
  // 7. whipsaw: BUY -> non-buy within 3 sessions (or reverse)
  for (let i = 2; i < allRows.length; i++) {
    const a = allRows[i - 2], b = allRows[i]
    if (a.ticker !== b.ticker) continue
    if (a.signal === "buy" && b.signal === "hold" && examples.filter((e) => e.kind === "whipsaw").length < 2) push("whipsaw", b, `BUY on ${a.date} flipped to HOLD by ${b.date} (2 sessions) — entry zone validity of the printed plan is never re-checked across days`)
    if (a.signal === "hold" && b.signal === "buy" && examples.filter((e) => e.kind === "whipsaw-buy").length < 1 && b.changePct !== null && Math.abs(b.changePct) < 0.5) push("whipsaw-buy", b, `HOLD -> BUY on a nearly flat session (${b.changePct?.toFixed(2)}%) — the flip is driven by slow-average crossings, not price action`)
  }
  // 8. score flat during a big move
  for (const { d } of withDeltas.filter((x) => Math.abs(x.delta) <= 1 && x.d.changePct !== null && Math.abs(x.d.changePct) >= 3).slice(0, 3)) push("score-flat-big-move", d, `1-day move ${d.changePct?.toFixed(2)}% and the score moved <= 1 point — band quantisation ignores large single-session information`)
  // 9. longest unchanged runs
  const runStat = allStats.filter((s) => s.runMax >= 10).sort((a, b) => b.runMax - a.runMax)[0]
  if (runStat) {
    const rows = allRows.filter((r) => r.ticker === runStat.ticker && r.signal !== null)
    const first = rows[0]
    push("long-static-run", first, `${runStat.ticker} held the same signal for ${runStat.runMax} consecutive scored sessions (median run ${f1(runStat.runMedian)}) — near-static labels limit information content`)
  }
  // 10. chasing trade plan
  for (const d of allRows.filter((x) => x.tradePlan?.bias === "buy" && x.tradePlan.basisAr === "دخول على التصحيح مش المطاردة").slice(0, 2)) push("plan-chasing-flat-stop", d, `BUY plan uses the chasing branch: entry ${d.tradePlan?.entryLow}-${d.tradePlan?.entryHigh}, stop ${d.tradePlan?.stop} (flat -4.5% of close, no ATR on the board path), RR ${d.tradePlan?.riskReward}`)
  // 11. weak-data days
  for (const d of allRows.filter((x) => x.signal === null && x.sessions < 15).slice(0, 2)) push("weak-data-null", d, `only ${d.sessions} sessions — stance null (honest weak-data bucket)`)
  console.log("\n================ CONCRETE EXAMPLES ================")
  for (const [i, e] of examples.entries()) console.log(`${i + 1}. [${e.kind}] ${e.ticker} ${e.date} ${e.signal} score=${e.score} — ${e.reason}`)

  fs.writeFileSync(OUT_JSON, JSON.stringify({
    generatedAt: new Date().toISOString(),
    universe: UNIVERSE,
    aggregate: { agg, buyAgg, fwd: { buy: { median: median(fwdBuyAll), iqr: iqr(fwdBuyAll), n: fwdBuyAll.length }, hold: { median: median(fwdHoldAll), iqr: iqr(fwdHoldAll), n: fwdHoldAll.length }, sell: { median: median(fwdSellAll), iqr: iqr(fwdSellAll), n: fwdSellAll.length } } },
    perTicker: allStats,
    productionStances,
    examples,
    rows: allRows,
  }, null, 1))
  console.log(`\nwrote ${OUT_JSON} (${allRows.length} replay rows, ${examples.length} examples) in ${(Date.now() - T0) / 1000 | 0}s`)
}

void main()
