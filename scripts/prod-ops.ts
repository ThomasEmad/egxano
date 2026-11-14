#!/usr/bin/env bun
/**
 * prod-ops.ts — production ops toolkit for EGXANO price-candle ingestion.
 *
 * Talks directly to the production Postgres (Supabase) via Bun's built-in SQL
 * client — no Prisma involved (the repo schema targets sqlite for local dev;
 * this table set was provisioned additively on the production database).
 *
 * Subcommands:
 *   stats                        — candle-coverage distribution across active companies
 *   ingest-missing [--min N]     — backfill Yahoo daily candles for companies
 *                                  whose PriceBar count is below the bar (default 200)
 *              [--only T1,T2]    — restrict to specific tickers
 *              [--limit N]       — process at most N companies (testing)
 *
 * Safety rules (live financial product):
 *   - Writes ONLY to PriceBar, always INSERT ... ON CONFLICT ("companyId", ts)
 *     DO NOTHING — never mutates, never deletes, fully idempotent re-runs.
 *   - ts normalized to UTC midnight of the Yahoo session day (matches the
 *     convention of the existing YAHOO_CANDLES_1Y rows exactly, so the unique
 *     index catches duplicates instead of creating double bars per day).
 *   - Row ids are deterministic md5("yahoo:<companyId>:<ymd>") — stable across
 *     re-runs, collision-free with existing cuid ids.
 *   - Politeness: ~700 ms pacing between companies; on HTTP 429/503 exponential
 *     backoff (3s→10s→30s→60s→120s); a circuit breaker aborts the whole run
 *     (exit code 42) when 3 consecutive companies remain rate-limited after all
 *     retries, so the operator can reschedule later instead of hammering Yahoo.
 *   - Null/garbage candles are skipped, never guessed; volume null → 0.
 *   - Yahoo 404 ("symbol may be delisted") is recorded as notFound and disclosed
 *     in the final stats — never substituted with fabricated data.
 *
 * Usage:
 *   DATABASE_URL="postgres://..." bun scripts/prod-ops.ts stats
 *   DATABASE_URL="postgres://..." bun scripts/prod-ops.ts ingest-missing
 */

import { SQL } from "bun"

// ---------------------------------------------------------------- config ---
const MIN_BARS = (() => {
  const i = process.argv.indexOf("--min")
  return i >= 0 ? Number(process.argv[i + 1]) || 200 : 200
})()
const ONLY = (() => {
  const i = process.argv.indexOf("--only")
  return i >= 0 ? process.argv[i + 1].split(",").map((s) => s.trim().toUpperCase()) : null
})()
const LIMIT = (() => {
  const i = process.argv.indexOf("--limit")
  return i >= 0 ? Number(process.argv[i + 1]) || 0 : 0
})()

const PERIOD1 = 1451606400 // 2016-01-01 UTC — full available history
const SOURCE_NAME = "YAHOO_CANDLES_FULL"
const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36"
const PACING_MS = 700
const BACKOFFS = [3000, 10000, 30000, 60000, 120000]
const CIRCUIT_BREAKER = 3
const CHUNK = 800
const HTTP_TIMEOUT = 20_000

type Candle = { ymd: string; open: number; high: number; low: number; close: number; volume: number }
type FetchResult =
  | { ok: true; candles: Candle[] }
  | { ok: false; status: "notFound" | "rateLimited" | "error"; detail: string }

// -------------------------------------------------------------- helpers ---
function md5Hex(s: string): string {
  return new Bun.CryptoHasher("md5").update(s).digest("hex")
}

function ymdOfUnixSeconds(sec: number): string {
  return new Date(sec * 1000).toISOString().slice(0, 10)
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

function yahooSymbol(ticker: string): string {
  const t = ticker.trim().toUpperCase()
  return t.endsWith(".CA") ? t : `${t}.CA`
}

/**
 * Strict value sanitation for the raw multi-row INSERT path.
 * Every value passed through here is machine-generated (md5 hex ids, ISO
 * date digits, finite floats, fixed string literals) — the guards below
 * guarantee nothing else can ever reach the SQL text.
 */
function safeId(s: string): string {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(s)) throw new Error(`unsafe id: ${s}`)
  return s
}
function safeYmd(s: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new Error(`unsafe ymd: ${s}`)
  return s
}
function safeNum(n: number): string {
  if (!Number.isFinite(n)) throw new Error("non-finite number")
  return String(n)
}
function sqlStr(s: string): string {
  return `'${s.replace(/'/g, "''")}'`
}

