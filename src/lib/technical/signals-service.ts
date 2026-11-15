// =============================================================================
// Market-wide technical signals service — DB plumbing around the pure
// close-based signal engine (src/lib/technical/signals.ts).
//
// Data source: MarketPrice day-rows (one row per company per UTC day, from the
// public TradingView EGX scanner pull) + PriceBar deep history. Close-only
// bars are the SAME documented precedent the per-company technical engine uses
// for its freshest sessions — here they are the whole input, and that
// limitation is disclosed on every response rather than hidden. Nothing is
// written to the DB.
//
// Corporate-action continuity: the board computes its own changePct from the
// merged series (last vs prior close), so bonus/split/cash ex-dates inside the
// window are rebuilt through applyCorporateActionAdjustments() — the SAME
// engine the per-company technical bundle uses — before any indicator runs.
// Without this pass an ex-date shows up as a fake cliff (CANA 2026-11-12:
// −31.9% displayed for a real ≈ +2% session) and poisons every reading.
//
// Cost shape: ~250 active companies × a 420-calendar-day trailing window —
// one cached pass every 10 minutes (prices move intraday, the stance follows).
// Actions ride ONE batched query for the whole universe (see loadSeriesActionsByCompany).
// =============================================================================

import { db } from "@/lib/db"
import { cached } from "@/lib/server-cache"
import { applyCorporateActionAdjustments, loadSeriesActionsByCompany, type SeriesBar } from "@/lib/market/corporate-actions"
import { effectiveEgxSessionDate } from "@/lib/market/egx-session"
import { computeCloseSignal, SIGNALS_VERSION, type CloseSignalOutput, type TechStance } from "./signals"
import { emaSeries, type Bar } from "./indicators"
import type { MarketRegimeInput, MarketRegime, ConvictionTier } from "./board-gates"
import { applyRegimeGate, convictionTier } from "./board-gates"
import { gateRowForFree } from "./board-filters"
import { readCanonicalStance, BOARD_MAX_AGE_MS, isFreshCanonicalRow, STANCE_ENGINE_VERSION } from "./stance-store"
import { persistBoardSnapshot } from "./board-snapshot"
// Opportunity Intelligence Engine (opportunity@1) — Wave-2 modules are IMPORTED
// only (parallel ownership): map → ladder → classify → score, all deterministic.
import { buildResistanceMap, type ResistanceMap } from "./resistance-map"
import { buildTargetLadder, type TargetLadder } from "./opportunity-targets"
import { classifyOpportunity, type OpportunityState, type OpportunityView } from "./opportunity"
import {
  computeOpportunityScore,
  type LiquidityTier,
  type OpportunityScoreComponents,
  type OpportunityState as OqsScoreState,
} from "./opportunity-score"
import { roundToTick, buildTradePlan, type TradePlan } from "./trade-plan"

/** Calendar-day cutoff for the trailing window. 300 days ≈ 200 EGX sessions —
 *  still ≥3× the longest indicator window (rangePos60) with corporate-action
 *  margin, and ~30% less DB egress on every cold compute. */
const WINDOW_DAYS = 300
const CACHE_MS = 10 * 60_000

// ---- Market-regime loader constants (consumed by board-gates.marketRegime) ---
// A company counts toward regime breadth only when its adjusted series is long
// enough for BOTH an EMA50 read and a meaningful EMA20 slope (50 sessions).
const REGIME_BREADTH_MIN_SESSIONS = 50
// "Rising 20-EMA" = the EMA20 is higher than it was this many sessions ago.
const REGIME_EMA_SLOPE_SESSIONS = 5

export interface MarketSignalRow extends CloseSignalOutput {
  companyId: string
  ticker: string
  nameEn: string
  nameAr: string | null
  sector: string
  /** EGX30 | EGX70 | MAIN | OTC (see src/lib/market/tiers.ts) */
  marketTier: string
  /** Where the displayed `metrics` block came from (remediation 2026-11-15).
   *  "canonical"   — the full-OHLC canonical stance: identical to the company tab.
   *  "close_only"  — a canonical stance that predates the metric block.
   *  "unavailable" — no canonical stance; chips are withheld rather than showing
   *                  close-only numbers that would contradict the company tab. */
  metricsSource?: "canonical" | "close_only" | "unavailable"
  /** Opportunity Intelligence layer (opportunity@1) — attached ONLY to
   *  candidate rows (signalState "confirmed", or "watching" WITH a setup).
   *  Hold/wait rows carry NO field at all: a missing `opportunity` reads as
   *  state "none" implicitly (documented degradation — old cached payloads and
   *  non-candidate rows are honestly empty, never fabricated). */
  opportunity?: RowOpportunity
}

// =============================================================================
// Opportunity layer (opportunity@1) — the per-row attachment + its builder.
//
// CANDIDATE COST DISCIPLINE: the layer is built ONLY for rows that can carry
// an opportunity at all (signalState "confirmed", or "watching" WITH a setup).
// Hold/wait rows are skipped entirely — no map, no ladder, no classify call.
//
// BARS: the map is built from the SAME batched fetch the board snapshot used —
// the PriceBar deep history's stored OHLC candles (the select was widened to
// carry open/high/low; one query, no refetch). The freshest scanner-overlay
// sessions (MarketPrice day-rows) are close-only by source and are skipped by
// the map's own flat-bar rule (P1) — zones are historical structure, while
// every gate/level below reads the row's OWN freshest lastClose. When the
// company has corporate actions, the SAME shared adjustment engine rescales
// the stored candles before the map (identical to the signal series).
//
// INTRADAY CONTEXT: deliberately NOT wired here — fetchIntradayContext is a
// per-ticker network fetch (delayed, evidence-only); across ~250 companies it
// is not cheap, and it must never affect eligibility anyway. Omitted (not
// passed) on every row; additive later if a cheap surface appears.
// =============================================================================

/** The opportunity layer attached to one candidate row. */
export interface RowOpportunity {
  /** the classified view (state / gates / reasons / notes — opportunity@2) */
  view: OpportunityView
  /** the structural target ladder for this side (null when no honest rung) */
  ladder: TargetLadder | null
  /** the executable plan actually backing the displayed levels — the row's
   *  own plan, or the FRESH rebuild when that plan had gone stale against the
   *  last close (planRebuilt). Null when no plan exists at all. */
  plan: TradePlan | null
  /** true when the row's persisted plan was stale vs the last close and a
   *  fresh plan was rebuilt from the stored candles (2026-11-15 owner bug:
   *  a plan published at ~9 EGP served while the stock traded 24+). */
  planRebuilt: boolean
  /** Arabic note when the plan was rebuilt (surfaced in the notes panel) */
  planRebuiltNoteAr: string | null
  /** true when the watched setup's activation level sat far from the current
   *  close (SETUP_STALE_GAP_PCT) — the stale setup is NOT classified and its
   *  provisional levels must not be displayed anywhere (2026-11-15 AMES bug:
   *  a buy trigger at ~108 served while the stock traded 54). */
  setupDropped: boolean
  /** Arabic note when the setup was dropped (surfaced in the notes panel) */
  setupDroppedNoteAr: string | null
  /** OQS 0-100 — null for ineligible rows (the module's own hard rule) */
  oqs: number | null
  /** per-component 0-1 sub-scores (null for ineligible rows) */
  oqsComponents: OpportunityScoreComponents | null
  /** factual Arabic attribution of the two strongest components */
  oqsNoteAr: string
  /** liquidity tier fed to the score — the row's OWN relVol convention:
   *  relVol ≥ 1.5 → "liquid" (the board's high-liquidity filter threshold),
   *  otherwise "normal", unknown → "thin" (conservative executability) */
  liquidityTier: LiquidityTier
  /** EGX sessions between the row's asOf and the compute day (0 = today) */
  dataAgeSessions: number
}

