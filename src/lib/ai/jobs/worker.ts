// =============================================================================
// AI report generation — durable background jobs on Postgres.
// =============================================================================
//
// Why a DB queue (and not Redis/BullMQ): the deployment target is Vercel
// serverless (no long-running worker, Hobby plan) + an existing external
// health cron. A tiny lease-based table queue gives:
//   * duplicate prevention   — UNIQUE(reportKey) + conditional claim
//   * crash safety           — leases expire; stale jobs are re-claimed
//   * retry policy           — attempts counter + max attempts
//   * observability          — AiAnalysisEvent trail + AuditLog
// Reading reports never touches this system: readers query AiAnalysisReport
// directly (heavily indexed), fully decoupled from generation capacity.

import { db } from "@/lib/db"
import { audit } from "@/lib/audit"
import { buildReportContext, buildPromptPayload, type ReportContext } from "@/lib/ai/report/builder"
import { SYSTEM_PROMPT, AR_INSTRUCTION, EN_INSTRUCTION, LENGTH_BUDGET } from "@/lib/ai/report/prompt"
import { validateReport, buildRuleBasedReportMarkdown } from "@/lib/ai/report/validate"
import { orchestrate, AiUnavailableError } from "@/lib/ai/orchestrator/orchestrate"
import { RULE_BASED_MODEL } from "@/lib/ai/analysis-snapshot"
import { PROMPT_VERSION, CONFIG_VERSION } from "@/lib/ai/report/identity"
import { invalidateServerCache } from "@/lib/server-cache"

/**
 * Worker time window. Vercel serverless constrains `after()` to the host
 * invocation's maxDuration, so every kick path passes an EXPLICIT budget that
 * fits its window (POST after() ≈ 45s, health cron 60s → 50s, manual worker
 * 300s). The lease is sized so a live worker never outlives it.
 */
export const JOB_LEASE_MS = 90_000
export const DEFAULT_WORKER_BUDGET_MS = Math.min(
  Math.max(Number(process.env.AI_WORKER_BUDGET_MS || "") || 42_000, 20_000),
  80_000
)
/**
 * 5 attempts: 1×45s (POST after) + up to 3×24s (poll donations) + 50s
 * (health-cron worker). Short windows still make progress (fast providers);
 * only after ALL of them does the clearly-labeled degraded artifact serve.
 */
export const MAX_ATTEMPTS = 5
/** Worker instance id (diagnostics). */
const WORKER_ID = `w-${process.pid}-${Math.random().toString(36).slice(2, 8)}`

export type JobOutcome =
  | { status: "completed"; reportKey: string; degraded: boolean }
  | { status: "in_progress"; leasedByOther: boolean }
  | { status: "retry_scheduled"; error: string }
  | { status: "failed_permanent"; error: string }
  | { status: "no_data" }

/** Conditional claim — safe across concurrent serverless instances. */
async function claimJob(jobId: string): Promise<boolean> {
  const claimed = await db.aiAnalysisJob.updateMany({
    where: {
      id: jobId,
      status: { in: ["PENDING", "PROCESSING"] },
      attempts: { lt: MAX_ATTEMPTS },
      OR: [{ leaseUntil: null }, { leaseUntil: { lt: new Date() } }],
    },
    data: {
      status: "PROCESSING",
      leasedBy: WORKER_ID,
      leaseUntil: new Date(Date.now() + JOB_LEASE_MS),
      attempts: { increment: 1 },
      startedAt: new Date(),
    },
  })
  return claimed.count === 1
}

