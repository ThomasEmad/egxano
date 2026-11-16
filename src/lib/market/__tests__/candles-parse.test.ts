// =============================================================================
// Candle ingest — logical-error handling (owner audit 2026-11-16):
//   • glitch bars (low > high, open/close outside [low, high]) are DROPPED,
//     never stored (they would poison indicators and range math)
//   • same-session duplicates are deduped — a multi-row VALUES insert hitting
//     the same (companyId, ts) twice aborts the whole statement in Postgres
//     ("ON CONFLICT DO UPDATE cannot affect row a second time"), which used to
//     fail the entire company as STORE_FAILED
// =============================================================================

import { describe, expect, it } from "vitest"
import { parseChartBars } from "@/lib/market/candles"

function chartOf(rows: { ts: number; o: number; h: number; l: number; c: number; v?: number }[]): NonNullable<import("@/lib/market/candles").YahooChartJson["chart"]> {
  return {
    result: [
      {
        timestamp: rows.map((r) => r.ts),
        indicators: {
          quote: [
            {
              open: rows.map((r) => r.o),
              high: rows.map((r) => r.h),
              low: rows.map((r) => r.l),
              close: rows.map((r) => r.c),
              volume: rows.map((r) => (r.v === undefined ? null : r.v)),
            },
          ],
        },
        meta: { regularMarketPrice: rows[rows.length - 1]?.c ?? null },
      },
    ],
  }
}

const DAY = 86_400_000

describe("parseChartBars — glitch-bar handling", () => {
  it("drops a bar whose low > high instead of storing the impossible candle", () => {
    const { bars } = parseChartBars(chartOf([
      { ts: 1_700_000_000, o: 10, h: 11, l: 9, c: 10.5 },
      { ts: 1_700_000_000 + DAY, o: 11, h: 10, l: 12, c: 11.5 }, // h < l — glitch
    ]))
    expect(bars).toHaveLength(1)
    expect(bars[0].close).toBe(10.5)
  })

  it("drops a bar whose close sits outside [low, high]", () => {
    const { bars } = parseChartBars(chartOf([
      { ts: 1_700_000_000, o: 10, h: 10.2, l: 9.8, c: 11 }, // close > high — glitch
      { ts: 1_700_000_000 + DAY, o: 10, h: 10.2, l: 9.8, c: 9 }, // close < low — glitch
    ]))
    expect(bars).toHaveLength(0)
  })

  it("keeps a null-open bar out but never invents values for it", () => {
    const chart = {
      result: [
        {
          timestamp: [1_700_000_000, 1_700_000_000 + DAY],
          indicators: { quote: [{ open: [null, 10], high: [10.5, 10.4], low: [9.5, 9.6], close: [10.2, 10.1], volume: [100, 200] }] },
        },
      ],
    }
    const { bars } = parseChartBars(chart as unknown as NonNullable<import("@/lib/market/candles").YahooChartJson["chart"]>)
    expect(bars).toHaveLength(1)
    expect(bars[0].open).toBe(10)
  })
})

describe("parseChartBars — same-session dedup", () => {
  it("collapses duplicate session rows to ONE bar (the last occurrence wins)", () => {
    const { bars } = parseChartBars(chartOf([
      { ts: 1_700_000_000, o: 10, h: 11, l: 9, c: 10.5 },
      { ts: 1_700_000_000 + 3600, o: 10, h: 11.2, l: 9.4, c: 10.6 }, // same day, later instant
      { ts: 1_700_000_000 + DAY, o: 10.5, h: 11.5, l: 10.2, c: 11 },
    ]))
    expect(bars).toHaveLength(2)
    expect(bars.find((b) => b.close === 10.6)?.close).toBe(10.6)
    expect(bars.filter((b) => b.ts.getTime() === 1_700_000_000_000)).toHaveLength(0)
  })

  it("normalizes session instants to UTC-midnight session days", () => {
    // 2023-11-14T07:00:00Z — an EGX open instant maps to the session's UTC day
    const { bars } = parseChartBars(chartOf([{ ts: 1_699_945_200, o: 10, h: 11, l: 9, c: 10.5 }]))
    expect(bars[0].ts.toISOString()).toBe("2023-11-14T00:00:00.000Z")
  })

  it("carries the latest meta price through", () => {
    const { meta } = parseChartBars(chartOf([{ ts: 1_700_000_000, o: 10, h: 11, l: 9, c: 10.5 }]))
    expect(meta.regularMarketPrice).toBe(10.5)
  })
})
