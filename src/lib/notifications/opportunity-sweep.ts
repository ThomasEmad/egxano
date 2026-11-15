// =============================================================================
// Daily opportunity sweep — orchestration over INJECTED deps (no db here).
// =============================================================================
//
// opportunity-sweep@1 — the second pass of the owner-directive-§10 sweep. For
// every company the lifecycle pass already tracked (the SAME listing, the
// SAME computeOne — the production wiring in scripts/daily-lifecycle-sweep.mjs
// hands this pass the very rows the lifecycle fetch produced, so the
// resistance map + target ladder are built from the SAME bars with ZERO extra
// fetches), it:
//   1. builds the resistance map from the captured ascending real-OHLC bars
//      (src/lib/technical/resistance-map.ts) and the structural target ladder
//      (src/lib/technical/opportunity-targets.ts) at the plan's entry zone —
//      or, for a watching row without a plan, at the setup's activation level
//      (entryLow = entryHigh = activationLevel: the ladder's T1 search then
//      starts strictly beyond the trigger, exactly the classifier's own
//      selectT1 reference);
//   2. classifies the row (classifyOpportunity — the same input assembly the
//      classifier documents: lastClose from the last captured bar, the
//      stance's score/plan/setup, the lifecycle view pass-through);
//   3. diffs the fresh view against the PREVIOUS persisted snapshot
//      (opportunity-alerts.ts — new Setting row opportunity-sweep:state:v1);
//   4. merges the new alerts into the SHARED alerts feed row
//      (lifecycle-sweep:alerts:v1 — kind-aware merge from lifecycle-alerts.ts,
//      so lifecycle and opportunity items coexist and existing readers are
//      untouched) and updates the state map.
//
// HONEST ABSTENTION: when the resistance map is UNAVAILABLE (fewer than
// MIN_SESSIONS valid OHLC sessions — no extra bar fetch would fix it), the
// last close is unusable, or no session date exists to stamp the diff with,
// the opportunity layer is SKIPPED for that company: no classification, no
// snapshot write, no alert. The previous snapshot (if any) is left untouched
// so the next sufficient run re-diffs against its own history. Abstentions
// are counted (summary.abstained) — silence is never presented as data.
//
// DRY-RUN: opts.dryRun computes everything (diffs + summary) but calls NO
// save dep — exactly like runLifecycleSweep.
//
// Failure containment: one company's error is recorded in summary.errors and
// that company is SKIPPED (snapshot untouched) — one broken row can never
// abort the whole pass.
// =============================================================================

import type { Bar } from "../technical/indicators"
import type { LifecycleView } from "../technical/lifecycle"
import type { SignalState, WatchingSetup } from "../technical/signals"
import type { TradePlan } from "../technical/trade-plan"
import { buildResistanceMap, type ResistanceMap } from "../technical/resistance-map"
import { buildTargetLadder, type TargetLadder } from "../technical/opportunity-targets"
import {
  classifyOpportunity,
  type OpportunitySetupInput,
  type OpportunityView,
} from "../technical/opportunity"
import {
  diffOpportunityState,
  OPPORTUNITY_ALERT_TYPES,
  type OpportunityAlertType,
  type OpportunityStateSnapshot,
} from "./opportunity-alerts"
import { mergeAlertFeed, ALERT_FEED_CAP, type SweepFeedAlert } from "./lifecycle-alerts"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** One computed row handed back by deps.computeOne — the lifecycle-service
 *  read path's output PLUS the pieces the classifier needs. `bars` is the
 *  EXACT ascending bar array the lifecycle fetch already returned (real OHLC;
 *  structurally the indicators Bar shape) — the production wiring captures it
 *  from the same loadBars call, never re-queries. */
export interface OpportunityComputedRow {
  companyId: string
  ticker: string | null
  signalState: SignalState
  view: LifecycleView
  bars: Bar[]
  /** the stance's score (0-100 context — the classifier reads no threshold
   *  from it); null → passed to the classifier as 0 */
  score: number | null
  /** the stance's validated plan (null on watching/wait rows) */
  tradePlan: TradePlan | null
  /** the stance's watching-setup payload (null otherwise) */
  setup: WatchingSetup | null
}

