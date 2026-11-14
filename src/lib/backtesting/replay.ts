// NO-LOOKAHEAD ENGINE REPLAY.
//
// At each session t (from warmupSessions to last-1 inclusive) the frozen
// engine (a verbatim copy of src/lib/technical, snapshotted at
// .cache/engine-baseline) is invoked on bars[0..t] ONLY — the slice passed to
// computeCloseSignal ends at t, so nothing after t can influence the record.
//
// The engine entry point is computeCloseSignal(rows: CloseRow[]) — the same
// close+volume daily input shape production's close-engine consumes. The
// full-snapshot entry (computeStanceFromSnapshot) needs the DB-backed
// TechnicalSnapshot pipeline (unreachable in this sandbox) — disclosed.
import { computeCloseSignal, type CloseRow } from "../../../.cache/engine-baseline/signals"
import { DEFAULT_BACKTEST_CONFIG, type BacktestConfig } from "./constants"
import type { EngineRow, ReplayRecord } from "./types"

export interface ReplayResult {
  records: ReplayRecord[]
  /** indexes [first, last] of evaluated sessions in the source series */
  firstIndex: number
  lastIndex: number
  /** date of the last bar in the series (YYYY-MM-DD) */
  seriesLastDate: string
}

/** Plan tradability for a BUY read: plan exists, levels are ordered
 *  (stop < entry-mid < target), and RR >= minRiskReward. Mirrors the
 *  production plan-builder's honesty rules (it returns null when no honest
 *  plan can be anchored) plus the backtest's RR floor. */
export function planIsTradable(plan: {
  bias: "buy" | "sell"
  entryLow: number
  entryHigh: number
  stop: number
  targetLow: number
  targetHigh: number
  riskReward: number
} | null, minRiskReward: number): boolean {
  if (!plan) return false
  const mid = (plan.entryLow + plan.entryHigh) / 2
  return (
    Number.isFinite(plan.stop) && plan.stop > 0 &&
    Number.isFinite(plan.targetLow) && plan.targetLow > plan.stop &&
    Number.isFinite(mid) && plan.stop < mid &&
    plan.riskReward >= minRiskReward
  )
}

/**
 * Replay the engine over the series with no lookahead.
 * Deterministic: same rows + config => same records.
 */
export function replayEngine(
  rows: EngineRow[],
  config: BacktestConfig = DEFAULT_BACKTEST_CONFIG,
): ReplayResult {
  const firstIndex = Math.max(config.warmupSessions, 0)
  // Signals evaluated up to last-1 so a signal at t always has a t+1 close
  // to attempt a fill on (conservative daily-data execution).
  const lastIndex = rows.length - 2
  const records: ReplayRecord[] = []

  for (let t = firstIndex; t <= lastIndex; t++) {
    // ---- the ONLY engine call: strictly truncated slice [0..t] ----
    const out = computeCloseSignal(rows.slice(0, t + 1) as CloseRow[])
    const plan = out.tradePlan
    const valid = out.signal === "buy" ? planIsTradable(plan, config.minRiskReward) : false
    records.push({
      ts: rows[t].ts,
      index: t,
      signal: out.signal,
      score: out.score,
      relVol: out.metrics.relVol,
      planBias: plan?.bias ?? null,
      planStop: plan?.stop ?? null,
      planTarget: plan?.targetLow ?? null,
      planRiskReward: plan?.riskReward ?? null,
      planValid: valid,
      limitations: out.limitations,
    })
  }

  return {
    records,
    firstIndex,
    lastIndex,
    seriesLastDate: rows.length ? rows[rows.length - 1].ts : "",
  }
}
