// =============================================================================
// Opportunity-transition alerts (v1) — PURE diff/dedup over opportunity views.
// =============================================================================
//
// opportunity-alerts@1 — the notification layer of owner directive §10. The
// opportunity classifier (src/lib/technical/opportunity.ts, opportunity@1) is
// DETERMINISTIC: the same stance + the same bars + the same resistance map
// always produce the same OpportunityView. This module diffs that view against
// the PREVIOUS persisted snapshot of the same company's opportunity state and
// produces the alert records for NEW transitions only.
//
// THE TRANSITION MATRIX (one alert type per transition, pinned by tests):
//
//   none→actionable (generalized: any non-actionable → actionable)
//                             ⇒ "actionable_ready"    «فرصة شراء/بيع جاهزة جديدة»
//   observation→conditional   ⇒ "conditional_entry"   «دخول مشروط تم تحديده»
//   actionable→invalidated    ⇒ "invalidated"         (a live opportunity died)
//   any→missed                ⇒ "missed"              «الفرصة فاتت — العائد
//                                                       المتبقي غير كافٍ»
//   eligible→upside below 5%  ⇒ "upside_dropped"      «انخفض العائد المتبقي
//                                                       دون 5%»
//
// Generalization note (the one deliberate superset of the written matrix):
// "none→actionable" is implemented as "any non-actionable → actionable". A
// conditional→actionable promotion (the watched setup activated, the plan
// recomputed and BOTH gates passed on real numbers) is the same "ready" event
// with better evidence — suppressing it would hide the single most important
// moment this layer exists for. observation→conditional and
// actionable→invalidated stay EXACT (only those previous states fire).
//
// PRECEDENCE (a company emits AT MOST ONE alert per sweep — one diff, one
// transition; evaluated top-down, first match wins):
//   1. actionable→invalidated  — the opportunity is dead (strongest verdict);
//   2. any→missed              — the no-chase verdict supersedes the numeric
//                                 drop (the drop is its cause);
//   3. eligible→upside_dropped — prev eligible (upside > 5) and the current
//                                 computed upside fell strictly below the 5%
//                                 gate (OPPORTUNITY_THRESHOLDS.minUpsidePct);
//   4. actionable_ready;
//   5. conditional_entry.
//   Overlap examples: actionable 5.2% → missed 4.7% fires "missed" ONLY;
//   actionable 5.2% → none 4.7% fires "upside_dropped"; exactly-5.00% does not
//   fire the drop alert (the title says دون 5% — strictly below; the classifier
//   itself rejects exactly 5.00 via its strict > gate, but this layer only
//   alerts on numbers it can honestly describe as "below 5").
//
// SILENT BY DESIGN (no alert type exists for these — do not invent states):
//   unchanged states (including actionable→actionable with a better upside,
//   e.g. 5.2→6.1), →"none" without a computable upside (no T1 anymore —
//   honest abstention), conditional/observation churn, and →"early".
//
// DEDUP RULES (the same contract lifecycle-alerts pins):
//   1. one alert per transition — identified by `${type}:${date}` where date is
//      the session date the classification consumed (the lifecycle view's
//      asOf / last bar). A state that persists re-diffs to the SAME state →
//      no new transition → no alert, regardless of the date;
//   2. no alert for unchanged states;
//   3. FIRST observation of a company (previous === null) is a BASELINE: the
//      snapshot is recorded with an empty ledger and NO alerts — a newly
//      deployed layer must never spam the feed with the states it just learned;
//   4. the ledger is pruned to the most recent EMITTED_KEYS_KEEP keys (the
//      same bound and ordering as the lifecycle ledger, via the shared
//      pruneEmitted helper);
//   5. a repeated A→B re-transition (state flapped back and forth between
//      sweeps) fires again under a NEW date key — each occurrence is a real
//      event; the ledger keeps them apart.
//
// BODY NUMBERS ARE HONEST: actionable/conditional/upside_dropped bodies cite
// view.upsidePctToT1 (the classifier's real computed number). MISSED bodies
// cite view.stateNoteAr instead of upsidePctToT1 — on a missed row the view's
// upsidePctToT1 is the stale ENTRY-based figure, while the classifier's own
// stateNoteAr carries the REAL remaining-upside-from-close number the no-chase
// rule fired on. Never fabricate a number the view does not carry.
//
// NO persistence here (no clocks, no randomness, no db import) — the storage
// seam is the `opportunity-sweep:state:v1` Setting row
// (lifecycle-alerts-store.ts) and the orchestration lives in
// opportunity-sweep.ts, both unit-testable with fakes. The alerts feed is the
// SHARED `lifecycle-sweep:alerts:v1` row — the merge/cap helpers are the
// generalized, kind-aware ones from lifecycle-alerts.ts (no re-implementation).
// =============================================================================

