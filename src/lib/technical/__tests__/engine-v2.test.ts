// tech-signals@5 contract tests — the evidence-based recalibration pins.
// Covers: decision gates (volume agreement, decision-level excellence),
// structure veto (resistance/support + breakout/breakdown confirmation),
// de-duplication (oscillator corroboration cap), hysteresis (enter/exit bands,
// minimum state hold, score glide), version bump, zones version, style honesty.
import { describe, expect, it } from "vitest"
import {
  applyHysteresis,
  computeCloseSignal,
  decideSignal,
  SIGNALS_VERSION,
  SIGNALS_VERSION_V1_BASELINE,
  type CloseRow,
  type TrailRead,
} from "../signals"
import { ZONES_VERSION } from "../zones"
import { TECHNICAL_VERSION } from "../analyze"
import { buildTradePlan } from "../trade-plan"

function rowsFrom(closes: number[], volumes: number[] | null = null): CloseRow[] {
  const out: CloseRow[] = []
  const start = new Date("2025-06-02T00:00:00Z").getTime()
  for (let i = 0; i < closes.length; i++) {
    out.push({ ts: new Date(start + i * 86_400_000).toISOString().slice(0, 10), close: closes[i], volume: volumes ? volumes[i] : 1000 })
  }
  return out
}

function healthyUptrend(n = 80): number[] {
  const out: number[] = []
  let p = 50
  for (let i = 0; i < n; i++) { p *= i % 2 === 0 ? 1.005 : 0.996; out.push(Math.round(p * 100) / 100) }
  return out
}

function uptrendCloses(n = 80): number[] {
  const out: number[] = []
  let p = 50
  for (let i = 0; i < n; i++) { p *= i % 3 === 2 ? 0.992 : 1.01; out.push(Math.round(p * 100) / 100) }
  return out
}

const read = (over: Partial<TrailRead>): TrailRead => ({
  ts: over.ts ?? "d",
  signal: over.signal ?? "hold",
  score: over.score ?? 50,
  changePct: over.changePct ?? 0.5,
  structural: over.structural ?? false,
  dims: over.dims ?? [],
  facts: null,
})

describe("versioning (I)", () => {
  it("SIGNALS_VERSION bumped and visible in the output", () => {
    expect(SIGNALS_VERSION).toBe("tech-signals@5")
    expect(TECHNICAL_VERSION).toBe("technical@5")
    expect(ZONES_VERSION).toBe("zones@2")
    const sig = computeCloseSignal(rowsFrom(uptrendCloses(40)))
    expect(sig.version).toBe("tech-signals@5")
  })

  it("v1 baseline stays callable for A/B backtesting on identical bars", () => {
    const rows = rowsFrom(uptrendCloses(80))
    const v1 = computeCloseSignal(rows, { engineVersion: SIGNALS_VERSION_V1_BASELINE })
    expect(v1.version).toBe("tech-signals@4")
    expect(v1.signal).not.toBeNull()
    // v1 keeps the old methodology: no gates, mechanical plan, day style
    const v2 = computeCloseSignal(rows)
    expect(v2.version).toBe("tech-signals@5")
  })
})