export interface OpportunitySweepDeps {
  /** companies to process, in a stable order (the sweep re-sorts by ticker —
   *  determinism must not depend on the dep's order) */
  listCompanies(): Promise<{ companyId: string; ticker: string | null }[]>
  /** the fresh computed row for one company — null when there is nothing to
   *  track (no lifecycle row: the production wiring shares the lifecycle
   *  pass's fetch cache, so a company the lifecycle pass could not compute is
   *  skipped here too) */
  computeOne(companyId: string, ticker: string | null): Promise<OpportunityComputedRow | null>
  /** the persisted per-company snapshots (empty map = first run) */
  loadStateMap(): Promise<Record<string, OpportunityStateSnapshot>>
  saveStateMap(map: Record<string, OpportunityStateSnapshot>): Promise<boolean>
  /** the persisted SHARED recent-alerts feed (empty = first run) */
  loadRecentAlerts(): Promise<SweepFeedAlert[]>
  saveRecentAlerts(alerts: SweepFeedAlert[]): Promise<boolean>
  /** the clock — injected so tests stay deterministic */
  now(): Date
}

export interface OpportunitySweepSummary {
  dryRun: boolean
  startedAt: string
  finishedAt: string
  /** companies listed by deps.listCompanies */
  companiesLoaded: number
  /** companies classified + diffed */
  tracked: number
  /** companies skipped (null row: nothing trackable from the shared cache) */
  skipped: number
  /** companies tracked but honestly ABSTAINED (map unavailable / no usable
   *  close / no session date) — no snapshot write, no alert */
  abstained: number
  alertsNew: number
  byType: Record<OpportunityAlertType, number>
  /** whether the state map was persisted (always false on a dry-run) */
  stateSaved: boolean
  /** whether the alert feed was persisted (always false on a dry-run) */
  feedSaved: boolean
  /** "companyId: message" for every company whose compute threw */
  errors: string[]
}

export const OPPORTUNITY_EMPTY_BY_TYPE: Record<OpportunityAlertType, number> = {
  actionable_ready: 0,
  conditional_entry: 0,
  invalidated: 0,
  missed: 0,
  upside_dropped: 0,
}

// ---------------------------------------------------------------------------
// Pure helpers — the classify input assembly (unit-testable on their own)
// ---------------------------------------------------------------------------

function usablePrice(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v) && v > 0
}

/** Map the signals WatchingSetup payload onto the classifier's structural
 *  setup input (activation.level → activationLevel; the documented level basis
 *  + volume condition travel verbatim as the activation condition). Returns
 *  null for a missing/level-less setup — the classifier then reports the
 *  honest "no documented trigger" observation state. */
export function toOpportunitySetup(setup: WatchingSetup | null | undefined): OpportunitySetupInput | null {
  if (!setup || !usablePrice(setup.activation?.level)) return null
  const conditionAr =
    [setup.activation.basisAr, setup.activation.volumeConditionAr]
      .filter((s) => typeof s === "string" && s.length > 0)
      .join(" — ") || null
  return {
    direction: setup.direction,
    activationLevel: setup.activation.level,
    activationConditionAr: conditionAr,
    provisional: true,
    provisionalRiskReward: typeof setup.provisionalRiskReward === "number" ? setup.provisionalRiskReward : null,
  }
}

export interface ClassifiedRow {
  view: OpportunityView
  map: ResistanceMap
  ladder: TargetLadder | null
}

/**
 * Build the resistance map + ladder from the row's OWN bars and classify the
 * row. Returns null = honest abstention (map unavailable / no usable close).
 * The ladder's side + entry band mirror the classifier's own plan selection
 * (stance plan first, then the lifecycle-recomputed plan, then the setup's
 * activation level as a point entry) so the T1 the gates evaluate is the T1
 * the ladder actually walked.
 */
export function classifyOpportunityRow(row: OpportunityComputedRow): ClassifiedRow | null {
  const bars = Array.isArray(row.bars) ? row.bars : []
  const map = buildResistanceMap(bars)
  if (!map.available) return null // insufficient valid sessions — abstain, no alert
  const lastClose = bars.length > 0 ? bars[bars.length - 1].close : NaN
  if (!usablePrice(lastClose)) return null

  const plan = row.tradePlan ?? row.view.tradePlan ?? null
  const setupInputRaw = toOpportunitySetup(row.setup)
  // SETUP freshness guard (mirror of the board's SETUP_STALE_GAP_PCT): a
  // watched setup whose activation sits far from the current close is dead
  // geometry (AMES: a buy trigger at ~108 while the stock traded 54) — never
  // classify or alert on it.
  const setupInput =
    setupInputRaw && usablePrice(setupInputRaw.activationLevel) &&
    Math.abs(((setupInputRaw.activationLevel - lastClose) / lastClose) * 100) > 15
      ? null
      : setupInputRaw

  let ladder: TargetLadder | null = null
  if (plan && usablePrice(plan.entryLow) && usablePrice(plan.entryHigh) && plan.entryHigh >= plan.entryLow) {
    ladder = buildTargetLadder(map, plan.bias, plan.entryLow, plan.entryHigh, lastClose)
  } else if (setupInput) {
    // watching row: the activation level is the documented point entry —
    // T1 is searched strictly beyond the trigger (selectT1's own reference).
    ladder = buildTargetLadder(map, setupInput.direction, setupInput.activationLevel, setupInput.activationLevel, lastClose)
  }
  // no plan and no setup → ladder null: the classifier still produces an
  // honest view (its no-plan / no-setup paths) — classify, don't abstain.

  const view = classifyOpportunity({
    lastClose,
    signalState: row.signalState,
    score: typeof row.score === "number" && Number.isFinite(row.score) ? row.score : 0,
    direction: row.tradePlan?.bias ?? row.setup?.direction ?? null,
    tradePlan: row.tradePlan,
    setup: setupInput,
    lifecycleView: row.view,
    zones: map.zones,
    ladder,
  })
  return { view, map, ladder }
}

