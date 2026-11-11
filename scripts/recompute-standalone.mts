// Standalone full recompute driver — runs the platform's own recomputeCompany
// engine per active company WITHOUT the Vercel 300s function cap.
//
//   node_modules/.bin/tsx scripts/recompute-standalone.ts --budget-seconds=520
//
// Resumable: a checkpoint file (reports/recompute-checkpoint.json) records the
// index of the next company to process; re-run until it reports "ALL DONE".
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs"
import { db } from "../src/lib/db"
import { recomputeCompany } from "../src/lib/financial/recompute"

const BUDGET_MS = Number((process.argv.find((a) => a.startsWith("--budget-seconds=")) ?? "=520").split("=")[1]) * 1000

const CHECKPOINT = "reports/recompute-checkpoint.json"
mkdirSync("reports", { recursive: true })
const cp = existsSync(CHECKPOINT) ? JSON.parse(readFileSync(CHECKPOINT, "utf8")) : { next: 0 }

const companies = await db.company.findMany({
  where: { isActive: true, isDemoData: false },
  select: { id: true, ticker: true },
  orderBy: { id: "asc" },
})
console.log(`recompute driver: ${companies.length} companies, resuming at #${cp.next}, budget ${BUDGET_MS / 1000}s`)

const t0 = Date.now()
let i = cp.next
let metrics = 0, events = 0, periods = 0, failed = 0
for (; i < companies.length; i++) {
  if (Date.now() - t0 > BUDGET_MS) { console.log(`budget exhausted at #${i} — checkpoint saved`); break }
  const c = companies[i]
  try {
    const r = await recomputeCompany(c.id)
    metrics += r.calculatedMetrics
    events += r.events.length
    periods += r.periods.length
    if ((i - cp.next) % 10 === 9) console.log(`  ${i + 1}/${companies.length} done (${c.ticker}: ${r.calculatedMetrics} metrics, ${r.events.length} events)`)
  } catch (e) {
    failed++
    console.log(`  ${c.ticker}: FAILED — ${String(e?.message || e).slice(0, 160)}`)
  }
  writeFileSync(CHECKPOINT, JSON.stringify({ next: i + 1 }))
}

console.log(`processed #${cp.next}..#${i} = ${i - cp.next} companies (failed ${failed}) | metrics ${metrics}, events ${events}, periods ${periods}`)
if (i >= companies.length) {
  console.log("ALL DONE — clearing checkpoint")
  writeFileSync(CHECKPOINT, JSON.stringify({ next: 0 }))
}
await db.$disconnect()