async function releaseJob(jobId: string, error: string, permanent: boolean): Promise<void> {
  const job = await db.aiAnalysisJob.findUnique({
    where: { id: jobId },
    select: { attempts: true, maxAttempts: true, reportKey: true, companyId: true },
  })
  if (!job) return
  if (!permanent && job.attempts < job.maxAttempts) {
    // retry with exponential backoff encoded in the lease (next claim waits it out)
    await db.aiAnalysisJob.update({
      where: { id: jobId },
      data: {
        status: "PENDING",
        leasedBy: null,
        leaseUntil: new Date(Date.now() + 15_000 * 2 ** job.attempts),
        lastError: error.slice(0, 500),
      },
    })
    await db.aiAnalysisEvent.create({ data: { companyId: job.companyId, reportKey: job.reportKey, kind: "RETRY_SCHEDULED", details: error.slice(0, 300) } })
  } else {
    await db.aiAnalysisJob.update({
      where: { id: jobId },
      data: { status: "FAILED", leasedBy: null, leaseUntil: null, lastError: error.slice(0, 500), finishedAt: new Date() },
    })
    await db.aiAnalysisEvent.create({ data: { companyId: job.companyId, reportKey: job.reportKey, kind: "FAILED", details: error.slice(0, 500) } })
    // keep the failed row for diagnostics; the sweeper deletes it after 24h
  }
}

async function persistCompletedReport(
  ctx: ReportContext,
  args: {
    content: string
    sections: Record<string, string>
    stance: string | null
    degraded: boolean
    providerId: string | null
    model: string | null
    tokensIn?: number
    tokensOut?: number
    latencyMs?: number
    attempt: number
    wordCount?: number
  }
): Promise<void> {
  await db.aiAnalysisReport.upsert({
    where: { reportKey: ctx.reportKey },
    create: {
      companyId: ctx.company.id,
      reportKey: ctx.reportKey,
      lang: ctx.lang,
      status: "COMPLETED",
      content: args.content,
      sections: JSON.stringify(args.sections),
      stance: args.stance,
      dataHash: ctx.financialDataHash,
      technicalHash: ctx.technical?.hash ?? null,
      priceAsOf: ctx.priceAsOf ? new Date(`${ctx.priceAsOf}T00:00:00Z`) : null,
      financialAsOf: ctx.financialAsOf ? new Date(`${ctx.financialAsOf}T00:00:00Z`) : null,
      periodKey: ctx.periodKey,
      dataCompleteness: JSON.stringify(ctx.completeness),
      promptVersion: PROMPT_VERSION,
      configVersion: CONFIG_VERSION,
      technicalVersion: ctx.technical?.snapshot.version ?? "none",
      provider: args.providerId,
      model: args.model,
      degraded: args.degraded,
      tokensIn: args.tokensIn ?? null,
      tokensOut: args.tokensOut ?? null,
      latencyMs: args.latencyMs ?? null,
      wordCount: args.wordCount ?? null,
      attempt: args.attempt,
      completedAt: new Date(),
    },
    update: {
      status: "COMPLETED",
      content: args.content,
      sections: JSON.stringify(args.sections),
      stance: args.stance,
      degraded: args.degraded,
      provider: args.providerId,
      model: args.model,
      completedAt: new Date(),
    },
  })
  // a fresh artifact must not wait out the 15s read-cache window
  invalidateServerCache()
}

function financialSummaryLines(ctx: ReportContext, lang: "ar" | "en"): string[] {
  try {
    const ext = JSON.parse(ctx.extendedMetricsJson) as {
      valuation?: Record<string, { value: number | null; unit: string; status: string }>
      health?: Record<string, { value: number | null; unit: string; status: string }>
    }
    const lines: string[] = []
    const unitSuffix = (unit: string): string => (unit === "PERCENT" ? "%" : unit === "RATIO" ? "x" : "")
    const push = (code: string, m: { value: number | null; unit: string; status: string }): void => {
      if (m.status !== "ok" || m.value === null) return
      lines.push(`${code}: ${m.value}${unitSuffix(m.unit)}`)
    }
    for (const [code, m] of Object.entries(ext.valuation ?? {})) push(code, m)
    for (const [code, m] of Object.entries(ext.health ?? {})) push(code, m)
    return lines.slice(0, 8)
  } catch {
    return []
  }
}

