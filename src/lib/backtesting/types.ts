// Backtesting framework — shared data shapes.
import type { CloseRow, TechSignalType } from "../../../.cache/engine-baseline/signals"

/** Engine input row — structurally identical to the frozen engine's CloseRow
 *  ({ ts, close, volume }); close is the ADJUSTED close (corporate-action
 *  continuity), volume is the raw session volume (production parity). */
export type EngineRow = CloseRow

export type SignalType = TechSignalType

/** Per-session replay record (what the engine said at session t, using bars
 *  [0..t] ONLY). */
export interface ReplayRecord {
  /** session date (YYYY-MM-DD) */
  ts: string
  /** index in the full validated series */
  index: number
  signal: SignalType | null
  score: number | null
  relVol: number | null
  planBias: "buy" | "sell" | null
  planStop: number | null
  planTarget: number | null
  planRiskReward: number | null
  /** plan present, sane and RR >= config.minRiskReward (BUY tradability) */
  planValid: boolean
  limitations: string[]
}

export interface SkipReasons {
  /** entry-session close outside the ±limit band vs signal-session close */
  limitLocked: number
  /** BUY signal with plan null or RR < minRiskReward */
  planInvalid: number
  /** BUY signal at the last replay session with no forward session */
  noForwardSession: number
  /** BUY signal while a position on the same ticker is open */
  positionBusy: number
}

export type TradeOutcome = "target" | "stop" | "timeStop" | "open"

export interface TradeRecord {
  ticker: string
  sector: string
  tier: string
  liquidityTercile: "T1" | "T2" | "T3" | "unknown"
  signalTs: string
  signalIndex: number
  score: number | null
  entryTs: string
  entryIndex: number
  entry: number
  stop: number
  target: number
  riskReward: number
  exitTs: string | null
  exitIndex: number | null
  exit: number | null
  outcome: TradeOutcome
  sessionsHeld: number | null
  /** (exit/entry - 1) * 100 before costs */
  grossReturnPct: number | null
  /** gross minus 2x costPerSide */
  netReturnPct: number | null
  /** max adverse excursion vs entry, % (negative = drawdown) */
  maePct: number
  /** max favorable excursion vs entry, % */
  mfePct: number
  window: "train" | "validation" | "test"
}

export interface SellEvidenceRecord {
  ticker: string
  signalTs: string
  signalIndex: number
  score: number | null
  /** close-to-close return over sellFwdHorizonSessions starting at t+1 close;
   *  negative = what a BUY-holder would have lost (SELL was correct). */
  fwdReturnPct: number | null
  window: "train" | "validation" | "test"
}

export interface TradeMetrics {
  trades: number
  completed: number
  open: number
  wins: number
  losses: number
  winRatePct: number | null
  profitFactor: number | null
  expectancyPct: number | null
  avgReturnPct: number | null
  medianReturnPct: number | null
  grossWinPct: number
  grossLossPct: number
  maxDrawdownPct: number | null
  /** per-trade returns, annualized by trades/year (convention disclosed) */
  sharpe: number | null
  sortino: number | null
  medianSessionsHeld: number | null
  medianTimeToTarget: number | null
  maeP50: number | null
  maeP90: number | null
  mfeP50: number | null
  mfeP90: number | null
  /** among definitively resolved trades (stop OR target), fraction that hit
   *  stop first — the BUY false-positive proxy */
  falsePositiveRatePct: number | null
  stopExits: number
  targetExits: number
  timeStopExits: number
}

export interface SignalMetrics {
  buySignals: number
  sellSignals: number
  holdSignals: number
  weakSignals: number
  replaySessions: number
  buyPer100Sessions: number
  sellPer100Sessions: number
  planValidityRatePct: number
}

export interface SellEvidenceSummary {
  signals: number
  evaluable: number
  meanFwdReturnPct: number | null
  medianFwdReturnPct: number | null
  /** fraction of evaluable SELL signals followed by a negative fwd return */
  correctRatePct: number | null
  /** baseline: mean fwd return over ALL sessions in the same windows */
  baselineMeanFwdReturnPct: number | null
}

export interface WindowResult {
  window: "train" | "validation" | "test"
  startDate: string | null
  endDate: string | null
  replaySessions: number
  tradesPerYear: number
  signals: SignalMetrics
  metrics: TradeMetrics
  sellEvidence: SellEvidenceSummary
}
