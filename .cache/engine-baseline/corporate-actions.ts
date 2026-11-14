// Corporate-action ex-date adjustment — the daily-change engine.
//
// A bonus issue, split, rights issue or cash dividend mechanically moves the
// share price on the ex-date. TradingView's scanner `change` field (and any
// naive prev-close comparison) reports that mechanical drop as a market loss:
//   CANA (Suez Canal Bank) 2026-11-12: 0.5 bonus shares per share → the
//   scanner showed −31.9% while the market's real move was ≈ +2%.
//
// Fix: on the ex-date, rebuild the previous close from the action terms
// BEFORE computing the change:
//   stock_dividend (bonus b per share): adjPrev = prev / (1 + b)
//   split (s new per 1 old):            adjPrev = prev / s
//   cash dividend (d EGP per share):    adjPrev = prev − d
//   rights issue (r per share at S):    adjPrev = (prev + r·S) / (1 + r)  [TERP]
//
// The scanner's change is only trusted to span [previousSession → latest
// session]. The adjustment applies when the action's ex-date equals that
// latest session date. Server-only (DB access); the pure math is exported
// for tests.

import { db } from "@/lib/db"
import { EGX_TIMEZONE } from "./egx-hours"

/** Action terms needed for the adjustment math (subset of the Prisma row). */
export interface CorporateActionTerms {
  actionType: string // stock_dividend | cash_dividend | split | rights | other
  ratioNumerator: bigint | null
  ratioDenominator: bigint | null
  cashPerShare: number | null
  subscriptionPrice: number | null
}

/** Per-share ratio from the numerator/denominator pair (null when unusable). */
export function perShareRatio(a: Pick<CorporateActionTerms, "ratioNumerator" | "ratioDenominator">): number | null {
  if (a.ratioNumerator === null || a.ratioDenominator === null) return null
  const den = Number(a.ratioDenominator)
  if (!Number.isFinite(den) || den <= 0) return null
  const ratio = Number(a.ratioNumerator) / den
  return Number.isFinite(ratio) && ratio > 0 ? ratio : null
}

/**
 * Adjusted previous close given the raw previous close and the actions whose
 * ex-date falls ON the session being priced. Multiple actions compose in
 * sequence (rare, but e.g. bonus + cash on the same day happens).
 * Returns the input unchanged when nothing applies (never throws).
 */
export function adjustPrevClose(rawPrev: number, actions: CorporateActionTerms[]): number {
  let adj = rawPrev
  for (const a of actions) {
    if (a.actionType === "stock_dividend" || a.actionType === "split") {
      const ratio = perShareRatio(a)
      // stock_dividend: b new shares per 1 held → price scales by 1/(1+b).
      // split: s new shares replace 1 → price scales by 1/s. Both arrive as
      // numerator/denominator; stock_dividend's ratio is IN ADDITION to the
      // held share, a split's ratio REPLACES it.
      if (ratio !== null && ratio > 0) adj = adj / (a.actionType === "split" ? ratio : 1 + ratio)
    } else if (a.actionType === "cash_dividend") {
      const d = a.cashPerShare
      if (d !== null && Number.isFinite(d) && d > 0 && adj > d) adj = adj - d
    } else if (a.actionType === "rights") {
      const r = perShareRatio(a)
      const s = a.subscriptionPrice
      if (r !== null && r > 0 && s !== null && Number.isFinite(s) && s > 0) {
        adj = (adj + r * s) / (1 + r)
      }
    }
  }
  return adj > 0 ? adj : rawPrev
}

/**
 * The session whose change the scanner is currently reporting, plus the one
 * before it: [latest, previous]. Weekend-aware (Sun–Thu Cairo); pre-open on a
 * trading day the scanner still shows yesterday's session, so "latest" rolls
 * back. Holidays are ignored (worst case: an adjustment is skipped for one
 * day — never fabricated).
 */
