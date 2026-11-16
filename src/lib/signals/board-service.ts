// =============================================================================
// Signals board service v2 (tech-signals@7) — the data plumbing around the
// rebuilt engine. Loads the whole universe ONCE (batched, cached 10 min),
// adjusts for corporate actions, anchors EGX sessions, runs the engine per
// company, and publishes a sorted board with honest summary counts.
//
// FREE GATING (unchanged product rule): paid analysis fields never leave the
// server for non-entitled tickers — locked rows carry identity + price only,
// while the summary counts stay public (they describe the matched universe,
// not locked values).
//
// COLD STARTS: every successful compute persists a snapshot (new v2 key) and a
// freshly-scaled instance serves it within the freshness bound.
// =============================================================================

import { db } from "@/lib/db"
import { cached } from "@/lib/server-cache"
import { applyCorporateActionAdjustments, loadSeriesActionsByCompany, type SeriesBar } from "@/lib/market/corporate-actions"
import { effectiveEgxSessionDate } from "@/lib/market/egx-session"
import { computeCompanySignalV2, type CompanyIdentity } from "./engine"
import { SIGNALS_V2_VERSION, type Fundamentals, type SignalRowV2, type SignalState } from "./types"

/** Calendar-day window: ≈200 EGX sessions — deep enough for the 63-session
 *  momentum lookbacks and 90-session zone history, cheap enough to batch. */
const WINDOW_DAYS = 300
const CACHE_MS = 10 * 60_000

export interface BoardSummary {
  buy: number
  near: number
  exit: number
  wait: number
  /** companies with too little history for any reading (part of wait) */
  insufficientData: number
}

export interface BoardOutputV2 {
  version: string
  /** freshest session date across the universe */
  asOf: string | null
  universe: number
  scored: number
  summary: BoardSummary
  /** technical breadth — % of measured companies above EMA50 (disclosure) */
  breadthAboveEma50Pct: number | null
  rows: SignalRowV2[]
  computedAt: string
}

const STATE_ORDER: Record<SignalState, number> = { buy: 0, near: 1, exit: 2, wait: 3 }

/** Locked identity row for free callers — the allowlist projection. */
export interface GatedRowV2 {
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

export function gateRowV2ForFree(row: SignalRowV2): GatedRowV2 {
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
    locked: true,
  }
}

/** The route's response shape: full rows for paid callers, gated rows for free. */
export type BoardRow = SignalRowV2 | GatedRowV2

export interface SignalsBoardResponse extends Omit<BoardOutputV2, "rows"> {
  rows: BoardRow[]
  /** distinct sector names over the full universe (public metadata) */
  sectors?: string[]
  plan?: string
  lockedRemaining?: number
  hiddenCompanies?: number
  upgradeHint?: { message: string; freeSetSize: number } | null
  missingFreeTickers?: string[]
}

function validBar(v: { open: number; high: number; low: number; close: number }): boolean {
  return [v.open, v.high, v.low, v.close].every((x) => Number.isFinite(x) && x > 0) && v.high >= v.low && v.close > 0
}

/** Statement-type preference for fundamentals (same rule as the pipeline:
 *  CONSOLIDATED when any exists for the company, else STANDALONE). */
const PERIOD_PRIORITY: Record<string, number> = { TTM: 5, ANNUAL: 4, NINE_MONTH: 3, SEMIANNUAL: 2, QUARTERLY: 1 }

type FundRow = { companyId: string; code: string; periodType: string; fiscalYear: number; statementType: string; value: number | null }

/** Batched fundamentals read for the warning layer — never blocks the board. */
async function loadFundamentals(ids: string[]): Promise<Map<string, Fundamentals>> {
  if (!ids.length) return new Map()
  try {
    const rows = await db.calculatedMetric.findMany({
      where: { companyId: { in: ids }, code: { in: ["net_profit", "p_e"] }, valueStatus: "OK", value: { not: null } },
      select: { companyId: true, code: true, periodType: true, fiscalYear: true, statementType: true, value: true },
    })
    return fundamentalsOf(rows)
  } catch {
    return new Map() // fundamentals are a disclosure layer — absence never blocks the board
  }
}

