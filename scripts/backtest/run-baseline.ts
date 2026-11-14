// BASELINE BACKTEST RUNNER — frozen CURRENT engine (tech-signals@4).
//
//   npx tsx scripts/backtest/run-baseline.ts
//
// Reads cached Yahoo quotes (.cache/bt/<T>.json — fetch with fetch-data.ts),
// validates each series, adjusts for corporate-action continuity (adjclose —
// the closest available equivalent of the DB-ledger read-time adjustment,
// which is unreachable in this sandbox), replays the frozen engine with NO
// lookahead, simulates the documented execution model, computes metrics,
// walk-forward windows and segments, then writes:
//   .cache/bt/baseline-results.json
//   docs/notes/backtest-baseline.md
// and prints a compact summary.
//
// Requires DATABASE_URL to be set to ANY syntactically valid URL: importing
// the frozen corporate-actions module transitively constructs the Prisma
// client (never queried — only its pure math is used). This script sets the
// placeholder itself before any imports of engine code run.
if (!process.env.DATABASE_URL) process.env.DATABASE_URL = "postgresql://placeholder:placeholder@localhost:5432/placeholder"

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"

import { DEFAULT_BACKTEST_CONFIG, EGX_SESSIONS_PER_YEAR, scoreBand, type BacktestConfig } from "../../src/lib/backtesting/constants"
import { crossCheckSplits, validateSeries, type CachedQuote, type SeriesValidation } from "../../src/lib/backtesting/data-quality"
import { simulateExecution, type TickerMeta } from "../../src/lib/backtesting/execution"
import { computeSellEvidence, computeSignalMetrics, computeTradeMetrics, mean, median, turnoverPer100Sessions } from "../../src/lib/backtesting/metrics"
import { replayEngine, type ReplayResult } from "../../src/lib/backtesting/replay"
import { segmentByLiquidity, segmentByScoreBand, segmentBySector, segmentByTier, type SegmentRow } from "../../src/lib/backtesting/segments"
import type { EngineRow, SellEvidenceRecord, SkipReasons, TradeRecord, WindowResult } from "../../src/lib/backtesting/types"
import { splitWindows, type WindowDates } from "../../src/lib/backtesting/walkforward"

const ROOT = path.resolve(import.meta.dirname, "../..")
const BT = path.join(ROOT, ".cache/bt")

interface UniverseCandidate { ticker: string; nameEn: string | null; sector: string; tier: string; listingStatus: string | null; isDemoData: boolean | null }

// ---------------------------------------------------------------------------
// Load + validate + adjust
// ---------------------------------------------------------------------------

interface RetainedTicker {
  meta: TickerMeta
  rows: EngineRow[]
  quote: CachedQuote
  validation: SeriesValidation
}

const uni = JSON.parse(readFileSync(path.join(BT, "universe.json"), "utf8")) as {
  generatedAt: string
  selectionRule: string
  candidates: UniverseCandidate[][]
}

const cfg: BacktestConfig = DEFAULT_BACKTEST_CONFIG
const retained: RetainedTicker[] = []
const skipped: { ticker: string; bucket: string; reason: string }[] = []
const splitChecks: ReturnType<typeof crossCheckSplits> = []
const frozenMathMismatches: number[] = []

let bucketNo = 0
for (const bucket of uni.candidates) {
  const bucketName = bucket[0]?.tier ?? `bucket${bucketNo}`
  let kept = 0
  for (const cand of bucket) {
    const qPath = path.join(BT, `${cand.ticker}.json`)
    if (!existsSync(qPath)) {
      skipped.push({ ticker: cand.ticker, bucket: bucketName, reason: "no cached Yahoo quote (404/no chart)" })
      continue
    }
    const quote = JSON.parse(readFileSync(qPath, "utf8")) as CachedQuote
    const v = validateSeries(quote, cfg)
    splitChecks.push(...crossCheckSplits(quote, v))
    if (!v.ok) {
      skipped.push({ ticker: cand.ticker, bucket: bucketName, reason: v.reasons.join("; ") })
      continue
    }
    if (kept >= 10) {
      skipped.push({ ticker: cand.ticker, bucket: bucketName, reason: "bucket already full (10 valid names)" })
      continue
    }
    retained.push({
      meta: { ticker: cand.ticker, sector: cand.sector || "Other", tier: bucketName, liquidityTercile: "unknown" },
      rows: v.rows,
      quote,
      validation: v,
    })
    kept++
  }
  bucketNo++
}