/** Session count between two UTC day strings over EGX's Sun–Thu week.
 *  0 when fromDay >= toDay; capped by the bounded loop (30 days) — a stale
 *  row simply floors at the honest "≥ 4" band of the freshness map. */
export function egxSessionsBetween(fromDay: string, toDay: string): number {
  const parse = (day: string) => new Date(`${day.slice(0, 10)}T00:00:00.000Z`).getTime()
  const from = parse(fromDay)
  const to = parse(toDay)
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) return 0
  let count = 0
  // bounded walk: 30 calendar days covers 6+ EGX weeks — far beyond the
  // freshness map's ≥ 4 band; beyond the cap the answer is already "stale".
  for (let t = from + 86_400_000; t <= to && count < 30; t += 86_400_000) {
    const dow = new Date(t).getUTCDay()
    if (dow >= 0 && dow <= 4) count++ // Sun..Thu are EGX sessions
  }
  return count
}

/** Trend label for the score's structure component, from the row's OWN
 *  displayed metrics (ema20/ema50 vs lastClose). Unknown metrics encode the
 *  documented "unknown" bucket as "down" (the score module's conservative
 *  0.1 — never credited for a trend it cannot see). */
function rowTrendLabel(lastClose: number | null, ema20: number | null, ema50: number | null): "up" | "side" | "down" {
  if (lastClose === null || ema20 === null || ema50 === null) return "down"
  if (lastClose > ema50 && ema20 > ema50) return "up"
  if (lastClose < ema50 && ema20 < ema50) return "down"
  return "side"
}

/** Liquidity tier from the row's own relative volume (board conventions). */
function rowLiquidityTier(relVol: number | null): LiquidityTier {
  if (relVol === null || !Number.isFinite(relVol)) return "thin"
  return relVol >= 1.5 ? "liquid" : "normal"
}

/** Structural obstacles between the entry edge and T1: kind-matching map zones
 *  whose band sits strictly INSIDE the span (the T1 band itself excluded —
 *  it IS the target, not an obstacle). Ladder null / no rungs → 0. */
function obstacleCountBetween(map: ResistanceMap | null, ladder: TargetLadder | null, side: "buy" | "sell", entryLow: number, entryHigh: number): number {
  if (!map || !ladder || ladder.targets.length === 0) return 0
  const t1 = ladder.targets[0].price
  const isBuy = side === "buy"
  let n = 0
  for (const z of map.zones) {
    if (z.kind !== (isBuy ? "supply" : "demand")) continue
    if (isBuy) {
      if (z.low > entryHigh && z.high < t1) n++
    } else {
      if (z.high < entryLow && z.low > t1) n++
    }
  }
  return n
}

export interface OpportunityLayerInput {
  signalState: "confirmed" | "watching" | "wait" | undefined
  /** the row's published direction (null on wait rows) */
  direction: "buy" | "sell" | null
  lastClose: number | null
  score: number | null
  /** the confirmed row's validated plan (null on watching/wait rows) */
  tradePlan: CloseSignalOutput["tradePlan"]
  /** the watching row's watched setup (null otherwise) */
  setup: CloseSignalOutput["setup"]
  reasons: { tone: "positive" | "negative" | "neutral" }[]
  relVol: number | null
  ema20: number | null
  ema50: number | null
  /** the row's displayed daily volatility % (σ of last 20 close-to-close
   *  moves) — the ATR-proxy input for a fresh plan rebuild */
  volPct: number | null
  /** the row's data session (null when unknown) */
  asOf: string | null
  /** the compute day's effective EGX session date */
  todaySession: string
  /** the company's stored daily OHLC candles (corporate-action adjusted),
   *  from the SAME batched fetch as the snapshot — never a refetch */
  bars: Bar[]
}

// ---- plan freshness + rebuild constants (2026-11-15 owner bug report) ----
/** A persisted plan whose entry zone no longer sits near the market price is
 *  STALE: its entry/stop and the ladder anchored on it describe a price
 *  regime the market already left (VLMRA: plan entry ~9.2 served while the
 *  stock traded 24.47 — a "target" below the live price). The farthest entry
 *  edge beyond this % of the last close disqualifies the plan. A freshly
 *  built plan's edges sit within ~2% of the close, so 10% only fires on a
 *  genuinely dead regime, never on normal drift. */
const STALE_PLAN_GAP_PCT = 10

/** A watched setup whose activation level the market has already left far
 *  behind describes a structure that no longer exists (2026-11-15 owner bug
 *  report, AMES: a buy trigger at ~108 served while the stock traded 54 — the
 *  close-above trigger fired a week earlier and the provisional levels were
 *  dead geometry). The activation must sit within this % of the last close
 *  for the setup to stay usable; beyond it the row honestly reads observation
 *  with no executable levels (targets still print from the price-anchored
 *  ladder; entry/stop stay empty). */
const SETUP_STALE_GAP_PCT = 15

/** σ of the last 20 close-to-close % moves — the signals.ts dailyVolPct
 *  convention (same formula) so a fresh rebuild matches the close engine. */
function closeOnlyDailyVolPct(closes: number[]): number | null {
  if (closes.length < 21) return null
  const moves: number[] = []
  for (let i = closes.length - 20; i < closes.length; i++) {
    if (closes[i - 1] > 0) moves.push(((closes[i] - closes[i - 1]) / closes[i - 1]) * 100)
  }
  if (!moves.length) return null
  const mean = moves.reduce((s, m) => s + m, 0) / moves.length
  const variance = moves.reduce((s, m) => s + (m - mean) ** 2, 0) / moves.length
  return Math.sqrt(variance)
}

/**
 * Build one row's opportunity layer (pure + deterministic). Returns null when
 * the row is not a candidate (wait rows, no direction, no usable close) — the
 * caller then attaches NOTHING and the row reads as "none" implicitly.
 */