/** Per (company, code) keep the freshest row of each statement type
 *  (TTM > annual > interim, then fiscal year), then resolve per company with
 *  the CONSOLIDATED-when-any rule and build the Fundamentals pair. */
function fundamentalsOf(rows: FundRow[]): Map<string, Fundamentals> {
  const byCompany = new Map<string, Map<string, Map<string, { periodPriority: number; fiscalYear: number; value: number }>>>()
  for (const r of rows) {
    if (r.value === null || !Number.isFinite(r.value)) continue
    let byCode = byCompany.get(r.companyId)
    if (!byCode) {
      byCode = new Map()
      byCompany.set(r.companyId, byCode)
    }
    let byStatement = byCode.get(r.code)
    if (!byStatement) {
      byStatement = new Map()
      byCode.set(r.code, byStatement)
    }
    const cur = byStatement.get(r.statementType)
    const pri = PERIOD_PRIORITY[r.periodType] ?? 0
    if (!cur || pri > cur.periodPriority || (pri === cur.periodPriority && r.fiscalYear > cur.fiscalYear)) {
      byStatement.set(r.statementType, { periodPriority: pri, fiscalYear: r.fiscalYear, value: r.value })
    }
  }
  const out = new Map<string, Fundamentals>()
  for (const [companyId, byCode] of byCompany) {
    const hasConsolidated = [...byCode.values()].some((byStatement) => byStatement.has("CONSOLIDATED"))
    const pick = (code: string): number | null => {
      const byStatement = byCode.get(code)
      if (!byStatement) return null
      const chosen = hasConsolidated ? byStatement.get("CONSOLIDATED") : [...byStatement.values()].sort((a, b) => b.periodPriority - a.periodPriority || b.fiscalYear - a.fiscalYear)[0]
      return chosen ? chosen.value : null
    }
    const netProfitEgp = pick("net_profit")
    const peRatio = pick("p_e")
    if (netProfitEgp === null && peRatio === null) continue
    out.set(companyId, { netProfitEgp, peRatio })
  }
  return out
}

