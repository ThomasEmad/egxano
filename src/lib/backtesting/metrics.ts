// METRICS — all math in one place, unit-tested on hand-computed examples.
// No annualized-return claims; raw per-trade numbers only.
// Sharpe/Sortino convention (disclosed): per-trade net returns r (fractions),
// Sharpe = mean(r)/sampleStd(r) * sqrt(tradesPerYear);
// Sortino = mean(r)/downsideDev(r) * sqrt(tradesPerYear) where
// downsideDev = sqrt(mean(min(r,0)^2)) (target = 0).
import type {
  EngineRow,
  ReplayRecord,
  SellEvidenceRecord,
  SellEvidenceSummary,
  SignalMetrics,
  TradeMetrics,
  TradeRecord,
} from "./types"
import { EGX_SESSIONS_PER_YEAR } from "./constants"

export function quantile(sorted: number[], q: number): number | null {
  if (!sorted.length) return null
  const pos = (sorted.length - 1) * q
  const lo = Math.floor(pos)
  const hi = Math.ceil(pos)
  if (lo === hi) return sorted[lo]
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo)
}

export function mean(xs: number[]): number | null {
  if (!xs.length) return null
  return xs.reduce((s, x) => s + x, 0) / xs.length
}

export function median(xs: number[]): number | null {
  if (!xs.length) return null
  const s = [...xs].sort((a, b) => a - b)
  const n = s.length
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2
}

export function sampleStd(xs: number[]): number | null {
  if (xs.length < 2) return null
  const m = mean(xs) as number
  const v = xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1)
  return Math.sqrt(v)
}

export function downsideDev(xs: number[]): number | null {
  if (!xs.length) return null
  const dv = xs.reduce((s, x) => s + Math.min(x, 0) ** 2, 0) / xs.length
  return Math.sqrt(dv)
}

/** Max drawdown (%) of the multiplicative equity curve over sequential
 *  per-trade returns given in PERCENT. */
export function maxDrawdownPct(returnsPct: number[]): number | null {
  if (!returnsPct.length) return null
  let equity = 1
  let peak = 1
  let dd = 0
  for (const r of returnsPct) {
    equity *= 1 + r / 100
    peak = Math.max(peak, equity)
    dd = Math.min(dd, equity / peak - 1)
  }
  return dd * 100
}

/** Core trade metrics. `tradesPerYear` scales Sharpe/Sortino annualization. */
export function computeTradeMetrics(trades: TradeRecord[], tradesPerYear: number): TradeMetrics {
  const completed = trades.filter((t) => t.netReturnPct !== null)
  const netPct = completed.map((t) => t.netReturnPct as number)
  const netFrac = netPct.map((p) => p / 100)
  const wins = completed.filter((t) => (t.netReturnPct as number) > 0)
  const losses = completed.filter((t) => (t.netReturnPct as number) <= 0)
  const grossWinPct = wins.reduce((s, t) => s + (t.netReturnPct as number), 0)
  const grossLossPct = losses.reduce((s, t) => s + (t.netReturnPct as number), 0) // negative

  const std = sampleStd(netFrac)
  const dDev = downsideDev(netFrac)
  const m = mean(netFrac)
  const sharpe = std && std > 0 && m !== null ? (m / std) * Math.sqrt(tradesPerYear) : null
  const sortino = dDev && dDev > 0 && m !== null ? (m / dDev) * Math.sqrt(tradesPerYear) : null

  const held = completed.map((t) => t.sessionsHeld as number).filter((n) => n !== null)
  const targets = completed.filter((t) => t.outcome === "target")
  const ttt = targets.map((t) => t.sessionsHeld as number)

  const definitive = completed.filter((t) => t.outcome === "stop" || t.outcome === "target")
  const stopFirst = definitive.filter((t) => t.outcome === "stop").length

  const maeAll = completed.map((t) => t.maePct).sort((a, b) => a - b)
  const mfeAll = completed.map((t) => t.mfePct).sort((a, b) => a - b)

  return {
    trades: trades.length,
    completed: completed.length,
    open: trades.length - completed.length,
    wins: wins.length,
    losses: losses.length,
    winRatePct: completed.length ? (wins.length / completed.length) * 100 : null,
    profitFactor: grossLossPct === 0 ? (grossWinPct > 0 ? null : 0) : grossWinPct / Math.abs(grossLossPct),
    expectancyPct: mean(netPct),
    avgReturnPct: mean(netPct),
    medianReturnPct: median(netPct),
    grossWinPct,
    grossLossPct,
    maxDrawdownPct: maxDrawdownPct(netPct),
    sharpe,
    sortino,
    medianSessionsHeld: median(held),
    medianTimeToTarget: median(ttt),
    maeP50: quantile(maeAll, 0.5),
    maeP90: quantile(maeAll, 0.9),
    mfeP50: quantile(mfeAll, 0.5),
    mfeP90: quantile(mfeAll, 0.9),
    falsePositiveRatePct: definitive.length ? (stopFirst / definitive.length) * 100 : null,
    stopExits: completed.filter((t) => t.outcome === "stop").length,
    targetExits: targets.length,
    timeStopExits: completed.filter((t) => t.outcome === "timeStop").length,
  }
}

export function computeSignalMetrics(records: ReplayRecord[]): SignalMetrics {
  const buy = records.filter((r) => r.signal === "buy")
  const sell = records.filter((r) => r.signal === "sell")
  const hold = records.filter((r) => r.signal === "hold")
  const weak = records.filter((r) => r.signal === null)
  const sessions = records.length
  return {
    buySignals: buy.length,
    sellSignals: sell.length,
    holdSignals: hold.length,
    weakSignals: weak.length,
    replaySessions: sessions,
    buyPer100Sessions: sessions ? (buy.length / sessions) * 100 : 0,
    sellPer100Sessions: sessions ? (sell.length / sessions) * 100 : 0,
    planValidityRatePct: buy.length ? (buy.filter((r) => r.planValid).length / buy.length) * 100 : 0,
  }
}

export function computeSellEvidence(
  evidence: SellEvidenceRecord[],
  baselineReturns: number[],
): SellEvidenceSummary {
  const evaluable = evidence.filter((e) => e.fwdReturnPct !== null)
  const values = evaluable.map((e) => e.fwdReturnPct as number)
  return {
    signals: evidence.length,
    evaluable: evaluable.length,
    meanFwdReturnPct: mean(values),
    medianFwdReturnPct: median(values),
    correctRatePct: evaluable.length ? (values.filter((v) => v < 0).length / evaluable.length) * 100 : null,
    baselineMeanFwdReturnPct: mean(baselineReturns),
  }
}

/** Trades per company per 100 replay sessions (turnover density). */
export function turnoverPer100Sessions(trades: TradeRecord[], companies: number, replaySessions: number): number | null {
  if (!companies || !replaySessions) return null
  return (trades.length / (companies * replaySessions)) * 100
}
