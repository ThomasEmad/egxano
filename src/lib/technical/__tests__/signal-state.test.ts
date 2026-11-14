// Three-state publication layer tests (tech-signals@5 fix J — 2026-11-14).
//
// THE INVARIANT UNDER TEST: a published directional read is never "naked" —
// every buy/sell row carries EITHER a tradable trade plan (confirmed) OR a
// watching setup (blocked candidate / untradable read). The state layer is
// additive: signal/score/dims/reasons keep their pinned semantics (covered by
// signals.test.ts + engine-v2.test.ts, both still green).
//
// All series are deterministic and hand-shaped, so every expected state is
// derivable by construction, not by re-running the engine.
import { describe, expect, it } from "vitest"
import {
  computeCloseSignal,
  computeStanceFromSnapshot,
  SIGNALS_VERSION_V1_BASELINE,
  type CloseRow,
  type SignalState,
  type TechStance,
  type WatchingSetup,
} from "../signals"
import { assembleBundle, type TechnicalSnapshot } from "../analyze"
import type { Bar } from "../indicators"

function rowsFrom(closes: number[], volumes: number[] | null = null): CloseRow[] {
  const out: CloseRow[] = []
  const start = new Date("2025-06-02T00:00:00Z").getTime()
  for (let i = 0; i < closes.length; i++) {
    const day = new Date(start + i * 86_400_000).toISOString().slice(0, 10)
    out.push({ ts: day, close: closes[i], volume: volumes ? volumes[i] : 1000 + (i % 5) * 50 })
  }
  return out
}

function healthyUptrend(n = 80): number[] {
  const out: number[] = []
  let p = 50
  for (let i = 0; i < n; i++) {
    if (i <= 45) p *= i % 2 === 0 ? 1.006 : 0.9975
    else if (i <= 70) p *= i % 2 === 0 ? 0.996 : 1.00125
    else p *= 1.003
    out.push(Math.round(p * 100) / 100)
  }
  return out
}

function uptrendCloses(n = 80): number[] {
  const out: number[] = []
  let p = 50
  for (let i = 0; i < n; i++) { p *= i % 3 === 2 ? 0.992 : 1.01; out.push(Math.round(p * 100) / 100) }
  return out
}

function downtrendCloses(n = 80): number[] {
  const out: number[] = []
  let p = 78
  for (let i = 0; i < 6; i++) { out.push(Math.round(p * 100) / 100); p *= 1.005 }
  out.push(82)
  p = 80.5
  for (let i = 7; i < n; i++) { p *= 0.995; out.push(Math.round(p * 100) / 100) }
  return out
}

function flatTape(n = 80): number[] {
  const out: number[] = []
  let p = 100
  for (let i = 0; i < n; i++) { p *= i % 2 === 0 ? 1.008 : 0.992; out.push(Math.round(p * 100) / 100) }
  return out
}

/**
 * Double-top resistance: rally to a 105 range high, decline, a two-touch
 * consolidation ~100 (the cluster the veto consumes), then a mostly-rising
 * recovery that stalls just under the cluster. Tuned so EVERY @5 buy gate
 * passes (trend 24/30, momentum 24/30, volume 16/20, risk 20/20 — decision
 * excellence holds) while the multi-touch cluster sits within the 2% veto
 * band above the close: the raw decision is therefore a vetoed buy → hold
 * with near_resistance_veto → published as a WATCHED setup whose activation
 * is the veto structure itself.
 */
