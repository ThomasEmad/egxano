// Integration test — executed against the LIVE database (not vitest, because
// it needs real Postgres). Proves the Phase 7/8 acceptance criteria:
//   1. N concurrent requestReport() calls for the same identity create
//      EXACTLY ONE job (unique-key dedup).
//   2. The conditional claim prevents duplicate processing under concurrency.
//   3. A completed report is then served as cache_hit to everyone.
//   4. One real end-to-end generation runs (real model, real data).
//
// Usage: node --import tsx scripts/test-ai-concurrency.mts
import { db } from "../src/lib/db"
import { requestReport } from "../src/lib/ai/jobs/enqueue"
import { processJob } from "../src/lib/ai/jobs/worker"

async function main() {
  const company = await db.company.findFirst({ where: { ticker: "COMI" }, select: { id: true, ticker: true } })
  if (!company) throw new Error("COMI not found")
  console.log(`company=${company.ticker}`)

  // ---------- 1. concurrent enqueue ----------
  const results = await Promise.all(
    Array.from({ length: 5 }, () =>
      requestReport(company.id, "en", { isPremium: true, requestedBy: "integration-test", skipQuota: true })
    )
  )
  const kinds = results.map((r) => r.kind)
  const reportKeys = new Set(results.filter((r) => "job" in r && r.job).map((r) => (r as { job: { reportKey: string } }).job.reportKey))
  const cacheHits = results.filter((r) => r.kind === "cache_hit").length
  const queued = results.filter((r) => r.kind === "queued").length
  const generating = results.filter((r) => r.kind === "generating").length
  const jobs = await db.aiAnalysisJob.findMany({ where: { reportKey: { in: [...reportKeys] } } })
  console.log({ kinds, reportKeys: reportKeys.size, cacheHits, queued, generating, jobRows: jobs.length })
  if (reportKeys.size !== 1) throw new Error("FAIL: identities diverged — context is not deterministic across calls")
  if (jobs.length !== 1) throw new Error(`FAIL: ${jobs.length} job rows for one identity — duplicate prevention broken`)
  if (cacheHits + queued + generating !== results.length) throw new Error("FAIL: unexpected enqueue kinds")

  // ---------- 2. concurrent processing (real generation once) ----------
  const jobId = (results.find((r) => "job" in r && r.job) as { job: { id: string } }).job.id
  const t0 = Date.now()
  const outcomes = await Promise.all(Array.from({ length: 3 }, () => processJob(jobId)))
  console.log({ outcomes: outcomes.map((o) => o.status), tookMs: Date.now() - t0 })
  const processed = outcomes.filter((o) => o.status === "completed")
  const others = outcomes.filter((o) => o.status === "in_progress")
  if (processed.length !== 1 || others.length !== 2) {
    throw new Error(`FAIL: expected exactly 1 completed + 2 in_progress, got ${outcomes.map((o) => o.status).join(",")}`)
  }
  const completed = processed[0]
  if (completed.status !== "completed") throw new Error("unreachable")
  console.log(`degraded=${completed.degraded}`)

  // ---------- 3. cache hit for everyone ----------
  const after = await Promise.all(
    Array.from({ length: 3 }, () =>
      requestReport(company.id, "en", { isPremium: true, requestedBy: "integration-test", skipQuota: true })
    )
  )
  const allCached = after.every((r) => r.kind === "cache_hit")
  console.log({ afterKinds: after.map((r) => r.kind) })
  if (!allCached) throw new Error("FAIL: completed report not served from cache")
  const remainingJobs = await db.aiAnalysisJob.count({ where: { reportKey: completed.reportKey } })
  if (remainingJobs !== 0) throw new Error("FAIL: job row leaked after completion")

  const report = await db.aiAnalysisReport.findUnique({ where: { reportKey: completed.reportKey } })
  console.log({
    report: report && {
      key: report.reportKey.slice(0, 12),
      model: report.model,
      degraded: report.degraded,
      words: report.wordCount,
      latencyMs: report.latencyMs,
      stance: report.stance,
      completeness: report.dataCompleteness?.slice(0, 120),
    },
  })
  if (!report?.content) throw new Error("FAIL: report content missing")
  console.log("ALL CONCURRENCY CHECKS PASSED ✅")
}

main()
  .catch((e) => {
    console.error("INTEGRATION TEST FAILED:", e)
    process.exitCode = 1
  })
  .finally(() => db.$disconnect())
