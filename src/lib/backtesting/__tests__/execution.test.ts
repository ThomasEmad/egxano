// Execution model tests — hand-built series with known outcomes.
import { describe, expect, it } from "vitest"
import { DEFAULT_BACKTEST_CONFIG, type BacktestConfig } from "../constants"
import { simulateExecution, type TickerMeta } from "../execution"
import type { ReplayResult } from "../replay"
import type { EngineRow, ReplayRecord } from "../types"

const META: TickerMeta = { ticker: "TEST", sector: "Banks", tier: "EGX30", liquidityTercile: "T2" }

function rowsFrom(closes: number[]): EngineRow[] {
  return closes.map((c, i) => ({
    ts: new Date(Date.UTC(2025, 0, 1) + i * 86_400_000).toISOString().slice(0, 10),
    close: c,
    volume: 1_000_000,
  }))
}

function replayOf(records: Omit<ReplayRecord, "limitations">[], firstIndex = 0, lastIndex: number): ReplayResult {
  return {
    records: records.map((r) => ({ ...r, limitations: [] })),
    firstIndex,
    lastIndex,
    seriesLastDate: `last`,
  }
}

const FULL: BacktestConfig = { ...DEFAULT_BACKTEST_CONFIG }
const WINDOWS = { train: 999, validation: 0, test: 0 }

function buyRecord(index: number, valid = true, stop = 95, target = 110, rr = 1.5): Omit<ReplayRecord, "limitations"> {
  return {
    ts: `d${index}`, index, signal: "buy", score: 80, relVol: 1.3,
    planBias: "buy", planStop: stop, planTarget: target, planRiskReward: rr, planValid: valid,
  }
}

describe("execution — fills and plan management", () => {
  it("target exit: entry t+1, exit at first close >= target, math exact", () => {
    // closes: idx0..idx4; signal at idx1 (close 100), entry idx2 (100)
    const rows = rowsFrom([98, 100, 100, 102, 97, 110.5, 112])
    const rec = buyRecord(1) // stop 95, target 110
    const res = simulateExecution(rows, replayOf([rec], 0, 5), META, WINDOWS, FULL)
    expect(res.trades).toHaveLength(1)
    const t = res.trades[0]
    expect(t.entryIndex).toBe(2)
    expect(t.entry).toBe(100)
    expect(t.outcome).toBe("target")
    expect(t.exitIndex).toBe(5)
    expect(t.sessionsHeld).toBe(4)
    expect(t.grossReturnPct).toBeCloseTo(10.5, 10)
    expect(t.netReturnPct).toBeCloseTo(10.5 - 0.6, 10)
    expect(t.mfePct).toBeCloseTo(10.5, 10)
    expect(t.maePct).toBeCloseTo(-3, 10) // close 97 vs entry 100
    expect(t.window).toBe("train")
  })

  it("stop exit: close <= stop wins precedence, math exact", () => {
    const rows = rowsFrom([98, 100, 100, 96, 94.5, 120])
    const rec = buyRecord(1, true, 95, 110)
    const res = simulateExecution(rows, replayOf([rec], 0, 5), META, WINDOWS, FULL)
    const t = res.trades[0]
    expect(t.outcome).toBe("stop")
    expect(t.exitIndex).toBe(4)
    expect(t.exit).toBe(94.5)
    expect(t.grossReturnPct).toBeCloseTo(-5.5, 10)
    expect(t.netReturnPct).toBeCloseTo(-6.1, 10)
    expect(t.maePct).toBeCloseTo(-5.5, 10)
    expect(t.mfePct).toBeCloseTo(0, 10)
  })

  it("time-stop: exit at close after N holding sessions when neither level hits", () => {
    // 25 flat closes around entry; no stop/target breach
    const closes = [100, 100, 100, ...Array(25).fill(101), 999]
    const rows = rowsFrom(closes)
    const rec = buyRecord(1, true, 95, 110)
    const res = simulateExecution(rows, replayOf([rec], 0, closes.length - 2), META, WINDOWS, FULL)
    const t = res.trades[0]
    expect(t.outcome).toBe("timeStop")
    expect(t.exitIndex).toBe(1 + FULL.timeStopSessions) // entry idx2, exit idx 2+19=21
    expect(t.sessionsHeld).toBe(FULL.timeStopSessions)
    expect(t.grossReturnPct).toBeCloseTo(1, 10) // exit close 101 vs entry 100
  })

  it("price-limit lock: entry close beyond the band => no fill, counted", () => {
    const rows = rowsFrom([98, 100, 126, 126]) // +26% vs signal close 100
    const rec = buyRecord(1, true, 95, 110)
    const res = simulateExecution(rows, replayOf([rec], 0, 2), META, WINDOWS, FULL)
    expect(res.trades).toHaveLength(0)
    expect(res.skips.limitLocked).toBe(1)
    // and on the downside
    const rows2 = rowsFrom([98, 100, 74, 74]) // -26%
    const res2 = simulateExecution(rows2, replayOf([rec], 0, 2), META, WINDOWS, FULL)
    expect(res2.skips.limitLocked).toBe(1)
  })

  it("plan-invalid: BUY with invalid plan skipped and counted", () => {
    const rows = rowsFrom([98, 100, 101, 102])
    const rec = buyRecord(1, false)
    const res = simulateExecution(rows, replayOf([rec], 0, 2), META, WINDOWS, FULL)
    expect(res.trades).toHaveLength(0)
    expect(res.skips.planInvalid).toBe(1)
  })

  it("no-overlap: a BUY signal while a position is open is skipped", () => {
    const rows = rowsFrom([98, 100, 100, 102, 97, 110.5, 100, 100, 100, 110.5])
    const rec1 = buyRecord(1, true, 95, 110) // opens idx2, exits idx5 (target)
    const rec2 = buyRecord(4, true, 95, 110) // signal idx4 <= openUntil idx5 -> busy
    const res = simulateExecution(rows, replayOf([rec1, rec2], 0, 8), META, WINDOWS, FULL)
    expect(res.trades).toHaveLength(1)
    expect(res.skips.positionBusy).toBe(1)
  })

  it("SELL signals produce exit-evidence only (no trade)", () => {
    const rows = rowsFrom([100, 100, 100, 99, 98, 97, 96, 96])
    const rec: Omit<ReplayRecord, "limitations"> = {
      ts: "d1", index: 1, signal: "sell", score: 30, relVol: 1.0,
      planBias: "sell", planStop: 110, planTarget: 85, planRiskReward: 2, planValid: false,
    }
    const res = simulateExecution(rows, replayOf([rec], 0, 6), META, WINDOWS, FULL)
    expect(res.trades).toHaveLength(0)
    expect(res.sellEvidence).toHaveLength(1)
    // base = close[2] = 100; fwd 5 sessions = close[7] = 96 -> -4%
    expect(res.sellEvidence[0].fwdReturnPct).toBeCloseTo(-4, 10)
  })

  it("trade still open at data end is recorded as open (excluded from completed)", () => {
    const rows = rowsFrom([98, 100, 100, 101, 102]) // ends before stop/target/timestop
    const rec = buyRecord(1, true, 95, 110)
    const res = simulateExecution(rows, replayOf([rec], 0, 3), META, WINDOWS, FULL)
    expect(res.trades).toHaveLength(1)
    expect(res.trades[0].outcome).toBe("open")
    expect(res.trades[0].netReturnPct).toBeNull()
  })
})
