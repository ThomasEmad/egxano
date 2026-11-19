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
 * Cheap quota PRE-CHECK for the route (2026-11-19): the expensive report used
 * to be built BEFORE any quota enforcement — a caller with no quota left paid
 * the full build cost and only then got the 429. True when the caller may
 * reach a fresh build: premium, OR the stock is already in today's dedup set
 * (same-stock re-analysis stays free), OR at least one daily unit remains.
 * Read-only — never consumes; the authoritative atomic consume still runs
 * after the build, so an invalid company never burns quota.
 */
export async function positionReviewQuotaAllows(userId: string, isPremium: boolean, companyId: string): Promise<boolean> {
  if (isPremium) return true
  const day = effectiveEgxSessionDate(new Date())
  const record = await db.positionReviewUsage.findUnique({
    where: { userId_day: { userId, day } },
  })
  if (!record) return true // no usage today — quota intact
  if (parseIds(record.companyIds).includes(companyId)) return true // same-stock re-analysis is free
  return record.usageCount < POSITION_REVIEW_FREE_DAILY_LIMIT
}

/**
 * Atomic quota consumption with SAME-STOCK dedup (owner semantics: "سهمين
 * بس في اليوم" = two DIFFERENT stocks — re-analyzing a stock already analyzed
 * today never burns a second unit).
 *
 * LOST-UPDATE FIX (2026-11-19): the old shape consumed with a bare conditional
 * increment and THEN appended the company id in a second read-modify-write
 * (`appendId`) whose failure was swallowed — concurrent consumes lost ids, and
 * a lost id silently charged the user for re-analyzing a stock they had
 * already analyzed today (breaking the same-stock-is-free mandate). Now the
 * id merge and the count bump persist in ONE atomic guarded update: the
 * `usageCount` equality in the where-clause is an optimistic lock, so a
 * concurrent consume that wrote between our read and our write makes the
 * guard miss and the loop retries against the fresh row — no id and no charge
 * is lost. The create branch handles the missing row; its unique-violation
 * retry collapses concurrent creates into the same guarded loop.
 * Returns the quota snapshot AFTER the consume, or null when the daily limit
 * is already exhausted (and the stock is not in today's set).
 */
export async function consumePositionReviewUsage(userId: string, isPremium: boolean, companyId: string): Promise<DailyQuota | null> {
  if (isPremium) return getPositionReviewQuota(userId, true)
  const day = effectiveEgxSessionDate(new Date())

  for (let attempt = 0; attempt < 4; attempt++) {
    const existing = await db.positionReviewUsage.findUnique({ where: { userId_day: { userId, day } } })
    if (existing) {
      const ids = parseIds(existing.companyIds)
      // dedup fast path: the same stock analyzed again today is free
      if (ids.includes(companyId)) return quotaFrom(existing.usageCount)
      if (existing.usageCount >= POSITION_REVIEW_FREE_DAILY_LIMIT) return null
      // ONE atomic write: bump the count and merge the id together, guarded by
      // the usageCount read (optimistic lock) — a concurrent consume between
      // read and write makes the guard miss and the loop retries with the
      // fresh row, so neither the id list nor the charge is lost.
      const merged = ids.includes(companyId) ? ids : [...ids, companyId].slice(-50)
      const bumped = await db.positionReviewUsage.updateMany({
        where: { userId, day, usageCount: existing.usageCount },
        data: { usageCount: { increment: 1 }, companyIds: JSON.stringify(merged) },
      })
      if (bumped.count === 1) return quotaFrom(existing.usageCount + 1)
      continue // lost the race to a concurrent consume — re-read and retry
    }
    try {
      const created = await db.positionReviewUsage.create({
        data: { userId, day, usageCount: 1, companyIds: JSON.stringify([companyId]) },
      })
      return quotaFrom(created.usageCount)
    } catch {
      // a concurrent request created the row (and consumed a unit) — the loop
      // retries against its committed row
    }
  }

  // Pathologically hot user lost every optimistic retry: fall back to the bare
  // conditional increment so the LIMIT verdict stays exact — the id list is
  // best-effort here (one user, briefly), with a FRESH read to minimize loss.
  const bumped = await db.positionReviewUsage.updateMany({
    where: { userId, day, usageCount: { lt: POSITION_REVIEW_FREE_DAILY_LIMIT } },
    data: { usageCount: { increment: 1 } },
  })
  if (bumped.count !== 1) return null
  const row = await db.positionReviewUsage.findUnique({ where: { userId_day: { userId, day } } })
  const ids = parseIds(row?.companyIds)
  if (row && !ids.includes(companyId)) {
    await db.positionReviewUsage.update({
      where: { userId_day: { userId, day } },
      data: { companyIds: JSON.stringify([...ids, companyId].slice(-50)) },
    }).catch(() => undefined) // the limit verdict is already committed — list is best-effort here
  }
  return quotaFrom(row?.usageCount ?? POSITION_REVIEW_FREE_DAILY_LIMIT)
}

function parseIds(raw: string | undefined | null): string[] {
  try {
    const arr = raw ? (JSON.parse(raw) as unknown) : []
    return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === "string") : []
  } catch {
    return []
  }
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