function doubleTopVeto(): number[] {
  const out: number[] = []
  const push = (v: number) => out.push(Math.round(v * 100) / 100)
  let v = 90
  for (let i = 0; i < 25; i++) { v += (105 - v) * 0.12 * (i % 2 === 0 ? 1.2 : 0.8); push(v) }
  for (let i = 0; i < 12; i++) { v += (96.5 - v) * 0.3; push(v) }
  for (let i = 0; i < 6; i++) { v += (100.2 - v) * 0.35; push(v) }
  for (let i = 0; i < 6; i++) { v += (97.8 - v) * 0.3; push(v) }
  for (let i = 0; i < 6; i++) { v += (100.0 - v) * 0.35; push(v) }
  for (let i = 0; i < 6; i++) { v += (97.5 - v) * 0.3; push(v) }
  for (let i = 0; i < 14; i++) { v *= i % 3 === 2 ? 0.999 : 1.0018; push(v) }
  return out
}

function upDownVolumes(closes: number[], up = 1400, down = 800): number[] {
  return closes.map((c, i) => (i > 0 && c >= closes[i - 1] ? up : down))
}

// ---------------------------------------------------------------------------
// The contract checker — every @5 stance from ANY path must satisfy it.
// ---------------------------------------------------------------------------

function checkStanceContract(s: TechStance, label: string): void {
  // state is always emitted on @5 paths and always one of the three values
  expect(s.signalState, `${label}: signalState emitted`).toBeDefined()
  expect(["confirmed", "watching", "wait"], `${label}: state value`).toContain(s.signalState as SignalState)

  if (s.signal === "buy" || s.signal === "sell") {
    // THE no-naked-read invariant
    const hasPlan = s.tradePlan !== null
    const hasSetup = s.signalState === "watching" && s.setup !== null
    expect(hasPlan || hasSetup, `${label}: buy/sell without plan nor setup`).toBe(true)
  }

  if (s.signalState === "confirmed") {
    expect(s.tradePlan, `${label}: confirmed requires a tradable plan`).not.toBeNull()
    expect(s.tradePlan!.riskReward).toBeGreaterThanOrEqual(1.5)
    expect(s.setup ?? null, `${label}: confirmed carries no setup`).toBeNull()
  }

  if (s.signalState === "watching") {
    const setup = s.setup as WatchingSetup | null
    expect(setup, `${label}: watching requires a setup`).not.toBeNull()
    expect(["buy", "sell"]).toContain(setup!.direction)
    expect(["close_above", "close_below"]).toContain(setup!.activation.kind)
    expect(Number.isFinite(setup!.activation.level)).toBe(true)
    expect(setup!.activation.level).toBeGreaterThan(0)
    expect(setup!.activation.volumeConditionAr.length).toBeGreaterThan(0)
    expect(setup!.activation.basisAr.length).toBeGreaterThan(0)
    expect(setup!.recomputeNoteAr).toContain("تُعاد الحسابات")
    expect(setup!.preEntryInvalidation.conditionAr).toMatch(/يلغي الفرصة/)
    expect(setup!.preEntryInvalidation.reasonAr.length).toBeGreaterThan(0)
    expect(setup!.vetoReasons.length, `${label}: watching states its blockers`).toBeGreaterThanOrEqual(1)
    // activation direction sanity: a buy activates above, a sell below
    if (setup!.direction === "buy") expect(setup!.activation.kind).toBe("close_above")
    else expect(setup!.activation.kind).toBe("close_below")
  }

  if (s.signalState === "wait") {
    expect(s.setup ?? null, `${label}: wait carries no setup`).toBeNull()
    expect(s.signal === "buy" || s.signal === "sell", `${label}: wait must not carry a directional read`).toBe(false)
  }
}