import { OPPORTUNITY_THRESHOLDS, type OpportunityState, type OpportunityView } from "../technical/opportunity"
import { pruneEmitted } from "./lifecycle-alerts"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type OpportunityAlertType =
  | "actionable_ready"
  | "conditional_entry"
  | "invalidated"
  | "missed"
  | "upside_dropped"

/** The full alert set — every type carries ALL the opportunity alert types. */
export const OPPORTUNITY_ALERT_TYPES: readonly OpportunityAlertType[] = [
  "actionable_ready",
  "conditional_entry",
  "invalidated",
  "missed",
  "upside_dropped",
]

/** Stable same-date rank (a ready call outranks a conditional entry; death and
 *  the no-chase verdict sort last — the causal order of a dying opportunity). */
const OPPORTUNITY_TYPE_RANK: Record<OpportunityAlertType, number> = {
  actionable_ready: 0,
  conditional_entry: 1,
  invalidated: 2,
  upside_dropped: 3,
  missed: 4,
}

export interface OpportunityAlert {
  companyId: string
  ticker: string
  /** feed-kind discriminator — opportunity items always carry it explicitly */
  kind: "opportunity"
  type: OpportunityAlertType
  /** session date (YYYY-MM-DD) the transition was observed on (the last
   *  session the classification consumed) */
  date: string
  titleAr: string
  /** cites the real numbers (upsidePctToT1 / the classifier's own note) */
  bodyAr: string
}

/** The persisted per-company sweep snapshot (stored as Setting KV JSON in
 *  `opportunity-sweep:state:v1`). */
export interface OpportunityStateSnapshot {
  /** the classified state after the last successful sweep */
  state: OpportunityState
  /** the view's eligibility flag (true ONLY on "actionable") */
  eligible: boolean
  /** the view's computed upside (null when no plan/T1 — abstention territory) */
  upsidePctToT1: number | null
  /** last session consumed by the classification */
  asOf: string
  /** transition keys already alerted (`${type}:${date}`), sorted ascending —
   *  the dedup ledger; pruned to the most recent EMITTED_KEYS_KEEP entries */
  emitted: string[]
}

export interface OpportunityCompanyRef {
  companyId: string
  ticker: string | null
}

/** Context of one diff — who, and which session the classification saw. */
export interface OpportunityDiffContext {
  companyId: string
  ticker: string | null
  /** session date (YYYY-MM-DD) the classification consumed — the alert date
   *  and the dedup-key suffix */
  asOf: string
}

export interface OpportunityDiffResult {
  /** NEW transitions only (deduped against the previous snapshot) — [] on a
   *  baseline or an unchanged state. At most ONE alert (the precedence rules). */
  alerts: OpportunityAlert[]
  /** the snapshot to persist for the next run (the ledger includes the fired
   *  key whether or not anything else changed) */
  snapshot: OpportunityStateSnapshot
}

// ---------------------------------------------------------------------------
// Titles — Arabic-first, the directive's strings verbatim
// ---------------------------------------------------------------------------

