// =============================================================================
// EGXANO Plan-lifecycle layer (v1) — DERIVED, on demand, zero persistence.
// =============================================================================
//
// A published stance (signalState "watching" with a WatchingSetup, or
// "confirmed" with a TradePlan) REACTS to the daily bars that trade after its
// creation. This module derives that reaction from data — no new DB tables, no
// schema changes, no stored state: the same inputs ALWAYS produce the same
// view (deterministic: no clocks, no randomness, no AI).
//
// TRANSITION RULES (defaults in DEFAULT_LIFECYCLE_PARAMS):
//
//   watching setup (direction buy — mirrored for sell):
//     • "confirmed"  — a session AFTER creation closes STRICTLY beyond the
//       activation level (close_above: close > level, close_below: close <
//       level) AND its relative volume (session volume ÷ mean of the prior
//       20 volume-carrying sessions, ≥ 10 required) is ≥ volumeRatioMin (1.5).
//       On the activation bar the plan is REBUILT with the existing
//       buildTradePlan (src/lib/technical/trade-plan.ts) evaluated at
//       lastClose = activation close, structure derived from the closes seen
//       SO FAR (strictly prefix-only). The setup confirms ONLY if the rebuilt
//       plan anchors AND its riskReward ≥ minRiskReward (1.5) — a weak
//       recompute NEVER auto-confirms: state "expired" (reason: recompute
//       rejected).
//     • "invalidated" — a session closes beyond the preEntryInvalidation level
//       (buy: close < level, sell: close > level) BEFORE activation. The
//       event date travels on the event.
//     • "expired" — maxWatchingSessions (30) sessions after creation elapsed
//       without activation or invalidation. Sessions past expiry are ignored
//       (terminal states freeze the walk).
//
//   confirmed plan (bias buy — mirrored for sell):
//     • "active" — the first daily close inside the entry zone
//       [entryLow, entryHigh] enters the trade at that close; from that bar
//       the walk mirrors the backtest execution model
//       (src/lib/backtesting/execution.ts): stop precedence over target
//       within one session, holding sessions counted INCLUSIVE of the entry
//       session (a same-session round trip is possible and is disclosed),
//       time stop at the session where the held count reaches maxHoldSessions.
//       With OHLC bars the fills upgrade from execution.ts's close-only model
//       to intraday touches with an explicit GAP RULE:
//         stop  — low touches/breaches the stop (buy); if the session OPEN is
//                 already beyond the stop, the fill is the OPEN and the event
//                 discloses "تنفيذ على فجوة الافتتاح".
//         target — high touches the target zone (buy); the gap rule reversed
//                 (open already beyond the target → fill at the OPEN, also
//                 disclosed).
//     • "stopped" | "targeted" — first stop/target fill (event carries date +
//       fill price).
//     • "time_stopped" — exit at the session CLOSE after maxHoldSessions
//       (15) held sessions (semantics mirror execution.ts's
//       config.timeStopSessions counting; the value is a lifecycle param so
//       the horizon can differ from the backtest default without touching
//       backtesting/**).
//     • "expired" — maxWatchingSessions sessions after creation with NO close
//       inside the entry zone (the plan went stale before it ever traded).
//
//   Data honesty: bars BEFORE creation (ts <= createdOn) are warmup context
//   only (volume average, plan-rebuild structure) — they can never trigger a
//   transition. Data ending before a terminal transition leaves the state at
//   "watching"/"confirmed"/"active" (open, not expired).
// =============================================================================

import { buildTradePlan, type TradePlan } from "./trade-plan"
import type { SignalState, WatchingSetup } from "./signals"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** One daily bar — exactly the OHLCV the lifecycle reacts to (ascending). */
export interface LifecycleBar {
  ts: string // YYYY-MM-DD session date
  open: number
  high: number
  low: number
  close: number
  volume: number | null
}

export type WatchingLifecycleState = "watching" | "confirmed" | "invalidated" | "expired"
export type ConfirmedLifecycleState = "confirmed" | "active" | "stopped" | "targeted" | "expired"
export type LifecycleState = WatchingLifecycleState | ConfirmedLifecycleState

export type LifecycleEventType =
  | "activated"
  | "stopped"
  | "targeted"
  | "time_stopped"
  | "invalidated"
  | "expired"

export interface LifecycleEvent {
  type: LifecycleEventType
  /** session date (YYYY-MM-DD) the event fired on */
  date: string
  /** the price the event realizes (close / fill price) — null when unknown */
  price: number | null
  /** honest Arabic note; gap fills are explicitly labeled */
  noteAr: string
}