async function fetchFullHistory(symbol: string): Promise<FetchResult> {
  const p2 = Math.floor(Date.now() / 1000) + 86_400
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?period1=${PERIOD1}&period2=${p2}&interval=1d`
  let lastRate = false
  for (let attempt = 0; attempt <= BACKOFFS.length; attempt++) {
    if (attempt > 0) {
      console.log(`    retry #${attempt} after ${BACKOFFS[attempt - 1]}ms (${symbol})`)
      await sleep(BACKOFFS[attempt - 1])
    }
    try {
      const res = await fetch(url, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(HTTP_TIMEOUT) })
      if (res.status === 429 || res.status === 503) {
        lastRate = true
        continue // backoff and retry
      }
      if (res.status === 404) {
        return { ok: false, status: "notFound", detail: "HTTP 404 symbol may be delisted" }
      }
      if (!res.ok) {
        return { ok: false, status: "error", detail: `HTTP ${res.status}` }
      }
      const json: any = await res.json()
      const result = json?.chart?.result?.[0]
      if (!result) {
        const desc = String(json?.chart?.error?.description ?? "no result")
        // Yahoo reports delisted/unknown symbols as a chart error
        if (desc.toLowerCase().includes("delisted") || desc.toLowerCase().includes("no data")) {
          return { ok: false, status: "notFound", detail: desc }
        }
        return { ok: false, status: "error", detail: desc }
      }
      const timestamps: number[] = result.timestamp ?? []
      const q = result.indicators?.quote?.[0] ?? {}
      const opens: (number | null)[] = q.open ?? []
      const highs: (number | null)[] = q.high ?? []
      const lows: (number | null)[] = q.low ?? []
      const closes: (number | null)[] = q.close ?? []
      const volumes: (number | null)[] = q.volume ?? []

      // last (Cairo-day) wins on duplicated session stamps
      const byDay = new Map<string, Candle>()
      for (let i = 0; i < timestamps.length; i++) {
        const close = closes[i]
        if (!Number.isFinite(close as number) || (close as number) <= 0) continue
        const open = Number.isFinite(opens[i] as number) ? (opens[i] as number) : (close as number)
        const high = Number.isFinite(highs[i] as number) ? (highs[i] as number) : (close as number)
        const low = Number.isFinite(lows[i] as number) ? (lows[i] as number) : (close as number)
        const volume = Number.isFinite(volumes[i] as number) ? (volumes[i] as number) : 0
        const ymd = ymdOfUnixSeconds(timestamps[i])
        byDay.set(ymd, { ymd, open, high, low, close: close as number, volume })
      }
      return { ok: true, candles: [...byDay.values()] }
    } catch (e: any) {
      const msg = String(e?.message ?? e)
      if (msg.includes("aborted") || msg.includes("timeout")) {
        lastRate = false
        if (attempt === BACKOFFS.length) return { ok: false, status: "error", detail: `timeout: ${msg}` }
        continue
      }
      return { ok: false, status: "error", detail: msg }
    }
  }
  return {
    ok: false,
    status: lastRate ? "rateLimited" : "error",
    detail: "exhausted retries",
  }
}

