// TEMP visual-check seed: two EGX sessions of MarketPrice rows across sectors
// so the sector-liquidity heatmap renders locally. Local DB only.
import { PrismaClient } from "@prisma/client"
const db = new PrismaClient()
const companies = await db.company.findMany({ take: 24, select: { id: true, sector: true } })
if (companies.length < 3) { console.log("too few companies:", companies.length); process.exit(0) }
const days = [new Date(Date.now() - 1 * 864e5), new Date(Date.now() - 2 * 864e5)]
await db.marketPrice.deleteMany({ where: { sourceName: "DEMO_VISUAL" } })
let n = 0
for (const [i, d] of days.entries()) {
  for (const [j, c] of companies.entries()) {
    await db.marketPrice.create({ data: {
      companyId: c.id, asOf: new Date(d.getTime() + (10 + j) * 60_000),
      price: 10 + (j % 9) * 3, volume: 50_000 + (j * 37_000) * (i === 0 ? 1.6 : 1),
      valueTraded: (10 + (j % 9) * 3) * (50_000 + (j * 37_000)) * (i === 0 ? 1.6 : 1),
      sourceName: "DEMO_VISUAL",
    } })
    n++
  }
}
console.log("seeded", n, "rows across", new Set(companies.map(c => c.sector)).size, "sectors")
await db.$disconnect()
