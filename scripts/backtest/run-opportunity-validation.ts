// OPPORTUNITY VALIDATION RUNNER (owner directive §12 historical validation).
//
//   npx tsx scripts/backtest/run-opportunity-validation.ts
//
// Replays the Opportunity Intelligence eligibility layer over the SAME frozen
// window as the v2 baseline (baseline-results-v2.json: same universe.json
// retention, same validated series, same BacktestConfig, same 60/20/20
// walk-forward split, same v2 signal stream) and measures the §12 metric list.
// NO LOOKAHEAD: every decision at session t uses bars [0..t] only. NO TUNING:
// whatever falls out of the frozen window is what gets reported.
//
// Writes .cache/bt/opportunity-validation-results.json and prints a summary
// table. Requires DATABASE_URL set (placeholder ok) — the engine import
// transitively constructs the Prisma client (never queried).
if (!process.env.DATABASE_URL) process.env.DATABASE_URL = "postgresql://placeholder:placeholder@localhost:5432/placeholder"

import { existsSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"

import { DEFAULT_BACKTEST_CONFIG, EGX_SESSIONS_PER_YEAR, type BacktestConfig } from "../../src/lib/backtesting/constants"
import { validateSeries, type CachedQuote, type SeriesValidation } from "../../src/lib/backtesting/data-quality"
import { type TickerMeta } from "../../src/lib/backtesting/execution"
import { computeTradeMetrics, mean, median } from "../../src/lib/backtesting/metrics"
import { replayEngine } from "../../src/lib/backtesting/replay"
import { auditUpsideGate, replayOpportunityTrades, type OpportunityFunnel, type OpportunityTradeRecord } from "../../src/lib/backtesting/opportunity-replay"
import { segmentByLiquidity, segmentByScoreBand, segmentBySector, segmentByTier } from "../../src/lib/backtesting/segments"
import type { EngineRow, TradeMetrics } from "../../src/lib/backtesting/types"
import { splitWindows, type WindowDates } from "../../src/lib/backtesting/walkforward"
// The signal stream MUST be the same frozen engine that produced
// baseline-results-v2.json (replay.ts's own default, .cache/engine-baseline).
// The in-tree signals.ts drifted after the parity/rounding remediation — its
// close path returns null plans on the cached data — which would leave the
// eligibility layer zero candidates and void the comparison.
import { computeCloseSignal as v2ComputeCloseSignal } from "../../.cache/engine-baseline/signals"

const ROOT = path.resolve(import.meta.dirname, "../..")
const BT = path.join(ROOT, ".cache/bt")

interface UniverseCandidate { ticker: string; nameEn: string | null; sector: string; tier: string; listingStatus: string | null; isDemoData: boolean | null }

// ---------------------------------------------------------------------------
// Load + validate — EXACT run-baseline retention (first 10 valid per bucket)
// ---------------------------------------------------------------------------

const uni = JSON.parse(readFileSync(path.join(BT, "universe.json"), "utf8")) as {
  generatedAt: string
  selectionRule: string
  candidates: UniverseCandidate[][]
}
const cfg: BacktestConfig = DEFAULT_BACKTEST_CONFIG
const retained: { meta: TickerMeta; rows: EngineRow[]; validation: SeriesValidation }[] = []
const skipped: { ticker: string; bucket: string; reason: string }[] = []

let bucketNo = 0
for (const bucket of uni.candidates) {
  const bucketName = bucket[0]?.tier ?? `bucket${bucketNo}`
  let kept = 0
  for (const cand of bucket) {
    const qPath = path.join(BT, `${cand.ticker}.json`)
    if (!existsSync(qPath)) { skipped.push({ ticker: cand.ticker, bucket: bucketName, reason: "no cached Yahoo quote" }); continue }
    const quote = JSON.parse(readFileSync(qPath, "utf8")) as CachedQuote
    const v = validateSeries(quote, cfg)
    if (!v.ok) { skipped.push({ ticker: cand.ticker, bucket: bucketName, reason: v.reasons.join("; ") }); continue }
    if (kept >= 10) { skipped.push({ ticker: cand.ticker, bucket: bucketName, reason: "bucket already full (10 valid names)" }); continue }
    retained.push({
      meta: { ticker: cand.ticker, sector: cand.sector || "Other", tier: bucketName, liquidityTercile: "unknown" },
      rows: v.rows,
      validation: v,
    })
    kept++
  }
  bucketNo++
}

// liquidity terciles by mean ADV (EGP) — run-baseline parity
const advs = retained.map((r) => r.validation.stats.meanAdvEgp as number).sort((a, b) => a - b)
const quantileAt = (sorted: number[], q: number): number => {
  if (!sorted.length) return NaN
  const pos = (sorted.length - 1) * q
  const lo = Math.floor(pos), hi = Math.ceil(pos)
  return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo)
}
const t1 = quantileAt(advs, 1 / 3)
const t2 = quantileAt(advs, 2 / 3)
for (const r of retained) {
  const adv = r.validation.stats.meanAdvEgp as number
  r.meta.liquidityTercile = adv <= (t1 as number) ? "T1" : adv <= (t2 as number) ? "T2" : "T3"
}