export function buildOpportunityLayer(input: OpportunityLayerInput): RowOpportunity | null {
  // ---- candidate gate ONLY (cost discipline): confirmed, or watching WITH setup
  const isConfirmed = input.signalState === "confirmed"
  const isWatchingWithSetup = input.signalState === "watching" && !!input.setup
  if (!isConfirmed && !isWatchingWithSetup) return null
  if (!input.lastClose || !Number.isFinite(input.lastClose) || input.lastClose <= 0) return null

  const plan = input.tradePlan ?? null
  const setup = input.setup ?? null

  // ---- SETUP FRESHNESS GUARD (2026-11-15 owner bug report) ----
  // A watching setup whose activation level sits far from the CURRENT close
  // is stale: its trigger already fired (or became unreachable) and the
  // provisional entry/stop are dead geometry. Drop it — the row honestly
  // reads observation with no executable levels (targets still print from
  // the current-price-anchored ladder; entry/stop stay empty). The guard runs
  // BEFORE the side resolution so a dropped setup cannot lend its direction
  // to the ladder while the row displays the ROW's own direction.
  const setupStale =
    !isConfirmed && setup
      ? Math.abs(((setup.activation.level - input.lastClose) / input.lastClose) * 100) > SETUP_STALE_GAP_PCT
      : false
  const effectiveSetup = setupStale ? null : setup
  let setupDroppedNoteAr: string | null = null
  if (setupStale && setup) {
    setupDroppedNoteAr = `مستوى التفعيل المراقَب (${setup.activation.level.toFixed(2)}) أصبح بعيدًا عن السعر الحالي (${input.lastClose.toFixed(2)}) — البنية التي أنتجت هذا المستوى لم تعد قائمة، فأُسقطت المستويات التقديرية بدل عرض أرقام ميتة، وتُعاد القراءة عند التحديث القادم.`
  }

  // side: confirmed rows publish the plan's own bias (fall back to the row's
  // signal); watching rows carry the direction on the USABLE setup — a
  // dropped (stale) setup falls back to the row's own signal direction so
  // the ladder's side always matches the displayed direction chip.
  const side: "buy" | "sell" | null = isConfirmed
    ? (plan ? plan.bias : input.direction)
    : (effectiveSetup ? effectiveSetup.direction : input.direction)
  if (side !== "buy" && side !== "sell") return null

  // ---- resistance map on the SAME stored daily candles (no refetch) ----
  const map: ResistanceMap | null = input.bars.length > 0 ? buildResistanceMap(input.bars) : null

  // ---- PLAN FRESHNESS GUARD (2026-11-15 owner bug report) ----
  // A persisted plan whose entry zone no longer sits near the CURRENT close
  // is stale: every level anchored on it describes a price regime the market
  // already left. Rebuild the plan from the SAME stored candles around the
  // current close (same builder, same zones, same ATR proxy). No rebuildable
  // plan → the row honestly carries NO levels (never serve a stale one).
  const farFromEntry = plan
    ? Math.max(
        Math.abs(((plan.entryLow - input.lastClose) / input.lastClose) * 100),
        Math.abs(((plan.entryHigh - input.lastClose) / input.lastClose) * 100),
      )
    : 0
  const planStale = farFromEntry > STALE_PLAN_GAP_PCT
  let effectivePlan: TradePlan | null = plan
  let planRebuilt = false
  let planRebuiltNoteAr: string | null = null
  if (planStale && plan) {
    const volPct = input.volPct ?? closeOnlyDailyVolPct(input.bars.map((b) => b.close))
    const rebuilt =
      buildTradePlan({
        signal: side,
        lastClose: input.lastClose,
        closes: input.bars.map((b) => b.close),
        zones: map ? map.zones.map((z) => ({ kind: z.kind, low: z.low, high: z.high })) : null,
        volPct,
      }) ?? null
    if (rebuilt) {
      effectivePlan = rebuilt
      planRebuilt = true
      planRebuiltNoteAr = `الخطة المحفوظة كانت من جلسة سابقة (منطقة الدخول ${plan.entryLow.toFixed(2)}–${plan.entryHigh.toFixed(2)}) والسعر الحالي (${input.lastClose.toFixed(2)}) أصبح بعيدًا عنها — أُعيد بناء الخطة على السعر الحالي من نفس شموع السهم، والمستويات المعروضة هي المستويات الجديدة.`
    } else {
      effectivePlan = null // no honest levels at the current price — serve none
    }
  }

  // ---- entry basis per the opportunity.ts input contract: the plan's entry
  // zone when a plan exists, else the setup's activation level as a
  // single-price basis (the daily close decides there). The setup freshness
  // guard already ran above — a dropped setup cannot anchor the ladder.
  const entryLow = effectivePlan ? effectivePlan.entryLow : effectiveSetup ? effectiveSetup.activation.level : input.lastClose
  const entryHigh = effectivePlan ? effectivePlan.entryHigh : effectiveSetup ? effectiveSetup.activation.level : input.lastClose

  // ---- structural target ladder for this side ----
  const ladder = map ? buildTargetLadder(map, side, entryLow, entryHigh, input.lastClose, roundToTick) : null

  // ---- classify (opportunity@2) ----
  const view = classifyOpportunity({
    lastClose: input.lastClose,
    signalState: isConfirmed ? "confirmed" : "watching",
    score: input.score ?? 0,
    // the displayed direction MUST equal the ladder's own side — the owner's
    // visual review caught a "جاهزة شراء" chip on a row whose whole plan was
    // a sell (EGTS: stop above entry, targets below the price). side already
    // resolves plan-bias → usable-setup → row-signal in that order.
    direction: side,
    tradePlan:
      effectivePlan
        ? {
            bias: effectivePlan.bias,
            entryLow: effectivePlan.entryLow,
            entryHigh: effectivePlan.entryHigh,
            stop: effectivePlan.stop,
            targetLow: effectivePlan.targetLow,
            targetHigh: effectivePlan.targetHigh,
            riskReward: effectivePlan.riskReward,
            targetKind: effectivePlan.targetKind ?? null,
          }
        : null,
    setup: effectiveSetup
      ? {
          direction: effectiveSetup.direction,
          activationLevel: effectiveSetup.activation.level,
          activationConditionAr: effectiveSetup.activation.basisAr,
          provisional: true, // the watched-setup levels are recomputed at activation
          provisionalRiskReward: effectiveSetup.provisionalRiskReward,
        }
      : null,
    lifecycleView: null, // the board serves PRE-ENTRY stances; the lifecycle walk is the per-company route's own layer
    zones: map ? map.zones : [],
    ladder,
    intradayContext: null, // evidence-only module — deliberately not fetched board-wide (cost)
    earlyEvidence: null,
  })

  // ---- score (OQS): the module's own hard rule nulls ineligible rows, so
  // feeding every candidate is safe and keeps oqsNoteAr honest for them too.
  const dataAgeSessions = input.asOf ? egxSessionsBetween(input.asOf, input.todaySession) : 30
  // vocabulary narrowing: the score module's state union has no "none" — an
  // honest "none" (no opportunity) maps to "observation"; irrelevant in
  // practice because the hard rule nulls ineligible rows by construction.
  const scoreState: OqsScoreState = view.state === "none" ? "observation" : view.state
  const oqs = computeOpportunityScore({
    eligible: view.eligible,
    score: input.score ?? 0,
    positiveReasons: input.reasons.filter((r) => r.tone === "positive").length,
    negativeReasons: input.reasons.filter((r) => r.tone === "negative").length,
    signalState: isConfirmed ? "confirmed" : "watching",
    trendLabel: rowTrendLabel(input.lastClose, input.ema20, input.ema50),
    relativeStrengthPct: null, // no benchmark window on the board — neutral 0.5 (documented)
    relVol: input.relVol,
    upsidePctToT1: view.upsidePctToT1,
    riskReward: effectivePlan ? effectivePlan.riskReward : null,
    obstacleCount: obstacleCountBetween(map, ladder, side, entryLow, entryHigh),
    liquidityTier: rowLiquidityTier(input.relVol),
    state: scoreState,
    dataAgeSessions,
  })

  return {
    view,
    ladder,
    plan: effectivePlan,
    planRebuilt,
    planRebuiltNoteAr,
    setupDropped: setupStale,
    setupDroppedNoteAr,
    oqs: oqs.oqs,
    oqsComponents: oqs.components,
    oqsNoteAr: oqs.noteAr,
    liquidityTier: rowLiquidityTier(input.relVol),
    dataAgeSessions,
  }
}