export function scannerChangeSessions(now: Date = new Date()): { latest: string; previous: string } {
  const dayISO = (d: Date): string => {
    const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: EGX_TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit" })
    return fmt.format(d) // YYYY-MM-DD
  }
  const isTradingDay = (d: Date): boolean => {
    const wd = new Intl.DateTimeFormat("en-US", { timeZone: EGX_TIMEZONE, weekday: "short" }).format(d)
    return ["Sun", "Mon", "Tue", "Wed", "Thu"].includes(wd)
  }
  const cairoMinutes = (d: Date): number => {
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat("en-US", { timeZone: EGX_TIMEZONE, hour: "2-digit", minute: "2-digit", hour12: false })
        .formatToParts(d)
        .map((p) => [p.type, p.value])
    )
    return (Number(parts.hour) % 24) * 60 + Number(parts.minute)
  }
  const sessions: string[] = []
  const cursor = new Date(now.getTime())
  // Pre-open on a trading day → the reported change still belongs to the
  // previous session (EGX opens 09:45 Cairo).
  if (isTradingDay(cursor) && cairoMinutes(cursor) < 9 * 60 + 45) cursor.setUTCDate(cursor.getUTCDate() - 1)
  while (sessions.length < 2) {
    if (isTradingDay(cursor)) sessions.push(dayISO(cursor))
    cursor.setUTCDate(cursor.getUTCDate() - 1)
    if (sessions.length === 0 && cursor.getTime() < now.getTime() - 10 * 86_400_000) break // safety
  }
  return { latest: sessions[0] ?? dayISO(now), previous: sessions[1] ?? sessions[0] ?? dayISO(now) }
}

/** UTC-midnight boundary of an ISO date (YYYY-MM-DD) as a Date. */
function dayStart(isoDay: string): Date {
  return new Date(`${isoDay}T00:00:00.000Z`)
}

/** True when the action's ex-date equals the given session day (YYYY-MM-DD). */
export function actionOnSession(a: { exDate: Date }, sessionISO: string): boolean {
  const t = a.exDate.getTime()
  const start = dayStart(sessionISO).getTime()
  return t >= start && t < start + 86_400_000
}

interface ActionRowLite {
  companyId: string
  actionType: string
  exDate: Date
  ratioNumerator: bigint | null
  ratioDenominator: bigint | null
  cashPerShare: number | null
  subscriptionPrice: number | null
}

/**
 * Adjusted previous-session close from Yahoo's daily bars (split-adjusted
 * `close` series — current trading units), strictly before the given ex-date.
 *
 * Why not the scanner's own change field: across an ex-date TradingView's
 * `change` is unreliable in BOTH directions — CANA 2026-11-12 showed −31.9%
 * (unadjusted) at the close, then +53.2% (bonus factor applied TWICE to the
 * base) the next day. Yahoo's back-adjusted close (34.01 vs the raw 51.02)
 * is the honest base: 34.74 vs 34.01 = the market's real +2.15%.
 *
 * Returns null on any failure — callers then fall back to scanner math.
 */
