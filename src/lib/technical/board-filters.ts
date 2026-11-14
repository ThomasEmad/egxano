// =============================================================================
// Board filter engine — the SAME filter semantics the signals board UI applies
// client-side, expressed once as pure functions so the API can execute filters
// server-side over the FULL cached universe.
//
// Why this exists (2026-11-14): free users receive gated rows (paid analysis
// fields never leave the server), so the browser cannot evaluate filters on
// locked rows. The server filters the full cached computation and returns the
// MATCHED companies' identity (ticker/name/sector/tier/last price) — the paid
// signal values stay server-side. Premium callers get the same engine via the
// same params (identical results, one code path).
// =============================================================================

import type { GatedSignalRow, MarketSignalRow } from "./signals-service"

export type BoardSignalFilter = "all" | "buy" | "hold" | "sell"
export type BoardRsiFilter = "all" | "oversold" | "neutral" | "overbought"
export type BoardLiquidityFilter = "all" | "high" | "normal"
export type BoardDayMoveFilter = "all" | "up" | "down"
export type BoardTierFilter = "all" | "EGX30" | "EGX70" | "MAIN" | "OTC"
export type BoardMaFilter = "all" | "aboveEma50" | "belowEma50"
export type BoardRangePosFilter = "all" | "top" | "middle" | "bottom"
export type BoardScoreFilter = "all" | "s70" | "s60"
export type BoardSortKey = "score" | "change" | "perfM1" | "rsi" | "relVol"

export interface BoardFilterParams {
  signal: BoardSignalFilter
  style: string
  rsi: BoardRsiFilter
  liquidity: BoardLiquidityFilter
  dayMove: BoardDayMoveFilter
  tier: BoardTierFilter
  ma: BoardMaFilter
  rangePos: BoardRangePosFilter
  score: BoardScoreFilter
  sector: string
  q: string
  sort: BoardSortKey
}

export const BOARD_FILTER_DEFAULTS: BoardFilterParams = {
  signal: "all",
  style: "all",
  rsi: "all",
  liquidity: "all",
  dayMove: "all",
  tier: "all",
  ma: "all",
  rangePos: "all",
  score: "all",
  sector: "",
  q: "",
  sort: "score",
}

const SIGNAL_VALUES: BoardSignalFilter[] = ["all", "buy", "hold", "sell"]
const RSI_VALUES: BoardRsiFilter[] = ["all", "oversold", "neutral", "overbought"]
const LIQ_VALUES: BoardLiquidityFilter[] = ["all", "high", "normal"]
const MOVE_VALUES: BoardDayMoveFilter[] = ["all", "up", "down"]
const TIER_VALUES: BoardTierFilter[] = ["all", "EGX30", "EGX70", "MAIN", "OTC"]
const MA_VALUES: BoardMaFilter[] = ["all", "aboveEma50", "belowEma50"]
const RANGE_VALUES: BoardRangePosFilter[] = ["all", "top", "middle", "bottom"]
const SCORE_VALUES: BoardScoreFilter[] = ["all", "s70", "s60"]
const SORT_VALUES: BoardSortKey[] = ["score", "change", "perfM1", "rsi", "relVol"]
const STYLE_VALUES = new Set(["all", "day", "swing", "trend", "reversal"])

function pick<T extends string>(raw: string | null, allowed: T[], fallback: T): T {
  return raw && (allowed as string[]).includes(raw) ? (raw as T) : fallback
}

/** Parse + validate filter params from a URL's search params (defaults "all"). */
export function parseBoardFilterParams(sp: URLSearchParams): BoardFilterParams {
  const style = sp.get("style") ?? "all"
  return {
    signal: pick(sp.get("signal"), SIGNAL_VALUES, "all"),
    style: STYLE_VALUES.has(style) ? style : "all",
    rsi: pick(sp.get("rsi"), RSI_VALUES, "all"),
    liquidity: pick(sp.get("liquidity"), LIQ_VALUES, "all"),
    dayMove: pick(sp.get("dayMove"), MOVE_VALUES, "all"),
    tier: pick(sp.get("tier"), TIER_VALUES, "all"),
    ma: pick(sp.get("ma"), MA_VALUES, "all"),
    rangePos: pick(sp.get("rangePos"), RANGE_VALUES, "all"),
    score: pick(sp.get("score"), SCORE_VALUES, "all"),
    sector: (sp.get("sector") ?? "").slice(0, 120),
    q: (sp.get("q") ?? "").slice(0, 120),
    sort: pick(sp.get("sort"), SORT_VALUES, "score"),
  }
}

/** True when any param deviates from the defaults (i.e. a filter is applied). */
export function hasActiveFilters(p: BoardFilterParams): boolean {
  return (
    p.signal !== "all" ||
    p.style !== "all" ||
    p.rsi !== "all" ||
    p.liquidity !== "all" ||
    p.dayMove !== "all" ||
    p.tier !== "all" ||
    p.ma !== "all" ||
    p.rangePos !== "all" ||
    p.score !== "all" ||
    p.sector !== "" ||
    p.q !== ""
  )
}