export interface MarketSignalsOutput {
  version: string
  asOf: string | null
  /** freshest session date used across the universe */
  pricedAsOf: string | null
  universe: number
  scored: number
  weakData: number
  distribution: { buy: number; hold: number; sell: number }
  /** rows whose displayed reading comes from the persisted canonical stance */
  canonicalCount?: number
  /** % of scored companies whose price sits above EMA20 — technical breadth */
  pctAboveEma20: number | null
  /** Board-wide aggregates feeding the market-regime gate
   *  (src/lib/technical/board-gates.ts marketRegime): share of MEASURED
   *  companies whose 20-EMA is rising (5-session slope) AND whose close sits
   *  above EMA50, plus the median displayed score. Optional so pre-regime
   *  cached payloads / persisted snapshots keep type-checking — a missing
   *  field degrades to the neutral regime (never a penalty). */
  regimeInput?: MarketRegimeInput
  rows: MarketSignalRow[]
  computedAt: string
}

async function buildMarketSignalsUncached(): Promise<MarketSignalsOutput> {
  const companies = await db.company.findMany({
    where: { isActive: true },
    select: { id: true, ticker: true, nameEn: true, nameAr: true, sector: true, marketTier: true },
    orderBy: { ticker: "asc" },
  })

  const cutoff = new Date(Date.now() - WINDOW_DAYS * 86_400_000)
  const ids = companies.map((c) => c.id)

  // Source 1 — PriceBar: the deep stored history.
  // Source 2 — MarketPrice day-rows: the freshest scanner sessions (the
  // intraday refreshes rewrite the same UTC day). Precedence mirrors
  // buildTechnicalBundle: the scanner day-row WINS for its day (it carries the
  // latest recorded price), PriceBar fills the deep history behind it.
  const [barRows, priceRows] = await Promise.all([
    ids.length
      ? db.priceBar.findMany({
          where: { companyId: { in: ids }, ts: { gte: cutoff } },
          orderBy: { ts: "asc" },
          // Opportunity layer (opportunity@1): the stored candles' OHLC rides
          // the SAME query (columns widened — one fetch, no refetch). The
          // map reads this stored anatomy; scanner day-rows stay close-only.
          select: { companyId: true, ts: true, open: true, high: true, low: true, close: true, volume: true },
        })
      : Promise.resolve([] as { companyId: string; ts: Date; open: number; high: number; low: number; close: number; volume: number | null }[]),
    ids.length
      ? db.marketPrice.findMany({
          where: { companyId: { in: ids }, sourceName: "TRADINGVIEW_SCANNER", isDemoData: false, asOf: { gte: cutoff }, price: { gt: 0 } },
          orderBy: { asOf: "asc" },
          select: { companyId: true, asOf: true, price: true, volume: true },
        })
      : Promise.resolve([] as { companyId: string; asOf: Date; price: number; volume: number | null }[]),
  ])

  // Stored daily OHLC candles per company (opportunity layer input) — the
  // SAME PriceBar rows fetched above, kept as real anatomy. Scanner-overlay
  // days carry no anatomy and are honestly absent (the map's flat-bar rule
  // would skip them anyway); zones are historical structure and every
  // opportunity gate reads the row's OWN freshest lastClose.
  const ohlcByCompany = new Map<string, { ts: string; open: number; high: number; low: number; close: number; volume: number | null }[]>()
  for (const b of barRows) {
    if (![b.open, b.high, b.low, b.close].every((v) => Number.isFinite(v) && v > 0) || b.high < b.low) continue
    let list = ohlcByCompany.get(b.companyId)
    if (!list) { list = []; ohlcByCompany.set(b.companyId, list) }
    list.push({ ts: b.ts.toISOString().slice(0, 10), open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume !== null && Number.isFinite(b.volume) && b.volume > 0 ? b.volume : null })
  }

  // Day-bucket per company: PriceBar first, then MarketPrice overlays its days.
  const byDayAll = new Map<string, Map<string, { ts: string; close: number; volume: number | null }>>()
  for (const b of barRows) {
    let m = byDayAll.get(b.companyId)
    if (!m) { m = new Map(); byDayAll.set(b.companyId, m) }
    const day = b.ts.toISOString().slice(0, 10)
    m.set(day, { ts: day, close: b.close, volume: b.volume !== null && Number.isFinite(b.volume) && b.volume > 0 ? b.volume : null })
  }
  for (const r of priceRows) {
    let m = byDayAll.get(r.companyId)
    if (!m) { m = new Map(); byDayAll.set(r.companyId, m) }
    // EGX session anchoring (2026-11-14 audit): Fri/Sat quotes restate the
    // previous close — anchor them onto the session they belong to instead of
    // minting a phantom weekend session. Never clobber an existing close for
    // the anchored day (the real session bar stays authoritative).
    const rawDay = r.asOf.toISOString().slice(0, 10)
    const day = effectiveEgxSessionDate(r.asOf)
    if (day !== rawDay && m.has(day)) continue
    m.set(day, { ts: day, close: r.price, volume: r.volume !== null && Number.isFinite(r.volume) && r.volume > 0 ? r.volume : null })
  }
  const companyById = new Map(companies.map((c) => [c.id, c]))

  const rows: MarketSignalRow[] = []
  let weakData = 0
  let pricedAsOf: string | null = null
  // Regime breadth accumulators (see REGIME_* constants above).
  let breadthMeasured = 0
  let breadthBullish = 0

  // BATCHED action load: one pass over the whole universe (2 indexed queries),
  // replacing the per-company lookups that made the cold compute pay ~500 DB
  // round trips and blew the function timeout on the new deployment.
  const allSeries: { companyId: string; firstTs: string; lastTs: string }[] = []
  for (const [companyId, byDay] of byDayAll) {
    const days = [...byDay.keys()]
    if (days.length >= 2 && days.length === byDay.size) {
      allSeries.push({ companyId, firstTs: days[0], lastTs: days[days.length - 1] })
    }
  }
  const actionsByCompany =
    allSeries.length > 0
      ? await loadSeriesActionsByCompany(
          allSeries.map((s) => s.companyId),
          allSeries.reduce((min, s) => (s.firstTs < min ? s.firstTs : min), allSeries[0].firstTs),
          allSeries.reduce((max, s) => (s.lastTs > max ? s.lastTs : max), allSeries[0].lastTs)
        )
      : new Map()

  for (const [companyId, byDay] of byDayAll) {
    const c = companyById.get(companyId)
    if (!c) continue
    for (const day of byDay.keys()) {
      if (!pricedAsOf || day > pricedAsOf) pricedAsOf = day
    }
    let series = [...byDay.values()].sort((a, b) => a.ts.localeCompare(b.ts))

    // Corporate-action continuity over the merged series (best-effort): the
    // close-only rows become flat bars, the shared adjustment engine rescales
    // every session before the first ex-date, and the resulting series is
    // continuous across bonus/split/cash events — so the board's own
    // changePct and every indicator read the REAL market move.
    try {
      if (series.length >= 2) {
        const actions = actionsByCompany.get(companyId) ?? []
        if (actions.length > 0) {
          const bars: SeriesBar[] = series.map((r) => ({
            ts: r.ts,
            open: r.close,
            high: r.close,
            low: r.close,
            close: r.close,
            volume: r.volume,
            source: "scanner", // PriceBar/scanner rows are RAW prices (documented)
          }))
          const adjusted = applyCorporateActionAdjustments(bars, actions)
          series = adjusted.bars.map((b) => ({ ts: b.ts, close: b.close, volume: b.volume }))
        }
      }
    } catch {
      // Adjustment is best-effort — the raw series remains the honest fallback.
    }

    const sig = computeCloseSignal(series)

    // Regime breadth for THIS company, measured on the SAME adjusted series
    // the board read above — a bullish company = rising 20-EMA (5-session
    // slope) AND close above EMA50. Companies with too little history are
    // excluded from the breadth denominator (unmeasurable ≠ bearish).
    const regimeCloses = series.map((s) => s.close)
    if (regimeCloses.length >= REGIME_BREADTH_MIN_SESSIONS) {
      const ema20s = emaSeries(regimeCloses, 20)
      const ema50s = emaSeries(regimeCloses, 50)
      const last = regimeCloses.length - 1
      const e20Last = ema20s[last]
      const e20Prev = ema20s[last - REGIME_EMA_SLOPE_SESSIONS]
      const e50Last = ema50s[last]
      if (e20Last !== null && e20Prev !== null && e50Last !== null) {
        breadthMeasured++
        if (e20Last > e20Prev && regimeCloses[last] > e50Last) breadthBullish++
      }
    }

    rows.push({
      ...sig,
      companyId,
      ticker: c.ticker,
      nameEn: c.nameEn,
      nameAr: c.nameAr,
      sector: c.sector,
      marketTier: (c as { marketTier?: string }).marketTier ?? "MAIN",
    })
    if (sig.signal === null) weakData++
  }

  // ---- CANONICAL STANCE OVERLAY (single source of truth, 2026-11-14) ----
  // The close-only engine's own trade plan came from a DIFFERENT level source
  // than the company technical tab (close-based S/R vs OHLC zones) — the same
  // stock showed two different stop-losses on two pages. Every row that has a
  // persisted canonical stance now displays THAT reading (identical to the
  // company tab, same levels, same invalidation). Rows without one keep the
  // close-based READ but never show levels (no plan, no invalidation) — one
  // stock, one analysis, everywhere.
  //
  // PER-ROW ERROR ISOLATION (2026-11-15 remediation): individual snapshot
  // validation/decoding failures MUST NOT corrupt other company results.
  // Infrastructure-wide DB failures are caught separately and degrade gracefully.
  let canonicalCount = 0
  let canonicalByCompany: Map<string, { stance: TechStance; dataAsOf: Date }> = new Map()
  try {
    const canonicalRows = await db.stanceSnapshot.findMany({
      where: { company: { isActive: true } },
      select: { companyId: true, stanceJson: true, dataAsOf: true, computedAt: true, engineVersion: true },
    })
    canonicalByCompany = new Map(
      canonicalRows
        // version + age contract is the shared, unit-tested helper — a
        // stale-version (stance@1) row is NEVER overlaid onto the board
        .filter((s) => isFreshCanonicalRow(s.engineVersion, s.computedAt, BOARD_MAX_AGE_MS))
        .map((s) => {
          try {
            return [s.companyId, { stance: JSON.parse(s.stanceJson) as TechStance, dataAsOf: s.dataAsOf }]
          } catch (e) {
            console.error(`canonical stance decode failed for ${s.companyId}:`, e instanceof Error ? e.message.slice(0, 200) : e)
            return [s.companyId, null]
          }
        })
        .filter(([, v]) => v !== null) as [string, { stance: TechStance; dataAsOf: Date }][],
    )
  } catch (e) {
    console.error(
      "canonical stance batch load failed — serving close-based rows without levels:",
      e instanceof Error ? e.message.slice(0, 200) : e,
    )
    // canonicalByCompany stays empty; all rows keep close-based reads with levels withheld
  }

  for (const row of rows) {
    const canonical = canonicalByCompany.get(row.companyId)
    if (canonical) {
      canonicalCount++
      row.score = canonical.stance.score
      row.signal = canonical.stance.signal
      row.dimensions = canonical.stance.dimensions
      row.reasons = canonical.stance.reasons
      row.styleFits = canonical.stance.styleFits
      row.invalidation = canonical.stance.invalidation
      row.tradePlan = canonical.stance.tradePlan
      row.limitations = canonical.stance.limitations
      // Three-state publication layer (fix J): the canonical stance carries
      // the state + watched setup, so the board and the company tab publish
      // the SAME state. Rows overlaid from a stance persisted BEFORE the
      // layer (possible only if a stale row slipped the version contract)
      // keep `undefined` — the UI falls back to the legacy badge and the
      // no-naked-read invariant is still enforced at the engine itself.
      row.signalState = canonical.stance.signalState
      row.setup = canonical.stance.setup ?? null
      // Metric consistency (remediation 2026-11-15): overlay the canonical
      // stance's OWN metric block so the board chips show exactly what the
      // company tab shows. A metric the canonical snapshot could not produce
      // is null — the chip renders "—" rather than borrowing the close-only
      // number, which is what caused two different RSI readings for one stock.
      if (canonical.stance.metrics) {
        row.metrics = {
          ...row.metrics,
          ...canonical.stance.metrics,
        }
      }
      // A row whose stance predates the metric block cannot be shown to agree
      // with the tab — mark it so the UI can say so instead of implying parity.
      row.metricsSource = canonical.stance.metrics ? "canonical" : "close_only"
    } else {
      // No canonical bundle (no candles / too few sessions): the close-based
      // reading stays, but LEVELS are withheld everywhere for consistency.
      row.tradePlan = null
      row.invalidation = null
      // METRIC PARITY (remediation 2026-11-15): the company tab computes its
      // metrics from the full OHLC bundle. A row with no canonical stance has
      // no such bundle here, so its close-only metrics are NOT the same numbers
      // the tab would show (verified live: ETEL board RSI 55.89 vs tab 54.86).
      // Withhold them exactly as levels are withheld — an unavailable chip is
      // honest, a contradicting chip is not. The directional read, score and
      // signal still come from the close engine and remain displayed.
      row.metrics = {
        rsi14: null, ema20: null, ema50: null, macdLine: null, macdHist: null,
        relVol: null, perfW1: null, perfM1: null, perfM3: null,
        rangePos60: null, dailyVolPct: null, obvSlope20: null,
      }
      row.metricsSource = "unavailable"
    }
  }

  // ---- OPPORTUNITY LAYER PASS (opportunity@1, candidate rows only) ----
  // Built AFTER the canonical overlay: signalState / setup / tradePlan must be
  // the FINAL displayed values (the overlay owns them). Non-candidate rows
  // (hold / wait / degraded) get NO field — honest implicit "none". Each map
  // is built once per candidate company from the stored candles already in
  // memory, adjusted through the SAME corporate-action engine when actions
  // exist for that company (identical to the signal series' adjustment).
  const todaySession = effectiveEgxSessionDate(new Date())
  const layerBarsCache = new Map<string, Bar[]>()
  for (const row of rows) {
    const isCandidate = row.signalState === "confirmed" || (row.signalState === "watching" && !!row.setup)
    if (!isCandidate) continue
    try {
      let bars = layerBarsCache.get(row.companyId)
      if (!bars) {
        const stored = ohlcByCompany.get(row.companyId) ?? []
        bars = stored.map((b) => ({ ts: b.ts, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume }))
        const actions = actionsByCompany.get(row.companyId) ?? []
        if (actions.length > 0 && bars.length >= 2) {
          const seriesBars: SeriesBar[] = bars.map((b) => ({
            ts: b.ts, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume,
            source: "scanner", // PriceBar/scanner rows are RAW prices (documented)
          }))
          bars = applyCorporateActionAdjustments(seriesBars, actions).bars.map((b) => ({
            ts: b.ts, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume,
          }))
        }
        layerBarsCache.set(row.companyId, bars)
      }
      const layer = buildOpportunityLayer({
        signalState: row.signalState,
        direction: row.signal === "buy" || row.signal === "sell" ? row.signal : null,
        lastClose: row.lastClose,
        score: row.score,
        tradePlan: row.tradePlan,
        setup: row.setup ?? null,
        reasons: row.reasons,
        relVol: row.metrics.relVol,
        ema20: row.metrics.ema20,
        ema50: row.metrics.ema50,
        volPct: row.metrics.dailyVolPct,
        asOf: row.asOf,
        todaySession,
        bars,
      })
      if (layer) {
        row.opportunity = layer
        // The board must never display stale executable levels: when the
        // layer rebuilt the plan around the current close, the ROW serves the
        // fresh plan (the company tab converges when its stance refreshes).
        if (layer.planRebuilt && layer.plan) row.tradePlan = layer.plan
      }
    } catch (e) {
      // Per-row error isolation (same rule as the overlay above): a failed
      // layer must never corrupt the row — the row stays honest "none".
      console.error(`opportunity layer failed for ${row.ticker}:`, e instanceof Error ? e.message.slice(0, 200) : e)
    }
  }

  const distribution = { buy: 0, hold: 0, sell: 0 }
  let aboveEma20 = 0
  let ema20Count = 0
  for (const r of rows) {
    if (r.signal) distribution[r.signal]++
    if (r.metrics.ema20 !== null && r.lastClose !== null) {
      ema20Count++
      if (r.lastClose > r.metrics.ema20) aboveEma20++
    }
    if (!r.asOf) continue
  }

  // Regime aggregate: median of the DISPLAYED scores (post-overlay — the
  // canonical stance replaced most rows' close-based score above). Rounded to
  // 1dp so the value is stable across recomputes.
  const sortedScores = rows.map((r) => r.score).filter((s): s is number => s !== null && Number.isFinite(s)).sort((a, b) => a - b)
  let medianScore: number | null = null
  if (sortedScores.length > 0) {
    const mid = Math.floor(sortedScores.length / 2)
    const rawMedian = sortedScores.length % 2 === 1 ? sortedScores[mid] : (sortedScores[mid - 1] + sortedScores[mid]) / 2
    medianScore = Math.round(rawMedian * 10) / 10
  }

  rows.sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || a.ticker.localeCompare(b.ticker))

  return {
    version: SIGNALS_VERSION,
    asOf: pricedAsOf,
    pricedAsOf,
    universe: companies.length,
    scored: rows.length - weakData,
    weakData,
    canonicalCount,
    distribution,
    pctAboveEma20: ema20Count > 0 ? Math.round((aboveEma20 / ema20Count) * 1000) / 10 : null,
    regimeInput: {
      breadthBullishShare: breadthMeasured > 0 ? Math.round((breadthBullish / breadthMeasured) * 1000) / 1000 : null,
      medianScore,
    },
    rows,
    computedAt: new Date().toISOString(),
  }
}

