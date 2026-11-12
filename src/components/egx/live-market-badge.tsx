"use client"

// LiveMarketBadge — the honest "is this data moving?" indicator.
// Green pulse while EGX is live + the auto-refresh promise; a calm closed
// state with the next open time so the user never wonders whether the data
// is fresh. Psychology: uncertainty about freshness is one of the top trust
// killers on market sites — this badge answers it before it's asked.
//
// Controlled or standalone: pass `status`/`lastUpdated` from your own
// useMarketLive() instance when the page already runs one (avoids duplicate
// intervals); omit them and the badge manages its own instance.

import { useMarketLive, formatLastUpdated } from "./use-market-live"
import type { EgxMarketStatus } from "@/lib/market/egx-hours"

export function LiveMarketBadge({
  ar,
  on,
  status: statusProp,
  lastUpdated: lastUpdatedProp,
}: {
  ar: boolean
  on: string[]
  status?: EgxMarketStatus
  lastUpdated?: Date | null
}) {
  const self = useMarketLive(statusProp ? [] : on)
  const status = statusProp ?? self.status
  const lastUpdated = lastUpdatedProp !== undefined ? lastUpdatedProp : self.lastUpdated
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-background px-2.5 py-0.5 text-[11px] font-medium"
      title={ar
        ? `${status.ar} · آخر تحديث ${formatLastUpdated(lastUpdated, true)}`
        : `${status.en} · last updated ${formatLastUpdated(lastUpdated, false)}`}
      role="status"
    >
      <span
        className={`flex h-1.5 w-1.5 rounded-full ${status.live ? "bg-positive animate-pulse" : "bg-muted-foreground/50"}`}
        aria-hidden
      />
      <span className={status.live ? "text-positive" : "text-muted-foreground"}>
        {ar ? status.ar : status.en}
      </span>
      <span className="text-muted-foreground/70">·</span>
      <span className="text-muted-foreground" dir="auto">
        {ar ? "آخر تحديث" : "updated"} {formatLastUpdated(lastUpdated, ar)}
      </span>
    </span>
  )
}