// frozen-window parity check against the v2 baseline results
const baseline = JSON.parse(readFileSync(path.join(BT, "baseline-results-v2.json"), "utf8")) as {
  engine: { signalsVersion: string }
  universe: { retained: string[] }
  walkForward: { windows: WindowDates }
  overall: { metrics: TradeMetrics; signals: { buySignals: number; replaySessions: number } }
  windows: Record<string, { startDate: string | null; endDate: string | null; replaySessions: number; metrics: TradeMetrics }>
}
const sameUniverse = JSON.stringify([...retained.map((r) => r.meta.ticker)].sort()) === JSON.stringify([...baseline.universe.retained].sort())
if (!sameUniverse) {
  console.error("FATAL: retained universe differs from baseline-results-v2.json — aborting (frozen-window parity broken)")
  process.exit(1)
}

// ---------------------------------------------------------------------------
// Replay per ticker: v2 signal stream + opportunity eligibility layer
// ---------------------------------------------------------------------------

const allTrades: OpportunityTradeRecord[] = []
const funnels: Record<string, OpportunityFunnel> = {}
let windowDates: WindowDates | null = null
const sessionsByWindow = { train: 0, validation: 0, test: 0 }

for (const r of retained) {
  const replay = replayEngine(r.rows, cfg, v2ComputeCloseSignal)
  const { counts, dates } = splitWindows(replay)
  if (windowDates === null) windowDates = dates
  for (const rec of replay.records) {
    const rel = rec.index - replay.firstIndex
    const w = rel < counts.train ? "train" : rel < counts.train + counts.validation ? "validation" : "test"
    sessionsByWindow[w]++
  }
  const res = replayOpportunityTrades(r.rows, replay, r.meta, counts, cfg, v2ComputeCloseSignal)
  funnels[r.meta.ticker] = res.funnel
  allTrades.push(...res.trades)
}

const dates = windowDates as WindowDates
// frozen-window parity: identical session grid + split as the v2 baseline
const sameWindows = dates.train.start === baseline.walkForward.windows.train.start &&
  dates.train.end === baseline.walkForward.windows.train.end &&
  dates.test.end === baseline.walkForward.windows.test.end
if (!sameWindows) {
  console.error("FATAL: walk-forward window dates differ from baseline-results-v2.json — aborting")
  process.exit(1)
}

// pooled chronological order (run-baseline parity)
const sortedTrades = [...allTrades].sort((a, b) =>
  a.entryTs === b.entryTs ? a.ticker.localeCompare(b.ticker) : a.entryTs < b.entryTs ? -1 : 1,
)

// ---------------------------------------------------------------------------
// §12 metrics
// ---------------------------------------------------------------------------

const funnelTotal: OpportunityFunnel = {
  decisionSessions: 0, buySignals: 0, planValidBuyCandidates: 0, planRederivationMisses: 0,
  classified: 0,
  stateCounts: { early: 0, observation: 0, conditional: 0, actionable: 0, invalidated: 0, missed: 0, none: 0 },
  qualifying: 0, limitLocked: 0, positionBusy: 0, tradesEntered: 0,
}
for (const f of Object.values(funnels)) {
  funnelTotal.decisionSessions += f.decisionSessions
  funnelTotal.buySignals += f.buySignals
  funnelTotal.planValidBuyCandidates += f.planValidBuyCandidates
  funnelTotal.planRederivationMisses += f.planRederivationMisses
  funnelTotal.classified += f.classified
  for (const k of Object.keys(f.stateCounts) as (keyof OpportunityFunnel["stateCounts"])[]) {
    funnelTotal.stateCounts[k] += f.stateCounts[k]
  }
  funnelTotal.qualifying += f.qualifying
  funnelTotal.limitLocked += f.limitLocked
  funnelTotal.positionBusy += f.positionBusy
  funnelTotal.tradesEntered += f.tradesEntered
}