describe("three-state publication — the no-naked-read invariant (fix J)", () => {
  const closeSeries: [string, CloseRow[]][] = [
    ["hot uptrend / default vol", rowsFrom(uptrendCloses(80))],
    ["hot uptrend / rising vol", rowsFrom(uptrendCloses(80), uptrendCloses(80).map((_, i) => 1000 + i * 5))],
    ["healthy uptrend / confirmed vol", rowsFrom(healthyUptrend(80), upDownVolumes(healthyUptrend(80), 1300, 900))],
    ["healthy uptrend / thin up vol", rowsFrom(healthyUptrend(80), upDownVolumes(healthyUptrend(80), 400, 4000))],
    ["healthy uptrend / no vol", rowsFrom(healthyUptrend(80)).map((r) => ({ ...r, volume: null }))],
    ["healthy uptrend / zero vol", rowsFrom(healthyUptrend(80)).map((r) => ({ ...r, volume: 0 }))],
    ["downtrend", rowsFrom(downtrendCloses(80), downtrendCloses(80).map((_, i) => 1200 - i * 5))],
    ["flat tape", rowsFrom(flatTape(80))],
    ["monotonic rise", rowsFrom((() => { const o: number[] = []; let p = 50; for (let i = 0; i < 80; i++) { p *= 1.005; o.push(Math.round(p * 100) / 100) } return o })())],
    ["monotonic fall", rowsFrom((() => { const o: number[] = []; let p = 100; for (let i = 0; i < 80; i++) { p *= 0.995; o.push(Math.round(p * 100) / 100) } return o })())],
    ["double-top veto tape", rowsFrom(doubleTopVeto(), upDownVolumes(doubleTopVeto()))],
    ["40-session uptrend", rowsFrom(uptrendCloses(40))],
    ["21-session uptrend", rowsFrom(uptrendCloses(21))],
    ["120-session healthy uptrend", rowsFrom(healthyUptrend(120), upDownVolumes(healthyUptrend(120), 1300, 900))],
  ]

  it("every close-engine stance satisfies the contract (deterministic sweep)", () => {
    for (const [label, rows] of closeSeries) {
      checkStanceContract(computeCloseSignal(rows), `close engine / ${label}`)
    }
  })

  it("insufficient history → wait, never a stateful fake", () => {
    for (const n of [0, 5, 10, 14]) {
      const sig = computeCloseSignal(rowsFrom(uptrendCloses(Math.max(n, 1))))
      expect(sig.signal).toBeNull()
      expect(sig.signalState).toBe("wait")
      expect(sig.setup ?? null).toBeNull()
    }
  })

  it("the trail path (snapshot engine) satisfies the same contract", () => {
    const bundleBars = (closes: number[]): Bar[] =>
      closes.map((c, i) => ({
        ts: new Date(new Date("2025-06-02T00:00:00Z").getTime() + i * 86_400_000).toISOString().slice(0, 10),
        open: c * 0.995,
        high: c * 1.01,
        low: c * 0.985,
        close: c,
        volume: 1000 + (i % 7) * 80,
      }))
    for (const [label, closes] of [
      ["hot uptrend", uptrendCloses(80)],
      ["healthy uptrend", healthyUptrend(80)],
      ["downtrend", downtrendCloses(80)],
      ["flat tape", flatTape(80)],
      ["double-top veto", doubleTopVeto()],
    ] as [string, number[]][]) {
      const bundle = assembleBundle(bundleBars(closes))
      checkStanceContract(computeStanceFromSnapshot(bundle.snapshot), `trail path / ${label}`)
    }
  })
})

