// =============================================================================
// replay-signals-v2.mts — honest walk-forward replay of the rebuilt engine
// (tech-signals@6) over REAL production candles pulled from the live API.
//
// Run:  bun scripts/replay-signals-v2.mts [--tickers LIST] [--max N]
// Out:  reports/replay-signals-v2.json + a printed summary.
//
// What it proves (and reports honestly):
//   1. signals DO appear when their conditions are met on real tapes;
//   2. every BUY row satisfies the plan-math invariants on every replayed
//      session (stop < entry, T1 > close, RR exact) — the VLMRA bug class;
//   3. every NEAR row keeps its activation within the documented bound;
//   4. EXIT rows never carry a plan (no short-selling output exists);
//   5. outcome stats (T1-hit / stop-first / neither) for BUY rows and
//      activation-fire stats for NEAR rows — small-sample honest, no
//      out-of-sample victory is claimed from a single-year window.
// =============================================================================

const BASE = "https://egxano.vercel.app"

const args = process.argv.slice(2)
function argOf(flag: string, fallback: string): string {
  const i = args.indexOf(flag)
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback
}
const MAX_COMPANIES = Number(argOf("--max", "30"))
const TICKER_FILTER = argOf("--tickers", "")

// ---- engine imports (bun resolves "@" via tsconfig) ----
import { computeCompanySignalV2 } from "@/lib/signals/engine"
import type { Bar } from "@/lib/signals/types"

interface Candle {
  t: string
  o: number
  h: number
  l: number
  c: number
  v?: number
}

const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36"

/** Yahoo daily candles (the SAME source production ingests) — real EGX history. */
async function yahooBars(ticker: string): Promise<Bar[]> {
  const symbol = ticker.endsWith(".CA") ? ticker : `${ticker}.CA`
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=2y&interval=1d`
  const res = await fetch(url, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(20_000) })
  if (!res.ok) throw new Error(`yahoo ${res.status} for ${symbol}`)
  const d: any = await res.json()
  const r = d?.chart?.result?.[0]
  if (!r) throw new Error(`yahoo empty for ${symbol}`)
  const ts: number[] = r.timestamp ?? []
  const q = r.indicators?.quote?.[0] ?? {}
  const bars: Bar[] = []
  for (let i = 0; i < ts.length; i++) {
    const o = q.open?.[i]
    const h = q.high?.[i]
    const l = q.low?.[i]
    const c = q.close?.[i]
    if (![o, h, l, c].every((v: any) => Number.isFinite(v) && v > 0)) continue
    bars.push({
      ts: new Date(ts[i] * 1000).toISOString().slice(0, 10),
      open: o,
      high: h,
      low: l,
      close: c,
      volume: Number.isFinite(q.volume?.[i]) && q.volume[i] > 0 ? q.volume[i] : null,
    })
  }
  return bars
}

async function getJson(url: string, tries = 3): Promise<any> {
  for (let a = 0; a < tries; a++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(25_000) })
      if (res.status === 429 || res.status >= 500) {
        await new Promise((r) => setTimeout(r, 2000 * (a + 1)))
        continue
      }
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`)
      return await res.json()
    } catch (e) {
      if (a === tries - 1) throw e
      await new Promise((r) => setTimeout(r, 2000 * (a + 1)))
    }
  }
  throw new Error("unreachable")
}

