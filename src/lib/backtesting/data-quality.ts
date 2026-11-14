// DATA VALIDATION + CORPORATE-ACTION ADJUSTMENT (frozen-context pipeline).
//
// Production pipeline (src/app/api/v1/companies/[id]/technical/route.ts):
//   Yahoo 1d candles -> RawBar[] (live-bars.ts) -> TechnicalSnapshot bundle ->
//   computeCloseSignal (close engine) / computeStanceFromSnapshot (full).
//   Corporate-action continuity at read time comes from the FoudaLens ledger
//   in the DB via corporate-actions.ts (adjustPrevClose on ex-dates).
//
// Sandbox reality: the Neon DB is unreachable, so the ledger-driven ex-date
// adjustment cannot run against real actions. Closest available equivalent:
// Yahoo's adjclose series (split + cash-dividend adjusted), the same vendor
// that supplies production's bars. The frozen corporate-actions PURE math
// (adjustPrevClose / perShareRatio — no DB access) is still exercised here as
// a cross-check: for every split event Yahoo reports, the frozen engine's
// adjustment of the raw previous close must match its documented formula, and
// the implied adjclose factor must agree with the split ratio. Agreements and
// mismatches are counted and reported in the baseline results.
//
// The engine consumes ONLY { ts, close, volume }: close = ADJUSTED close
// (corporate-action continuity), volume = raw session volume (production
// parity — Yahoo volumes are not split-adjusted either).
import {
  adjustPrevClose,
  perShareRatio,
  type CorporateActionTerms,
} from "../../../.cache/engine-baseline/corporate-actions"
import type { BacktestConfig } from "./constants"
import type { EngineRow } from "./types"

export interface RawBar {
  ts: string
  open: number
  high: number
  low: number
  close: number
  volume: number | null
  adjClose: number
}

export interface CachedQuote {
  ticker: string
  fetchedAt: string
  range: string
  adjcloseUsed: boolean
  bars: RawBar[]
  splits: { date: string; numerator: number; denominator: number }[]
  dividends: { date: string; amount: number }[]
}

export interface SeriesStats {
  sessions: number
  firstDate: string | null
  lastDate: string | null
  nullVolumeFraction: number
  duplicateDates: number
  ohlcViolations: number
  weekdayViolations: number
  maxCalendarGapDays: number
  meanAdvEgp: number | null // mean dollar-volume proxy (volume x adjClose)
}

export interface SeriesValidation {
  ticker: string
  ok: boolean
  reasons: string[]
  stats: SeriesStats
  rows: EngineRow[] // adjusted close rows fed to the engine
}

function weekdayOf(ts: string): string {
  return new Date(ts + "T00:00:00Z").toUTCString().slice(0, 3)
}

function gapDays(a: string, b: string): number {
  return (new Date(b + "T00:00:00Z").getTime() - new Date(a + "T00:00:00Z").getTime()) / 86_400_000
}