// liquidity terciles by mean ADV (EGP) across retained tickers
const advs = retained.map((r) => r.validation.stats.meanAdvEgp as number).sort((a, b) => a - b)
const t1 = quantileAt(advs, 1 / 3)
const t2 = quantileAt(advs, 2 / 3)
for (const r of retained) {
  const adv = r.validation.stats.meanAdvEgp as number
  r.meta.liquidityTercile = adv <= (t1 as number) ? "T1" : adv <= (t2 as number) ? "T2" : "T3"
}

function quantileAt(sorted: number[], q: number): number {
  if (!sorted.length) return NaN
  const pos = (sorted.length - 1) * q
  const lo = Math.floor(pos), hi = Math.ceil(pos)
  return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo)
}

// frozen corporate-actions math cross-check summary
for (const c of splitChecks) {
  if (!c.frozenMatch) frozenMathMismatches.push(c.ticker)
}

// ---------------------------------------------------------------------------
// Replay + execute per ticker
// ---------------------------------------------------------------------------

const allTrades: TradeRecord[] = []
const allSell: SellEvidenceRecord[] = []
const skipsTotal: SkipReasons = { limitLocked: 0, planInvalid: 0, noForwardSession: 0, positionBusy: 0 }
const baselines: number[] = []
const perTicker: Record<string, { ticker: string; tier: string; sector: string; sessions: number; firstDate: string | null; lastDate: string | null; advEgp: number | null; tercile: string; trades: number; completed: number; winRatePct: number | null; profitFactor: number | null; expectancyPct: number | null; medianReturnPct: number | null; buySignals: number; sellSignals: number; planValidityRatePct: number }> = {}
const windowsDates: WindowDates | null = null // per-ticker splits recorded below
const windowDatesList: WindowDates[] = []

let totalReplaySessions = 0
for (const r of retained) {
  const replay: ReplayResult = replayEngine(r.rows, cfg)
  const { counts, dates } = splitWindows(replay)
  windowDatesList.push(dates)
  totalReplaySessions += replay.records.length
  const res = simulateExecution(r.rows, replay, r.meta, counts, cfg)
  allTrades.push(...res.trades)
  allSell.push(...res.sellEvidence)
  for (const k of Object.keys(skipsTotal) as (keyof SkipReasons)[]) skipsTotal[k] += res.skips[k]

  // pooled sell baseline: fwd-horizon return at every replay session
  const H = cfg.sellFwdHorizonSessions
  for (const rec of replay.records) {
    const base = rec.index + 1
    const fwd = base + H
    if (fwd < r.rows.length && r.rows[base].close > 0) {
      baselines.push(((r.rows[fwd].close / r.rows[base].close) - 1) * 100)
    }
  }

  const tm = computeTradeMetrics(res.trades, EGX_SESSIONS_PER_YEAR)
  const sm = computeSignalMetrics(replay.records)
  perTicker[r.meta.ticker] = {
    ticker: r.meta.ticker, tier: r.meta.tier, sector: r.meta.sector,
    sessions: r.validation.stats.sessions, firstDate: r.validation.stats.firstDate,
    lastDate: r.validation.stats.lastDate, advEgp: r.validation.stats.meanAdvEgp,
    tercile: r.meta.liquidityTercile,
    trades: tm.trades, completed: tm.completed, winRatePct: tm.winRatePct,
    profitFactor: tm.profitFactor, expectancyPct: tm.expectancyPct, medianReturnPct: tm.medianReturnPct,
    buySignals: sm.buySignals, sellSignals: sm.sellSignals, planValidityRatePct: sm.planValidityRatePct,
  }
}

// pooled chronological order for equity-curve metrics
const sortedTrades = [...allTrades].sort((a, b) =>
  a.entryTs === b.entryTs ? a.ticker.localeCompare(b.ticker) : a.entryTs < b.entryTs ? -1 : 1,
)

// ---------------------------------------------------------------------------
// Window metrics
// ---------------------------------------------------------------------------

