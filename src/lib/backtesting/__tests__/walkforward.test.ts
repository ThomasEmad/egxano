// Walk-forward split tests.
import { describe, expect, it } from "vitest"
import { DEFAULT_BACKTEST_CONFIG } from "../constants"
import { replayEngine } from "../replay"
import { splitWindows } from "../walkforward"
import type { EngineRow } from "../types"

function buildRows(n: number): EngineRow[] {
  return Array.from({ length: n }, (_, i) => ({
    ts: new Date(Date.UTC(2025, 0, 1) + i * 86_400_000).toISOString().slice(0, 10),
    close: 100 + i * 0.1,
    volume: 1_000_000,
  }))
}

describe("splitWindows 60/20/20", () => {
  it("tiles the replay session list chronologically with recorded dates", () => {
    const rows = buildRows(200)
    const replay = replayEngine(rows, { ...DEFAULT_BACKTEST_CONFIG, warmupSessions: 100 })
    // replay length = 200 - 2 - 100 + 1 = 99
    const { counts, dates } = splitWindows(replay)
    expect(counts.train + counts.validation + counts.test).toBe(replay.records.length)
    expect(counts.train).toBe(Math.floor(replay.records.length * 0.6)) // 59
    expect(counts.validation).toBe(Math.floor(replay.records.length * 0.2)) // 19
    expect(dates.train.start).toBe(replay.records[0].ts)
    expect(dates.train.end).toBe(replay.records[counts.train - 1].ts)
    expect(dates.validation.start).toBe(replay.records[counts.train].ts)
    expect(dates.test.start).toBe(replay.records[counts.train + counts.validation].ts)
    expect(dates.test.end).toBe(replay.records[replay.records.length - 1].ts)
  })
})
