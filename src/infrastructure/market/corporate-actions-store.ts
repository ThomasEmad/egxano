// Corporate-action ledger loaders — INFRASTRUCTURE adapters (Prisma + Yahoo fetch).
//
// Feeds the pure adjustment math (src/domain/market/corporate-actions.ts) from
// the CorporateAction ledger (the admin console's write path, including its
// cash_dividend rows — owner bug 2026-11-17) and the Dividend ledger, merged
// under the one-cash-event-per-company-day contract (never subtract twice).
// Server-only. Empty results on any DB hiccup — the series stays raw, never
// fabricated.

import { db } from "@/infrastructure/db"
import {
  scannerChangeSessions,
  dayStart,
  actionOnSession,
  mergeSeriesActionRows,
  type CorporateActionTerms,
  type CorporateActionRowLike,
  type DividendRowLike,
  type SeriesAction,
} from "@/domain/market/corporate-actions"

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
 * Admin write-path hook (POST/PATCH/DELETE on the corporate-actions ledger):
 * drop the 5-minute session-actions cache so the NEXT snapshot refresh re-fits
 * MarketPrice.changePct with the new terms immediately instead of serving a
 * ledger snapshot that predates the admin's save. Purely in-memory; safe to
 * call from any request context.
 */
export function invalidateCorporateActionCaches(): void {
  sessionActionsCache = null
}

/**
 * Actions (from CorporateAction + the cash Dividend ledger) whose ex-date
 * equals the session the scanner currently prices, keyed by ticker. Cached
 * 5 min per lambda — the import cadence is daily at most.
 *
 * Cash events come from BOTH ledgers (CorporateAction rows — the admin
 * console's write path — and the Dividend ledger), merged by
 * mergeSeriesActionRows() with the one-cash-event-per-company-day contract,
 * so an event recorded in both is never subtracted twice.
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
        where: {
          exDate: { gte: start, lt: end },
          // share/rights events of any shape + cash rows with a usable amount
          // (the admin console records cash dividends HERE, not in Dividend)
          OR: [{ actionType: { not: "cash_dividend" } }, { cashPerShare: { gt: 0 } }],
        },
        select: { company: { select: { ticker: true } }, actionType: true, exDate: true, sourceName: true, ratioNumerator: true, ratioDenominator: true, cashPerShare: true, subscriptionPrice: true },
      }),
      db.dividend.findMany({
        where: { exDividendDate: { gte: start, lt: end }, dividendPerShare: { gt: 0 }, dividendType: { in: ["CASH", "SPECIAL"] } },
        select: { company: { select: { ticker: true } }, dividendPerShare: true, exDividendDate: true },
      }),
    ])
    const actionsByTicker = new Map<string, (CorporateActionRowLike & { company: { ticker: string } })[]>()
    const dividendsByTicker = new Map<string, { dividendPerShare: number | null; exDividendDate: Date | null }[]>()
    for (const a of actions) {
      if (!actionOnSession(a, sessions.latest)) continue
      const t = a.company.ticker.toUpperCase()
      const arr = actionsByTicker.get(t) ?? []
      arr.push(a)
      actionsByTicker.set(t, arr)
    }
    for (const d of dividends) {
      if (!d.exDividendDate || !actionOnSession({ exDate: d.exDividendDate }, sessions.latest)) continue
      const t = d.company.ticker.toUpperCase()
      const arr = dividendsByTicker.get(t) ?? []
      arr.push({ dividendPerShare: d.dividendPerShare, exDividendDate: d.exDividendDate })
      dividendsByTicker.set(t, arr)
    }
    for (const [ticker, rows] of actionsByTicker) {
      const merged = mergeSeriesActionRows(rows, dividendsByTicker.get(ticker) ?? [])
      for (const sa of merged) {
        const arr = byTicker.get(ticker) ?? []
        arr.push(sa.terms)
        byTicker.set(ticker, arr)
      }
    }
    for (const [ticker, rows] of dividendsByTicker) {
      if (actionsByTicker.has(ticker)) continue // already merged above
      for (const d of rows) {
        if (d.dividendPerShare === null || !Number.isFinite(d.dividendPerShare) || d.dividendPerShare <= 0) continue
        const arr = byTicker.get(ticker) ?? []
        arr.push({ actionType: "cash_dividend", ratioNumerator: null, ratioDenominator: null, cashPerShare: d.dividendPerShare, subscriptionPrice: null })
        byTicker.set(ticker, arr)
      }
    }
  } catch {
    // DB hiccup → empty map: the change stays raw (never fabricated), the
    // next refresh retries.
    byTicker.clear()
  }
  sessionActionsCache = { at: Date.now(), sessions, byTicker }
  return { sessions, byTicker }
}
/**
 * Every adjustment-relevant action for ONE company inside [fromISO, toISO]:
 * share/rights AND cash-dividend events from the CorporateAction ledger (the
 * admin console's write path — cash rows must never be invisible again,
 * owner bug 2026-11-17) plus cash dividends from the Dividend ledger (which
 * reaches back years, while FoudaLens corporate actions cover ~6 months).
 * The two cash ledgers are merged by mergeSeriesActionRows() under the
 * one-cash-event-per-company-day contract, so an event recorded in both is
 * never subtracted twice. Server-only (DB access); empty on any DB hiccup
 * (series stays raw).
 */
