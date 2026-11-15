// OPPORTUNITY REPLAY — the Opportunity Intelligence eligibility layer measured
// on the FROZEN backtest harness (owner directive §12 historical validation).
//
// ADDITIVE ONLY: imports the existing replay/execution machinery and the pure
// opportunity modules; nothing in replay.ts/execution.ts/metrics.ts/
// walkforward.ts/segments.ts/constants.ts/types.ts or src/lib/technical/**
// is modified. This module replays the EXACT signal stream of
// scripts/backtest/run-baseline.ts (--engine=v2) and adds, ON TOP:
//
//   1. At each decision point t (the replay's evaluated sessions — bars
//      [0..t] ONLY, no lookahead): build the resistance map + target ladder
//      from TRAILING bars [0..t] exclusively, then classifyOpportunity() on
//      the BUY candidate (signalState "confirmed" — the close engine's buy
//      read; lifecycleView null — the close-engine replay carries no
//      lifecycle layer, disclosed). An opportunity "trade" = a candidate that
//      classifies ELIGIBLE ("actionable", both gates pass: strict >5% upside
//      from plan.entryHigh to the ladder's T1, plan RR ≥ 1.5).
//   2. The v2 engine's signal stream is the candidate source, reused EXACTLY:
//      the caller passes the same ReplayResult from replayEngine() and the
//      same engine fn. The replay record does not carry entryLow/entryHigh
//      (ReplayRecord keeps stop/target/RR only), so the FULL plan is
//      re-derived by calling the SAME pure engine on the SAME slice
//      rows[0..t] — deterministic (identical input ⇒ identical output), the
//      identical call replay.ts itself made, therefore the identical signal.
//   3. CONSERVATIVE EXECUTION (mirrors execution.ts semantics, extended to the
//      limit-order reality of the entry zone — every rule below is fixed and
//      documented, NO tuning):
//      • Entry: next session t+1, buy limit at entryHigh (the WORST
//        executable edge of the plan's entry zone). Fill rules from real
//        OHLC of t+1 (daily data; intraday path otherwise unobservable):
//          - open(t+1) ≤ entryHigh                → fill at open(t+1)
//            (a buy limit at/below the open fills at the open — the standard
//            daily-data limit convention; never claims entryHigh when the
//            market opened cheaper);
//          - open(t+1) > entryHigh, low(t+1) ≤ entryHigh
//                                                 → fill at entryHigh
//            (the session traded back into the zone — worst executable);
//          - open(t+1) > entryHigh, low(t+1) > entryHigh
//                                                 → GAP-THROUGH fill at
//              open(t+1) (the harness rule: a session that gapped through
//              the entry zone and never offered it fills at the open — the
//              worst executable price of that session; skipping would
//              select against strong movers).
//        The fill case is recorded per trade (fillCase).
//      • Limit lock (execution.ts parity): |close(t+1)/close(t) − 1| × 100
//        > dailyPriceLimitPct → the session is limit-locked (untradable),
//        the entry is skipped and counted.
//      • One position per ticker: an eligible decision while a trade is
//        open (through its exit session) is skipped and counted
//        (positionBusy) — execution.ts parity.
//      • Management walk (entry session = t+1, inclusive, mirroring
//        execution.ts — stop-first precedence, entry-session close can
//        trigger a same-session round trip):
//          - close(s) ≤ plan.stop             → exit "stop" at close(s)
//          - else close(s) ≥ ladder T1 price  → exit "target" at close(s)
//          - else (s − entry + 1) ≥ timeStopSessions → exit "timeStop" at
//            close(s)
//        Exit at the session CLOSE (execution.ts parity — close-only exit
//        pricing; the stop/target TESTS use closes exactly like
//        execution.ts). holdEnd = min(last, t + timeStopSessions).
//      • CONSERVATIVE AMBIGUITY: if the RESOLVING session's intraday range
//        touches BOTH levels (low ≤ stop AND high ≥ T1), stop-first wins
//        (the existing precedence) and the trade is marked ambiguous=true;
//        the ambiguous count is reported. A trade that exits on the
//        time-stop session while that bar double-touched is also marked.
//   4. P&L is FULL-EXIT-AT-T1 (conservative, execution.ts first-target
//      parity): no invented scaling parameter. T2 is OBSERVATIONAL ONLY —
//      the ladder's T2 rung is recorded and t2Reached flags whether some
//      close in the trade's ORIGINAL max-holding window
//      [entry .. t + timeStopSessions] reached T2 before any stop-close,
//      regardless of the T1 exit (measures ladder depth, not P&L — the
//      position is already out at T1).
//   5. FALSE-BREAKOUT METRIC (deterministic, documented definition; K =
//      FALSE_BREAKOUT_K_SESSIONS = 5, fixed — not tuned):
//      an entered trade is a FALSE BREAKOUT when some session s in the first
//      K holding sessions [entrySession .. entrySession + K − 1] closes
//      STRICTLY BELOW the plan's entry-zone low (close(s) < entryLow), and
//      no session up to and including that s closes at/below the plan stop
//      (close(s') ≤ stop for s' ≤ s — "without hitting stop first").
//      Activation is the eligibility decision at t + the t+1 entry; "closes
//      back below the entry zone low" includes the entry session itself
//      (e.g. an open-fill below the zone that never recovers — the breakout
//      thesis failed on day one).
//   6. THE 5% AUDIT: every entered trade is asserted to satisfy the strict
//      gate on its OWN decision geometry — upside from plan.entryHigh (the
//      eligible entry reference, at the decision date) to T1, rounded to
//      OPPORTUNITY_THRESHOLDS.upsideRoundDecimals, STRICTLY > 5.0 (the
//      identical computation classifyOpportunity performed). auditUpsideGate
//      recounts violations over any trade list; violations MUST be 0 (any
//      violation is a bug to fix before reporting). Informational (NOT a
//      violation): upside from the ACTUAL fill — gap-through/open fills can
//      erode it below 5%; that erosion is measured and disclosed.
//
// NO TUNING: every threshold comes from OPPORTUNITY_THRESHOLDS /
// TARGET_RULES / BacktestConfig / the ladder rules. Nothing here is fitted to
// outcomes; whatever falls out of the frozen window is what gets reported.
import { classifyOpportunity, OPPORTUNITY_THRESHOLDS, type OpportunityState, type OpportunityView } from "../../lib/technical/opportunity"
import { buildTargetLadder } from "../../lib/technical/opportunity-targets"
import { buildResistanceMap } from "../../lib/technical/resistance-map"
import type { CloseEngine } from "./replay"
import { windowForIndex, type TickerMeta } from "./execution"
import type { BacktestConfig } from "./constants"
import type { EngineRow, TradeRecord, TradeOutcome } from "./types"
import type { ReplayResult } from "./replay"
import type { WindowCounts } from "./walkforward"