const audit = auditUpsideGate(sortedTrades)

const completed = sortedTrades.filter((tr) => tr.netReturnPct !== null)
const definitive = completed.filter((tr) => tr.outcome === "stop" || tr.outcome === "target")
const t1First = definitive.filter((tr) => tr.outcome === "target")
const t2WithRung = sortedTrades.filter((tr) => tr.t2Price !== null && tr.t2Reached !== null)
const t2Reached = t2WithRung.filter((tr) => tr.t2Reached === true)
const sessionsToT1 = completed.filter((tr) => tr.sessionsToT1 !== null).map((tr) => tr.sessionsToT1 as number)
const fbRate = sortedTrades.length ? (sortedTrades.filter((tr) => tr.falseBreakout).length / sortedTrades.length) * 100 : null
const ambiguousCount = sortedTrades.filter((tr) => tr.ambiguous).length
const fillEroded = sortedTrades.filter((tr) => tr.upsidePctToT1FromFill <= 5).length
const fillCases = sortedTrades.reduce<Record<string, number>>((acc, tr) => { acc[tr.fillCase] = (acc[tr.fillCase] ?? 0) + 1; return acc }, {})

const yearsTotal = funnelTotal.decisionSessions / EGX_SESSIONS_PER_YEAR
const tradesPerYearOverall = yearsTotal > 0 ? completed.length / yearsTotal : 0
const pooledMetrics = computeTradeMetrics(sortedTrades, tradesPerYearOverall)

const avgMfe = mean(completed.map((tr) => tr.mfePct))
const avgMae = mean(completed.map((tr) => tr.maePct))

// per-window metrics + funnel
const windowsOut: Record<string, ReturnType<typeof windowBlock>> = {}
function windowBlock(w: "train" | "validation" | "test") {
  const trades = sortedTrades.filter((tr) => tr.window === w)
  const nSessions = sessionsByWindow[w]
  const years = nSessions / EGX_SESSIONS_PER_YEAR
  const tpy = years > 0 ? trades.filter((tr) => tr.netReturnPct !== null).length / years : 0
  const m = computeTradeMetrics(trades, tpy)
  const classified = [...Object.values(funnels)].length // placeholder, replaced below
  void classified
  return { trades, metrics: m, sessions: nSessions, tpy }
}
for (const w of ["train", "validation", "test"] as const) windowsOut[w] = windowBlock(w)

// per-window funnel (recount from per-ticker funnels by re-deriving windows is
// unnecessary: decisions carry no window on the funnel — recount from trades +
// sessions and report decision sessions per window)
const tradesByWindow = {
  train: sortedTrades.filter((t) => t.window === "train").length,
  validation: sortedTrades.filter((t) => t.window === "validation").length,
  test: sortedTrades.filter((t) => t.window === "test").length,
}

// segments (segments.ts helpers reused on the TradeRecord-compatible records)
const segments = {
  bySector: segmentBySector(sortedTrades),
  byLiquidity: segmentByLiquidity(sortedTrades),
  byScoreBand: segmentByScoreBand(sortedTrades),
  byTier: segmentByTier(sortedTrades),
}

// ---------------------------------------------------------------------------
// Write results + print summary
// ---------------------------------------------------------------------------

