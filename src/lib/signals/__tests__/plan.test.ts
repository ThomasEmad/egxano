// =============================================================================
// Signals engine v2 (tech-signals@6) — the plan-math contract tests.
// These encode the OWNER bug classes as invariants: a target below the live
// price (VLMRA), a stop above the entry, an RR that doesn't match its own
// numbers, and provisional levels anchored on dead geometry (AMES).
// =============================================================================

import { describe, expect, it } from "vitest"
import { buildBuyPlan, buildNearSetup, roundToTick } from "../plan"
import { buildZoneMap } from "../levels"
import { computeMetrics } from "../metrics"
import type { Bar } from "../types"

function bar(ts: string, open: number, high: number, low: number, close: number, volume: number | null = 1000): Bar {
  return { ts, open, high, low, close, volume }
}

/** A rising series with volume 1000 — enough sessions for every indicator. */
function rising(n: number, from = 50, step = 0.3): Bar[] {
  const out: Bar[] = []
  let p = from
  for (let i = 0; i < n; i++) {
    const c = p + step
    out.push(bar(`2026-01-${String((i % 28) + 1).padStart(2, "0")}-${String(i).padStart(3, "0")}`, p, Math.max(p, c) + 0.2, Math.min(p, c) - 0.2, c))
    p = c
  }
  return out
}

describe("roundToTick", () => {
  it("rounds high prices to 0.05 and others to 0.01", () => {
    expect(roundToTick(123.456)).toBe(123.45)
    expect(roundToTick(23.456)).toBe(23.46)
    expect(roundToTick(5.456)).toBe(5.46)
  })
})

describe("buildBuyPlan — the math contract", () => {
  it("produces stop < entryLow ≤ entryHigh < target1 ≤ target2 with exact RR", () => {
    const bars = rising(120)
    const m = computeMetrics(bars)!
    const map = buildZoneMap(bars)
    const anchor = m.lastClose
    const plan = buildBuyPlan({ anchor, map, m, level: 0, strength: 0.5 })
    expect(plan).not.toBeNull()
    const p = plan!
    expect(p.stop).toBeLessThan(p.entryLow)
    expect(p.entryLow).toBeLessThanOrEqual(p.entryHigh)
    expect(p.target1).toBeGreaterThan(p.entryHigh)
    expect(p.target1).toBeGreaterThan(anchor) // THE VLMRA INVARIANT
    if (p.target2 !== null) expect(p.target2).toBeGreaterThan(p.target1)
    const entryMid = (p.entryLow + p.entryHigh) / 2
    const rr = (p.target1 - entryMid) / (entryMid - p.stop)
    expect(p.riskReward).toBeCloseTo(rr, 2)
    expect(p.riskReward).toBeGreaterThanOrEqual(1.2)
  })

  it("returns null rather than publishing an RR below 1.2 (no invented levels)", () => {
    const bars = rising(120)
    const m = computeMetrics(bars)!
    // a huge ATR makes the structural stop so wide that no honest T1 clears 1.2
    const map = buildZoneMap(bars)
    const inflated = { ...m, atr14: (m.atr14 ?? 1) * 25 }
    const plan = buildBuyPlan({ anchor: m.lastClose, map, m: inflated, level: 0, strength: 0 })
    // either null or a still-valid plan — never a bad one
    if (plan) {
      expect(plan.riskReward).toBeGreaterThanOrEqual(1.2)
      expect(plan.target1).toBeGreaterThan(m.lastClose)
    }
  })

  it("never places the stop at or above the entry", () => {
    for (const level of [0, 5, 50]) {
      const bars = rising(120)
      const m = computeMetrics(bars)!
      const plan = buildBuyPlan({ anchor: m.lastClose, map: buildZoneMap(bars), m, level, strength: 0.5 })
      if (plan) expect(plan.stop).toBeLessThan(plan.entryLow)
    }
  })
})

describe("buildNearSetup — provisional geometry", () => {
  it("builds the provisional plan AT the activation price and reports the gap", () => {
    const bars = rising(120)
    const m = computeMetrics(bars)!
    const map = buildZoneMap(bars)
    const activation = m.lastClose * 1.03 // 3% above — a pending breakout trigger
    const setup = buildNearSetup({
      anchor: m.lastClose,
      activation,
      activationAr: "شرط التفعيل: إغلاق فوق المستوى",
      map,
      m,
      strength: 0.5,
      preEntryInvalidationAr: "إلغاء قبل الدخول",
    })
    expect(setup).not.toBeNull()
    const s = setup!
    expect(s.activation).toBeCloseTo(activation, 2)
    expect(s.activationGapPct).toBeCloseTo(3, 1)
    expect(s.provisional.stop).toBeLessThan(s.provisional.entryLow)
    expect(s.provisional.target1).toBeGreaterThan(activation)
    expect(s.provisional.riskReward).toBeGreaterThanOrEqual(1.2)
    expect(s.preEntryInvalidationAr.length).toBeGreaterThan(0)
  })

  it("drops the setup when the provisional geometry fails at activation (dead levels never published)", () => {
    const bars = rising(120)
    const m = computeMetrics(bars)!
    const map = buildZoneMap(bars)
    // an activation so far that even a measured ATR target cannot clear RR 1.2
    const inflated = { ...m, atr14: (m.atr14 ?? 1) * 20 }
    const setup = buildNearSetup({
      anchor: m.lastClose,
      activation: m.lastClose * 1.07,
      activationAr: "شرط بعيد",
      map,
      m: inflated,
      strength: 0.5,
      preEntryInvalidationAr: "إلغاء",
    })
    if (setup) {
      expect(setup.provisional.riskReward).toBeGreaterThanOrEqual(1.2)
      expect(setup.provisional.target1).toBeGreaterThan(setup.activation)
    }
  })
})
