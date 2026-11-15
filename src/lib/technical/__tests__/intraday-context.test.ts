// Intraday-context tests — INJECTED fetcher, zero network. Pins the documented
// contract: Yahoo 5m parse (null/malformed drop, out-of-order sort, duplicate
// ts), volume-expansion math (last N=6 bars vs a documented baseline with the
// same-session fallback), breakout-attempt boundary (equal → NOT active,
// strictly above → active), VWAP from real volume-carrying bars only, every
// abstention path (transport → null; empty/thin/flat-garbage → available:false)
// and the mandatory delay note + disclaimer on every available context.
import { describe, expect, it } from "vitest"
import {
  fetchIntradayContext,
  INTRADAY_DELAY_NOTE_AR,
  INTRADAY_DISCLAIMER_AR,
  VOLUME_EXPANSION_RECENT_BARS,
  MIN_USABLE_BARS,
  type IntradayContext,
} from "../intraday-context"

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

interface FakeBar {
  ts: number
  o: number | null
  h: number | null
  l: number | null
  c: number | null
  v: number | null
}

function chartPayload(bars: FakeBar[]): unknown {
  return {
    chart: {
      result: [
        {
          timestamp: bars.map((b) => Math.floor(b.ts / 1000)),
          indicators: {
            quote: [
              {
                open: bars.map((b) => b.o),
                high: bars.map((b) => b.h),
                low: bars.map((b) => b.l),
                close: bars.map((b) => b.c),
                volume: bars.map((b) => b.v),
              },
            ],
          },
        },
      ],
    },
  }
}

const MIN5 = 5 * 60 * 1000
// 2026-11-09 / 2026-11-10 at 08:00Z — mid-morning instants whose calendar date
// is the SAME under both a UTC and an Africa/Cairo grouping (DST-safe tests).
const D1 = Date.UTC(2026, 10, 9, 8, 0, 0)
const D2 = Date.UTC(2026, 10, 10, 8, 0, 0)

function sessionBars(startTs: number, n: number, price: number, vol: (i: number) => number | null, closeFn?: (i: number) => number): FakeBar[] {
  const out: FakeBar[] = []
  for (let i = 0; i < n; i++) {
    const c = closeFn ? closeFn(i) : price
    out.push({ ts: startTs + i * MIN5, o: c - 0.05, h: c + 0.1, l: c - 0.1, c, v: vol(i) })
  }
  return out
}

const constVol = (v: number) => (_i: number): number | null => v
const ok = (payload: unknown) => async (): Promise<Response> => new Response(JSON.stringify(payload), { status: 200 })
const networkFail = async (): Promise<Response> => {
  throw new Error("network down")
}
const httpFail = (status: number) => async (): Promise<Response> => new Response("err", { status })

const isCtx = (r: IntradayContext | { available: false } | null): r is IntradayContext => r !== null && r.available === true
const expectUnavailable = (r: IntradayContext | { available: false; reasonAr: string } | null): { available: false; reasonAr: string } => {
  if (r === null || r.available === true) throw new Error("expected available:false abstention")
  return r
}