/** Validate + clean one cached quote; adjust for corporate-action continuity. */
export function validateSeries(quote: CachedQuote, cfg: BacktestConfig): SeriesValidation {
  const reasons: string[] = []
  const bars = [...quote.bars].sort((a, b) => (a.ts < b.ts ? -1 : 1))

  // dedupe identical session dates (keep the first occurrence)
  let duplicateDates = 0
  const seen = new Set<string>()
  const deduped: RawBar[] = []
  for (const b of bars) {
    if (seen.has(b.ts)) { duplicateDates++; continue }
    seen.add(b.ts)
    deduped.push(b)
  }

  // OHLC sanity (raw, unadjusted OHLCV — same fields production ingests).
  // Yahoo EGX bars carry genuine ordering quirks (close > high on auction
  // closes etc.); production's live-bars.ts ingests them as-is. Ordering
  // anomalies are COUNTED and disclosed but are non-fatal — only
  // non-finite/non-positive OHLC values are fatal.
  let ohlcViolations = 0
  let ohlcNonPositive = 0
  for (const b of deduped) {
    const vals = [b.open, b.high, b.low, b.close]
    if (!vals.every((x) => Number.isFinite(x) && x > 0)) { ohlcNonPositive++; ohlcViolations++; continue }
    if (b.high < Math.max(b.open, b.close) - 1e-9) ohlcViolations++
    else if (b.low > Math.min(b.open, b.close) + 1e-9) ohlcViolations++
  }

  // weekday sanity: EGX sessions are Sunday-Thursday (Cairo). Friday/Saturday
  // UTC dates are violations.
  let weekdayViolations = 0
  for (const b of deduped) {
    const wd = new Date(b.ts + "T00:00:00Z").getUTCDay()
    if (wd === 5 || wd === 6) weekdayViolations++ // Friday / Saturday
  }

  const withVol = deduped.filter((b) => b.volume !== null && b.volume > 0)
  const nullVolumeFraction = deduped.length
    ? (deduped.length - withVol.length) / deduped.length
    : 1
  const maxGap = deduped.length >= 2
    ? Math.max(...deduped.slice(1).map((b, i) => gapDays(deduped[i].ts, b.ts)))
    : 0
  const adv = withVol.length
    ? withVol.reduce((s, b) => s + (b.volume as number) * b.close, 0) / withVol.length
    : null

  const stats: SeriesStats = {
    sessions: deduped.length,
    firstDate: deduped[0]?.ts ?? null,
    lastDate: deduped[deduped.length - 1]?.ts ?? null,
    nullVolumeFraction,
    duplicateDates,
    ohlcViolations,
    weekdayViolations,
    maxCalendarGapDays: maxGap,
    meanAdvEgp: adv,
  }

  if (deduped.length < cfg.minSessions) reasons.push(`only ${deduped.length} sessions (< ${cfg.minSessions})`)
  if (ohlcNonPositive > 0) reasons.push(`${ohlcNonPositive} non-finite/non-positive OHLC bars`)
  if (weekdayViolations > 0) reasons.push(`${weekdayViolations} Friday/Saturday sessions`)
  if (maxGap > 14) reasons.push(`max calendar gap ${maxGap} days (suspension?)`)
  // ordering anomalies disclosed in stats (ohlcViolations) but non-fatal

  const rows: EngineRow[] = deduped.map((b) => ({
    ts: b.ts,
    close: Number.isFinite(b.adjClose) && b.adjClose > 0 ? b.adjClose : b.close,
    volume: b.volume,
  }))

  return { ticker: quote.ticker, ok: reasons.length === 0, reasons, stats, rows }
}

export interface SplitCrossCheck {
  ticker: string
  date: string
  splitRatio: number
  frozenAdjPrev: number
  frozenExpected: number
  frozenMatch: boolean
  yahooImpliedRatio: number | null
  yahooMatch: boolean | null
}

/**
 * Cross-check the frozen corporate-actions pure math against Yahoo's split
 * events (the only action class whose exact terms are available without the
 * DB). Verifies (a) adjustPrevClose implements the documented split formula
 * and (b) Yahoo's adjclose factor implies the same ratio across the ex-date.
 */
export function crossCheckSplits(quote: CachedQuote, validation: SeriesValidation): SplitCrossCheck[] {
  const out: SplitCrossCheck[] = []
  const bars = [...quote.bars].sort((a, b) => (a.ts < b.ts ? -1 : 1))
  const idx = new Map(bars.map((b, i) => [b.ts, i]))
  for (const s of quote.splits) {
    const i = idx.get(s.date)
    if (i === undefined || i === 0) continue
    const prev = bars[i - 1]
    const terms: CorporateActionTerms = {
      actionType: "split",
      ratioNumerator: BigInt(Math.round(s.numerator)),
      ratioDenominator: BigInt(Math.round(s.denominator)),
      cashPerShare: null,
      subscriptionPrice: null,
    }
    const ratio = perShareRatio(terms)
    if (ratio === null) continue
    const frozenAdjPrev = adjustPrevClose(prev.close, [terms])
    const frozenExpected = prev.close / ratio
    const frozenMatch = Math.abs(frozenAdjPrev - frozenExpected) < 1e-9
    // Yahoo implied: factor[d]/factor[d-1] should equal the split ratio
    const f0 = prev.adjClose / prev.close
    const f1 = bars[i].adjClose / bars[i].close
    const implied = f0 > 0 && f1 > 0 ? f1 / f0 : null
    const yahooMatch = implied !== null ? Math.abs(implied - ratio) / ratio < 0.05 : null
    out.push({
      ticker: quote.ticker,
      date: s.date,
      splitRatio: ratio,
      frozenAdjPrev,
      frozenExpected,
      frozenMatch,
      yahooImpliedRatio: implied,
      yahooMatch,
    })
  }
  return out
}
