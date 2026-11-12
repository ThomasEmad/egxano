// Reference tests for the whole-market intelligence compute module.
import { describe, it, expect } from "vitest"
import { computeIntelligence, classifyRegime, type IntelInput, type MoverInput } from "../compute"

function mover(ticker: string, sector: string, changePct: number, volume: number | null, cap: number, price = 10): MoverInput {
  return { ticker, name: `Company ${ticker}`, nameAr: null, sector, price, changePct, volume, cap }
}

function input(overrides: Partial<IntelInput> = {}): IntelInput {
  const movers: MoverInput[] = [
    mover("AAA", "Banks", 2.5, 100_000, 1_000_000),
    mover("BBB", "Banks", 1.0, 80_000, 900_000),
    mover("CCC", "Real Estate", -1.5, 200_000, 500_000),
    mover("DDD", "Real Estate", 0.0, 50_000, 300_000),
    mover("EEE", "Telecom", 4.2, 300_000, 2_000_000),
    mover("FFF", "Telecom", 0.0, null, 100_000), // no volume
  ]
  return {
    now: "2026-11-12T12:55:00Z",
    day: "2026-11-12",
    delayMinutes: 15,
    movers,
    baselines: {
      AAA: { avg20: 50_000, avg60: 48_000, sessions: 60 },
      BBB: { avg20: 100_000, avg60: 95_000, sessions: 60 },
      CCC: { avg20: 90_000, avg60: 88_000, sessions: 60 },
      DDD: { avg20: 10_000, avg60: 9_000, sessions: 60 },
      EEE: { avg20: 120_000, avg60: 110_000, sessions: 60 },
      FFF: { avg20: 40_000, avg60: 39_000, sessions: 60 },
    },
    history: [],
    enrichment: null,
    ...overrides,
  }
}

describe("breadth", () => {
  it("counts advancers/decliners/unchanged and the A/D ratio", () => {
    const mi = computeIntelligence(input())
    expect(mi.breadth.advancing).toBe(3)
    expect(mi.breadth.declining).toBe(1)
    expect(mi.breadth.unchanged).toBe(2)
    expect(mi.breadth.ratio).toBe(3)
  })

  it("computes traded value only when volume coverage ≥ 50%, and discloses coverage", () => {
    const mi = computeIntelligence(input())
    expect(mi.breadth.tradedValueEgp).not.toBeNull()
    expect(mi.universe.volumeCoveragePct).toBeCloseTo(83.3, 0)
    // Thin coverage: only 2 of 6 movers carry volume (33%) → value withheld.
    const thin = computeIntelligence(input({ movers: input().movers.map((m, i) => (i < 4 ? { ...m, volume: null } : m)) }))
    expect(thin.breadth.tradedValueEgp).toBeNull()
    expect(thin.limitations.join(" ")).toContain("volume")
  })
})

describe("concentration", () => {
  it("ranks top-5 share of traded value", () => {
    const mi = computeIntelligence(input())
    // Values: AAA 1M, BBB 800k, CCC 3M, DDD 500k, EEE 12.6M → total 17.9M
    expect(mi.concentration.top5TurnoverSharePct).not.toBeNull()
    expect(mi.concentration.top5TurnoverSharePct!).toBeGreaterThan(50)
    expect(mi.concentration.top5TurnoverSharePct!).toBeLessThanOrEqual(100)
  })
})

describe("sector rotation", () => {
  it("allocates turnover shares that sum to ~100% and computes 5-session deltas", () => {
    const history = Array.from({ length: 6 }, (_, i) => ({
      day: `2026-11-0${i + 1}`,
      advancing: 100,
      declining: 80,
      unchanged: 20,
      regime: "sideways",
      pulse: 55,
      tradedValueEgp: 10_000_000,
      turnoverShares: { Banks: 40, "Real Estate": 35, Telecom: 25 },
    }))
    const mi = computeIntelligence(input({ history }))
    const shares = mi.rotation.sectors.filter((s) => s.turnoverSharePct !== null).map((s) => s.turnoverSharePct!)
    expect(shares.length).toBe(3)
    // Telecom: 3.0M of 7.3M ≈ 41% vs stored 25% → delta ≈ +16 → gaining.
    const telecom = mi.rotation.sectors.find((s) => s.sector === "Telecom")!
    expect(telecom.turnoverSharePct!).toBeGreaterThan(35)
    expect(telecom.turnoverShareDelta5d!).toBeGreaterThan(1.5)
    expect(mi.rotation.gaining).toContain("Telecom")
  })

  it("states plainly when rotation deltas are not yet computable", () => {
    const mi = computeIntelligence(input({ history: [] }))
    expect(mi.rotation.note).toContain("≥6 stored daily snapshots")
    expect(mi.rotation.gaining).toHaveLength(0)
  })
})