export async function yahooPrevCloseBefore(ticker: string, exDate: Date, timeoutMs = 9_000): Promise<number | null> {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}.CA?range=1mo&interval=1d`
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36" },
      signal: AbortSignal.timeout(timeoutMs),
      cache: "no-store",
    })
    if (!res.ok) return null
    const j = (await res.json()) as {
      chart?: { result?: { timestamp?: number[]; indicators?: { quote?: { close?: (number | null)[] }[] } }[] }
    }
    const r = j.chart?.result?.[0]
    const ts = r?.timestamp
    const close = r?.indicators?.quote?.[0]?.close
    if (!ts || !close) return null
    const exStart = new Date(Date.UTC(exDate.getUTCFullYear(), exDate.getUTCMonth(), exDate.getUTCDate())).getTime()
    let best: number | null = null
    let bestTs = -1
    for (let i = 0; i < ts.length; i++) {
      if (ts[i] * 1000 >= exStart) continue
      const c = close[i]
      if (typeof c === "number" && Number.isFinite(c) && c > 0 && ts[i] > bestTs) {
        bestTs = ts[i]
        best = c
      }
    }
    return best
  } catch {
    return null
  }
}

let sessionActionsCache: { at: number; sessions: { latest: string; previous: string }; byTicker: Map<string, CorporateActionTerms[]> } | null = null
const SESSION_CACHE_MS = 5 * 60_000

/**
 * Actions (from CorporateAction + the cash Dividend ledger) whose ex-date
 * equals the session the scanner currently prices, keyed by ticker. Cached
 * 5 min per lambda — the import cadence is daily at most.
 */
export async function loadSessionActionsByTicker(now: Date = new Date()): Promise<{ sessions: { latest: string; previous: string }; byTicker: Map<string, CorporateActionTerms[]> }> {
  if (sessionActionsCache && Date.now() - sessionActionsCache.at < SESSION_CACHE_MS) {
    return { sessions: sessionActionsCache.sessions, byTicker: sessionActionsCache.byTicker }
  }
  const sessions = scannerChangeSessions(now)
  const start = dayStart(sessions.latest)
  const end = new Date(start.getTime() + 86_400_000)
  const byTicker = new Map<string, CorporateActionTerms[]>()
  try {
    const [actions, dividends] = await Promise.all([
      db.corporateAction.findMany({
        where: { exDate: { gte: start, lt: end }, actionType: { not: "cash_dividend" } },
        select: { company: { select: { ticker: true } }, actionType: true, exDate: true, ratioNumerator: true, ratioDenominator: true, cashPerShare: true, subscriptionPrice: true },
      }),
      db.dividend.findMany({
        where: { exDividendDate: { gte: start, lt: end }, dividendPerShare: { gt: 0 }, dividendType: { in: ["CASH", "SPECIAL"] } },
        select: { company: { select: { ticker: true } }, dividendPerShare: true, exDividendDate: true },
      }),
    ])
    const push = (ticker: string, terms: CorporateActionTerms): void => {
      const t = ticker.toUpperCase()
      const arr = byTicker.get(t) ?? []
      arr.push(terms)
      byTicker.set(t, arr)
    }
    for (const a of actions as (ActionRowLite & { company: { ticker: string } })[]) {
      if (!actionOnSession(a, sessions.latest)) continue
      push(a.company.ticker, {
        actionType: a.actionType,
        ratioNumerator: a.ratioNumerator,
        ratioDenominator: a.ratioDenominator,
        cashPerShare: a.cashPerShare,
        subscriptionPrice: a.subscriptionPrice,
      })
    }
    for (const d of dividends) {
      if (!d.exDividendDate || !actionOnSession({ exDate: d.exDividendDate }, sessions.latest)) continue
      push(d.company.ticker, {
        actionType: "cash_dividend",
        ratioNumerator: null,
        ratioDenominator: null,
        cashPerShare: d.dividendPerShare,
        subscriptionPrice: null,
      })
    }
  } catch {
    // DB hiccup → empty map: the change stays raw (never fabricated), the
    // next refresh retries.
    byTicker.clear()
  }
  sessionActionsCache = { at: Date.now(), sessions, byTicker }
  return { sessions, byTicker }
}

/** Apply the session adjustment to one scanner mover row (pure). */
export function adjustedChangePct(price: number, rawChangePct: number, actions: CorporateActionTerms[] | undefined): number {
  if (!actions || actions.length === 0) return rawChangePct
  const rawPrev = price / (1 + rawChangePct / 100)
  if (!(rawPrev > 0)) return rawChangePct
  const adjPrev = adjustPrevClose(rawPrev, actions)
  if (!(adjPrev > 0)) return rawChangePct
  return ((price - adjPrev) / adjPrev) * 100
}

// =============================================================================
// Series adjustment — corporate-action continuity for the technical analysis.
//
// The technical bundle merges bars from three sources with DIFFERENT
// adjustment semantics:
//   • scanner day-rows (TradingView) and stored PriceBar rows are RAW prices,
//   • Yahoo chart bars are ALREADY split/bonus-adjusted (Yahoo's chart `close`
//     for EGX reflects share events — CANA 2026-11-12: the raw Nov 11 close
//     51.02 comes back as 34.01), but Yahoo does NOT adjust cash dividends.
//
// A series that mixes them shows a fake cliff at every ex-date whose bars come
// from a raw source (exactly the CANA complaint: "التحليل الفني ظاهر انه هابط
// مع انه في قمة"). The fix is two passes over one merged series:
//
//   Phase 1 — de-adjust Yahoo bars back to RAW terms using OUR event ledger
//   (multiply pre-ex-date Yahoo bars by 1+b / s — the exact inverse of the
//   adjustment Yahoo already applied). Cash/rights have no phase-1 inverse
//   because Yahoo never applied them.
//
//   Phase 2 — re-adjust the now-uniform RAW series newest→oldest: for each
//   event, rebuild the session close immediately before its ex-date with
//   adjustPrevClose() and scale every bar on/before it by the resulting
//   factor. Because events are processed newest→oldest, older events see the
//   close already adjusted for newer ones — correct compounding.
//
// The result is ONE consistently adjusted series regardless of which source
// served which session, and it is idempotent for Yahoo-sourced bars (de-adjust
// + re-adjust cancel out exactly).
// =============================================================================

export interface SeriesBar {
  ts: string // YYYY-MM-DD (UTC session day)
  open: number
  high: number
  low: number
  close: number
  volume: number | null
  /** Which source produced this bar — decides phase-1 de-adjustment. */
  source?: "yahoo" | "scanner" | "pricebar"
}

export interface SeriesAction {
  exDateISO: string // YYYY-MM-DD
  terms: CorporateActionTerms
}

export interface AdjustedSeriesResult {
  bars: SeriesBar[]
  /** Events that actually rescaled the series (for honest disclosure). */
  eventsApplied: { exDateISO: string; actionType: string; factor: number }[]
}

/** Multiplicative factor a share-type action applies going BACKWARD in time
 *  (the inverse of the price scale Yahoo bakes into its `close` series). */
function shareEventInverseFactor(a: CorporateActionTerms): number | null {
  if (a.actionType === "stock_dividend" || a.actionType === "split") {
    const ratio = perShareRatio(a)
    if (ratio === null || ratio <= 0) return null
    return a.actionType === "split" ? ratio : 1 + ratio
  }
  return null
}

export function applyCorporateActionAdjustments(bars: SeriesBar[], actions: SeriesAction[]): AdjustedSeriesResult {
  const eventsApplied: AdjustedSeriesResult["eventsApplied"] = []
  if (bars.length === 0 || actions.length === 0) return { bars: bars.map((b) => ({ ...b })), eventsApplied }

  // Deep copy — never mutate the caller's series.
  const out: SeriesBar[] = bars.map((b) => ({ ...b }))
  out.sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0))

  const usable = actions.filter((a) => a.exDateISO.length === 10)
  if (usable.length === 0) return { bars: out, eventsApplied }

  // Only events whose ex-date has actually ARRIVED (on/before the last bar)
  // take effect: a future ex-date must not rescale today's cum-event prices.
  const lastTs = out[out.length - 1].ts
  const effective = usable.filter((a) => a.exDateISO <= lastTs)
  if (effective.length === 0) return { bars: out, eventsApplied }

  // ---------- Phase 1: de-adjust Yahoo bars to the raw price universe ----------
  for (const a of effective) {
    const inv = shareEventInverseFactor(a.terms)
    if (inv === null) continue
    for (const bar of out) {
      if (bar.source === "yahoo" && bar.ts < a.exDateISO) {
        bar.open *= inv
        bar.high *= inv
        bar.low *= inv
        bar.close *= inv
      }
    }
  }

  // ---------- Phase 2: re-adjust the raw series, newest event first ----------
  const desc = [...effective].sort((a, b) => (a.exDateISO > b.exDateISO ? -1 : a.exDateISO < b.exDateISO ? 1 : 0))
  for (const a of desc) {
    // Last session STRICTLY before the ex-date — the change base that the
    // ex-date's mechanical move would corrupt.
    let idx = -1
    for (let i = out.length - 1; i >= 0; i--) {
      if (out[i].ts < a.exDateISO) {
        idx = i
        break
      }
    }
    if (idx < 0) continue
    const base = out[idx].close
    if (!(base > 0)) continue
    const adj = adjustPrevClose(base, [a.terms])
    if (!(adj > 0) || Math.abs(adj - base) < 1e-9) continue
    const f = adj / base
    for (let i = 0; i <= idx; i++) {
      out[i].open *= f
      out[i].high *= f
      out[i].low *= f
      out[i].close *= f
    }
    eventsApplied.push({ exDateISO: a.exDateISO, actionType: a.terms.actionType, factor: f })
  }

  // Tame float noise from repeated scaling (sub-piastre precision is plenty
  // for EGP prices quoted in piastres).
  for (const bar of out) {
    bar.open = Number(bar.open.toFixed(4))
    bar.high = Number(bar.high.toFixed(4))
    bar.low = Number(bar.low.toFixed(4))
    bar.close = Number(bar.close.toFixed(4))
  }
  return { bars: out, eventsApplied }
}

/**
 * Every adjustment-relevant action for ONE company inside [fromISO, toISO]:
 * share/rights events from the CorporateAction ledger plus cash dividends
 * from the Dividend ledger (which reaches back years, while FoudaLens
 * corporate actions cover ~6 months). Cash_dividend rows are deliberately
 * excluded from the CorporateAction query — the Dividend table is the single
 * cash source, so an event recorded in both is never subtracted twice.
 * Server-only (DB access); empty on any DB hiccup (series stays raw).
 */
export async function loadCompanySeriesActions(companyId: string, fromISO: string, toISO: string): Promise<SeriesAction[]> {
  const from = new Date(`${fromISO}T00:00:00.000Z`)
  const to = new Date(`${toISO}T00:00:00.000Z`)
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to < from) return []
  const toExclusive = new Date(to.getTime() + 86_400_000)
  const out: SeriesAction[] = []
  try {
    const [actions, dividends] = await Promise.all([
      db.corporateAction.findMany({
        where: { companyId, exDate: { gte: from, lt: toExclusive }, actionType: { not: "cash_dividend" } },
        select: { actionType: true, exDate: true, ratioNumerator: true, ratioDenominator: true, cashPerShare: true, subscriptionPrice: true },
      }),
      db.dividend.findMany({
        where: { companyId, exDividendDate: { gte: from, lt: toExclusive }, dividendPerShare: { gt: 0 }, dividendType: { in: ["CASH", "SPECIAL"] } },
        select: { dividendPerShare: true, exDividendDate: true },
      }),
    ])
    for (const a of actions) {
      if (!a.exDate) continue
      out.push({ exDateISO: a.exDate.toISOString().slice(0, 10), terms: { actionType: a.actionType, ratioNumerator: a.ratioNumerator, ratioDenominator: a.ratioDenominator, cashPerShare: a.cashPerShare, subscriptionPrice: a.subscriptionPrice } })
    }
    for (const d of dividends) {
      if (!d.exDividendDate) continue
      out.push({ exDateISO: d.exDividendDate.toISOString().slice(0, 10), terms: { actionType: "cash_dividend", ratioNumerator: null, ratioDenominator: null, cashPerShare: d.dividendPerShare, subscriptionPrice: null } })
    }
  } catch {
    return []
  }
  return out
}

/**
 * Actions whose ex-date falls in the (from, to] UTC window — used by the
 * treemap fallback that compares the two latest durable price rows: the
 * previous row predates the ex-date, the latest row is on/after it.
 * Keyed by ticker. Dividend-table cash dividends are merged in (their ledger
 * goes back years, FoudaLens corporate actions only ~6 months).
 */
export async function loadActionsBetween(fromISO: Date, toISO: Date): Promise<Map<string, CorporateActionTerms[]>> {
  const byTicker = new Map<string, CorporateActionTerms[]>()
  try {
    const [actions, dividends] = await Promise.all([
      db.corporateAction.findMany({
        where: { exDate: { gt: fromISO, lte: toISO }, actionType: { not: "cash_dividend" } },
        select: { company: { select: { ticker: true } }, actionType: true, ratioNumerator: true, ratioDenominator: true, cashPerShare: true, subscriptionPrice: true },
      }),
      db.dividend.findMany({
        where: { exDividendDate: { gt: fromISO, lte: toISO }, dividendPerShare: { gt: 0 }, dividendType: { in: ["CASH", "SPECIAL"] } },
        select: { company: { select: { ticker: true } }, dividendPerShare: true },
      }),
    ])
    const push = (ticker: string, terms: CorporateActionTerms): void => {
      const t = ticker.toUpperCase()
      const arr = byTicker.get(t) ?? []
      arr.push(terms)
      byTicker.set(t, arr)
    }
    for (const a of actions) push(a.company.ticker, { actionType: a.actionType, ratioNumerator: a.ratioNumerator, ratioDenominator: a.ratioDenominator, cashPerShare: a.cashPerShare, subscriptionPrice: a.subscriptionPrice })
    for (const d of dividends) push(d.company.ticker, { actionType: "cash_dividend", ratioNumerator: null, ratioDenominator: null, cashPerShare: d.dividendPerShare, subscriptionPrice: null })
  } catch {
    byTicker.clear()
  }
  return byTicker
}

/**
 * BATCHED variant of loadCompanySeriesActions for whole-market passes: same
 * SeriesAction semantics (CorporateAction minus cash_dividend + Dividend
 * CASH/SPECIAL), but fetched for ALL companies in exactly two indexed
 * queries and grouped by companyId — the market signals board must not pay
 * ~2 round trips per company (~500 queries for the full universe) on its
 * cold compute path.
 */
export async function loadSeriesActionsByCompany(
  companyIds: string[],
  fromISO: string,
  toISO: string
): Promise<Map<string, SeriesAction[]>> {
  const byCompany = new Map<string, SeriesAction[]>()
  if (companyIds.length === 0) return byCompany
  const from = new Date(`${fromISO}T00:00:00.000Z`)
  const to = new Date(`${toISO}T00:00:00.000Z`)
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to < from) return byCompany
  const toExclusive = new Date(to.getTime() + 86_400_000)
  try {
    const [actions, dividends] = await Promise.all([
      db.corporateAction.findMany({
        where: { companyId: { in: companyIds }, exDate: { gte: from, lt: toExclusive }, actionType: { not: "cash_dividend" } },
        select: { companyId: true, actionType: true, exDate: true, ratioNumerator: true, ratioDenominator: true, cashPerShare: true, subscriptionPrice: true },
      }),
      db.dividend.findMany({
        where: { companyId: { in: companyIds }, exDividendDate: { gte: from, lt: toExclusive }, dividendPerShare: { gt: 0 }, dividendType: { in: ["CASH", "SPECIAL"] } },
        select: { companyId: true, dividendPerShare: true, exDividendDate: true },
      }),
    ])
    for (const a of actions) {
      if (!a.exDate) continue
      const arr = byCompany.get(a.companyId) ?? []
      arr.push({ exDateISO: a.exDate.toISOString().slice(0, 10), terms: { actionType: a.actionType, ratioNumerator: a.ratioNumerator, ratioDenominator: a.ratioDenominator, cashPerShare: a.cashPerShare, subscriptionPrice: a.subscriptionPrice } })
      byCompany.set(a.companyId, arr)
    }
    for (const d of dividends) {
      if (!d.exDividendDate) continue
      const arr = byCompany.get(d.companyId) ?? []
      arr.push({ exDateISO: d.exDividendDate.toISOString().slice(0, 10), terms: { actionType: "cash_dividend", ratioNumerator: null, ratioDenominator: null, cashPerShare: d.dividendPerShare, subscriptionPrice: null } })
      byCompany.set(d.companyId, arr)
    }
  } catch {
    byCompany.clear()
  }
  return byCompany
}

// =============================================================================
// Admin gap detector — pure, no DB.
//
// A close-to-close drop larger than 12% between consecutive sessions is
// either a real crash or an UNRECORDED corporate action (exactly how the CANA
// bonus was found: −31.9% overnight). The admin actions page runs this against
// the stored PriceBar series and the existing action ex-dates: a gap whose
// ex-date window (±3 calendar days) already holds a recorded action is covered
// — anything else needs the admin to check the exchange's official notices.
// =============================================================================

/** Result row of the suspicious-gap scan. `dropPct` is in percentage points
 *  (20 means the close fell 20% from prevTs to ts). */
export interface SuspiciousGap {
  ts: string // YYYY-MM-DD of the session AFTER the drop
  prevTs: string // YYYY-MM-DD of the session BEFORE the drop
  dropPct: number
  hasAction: boolean
}

/** UTC YYYY-MM-DD of a Date or an already-ISO date string. */
function gapDayISO(v: Date | string): string {
  if (typeof v === "string") return v.slice(0, 10)
  return v.toISOString().slice(0, 10)
}

const GAP_DROP_FRACTION = 0.12 // >12% overnight drop is worth a look
const GAP_ACTION_WINDOW_DAYS = 3

/**
 * Scan consecutive bars (in the order given — callers pass ts ascending) and
 * flag every >12% close-to-close drop. A drop is `hasAction: true` when ANY
 * recorded action ex-date falls within ±3 calendar days of the drop session
 * (weekends/holidays can push the trading day a couple of days past the
 * ex-date; a wider window would start matching unrelated crashes).
 * Never throws; invalid closes are skipped, not fabricated.
 */
export function detectSuspiciousGaps(
  bars: { ts: Date | string; close: number }[],
  actionExDates: (Date | string)[] = []
): SuspiciousGap[] {
  const exDays = actionExDates.map(gapDayISO)
  const DAY_MS = 86_400_000
  const hasActionNear = (dayISO: string): boolean => {
    const t = Date.parse(`${dayISO}T00:00:00.000Z`)
    if (Number.isNaN(t)) return false
    return exDays.some((e) => {
      const et = Date.parse(`${e}T00:00:00.000Z`)
      return !Number.isNaN(et) && Math.abs(t - et) <= GAP_ACTION_WINDOW_DAYS * DAY_MS
    })
  }
  const gaps: SuspiciousGap[] = []
  let prev: { ts: string; close: number } | null = null
  for (const b of bars) {
    const tsISO = gapDayISO(b.ts)
    if (!Number.isFinite(b.close) || b.close <= 0 || !tsISO || tsISO.length !== 10) continue
    if (prev) {
      const dropPct = ((prev.close - b.close) / prev.close) * 100
      if (dropPct > GAP_DROP_FRACTION * 100) {
        gaps.push({
          ts: tsISO,
          prevTs: prev.ts,
          dropPct: Number(dropPct.toFixed(2)),
          hasAction: hasActionNear(tsISO),
        })
      }
    }
    prev = { ts: tsISO, close: b.close }
  }
  return gaps
}
