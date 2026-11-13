"use client"
import React from "react"

import { useQuery } from "@tanstack/react-query"
import { authHeaders, getUserToken } from "@/lib/client/api"
import { useI18n } from "@/lib/i18n"
import { isPaidPlanId, type PlanId } from "@/lib/plans/entitlements"

interface SubscriptionMeResponse {
  plan?: string
  isPremium?: boolean
  subscription?: unknown
}

export function useSubscription() {
  const { data, isLoading } = useQuery({
    queryKey: ["subscription-me"],
    queryFn: fetchSubscriptionMe,
    staleTime: 60000,
  })
  return { isPremium: !!data?.isPremium, subscription: data?.subscription ?? null, isLoading }
}

// Shared query body: anonymous visitors have no subscription. Do not call the
// protected endpoint with an empty token: that produced a 401 in the console
// on every public page.
function fetchSubscriptionMe(): Promise<SubscriptionMeResponse> {
  if (!getUserToken()) return Promise.resolve({ isPremium: false, subscription: null })
  return fetch("/api/v1/subscription/me", { headers: authHeaders() }).then((r) =>
    r.ok ? r.json() : { isPremium: false, subscription: null },
  )
}

/**
 * The caller's plan (FREE | PRO | PRO_PLUS) from /api/v1/subscription/me.
 * The response's `plan` field is authoritative; when an older cached response
 * lacks it, a premium boolean maps to PRO (a paid plan) and everything else to
 * FREE. Shares the same react-query cache entry as useSubscription.
 */
export function usePlan(): { plan: PlanId; isPremium: boolean; isLoading: boolean } {
  const { data, isLoading } = useQuery({
    queryKey: ["subscription-me"],
    queryFn: fetchSubscriptionMe,
    staleTime: 60000,
  })
  const raw = typeof data?.plan === "string" ? data.plan : data?.isPremium ? "PRO" : "FREE"
  const plan: PlanId = (isPaidPlanId(raw) || raw === "FREE") ? (raw as PlanId) : data?.isPremium ? "PRO" : "FREE"
  const isPremium = typeof data?.isPremium === "boolean" ? data.isPremium : plan !== "FREE"
  return { plan, isPremium, isLoading }
}

export function AdSlot(props: { slot: string }) {
  const { isPremium, isLoading } = useSubscription()
  const { lang } = useI18n()
  if (isLoading) return null
  if (isPremium) return null

  const label = lang === "ar" ? "إعلان (" + props.slot + ")" : "Ad slot (" + props.slot + ")"
  return React.createElement("div", {
    className: "flex items-center justify-center rounded-lg border border-dashed p-6 text-xs text-muted-foreground",
  }, label)
}
