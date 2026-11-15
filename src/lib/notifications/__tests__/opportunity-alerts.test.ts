// =============================================================================
// Opportunity-transition alerts — pure diff/dedup + sweep orchestration tests.
//
// The contract pinned here (src/lib/notifications/opportunity-alerts.ts +
// opportunity-sweep.ts):
//   • the transition matrix: none→actionable ("actionable_ready"),
//     observation→conditional ("conditional_entry"), actionable→invalidated,
//     any→missed, eligible→upside-dropped-below-5 — each fires ONCE, never
//     twice (state comparison + `${type}:${date}` ledger + kind-aware feed
//     identity);
//   • FIRST observation is a baseline (state recorded, zero alerts);
//   • upside-drop detection: 5.2→4.7 fires, 5.2→6.1 silent, exactly 5.0 silent;
//   • precedence: one alert per company per sweep (missed supersedes the
//     numeric drop);
//   • the SHARED feed row hosts both kinds without collision and existing
//     lifecycle-only ordering is preserved;
//   • the sweep persists through injected deps, honors dry-run (zero
//     persistence), contains per-company errors and honestly ABSTAINS when
//     the bars cannot support a resistance map (no alert, snapshot untouched).
// OpportunityViews are hand-shaped for the diff tests; the sweep-level tests
// run the REAL classifyOpportunityRow pipeline (buildResistanceMap +
// buildTargetLadder + classifyOpportunity) over synthetic real-OHLC bars.
// =============================================================================
import { describe, expect, it, vi } from "vitest"
import type { Bar } from "../../technical/indicators"
import type { LifecycleView } from "../../technical/lifecycle"
import type { OpportunityView } from "../../technical/opportunity"
import type { TradePlan } from "../../technical/trade-plan"
import type { WatchingSetup } from "../../technical/signals"
import {
  diffOpportunityState,
  opportunityAlertKey,
  OPPORTUNITY_EMITTED_KEYS_KEEP,
  type OpportunityAlert,
  type OpportunityStateSnapshot,
} from "../opportunity-alerts"
import {
  classifyOpportunityRow,
  runOpportunitySweep,
  toOpportunitySetup,
  type OpportunityComputedRow,
  type OpportunitySweepDeps,
} from "../opportunity-sweep"
import { mergeAlertFeed, orderAlertsNewestFirst, ALERT_FEED_CAP, type SweepFeedAlert } from "../lifecycle-alerts"

// ---------------------------------------------------------------------------
// Hand-shaped builders (the diff logic consumes plain views/snapshots)
// ---------------------------------------------------------------------------

const COMPANY = { companyId: "c1", ticker: "TEST" }

function oppView(overrides?: Partial<OpportunityView>): OpportunityView {
  return {
    state: "none",
    direction: "buy",
    opportunityVersion: "opportunity@2",
    remainingPctToT1: null,
    upsidePctToT1: null,
    qualifies5: false,
    rrOk: false,
    eligible: false,
    rejectionReasonsAr: [],
    missedAr: null,
    watchNextAr: "",
    stateNoteAr: "",
    provisional: false,
    ...overrides,
  }
}

function snap(overrides?: Partial<OpportunityStateSnapshot>): OpportunityStateSnapshot {
  return {
    state: "none",
    eligible: false,
    upsidePctToT1: null,
    asOf: "2026-03-01",
    emitted: [],
    ...overrides,
  }
}

const CTX = { ...COMPANY, asOf: "2026-03-02" }

// ---------------------------------------------------------------------------
// diffOpportunityState — the transition matrix
// ---------------------------------------------------------------------------

