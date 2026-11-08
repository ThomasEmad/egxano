import { NextRequest } from "next/server"
import { after } from "next/server"
import { db } from "@/lib/db"
import { requireAuth, unauthorizedResponse } from "@/lib/access"
import { processJob } from "@/lib/ai/jobs/worker"
import { cachedRead } from "@/lib/hot-read"

// GET /api/v1/companies/[id]/ai-analysis/status?lang=ar|en&jobRef=<id>
// Lightweight generation-status poll. Returns the latest job for the company
// + language; when a completed report exists for the job's identity it is
// returned immediately. A stale PENDING job (lease expired) is re-kicked via
// after() — the poll path is also the recovery path.

export const maxDuration = 30

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireAuth(req)
    if (!userId) return unauthorizedResponse()

    const { id } = await params
    const raw = decodeURIComponent(id)
    const upper = raw.toUpperCase()
    // cached company resolution (stable identity) — poll storms must not
    // spend a pool connection on this
    const company = await cachedRead(`ai-company:${raw}`, 60_000, async () => {
      return db.company.findFirst({
        where: { OR: [{ id: raw }, { ticker: upper }, { isin: upper }] },
        select: { id: true },
      })
    })
    if (!company) return Response.json({ error: "NOT_FOUND" }, { status: 404 })

    const langParam = req.nextUrl.searchParams.get("lang")?.toLowerCase() === "ar" ? "ar" : "en"
    const jobRef = req.nextUrl.searchParams.get("jobRef")

    // Polling status is user-independent per (company, lang, jobRef). A short
    // shared cache turns a 1000-user poll storm into ~1 DB query per window;
    // the poll interval (5s) is far larger than the cache window so the
    // indicator stays honest.
    const snap = await cachedRead(`ai-status:${company.id}:${langParam}:${jobRef ?? "latest"}`, 3_000, async () => {
      const job = await db.aiAnalysisJob.findFirst({
        where: {
          companyId: company.id,
          lang: langParam,
          ...(jobRef ? { id: jobRef } : {}),
        },
        orderBy: { createdAt: "desc" },
      })

      const report = await db.aiAnalysisReport.findFirst({
        where: { companyId: company.id, status: "COMPLETED", lang: langParam },
        orderBy: { createdAt: "desc" },
      })
      return { job, report }
    })
    const { job, report } = snap

    // Stale-job recovery: a PENDING/PROCESSING job whose lease expired is
    // re-claimed from this poll (fire-and-forget, never blocks the response).
    const leaseStale =
      job &&
      job.status !== "FAILED" &&
      (!job.leaseUntil || job.leaseUntil.getTime() < Date.now())
    if (leaseStale && job) {
      after(async () => {
        try {
          await processJob(job.id)
        } catch (e) {
          console.error("status-poll worker kick failed:", e instanceof Error ? e.message.slice(0, 200) : e)
        }
      })
    }

    return Response.json(
      {
        status: job
          ? job.status === "PENDING"
            ? "pending"
            : job.status === "PROCESSING"
              ? "processing"
              : "failed"
          : report
            ? "ready"
            : "none",
        jobRef: job?.id ?? null,
        reportKey: job?.reportKey ?? report?.reportKey ?? null,
        attempts: job?.attempts ?? 0,
        lastError: job?.lastError ?? null,
        queuedAt: job?.createdAt ?? null,
        report: report
          ? {
              content: report.content,
              createdAt: report.createdAt,
              completedAt: report.completedAt,
              periodKey: report.periodKey,
              dataHash: report.dataHash,
              technicalHash: report.technicalHash,
              priceAsOf: report.priceAsOf,
              financialAsOf: report.financialAsOf,
              model: report.model,
              lang: report.lang,
              degraded: report.degraded,
              stance: report.stance,
              wordCount: report.wordCount,
              completeness: report.dataCompleteness ? JSON.parse(report.dataCompleteness) : null,
              reportKey: report.reportKey,
            }
          : null,
      },
      { headers: { "Cache-Control": "no-store" } }
    )
  } catch (e) {
    console.error("ai-analysis status error:", e instanceof Error ? e.message.slice(0, 200) : e)
    return Response.json({ error: "STATUS_TEMPORARILY_UNAVAILABLE" }, { status: 503 })
  }
}