describe("the flagship case — vetoed buy publishes a watched setup, not a naked read", () => {
  const closes = doubleTopVeto()
  const sig = computeCloseSignal(rowsFrom(closes, upDownVolumes(closes)))

  it("the raw decision is a vetoed buy → hold with near_resistance_veto", () => {
    expect(sig.signal).toBe("hold")
    expect(sig.reasons.map((r) => r.code)).toContain("near_resistance_veto")
    expect(sig.signalState).toBe("watching")
  })

  it("the setup activation is the veto structure itself (close-based)", () => {
    const setup = sig.setup!
    expect(setup.direction).toBe("buy")
    expect(setup.activation.kind).toBe("close_above")
    // the tested-resistance cluster the veto consumed, tick-rounded
    expect(setup.activation.level).toBe(99.89)
    expect(setup.activation.basisAr).toContain("المقاومة المُختبرة")
    expect(setup.activation.basisAr).toContain("2 اختبارات")
    expect(setup.activation.volumeConditionAr).toContain("1.5×")
    // DAILY-CLOSE based: never an intraday touch (the condition text says إغلاق)
    expect(setup.recomputeNoteAr).toContain("بإغلاق يومي")
  })

  it("provisional levels come from the trade-plan builder evaluated AT the activation level", () => {
    const setup = sig.setup!
    expect(setup.provisionalEntry).not.toBeNull()
    expect(setup.provisionalStop).not.toBeNull()
    expect(setup.provisionalTarget).not.toBeNull()
    // the plan builder validated RR ≥ 1.5 at the activation anchor
    expect(setup.provisionalRiskReward).toBeGreaterThanOrEqual(1.5)
    expect(setup.provisionalBasisAr).toContain("مُنشئ الخطط")
    // each level carries its own basis
    expect(setup.provisionalEntry!.basisAr.length).toBeGreaterThan(0)
    expect(setup.provisionalStop!.basisAr.length).toBeGreaterThan(0)
    expect(setup.provisionalTarget!.basisAr.length).toBeGreaterThan(0)
    // geometry sanity at the activation anchor
    expect(setup.provisionalStop!.level).toBeLessThan(setup.provisionalEntry!.low)
    expect(setup.provisionalTarget!.low).toBeGreaterThan(setup.provisionalEntry!.high)
  })

  it("pre-entry invalidation is a SEPARATE object from the post-entry stop", () => {
    const setup = sig.setup!
    expect(setup.preEntryInvalidation.level).not.toBe(setup.provisionalStop!.level)
    expect(setup.preEntryInvalidation.conditionAr).toContain("قبل الدخول")
    // the prose note states the post-entry exit follows the stop, not the invalidation
    expect(setup.postEntryNoteAr).toContain("وقف الخسارة")
    expect(setup.postEntryNoteAr).toContain("وليس شرط الإلغاء")
    // the invalidation floor sits below the current close (kills the setup first)
    expect(setup.preEntryInvalidation.level).toBeLessThan(sig.lastClose!)
  })

  it("vetoReasons are the exact rejection objects that raised the block", () => {
    const setup = sig.setup!
    expect(setup.vetoReasons[0].code).toBe("near_resistance_veto")
    expect(setup.vetoReasons[0].ar).toContain("ملاصق لمقاومة")
  })

  it("deterministic: identical input → byte-identical setup", () => {
    const again = computeCloseSignal(rowsFrom(closes, upDownVolumes(closes)))
    expect(JSON.stringify(again.setup)).toBe(JSON.stringify(sig.setup))
    expect(again.signalState).toBe(sig.signalState)
  })
})

