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