describe("diffOpportunityState — the transition matrix", () => {
  it("baseline (previous === null): records the state, emits NO alerts, empty ledger", () => {
    const diff = diffOpportunityState(null, oppView({ state: "actionable", eligible: true, upsidePctToT1: 7.25 }), {
      ...CTX,
    })
    expect(diff.alerts).toEqual([])
    expect(diff.snapshot).toEqual({
      state: "actionable",
      eligible: true,
      upsidePctToT1: 7.25,
      asOf: CTX.asOf,
      emitted: [],
    })
  })

  it("none→actionable fires actionable_ready ONCE — never twice on an unchanged re-diff", () => {
    const actionable = oppView({ state: "actionable", eligible: true, upsidePctToT1: 7.25, direction: "buy" })
    const first = diffOpportunityState(snap({ state: "none" }), actionable, CTX)
    expect(first.alerts).toHaveLength(1)
    expect(first.alerts[0].type).toBe("actionable_ready")
    expect(first.alerts[0].kind).toBe("opportunity")
    expect(first.alerts[0].titleAr).toBe("فرصة شراء جاهزة جديدة")
    expect(first.alerts[0].bodyAr).toContain("7.25")
    expect(first.alerts[0].bodyAr).toContain("قابلة للتنفيذ")
    expect(first.alerts[0].date).toBe(CTX.asOf)
    expect(first.snapshot.emitted).toEqual([opportunityAlertKey("actionable_ready", CTX.asOf)])
    // the same state re-diffed (next run) emits nothing
    const second = diffOpportunityState(first.snapshot, actionable, { ...CTX, asOf: "2026-03-03" })
    expect(second.alerts).toEqual([])
  })

  it("a sell-direction ready call gets the sell title", () => {
    const diff = diffOpportunityState(
      snap({ state: "none" }),
      oppView({ state: "actionable", eligible: true, upsidePctToT1: 6.4, direction: "sell" }),
      CTX,
    )
    expect(diff.alerts[0].titleAr).toBe("فرصة بيع جاهزة جديدة")
  })

  it("observation→conditional fires conditional_entry (title verbatim, provisional body)", () => {
    const diff = diffOpportunityState(
      snap({ state: "observation" }),
      oppView({ state: "conditional", upsidePctToT1: 6.1, provisional: true, direction: "buy" }),
      CTX,
    )
    expect(diff.alerts).toHaveLength(1)
    expect(diff.alerts[0].type).toBe("conditional_entry")
    expect(diff.alerts[0].titleAr).toBe("دخول مشروط تم تحديده")
    expect(diff.alerts[0].bodyAr).toContain("6.1")
    expect(diff.alerts[0].bodyAr).toContain("تقديرية")
  })

  it("actionable→invalidated fires invalidated; other →invalidated transitions stay silent", () => {
    const dead = oppView({ state: "invalidated", direction: "buy", stateNoteAr: "دورة الحياة: أُلغيت" })
    const fired = diffOpportunityState(snap({ state: "actionable", eligible: true, upsidePctToT1: 7.0 }), dead, CTX)
    expect(fired.alerts).toHaveLength(1)
    expect(fired.alerts[0].type).toBe("invalidated")
    expect(fired.alerts[0].bodyAr).toContain("ملغاة")
    // conditional→invalidated is NOT in the matrix — silent
    expect(diffOpportunityState(snap({ state: "conditional" }), dead, CTX).alerts).toEqual([])
  })

  it("any→missed fires missed from actionable AND from conditional/observation previous states", () => {
    const missed = oppView({ state: "missed", missedAr: "الفرصة فاتت — العائد المتبقي غير كافٍ", upsidePctToT1: 4.1 })
    for (const prev of [
      snap({ state: "actionable", eligible: true, upsidePctToT1: 8.0 }),
      snap({ state: "conditional" }),
      snap({ state: "observation" }),
      snap({ state: "none" }),
    ]) {
      const diff = diffOpportunityState(prev, missed, CTX)
      expect(diff.alerts).toHaveLength(1)
      expect(diff.alerts[0].type).toBe("missed")
      expect(diff.alerts[0].titleAr).toBe("الفرصة فاتت — العائد المتبقي غير كافٍ")
    }
  })

  it("an unchanged missed state does not re-fire (prev missed → curr missed)", () => {
    const missed = oppView({ state: "missed", missedAr: "فاتت" })
    expect(diffOpportunityState(snap({ state: "missed" }), missed, CTX).alerts).toEqual([])
  })

  it("upside-drop detection: 5.2→4.7 fires upside_dropped; 5.2→6.1 silent; exactly 5.0 silent", () => {
    const fires = diffOpportunityState(
      snap({ state: "actionable", eligible: true, upsidePctToT1: 5.2 }),
      oppView({ state: "none", upsidePctToT1: 4.7 }),
      CTX,
    )
    expect(fires.alerts).toHaveLength(1)
    expect(fires.alerts[0].type).toBe("upside_dropped")
    expect(fires.alerts[0].titleAr).toBe("انخفض العائد المتبقي دون 5%")
    expect(fires.alerts[0].bodyAr).toContain("4.7")

    const silent = diffOpportunityState(
      snap({ state: "actionable", eligible: true, upsidePctToT1: 5.2 }),
      oppView({ state: "actionable", eligible: true, upsidePctToT1: 6.1 }),
      CTX,
    )
    expect(silent.alerts).toEqual([])

    // exactly 5.00 fails the classifier's strict gate but the alert title says
    // "دون 5%" — the boundary value is honestly NOT alerted as "below 5%"
    const boundary = diffOpportunityState(
      snap({ state: "actionable", eligible: true, upsidePctToT1: 5.2 }),
      oppView({ state: "none", upsidePctToT1: 5.0 }),
      CTX,
    )
    expect(boundary.alerts).toEqual([])
  })

  it("upside drop without a computable current upside abstains (no fabricated number)", () => {
    const diff = diffOpportunityState(
      snap({ state: "actionable", eligible: true, upsidePctToT1: 5.2 }),
      oppView({ state: "none", upsidePctToT1: null }),
      CTX,
    )
    expect(diff.alerts).toEqual([])
  })

  it("precedence: actionable 5.2% → missed 4.7% fires the missed verdict ONLY (one alert per sweep)", () => {
    const diff = diffOpportunityState(
      snap({ state: "actionable", eligible: true, upsidePctToT1: 5.2 }),
      oppView({ state: "missed", missedAr: "فاتت", upsidePctToT1: 4.7 }),
      CTX,
    )
    expect(diff.alerts).toHaveLength(1)
    expect(diff.alerts[0].type).toBe("missed")
  })

  it("conditional→actionable fires actionable_ready (the documented generalization of none→actionable)", () => {
    const diff = diffOpportunityState(
      snap({ state: "conditional" }),
      oppView({ state: "actionable", eligible: true, upsidePctToT1: 6.8, direction: "buy" }),
      CTX,
    )
    expect(diff.alerts).toHaveLength(1)
    expect(diff.alerts[0].type).toBe("actionable_ready")
  })

  it("missed→actionable fires actionable_ready (an honest re-emergence after a pullback)", () => {
    const diff = diffOpportunityState(
      snap({ state: "missed" }),
      oppView({ state: "actionable", eligible: true, upsidePctToT1: 6.8, direction: "buy" }),
      CTX,
    )
    expect(diff.alerts).toHaveLength(1)
    expect(diff.alerts[0].type).toBe("actionable_ready")
  })
})

