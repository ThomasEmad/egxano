import { readFileSync, writeFileSync, existsSync } from "node:fs"
import { db } from "../src/lib/db"
import { recomputeCompany } from "../src/lib/financial/recompute"

const CUTOFF = new Date(process.argv[2] ?? Date.now() - 60 * 60 * 1000)
const stale = await db.$queryRawUnsafe(
  `SELECT DISTINCT cm."companyId", c.ticker, max(cm."calculatedAt") AS last
   FROM "CalculatedMetric" cm JOIN "Company" c ON c.id = cm."companyId"
   WHERE c."isActive" = true AND c."isDemoData" = false
   GROUP BY cm."companyId", c.ticker HAVING max(cm."calculatedAt") < $1`,
  CUTOFF,
)
console.log(`stale companies (last recompute < ${CUTOFF.toISOString()}): ${stale.length}`)
let done = 0
for (const s of stale) {
  try {
    const r = await recomputeCompany(s.companyId)
    done++
    console.log(`  ${s.ticker}: ${r.calculatedMetrics} metrics`)
  } catch (e) {
    console.log(`  ${s.ticker}: FAILED AGAIN — ${String(e?.message || e).slice(0, 120)}`)
  }
}
console.log(`redone: ${done}/${stale.length}`)
await db.$disconnect()