/** Fixed, documented false-breakout horizon (sessions after entry, inclusive
 *  of the entry session). K = 5 per the §12 mission; never tuned. */
export const FALSE_BREAKOUT_K_SESSIONS = 5

/** Why the entry filled where it did (see header §3). */
export type OpportunityFillCase = "open" | "zone_edge" | "gap_through_open"

/** A completed opportunity-layer trade: execution.ts TradeRecord parity PLUS
 *  the opportunity fields. `target` carries the ladder T1 price (the P&L
 *  exit level); `targetRiskReward` is the plan's own RR (unchanged). */
export interface OpportunityTradeRecord extends TradeRecord {
  /** decision-date entry references and plan geometry */
  entryLow: number
  entryHigh: number
  /** plan stop (== TradeRecord.stop, repeated for clarity of the audit) */
  planStop: number
  /** the plan builder's own RR at decision time */
  targetRiskReward: number
  /** ladder rungs used: T1 (P&L target) and T2 (observational, null if the ladder stopped at T1) */
  t1Price: number
  t2Price: number | null
  t1Kind: string | null
  t2Kind: string | null
  /** strict-gate numbers at the decision date */
  upsidePctToT1FromEntryHigh: number
  qualifies5: boolean
  rrOk: boolean
  /** informational: strict-gate upside from the ACTUAL fill to T1 */
  upsidePctToT1FromFill: number
  fillCase: OpportunityFillCase
  /** classification metadata */
  opportunityState: "actionable"
  opportunityVersion: string
  /** the 5%-audit invariant (must be true for every entered trade) */
  gateUpheld: boolean
  /** outcome metadata beyond execution.ts parity */
  ambiguous: boolean
  t2Reached: boolean | null // null when the ladder had no T2 rung
  sessionsToT1: number | null // holding sessions to the T1 exit (target exits only)
  falseBreakout: boolean
}