function technicalSummaryLines(ctx: ReportContext, lang: "ar" | "en"): string[] {
  const s = ctx.technical?.snapshot
  if (!s || !s.available) return []
  const out: string[] = []
  if (s.lastClose !== null) out.push(lang === "ar" ? `آخر إغلاق: ${s.lastClose} بتاريخ ${s.asOf}` : `Last close ${s.lastClose} on ${s.asOf}`)
  if (s.trend.alignment) out.push(`${lang === "ar" ? "الرصيف" : "Trend"}: ${s.trend.alignment}`)
  if (s.momentum.rsi14 !== null) out.push(`RSI(14): ${s.momentum.rsi14}`)
  if (s.fromHigh52wPct !== null) out.push(`${lang === "ar" ? "من قمة 52 أسبوعاً" : "From 52w high"}: ${s.fromHigh52wPct}%`)
  return out
}

/**
 * Process one job end-to-end. NEVER throws — all outcomes are returned so
 * callers (after(), cron, health kick) can log safely.
 */
export async function processJob(jobId: string, opts?: { budgetMs?: number }): Promise<JobOutcome> {
  const claimed = await claimJob(jobId)
  if (!claimed) return { status: "in_progress", leasedByOther: true }
  const job = await db.aiAnalysisJob.findUnique({ where: { id: jobId } })
  if (!job) return { status: "in_progress", leasedByOther: true }
  const attempt = job.attempts

  try {
    const company = await db.company.findUnique({
      where: { id: job.companyId },
      // MUST match resolveCompany's field set exactly — the report identity
      // hash covers sharesOutstanding/listingStatus via the financial
      // snapshot; a narrower select would drift the reportKey.
      select: { id: true, ticker: true, nameEn: true, nameAr: true, sector: true, industry: true, sharesOutstanding: true, listingStatus: true },
    })
    if (!company) {
      await releaseJob(jobId, "company disappeared", true)
      return { status: "failed_permanent", error: "company not found" }
    }
    const lang = job.lang === "ar" ? "ar" : "en"
    const ctx = await buildReportContext(company, lang)

    // Data identity drifted between enqueue and processing (a recompute or a
    // new price bar landed). The stale identity would never be read — finish
    // the job and let the next request enqueue the fresh key.
    if (ctx.reportKey !== job.reportKey) {
      await db.aiAnalysisEvent.create({
        data: { companyId: company.id, reportKey: job.reportKey, kind: "IDENTITY_DRIFT", details: `enqueue=${job.reportKey.slice(0, 12)} processing=${ctx.reportKey.slice(0, 12)}` },
      })
      await db.aiAnalysisJob.delete({ where: { id: jobId } })
      return { status: "completed", reportKey: ctx.reportKey, degraded: false }
    }

    if (!ctx.hasFinancialData) {
      await releaseJob(jobId, "NO_DATA: no verified financial statements", true)
      return { status: "no_data" }
    }

    const started = Date.now()
    try {
      const result = await orchestrate({
        system: SYSTEM_PROMPT,
        user:
          "Company report data (JSON):\n" +
          buildPromptPayload(ctx) +
          (lang === "ar" ? AR_INSTRUCTION : EN_INSTRUCTION) +
          LENGTH_BUDGET,
        kind: "report",
        companyId: company.id,
        reportKey: ctx.reportKey,
        timeoutMs: opts?.budgetMs ?? DEFAULT_WORKER_BUDGET_MS,
      })

      const validation = validateReport({ markdown: result.content }, { lang, hasFinancialData: ctx.hasFinancialData })
      if (!validation.ok) {
        // malformed output = provider failure → retry within the job policy
        throw new AiUnavailableError("all_providers_failed", `invalid output: ${validation.errors.join("; ")}`)
      }

      await persistCompletedReport(ctx, {
        content: result.content,
        sections: validation.sections!,
        stance: validation.stance ?? null,
        degraded: false,
        providerId: result.providerId,
        model: result.model,
        tokensIn: result.usage?.promptTokens,
        tokensOut: result.usage?.completionTokens,
        latencyMs: result.latencyMs,
        attempt,
        wordCount: validation.wordCount,
      })
      await db.aiAnalysisJob.delete({ where: { id: jobId } }).catch(() => {})
      await db.aiAnalysisEvent.create({
        data: { companyId: company.id, reportKey: ctx.reportKey, kind: "COMPLETED", details: `provider=${result.providerId} model=${result.model} ${Date.now() - started}ms words=${validation.wordCount}` },
      })
      await audit("AI_ANALYSIS", {
        actor: "system",
        entityType: "Company",
        entityId: company.id,
        details: `AI report completed (${lang}) via ${result.providerId}/${result.model} — key ${ctx.reportKey.slice(0, 12)}`,
      })
      return { status: "completed", reportKey: ctx.reportKey, degraded: false }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      const attemptsLeft = job.attempts < job.maxAttempts
      // Permanent failure → deterministic, clearly-labeled degraded artifact
      // so the user sees honest content instead of a dead tab (mirrors the
      // legacy product behavior).
      if (!attemptsLeft) {
        const markdown = buildRuleBasedReportMarkdown({
          companyName: ctx.company.nameEn,
          ticker: ctx.company.ticker,
          lang,
          financialSummary: financialSummaryLines(ctx, lang),
          technicalSummary: technicalSummaryLines(ctx, lang),
          limitations: ctx.completeness.limitations,
        })
        await persistCompletedReport(ctx, {
          content: markdown,
          sections: {},
          stance: "neutral",
          degraded: true,
          providerId: null,
          model: RULE_BASED_MODEL,
          attempt,
        })
        await db.aiAnalysisJob.delete({ where: { id: jobId } }).catch(() => {})
        await db.aiAnalysisEvent.create({
          data: { companyId: company.id, reportKey: ctx.reportKey, kind: "DEGRADED_FALLBACK", details: msg.slice(0, 300) },
        })
        await audit("AI_ANALYSIS", {
          actor: "system",
          entityType: "Company",
          entityId: company.id,
          details: `AI report degraded to rule-based (${lang}) — ${msg.slice(0, 200)}`,
        })
        return { status: "completed", reportKey: ctx.reportKey, degraded: true }
      }
      await releaseJob(jobId, msg, false)
      return { status: "retry_scheduled", error: msg }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    await releaseJob(jobId, msg, job.attempts >= job.maxAttempts).catch(() => {})
    return { status: "failed_permanent", error: msg }
  }
}

/**
 * Claim & process up to `limit` PENDING jobs (priority order). Used by the
 * cron worker endpoint and the health-kick path.
 */
export async function processPendingJobs(
  limit = 2,
  opts?: { budgetMs?: number }
): Promise<{ processed: number; outcomes: JobOutcome[] }> {
  const candidates = await db.aiAnalysisJob.findMany({
    where: {
      status: { in: ["PENDING", "PROCESSING"] },
      attempts: { lt: MAX_ATTEMPTS },
      OR: [{ leaseUntil: null }, { leaseUntil: { lt: new Date() } }],
    },
    orderBy: [{ priority: "asc" }, { createdAt: "asc" }],
    take: limit,
    select: { id: true },
  })
  const outcomes: JobOutcome[] = []
  for (const c of candidates) outcomes.push(await processJob(c.id, opts))
  return { processed: candidates.length, outcomes }
}

/**
 * Stale-job recovery + housekeeping sweep:
 *  - leases that expired while PROCESSING → back to PENDING
 *  - terminal FAILED rows older than 24h → deleted (queue stays small)
 */
export async function sweepJobs(): Promise<{ reclaimed: number; deleted: number }> {
  const now = new Date()
  const stale = await db.aiAnalysisJob.updateMany({
    where: { status: "PROCESSING", leaseUntil: { lt: new Date(now.getTime() - 30_000) } },
    data: { status: "PENDING", leasedBy: null, leaseUntil: null },
  })
  const dayAgo = new Date(now.getTime() - 24 * 3600_000)
  const dead = await db.aiAnalysisJob.findMany({
    where: { status: "FAILED", finishedAt: { lt: dayAgo } },
    select: { id: true },
    take: 50,
  })
  for (const j of dead) await db.aiAnalysisJob.delete({ where: { id: j.id } }).catch(() => {})
  if (stale.count > 0) {
    await db.aiAnalysisEvent.create({ data: { kind: "STALE_RECLAIMED", details: `count=${stale.count}` } })
  }
  return { reclaimed: stale.count, deleted: dead.length }
}