describe("parsing — real bars only", () => {
  it("parses OHLCV bars and reports asOf / lastPrice / counts / interval", async () => {
    const bars = [
      ...sessionBars(D1, 12, 10, constVol(1000)),
      ...sessionBars(D2, 12, 11, constVol(1000), (i) => 11 + i * 0.02),
    ]
    const r = await fetchIntradayContext("TSTPARSE", { fetcher: ok(chartPayload(bars)) })
    expect(isCtx(r)).toBe(true)
    const ctx = r as IntradayContext
    expect(ctx.interval).toBe("5m")
    expect(ctx.barsAnalyzed).toBe(24)
    expect(ctx.todayBars).toBe(12)
    expect(ctx.lastPrice).toBeCloseTo(11 + 11 * 0.02, 9)
    expect(ctx.asOf).toEqual(new Date(D2 + 11 * MIN5))
    expect(ctx.lastSessionDate).toBe("2026-11-10")
    expect(ctx.available).toBe(true)
  })

  it("drops null/incomplete bars (missing OHLC) and keeps volume-less bars", async () => {
    const bars: FakeBar[] = [
      { ts: D1, o: 10, h: 10.5, l: 9.8, c: 10.2, v: 100 },
      { ts: D1 + MIN5, o: null, h: 10.5, l: 9.8, c: 10.2, v: 100 }, // dropped
      { ts: D1 + 2 * MIN5, o: 10, h: 10.5, l: 9.8, c: null, v: 100 }, // dropped
      { ts: D1 + 3 * MIN5, o: 10, h: 10.5, l: 9.8, c: 10.2, v: null }, // kept, volume unknown
      { ts: D1 + 4 * MIN5, o: 10, h: 10.5, l: 9.8, c: 10.3, v: 100 },
      { ts: D1 + 5 * MIN5, o: 10, h: 10.5, l: 9.8, c: 10.4, v: 100 },
    ]
    const r = await fetchIntradayContext("TSTNULLS", { fetcher: ok(chartPayload(bars)) })
    const ctx = r as IntradayContext
    expect(isCtx(r)).toBe(true)
    expect(ctx.barsAnalyzed).toBe(4)
    expect(ctx.lastPrice).toBeCloseTo(10.4, 9)
    expect(ctx.todayBars).toBe(4)
  })

  it("drops malformed bars (high < low)", async () => {
    const bars: FakeBar[] = [
      { ts: D1, o: 10, h: 10.5, l: 9.8, c: 10.2, v: 100 },
      { ts: D1 + MIN5, o: 10, h: 9, l: 11, c: 10, v: 100 }, // malformed
      { ts: D1 + 2 * MIN5, o: 10, h: 10.5, l: 9.8, c: 10.3, v: 100 },
      { ts: D1 + 3 * MIN5, o: 10, h: 10.5, l: 9.8, c: 10.4, v: 100 },
    ]
    const r = await fetchIntradayContext("TSTHLO", { fetcher: ok(chartPayload(bars)) })
    const ctx = r as IntradayContext
    expect(isCtx(r)).toBe(true)
    expect(ctx.barsAnalyzed).toBe(3)
  })

  it("sorts out-of-order payloads ascending (asOf is the max timestamp)", async () => {
    const bars: FakeBar[] = [
      { ts: D1 + 3 * MIN5, o: 10, h: 10.5, l: 9.8, c: 10.4, v: 100 },
      { ts: D1 + MIN5, o: 10, h: 10.5, l: 9.8, c: 10.2, v: 100 },
      { ts: D1 + 2 * MIN5, o: 10, h: 10.5, l: 9.8, c: 10.3, v: 100 },
      { ts: D1, o: 10, h: 10.5, l: 9.8, c: 10.1, v: 100 },
    ]
    const r = await fetchIntradayContext("TSTORDER", { fetcher: ok(chartPayload(bars)) })
    const ctx = r as IntradayContext
    expect(isCtx(r)).toBe(true)
    expect(ctx.asOf).toEqual(new Date(D1 + 3 * MIN5))
    expect(ctx.lastPrice).toBeCloseTo(10.4, 9)
    expect(ctx.barsAnalyzed).toBe(4)
  })

  it("drops exact-duplicate timestamps keeping the FIRST occurrence", async () => {
    const bars: FakeBar[] = [
      { ts: D1, o: 10, h: 10.5, l: 9.8, c: 10.1, v: 100 },
      { ts: D1, o: 10, h: 10.5, l: 9.8, c: 10.9, v: 100 }, // duplicate ts
      { ts: D1 + MIN5, o: 10, h: 10.5, l: 9.8, c: 11, v: 100 },
      { ts: D1 + 2 * MIN5, o: 10, h: 10.5, l: 9.8, c: 11.1, v: 100 },
    ]
    const r = await fetchIntradayContext("TSTDUP", { fetcher: ok(chartPayload(bars)) })
    const ctx = r as IntradayContext
    expect(isCtx(r)).toBe(true)
    expect(ctx.barsAnalyzed).toBe(3)
    expect(ctx.lastPrice).toBeCloseTo(11.1, 9)
  })
})

