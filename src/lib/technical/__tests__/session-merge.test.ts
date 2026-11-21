import { describe, expect, it } from "vitest"
import { mergeSessionSeries } from "@/lib/technical/analyze"

/**
 * MERGE CONTRACT (2026-11-14 audit; tightened by the SAME-SOURCE MANDATE
 * 2026-11-21) — pure regression tests for the session merge. These encode:
 *
 * 1. PHANTOM WEEKEND SESSIONS: Fri/Sat scanner quotes restate the previous
 *    close — they must anchor onto the Sun–Thu session, never mint a session.
 * 2. THE SWALLOWED SESSION: a degenerate stored bar (0-valued OHLC from a
 *    partial import) must not occupy the day bucket ahead of the live quote —
 *    otherwise the anchored-skip preserves it and the post-merge sanitize
 *    drops the session entirely (live incident: COMI lost its Thursday
 *    session while ETEL kept it via the quote).
 * 3. THE SAME-SOURCE RULE (2026-11-21, the AMES case): the scanner feed may
 *    touch ONLY the live, unsettled session — a settled session keeps its
 *    stored candle; a close-only restatement must never flatten or overwrite
 *    real OHLC history. `todaySession` is passed explicitly so every test is
 *    deterministic.
 */
const WB = (ts: string, o: number, h: number, l: number, c: number) => ({ ts, open: o, high: h, low: l, close: c, volume: 1000 })
const Q = (asOf: string, price: number) => ({ asOf, price, volume: null })

const PRICEBARS = [
  WB("2026-11-08", 126.0, 127.0, 125.5, 126.5),
  WB("2026-11-09", 126.5, 128.0, 126.2, 127.31),
  WB("2026-11-11", 131.0, 131.0, 129.0, 130.34),
]
const QUOTES = [
  Q("2026-11-12T23:50:00.000Z", 128.75), // Thursday quote — its own session
  Q("2026-11-13T06:31:00.000Z", 128.75), // Friday cron quote — anchors to Thursday
  Q("2026-11-14T00:50:00.000Z", 128.75), // Saturday sync quote — anchors to Thursday
]

describe("mergeSessionSeries", () => {
  it("LIVE Thursday session: the anchored quotes land on Thursday only; no phantom Fri/Sat bars", () => {
    const { bars, sourceByDay } = mergeSessionSeries(PRICEBARS, QUOTES, null, "2026-11-12")
    const last = bars[bars.length - 1]
    expect(last).toEqual({ ts: "2026-11-12", open: 128.75, high: 128.75, low: 128.75, close: 128.75, volume: null })
    expect(sourceByDay.get("2026-11-12")).toBe("scanner")
    for (const b of bars) {
      expect(["2026-11-13", "2026-11-14"].includes(b.ts)).toBe(false)
    }
  })

  it("a degenerate stored bar never blocks (and then swallows) the LIVE session", () => {
    // The live COMI defect: Thursday pricebar imported unusable (0-valued).
    const withDegenerate = [
      ...PRICEBARS,
      WB("2026-11-12", 0, 0, 0, 0),
    ]
    const { bars } = mergeSessionSeries(withDegenerate, QUOTES, null, "2026-11-12")
    const last = bars[bars.length - 1]
    expect(last.ts).toBe("2026-11-12")
    expect(last.close).toBe(128.75)
  })

  it("SETTLED Thursday (candle stored): the weekend restatement quotes change NOTHING", () => {
    // Same-source rule: once the session has a stored candle, Fri/Sat
    // restatements are skipped outright — real OHLC survives untouched.
    const withRealThursday = [...PRICEBARS, WB("2026-11-12", 128.2, 129.4, 127.9, 128.75)]
    const { bars, sourceByDay } = mergeSessionSeries(withRealThursday, QUOTES, null, "2026-11-14")
    const thu = bars.find((b) => b.ts === "2026-11-12")
    expect(thu).toEqual({ ts: "2026-11-12", open: 128.2, high: 129.4, low: 127.9, close: 128.75, volume: 1000 })
    expect(sourceByDay.get("2026-11-12")).toBe("pricebar")
  })

  it("candle provenance flows into sourceByDay as 'yahoo' for the corporate-action de-adjustment", () => {
    const candles = PRICEBARS.map((b) => ({ ...b, barSource: "candle" as const }))
    const { sourceByDay } = mergeSessionSeries(candles, [], null, "2026-11-12")
    expect(sourceByDay.get("2026-11-09")).toBe("yahoo")
    const legacy = mergeSessionSeries(PRICEBARS, [], null, "2026-11-12")
    expect(legacy.sourceByDay.get("2026-11-09")).toBe("pricebar")
  })

  it("yahoo bars restore older OHLC but never override the live scanner day", () => {
    const yahoo = [WB("2026-11-08", 125.9, 127.1, 125.4, 126.6), WB("2026-11-09", 126.4, 128.1, 126.1, 127.35), WB("2026-11-11", 130.8, 131.2, 128.9, 130.5), WB("2026-11-12", 128.7, 129.0, 128.2, 128.75)]
    const { bars } = mergeSessionSeries(PRICEBARS, QUOTES, yahoo, "2026-11-12")
    // 11-12 is the live scanner day — yahoo's copy is skipped.
    expect(bars[bars.length - 1].ts).toBe("2026-11-12")
    expect(bars[bars.length - 1].close).toBe(128.75)
    // older yahoo days override the stored bars (real OHLC beats flat)
    const mon = bars.find((b) => b.ts === "2026-11-09")
    expect(mon?.open).toBe(126.4)
  })

  it("a quote on a scheduled LIVE trading day keeps its own session", () => {
    const { bars } = mergeSessionSeries([WB("2026-11-08", 126, 127, 125.5, 126.5)], [Q("2026-11-09T10:31:00.000Z", 127.31)], null, "2026-11-09")
    expect(bars[bars.length - 1].ts).toBe("2026-11-09")
    expect(bars[bars.length - 1].close).toBe(127.31)
  })

  it("a quote on a NON-live day is ignored entirely (settled history is immutable)", () => {
    const { bars } = mergeSessionSeries([WB("2026-11-08", 126, 127, 125.5, 126.5)], [Q("2026-11-09T10:31:00.000Z", 127.31)], null, "2026-11-12")
    const mon = bars.find((b) => b.ts === "2026-11-09")
    expect(mon).toBeUndefined()
  })
})
