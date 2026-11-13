/**
 * Enqueue a REAL AI report job using the EXACT production identity code.
 * Usage: DATABASE_URL=<prod> npx tsx scripts/ai-enqueue-e2e.mts <TICKER> <ar|en>
 * The production worker (health kick) then claims it — identity matches by
 * construction because this imports the same buildReportContext + versions
 * and reads the same production database.
 */
import { PrismaClient } from "@prisma/client"
import { buildReportContext, resolveCompany } from "../src/lib/ai/report/builder"

const prisma = new PrismaClient()

async function main() {
  const ticker = (process.argv[2] || "ABUK").toUpperCase()
  const lang = (process.argv[3] === "en" ? "en" : "ar") as "ar" | "en"

  const company = await resolveCompany(ticker)
  if (!company) {
    console.error("company not found:", ticker)
    process.exit(1)
  }
  const ctx = await buildReportContext(company, lang)
  console.log("reportKey:", ctx.reportKey)
  console.log("hasFinancialData:", ctx.hasFinancialData, "| periodKey:", ctx.periodKey, "| priceAsOf:", ctx.priceAsOf)

  if (!ctx.hasFinancialData) {
    console.error("NO_DATA for", ticker)
    process.exit(2)
  }

  // completed artifact already there?
  const existing = await prisma.aiAnalysisReport.findUnique({ where: { reportKey: ctx.reportKey }, select: { degraded: true, model: true, wordCount: true } })
  if (existing) {
    console.log("ALREADY_COMPLETED degraded=", existing.degraded, "model=", existing.model, "words=", existing.wordCount)
    return
  }

  // stale job row for this identity? delete it (it was the drifted one)
  await prisma.aiAnalysisJob.deleteMany({ where: { reportKey: ctx.reportKey } })

  const job = await prisma.aiAnalysisJob.create({
    data: {
      reportKey: ctx.reportKey,
      companyId: company.id,
      lang,
      priority: 50, // front of the queue
      status: "PENDING",
      requestedBy: "e2e-verification",
    },
    select: { id: true },
  })
  await prisma.aiAnalysisEvent.create({
    data: { companyId: company.id, reportKey: ctx.reportKey, kind: "ENQUEUED", details: `lang=${lang} by=e2e-verification (post-deploy proof)`, actor: "e2e-verification" },
  })
  console.log("ENQUEUED job:", job.id)
}

main()
  .catch((e) => { console.error("ERR:", e instanceof Error ? e.message.slice(0, 300) : e); process.exit(1) })
  .finally(() => prisma.$disconnect())
