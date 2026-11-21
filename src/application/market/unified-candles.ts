// =============================================================================
// unified-candles.ts — THE one candle reader (owner mandate 2026-11-21:
// «كل السهم وكل التحليلات تقرأ من نفس المصدر»).
//
// Every analysis feature (signals board, «حلل سهمي», the technical tab,
// lifecycle alerts, market intelligence, the price chart) loads its OHLC
// history through loadUnifiedHistory — never by querying a feed table
// directly. The priority is absolute and single:
//
//   1. MarketCandle (verified=true) — the quality-gated Yahoo full-history
//      store, refreshed daily by the candles cron. When a company is covered
//      here, its series comes ONLY from here: no mixing with other feeds.
//   2. PriceBar — legacy fallback for companies the unified store does not
//      cover at all (Yahoo resolution failed). Their series stays raw
//      tradingview@daily rows and keeps yesterday's synthetic-flag honesty.
//
// The scanner (MarketPrice) close overlay is NOT part of this loader: only
// the LIVE, unsettled session may be overlaid, and that stays the board
// builders' job (they own the EGX session anchoring). Settled sessions are
// never overwritten by a restatement — that mixing is exactly how the
// two-source skew bugs were born.
// =============================================================================

import { db } from "@/infrastructure/db"

/** Provenance of one history bar — drives the corporate-action engine's
 *  phase-1 de-adjustment (Yahoo-sourced bars arrive split-adjusted; raw
 *  PriceBar rows do not). */
export type BarProvenance = "candle" | "pricebar"

export interface UnifiedBar {
  ts: Date
  open: number
  high: number
  low: number
  close: number
  volume: number | null
  barSource: BarProvenance
}

/**
 * Verified candle history per company, ascending by session date.
 * `companyIds` = the exact universe the caller analyzes (batched: one
 * MarketCandle query + one legacy query only when companies are uncovered).
 */
export async function loadUnifiedHistory(companyIds: string[], since: Date): Promise<Map<string, UnifiedBar[]>> {
  const out = new Map<string, UnifiedBar[]>()
  if (companyIds.length === 0) return out

  const candles = await db.marketCandle.findMany({
    where: { companyId: { in: companyIds }, verified: true, tradeDate: { gte: since } },
    orderBy: { tradeDate: "asc" },
    select: { companyId: true, tradeDate: true, open: true, high: true, low: true, close: true, volume: true },
  })
  for (const r of candles) {
    let list = out.get(r.companyId)
    if (!list) {
      list = []
      out.set(r.companyId, list)
    }
    list.push({ ts: r.tradeDate, open: r.open, high: r.high, low: r.low, close: r.close, volume: r.volume, barSource: "candle" })
  }

  // Coverage is judged WITHOUT the date filter, and ALWAYS probed (never
  // short-circuited on the window query being empty): a company whose candles
  // all sit older than `since` (a suspended name) is still a candle company —
  // its honest series here is EMPTY, never a legacy splice.
  const covered = new Set(
    (
      await db.marketCandle.findMany({
        where: { companyId: { in: companyIds }, verified: true },
        select: { companyId: true },
        distinct: ["companyId"],
      })
    ).map((r) => r.companyId),
  )
  const missing = companyIds.filter((id) => !covered.has(id))
  if (missing.length > 0) {
    const legacy = await db.priceBar.findMany({
      where: { companyId: { in: missing }, ts: { gte: since } },
      orderBy: { ts: "asc" },
      select: { companyId: true, ts: true, open: true, high: true, low: true, close: true, volume: true },
    })
    for (const r of legacy) {
      let list = out.get(r.companyId)
      if (!list) {
        list = []
        out.set(r.companyId, list)
      }
      list.push({ ts: r.ts, open: r.open, high: r.high, low: r.low, close: r.close, volume: r.volume, barSource: "pricebar" })
    }
  }
  return out
}

/** Single-company convenience (same rules, one id). */
export async function loadUnifiedHistoryOne(companyId: string, since: Date): Promise<UnifiedBar[]> {
  return (await loadUnifiedHistory([companyId], since)).get(companyId) ?? []
}