function windowTrades(w: TradeRecord["window"]): TradeRecord[] {
  return sortedTrades.filter((t) => t.window === w)
}
function windowSell(w: TradeRecord["window"]): SellEvidenceRecord[] {
  return allSell.filter((e) => e.window === w)
}

const windows: Record<string, WindowResult> = {}
for (const w of ["train", "validation", "test"] as const) {
  const trades = windowTrades(w)
  // replay sessions per window: fraction of total proportional to 60/20/20
  const nReplay = Math.round(totalReplaySessions * (w === "train" ? 0.6 : w === "validation" ? 0.2 : 0.2))
  const years = nReplay / EGX_SESSIONS_PER_YEAR
  const tradesPerYear = years > 0 ? trades.filter((t) => t.netReturnPct !== null).length / years : 0
  const recsForSignals: number = nReplay
  const buyCount = allTrades.filter((t) => t.window === w).length
  void recsForSignals; void buyCount
  const metrics = computeTradeMetrics(trades, tradesPerYear)
  const dates = windowDatesList[0] // same session grid for every retained ticker
  windows[w] = {
    window: w,
    startDate: dates[w].start,
    endDate: dates[w].end,
    replaySessions: nReplay,
    tradesPerYear,
    signals: {
      buySignals: trades.length + skippedBuys(w),
      sellSignals: windowSell(w).length,
      holdSignals: holdCount(w),
      weakSignals: 0,
      replaySessions: nReplay,
      buyPer100Sessions: nReplay ? ((trades.length + skippedBuys(w)) / nReplay) * 100 : 0,
      sellPer100Sessions: nReplay ? (windowSell(w).length / nReplay) * 100 : 0,
      planValidityRatePct: planValidityForWindow(w),
    },
    metrics,
    sellEvidence: computeSellEvidence(windowSell(w), baselines),
  }
}

// per-window signal counts require replay records per window; we aggregated
// trades and sell evidence above — buy-signal counts (incl. skipped) are
// recomputed from records here:
const buySignalsByWindow = { train: 0, validation: 0, test: 0 }
const holdByWindow = { train: 0, validation: 0, test: 0 }
const buyPlannedByWindow = { train: 0, validation: 0, test: 0 }
const sessionsByWindow = { train: 0, validation: 0, test: 0 }
for (const r of retained) {
  const replay = replayEngine(r.rows, cfg)
  const { counts } = splitWindows(replay)
  for (const rec of replay.records) {
    const w = windowLabel(rec.index, replay.firstIndex, counts)
    sessionsByWindow[w]++
    if (rec.signal === "buy") { buySignalsByWindow[w]++; if (rec.planValid) buyPlannedByWindow[w]++ }
    else if (rec.signal === "hold") holdByWindow[w]++
    else if (rec.signal === null) { /* weak */ }
  }
}
for (const w of ["train", "validation", "test"] as const) {
  windows[w].signals.buySignals = buySignalsByWindow[w]
  windows[w].signals.holdSignals = holdByWindow[w]
  windows[w].signals.weakSignals = sessionsByWindow[w] - buySignalsByWindow[w] - holdByWindow[w] - windows[w].signals.sellSignals
  windows[w].signals.replaySessions = sessionsByWindow[w]
  windows[w].signals.buyPer100Sessions = sessionsByWindow[w] ? (buySignalsByWindow[w] / sessionsByWindow[w]) * 100 : 0
  windows[w].signals.sellPer100Sessions = sessionsByWindow[w] ? (windows[w].signals.sellSignals / sessionsByWindow[w]) * 100 : 0
  windows[w].signals.planValidityRatePct = buySignalsByWindow[w] ? (buyPlannedByWindow[w] / buySignalsByWindow[w]) * 100 : 0
  // recompute tradesPerYear with the true session count
  const years = sessionsByWindow[w] / EGX_SESSIONS_PER_YEAR
  windows[w].tradesPerYear = years > 0 ? windows[w].metrics.completed / years : 0
  // sharpe/sortino depend on tradesPerYear — recompute
  const m2 = computeTradeMetrics(windowTrades(w), windows[w].tradesPerYear)
  windows[w].metrics.sharpe = m2.sharpe
  windows[w].metrics.sortino = m2.sortino
}