/** Cached whole-market signal computation (10 min — follows the intraday price refresh). */
export function getCachedMarketSignals(): Promise<MarketSignalsOutput> {
  // v4: tech-signals@5 recalibration (decision gates, de-duplicated weights,
  // structure veto, hysteresis, structural trade plans) — the bump invalidates
  // stale v3 payloads whose scoring semantics no longer match the engine.
  // v5: metric-parity remediation (2026-11-15) — rows now carry a canonical
  // metric block + metricsSource, and non-canonical rows withhold their metrics
  // instead of contradicting the company tab. The bump invalidates v4 payloads
  // whose rows lack those fields (a persisted v4 snapshot would otherwise be
  // served for up to 24h off-hours, hiding the fix and mislabeling its source).
  // v6: opportunity layer (opportunity@1, 2026-11-15) — candidate rows now
  // carry `opportunity` (view + ladder + OQS). The persisted row shape changed,
  // so the bump retires v5 payloads whose rows lack the field (same lesson as
  // the board-snapshot key bump: a pre-layer payload must never be served as
  // if it were current).
  // v7: stale-plan guard (opportunity@2 + opportunity-targets@3, 2026-11-15) —
  // the view gained remainingPctToT1 and the layer carries plan/planRebuilt;
  // a persisted v6 snapshot would serve pre-guard ladders whose T1 could sit
  // below the live price (the exact owner bug report this fixes).
  return cached("technical-signals:market:v7", CACHE_MS, async () => {
    const payload = await buildMarketSignalsUncached()
    // Shared read model: every successful compute persists the payload so a
    // cold instance can serve instantly. The write is AWAITED inside the
    // single-flight build — a fire-and-forget write would be frozen mid-flight
    // when the serverless function suspends right after the response.
    await persistBoardSnapshot(payload)
    return payload
  })
}

