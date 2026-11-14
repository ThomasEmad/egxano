// EXECUTION MODEL — conservative daily-data fills, EGX price-limit lock,
// plan-based BUY management, SELL exit-evidence (no short P&L modeling).
//
// Documented assumptions (all knobs in BacktestConfig):
//   1. Signal confirmed on close t -> execution at session t+1 close. No
//      intraday fills; daily data cannot support better.
//   2. Price-limit lock: if close[t+1] vs close[t] breaches the ±band, the
//      fill is SKIPPED (untradable) and counted.
//   3. Costs: costPerSidePct charged on entry AND exit (round trip =
//      2 x costPerSidePct of traded value).
//   4. Management (BUY): exit at the first session whose close <= plan.stop
//      (stop precedence over target on the same close), first session whose
//      close >= plan.targetLow, or the time-stop session (N holding sessions
//      including the entry session). Entry-session close itself can trigger
//      (a same-session round trip is possible and realistic for limit-gapped
//      fills).
//   5. MAE/MFE are CLOSE-based excursions vs entry (the engine input is
//      close-only; intraday H/L not modeled).
//   6. SELL: no short modeling (EGX retail shorting is not realistically
//      available for most names) — forward return from t+1 close over
//      sellFwdHorizonSessions measures what a BUY-holder would have avoided.
import { DEFAULT_BACKTEST_CONFIG, type BacktestConfig } from "./constants"
import type {
  EngineRow,
  ReplayRecord,
  ReplayResult,
  SellEvidenceRecord,
  SkipReasons,
  TradeRecord,
} from "./types"

export interface TickerMeta {
  ticker: string
  sector: string
  tier: string
  liquidityTercile: "T1" | "T2" | "T3" | "unknown"
}

export interface ExecutionResult {
  trades: TradeRecord[]
  skips: SkipReasons
  sellEvidence: SellEvidenceRecord[]
}

export function emptySkips(): SkipReasons {
  return { limitLocked: 0, planInvalid: 0, noForwardSession: 0, positionBusy: 0 }
}

/** Window label for a replay index (assigned on the REPLAY session list). */
export function windowForIndex(index: number, replay: ReplayResult, counts: {
  train: number
  validation: number
  test: number
}): "train" | "validation" | "test" {
  const rel = index - replay.firstIndex
  if (rel < counts.train) return "train"
  if (rel < counts.train + counts.validation) return "validation"
  return "test"
}

/**
 * Simulate trades from replay records. Pure function; deterministic.
 */
export function simulateExecution(
  rows: EngineRow[],
  replay: ReplayResult,
  meta: TickerMeta,
  windows: { train: number; validation: number; test: number },
  config: BacktestConfig = DEFAULT_BACKTEST_CONFIG,
): ExecutionResult {
  const skips = emptySkips()
  const trades: TradeRecord[] = []
  const sellEvidence: SellEvidenceRecord[] = []
  const closes = rows.map((r) => r.close)

  let positionOpenUntil = -1 // last index occupied by an open trade

  for (const rec of replay.records) {
    const window = windowForIndex(rec.index, replay, windows)

    // ---- SELL: exit-evidence only ----
    if (rec.signal === "sell") {
      const base = rec.index + 1
      const fwd = base + config.sellFwdHorizonSessions
      const fwdReturnPct = fwd < rows.length && closes[base] > 0
        ? ((closes[fwd] / closes[base]) - 1) * 100
        : null
      sellEvidence.push({ ticker: meta.ticker, signalTs: rec.ts, signalIndex: rec.index, score: rec.score, fwdReturnPct, window })
      continue
    }

    // ---- BUY candidate ----
    if (rec.signal !== "buy") continue
    if (!rec.planValid) { skips.planInvalid++; continue }
    if (rec.index + 1 >= rows.length) { skips.noForwardSession++; continue }
    if (!config.allowOverlappingTrades && rec.index <= positionOpenUntil) { skips.positionBusy++; continue }

    const sigClose = closes[rec.index]
    const entry = closes[rec.index + 1]
    const limitMovePct = Math.abs((entry / sigClose) - 1) * 100
    if (limitMovePct > config.dailyPriceLimitPct) { skips.limitLocked++; continue }

    const stop = rec.planStop as number
    const target = rec.planTarget as number
    const rr = rec.planRiskReward as number

    // walk forward: inclusive entry session; stop precedence; time-stop
    let exitIndex: number | null = null
    let outcome: TradeRecord["outcome"] = "open"
    const holdEnd = Math.min(rows.length - 1, rec.index + config.timeStopSessions)
    for (let s = rec.index + 1; s <= holdEnd; s++) {
      if (closes[s] <= stop) { exitIndex = s; outcome = "stop"; break }
      if (closes[s] >= target) { exitIndex = s; outcome = "target"; break }
      if (s - (rec.index + 1) + 1 >= config.timeStopSessions) { exitIndex = s; outcome = "timeStop"; break }
    }

    const entrySession = rec.index + 1
    const holding = exitIndex !== null
    const sessionsHeld = exitIndex !== null ? exitIndex - entrySession + 1 : null
    const exit = exitIndex !== null ? closes[exitIndex] : null
    const grossReturnPct = holding && exit !== null ? ((exit / entry) - 1) * 100 : null
    const netReturnPct = grossReturnPct !== null
      ? grossReturnPct - 2 * config.costPerSidePct
      : null

    // MAE/MFE over the realized holding window (close-based); for open
    // trades, over everything observed so far.
    const scanTo = exitIndex ?? rows.length - 1
    let maePct = 0
    let mfePct = 0
    for (let s = entrySession; s <= scanTo; s++) {
      const exc = ((closes[s] / entry) - 1) * 100
      if (exc < maePct) maePct = exc
      if (exc > mfePct) mfePct = exc
    }

    if (exitIndex !== null) positionOpenUntil = exitIndex
    else positionOpenUntil = rows.length - 1 // still open at data end

    trades.push({
      ticker: meta.ticker,
      sector: meta.sector,
      tier: meta.tier,
      liquidityTercile: meta.liquidityTercile,
      signalTs: rec.ts,
      signalIndex: rec.index,
      score: rec.score,
      entryTs: rows[entrySession].ts,
      entryIndex: entrySession,
      entry,
      stop,
      target,
      riskReward: rr,
      exitTs: exitIndex !== null ? rows[exitIndex].ts : null,
      exitIndex,
      exit,
      outcome,
      sessionsHeld,
      grossReturnPct,
      netReturnPct,
      maePct,
      mfePct,
      window,
    })
  }

  return { trades, skips, sellEvidence }
}
