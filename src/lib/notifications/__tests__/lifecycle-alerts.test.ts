// =============================================================================
// Lifecycle-transition alerts — pure diff/dedup + sweep orchestration tests.
//
// The contract pinned here (src/lib/notifications/lifecycle-alerts.ts):
//   • one alert per transition (keyed `${type}:${date}`);
//   • no alert for unchanged states;
//   • FIRST observation is a baseline (history recorded, zero alerts);
//   • ordering is total and stable;
//   • the sweep persists state + feed through injected deps and honors
//     dry-run; one company's error never aborts the run.
// Lifecycle views are hand-shaped (plain objects) for the diff tests, and two
// scenarios run through the REAL computeLifecycle walk to pin the
// view → alert mapping on engine-produced events.
// =============================================================================
import { describe, expect, it, vi } from "vitest"
import { computeLifecycle, type LifecycleBar, type LifecycleView } from "../../technical/lifecycle"
import type { TradePlan } from "../../technical/trade-plan"
import type { WatchingSetup } from "../../technical/signals"
import {
  EMITTED_KEYS_KEEP,
  ALERT_FEED_CAP,
  alertTypeForView,
  currentTransitionAlerts,
  diffLifecycleState,
  lifecycleAlertKey,
  mergeAlertFeed,
  orderAlertsNewestFirst,
  type LifecycleAlert,
  type LifecycleStateSnapshot,
} from "../lifecycle-alerts"
import { runLifecycleSweep, type SweepDeps } from "../lifecycle-sweep"

// ---------------------------------------------------------------------------
// Hand-shaped view builder (the diff logic consumes plain LifecycleViews)
// ---------------------------------------------------------------------------

function viewStub(overrides?: Partial<LifecycleView>): LifecycleView {
  return {
    basis: "watching",
    signalState: "watching",
    state: "watching",
    reasonAr: null,
    asOf: "2026-01-20",
    evaluatedSessions: 0,
    events: [],
    tradePlan: null,
    activation: null,
    entry: null,
    exit: null,
    sessionsHeld: null,
    ...overrides,
  }
}

const COMPANY = { companyId: "c1", ticker: "TEST" }

// ---------------------------------------------------------------------------
// Real-walk fixtures (same builders the lifecycle tests pin)
// ---------------------------------------------------------------------------

const WARMUP = 17

function dayIso(i: number): string {
  return new Date(Date.UTC(2026, 0, 4 + i)).toISOString().slice(0, 10)
}

function risingWithDips(n: number, start = 9.0): number[] {
  const out: number[] = []
  let p = start
  for (let i = 0; i < n; i++) {
    p = i > 0 && i % 6 === 0 ? p * 0.998 : p * 1.005
    out.push(Math.round(p * 100) / 100)
  }
  return out
}

function closeBars(closes: number[], volumes?: (number | null)[]): LifecycleBar[] {
  return closes.map((c, i) => ({
    ts: dayIso(i),
    open: c,
    high: c,
    low: c,
    close: c,
    volume: volumes ? (volumes[i] ?? null) : 1000,
  }))
}

function watchSetup(overrides?: Partial<WatchingSetup>): WatchingSetup {
  return {
    direction: "buy",
    activation: {
      kind: "close_above",
      level: 9.7,
      basisAr: "اختبار — أعلى مقاومة مُختبرة",
      volumeConditionAr: "حجم إغلاق ≥ 1.5× متوسط آخر 20 جلسة",
    },
    provisionalEntry: null,
    provisionalStop: null,
    provisionalTarget: null,
    provisionalRiskReward: null,
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
    riskReward: 2.5,
    textAr: "خطة اختبار",
    textEn: "test plan",
    basisAr: "اختبار",
    ...overrides,
  }
}

/** Real watching walk that INVALIDATES: 17 warmup sessions near 9.2, then a
 *  future close below the 9.00 pre-entry invalidation (before activation). */
function invalidatedRealView(): LifecycleView {
  const bars = closeBars([...risingWithDips(WARMUP, 9.2), 8.9])
  const view = computeLifecycle({
    signalState: "watching",
    setup: watchSetup(),
    bars,
    createdOn: dayIso(WARMUP - 1),
  })
  expect(view).not.toBeNull()
  return view!
}

