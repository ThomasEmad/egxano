// Opportunity-replay tests — hand-built synthetic series with known
// eligibility / fill / exit outcomes. The stub engine is deterministic and
// keys off the last close of the slice it receives, so the replay's signal
// stream and the eligibility layer's re-derived plan always agree.
import { describe, expect, it } from "vitest"
import { DEFAULT_BACKTEST_CONFIG, type BacktestConfig } from "../constants"
import { replayEngine, type CloseEngine } from "../replay"
import {
  FALSE_BREAKOUT_K_SESSIONS,
  auditUpsideGate,
  replayOpportunityTrades,
  upsidePctFromEntryHighToT1,
  type OpportunityTradeRecord,
} from "../opportunity-replay"
import type { TickerMeta } from "../execution"
import type { EngineRow } from "../types"
import type { TradePlan } from "../../technical/trade-plan"
import type { CloseSignalOutput } from "../../../../.cache/engine-baseline/signals"

const META: TickerMeta = { ticker: "TEST", sector: "Banks", tier: "EGX30", liquidityTercile: "T2" }
const CFG: BacktestConfig = { ...DEFAULT_BACKTEST_CONFIG, warmupSessions: 40 }
const WINDOWS_ALL_TRAIN = { train: 999, validation: 0, test: 0 }

// ---- synthetic bars -----------------------------------------------------------

let tsCounter = 0
function nextTs(): string {
  const d = new Date(Date.UTC(2025, 0, 1) + (tsCounter++) * 86_400_000).toISOString().slice(0, 10)
  return d
}
function bar(o: number, h: number, l: number, c: number): EngineRow {
  return { ts: nextTs(), open: o, high: h, low: l, close: c, volume: 1_000_000 }
}
/** open = previous close, wicks ±0.5 — never flat, pivot highs sit on closes. */
function barsFromCloses(closes: number[]): EngineRow[] {
  return closes.map((c, i) => {
    const o = i === 0 ? c : closes[i - 1]
    return bar(o, Math.max(o, c) + 0.5, Math.min(o, c) - 0.5, c)
  })
}
/** Phase A ×4 blocks: supply clusters at pivot highs 110.5 (Z1) and 120.5
 *  (Z2, weaker than Z1 so T2 comes from the major extreme). */
const PHASE_A = Array.from({ length: 4 }, () => [103, 105, 107, 110, 108, 106, 104, 120, 117, 114]).flat()
/** Phase B decline into the decision close (100). */
const PHASE_B = [108, 104, 101, 100]
const BASE = () => barsFromCloses([...PHASE_A, ...PHASE_B]) // idx 0..43, close(43) = 100
/** Z1 band [109.84, 111.14] → ladder T1 = 109.84; major extreme 120.5 → T2. */
const T1 = 109.84
const T2 = 120.5

// ---- stub engine ---------------------------------------------------------------

function makePlan(entryLow: number, entryHigh: number, stop: number, targetLow: number, riskReward: number): TradePlan {
  return {
    bias: "buy", entryLow, entryHigh, entryPct: 0, stop, stopPct: 0,
    targetLow, targetHigh: targetLow * 1.02, targetPct: 0, riskReward,
    textAr: "", textEn: "", basisAr: "",
  }
}
function defaultPlan(lc: number): TradePlan {
  return makePlan(lc * 0.99, lc * 1.01, lc * 0.92, lc * 1.01 * 1.15, 2.0)
}
function stance(signal: "buy" | "hold", plan: TradePlan | null): CloseSignalOutput {
  return {
    version: "stub@1", score: signal === "buy" ? 80 : 50, signal,
    dimensions: [], reasons: [], styleFits: [], invalidation: null,
    tradePlan: plan, limitations: [],
    sessions: 0, lastClose: null, asOf: null, changePct: null,
    metrics: {
      rsi14: null, ema20: null, ema50: null, macdLine: null, macdHist: null,
      relVol: null, perfW1: null, perfM1: null, perfM3: null, rangePos60: null,
      dailyVolPct: null, obvSlope20: null,
    },
  }
}
function stubEngine(opts: {
  buyWhen: (lastClose: number) => boolean
  plan?: (lastClose: number) => TradePlan | null
  slices?: string[]
}): CloseEngine {
  return (rows) => {
    const last = rows[rows.length - 1]
    opts.slices?.push(last.ts)
    if (opts.buyWhen(last.close)) {
      return stance("buy", opts.plan ? opts.plan(last.close) : defaultPlan(last.close))
    }
    return stance("hold", null)
  }
}