/** Per-ticker funnel counters — opportunities generated vs qualifying. */
export interface OpportunityFunnel {
  decisionSessions: number
  buySignals: number
  /** plan-tradable BUY candidates fed to classifyOpportunity (the
   *  "generated opportunities" denominator) */
  planValidBuyCandidates: number
  /** of those, how many re-deriving the full plan on the identical slice
   *  failed to yield a usable BUY plan (frozen-engine contract break; must
   *  stay 0 — counted honestly, never silently dropped) */
  planRederivationMisses: number
  classified: number
  stateCounts: Record<OpportunityState, number>
  /** candidates classified ELIGIBLE (actionable, both gates pass) — the
   *  strict 5% gate's pass rate numerator */
  qualifying: number
  /** no eligible decision could execute */
  limitLocked: number
  positionBusy: number
  tradesEntered: number
}

export interface OpportunitySkips {
  limitLocked: number
  positionBusy: number
}

export interface OpportunityReplayResult {
  trades: OpportunityTradeRecord[]
  funnel: OpportunityFunnel
  skips: OpportunitySkips
}

function emptyStateCounts(): Record<OpportunityState, number> {
  const states: OpportunityState[] = ["early", "observation", "conditional", "actionable", "invalidated", "missed", "none"]
  const out = {} as Record<OpportunityState, number>
  for (const s of states) out[s] = 0
  return out
}

/** Round to `decimals` (mirror of the opportunity module's float-dust guard
 *  — the strict gate compares the ROUNDED upside). */
function roundTo(value: number, decimals: number): number {
  if (!Number.isFinite(value)) return value
  const f = Math.pow(10, decimals)
  return Math.round(value * f) / f
}

/** The strict 5%-gate computation, verbatim parity with opportunity.ts's
 *  favorablePct (buy: (T1 − entryHigh) / entryHigh × 100, rounded to the
 *  module's gate decimals, STRICTLY > 5). */
export function upsidePctFromEntryHighToT1(entryHigh: number, t1: number): number {
  return roundTo(((t1 - entryHigh) / entryHigh) * 100, OPPORTUNITY_THRESHOLDS.upsideRoundDecimals)
}

/**
 * Re-run the 5% gate over a list of entered opportunity trades (the §12
 * audit): every trade must show upside from its ACTUAL eligible entry
 * reference (plan.entryHigh, at the decision date) to T1 strictly > 5%.
 * Returns the violation count (MUST be 0) plus the observed minimum.
 */
export function auditUpsideGate(trades: OpportunityTradeRecord[]): {
  checked: number
  violations: number
  minUpsidePct: number | null
  violating: { ticker: string; decisionTs: string; upsidePct: number }[]
} {
  let violations = 0
  let min: number | null = null
  const violating: { ticker: string; decisionTs: string; upsidePct: number }[] = []
  for (const t of trades) {
    const pct = upsidePctFromEntryHighToT1(t.entryHigh, t.t1Price)
    if (min === null || pct < min) min = pct
    const ok = pct > OPPORTUNITY_THRESHOLDS.minUpsidePct && t.gateUpheld && t.qualifies5 && t.rrOk
    if (!ok) {
      violations++
      violating.push({ ticker: t.ticker, decisionTs: t.signalTs, upsidePct: pct })
    }
  }
  return { checked: trades.length, violations, minUpsidePct: min, violating }
}

/**
 * Replay the opportunity eligibility layer over ONE ticker's frozen series.
 * Pure and deterministic. `replay` MUST be the ReplayResult of replayEngine()
 * over the same rows with the same engine (the candidate source, reused
 * exactly); `engine` is the same CloseEngine, called again on the identical
 * [0..t] slices to re-derive the full plan geometry the replay record does
 * not carry.
 */
