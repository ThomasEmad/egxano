import { PrismaClient } from "@prisma/client"
const db = new PrismaClient()

const byStatus = await db.calculatedMetric.groupBy({ by: ["valueStatus"], _count: true, where: { code: "dividend_yield" } })
console.log("dividend_yield status distribution:", byStatus.map((s) => `${s.valueStatus}:${s._count}`).join(" | "))
const total = await db.calculatedMetric.count({ where: { code: "dividend_yield" } })
console.log("total dividend_yield rows:", total)

const sample = await db.calculatedMetric.findMany({ where: { code: "dividend_yield" }, select: { value: true, valueStatus: true, statusDetail: true, periodType: true, fiscalYear: true }, take: 8, orderBy: { calculatedAt: "desc" } })
console.log("sample rows:", JSON.stringify(sample, null, 1))

// What valueStatus values exist generally?
const statuses = await db.calculatedMetric.groupBy({ by: ["valueStatus"], _count: true })
console.log("all metrics status distribution:", statuses.map((s) => `${s.valueStatus}:${s._count}`).join(" | "))
await db.$disconnect()
