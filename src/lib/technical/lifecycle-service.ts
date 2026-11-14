// =============================================================================
// Plan-lifecycle service — DB plumbing around the pure lifecycle core
// (src/lib/technical/lifecycle.ts). ZERO persistence of its own: no new
// tables, no writes — the view is DERIVED on demand from
//   1. the persisted canonical stance (src/lib/technical/stance-store.ts —
//      the same single-source-of-truth row the board and the company tab
//      read), and
//   2. the stored daily PriceBar history (companyId + ts unique; volume
//      nullable → null/zero volume is carried as null, the lifecycle treats
//      it as "volume unknown" and never as confirmation).
//
// SEAM: everything DB-bound lives behind LifecycleDeps (function injection),
// so unit tests inject stance + bar arrays and never touch a database — the
// production DB is not reachable from the test sandbox.
//
// Freshness contract: the stance is read via readCanonicalStance (the board's
// read path) — a missing row, a wrong engine version, or a row older than
// BOARD_MAX_AGE_MS yields null → the caller sees "no lifecycle" rather than a
// derived view built on a stale reading.
// =============================================================================

import { db } from "@/lib/db"
import { readCanonicalStance } from "./stance-store"
import {
  computeLifecycle,
  insufficientLifecycleView,
  type LifecycleBar,
  type LifecycleView,
} from "./lifecycle"
import type { SignalState, TechStance } from "./signals"

/** Sessions the lifecycle needs BEFORE it trusts a walk: the 20-session
 *  volume average (activation condition) + the creation session itself.
 *  Below this the loader short-circuits with "بيانات غير كافية". */
export const LIFECYCLE_WARMUP_SESSIONS = 21

/** Calendar-day lookback for bar history: the plan REBUILD at activation
 *  derives its pivots from the last 120 closes (trade-plan.ts) — 420 calendar
 *  days ≈ 250+ EGX sessions keeps the rebuild structure honest while staying
 *  a bounded, indexed query. */
export const LIFECYCLE_LOOKBACK_DAYS = 420

export interface LifecycleDeps {
  /** the persisted canonical stance for a company (null = none/unsupported) */
  loadStance(companyId: string): Promise<{ stance: TechStance; dataAsOf: Date } | null>
  /** ascending daily bars from fromTs (inclusive) onward */
  loadBars(companyId: string, fromTs: Date): Promise<LifecycleBar[]>
}

export const defaultLifecycleDeps: LifecycleDeps = {
  async loadStance(companyId) {
    const canonical = await readCanonicalStance(companyId)
    return canonical ? { stance: canonical.stance, dataAsOf: canonical.dataAsOf } : null
  },
  async loadBars(companyId, fromTs) {
    const rows = await db.priceBar.findMany({
      where: { companyId, ts: { gte: fromTs } },
      orderBy: { ts: "asc" },
      select: { ts: true, open: true, high: true, low: true, close: true, volume: true },
    })
    return rows.map((r) => ({
      ts: r.ts.toISOString().slice(0, 10),
      open: r.open,
      high: r.high,
      low: r.low,
      close: r.close,
      volume: r.volume !== null && Number.isFinite(r.volume) && r.volume > 0 ? r.volume : null,
    }))
  },
}

export interface LifecycleResult {
  companyId: string
  ticker: string | null
  /** the persisted stance's publication state (echoed for the gated payload) */
  signalState: SignalState
  lifecycle: LifecycleView
}

/** API response shape (route serializes exactly this; the route strips
 *  `lifecycle` for free/anonymous callers). */
export interface LifecycleApiResponse {
  companyId: string
  ticker: string | null
  signalState: SignalState | null
  lifecycleState: import("./lifecycle").LifecycleState | null
  /** full view — null for free callers and when there is nothing to track */
  lifecycle: LifecycleView | null
  plan?: string
}

/**
 * Assemble the LifecycleView for one company.
 * Returns null when there is nothing to track: no fresh stance, a stance
 * without a signalState, a "wait" row, or a watching/confirmed row missing
 * its setup/plan payload (an engine-invariant violation — never fabricate).
 */
export async function getCompanyLifecycle(
  companyId: string,
  opts: {
    deps?: LifecycleDeps
    ticker?: string | null
    /** optional bar-derived pivots handed to the activation-time plan rebuild
     *  (production callers omit them — the plan builder then derives its own
     *  close-only pivots from the prefix closes) */
    rebuildSupports?: { price: number }[] | null
    rebuildResistances?: { price: number }[] | null
  } = {},
): Promise<LifecycleResult | null> {
  const deps = opts.deps ?? defaultLifecycleDeps
  const loaded = await deps.loadStance(companyId)
  if (!loaded) return null
  const { stance, dataAsOf } = loaded
  const signalState = stance.signalState
  if (!signalState) return null
  if (signalState === "wait") return null
  if (signalState === "watching" && !stance.setup) return null
  if (signalState === "confirmed" && !stance.tradePlan) return null

  // Creation marker: the stance's dataAsOf is the LAST session its reading
  // saw — strictly-later sessions are the future it reacts to. (A stance
  // persisted with dataAsOf epoch-0 degrades to "every bar is future" — the
  // volume condition then stays unmet, so such a view can never confirm.)
  const createdOn = dataAsOf.toISOString().slice(0, 10)
  const fromTs = new Date(dataAsOf.getTime() - LIFECYCLE_LOOKBACK_DAYS * 86_400_000)

  let bars: LifecycleBar[] = []
  try {
    bars = await deps.loadBars(companyId, fromTs)
  } catch {
    bars = [] // degrade to the insufficient-data view — never throw past the seam
  }

  if (bars.length < LIFECYCLE_WARMUP_SESSIONS) {
    const basis = signalState === "confirmed" ? "confirmed" : "watching"
    const asOf = bars.length ? bars[bars.length - 1].ts : createdOn
    return {
      companyId,
      ticker: opts.ticker ?? null,
      signalState,
      lifecycle: insufficientLifecycleView(basis, signalState, asOf),
    }
  }

  const view = computeLifecycle({
    signalState,
    setup: stance.setup ?? null,
    tradePlan: stance.tradePlan ?? null,
    bars,
    createdOn,
    rebuildSupports: opts.rebuildSupports ?? null,
    rebuildResistances: opts.rebuildResistances ?? null,
  })
  if (!view) return null
  return { companyId, ticker: opts.ticker ?? null, signalState, lifecycle: view }
}