// =============================================================================
// Gated row shape for FREE callers — identity + public market price ONLY.
// The paid analysis (signal, score, dimensions, reasons, styleFits, metrics,
// trade plan) is removed server-side before serialization and never reaches
// the browser, the network response, or any client state.
// =============================================================================
export interface GatedSignalRow {
  companyId: string
  ticker: string
  nameEn: string
  nameAr: string | null
  sector: string
  marketTier: string
  lastClose: number | null
  changePct: number | null
  asOf: string | null
  locked: true
}

export type BoardRow = MarketSignalRow | GatedSignalRow

export interface BoardMatchedCounts {
  buy: number
  hold: number
  sell: number
  weak: number
  total: number
}

/** The route's response shape: full rows for paid callers, gated rows for free. */
export interface MarketSignalsResponse extends Omit<MarketSignalsOutput, "rows"> {
  rows: BoardRow[]
  /** distribution over the FILTERED set (true filter counts for every tier) */
  matched?: BoardMatchedCounts
  /** aggregate per-tier counts over the FILTERED set */
  tiers?: Record<string, number>
  /** aggregate per-style-tag counts over the FILTERED set */
  styles?: Record<string, number>
  /** distinct sector names over the FULL filtered universe (before gating) —
   * the sector dropdown's option list is public metadata, so it must be
   * complete even when the caller's rows are gated/free-sliced. */
  sectors?: string[]
  /** locked identity rows omitted by the free slice cap */
  lockedRemaining?: number
  plan?: string
  upgradeHint?: { message: string; freeSetSize: number } | null
  hiddenCompanies?: number
  missingFreeTickers?: string[]
}

