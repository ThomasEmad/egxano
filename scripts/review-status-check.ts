// Production-grounded status check for the review findings (F03/F04/F07 etc.).
import { db } from "../src/lib/db"

async function main(): Promise<void> {
  const totalCompanies = await db.company.count()

  // F03 — companies with no price rows at all
  const withPrices = await db.marketPrice.findMany({ select: { companyId: true }, distinct: ["companyId"] })
  const withPricesSet = new Set(withPrices.map((r) => r.companyId))
  const noPrice = totalCompanies - withPricesSet.size

  // F04 — missing ISIN
  const nullIsin = await db.company.count({ where: { OR: [{ isin: null }, { isin: "" }] } })

  // F07 — open audit issues by severity + accounting (balance) identity issues
  const openIssues = await db.auditIssue.count({ where: { status: "open" } })
  const bySeverity: Record<string, number> = {}
  for (const sev of ["critical", "high", "medium", "low"]) {
    bySeverity[sev] = await db.auditIssue.count({ where: { status: "open", severity: sev } })
  }
  const accountingIssues = await db.auditIssue.count({ where: { status: "open", category: "accounting" } })

  // corrected values (manual corrections)
  const corrected = await db.financialValue.count({ where: { isManuallyCorrected: true } })
  const needsReview = await db.financialValue.count({ where: { validationStatus: "NEEDS_REVIEW" } })
  const failedValidation = await db.financialValue.count({ where: { validationStatus: "FAILED" } })

  // totals
  const reports = await db.financialReport.count()
  const values = await db.financialValue.count()
  const prices = await db.marketPrice.count()
  const calc = await db.calculatedMetric.count().catch(() => -1)

  console.log(JSON.stringify({ totalCompanies, withPrices: withPricesSet.size, noPrice, nullIsin, openIssues, bySeverity, accountingIssues, corrected, needsReview, failedValidation, reports, values, prices, calc }, null, 1))

  // latest audit run summary
  const lastRun = await db.auditRun.findFirst({ orderBy: { startedAt: "desc" } })
  if (lastRun) console.log("lastAuditRun:", JSON.stringify(lastRun).slice(0, 400))
}

void main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
