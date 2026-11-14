import { describe, expect, it } from "vitest"
import {
  distributionOf,
  filterMarketRows,
  gateRowForFree,
  hasActiveFilters,
  parseBoardFilterParams,
  BOARD_FILTER_DEFAULTS,
} from "../board-filters"
import type { MarketSignalRow } from "../signals-service"

/** Synthetic board row — the fields the filter engine actually reads. */
function row(over: Partial<MarketSignalRow> & { ticker: string; signal: MarketSignalRow["signal"] }): MarketSignalRow {
  return {
    version: "test",
    score: 50,
    dimensions: [],
    reasons: [],
    styleFits: [],
    invalidation: null,
    tradePlan: null,
    limitations: [],
    companyId: `id-${over.ticker}`,
    nameEn: over.ticker,
    nameAr: null,
    sector: "بنوك",
    marketTier: "MAIN",
    sessions: 120,
    lastClose: 10,
    asOf: "2026-11-12",
    changePct: 0,
    metrics: {
      rsi14: 50,
      ema20: 10,
      ema50: 10,
      macdLine: 0,
      macdHist: 0,
      relVol: 1,
      perfW1: 0,
      perfM1: 0,
      perfM3: 0,
      rangePos60: 50,
      dailyVolPct: 2,
      obvSlope20: 0,
    },
    ...over,
  } as MarketSignalRow
}

const rows: MarketSignalRow[] = [
  row({ ticker: "COMI", signal: "buy", score: 80, changePct: 2.5, marketTier: "EGX30", sector: "بنوك", metrics: { rsi14: 62, ema20: 9, ema50: 8, macdLine: 1, macdHist: 0.2, relVol: 2.1, perfW1: 3, perfM1: 8, perfM3: 12, rangePos60: 85, dailyVolPct: 2, obvSlope20: 1 } as MarketSignalRow["metrics"], styleFits: [{ tag: "trend", earned: 4, total: 5 }, { tag: "swing", earned: 3, total: 5 }] }),
  row({ ticker: "ETEL", signal: "hold", score: 55, changePct: -0.4, marketTier: "EGX30", sector: "اتصالات", metrics: { rsi14: 45, ema20: 11, ema50: 10, macdLine: 0, macdHist: -0.1, relVol: 0.8, perfW1: -1, perfM1: -3, perfM3: -5, rangePos60: 45, dailyVolPct: 1.5, obvSlope20: 0 } as MarketSignalRow["metrics"], styleFits: [] }),
  row({ ticker: "ABUK", signal: "sell", score: 25, changePct: -3.2, marketTier: "EGX70", sector: "العقارات", metrics: { rsi14: 28, ema20: 12, ema50: 11, macdLine: -1, macdHist: -0.3, relVol: 1.8, perfW1: -4, perfM1: -12, perfM3: -20, rangePos60: 12, dailyVolPct: 3, obvSlope20: -1 } as MarketSignalRow["metrics"], styleFits: [{ tag: "reversal", earned: 4, total: 5 }] }),
  row({ ticker: "EFID", signal: "buy", score: 72, changePct: 1.1, marketTier: "MAIN", sector: "بنوك", metrics: { rsi14: 58, ema20: 9.5, ema50: 9, macdLine: 0.5, macdHist: 0.1, relVol: 1.2, perfW1: 2, perfM1: 5, perfM3: 9, rangePos60: 72, dailyVolPct: 1.8, obvSlope20: 1 } as MarketSignalRow["metrics"], styleFits: [{ tag: "swing", earned: 3, total: 5 }] }),
  row({ ticker: "TMGH", signal: null, score: null, changePct: 0, marketTier: "EGX30", sector: "السياحة", metrics: { rsi14: null, ema20: null, ema50: null, macdLine: null, macdHist: null, relVol: null, perfW1: null, perfM1: null, perfM3: null, rangePos60: null, dailyVolPct: null, obvSlope20: null } as MarketSignalRow["metrics"], styleFits: [] }),
]

describe("parseBoardFilterParams", () => {
  it("defaults to all-all when no params exist", () => {
    expect(parseBoardFilterParams(new URLSearchParams(""))).toEqual(BOARD_FILTER_DEFAULTS)
    expect(hasActiveFilters(parseBoardFilterParams(new URLSearchParams("")))).toBe(false)
  })

  it("accepts known values and rejects unknown ones (no injection surface)", () => {
    const p = parseBoardFilterParams(new URLSearchParams("signal=buy&tier=EGX70&sort=change"))
    expect(p.signal).toBe("buy")
    expect(p.tier).toBe("EGX70")
    expect(p.sort).toBe("change")
    const bad = parseBoardFilterParams(new URLSearchParams("signal=DROP&tier=../etc&sort=(;--"))
    expect(bad.signal).toBe("all")
    expect(bad.tier).toBe("all")
    expect(bad.sort).toBe("score")
    expect(hasActiveFilters(p)).toBe(true)
    expect(hasActiveFilters(bad)).toBe(false)
  })

  it("bounds free-text params (q/sector)", () => {
    const p = parseBoardFilterParams(new URLSearchParams(`q=${"x".repeat(500)}`))
    expect(p.q.length).toBe(120)
  })
})

