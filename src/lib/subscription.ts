// Subscription helper — single source of truth for premium status.

import { db } from "@/lib/db"
import { TRIAL_DURATION_DAYS, TRIAL_EPOCH_ISO, type PlanId } from "@/lib/plans/entitlements"

export type SubscriptionStatus = "PENDING" | "ACTIVE" | "EXPIRED" | "CANCELLED" | "REJECTED"

export interface SubscriptionInfo {
  id: string
  status: SubscriptionStatus
  planName: string
  /** Raw DB price of the plan row — lets callers re-resolve premium truth. */
  planPrice?: number
  startDate: string | null
  endDate: string | null
  activatedAt: string | null
  activatedBy: string | null
  cancelledAt: string | null
  notes: string | null
}

export interface SubscriptionSummary {
  isPremium: boolean
  subscription: SubscriptionInfo | null
}

export async function getUserSubscription(userId: string): Promise<SubscriptionInfo | null> {
  const sub = await db.subscription.findUnique({
    where: { userId },
    include: { plan: { select: { name: true, price: true } } },
  })
  if (!sub) return null
  return {
    id: sub.id,
    status: sub.status as SubscriptionStatus,
    planName: sub.plan.name,
    planPrice: sub.plan.price,
    startDate: sub.startDate?.toISOString() ?? null,
    endDate: sub.endDate?.toISOString() ?? null,
    activatedAt: sub.activatedAt?.toISOString() ?? null,
    activatedBy: sub.activatedBy ?? null,
    cancelledAt: sub.cancelledAt?.toISOString() ?? null,
    notes: sub.notes ?? null,
  }
}

// =============================================================================
// Plan resolution — ONE function both the UI-facing summary and the API gates
// derive premium truth from. History: `getSubscriptionSummary.isPremium` used
// to accept ANY active row (even a literal FREE plan row) while
// `getActivePlanId` mapped by exact plan NAME (unknown names stayed FREE unless
// price > 0) — a premium UI with a free API, i.e. "premium user sees only the
// fixed free set on the signals board". Both now call resolvePlanIdFromRow.
// =============================================================================

/** Canonical plan names + the legacy aliases that must keep resolving (paid). */
const PLAN_NAME_ALIASES: Record<string, PlanId> = {
  PRO: "PRO",
  // Retired paid tiers keep resolving to a PAID plan so existing subscribers
  // never silently drop to the free tier and PLANS[...] lookups never miss.
  PRO_PLUS: "PRO",
  PROPLUS: "PRO",
  PLUS: "PRO",
  PRO_3M: "PRO_3M",
  PREMIUM: "PRO",
  PREMIUM_PLUS: "PRO",
  FREE: "FREE",
}

/**
 * Resolve a DB plan row to the canonical PlanId.
 * - Name is normalized (trim/uppercase/space-hyphen→underscore) then matched
 *   against canonical names + legacy aliases (the retired "PREMIUM" row, etc.).
 * - Any unknown name with price > 0 still means a paying user → PRO.
 * - A plan named FREE (or an unknown free row) is never premium.
 */
export function resolvePlanIdFromRow(plan: { name: string; price: number | null } | null | undefined): PlanId {
  if (!plan || typeof plan.name !== "string") return "FREE"
  const norm = plan.name.trim().toUpperCase().replace(/[\s-]+/g, "_")
  const byName = PLAN_NAME_ALIASES[norm]
  if (byName) return byName
  if (typeof plan.price === "number" && plan.price > 0) return "PRO"
  return "FREE"
}

/** Is the given subscription row "premium right now" (active + not expired)? */
function subscriptionCurrentlyActive(sub: { status: string; endDate: Date | string | null }): boolean {
  if (sub.status !== "ACTIVE") return false
  if (!sub.endDate) return true
  return new Date(sub.endDate) >= new Date()
}

// =============================================================================
// FULL-FEATURE FREE TRIAL MONTH (2026-11-16 owner mandate): ANY user gets one
// month of the entire product. Keyed off the account's createdAt — NO DB
// subscription row, no migration, no race with the paid flows:
//   • a NEW account trials from its own signup date;
//   • accounts created BEFORE the feature's deploy get a full 30 days from
//     TRIAL_EPOCH (never a prorated remainder — "لاي مستخدم");
//   • an ACTIVE PAID subscription always wins (a subscriber's plan name is
//     what the admin sees; the trial never overrides it).
// Trial resolution rides the same hot-path caches as plan resolution (60s
// bounded staleness — the same trade-off every gate already accepts).
// =============================================================================