export interface LifecycleView {
  /** which payload produced this view */
  basis: "watching" | "confirmed"
  /** the stance publication state the view was built from */
  signalState: SignalState
  state: LifecycleState
  /** Arabic explanation when the view is degraded (insufficient data,
   *  recompute rejected, no plan) — null on a clean walk */
  reasonAr: string | null
  /** last session date consumed by the walk (null when no bars at all) */
  asOf: string | null
  /** sessions AFTER creation the walk consumed before freezing */
  evaluatedSessions: number
  events: LifecycleEvent[]
  /** the RECOMPUTED plan — watching basis only, present on confirmation */
  tradePlan: TradePlan | null
  activation: { date: string; price: number } | null
  entry: { date: string; price: number } | null
  exit: { date: string; price: number; kind: "stopped" | "targeted" | "time_stopped" } | null
  /** held sessions inclusive of the entry session (execution.ts semantics) */
  sessionsHeld: number | null
}

/** Numeric lifecycle knobs — the Arabic volumeConditionAr string is NEVER
 *  parsed; the numeric rule travels as explicit params (default 1.5× the
 *  20-session average, exactly what the setup's Arabic text promises). */
export interface LifecycleParams {
  /** activation close volume ÷ prior-average minimum */
  volumeRatioMin: number
  /** sessions in the prior volume average */
  volumeAvgSessions: number
  /** minimum volume-carrying sessions required for the average to be usable */
  volumeMinHistory: number
  /** watching: sessions before expiry; confirmed: sessions before entry expiry */
  maxWatchingSessions: number
  /** time stop: held sessions inclusive of the entry session */
  maxHoldSessions: number
  /** recompute gate: the rebuilt plan must pay at least this RR to confirm */
  minRiskReward: number
}

export const DEFAULT_LIFECYCLE_PARAMS: LifecycleParams = {
  volumeRatioMin: 1.5,
  volumeAvgSessions: 20,
  volumeMinHistory: 10,
  maxWatchingSessions: 30,
  maxHoldSessions: 15,
  minRiskReward: 1.5,
}

export interface LifecycleInput {
  signalState: SignalState
  /** watching payload — required when signalState === "watching" */
  setup?: WatchingSetup | null
  /** confirmed payload — required when signalState === "confirmed" */
  tradePlan?: TradePlan | null
  /** ascending daily bars; sessions AFTER createdOn are the future reacted to */
  bars: LifecycleBar[]
  /** creation marker: bars with ts <= createdOn are warmup context.
   *  null/undefined → every bar is treated as future. */
  createdOn?: string | null
  /** OPTIONAL precomputed pivot structure derived FROM THE BARS (the loader
   *  derives it with the same supportResistance clustering the engine uses)
   *  and handed to the activation-time plan REBUILD. When omitted the rebuild
   *  falls back to the plan builder's own close-only pivot derivation. */
  rebuildSupports?: { price: number }[] | null
  rebuildResistances?: { price: number }[] | null
  params?: Partial<LifecycleParams>
}

// ---------------------------------------------------------------------------
// Helpers — all pure, all deterministic
// ---------------------------------------------------------------------------

const fmt = (v: number): string => v.toFixed(2)

function sortedBars(bars: LifecycleBar[]): LifecycleBar[] {
  return [...bars].sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0))
}

/** Index of the first bar strictly AFTER createdOn (0 when createdOn is null). */
function firstFutureIndex(bars: LifecycleBar[], createdOn: string | null | undefined): number {
  if (!createdOn) return 0
  for (let i = 0; i < bars.length; i++) {
    if (bars[i].ts > createdOn) return i
  }
  return bars.length
}

/** Relative volume of session i vs the prior volume-carrying sessions.
 *  Mirrors the close engine's documented skip-zero-volume behavior
 *  (src/lib/technical/signals.ts relVolAt): the mean covers the prior
 *  volumeAvgSessions usable sessions; below volumeMinHistory of them the
 *  input is unknown → null → the volume condition is NOT met. */
function relativeVolumeAt(bars: LifecycleBar[], i: number, p: LifecycleParams): number | null {
  const v = bars[i].volume
  if (v === null || !(v > 0)) return null
  const prior: number[] = []
  for (let j = i - 1; j >= 0 && prior.length < p.volumeAvgSessions; j--) {
    const pv = bars[j].volume
    if (pv !== null && pv > 0) prior.push(pv)
  }
  if (prior.length < p.volumeMinHistory) return null
  const mean = prior.reduce((s, x) => s + x, 0) / prior.length
  if (!(mean > 0)) return null
  return v / mean
}

