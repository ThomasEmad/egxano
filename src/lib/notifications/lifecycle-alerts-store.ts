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
// OWNER DIRECTIVE §10 EXTENSION (additive): the opportunity layer shares the
// SAME feed row and gains its own state row —
//   • `opportunity-sweep:state:v1` — one JSON map { companyId → snapshot } of
//     per-company opportunity snapshots (the diff ledger, see
//     opportunity-alerts.ts). One row, same scale as the lifecycle one.
//   • `lifecycle-sweep:alerts:v1` — now holds BOTH kinds: every feed item
//     carries a `kind` discriminator ("lifecycle" — the default for the
//     pre-extension rows that lack it — or "opportunity"). The feed readers
//     below return the widened SweepFeedAlert union and validate the
//     discriminator; the alerts API and the bell UI pass whole items through,
//     so no reader change was needed anywhere.
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
import type { LifecycleAlert, LifecycleStateSnapshot, SweepFeedAlert } from "./lifecycle-alerts"
import type { OpportunityStateSnapshot } from "./opportunity-alerts"

const STATE_KEY = "lifecycle-sweep:state:v1"
const FEED_KEY = "lifecycle-sweep:alerts:v1"
const OPPORTUNITY_STATE_KEY = "opportunity-sweep:state:v1"
const STATE_DESCRIPTION =
  "Per-company lifecycle sweep snapshots (diff ledger for lifecycle transition alerts)"
const FEED_DESCRIPTION =
  "Recent sweep transition alerts, lifecycle + opportunity kinds (newest first, capped)"
const OPPORTUNITY_STATE_DESCRIPTION =
  "Per-company opportunity sweep snapshots (diff ledger for opportunity transition alerts)"

interface StatePayload {
  savedAt: string
  companies: Record<string, LifecycleStateSnapshot>
}

interface FeedPayload {
  savedAt: string
  alerts: SweepFeedAlert[]
}

interface OpportunityStatePayload {
  savedAt: string
  companies: Record<string, OpportunityStateSnapshot>
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

/** Shape guard for a persisted feed item — a corrupt/foreign entry is dropped,
 *  never trusted. Accepts BOTH kinds: kind "opportunity" (the §10 items) or
 *  absent/"lifecycle" (every pre-extension row). Any other kind value is
 *  foreign → dropped. */
function isAlert(v: unknown): v is SweepFeedAlert {
  if (!v || typeof v !== "object") return false
  const a = v as Partial<SweepFeedAlert>
  if (
    typeof a.companyId !== "string" ||
    typeof a.ticker !== "string" ||
    typeof a.type !== "string" ||
    typeof a.date !== "string" ||
    typeof a.titleAr !== "string" ||
    typeof a.bodyAr !== "string"
  )
    return false
  return a.kind === undefined || a.kind === "lifecycle" || a.kind === "opportunity"
}

/** Shape guard for a persisted opportunity snapshot — a corrupt/foreign entry
 *  is dropped, never trusted. */
function isOpportunitySnapshot(v: unknown): v is OpportunityStateSnapshot {
  if (!v || typeof v !== "object") return false
  const s = v as Partial<OpportunityStateSnapshot>
  return (
    typeof s.state === "string" &&
    typeof s.eligible === "boolean" &&
    (s.upsidePctToT1 === null || typeof s.upsidePctToT1 === "number") &&
    typeof s.asOf === "string" &&
    Array.isArray(s.emitted) &&
    s.emitted.every((k) => typeof k === "string")
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

/** Read the persisted recent-alerts feed (BOTH kinds — see the banner).
 *  Absent/corrupt → []. Never throws. */
export async function readLifecycleAlertFeed(): Promise<SweepFeedAlert[]> {
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

/** Persist the whole feed (one Setting row — both kinds). Never throws. */
export async function writeLifecycleAlertFeed(alerts: SweepFeedAlert[], savedAt: string): Promise<boolean> {
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

// ---------------------------------------------------------------------------
// Opportunity state map (the §10 diff ledger — `opportunity-sweep:state:v1`)
// ---------------------------------------------------------------------------

/** Read the persisted per-company opportunity snapshots. Absent/corrupt → {}
 *  (first-run semantics: everything is a baseline). Never throws. */
export async function readOpportunityStateMap(): Promise<Record<string, OpportunityStateSnapshot>> {
  try {
    const row = await db.setting.findUnique({ where: { key: OPPORTUNITY_STATE_KEY }, select: { value: true } })
    if (!row) return {}
    const parsed = JSON.parse(row.value) as OpportunityStatePayload
    if (!parsed || typeof parsed !== "object" || !parsed.companies) return {}
    const out: Record<string, OpportunityStateSnapshot> = {}
    for (const [companyId, snap] of Object.entries(parsed.companies)) {
      if (isOpportunitySnapshot(snap)) out[companyId] = snap
    }
    return out
  } catch {
    return {}
  }
}

/** Persist the whole opportunity state map (one Setting row). Never throws. */
export async function writeOpportunityStateMap(
  companies: Record<string, OpportunityStateSnapshot>,
  savedAt: string,
): Promise<boolean> {
  try {
    const value = JSON.stringify({ savedAt, companies } satisfies OpportunityStatePayload)
    await db.setting.upsert({
      where: { key: OPPORTUNITY_STATE_KEY },
      create: { key: OPPORTUNITY_STATE_KEY, value, type: "json", description: OPPORTUNITY_STATE_DESCRIPTION },
      update: { value },
    })
    return true
  } catch {
    return false
  }
}