describe("decision gates (A) — shared decideSignal contract", () => {
  const buyFacts = {
    finalScore: 75,
    trendShare: 0.9,
    rsi: 55,
    macdLine: 1.2,
    macdHist: 0.4,
    relVol: 1.2,
    obvSlope: 5000,
    allDimsStrong: true,
    lowerHighs: false,
    belowLongMa: false,
    close: 100,
    prevClose: 99,
    resistanceZone: null,
    supportZone: null,
  }

  it("full-strength confirmed tape → buy", () => {
    const { signal } = decideSignal(buyFacts)
    expect(signal).toBe("buy")
  })

  it("volume gate: relVol < 1 AND OBV not agreeing → hold with the gate flagged", () => {
    const { signal, gates } = decideSignal({ ...buyFacts, relVol: 0.4, obvSlope: -100 })
    expect(signal).toBe("hold")
    expect(gates.buyCandidate).toBe(true)
    expect(gates.volumeAgreement).toBe(false)
    // the OBV agreement alternative satisfies the gate even on a thin tape
    const alt = decideSignal({ ...buyFacts, relVol: 0.4, obvSlope: 800 })
    expect(alt.signal).toBe("buy")
    expect(alt.gates.volumeAgreement).toBe(true)
  })

  it("decision-level excellence: any present dimension below 80% → hold", () => {
    const { signal, gates } = decideSignal({ ...buyFacts, allDimsStrong: false })
    expect(signal).toBe("hold")
    expect(gates.allDimsStrong).toBe(false)
  })

  it("structure veto: multi-touch resistance within 2% blocks the buy…", () => {
    const { signal, gates } = decideSignal({ ...buyFacts, resistanceZone: { price: 101.5, touches: 3 } })
    expect(signal).toBe("hold")
    expect(gates.vetoResistance).toBe(true)
    expect(gates.buyCandidate).toBe(true)
  })

  it("…unless the breakout is confirmed (prior close above the zone AND relVol ≥ 1.5)", () => {
    const breakout = decideSignal({ ...buyFacts, prevClose: 102, relVol: 1.8, resistanceZone: { price: 101.5, touches: 3 } })
    expect(breakout.signal).toBe("buy")
    expect(breakout.gates.breakoutConfirmed).toBe(true)
    expect(breakout.gates.vetoResistance).toBe(false)
    // thin retest volume → the veto stands
    const thin = decideSignal({ ...buyFacts, prevClose: 102, relVol: 0.9, resistanceZone: { price: 101.5, touches: 3 } })
    expect(thin.signal).toBe("hold")
    // single-touch pivots never veto
    const single = decideSignal({ ...buyFacts, resistanceZone: { price: 101.5, touches: 1 } })
    expect(single.signal).toBe("buy")
  })

  it("SELL does not require the excellence gate (reachability, audit D)", () => {
    const { signal } = decideSignal({
      finalScore: 25, trendShare: 0.1, rsi: 30, macdLine: -1, macdHist: -0.5,
      relVol: 0.8, obvSlope: -3000, allDimsStrong: false, lowerHighs: true,
      belowLongMa: true, close: 90, prevClose: 91, resistanceZone: null, supportZone: null,
    })
    expect(signal).toBe("sell")
  })

  it("SELL mirrored structure veto: multi-touch support blocks unless breakdown confirms", () => {
    const base = {
      finalScore: 25, trendShare: 0.1, rsi: 30, macdLine: -1, macdHist: -0.5,
      relVol: 2, obvSlope: -3000, allDimsStrong: false, lowerHighs: true,
      belowLongMa: true, close: 90.3, prevClose: 91, resistanceZone: null,
    }
    const vetoed = decideSignal({ ...base, supportZone: { price: 89, touches: 2 } })
    expect(vetoed.signal).toBe("hold")
    expect(vetoed.gates.vetoSupport).toBe(true)
    const breakdown = decideSignal({ ...base, prevClose: 88.5, supportZone: { price: 89, touches: 2 } })
    expect(breakdown.signal).toBe("sell")
    expect(breakdown.gates.breakdownConfirmed).toBe(true)
  })
})