export async function loadCompanySeriesActions(companyId: string, fromISO: string, toISO: string): Promise<SeriesAction[]> {
  const from = new Date(`${fromISO}T00:00:00.000Z`)
  const to = new Date(`${toISO}T00:00:00.000Z`)
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to < from) return []
  const toExclusive = new Date(to.getTime() + 86_400_000)
  try {
    const [actions, dividends] = await Promise.all([
      db.corporateAction.findMany({
        where: {
          companyId,
          exDate: { gte: from, lt: toExclusive },
          OR: [{ actionType: { not: "cash_dividend" } }, { cashPerShare: { gt: 0 } }],
        },
        select: { actionType: true, exDate: true, sourceName: true, ratioNumerator: true, ratioDenominator: true, cashPerShare: true, subscriptionPrice: true },
      }),
      db.dividend.findMany({
        where: { companyId, exDividendDate: { gte: from, lt: toExclusive }, dividendPerShare: { gt: 0 }, dividendType: { in: ["CASH", "SPECIAL"] } },
        select: { dividendPerShare: true, exDividendDate: true },
      }),
    ])
    return mergeSeriesActionRows(actions, dividends)
  } catch {
    return []
  }
}
/**
 * Actions whose ex-date falls in the (from, to] UTC window — used by the
 * treemap fallback that compares the two latest durable price rows: the
 * previous row predates the ex-date, the latest row is on/after it.
 * Keyed by ticker. Dividend-table cash dividends are merged in (their ledger
 * goes back years, FoudaLens corporate actions only ~6 months), and
 * CorporateAction cash rows are included (the admin console records them
 * HERE) — mergeSeriesActionRows() keeps one cash event per company-day.
 */