// ---------------------------------------------------------------------------
// dedup across runs — the ledger
// ---------------------------------------------------------------------------

describe("diffOpportunityState — dedup across runs", () => {
  it("a persisting state never re-fires regardless of the sweep date (sweep-gap tolerance)", () => {
    const missed = oppView({ state: "missed", missedAr: "فاتت" })
    const first = diffOpportunityState(snap({ state: "actionable", eligible: true, upsidePctToT1: 8.0 }), missed, CTX)
    expect(first.alerts).toHaveLength(1)
    const dayN = diffOpportunityState(first.snapshot, missed, { ...CTX, asOf: "2026-03-09" })
    expect(dayN.alerts).toEqual([])
    expect(dayN.snapshot.emitted).toEqual(first.snapshot.emitted)
  })

  it("the ledger suppresses a repeated same-date key when the state flaps within one session", () => {
    const prev = snap({ state: "none", emitted: [opportunityAlertKey("actionable_ready", CTX.asOf)] })
    const diff = diffOpportunityState(
      prev,
      oppView({ state: "actionable", eligible: true, upsidePctToT1: 6.0 }),
      CTX,
    )
    expect(diff.alerts).toEqual([]) // actionable_ready:2026-03-02 already emitted
    expect(diff.snapshot.state).toBe("actionable")
  })

  it("an A→B re-transition on a NEW date fires again (each occurrence is a real event)", () => {
    const first = diffOpportunityState(
      snap({ state: "none" }),
      oppView({ state: "actionable", eligible: true, upsidePctToT1: 6.0 }),
      CTX,
    )
    expect(first.alerts).toHaveLength(1)
    // actionable died (invalidated) then re-emerged actionable on a later session
    const died = diffOpportunityState(
      first.snapshot,
      oppView({ state: "invalidated", stateNoteAr: "أُلغيت" }),
      { ...CTX, asOf: "2026-03-03" },
    )
    expect(died.alerts.map((a) => a.type)).toEqual(["invalidated"])
    const back = diffOpportunityState(
      died.snapshot,
      oppView({ state: "actionable", eligible: true, upsidePctToT1: 6.4 }),
      { ...CTX, asOf: "2026-03-04" },
    )
    expect(back.alerts.map((a) => a.type)).toEqual(["actionable_ready"])
    expect(back.snapshot.emitted).toContain(opportunityAlertKey("actionable_ready", CTX.asOf))
    expect(back.snapshot.emitted).toContain(opportunityAlertKey("actionable_ready", "2026-03-04"))
  })

  it("prunes the ledger to the most recent OPPORTUNITY_EMITTED_KEYS_KEEP keys", () => {
    const oldKeys = Array.from(
      { length: OPPORTUNITY_EMITTED_KEYS_KEEP + 10 },
      (_, i) => `missed:2025-01-${String((i % 28) + 1).padStart(2, "0")}`,
    )
    const diff = diffOpportunityState(
      snap({ state: "none", emitted: oldKeys }),
      oppView({ state: "missed", missedAr: "فاتت" }),
      CTX,
    )
    expect(diff.snapshot.emitted.length).toBeLessThanOrEqual(OPPORTUNITY_EMITTED_KEYS_KEEP)
    expect(diff.snapshot.emitted).toContain(opportunityAlertKey("missed", CTX.asOf))
    expect(diff.alerts).toHaveLength(1)
  })

  it("is deterministic: identical inputs → identical output (deep equal)", () => {
    const prev = snap({ state: "none" })
    const curr = oppView({ state: "actionable", eligible: true, upsidePctToT1: 6.0 })
    expect(diffOpportunityState(prev, curr, CTX)).toEqual(diffOpportunityState(prev, curr, CTX))
  })
})