const results = {
  generatedAt: new Date().toISOString(),
  mission: "owner directive §12 — historical validation of the Opportunity Intelligence eligibility rules on the frozen backtest harness",
  engine: {
    signalSource: baseline.engine.signalsVersion + " (the v2 engine signal stream, reused exactly via replayEngine)",
    eligibilityLayer: "opportunity@1 (classifyOpportunity) + resistance-map@1 + opportunity-targets@1, all rebuilt per decision from trailing bars [0..t] only",
  },
  config: cfg,
  frozenWindowParity: {
    universeIdentical: sameUniverse,
    retained: retained.map((r) => r.meta.ticker),
    windowDates: dates,
    windowDatesMatchBaseline: sameWindows,
  },
  funnel: funnelTotal,
  qualifyingRatePctOfCandidates: funnelTotal.classified ? (funnelTotal.qualifying / funnelTotal.classified) * 100 : null,
  qualifyingRatePctOfBuySignals: funnelTotal.buySignals ? (funnelTotal.qualifying / funnelTotal.buySignals) * 100 : null,
  audit,
  tradeStats: {
    entered: sortedTrades.length,
    completed: completed.length,
    open: sortedTrades.length - completed.length,
    t1BeforeStopPct: definitive.length ? (t1First.length / definitive.length) * 100 : null,
    stopRatePct: completed.length ? (pooledMetrics.stopExits / completed.length) * 100 : null,
    t2ReachedPctOfRungTrades: t2WithRung.length ? (t2Reached.length / t2WithRung.length) * 100 : null,
    t2WithRung: t2WithRung.length,
    ambiguousCount,
    falseBreakoutRatePct: fbRate,
    medianSessionsToT1: median(sessionsToT1),
    avgMfePct: avgMfe,
    avgMaePct: avgMae,
    fillCases,
    fillErodedBelow5Pct: fillEroded,
    upsidePctFromFillMin: sortedTrades.length ? Math.min(...sortedTrades.map((t) => t.upsidePctToT1FromFill)) : null,
  },
  pooledMetrics,
  windows: Object.fromEntries(
    (["train", "validation", "test"] as const).map((w) => [w, {
      startDate: dates[w].start,
      endDate: dates[w].end,
      decisionSessions: sessionsByWindow[w],
      trades: tradesByWindow[w],
      completed: windowsOut[w].metrics.completed,
      metrics: windowsOut[w].metrics,
    }]),
  ),
  segments,
  perTickerFunnel: funnels,
  perTickerTrades: Object.values(funnels).map((f) => f.tradesEntered).reduce((a, b) => a + b, 0),
  comparisonBasis: "v2 baseline numbers read from .cache/bt/baseline-results-v2.json (same frozen window, verified above)",
  disclosure: {
    noTuning: "Every threshold comes from OPPORTUNITY_THRESHOLDS / TARGET_RULES / BacktestConfig / the ladder rules. Nothing was fitted to outcomes; the honest numbers are reported as measured.",
    noLookahead: "Every decision at session t rebuilds the resistance map, target ladder and classification from bars [0..t] ONLY; the plan is re-derived on the identical slice replay.ts used; the entry/exit walk uses t+1.. data (the execution session).",
    ambiguity: "A resolving session whose intraday range touches BOTH stop and T1 exits stop-first (execution.ts precedence) and is marked ambiguous; the ambiguous count is reported separately.",
    falseBreakout: "An entered trade is a FALSE BREAKOUT when some session in the first K=5 holding sessions (entry session inclusive) closes strictly below the plan's entry-zone low, and no session up to and including that one closes at/below the plan stop ('without hitting stop first'). K is fixed, not tuned.",
    pnl: "P&L is full-exit-at-T1 (execution.ts first-target parity, no invented scaling parameter). The ladder's T2 rung is OBSERVATIONAL ONLY: t2Reached flags a close at/above T2 within the trade's original max-holding window before any stop-close, regardless of the T1 exit.",
    fillModel: "Buy limit at entryHigh on t+1: open<=entryHigh → fill at open; open>entryHigh and low<=entryHigh → fill at entryHigh; open and low > entryHigh (gap-through) → fill at the open (harness gap-through rule). |close(t+1)/close(t)-1|>20% → limit-locked skip (execution.ts parity).",
    fivePctAudit: "Per entered trade the gate is recomputed on its own decision geometry: upside from plan.entryHigh (decision date) to the ladder T1, rounded to 4 decimals, STRICTLY > 5.0. Violations must be 0. Upside from the ACTUAL fill is reported informationally (gap-through fills erode it).",
    survivorship: baseline.universe.retained.length + " currently-listed tickers — the same universe/survivorship limitation as the v2 baseline.",
  },
}

writeFileSync(path.join(BT, "opportunity-validation-results.json"), JSON.stringify(results, null, 1))

// ---- stdout summary ----
const pct = (v: number | null | undefined, d = 1): string => (v === null || v === undefined || !Number.isFinite(v) ? "—" : `${v.toFixed(d)}%`)
const num = (v: number | null | undefined, d = 2): string => (v === null || v === undefined || !Number.isFinite(v) ? "—" : v.toFixed(d))