describe("volume expansion — documented N=6 vs documented baseline", () => {
  it("recent last-6-bar mean vs the PRIOR-SESSIONS baseline", async () => {
    const bars = [
      ...sessionBars(D1, 12, 10, constVol(1000)),
      ...sessionBars(D2, 12, 11, (i) => (i < 6 ? 1000 : 2000)),
    ]
    const r = await fetchIntradayContext("TSTEXP1", { fetcher: ok(chartPayload(bars)) })
    const ctx = r as IntradayContext
    expect(isCtx(r)).toBe(true)
    expect(ctx.volumeExpansion).toBeCloseTo(2, 9)
    expect(ctx.volumeExpansionNoteAr).toContain(String(VOLUME_EXPANSION_RECENT_BARS))
    expect(ctx.volumeExpansionNoteAr).toContain("الجلسات السابقة")
    expect(ctx.volumeExpansionNoteAr).toContain("وصفي")
  })

  it("fallback baseline: today's earlier bars when no prior session exists", async () => {
    const bars = sessionBars(D1, 12, 10, (i) => (i < 6 ? 1000 : 3000))
    const r = await fetchIntradayContext("TSTEXP2", { fetcher: ok(chartPayload(bars)) })
    const ctx = r as IntradayContext
    expect(isCtx(r)).toBe(true)
    expect(ctx.volumeExpansion).toBeCloseTo(3, 9)
    expect(ctx.volumeExpansionNoteAr).toContain("الجلسة نفسها")
  })

  it("null when the session is younger than N bars, or a baseline cannot be computed honestly", async () => {
    const young = await fetchIntradayContext("TSTEXP3", { fetcher: ok(chartPayload(sessionBars(D1, 4, 10, constVol(1000)))) })
    expect(isCtx(young)).toBe(true)
    expect((young as IntradayContext).volumeExpansion).toBeNull()
    expect((young as IntradayContext).volumeExpansionNoteAr).toBeNull()

    // 7 bars: the last 6 form the recent window, only 1 earlier bar — no honest baseline
    const thin = await fetchIntradayContext("TSTEXP4", { fetcher: ok(chartPayload(sessionBars(D1, 7, 10, constVol(1000)))) })
    expect(isCtx(thin)).toBe(true)
    expect((thin as IntradayContext).volumeExpansion).toBeNull()

    // zero-volume bars everywhere → no recent window either
    const zeroVol = await fetchIntradayContext("TSTEXP5", {
      fetcher: ok(chartPayload(sessionBars(D1, 12, 10, () => 0))),
    })
    expect(isCtx(zeroVol)).toBe(true)
    expect((zeroVol as IntradayContext).volumeExpansion).toBeNull()
  })
})

describe("session VWAP-ish — real volume-carrying bars only", () => {
  it("computes Σ(typical×vol)/Σ(vol) over today's numeric-volume bars", async () => {
    const bars: FakeBar[] = [
      { ts: D1, o: 10, h: 10, l: 10, c: 10, v: 100 }, // typical 10
      { ts: D1 + MIN5, o: 12, h: 12, l: 12, c: 12, v: 300 }, // typical 12
      { ts: D1 + 2 * MIN5, o: 14, h: 14, l: 14, c: 14, v: null }, // excluded — no volume
    ]
    const r = await fetchIntradayContext("TSTVWAP", { fetcher: ok(chartPayload(bars)) })
    const ctx = r as IntradayContext
    expect(isCtx(r)).toBe(true)
    expect(ctx.vwapToday).toBeCloseTo((10 * 100 + 12 * 300) / 400, 9)
    expect(ctx.vwapNoteAr).toContain("11.50")
    expect(ctx.vwapNoteAr).toContain("وليس إشارة")
  })

  it("null VWAP when no bar carries volume", async () => {
    const bars: FakeBar[] = [
      { ts: D1, o: 10, h: 10.1, l: 9.9, c: 10.05, v: null },
      { ts: D1 + MIN5, o: 10, h: 10.1, l: 9.9, c: 10.06, v: null },
      { ts: D1 + 2 * MIN5, o: 10, h: 10.1, l: 9.9, c: 10.07, v: null },
    ]
    const r = await fetchIntradayContext("TSTVWAP0", { fetcher: ok(chartPayload(bars)) })
    const ctx = r as IntradayContext
    expect(isCtx(r)).toBe(true)
    expect(ctx.vwapToday).toBeNull()
    expect(ctx.vwapNoteAr).toBeNull()
  })
})