/** Trial end for an account: signup + 30d, floored at epoch + 30d. */
export function trialEndsAt(createdAt: Date): Date {
  const bySignup = new Date(createdAt.getTime() + TRIAL_DURATION_DAYS * 86_400_000)
  const byEpoch = new Date(Date.parse(TRIAL_EPOCH_ISO) + TRIAL_DURATION_DAYS * 86_400_000)
  return bySignup > byEpoch ? bySignup : byEpoch
}

export interface TrialInfo {
  active: boolean
  endsAt: string | null
  daysLeft: number | null
}

export async function getTrialInfo(userId: string): Promise<TrialInfo> {
  const user = await db.user.findUnique({ where: { id: userId }, select: { createdAt: true } })
  if (!user) return { active: false, endsAt: null, daysLeft: null }
  const end = trialEndsAt(user.createdAt)
  const remainingMs = end.getTime() - Date.now()
  if (remainingMs <= 0) return { active: false, endsAt: null, daysLeft: null }
  return {
    active: true,
    endsAt: end.toISOString(),
    daysLeft: Math.max(1, Math.ceil(remainingMs / 86_400_000)),
  }
}

const trialCache = new Map<string, { value: TrialInfo; at: number }>()
const TRIAL_CACHE_TTL_MS = 60_000

async function trialInfoCached(userId: string): Promise<TrialInfo> {
  const hit = trialCache.get(userId)
  if (hit && Date.now() - hit.at < TRIAL_CACHE_TTL_MS) return hit.value
  const value = await getTrialInfo(userId)
  trialCache.set(userId, { value, at: Date.now() })
  return value
}

/** Invalidate all three hot-path caches for a user (or everyone). */
export function invalidateTrialCache(userId?: string): void {
  if (userId) trialCache.delete(userId)
  else trialCache.clear()
}

const premiumCache = new Map<string, { value: boolean; at: number }>()
const PREMIUM_CACHE_TTL_MS = 60_000

export function invalidatePremiumCache(userId?: string): void {
  if (userId) premiumCache.delete(userId)
  else premiumCache.clear()
}

export async function isPremiumUser(userId: string): Promise<boolean> {
  const hit = premiumCache.get(userId)
  if (hit && Date.now() - hit.at < PREMIUM_CACHE_TTL_MS) return hit.value
  const sub = await db.subscription.findUnique({
    where: { userId },
    include: { plan: { select: { name: true, price: true } } },
  })
  let value = false
  if (sub && subscriptionCurrentlyActive(sub)) {
    value = resolvePlanIdFromRow(sub.plan) !== "FREE"
  } else if (sub && sub.status === "ACTIVE" && sub.endDate && new Date(sub.endDate) < new Date()) {
    // Expired while cached — persist the honest status (same as before).
    await db.subscription.update({
      where: { id: sub.id },
      data: { status: "EXPIRED" },
    })
  }
  if (!value) {
    // no active paid plan → the automatic full-feature trial month applies
    value = (await trialInfoCached(userId)).active
  }
  premiumCache.set(userId, { value, at: Date.now() })
  return value
}

export async function getSubscriptionSummary(userId: string): Promise<SubscriptionSummary & { trial: TrialInfo }> {
  const info = await getUserSubscription(userId)
  const trial = await trialInfoCached(userId)
  if (!info) return { isPremium: trial.active, subscription: null, trial }
  const active = info.status === "ACTIVE" && (!info.endDate || new Date(info.endDate) >= new Date())
  // Same resolver the API gates use — the UI can never disagree with the API.
  const paidActive = active && resolvePlanIdFromRow({ name: info.planName, price: info.planPrice ?? null }) !== "FREE"
  return { isPremium: paidActive || trial.active, subscription: info, trial }
}

// Hot-path cache for the resolved plan id — same shape/TTL rationale as
// premiumCache above: it is read on every gated request (QA quota, alerts,
// watchlist, portfolio). 60s bounded staleness.
const planCache = new Map<string, { value: PlanId; at: number }>()
const PLAN_CACHE_TTL_MS = 60_000

