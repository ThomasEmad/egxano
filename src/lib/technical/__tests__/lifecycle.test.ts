// Plan-lifecycle layer tests (v1 — derived states, zero persistence).
//
// THE CONTRACT UNDER TEST: a published stance reacts to the daily bars that
// trade AFTER its creation. Every scenario below is hand-shaped so the
// expected state is derivable by construction, not by re-running the engine:
//   • watching setups: activation (close beyond the level + the numeric
//     volume rule), pre-entry invalidation, session-window expiry, and the
//     recompute gate (a weak plan rebuild NEVER auto-confirms);
//   • confirmed plans: entry by daily close, then the execution walk
//     mirroring the backtest model — stop precedence, OHLC touches with the
//     open-gap rule, time stop inclusive of the entry session;
//   • determinism: identical inputs → deep-equal views;
//   • the service seam: injected deps, no database, "بيانات غير كافية".
import { describe, expect, it } from "vitest"
import {
  computeLifecycle,
  gateLifecycleForFree,
  insufficientLifecycleView,
  lifecycleChipLabel,
  DEFAULT_LIFECYCLE_PARAMS,
  type LifecycleBar,
  type LifecycleView,
} from "../lifecycle"
import { getCompanyLifecycle, LIFECYCLE_WARMUP_SESSIONS, type LifecycleDeps } from "../lifecycle-service"
import type { TradePlan } from "../trade-plan"
import type { SignalState, TechStance, WatchingSetup } from "../signals"

// ---------------------------------------------------------------------------
// Deterministic series builders
// ---------------------------------------------------------------------------

const WARMUP = 17 // watching warmup sessions (indices 0..16); future starts at 17

function dayIso(i: number): string {
  return new Date(Date.UTC(2026, 0, 4 + i)).toISOString().slice(0, 10)
}

/** Rising closes with a shallow dip every 6th session — the dips are the
 *  close-only pivot LOWS the trade-plan rebuild anchors on. Starts at 9.0
 *  (tall measured-move range) with tiny daily noise so the rebuilt plan's
 *  ATR-bounded stop stays small and RR lands well above 1.5. Ends ~9.7. */
function risingWithDips(n: number, start = 9.0): number[] {
  const out: number[] = []
  let p = start
  for (let i = 0; i < n; i++) {
    p = i > 0 && i % 6 === 0 ? p * 0.998 : p * 1.005
    out.push(Math.round(p * 100) / 100)
  }
  return out
}

/** Declining closes: a flat 9-session shelf at 10.5 (inside the wing-5 pivot
 *  scan — the resistance cluster the sell rebuild anchors on), then a decline
 *  with a shallow bounce every 6th session. Ends ~10.0. */