// =============================================================================
// opportunity@1 digest — the upgraded "فرص اليوم" response core (PURE; the
// route stays glue: auth + payload sourcing + response).
//
// SHAPE: qualifying rows (opportunity.eligible — the STRICT opportunity gates:
// > 5% remaining upside to the ladder's T1 AND RR ≥ 1.5 on real plan numbers)
// ranked by OQS DESC (ties → higher upsidePctToT1, then ticker), followed by a
// SMALL informative tail of non-eligible rows (conditional / observation with
// their rejectionReasonsAr, clearly separated by `section`), total capped at
// 5. Ineligible rows can NEVER outrank eligible ones — the OQS module's own
// hard rule nulls their score, and the ranking splits the lists first.
// Missed rows (the NO-CHASE verdict) travel SEPARATELY in missedRows (cap 3).
// Rows without a candidate state are not in the digest at all.
//
// FREE GATING: identical to the board route — every row a free/anonymous
// caller receives is gateRowForFree(row): locked identity only, every paid
// field (opportunity view, levels, OQS, reasons) stripped server-side by the
// allowlist serialization. `qualifying` still travels (the filter ran for real).
// =============================================================================

export const OPPORTUNITY_DIGEST_VERSION = "opportunity@1"
/** Max rows the strip digest ever returns (qualifying first, never padded). */
export const OPPORTUNITY_DIGEST_CAP = 5
/** Max missed rows in the separate NO-CHASE list. */
export const OPPORTUNITY_DIGEST_MISSED_CAP = 3
/** The exact honest empty-state note (qualifying === 0) — no manufactured hope. */
export const OPPORTUNITY_DIGEST_EMPTY_AR =
  "لا توجد فرص مؤهلة اليوم وفق المعايير الصارمة — هذا طبيعي ولا يتم تصنيع فرص"

/** One ladder rung as serialized on a digest row. */
export interface OpportunityDigestTarget {
  label: string
  price: number
  kind: string
  strength: number | null
  whyAr: string
}

/** Strip-section marker — the UI's three distinct sections + separation. */
export type OpportunityDigestSection = "qualifying" | "watch" | "ineligible"

/**
 * The digest row — an ALLOWLIST projection of a candidate board row: identity
 * + the exact fields the opportunity cards render (view + ladder + OQS).
 * Nothing else from MarketSignalRow crosses the wire.
 */
export interface OpportunityDigestRow {
  companyId: string
  ticker: string
  nameEn: string
  nameAr: string | null
  sector: string
  marketTier: string
  lastClose: number | null
  changePct: number | null
  asOf: string | null
  section: OpportunityDigestSection
  /** conviction tier AFTER the regime gate — display context, NOT the ranking */
  tier: ConvictionTier
  /** true when the regime gate reduced the tier for this row */
  gated: boolean
  /** the regime-gate Arabic note when gated, else null */
  noteAr: string | null
  /** the full opportunity view (state / gates / reasons / notes) */
  view: OpportunityView
  /** ladder rungs (T1 first) with their Arabic evidence — null when none */
  targets: OpportunityDigestTarget[] | null
  oqs: number | null
  oqsComponents: OpportunityScoreComponents | null
  oqsNoteAr: string
  /** factual risk lines: rejectionReasonsAr when present, else the row's own
   *  negative-tone reasons (what may fail — cited, never invented) */
  riskFactorsAr: string[]
  /** confirmed rows — plan levels (null for watching rows) */
  entryLow: number | null
  entryHigh: number | null
  stop: number | null
  riskReward: number | null
  /** watching rows — the close-based activation (null for confirmed rows) */
  activationKind: "close_above" | "close_below" | null
  activationLevel: number | null
  activationConditionAr: string | null
}

/** A missed (NO-CHASE) row in the separate list — identity + the verdict. */
export interface OpportunityMissedRow {
  companyId: string
  ticker: string
  nameEn: string
  nameAr: string | null
  sector: string
  marketTier: string
  lastClose: number | null
  changePct: number | null
  asOf: string | null
  /** the NO-CHASE verdict, emitted exactly by the classifier */
  missedAr: string
  stateNoteAr: string
  watchNextAr: string
  /** remaining upside to T1 from the LAST close — the number that failed the
   *  5% NO-CHASE gate (opportunity@2; the entry-basis upside is gate-internal) */
  remainingPctToT1: number | null
}

export interface OpportunityDigestResponse {
  version: string
  regime: MarketRegime
  regimeNoteAr: string
  /** breadth as a display percent (0-100, 1dp); null when not measurable */
  breadthPct: number | null
  medianScore: number | null
  asOf: string | null
  computedAt: string | null
  /** eligible rows BEFORE the cap — a short digest is never a bug */
  qualifying: number
  rows: (OpportunityDigestRow | GatedSignalRow)[]
  /** missed rows (NO-CHASE) — separate list, never mixed into `rows` */
  missedRows: (OpportunityMissedRow | GatedSignalRow)[]
  /** present IFF qualifying === 0 — the exact honest empty-state note */
  emptyNoteAr?: string
  plan?: string
}

