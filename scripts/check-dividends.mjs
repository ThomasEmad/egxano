import { PrismaClient } from "@prisma/client"
const db = new PrismaClient()
const divCount = await db.dividend.count()
console.log("Dividend rows:", divCount)
const sample = await db.dividend.findMany({ take: 5, select: { companyId: true, exDate: true, paymentDate: true, amountPerShare: true, currency: true, status: true } })
console.log("sample:", JSON.stringify(sample, null, 1))
const withCompany = await db.dividend.findMany({ take: 3, include: { company: { select: { ticker: true } } } })
console.log("with ticker:", withCompany.map((d) => `${d.company?.ticker}: ${d.amountPerShare} @ ${d.exDate?.toISOString?.().slice(0, 10)}`).join(" | "))
await db.$disconnect()
