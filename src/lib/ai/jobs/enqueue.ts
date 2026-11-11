// =============================================================================
// Enqueue service — the ONLY path that starts a report generation.
// Guarantees: cache-first, single job per report identity, quota charged once.
// =============================================================================

import { db } from "@/lib/db"
import { buildReportContext, resolveCompany, type ReportContext } from "@/lib/ai/report/builder"
import { consumeSmartAnalysisUsage } from "@/lib/smart-analysis-usage"

export type EnqueueResult =
  | { kind: "not_found" }
  | { kind: "no_data" }
  | { kind: "cache_hit"; report: ReportRow }
  | { kind: "generating"; job: { id: string; reportKey: string }; ctx: ReportContext }
  | { kind: "queued"; job: { id: string; reportKey: string }; ctx: ReportContext }
  | { kind: "quota_exhausted"; usage: { usageCount: number; limit: number; remaining: number; resetAt: string | null } }

interface ReportRowLike {
  id: string
  reportKey: string
  content: string | null
  sections: string | null
  stance: string | null
  degraded: boolean
  model: string | null
  lang: string
  createdAt: Date
  completedAt: Date | null
  dataHash: string
  technicalHash: string | null
  priceAsOf: Date | null
  financialAsOf: Date | null
  dataCompleteness: string | null
  periodKey: string | null
  wordCount: number | null
}

export type ReportRow = ReportRowLike

/**
 * Request a report for (company, lang):
 *  1. resolve company
 *  2. build context once (also yields the deterministic reportKey)
 *  3. completed report with that key → cache_hit (zero inference)
 *  4. active job with that key → generating (duplicate prevention)
 *  5. quota (free tier) charged atomically ONLY when a job is about to exist
 *  6. insert job — UNIQUE(reportKey) closes the last race
 */
export async function requestReport(rawId: string, lang: "ar" | "en", opts: { isPremium: boolean; requestedBy: string | null; skipQuota?: boolean }): Promise<EnqueueResult> {
  const company = await resolveCompany(rawId)
  if (!company) return { kind: "not_found" }

  const ctx = await buildReportContext(company, lang)
  if (!ctx.hasFinancialData) return { kind: "no_data" }

  // 1) valid artifact?
  const existing = await db.aiAnalysisReport.findUnique({ where: { reportKey: ctx.reportKey } })
  if (existing && existing.status === "COMPLETED" && existing.content) {
    return { kind: "cache_hit", report: existing }
  }

  // 2) active job?
  const activeJob = await db.aiAnalysisJob.findUnique({ where: { reportKey: ctx.reportKey }, select: { id: true, status: true } })
  if (activeJob && activeJob.status !== "FAILED") {
    return { kind: "generating", job: { id: activeJob.id, reportKey: ctx.reportKey }, ctx }
  }

  // 3) quota — charged exactly once per actual generation enqueue
  if (!opts.isPremium && !opts.skipQuota) {
    const consumed = await consumeSmartAnalysisUsage(opts.requestedBy ?? "anonymous", 3)
    if (!consumed) {
      const record = await db.smartAnalysisUsage.findUnique({
        where: { userId_year_month: { userId: opts.requestedBy ?? "anonymous", year: new Date().getFullYear(), month: new Date().getMonth() + 1 } },
      })
      return {
        kind: "quota_exhausted",
        usage: {
          usageCount: record?.usageCount ?? 3,
          limit: 3,
          remaining: 0,
          resetAt: record?.resetAt?.toISOString() ?? new Date(new Date().getFullYear(), new Date().getMonth() + 1, 1).toISOString(),
        },
      }
    }
  }

  // 4) create the job — the unique key is the final race guard
  try {
    const job = await db.aiAnalysisJob.create({
      data: {
        reportKey: ctx.reportKey,
        companyId: company.id,
        lang,
        priority: 100,
        status: "PENDING",
        requestedBy: opts.requestedBy,
      },
      select: { id: true },
    })
    await db.aiAnalysisEvent.create({
      data: { companyId: company.id, reportKey: ctx.reportKey, kind: "ENQUEUED", details: `lang=${lang} by=${opts.requestedBy ? "user" : "system"}`, actor: opts.requestedBy },
    })
    return { kind: "queued", job: { id: job.id, reportKey: ctx.reportKey }, ctx }
  } catch (e) {
    // A concurrent request inserted the same identity first — that job wins.
    const job = await db.aiAnalysisJob.findUnique({ where: { reportKey: ctx.reportKey }, select: { id: true, status: true } })
    if (job && job.status !== "FAILED") return { kind: "generating", job: { id: job.id, reportKey: ctx.reportKey }, ctx }
    throw e
  }
}

/** Serialized shape returned to the frontend for a completed report. */
export function serializeReport(r: ReportRowLike) {
  return {
    content: r.content,
    createdAt: r.createdAt,
    completedAt: r.completedAt,
    periodKey: r.periodKey,
    dataHash: r.dataHash,
    technicalHash: r.technicalHash,
    priceAsOf: r.priceAsOf,
    financialAsOf: r.financialAsOf,
    model: r.model,
    lang: r.lang,
    degraded: r.degraded,
    stance: r.stance,
    wordCount: r.wordCount,
    completeness: r.dataCompleteness ? JSON.parse(r.dataCompleteness) : null,
    reportKey: r.reportKey,
  }
}
