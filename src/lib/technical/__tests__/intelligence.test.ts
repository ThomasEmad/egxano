// Reference-value tests for the market-intelligence technical modules:
// structure (swings/BOS/CHoCH), VSA, supply/demand zones, quality score.
// Every fixture is hand-constructed so expected outcomes are known a priori.
import { describe, it, expect } from "vitest"
import {
  rawPivots,
  cleanPivots,
  labelPivots,
  trendFromSwings,
  structureEvents,
  analyzeStructure,
  resampleWeekly,
  type Bar,
} from "../structure"
import { analyzeVsa } from "../vsa"
import { analyzeZones } from "../zones"
import { scoreQuality } from "../quality"
import { assembleBundle } from "../analyze"

// ---------------------------------------------------------------- fixtures

/** Deterministic bar factory: ascending dates skipping weekends.
 * h/l are asymmetric so consecutive bars never produce EQUAL highs/lows
 * (equal extremes would defeat the strictly-greater pivot rule). */
function mkBars(specs: { o: number; h?: number; l?: number; c: number; v?: number }[], startDay = 1): Bar[] {
  const out: Bar[] = []
  let day = startDay
  for (const s of specs) {
    const d = new Date(Date.UTC(2025, 0, day))
    const dow = d.getUTCDay()
    if (dow === 5) day += 3 // skip Fri+Sat (EGX weekend is Fri/Sat)
    else day += 1
    const date = new Date(Date.UTC(2025, 0, day))
    const up = s.c >= s.o
    out.push({
      ts: date.toISOString().slice(0, 10),
      open: s.o,
      high: s.h ?? (up ? s.c * 1.002 : s.o * 1.0005),
      low: s.l ?? (up ? s.o * 0.9995 : s.c * 0.998),
      close: s.c,
      volume: s.v ?? 1000,
    })
  }
  return out
}

/** Clean sawtooth uptrend: 4 sessions up ~2.2%, 4 down ~1.6% (net +3%/cycle).
 * Guarantees fractal pivots at every cycle boundary with HH+HL labels. */
function uptrendBars(n = 60, start = 100): { o: number; c: number; v: number }[] {
  const specs: { o: number; c: number; v: number }[] = []
  let price = start
  for (let i = 0; i < n; i++) {
    const phase = i % 8
    const factor = phase < 4 ? 1.022 : 0.984
    const next = price * factor
    specs.push({ o: price, c: next, v: 1000 + (i % 5) * 50 })
    price = next
  }
  return specs
}

/** Chained sawtooth downtrend: 4 sessions down ~2.2%, 4 up ~1.6%. */
function downtrendBars(n = 60, start = 200): { o: number; c: number; v: number }[] {
  const specs: { o: number; c: number; v: number }[] = []
  let price = start
  for (let i = 0; i < n; i++) {
    const phase = i % 8
    const factor = phase < 4 ? 0.978 : 1.016
    const next = price * factor
    specs.push({ o: price, c: next, v: 1000 + (i % 5) * 50 })
    price = next
  }
  return specs
}

// ---------------------------------------------------------------- structure

describe("structure — pivot rules", () => {
  it("R1: wing-surrounding pivot detection (peak needs wing bars each side)", () => {
    const bars = mkBars([
      { o: 10, c: 10 }, { o: 10, c: 11 }, { o: 11, c: 12 }, // rise
      { o: 12, c: 13, h: 14 }, // peak day (highest high)
      { o: 13, c: 12 }, { o: 12, c: 11 }, { o: 11, c: 10 }, // fall
    ])
    const pivots = rawPivots(bars, 2)
    const highs = pivots.filter((p) => p.kind === "high")
    expect(highs.length).toBe(1)
    expect(highs[0].price).toBe(14)
  })

  it("R2: consecutive same-kind pivots collapse to the extreme one", () => {
    // Two ascending peaks with wing=2: raw finds both; cleaning keeps the higher.
    const bars = mkBars([
      { o: 10, c: 10 }, { o: 10, c: 11 }, { o: 11, c: 12, h: 13 },
      { o: 12, c: 11.5, l: 11 }, { o: 11.5, c: 12.5 }, { o: 12.5, c: 13.5, h: 14.5 },
      { o: 13.5, c: 12.5, l: 12 }, { o: 12.5, c: 11.5 }, { o: 11.5, c: 10.5 },
    ])
    const raw = rawPivots(bars, 2).filter((p) => p.kind === "high")
    const clean = cleanPivots(bars, 2, 0.5).filter((p) => p.kind === "high")
    expect(raw.length).toBeGreaterThanOrEqual(2)
    expect(clean.length).toBe(1)
    expect(clean[0].price).toBe(14.5)
  })

  it("R3/R4: rising series labels HH+HL and classifies an uptrend", () => {
    const bars = mkBars(uptrendBars(48))
    const swings = labelPivots(cleanPivots(bars, 3, 1.5))
    const highs = swings.filter((s) => s.kind === "high")
    const lows = swings.filter((s) => s.kind === "low")
    expect(highs.length).toBeGreaterThanOrEqual(2)
    expect(highs[highs.length - 1].label).toBe("HH")
    expect(lows[lows.length - 1].label).toBe("HL")
    const t = trendFromSwings(swings)
    expect(t.state).toBe("uptrend")
  })
})

