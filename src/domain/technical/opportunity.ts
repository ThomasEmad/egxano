// =============================================================================
// EGXANO Opportunity Intelligence — opportunity-state classifier + STRICT
// eligibility gates. opportunity@1 — pure, versioned, DETERMINISTIC ONLY
// (no AI, no randomness, no clocks): identical inputs → identical view.
// =============================================================================
//
// This module turns one published technical row (signals.ts semantics) into an
// OPPORTUNITY VIEW: is there an opportunity here, in which state, and does it
// honestly pass the two strict eligibility gates — or is the honest answer
// "nothing here"? HONESTY IS THE CONTRACT:
//   • no fabricated levels, no probability/success claims;
//   • rejection reasons cite the ACTUAL computed numbers in Arabic;
//   • an honest empty result ("none") is always preferred over a manufactured
//     opportunity;
//   • the 5% gate is an ELIGIBILITY FILTER, never a target-generation formula:
//     targets/entries are never nudged to pass — compute and report.
//
// INPUT CONTRACT — plain structural shapes only. This module MUST NOT import
// resistance-map.ts / opportunity-targets.ts (parallel Wave-2 ownership): the
// integrator feeds zone/ladder objects that are structurally compatible with
// ResistanceZone { low, high, kind, touches, … } and TargetLadder
// { targets: [{ label T1/T2/T3, price, kind, strength, whyAr }] }. Only the
// fields listed on the local input types are read; everything else is ignored.
//
// THE TWO ELIGIBILITY GATES (OPPORTUNITY_THRESHOLDS):
//   • upsidePctToT1 STRICTLY > 5.0 — an upside of exactly 5.00% FAILS. For a
//     buy the upside is (T1.price − entryHigh) / entryHigh × 100 — entryHigh is
//     the WORST executable entry of the plan's entry zone (conservative). For a
//     sell it mirrors to (entryLow − T1.price) / entryLow × 100. T1 comes ONLY
//     from the documented target ladder — never invented, never substituted,
//     never derived from the gate itself.
//   • riskReward >= 1.5 — re-checked here on the SAME plan numbers (the plan
//     builder already validates; a 1.49 fails, a 1.50 passes).
//   The computed upside is rounded to 4 decimals BEFORE the strict comparison
//   (float-dust guard: (10.5−10)/10×100 = 5.000000000000001 must FAIL, and it
//   does once rounded to 5.0000).
//
// STATE RULES (deterministic; every rule below is pinned by tests):
//   • actionable — signalState "confirmed" + valid plan + both gates pass.
//     A watching row whose LIFECYCLE recompute already confirmed (lifecycle
//     state "confirmed" with the recomputed plan — lifecycle.ts validated
//     RR ≥ 1.5 at activation) is confirmed-EQUIVALENT and follows the same
//     path with provisional=false (levels were recomputed, not provisional).
//   • missed (NO-CHASE) — confirmed but NOT eligible, AND the entry zone is
//     already left behind (buy: lastClose >= entryHigh; sell: lastClose <=
//     entryLow) AND the REMAINING upside from the LAST CLOSE (not the entry)
//     to T1 is < 5% → the opportunity is missed; missedAr is emitted exactly;
//     a late entry is never suggested. Remaining upside ≥ 5% (or T1
//     unavailable so it cannot be computed) → NOT missed → "none" with
//     rejection reasons (an honest non-qualifying confirmed row is NOT an
//     opportunity; do not invent states).
//   • conditional — watching row WITH a setup whose trigger geometry implies a
//     valid plan passing BOTH gates at the activation level: provisional
//     upside = (T1.price − activationLevel) / activationLevel × 100 (mirrored
//     for sell) and provisional RR = setup.provisionalRiskReward (the plan
//     builder evaluated AT the activation level). provisional=true; levels are
//     PROVISIONAL and must be recomputed on activation — disclosed in
//     stateNoteAr; eligible stays false (a provisional geometry is not an
//     executable plan).
//   • observation — watching row without a qualifying trigger geometry (no
//     setup, no usable T1 at the trigger, trigger-time upside < 5%, or
//     provisional RR < 1.5 / unknown) → stays observation with rejection
//     reasons citing the TRIGGER-TIME numbers.
//   • invalidated / expired — the lifecycle says so: lifecycle state
//     "invalidated" or "expired" passes through as "invalidated" with the
//     lifecycle's LAST EVENT noteAr as the primary assessment. (The output
//     vocabulary has one dead-opportunity bucket; the note carries the
//     invalidated-vs-expired distinction.)
//   • lifecycle "active" / "stopped" / "targeted" / "time_stopped" — the
//     confirmed plan already EXECUTED (in-trade or resolved): there is no NEW
//     entry opportunity to sell here → "none" with the last lifecycle event
//     noteAr passed through (a re-entry would be a manufactured opportunity).
//   • early — RESERVED for the early-evidence layer: requires explicit
//     earlyEvidence input (improving RS / accumulation flags, at least one
//     true) on a WAIT row. NEVER implies a trade or an entry — the output
//     carries no levels (upside null, both gates false, eligible false).
//   • none — no qualifying opportunity exists. Honest emptiness.
//   • A "wait" row is NEVER an opportunity (no naked reads): "none" or
//     "early" only. A wait row never emits a direction (no naked directional
//     label); an "early" row echoes the caller-passed direction only.
//   • intradayContext is EVIDENCE-ONLY: accepted on the input, never read by
//     any gate or state rule (pinned by test: same classification with and
//     without it).
//   • score travels with the row context but carries NO threshold here — the
//     signal engine already gated the publication state; no invented score
//     gate exists in opportunity@1.
//
// T1 SELECTION (from the ladder, deterministic):
//   the rung labeled "T1" (case-insensitive, trimmed) when present, else the
//   rung NEAREST beyond the reference level (buy: lowest price above the
//   reference; sell: highest below) — the conservative edge. No rung in
//   direction → no T1 → gate fails honestly with the no-target reason; other
//   rungs (T2/T3) are NEVER substituted for a missing/unusable T1.
//
// LADDER INPUT FORM — the directive ships TargetLadder-shaped objects; a bare
// array of target rungs is also accepted and normalized (documented tolerance
// for Wave-2 integration), so both
//   { targets: [{ label: "T1", price, … }, …] }  and  [{ label: "T1", … }, …]
// produce identical views.
// =============================================================================

