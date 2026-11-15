// =============================================================================
// Lifecycle-transition alerts (v1) — PURE diff/dedup over lifecycle views.
// =============================================================================
//
// A plan lifecycle (src/lib/technical/lifecycle.ts) is a DETERMINISTIC walk:
// the same stance + the same daily bars always produce the same
// LifecycleView with the same terminal transition. This module diffs that
// view against the PREVIOUS persisted snapshot of the same company's
// lifecycle state and produces the alert records for NEW transitions only.
//
// Alert types (one per lifecycle TRANSITION, mirrored on the view's terminal
// state — a walk always stops at its first terminal transition, so one view
// yields at most one new alert per sweep):
//
//   watching basis   → state "confirmed"   ⇒ "confirmed"   (the setup
//                       activated with the required volume AND the recompute
//                       gate passed — the weak-recompute path ends "expired"
//                       instead and alerts as "expired", never as confirmed)
//   confirmed basis  → state "active"      ⇒ "activated"   (first daily close
//                       inside the entry zone — the trade began)
//                     → state "stopped"     ⇒ "stopped"
//                     → state "targeted"    ⇒ "targeted"
//                     → state "expired" with exit.kind "time_stopped"
//                                           ⇒ "time_stopped"
//                     → state "expired" without an exit (entry expiry)
//                                           ⇒ "expired"
//   watching basis   → state "invalidated" ⇒ "invalidated"
//                     → state "expired"     ⇒ "expired"     (window expiry or
//                                             the rejected-recompute expiry)
//
// DEDUP RULES (the contract the sweep + tests pin):
//   1. one alert per transition — a transition is identified by its key
//      `${type}:${date}` (date = the session date the event fired on; within
//      one company one generation of a stance can never produce two events
//      of the same type on the same date, so the key is unique);
//   2. no alert for unchanged states — an unchanged terminal state repeats
//      the same key, which the previous snapshot already recorded;
//   3. FIRST observation of a company (previous === null) is a BASELINE: the
//      current transitions are recorded as already-emitted and NO alerts are
//      produced — a newly deployed sweep must never spam the feed with the
//      whole history it just learned;
//   4. ordering is stable and total: (date, type rank, ticker, titleAr) —
//      identical inputs always yield byte-identical output order.
//
// NO persistence here (no clocks, no randomness, no db import) — the storage
// seam lives in lifecycle-alerts-store.ts (Setting KV) and the orchestration
// in lifecycle-sweep.ts, both of which stay unit-testable with fakes.
//
// OWNER DIRECTIVE §10 EXTENSION (additive, 2026-11): the persisted feed row is
// now SHARED with the opportunity-transition layer
// (src/lib/notifications/opportunity-alerts.ts + opportunity-sweep.ts). Every
// item carries a `kind` discriminator ("lifecycle" — the default for absent
// kind, this module's items — or "opportunity"), the dedup identity includes
// the kind, and the ordering is total over both kinds. Lifecycle-only feeds
// order byte-identically to the pre-extension behavior; the alerts API and the
// bell UI pass whole items through, so no reader change was needed.
// =============================================================================

import type { LifecycleState, LifecycleView } from "../technical/lifecycle"
import type { SignalState } from "../technical/signals"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type LifecycleAlertType =
  | "confirmed"
  | "activated"
  | "stopped"
  | "targeted"
  | "time_stopped"
  | "invalidated"
  | "expired"

/** The full alert set — every type carries ALL the alert types, so a feed
 *  consumer can render chips without a fallback. */
export const LIFECYCLE_ALERT_TYPES: readonly LifecycleAlertType[] = [
  "confirmed",
  "activated",
  "stopped",
  "targeted",
  "time_stopped",
  "invalidated",
  "expired",
]

/** Stable tie-break rank for same-date alerts (confirmation first, expiry
 *  last — the lifecycle's own causal order). */
const TYPE_RANK: Record<LifecycleAlertType, number> = {
  confirmed: 0,
  activated: 1,
  stopped: 2,
  targeted: 3,
  time_stopped: 4,
  invalidated: 5,
  expired: 6,
}