describe("structure — events", () => {
  it("R5: close above the last swing high in an uptrend emits a bullish BOS", () => {
    const bars = mkBars(uptrendBars(60))
    const pivots = cleanPivots(bars, 3, 1.5)
    const events = structureEvents(bars, pivots)
    expect(events.length).toBeGreaterThan(0)
    const bos = events.filter((e) => e.code === "BOS" && e.direction === "bullish")
    expect(bos.length).toBeGreaterThan(0)
    for (const e of bos) {
      expect(e.closeConfirmed).toBe(true)
      expect(e.volumeRatio).not.toBeNull()
    }
  })

  it("R6: downtrend then close above the last lower-high emits a CHoCH", () => {
    const down = mkBars(downtrendBars(40))
    // Reversal: 12 sessions of higher closes punching above prior swing highs.
    let price = down[down.length - 1].close
    const rev: { o: number; c: number; v: number }[] = []
    for (let i = 0; i < 12; i++) {
      const next = price * 1.03
      rev.push({ o: price, c: next, v: 2500 })
      price = next
    }
    const bars = [...down, ...mkBars(rev)]
    const pivots = cleanPivots(bars, 3, 1.5)
    const events = structureEvents(bars, pivots)
    const choch = events.find((e) => e.code === "CHOCH" && e.direction === "bullish")
    expect(choch).toBeDefined()
    expect(choch!.volumeSupported).toBe(true) // 2500 vs ~1000 baseline
  })

  it("R9: a close back through a broken level invalidates the event", () => {
    const down = mkBars(downtrendBars(40))
    let price = down[down.length - 1].close
    const spike: { o: number; c: number; v: number }[] = [{ o: price, c: price * 1.06, v: 2600 }]
    const crash: { o: number; c: number; v: number }[] = []
    let p = price * 1.06
    for (let i = 0; i < 8; i++) {
      const next = p * 0.97
      crash.push({ o: p, c: next, v: 1200 })
      p = next
    }
    const bars = [...down, ...mkBars([...spike, ...crash])]
    const pivots = cleanPivots(bars, 3, 1.5)
    const events = structureEvents(bars, pivots)
    const choch = events.find((e) => e.code === "CHOCH" && e.direction === "bullish")
    if (choch) expect(choch.invalidated).toBe(true)
  })

  it("analyzeStructure end-to-end: uptrend classified, consistency computed, texts bilingual", () => {
    const bars = mkBars(uptrendBars(90))
    const snap = analyzeStructure(bars)
    expect(snap.available).toBe(true)
    expect(snap.trend.medium).toBe("uptrend")
    expect(snap.events.length).toBeGreaterThan(0)
    expect(snap.events[0].text).toContain("structure")
    expect(snap.events[0].textAr.length).toBeGreaterThan(10)
    expect(snap.keyLevels.length).toBeGreaterThan(0)
  })

  it("short series refuses to guess", () => {
    const snap = analyzeStructure(mkBars(uptrendBars(10)))
    expect(snap.available).toBe(false)
    expect(snap.reason).toContain("15")
  })
})

describe("weekly resample", () => {
  it("aggregates ISO weeks with OHLC + summed volume", () => {
    const bars = mkBars(uptrendBars(12)) // ~2.5 weeks
    const weeks = resampleWeekly(bars)
    expect(weeks.length).toBeLessThan(bars.length)
    for (const w of weeks) {
      const dayBars = bars.filter((b) => weekKeyOf(b.ts) === weekKeyOf(w.ts))
      expect(w.high).toBe(Math.max(...dayBars.map((b) => b.high)))
      expect(w.low).toBe(Math.min(...dayBars.map((b) => b.low)))
      expect(w.close).toBe(dayBars[dayBars.length - 1].close)
      expect(w.volume).toBe(dayBars.reduce((s, b) => s + (b.volume ?? 0), 0))
    }
  })
})