/** Close-to-close daily volatility % over the last 20 closes — the documented
 *  ATR proxy input of the plan builder on close-only paths. null below 21
 *  closes (the builder then falls back to its [2%, 8%] band). */
function dailyVolPct(closes: number[]): number | null {
  if (closes.length < 21) return null
  const moves: number[] = []
  for (let i = closes.length - 20; i < closes.length; i++) {
    if (closes[i - 1] > 0) moves.push(((closes[i] - closes[i - 1]) / closes[i - 1]) * 100)
  }
  if (!moves.length) return null
  const mean = moves.reduce((s, m) => s + m, 0) / moves.length
  const variance = moves.reduce((s, m) => s + (m - mean) ** 2, 0) / moves.length
  return Math.sqrt(variance)
}

function baseView(basis: "watching" | "confirmed", signalState: SignalState): LifecycleView {
  return {
    basis,
    signalState,
    state: basis === "watching" ? "watching" : "confirmed",
    reasonAr: null,
    asOf: null,
    evaluatedSessions: 0,
    events: [],
    tradePlan: null,
    activation: null,
    entry: null,
    exit: null,
    sessionsHeld: null,
  }
}

/** Degraded view for insufficient data (service/loader contract: bars below
 *  warmup) — the publication state is echoed unchanged, never invented. */
export function insufficientLifecycleView(
  basis: "watching" | "confirmed",
  signalState: SignalState,
  asOf: string | null,
  noteAr = "بيانات غير كافية لحساب دورة الحياة — يحتاج الحساب تاريخ أسعار يومي كافٍ بعد إنشاء القراءة.",
): LifecycleView {
  return { ...baseView(basis, signalState), reasonAr: noteAr, asOf }
}

// ---------------------------------------------------------------------------
// Watching branch — activation / invalidation / expiry + plan revalidation
// ---------------------------------------------------------------------------