export interface LifecycleAlert {
  companyId: string
  ticker: string
  type: LifecycleAlertType
  /** session date (YYYY-MM-DD) the transition fired on */
  date: string
  titleAr: string
  /** the lifecycle event's Arabic note (gap fills, fills, volume condition) */
  bodyAr: string
  /**
   * Feed-kind discriminator (owner directive §10 — the opportunity layer shares
   * this feed row). ABSENT on every pre-existing persisted item and on the
   * records this module produces: an absent kind READS as "lifecycle" everywhere
   * (feedItemKind below), so old rows and old readers stay byte-compatible.
   * Opportunity alerts (opportunity-alerts.ts) carry kind "opportunity" explicitly.
   */
  kind?: "lifecycle"
}

/**
 * Structural shape of an opportunity-transition feed item as the shared feed
 * sees it. Kept STRUCTURAL (type widened to string) so the pure modules stay
 * import-cycle-free: opportunity-alerts.ts's OpportunityAlert (with its
 * narrower OpportunityAlertType) is assignable to this, and the generalized
 * feed helpers below accept both kinds without importing it.
 */
export interface OpportunityFeedItem {
  kind: "opportunity"
  companyId: string
  ticker: string
  type: string
  date: string
  titleAr: string
  bodyAr: string
}

/** One item of the shared sweep feed row (`lifecycle-sweep:alerts:v1`): a
 *  lifecycle transition alert (kind absent/`"lifecycle"`) or an
 *  opportunity-transition alert (kind `"opportunity"`). */
export type SweepFeedAlert = LifecycleAlert | OpportunityFeedItem

/** The feed kind of an item — absent kind reads as "lifecycle" (pre-kind rows). */
export function feedItemKind(a: SweepFeedAlert): "lifecycle" | "opportunity" {
  return a.kind === "opportunity" ? "opportunity" : "lifecycle"
}

/** The persisted per-company sweep snapshot (stored as Setting KV JSON). */
export interface LifecycleStateSnapshot {
  basis: "watching" | "confirmed"
  signalState: SignalState
  /** lifecycle state after the last successful sweep */
  state: LifecycleState
  /** last session consumed by the walk (echoed from the view) */
  asOf: string | null
  /** transition keys already alerted (`${type}:${date}`), sorted ascending —
   *  the dedup ledger; pruned to the most recent EMITTED_KEYS_KEEP entries */
  emitted: string[]
}

export interface LifecycleCompanyRef {
  companyId: string
  ticker: string | null
}

export interface LifecycleDiffResult {
  /** NEW transitions only (deduped against the previous snapshot) — [] on a
   *  baseline or an unchanged state. Ordered oldest → newest. */
  alerts: LifecycleAlert[]
  /** the snapshot to persist for the next run (ledger includes the current
   *  transitions whether or not they alerted) */
  snapshot: LifecycleStateSnapshot
}

// ---------------------------------------------------------------------------
// Titles — Arabic-first, honest, one line per transition type
// ---------------------------------------------------------------------------

/** The Arabic alert title for a transition type ({ticker} interpolated). */
export function lifecycleAlertTitleAr(type: LifecycleAlertType, ticker: string): string {
  switch (type) {
    case "confirmed":
      return `فرصة ${ticker} تفعّلت — أصبحت قراءة مؤكدة`
    case "activated":
      return `صفقة ${ticker} دخلت منطقة الدخول`
    case "stopped":
      return `صفقة ${ticker} ضربت وقف الخسارة`
    case "targeted":
      return `صفقة ${ticker} حققت الهدف`
    case "time_stopped":
      return `صفقة ${ticker} خرجت على الوقف الزمني`
    case "invalidated":
      return `فرصة ${ticker} أُلغيت قبل الدخول`
    case "expired":
      return `قراءة ${ticker} انتهت صلاحيتها`
  }
}

// ---------------------------------------------------------------------------
// Key + transition mapping (pure, deterministic)
// ---------------------------------------------------------------------------

/** The dedup key of a transition: type + the session date it fired on. */
export function lifecycleAlertKey(type: LifecycleAlertType, date: string): string {
  return `${type}:${date}`
}

/**
 * The alert type of the view's TERMINAL transition — null when the view has
 * no transition to report (still watching / awaiting entry / degraded with
 * no events). The walk always stops at its first terminal transition, so a
 * view carries at most one.
 */