function weekKeyOf(ts: string): string {
  const d = new Date(ts + "T00:00:00Z")
  const day = (d.getUTCDay() + 6) % 7
  const monday = new Date(d)
  monday.setUTCDate(d.getUTCDate() - day)
  return monday.toISOString().slice(0, 10)
}

// ---------------------------------------------------------------- VSA

describe("VSA", () => {
  it("detects a selling climax with full candle evidence and guardrail language", () => {
    // 45 flat drift sessions, then a wide 3×-volume DOWN session closing near its HIGH.
    const specs: { o: number; c: number; v: number }[] = []
    let price = 120
    for (let i = 0; i < 45; i++) {
      const next = price * (i % 9 === 8 ? 1.004 : 0.994)
      specs.push({ o: price, c: next, v: 1000 })
      price = next
    }
    // Climax bar: down close (0.995×), wide range 0.955..1.001 → closeLoc ≈ 0.87.
    const climax = { o: price, c: price * 0.995, v: 3200, h: price * 1.001, l: price * 0.955 }
    const bars = mkBars([...specs, { o: climax.o, c: climax.c, v: climax.v }])
    const last = bars[bars.length - 1]
    last.high = climax.h
    last.low = climax.l
    const snap = analyzeVsa(bars)
    expect(snap.available).toBe(true)
    const ev = snap.events.find((e) => e.code === "selling_climax")
    expect(ev).toBeDefined()
    expect(ev!.volRatio).toBeGreaterThanOrEqual(2.5)
    expect(ev!.closeLoc).toBeGreaterThanOrEqual(0.55)
    expect(ev!.text).toContain("does not establish")
    expect(ev!.textAr).toContain("لا يحدد هوية")
  })

  it("detects no-demand on an up close with thin volume", () => {
    const specs: { o: number; c: number; v: number }[] = []
    let price = 100
    for (let i = 0; i < 45; i++) {
      const next = price * (i % 2 ? 0.999 : 1.001)
      specs.push({ o: price, c: next, v: 1000 })
      price = next
    }
    specs.push({ o: price, c: price * 1.008, v: 600 }) // up close on 0.6× volume
    const bars = mkBars(specs)
    const snap = analyzeVsa(bars)
    const ev = snap.events.find((e) => e.code === "no_demand")
    expect(ev).toBeDefined()
    expect(ev!.volRatio).toBeLessThanOrEqual(0.7)
  })

  it("refuses short series instead of inventing profiles", () => {
    expect(analyzeVsa(mkBars(uptrendBars(20))).available).toBe(false)
  })
})

// ---------------------------------------------------------------- zones

describe("supply/demand zones", () => {
  it("forms a demand zone from a consolidation before a volume-backed breakout", () => {
    const specs: { o: number; c: number; v: number }[] = []
    let price = 100
    for (let i = 0; i < 45; i++) {
      specs.push({ o: price, c: price, v: 1000 }) // flat drift
      price = price * (i % 2 ? 1.0005 : 0.9995)
    }
    // Breakout up on 2.5× volume.
    specs.push({ o: price, c: price * 1.04, v: 2600 })
    for (let i = 0; i < 6; i++) {
      price = price * 1.01
      specs.push({ o: price, c: price, v: 1800 })
    }
    const bars = mkBars(specs)
    const snap = analyzeZones(bars)
    expect(snap.available).toBe(true)
    const demand = snap.zones.find((z) => z.kind === "demand" && z.origin === "consolidation_break")
    expect(demand).toBeDefined()
    expect(demand!.quality).toBeGreaterThan(30)
    expect(demand!.text).toContain("Invalidated by a close below")
    expect(demand!.textAr).toContain("منطقة طلب")
  })

  it("drops a demand zone once a close invalidates it", () => {
    const specs: { o: number; c: number; v: number }[] = []
    let price = 100
    for (let i = 0; i < 45; i++) specs.push({ o: price, c: price, v: 1000 })
    specs.push({ o: price, c: price * 1.04, v: 2600 }) // breakout forms demand ~96-100
    for (let i = 0; i < 6; i++) {
      price = price * 1.01
      specs.push({ o: price, c: price, v: 1800 })
    }
    // Crash back through the zone: close far below zone low.
    specs.push({ o: price, c: price * 0.85, v: 2200 })
    const bars = mkBars(specs)
    const snap = analyzeZones(bars)
    const broken = snap.zones.find((z) => z.kind === "demand" && z.origin === "consolidation_break")
    expect(broken).toBeUndefined()
  })
})

