// =============================================================================
// Daily lifecycle sweep — orchestration over INJECTED deps (no db here).
// =============================================================================
//
// Loads every company with an actionable persisted stance (signalState
// "confirmed" or "watching"-with-setup), recomputes its plan lifecycle over
// the recent daily-bar window (src/lib/technical/lifecycle.ts via the
// lifecycle-service read path, wired by the caller), diffs each fresh view
// against the PREVIOUS persisted snapshot
// (src/lib/notifications/lifecycle-alerts.ts), appends the new transition
// alerts to the persisted feed, and updates the state map.
//
// SEAM: every side effect (company listing, lifecycle compute, state/feed
// persistence, the clock) is a function on SweepDeps — unit tests inject
// fakes and never touch a database; scripts/daily-lifecycle-sweep.mjs wires
// the production deps (Prisma + the Setting KV store).
//
// DRY-RUN: opts.dryRun computes everything (diffs + summary) but calls NO
// save dep — the exact bytes that WOULD be written are reported in the
// summary counts, never half-persisted.
//
// Failure containment: one company's compute error is recorded in
// summary.errors and that company is SKIPPED (its snapshot is left
// untouched, so the next run re-diffs it) — one broken stance can never
 // abort the whole sweep.
// =============================================================================

import type { LifecycleView } from "../technical/lifecycle"
import type { SignalState } from "../technical/signals"
import {
  diffLifecycleState,
  mergeAlertFeed,
  ALERT_FEED_CAP,
  type LifecycleAlert,
  type LifecycleAlertType,
  type LifecycleStateSnapshot,
} from "./lifecycle-alerts"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** One computed row handed back by deps.computeOne — the shape
 *  getCompanyLifecycle returns (lifecycle-service read path). */
export interface SweepComputedRow {
  companyId: string
  ticker: string | null
  signalState: SignalState
  view: LifecycleView
}

export interface SweepDeps {
  /** companies with actionable stances, in a stable order (the sweep re-sorts
   *  by ticker anyway — determinism must not depend on the dep's order) */
  listCompanies(): Promise<{ companyId: string; ticker: string | null }[]>
  /** the fresh lifecycle view for one company — null when there is nothing
   *  to track (no fresh stance, wait row, missing payload) */
  computeOne(companyId: string, ticker: string | null): Promise<SweepComputedRow | null>
  /** the persisted per-company snapshots (empty map = first run) */
  loadStateMap(): Promise<Record<string, LifecycleStateSnapshot>>
  saveStateMap(map: Record<string, LifecycleStateSnapshot>): Promise<boolean>
  /** the persisted recent-alerts feed (empty = first run) */
  loadRecentAlerts(): Promise<LifecycleAlert[]>
  saveRecentAlerts(alerts: LifecycleAlert[]): Promise<boolean>
  /** the clock — injected so tests stay deterministic */
  now(): Date
}

export interface SweepSummary {
  dryRun: boolean
  startedAt: string
  finishedAt: string
  /** companies listed by deps.listCompanies */
  companiesLoaded: number
  /** companies whose computeOne returned a trackable view */
  tracked: number
  /** companies skipped (null view: stale/no stance, wait row, missing payload) */
  skipped: number
  alertsNew: number
  byType: Record<LifecycleAlertType, number>
  /** whether the state map was persisted (always false on a dry-run) */
  stateSaved: boolean
  /** whether the alert feed was persisted (always false on a dry-run) */
  feedSaved: boolean
  /** "companyId: message" for every company whose compute threw */
  errors: string[]
}

export const EMPTY_BY_TYPE: Record<LifecycleAlertType, number> = {
  confirmed: 0,
  activated: 0,
  stopped: 0,
  targeted: 0,
  time_stopped: 0,
  invalidated: 0,
  expired: 0,
}

// ---------------------------------------------------------------------------
// The sweep
// ---------------------------------------------------------------------------

/**
 * Run one sweep pass. Deterministic given the deps: companies are processed
 * in ticker order, alerts merge into the feed newest-first, and the state
 * map is written in one shot at the end.
 */
export async function runLifecycleSweep(
  deps: SweepDeps,
  opts: { dryRun?: boolean; feedCap?: number; maxCompanies?: number } = {},
): Promise<SweepSummary> {
  const dryRun = opts.dryRun === true
  const feedCap = opts.feedCap ?? ALERT_FEED_CAP
  const maxCompanies = opts.maxCompanies ?? Number.POSITIVE_INFINITY
  const startedAt = deps.now().toISOString()

  const [listed, stateMap, feed] = await Promise.all([
    deps.listCompanies(),
    deps.loadStateMap().catch(() => ({}) as Record<string, LifecycleStateSnapshot>),
    deps.loadRecentAlerts().catch(() => [] as LifecycleAlert[]),
  ])

  // Stable processing order: ticker (companyId as the total tie-break).
  const companies = [...listed]
    .sort((a, b) => {
      const ta = a.ticker ?? a.companyId
      const tb = b.ticker ?? b.companyId
      return ta < tb ? -1 : ta > tb ? 1 : a.companyId < b.companyId ? -1 : a.companyId > b.companyId ? 1 : 0
    })
    .slice(0, maxCompanies)

  const byType: Record<LifecycleAlertType, number> = { ...EMPTY_BY_TYPE }
  const newAlerts: LifecycleAlert[] = []
  const errors: string[] = []
  const nextStateMap: Record<string, LifecycleStateSnapshot> = { ...stateMap }
  let tracked = 0
  let skipped = 0

  for (const company of companies) {
    let row: SweepComputedRow | null = null
    try {
      row = await deps.computeOne(company.companyId, company.ticker)
    } catch (err) {
      errors.push(`${company.companyId}: ${String((err as Error)?.message ?? err).slice(0, 160)}`)
      continue
    }
    if (!row) {
      skipped++
      // Nothing to track — the stale snapshot (if any) is left untouched so a
      // later fresh stance still diffs against its own history.
      continue
    }
    const prev = stateMap[company.companyId] ?? null
    const diff = diffLifecycleState({ companyId: row.companyId, ticker: row.ticker }, row.view, prev)
    tracked++
    nextStateMap[company.companyId] = diff.snapshot
    for (const alert of diff.alerts) {
      byType[alert.type]++
      newAlerts.push(alert)
    }
  }

  const mergedFeed = mergeAlertFeed(feed, newAlerts, feedCap)

  let stateSaved = false
  let feedSaved = false
  if (!dryRun) {
    stateSaved = await deps.saveStateMap(nextStateMap)
    // The feed only changes when a new alert merges in — an unchanged feed
    // is never rewritten.
    feedSaved = newAlerts.length > 0 ? await deps.saveRecentAlerts(mergedFeed) : false
  }
  // Dry-run: nothing is persisted — stateSaved/feedSaved stay false and the
  // caller reports intent from dryRun + alertsNew.

  return {
    dryRun,
    startedAt,
    finishedAt: deps.now().toISOString(),
    companiesLoaded: companies.length,
    tracked,
    skipped,
    alertsNew: newAlerts.length,
    byType,
    stateSaved,
    feedSaved,
    errors,
  }
}