// ---------------------------------------------------------------------------
// Feed coexistence — both kinds in ONE row (kind-aware identity + ordering)
// ---------------------------------------------------------------------------

function oppAlertOf(partial: Pick<OpportunityAlert, "companyId" | "ticker" | "type" | "date"> & Partial<OpportunityAlert>): OpportunityAlert {
  return {
    kind: "opportunity",
    titleAr: `${partial.type} ${partial.ticker}`,
    bodyAr: "ملاحظة الفرصة",
    ...partial,
  }
}

function lcAlertOf(
  partial: Pick<import("../lifecycle-alerts").LifecycleAlert, "companyId" | "ticker" | "type" | "date"> &
    Partial<import("../lifecycle-alerts").LifecycleAlert>,
): import("../lifecycle-alerts").LifecycleAlert {
  return {
    titleAr: `${partial.type} ${partial.ticker}`,
    bodyAr: "ملاحظة دورة الحياة",
    ...partial,
  }
}

describe("shared feed — kind coexistence", () => {
  it("mergeAlertFeed dedups by kind+company+type+date: the same identity across kinds does NOT collide", () => {
    const existing: SweepFeedAlert[] = [
      lcAlertOf({ companyId: "c1", ticker: "AAA", type: "invalidated", date: "2026-03-02" }),
    ]
    const incoming: SweepFeedAlert[] = [
      oppAlertOf({ companyId: "c1", ticker: "AAA", type: "invalidated", date: "2026-03-02" }), // same identity fields, OTHER kind
      oppAlertOf({ companyId: "c1", ticker: "AAA", type: "invalidated", date: "2026-03-02" }), // true duplicate
    ]
    const merged = mergeAlertFeed(existing, incoming)
    expect(merged).toHaveLength(2)
    expect(merged.filter((a) => a.kind === "opportunity")).toHaveLength(1)
    expect(merged.filter((a) => a.kind !== "opportunity")).toHaveLength(1)
  })

  it("mergeAlertFeed stays duplicate-free on a refresh (same incoming twice)", () => {
    const incoming = [oppAlertOf({ companyId: "c1", ticker: "AAA", type: "missed", date: "2026-03-02" })]
    const once = mergeAlertFeed([], incoming)
    const twice = mergeAlertFeed(once, incoming)
    expect(twice).toHaveLength(1)
  })

  it("ordering is total over both kinds: date desc, lifecycle before opportunity on the same date", () => {
    const mixed: SweepFeedAlert[] = [
      oppAlertOf({ companyId: "c1", ticker: "AAA", type: "missed", date: "2026-03-03" }),
      lcAlertOf({ companyId: "c2", ticker: "BBB", type: "confirmed", date: "2026-03-03" }),
      oppAlertOf({ companyId: "c3", ticker: "CCC", type: "actionable_ready", date: "2026-03-04" }),
      lcAlertOf({ companyId: "c4", ticker: "DDD", type: "stopped", date: "2026-03-02" }),
    ]
    const out = orderAlertsNewestFirst(mixed)
    expect(out.map((a) => `${a.kind ?? "lifecycle"}:${a.ticker}`)).toEqual([
      "opportunity:CCC", // 03-04
      "lifecycle:BBB", // 03-03, lifecycle kind first
      "opportunity:AAA", // 03-03, opportunity after
      "lifecycle:DDD", // 03-02
    ])
  })

  it("a lifecycle-only feed orders byte-identically to the pre-extension behavior", () => {
    const only = [
      lcAlertOf({ companyId: "c1", ticker: "AAA", type: "stopped", date: "2026-02-02" }),
      lcAlertOf({ companyId: "c2", ticker: "DDD", type: "confirmed", date: "2026-02-03" }),
      lcAlertOf({ companyId: "c3", ticker: "CCC", type: "activated", date: "2026-02-03" }),
    ]
    const out = orderAlertsNewestFirst(only)
    expect(out.map((a) => `${a.ticker}:${a.type}`)).toEqual(["DDD:confirmed", "CCC:activated", "AAA:stopped"])
  })

  it("caps the merged feed, dropping the oldest", () => {
    const many: SweepFeedAlert[] = Array.from({ length: ALERT_FEED_CAP + 5 }, (_, i) =>
      oppAlertOf({ companyId: `c${i}`, ticker: `T${i}`, type: "missed", date: `2026-01-${String((i % 28) + 1).padStart(2, "0")}` }),
    )
    expect(mergeAlertFeed([], many, 10)).toHaveLength(10)
  })
})

// ---------------------------------------------------------------------------
// Real-bar pipeline — classifyOpportunityRow (map + ladder + classifier)
// ---------------------------------------------------------------------------

function dayIso(i: number): string {
  return new Date(Date.UTC(2026, 0, 5 + i)).toISOString().slice(0, 10)
}

