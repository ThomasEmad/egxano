// =============================================================================
// Lifecycle-alert storage — the Setting KV seam (NO schema changes).
// =============================================================================
//
// STORAGE DECISION (v1): the existing generic key-value `Setting` table
// (key @id / value / type / description — the same table the board snapshot
// and the market ticker snapshot persist into) carries BOTH sides of the
// sweep's state:
//
//   • `lifecycle-sweep:state:v1`  — one JSON map { companyId → snapshot } of
//     per-company lifecycle snapshots (the diff ledger, see
//     lifecycle-alerts.ts). One row, ~30 KB at full-market scale.
//   • `lifecycle-sweep:alerts:v1` — the bounded recent-alerts feed (newest
//     first, capped) the alerts API serves.
//
// WHY Setting and not anything else:
//   • NotificationOutbox exists but is a USER-scoped Web-Push delivery
//     ledger (alertId @unique 1:1 with PriceAlert, userId, status/retry
//     machinery) — writing company-scoped lifecycle alerts into it would
//     hijack its idempotency key and its drain, so it stays untouched
//     (notification-audit.md §5 owns that design).
//   • PriceAlert is a user-owned price alert, not a market feed.
//   • No JobState/KV other than Setting exists, and Setting's INTENDED use
//     (its own type: "json" + description fields, and the precedent of
//     board-snapshot.ts persisting a whole-market read model there) is
//     exactly "derived state for reads".
// The honest consequence: the feed is only as fresh as the last sweep —
// the sweep (scripts/daily-lifecycle-sweep.mjs, scheduled after the 13:30
// UTC candles refresh) is the single writer; the API never computes alerts
// on read.
//
// Conventions copied from board-snapshot.ts: upsert with type "json" +
// description, read with parse/shape guards, and EVERY failure degrades to
// an empty read / false write — a locked-down DB user or a transient error
// must never break a caller.
// =============================================================================

import { db } from "@/lib/db"
import type { LifecycleAlert, LifecycleStateSnapshot } from "./lifecycle-alerts"

const STATE_KEY = "lifecycle-sweep:state:v1"
const FEED_KEY = "lifecycle-sweep:alerts:v1"
const STATE_DESCRIPTION =
  "Per-company lifecycle sweep snapshots (diff ledger for lifecycle transition alerts)"
const FEED_DESCRIPTION = "Recent plan-lifecycle transition alerts (newest first, capped)"

interface StatePayload {
  savedAt: string
  companies: Record<string, LifecycleStateSnapshot>
}

interface FeedPayload {
  savedAt: string
  alerts: LifecycleAlert[]
}

/** Shape guard for a persisted snapshot — a corrupt/foreign entry is dropped,
 *  never trusted. */
function isSnapshot(v: unknown): v is LifecycleStateSnapshot {
  if (!v || typeof v !== "object") return false
  const s = v as Partial<LifecycleStateSnapshot>
  return (
    (s.basis === "watching" || s.basis === "confirmed") &&
    typeof s.signalState === "string" &&
    typeof s.state === "string" &&
    (s.asOf === null || typeof s.asOf === "string") &&
    Array.isArray(s.emitted) &&
    s.emitted.every((k) => typeof k === "string")
  )
}

function isAlert(v: unknown): v is LifecycleAlert {
  if (!v || typeof v !== "object") return false
  const a = v as Partial<LifecycleAlert>
  return (
    typeof a.companyId === "string" &&
    typeof a.ticker === "string" &&
    typeof a.type === "string" &&
    typeof a.date === "string" &&
    typeof a.titleAr === "string" &&
    typeof a.bodyAr === "string"
  )
}

// ---------------------------------------------------------------------------
// State map (the per-company diff ledger)
// ---------------------------------------------------------------------------

/** Read the persisted per-company snapshots. Absent/corrupt → {} (first run
 *  semantics: everything is a baseline). Never throws. */
export async function readLifecycleStateMap(): Promise<Record<string, LifecycleStateSnapshot>> {
  try {
    const row = await db.setting.findUnique({ where: { key: STATE_KEY }, select: { value: true } })
    if (!row) return {}
    const parsed = JSON.parse(row.value) as StatePayload
    if (!parsed || typeof parsed !== "object" || !parsed.companies) return {}
    const out: Record<string, LifecycleStateSnapshot> = {}
    for (const [companyId, snap] of Object.entries(parsed.companies)) {
      if (isSnapshot(snap)) out[companyId] = snap
    }
    return out
  } catch {
    return {}
  }
}

/** Persist the whole state map (one Setting row). Never throws. */
export async function writeLifecycleStateMap(
  companies: Record<string, LifecycleStateSnapshot>,
  savedAt: string,
): Promise<boolean> {
  try {
    const value = JSON.stringify({ savedAt, companies } satisfies StatePayload)
    await db.setting.upsert({
      where: { key: STATE_KEY },
      create: { key: STATE_KEY, value, type: "json", description: STATE_DESCRIPTION },
      update: { value },
    })
    return true
  } catch {
    return false
  }
}

// ---------------------------------------------------------------------------
// Recent-alerts feed (what the API serves)
// ---------------------------------------------------------------------------

/** Read the persisted recent-alerts feed. Absent/corrupt → []. Never throws. */
export async function readLifecycleAlertFeed(): Promise<LifecycleAlert[]> {
  try {
    const row = await db.setting.findUnique({ where: { key: FEED_KEY }, select: { value: true } })
    if (!row) return []
    const parsed = JSON.parse(row.value) as FeedPayload
    if (!parsed || !Array.isArray(parsed.alerts)) return []
    return parsed.alerts.filter(isAlert)
  } catch {
    return []
  }
}

/** Persist the whole feed (one Setting row). Never throws. */
export async function writeLifecycleAlertFeed(alerts: LifecycleAlert[], savedAt: string): Promise<boolean> {
  try {
    const value = JSON.stringify({ savedAt, alerts } satisfies FeedPayload)
    await db.setting.upsert({
      where: { key: FEED_KEY },
      create: { key: FEED_KEY, value, type: "json", description: FEED_DESCRIPTION },
      update: { value },
    })
    return true
  } catch {
    return false
  }
}