/** Real watching walk that CONFIRMS: the lifecycle tests' activation scenario
 *  (close 9.80 beyond 9.70 on 3× volume, recompute passes RR ≥ 1.5 with the
 *  bar-derived pivots the loader hands the rebuild). */
function confirmedRealView(): LifecycleView {
  const bars = closeBars(
    [...risingWithDips(WARMUP), 9.6, 9.62, 9.65, 9.8],
    [...Array(WARMUP).fill(1000), 1000, 1000, 1000, 3000],
  )
  const view = computeLifecycle({
    signalState: "watching",
    setup: watchSetup(),
    rebuildSupports: [{ price: 9.5 }],
    rebuildResistances: [{ price: 11.5 }],
    bars,
    createdOn: dayIso(WARMUP - 1),
  })
  expect(view).not.toBeNull()
  expect(view!.state).toBe("confirmed")
  return view!
}

// ---------------------------------------------------------------------------
// alertTypeForView — the view → alert-type mapping
// ---------------------------------------------------------------------------

describe("alertTypeForView", () => {
  it("returns null for the initial (non-transition) states", () => {
    expect(alertTypeForView(viewStub({ state: "watching" }))).toBeNull()
    expect(alertTypeForView(viewStub({ basis: "confirmed", signalState: "confirmed", state: "confirmed" }))).toBeNull()
  })

  it("maps each terminal state to its alert type", () => {
    expect(alertTypeForView(viewStub({ state: "invalidated" }))).toBe("invalidated")
    expect(alertTypeForView(viewStub({ basis: "confirmed", signalState: "confirmed", state: "active" }))).toBe("activated")
    expect(alertTypeForView(viewStub({ basis: "confirmed", signalState: "confirmed", state: "stopped" }))).toBe("stopped")
    expect(alertTypeForView(viewStub({ basis: "confirmed", signalState: "confirmed", state: "targeted" }))).toBe("targeted")
    expect(alertTypeForView(viewStub({ basis: "confirmed", signalState: "confirmed", state: "expired" }))).toBe("expired")
  })

  it("distinguishes the time stop (expired + exit.kind time_stopped)", () => {
    expect(
      alertTypeForView(
        viewStub({
          basis: "confirmed",
          signalState: "confirmed",
          state: "expired",
          exit: { date: "2026-02-05", price: 10.1, kind: "time_stopped" },
        }),
      ),
    ).toBe("time_stopped")
  })

  it("watching confirmation maps to the confirmed alert type", () => {
    expect(alertTypeForView(confirmedRealView())).toBe("confirmed")
  })
})

// ---------------------------------------------------------------------------
// currentTransitionAlerts — the terminal transition as a full record
// ---------------------------------------------------------------------------

