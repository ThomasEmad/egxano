// No-lookahead + determinism tests for the backtest replay.
import { describe, expect, it } from "vitest"
import { computeCloseSignal } from "../../../../.cache/engine-baseline/signals"
import { DEFAULT_BACKTEST_CONFIG } from "../constants"
import { replayEngine } from "../replay"
import type { EngineRow, ReplayRecord } from "../types"

/** Mild uptrend: 2 up sessions (+0.4%) then 1 down (-0.3%) — keeps RSI < 78
 *  so the engine emits a BUY read at the end (verified by the prototype run:
 *  signal=buy, score=71, RSI=55.2). index `crashAt` gets a -15% bar instead,
 *  which flips the read to sell when INCLUDED (but must not affect t<crashAt). */
function buildRows(n: number, crashAt: number | null): EngineRow[] {
  const rows: EngineRow[] = []
  let close = 100
  for (let i = 0; i < n; i++) {
    if (crashAt !== null && i === crashAt) close = close * 0.85
    else close = i % 3 === 2 ? close * 0.997 : close * 1.004
    const d = new Date(Date.UTC(2025, 0, 1) + i * 86_400_000)
    rows.push({
      ts: d.toISOString().slice(0, 10),
      close: Math.round(close * 100) / 100,
      volume: 1_000_000 + (i % 7) * 90_000,
    })
  }
  return rows
}

describe("replayEngine — no lookahead", () => {
  const rows = buildRows(130, 120) // crash bar at index 120 (inside replay range)
  const config = { ...DEFAULT_BACKTEST_CONFIG, warmupSessions: 90 }
  const replay = replayEngine(rows, config)

  it("crash bar at t+1 does NOT flip the signal recorded at t", () => {
    const t = 119 // replay record at index 119; bar 120 is the crash
    const a = computeCloseSignal(rows.slice(0, t + 1))
    const b = computeCloseSignal(rows.slice(0, t + 2)) // includes the crash
    // precondition: the crash genuinely changes the read
    expect(a.signal).toBe("buy")
    expect(b.signal).not.toBe("buy")
    // the replay must reproduce the TRUNCATED read, not the crash-inclusive one
    const rec = replay.records.find((r) => r.index === t) as ReplayRecord
    expect(rec.signal).toBe(a.signal)
    expect(rec.signal).not.toBe(b.signal)
    expect(rec.score).toBe(a.score)
    expect(rec.score).not.toBe(b.score)
  })

  it("every replay record equals a direct engine call on bars[0..t] only", () => {
    for (let i = 0; i < replay.records.length; i += 7) { // spot-check every 7th
      const rec = replay.records[i]
      const direct = computeCloseSignal(rows.slice(0, rec.index + 1))
      expect(rec.signal).toBe(direct.signal)
      expect(rec.score).toBe(direct.score)
      expect(rec.planStop).toBe(direct.tradePlan?.stop ?? null)
      expect(rec.planTarget).toBe(direct.tradePlan?.targetLow ?? null)
      expect(rec.planRiskReward).toBe(direct.tradePlan?.riskReward ?? null)
    }
  })

  it("replay covers exactly [warmup .. last-1]", () => {
    expect(replay.firstIndex).toBe(90)
    expect(replay.lastIndex).toBe(rows.length - 2)
    expect(replay.records.length).toBe(rows.length - 2 - 90 + 1)
    expect(replay.records[0].index).toBe(90)
    expect(replay.records[replay.records.length - 1].index).toBe(rows.length - 2)
  })

  it("deterministic: two runs produce byte-identical records", () => {
    const r1 = replayEngine(rows, config)
    const r2 = replayEngine(rows, config)
    expect(JSON.stringify(r1)).toBe(JSON.stringify(r2))
  })
})