/** Arabic state label used inside bodies (never a bare machine state). */
const STATE_AR: Record<OpportunityState, string> = {
  early: "مبكرة",
  observation: "تحت المراقبة",
  conditional: "مشروطة",
  actionable: "قابلة للتنفيذ",
  invalidated: "ملغاة",
  missed: "فائتة",
  none: "غير مؤهلة حاليًا",
}

/** Percentage display — trims float dust without lying (opportunity.ts's
 *  fmtPct convention: 4.96 stays "4.96", a 4.96% upside never prints "5%"). */
function fmtPct(value: number): string {
  return String(Math.round(value * 100) / 100)
}

/** The Arabic alert title for a transition type — the directive's strings
 *  verbatim, direction-aware only where the directive's string is. */
export function opportunityAlertTitleAr(type: OpportunityAlertType, direction: "buy" | "sell" | null): string {
  switch (type) {
    case "actionable_ready":
      return direction === "sell" ? "فرصة بيع جاهزة جديدة" : direction === "buy" ? "فرصة شراء جاهزة جديدة" : "فرصة جاهزة جديدة"
    case "conditional_entry":
      return "دخول مشروط تم تحديده"
    case "invalidated":
      return "فرصة قابلة للتنفيذ أُلغيت"
    case "missed":
      return "الفرصة فاتت — العائد المتبقي غير كافٍ"
    case "upside_dropped":
      return "انخفض العائد المتبقي دون 5%"
  }
}

// ---------------------------------------------------------------------------
// Key + transition mapping (pure, deterministic)
// ---------------------------------------------------------------------------

/** The dedup key of a transition: type + the session date it fired on. */
export function opportunityAlertKey(type: OpportunityAlertType, date: string): string {
  return `${type}:${date}`
}

/** The transition the previous → current state pair represents, with the
 *  precedence rules applied (first match wins; null = nothing to report). */
function transitionTypeFor(previous: OpportunityStateSnapshot, current: OpportunityView): OpportunityAlertType | null {
  const minUpside = OPPORTUNITY_THRESHOLDS.minUpsidePct
  // 1. a live (executable) opportunity died
  if (previous.state === "actionable" && current.state === "invalidated") return "invalidated"
  // 2. the no-chase verdict — ANY previous state (except missed itself: an
  //    unchanged missed state is not a new transition)
  if (current.state === "missed" && previous.state !== "missed") return "missed"
  // 3. the eligibility drop: prev eligible (its upside cleared the strict
  //    gate) and the current computed upside fell strictly below the gate
  if (
    previous.state === "actionable" &&
    previous.eligible &&
    previous.upsidePctToT1 !== null &&
    previous.upsidePctToT1 > minUpside &&
    current.state !== "actionable" &&
    current.upsidePctToT1 !== null &&
    current.upsidePctToT1 < minUpside
  )
    return "upside_dropped"
  // 4. became actionable (directive's none→actionable, generalized to any
  //    non-actionable previous state — see the banner)
  if (current.state === "actionable" && previous.state !== "actionable") return "actionable_ready"
  // 5. the watched geometry first cleared both provisional gates
  if (previous.state === "observation" && current.state === "conditional") return "conditional_entry"
  return null
}

/** The alert body — cites the real numbers the view carries (see the banner's
 *  honesty note on missed rows). */
