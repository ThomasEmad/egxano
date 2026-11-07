// Targeted recompute driver — re-run the platform's recomputeCompany engine
// for a specific ticker list (e.g. right after a data import touched those
// companies). Same engine, same trust rules as the full cron recompute.
//
//   node_modules/.bin/tsx scripts/recompute-tickers.mts AALR,COMI,HDBK
import { db } from "../src/lib/db"
import { recomputeCompany } from "../src/lib/financial/recompute"

const arg = process.argv[2] ?? ""
const tickers = arg.split(",").map((t) => t.trim().toUpperCase()).filter(Boolean)
if (tickers.length === 0) {
  console.error("usage: tsx scripts/recompute-tickers.mts TICKER1,TICKER2,…")
  process.exit(1)
}

const companies = await db.company.findMany({
  where: { ticker: { in: tickers }, isActive: true },
  select: { id: true, ticker: true },
})
console.log(`recompute ${companies.length}/${tickers.length} tickers: ${companies.map((c) => c.ticker).join(",")}`)

let ok = 0, failed = 0
for (const c of companies) {
  try {
    const r = await recomputeCompany(c.id)
    ok++
    console.log(`  ${c.ticker}: ${r.calculatedMetrics} metrics, ${r.events ?? 0} events`)
  } catch (e) {
    failed++
    console.log(`  ${c.ticker}: FAILED — ${String(e?.message || e).slice(0, 140)}`)
  }
}
console.log(`done: ${ok} ok, ${failed} failed`)
await db.$disconnect()