export async function loadActionsBetween(fromISO: Date, toISO: Date): Promise<Map<string, CorporateActionTerms[]>> {
  const byTicker = new Map<string, CorporateActionTerms[]>()
  try {
    const [actions, dividends] = await Promise.all([
      db.corporateAction.findMany({
        where: {
          exDate: { gt: fromISO, lte: toISO },
          OR: [{ actionType: { not: "cash_dividend" } }, { cashPerShare: { gt: 0 } }],
        },
        select: { company: { select: { ticker: true } }, actionType: true, exDate: true, sourceName: true, ratioNumerator: true, ratioDenominator: true, cashPerShare: true, subscriptionPrice: true },
      }),
      db.dividend.findMany({
        where: { exDividendDate: { gt: fromISO, lte: toISO }, dividendPerShare: { gt: 0 }, dividendType: { in: ["CASH", "SPECIAL"] } },
        select: { company: { select: { ticker: true } }, dividendPerShare: true, exDividendDate: true },
      }),
    ])
    const actionsByTicker = new Map<string, CorporateActionRowLike[]>()
    const dividendsByTicker = new Map<string, DividendRowLike[]>()
    for (const a of actions) {
      const t = a.company.ticker.toUpperCase()
      const arr = actionsByTicker.get(t) ?? []
      arr.push(a)
      actionsByTicker.set(t, arr)
    }
    for (const d of dividends) {
      const t = d.company.ticker.toUpperCase()
      const arr = dividendsByTicker.get(t) ?? []
      arr.push({ dividendPerShare: d.dividendPerShare, exDividendDate: d.exDividendDate })
      dividendsByTicker.set(t, arr)
    }
    for (const [ticker, rows] of actionsByTicker) {
      const merged = mergeSeriesActionRows(rows, dividendsByTicker.get(ticker) ?? [])
      if (merged.length === 0) continue
      byTicker.set(ticker, merged.map((sa) => sa.terms))
    }
    for (const [ticker, rows] of dividendsByTicker) {
      if (actionsByTicker.has(ticker)) continue // already merged above
      for (const d of rows) {
        if (d.dividendPerShare === null || !Number.isFinite(d.dividendPerShare) || d.dividendPerShare <= 0) continue
        const arr = byTicker.get(ticker) ?? []
        arr.push({ actionType: "cash_dividend", ratioNumerator: null, ratioDenominator: null, cashPerShare: d.dividendPerShare, subscriptionPrice: null })
        byTicker.set(ticker, arr)
      }
    }
  } catch {
    byTicker.clear()
  }
  return byTicker
}
/**
 * BATCHED variant of loadCompanySeriesActions for whole-market passes: same
 * SeriesAction semantics (CorporateAction incl. its cash_dividend rows — the
 * admin console's write path — merged with the Dividend ledger under the
 * one-cash-event-per-company-day contract), but fetched for ALL companies in
 * exactly two indexed queries and grouped by companyId — the market signals
 * board must not pay ~2 round trips per company (~500 queries for the full
 * universe) on its cold compute path.
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
        where: {
          companyId: { in: companyIds },
          exDate: { gte: from, lt: toExclusive },
          OR: [{ actionType: { not: "cash_dividend" } }, { cashPerShare: { gt: 0 } }],
        },
        select: { companyId: true, actionType: true, exDate: true, sourceName: true, ratioNumerator: true, ratioDenominator: true, cashPerShare: true, subscriptionPrice: true },
      }),
      db.dividend.findMany({
        where: { companyId: { in: companyIds }, exDividendDate: { gte: from, lt: toExclusive }, dividendPerShare: { gt: 0 }, dividendType: { in: ["CASH", "SPECIAL"] } },
        select: { companyId: true, dividendPerShare: true, exDividendDate: true },
      }),
    ])
    const actionsByCompany = new Map<string, CorporateActionRowLike[]>()
    for (const a of actions) {
      const arr = actionsByCompany.get(a.companyId) ?? []
      arr.push(a)
      actionsByCompany.set(a.companyId, arr)
    }
    const dividendsByCompany = new Map<string, DividendRowLike[]>()
    for (const d of dividends) {
      const arr = dividendsByCompany.get(d.companyId) ?? []
      arr.push({ dividendPerShare: d.dividendPerShare, exDividendDate: d.exDividendDate })
      dividendsByCompany.set(d.companyId, arr)
    }
    for (const [companyId, rows] of actionsByCompany) {
      const merged = mergeSeriesActionRows(rows, dividendsByCompany.get(companyId) ?? [])
      if (merged.length === 0) continue
      byCompany.set(companyId, merged)
    }
    for (const [companyId, rows] of dividendsByCompany) {
      if (actionsByCompany.has(companyId)) continue // already merged above
      for (const d of rows) {
        if (d.dividendPerShare === null || !Number.isFinite(d.dividendPerShare) || d.dividendPerShare <= 0 || !d.exDividendDate) continue
        const arr = byCompany.get(companyId) ?? []
        arr.push({ exDateISO: d.exDividendDate.toISOString().slice(0, 10), terms: { actionType: "cash_dividend", ratioNumerator: null, ratioDenominator: null, cashPerShare: d.dividendPerShare, subscriptionPrice: null } })
        byCompany.set(companyId, arr)
      }
    }
  } catch {
    byCompany.clear()
  }
  return byCompany
}
