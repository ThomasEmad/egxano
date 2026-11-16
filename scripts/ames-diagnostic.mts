// =============================================================================
// ames-diagnostic.mts — targeted diagnostic for ONE ticker against the REAL
// candle history (same Yahoo source production ingests).
//
// Run:  bun scripts/ames-diagnostic.mts [--tickers AMES,COMI]
//
// Prints: the engine row (state/score/plan/evidence) + the full resistance
// zone map above the close, so a "173 target from 54.15" class bug can be
// seen, fixed, and re-verified end to end.
// =============================================================================

import { computeCompanySignalV2 } from "@/lib/signals/engine"
import { buildZoneMap } from "@/lib/signals/levels"
import { computeMetrics } from "@/lib/signals/metrics"
import type { Bar } from "@/lib/signals/types"

const args = process.argv.slice(2)
function argOf(flag: string, fallback: string): string {
  const i = args.indexOf(flag)
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback
}
const TICKERS = argOf("--tickers", "AMES").split(",").map((s) => s.trim().toUpperCase())

const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36"

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

async function main() {
  for (const ticker of TICKERS) {
    console.log(`\n===== ${ticker} =====`)
    const bars = await yahooBars(ticker)
    const last = bars[bars.length - 1]
    console.log(`bars: ${bars.length}  last: ${last.ts}  close: ${last.close}`)
    const m = computeMetrics(bars)
    if (!m) {
      console.log("metrics unavailable")
      continue
    }
    const map = buildZoneMap(bars, m)
    const above = map.zones
      .filter((z) => z.kind === "resistance" && !z.broken && z.low > last.close)
      .sort((a, b) => a.low - b.low)
    console.log("resistance zones above the close (nearest first):")
    for (const z of above.slice(0, 6)) {
      const gap = (((z.low + z.high) / 2 - last.close) / last.close * 100).toFixed(1)
      console.log(`  ${z.low.toFixed(2)}–${z.high.toFixed(2)}  touches=${z.touches}  T1-mid gap=${gap}%`)
    }
    const row = computeCompanySignalV2({
      bars,
      identity: { companyId: ticker, ticker, nameEn: ticker, nameAr: null, sector: "diagnostic", marketTier: "MAIN" },
      todaySession: last.ts,
    })
    console.log("engine row:", JSON.stringify({
      state: row.state,
      type: row.type,
      score: row.score,
      plan: row.plan,
      setup: row.setup ? { activation: row.setup.activation, provisional: row.setup.provisional } : null,
      quality: row.quality,
    }, null, 2))
  }
}

await main()