describe("watching variants on the snapshot fallback path", () => {
  const empty = assembleBundle([]).snapshot

  function snapWith(over: Partial<TechnicalSnapshot>): TechnicalSnapshot {
    return {
      ...empty,
      available: true,
      sessions: 250,
      lastClose: 110,
      perf: { ...empty.perf, d1: 1.5 },
      trend: { ema20: 107, ema50: 100, ema200: 90, priceVsEma20: "above", priceVsEma50: "above", priceVsEma200: "above", ema20VsEma50: "above", ema50VsEma200: "above", alignment: "aligned_uptrend", cross50200: "golden", cross50200Age: 30 },
      momentum: { rsi14: 55, macd: { macd: 2, signal: 1, histogram: 1 }, stochastic: { k: 60, d: 40 } },
      volume: { obv: 1, obvSlope20: 500, volMa20: 1000, relVol: 2.5, volumeWindow: 20 },
      volatility: { atr14: 2.7, atrPct: 2.5, bollinger: { upper: null, middle: null, lower: null, widthPct: null, percentB: null }, histVol20: null },
      levels: { supports: [], resistances: [] },
      ...over,
    }
  }

  it("structural veto on the fallback path → activation = the tested-resistance price", () => {
    const stance = computeStanceFromSnapshot(
      snapWith({
        levels: { supports: [{ price: 104, touches: 2, distPct: -5.5 }], resistances: [{ price: 111.65, touches: 2, distPct: 1.5 }] },
        range60: { high: 112, low: 105, posPct: 71.4, sessions: 60 },
      }),
    )
    expect(stance.signal).toBe("hold")
    expect(stance.signalState).toBe("watching")
    const setup = stance.setup!
    expect(setup.direction).toBe("buy")
    expect(setup.activation.kind).toBe("close_above")
    expect(setup.activation.level).toBe(111.65) // the veto zone price, tick-rounded
    expect(setup.activation.basisAr).toContain("المقاومة المُختبرة")
    expect(setup.vetoReasons[0].code).toBe("near_resistance_veto")
    // plan builder cannot anchor a target (no resistance above the cluster,
    // no zones, no closes for a measured move) → structure fallback fills
    // the stop from the pivot support and leaves the target honestly null
    expect(setup.provisionalStop).not.toBeNull()
    expect(setup.provisionalStop!.level).toBe(104)
    expect(setup.provisionalTarget).toBeNull()
    expect(setup.provisionalRiskReward).toBeNull()
    expect(setup.recomputeNoteAr).toContain("تُعاد الحسابات")
    checkStanceContract(stance, "fallback veto buy")
  })

  it("a strong buy with NO anchorable plan is watching (no_tradable_plan), never naked", () => {
    const stance = computeStanceFromSnapshot(snapWith({}))
    expect(stance.signal).toBe("buy")
    expect(stance.tradePlan).toBeNull()
    expect(stance.signalState).toBe("watching")
    expect(stance.setup!.direction).toBe("buy")
    expect(stance.setup!.vetoReasons.map((r) => r.code)).toContain("no_tradable_plan")
    checkStanceContract(stance, "fallback strong buy no plan")
  })

  it("confirmed path: a tradable plan confirms the read", () => {
    const stance = computeStanceFromSnapshot(
      snapWith({
        levels: {
          supports: [{ price: 100, touches: 3, distPct: -9.1 }],
          resistances: [{ price: 125, touches: 2, distPct: 13.6 }],
        },
        zones: { version: "zones@2", available: true, zones: [], limitations: [] },
      }),
    )
    checkStanceContract(stance, "fallback confirmed")
    if (stance.signal === "buy" && stance.tradePlan !== null) {
      expect(stance.signalState).toBe("confirmed")
      expect(stance.setup ?? null).toBeNull()
    }
  })

  it("no-trend and unavailable snapshots → wait", () => {
    const noTrend = computeStanceFromSnapshot(
      snapWith({
        sessions: 19,
        trend: { ema20: null, ema50: null, ema200: null, priceVsEma20: null, priceVsEma50: null, priceVsEma200: null, ema20VsEma50: null, ema50VsEma200: null, alignment: null, cross50200: null, cross50200Age: null },
      }),
    )
    expect(noTrend.signal).toBeNull()
    expect(noTrend.signalState).toBe("wait")
    expect(noTrend.setup ?? null).toBeNull()
    const unavailable = computeStanceFromSnapshot(assembleBundle([]).snapshot)
    expect(unavailable.signal).toBeNull()
    expect(unavailable.signalState).toBe("wait")
    expect(unavailable.setup ?? null).toBeNull()
  })
})

describe("frozen v1 baseline stays untouched", () => {
  it("the @4 A/B baseline does not emit the state layer (byte-comparable replay)", () => {
    const v1 = computeCloseSignal(rowsFrom(uptrendCloses(80)), { engineVersion: SIGNALS_VERSION_V1_BASELINE })
    expect(v1.version).toBe("tech-signals@4")
    expect(v1.signalState).toBeUndefined()
    expect("setup" in v1 ? v1.setup : undefined).toBeUndefined()
  })
})