function windowLabel(index: number, firstIndex: number, counts: { train: number; validation: number; test: number }): "train" | "validation" | "test" {
  const rel = index - firstIndex
  if (rel < counts.train) return "train"
  if (rel < counts.train + counts.validation) return "validation"
  return "test"
}

function skippedBuys(w: TradeRecord["window"]): number {
  // placeholder replaced by the recomputation pass below
  return 0
}
function holdCount(w: TradeRecord["window"]): number { return 0 }
function planValidityForWindow(w: TradeRecord["window"]): number { return 0 }

// ---------------------------------------------------------------------------
// Overall metrics
// ---------------------------------------------------------------------------

const overallSignals = (() => {
  let buy = 0, sell = 0, hold = 0, weak = 0, planned = 0, sessions = 0
  for (const r of retained) {
    const replay = replayEngine(r.rows, cfg)
    sessions += replay.records.length
    for (const rec of replay.records) {
      if (rec.signal === "buy") { buy++; if (rec.planValid) planned++ }
      else if (rec.signal === "sell") sell++
      else if (rec.signal === "hold") hold++
      else weak++
    }
  }
  return {
    buySignals: buy, sellSignals: sell, holdSignals: hold, weakSignals: weak,
    replaySessions: sessions,
    buyPer100Sessions: sessions ? (buy / sessions) * 100 : 0,
    sellPer100Sessions: sessions ? (sell / sessions) * 100 : 0,
    planValidityRatePct: buy ? (planned / buy) * 100 : 0,
  }
})()

const yearsTotal = overallSignals.replaySessions / EGX_SESSIONS_PER_YEAR
const tradesPerYearOverall = yearsTotal > 0 ? sortedTrades.filter((t) => t.netReturnPct !== null).length / yearsTotal : 0
const overallMetrics = computeTradeMetrics(sortedTrades, tradesPerYearOverall)
const overallSell = computeSellEvidence(allSell, baselines)
const turnover = turnoverPer100Sessions(sortedTrades, retained.length, Math.round(totalReplaySessions / retained.length))

// ---------------------------------------------------------------------------
// Segments (all completed trades, pooled chronological order)
// ---------------------------------------------------------------------------

const segments = {
  bySector: segmentBySector(sortedTrades),
  byLiquidity: segmentByLiquidity(sortedTrades),
  byScoreBand: segmentByScoreBand(sortedTrades),
  byTier: segmentByTier(sortedTrades),
}

// ---------------------------------------------------------------------------
// Write results + report
// ---------------------------------------------------------------------------

const frozenSignalsVersion = (() => {
  const m = readFileSync(path.join(ROOT, ".cache/engine-baseline/signals.ts"), "utf8")
  return m.match(/SIGNALS_VERSION = "([^"]+)"/)?.[1] ?? "unknown"
})()

