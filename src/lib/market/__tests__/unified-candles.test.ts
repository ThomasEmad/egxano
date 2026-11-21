// =============================================================================
// unified-candles tests — the SAME-SOURCE mandate contract (owner, 2026-11-21).
// Every analysis feature reads OHLC history through loadUnifiedHistory; these
// tests pin its three iron rules:
//   1. COVERED WINS WHOLE: a company with ANY verified candle gets ONLY
//      candle rows — never spliced with legacy PriceBar (mixing a gated
//      series with an ungated one is how the two-source skew bugs were born).
//   2. UNCOVERED FALLS BACK: companies the store does not cover at all keep
//      their legacy PriceBar history (provenance "pricebar").
//   3. PARTIAL-BY-DATE IS STILL COVERED: candles older than `since` still
//      count as coverage — an empty (honest) series, not a silent splice.
// =============================================================================

import { describe, expect, it, vi, beforeEach } from "vitest"

const h = vi.hoisted(() => ({
  candles: [] as Record<string, unknown>[],
  priceBars: [] as Record<string, unknown>[],
}))

vi.mock("@/lib/db", () => ({
  db: {
    marketCandle: {
      findMany: async (args?: { distinct?: string[]; where?: { tradeDate?: { gte?: Date } }; orderBy?: unknown }) => {
        // the coverage probe calls with distinct:["companyId"] — return one row per covered company
        if (args?.distinct) {
          const ids = [...new Set(h.candles.map((r) => r.companyId as string))]
          return ids.map((companyId) => ({ companyId }))
        }
        // emulate the Prisma window filter + asc ordering the loader relies on
        const gte = args?.where?.tradeDate?.gte
        return h.candles
          .filter((r) => !gte || (r.tradeDate as Date).getTime() >= gte.getTime())
          .sort((a, b) => (a.tradeDate as Date).getTime() - (b.tradeDate as Date).getTime())
      },
    },
    priceBar: { findMany: async () => h.priceBars },
  },
}))

import { loadUnifiedHistory, loadUnifiedHistoryOne } from "@/lib/market/unified-candles"

const d = (s: string) => new Date(`${s}T00:00:00Z`)
const candle = (companyId: string, date: string) => ({
  companyId,
  tradeDate: d(date),
  open: 10, high: 11, low: 9.5, close: 10.5, volume: 1000,
})
const legacyBar = (companyId: string, date: string) => ({
  companyId,
  ts: d(date),
  open: 5, high: 5.5, low: 4.8, close: 5.1, volume: 500,
})

describe("loadUnifiedHistory — the same-source contract", () => {
  beforeEach(() => {
    h.candles = []
    h.priceBars = []
  })

  it("a candle-covered company reads ONLY candles (legacy rows never splice in)", async () => {
    h.candles = [candle("co-a", "2026-11-18"), candle("co-a", "2026-11-19")]
    h.priceBars = [legacyBar("co-a", "2026-11-10")]
    const out = await loadUnifiedHistory(["co-a"], d("2026-11-01"))
    const bars = out.get("co-a") ?? []
    expect(bars).toHaveLength(2)
    expect(bars.every((b) => b.barSource === "candle")).toBe(true)
    expect(bars.every((b) => b.ts.toISOString().slice(0, 10) >= "2026-11-01")).toBe(true)
  })

  it("an uncovered company falls back to legacy PriceBar with honest provenance", async () => {
    h.priceBars = [legacyBar("co-b", "2026-11-05")]
    const out = await loadUnifiedHistory(["co-b"], d("2026-11-01"))
    const bars = out.get("co-b") ?? []
    expect(bars).toHaveLength(1)
    expect(bars[0]!.barSource).toBe("pricebar")
  })

  it("candles older than `since` still count as coverage — empty series, never a splice", async () => {
    h.candles = [candle("co-c", "2026-01-15")] // way before `since`
    h.priceBars = [legacyBar("co-c", "2026-11-19")]
    const out = await loadUnifiedHistory(["co-c"], d("2026-11-01"))
    const bars = out.get("co-c") ?? []
    expect(bars).toHaveLength(0) // the honest empty — NOT the legacy bar
  })

  it("mixed universe: each company gets exactly its own source", async () => {
    h.candles = [candle("co-a", "2026-11-19")]
    h.priceBars = [legacyBar("co-b", "2026-11-05")]
    const out = await loadUnifiedHistory(["co-a", "co-b"], d("2026-11-01"))
    expect((out.get("co-a") ?? []).every((b) => b.barSource === "candle")).toBe(true)
    expect((out.get("co-b") ?? []).every((b) => b.barSource === "pricebar")).toBe(true)
  })

  it("loadUnifiedHistoryOne returns the single company's bars ascending", async () => {
    h.candles = [candle("co-a", "2026-11-19"), candle("co-a", "2026-11-18")]
    const bars = await loadUnifiedHistoryOne("co-a", d("2026-11-01"))
    expect(bars.map((b) => b.ts.toISOString().slice(0, 10))).toEqual(["2026-11-18", "2026-11-19"])
  })
})