export function alertTypeForView(view: LifecycleView): LifecycleAlertType | null {
  switch (view.state) {
    case "watching":
      // initial state of the watching basis — nothing to report
      return null
    case "confirmed":
      // watching basis: the setup activated (volume-confirmed) AND the
      // recompute gate passed — the transition TO confirmed.
      // confirmed basis: the initial published state (awaiting entry) —
      // not a transition.
      return view.basis === "watching" ? "confirmed" : null
    case "invalidated":
      return "invalidated"
    case "active":
      return "activated"
    case "stopped":
      return "stopped"
    case "targeted":
      return "targeted"
    case "expired":
      // confirmed basis: a held trade that ran out of sessions exits via the
      // time stop (view.exit.kind "time_stopped"); watching basis and the
      // entry-expiry path have no exit — plain expiry.
      return view.exit?.kind === "time_stopped" ? "time_stopped" : "expired"
  }
}

/** The lifecycle event that carries a transition's date + Arabic note. */
function eventForAlertType(view: LifecycleView, type: LifecycleAlertType) {
  const wanted =
    type === "confirmed"
      ? "activated" // the watching activation event (note describes the recompute)
      : type // every other alert type maps 1:1 onto its event type
  for (let i = view.events.length - 1; i >= 0; i--) {
    if (view.events[i].type === wanted) return view.events[i]
  }
  return null
}

/** Total, stable alert ordering — the ONLY order this module produces.
 *  (date asc within a diff; date desc in the feed helper below.) */
function compareAlertsAsc(a: LifecycleAlert, b: LifecycleAlert): number {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1
  if (a.type !== b.type) return TYPE_RANK[a.type] - TYPE_RANK[b.type]
  if (a.ticker !== b.ticker) return a.ticker < b.ticker ? -1 : 1
  return a.titleAr < b.titleAr ? -1 : a.titleAr > b.titleAr ? 1 : 0
}

/**
 * Every transition the view currently reports, as a full alert record
 * (no dedup, at most one — the terminal transition). Returns [] when the
 * view has no transition or the transition's event is missing (an
 * engine-invariant violation — never fabricate a date).
 */
export function currentTransitionAlerts(company: LifecycleCompanyRef, view: LifecycleView): LifecycleAlert[] {
  const type = alertTypeForView(view)
  if (!type) return []
  const event = eventForAlertType(view, type)
  if (!event) return []
  const ticker = company.ticker ?? company.companyId
  return [
    {
      companyId: company.companyId,
      ticker,
      type,
      date: event.date,
      titleAr: lifecycleAlertTitleAr(type, ticker),
      bodyAr: event.noteAr,
    },
  ]
}

// ---------------------------------------------------------------------------
// The diff — one company, one view, one previous snapshot
// ---------------------------------------------------------------------------

/** Ledger bound: with at most a handful of transitions per stance per day, a
 *  company would need 64 transitions BETWEEN two sweeps to lose a dedup key
 *  — impossible with a daily sweep; the bound keeps the Setting row small. */
export const EMITTED_KEYS_KEEP = 64

/** Dedup-ledger pruning, shared with the opportunity-alerts ledger (same
 *  `${type}:${date}` key shape, same bound, same recency ordering). */
export function pruneEmitted(keys: string[]): string[] {
  const unique = [...new Set(keys)].sort((a, b) => {
    // keys are `${type}:${date}` — sort by the date suffix desc (recency)
    const da = a.slice(a.lastIndexOf(":") + 1)
    const db = b.slice(b.lastIndexOf(":") + 1)
    if (da !== db) return da < db ? 1 : -1
    return a < b ? 1 : -1
  })
  return unique.slice(0, EMITTED_KEYS_KEEP).sort((a, b) => (a < b ? -1 : 1))
}

function snapshotOf(view: LifecycleView, emitted: string[]): LifecycleStateSnapshot {
  return {
    basis: view.basis,
    signalState: view.signalState,
    state: view.state,
    asOf: view.asOf,
    emitted: pruneEmitted(emitted),
  }
}

/**
 * Diff one company's fresh LifecycleView against its previous persisted
 * snapshot (null = first observation). See the banner for the dedup rules.
 * Pure and deterministic: identical inputs → identical output.
 */