/** Version stamped on every emitted view. */
export const OPPORTUNITY_VERSION = "opportunity@2"

/** The strict eligibility gates — exported so UI/tests/integration cite the
 *  SAME numbers instead of re-hardcoding them. */
export const OPPORTUNITY_THRESHOLDS = {
  /** MINIMUM favorable distance to the first documented target, in percent of
   *  the reference level — STRICTLY greater: exactly 5.00 FAILS. */
  minUpsidePct: 5.0,
  /** MINIMUM plan risk/reward — greater-or-equal: exactly 1.50 PASSES. */
  minRiskReward: 1.5,
  /** Decimals the computed upside is rounded to before the strict comparison
   *  (float-dust guard; 5.000000000000001 rounds to 5.0000 and fails). */
  upsideRoundDecimals: 4,
} as const

// ---------------------------------------------------------------------------
// Local input types — plain structural shapes (NO imports from Wave-2 files).
// ---------------------------------------------------------------------------

/** TradePlan-like: only the geometry fields this module reads. Compatible
 *  with src/lib/technical/trade-plan.ts TradePlan. */
export interface OpportunityPlanInput {
  bias: "buy" | "sell"
  entryLow: number
  entryHigh: number
  stop: number
  targetLow: number
  targetHigh: number
  /** validated ≥ 1.5 by the plan builder; re-checked here on the same number */
  riskReward: number
  targetKind?: string | null
}

/** WatchingSetup-like: the activation trigger + its provisional geometry.
 *  Compatible with signals.ts WatchingSetup (activation.level →
 *  activationLevel; provisionalRiskReward carried as-is). */
export interface OpportunitySetupInput {
  direction: "buy" | "sell"
  /** tick-rounded activation trigger level (the daily close decides) */
  activationLevel: number
  /** the documented activation condition (Arabic) — surfaced verbatim */
  activationConditionAr?: string | null
  /** true when the setup's levels are provisional (recomputed on activation) */
  provisional?: boolean
  /** provisional RR evaluated AT the activation level (may be null) */
  provisionalRiskReward?: number | null
}

/** LifecycleView-like: state + events (noteAr pass-through). Compatible with
 *  src/lib/technical/lifecycle.ts LifecycleView. */
export interface OpportunityLifecycleInput {
  /** LifecycleState: watching | confirmed | active | stopped | targeted |
   *  time_stopped | invalidated | expired */
  state: string
  /** the walk's events in order — the LAST event's noteAr passes through.
   *  Compatible with lifecycle.ts LifecycleEvent (type/date/price/noteAr). */
  events?: { type?: string | null; noteAr?: string | null; date?: string | null; price?: number | null }[] | null
  /** the walk's degraded-reason note (fallback when no events exist) */
  reasonAr?: string | null
  /** the RECOMPUTED plan carried by the lifecycle view (present on a watching
   *  basis whose activation recompute CONFIRMED — used when the row's own
   *  tradePlan is not yet swapped in) */
  tradePlan?: OpportunityPlanInput | null
}

/** ResistanceZone-like: only low/high/kind are read. */
export interface OpportunityZoneInput {
  low: number
  high: number
  kind?: "supply" | "demand" | string | null
  touches?: number | null
  strength?: number | null
}

/** One ladder rung (TargetLadder targets[i]). */
export interface OpportunityLadderTargetInput {
  /** "T1" | "T2" | "T3" — the T1 rung is the eligibility reference */
  label?: string | null
  price: number
  kind?: string | null
  strength?: number | null
  whyAr?: string | null
}