describe("currentTransitionAlerts", () => {
  it("builds the record from the terminal event (date + noteAr)", () => {
    const view = viewStub({
      state: "stopped",
      events: [{ type: "stopped", date: "2026-01-30", price: 9.5, noteAr: "وقف الخسارة عند 9.50" }],
      exit: { date: "2026-01-30", price: 9.5, kind: "stopped" },
    })
    const alerts = currentTransitionAlerts(COMPANY, view)
    expect(alerts).toHaveLength(1)
    expect(alerts[0]).toEqual({
      companyId: "c1",
      ticker: "TEST",
      type: "stopped",
      date: "2026-01-30",
      titleAr: "صفقة TEST ضربت وقف الخسارة",
      bodyAr: "وقف الخسارة عند 9.50",
    })
  })

  it("returns [] for views with no transition or a missing terminal event", () => {
    expect(currentTransitionAlerts(COMPANY, viewStub())).toEqual([])
    expect(currentTransitionAlerts(COMPANY, viewStub({ state: "stopped", events: [] }))).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// diffLifecycleState — transition dedup / baseline / unchanged states
// ---------------------------------------------------------------------------

describe("diffLifecycleState", () => {
  it("baseline (previous === null): records the terminal transition as emitted, emits NO alerts", () => {
    const view = viewStub({
      state: "stopped",
      exit: { date: "2026-01-30", price: 9.5, kind: "stopped" },
      events: [
        { type: "activated", date: "2026-01-22", price: 10.1, noteAr: "دخول" },
        { type: "stopped", date: "2026-01-30", price: 9.5, noteAr: "وقف" },
      ],
    })
    const diff = diffLifecycleState(COMPANY, view, null)
    expect(diff.alerts).toEqual([])
    // The ledger carries what the view REPORTS — the walk's terminal
    // transition. The historical entry (pre-baseline) can never re-fire: the
    // walk only moves forward, so a terminal state never un-terminates.
    expect(diff.snapshot.emitted).toEqual(["stopped:2026-01-30"])
    expect(diff.snapshot.state).toBe("stopped")
    expect(diff.snapshot.asOf).toBe("2026-01-20")
  })

  it("baseline with a confirmed real walk: no alerts, ledger carries the activation key", () => {
    const view = confirmedRealView()
    const diff = diffLifecycleState(COMPANY, view, null)
    expect(diff.alerts).toEqual([])
    expect(diff.snapshot.emitted).toEqual([lifecycleAlertKey("confirmed", view.events[0].date)])
    expect(diff.snapshot.state).toBe("confirmed")
    expect(diff.snapshot.basis).toBe("watching")
    expect(diff.snapshot.signalState).toBe("watching")
  })

  it("emits ONE confirmed alert on the watching→confirmed transition, with the event's noteAr", () => {
    const view = confirmedRealView()
    const baseline = diffLifecycleState(COMPANY, viewStub({ asOf: "2026-01-20" }), null).snapshot
    const diff = diffLifecycleState(COMPANY, view, baseline)
    expect(diff.alerts).toHaveLength(1)
    const alert = diff.alerts[0]
    expect(alert.type).toBe("confirmed")
    expect(alert.companyId).toBe("c1")
    expect(alert.ticker).toBe("TEST")
    expect(alert.date).toBe(view.events[0].date)
    expect(alert.bodyAr).toBe(view.events[0].noteAr)
    expect(alert.titleAr).toContain("TEST")
    expect(diff.snapshot.emitted).toContain(lifecycleAlertKey("confirmed", alert.date))
  })

  it("no alert on unchanged states — the same view re-diffed emits nothing", () => {
    const view = confirmedRealView()
    const first = diffLifecycleState(COMPANY, view, null)
    const second = diffLifecycleState(COMPANY, view, first.snapshot)
    expect(second.alerts).toEqual([])
    expect(second.snapshot.emitted).toEqual(first.snapshot.emitted)
  })

  it("dedups across runs while the terminal state persists (sweep-gap tolerance)", () => {
    const view = confirmedRealView()
    const baseline = diffLifecycleState(COMPANY, viewStub(), null).snapshot
    const day1 = diffLifecycleState(COMPANY, view, baseline)
    expect(day1.alerts).toHaveLength(1)
    // The sweep fails for several days and re-runs against the SAME view.
    const dayN = diffLifecycleState(COMPANY, view, day1.snapshot)
    expect(dayN.alerts).toEqual([])
  })

  it("walks confirmed basis entry → stop as two transitions across runs", () => {
    const entryView = viewStub({
      basis: "confirmed",
      signalState: "confirmed",
      state: "active",
      events: [{ type: "activated", date: "2026-02-01", price: 10.1, noteAr: "أول إغلاق داخل المنطقة" }],
      entry: { date: "2026-02-01", price: 10.1 },
    })
    const stopView = viewStub({
      basis: "confirmed",
      signalState: "confirmed",
      state: "stopped",
      events: [
        { type: "activated", date: "2026-02-01", price: 10.1, noteAr: "أول إغلاق داخل المنطقة" },
        { type: "stopped", date: "2026-02-05", price: 9.5, noteAr: "وقف الخسارة" },
      ],
      entry: { date: "2026-02-01", price: 10.1 },
      exit: { date: "2026-02-05", price: 9.5, kind: "stopped" },
      sessionsHeld: 5,
    })
    const baseline = diffLifecycleState(COMPANY, entryView, null).snapshot
    const d1 = diffLifecycleState(COMPANY, entryView, baseline)
    expect(d1.alerts).toEqual([]) // baseline already covered the entry
    const d2 = diffLifecycleState(COMPANY, stopView, d1.snapshot)
    expect(d2.alerts).toHaveLength(1)
    expect(d2.alerts[0].type).toBe("stopped")
    expect(d2.alerts[0].date).toBe("2026-02-05")
    expect(d2.alerts[0].bodyAr).toBe("وقف الخسارة")
    // The entry key survives in the ledger (no re-fire) alongside the stop key.
    expect(d2.snapshot.emitted).toContain("activated:2026-02-01")
    expect(d2.snapshot.emitted).toContain("stopped:2026-02-05")
  })

  it("maps the time stop, invalidation and expiry transitions with real notes", () => {
    const cases: { view: LifecycleView; type: LifecycleAlert["type"] }[] = [
      {
        type: "time_stopped",
        view: viewStub({
          basis: "confirmed",
          signalState: "confirmed",
          state: "expired",
          events: [{ type: "time_stopped", date: "2026-02-20", price: 10.3, noteAr: "وقف زمني" }],
          exit: { date: "2026-02-20", price: 10.3, kind: "time_stopped" },
        }),
      },
      { type: "invalidated", view: invalidatedRealView() },
      {
        type: "expired",
        view: viewStub({
          state: "expired",
          reasonAr: "انتهت المهلة",
          events: [{ type: "expired", date: "2026-03-01", price: 9.4, noteAr: "انتهت المهلة" }],
        }),
      },
    ]
    for (const c of cases) {
      const baseline = diffLifecycleState(COMPANY, viewStub({ basis: c.view.basis, signalState: c.view.signalState }), null).snapshot
      const diff = diffLifecycleState(COMPANY, c.view, baseline)
      expect(diff.alerts).toHaveLength(1)
      expect(diff.alerts[0].type).toBe(c.type)
      expect(diff.alerts[0].bodyAr).toBeTruthy()
    }
  })

  it("never fabricates an alert when the transition's event is missing", () => {
    const view = viewStub({ state: "stopped", events: [] }) // inconsistent on purpose
    const baseline = diffLifecycleState(COMPANY, viewStub(), null).snapshot
    const diff = diffLifecycleState(COMPANY, view, baseline)
    expect(diff.alerts).toEqual([])
    expect(diff.snapshot.state).toBe("stopped")
  })

  it("prunes the ledger to the most recent EMITTED_KEYS_KEEP keys", () => {
    const oldKeys = Array.from({ length: EMITTED_KEYS_KEEP + 10 }, (_, i) => `expired:2025-01-${String((i % 28) + 1).padStart(2, "0")}`)
    const view = viewStub({ state: "expired", events: [{ type: "expired", date: "2026-03-01", price: 9.4, noteAr: "انتهت" }] })
    const previous: LifecycleStateSnapshot = {
      ...diffLifecycleState(COMPANY, viewStub(), null).snapshot,
      emitted: oldKeys,
    }
    const diff = diffLifecycleState(COMPANY, view, previous)
    expect(diff.snapshot.emitted.length).toBeLessThanOrEqual(EMITTED_KEYS_KEEP)
    expect(diff.snapshot.emitted).toContain("expired:2026-03-01")
    // The pruned old keys can no longer suppress — a fresh transition still fires.
    expect(diff.alerts).toHaveLength(1)
  })

  it("falls back to the companyId as the ticker when none exists", () => {
    const view = viewStub({
      state: "invalidated",
      events: [{ type: "invalidated", date: "2026-01-25", price: 8.9, noteAr: "إلغاء" }],
    })
    const baseline = diffLifecycleState({ companyId: "c1", ticker: null }, viewStub(), null).snapshot
    const diff = diffLifecycleState({ companyId: "c1", ticker: null }, view, baseline)
    expect(diff.alerts[0].ticker).toBe("c1")
  })

  it("is deterministic: identical inputs → identical output (deep equal)", () => {
    const view = confirmedRealView()
    const baseline = diffLifecycleState(COMPANY, viewStub(), null).snapshot
    expect(diffLifecycleState(COMPANY, view, baseline)).toEqual(diffLifecycleState(COMPANY, view, baseline))
  })
})

// ---------------------------------------------------------------------------
// Feed helpers — ordering + merge/cap
// ---------------------------------------------------------------------------

function alertOf(partial: Pick<LifecycleAlert, "companyId" | "ticker" | "type" | "date"> & Partial<LifecycleAlert>): LifecycleAlert {
  return {
    titleAr: `${partial.type} ${partial.ticker}`,
    bodyAr: "ملاحظة",
    ...partial,
  }
}

describe("orderAlertsNewestFirst", () => {
  it("orders newest first with total, stable tie-breaks (date desc, type rank, ticker)", () => {
    const input = [
      alertOf({ companyId: "c1", ticker: "AAA", type: "stopped", date: "2026-02-02" }),
      alertOf({ companyId: "c2", ticker: "DDD", type: "confirmed", date: "2026-02-03" }),
      alertOf({ companyId: "c3", ticker: "CCC", type: "activated", date: "2026-02-03" }),
      alertOf({ companyId: "c4", ticker: "BBB", type: "confirmed", date: "2026-02-03" }),
    ]
    const out = orderAlertsNewestFirst(input)
    expect(out.map((a) => `${a.ticker}:${a.type}`)).toEqual([
      "BBB:confirmed", // 02-03, rank 0
      "DDD:confirmed", // 02-03, rank 0, ticker tie-break
      "CCC:activated", // 02-03, rank 1
      "AAA:stopped", // 02-02
    ])
  })

  it("is deterministic under input shuffling", () => {
    const input = [
      alertOf({ companyId: "c1", ticker: "AAA", type: "expired", date: "2026-01-01" }),
      alertOf({ companyId: "c2", ticker: "BBB", type: "confirmed", date: "2026-01-02" }),
      alertOf({ companyId: "c3", ticker: "CCC", type: "targeted", date: "2026-01-02" }),
    ]
    const a = orderAlertsNewestFirst(input)
    const b = orderAlertsNewestFirst([...input].reverse())
    expect(a).toEqual(b)
  })
})

describe("mergeAlertFeed", () => {
  it("dedups by companyId + type + date and keeps newest-first order", () => {
    const existing = [alertOf({ companyId: "c1", ticker: "AAA", type: "stopped", date: "2026-02-02" })]
    const incoming = [
      alertOf({ companyId: "c1", ticker: "AAA", type: "stopped", date: "2026-02-02" }), // duplicate
      alertOf({ companyId: "c2", ticker: "BBB", type: "confirmed", date: "2026-02-04" }),
    ]
    const merged = mergeAlertFeed(existing, incoming)
    expect(merged).toHaveLength(2)
    expect(merged[0].ticker).toBe("BBB")
    expect(merged[1].ticker).toBe("AAA")
  })

  it("caps the feed, dropping the oldest", () => {
    const many: LifecycleAlert[] = Array.from({ length: ALERT_FEED_CAP + 5 }, (_, i) =>
      alertOf({ companyId: `c${i}`, ticker: `T${i}`, type: "confirmed", date: `2026-01-${String((i % 28) + 1).padStart(2, "0")}` }),
    )
    const merged = mergeAlertFeed([], many, 10)
    expect(merged).toHaveLength(10)
    expect(merged[0].date).toBe("2026-01-28") // the newest date leads
  })

  it("default cap matches ALERT_FEED_CAP", () => {
    const many: LifecycleAlert[] = Array.from({ length: ALERT_FEED_CAP + 1 }, (_, i) =>
      alertOf({ companyId: `c${i}`, ticker: `T${i}`, type: "confirmed", date: "2026-01-01" }),
    )
    expect(mergeAlertFeed([], many)).toHaveLength(ALERT_FEED_CAP)
  })
})

// ---------------------------------------------------------------------------
// runLifecycleSweep — injected fake deps (no database)
// ---------------------------------------------------------------------------

interface FakeCompany {
  companyId: string
  ticker: string | null
  view: LifecycleView | null
  error?: Error
}

function fakeDeps(companies: FakeCompany[], now = new Date("2026-03-02T14:00:00Z")): SweepDeps & {
  savedStates: Record<string, LifecycleStateSnapshot>[]
  savedFeeds: LifecycleAlert[][]
} {
  const savedStates: Record<string, LifecycleStateSnapshot>[] = []
  const savedFeeds: LifecycleAlert[][] = []
  const stateStore: Record<string, LifecycleStateSnapshot> = {}
  let feedStore: LifecycleAlert[] = []
  return {
    savedStates,
    savedFeeds,
    async listCompanies() {
      return companies.map((c) => ({ companyId: c.companyId, ticker: c.ticker }))
    },
    async computeOne(companyId: string) {
      const c = companies.find((x) => x.companyId === companyId)
      if (!c) return null
      if (c.error) throw c.error
      if (!c.view) return null
      return { companyId: c.companyId, ticker: c.ticker, signalState: c.view.signalState, view: c.view }
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
    now: () => now,
  }
}

describe("runLifecycleSweep", () => {
  const watchingView = viewStub({ asOf: "2026-03-01" })

  it("first run is a baseline: zero alerts, state persisted, feed untouched", async () => {
    const deps = fakeDeps([{ companyId: "c1", ticker: "AAA", view: watchingView }])
    const summary = await runLifecycleSweep(deps)
    expect(summary.dryRun).toBe(false)
    expect(summary.companiesLoaded).toBe(1)
    expect(summary.tracked).toBe(1)
    expect(summary.skipped).toBe(0)
    expect(summary.alertsNew).toBe(0)
    expect(summary.stateSaved).toBe(true)
    expect(deps.savedStates).toHaveLength(1)
    expect(deps.savedStates[0]["c1"]?.emitted).toEqual([])
    expect(deps.savedFeeds).toHaveLength(0) // nothing changed → no feed write
    expect(summary.feedSaved).toBe(false)
  })

  it("full lifecycle across three runs: baseline → confirmed alert → dedup", async () => {
    const confirmed = confirmedRealView()
    const store: { state: Record<string, LifecycleStateSnapshot>; feed: LifecycleAlert[] } = { state: {}, feed: [] }
    const makeDeps = (view: LifecycleView | null): SweepDeps => ({
      async listCompanies() {
        return [{ companyId: "c1", ticker: "AAA" }]
      },
      async computeOne() {
        if (!view) return null
        return { companyId: "c1", ticker: "AAA", signalState: view.signalState, view }
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
      now: () => new Date("2026-03-02T14:00:00Z"),
    })

    const s1 = await runLifecycleSweep(makeDeps(watchingView))
    expect(s1.alertsNew).toBe(0)
    const s2 = await runLifecycleSweep(makeDeps(confirmed))
    expect(s2.alertsNew).toBe(1)
    expect(s2.byType.confirmed).toBe(1)
    expect(s2.feedSaved).toBe(true)
    expect(store.feed).toHaveLength(1)
    expect(store.feed[0].type).toBe("confirmed")
    // Run 3: the same confirmed view → dedup, no new alert, feed not rewritten.
    const s3 = await runLifecycleSweep(makeDeps(confirmed))
    expect(s3.alertsNew).toBe(0)
    expect(s3.feedSaved).toBe(false)
    expect(store.feed).toHaveLength(1)
    expect(s3.stateSaved).toBe(true)
  })

  it("dry-run computes everything but persists nothing", async () => {
    const deps = fakeDeps([{ companyId: "c1", ticker: "AAA", view: watchingView }])
    const saveState = vi.spyOn(deps, "saveStateMap")
    const saveFeed = vi.spyOn(deps, "saveRecentAlerts")
    const summary = await runLifecycleSweep(deps, { dryRun: true })
    expect(summary.dryRun).toBe(true)
    expect(summary.tracked).toBe(1)
    expect(saveState).not.toHaveBeenCalled()
    expect(saveFeed).not.toHaveBeenCalled()
    expect(summary.stateSaved).toBe(false)
    expect(summary.feedSaved).toBe(false)
  })

  it("one company's error never aborts the run — recorded and skipped", async () => {
    const deps = fakeDeps([
      { companyId: "c-broken", ticker: "BRK", view: null, error: new Error("boom") },
      {
        companyId: "c-ok",
        ticker: "AAA",
        view: viewStub({
          state: "invalidated",
          events: [{ type: "invalidated", date: "2026-03-01", price: 8.9, noteAr: "إلغاء" }],
        }),
      },
    ])
    const summary = await runLifecycleSweep(deps)
    expect(summary.errors).toHaveLength(1)
    expect(summary.errors[0]).toContain("c-broken")
    expect(summary.errors[0]).toContain("boom")
    expect(summary.tracked).toBe(1)
    expect(summary.alertsNew).toBe(0) // the ok company is a baseline
    expect(summary.stateSaved).toBe(true)
  })

  it("skips null views without touching their persisted snapshot", async () => {
    const deps = fakeDeps([{ companyId: "c1", ticker: "AAA", view: null }])
    const summary = await runLifecycleSweep(deps)
    expect(summary.skipped).toBe(1)
    expect(summary.tracked).toBe(0)
    expect(deps.savedStates[0]).toEqual({})
  })

  it("processes companies in stable ticker order regardless of listing order", async () => {
    const order: string[] = []
    const deps = fakeDeps([
      { companyId: "c2", ticker: "ZZZ", view: watchingView },
      { companyId: "c1", ticker: "AAA", view: watchingView },
    ])
    deps.computeOne = async (companyId) => {
      order.push(companyId)
      const ticker = companyId === "c2" ? "ZZZ" : "AAA"
      return { companyId, ticker, signalState: watchingView.signalState, view: watchingView }
    }
    await runLifecycleSweep(deps)
    expect(order).toEqual(["c1", "c2"]) // AAA before ZZZ
  })

  it("merges new alerts into an existing feed (newest first, bodyAr carried)", async () => {
    const existing: LifecycleAlert[] = [
      alertOf({ companyId: "c0", ticker: "OLD", type: "expired", date: "2026-02-01" }),
    ]
    const store: { state: Record<string, LifecycleStateSnapshot>; feed: LifecycleAlert[] } = { state: {}, feed: existing }
    const invalidated = viewStub({
      state: "invalidated",
      events: [{ type: "invalidated", date: "2026-03-01", price: 8.9, noteAr: "إلغاء قبل الدخول" }],
    })
    const deps: SweepDeps = {
      async listCompanies() {
        return [{ companyId: "c1", ticker: "AAA" }]
      },
      async computeOne() {
        return { companyId: "c1", ticker: "AAA", signalState: invalidated.signalState, view: invalidated }
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
      now: () => new Date("2026-03-02T14:00:00Z"),
    }
    // Pre-seed the ledger so the transition is NEW (not a baseline).
    store.state["c1"] = {
      basis: "watching",
      signalState: "watching",
      state: "watching",
      asOf: "2026-02-28",
      emitted: [],
    }
    const summary = await runLifecycleSweep(deps)
    expect(summary.alertsNew).toBe(1)
    expect(summary.feedSaved).toBe(true)
    expect(store.feed).toHaveLength(2)
    expect(store.feed[0].ticker).toBe("AAA") // newest first
    expect(store.feed[0].bodyAr).toBe("إلغاء قبل الدخول")
    // The ledger now carries the transition key.
    expect(store.state["c1"].emitted).toContain("invalidated:2026-03-01")
  })

  it("honors feedCap when merging", async () => {
    const existing: LifecycleAlert[] = Array.from({ length: 5 }, (_, i) =>
      alertOf({ companyId: `c0-${i}`, ticker: `O${i}`, type: "confirmed", date: `2026-02-0${i + 1}` }),
    )
    const store: { state: Record<string, LifecycleStateSnapshot>; feed: LifecycleAlert[] } = {
      state: {},
      feed: existing,
    }
    const invalidated = viewStub({
      state: "invalidated",
      events: [{ type: "invalidated", date: "2026-03-01", price: 8.9, noteAr: "إلغاء" }],
    })
    const deps: SweepDeps = {
      async listCompanies() {
        return [{ companyId: "c1", ticker: "AAA" }]
      },
      async computeOne() {
        return { companyId: "c1", ticker: "AAA", signalState: invalidated.signalState, view: invalidated }
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
      now: () => new Date("2026-03-02T14:00:00Z"),
    }
    store.state["c1"] = { basis: "watching", signalState: "watching", state: "watching", asOf: "2026-02-28", emitted: [] }
    const summary = await runLifecycleSweep(deps, { feedCap: 3 })
    expect(summary.alertsNew).toBe(1)
    expect(store.feed).toHaveLength(3) // oldest entries dropped by the cap
  })
})