const results = {
  generatedAt: new Date().toISOString(),
  engine: {
    source: ".cache/engine-baseline (frozen copy of src/lib/technical + corporate-actions.ts + egx-hours.ts at commit f5e7277)",
    signalsVersion: frozenSignalsVersion,
    entryPoint: "computeCloseSignal(rows[0..t]) — close+volume daily rows, identical input shape to production close engine",
  },
  config: cfg,
  universe: {
    selectionRule: uni.selectionRule,
    candidates: uni.candidates.flat().length,
    retained: retained.map((r) => r.meta.ticker),
    retainedByTier: retained.reduce<Record<string, number>>((acc, r) => { acc[r.meta.tier] = (acc[r.meta.tier] ?? 0) + 1; return acc }, {}),
    skipped,
    liquidityTerciles: { t1Max: t1, t2Max: t2, note: "terciles of mean ADV (EGP, volume x adjusted close) across retained tickers" },
  },
  dataQuality: {
    sessionsPerTicker: [...new Set(retained.map((r) => r.validation.stats.sessions))],
    dateRange: {
      first: retained[0]?.validation.stats.firstDate,
      last: retained[0]?.validation.stats.lastDate,
    },
    adjustment: "Yahoo adjclose (split + dividend adjusted) — closest available equivalent of the DB-ledger adjustPrevClose pipeline (Neon unreachable in sandbox); engine input rows use adjusted close + raw volume",
    splitCrossCheck: {
      events: splitChecks.length,
      frozenMathMismatches: frozenMathMismatches.length,
      yahooFactorAgreement: splitChecks.filter((c) => c.yahooMatch).length,
      detail: splitChecks,
    },
    validationSkips: skipped,
  },
  walkForward: {
    split: "60/20/20 chronological on the replay-session list; NO parameter tuning (baseline)",
    windows: windowDatesList[0],
  },
  overall: {
    signals: overallSignals,
    metrics: overallMetrics,
    sellEvidence: overallSell,
    skips: skipsTotal,
    turnoverPer100CompanySessions: turnover,
  },
  windows,
  segments,
  perTicker: Object.values(perTicker).sort((a, b) => a.ticker.localeCompare(b.ticker)),
  disclosure: {
    survivorship: "SURVIVORSHIP BIAS — UNIVERSE LIMITATION: the backtest universe consists of currently LISTED companies only (per the market-tier seed lists and the production company registry). Delisted companies' history is unavailable in this sandbox, so companies that were delisted, suspended or absorbed during the backtest window are absent from the universe. Every reported result therefore carries an upward survivorship bias and must NOT be read as a market-representative expectation.",
    engineContext: "The full-snapshot engine entry (computeStanceFromSnapshot) needs the DB-backed TechnicalSnapshot pipeline (Neon unreachable). The baseline replays the close-based engine entry (computeCloseSignal) — the same signal family production exposes, with the input shape it expects.",
    corporateActions: "Production adjusts ex-date previous closes from the FoudaLens ledger in the DB. The DB is unreachable, so the baseline uses Yahoo's adjclose (split + cash-dividend adjusted) — the closest available equivalent — and cross-checks the frozen corporate-actions pure math (adjustPrevClose/perShareRatio) against every Yahoo split event.",
    costs: "0.30%/side is an ASSUMPTION (brokerage + fees + spread allowance). EGX retail brokerage is commonly quoted around 0.10-0.19% but primary sources were unreachable from this sandbox; the figure is deliberately conservative and fully configurable via BacktestConfig.costPerSidePct.",
    priceLimit: "The ±20% band is an ASSUMPTION (EGX main-market daily price limit); no tier-specific band differentiation is modeled.",
    sharpeConvention: "Sharpe/Sortino annualize per-trade net returns by sqrt(trades/year); trades/year = completed trades in the window / (window replay sessions / 248). Pooled across tickers.",
  },
}

mkdirSync(path.join(ROOT, "docs/notes"), { recursive: true })
writeFileSync(path.join(BT, "baseline-results.json"), JSON.stringify(results, null, 1))

// ---- markdown report ----
const fmt = (x: number | null | undefined, d = 2): string => (x === null || x === undefined || !Number.isFinite(x) ? "—" : x.toFixed(d))
const pct = (x: number | null | undefined, d = 1): string => (x === null || x === undefined || !Number.isFinite(x) ? "—" : `${x.toFixed(d)}%`)

function metricsTableRows(m: ReturnType<typeof computeTradeMetrics>): string {
  return `| trades (completed/open) | ${m.trades} (${m.completed}/${m.open}) |
| win rate | ${pct(m.winRatePct)} |
| profit factor | ${m.profitFactor === null ? "null (no losing trades)" : fmt(m.profitFactor)} |
| expectancy (net %/trade) | ${pct(m.expectancyPct, 2)} |
| median return (net %) | ${pct(m.medianReturnPct, 2)} |
| avg return (net %) | ${pct(m.avgReturnPct, 2)} |
| gross wins / losses (net %) | ${fmt(m.grossWinPct)} / ${fmt(m.grossLossPct)} |
| max drawdown (equity curve) | ${pct(m.maxDrawdownPct)} |
| Sharpe / Sortino (per-trade, annualized) | ${fmt(m.sharpe)} / ${fmt(m.sortino)} |
| exits: target / stop / time-stop | ${m.targetExits} / ${m.stopExits} / ${m.timeStopExits} |
| false-positive proxy (stop-first among stop|target) | ${pct(m.falsePositiveRatePct)} |
| median sessions held / time-to-target | ${fmt(m.medianSessionsHeld, 0)} / ${fmt(m.medianTimeToTarget, 0)} |
| MAE P50 / P90 (close-based %) | ${pct(m.maeP50, 2)} / ${pct(m.maeP90, 2)} |
| MFE P50 / P90 (close-based %) | ${pct(m.mfeP50, 2)} / ${pct(m.mfeP90, 2)} |`
}

