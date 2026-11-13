// Rule-based signals engine tests — synthetic series with KNOWN shapes, so the
// expected stance is derivable by construction (not by re-running the engine).
import { describe, expect, it } from "vitest"
import { computeCloseSignal, computeStanceFromSnapshot, SIGNAL_WEIGHTS, type CloseRow } from "../signals"
import { assembleBundle, type TechnicalSnapshot } from "../analyze"
import type { Bar } from "../indicators"

function rowsFrom(closes: number[], volumes: number[] | null = null): CloseRow[] {
  const out: CloseRow[] = []
  const start = new Date("2025-06-02T00:00:00Z").getTime()
  for (let i = 0; i < closes.length; i++) {
    const day = new Date(start + i * 86_400_000).toISOString().slice(0, 10)
    out.push({ ts: day, close: closes[i], volume: volumes ? volumes[i] : 1000 + (i % 5) * 50 })
  }
  return out
}

/** Realistic uptrend: two up sessions (+1.0%) then one pullback (-0.8%).
 *  Net drift ~ +0.4%/session with a Wilder-RSI that lands in the low 70s —
 *  the honest shape of a tradable EGX uptrend, unlike a monotonic ramp. */
function uptrendCloses(n = 80): number[] {
  const out: number[] = []
  let p = 50
  for (let i = 0; i < n; i++) {
    p *= i % 3 === 2 ? 0.992 : 1.01
    out.push(Math.round(p * 100) / 100)
  }
  return out
}

/** Steady downtrend: -0.5% per session from 80. */
function downtrendCloses(n = 80): number[] {
  const out: number[] = []
  let p = 80
  for (let i = 0; i < n; i++) { out.push(Math.round(p * 100) / 100); p *= 0.995 }
  return out
}

describe("computeCloseSignal — stance mapping", () => {
  it("steady uptrend with confirmed volume → buy read, high score, trend/swing styles", () => {
    const closes = uptrendCloses(80)
    // rising volume — accumulation alongside price
    const volumes = closes.map((_, i) => 1000 + i * 5)
    const sig = computeCloseSignal(rowsFrom(closes, volumes))
    expect(sig.signal).toBe("buy")
    expect(sig.score).toBeGreaterThanOrEqual(62)
    expect(sig.styleFits.map((f) => f.tag)).toContain("trend")
    expect(sig.styleFits.map((f) => f.tag)).toContain("swing")
    expect(sig.reasons.length).toBeGreaterThan(0)
    expect(sig.dimensions.find((d) => d.key === "trend")!.earned).toBeGreaterThan(0)
  })

  it("steady downtrend → sell-press read, low score", () => {
    const closes = downtrendCloses(80)
    const volumes = closes.map((_, i) => 1200 - i * 5)
    const sig = computeCloseSignal(rowsFrom(closes, volumes))
    expect(sig.signal).toBe("sell")
    expect(sig.score).toBeLessThanOrEqual(35)
    expect(sig.reasons.some((r) => r.tone === "negative")).toBe(true)
  })

  it("flat balanced tape → hold, mid-range score", () => {
    // symmetric zigzag around 100: equal gains and losses, flat MAs, RSI ~50
    const closes: number[] = []
    let p = 100
    for (let i = 0; i < 80; i++) {
      p *= i % 2 === 0 ? 1.008 : 0.992
      closes.push(Math.round(p * 100) / 100)
    }
    const sig = computeCloseSignal(rowsFrom(closes))
    expect(sig.signal).toBe("hold")
    expect(sig.score!).toBeGreaterThan(20)
    expect(sig.score!).toBeLessThan(80)
  })

  it("score respects the documented weight ceiling (sums to 100)", () => {
    const total = Object.values(SIGNAL_WEIGHTS).reduce((a, b) => a + b, 0)
    expect(total).toBe(100)
  })

  it("undersupplied history → null stance with disclosure, never a fake score", () => {
    const sig = computeCloseSignal(rowsFrom(uptrendCloses(10)))
    expect(sig.score).toBeNull()
    expect(sig.signal).toBeNull()
    expect(sig.limitations.join(" ")).toMatch(/sessions available/)
  })

  it("35-49 sessions → rescaled score with SMA50 exclusion disclosed", () => {
    const sig = computeCloseSignal(rowsFrom(uptrendCloses(40)))
    expect(sig.score).not.toBeNull()
    expect(sig.limitations.join(" ")).toMatch(/SMA50/)
    const trend = sig.dimensions.find((d) => d.key === "trend")!
    expect(trend.max).toBeLessThan(35) // SMA50 checks excluded
  })

  it("thin volume → volume dimension excluded and disclosed", () => {
    const closes = uptrendCloses(80)
    const rows: CloseRow[] = rowsFrom(closes).map((r) => ({ ts: r.ts, close: r.close, volume: null }))
    const sig = computeCloseSignal(rows)
    expect(sig.metrics.relVol).toBeNull()
    expect(sig.limitations.join(" ")).toMatch(/volume/i)
    const vol = sig.dimensions.find((d) => d.key === "volume")!
    expect(vol.max).toBeLessThan(20)
  })

  it("metrics carry the documented fields", () => {
    const sig = computeCloseSignal(rowsFrom(uptrendCloses(80)))
    expect(sig.metrics.sma20).not.toBeNull()
    expect(sig.metrics.sma50).not.toBeNull()
    expect(sig.metrics.rsi14).toBeGreaterThan(30)
    expect(sig.changePct).not.toBeNull()
    expect(sig.asOf).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})

describe("computeStanceFromSnapshot — full-bundle stance", () => {
  function bundleBars(closes: number[]): Bar[] {
    return closes.map((c, i) => ({
      ts: new Date(new Date("2025-06-02T00:00:00Z").getTime() + i * 86_400_000).toISOString().slice(0, 10),
      open: c * 0.995,
      high: c * 1.01,
      low: c * 0.985,
      close: c,
      volume: 1000 + (i % 7) * 80,
    }))
  }

  it("produces a score in range and a valid signal from a real bundle", () => {
    const bundle = assembleBundle(bundleBars(uptrendCloses(80)))
    const stance = computeStanceFromSnapshot(bundle.snapshot)
    expect(stance.score).not.toBeNull()
    expect(stance.score!).toBeGreaterThanOrEqual(0)
    expect(stance.score!).toBeLessThanOrEqual(100)
    expect(["buy", "hold", "sell"]).toContain(stance.signal)
    expect(stance.dimensions.length).toBe(4)
  })

  it("unavailable snapshot → null stance with disclosure", () => {
    const empty: TechnicalSnapshot = assembleBundle([]).snapshot
    const stance = computeStanceFromSnapshot(empty)
    expect(stance.score).toBeNull()
    expect(stance.signal).toBeNull()
    expect(stance.limitations[0]).toMatch(/No daily price history/)
  })

  it("buy stance carries an invalidation level when support exists", () => {
    const bundle = assembleBundle(bundleBars(uptrendCloses(90)))
    const stance = computeStanceFromSnapshot(bundle.snapshot)
    if (stance.signal === "buy" && bundle.snapshot.levels.supports.length > 0) {
      expect(stance.invalidation).not.toBeNull()
      expect(stance.invalidation!.side).toBe("below")
    }
  })
})