describe("filterMarketRows — semantics identical to the client board", () => {
  it("filters by signal", () => {
    const out = filterMarketRows(rows, { ...BOARD_FILTER_DEFAULTS, signal: "buy" })
    expect(out.map((r) => r.ticker).sort()).toEqual(["COMI", "EFID"])
  })

  it("filters by tier", () => {
    const out = filterMarketRows(rows, { ...BOARD_FILTER_DEFAULTS, tier: "EGX30" })
    expect(out.map((r) => r.ticker).sort()).toEqual(["COMI", "ETEL", "TMGH"])
  })

  it("RSI oversold keeps null-metrics rows OUT (weak data is not oversold)", () => {
    const out = filterMarketRows(rows, { ...BOARD_FILTER_DEFAULTS, rsi: "oversold" })
    expect(out.map((r) => r.ticker)).toEqual(["ABUK"])
  })

  it("high liquidity requires relVol >= 1.5", () => {
    const out = filterMarketRows(rows, { ...BOARD_FILTER_DEFAULTS, liquidity: "high" })
    expect(out.map((r) => r.ticker).sort()).toEqual(["ABUK", "COMI"])
  })

  it("day move up uses >0 and treats null as 0", () => {
    const out = filterMarketRows(rows, { ...BOARD_FILTER_DEFAULTS, dayMove: "up" })
    expect(out.map((r) => r.ticker).sort()).toEqual(["COMI", "EFID"])
  })

  it("above EMA50 requires both close and ema present", () => {
    const out = filterMarketRows(rows, { ...BOARD_FILTER_DEFAULTS, ma: "aboveEma50" })
    expect(out.map((r) => r.ticker).sort()).toEqual(["COMI", "EFID"])
  })

  it("range top >= 80 and bottom <= 20", () => {
    expect(filterMarketRows(rows, { ...BOARD_FILTER_DEFAULTS, rangePos: "top" }).map((r) => r.ticker)).toEqual(["COMI"])
    expect(filterMarketRows(rows, { ...BOARD_FILTER_DEFAULTS, rangePos: "bottom" }).map((r) => r.ticker)).toEqual(["ABUK"])
  })

  it("score threshold treats null score as unmatched", () => {
    expect(filterMarketRows(rows, { ...BOARD_FILTER_DEFAULTS, score: "s70" }).map((r) => r.ticker).sort()).toEqual(["COMI", "EFID"])
    expect(filterMarketRows(rows, { ...BOARD_FILTER_DEFAULTS, score: "s60" }).map((r) => r.ticker).sort()).toEqual(["COMI", "EFID"])
  })

  it("combines multiple filters (AND) — the free-user multi-filter contract", () => {
    const out = filterMarketRows(rows, { ...BOARD_FILTER_DEFAULTS, signal: "buy", tier: "EGX30", liquidity: "high" })
    expect(out.map((r) => r.ticker)).toEqual(["COMI"])
  })

  it("search matches ticker and Arabic/English names", () => {
    const byTicker = filterMarketRows(rows, { ...BOARD_FILTER_DEFAULTS, q: "comi" })
    expect(byTicker.map((r) => r.ticker)).toEqual(["COMI"])
    const byArName = filterMarketRows(rows, { ...BOARD_FILTER_DEFAULTS, q: "بنك" })
    expect(byArName.length).toBe(0) // fixture nameEn has no Arabic match — nameAr null
  })

  it("sorts by the requested key with nulls handled (rsi ascending puts nulls last)", () => {
    const out = filterMarketRows(rows, { ...BOARD_FILTER_DEFAULTS, sort: "rsi" })
    expect(out[0].ticker).toBe("ABUK")
    expect(out[out.length - 1].ticker).toBe("TMGH")
  })

  it("zero-result filters return an EMPTY list (honest empty state)", () => {
    const out = filterMarketRows(rows, { ...BOARD_FILTER_DEFAULTS, signal: "buy", rsi: "overbought" })
    expect(out).toEqual([])
  })
})

describe("distributionOf", () => {
  it("aggregates true counts including the weak bucket", () => {
    expect(distributionOf(rows)).toEqual({ buy: 2, hold: 1, sell: 1, weak: 1, total: 5 })
  })
})

describe("gateRowForFree — paid analysis must never cross the wire", () => {
  const gated = gateRowForFree(rows[0])

  it("keeps identity + public market price", () => {
    expect(gated).toMatchObject({
      companyId: "id-COMI",
      ticker: "COMI",
      sector: "بنوك",
      marketTier: "EGX30",
      lastClose: 10,
      changePct: 2.5,
      locked: true,
    })
  })

  it("REMOVES every paid analysis field (server-side redaction)", () => {
    const keys = Object.keys(gated)
    for (const forbidden of ["signal", "score", "metrics", "dimensions", "reasons", "styleFits", "tradePlan", "invalidation", "limitations", "sessions"]) {
      expect(keys).not.toContain(forbidden)
    }
  })

  it("JSON round-trip keeps the redaction (what the network really sees)", () => {
    const json = JSON.parse(JSON.stringify(gated))
    expect(json).not.toHaveProperty("signal")
    expect(json).not.toHaveProperty("score")
    expect(json).not.toHaveProperty("tradePlan")
    expect(json.locked).toBe(true)
  })
})