// ---------------------------------------------------------------------------
// The sweep
// ---------------------------------------------------------------------------

/**
 * Run one opportunity pass. Deterministic given the deps: companies are
 * processed in ticker order, alerts merge into the shared feed newest-first,
 * and the state map is written in one shot at the end.
 */
export async function runOpportunitySweep(
  deps: OpportunitySweepDeps,
  opts: { dryRun?: boolean; feedCap?: number; maxCompanies?: number } = {},
): Promise<OpportunitySweepSummary> {
  const dryRun = opts.dryRun === true
  const feedCap = opts.feedCap ?? ALERT_FEED_CAP
  const maxCompanies = opts.maxCompanies ?? Number.POSITIVE_INFINITY
  const startedAt = deps.now().toISOString()

  const [listed, stateMap, feed] = await Promise.all([
    deps.listCompanies(),
    deps.loadStateMap().catch(() => ({}) as Record<string, OpportunityStateSnapshot>),
    deps.loadRecentAlerts().catch(() => [] as SweepFeedAlert[]),
  ])

  // Stable processing order: ticker (companyId as the total tie-break) — the
  // same ordering rule the lifecycle pass applies.
  const companies = [...listed]
    .sort((a, b) => {
      const ta = a.ticker ?? a.companyId
      const tb = b.ticker ?? b.companyId
      return ta < tb ? -1 : ta > tb ? 1 : a.companyId < b.companyId ? -1 : a.companyId > b.companyId ? 1 : 0
    })
    .slice(0, maxCompanies)

  const byType: Record<OpportunityAlertType, number> = { ...OPPORTUNITY_EMPTY_BY_TYPE }
  const newAlerts: SweepFeedAlert[] = []
  const errors: string[] = []
  const nextStateMap: Record<string, OpportunityStateSnapshot> = { ...stateMap }
  let tracked = 0
  let skipped = 0
  let abstained = 0

  for (const company of companies) {
    let row: OpportunityComputedRow | null = null
    try {
      row = await deps.computeOne(company.companyId, company.ticker)
    } catch (err) {
      errors.push(`${company.companyId}: ${String((err as Error)?.message ?? err).slice(0, 160)}`)
      continue
    }
    if (!row) {
      skipped++
      continue
    }

    // Honest abstention — inside the same try so a classify throw is also
    // contained per-company.
    let classified: ClassifiedRow | null = null
    let asOf: string | null = null
    try {
      classified = classifyOpportunityRow(row)
      asOf = row.view.asOf ?? (row.bars.length > 0 ? row.bars[row.bars.length - 1].ts : null)
    } catch (err) {
      errors.push(`${company.companyId}: ${String((err as Error)?.message ?? err).slice(0, 160)}`)
      continue
    }
    if (!classified || !asOf) {
      // Abstain: insufficient bars/map or no session date — the previous
      // snapshot (if any) is left untouched; count it, alert nothing.
      abstained++
      continue
    }

    const prev = stateMap[company.companyId] ?? null
    const diff = diffOpportunityState(prev, classified.view, {
      companyId: row.companyId,
      ticker: row.ticker,
      asOf,
    })
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

  return {
    dryRun,
    startedAt,
    finishedAt: deps.now().toISOString(),
    companiesLoaded: companies.length,
    tracked,
    skipped,
    abstained,
    alertsNew: newAlerts.length,
    byType,
    stateSaved,
    feedSaved,
    errors,
  }
}

// re-export for the script's summary printing (single source of the type list)
export { OPPORTUNITY_ALERT_TYPES }