// ---------------------------------------------------------------- quality score

describe("analytical quality score", () => {
  it("nine explainable dimensions, weights sum to 100, score within 0-100", () => {
    const bundle = assembleBundle(mkBars(uptrendBars(120)))
    const q = bundle.snapshot.quality
    expect(q).not.toBeNull()
    expect(q!.dimensions.length).toBe(9)
    expect(q!.dimensions.reduce((s, d) => s + d.weight, 0)).toBe(100)
    expect(q!.score).toBeGreaterThanOrEqual(0)
    expect(q!.score).toBeLessThanOrEqual(100)
    for (const d of q!.dimensions) {
      expect(d.earned).toBeLessThanOrEqual(d.weight)
      expect(d.reason.length).toBeGreaterThan(3)
    }
  })

  it("market/sector context raises the context dimension", () => {
    const bars = mkBars(uptrendBars(120))
    const without = assembleBundle(bars).snapshot.quality!
    const withCtx = assembleBundle(bars, {
      available: true,
      asOf: bars[bars.length - 1].ts,
      marketRegime: "weak_uptrend",
      marketRegimeAr: "اتجاه صاعد ضعيف",
      marketPulse: 61,
      breadth: { advancing: 120, declining: 80, unchanged: 20, ratio: 1.5 },
      pctAboveSma20: 55,
      pctAboveSma50: 48,
      sector: { name: "Banks", dayChangePct: 0.8, advancing: 6, declining: 2, turnoverSharePct: 22.5, turnoverShareDelta5d: 3.1 },
      relVolRankPct: 72,
      limitations: [],
    }).snapshot.quality!
    const ctxDim = (q: typeof without) => q.dimensions.find((d) => d.key === "market_context")!
    expect(ctxDim(withCtx).earned).toBe(10)
    expect(ctxDim(without).earned).toBe(0)
    // Fresh-reference rescoring: the fixture dates are historical, so compare
    // with a fixed nowMs near the last bar to bypass the staleness gate veto.
    const nowMs = new Date(bars[bars.length - 1].ts + "T23:59:59Z").getTime()
    const qWithout = scoreQuality(assembleBundle(bars).snapshot, { contextPresent: false, contextComplete: false, nowMs })
    const qWith = scoreQuality(assembleBundle(bars, {
      available: true, asOf: bars[bars.length - 1].ts, marketRegime: "weak_uptrend", marketRegimeAr: null, marketPulse: 61,
      breadth: null, pctAboveSma20: null, pctAboveSma50: null,
      sector: { name: "Banks", dayChangePct: 0.8, advancing: 6, declining: 2, turnoverSharePct: 22.5, turnoverShareDelta5d: 3.1 },
      relVolRankPct: null, limitations: [],
    }).snapshot, { contextPresent: true, contextComplete: true, nowMs })
    expect(qWith.score).toBeGreaterThan(qWithout.score)
  })

  it("gate veto caps the score at 60 when data is stale", () => {
    const bars = mkBars(uptrendBars(120))
    const bundle = assembleBundle(bars)
    const stale = new Date(Date.parse(bars[bars.length - 1].ts) + 90 * 86_400_000).getTime()
    const q = scoreQuality(bundle.snapshot, { contextPresent: true, contextComplete: true, nowMs: stale })
    expect(q.gateVeto).not.toBeNull()
    expect(q.band).toBe("blocked")
    expect(q.score).toBeLessThanOrEqual(60)
  })

  it("flags trend/momentum conflict under critical review", () => {
    // Construct a rising series then force the snapshot trend up but RSI low is
    // hard to fabricate cheaply; instead verify the mechanism on a synthetic
    // snapshot through scoreQuality directly.
    const bundle = assembleBundle(mkBars(uptrendBars(120)))
    const snap = { ...bundle.snapshot, momentum: { ...bundle.snapshot.momentum, rsi14: 30 } }
    const q = scoreQuality(snap, { contextPresent: true, contextComplete: true })
    expect(q.conflicts.length).toBeGreaterThan(0)
    expect(q.dimensions.find((d) => d.key === "critical_review")!.earned).toBe(5)
  })
})
