// Subscription helper — single source of truth for premium status.

import { db } from "@/lib/db"

export type SubscriptionStatus = "PENDING" | "ACTIVE" | "EXPIRED" | "CANCELLED" | "REJECTED"

export interface SubscriptionInfo {
  id: string
  status: SubscriptionStatus
  planName: string
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
    include: { plan: { select: { name: true } } },
  })
  if (!sub) return null
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

// Hot-path cache: premium status is read on EVERY authenticated request to
// premium features. Under load it shares the blame for connection-pool
// exhaustion. 60s bounded staleness; explicit invalidation on any write path
// that changes premium state (activate/cancel/reject below).
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
    include: { plan: true },
  })
  if (!sub) {
    premiumCache.set(userId, { value: false, at: Date.now() })
    return false
  }
  if (sub.status !== "ACTIVE") {
    premiumCache.set(userId, { value: false, at: Date.now() })
    return false
  }
  if (sub.endDate && new Date(sub.endDate) < new Date()) {
    await db.subscription.update({
      where: { id: sub.id },
      data: { status: "EXPIRED" },
    })
    premiumCache.set(userId, { value: false, at: Date.now() })
    return false
  }
  premiumCache.set(userId, { value: true, at: Date.now() })
  return true
}

export async function getSubscriptionSummary(userId: string): Promise<SubscriptionSummary> {
  const info = await getUserSubscription(userId)
  if (!info) return { isPremium: false, subscription: null }
  const isPremium = info.status === "ACTIVE" && (!info.endDate || new Date(info.endDate) >= new Date())
  return { isPremium, subscription: info }
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