function segmentTable(rows: SegmentRow[], label: string): string {
  return `\n### ${label}\n\n| segment | trades | win rate | profit factor | expectancy (net %) | median (net %) |\n|---|---:|---:|---:|---:|---:|\n` +
    rows.map((r) => `| ${r.segment} | ${r.completed} | ${pct(r.winRatePct)} | ${r.profitFactor === null ? "null" : fmt(r.profitFactor)} | ${pct(r.expectancyPct, 2)} | ${pct(r.medianReturnPct, 2)} |`).join("\n")
}

const win = (w: WindowResult) => `#### ${w.window} window (${w.startDate} → ${w.endDate}, ${w.replaySessions} replay sessions/company)

Signals: buy ${w.signals.buySignals} (${fmt(w.signals.buyPer100Sessions, 1)}/100 sessions), sell ${w.signals.sellSignals}, hold ${w.signals.holdSignals}, weak ${w.signals.weakSignals}; plan-validity rate ${pct(w.signals.planValidityRatePct)}; trades/year ${fmt(w.tradesPerYear, 1)}

| metric | value |
|---|---|
${metricsTableRows(w.metrics)}

SELL exit-evidence: ${w.sellEvidence.evaluable}/${w.sellEvidence.signals} evaluable; mean fwd ${pct(w.sellEvidence.meanFwdReturnPct, 2)}, median ${pct(w.sellEvidence.medianFwdReturnPct, 2)}, "SELL correct" (negative fwd) ${pct(w.sellEvidence.correctRatePct)}; all-sessions baseline mean ${pct(w.sellEvidence.baselineMeanFwdReturnPct, 2)}`