describe("hysteresis (E) — enter/exit bands, minimum hold, glide", () => {
  it("no 1-session flapping: a marginal dip inside the exit band keeps the BUY", () => {
    const reads = [
      read({ ts: "d1", signal: "buy", score: 70 }),
      read({ ts: "d2", signal: "hold", score: 58 }), // raw hold, but ≥ exit 55
      read({ ts: "d3", signal: "hold", score: 58 }),
    ]
    const r = applyHysteresis(reads)
    expect(r.signal).toBe("buy")
    expect(r.heldByHysteresis).toBe(true)
  })

  it("minimum state hold suppresses a young-state flip (no whipsaw)", () => {
    const reads = [
      read({ ts: "d1", signal: "hold", score: 60 }),
      read({ ts: "d2", signal: "buy", score: 70 }), // enter
      read({ ts: "d3", signal: "hold", score: 50 }), // below exit — but state is 1 session old
      read({ ts: "d4", signal: "buy", score: 70 }),
    ]
    const r = applyHysteresis(reads)
    expect(r.signal).toBe("buy")
  })

  it("exit band breach after the hold elapses → the label follows the evidence", () => {
    const reads = [
      read({ ts: "d1", signal: "buy", score: 70 }),
      read({ ts: "d2", signal: "buy", score: 68 }),
      read({ ts: "d3", signal: "hold", score: 50 }), // < 55 exit
      read({ ts: "d4", signal: "hold", score: 50 }),
    ]
    expect(applyHysteresis(reads).signal).toBe("hold")
  })

  it("structural events bypass hysteresis; the score glides ±25/session otherwise", () => {
    const glide = applyHysteresis([
      read({ ts: "d1", signal: "hold", score: 80 }),
      read({ ts: "d2", signal: "hold", score: 15 }), // −65 without a structural move
    ])
    expect(glide.score).toBe(55) // 80 − 25
    expect(glide.glideApplied).toBe(true)
    const structural = applyHysteresis([
      read({ ts: "d1", signal: "hold", score: 80 }),
      read({ ts: "d2", signal: "hold", score: 15, changePct: -4, structural: true }),
    ])
    expect(structural.score).toBe(15) // genuine structural event passes through
    expect(structural.glideApplied).toBe(false)
  })
})

describe("de-duplication (B) — the same fact cannot stack across dimensions", () => {
  it("oscillator corroboration cap: full agreement saturates at 80% of the group max", () => {
    // exercised end-to-end via the fallback scorer in signals.test.ts (24/30);
    // here via the close engine: momentum never exceeds the cap on any tape
    for (const n of [40, 80]) {
      const sig = computeCloseSignal(rowsFrom(healthyUptrend(n)))
      const mom = sig.dimensions.find((d) => d.key === "momentum")!
      expect(mom.earned).toBeLessThanOrEqual(Math.round(0.8 * mom.max))
    }
  })

  it("risk no longer rewards trend agreement — deep dislocation below EMA20 is a risk", () => {
    // a tape ~15% below its EMA20 earns partial risk credit (3/8), not the
    // full 8 @4 gave for "not far above the average"
    const closes: number[] = []
    let p = 100
    for (let i = 0; i < 80; i++) { p *= 0.982; closes.push(Math.round(p * 100) / 100) }
    const sig = computeCloseSignal(rowsFrom(closes))
    expect(sig.dimensions.find((d) => d.key === "risk")!.earned).toBeLessThan(20)
  })
})

describe("style honesty (H)", () => {
  it("the day-trading style is never emitted from daily closes", () => {
    for (const volumes of [null, [1500, 3000] as number[]]) {
      const closes = healthyUptrend(80)
      const rows = rowsFrom(closes, volumes && closes.map((_, i) => volumes[i % volumes.length] + i))
      const sig = computeCloseSignal(rows)
      expect(sig.styleFits.map((f) => f.tag)).not.toContain("day")
    }
  })
})

describe("trade plan rides the read (F)", () => {
  it("WAIT has no plan; a buy plan is structural with RR ≥ 1.5 or absent", () => {
    const hold = computeCloseSignal(rowsFrom(uptrendCloses(80)))
    expect(hold.signal).toBe("hold")
    expect(hold.tradePlan).toBeNull()
    const closes = healthyUptrend(80)
    const volumes = closes.map((_, i) => (i % 2 === 0 ? 1100 : 1000))
    const buy = computeCloseSignal(rowsFrom(closes, volumes))
    if (buy.signal === "buy") {
      expect(buy.tradePlan).not.toBeNull()
      expect(buy.tradePlan!.riskReward).toBeGreaterThanOrEqual(1.5)
    }
    expect(buildTradePlan({ signal: "hold", lastClose: 100, closes: [], supports: [{ price: 95 }], atrPct: null })).toBeNull()
  })
})
