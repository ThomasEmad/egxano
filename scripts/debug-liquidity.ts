// Debug: replicate the liquidity-heatmap route's DB conditions step by step.
import { PrismaClient } from "@prisma/client"
const db = new PrismaClient()

const windowStart = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
console.log("windowStart:", windowStart.toISOString())

const total = await db.marketPrice.count()
console.log("marketPrice total rows:", total)

const priced = await db.marketPrice.count({ where: { asOf: { gte: windowStart }, price: { gt: 0 } } })
console.log("in window, price>0:", priced)

const nonDemo = await db.marketPrice.count({ where: { asOf: { gte: windowStart }, price: { gt: 0 }, isDemoData: false } })
console.log("+ isDemoData=false:", nonDemo)

const full = await db.marketPrice.count({
  where: { asOf: { gte: windowStart }, price: { gt: 0 }, isDemoData: false, company: { isActive: true, listingStatus: "LISTED" } },
})
console.log("+ company active LISTED:", full)

const sample = await db.marketPrice.findFirst({ select: { asOf: true, isDemoData: true, price: true, company: { select: { isActive: true, listingStatus: true, isDemoData: true } } } })
console.log("sample row:", sample)
await db.$disconnect()