function runWatching(bars: LifecycleBar[], createdOn: string | null | undefined, setup: WatchingSetup, signalState: SignalState, p: LifecycleParams, rebuildSupports?: { price: number }[] | null, rebuildResistances?: { price: number }[] | null): LifecycleView {
  const view = baseView("watching", signalState)
  const buy = setup.direction === "buy"
  const act = setup.activation
  const inv = setup.preEntryInvalidation
  const startIdx = firstFutureIndex(bars, createdOn)
  if (bars.length > 0) view.asOf = bars[Math.min(bars.length - 1, Math.max(startIdx - 1, 0))].ts
  if (startIdx >= bars.length) return view // no future yet — still watching

  let elapsed = 0
  for (let k = 0; k < p.maxWatchingSessions; k++) {
    const i = startIdx + k
    if (i >= bars.length) {
      view.asOf = bars[bars.length - 1].ts
      view.evaluatedSessions = elapsed
      return view // data ended mid-watch — open, not expired
    }
    elapsed = k + 1
    const b = bars[i]
    view.asOf = b.ts

    // ACTIVATION — the daily close decides, never an intraday touch; the
    // volume condition is the explicit numeric rule (no Arabic parsing).
    const closeBeyond = buy ? b.close > act.level : b.close < act.level
    if (closeBeyond) {
      const rel = relativeVolumeAt(bars, i, p)
      if (rel !== null && rel >= p.volumeRatioMin) {
        // REVALIDATE: rebuild the plan at the activation close over the
        // closes seen so far (strictly prefix-only — no lookahead).
        const closes = bars.slice(0, i + 1).map((x) => x.close)
        const plan = buildTradePlan({
          signal: setup.direction,
          lastClose: b.close,
          closes,
          supports: rebuildSupports ?? null,
          resistances: rebuildResistances ?? null,
          volPct: dailyVolPct(closes),
        })
        view.activation = { date: b.ts, price: b.close }
        view.events.push({
          type: "activated",
          date: b.ts,
          price: b.close,
          noteAr: buy
            ? `تفعّلت الفرصة بإغلاق يومي عند ${fmt(b.close)} فوق مستوى التفعيل ${fmt(act.level)} بحجم ${rel.toFixed(1)}× المتوسط — أُعيد حساب الخطة بالكامل عند هذا الإغلاق.`
            : `تفعّلت الفرصة بإغلاق يومي عند ${fmt(b.close)} تحت مستوى التفعيل ${fmt(act.level)} بحجم ${rel.toFixed(1)}× المتوسط — أُعيد حساب الخطة بالكامل عند هذا الإغلاق.`,
        })
        if (plan && plan.riskReward >= p.minRiskReward) {
          view.state = "confirmed"
          view.tradePlan = plan
          view.evaluatedSessions = elapsed
          return view
        }
        // WEAK RECOMPUTE — never auto-confirm: the opportunity is dead.
        view.state = "expired"
        view.reasonAr = "أُلغيت بعد التفعيل: الخطة المُعاد حسابها عند إغلاق التفعيل لم تثبت (نسبة المخاطرة/العائد أقل من الحد أو لا تُثبَّت على الهيكل) — الفرصة لا تتحول إلى قراءة مؤكدة."
        view.events.push({
          type: "expired",
          date: b.ts,
          price: b.close,
          noteAr: "إعادة حساب الخطة عند التفعيل رُفضت — انتهت الفرصة (لا تأكيد تلقائي على حساب ضعيف).",
        })
        view.evaluatedSessions = elapsed
        return view
      }
      // close beyond the level but volume unconfirmed → the close alone does
      // not activate; the setup stays watching (no event — not a transition).
    }

    // PRE-ENTRY INVALIDATION — a daily close beyond the invalidation level
    // before activation kills the opportunity (separate from the post-entry
    // stop, exactly as the setup's postEntryNoteAr promises).
    const invalidated = buy ? b.close < inv.level : b.close > inv.level
    if (invalidated) {
      view.state = "invalidated"
      view.reasonAr = null
      view.events.push({
        type: "invalidated",
        date: b.ts,
        price: b.close,
        noteAr: buy
          ? `أُلغيت الفرصة قبل الدخول: إغلاق يومي عند ${fmt(b.close)} تحت مستوى الإلغاء ${fmt(inv.level)} — ${inv.reasonAr}`
          : `أُلغيت الفرصة قبل الدخول: إغلاق يومي عند ${fmt(b.close)} فوق مستوى الإلغاء ${fmt(inv.level)} — ${inv.reasonAr}`,
      })
      view.evaluatedSessions = elapsed
      return view
    }
  }

  // EXPIRY — the window elapsed with no activation/invalidation. Terminal
  // states freeze the walk: sessions after the expiry bar are ignored.
  const expiryIdx = startIdx + p.maxWatchingSessions - 1
  if (expiryIdx < bars.length) {
    const b = bars[expiryIdx]
    view.state = "expired"
    view.reasonAr = `انتهت صلاحية الفرصة بعد ${p.maxWatchingSessions} جلسة بدون تفعيل أو إلغاء — تُعاد القراءة من البيانات الحالية.`
    view.asOf = b.ts
    view.events.push({
      type: "expired",
      date: b.ts,
      price: b.close,
      noteAr: `انتهت المهلة: ${p.maxWatchingSessions} جلسة بعد إنشاء الفرصة بدون إغلاق يفعّل المستوى ${fmt(act.level)} أو يلامس شرط الإلغاء.`,
    })
    view.evaluatedSessions = p.maxWatchingSessions
  } else {
    view.evaluatedSessions = elapsed
    view.asOf = bars[bars.length - 1].ts
  }
  return view
}

// ---------------------------------------------------------------------------
// Confirmed branch — entry + execution mirroring the backtest model
// ---------------------------------------------------------------------------

interface FillResult {
  kind: "stopped" | "targeted" | "time_stopped"
  price: number
  gap: boolean
  sameSessionAsEntry: boolean
}

