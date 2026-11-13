/**
 * Read-only production AI diagnostics: provider ledger, events, reports coverage.
 * Usage: DATABASE_URL=<url> node scripts/ai-diagnose-prod.mjs
 */
import { PrismaClient } from "@prisma/client"

const prisma = new PrismaClient()
const since24 = new Date(Date.now() - 24 * 3600_000)
const since7d = new Date(Date.now() - 7 * 24 * 3600_000)

async function main() {
  // 1) provider usage last 7d by provider+ok
  const rows = await prisma.aiProviderUsage.groupBy({
    by: ["provider", "ok"],
    where: { createdAt: { gte: since7d }, kind: { in: ["chat", "report", "probe"] } },
    _count: { _all: true },
    _max: { createdAt: true },
  })
  console.log("== AiProviderUsage last 7d ==")
  for (const r of rows.sort((a, b) => a.provider.localeCompare(b.provider)))
    console.log(`  ${r.provider.padEnd(14)} ok=${r.ok ? 1 : 0} count=${String(r._count._all).padStart(4)} last=${r._max.createdAt?.toISOString()}`)

  // 2) last 10 provider failures
  const fails = await prisma.aiProviderUsage.findMany({
    where: { ok: false, createdAt: { gte: since7d } },
    orderBy: { createdAt: "desc" },
    take: 10,
    select: { provider: true, errorKind: true, kind: true, createdAt: true, latencyMs: true, reportKey: true },
  })
  console.log("\n== last failures ==")
  for (const f of fails)
    console.log(`  ${f.createdAt.toISOString()} ${f.provider} ${f.errorKind} ${String(f.latencyMs ?? "?")}ms ${f.reportKey?.slice(0, 40) ?? ""}`)

  // 3) recent analysis events
  const evs = await prisma.aiAnalysisEvent.findMany({
    where: { createdAt: { gte: since7d } },
    orderBy: { createdAt: "desc" },
    take: 12,
    select: { kind: true, reportKey: true, actor: true, createdAt: true, details: true },
  })
  console.log("\n== AiAnalysisEvent last 7d ==")
  for (const e of evs)
    console.log(`  ${e.createdAt.toISOString()} ${e.kind} ${e.reportKey?.slice(0, 46) ?? ""} :: ${(e.details || "").slice(0, 100)}`)

  // 4) jobs state
  const jobs = await prisma.aiAnalysisJob.groupBy({ by: ["status"], _count: { _all: true } })
  console.log("\n== jobs by status ==")
  for (const j of jobs) console.log(`  ${j.status}: ${j._count._all}`)
  const active = await prisma.aiAnalysisJob.findMany({
    where: { status: { in: ["PENDING", "PROCESSING"] } },
    take: 6,
    orderBy: { createdAt: "desc" },
    select: { id: true, reportKey: true, status: true, attempts: true, leaseUntil: true, createdAt: true },
  })
  for (const a of active) console.log(`  active: ${a.status} ${a.reportKey.slice(0, 50)} attempts=${a.attempts} lease=${a.leaseUntil?.toISOString() ?? "-"}`)

  // 5) reports coverage: how many companies have COMPLETED reports vs total with data
  const totalCompanies = await prisma.company.count()
  const doneReports = await prisma.aiAnalysisReport.groupBy({ by: ["lang"], where: { status: "COMPLETED" }, _count: { _all: true } })
  const reportedCompanies = await prisma.aiAnalysisReport.findMany({ where: { status: "COMPLETED" }, select: { companyId: true }, distinct: ["companyId"] })
  console.log("\n== coverage ==")
  console.log(`  companies total: ${totalCompanies}`)
  console.log(`  companies with COMPLETED report: ${reportedCompanies.length}`)
  for (const d of doneReports) console.log(`  lang=${d.lang}: ${d._count._all} reports`)

  // 6) pick candidates: companies with financial data but no report
  const withReports = new Set(reportedCompanies.map((r) => r.companyId))
  const companies = await prisma.company.findMany({
    select: { id: true, ticker: true, name: true },
    where: { deletedAt: null },
    take: 500,
  })
  const candidates = []
  for (const c of companies) {
    if (withReports.has(c.id)) continue
    const cnt = await prisma.financialReport.count({ where: { companyId: c.id, status: "APPROVED" } })
    if (cnt > 0) candidates.push({ ticker: c.ticker, name: c.name, reports: cnt })
  }
  console.log(`\n== fresh candidates (APPROVED data, no report) count=${candidates.length} ==`)
  for (const c of candidates.slice(0, 15)) console.log(`  ${c.ticker.padEnd(8)} ${c.name} (${c.reports} approved reports)`)
}

main()
  .catch((e) => { console.error("ERR:", e?.message?.slice(0, 300)); process.exitCode = 1 })
  .finally(() => prisma.$disconnect())