/**
 * Apply the board filters — semantics identical to the client memo in
 * signals-view.tsx (same thresholds, same null handling), then sort.
 */
export function filterMarketRows(rows: MarketSignalRow[], p: BoardFilterParams): MarketSignalRow[] {
  let list = rows
  if (p.signal !== "all") list = list.filter((r) => r.signal === p.signal)
  if (p.style !== "all") list = list.filter((r) => r.styleFits.some((f) => f.tag === p.style))
  if (p.rsi === "oversold") list = list.filter((r) => r.metrics.rsi14 !== null && r.metrics.rsi14 < 30)
  if (p.rsi === "overbought") list = list.filter((r) => r.metrics.rsi14 !== null && r.metrics.rsi14 > 70)
  if (p.rsi === "neutral") list = list.filter((r) => r.metrics.rsi14 !== null && r.metrics.rsi14 >= 30 && r.metrics.rsi14 <= 70)
  if (p.liquidity === "high") list = list.filter((r) => r.metrics.relVol !== null && r.metrics.relVol >= 1.5)
  if (p.liquidity === "normal") list = list.filter((r) => r.metrics.relVol === null || r.metrics.relVol < 1.5)
  if (p.dayMove === "up") list = list.filter((r) => (r.changePct ?? 0) > 0)
  if (p.dayMove === "down") list = list.filter((r) => (r.changePct ?? 0) < 0)
  if (p.tier !== "all") list = list.filter((r) => (r.marketTier ?? "MAIN") === p.tier)
  if (p.ma === "aboveEma50") list = list.filter((r) => r.metrics.ema50 !== null && r.lastClose !== null && r.lastClose > r.metrics.ema50)
  if (p.ma === "belowEma50") list = list.filter((r) => r.metrics.ema50 !== null && r.lastClose !== null && r.lastClose < r.metrics.ema50)
  if (p.rangePos === "top") list = list.filter((r) => r.metrics.rangePos60 !== null && r.metrics.rangePos60 >= 80)
  if (p.rangePos === "bottom") list = list.filter((r) => r.metrics.rangePos60 !== null && r.metrics.rangePos60 <= 20)
  if (p.rangePos === "middle") list = list.filter((r) => r.metrics.rangePos60 !== null && r.metrics.rangePos60 > 20 && r.metrics.rangePos60 < 80)
  if (p.score === "s70") list = list.filter((r) => (r.score ?? -1) >= 70)
  if (p.score === "s60") list = list.filter((r) => (r.score ?? -1) >= 60)
  if (p.sector) list = list.filter((r) => r.sector === p.sector)
  const needle = p.q.trim().toLowerCase()
  if (needle) {
    list = list.filter(
      (r) =>
        r.ticker.toLowerCase().includes(needle) ||
        r.nameEn.toLowerCase().includes(needle) ||
        (r.nameAr ?? "").includes(needle)
    )
  }
  const sorted = [...list]
  sorted.sort((a, b) => {
    switch (p.sort) {
      case "change": return (b.changePct ?? -99) - (a.changePct ?? -99)
      case "perfM1": return (b.metrics.perfM1 ?? -99) - (a.metrics.perfM1 ?? -99)
      case "rsi": return (a.metrics.rsi14 ?? 999) - (b.metrics.rsi14 ?? 999)
      case "relVol": return (b.metrics.relVol ?? 0) - (a.metrics.relVol ?? 0)
      default: return (b.score ?? -1) - (a.score ?? -1) || a.ticker.localeCompare(b.ticker)
    }
  })
  return sorted
}

/** Aggregate distribution over a filtered set — aggregate counts only. */
export function distributionOf(rows: MarketSignalRow[]): { buy: number; hold: number; sell: number; weak: number; total: number } {
  const d = { buy: 0, hold: 0, sell: 0, weak: 0, total: rows.length }
  for (const r of rows) {
    if (r.signal) d[r.signal]++
    else d.weak++
  }
  return d
}

/**
 * Identity-only projection of a matched company for FREE callers.
 * The paid analysis (signal, score, dimensions, reasons, styleFits, metrics,
 * trade plan, invalidation) is REMOVED here — nothing beyond identity + the
 * public last price/change may cross the wire for a locked row. This is the
 * server-side redaction, not a browser-side blur.
 */
export function gateRowForFree(r: MarketSignalRow): GatedSignalRow {
  return {
    companyId: r.companyId,
    ticker: r.ticker,
    nameEn: r.nameEn,
    nameAr: r.nameAr,
    sector: r.sector,
    marketTier: r.marketTier,
    lastClose: r.lastClose,
    changePct: r.changePct,
    asOf: r.asOf,
    locked: true,
  }
}