console.log("=== OPPORTUNITY VALIDATION (frozen window, v2 signal stream + opportunity@1 eligibility) ===")
console.log(`universe: ${retained.length} tickers — identical to baseline-results-v2: ${sameUniverse} | windows ${dates.train.start} → ${dates.test.end} (match: ${sameWindows})`)
console.log(`FUNNEL: decision sessions ${funnelTotal.decisionSessions} | buy signals ${funnelTotal.buySignals} | plan-valid candidates ${funnelTotal.planValidBuyCandidates} (classified) | qualifying ${funnelTotal.qualifying}`)
console.log(`  HEADLINE qualifying rate: ${pct(funnelTotal.classified ? (funnelTotal.qualifying / funnelTotal.classified) * 100 : null)} of classified candidates (${pct(funnelTotal.buySignals ? (funnelTotal.qualifying / funnelTotal.buySignals) * 100 : null)} of buy signals)`)
console.log(`  states: actionable ${funnelTotal.stateCounts.actionable} | conditional ${funnelTotal.stateCounts.conditional} | observation ${funnelTotal.stateCounts.observation} | missed ${funnelTotal.stateCounts.missed} | none ${funnelTotal.stateCounts.none} | invalidated ${funnelTotal.stateCounts.invalidated}`)
console.log(`  execution skips: limit-locked ${funnelTotal.limitLocked} | position-busy ${funnelTotal.positionBusy} → trades entered ${funnelTotal.tradesEntered}`)
console.log(`5% AUDIT: checked ${audit.checked} | violations ${audit.violations} | min upside-from-entryHigh ${pct(audit.minUpsidePct, 4)} (MUST be 0 violations)`)
console.log(`TRADE STATS: T1-before-stop ${pct(results.tradeStats.t1BeforeStopPct)} | stop rate ${pct(results.tradeStats.stopRatePct)} | T2-reached ${pct(results.tradeStats.t2ReachedPctOfRungTrades)} (of ${results.tradeStats.t2WithRung} with a T2 rung) | ambiguous ${ambiguousCount} | false-breakout ${pct(fbRate)} | median sessions-to-T1 ${num(results.tradeStats.medianSessionsToT1, 1)}`)
console.log(`  avg MFE ${pct(avgMfe)} / avg MAE ${pct(avgMae)} | fills: ${JSON.stringify(fillCases)} | fill-eroded-below-5% ${fillEroded}`)
console.log(`POOLED: trades ${pooledMetrics.trades} (completed ${pooledMetrics.completed}, open ${pooledMetrics.open}) | win ${pct(pooledMetrics.winRatePct)} | PF ${num(pooledMetrics.profitFactor)} | expectancy ${pct(pooledMetrics.expectancyPct)} | maxDD ${pct(pooledMetrics.maxDrawdownPct)}`)
console.log(`         v2 baseline on the same window: trades ${baseline.overall.metrics.trades} | win ${pct(baseline.overall.metrics.winRatePct)} | PF ${num(baseline.overall.metrics.profitFactor)} | expectancy ${pct(baseline.overall.metrics.expectancyPct)} | maxDD ${pct(baseline.overall.metrics.maxDrawdownPct)}`)
for (const w of ["train", "validation", "test"] as const) {
  const m = windowsOut[w].metrics
  const b = baseline.windows[w].metrics
  console.log(`${w.toUpperCase().padEnd(11)}: decision sessions ${sessionsByWindow[w]} | opp trades ${m.completed} | win ${pct(m.winRatePct)} | PF ${num(m.profitFactor)} | exp ${pct(m.expectancyPct)} | maxDD ${pct(m.maxDrawdownPct)}   ||  v2: trades ${b.completed} | win ${pct(b.winRatePct)} | PF ${num(b.profitFactor)} | exp ${pct(b.expectancyPct)}`)
}
console.log(`SEGMENTS (opportunity trades): sectors ${segments.bySector.length} | liquidity ${segments.byLiquidity.map((s) => `${s.segment}:${s.trades}`).join(" ")} | tiers ${segments.byTier.map((s) => `${s.segment}:${s.trades}`).join(" ")}`)
console.log(`written: .cache/bt/opportunity-validation-results.json`)