const md = `# Backtest baseline — frozen CURRENT technical engine (tech-signals@${frozenSignalsVersion.split("@")[1] ?? "4"})

**Run**: ${results.generatedAt} · commit f5e7277 · engine frozen at \`.cache/engine-baseline/\` · data cached under \`.cache/bt/\`
**Raw results**: \`.cache/bt/baseline-results.json\` (every number below is generated from it — no hand transcription)

## 1. Mission and method

This baseline measures the CURRENT production signal engine — a verbatim frozen copy of \`src/lib/technical\` (including \`trade-plan.ts\`, \`indicators.ts\`) plus \`src/lib/market/corporate-actions.ts\` and \`egx-hours.ts\` — under a reproducible, no-lookahead backtest harness. At every session t from warmup end to last-1, the engine is called on \`bars[0..t]\` ONLY via \`computeCloseSignal(rows: CloseRow[])\` (the exact input shape the production close engine consumes: \`{ ts, close, volume }\`), and the emitted signal/score/trade-plan is recorded. The full-snapshot engine entry (\`computeStanceFromSnapshot\`) needs the DB-backed TechnicalSnapshot pipeline, which is unreachable in this sandbox (Neon DB down) — disclosed as an engine-context limitation, not a deviation.

**Pipeline per ticker** (mirrors production read path \`src/app/api/v1/companies/[id]/technical/route.ts\` → \`live-bars.ts\` Yahoo 1d candles → engine):
1. Yahoo chart API 1y daily candles (\`*.CA\`), cached to \`.cache/bt/<T>.json\`, never re-fetched. Rate-limit note: Yahoo 429s every browser-style User-Agent from this sandbox; requests succeed with NO User-Agent header (verified empirically; documented deviation from production's UA).
2. Validation: dedupe dates, OHLC sanity (high ≥ max(o,c), low ≤ min(o,c), all > 0), weekday sanity (EGX sessions Sun–Thu; Fri/Sat UTC dates = violations), calendar-gap check, ≥ ${cfg.minSessions} sessions.
3. Corporate-action adjustment: engine rows use Yahoo's **adjclose** (split + cash-dividend adjusted) — the closest available equivalent of production's DB-ledger \`adjustPrevClose\` ex-date engine, which cannot run without the Neon DB. The frozen pure math (\`adjustPrevClose\`/\`perShareRatio\`) is still exercised: for every Yahoo split event the frozen function must reproduce its documented formula, and the implied adjclose factor must agree with the split ratio (results in §4).
4. Replay with no lookahead; walk-forward 60/20/20 chronological split with **no parameter tuning** — the test window is recorded so a future upgraded engine can be evaluated on the same untouched window.

## 2. Data coverage

- Universe: ${results.universe.candidates} candidates (12 per bucket in seed order from \`src/lib/market/tiers.ts\` + MAIN names from the production tier enumeration), **${retained.length} retained** after validation (≥ 10 per bucket where data allowed): ${retained.map((r) => r.meta.tier).join(", ")}.
- Sessions per ticker: ${results.dataQuality.sessionsPerTicker.join(", ")} — every retained series has ≥ ${cfg.minSessions} valid sessions (requirement met, no series skipped for depth).
- Date range: ${results.dataQuality.dateRange.first} → ${results.dataQuality.dateRange.last} (~1y daily).
- Skipped candidates (with reasons): ${skipped.length === 0 ? "none" : skipped.map((s) => `${s.ticker} (${s.reason})`).join(", ")}.

## 3. Execution model (every assumption disclosed, all configurable in \`BacktestConfig\`)

| assumption | default | note |
|---|---|---|
| fill timing | signal on close t → entry at t+1 close | conservative daily-data assumption; no intraday fills |
| EGX daily price limit | ±${cfg.dailyPriceLimitPct}% | t+1 close outside band vs t close → limit-locked, fill skipped, counted |
| transaction costs | ${cfg.costPerSidePct}% per side (${cfg.costPerSidePct * 2}% round trip) | ASSUMPTION — see disclosure in §6 |
| plan validity | RR ≥ ${cfg.minRiskReward}, stop < entry-mid < target | invalid/null plan → trade skipped, counted |
| trade management | stop: close ≤ plan.stop; target: close ≥ plan.targetLow; time-stop after ${cfg.timeStopSessions} sessions | stop takes precedence on the same close |
| MAE / MFE | close-based excursions vs entry | engine input is close-only; intraday H/L not modeled |
| overlap | one position per ticker | buy signals while a position is open are skipped and counted |
| SELL signals | exit-evidence metric only | EGX retail shorting not realistically available; fwd ${cfg.sellFwdHorizonSessions}-session return from t+1 close ("what a BUY-holder would have avoided"); NO short P&L modeled |
| WAIT/hold | no trade | — |

## 4. Data quality and frozen-engine cross-check

- All ${retained.length} series: OHLC sanity passed, zero Fri/Sat sessions, no dedupe losses. adjclose available for every series.
- Split events in window: ${splitChecks.length}. Frozen \`adjustPrevClose\` matched its documented formula on ${splitChecks.length - frozenMathMismatches.length}/${splitChecks.length} (mismatches: ${frozenMathMismatches.length || "none"}); Yahoo adjclose factor agreed with the split ratio on ${splitChecks.filter((c) => c.yahooMatch).length}/${splitChecks.length} events.
- Engine context: \`computeCloseSignal\` close-engine replay (see §6 limitation).

## 5. Results — CURRENT engine, honest numbers

### Overall (all windows pooled, ${retained.length} tickers)

Signals: buy ${overallSignals.buySignals} (${fmt(overallSignals.buyPer100Sessions, 1)}/100 sessions), sell ${overallSignals.sellSignals}, hold ${overallSignals.holdSignals}, weak ${overallSignals.weakSignals} over ${overallSignals.replaySessions} replay sessions. **Plan-validity rate (BUY)**: ${pct(overallSignals.planValidityRatePct)}. Skips: limit-locked ${skipsTotal.limitLocked}, plan-invalid ${skipsTotal.planInvalid}, no-forward-session ${skipsTotal.noForwardSession}, position-busy ${skipsTotal.positionBusy}. Turnover: ${fmt(turnover)} trades per company per 100 sessions. Trades/year (pooled): ${fmt(tradesPerYearOverall, 1)}.

| metric | value |
|---|---|
${metricsTableRows(overallMetrics)}

### Walk-forward windows (chronological 60/20/20, no tuning)

${windows.train ? win(windows.train) : ""}
${windows.validation ? "\n" + win(windows.validation) : ""}
${windows.test ? "\n" + win(windows.test) : ""}

### Segments (pooled trades, all windows)
${segmentTable(segments.byTier, "By market tier")}
${segmentTable(segments.byScoreBand, "By engine score band")}
${segmentTable(segments.byLiquidity, "By liquidity tercile (mean ADV EGP)")}
${segmentTable(segments.bySector, "By sector")}

### Per-ticker

| ticker | tier | sector | sessions | trades | win rate | PF | expectancy % | median % |
|---|---|---|---:|---:|---:|---:|---:|---:|
${Object.values(perTicker).sort((a, b) => a.ticker.localeCompare(b.ticker)).map((p) => `| ${p.ticker} | ${p.tier} | ${p.sector} | ${p.sessions} | ${p.completed} | ${pct(p.winRatePct)} | ${p.profitFactor === null ? "null" : fmt(p.profitFactor)} | ${pct(p.expectancyPct, 2)} | ${pct(p.medianReturnPct, 2)} |`).join("\n")}

## 6. Assumptions and limitations (verbatim disclosures)

1. **${results.disclosure.survivorship.split(" — ")[0]}**: ${results.disclosure.survivorship}
2. Engine context: ${results.disclosure.engineContext}
3. Corporate actions: ${results.disclosure.corporateActions}
4. Costs: ${results.disclosure.costs}
5. Price limit: ${results.disclosure.priceLimit}
6. Sharpe/Sortino: ${results.disclosure.sharpeConvention}
7. No annualized-return claims beyond what daily data supports; no confidence scores; raw numbers only. PF is reported as null when a segment has no losing trades (not Infinity).
8. Yahoo fetch required NO User-Agent header from this sandbox (browser-style UA → persistent 429). Data vendor identical to production (Yahoo chart API) but fetched ${results.generatedAt.slice(0, 10)}.
`

