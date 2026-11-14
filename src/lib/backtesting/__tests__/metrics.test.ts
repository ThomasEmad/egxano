// Metrics math tests — hand-computed examples.
import { describe, expect, it } from "vitest"
import {
  computeTradeMetrics,
  downsideDev,
  maxDrawdownPct,
  mean,
  median,
  quantile,
  sampleStd,
} from "../metrics"
import type { TradeRecord } from "../types"

function trade(net: number, outcome: TradeRecord["outcome"] = "target", sessions = 5): TradeRecord {
  const entry = 100
  const exit = entry * (1 + (net + 0.6) / 100) // invert the 0.6% round-trip cost
  return {
    ticker: "T", sector: "Banks", tier: "EGX30", liquidityTercile: "T2",
    signalTs: "s", signalIndex: 0, score: 80,
    entryTs: "e", entryIndex: 1, entry,
    stop: 95, target: 110, riskReward: 1.5,
    exitTs: "x", exitIndex: sessions, exit,
    outcome, sessionsHeld: sessions,
    grossReturnPct: net + 0.6, netReturnPct: net,
    maePct: -1, mfePct: net > 0 ? net : 0,
    window: "train",
  }
}

describe("metric primitives", () => {
  it("mean / median / std / downsideDev / quantile", () => {
    expect(mean([1, 2, 3])).toBe(2)
    expect(median([10, -5, 3, -2])).toBe(0.5) // sorted [-5,-2,3,10] -> (-2+3)/2
    expect(median([1, 3, 5])).toBe(3)
    // sample std of [1,2,3] = sqrt(1) = 1 (n-1 denominator)
    expect(sampleStd([1, 2, 3]) as number).toBeCloseTo(1, 12)
    expect(downsideDev([0.01, -0.02, 0.03])).toBeCloseTo(Math.sqrt(0.0004 / 3), 12)
    const s = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
    expect(quantile(s, 0.5)).toBeCloseTo(5.5, 12)
    expect(quantile(s, 0.9)).toBeCloseTo(9.1, 12) // pos = 0.9*9 = 8.1 -> 9 + 0.1*(10-9)
  })

  it("maxDrawdownPct: hand-computed multiplicative equity drawdown", () => {
    // equity: 1.10 -> 1.045 -> 1.0764 -> 1.0549; peak 1.10, trough 1.045
    expect(maxDrawdownPct([10, -5, 3, -2])).toBeCloseTo(-5.0, 10)
    expect(maxDrawdownPct([5, 5])).toBeCloseTo(0, 10)
    expect(maxDrawdownPct([])).toBeNull()
  })
})

describe("computeTradeMetrics", () => {
  const tpy = 4 // trades/year for annualization (hand-picked)
  it("PF / expectancy / median / win rate on [+10,-5,+3,-2]", () => {
    const m = computeTradeMetrics([trade(10), trade(-5), trade(3), trade(-2)], tpy)
    expect(m.completed).toBe(4)
    expect(m.winRatePct).toBeCloseTo(50, 10)
    expect(m.grossWinPct).toBeCloseTo(13, 10)
    expect(m.grossLossPct).toBeCloseTo(-7, 10)
    expect(m.profitFactor).toBeCloseTo(13 / 7, 10)
    expect(m.expectancyPct).toBeCloseTo(1.5, 10)
    expect(m.avgReturnPct).toBeCloseTo(1.5, 10)
    expect(m.medianReturnPct).toBeCloseTo(0.5, 10)
    expect(m.targetExits).toBe(4) // helper defaults every trade to outcome "target"
    expect(m.stopExits).toBe(0)
  })

  it("Sharpe: mean/std*sqrt(tradesPerYear) on [1%,2%,3%]", () => {
    const m = computeTradeMetrics([trade(1), trade(2), trade(3)], tpy)
    // mean=2, sampleStd=1 (percent) -> (2/1)*sqrt(4) = 4
    expect(m.sharpe).toBeCloseTo(4, 10)
    expect(m.winRatePct).toBe(100)
    expect(m.profitFactor).toBeNull() // no losing trades -> PF undefined, disclosed
    expect(m.falsePositiveRatePct).toBe(0) // definitive exits exist, none stopped
  })

  it("Sortino: mean/downsideDev*sqrt(tradesPerYear) on [-1%,2%]", () => {
    const m = computeTradeMetrics([trade(-1), trade(2)], tpy)
    const meanF = 0.005
    const dDev = Math.sqrt((0.0001 + 0) / 2)
    const expected = (meanF / dDev) * Math.sqrt(tpy) // tpy = 4
    expect(m.sortino).toBeCloseTo(expected, 10)
  })

  it("false-positive proxy: stop-first fraction among stop|target exits", () => {
    const m = computeTradeMetrics(
      [trade(10, "target"), trade(-5, "stop"), trade(-6, "stop"), trade(8, "target"), trade(1, "timeStop")],
      tpy,
    )
    // definitive = 4 (2 target, 2 stop); stop-first = 2/4
    expect(m.falsePositiveRatePct).toBeCloseTo(50, 10)
    expect(m.stopExits).toBe(2)
    expect(m.targetExits).toBe(2)
    expect(m.timeStopExits).toBe(1)
  })

  it("open trades counted, excluded from completed metrics", () => {
    const openTrade: TradeRecord = {
      ...trade(0),
      outcome: "open", exitTs: null, exitIndex: null, exit: null,
      sessionsHeld: null, grossReturnPct: null, netReturnPct: null,
    }
    const m = computeTradeMetrics([trade(10), openTrade], tpy)
    expect(m.trades).toBe(2)
    expect(m.completed).toBe(1)
    expect(m.open).toBe(1)
    expect(m.winRatePct).toBe(100)
    expect(m.medianReturnPct).toBeCloseTo(10, 10)
  })

  it("MAE/MFE percentiles", () => {
    const mk = (mae: number, mfe: number): TradeRecord => ({ ...trade(5), maePct: mae, mfePct: mfe })
    const m = computeTradeMetrics([mk(-1, 5), mk(-2, 6), mk(-3, 7), mk(-4, 8)], tpy)
    expect(m.maeP50).toBeCloseTo(-2.5, 10)
    expect(m.mfeP50).toBeCloseTo(6.5, 10)
    expect(m.maeP90).toBeCloseTo(-1.3, 10) // sorted [-4,-3,-2,-1]; pos=2.7 -> -2 + 0.7*1
    expect(m.mfeP90).toBeCloseTo(7.7, 10)
  })
})