describe("breakout ATTEMPT — strictly-above boundary, never a confirmation", () => {
  it("last close EQUAL to the level → not active", async () => {
    const bars = sessionBars(D1, 6, 10, constVol(500), () => 10.5)
    const r = await fetchIntradayContext("TSTBR1", { fetcher: ok(chartPayload(bars)), triggerLevel: 10.5 })
    const ctx = r as IntradayContext
    expect(isCtx(r)).toBe(true)
    expect(ctx.breakoutAttempt).not.toBeNull()
    expect(ctx.breakoutAttempt!.active).toBe(false)
    expect(ctx.breakoutAttempt!.level).toBe(10.5)
    expect(ctx.breakoutAttempt!.noteAr).toContain("ليس أعلى من مستوى التفعيل")
  })

  it("last close STRICTLY above the level → active, with the no-confirmation disclaimer", async () => {
    const bars = sessionBars(D1, 6, 10, constVol(500), () => 10.51)
    const r = await fetchIntradayContext("TSTBR2", { fetcher: ok(chartPayload(bars)), triggerLevel: 10.5 })
    const ctx = r as IntradayContext
    expect(isCtx(r)).toBe(true)
    expect(ctx.breakoutAttempt!.active).toBe(true)
    expect(ctx.breakoutAttempt!.noteAr).toContain(INTRADAY_DISCLAIMER_AR)
    expect(ctx.breakoutAttempt!.noteAr).toContain("محاولة اختراق جارية")
  })

  it("null breakoutAttempt without a caller trigger level", async () => {
    const bars = sessionBars(D1, 6, 10, constVol(500), () => 10.51)
    const r = await fetchIntradayContext("TSTBR3", { fetcher: ok(chartPayload(bars)) })
    const ctx = r as IntradayContext
    expect(isCtx(r)).toBe(true)
    expect(ctx.breakoutAttempt).toBeNull()
  })
})

describe("abstention — never fabricate bars", () => {
  it("transport failure (both intervals) → null, and a null is NOT cached", async () => {
    let calls = 0
    const flaky = async (): Promise<Response> => {
      calls++
      if (calls === 1 || calls === 2) throw new Error("down") // first call: 5m + 15m
      return new Response(JSON.stringify(chartPayload(sessionBars(D1, 6, 10, constVol(500)))), { status: 200 })
    }
    expect(await fetchIntradayContext("TSTABST1", { fetcher: flaky })).toBeNull()
    const second = await fetchIntradayContext("TSTABST1", { fetcher: flaky }) // retries — nothing was cached
    expect(isCtx(second)).toBe(true)
    expect(calls).toBe(3)
  })

  it("HTTP failure on both intervals → null", async () => {
    expect(await fetchIntradayContext("TSTABST2", { fetcher: httpFail(404) })).toBeNull()
    expect(await fetchIntradayContext("TSTABST3", { fetcher: httpFail(429) })).toBeNull()
  })

  it("200 with an empty chart → available:false (Yahoo answered, nothing usable)", async () => {
    const r = await fetchIntradayContext("TSTABST4", { fetcher: ok({ chart: { result: [] } }) })
    const un = expectUnavailable(r)
    expect(un.reasonAr).toContain("لا توجد بيانات لحظية")
  })

  it("fewer than MIN_USABLE_BARS usable bars → available:false", async () => {
    const r = await fetchIntradayContext("TSTABST5", { fetcher: ok(chartPayload(sessionBars(D1, MIN_USABLE_BARS - 1, 10, constVol(100)))) })
    const un = expectUnavailable(r)
    expect(un.reasonAr).toContain("غير كافية")
  })

  it("all-flat zero-volume garbage → available:false (never synthesized around)", async () => {
    const bars: FakeBar[] = [0, 1, 2, 3, 4].map((i) => ({ ts: D1 + i * MIN5, o: 10, h: 10, l: 10, c: 10, v: 0 }))
    const r = await fetchIntradayContext("TSTABST6", { fetcher: ok(chartPayload(bars)) })
    const un = expectUnavailable(r)
    expect(un.reasonAr).toContain("مسطّر")
  })

  it("flat bars WITH real volume are real thin-name trading → available", async () => {
    const bars: FakeBar[] = [0, 1, 2, 3, 4].map((i) => ({ ts: D1 + i * MIN5, o: 10, h: 10, l: 10, c: 10, v: 500 }))
    const r = await fetchIntradayContext("TSTABST7", { fetcher: ok(chartPayload(bars)) })
    expect(isCtx(r)).toBe(true)
    expect((r as IntradayContext).barsAnalyzed).toBe(5)
  })
})

