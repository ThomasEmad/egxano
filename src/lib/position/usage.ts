// =============================================================================
// Position-review daily quota (owner mandate 2026-11-17): 2 stocks/day on the
// free plan, unlimited for Premium. Mirrors the atomic-consume pattern of
// smart-analysis-usage.ts (conditional updateMany = one indivisible
// check-and-increment, create-race retry) but with a DAILY window keyed on
// the EGX session date (Africa/Cairo) so it rolls over with the trading day.
// =============================================================================

import { db } from "@/lib/db"
import { effectiveEgxSessionDate } from "@/lib/market/egx-session"

/** Free-plan daily limit — two analyzed stocks per day. */
export const POSITION_REVIEW_FREE_DAILY_LIMIT = 2

export interface DailyQuota {
  day: string
  used: number
  limit: number
  remaining: number
  unlimited: boolean
}

export async function getPositionReviewQuota(userId: string, isPremium: boolean): Promise<DailyQuota> {
  const day = effectiveEgxSessionDate(new Date())
  if (isPremium) {
    return { day, used: 0, limit: Number.POSITIVE_INFINITY, remaining: Number.POSITIVE_INFINITY, unlimited: true }
  }
  const record = await db.positionReviewUsage.findUnique({
    where: { userId_day: { userId, day } },
  })
  const used = record?.usageCount ?? 0
  return { day, used, limit: POSITION_REVIEW_FREE_DAILY_LIMIT, remaining: Math.max(0, POSITION_REVIEW_FREE_DAILY_LIMIT - used), unlimited: false }
}

/**
 * Atomic quota consumption with SAME-STOCK dedup (owner semantics: "سهمين
 * بس في اليوم" = two DIFFERENT stocks — re-analyzing a stock already analyzed
 * today never burns a second unit). Race-safe like consumeSmartAnalysisUsage():
 * the conditional updateMany makes the check and the increment one write; the
 * create branch handles the missing row and the retry collapses concurrent
 * creates. Returns the quota snapshot AFTER the consume, or null when the
 * daily limit is already exhausted (and the stock is not in today's set).
 */
export async function consumePositionReviewUsage(userId: string, isPremium: boolean, companyId: string): Promise<DailyQuota | null> {
  if (isPremium) return getPositionReviewQuota(userId, true)
  const day = effectiveEgxSessionDate(new Date())

  const readRow = () =>
    db.positionReviewUsage.findUnique({ where: { userId_day: { userId, day } } })

  // dedup fast path: the same stock analyzed again today is free
  const existing = await readRow()
  const parsedIds = parseIds(existing?.companyIds)
  if (existing && parsedIds.includes(companyId)) {
    return quotaFrom(existing.usageCount)
  }

  const bumped = await db.positionReviewUsage.updateMany({
    where: { userId, day, usageCount: { lt: POSITION_REVIEW_FREE_DAILY_LIMIT } },
    data: { usageCount: { increment: 1 } },
  })
  if (bumped.count === 1) {
    await appendId(userId, day, companyId, parsedIds)
    return quotaFrom((existing?.usageCount ?? 0) + 1)
  }

  try {
    await db.positionReviewUsage.create({
      data: { userId, day, usageCount: 1, companyIds: JSON.stringify([companyId]) },
    })
    return quotaFrom(1)
  } catch {
    // a concurrent request created the row (and consumed a unit) — retry the
    // conditional increment against its committed row
    const retry = await db.positionReviewUsage.updateMany({
      where: { userId, day, usageCount: { lt: POSITION_REVIEW_FREE_DAILY_LIMIT } },
      data: { usageCount: { increment: 1 } },
    })
    if (retry.count !== 1) return null
    await appendId(userId, day, companyId, parseIds((await readRow())?.companyIds))
    return quotaFrom((await readRow())?.usageCount ?? POSITION_REVIEW_FREE_DAILY_LIMIT)
  }
}

function parseIds(raw: string | undefined | null): string[] {
  try {
    const arr = raw ? (JSON.parse(raw) as unknown) : []
    return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === "string") : []
  } catch {
    return []
  }
}

async function appendId(userId: string, day: string, companyId: string, prior: string[]): Promise<void> {
  const ids = prior.includes(companyId) ? prior : [...prior, companyId]
  await db.positionReviewUsage.update({
    where: { userId_day: { userId, day } },
    data: { companyIds: JSON.stringify(ids.slice(-50)) },
  }).catch(() => undefined) // the limit verdict is already committed — list is best-effort
}

function quotaFrom(used: number): DailyQuota {
  return {
    day: effectiveEgxSessionDate(new Date()),
    used,
    limit: POSITION_REVIEW_FREE_DAILY_LIMIT,
    remaining: Math.max(0, POSITION_REVIEW_FREE_DAILY_LIMIT - used),
    unlimited: false,
  }
}
