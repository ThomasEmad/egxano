// Candlestick module tests — REAL-OHLC honesty (flat bars skipped), context
// gating (trend / S-R location / volume weakening), deterministic strengths.
import { describe, expect, it } from "vitest"
import { readLastCandle, scanCandlePatterns, type CandleRow } from "../candlestick"

function trendBars(from: number, n: number, factor: number, volume = 1000): CandleRow[] {
  const out: CandleRow[] = []
  let c = from
  const start = Date.UTC(2025, 5, 2)
  for (let i = 0; i < n; i++) {
    const o = c
    c = Math.round(c * factor * 100) / 100
    out.push({
      ts: new Date(start + out.length * 86_400_000).toISOString().slice(0, 10),
      open: o, high: Math.max(o, c) + 0.05, low: Math.min(o, c) - 0.05, close: c, volume,
    })
  }
  return out
}

const decline = trendBars(60, 20, 0.9856) // 60 → ~45.6 (trend "down" at the gate)
const rise = trendBars(40, 20, 1.005) // 40 → ~44.1 (trend "up" at the gate)
const day = (prevClose: number, o: number, h: number, l: number, c: number, volume = 1000, offset = 0): CandleRow => ({
  ts: new Date(Date.UTC(2025, 5, 2) + (20 + offset) * 86_400_000).toISOString().slice(0, 10),
  open: o, high: h, low: l, close: c, volume,
})

describe("candlestick — single-bar wick shapes with trend context", () => {
  it("hammer after a decline: bullish, base strength 0.6, no volume weakening", () => {
    const rows = [...decline, day(decline[19].close, 45.0, 45.3, 43.0, 45.15, 1200)]
    const r = readLastCandle(rows)
    expect(r.available).toBe(true)
    expect(r.read?.pattern).toBe("hammer")
    expect(r.read?.tone).toBe("bullish")
    expect(r.read?.strength).toBe(0.6)
    expect(r.read?.context.trend).toBe("down")
    expect(r.read?.context.volumeWeakened).toBe(false)
    expect(r.read?.contextAr).toContain("مطرقة")
  })

  it("the SAME hammer shape after an advance is a hanging-man (bearish) — context names the pattern", () => {
    const rows = [...rise, day(rise[19].close, 44.0, 44.3, 42.0, 44.15, 1200)]
    const r = readLastCandle(rows)
    expect(r.read?.pattern).toBe("hanging_man")
    expect(r.read?.tone).toBe("bearish")
    expect(r.read?.strength).toBe(0.6)
    expect(r.read?.context.trend).toBe("up")
  })

  it("weak volume (< 0.7× the prior-20 mean) weakens the pattern to ×0.5 and discloses it", () => {
    const rows = [...decline, day(decline[19].close, 45.0, 45.3, 43.0, 45.15, 500)]
    const r = readLastCandle(rows)
    expect(r.read?.pattern).toBe("hammer")
    expect(r.read?.context.volumeWeakened).toBe(true)
    expect(r.read?.context.volumeRatio).toBe(0.5)
    expect(r.read?.strength).toBe(0.3) // 0.6 × 0.5
    expect(r.read?.contextAr).toContain("مُضعَّف")
  })

  it("doji is a neutral marker (strength 0.3, tone neutral)", () => {
    const rows = [...decline, day(decline[19].close, 45.0, 45.5, 44.5, 45.02)]
    const r = readLastCandle(rows)
    expect(r.read?.pattern).toBe("doji")
    expect(r.read?.tone).toBe("neutral")
    expect(r.read?.strength).toBe(0.3)
    expect(r.read?.contextAr).toContain("دوجي")
  })

  it("FLAT bars (O=H=L=C scanner placeholders) are skipped — no pattern, not even a doji", () => {
    const rows = [...decline, day(decline[19].close, 45.0, 45.0, 45.0, 45.0)]
    const r = readLastCandle(rows)
    expect(r.available).toBe(true)
    expect(r.read).toBeNull()
    const scan = scanCandlePatterns(rows)
    expect(scan[scan.length - 1]).toBeNull()
  })
})

describe("candlestick — multi-bar patterns", () => {
  it("bullish engulfing after a decline: 0.7 with the trend gate agreeing", () => {
    const rows = [
      ...decline,
      day(decline[19].close, 46.0, 46.1, 45.4, 45.5), // bearish body 0.5
      day(decline[19].close, 45.3, 46.3, 45.2, 46.2, 1000, 1), // bullish body 0.9 engulfs it
    ]
    const r = readLastCandle(rows)
    expect(r.read?.pattern).toBe("engulfing_bull")
    expect(r.read?.tone).toBe("bullish")
    expect(r.read?.context.trend).toBe("down")
    expect(r.read?.strength).toBe(0.7)
  })

  it("morning star after a decline: 0.8 (three-candle class outranks single-bar)", () => {
    const rows = [
      ...decline,
      day(decline[19].close, 47.0, 47.1, 45.4, 45.5), // strong bearish
      day(decline[19].close, 45.4, 45.9, 45.1, 45.45, 1000, 1), // small body
      day(decline[19].close, 45.5, 46.6, 45.4, 46.5, 1000, 2), // bullish close > midpoint of body 1
    ]
    const r = readLastCandle(rows)
    expect(r.read?.pattern).toBe("morning_star")
    expect(r.read?.strength).toBe(0.8)
  })

  it("three white soldiers in an advance: 0.85", () => {
    const rows = [
      ...rise,
      day(rise[19].close, 44.0, 44.1, 43.9, 45.0),
      day(rise[19].close, 44.2, 44.4, 44.1, 45.3, 1000, 1),
      day(rise[19].close, 44.5, 45.8, 44.4, 45.7, 1000, 2),
    ]
    const r = readLastCandle(rows)
    expect(r.read?.pattern).toBe("three_white_soldiers")
    expect(r.read?.strength).toBe(0.85)
  })
})

describe("candlestick — honesty gates", () => {
  it("abstains when real OHLC is absent (close-only rows) — silent evidence", () => {
    const rows: CandleRow[] = [...decline, day(decline[19].close, 45.0, 45.3, 43.0, 45.15, 1200)].map((b) => ({ ts: b.ts, close: b.close, volume: b.volume }))
    const r = readLastCandle(rows)
    expect(r.available).toBe(false)
    expect(r.read).toBeNull()
    expect(r.reason).toContain("abstains")
  })

  it("abstains on thin history (< 21 sessions)", () => {
    const r = readLastCandle(decline.slice(0, 20))
    expect(r.available).toBe(false)
  })

  it("is prefix-pure: scanCandlePatterns at i uses rows[0..i] only", () => {
    const rows = [...decline, day(decline[19].close, 45.0, 45.3, 43.0, 45.15, 1200)]
    const scan = scanCandlePatterns(rows)
    const scanShort = scanCandlePatterns(rows.slice(0, 21))
    expect(scan[20]).toEqual(scanShort[20])
    expect(scan[20]?.pattern).toBe("hammer")
  })
})
