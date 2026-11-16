// Visual-check seed for the sector liquidity heatmap (local dev SQLite only):
// demo companies across real EGX sectors + MarketPrice rows for three session
// days, with MULTIPLE pulls per company per day of CUMULATIVELY growing
// volume — exactly what the TradingView pipeline writes — so the last-pull
// dedupe is exercised for real. Cleanup: rows carry isDemoData=true.
import { PrismaClient } from "@prisma/client"
const db = new PrismaClient()

const SECTORS: Array<[string, number]> = [
  ["Banks", 22], ["Industrial", 18], ["Telecom", 12], ["Real Estate", 14],
  ["Food", 10], ["Healthcare", 8], ["Building Materials", 8], ["Travel & Leisure", 6],
  ["Financial Services", 8],
]

// route filters MarketPrice.isDemoData=false — mark rows by sourceName and
// clean by it instead (the demo DB is throwaway anyway)
await db.marketPrice.deleteMany({ where: { sourceName: "TRADINGVIEW_SCANNER" } })
await db.company.deleteMany({ where: { isDemoData: true } })

let n = 0
const created: Array<{ id: string; sector: string }> = []
for (const [sector, count] of SECTORS) {
  for (let i = 0; i < count; i++) {
    const ticker = `${sector.slice(0, 3).toUpperCase()}${i + 1}`
    const c = await db.company.create({
      data: { ticker, nameEn: `Demo ${ticker}`, nameAr: `شركة ${ticker}`, sector, isDemoData: true, isActive: true, sharesOutstanding: 5e7 + i * 1e6 },
      select: { id: true },
    })
    created.push({ id: c.id, sector })
    n++
  }
}
console.log("demo companies:", n)

// three session days (Sun–Thu): 2026-11-15 (Sun), 11-16 (Mon), 11-17 (Tue)
// today = 2026-11-17, prev = 2026-11-16, older = 11-15
const pulls = 3 // three scanner pulls per company per day
const rows: Array<{ companyId: string; asOf: Date; price: number; volume: number; valueTraded: number; sourceName: string; isDemoData: boolean }> = []
let r = 7 // deterministic pseudo-random
const rnd = (m: number) => { r = (r * 1103515245 + 12345) % 2147483648; return r % m }
for (const c of created) {
  const basePrice = 5 + rnd(60) + 2
  const baseVolume = 80_000 + rnd(400_000)
  for (const day of ["2026-11-15", "2026-11-16", "2026-11-17"]) {
    // per-sector day factors on the snapshot day → a REALISTIC mix of green
    // (inflow), red (outflow) and grey (no prior session) tiles
    const TODAY_FACTOR: Record<string, number> = {
      Banks: 1.35, "Real Estate": 1.4, Telecom: 1.1, Food: 0.6, Industrial: 0.7,
      "Building Materials": 0.8, "Travel & Leisure": 0.5, "Financial Services": 1.2, Healthcare: 1.0,
    }
    const dayFactor = day === "2026-11-17" ? (TODAY_FACTOR[c.sector] ?? 1) : day === "2026-11-16" ? 0.9 : 1
    // Healthcare + Travel & Leisure skip yesterday entirely → grey tiles today
    if (day === "2026-11-16" && (c.sector === "Healthcare" || c.sector === "Travel & Leisure")) continue
    let cum = 0
    for (let p = 0; p < pulls; p++) {
      cum += Math.round(baseVolume * (0.35 + rnd(20) / 100)) // incremental
      const asOf = new Date(`${day}T${String(9 + p).padStart(2, "0")}:15:00.000Z`) // 09:15/10:15/11:15 UTC ≈ 11:15/12:15/13:15 Cairo
      rows.push({
        companyId: c.id,
        asOf,
        price: Math.round((basePrice * (1 + rnd(10) / 100)) * 100) / 100,
        volume: cum,
        valueTraded: Math.round(basePrice * cum * dayFactor),
        sourceName: "TRADINGVIEW_SCANNER",
        isDemoData: false,
      })
    }
  }
}
await db.marketPrice.createMany({ data: rows })
console.log("marketPrice rows:", rows.length, "(3 pulls × 3 days ×", created.length, "companies)")
await db.$disconnect()
