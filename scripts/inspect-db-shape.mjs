// Inspect the database the local .env points at: counts, latest price, plans, tiers.
// Prints NO credentials. Run: node --env-file=.env scripts/inspect-db-shape.mjs
import { PrismaClient } from "@prisma/client"

const db = new PrismaClient()
try {
  const companies = await db.company.count()
  const active = await db.company.count({ where: { isActive: true } })
  const bars = await db.priceBar.count()
  const last = await db.marketPrice.findFirst({ orderBy: { asOf: "desc" }, select: { asOf: true } })
  const plans = await db.plan.findMany({ select: { name: true, price: true, isActive: true, offerPrice: true, offerActive: true } })
  const nilex = await db.company.count({ where: { marketTier: "NILEX" } })
  const tiers = await db.$queryRawUnsafe('SELECT "marketTier", COUNT(*)::int AS n FROM "Company" GROUP BY "marketTier" ORDER BY n DESC')
  const settings = await db.setting.findMany({ where: { key: { in: ["PAYMENT_INSTRUCTIONS", "INSTAPAY_QR_URL", "PAYMENT_PHONE", "PREMIUM_PRICE"] } }, select: { key: true } })
  const briefingTables = await db.$queryRawUnsafe("SELECT COUNT(*)::int AS n FROM information_schema.tables WHERE table_name IN ('StockBriefing','BriefingTrial')")
  const subs = await db.subscription.findMany({ where: { status: "ACTIVE" }, select: { planId: true }, take: 5 })
  console.log(JSON.stringify({ companies, active, bars, lastPrice: last?.asOf ?? null, plans, nilex, tiers, paymentSettings: settings, briefingTables, activeSubs: subs.length }, null, 1))
} catch (e) {
  console.error("DB_ERROR:", String(e?.message ?? e).slice(0, 400))
  process.exitCode = 1
} finally {
  await db.$disconnect()
}
