"use client"

// useMarketLive — trading-hours-aware auto-refresh for market dashboards.
//
// What it does:
//   • picks the poll cadence from the EGX session clock (60s while the market
//     can move, 10 min outside it — the data itself only changes once per
//     trading day, so we never burn egress for nothing);
//   • pauses entirely when the tab is hidden (visibilitychange) and refetches
//     the moment the user comes back — the "stale on return" bug this kills;
//   • invalidates the given react-query key prefixes and stamps `lastUpdated`,
//     so every panel re-renders against the freshest snapshot together.
//
// The manual "تحديث الآن" button stays — this hook is the automatic layer on
// top, not a replacement.

import { useCallback, useEffect, useRef, useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { egxMarketStatus, type EgxMarketStatus } from "@/lib/market/egx-hours"

const LIVE_INTERVAL_MS = 60_000 // market can move → poll every minute
const IDLE_INTERVAL_MS = 600_000 // closed/weekend → every 10 minutes

export function useMarketLive(queryKeyPrefixes: string[] = []) {
  const queryClient = useQueryClient()
  const [status, setStatus] = useState<EgxMarketStatus>(() => egxMarketStatus())
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [tick, setTick] = useState(0)
  const prefixesRef = useRef(queryKeyPrefixes)
  prefixesRef.current = queryKeyPrefixes

  const refresh = useCallback(
    async (reason: "timer" | "visible" | "manual") => {
      for (const prefix of prefixesRef.current) {
        await queryClient.invalidateQueries({ queryKey: [prefix] })
      }
      setLastUpdated(new Date())
      setTick((t) => t + 1)
      void reason
    },
    [queryClient]
  )

  // Session clock — re-evaluate every 30s (cheap pure computation) so the
  // badge flips to "مقفول"/"مفتوح" without a poll firing.
  useEffect(() => {
    const id = setInterval(() => setStatus(egxMarketStatus()), 30_000)
    return () => clearInterval(id)
  }, [])

  // The heartbeat: one interval whose cadence follows market state, paused
  // while the tab is hidden.
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null

    const start = () => {
      const ms = status.live ? LIVE_INTERVAL_MS : IDLE_INTERVAL_MS
      if (timer) clearInterval(timer)
      timer = setInterval(() => {
        if (typeof document !== "undefined" && document.hidden) return // paused
        void refresh("timer")
      }, ms)
    }

    start()
    const onVisibility = () => {
      if (!document.hidden) {
        // Coming back to the tab: refresh immediately, then restart cadence.
        void refresh("visible")
        start()
      }
    }
    document.addEventListener("visibilitychange", onVisibility)
    return () => {
      if (timer) clearInterval(timer)
      document.removeEventListener("visibilitychange", onVisibility)
    }
  }, [status.live, refresh])

  return { status, lastUpdated, tick, refresh }
}

// A "first load already counts as an update" nicety: dashboards render fresh
// data on mount; stamp it so the badge never says "آخر تحديث: —" for long.
export function useStampOnMount() {
  const [stamped, setStamped] = useState(false)
  useEffect(() => {
    if (!stamped) setStamped(true)
  }, [stamped])
  return stamped
}

/** Relative "آخر تحديث" label in Arabic-friendly short form. */
export function formatLastUpdated(date: Date | null, ar: boolean): string {
  if (!date) return ar ? "—" : "—"
  const diffSec = Math.round((Date.now() - date.getTime()) / 1000)
  if (diffSec < 90) return ar ? "الآن" : "just now"
  if (diffSec < 3600) return ar ? `منذ ${Math.floor(diffSec / 60)} دقيقة` : `${Math.floor(diffSec / 60)}m ago`
  const hh = date.toLocaleTimeString(ar ? "ar-EG" : "en-GB", { hour: "2-digit", minute: "2-digit" })
  return ar ? `عند ${hh}` : `at ${hh}`
}