/** 60 valid non-flat OHLC sessions: a low 8.0–8.8 zigzag shelf for 40 sessions
 *  (highs never above 9.0 — strictly below the 10.0–10.2 entry, so NO supply
 *  forms near the entry), then a higher 11.0–11.8 shelf whose 12.0 pivot highs
 *  cluster into one meaningful supply band (~11.9 conservative edge → >5%
 *  upside from entryHigh and from the 10.5 activation level). Real swing
 *  pivots on BOTH shelves. The old arithmetic shelf (`9.0 + 0.4*(i%4)`) actually
 *  reached 10.2 closes / 10.4 highs — supply 1.37% above the entry — which the
 *  classifier honestly rejects; this fixture keeps the shelves cleanly apart. */
function opportunityBars(lastClose?: number): Bar[] {
  const out: Bar[] = []
  for (let i = 0; i < 60; i++) {
    let close = i < 40 ? [8.0, 8.4, 8.8, 8.4][i % 4] : [11.0, 11.4, 11.8, 11.4][i % 4]
    if (i === 59 && lastClose !== undefined) close = lastClose
    out.push({ ts: dayIso(i), open: close - 0.1, high: close + 0.2, low: close - 0.25, close, volume: 1000 })
  }
  return out
}

/** 60 sessions in a TIGHT 10.0\u201310.4 zigzag with the last close pulled to
 *  10.5: the only supply band (10.44\u201310.56) CONTAINS the price, so under
 *  opportunity-targets@3 (R3\u2033) it is support \u2014 never a target \u2014 and the
 *  honest measured-move projection (~10.8) lands < 5% above the close, which
 *  is exactly what fires the NO-CHASE rule. */
function missedBars(): Bar[] {
  const out: Bar[] = []
  for (let i = 0; i < 60; i++) {
    const close = [10.0, 10.2, 10.4, 10.2][i % 4]
    out.push({ ts: dayIso(i), open: close - 0.1, high: close + 0.1, low: close - 0.1, close, volume: 1000 })
  }
  const last = out[59]
  last.open = 10.4
  last.high = 10.6
  last.low = 10.4
  last.close = 10.5
  return out
}

function lcViewStub(overrides?: Partial<LifecycleView>): LifecycleView {
  return {
    basis: "confirmed",
    signalState: "confirmed",
    state: "watching",
    reasonAr: null,
    asOf: "2026-03-05",
    evaluatedSessions: 4,
    events: [],
    tradePlan: null,
    activation: null,
    entry: null,
    exit: null,
    sessionsHeld: null,
    ...overrides,
  }
}

function planStub(overrides?: Partial<TradePlan>): TradePlan {
  return {
    bias: "buy",
    entryLow: 10.0,
    entryHigh: 10.2,
    entryPct: 0.5,
    stop: 9.5,
    stopPct: -4.5,
    targetLow: 11.0,
    targetHigh: 11.0,
    targetPct: 6.0,
    riskReward: 2.0,
    textAr: "خطة اختبار",
    textEn: "test plan",
    basisAr: "اختبار",
    ...overrides,
  }
}

function watchSetupStub(overrides?: Partial<WatchingSetup>): WatchingSetup {
  return {
    direction: "buy",
    activation: {
      kind: "close_above",
      level: 10.5,
      basisAr: "اختبار — أعلى مقاومة مُختبرة",
      volumeConditionAr: "حجم إغلاق ≥ 1.5× متوسط آخر 20 جلسة",
    },
    provisionalEntry: null,
    provisionalStop: null,
    provisionalTarget: null,
    provisionalRiskReward: 2.0,
    provisionalBasisAr: "اختبار",
    recomputeNoteAr: "المستويات تقديرية وتُعاد الحسابات عند التفعيل",
    preEntryInvalidation: {
      level: 9.0,
      conditionAr: "إغلاق يومي تحت 9.00 يلغي الفرصة قبل الدخول.",
      reasonAr: "الكسر الهيكلي قبل التفعيل يجعل سيناريو الاستمرار غير صالح",
    },
    postEntryNoteAr: "بعد الدخول الخروج يتبع وقف الخطة",
    vetoReasons: [],
    ...overrides,
  }
}

function rowStub(overrides?: Partial<OpportunityComputedRow>): OpportunityComputedRow {
  return {
    companyId: "c1",
    ticker: "TEST",
    signalState: "confirmed",
    view: lcViewStub(),
    bars: opportunityBars(10.0),
    score: 78,
    tradePlan: planStub(),
    setup: null,
    ...overrides,
  }
}

describe("toOpportunitySetup — the WatchingSetup mapping", () => {
  it("maps activation.level → activationLevel and carries the documented condition verbatim", () => {
    const s = toOpportunitySetup(watchSetupStub())
    expect(s).not.toBeNull()
    expect(s!.direction).toBe("buy")
    expect(s!.activationLevel).toBe(10.5)
    expect(s!.activationConditionAr).toContain("أعلى مقاومة مُختبرة")
    expect(s!.activationConditionAr).toContain("حجم إغلاق")
    expect(s!.provisional).toBe(true)
    expect(s!.provisionalRiskReward).toBe(2.0)
  })

  it("returns null for a missing or level-less setup (never a fabricated trigger)", () => {
    expect(toOpportunitySetup(null)).toBeNull()
    expect(toOpportunitySetup(watchSetupStub({ activation: { kind: "close_above", level: NaN, basisAr: "", volumeConditionAr: "" } }))).toBeNull()
  })
})