async function main() {
  // ---- 1) universe
  const wanted = TICKER_FILTER ? TICKER_FILTER.split(",").map((s) => s.trim().toUpperCase()) : null
  const companies: { id: string; ticker: string }[] = []
  const pageSize = 50 // the live API caps pageSize at 50 and ignores sort=ticker
  for (let page = 1; page <= 6; page++) {
    const d = await getJson(`${BASE}/api/v1/companies?page=${page}&pageSize=${pageSize}`)
    const rows = d.companies ?? []
    for (const c of rows) companies.push({ id: c.id, ticker: c.ticker })
    if (rows.length === 0) break
  }
  const universe = wanted
    ? companies.filter((c) => wanted.includes(c.ticker))
    : companies.slice(0, MAX_COMPANIES)
  console.log(`universe fetched: ${companies.length}; replaying ${universe.length}: ${universe.map((c) => c.ticker).join(",")}`)

  // ---- 2) pull candles per company
  const replayed: string[] = []
  const skipped: string[] = []
  const stateCounts: Record<string, number> = { buy: 0, near: 0, wait: 0, exit: 0 }
  const typeCounts: Record<string, number> = {}
  let buySessions = 0
  let nearSessions = 0
  let invariantViolations: string[] = []
  let t1Hits = 0
  let stopFirsts = 0
  let stillOpen = 0
  let nearFired5 = 0
  let nearTotal5 = 0
  const t1Returns10: number[] = []
  const buyExamples: any[] = []
  const exitExamples: any[] = []

  for (const comp of universe) {
    let bars: Bar[] = []
    // Yahoo first (the same source production ingests — full 2y OHLCV);
    // fallback to the production technical route (free-set tickers only).
    try {
      bars = await yahooBars(comp.ticker)
    } catch {
      try {
        const d = await getJson(`${BASE}/api/v1/companies/${comp.id}/technical`)
        const candles = (d.candles ?? []) as Candle[]
        bars = candles.map((k) => ({ ts: k.t, open: k.o, high: k.h, low: k.l, close: k.c, volume: k.v ?? null }))
      } catch {
        skipped.push(comp.ticker)
        continue
      }
    }
    if (bars.length < 80) {
      skipped.push(comp.ticker)
      continue
    }
    replayed.push(comp.ticker)

    // ---- 3) walk forward: compute at each session from the PREFIX ONLY
    for (let k = 70; k < bars.length; k++) {
      const prefix = bars.slice(0, k + 1)
      const row = computeCompanySignalV2({
        bars: prefix,
        identity: { companyId: comp.id, ticker: comp.ticker, nameEn: comp.ticker, nameAr: null, sector: "replay", marketTier: "MAIN" },
        todaySession: prefix[k].ts,
      })
      stateCounts[row.state]++
      if (row.type) typeCounts[row.type] = (typeCounts[row.type] ?? 0) + 1

      // invariants on every published row
      if (row.state === "buy" && row.plan) {
        buySessions++
        const p = row.plan
        const close = row.lastClose ?? 0
        if (!(p.stop < p.entryLow && p.entryLow <= p.entryHigh && p.target1 > close)) {
          invariantViolations.push(`${comp.ticker}@${row.asOf}: stop=${p.stop} entry=[${p.entryLow},${p.entryHigh}] T1=${p.target1} close=${close}`)
        }
        const rrCalc = (p.target1 - (p.entryLow + p.entryHigh) / 2) / ((p.entryLow + p.entryHigh) / 2 - p.stop)
        if (Math.abs(rrCalc - p.riskReward) > 0.02) {
          invariantViolations.push(`${comp.ticker}@${row.asOf}: RR printed ${p.riskReward} vs computed ${rrCalc.toFixed(2)}`)
        }
        // ---- outcome walk (close-forward, honest ties counted as ambiguous)
        const future = bars.slice(k + 1, k + 21)
        let hit = false
        let stopped = false
        for (const f of future) {
          if (f.low <= p.stop) stopped = true
          if (f.high >= p.target1) hit = true
          if (stopped || hit) break
        }
        if (hit && !stopped) {
          t1Hits++
          const f10 = future[9]
          if (f10) t1Returns10.push(((f10.c - close) / close) * 100)
        } else if (stopped && !hit) stopFirsts++
        else stillOpen++
        if (buyExamples.length < 8 && (hit || stopped)) {
          buyExamples.push({ ticker: comp.ticker, asOf: row.asOf, type: row.type, entry: [p.entryLow, p.entryHigh], stop: p.stop, t1: p.target1, rr: p.riskReward, score: row.score, hit, stopped })
        }
      } else if (row.state === "near" && row.setup) {
        nearSessions++
        const act = row.setup.activation
        if (row.lastClose && Math.abs((act - row.lastClose) / row.lastClose) * 100 > 8) {
          invariantViolations.push(`${comp.ticker}@${row.asOf}: activation ${act} vs close ${row.lastClose} beyond 8%`)
        }
        const future5 = bars.slice(k + 1, k + 6)
        if (future5.length === 5) {
          nearTotal5++
          if (future5.some((f) => f.close >= act)) nearFired5++
        }
      } else if (row.state === "exit") {
        if (row.plan) invariantViolations.push(`${comp.ticker}@${row.asOf}: EXIT row carries a plan (short-selling leak)`)
        if (exitExamples.length < 5) exitExamples.push({ ticker: comp.ticker, asOf: row.asOf, type: row.type, score: row.score })
      }
    }
    await new Promise((r) => setTimeout(r, 120)) // polite pacing to prod
  }

  const report = {
    generatedAt: new Date().toISOString(),
    base: BASE,
    universeReplayed: replayed,
    skipped,
    sessionsReplayed: stateCounts.buy + stateCounts.near + stateCounts.wait + stateCounts.exit,
    stateCounts,
    typeCounts,
    invariants: {
      violations: invariantViolations,
      violationCount: invariantViolations.length,
    },
    outcomes: {
      buySessions,
      t1BeforeStop: t1Hits,
      stopBeforeT1: stopFirsts,
      neitherWithin20: stillOpen,
      medianReturn10AfterT1: median(t1Returns10),
      nearSessionsWith5Forward: nearTotal5,
      nearFiredWithin5: nearFired5,
    },
    examples: { buy: buyExamples, exit: exitExamples },
  }
  await import("node:fs").then((fs) => {
    fs.mkdirSync("reports", { recursive: true })
    fs.writeFileSync("reports/replay-signals-v2.json", JSON.stringify(report, null, 2))
  })

  console.log("\n================ REPLAY SUMMARY ================")
  console.log(`companies replayed: ${replayed.length} (skipped ${skipped.length})`)
  console.log(`state distribution: ${JSON.stringify(stateCounts)}`)
  console.log(`type distribution:  ${JSON.stringify(typeCounts)}`)
  console.log(`invariant violations: ${invariantViolations.length}`)
  console.log(`BUY outcomes: T1-before-stop ${t1Hits} / stop-first ${stopFirsts} / neither ${stillOpen}`)
  console.log(`NEAR fired within 5 sessions: ${nearFired5}/${nearTotal5}`)
  if (buyExamples.length) console.log("buy examples:", JSON.stringify(buyExamples.slice(0, 4), null, 1))
  if (exitExamples.length) console.log("exit examples:", JSON.stringify(exitExamples.slice(0, 3), null, 1))
  console.log("report: reports/replay-signals-v2.json")
}

function median(xs: number[]): number | null {
  if (!xs.length) return null
  const s = [...xs].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return Math.round(((s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2) * 100)) / 100
}

void main()