function run(rows: EngineRow[], engine: CloseEngine, windows = WINDOWS_ALL_TRAIN, cfg: BacktestConfig = CFG) {
  const replay = replayEngine(rows, cfg, engine)
  return { replay, res: replayOpportunityTrades(rows, replay, META, windows, cfg, engine) }
}

describe("opportunity-replay — decision-point eligibility", () => {
  it("zone-edge fill at entryHigh, T1 exit: exact math, funnel consistent, audit clean", () => {
    tsCounter = 0
    const rows = [
      ...BASE(),
      bar(101.5, 102.0, 100.8, 102.0), // idx44 entry session: open>entryHigh, low<=entryHigh
      bar(102.2, 106.5, 105.2, 106.0),
      bar(106.2, 111.0, 105.8, 110.5), // close >= T1 → target exit
      bar(110.5, 111.2, 109.6, 110.1),
    ]
    const { res } = run(rows, stubEngine({ buyWhen: (c) => c === 100 }))
    expect(res.funnel).toMatchObject({
      decisionSessions: rows.length - 2 - CFG.warmupSessions + 1,
      buySignals: 1, planValidBuyCandidates: 1, planRederivationMisses: 0,
      classified: 1, qualifying: 1, tradesEntered: 1, limitLocked: 0, positionBusy: 0,
    })
    expect(res.funnel.stateCounts.actionable).toBe(1)
    expect(res.trades).toHaveLength(1)
    const t = res.trades[0]
    expect(t.fillCase).toBe("zone_edge")
    expect(t.entry).toBe(101) // worst executable edge
    expect(t.entryHigh).toBeCloseTo(101, 10)
    expect(t.t1Price).toBe(T1)
    expect(t.t2Price).toBe(T2) // from the major confirmed extreme
    expect(t.t2Kind).toBe("major_high")
    expect(t.outcome).toBe("target")
    expect(t.exitIndex).toBe(46)
    expect(t.sessionsHeld).toBe(3)
    expect(t.sessionsToT1).toBe(3)
    expect(t.grossReturnPct).toBeCloseTo(((110.5 / 101) - 1) * 100, 10)
    expect(t.netReturnPct).toBeCloseTo(((110.5 / 101) - 1) * 100 - 0.6, 10)
    expect(t.mfePct).toBeCloseTo(((110.5 / 101) - 1) * 100, 10)
    expect(t.maePct).toBe(0)
    expect(t.ambiguous).toBe(false)
    expect(t.falseBreakout).toBe(false)
    expect(t.t2Reached).toBe(false)
    expect(t.gateUpheld).toBe(true)
    expect(t.upsidePctToT1FromEntryHigh).toBeCloseTo(8.7525, 4)
    expect(t.window).toBe("train")
    const audit = auditUpsideGate(res.trades)
    expect(audit.checked).toBe(1)
    expect(audit.violations).toBe(0)
    expect(audit.minUpsidePct).toBeCloseTo(8.7525, 4)
  })

  it("open fill below the entry zone fills at the open (never claims entryHigh)", () => {
    tsCounter = 0
    const rows = [
      ...BASE(),
      bar(99.5, 100.2, 99.0, 100.0), // open 99.5 <= entryHigh 101 → fill at open
      bar(100.2, 111.5, 99.8, 111.0), // close >= T1 → target
      bar(111.0, 112.0, 110.4, 111.4),
    ]
    const { res } = run(rows, stubEngine({ buyWhen: (c) => c === 100 }))
    expect(res.trades).toHaveLength(1)
    const t = res.trades[0]
    expect(t.fillCase).toBe("open")
    expect(t.entry).toBe(99.5)
    expect(t.outcome).toBe("target")
    expect(t.grossReturnPct).toBeCloseTo(((111 / 99.5) - 1) * 100, 10)
  })

  it("gap-through session (open and low above entryHigh) fills at the open; fill-based upside erodes below 5% but is NOT a gate violation", () => {
    tsCounter = 0
    const rows = [
      ...BASE(),
      bar(105, 105.6, 104.4, 105.0), // gap through the 101 entry zone, never offered
      bar(105.2, 110.9, 104.6, 110.2), // close >= T1 → target
      bar(110.2, 111.0, 109.8, 110.5),
    ]
    const { res } = run(rows, stubEngine({ buyWhen: (c) => c === 100 }))
    expect(res.trades).toHaveLength(1)
    const t = res.trades[0]
    expect(t.fillCase).toBe("gap_through_open")
    expect(t.entry).toBe(105)
    expect(t.upsidePctToT1FromEntryHigh).toBeCloseTo(8.7525, 4) // gate on entryHigh — upheld
    expect(t.upsidePctToT1FromFill).toBeCloseTo(((T1 - 105) / 105) * 100, 4) // eroded, informational
    expect(t.upsidePctToT1FromFill).toBeLessThan(5)
    expect(auditUpsideGate(res.trades).violations).toBe(0)
    expect(t.grossReturnPct).toBeCloseTo(((110.2 / 105) - 1) * 100, 10)
  })

  it("stop-first precedence on the resolving close; intraday double-touch marks ambiguous; stopped-first suppresses falseBreakout", () => {
    tsCounter = 0
    const rows = [
      ...BASE(),
      bar(101.5, 102.0, 100.8, 101.0), // entry, fill 101, no trigger
      bar(101.0, 110.0, 91.0, 91.0), // close <= stop AND high >= T1 → stop-first, ambiguous
      bar(91.0, 92.0, 90.0, 91.5),
    ]
    const { res } = run(rows, stubEngine({ buyWhen: (c) => c === 100 }))
    expect(res.trades).toHaveLength(1)
    const t = res.trades[0]
    expect(t.outcome).toBe("stop")
    expect(t.ambiguous).toBe(true)
    expect(t.exit).toBe(91)
    expect(t.sessionsToT1).toBeNull()
    expect(t.falseBreakout).toBe(false) // the stop-close precedes the entryLow breach
    expect(t.grossReturnPct).toBeCloseTo(((91 / 101) - 1) * 100, 10)
  })

  it("false breakout: close back below entryLow within K sessions without a stop-close first", () => {
    tsCounter = 0
    const tail: EngineRow[] = [
      bar(100.2, 102.5, 99.8, 102.0), // idx44 entry (fill at open 100.2 <= 101), close fine
      bar(101.8, 101.6, 100.9, 101.0),
      bar(101.0, 98.8, 98.2, 98.5), // close 98.5 < entryLow 99, > stop 92 → false breakout
    ]
    for (let i = 0; i < 18; i++) {
      const c = 100 + (i % 2 === 0 ? 0.3 : -0.3)
      const o = tail[tail.length - 1].close
      tail.push(bar(o, Math.max(o, c) + 0.3, Math.min(o, c) - 0.3, c))
    }
    const rows = [...BASE(), ...tail]
    const { res } = run(rows, stubEngine({ buyWhen: (c) => c === 100 }))
    expect(res.trades).toHaveLength(1)
    const t = res.trades[0]
    expect(t.falseBreakout).toBe(true)
    expect(t.outcome).toBe("timeStop")
    expect(t.sessionsHeld).toBe(CFG.timeStopSessions)
    expect(t.ambiguous).toBe(false)
    expect(t.t2Reached).toBe(false)
  })

  it("false-breakout window is exactly K sessions (a breach at session K+1 does not flag)", () => {
    tsCounter = 0
    const tail: EngineRow[] = [bar(100.2, 102.5, 99.8, 102.0)]
    // K = 5 holding sessions: idx44..48 — all above entryLow; breach at idx49 (6th)
    for (let i = 0; i < 4; i++) {
      const o = tail[tail.length - 1].close
      tail.push(bar(o, o + 0.4, o - 0.4, o + 0.1))
    }
    tail.push(bar(102.3, 102.6, 98.0, 98.5)) // idx49: outside the K window
    for (let i = 0; i < 14; i++) {
      const o = tail[tail.length - 1].close
      const c = o + (i % 2 === 0 ? 0.1 : -0.1)
      tail.push(bar(o, Math.max(o, c) + 0.3, Math.min(o, c) - 0.3, c))
    }
    const rows = [...BASE(), ...tail]
    const { res } = run(rows, stubEngine({ buyWhen: (c) => c === 100 }))
    expect(res.trades).toHaveLength(1)
    expect(res.trades[0].falseBreakout).toBe(false)
    expect(FALSE_BREAKOUT_K_SESSIONS).toBe(5)
  })

  it("T2 reached inside the original holding window even though P&L exited at T1", () => {
    tsCounter = 0
    const rows = [
      ...BASE(),
      bar(101.5, 102.0, 100.8, 102.0), // entry, fill 101
      bar(106.2, 121.5, 105.8, 121.0), // close >= T2 (and >= T1) → target exit; T2 reached
      bar(121.0, 122.0, 120.2, 121.3),
    ]
    const { res } = run(rows, stubEngine({ buyWhen: (c) => c === 100 }))
    expect(res.trades).toHaveLength(1)
    const t = res.trades[0]
    expect(t.outcome).toBe("target")
    expect(t.t1Price).toBe(T1)
    expect(t.t2Price).toBe(T2)
    expect(t.t2Reached).toBe(true)
    expect(t.sessionsToT1).toBe(2)
  })

  it("time-stop exit mirrors execution.ts (20 holding sessions inclusive)", () => {
    tsCounter = 0
    const tail: EngineRow[] = [bar(100.2, 102.5, 99.8, 102.0)]
    for (let i = 0; i < 21; i++) {
      const o = tail[tail.length - 1].close
      const c = 100 + (i % 2 === 0 ? 0.2 : -0.2)
      tail.push(bar(o, Math.max(o, c) + 0.3, Math.min(o, c) - 0.3, c))
    }
    const rows = [...BASE(), ...tail]
    const { res } = run(rows, stubEngine({ buyWhen: (c) => c === 100 }))
    expect(res.trades).toHaveLength(1)
    const t = res.trades[0]
    expect(t.outcome).toBe("timeStop")
    expect(t.sessionsHeld).toBe(20)
    expect(t.falseBreakout).toBe(false)
  })

  it("limit lock: t+1 close outside the ±20% band skips the entry (execution.ts parity)", () => {
    tsCounter = 0
    const rows = [
      ...BASE(),
      bar(100.5, 125.5, 100.2, 125.0), // +25% vs decision close → limit-locked
      bar(125.0, 126.0, 124.0, 125.5),
    ]
    const { res } = run(rows, stubEngine({ buyWhen: (c) => c === 100 }))
    expect(res.trades).toHaveLength(0)
    expect(res.funnel.qualifying).toBe(1)
    expect(res.funnel.limitLocked).toBe(1)
    expect(res.funnel.tradesEntered).toBe(0)
    expect(res.skips.limitLocked).toBe(1)
  })

  it("one position per ticker: an eligible decision while a trade is open is positionBusy", () => {
    tsCounter = 0
    const tail: EngineRow[] = [bar(100.2, 102.5, 99.8, 102.0)]
    const closesTail = [102.0]
    // idx45..49 non-100 closes, idx50 = 100 (second decision, trade 1 still open)
    for (const c of [100.3, 100.1, 99.8, 100.2, 100.4, 100.0]) {
      const o = closesTail[closesTail.length - 1]
      tail.push(bar(o, Math.max(o, c) + 0.3, Math.min(o, c) - 0.3, c))
      closesTail.push(c)
    }
    for (let i = 0; i < 13; i++) {
      const o = closesTail[closesTail.length - 1]
      const c = 100 + (i % 2 === 0 ? 0.25 : -0.25)
      tail.push(bar(o, Math.max(o, c) + 0.3, Math.min(o, c) - 0.3, c))
      closesTail.push(c)
    }
    const rows = [...BASE(), ...tail]
    const { res } = run(rows, stubEngine({ buyWhen: (c) => c === 100 }))
    expect(res.funnel.buySignals).toBe(2)
    expect(res.funnel.classified).toBe(2)
    expect(res.funnel.qualifying).toBe(2)
    expect(res.funnel.positionBusy).toBe(1)
    expect(res.funnel.tradesEntered).toBe(1)
    expect(res.trades).toHaveLength(1)
    expect(res.trades[0].outcome).toBe("timeStop")
  })

  it("strict 5% gate: upside 5.0005% passes, 4.9995% fails — exactly per OPPORTUNITY_THRESHOLDS", () => {
    // T1 = 109.84; entryHigh 104.609 → upside 5.0005 (>5, eligible); 104.61 → 4.9995 (rejected)
    tsCounter = 0
    const passRows = [
      ...BASE(),
      bar(104.2, 104.9, 103.9, 104.5),
      bar(104.5, 111.0, 104.2, 110.5), // T1 exit
      bar(110.5, 111.2, 110.0, 110.6),
    ]
    const passEngine = stubEngine({
      buyWhen: (c) => c === 100,
      plan: () => makePlan(103.56, 104.609, 92, 120.3, 2.0),
    })
    const passRes = run(passRows, passEngine).res
    expect(passRes.funnel.qualifying).toBe(1)
    expect(passRes.trades).toHaveLength(1)
    expect(passRes.trades[0].upsidePctToT1FromEntryHigh).toBeGreaterThan(5)

    tsCounter = 0
    const failRows = [
      ...BASE(),
      bar(104.2, 104.9, 103.9, 104.5),
      bar(104.5, 104.8, 104.1, 104.4),
      bar(104.4, 104.7, 104.2, 104.5),
    ]
    const failEngine = stubEngine({
      buyWhen: (c) => c === 100,
      plan: () => makePlan(103.56, 104.61, 92, 120.3, 2.0),
    })
    const failRes = run(failRows, failEngine).res
    expect(failRes.funnel.qualifying).toBe(0)
    expect(failRes.funnel.stateCounts.none).toBe(1)
    expect(failRes.trades).toHaveLength(0)
    expect(upsidePctFromEntryHighToT1(104.609, T1)).toBeGreaterThan(5)
    expect(upsidePctFromEntryHighToT1(104.61, T1)).toBeLessThan(5)
    expect(upsidePctFromEntryHighToT1(104.61, T1)).toBeCloseTo(4.9995, 4)
  })

  it("RR gate: plan RR 1.4 (>= 1.0 plan-tradable but < 1.5) is classified, not qualifying", () => {
    tsCounter = 0
    const rows = [
      ...BASE(),
      bar(100.2, 102.5, 99.8, 102.0),
      bar(102.0, 102.6, 101.4, 102.2),
      bar(102.2, 102.8, 101.8, 102.4),
    ]
    const { res } = run(rows, stubEngine({
      buyWhen: (c) => c === 100,
      plan: (lc) => makePlan(lc * 0.99, lc * 1.01, lc * 0.92, lc * 1.01 * 1.15, 1.4),
    }))
    expect(res.funnel.planValidBuyCandidates).toBe(1)
    expect(res.funnel.classified).toBe(1)
    expect(res.funnel.qualifying).toBe(0)
    expect(res.funnel.stateCounts.none).toBe(1)
    expect(res.trades).toHaveLength(0)
  })

  it("NO-CHASE: close above the entry zone with < 5% remaining upside classifies 'missed', no trade", () => {
    tsCounter = 0
    // decision close 106 (>= entryHigh 95 override) — remaining upside to T1 = 3.62% < 5
    const rows = [
      ...BASE(),
      bar(104.9, 105.4, 104.6, 105.0),
      bar(105.0, 105.6, 104.8, 105.4),
      bar(105.4, 106.4, 105.2, 106.0), // decision close 106
      bar(106.0, 106.5, 105.6, 106.2),
    ]
    const { res } = run(rows, stubEngine({
      buyWhen: (c) => c === 106,
      // entryHigh 105 sits BELOW the 106 close (left behind) AND fails the 5%
      // gate from entryHigh (4.61% < 5); remaining upside from the 106 close
      // to T1 = 3.62% < 5 → the NO-CHASE rule classifies "missed"
      plan: () => makePlan(104, 105, 98, 116.15, 2.0),
    }))
    expect(res.funnel.planValidBuyCandidates).toBe(1)
    expect(res.funnel.classified).toBe(1)
    expect(res.funnel.qualifying).toBe(0)
    expect(res.funnel.stateCounts.missed).toBe(1)
    expect(res.trades).toHaveLength(0)
  })

  it("walk-forward window label follows the decision index (execution.ts windowForIndex parity)", () => {
    tsCounter = 0
    const rows = [
      ...BASE(),
      bar(101.5, 102.0, 100.8, 102.0),
      bar(106.2, 111.0, 105.8, 110.5),
      bar(110.5, 111.2, 109.6, 110.1),
    ]
    // rel = 43 - 40 = 3 → validation window (train 3, validation 1)
    const { res } = run(rows, stubEngine({ buyWhen: (c) => c === 100 }), { train: 3, validation: 1, test: 99 })
    expect(res.trades).toHaveLength(1)
    expect(res.trades[0].window).toBe("validation")
  })

  it("no lookahead: the eligibility layer re-derives the plan on the EXACT truncated slice [0..t] the replay used", () => {
    tsCounter = 0
    const slices: string[] = []
    const rows = [
      ...BASE(),
      bar(101.5, 102.0, 100.8, 102.0),
      bar(106.2, 111.0, 105.8, 110.5),
      bar(110.5, 111.2, 109.6, 110.1),
    ]
    const decisionTs = rows[43].ts
    const { res } = run(rows, stubEngine({ buyWhen: (c) => c === 100, slices }))
    const decisionCalls = slices.filter((ts) => ts === decisionTs)
    expect(decisionCalls.length).toBe(2) // replay + re-derivation, same slice
    expect(res.trades).toHaveLength(1)
    // no slice may extend past the last series date (stub sees only prefixes)
    expect(slices.every((ts) => ts <= rows[rows.length - 1].ts)).toBe(true)
  })

  it("auditUpsideGate counts violations on a crafted bad record (defense in depth)", () => {
    tsCounter = 0
    const rows = [
      ...BASE(),
      bar(101.5, 102.0, 100.8, 102.0),
      bar(106.2, 111.0, 105.8, 110.5),
      bar(110.5, 111.2, 109.6, 110.1),
    ]
    const { res } = run(rows, stubEngine({ buyWhen: (c) => c === 100 }))
    const bad = { ...res.trades[0], ticker: "BAD", entryHigh: 100, t1Price: 105, qualifies5: false, gateUpheld: false } as OpportunityTradeRecord
    const audit = auditUpsideGate([bad])
    expect(audit.checked).toBe(1)
    expect(audit.violations).toBe(1)
    expect(audit.violating[0].ticker).toBe("BAD")
    expect(audit.violating[0].upsidePct).toBeCloseTo(5, 4)
  })
})