// ------------------------------------------------------------------- main ---
async function main() {
  const cmd = process.argv[2] ?? "stats"
  if (!process.env.DATABASE_URL) {
    console.error("FATAL: DATABASE_URL env is required")
    process.exit(1)
  }
  const sql = new SQL(process.env.DATABASE_URL)

  // coverage snapshot: bars per active company
  async function coverage() {
    const rows: any[] = await sql`
      SELECT c.id, c.ticker, c."listingStatus", count(pb.id)::int AS bars
      FROM "Company" c
      LEFT JOIN "PriceBar" pb ON pb."companyId" = c.id
      WHERE c."isActive" = true
      GROUP BY c.id, c.ticker, c."listingStatus"
      ORDER BY bars ASC`
    return rows
  }

  function summarize(rows: { ticker: string; bars: number; listingStatus: string }[]) {
    const n = (k: number) => rows.filter((r) => r.bars >= k).length
    const stats = {
      totalCompanies: rows.length,
      companiesWithAnyBars: n(1),
      companiesWith100Plus: n(100),
      companiesWith150Plus: n(150),
      companiesWith200Plus: n(200),
      companiesWith250Plus: n(250),
      belowBar: rows.filter((r) => r.bars < MIN_BARS),
    }
    return stats
  }

  if (cmd === "stats") {
    const rows = await coverage()
    console.log("STATS:", JSON.stringify(summarize(rows), null, 1))
    await sql.end()
    return
  }

  if (cmd !== "ingest-missing") {
    console.error(`Unknown command: ${cmd}. Use stats | ingest-missing`)
    await sql.end()
    process.exit(1)
  }

  // ------------------------------------------------- ingest-missing flow ---
  const rows = await coverage()
  let targets = rows.filter((r) => r.bars < MIN_BARS)
  if (ONLY) targets = targets.filter((r) => ONLY!.includes(r.ticker.toUpperCase()))
  if (LIMIT > 0) targets = targets.slice(0, LIMIT)
  // closest-to-the-bar first: maximizes companiesWith200Plus gain if the run
  // gets interrupted partway
  targets.sort((a, b) => b.bars - a.bars)

  console.log(
    `ingest-missing: ${targets.length} companies below ${MIN_BARS} bars (min first-run: ${rows.filter((r) => r.bars >= MIN_BARS).length} already at/above)`,
  )

  const report: any = {
    startedAt: new Date().toISOString(),
    minBars: MIN_BARS,
    targets: targets.length,
    results: [] as any[],
    inserted: 0,
  }
  let consecutiveRateLimited = 0
  let abortedRate = false

  for (const t of targets) {
    const symbol = yahooSymbol(t.ticker)
    process.stdout.write(`  ${t.ticker.padEnd(6)} had=${String(t.bars).padStart(3)} → fetch ${symbol} ... `)
    const res = await fetchFullHistory(symbol)

    if (!res.ok) {
      process.stdout.write(`${res.status.toUpperCase()}: ${res.detail}\n`)
      report.results.push({ ticker: t.ticker, symbol, status: res.status, detail: res.detail, bars: t.bars })
      if (res.status === "rateLimited") {
        consecutiveRateLimited++
        if (consecutiveRateLimited >= CIRCUIT_BREAKER) {
          console.log(`CIRCUIT BREAKER: ${CIRCUIT_BREAKER} consecutive rate-limited companies — aborting run.`)
          abortedRate = true
          break
        }
      } else {
        consecutiveRateLimited = 0
      }
      await sleep(PACING_MS)
      continue
    }

    consecutiveRateLimited = 0
    const candles = res.candles
    if (candles.length === 0) {
      process.stdout.write(`noData (0 usable candles)\n`)
      report.results.push({ ticker: t.ticker, symbol, status: "noData", bars: t.bars })
      await sleep(PACING_MS)
      continue
    }

    // insert missing bars — create-only, idempotent (unique companyId+ts)
    let inserted = 0
    const cid = safeId(t.id)
    const rowsSql: string[] = []
    for (const c of candles) {
      const id = safeId(md5Hex(`yahoo:${t.id}:${c.ymd}`))
      const ymd = safeYmd(c.ymd)
      rowsSql.push(
        `('${id}','${cid}','${ymd} 00:00:00'::timestamp,${safeNum(c.open)},${safeNum(c.high)},${safeNum(c.low)},${safeNum(c.close)},${safeNum(c.volume)},'EGP','${SOURCE_NAME}',false)`,
      )
    }
    for (let i = 0; i < rowsSql.length; i += CHUNK) {
      const chunkRows = rowsSql.slice(i, i + CHUNK).join(",")
      const ret: any = await sql.unsafe(
        `INSERT INTO "PriceBar" (id, "companyId", ts, open, high, low, close, volume, currency, "sourceName", "isDemoData")
         VALUES ${chunkRows}
         ON CONFLICT ("companyId", ts) DO NOTHING
         RETURNING id`,
      )
      inserted += Array.isArray(ret) ? ret.length : Number(ret?.count ?? 0)
    }

    const totalNow = t.bars + inserted
    process.stdout.write(`got=${candles.length} inserted=${inserted} totalNow=${totalNow}${totalNow >= MIN_BARS ? " ✓" : ""}\n`)
    report.inserted += inserted
    report.results.push({
      ticker: t.ticker,
      symbol,
      status: totalNow >= MIN_BARS ? "filled" : "partial",
      got: candles.length,
      inserted,
      barsBefore: t.bars,
      barsAfter: totalNow,
      firstYmd: candles[0]?.ymd,
      lastYmd: candles[candles.length - 1]?.ymd,
    })
    await sleep(PACING_MS)
  }

  // ------------------------------------------------------- final stats ---
  const after = await coverage()
  const finalStats = summarize(after)
  report.finishedAt = new Date().toISOString()
  report.abortedRateLimited = abortedRate
  report.finalStats = finalStats
  report.notFoundSymbols = report.results.filter((r: any) => r.status === "notFound").map((r: any) => r.ticker)
  report.failedSymbols = report.results.filter((r: any) => r.status === "error").map((r: any) => r.ticker)

  console.log("\n===== STATS =====")
  console.log(JSON.stringify(finalStats, null, 1))
  console.log(`insertedTotal: ${report.inserted}`)
  console.log(`notFound: ${report.notFoundSymbols.join(",") || "none"}`)
  console.log(`errors: ${report.failedSymbols.join(",") || "none"}`)
  console.log(`abortedRateLimited: ${abortedRate}`)

  const fs = await import("node:fs")
  fs.mkdirSync("reports", { recursive: true })
  const outFile = `reports/prod-ops-ingest-missing-${Date.now()}${abortedRate ? "-ABORTED" : ""}.json`
  fs.writeFileSync(outFile, JSON.stringify(report, null, 1))
  console.log(`report: ${outFile}`)

  await sql.end()
  process.exit(abortedRate ? 42 : 0)
}

main().catch((e) => {
  console.error("FATAL:", e)
  process.exit(1)
})