describe("anomalies", () => {
  it("flags a volume spike with participation and a move without volume", () => {
    const mi = computeIntelligence(input())
    const spike = mi.anomalies.find((a) => a.ticker === "EEE") // 2.5× + 4.2%
    expect(spike?.kind).toBe("volume_spike")
    const ccc = mi.anomalies.find((a) => a.ticker === "CCC") // 200k/90k ≈ 2.2× — a spike too
    expect(ccc?.kind).toBe("volume_spike")
    // Force a move-without-volume case:
    const mi2 = computeIntelligence(
      input({
        movers: [mover("GGG", "Banks", -3.5, 6_000, 500_000)],
        baselines: { GGG: { avg20: 10_000, avg60: 10_000, sessions: 60 } },
      }),
    )
    expect(mi2.anomalies[0]?.kind).toBe("price_without_volume")
  })

  it("flags sudden activity after prolonged quiet", () => {
    const mi2 = computeIntelligence(
      input({
        movers: [mover("HHH", "Food", 0.2, 30_000, 500_000)],
        baselines: { HHH: { avg20: 4_000, avg60: 4_000, sessions: 60 } },
      }),
    )
    expect(mi2.anomalies[0]?.kind).toBe("activity_after_quiet")
  })
})

describe("A/D line", () => {
  it("accumulates from stored history plus today", () => {
    const history = [
      { day: "2026-11-10", advancing: 120, declining: 60, unchanged: 20, regime: null, pulse: 50, tradedValueEgp: null, turnoverShares: null },
      { day: "2026-11-11", advancing: 90, declining: 90, unchanged: 20, regime: null, pulse: 50, tradedValueEgp: null, turnoverShares: null },
    ]
    const mi = computeIntelligence(input({ history }))
    expect(mi.breadth.adLine).toHaveLength(3)
    expect(mi.breadth.adLine[1].value).toBe(60) // +60 then 0
    expect(mi.breadth.adLine[2].value).toBe(62) // +2 today
  })
})

describe("regime", () => {
  it("classifies with evidence and downgrades strong regimes on breadth mismatch", () => {
    const r = classifyRegime({ capWeightedMarket: 1.4, ratio: 2.4, pctAbove20: 45, pctAbove50: 60, nh: 5, nl: 1, narrowLeadership: false })
    expect(r.code).toBe("weak_uptrend") // downgraded from strong because only 45% above SMA20
    expect(r.evidence.join(" ")).toContain("A/D ratio 2.4")
  })

  it("detects narrow leadership", () => {
    const r = classifyRegime({ capWeightedMarket: 0.9, ratio: 0.8, pctAbove20: 40, pctAbove50: 40, nh: 2, nl: 2, narrowLeadership: true })
    expect(r.code).toBe("narrow_leadership")
  })

  it("falls back to market-change-only classification and says so", () => {
    const r = classifyRegime({ capWeightedMarket: 0.8, ratio: null, pctAbove20: null, pctAbove50: null, nh: null, nl: null, narrowLeadership: false })
    expect(r.code).toBe("weak_uptrend")
    expect(r.evidence.join(" ")).toContain("weaker evidence")
  })
})

describe("pulse", () => {
  it("is explainable: five dimensions with reasons, score 0-100", () => {
    const mi = computeIntelligence(input())
    expect(mi.pulse.dimensions).toHaveLength(5)
    for (const d of mi.pulse.dimensions) {
      expect(d.reason.length).toBeGreaterThan(3)
      expect(d.earned).toBeLessThanOrEqual(d.max)
    }
    expect(mi.pulse.score).toBeGreaterThanOrEqual(0)
    expect(mi.pulse.score).toBeLessThanOrEqual(100)
  })
})