describe("fetch policy — 5m primary, ONE documented 15m fallback, TTL cache", () => {
  it("5m usable → interval 5m, exactly ONE request (no 15m attempt)", async () => {
    let calls = 0
    const urls: string[] = []
    const fetcher = async (url: string): Promise<Response> => {
      calls++
      urls.push(url)
      return new Response(JSON.stringify(chartPayload(sessionBars(D1, 6, 10, constVol(500)))), { status: 200 })
    }
    const r = await fetchIntradayContext("TSTPOL1", { fetcher })
    expect(isCtx(r)).toBe(true)
    expect((r as IntradayContext).interval).toBe("5m")
    expect(calls).toBe(1)
    expect(urls[0]).toContain("chart/TSTPOL1.CA?range=5d&interval=5m")
  })

  it("5m unusable → exactly one 15m fallback attempt wins", async () => {
    const calls: string[] = []
    const fetcher = async (url: string): Promise<Response> => {
      calls.push(url)
      if (url.includes("interval=5m")) return new Response("err", { status: 500 })
      return new Response(JSON.stringify(chartPayload(sessionBars(D1, 6, 10, constVol(500)))), { status: 200 })
    }
    const r = await fetchIntradayContext("TSTPOL2", { fetcher })
    expect(isCtx(r)).toBe(true)
    expect((r as IntradayContext).interval).toBe("15m")
    expect(calls).toHaveLength(2)
    expect(calls[1]).toContain("interval=15m")
  })

  it("5m unusable and 15m unusable → available:false with the last attempt's reason", async () => {
    const fetcher = async (): Promise<Response> => new Response(JSON.stringify({ chart: {} }), { status: 200 })
    const r = await fetchIntradayContext("TSTPOL3", { fetcher })
    const un = expectUnavailable(r)
    expect(un.reasonAr).toContain("لا توجد بيانات لحظية")
  })

  it("in-memory TTL cache: a parsed outcome is served without a second fetch", async () => {
    let calls = 0
    const fetcher = async (): Promise<Response> => {
      calls++
      return new Response(JSON.stringify(chartPayload(sessionBars(D1, 6, 10, constVol(500)))), { status: 200 })
    }
    const first = await fetchIntradayContext("TSTPOL4", { fetcher })
    const second = await fetchIntradayContext("TSTPOL4", { fetcher })
    expect(calls).toBe(1)
    expect(second).toEqual(first)
  })

  it("caches per ticker — different tickers fetch independently", async () => {
    let calls = 0
    const fetcher = async (): Promise<Response> => {
      calls++
      return new Response(JSON.stringify(chartPayload(sessionBars(D1, 6, 10, constVol(500)))), { status: 200 })
    }
    await fetchIntradayContext("TSTPOL5", { fetcher })
    await fetchIntradayContext("TSTPOL6", { fetcher })
    expect(calls).toBe(2)
  })

  it("normalizes the ticker (trim + uppercase) exactly like live-bars", async () => {
    let url = ""
    const fetcher = async (u: string): Promise<Response> => {
      url = u
      return new Response(JSON.stringify(chartPayload(sessionBars(D1, 6, 10, constVol(500)))), { status: 200 })
    }
    await fetchIntradayContext("  tstnorm  ", { fetcher })
    expect(url).toContain("chart/TSTNORM.CA?range=5d&interval=5m")
  })
})

describe("honesty notes — always present on an available context", () => {
  it("delay note is EXACTLY the documented string, disclaimer always embedded", async () => {
    const bars = sessionBars(D1, 6, 10, constVol(500))
    for (const [i, trigger] of [undefined, 10.5].entries()) {
      const r = await fetchIntradayContext(`TSTNOTE${i}`, { fetcher: ok(chartPayload(bars)), triggerLevel: trigger })
      const ctx = r as IntradayContext
      expect(isCtx(r)).toBe(true)
      expect(ctx.delayNoteAr).toBe(INTRADAY_DELAY_NOTE_AR)
      expect(ctx.evidenceNoteAr).toContain(INTRADAY_DISCLAIMER_AR)
      expect(ctx.delayNoteAr).toContain("~15 دقيقة")
    }
    expect(INTRADAY_DELAY_NOTE_AR).toBe("بيانات اليوم اللحظي مصدرها متأخر (~15 دقيقة) — ليست أسعارًا لحظية فورية")
  })

  it("no output ever claims a confirmed breakout or gives a buy/sell instruction", async () => {
    const bars = sessionBars(D1, 6, 10, constVol(500), () => 10.99)
    const r = await fetchIntradayContext("TSTNOTE9", { fetcher: ok(chartPayload(bars)), triggerLevel: 10.5 })
    const ctx = r as IntradayContext
    const allAr = [ctx.evidenceNoteAr, ctx.vwapNoteAr ?? "", ctx.volumeExpansionNoteAr ?? "", ctx.breakoutAttempt?.noteAr ?? ""].join(" ")
    expect(allAr).toContain(INTRADAY_DISCLAIMER_AR)
    expect(allAr).not.toMatch(/اشترِ|بيع الآن|شراء الآن|مضمون|مؤكد رسميًا/)
  })
})
