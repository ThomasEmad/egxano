// Reference-value tests for the deterministic technical indicator library.
// Expected values are computed INDEPENDENTLY here (naive loops / hand math)
// so a shared bug cannot hide itself, plus boundary/insufficiency cases.
import { describe, expect, it } from "vitest"
import {
  atr,
  bollinger,
  crossType,
  ema,
  historicalVolatility,
  macd,
  onBalanceVolume,
  perfN,
  rsi,
  sma,
  smaSeries,
  stochastic,
  supportResistance,
  trendInfo,
  volumeStats,
  type Bar,
} from "../indicators"
import { assembleBundle, sanitizeBars } from "../analyze"

function bars(closes: number[], volumes: (number | null)[] | null = null): Bar[] {
  return closes.map((c, i) => ({
    ts: `2025-01-${String((i % 28) + 1).padStart(2, "0")}`,
    open: c * 0.99,
    high: c * 1.01,
    low: c * 0.98,
    close: c,
    volume: volumes ? volumes[i] : 1000,
  }))
}

describe("SMA", () => {
  it("matches arithmetic mean", () => {
    expect(sma([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 5).value).toBe(8)
    expect(sma([10, 20, 30], 3).value).toBe(20)
  })
  it("insufficient window → null with reason", () => {
    const v = sma([1, 2], 5)
    expect(v.value).toBeNull()
    expect(v.reason).toContain("need 5")
  })
  it("series alignment", () => {
    expect(smaSeries([1, 2, 3, 4], 2)).toEqual([null, 1.5, 2.5, 3.5])
  })
})

describe("EMA", () => {
  it("seeds with SMA then applies k=2/(n+1)", () => {
    // seed = SMA(2,4,6)=4 ; k=0.5 ; next: 8*0.5+4*0.5=6 ; then 12*0.5+6*0.5=9
    expect(ema([2, 4, 6, 8, 12], 3).value).toBe(9)
  })
  it("EMA equals SMA when input is constant", () => {
    expect(ema([5, 5, 5, 5, 5, 5], 4).value).toBe(5)
  })
  it("insufficient window → null", () => {
    expect(ema([1, 2], 3).value).toBeNull()
  })
})

describe("RSI (Wilder)", () => {
  it("sustained uptrend → 100", () => {
    expect(rsi([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15], 14).value).toBe(100)
  })
  it("sustained downtrend → 0", () => {
    expect(rsi([15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1], 14).value).toBe(0)
  })
  it("hand-computed small window n=4", () => {
    // closes [10,11,10,11,12] n=4: changes [1,-1,1,1] → avgGain=0.75, avgLoss=0.25
    // RSI = 100 - 100/(1+3) = 75
    expect(rsi([10, 11, 10, 11, 12], 4).value).toBeCloseTo(75, 6)
  })
  it("flat series → null (no movement)", () => {
    const v = rsi([5, 5, 5, 5, 5], 4)
    expect(v.value).toBeNull()
    expect(v.reason).toBeTruthy()
  })
  it("insufficient data → null", () => {
    expect(rsi([1, 2, 3], 14).value).toBeNull()
  })
})

describe("MACD", () => {
  it("constant series → zero line", () => {
    const m = macd(Array(40).fill(100))
    expect(m.macd).toBe(0)
    expect(m.signal).toBe(0)
    expect(m.histogram).toBe(0)
  })
  it("rising series → positive macd", () => {
    const closes = Array.from({ length: 40 }, (_, i) => 100 + i)
    const m = macd(closes)
    expect((m.macd ?? 0)).toBeGreaterThan(0)
    expect(m.signal).not.toBeNull()
    expect(m.histogram).not.toBeNull()
  })
  it("insufficient data", () => {
    expect(macd([1, 2, 3]).macd).toBeNull()
    expect(macd([1, 2, 3]).reason).toBeTruthy()
  })
})

describe("Bollinger", () => {
  it("constant series → bands collapse on the mean, %B neutral", () => {
    const b = bollinger(Array(20).fill(50))
    expect(b.middle).toBe(50)
    expect(b.upper).toBe(50)
    expect(b.lower).toBe(50)
    expect(b.percentB).toBeNull() // 0/0 → guarded null
  })
  it("independent reference computation", () => {
    const closes = [10, 12, 11, 13, 14, 13, 12, 15, 16, 14, 13, 15, 16, 17, 18, 16, 15, 17, 18, 19]
    const b = bollinger(closes, 20, 2)
    const mean = closes.reduce((a, x) => a + x, 0) / 20
    const sd = Math.sqrt(closes.reduce((a, x) => a + (x - mean) ** 2, 0) / 20)
    expect(b.middle).toBeCloseTo(mean, 3)
    expect(b.upper).toBeCloseTo(mean + 2 * sd, 3)
    expect(b.lower).toBeCloseTo(mean - 2 * sd, 3)
    const last = closes[19]
    expect(b.percentB).toBeCloseTo((last - (mean - 2 * sd)) / (4 * sd), 3)
  })
  it("insufficient window", () => {
    expect(bollinger([1, 2, 3]).middle).toBeNull()
  })
})

describe("Stochastic", () => {
  it("close at the top of the range → %K 100", () => {
    const bs: Bar[] = []
    for (let i = 0; i < 20; i++) {
      const close = i === 19 ? 20 : 10
      bs.push({ ts: `2025-01-${i + 1}`, open: 10, high: 20, low: 9, close, volume: 1 })
    }
    const s = stochastic(bs, 14, 3)
    expect(s.k).toBe(100)
  })
  it("close at the bottom → %K 0", () => {
    const bs: Bar[] = []
    for (let i = 0; i < 20; i++) {
      const close = i === 19 ? 9 : 10
      bs.push({ ts: `2025-01-${i + 1}`, open: 10, high: 20, low: 9, close, volume: 1 })
    }
    const s = stochastic(bs, 14, 3)
    expect(s.k).toBe(0)
  })
  it("flat window never divides by zero", () => {
    // truly flat sessions: high = low = close
    const bs: Bar[] = Array.from({ length: 20 }, (_, i) => ({
      ts: `2025-01-${i + 1}`, open: 10, high: 10, low: 10, close: 10, volume: 1,
    }))
    const s = stochastic(bs, 14, 3)
    expect(s.k).toBeNull()
    expect(s.reason).toBeTruthy()
  })
})

describe("ATR (Wilder)", () => {
  it("independent reference on a small case", () => {
    // 16 bars, constant high-low range of 2 and no gaps → every TR = 2 → ATR = 2
    const bs: Bar[] = []
    for (let i = 0; i < 16; i++) {
      bs.push({ ts: `2025-01-${i + 1}`, open: 10, high: 11, low: 9, close: 10, volume: 1 })
    }
    expect(atr(bs, 14).value).toBe(2)
  })
  it("TR includes gaps vs previous close", () => {
    const bs: Bar[] = []
    for (let i = 0; i < 16; i++) {
      const low = i === 15 ? 5 : 9 // last bar gaps down
      bs.push({ ts: `2025-01-${i + 1}`, open: 10, high: 11, low, close: i === 15 ? 6 : 10, volume: 1 })
    }
    // last TR = max(11-5, |11-10|, |5-10|) = 6 ; prior TRs = 2
    // Wilder: seed = 28/14=2 ; then (2*13 + 6)/14 = 2.2857...
    expect(atr(bs, 14).value).toBeCloseTo(2.2857, 3)
  })
  it("insufficient data", () => {
    expect(atr(bars([1, 2, 3]), 14).value).toBeNull()
  })
})

describe("Historical volatility", () => {
  it("zero returns → 0", () => {
    expect(historicalVolatility(Array(25).fill(100), 20).value).toBe(0)
  })
  it("independent reference computation", () => {
    const closes = Array.from({ length: 25 }, (_, i) => 100 * Math.exp(0.001 * i * ((i % 2) * 2 - 1) ** 0))
    // simpler: deterministic alternating log-returns
    const cs: number[] = [100]
    for (let i = 1; i <= 24; i++) cs.push(cs[i - 1] * (i % 2 === 1 ? 1.02 : 0.99))
    const rets: number[] = []
    for (let i = cs.length - 20; i < cs.length; i++) rets.push(Math.log(cs[i] / cs[i - 1]))
    const mean = rets.reduce((a, b) => a + b, 0) / 20
    const sd = Math.sqrt(rets.reduce((a, b) => a + (b - mean) ** 2, 0) / 19)
    expect(historicalVolatility(cs, 20).value).toBeCloseTo(sd * Math.sqrt(252) * 100, 4)
    void closes
  })
})

describe("OBV & volume stats", () => {
  it("OBV accumulates signed volume", () => {
    const bs = bars([10, 11, 10, 11, 12], [100, 200, 300, 400, 500])
    const o = onBalanceVolume(bs, 3)
    expect(o.obv).toBe(0 + 200 - 300 + 400 + 500) // 800
  })
  it("missing volume → null with reason", () => {
    const bs = bars([10, 11, 10], [100, null, 300])
    const o = onBalanceVolume(bs, 2)
    expect(o.obv).toBeNull()
    expect(o.reason).toContain("missing volume")
  })
  it("relative volume excludes the latest session from the average", () => {
    const vols = Array(25).fill(100)
    vols[24] = 300 // latest
    const bs = bars(Array(25).fill(10), vols)
    const v = volumeStats(bs, 20)
    expect(v.volMa).toBe(100)
    expect(v.relVol).toBe(3)
  })
})

describe("Support/Resistance", () => {
  it("detects swing pivots and labels them relative to the last close", () => {
    // build a zigzag: peaks at 15 (x2), troughs at 9 (x2), end at 12
    const closes: number[] = []
    const pattern = [10, 12, 15, 12, 9, 12, 15, 12, 9, 12]
    for (let rep = 0; rep < 4; rep++) closes.push(...pattern)
    closes.push(12)
    const bs = bars(closes)
    const sr = supportResistance(bs, 2, 1.5, 4)
    expect(sr.resistances.length).toBeGreaterThan(0)
    expect(sr.supports.length).toBeGreaterThan(0)
    expect(sr.resistances[0].price).toBeGreaterThan(12)
    expect(sr.supports[0].price).toBeLessThan(12)
    expect(sr.resistances[0].touches).toBeGreaterThanOrEqual(1)
  })
  it("too few bars → empty", () => {
    expect(supportResistance(bars([10, 11, 12]), 5).supports).toEqual([])
  })
})

describe("Trend", () => {
  // V-shape: 200 sessions down, then 60 up — SMA50 crosses ABOVE SMA200
  // inside the observable window (monotonic series have no observable cross).
  const vUp: number[] = []
  for (let i = 0; i < 200; i++) vUp.push(100 - i * 0.2) // 100 → 60
  for (let i = 0; i < 60; i++) vUp.push(60 + i * 1.0) // 60 → 120
  // Inverted V: rise then fall — SMA50 crosses BELOW SMA200.
  const vDown: number[] = []
  for (let i = 0; i < 200; i++) vDown.push(60 + i * 0.2) // 60 → 100
  for (let i = 0; i < 60; i++) vDown.push(100 - i * 1.0) // 100 → 40

  it("V-shape recovery → golden cross", () => {
    expect(crossType(vUp)).toBe("golden")
    expect(trendInfo(vUp).crossAge50200 ?? 999).toBeLessThan(60)
  })
  it("inverted V decline → death cross", () => {
    expect(crossType(vDown)).toBe("death")
  })
  it("long uptrend tail → aligned_uptrend", () => {
    const closes = Array.from({ length: 260 }, (_, i) => 50 + i * 0.5)
    expect(trendInfo(closes).alignment).toBe("aligned_uptrend")
    expect(perfN(closes, 252)).not.toBeNull()
  })
  it("short series → null alignment (never guesses)", () => {
    expect(trendInfo(Array.from({ length: 60 }, (_, i) => 100 + i)).alignment).toBeNull()
    expect(crossType(Array.from({ length: 150 }, (_, i) => 100 + i))).toBeNull()
  })
})

describe("sanitizeBars", () => {
  it("drops non-positive, non-finite and inconsistent observations", () => {
    const raw = [
      { ts: new Date("2025-01-01T00:00:00Z"), open: 10, high: 11, low: 9, close: 10, volume: 100 },
      { ts: new Date("2025-01-02T00:00:00Z"), open: 0, high: 11, low: 9, close: 10, volume: 100 }, // zero price
      { ts: new Date("2025-01-03T00:00:00Z"), open: 10, high: 8, low: 9, close: 10, volume: 100 }, // high < low
      { ts: new Date("2025-01-04T00:00:00Z"), open: 10, high: 11, low: 9, close: 50, volume: 100 }, // close outside range
      { ts: new Date("2025-01-05T00:00:00Z"), open: NaN, high: 11, low: 9, close: 10, volume: 100 }, // NaN
      { ts: new Date("2025-01-06T00:00:00Z"), open: 10, high: 11, low: 9, close: 10, volume: null }, // null volume allowed
    ]
    const clean = sanitizeBars(raw)
    expect(clean).toHaveLength(2)
    expect(clean[0].ts).toBe("2025-01-01")
    expect(clean[1].volume).toBeNull()
  })
})

describe("assembleBundle", () => {
  it("empty bars → available=false with limitation, no crash", () => {
    const b = assembleBundle([])
    expect(b.snapshot.available).toBe(false)
    expect(b.snapshot.limitations.length).toBeGreaterThan(0)
    expect(b.hash).toMatch(/^[0-9a-f]{64}$/)
  })
  it("sparse monthly data suppresses oscillators and flags the reason", () => {
    const closes = Array.from({ length: 60 }, (_, i) => 100 + i)
    const bs = closes.map((c, i) => ({
      ts: `20${String(21 + Math.floor(i / 12)).padStart(2, "0")}-${String((i % 12) + 1).padStart(2, "0")}-01`,
      open: c, high: c * 1.01, low: c * 0.99, close: c, volume: 1000,
    }))
    const b = assembleBundle(bs)
    expect(b.snapshot.sparse).toBe(true)
    expect(b.snapshot.momentum.rsi14).toBeNull()
    expect(b.snapshot.limitations.some((l) => l.includes("daily"))).toBe(true)
  })
  it("dense daily data computes the full indicator set + deterministic hash", () => {
    const closes = Array.from({ length: 300 }, (_, i) => 100 + Math.sin(i / 7) * 5 + i * 0.1)
    const b1 = assembleBundle(bars(closes))
    const b2 = assembleBundle(bars([...closes]))
    expect(b1.snapshot.sparse).toBe(false)
    expect(b1.snapshot.momentum.rsi14).not.toBeNull()
    expect(b1.snapshot.volatility.atr14).not.toBeNull()
    expect(b1.snapshot.trend.ema200).not.toBeNull()
    expect(b1.snapshot.range60.high).not.toBeNull()
    expect(b1.hash).toBe(b2.hash)
  })
})