async function buildBoardUncached(): Promise<BoardOutputV2> {
  const companies = await db.company.findMany({
    where: { isActive: true },
    select: { id: true, ticker: true, nameEn: true, nameAr: true, sector: true, marketTier: true },
    orderBy: { ticker: "asc" },
  })
  const ids = companies.map((c) => c.id)
  const cutoff = new Date(Date.now() - WINDOW_DAYS * 86_400_000)

  const [barRows, priceRows] = await Promise.all([
    ids.length
      ? db.priceBar.findMany({
          where: { companyId: { in: ids }, ts: { gte: cutoff } },
          orderBy: { ts: "asc" },
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

  // per-company day-bucketed series: PriceBar (full OHLC) first, scanner
  // day-rows overlay their session (freshest wins for that day); Fri/Sat
  // quotes anchor onto the session they restate — no phantom weekend bars.
  const ohlc = new Map<string, { ts: string; open: number; high: number; low: number; close: number; volume: number | null }[]>()
  const byDay = new Map<string, Map<string, { ts: string; open: number; high: number; low: number; close: number; volume: number | null }>>()
  for (const b of barRows) {
    if (!validBar(b)) continue
    const day = b.ts.toISOString().slice(0, 10)
    const bar = { ts: day, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume !== null && Number.isFinite(b.volume) && b.volume > 0 ? b.volume : null }
    let list = ohlc.get(b.companyId)
    if (!list) {
      list = []
      ohlc.set(b.companyId, list)
    }
    list.push(bar)
    let m = byDay.get(b.companyId)
    if (!m) {
      m = new Map()
      byDay.set(b.companyId, m)
    }
    m.set(day, bar)
  }
  for (const r of priceRows) {
    let m = byDay.get(r.companyId)
    if (!m) {
      m = new Map()
      byDay.set(r.companyId, m)
    }
    const rawDay = r.asOf.toISOString().slice(0, 10)
    const day = effectiveEgxSessionDate(r.asOf)
    if (day !== rawDay && m.has(day)) continue
    // scanner rows are close-only: the bar keeps OHLC from PriceBar when the
    // day already exists there; otherwise a flat close-only bar (disclosed)
    const existing = m.get(day)
    const volume = r.volume !== null && Number.isFinite(r.volume) && r.volume > 0 ? r.volume : null
    if (existing) {
      existing.close = r.price
      if (existing.volume === null && volume !== null) existing.volume = volume
    } else {
      m.set(day, { ts: day, open: r.price, high: r.price, low: r.price, close: r.price, volume })
    }
  }

  const companyById = new Map(companies.map((c) => [c.id, c]))
  const todaySession = effectiveEgxSessionDate(new Date())

  // one batched corporate-action load for the whole universe (same as v1)
  const allSeries: { companyId: string; firstTs: string; lastTs: string }[] = []
  for (const [companyId, days] of byDay) {
    const keys = [...days.keys()].sort()
    if (keys.length >= 2) allSeries.push({ companyId, firstTs: keys[0], lastTs: keys[keys.length - 1] })
  }
  const actionsByCompany =
    allSeries.length > 0
      ? await loadSeriesActionsByCompany(
          allSeries.map((s) => s.companyId),
          allSeries.reduce((min, s) => (s.firstTs < min ? s.firstTs : min), allSeries[0].firstTs),
          allSeries.reduce((max, s) => (s.lastTs > max ? s.lastTs : max), allSeries[0].lastTs),
        )
      : new Map()

  // one batched fundamentals load for the warning layer (net profit + P/E)
  const fundamentalsById = await loadFundamentals(ids)

  const rows: SignalRowV2[] = []
  let asOf: string | null = null
  let scored = 0
  let insufficient = 0
  let breadthMeasured = 0
  let breadthAbove = 0

  for (const [companyId, days] of byDay) {
    const c = companyById.get(companyId)
    if (!c) continue
    for (const day of days.keys()) {
      if (!asOf || day > asOf) asOf = day
    }
    let series = [...days.values()].sort((a, b) => a.ts.localeCompare(b.ts))

    // corporate-action continuity: rescale sessions before each ex-date so
    // bonus/split/cash events are not read as market losses (same engine v1)
    try {
      const actions = actionsByCompany.get(companyId) ?? []
      if (series.length >= 2 && actions.length > 0) {
        const bars: SeriesBar[] = series.map((b) => ({
          ts: b.ts,
          open: b.open,
          high: b.high,
          low: b.low,
          close: b.close,
          volume: b.volume,
          source: "scanner",
        }))
        const adjusted = applyCorporateActionAdjustments(bars, actions)
        series = adjusted.bars.map((b) => ({ ts: b.ts, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume }))
      }
    } catch {
      // best-effort — the raw series remains the honest fallback
    }

    // breadth disclosure (close vs EMA50 needs 50 sessions)
    if (series.length >= 50) {
      const closes = series.map((b) => b.close)
      // lightweight EMA50 at the last index (same seeding as the indicator lib)
      let ema50: number | null = null
      {
        const n = 50
        if (closes.length >= n) {
          const seed = closes.slice(0, n).reduce((s, v) => s + v, 0) / n
          ema50 = seed
          const k = 2 / (n + 1)
          for (let i = n; i < closes.length; i++) ema50 = closes[i] * k + ema50 * (1 - k)
        }
      }
      breadthMeasured++
      if (ema50 !== null && closes[closes.length - 1] > ema50) breadthAbove++
    }

    const identity: CompanyIdentity = {
      companyId,
      ticker: c.ticker,
      nameEn: c.nameEn,
      nameAr: c.nameAr,
      sector: c.sector,
      marketTier: (c as { marketTier?: string }).marketTier ?? "MAIN",
    }
    const row = computeCompanySignalV2({
      bars: series,
      identity,
      fundamentals: fundamentalsById.get(companyId) ?? null,
      todaySession,
    })
    rows.push(row)
    if (row.state === "wait" && row.quality.bars < 60) insufficient++
    else if (row.state !== "wait") scored++
  }

  // ---- publish order: the most important opportunities first
  rows.sort((a, b) => {
    const sa = STATE_ORDER[a.state]
    const sb = STATE_ORDER[b.state]
    if (sa !== sb) return sa - sb
    return (b.score ?? -1) - (a.score ?? -1) || a.ticker.localeCompare(b.ticker)
  })

  const summary: BoardSummary = { buy: 0, near: 0, exit: 0, wait: 0, insufficientData: insufficient }
  for (const r of rows) summary[r.state]++

  return {
    version: SIGNALS_V2_VERSION,
    asOf,
    universe: companies.length,
    scored,
    summary,
    breadthAboveEma50Pct: breadthMeasured > 0 ? Math.round((breadthAbove / breadthMeasured) * 1000) / 10 : null,
    rows,
    computedAt: new Date().toISOString(),
  }
}

/** Cached whole-board computation (10 min — follows the intraday refresh). */
export function getSignalsBoard(): Promise<BoardOutputV2> {
  return cached("technical-signals:board-v2:v1", CACHE_MS, async () => {
    const payload = await buildBoardUncached()
    await persistBoardSnapshotV2(payload)
    return payload
  })
}

// ---------------------------------------------------------------------------
// Snapshot persistence (cold-start read model) — same Setting-table pattern as
// v1, under a NEW key so a stale v1 payload can never be served as v2.
// ---------------------------------------------------------------------------

const SNAPSHOT_KEY = "technical-signals:board-v2:snapshot:v1"
const SNAPSHOT_FRESH_MS = 15 * 60_000
const SNAPSHOT_MAX_MS = 24 * 60 * 60_000

export function isEgxMarketOpenCairo(now: Date = new Date()): boolean {
  const cairo = new Intl.DateTimeFormat("en-US", {
    timeZone: "Africa/Cairo",
    hour: "numeric",
    hour12: false,
    weekday: "short",
  }).formatToParts(now)
  const hour = Number(cairo.find((p) => p.type === "hour")?.value ?? "0") % 24
  const weekday = cairo.find((p) => p.type === "weekday")?.value ?? ""
  return ["Sun", "Mon", "Tue", "Wed", "Thu"].includes(weekday) && hour >= 10 && hour < 14.5
}

async function persistBoardSnapshotV2(payload: BoardOutputV2): Promise<boolean> {
  try {
    const value = JSON.stringify(payload)
    await db.setting.upsert({
      where: { key: SNAPSHOT_KEY },
      create: { key: SNAPSHOT_KEY, value, type: "json", description: "Signals board v2 snapshot (tech-signals@7)" },
      update: { value },
    })
    return true
  } catch {
    return false
  }
}

export async function readBoardSnapshotV2(now: Date = new Date()): Promise<BoardOutputV2 | null> {
  try {
    const row = await db.setting.findUnique({ where: { key: SNAPSHOT_KEY }, select: { value: true } })
    if (!row) return null
    const parsed = JSON.parse(row.value) as BoardOutputV2
    if (!parsed || !Array.isArray(parsed.rows) || parsed.rows.length === 0) return null
    if (parsed.version !== SIGNALS_V2_VERSION) return null
    const computedAt = parsed.computedAt ? new Date(parsed.computedAt).getTime() : NaN
    if (!Number.isFinite(computedAt)) return null
    const maxAge = isEgxMarketOpenCairo(now) ? SNAPSHOT_FRESH_MS : SNAPSHOT_MAX_MS
    if (Date.now() - computedAt > maxAge) return null
    return parsed
  } catch {
    return null
  }
}