function digestIdentityFields(row: MarketSignalRow) {
  return {
    companyId: row.companyId,
    ticker: row.ticker,
    nameEn: row.nameEn,
    nameAr: row.nameAr,
    sector: row.sector,
    marketTier: row.marketTier,
    lastClose: row.lastClose,
    changePct: row.changePct,
    asOf: row.asOf,
  }
}

/**
 * Build the opportunity@1 digest from full board rows (PURE). Rows without an
 * attached opportunity layer (hold/wait rows, stale pre-layer payloads) are
 * honestly absent: they are not candidates and are not manufactured into one.
 */
export function buildOpportunityDigestV1(
  rows: MarketSignalRow[],
  regime: MarketRegime,
  opts: { cap?: number; missedCap?: number; free: boolean },
): Pick<OpportunityDigestResponse, "qualifying" | "rows" | "missedRows"> & { emptyNoteAr?: string } {
  const cap = Math.max(0, opts.cap ?? OPPORTUNITY_DIGEST_CAP)
  const missedCap = Math.max(0, opts.missedCap ?? OPPORTUNITY_DIGEST_MISSED_CAP)

  const layered = rows.filter((r): r is MarketSignalRow & { opportunity: RowOpportunity } => !!r.opportunity)

  // ---- qualifying: eligible rows, ranked OQS DESC → upside DESC → ticker ----
  const eligible = layered
    .filter((r) => r.opportunity.view.eligible)
    .sort(
      (a, b) =>
        (b.opportunity.oqs ?? -1) - (a.opportunity.oqs ?? -1) ||
        (b.opportunity.view.upsidePctToT1 ?? -Infinity) - (a.opportunity.view.upsidePctToT1 ?? -Infinity) ||
        a.ticker.localeCompare(b.ticker),
    )

  // ---- informative tail: conditional / observation only, never ranked above
  // eligible — appended AFTER the qualifying block in its own sections ----
  const informative = layered
    .filter((r) => !r.opportunity.view.eligible && (r.opportunity.view.state === "conditional" || r.opportunity.view.state === "observation"))
    .sort(
      (a, b) =>
        (a.opportunity.view.state === "conditional" ? 0 : 1) - (b.opportunity.view.state === "conditional" ? 0 : 1) ||
        (b.opportunity.view.upsidePctToT1 ?? -Infinity) - (a.opportunity.view.upsidePctToT1 ?? -Infinity) ||
        a.ticker.localeCompare(b.ticker),
    )

  // ---- missed (NO-CHASE): the separate list, remaining upside DESC → ticker ----
  const missed = layered
    .filter((r) => r.opportunity.view.state === "missed" && r.opportunity.view.missedAr !== null)
    .sort(
      (a, b) =>
        (b.opportunity.view.remainingPctToT1 ?? -Infinity) - (a.opportunity.view.remainingPctToT1 ?? -Infinity) ||
        a.ticker.localeCompare(b.ticker),
    )
    .slice(0, missedCap)

  const qualifying = eligible.length
  const picked = [...eligible, ...informative].slice(0, cap)

  if (opts.free) {
    // Free/anonymous: locked identity only — the SAME server-side redaction
    // the board uses (allowlist serialization, locked:true). `qualifying`
    // still travels: the filter ran for real.
    return {
      qualifying,
      rows: picked.map((r) => gateRowForFree(r)),
      missedRows: missed.map((r) => gateRowForFree(r)),
      ...(qualifying === 0 ? { emptyNoteAr: OPPORTUNITY_DIGEST_EMPTY_AR } : {}),
    }
  }

  const outRow = (r: MarketSignalRow & { opportunity: RowOpportunity }): OpportunityDigestRow => {
    const op = r.opportunity
    const tier = convictionTier(r)
    const gate = applyRegimeGate(tier, regime, op.view.direction === "buy" ? "buy" : "sell")
    const negativeReasonAr = r.reasons.filter((x) => x.tone === "negative").map((x) => x.ar)
    const riskFactorsAr = op.view.rejectionReasonsAr.length > 0 ? op.view.rejectionReasonsAr : negativeReasonAr
    const isConfirmed = op.view.state === "actionable"
    return {
      ...digestIdentityFields(r),
      section: op.view.eligible ? "qualifying" : op.view.state === "conditional" ? "watch" : "ineligible",
      tier: gate.tier,
      gated: gate.gated,
      noteAr: gate.noteAr,
      view: op.view,
      targets: op.ladder
        ? op.ladder.targets.map((t) => ({ label: t.label, price: t.price, kind: t.kind, strength: t.strength, whyAr: t.whyAr }))
        : null,
      oqs: op.oqs,
      oqsComponents: op.oqsComponents,
      oqsNoteAr: op.oqsNoteAr,
      riskFactorsAr,
      entryLow: isConfirmed && r.tradePlan ? r.tradePlan.entryLow : null,
      entryHigh: isConfirmed && r.tradePlan ? r.tradePlan.entryHigh : null,
      stop: isConfirmed && r.tradePlan ? r.tradePlan.stop : null,
      riskReward: isConfirmed && r.tradePlan ? r.tradePlan.riskReward : null,
      activationKind: !isConfirmed && !op.setupDropped && r.setup ? r.setup.activation.kind : null,
      activationLevel: !isConfirmed && !op.setupDropped && r.setup ? r.setup.activation.level : null,
      activationConditionAr: !isConfirmed && !op.setupDropped && r.setup ? r.setup.activation.basisAr : null,
    }
  }

  const outMissed = (r: MarketSignalRow & { opportunity: RowOpportunity }): OpportunityMissedRow => ({
    ...digestIdentityFields(r),
    missedAr: r.opportunity.view.missedAr as string,
    stateNoteAr: r.opportunity.view.stateNoteAr,
    watchNextAr: r.opportunity.view.watchNextAr,
    remainingPctToT1: r.opportunity.view.remainingPctToT1,
  })

  return {
    qualifying,
    rows: picked.map(outRow),
    missedRows: missed.map(outMissed),
    ...(qualifying === 0 ? { emptyNoteAr: OPPORTUNITY_DIGEST_EMPTY_AR } : {}),
  }
}

/**
 * The per-company opportunity block for the company technical route: the SAME
 * layer the strip serves for this ticker (single source — the board's cached
 * compute already built it on the company's stored candles). null when the
 * row is not a candidate or has no layer (honest "none" at the caller).
 */
export function companyOpportunityFromRows(rows: MarketSignalRow[], ticker: string): RowOpportunity | null {
  const row = rows.find((r) => r.ticker === ticker)
  return row?.opportunity ?? null
}
