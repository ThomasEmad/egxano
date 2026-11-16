// Find NET_PROFIT rows whose original label says "إجمالي/اجمالي الربح" (gross profit)
// and value-level sanity violations (net > gross / net > operating income).
import { PrismaClient } from "@prisma/client"
const db = new PrismaClient()

async function main() {
  // 1) smoking gun: NET_PROFIT rows with gross-profit wording in the label
  const mislabeled = await db.$queryRawUnsafe(
    `SELECT fv.id, c.ticker, r."fiscalYear", r."periodLabel", fv."originalLabel", fv."normalizedValue" AS value
     FROM "FinancialValue" fv
     JOIN "Company" c ON c.id = fv."companyId"
     JOIN "FinancialReport" r ON r.id = fv."reportId"
     WHERE fv."metricCode" = 'NET_PROFIT'
       AND (fv."originalLabel" LIKE '%اجمالي%' OR fv."originalLabel" LIKE '%إجمالي%' OR fv."originalLabel" LIKE '%الإجمالي%')
     ORDER BY c.ticker, r."fiscalYear" DESC
     LIMIT 40`
  ) as Array<{ ticker: string; fiscalYear: number; periodLabel: string; originalLabel: string; value: number }>
  console.log(`=== NET_PROFIT rows with gross wording: ${mislabeled.length}`)
  for (const r of mislabeled) console.log(r.ticker, r.fiscalYear, r.periodLabel, "|", r.originalLabel.slice(0, 60), "=", r.value)

  // 2) physics violation: NET_PROFIT > GROSS_PROFIT / OPERATING_INCOME same period (normalized EGP)
  const violators = await db.$queryRawUnsafe(
    `SELECT c.ticker, r."fiscalYear", r."periodLabel", n."normalizedValue" AS net, g."normalizedValue" AS gross, o."normalizedValue" AS opinc
     FROM "FinancialValue" n
     JOIN "Company" c ON c.id = n."companyId"
     JOIN "FinancialReport" r ON r.id = n."reportId"
     LEFT JOIN "FinancialValue" g ON g."companyId" = n."companyId" AND g."metricCode"='GROSS_PROFIT'
       AND g."reportId" = n."reportId" AND g."subPeriod" = n."subPeriod"
     LEFT JOIN "FinancialValue" o ON o."companyId" = n."companyId" AND o."metricCode"='OPERATING_INCOME'
       AND o."reportId" = n."reportId" AND o."subPeriod" = n."subPeriod"
     WHERE n."metricCode"='NET_PROFIT' AND n."normalizedValue" > 0
       AND ((g."normalizedValue" IS NOT NULL AND g."normalizedValue" > 0 AND n."normalizedValue" > g."normalizedValue")
         OR (o."normalizedValue" IS NOT NULL AND o."normalizedValue" > 0 AND n."normalizedValue" > o."normalizedValue"))
     ORDER BY c.ticker, r."fiscalYear" DESC
     LIMIT 40`
  ) as Array<{ ticker: string; fiscalYear: number; periodLabel: string; net: number; gross: number | null; opinc: number | null }>
  console.log(`\n=== net > gross / net > operating violations: ${violators.length}`)
  for (const r of violators) console.log(r.ticker, r.fiscalYear, r.periodLabel, "net=", r.net, "gross=", r.gross, "op=", r.opinc)

  // 3) distribution: how many NET_PROFIT rows total (context for scale)
  const [{ count }] = await db.$queryRawUnsafe(`SELECT COUNT(*)::int AS count FROM "FinancialValue" WHERE "metricCode"='NET_PROFIT'`) as Array<{ count: number }>
  console.log(`\ntotal NET_PROFIT rows: ${count}`)
  await db.$disconnect()
}
main().catch((e) => { console.error(e); process.exit(1) })