describe("classifyOpportunityRow — real map + ladder + classifier", () => {
  it("classifies a confirmed row past both gates as actionable (ladder walked from the plan entry)", () => {
    const out = classifyOpportunityRow(rowStub())
    expect(out).not.toBeNull()
    expect(out!.view.state).toBe("actionable")
    expect(out!.view.eligible).toBe(true)
    expect(out!.view.upsidePctToT1).not.toBeNull()
    expect(out!.view.upsidePctToT1!).toBeGreaterThan(5)
    expect(out!.ladder).not.toBeNull()
    expect(out!.ladder!.targets[0].label).toBe("T1")
  })

  it("classifies a confirmed row whose close left the entry behind with <5% remaining as missed", () => {
    const out = classifyOpportunityRow(rowStub({ bars: missedBars() }))
    expect(out).not.toBeNull()
    expect(out!.view.state).toBe("missed")
    expect(out!.view.missedAr).toBe("الفرصة فاتت — العائد المتبقي غير كافٍ")
  })

  it("classifies a watching row with a qualifying trigger geometry as conditional (ladder at the activation level)", () => {
    const out = classifyOpportunityRow(
      rowStub({
        signalState: "watching",
        tradePlan: null,
        setup: watchSetupStub(),
        view: lcViewStub({ basis: "watching", signalState: "watching", state: "watching" }),
      }),
    )
    expect(out).not.toBeNull()
    expect(out!.view.state).toBe("conditional")
    expect(out!.view.provisional).toBe(true)
    expect(out!.view.eligible).toBe(false)
    expect(out!.view.upsidePctToT1!).toBeGreaterThan(5)
  })

  it("abstains (null) when the bars cannot support an honest resistance map — no fabricated levels", () => {
    const short = rowStub({ bars: opportunityBars().slice(0, 10) })
    expect(classifyOpportunityRow(short)).toBeNull()
    expect(classifyOpportunityRow(rowStub({ bars: [] }))).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// runOpportunitySweep — injected fake deps (no database)
// ---------------------------------------------------------------------------

function fakeDeps(rows: OpportunityComputedRow[], failing: Record<string, Error> = {}) {
  const savedStates: Record<string, OpportunityStateSnapshot>[] = []
  const savedFeeds: SweepFeedAlert[][] = []
  const stateStore: Record<string, OpportunityStateSnapshot> = {}
  let feedStore: SweepFeedAlert[] = []
  const deps: OpportunitySweepDeps & { savedStates: typeof savedStates; savedFeeds: typeof savedFeeds } = {
    savedStates,
    savedFeeds,
    async listCompanies() {
      return rows.map((r) => ({ companyId: r.companyId, ticker: r.ticker }))
    },
    async computeOne(companyId: string) {
      if (failing[companyId]) throw failing[companyId]
      return rows.find((r) => r.companyId === companyId) ?? null
    },
    async loadStateMap() {
      return stateStore
    },
    async saveStateMap(map) {
      for (const [k, v] of Object.entries(map)) stateStore[k] = v
      savedStates.push(map)
      return true
    },
    async loadRecentAlerts() {
      return feedStore
    },
    async saveRecentAlerts(alerts) {
      feedStore = alerts
      savedFeeds.push(alerts)
      return true
    },
    now: () => new Date("2026-03-06T14:00:00Z"),
  }
  return deps
}

describe("runOpportunitySweep", () => {
  const actionableRow = rowStub({ companyId: "c1", ticker: "AAA" })

  it("first run is a baseline: zero alerts, state persisted, feed untouched", async () => {
    const deps = fakeDeps([actionableRow])
    const summary = await runOpportunitySweep(deps)
    expect(summary.dryRun).toBe(false)
    expect(summary.companiesLoaded).toBe(1)
    expect(summary.tracked).toBe(1)
    expect(summary.skipped).toBe(0)
    expect(summary.abstained).toBe(0)
    expect(summary.alertsNew).toBe(0)
    expect(summary.stateSaved).toBe(true)
    expect(deps.savedStates[0]["c1"]?.emitted).toEqual([])
    expect(deps.savedFeeds).toHaveLength(0)
    expect(summary.feedSaved).toBe(false)
  })

  it("full cycle across three runs: baseline → actionable_ready once → dedup on rerun", async () => {
    const store = { state: {} as Record<string, OpportunityStateSnapshot>, feed: [] as SweepFeedAlert[] }
    const makeDeps = (row: OpportunityComputedRow | null): OpportunitySweepDeps => ({
      async listCompanies() {
        return [{ companyId: "c1", ticker: "AAA" }]
      },
      async computeOne() {
        return row
      },
      async loadStateMap() {
        return store.state
      },
      async saveStateMap(map) {
        store.state = map
        return true
      },
      async loadRecentAlerts() {
        return store.feed
      },
      async saveRecentAlerts(alerts) {
        store.feed = alerts
        return true
      },
      now: () => new Date("2026-03-06T14:00:00Z"),
    })

    // run 1 baseline: a WAIT row classifies as "none" — the first observation
    // of ANY state records the snapshot with zero alerts (baseline rule).
    const s1 = await runOpportunitySweep(makeDeps(rowStub({ companyId: "c1", ticker: "AAA", signalState: "wait" })))
    expect(s1.alertsNew).toBe(0)
    const s2 = await runOpportunitySweep(makeDeps(actionableRow))
    expect(s2.alertsNew).toBe(1)
    expect(s2.byType.actionable_ready).toBe(1)
    expect(s2.feedSaved).toBe(true)
    expect(store.feed).toHaveLength(1)
    expect(store.feed[0].kind).toBe("opportunity")
    expect(store.feed[0].type).toBe("actionable_ready")
    // run 3: identical row → dedup, no new alert, feed NOT rewritten
    const s3 = await runOpportunitySweep(makeDeps(actionableRow))
    expect(s3.alertsNew).toBe(0)
    expect(s3.feedSaved).toBe(false)
    expect(store.feed).toHaveLength(1)
    expect(s3.stateSaved).toBe(true)
  })

  it("any→missed transition against a seeded actionable snapshot fires the missed alert into the shared feed", async () => {
    const store = {
      state: {
        c1: snap({ state: "actionable", eligible: true, upsidePctToT1: 16.9, asOf: "2026-03-04", emitted: [] }),
      } as Record<string, OpportunityStateSnapshot>,
      feed: [] as SweepFeedAlert[],
    }
    const deps: OpportunitySweepDeps = {
      async listCompanies() {
        return [{ companyId: "c1", ticker: "AAA" }]
      },
      async computeOne() {
        return rowStub({ companyId: "c1", ticker: "AAA", bars: missedBars() })
      },
      async loadStateMap() {
        return store.state
      },
      async saveStateMap(map) {
        store.state = map
        return true
      },
      async loadRecentAlerts() {
        return store.feed
      },
      async saveRecentAlerts(alerts) {
        store.feed = alerts
        return true
      },
      now: () => new Date("2026-03-06T14:00:00Z"),
    }
    const summary = await runOpportunitySweep(deps)
    expect(summary.alertsNew).toBe(1)
    expect(summary.byType.missed).toBe(1)
    expect(store.feed).toHaveLength(1)
    expect(store.feed[0].kind).toBe("opportunity")
    expect(store.feed[0].titleAr).toBe("الفرصة فاتت — العائد المتبقي غير كافٍ")
    expect(store.state["c1"].state).toBe("missed")
    expect(store.state["c1"].emitted).toContain(opportunityAlertKey("missed", "2026-03-05"))
  })

  it("dry-run computes everything but persists NOTHING (zero save calls)", async () => {
    const deps = fakeDeps([actionableRow])
    const saveState = vi.spyOn(deps, "saveStateMap")
    const saveFeed = vi.spyOn(deps, "saveRecentAlerts")
    const summary = await runOpportunitySweep(deps, { dryRun: true })
    expect(summary.dryRun).toBe(true)
    expect(summary.tracked).toBe(1)
    expect(saveState).not.toHaveBeenCalled()
    expect(saveFeed).not.toHaveBeenCalled()
    expect(summary.stateSaved).toBe(false)
    expect(summary.feedSaved).toBe(false)
  })

  it("one company's error never aborts the pass — recorded, skipped, others still processed", async () => {
    const deps = fakeDeps([rowStub({ companyId: "c-broken", ticker: "BRK" }), rowStub({ companyId: "c-ok", ticker: "AAA" })], {
      "c-broken": new Error("boom"),
    })
    const summary = await runOpportunitySweep(deps)
    expect(summary.errors).toHaveLength(1)
    expect(summary.errors[0]).toContain("c-broken")
    expect(summary.errors[0]).toContain("boom")
    expect(summary.tracked).toBe(1)
    expect(summary.alertsNew).toBe(0) // the ok company is a baseline
    expect(summary.stateSaved).toBe(true)
  })

  it("a classify throw is contained per-company exactly like a compute throw", async () => {
    const broken = rowStub({ companyId: "c2", ticker: "BRK", bars: [{ ts: "2026-01-01", open: 1, high: 0.5, low: 2, close: 1, volume: 1 }] })
    const deps = fakeDeps([broken, rowStub({ companyId: "c1", ticker: "AAA" })])
    const summary = await runOpportunitySweep(deps)
    // the malformed bar row cannot crash the pass — it is counted (abstained
    // or contained), and the healthy company is still tracked
    expect(summary.tracked).toBe(1)
    expect(summary.errors.length + summary.abstained).toBeGreaterThanOrEqual(1)
  })

  it("skips null rows without touching their persisted snapshot", async () => {
    const seeded = snap({ state: "missed" })
    const deps = fakeDeps([rowStub({ companyId: "c1", ticker: "AAA" })])
    deps.computeOne = async () => null
    deps.loadStateMap = async () => ({ c1: seeded })
    const summary = await runOpportunitySweep(deps)
    expect(summary.skipped).toBe(1)
    expect(summary.tracked).toBe(0)
    expect(deps.savedStates[0]["c1"]).toEqual(seeded) // untouched
  })

  it("honest abstention: insufficient bars → no alert, NO snapshot write, counted", async () => {
    const seeded = snap({ state: "actionable", eligible: true, upsidePctToT1: 6.0, asOf: "2026-03-04" })
    const deps = fakeDeps([rowStub({ companyId: "c1", ticker: "AAA", bars: opportunityBars().slice(0, 20) })])
    deps.loadStateMap = async () => ({ c1: seeded })
    const summary = await runOpportunitySweep(deps)
    expect(summary.abstained).toBe(1)
    expect(summary.tracked).toBe(0)
    expect(summary.alertsNew).toBe(0)
    expect(deps.savedFeeds).toHaveLength(0)
    expect(deps.savedStates[0]["c1"]).toEqual(seeded) // the previous snapshot is left untouched
  })

  it("processes companies in stable ticker order regardless of listing order", async () => {
    const order: string[] = []
    const deps = fakeDeps([
      rowStub({ companyId: "c2", ticker: "ZZZ" }),
      rowStub({ companyId: "c1", ticker: "AAA" }),
    ])
    deps.computeOne = async (companyId) => {
      order.push(companyId)
      return rowStub({ companyId, ticker: companyId === "c2" ? "ZZZ" : "AAA" })
    }
    await runOpportunitySweep(deps)
    expect(order).toEqual(["c1", "c2"]) // AAA before ZZZ
  })

  it("merges opportunity alerts into an EXISTING feed holding lifecycle items (both kinds coexist)", async () => {
    const existing: SweepFeedAlert[] = [
      lcAlertOf({ companyId: "c0", ticker: "OLD", type: "expired", date: "2026-03-01" }),
    ]
    const store = {
      state: { c1: snap({ state: "none", asOf: "2026-03-04" }) } as Record<string, OpportunityStateSnapshot>,
      feed: existing,
    }
    const deps: OpportunitySweepDeps = {
      async listCompanies() {
        return [{ companyId: "c1", ticker: "AAA" }]
      },
      async computeOne() {
        return actionableRow
      },
      async loadStateMap() {
        return store.state
      },
      async saveStateMap(map) {
        store.state = map
        return true
      },
      async loadRecentAlerts() {
        return store.feed
      },
      async saveRecentAlerts(alerts) {
        store.feed = alerts
        return true
      },
      now: () => new Date("2026-03-06T14:00:00Z"),
    }
    const summary = await runOpportunitySweep(deps)
    expect(summary.alertsNew).toBe(1)
    expect(summary.feedSaved).toBe(true)
    expect(store.feed).toHaveLength(2)
    // newest first: the opportunity alert (03-05 asOf) leads the lifecycle one (03-01)
    expect(store.feed[0].kind).toBe("opportunity")
    expect(store.feed[0].type).toBe("actionable_ready")
    expect(store.feed[1].kind).toBeUndefined() // the pre-kind lifecycle item passes through untouched
    expect(store.feed[1].type).toBe("expired")
  })

  it("honors feedCap when merging", async () => {
    const existing: SweepFeedAlert[] = Array.from({ length: 5 }, (_, i) =>
      lcAlertOf({ companyId: `c0-${i}`, ticker: `O${i}`, type: "confirmed", date: `2026-02-0${i + 1}` }),
    )
    const store = {
      state: { c1: snap({ state: "none", asOf: "2026-03-04" }) } as Record<string, OpportunityStateSnapshot>,
      feed: existing,
    }
    const deps: OpportunitySweepDeps = {
      async listCompanies() {
        return [{ companyId: "c1", ticker: "AAA" }]
      },
      async computeOne() {
        return actionableRow
      },
      async loadStateMap() {
        return store.state
      },
      async saveStateMap(map) {
        store.state = map
        return true
      },
      async loadRecentAlerts() {
        return store.feed
      },
      async saveRecentAlerts(alerts) {
        store.feed = alerts
        return true
      },
      now: () => new Date("2026-03-06T14:00:00Z"),
    }
    const summary = await runOpportunitySweep(deps, { feedCap: 3 })
    expect(summary.alertsNew).toBe(1)
    expect(store.feed).toHaveLength(3)
    expect(store.feed[0].kind).toBe("opportunity")
  })
})
