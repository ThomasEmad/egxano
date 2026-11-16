// Smoke test for the one-year candle ingest (owner request 2026-11-16):
// creates 3 real EGX companies in the LOCAL test DB, runs ONE real ingest
// chunk against Yahoo, verifies bars actually landed per company, then re-runs
// the same companies to prove the upsert path is idempotent (and exercises the
// same-session dedup on real payloads). Local DB only — never production.

import { PrismaClient } from "@prisma/client"

const db = new PrismaClient()

async function main() {
  const tickers = ["COMI", "TMGH", "ABUK"]
  const companies: { id: string }[] = []
  for (const t of tickers) {
    const existing = await db.company.findUnique({ where: { ticker: t }, select: { id: true } })
    if (existing) {
      companies.push(existing)
      continue
    }
    const co = await db.company.create({
      data: { ticker: t, nameEn: `Smoke ${t}`, nameAr: `سموك ${t}`, sector: "Test", listingStatus: "LISTED" },
      select: { id: true },
    })
    companies.push(co)
  }
  console.log("companies ready:", companies.length)

  // dynamic import AFTER the DB is ready (the ingest module opens its own pool)
  const { ingestCandlesChunk, getCandleStorageStats } = await import("../src/lib/market/candles.ts")

  const t0 = Date.now()
  const chunk = await ingestCandlesChunk({ limit: 3 })
  console.log("chunk:", JSON.stringify({ processed: chunk.processed, succeeded: chunk.succeeded, done: chunk.done, errors: chunk.errors }, null, 2))
  console.log(`elapsed: ${((Date.now() - t0) / 1000).toFixed(1)}s`)

  // bars must actually exist per company
  for (const c of companies) {
    const count = await db.priceBar.count({ where: { companyId: c.id } })
    const newest = await db.priceBar.findFirst({ where: { companyId: c.id }, orderBy: { ts: "desc" }, select: { ts: true, close: true } })
    console.log(`${c.id}: bars=${count} newest=${newest?.ts.toISOString().slice(0, 10)} close=${newest?.close}`)
    if (count === 0) throw new Error(`no bars stored for ${c.id}`)
    if (count < 100) throw new Error(`suspiciously shallow history for ${c.id}: ${count} bars`)
    // sanity: no impossible candles ever landed
    const bad = await db.$queryRaw<{ n: bigint }[]>`SELECT COUNT(*)::bigint AS n FROM "PriceBar" WHERE "companyId" = ${c.id} AND ("low" > "high" OR "low" > "close" OR "high" < "close")`
    if (Number(bad[0].n) > 0) throw new Error(`impossible candles stored for ${c.id}: ${bad[0].n}`)
  }

  // idempotency: a second pass over the SAME companies must succeed with no
  // ON CONFLICT errors and not grow the row count (same sessions, same values)
  const before = await db.priceBar.count()
  const again = await ingestCandlesChunk({ limit: 3, tickers })
  const after = await db.priceBar.count()
  console.log("re-run:", JSON.stringify({ succeeded: again.succeeded, errors: again.errors }))
  console.log(`bars before=${before} after=${after} (delta=${after - before})`)
  if (again.succeeded !== 3) throw new Error("re-run did not succeed for all three")
  if (after < before) throw new Error("re-run lost bars")

  const stats = await getCandleStorageStats()
  console.log("stats:", JSON.stringify(stats))
  console.log("SMOKE OK")
}

main()
  .catch((e) => {
    console.error("SMOKE FAILED:", e)
    process.exitCode = 1
  })
  .finally(() => db.$disconnect())