/**
 * The user's ACTIVE subscription plan as a canonical PlanId.
 * FREE when there is no active (non-expired) subscription.
 * TRIAL when the account is inside its automatic full-feature trial month
 * (signup date based — see trialEndsAt above).
 * Back-compat: legacy paid plans with unknown names (e.g. the retired
 * "PREMIUM" row) still mean a paying user — mapped to "PRO".
 */
export async function getActivePlanId(userId: string): Promise<PlanId> {
  const hit = planCache.get(userId)
  if (hit && Date.now() - hit.at < PLAN_CACHE_TTL_MS) return hit.value

  const sub = await db.subscription.findUnique({
    where: { userId },
    include: { plan: { select: { name: true, price: true } } },
  })
  let value: PlanId = "FREE"
  if (sub && subscriptionCurrentlyActive(sub)) {
    value = resolvePlanIdFromRow(sub.plan)
  }
  if (value === "FREE") {
    // no active paid plan → the automatic full-feature trial month applies
    if ((await trialInfoCached(userId)).active) value = "TRIAL"
  }
  planCache.set(userId, { value, at: Date.now() })
  return value
}

/** Invalidate both hot-path caches when a write changes a user's plan state. */
export function invalidatePlanCaches(userId?: string): void {
  if (userId) {
    premiumCache.delete(userId)
    planCache.delete(userId)
    trialCache.delete(userId)
  } else {
    premiumCache.clear()
    planCache.clear()
    trialCache.clear()
  }
}

/**
 * First-month amount a user must transfer for a DB plan row — offer-aware and
 * ALWAYS computed server-side (the client never sends an amount).
 */
export function planFirstMonthAmount(plan: { price: number; offerActive: boolean; offerPrice: number | null }): number {
  return plan.offerActive && plan.offerPrice != null ? plan.offerPrice : plan.price
}

export async function activateSubscription({
  userId,
  planId,
  durationDays,
  activatedBy,
  notes,
}: {
  userId: string
  planId: string
  durationDays: number
  activatedBy?: string | null
  notes?: string | null
}): Promise<SubscriptionInfo> {
  invalidatePlanCaches(userId)
  const now = new Date()
  const existing = await db.subscription.findUnique({ where: { userId } })
  let endDate = new Date(now)
  endDate.setDate(endDate.getDate() + durationDays)

  if (existing) {
    if (existing.status === "ACTIVE" && existing.endDate && existing.endDate > now) {
      endDate = new Date(existing.endDate)
      endDate.setDate(endDate.getDate() + durationDays)
    }
    const updated = await db.subscription.update({
      where: { id: existing.id },
      data: {
        planId,
        status: "ACTIVE",
        startDate: now,
        endDate,
        activatedAt: now,
        activatedBy: activatedBy ?? existing.activatedBy,
        cancelledAt: null,
        notes: notes ?? existing.notes,
      },
      include: { plan: { select: { name: true } } },
    })
    return map(updated)
  }

  const created = await db.subscription.create({
    data: {
      userId,
      planId,
      status: "ACTIVE",
      startDate: now,
      endDate,
      activatedAt: now,
      activatedBy: activatedBy ?? null,
      notes: notes ?? null,
    },
    include: { plan: { select: { name: true } } },
  })
  return map(created)
}

export async function cancelSubscription(userId: string, note?: string | null): Promise<SubscriptionInfo | null> {
  invalidatePlanCaches(userId)
  const sub = await db.subscription.findUnique({ where: { userId } })
  if (!sub) return null
  const updated = await db.subscription.update({
    where: { id: sub.id },
    data: {
      status: "CANCELLED",
      cancelledAt: new Date(),
      notes: note ?? sub.notes,
    },
    include: { plan: { select: { name: true } } },
  })
  return map(updated)
}

function map(sub: { id: string; status: string; plan: { name: string }; startDate: Date | null; endDate: Date | null; activatedAt: Date | null; activatedBy: string | null; cancelledAt: Date | null; notes: string | null }): SubscriptionInfo {
  return {
    id: sub.id,
    status: sub.status as SubscriptionStatus,
    planName: sub.plan.name,
    startDate: sub.startDate?.toISOString() ?? null,
    endDate: sub.endDate?.toISOString() ?? null,
    activatedAt: sub.activatedAt?.toISOString() ?? null,
    activatedBy: sub.activatedBy ?? null,
    cancelledAt: sub.cancelledAt?.toISOString() ?? null,
    notes: sub.notes ?? null,
  }
}