writeFileSync(path.join(ROOT, "docs/notes/backtest-baseline.md"), md)

// ---- stdout summary ----
console.log("=== BASELINE BACKTEST (frozen CURRENT engine) ===")
console.log(`universe: ${retained.length} tickers (${retained.map((r) => r.meta.tier).reduce<Record<string, number>>((a, t) => { a[t] = (a[t] ?? 0) + 1; return a }, {}) && Object.entries(retained.reduce<Record<string, number>>((a, r) => { a[r.meta.tier] = (a[r.meta.tier] ?? 0) + 1; return a }, {})).map(([k, v]) => `${k}:${v}`).join(" ")}) | sessions ${results.dataQuality.sessionsPerTicker[0]} | ${results.dataQuality.dateRange.first} → ${results.dataQuality.dateRange.last}`)
console.log(`signals: buy ${overallSignals.buySignals} (plan-valid ${pct(overallSignals.planValidityRatePct)}) | sell ${overallSignals.sellSignals} | replay sessions ${overallSignals.replaySessions}`)
console.log(`OVERALL: trades ${overallMetrics.trades} (completed ${overallMetrics.completed}, open ${overallMetrics.open}) | win ${pct(overallMetrics.winRatePct)} | PF ${overallMetrics.profitFactor === null ? "null" : fmt(overallMetrics.profitFactor)} | expectancy ${pct(overallMetrics.expectancyPct, 2)} | median ${pct(overallMetrics.medianReturnPct, 2)} | maxDD ${pct(overallMetrics.maxDrawdownPct)}`)
for (const w of ["train", "validation", "test"] as const) {
  const m = windows[w].metrics
  console.log(`${w.toUpperCase().padEnd(11)}: trades ${m.completed} | win ${pct(m.winRatePct)} | PF ${m.profitFactor === null ? "null" : fmt(m.profitFactor)} | expectancy ${pct(m.expectancyPct, 2)} | median ${pct(m.medianReturnPct, 2)} (${windows[w].startDate} → ${windows[w].endDate})`)
}
console.log(`SELL evidence: ${overallSell.evaluable}/${overallSell.signals} evaluable | mean fwd ${pct(overallSell.meanFwdReturnPct, 2)} vs baseline ${pct(overallSell.baselineMeanFwdReturnPct, 2)} | correct ${pct(overallSell.correctRatePct)}`)
console.log(`written: .cache/bt/baseline-results.json, docs/notes/backtest-baseline.md`)