/** TargetLadder-like — object form, or a bare rung array (normalized). */
export type OpportunityLadderInput = { targets: OpportunityLadderTargetInput[] | null } | OpportunityLadderTargetInput[]

/** Early-evidence flags (early-evidence layer input — evidence ONLY). */
export interface OpportunityEarlyEvidenceInput {
  /** improving relative strength versus the market/sector */
  improvingRs?: boolean | null
  /** accumulation evidence (e.g. OBV up-trend / up-volume dominance) */
  accumulation?: boolean | null
  noteAr?: string | null
}

/** Intraday context — EVIDENCE-ONLY: never read by any gate or state rule. */
export interface OpportunityIntradayInput {
  noteAr?: string | null
  sessionHigh?: number | null
  sessionLow?: number | null
}

export interface OpportunityInput {
  lastClose: number
  signalState: "confirmed" | "watching" | "wait"
  /** row score (0-100) — context only, NO threshold in opportunity@1 */
  score: number
  /** the row's published direction (null on wait rows) */
  direction: "buy" | "sell" | null
  /** the confirmed row's validated plan (null on watching/wait rows) */
  tradePlan: OpportunityPlanInput | null
  /** the watching row's activation setup (null otherwise) */
  setup: OpportunitySetupInput | null
  /** derived lifecycle view (null when not computed) */
  lifecycleView: OpportunityLifecycleInput | null
  /** documented supply/demand zones (ResistanceZone-like) */
  zones: OpportunityZoneInput[]
  /** documented target ladder (TargetLadder-like) or null */
  ladder: OpportunityLadderInput | null
  /** optional intraday evidence — accepted, NEVER gates */
  intradayContext?: OpportunityIntradayInput | null
  /** explicit early-evidence flags — required to promote a wait row to early */
  earlyEvidence?: OpportunityEarlyEvidenceInput | null
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

export type OpportunityState = "early" | "observation" | "conditional" | "actionable" | "invalidated" | "missed" | "none"

/** The classified opportunity view — one row, one honest assessment. */
export interface OpportunityView {
  state: OpportunityState
  /** buy | sell | null — null on wait rows (no naked directional label) */
  direction: "buy" | "sell" | null
  opportunityVersion: string
  /** favorable % from the WORST executable entry to the ladder's T1 (buy:
   *  entryHigh; sell: entryLow) — or, on conditional rows, from the ACTIVATION
   *  level (provisional). null when no plan or no usable T1. */
  upsidePctToT1: number | null
  /** favorable % from the CURRENT LAST CLOSE to the ladder's T1 — the reader's
   *  "العائد" mental model (2026-11-15 owner bug report: a +21% entry-basis
   *  upside printed next to a T1 that was +142% away from the displayed price
   *  read as a contradiction). Display value; the 5% gate still uses the
   *  entry-basis upside. null when no usable T1 or no usable lastClose. */
  remainingPctToT1: number | null
  /** STRICTLY > 5.0 (5.00 exactly FAILS). On conditional rows this is the
   *  PROVISIONAL gate result at the activation level. */
  qualifies5: boolean
  /** riskReward >= 1.5 re-checked on the same plan numbers (provisional RR on
   *  conditional rows). */
  rrOk: boolean
  /** qualifies5 && rrOk && a real plan exists && the state allows execution —
   *  true ONLY on "actionable" (conditional levels are provisional and must be
   *  recomputed before any execution). */
  eligible: boolean
  /** precise Arabic rejection reasons citing the actual computed numbers */
  rejectionReasonsAr: string[]
  /** the NO-CHASE verdict — emitted exactly when the rule fires */
  missedAr: string | null
  /** what to watch next (documented levels only — never invented) */
  watchNextAr: string
  /** ONE clear primary assessment for the current state */
  stateNoteAr: string
  /** true ONLY on conditional rows: levels are provisional and must be
   *  recomputed on activation */
  provisional: boolean
}

// ---------------------------------------------------------------------------
// Deterministic helpers
// ---------------------------------------------------------------------------

const fmtPrice = (v: number): string => v.toFixed(2)

/** Round to `decimals` places (float-dust guard before strict comparisons). */
function roundTo(value: number, decimals: number): number {
  if (!Number.isFinite(value)) return value
  const f = Math.pow(10, decimals)
  return Math.round(value * f) / f
}

/** Percentage display for Arabic reasons — trims float dust without lying:
 *  3.4 → "3.4", 4.96 → "4.96", 5 → "5" (a 4.96% upside never prints "5%"). */
function fmtPct(value: number): string {
  return String(roundTo(value, 2))
}

function isUsablePrice(v: number | null | undefined): v is number {
  return typeof v === "number" && Number.isFinite(v) && v > 0
}

/** Normalize the two accepted ladder input forms into a rung list. */
function ladderRungs(ladder: OpportunityLadderInput | null): OpportunityLadderTargetInput[] {
  if (!ladder) return []
  if (Array.isArray(ladder)) return ladder
  return ladder.targets ?? []
}

/** T1 selection (module-header rule): the rung labeled "T1" when present,
 *  else the rung NEAREST beyond the reference in the trade's favor. */
function selectT1(rungs: OpportunityLadderTargetInput[], buy: boolean, reference: number): OpportunityLadderTargetInput | null {
  const usable = rungs.filter((r) => isUsablePrice(r.price))
  for (const r of usable) {
    if (typeof r.label === "string" && r.label.trim().toUpperCase() === "T1") return r
  }
  let best: OpportunityLadderTargetInput | null = null
  for (const r of usable) {
    if (buy) {
      if (r.price > reference && (best === null || r.price < best.price)) best = r
    } else {
      if (r.price < reference && (best === null || r.price > best.price)) best = r
    }
  }
  return best
}

/** Favorable % from `from` to `to` in the trade's direction, rounded for the
 *  strict gate (buy: up; sell: down). */
function favorablePct(from: number, to: number, buy: boolean): number {
  const raw = buy ? ((to - from) / from) * 100 : ((from - to) / from) * 100
  return roundTo(raw, OPPORTUNITY_THRESHOLDS.upsideRoundDecimals)
}

/** Last event note (Arabic) of the lifecycle walk — the pass-through text. */
function lastLifecycleNote(lc: OpportunityLifecycleInput): string | null {
  const evs = lc.events ?? []
  for (let i = evs.length - 1; i >= 0; i--) {
    const n = evs[i]?.noteAr
    if (typeof n === "string" && n.length > 0) return n
  }
  if (typeof lc.reasonAr === "string" && lc.reasonAr.length > 0) return lc.reasonAr
  return null
}

// ---------------------------------------------------------------------------
// Arabic reason catalogue — every rejection cites the ACTUAL computed numbers.
// ---------------------------------------------------------------------------

const MISSED_AR = "الفرصة فاتت — العائد المتبقي غير كافٍ"

const AR = {
  noPlan: "لا توجد خطة تداول قابلة للتنفيذ على هذه القراءة — لا تُختلق خطة لتمرير الفرصة.",
  upsideFail: (pct: string, entry: string) =>
    `فرصة غير مؤهلة لمعيار العائد: العائد المتوقع حتى الهدف الأول ${pct}% من أعلى الدخول التنفيذي (${entry})، وهو أقل من الحد الأدنى 5%.`,
  upsideFailWrongSide: (pct: string, entry: string, buy: boolean) =>
    buy
      ? `فرصة غير مؤهلة لمعيار العائد: الهدف الأول يقع تحت منطقة الدخول التنفيذي (${entry}) والمسافة المواتية ${pct}% فقط — أقل من الحد الأدنى 5% — ولا تُستبدل الأهداف لتمرير البوابة.`
      : `فرصة غير مؤهلة لمعيار العائد: الهدف الأول يقع فوق منطقة الدخول التنفيذي (${entry}) والمسافة المواتية ${pct}% فقط — أقل من الحد الأدنى 5% — ولا تُستبدل الأهداف لتمرير البوابة.`,
  rrFail: (rr: string) =>
    `فرصة غير مؤهلة لمعيار المخاطرة: نسبة المخاطرة/العائد ${rr} أقل من الحد الأدنى 1.5.`,
  noT1NoZone: (buy: boolean) =>
    buy
      ? "الهدف الأول غير متاح — لا توجد منطقة مقاومة موثقة فوق الدخول."
      : "الهدف الأول غير متاح — لا توجد منطقة طلب موثقة تحت الدخول.",
  noT1ZonesWithoutLadder: (buy: boolean) =>
    buy
      ? "الهدف الأول غير متاح — توجد مناطق مقاومة موثقة فوق الدخول لكن لا سلّم أهداف محسوب، ولا يُشتق هدف جديد هنا لتمرير البوابة."
      : "الهدف الأول غير متاح — توجد مناطق طلب موثقة تحت الدخول لكن لا سلّم أهداف محسوب، ولا يُشتق هدف جديد هنا لتمرير البوابة.",
  noT1WrongSide: (buy: boolean, entry: string) =>
    buy
      ? `الهدف الأول في السلّم ليس فوق أعلى الدخول التنفيذي (${entry}) — لا تُستبدل الأهداف لتمرير البوابة.`
      : `الهدف الأول في السلّم ليس تحت أدنى الدخول التنفيذي (${entry}) — لا تُستبدل الأهداف لتمرير البوابة.`,
  leftBehind: (buy: boolean, close: string) =>
    buy
      ? `الإغلاق الحالي (${close}) تجاوز منطقة الدخول التنفيذي بالفعل.`
      : `الإغلاق الحالي (${close}) تجاوز منطقة الدخول التنفيذي هبوطًا بالفعل.`,
  missedRemainder: (pct: string) =>
    `تجاوز الإغلاق الحالي منطقة الدخول والعائد المتبقي حتى الهدف الأول ${pct}% فقط من الإغلاق الحالي — أقل من 5%، فتُصنّف الفرصة فائتة (لا مطاردة ولا دخول متأخر).`,
  watchingNoSetup: "فرصة تحت المراقبة بدون مستوى تفعيل موثق — لا يُحسب عائد محتمل بدون تفعيل هيكلي.",
  watchingUpsideFail: (pct: string, level: string) =>
    `العائد المتوقع حتى الهدف الأول عند مستوى التفعيل ${pct}% (من مستوى التفعيل ${level}) — أقل من الحد الأدنى 5%، لذلك تبقى الفرصة تحت المراقبة فقط.`,
  watchingWrongSide: (level: string, buy: boolean) =>
    `الهدف الأول في السلّم ليس في اتجاه الصفقة من مستوى التفعيل (${level}) — لا تُستبدل الأهداف لتمرير البوابة، وتبقى الفرصة تحت المراقبة فقط.`,
  watchingNoT1: (buy: boolean, level: string) =>
    buy
      ? `الهدف الأول غير متاح عند مستوى التفعيل (${level}) — لا توجد منطقة مقاومة موثقة فوق مستوى التفعيل، وتبقى الفرصة تحت المراقبة فقط.`
      : `الهدف الأول غير متاح عند مستوى التفعيل (${level}) — لا توجد منطقة طلب موثقة تحت مستوى التفعيل، وتبقى الفرصة تحت المراقبة فقط.`,
  watchingRrFail: (rr: string) =>
    `نسبة المخاطرة/العائد التقديرية عند التفعيل ${rr} — أقل من الحد الأدنى 1.5، لذلك تبقى الفرصة تحت المراقبة فقط.`,
  watchingRrUnknown: "نسبة المخاطرة/العائد التقديرية عند التفعيل غير محسوبة — تبقى الفرصة تحت المراقبة فقط.",
  waitRow: "صف انتظار بدون قراءة اتجاهية — لا تُبنى فرصة بدون قراءة موثقة.",
  lifecycleDead: (labelAr: string) => `دورة الحياة: الفرصة ${labelAr} — لم تعد قائمة ولا قابلة للتنفيذ.`,
  lifecycleResolved: (labelAr: string) => `الفرصة محلولة بالفعل (${labelAr}) — لا تُقترح فرصة دخول جديدة.`,
} as const

const LIFECYCLE_STATE_AR: Record<string, string> = {
  invalidated: "أُلغيت قبل الدخول",
  expired: "انتهت صلاحيتها",
  active: "نشطة كصفقة قائمة",
  stopped: "خرجت على وقف الخسارة",
  targeted: "حققت هدفها",
  time_stopped: "خرجت بالوقف الزمني",
}

const NOTE = {
  actionable: (pct: string, rr: string, buy: boolean) =>
    `قراءة مؤكدة بخطة صالحة تجتاز بوابتي العائد والمخاطرة: عائد متوقع ${pct}% من ${buy ? "أعلى" : "أدنى"} الدخول التنفيذي حتى الهدف الأول، ونسبة مخاطرة/عائد ${rr}.`,
  conditional: (level: string, pct: string, rr: string) =>
    `فرصة مشروطة: الهندسة عند مستوى التفعيل ${level} تجتاز البوابات مبدئيًا (عائد تقديري ${pct}% ونسبة مخاطرة/عائد تقديرية ${rr}) — المستويات تقديرية وتُعاد الحسابات بالكامل عند التفعيل بإغلاق يومي.`,
  observation: "تحت المراقبة فقط: بوابات العائد أو المخاطرة لم تُجتز بعد على الأرقام المحسوبة فعليًا — لا تأكيد ولا خطة تنفيذ حتى الآن.",
  observationNoSetup: "تحت المراقبة فقط: لا يوجد مستوى تفعيل موثق — لا يمكن تقييم هندسة التفعيل ولا حساب عائد محتمل.",
  missed: (pct: string) =>
    `الفرصة فاتت: الإغلاق الحالي تجاوز منطقة الدخول والعائد المتبقي حتى الهدف الأول ${pct}% فقط من الإغلاق — لا يُنصح بالمطاردة ولا بالدخول المتأخر.`,
  none: "لا توجد فرصة مؤهلة حاليًا وفق بوابتي العائد (5% المتبقية حتى الهدف الأول) والمخاطرة (RR ≥ 1.5) — تُعاد القراءة حسابيًا مع كل إغلاق يومي ولا تُصنَّع فرصة.",
  noneResolved: "الفرصة محلولة — لا توجد فرصة دخول جديدة على هذه القراءة في هذه اللقطة.",
  invalidated: "أُلغيت الفرصة ولم تعد قائمة — تُعاد القراءة من البيانات الحالية.",
  waitNote: "صف انتظار — لا توجد قراءة اتجاهية تُبنى عليها فرصة؛ تُعاد القراءة حسابيًا مع كل إغلاق يومي.",
  early: "قراءة مبكرة من طبقة الأدلة فقط: تحسّن نسبي/تجمّع مرصود — بدون مستويات أو خطة، ولا تعني فرصة تنفيذ.",
} as const

const WATCH = {
  actionable: (buy: boolean, entryLow: string, entryHigh: string, stop: string, t1: string) =>
    buy
      ? `راقب أول إغلاق يومي داخل منطقة الدخول ${entryLow}–${entryHigh} — عندها يبدأ تتبع الصفقة، والوقف ${stop} والهدف الأول ${t1}.`
      : `راقب أول إغلاق يومي داخل منطقة الدخول ${entryLow}–${entryHigh} — عندها يبدأ تتبع الصفقة، والوقف ${stop} والهدف الأول ${t1}.`,
  conditional: (buy: boolean, level: string, conditionAr: string | null) =>
    `راقب إغلاقًا يوميًا ${buy ? "فوق" : "تحت"} مستوى التفعيل ${level}${conditionAr ? ` — ${conditionAr}` : ""}؛ عند التفعيل تُعاد الحسابات بالكامل وتُعاد بوابات العائد والمخاطرة على الإغلاق الفعلي.`,
  observationWithSetup: (buy: boolean, level: string) =>
    `راقب مستوى التفعيل ${buy ? "فوق" : "تحت"} ${level} — لا ترقية للفرصة إلا إذا اجتازت بوابات العائد والمخاطرة على حسابات إعادة التفعيل الفعلية.`,
  observationNoSetup: "راقب ظهور مستوى تفعيل هيكلي موثق بإغلاق يومي — بدون مستوى تفعيل لا تتحول المراقبة إلى فرصة.",
  missed: "لا متابعة — لا يُنصح بدخول متأخر بعد تجاوز منطقة الدخول؛ انتظر قراءة جديدة موثقة بإغلاق يومي.",
  none: "لا فرصة متابعة — القراءة تُعاد حسابيًا مع كل إغلاق يومي وقد تتغير الأرقام.",
  invalidated: "الفرصة لم تعد قائمة — تُعاد القراءة من البيانات الحالية ولا يُتابع مستوى قديم.",
  early: "راقب اكتمال الأدلة (تحسّن النسبي/التجمّع) حتى تتحول القراءة المبكرة إلى فرصة موثقة بمستويات وخطة.",
} as const

// ---------------------------------------------------------------------------
// The classifier
// ---------------------------------------------------------------------------

/** Gate + geometry result shared by the confirmed and watching paths. */
interface GateResult {
  t1: OpportunityLadderTargetInput | null
  upsidePct: number | null
  qualifies5: boolean
  rrOk: boolean
}

function buildEmptyView(): OpportunityView {
  return {
    state: "none",
    direction: null,
    opportunityVersion: OPPORTUNITY_VERSION,
    upsidePctToT1: null,
    remainingPctToT1: null,
    qualifies5: false,
    rrOk: false,
    eligible: false,
    rejectionReasonsAr: [],
    missedAr: null,
    watchNextAr: WATCH.none,
    stateNoteAr: NOTE.none,
    provisional: false,
  }
}

/**
 * Classify one published technical row into an opportunity view.
 * Pure and deterministic: identical inputs → identical output.
 */
export function classifyOpportunity(input: OpportunityInput): OpportunityView {
  const view = buildEmptyView()

  const setup = input.setup ?? null
  const lc = input.lifecycleView ?? null
  // the plan: the row's own validated plan first; a watching row whose
  // lifecycle recompute CONFIRMED carries the recomputed plan on the view
  const plan = input.tradePlan ?? lc?.tradePlan ?? null
  const rungs = ladderRungs(input.ladder ?? null)
  const buy = (plan ? plan.bias : setup ? setup.direction : input.direction) === "buy"
  // published direction: the row's own direction first, then the payload's
  const direction: "buy" | "sell" | null = input.direction ?? (setup ? setup.direction : null)

  // ------------------------------------------------------------------
  // 1. WAIT rows — never an opportunity (no naked reads). "none" or
  //    "early" only; early requires explicit evidence flags.
  // ------------------------------------------------------------------
  if (input.signalState === "wait") {
    const evidence = input.earlyEvidence ?? null
    const hasEvidence = evidence !== null && (evidence.improvingRs === true || evidence.accumulation === true)
    if (!hasEvidence) {
      view.state = "none"
      view.direction = null
      view.rejectionReasonsAr = [AR.waitRow]
      view.stateNoteAr = NOTE.waitNote
      view.watchNextAr = WATCH.none
      return view
    }
    view.state = "early"
    // early echoes the caller-passed direction only (evidence-only layer)
    view.direction = input.direction ?? null
    const evidenceBits: string[] = []
    if (evidence.improvingRs === true) evidenceBits.push("تحسّن الأداء النسبي")
    if (evidence.accumulation === true) evidenceBits.push("أدلة تجمّع")
    view.stateNoteAr =
      NOTE.early + (evidenceBits.length > 0 ? ` (${evidenceBits.join(" + ")})` : "") + (evidence.noteAr ? ` — ${evidence.noteAr}` : "")
    view.watchNextAr = WATCH.early
    return view
  }

  // ------------------------------------------------------------------
  // 2. LIFECYCLE pass-through — the walk's verdict outranks the static row:
  //    dead opportunities stay dead, executed plans offer no NEW entry.
  // ------------------------------------------------------------------
  if (lc) {
    const s = lc.state
    if (s === "invalidated" || s === "expired") {
      view.state = "invalidated"
      view.direction = direction
      const label = LIFECYCLE_STATE_AR[s] ?? s
      view.rejectionReasonsAr = [AR.lifecycleDead(label)]
      const note = lastLifecycleNote(lc)
      view.stateNoteAr = note ?? NOTE.invalidated
      view.watchNextAr = WATCH.invalidated
      return view
    }
    if (s === "active" || s === "stopped" || s === "targeted" || s === "time_stopped") {
      view.state = "none"
      view.direction = direction
      const label = LIFECYCLE_STATE_AR[s] ?? s
      view.rejectionReasonsAr = [AR.lifecycleResolved(label)]
      const note = lastLifecycleNote(lc)
      view.stateNoteAr = note ?? NOTE.noneResolved
      view.watchNextAr = WATCH.none
      return view
    }
    // "watching" (open walk) and "confirmed" (awaiting entry, or a watching
    // basis that JUST recompute-confirmed) fall through to their own paths.
  }

  // ------------------------------------------------------------------
  // 3. CONFIRMED path — confirmed row (or lifecycle-confirmed equivalent):
  //    gates on the plan's geometry against the ladder's T1.
  // ------------------------------------------------------------------
  if (input.signalState === "confirmed" || lc?.state === "confirmed") {
    view.direction = direction
    if (!plan || !isUsablePrice(plan.entryLow) || !isUsablePrice(plan.entryHigh)) {
      view.state = "none"
      view.rejectionReasonsAr = [AR.noPlan]
      view.stateNoteAr = NOTE.none
      view.watchNextAr = WATCH.none
      return view
    }
    const entry = buy ? plan.entryHigh : plan.entryLow // WORST executable entry
    const t1 = selectT1(rungs, buy, entry)
    let g: GateResult = { t1, upsidePct: null, qualifies5: false, rrOk: false }
    if (t1 !== null) {
      const pct = favorablePct(entry, t1.price, buy)
      g = {
        t1,
        upsidePct: pct,
        qualifies5: pct > OPPORTUNITY_THRESHOLDS.minUpsidePct,
        rrOk: isUsablePrice(plan.riskReward) ? plan.riskReward >= OPPORTUNITY_THRESHOLDS.minRiskReward : false,
      }
    }
    view.upsidePctToT1 = g.upsidePct
    view.remainingPctToT1 =
      t1 !== null && isUsablePrice(input.lastClose) ? favorablePct(input.lastClose, t1.price, buy) : null
    view.qualifies5 = g.qualifies5
    view.rrOk = g.rrOk

    const gatesOk = g.qualifies5 && g.rrOk

    // Build the honest rejection reasons from real numbers (used by the
    // missed and none paths; the actionable path clears them).
    const reasons: string[] = []
    if (!gatesOk) {
      if (t1 === null) {
        const zoneBeyond = (input.zones ?? []).some((z) => {
          if (!isUsablePrice(z.low) || !isUsablePrice(z.high)) return false
          return buy ? z.high > entry || z.low > entry : z.low < entry || z.high < entry
        })
        if (rungs.length === 0 && !zoneBeyond) reasons.push(AR.noT1NoZone(buy))
        else if (rungs.length === 0 && zoneBeyond) reasons.push(AR.noT1ZonesWithoutLadder(buy))
        else reasons.push(AR.noT1WrongSide(buy, fmtPrice(entry)))
      } else {
        const pct = g.upsidePct as number
        reasons.push(pct < 0 ? AR.upsideFailWrongSide(fmtPct(pct), fmtPrice(entry), buy) : AR.upsideFail(fmtPct(pct), fmtPrice(entry)))
      }
      if (!g.rrOk) {
        reasons.push(
          isUsablePrice(plan.riskReward)
            ? AR.rrFail(fmtPct(plan.riskReward))
            : AR.rrFail("غير محسوبة"),
        )
      }
    }

    // NO-CHASE (missed) — checked BEFORE any actionable promotion (owner
    // directive §3.4): the entry zone is left behind AND the REMAINING upside
    // from the LAST CLOSE (not the entry) to T1 is < 5% → the opportunity is
    // missed even when the plan's entry-zone gates still pass. Never invite a
    // late entry.
    const leftBehind = isUsablePrice(input.lastClose) && (buy ? input.lastClose >= plan.entryHigh : input.lastClose <= plan.entryLow)
    const remaining = t1 !== null && isUsablePrice(input.lastClose) ? favorablePct(input.lastClose, t1.price, buy) : null
    if (leftBehind) reasons.push(AR.leftBehind(buy, fmtPrice(input.lastClose)))
    if (leftBehind && remaining !== null && remaining < OPPORTUNITY_THRESHOLDS.minUpsidePct) {
      view.state = "missed"
      view.eligible = false
      view.missedAr = MISSED_AR
      reasons.push(AR.missedRemainder(fmtPct(remaining)))
      view.rejectionReasonsAr = reasons
      view.stateNoteAr = NOTE.missed(fmtPct(remaining))
      view.watchNextAr = WATCH.missed
      return view
    }

    if (gatesOk) {
      // ACTIONABLE — confirmed + valid plan + both gates pass + NOT missed
      view.state = "actionable"
      view.eligible = true
      view.rejectionReasonsAr = []
      view.missedAr = null
      view.provisional = false
      const t1Rung = g.t1 as OpportunityLadderTargetInput
      const pctStr = fmtPct(g.upsidePct as number)
      view.stateNoteAr = NOTE.actionable(pctStr, fmtPct(plan.riskReward), buy)
      view.watchNextAr = WATCH.actionable(buy, fmtPrice(plan.entryLow), fmtPrice(plan.entryHigh), fmtPrice(plan.stop), fmtPrice(t1Rung.price))
      return view
    }

    view.state = "none"
    view.eligible = false
    view.missedAr = null
    view.rejectionReasonsAr = reasons
    view.stateNoteAr = NOTE.none
    view.watchNextAr = WATCH.none
    return view
  }

  // ------------------------------------------------------------------
  // 4. WATCHING path — conditional (qualifying trigger geometry) or
  //    observation (no qualifying geometry). All numbers are PROVISIONAL:
  //    computed at the ACTIVATION level, recomputed on activation.
  // ------------------------------------------------------------------
  view.direction = direction
  if (!setup || !isUsablePrice(setup.activationLevel)) {
    view.state = "observation"
    view.rejectionReasonsAr = [AR.watchingNoSetup]
    view.stateNoteAr = NOTE.observationNoSetup
    view.watchNextAr = WATCH.observationNoSetup
    return view
  }
  const act = setup.activationLevel
  const buySetup = setup.direction === "buy"
  const t1 = selectT1(rungs, buySetup, act)
  const reasons: string[] = []
  let provUpside: number | null = null
  let prov5 = false
  if (t1 === null) {
    const zoneBeyond = (input.zones ?? []).some((z) => {
      if (!isUsablePrice(z.low) || !isUsablePrice(z.high)) return false
      return buySetup ? z.high > act || z.low > act : z.low < act || z.high < act
    })
    if (rungs.length === 0 && !zoneBeyond) reasons.push(AR.watchingNoT1(buySetup, fmtPrice(act)))
    else if (rungs.length === 0 && zoneBeyond) reasons.push(AR.noT1ZonesWithoutLadder(buySetup))
    else reasons.push(AR.watchingWrongSide(fmtPrice(act), buySetup))
  } else {
    const pct = favorablePct(act, t1.price, buySetup)
    provUpside = pct
    prov5 = pct > OPPORTUNITY_THRESHOLDS.minUpsidePct
    if (!prov5) {
      reasons.push(
        pct < 0
          ? AR.watchingWrongSide(fmtPrice(act), buySetup)
          : AR.watchingUpsideFail(fmtPct(pct), fmtPrice(act)),
      )
    }
  }
  const provRR = isUsablePrice(setup.provisionalRiskReward) ? (setup.provisionalRiskReward as number) : null
  const provRrOk = provRR !== null ? provRR >= OPPORTUNITY_THRESHOLDS.minRiskReward : false
  if (!provRrOk) {
    reasons.push(provRR === null ? AR.watchingRrUnknown : AR.watchingRrFail(fmtPct(provRR)))
  }

  view.upsidePctToT1 = provUpside
  view.remainingPctToT1 =
    t1 !== null && isUsablePrice(input.lastClose) ? favorablePct(input.lastClose, t1.price, buySetup) : null
  view.qualifies5 = prov5
  view.rrOk = provRrOk

  if (prov5 && provRrOk) {
    // CONDITIONAL — the trigger geometry passes both gates at activation
    view.state = "conditional"
    view.provisional = true
    view.eligible = false // provisional levels — never executable as-is
    view.rejectionReasonsAr = []
    const conditionAr = typeof setup.activationConditionAr === "string" && setup.activationConditionAr.length > 0 ? setup.activationConditionAr : null
    view.stateNoteAr = NOTE.conditional(fmtPrice(act), fmtPct(provUpside as number), fmtPct(provRR as number))
    view.watchNextAr = WATCH.conditional(buySetup, fmtPrice(act), conditionAr)
    return view
  }
  view.state = "observation"
  view.provisional = false
  view.eligible = false
  view.rejectionReasonsAr = reasons
  view.stateNoteAr = NOTE.observation
  view.watchNextAr = WATCH.observationWithSetup(buySetup, fmtPrice(act))
  return view
}