function decliningWithBounces(n: number, start = 10.5): number[] {
  const out: number[] = []
  for (let i = 0; i < n; i++) {
    if (i < 9) { out.push(start); continue }
    const prev = out[i - 1]
    out.push(Math.round((i % 6 === 0 ? prev * 1.002 : prev * 0.993) * 100) / 100)
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

/** Explicit OHLC candles: [open, high, low, close] per session. */
function candleBars(rows: [number, number, number, number][], volumes?: (number | null)[]): LifecycleBar[] {
  return rows.map((r, i) => ({
    ts: dayIso(i),
    open: r[0],
    high: r[1],
    low: r[2],
    close: r[3],
    volume: volumes ? (volumes[i] ?? null) : 1000,
  }))
}

// ---------------------------------------------------------------------------
// Payload stubs (hand-built — same shapes the engine emits)
// ---------------------------------------------------------------------------

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

function stanceStub(signalState: SignalState, extra?: Partial<TechStance>): TechStance {
  return {
    version: "tech-signals@5",
    score: 60,
    signal: signalState === "watching" ? "buy" : signalState === "confirmed" ? "buy" : null,
    dimensions: [],
    reasons: [],
    styleFits: [],
    invalidation: null,
    tradePlan: null,
    limitations: [],
    signalState,
    setup: null,
    ...extra,
  }
}

/** The watching scenario: 17 warmup sessions rising with dips, then the
 *  future — three sessions below the 9.70 activation level, then the
 *  activation close 9.80 on 3× volume (index 20 = day 2026-01-24). */
function activationScenario(volumes?: (number | null)[]): LifecycleBar[] {
  const futureCloses = [9.6, 9.62, 9.65, 9.8]
  const futureVolumes = volumes ?? [1000, 1000, 1000, 3000]
  return closeBars([...risingWithDips(WARMUP), ...futureCloses], [
    ...Array(WARMUP).fill(1000),
    ...futureVolumes,
  ])
}

// ---------------------------------------------------------------------------
// Watching branch
// ---------------------------------------------------------------------------

describe("lifecycle — watching branch", () => {
  it("confirms when a daily close passes the level with the required volume, attaching the RECOMPUTED plan", () => {
    const setup = watchSetup()
    const view = computeLifecycle({
      signalState: "watching",
      setup,
      // pivots derived from the bars (the loader passes bar-derived structure
      // through to the activation-time rebuild)
      rebuildSupports: [{ price: 9.5 }],
      rebuildResistances: [{ price: 11.5 }],
      bars: activationScenario(),
      createdOn: dayIso(WARMUP - 1),
    })
    expect(view).not.toBeNull()
    expect(view!.basis).toBe("watching")
    expect(view!.state).toBe("confirmed")
    expect(view!.activation).toEqual({ date: dayIso(20), price: 9.8 })
    expect(view!.events).toHaveLength(1)
    expect(view!.events[0].type).toBe("activated")
    expect(view!.events[0].date).toBe(dayIso(20))
    expect(view!.events[0].price).toBe(9.8)
    expect(view!.events[0].noteAr).toContain("فوق مستوى التفعيل")
    // the recompute gate: the attached plan must be a real, RR-valid plan
    expect(view!.tradePlan).not.toBeNull()
    expect(view!.tradePlan!.bias).toBe("buy")
    expect(view!.tradePlan!.riskReward).toBeGreaterThanOrEqual(DEFAULT_LIFECYCLE_PARAMS.minRiskReward)
    expect(view!.evaluatedSessions).toBe(4)
    expect(view!.asOf).toBe(dayIso(20))
  })

  it("never auto-confirms on a weak recompute — expired with the rejection reason", () => {
    // strictly rising closes: no pivot lows survive → the rebuilt plan cannot
    // anchor (buildTradePlan returns null) → the setup dies, not confirms.
    const closes = [...Array(17)].map((_, i) => Math.round(9.5 * Math.pow(1.004, i) * 100) / 100)
    closes.push(10.2)
    const view = computeLifecycle({
      signalState: "watching",
      setup: watchSetup(),
      bars: closeBars(closes, [...Array(17).fill(1000), 3000]),
      createdOn: dayIso(16),
    })
    expect(view!.state).toBe("expired")
    expect(view!.reasonAr).toContain("أُلغيت بعد التفعيل")
    expect(view!.tradePlan).toBeNull()
    expect(view!.events.map((e) => e.type)).toEqual(["activated", "expired"])
    expect(view!.events[0].price).toBe(10.2)
    expect(view!.events[1].noteAr).toContain("لا تأكيد تلقائي")
  })

  it("invalidates on a pre-entry close beyond the invalidation level, with the event date", () => {
    const view = computeLifecycle({
      signalState: "watching",
      setup: watchSetup(),
      bars: closeBars([...risingWithDips(WARMUP), 8.9]),
      createdOn: dayIso(WARMUP - 1),
    })
    expect(view!.state).toBe("invalidated")
    expect(view!.events).toHaveLength(1)
    expect(view!.events[0].type).toBe("invalidated")
    expect(view!.events[0].date).toBe(dayIso(WARMUP))
    expect(view!.events[0].price).toBe(8.9)
    expect(view!.events[0].noteAr).toContain("تحت مستوى الإلغاء")
    expect(view!.tradePlan).toBeNull()
  })

  it("expires after maxWatchingSessions without activation/invalidation and freezes past it", () => {
    // 30 silent sessions + one 31st session that closes beyond the level on
    // 3× volume — AFTER expiry, so it must be ignored (terminal freeze).
    const future = Array(30).fill(9.9).concat([10.5])
    const volumes = Array(30).fill(1000).concat([3000])
    const bars = closeBars([...risingWithDips(WARMUP), ...future], [
      ...Array(WARMUP).fill(1000),
      ...volumes,
    ])
    const view = computeLifecycle({
      signalState: "watching",
      setup: watchSetup(),
      bars,
      createdOn: dayIso(WARMUP - 1),
    })
    expect(view!.state).toBe("expired")
    expect(view!.evaluatedSessions).toBe(30)
    expect(view!.asOf).toBe(dayIso(WARMUP + 29)) // frozen at the expiry bar…
    expect(view!.events).toHaveLength(1)
    expect(view!.events[0].type).toBe("expired")
    expect(view!.events[0].date).toBe(dayIso(WARMUP + 29))
    // …the 31st session closed 10.5 on 3× volume — AFTER expiry, ignored.
    expect(bars[WARMUP + 30].close).toBeGreaterThan(10.05)
  })

  it("keeps watching when the close passes the level but the volume condition is unmet", () => {
    const view = computeLifecycle({
      signalState: "watching",
      setup: watchSetup(),
      bars: activationScenario([1000, 1000, 1000, 1000]), // rel = 1.0 < 1.5
      createdOn: dayIso(WARMUP - 1),
    })
    expect(view!.state).toBe("watching")
    expect(view!.events).toHaveLength(0)
    expect(view!.tradePlan).toBeNull()
    expect(view!.evaluatedSessions).toBe(4)
  })

  it("treats unknown volume (thin history) as unmet — never as confirmation", () => {
    // only 5 usable volume sessions before the activation close (< 10 required)
    const warmupVolumes: (number | null)[] = Array(WARMUP).fill(null)
    warmupVolumes[12] = 1000
    warmupVolumes[13] = 1000
    warmupVolumes[14] = 1000
    warmupVolumes[15] = 1000
    warmupVolumes[16] = 1000
    const bars = closeBars([...risingWithDips(WARMUP), 10.2], [...warmupVolumes, 3000])
    const view = computeLifecycle({
      signalState: "watching",
      setup: watchSetup(),
      bars,
      createdOn: dayIso(WARMUP - 1),
    })
    expect(view!.state).toBe("watching")
    expect(view!.events).toHaveLength(0)
  })

  it("a sell setup can never confirm: the plan builder refuses to price a short on the EGX", () => {
    const setup = watchSetup({
      direction: "sell",
      activation: { kind: "close_below", level: 9.9, basisAr: "اختبار", volumeConditionAr: "حجم إغلاق ≥ 1.5× متوسط آخر 20 جلسة" },
      preEntryInvalidation: {
        level: 10.0,
        conditionAr: "إغلاق يومي فوق 10.00 يلغي الفرصة قبل الدخول.",
        reasonAr: "الاستعادة الهيكلية قبل التفعيل تلغي سيناريو الانهيار",
      },
    })
    const view = computeLifecycle({
      signalState: "watching",
      setup,
      rebuildSupports: [{ price: 8.4 }],
      rebuildResistances: [{ price: 10.5 }],
      bars: closeBars([...decliningWithBounces(WARMUP), 10.0, 9.95, 9.85], [
        ...Array(WARMUP).fill(1000),
        1000,
        1000,
        3000,
      ]),
      createdOn: dayIso(WARMUP - 1),
    })
    // 2026-11-15 owner report ("صفقات بيع كتير…"): the Egyptian Exchange has no
    // retail short-selling, so a sell read is never priced. With no rebuilt
    // plan the lifecycle cannot reach "confirmed" — it expires rather than
    // inventing levels nobody could execute.
    expect(view!.state).toBe("expired")
    expect(view!.tradePlan).toBeNull()
  })

  it("invalidates a sell setup when a close restores above the invalidation ceiling", () => {
    const setup = watchSetup({
      direction: "sell",
      activation: { kind: "close_below", level: 9.9, basisAr: "اختبار", volumeConditionAr: "حجم" },
      preEntryInvalidation: {
        level: 10.0,
        conditionAr: "إغلاق يومي فوق 10.00 يلغي الفرصة قبل الدخول.",
        reasonAr: "الاستعادة الهيكلية تلغي السيناريو",
      },
    })
    const view = computeLifecycle({
      signalState: "watching",
      setup,
      bars: closeBars([...decliningWithBounces(WARMUP), 10.4]),
      createdOn: dayIso(WARMUP - 1),
    })
    expect(view!.state).toBe("invalidated")
    expect(view!.events[0].noteAr).toContain("فوق مستوى الإلغاء")
  })

  it("returns null for wait rows and for a watching row without its setup", () => {
    expect(computeLifecycle({ signalState: "wait", bars: closeBars([10, 10]) })).toBeNull()
    expect(computeLifecycle({ signalState: "watching", bars: closeBars([10, 10]) })).toBeNull()
  })

  it("answers insufficient-data views for empty input without inventing a state", () => {
    const v = computeLifecycle({ signalState: "watching", setup: watchSetup(), bars: [], createdOn: "2026-01-20" })
    expect(v!.state).toBe("watching")
    expect(v!.reasonAr).toContain("بيانات غير كافية")
    expect(v!.events).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// Confirmed branch — entry + execution walk
// ---------------------------------------------------------------------------

describe("lifecycle — confirmed branch", () => {
  const setup = (extraBars: [number, number, number, number][], volumes?: (number | null)[]) =>
    candleBars([[9.8, 9.8, 9.8, 9.8], ...extraBars], volumes ? [1000, ...volumes] : undefined)

  it("activates on the first daily close inside the entry zone and stays active when data ends", () => {
    const view = computeLifecycle({
      signalState: "confirmed",
      tradePlan: planStub(),
      bars: setup([[9.7, 9.7, 9.7, 9.7], [9.75, 9.75, 9.75, 9.75], [10.1, 10.15, 10.05, 10.1]]),
      createdOn: dayIso(0),
    })
    expect(view!.basis).toBe("confirmed")
    expect(view!.state).toBe("active")
    expect(view!.entry).toEqual({ date: dayIso(3), price: 10.1 })
    expect(view!.events).toHaveLength(1)
    expect(view!.events[0].type).toBe("activated")
    expect(view!.exit).toBeNull()
    expect(view!.sessionsHeld).toBeNull()
  })

  it("stops on an intraday low touching the stop, filling at the stop", () => {
    const view = computeLifecycle({
      signalState: "confirmed",
      tradePlan: planStub(),
      bars: setup([
        [10.1, 10.1, 10.1, 10.1],
        [9.7, 9.8, 9.4, 9.45], // low 9.4 ≤ 9.5, open 9.7 > 9.5 → no gap
      ]),
      createdOn: dayIso(0),
    })
    expect(view!.state).toBe("stopped")
    expect(view!.entry!.price).toBe(10.1)
    expect(view!.exit).toEqual({ date: dayIso(2), price: 9.5, kind: "stopped" })
    expect(view!.sessionsHeld).toBe(2)
    expect(view!.events[1].type).toBe("stopped")
    expect(view!.events[1].noteAr).not.toContain("فجوة الافتتاح")
  })

  it("fills a gapped-through stop at the OPEN and discloses the gap", () => {
    const view = computeLifecycle({
      signalState: "confirmed",
      tradePlan: planStub(),
      bars: setup([
        [10.1, 10.1, 10.1, 10.1],
        [9.3, 9.4, 9.2, 9.25], // open 9.3 already below the 9.5 stop
      ]),
      createdOn: dayIso(0),
    })
    expect(view!.state).toBe("stopped")
    expect(view!.exit!.price).toBe(9.3) // the open, not the stop
    expect(view!.events[1].noteAr).toContain("تنفيذ على فجوة الافتتاح")
  })

  it("hits the target on an intraday high touching the target zone", () => {
    const view = computeLifecycle({
      signalState: "confirmed",
      tradePlan: planStub(),
      bars: setup([
        [10.1, 10.1, 10.1, 10.1],
        [10.2, 11.3, 10.15, 11.0], // high 11.3 ≥ 11.0, open 10.2 < 11.0 → no gap
      ]),
      createdOn: dayIso(0),
    })
    expect(view!.state).toBe("targeted")
    expect(view!.exit).toEqual({ date: dayIso(2), price: 11.0, kind: "targeted" })
    expect(view!.sessionsHeld).toBe(2)
    expect(view!.events[1].type).toBe("targeted")
    expect(view!.events[1].noteAr).not.toContain("فجوة الافتتاح")
  })

  it("fills a gapped-beyond-target fill at the OPEN (gap rule reversed) and discloses it", () => {
    const view = computeLifecycle({
      signalState: "confirmed",
      tradePlan: planStub(),
      bars: setup([
        [10.1, 10.1, 10.1, 10.1],
        [11.3, 11.5, 11.2, 11.4], // open 11.3 already beyond the 11.0 target
      ]),
      createdOn: dayIso(0),
    })
    expect(view!.state).toBe("targeted")
    expect(view!.exit!.price).toBe(11.3)
    expect(view!.events[1].noteAr).toContain("تنفيذ على فجوة الافتتاح")
  })

  it("applies STOP precedence when one session touches both the stop and the target", () => {
    const view = computeLifecycle({
      signalState: "confirmed",
      tradePlan: planStub(),
      bars: setup([
        [10.1, 10.1, 10.1, 10.1],
        [10.0, 11.2, 9.4, 10.6], // low 9.4 ≤ stop AND high 11.2 ≥ target
      ]),
      createdOn: dayIso(0),
    })
    expect(view!.state).toBe("stopped")
    expect(view!.events[1].type).toBe("stopped")
  })

  it("time-stops at the session CLOSE after maxHoldSessions held sessions (entry session inclusive)", () => {
    const hold = DEFAULT_LIFECYCLE_PARAMS.maxHoldSessions // 15
    const quiet: [number, number, number, number][] = [[10.1, 10.3, 10.0, 10.15]]
    for (let i = 1; i < hold; i++) quiet.push([10.15, 10.3, 10.0, 10.15])
    const view = computeLifecycle({
      signalState: "confirmed",
      tradePlan: planStub(),
      bars: setup(quiet),
      createdOn: dayIso(0),
    })
    expect(view!.state).toBe("expired")
    expect(view!.exit).toEqual({ date: dayIso(hold), price: 10.15, kind: "time_stopped" })
    expect(view!.sessionsHeld).toBe(hold)
    expect(view!.events[view!.events.length - 1].type).toBe("time_stopped")
    expect(view!.events[view!.events.length - 1].noteAr).toContain("وقف زمني")
    expect(view!.events[view!.events.length - 1].noteAr).toContain(`${hold}`)
  })

  it("can round-trip inside the entry session (same-session stop, disclosed)", () => {
    const view = computeLifecycle({
      signalState: "confirmed",
      tradePlan: planStub(),
      bars: setup([[10.1, 10.3, 9.4, 10.1]]), // entry close 10.1 but low 9.4 ≤ 9.5
      createdOn: dayIso(0),
    })
    expect(view!.state).toBe("stopped")
    expect(view!.sessionsHeld).toBe(1)
    expect(view!.events[1].noteAr).toContain("نفس جلسة الدخول")
  })

  it("expires a confirmed plan that never finds an entry close within the session window", () => {
    const below: [number, number, number, number][] = Array(30).fill([9.7, 9.7, 9.7, 9.7])
    const view = computeLifecycle({
      signalState: "confirmed",
      tradePlan: planStub(),
      bars: setup(below),
      createdOn: dayIso(0),
    })
    expect(view!.state).toBe("expired")
    expect(view!.entry).toBeNull()
    expect(view!.events).toHaveLength(1)
    expect(view!.events[0].type).toBe("expired")
    expect(view!.evaluatedSessions).toBe(30)
  })

  it("mirrors the sell plan: stop above (high touch), target below (low touch)", () => {
    const sell = planStub({
      bias: "sell",
      entryLow: 9.0,
      entryHigh: 9.2,
      stop: 9.6,
      targetLow: 8.5,
      targetHigh: 8.5,
    })
    const stopped = computeLifecycle({
      signalState: "confirmed",
      tradePlan: sell,
      bars: candleBars([
        [9.5, 9.5, 9.5, 9.5],
        [9.1, 9.1, 9.1, 9.1], // entry close 9.1 ∈ [9.0, 9.2]
        [9.2, 9.7, 9.15, 9.5], // high 9.7 ≥ 9.6, open 9.2 < 9.6 → no gap
      ]),
      createdOn: dayIso(0),
    })
    expect(stopped!.state).toBe("stopped")
    expect(stopped!.exit).toEqual({ date: dayIso(2), price: 9.6, kind: "stopped" })

    const targetedGap = computeLifecycle({
      signalState: "confirmed",
      tradePlan: sell,
      bars: candleBars([
        [9.5, 9.5, 9.5, 9.5],
        [9.1, 9.1, 9.1, 9.1],
        [8.3, 8.45, 8.2, 8.4], // open 8.3 already below the 8.5 target
      ]),
      createdOn: dayIso(0),
    })
    expect(targetedGap!.state).toBe("targeted")
    expect(targetedGap!.exit!.price).toBe(8.3)
    expect(targetedGap!.events[1].noteAr).toContain("تنفيذ على فجوة الافتتاح")
  })

  it("returns a degraded view for a confirmed row without a plan", () => {
    const view = computeLifecycle({
      signalState: "confirmed",
      bars: closeBars([10, 10.1]),
      createdOn: dayIso(0),
    })
    expect(view!.state).toBe("confirmed")
    expect(view!.reasonAr).toContain("بدون خطة تداول")
    expect(view!.events).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// Determinism + helpers
// ---------------------------------------------------------------------------

describe("lifecycle — determinism and shared helpers", () => {
  it("is fully deterministic: identical inputs produce deep-equal views", () => {
    const run = () =>
      computeLifecycle({
        signalState: "watching",
        setup: watchSetup(),
        bars: activationScenario(),
        createdOn: dayIso(WARMUP - 1),
      })
    const a: LifecycleView | null = run()
    const b: LifecycleView | null = run()
    expect(a).toEqual(b)
    expect(a).not.toBe(b)
  })

  it("sorts defensively — a shuffled bar array yields the same walk", () => {
    const bars = activationScenario()
    const shuffled = [...bars].reverse()
    const a = computeLifecycle({ signalState: "watching", setup: watchSetup(), bars, createdOn: dayIso(WARMUP - 1) })
    const b = computeLifecycle({ signalState: "watching", setup: watchSetup(), bars: shuffled, createdOn: dayIso(WARMUP - 1) })
    expect(a).toEqual(b)
  })

  it("gateLifecycleForFree strips everything except the two states", () => {
    const view = computeLifecycle({
      signalState: "watching",
      setup: watchSetup(),
      rebuildSupports: [{ price: 9.5 }],
      rebuildResistances: [{ price: 11.5 }],
      bars: activationScenario(),
      createdOn: dayIso(WARMUP - 1),
    })!
    const pub = gateLifecycleForFree(view)
    expect(Object.keys(pub).sort()).toEqual(["lifecycleState", "signalState"])
    expect(pub).toEqual({ signalState: "watching", lifecycleState: "confirmed" })
  })

  it("insufficientLifecycleView echoes the publication state and flags the reason", () => {
    const v = insufficientLifecycleView("confirmed", "confirmed", "2026-01-20")
    expect(v.basis).toBe("confirmed")
    expect(v.state).toBe("confirmed")
    expect(v.reasonAr).toContain("بيانات غير كافية")
    expect(v.events).toHaveLength(0)
  })

  it("labels chips honestly per basis and state (Arabic + English)", () => {
    expect(lifecycleChipLabel("watching", "watching", true)).toBe("لم تتفعل بعد")
    expect(lifecycleChipLabel("watching", "invalidated", true)).toBe("أُلغيت")
    expect(lifecycleChipLabel("watching", "expired", true)).toBe("انتهت")
    expect(lifecycleChipLabel("confirmed", "active", true)).toBe("نشطة")
    expect(lifecycleChipLabel("confirmed", "stopped", true)).toBe("ستوب")
    expect(lifecycleChipLabel("confirmed", "targeted", true)).toBe("هدف")
    expect(lifecycleChipLabel("confirmed", "expired", true)).toBe("انتهت زمنيًا")
    expect(lifecycleChipLabel("confirmed", "confirmed", true)).toBe("بانتظار الدخول")
    // watching→confirmed: "تفعّلت اليوم" ONLY when the activation landed on
    // the last evaluated session; otherwise the honest "تفعّلت".
    expect(lifecycleChipLabel("watching", "confirmed", true, "2026-01-24", "2026-01-24")).toBe("تفعّلت اليوم")
    expect(lifecycleChipLabel("watching", "confirmed", true, "2026-01-23", "2026-01-24")).toBe("تفعّلت")
    expect(lifecycleChipLabel("watching", "confirmed", true)).toBe("تفعّلت")
    expect(lifecycleChipLabel("watching", "confirmed", false)).toBe("Activated")
    expect(lifecycleChipLabel("confirmed", "stopped", false)).toBe("Stopped")
  })
})

// ---------------------------------------------------------------------------
// Service seam — injected deps, no database
// ---------------------------------------------------------------------------

describe("lifecycle-service — injected seam", () => {
  const CREATED = dayIso(WARMUP - 1) // 2026-01-20

  function depsWith(stance: TechStance | null, bars: LifecycleBar[], createdIso: string = CREATED): LifecycleDeps {
    return {
      loadStance: async () => (stance ? { stance, dataAsOf: new Date(`${createdIso}T00:00:00Z`) } : null),
      loadBars: async () => bars,
    }
  }

  it("assembles the view from the injected stance + bars", async () => {
    const stance = stanceStub("watching", { setup: watchSetup() })
    const res = await getCompanyLifecycle("comp-1", {
      deps: depsWith(stance, activationScenario()),
      ticker: "TEST",
      rebuildSupports: [{ price: 9.5 }],
      rebuildResistances: [{ price: 11.5 }],
    })
    expect(res).not.toBeNull()
    expect(res!.companyId).toBe("comp-1")
    expect(res!.ticker).toBe("TEST")
    expect(res!.signalState).toBe("watching")
    expect(res!.lifecycle.state).toBe("confirmed")
    expect(res!.lifecycle.tradePlan).not.toBeNull()
  })

  it("returns null when the stance is missing", async () => {
    expect(await getCompanyLifecycle("comp-1", { deps: depsWith(null, activationScenario()) })).toBeNull()
  })

  it("returns null for wait rows, watching-without-setup and confirmed-without-plan", async () => {
    const bars = activationScenario()
    expect(await getCompanyLifecycle("c", { deps: depsWith(stanceStub("wait"), bars) })).toBeNull()
    expect(await getCompanyLifecycle("c", { deps: depsWith(stanceStub("watching"), bars) })).toBeNull()
    expect(await getCompanyLifecycle("c", { deps: depsWith(stanceStub("confirmed"), bars) })).toBeNull()
  })

  it("short-circuits below the warmup with 'بيانات غير كافية' (never invents a transition)", async () => {
    const stance = stanceStub("watching", { setup: watchSetup() })
    const res = await getCompanyLifecycle("comp-1", {
      deps: depsWith(stance, activationScenario().slice(0, LIFECYCLE_WARMUP_SESSIONS - 1)),
    })
    expect(res).not.toBeNull()
    expect(res!.lifecycle.state).toBe("watching")
    expect(res!.lifecycle.reasonAr).toContain("بيانات غير كافية")
    expect(res!.lifecycle.events).toHaveLength(0)
  })

  it("traces a full confirmed lifecycle through the seam", async () => {
    const plan = planStub()
    const stance = stanceStub("confirmed", { tradePlan: plan })
    // 20 warmup sessions + entry session + gap-stop session (≥ warmup 21)
    const warm: [number, number, number, number][] = Array(20).fill([9.8, 9.8, 9.8, 9.8])
    const bars = candleBars([...warm, [10.1, 10.1, 10.1, 10.1], [9.3, 9.4, 9.2, 9.25]])
    const res = await getCompanyLifecycle("comp-1", { deps: depsWith(stance, bars, dayIso(19)) })
    expect(res).not.toBeNull()
    expect(res!.lifecycle.state).toBe("stopped")
    expect(res!.lifecycle.entry).toEqual({ date: dayIso(20), price: 10.1 })
    expect(res!.lifecycle.exit!.price).toBe(9.3)
    expect(res!.lifecycle.events[1].noteAr).toContain("فجوة الافتتاح")
  })
})