function bodyArFor(type: OpportunityAlertType, ticker: string, view: OpportunityView): string {
  const note = typeof view.stateNoteAr === "string" ? view.stateNoteAr.trim() : ""
  const upside = view.upsidePctToT1
  switch (type) {
    case "actionable_ready": {
      const dirAr = view.direction === "sell" ? "بيع" : view.direction === "buy" ? "شراء" : null
      const pct = upside !== null ? ` عائد متوقع ${fmtPct(upside)}% حتى الهدف الأول،` : ""
      return `فرصة ${ticker}${dirAr ? ` (${dirAr})` : ""} أصبحت جاهزة:${pct} الحالة: قابلة للتنفيذ.`
    }
    case "conditional_entry": {
      const pct = upside !== null ? ` عائد تقديري ${fmtPct(upside)}% حتى الهدف الأول عند مستوى التفعيل،` : ""
      return `دخول مشروط على ${ticker}:${pct} الحالة: مشروطة — المستويات تقديرية وتُعاد الحسابات بالكامل عند التفعيل.`
    }
    case "invalidated": {
      return `فرصة ${ticker} القابلة للتنفيذ لم تعد قائمة — الحالة: ملغاة.${note ? ` ${note}` : ""}`
    }
    case "missed": {
      // The view's upsidePctToT1 on a missed row is the stale ENTRY-based
      // figure — the honest number is the classifier's own stateNoteAr (it
      // carries the remaining-upside-from-close percentage the rule fired on).
      return `الفرصة فاتت على ${ticker} — الحالة: فائتة (لا مطاردة ولا دخول متأخر).${note ? ` ${note}` : ""}`
    }
    case "upside_dropped": {
      return `عائد ${ticker} حتى الهدف الأول انخفض إلى ${upside !== null ? fmtPct(upside) : "—"}% — دون بوابة الـ5% — الحالة: ${STATE_AR[view.state] ?? view.state}.`
    }
  }
}

/** Ledger bound — identical rationale and shape to the lifecycle ledger. */
export const OPPORTUNITY_EMITTED_KEYS_KEEP = 64

/**
 * Every alert the previous → current pair produces (dedup applied, precedence
 * applied — at most one). Exported for tests; the diff below is the API.
 */
export function currentOpportunityAlerts(
  company: OpportunityCompanyRef,
  previous: OpportunityStateSnapshot,
  current: OpportunityView,
  asOf: string,
): OpportunityAlert[] {
  const type = transitionTypeFor(previous, current)
  if (!type) return []
  const ticker = company.ticker ?? company.companyId
  return [
    {
      companyId: company.companyId,
      ticker,
      kind: "opportunity",
      type,
      date: asOf,
      titleAr: opportunityAlertTitleAr(type, current.direction),
      bodyAr: bodyArFor(type, ticker, current),
    },
  ]
}

function snapshotOf(current: OpportunityView, asOf: string, emitted: string[]): OpportunityStateSnapshot {
  return {
    state: current.state,
    eligible: current.eligible,
    upsidePctToT1: current.upsidePctToT1,
    asOf,
    emitted: pruneEmitted(emitted),
  }
}

/**
 * Diff one company's fresh OpportunityView against its previous persisted
 * snapshot (null = first observation). Pure and deterministic: identical
 * inputs → identical output. See the banner for the matrix, the precedence
 * and the dedup rules.
 */
export function diffOpportunityState(
  previous: OpportunityStateSnapshot | null,
  current: OpportunityView,
  ctx: OpportunityDiffContext,
): OpportunityDiffResult {
  if (!previous) {
    // BASELINE — first observation: record the state, alert nothing, empty
    // ledger (there is no dated transition to record yet).
    return { alerts: [], snapshot: snapshotOf(current, ctx.asOf, []) }
  }

  // Rule 1 (belt and braces): the ledger suppresses a repeated
  // `${type}:${date}` key (state flapping back and forth between two sweeps on
  // the SAME session date); the state-comparison rules above already make the
  // common case impossible, and the feed merge is the final identity gate.
  const known = new Set(previous.emitted)
  const alerts = currentOpportunityAlerts(
    { companyId: ctx.companyId, ticker: ctx.ticker },
    previous,
    current,
    ctx.asOf,
  ).filter((a) => !known.has(opportunityAlertKey(a.type, a.date)))
  const firedKeys = alerts.map((a) => opportunityAlertKey(a.type, a.date))
  return {
    alerts,
    snapshot: snapshotOf(current, ctx.asOf, [...previous.emitted, ...firedKeys]),
  }
}
