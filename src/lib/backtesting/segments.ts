// SEGMENTATION — per-segment trade metrics: sector, liquidity tercile,
// score band (<70, 70-79, >=80), marketTier. Segment stats: n, win rate,
// PF, expectancy, median.
import { scoreBand } from "./constants"
import { computeTradeMetrics } from "./metrics"
import type { TradeMetrics, TradeRecord } from "./types"

export interface SegmentRow {
  segment: string
  trades: number
  completed: number
  winRatePct: number | null
  profitFactor: number | null
  expectancyPct: number | null
  medianReturnPct: number | null
}

function summarize(segment: string, trades: TradeRecord[]): SegmentRow {
  const m: TradeMetrics = computeTradeMetrics(trades, 248) // annualization irrelevant here (no sharpe surfaced)
  return {
    segment,
    trades: m.trades,
    completed: m.completed,
    winRatePct: m.winRatePct,
    profitFactor: m.profitFactor,
    expectancyPct: m.expectancyPct,
    medianReturnPct: m.medianReturnPct,
  }
}

export function segmentBy(
  trades: TradeRecord[],
  keyOf: (t: TradeRecord) => string,
  order?: string[],
): SegmentRow[] {
  const groups = new Map<string, TradeRecord[]>()
  for (const t of trades) {
    const k = keyOf(t)
    if (!groups.has(k)) groups.set(k, [])
    groups.get(k)!.push(t)
  }
  const keys = order
    ? order.filter((k) => groups.has(k)).concat([...groups.keys()].filter((k) => !order.includes(k)).sort())
    : [...groups.keys()].sort()
  return keys.map((k) => summarize(k, groups.get(k)!))
}

export function segmentBySector(trades: TradeRecord[]): SegmentRow[] {
  return segmentBy(trades, (t) => t.sector || "Other")
}

export function segmentByLiquidity(trades: TradeRecord[]): SegmentRow[] {
  return segmentBy(trades, (t) => t.liquidityTercile, ["T1", "T2", "T3", "unknown"])
}

export function segmentByScoreBand(trades: TradeRecord[]): SegmentRow[] {
  return segmentBy(trades, (t) => scoreBand(t.score), ["<70", "70-79", ">=80", "nullScore"])
}

export function segmentByTier(trades: TradeRecord[]): SegmentRow[] {
  return segmentBy(trades, (t) => t.tier, ["EGX30", "EGX70", "MAIN"])
}