export function replayOpportunityTrades(
  rows: EngineRow[],
  replay: ReplayResult,
  meta: TickerMeta,
  windows: WindowCounts,
  config: BacktestConfig,
  engine: CloseEngine,
): OpportunityReplayResult {
  const trades: OpportunityTradeRecord[] = []
  const funnel: OpportunityFunnel = {
    decisionSessions: replay.records.length,
    buySignals: 0,
    planValidBuyCandidates: 0,
    planRederivationMisses: 0,
    classified: 0,
    stateCounts: emptyStateCounts(),
    qualifying: 0,
    limitLocked: 0,
    positionBusy: 0,
    tradesEntered: 0,
  }
  const skips: OpportunitySkips = { limitLocked: 0, positionBusy: 0 }
  const closes = rows.map((r) => r.close)

  let positionOpenUntil = -1 // last index occupied by an open trade

  for (const rec of replay.records) {
    if (rec.signal !== "buy") continue
    funnel.buySignals++
    if (!rec.planValid) continue
    funnel.planValidBuyCandidates++

    const t = rec.index
    // ---- re-derive the FULL plan on the identical truncated slice ----
    // (deterministic pure engine: identical input ⇒ identical output — the
    // same call replay.ts made; NO lookahead: the slice ends at t)
    const out = engine(rows.slice(0, t + 1))
    const plan = out.tradePlan
    if (!plan || plan.bias !== "buy") {
      // the replay said the plan was tradable; a divergence here would be a
      // frozen-engine contract break — counted honestly, never silently dropped
      funnel.planRederivationMisses++
      continue
    }
    const lastClose = closes[t]

    // ---- trailing-only evidence: map + ladder from bars [0..t] ----
    const bars = rows.slice(0, t + 1).map((r) => ({
      ts: r.ts,
      open: r.open ?? r.close,
      high: r.high ?? r.close,
      low: r.low ?? r.close,
      close: r.close,
      volume: r.volume,
    }))
    const map = buildResistanceMap(bars)
    const ladder = buildTargetLadder(map, "buy", plan.entryLow, plan.entryHigh, lastClose)

    // ---- the eligibility layer ----
    const view: OpportunityView = classifyOpportunity({
      lastClose,
      signalState: "confirmed",
      score: rec.score ?? out.score ?? 0,
      direction: "buy",
      tradePlan: plan,
      setup: null,
      lifecycleView: null, // close-engine replay: no lifecycle layer (disclosed)
      zones: map.zones,
      ladder,
    })
    funnel.classified++
    funnel.stateCounts[view.state]++

    if (!(view.state === "actionable" && view.eligible)) continue
    funnel.qualifying++

    // ---- execution gating (execution.ts parity) ----
    const window = windowForIndex(rec.index, replay, windows)
    if (rec.index + 1 >= rows.length) continue // no forward session (unreachable: replay ends at last-1)
    if (rec.index <= positionOpenUntil) {
      funnel.positionBusy++
      skips.positionBusy++
      continue
    }
    const sigClose = closes[rec.index]
    const entrySession = rec.index + 1
    const nextRow = rows[entrySession]
    const nextClose = nextRow.close
    const limitMovePct = Math.abs((nextClose / sigClose) - 1) * 100
    if (limitMovePct > config.dailyPriceLimitPct) {
      funnel.limitLocked++
      skips.limitLocked++
      continue
    }

    // ---- conservative entry fill at/from the entry zone (header §3) ----
    const entryHigh = plan.entryHigh
    const entryLow = plan.entryLow
    const open1 = nextRow.open ?? nextClose
    const low1 = nextRow.low ?? nextClose
    let entry: number
    let fillCase: OpportunityFillCase
    if (open1 <= entryHigh) {
      entry = open1
      fillCase = "open"
    } else if (low1 <= entryHigh) {
      entry = entryHigh
      fillCase = "zone_edge"
    } else {
      entry = open1
      fillCase = "gap_through_open"
    }

    // ---- ladder levels ----
    const rungs = ladder ? ladder.targets : null
    const t1 = rungs?.find((r) => r.label === "T1") ?? null
    const t2 = rungs?.find((r) => r.label === "T2") ?? null
    if (!t1) continue // unreachable for an eligible view (the gate needs T1) — defensive
    const t1Price = t1.price
    const stop = plan.stop

    // ---- management walk (execution.ts parity: stop-first precedence on
    // closes; exit priced at the session close) ----
    const holdEnd = Math.min(rows.length - 1, rec.index + config.timeStopSessions)
    let exitIndex: number | null = null
    let outcome: TradeOutcome = "open"
    let ambiguous = false
    for (let s = entrySession; s <= holdEnd; s++) {
      const bar = rows[s]
      const hi = bar.high ?? bar.close
      const lo = bar.low ?? bar.close
      if (closes[s] <= stop) {
        exitIndex = s
        outcome = "stop"
        ambiguous = lo <= stop && hi >= t1Price
        break
      }
      if (closes[s] >= t1Price) {
        exitIndex = s
        outcome = "target"
        ambiguous = lo <= stop && hi >= t1Price
        break
      }
      if (s - entrySession + 1 >= config.timeStopSessions) {
        exitIndex = s
        outcome = "timeStop"
        ambiguous = lo <= stop && hi >= t1Price
        break
      }
    }

    const holding = exitIndex !== null
    const sessionsHeld = exitIndex !== null ? exitIndex - entrySession + 1 : null
    const exit = exitIndex !== null ? closes[exitIndex] : null
    const grossReturnPct = holding && exit !== null ? ((exit / entry) - 1) * 100 : null
    const netReturnPct = grossReturnPct !== null ? grossReturnPct - 2 * config.costPerSidePct : null

    // MAE/MFE: close-based excursions vs the ACTUAL fill (execution.ts parity)
    const scanTo = exitIndex ?? rows.length - 1
    let maePct = 0
    let mfePct = 0
    for (let s = entrySession; s <= scanTo; s++) {
      const exc = ((closes[s] / entry) - 1) * 100
      if (exc < maePct) maePct = exc
      if (exc > mfePct) mfePct = exc
    }

    // ---- T2 observation (header §4): within the ORIGINAL max window,
    // before any stop-close — the position is out at T1, this is not P&L ----
    const obsEnd = Math.min(rows.length - 1, rec.index + config.timeStopSessions)
    let t2Reached: boolean | null = null
    if (t2) {
      t2Reached = false
      for (let s = entrySession; s <= obsEnd; s++) {
        if (closes[s] <= stop) break // a stop-close precedes — never reached
        if (closes[s] >= t2.price) {
          t2Reached = true
          break
        }
      }
    }

    // ---- false breakout (header §5): close back below entry-zone low
    // within K holding sessions, without a stop-close first ----
    let falseBreakout = false
    const fbEnd = Math.min(rows.length - 1, entrySession + FALSE_BREAKOUT_K_SESSIONS - 1)
    fbScan: for (let s = entrySession; s <= fbEnd; s++) {
      if (closes[s] <= stop) break // hit stop first — not a false breakout
      if (closes[s] < entryLow) {
        falseBreakout = true
        break fbScan
      }
    }

    // ---- the 5% audit invariant (recomputed on THIS trade's geometry) ----
    const upsideEntryHigh = upsidePctFromEntryHighToT1(entryHigh, t1Price)
    const upsideFill = roundTo(((t1Price - entry) / entry) * 100, OPPORTUNITY_THRESHOLDS.upsideRoundDecimals)
    const gateUpheld =
      upsideEntryHigh > OPPORTUNITY_THRESHOLDS.minUpsidePct &&
      view.qualifies5 === true &&
      view.rrOk === true &&
      plan.riskReward >= OPPORTUNITY_THRESHOLDS.minRiskReward

    if (exitIndex !== null) positionOpenUntil = exitIndex
    else positionOpenUntil = rows.length - 1 // still open at data end
    funnel.tradesEntered++

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
      target: t1Price,
      riskReward: plan.riskReward,
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
      entryLow,
      entryHigh,
      planStop: stop,
      targetRiskReward: plan.riskReward,
      t1Price,
      t2Price: t2 ? t2.price : null,
      t1Kind: t1.kind ?? null,
      t2Kind: t2 ? t2.kind ?? null : null,
      upsidePctToT1FromEntryHigh: upsideEntryHigh,
      qualifies5: view.qualifies5,
      rrOk: view.rrOk,
      upsidePctToT1FromFill: upsideFill,
      fillCase,
      opportunityState: "actionable",
      opportunityVersion: view.opportunityVersion,
      gateUpheld,
      ambiguous,
      t2Reached,
      sessionsToT1: outcome === "target" ? sessionsHeld : null,
      falseBreakout,
    })
  }

  return { trades, funnel, skips }
}