function runConfirmed(bars: LifecycleBar[], createdOn: string | null | undefined, plan: TradePlan, signalState: SignalState, p: LifecycleParams): LifecycleView {
  const view = baseView("confirmed", signalState)
  const buy = plan.bias === "buy"
  const startIdx = firstFutureIndex(bars, createdOn)
  if (bars.length > 0) view.asOf = bars[Math.min(bars.length - 1, Math.max(startIdx - 1, 0))].ts
  if (startIdx >= bars.length) return view // nothing traded yet

  // ---- ENTRY: the first daily close inside the entry zone enters the trade
  let entryIdx = -1
  let scanned = 0
  for (let k = 0; k < p.maxWatchingSessions; k++) {
    const i = startIdx + k
    if (i >= bars.length) {
      view.evaluatedSessions = scanned
      view.asOf = bars[bars.length - 1].ts
      return view // data ended before entry — still confirmed, not expired
    }
    scanned = k + 1
    const b = bars[i]
    view.asOf = b.ts
    if (b.close >= plan.entryLow && b.close <= plan.entryHigh) {
      entryIdx = i
      view.entry = { date: b.ts, price: b.close }
      view.events.push({
        type: "activated",
        date: b.ts,
        price: b.close,
        noteAr: `أول إغلاق يومي داخل منطقة الدخول (${fmt(plan.entryLow)}–${fmt(plan.entryHigh)}) عند ${fmt(b.close)} — بدأ تتبع الصفقة من هذه الجلسة.`,
      })
      break
    }
  }

  if (entryIdx < 0) {
    // ENTRY EXPIRY — the plan went stale before it ever traded.
    const expiryIdx = startIdx + p.maxWatchingSessions - 1
    if (expiryIdx < bars.length) {
      const b = bars[expiryIdx]
      view.state = "expired"
      view.reasonAr = `انتهت صلاحية الخطة بعد ${p.maxWatchingSessions} جلسة بدون إغلاق داخل منطقة الدخول (${fmt(plan.entryLow)}–${fmt(plan.entryHigh)}).`
      view.asOf = b.ts
      view.evaluatedSessions = p.maxWatchingSessions
      view.events.push({
        type: "expired",
        date: b.ts,
        price: b.close,
        noteAr: `انتهت المهلة بدون دخول: ${p.maxWatchingSessions} جلسة بدون إغلاق داخل منطقة الدخول — الخطة لم تعد قابلة للتتبع.`,
      })
    } else {
      view.evaluatedSessions = scanned
    }
    return view
  }

  // ---- EXECUTION WALK from the entry session INCLUSIVE (execution.ts
  // semantics: holding sessions count the entry session; stop precedence
  // over target; time stop at the held-session limit). Fills use the OHLC
  // touches with the gap rule; every gap fill is disclosed.
  const fillAt = (b: LifecycleBar, held: number): FillResult => {
    // 1. STOP (precedence — the conservative order the backtest model uses)
    const stopTouched = buy ? b.low <= plan.stop : b.high >= plan.stop
    if (stopTouched) {
      const gap = buy ? b.open < plan.stop : b.open > plan.stop
      return { kind: "stopped", price: gap ? b.open : plan.stop, gap, sameSessionAsEntry: held === 1 }
    }
    // 2. TARGET — touch of the target zone's near edge; gap rule reversed
    const targetTouched = buy ? b.high >= plan.targetLow : b.low <= plan.targetHigh
    if (targetTouched) {
      const gap = buy ? b.open > plan.targetLow : b.open < plan.targetHigh
      const touch = buy ? plan.targetLow : plan.targetHigh
      return { kind: "targeted", price: gap ? b.open : touch, gap, sameSessionAsEntry: held === 1 }
    }
    // 3. TIME STOP — exit at this session's close (held includes entry)
    return { kind: "time_stopped", price: b.close, gap: false, sameSessionAsEntry: held === 1 }
  }

  for (let i = entryIdx; i < bars.length; i++) {
    const b = bars[i]
    view.asOf = b.ts
    const held = i - entryIdx + 1
    const fill = fillAt(b, held)
    const sessionNote = fill.sameSessionAsEntry ? " (في نفس جلسة الدخول — جولة إغلاق داخل جلسة واحدة)" : ""
    if (fill.kind === "stopped") {
      view.state = "stopped"
      view.exit = { date: b.ts, price: fill.price, kind: "stopped" }
      view.events.push({
        type: "stopped",
        date: b.ts,
        price: fill.price,
        noteAr: [
          fill.gap
            ? `ضرب وقف الخسارة (${fmt(plan.stop)}) — تنفيذ على فجوة الافتتاح عند ${fmt(fill.price)}؛ الافتتاح تجاوز الوقف مباشرة.`
            : `ضرب وقف الخسارة عند ${fmt(fill.price)}.`,
          sessionNote,
        ].join(" ").trim(),
      })
      view.sessionsHeld = held
      view.evaluatedSessions = entryIdx - startIdx + 1
      return view
    }
    if (fill.kind === "targeted") {
      const touch = buy ? plan.targetLow : plan.targetHigh
      view.state = "targeted"
      view.exit = { date: b.ts, price: fill.price, kind: "targeted" }
      view.events.push({
        type: "targeted",
        date: b.ts,
        price: fill.price,
        noteAr: [
          fill.gap
            ? `لمس منطقة الهدف (${fmt(touch)}) — تنفيذ على فجوة الافتتاح عند ${fmt(fill.price)}؛ الافتتاح تجاوز الهدف مباشرة.`
            : `لمس الهدف عند ${fmt(fill.price)}.`,
          sessionNote,
        ].join(" ").trim(),
      })
      view.sessionsHeld = held
      view.evaluatedSessions = entryIdx - startIdx + 1
      return view
    }
    if (held >= p.maxHoldSessions) {
      view.state = "expired"
      view.exit = { date: b.ts, price: b.close, kind: "time_stopped" }
      view.events.push({
        type: "time_stopped",
        date: b.ts,
        price: b.close,
        noteAr: `وقف زمني: إغلاق بعد ${held} جلسة محتفظة (بما فيها جلسة الدخول) بدون ملامسة وقف الخسارة أو الهدف — خروج عند إغلاق ${fmt(b.close)}.`,
      })
      view.sessionsHeld = held
      view.evaluatedSessions = i - startIdx + 1
      return view
    }
  }

  // Data ended while the trade is still open — honest "active", not an exit.
  view.state = "active"
  view.evaluatedSessions = bars.length - startIdx
  return view
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Derive the lifecycle view of one stance row from the daily bars.
 * Deterministic: identical inputs → identical output. Returns null when the
 * payload cannot produce a lifecycle (wait rows; watching without a setup).
 */
export function computeLifecycle(input: LifecycleInput): LifecycleView | null {
  const p = { ...DEFAULT_LIFECYCLE_PARAMS, ...(input.params ?? {}) }
  const bars = sortedBars(input.bars)
  if (bars.length === 0) {
    if (input.signalState === "watching" && input.setup) {
      return insufficientLifecycleView("watching", input.signalState, input.createdOn ?? null)
    }
    if (input.signalState === "confirmed") {
      return insufficientLifecycleView("confirmed", input.signalState, input.createdOn ?? null)
    }
    return null
  }
  if (input.signalState === "watching") {
    if (!input.setup) return null
    return runWatching(bars, input.createdOn, input.setup, input.signalState, p, input.rebuildSupports, input.rebuildResistances)
  }
  if (input.signalState === "confirmed") {
    if (!input.tradePlan) {
      const v = baseView("confirmed", input.signalState)
      v.asOf = bars[bars.length - 1].ts
      v.reasonAr = "قراءة مؤكدة بدون خطة تداول — لا يوجد تنفيذ لمحاكاته."
      return v
    }
    return runConfirmed(bars, input.createdOn, input.tradePlan, input.signalState, p)
  }
  return null // "wait" rows have no lifecycle to track
}

// ---------------------------------------------------------------------------
// Entitlement gate + chip label (shared with the UI)
// ---------------------------------------------------------------------------

/** The ONLY payload a free/anonymous caller receives — no levels, no events. */
export interface PublicLifecycle {
  signalState: SignalState
  lifecycleState: LifecycleState
}

export function gateLifecycleForFree(view: LifecycleView): PublicLifecycle {
  return { signalState: view.signalState, lifecycleState: view.state }
}

/**
 * Compact chip label for the board (mirrors the Arabic label list of the
 * product spec). "تفعّلت اليوم" only when the activation landed on the last
 * evaluated session — otherwise the honest "تفعّلت" (the gated free payload
 * carries no dates, so it degrades to "تفعّلت").
 */
export function lifecycleChipLabel(
  basis: "watching" | "confirmed",
  state: LifecycleState,
  ar: boolean,
  activationDate?: string | null,
  asOf?: string | null,
): string {
  if (basis === "watching") {
    if (state === "watching") return ar ? "لم تتفعل بعد" : "Not activated yet"
    if (state === "invalidated") return ar ? "أُلغيت" : "Invalidated"
    if (state === "expired") return ar ? "انتهت" : "Expired"
    // confirmed within a watching basis — the setup just activated
    if (ar) return activationDate && asOf && activationDate === asOf ? "تفعّلت اليوم" : "تفعّلت"
    return activationDate && asOf && activationDate === asOf ? "Activated today" : "Activated"
  }
  if (state === "confirmed") return ar ? "بانتظار الدخول" : "Awaiting entry"
  if (state === "active") return ar ? "نشطة" : "Active"
  if (state === "stopped") return ar ? "ستوب" : "Stopped"
  if (state === "targeted") return ar ? "هدف" : "Target hit"
  return ar ? "انتهت زمنيًا" : "Timed out"
}
