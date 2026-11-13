// Production ops runner — runs the SAME library code the admin routes use,
// directly against DATABASE_URL from the environment (session-mode connection
// for long jobs). Bun executes TypeScript natively:
//   DATABASE_URL="postgres://..." bun scripts/prod-ops.ts seed-tiers
//   DATABASE_URL="postgres://..." bun scripts/prod-ops.ts ingest-candles [maxChunks]
//   DATABASE_URL="postgres://..." bun scripts/prod-ops.ts stats
import { ingestCandlesChunk, getCandleStorageStats } from "@/lib/market/candles"
import { EGX30_TICKERS, EGX70_TICKERS, NILEX_TICKERS } from "@/lib/market/tiers"
import { db } from "@/lib/db"

const cmd = process.argv[2] ?? "stats"

async function seedTiers() {
  const lists: [string, string[]][] = [
    ["EGX30", EGX30_TICKERS],
    ["EGX70", EGX70_TICKERS],
    ["NILEX", NILEX_TICKERS],
  ]
  const report: Record<string, { matched: number; unmatched: string[] }> = {}
  for (const [tier, tickers] of lists) {
    const res = await db.company.updateMany({ where: { ticker: { in: tickers } }, data: { marketTier: tier } })
    const found = await db.company.findMany({ where: { ticker: { in: tickers } }, select: { ticker: true } })
    const foundSet = new Set(found.map((c) => c.ticker))
    report[tier] = { matched: res.count, unmatched: tickers.filter((t) => !foundSet.has(t)) }
    console.log(`${tier}: matched=${res.count} unmatched=[${report[tier]!.unmatched.join(",") || "none"}]`)
  }
  // OTC sweep — only rows still at the default MAIN, never overriding index membership.
  const otc = await db.company.updateMany({
    where: { listingStatus: { in: ["SUSPENDED", "DELISTED"] }, marketTier: "MAIN" },
    data: { marketTier: "OTC" },
  })
  console.log(`OTC sweep: ${otc.count} companies`)
  const counts = await db.company.groupBy({ by: ["marketTier"], _count: { _all: true }, where: { isActive: true } })
  console.log("TIER_COUNTS:", counts.map((c) => `${c.marketTier}:${c._count._all}`).join(" "))
}

async function ingestCandles(maxChunks = 40) {
  let cursor: string | undefined
  let total = 0
  let done = false
  for (let i = 0; i < maxChunks && !done; i++) {
    const r = await ingestCandlesChunk({ limit: 25, cursor })
    total += r.succeeded
    cursor = r.nextCursor ?? undefined
    done = r.done
    console.log(`chunk ${i + 1}: processed=${r.processed} succeeded=${r.succeeded} errors=${r.errors.length} done=${r.done}`)
    if (r.errors.length) console.log("  errors:", r.errors.map((e) => `${e.ticker}:${e.code}`).join(" "))
  }
  console.log(`TOTAL ingested this run: ${total}`)
  const stats = await getCandleStorageStats()
  console.log("STATS:", JSON.stringify(stats))
}

/** Retry only companies whose stored history is thin (<100 sessions) — the
 * typical Yahoo-429 casualties of a first full run. Slow pacing, small chunks. */
async function ingestMissing(maxChunks = 40) {
  const thin = await db.company.findMany({
    where: { listingStatus: "LISTED" },
    select: { id: true, ticker: true, _count: { select: { priceBars: true } } },
  })
  const tickers = thin.filter((c) => c._count.priceBars < 100).map((c) => c.ticker)
  console.log(`thin companies (<100 bars): ${tickers.length}`)
  if (tickers.length === 0) return
  let total = 0
  for (let i = 0; i < tickers.length; i += 10) {
    const batch = tickers.slice(i, i + 10)
    const r = await ingestCandlesChunk({ limit: 10, tickers: batch, pacingMs: 1500 })
    total += r.succeeded
    console.log(`batch ${i / 10 + 1}: succeeded=${r.succeeded}/${batch.length} errors=${r.errors.map((e) => e.ticker).join(",") || "none"}`)
  }
  console.log(`TOTAL retried OK: ${total}`)
}

if (cmd === "seed-tiers") await seedTiers()
else if (cmd === "ingest-candles") await ingestCandles(Number(process.argv[3] ?? 40))
else if (cmd === "ingest-missing") await ingestMissing(Number(process.argv[3] ?? 40))
else if (cmd === "stats") console.log("STATS:", JSON.stringify(await getCandleStorageStats()))
else console.log("unknown command")
await db.$disconnect()