export function diffLifecycleState(
  company: LifecycleCompanyRef,
  view: LifecycleView,
  previous: LifecycleStateSnapshot | null,
): LifecycleDiffResult {
  const current = currentTransitionAlerts(company, view)
  const currentKeys = current.map((a) => lifecycleAlertKey(a.type, a.date))

  if (!previous) {
    // BASELINE — first observation: record history as emitted, alert nothing.
    return { alerts: [], snapshot: snapshotOf(view, currentKeys) }
  }

  const known = new Set(previous.emitted)
  const fresh = current.filter((a) => !known.has(lifecycleAlertKey(a.type, a.date)))
  return {
    alerts: [...fresh].sort(compareAlertsAsc),
    snapshot: snapshotOf(view, [...previous.emitted, ...currentKeys]),
  }
}

// ---------------------------------------------------------------------------
// Feed helpers — deterministic ordering + merge/cap for the persisted feed.
// Kind-aware (owner directive §10): the same feed row carries lifecycle AND
// opportunity items; the rules below are total over BOTH kinds and reduce to
// the original behavior when the feed contains lifecycle items only.
// ---------------------------------------------------------------------------

/** Same-kind type ordering: the documented lifecycle TYPE_RANK when both types
 *  are known lifecycle types; everything unknown (opportunity types, corrupt
 *  rows) sorts after ALL known ranks, ordered by plain type string. Built as a
 *  lexicographic (known?, key) composite so the comparator stays transitive. */
function sameKindTypeCompare(a: string, b: string): number {
  const ra = TYPE_RANK[a as LifecycleAlertType]
  const rb = TYPE_RANK[b as LifecycleAlertType]
  if (ra !== undefined && rb !== undefined) return ra - rb
  if (ra !== undefined) return -1
  if (rb !== undefined) return 1
  return a < b ? -1 : a > b ? 1 : 0
}

/** Newest-first, total order over BOTH feed kinds (date desc, then lifecycle
 *  before opportunity on the same date, then the within-kind type order, then
 *  the stable ticker/title tie-breaks) — the persisted alerts feed and the API
 *  return this order. For a lifecycle-only feed this is byte-identical to the
 *  original (pre-opportunity) ordering. */
export function orderAlertsNewestFirst<T extends SweepFeedAlert>(alerts: T[]): T[] {
  return [...alerts].sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? 1 : -1
    const ka = feedItemKind(a)
    const kb = feedItemKind(b)
    if (ka !== kb) return ka < kb ? -1 : 1
    if (a.type !== b.type) return sameKindTypeCompare(a.type, b.type)
    if (a.ticker !== b.ticker) return a.ticker < b.ticker ? -1 : 1
    return a.titleAr < b.titleAr ? -1 : a.titleAr > b.titleAr ? 1 : 0
  })
}

/** Default cap of the persisted feed (the API applies the per-tier
 *  PlanLimits.alerts ON TOP of this). */
export const ALERT_FEED_CAP = 200

/** The dedup identity of a feed item: kind + companyId + type + date. The KIND
 *  is part of the identity — a lifecycle "invalidated" and an opportunity
 *  "invalidated" on the same company/date are two different events and both
 *  belong in the feed. */
export function feedAlertKey(a: SweepFeedAlert): string {
  return `${feedItemKind(a)}|${a.companyId}|${a.type}|${a.date}`
}

/**
 * Merge the existing feed with newly produced alerts:
 *   • dedup by the transition identity (kind + companyId + type + date) — a
 *     company re-appearing in the feed (e.g. after a baseline reset) can never
 *     duplicate an entry;
 *   • newest-first order (orderAlertsNewestFirst);
 *   • capped at `cap` (oldest entries dropped — the sweeps' own ledgers in the
 *     state snapshots are the durable dedup record, the feed is a window).
 */
export function mergeAlertFeed<T extends SweepFeedAlert>(
  existing: T[],
  incoming: T[],
  cap: number = ALERT_FEED_CAP,
): T[] {
  const seen = new Set<string>()
  const merged: T[] = []
  for (const a of orderAlertsNewestFirst([...existing, ...incoming])) {
    const key = feedAlertKey(a)
    if (seen.has(key)) continue
    seen.add(key)
    merged.push(a)
    if (merged.length >= cap) break
  }
  return merged
}
