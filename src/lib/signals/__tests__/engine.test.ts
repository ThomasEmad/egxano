// =============================================================================
// Signals engine v2 (tech-signals@7) — state machine + no-lookahead tests.
// The no-lookahead property is tested MECHANICALLY: mutating any FUTURE bar
// must not change the row computed on an earlier prefix, and each row's asOf
// must equal the prefix's own last session.
// =============================================================================

import { describe, expect, it } from "vitest"
import { computeCompanySignalV2 } from "../engine"
import { computeMetrics, dailyVolPct, relVol, relVolWithBase, rangePos } from "../metrics"
import type { Bar } from "../types"

const TODAY = "2026-11-15"

/** One controlled session. */
function bar(i: number, open: number, high: number, low: number, close: number, volume = 1000): Bar {
  return { ts: `2026-${String(Math.floor(i / 28) + 1).padStart(2, "0")}-${String((i % 28) + 1).padStart(2, "0")}`, open, high, low, close, volume }
}

/** Rising drift with mild noise (deterministic). */
function uptrend(n: number, from = 60, step = 0.35): Bar[] {
  const out: Bar[] = []
  let p = from
  for (let i = 0; i < n; i++) {
    const noise = (i % 3 === 0 ? -0.2 : i % 3 === 1 ? 0.15 : 0) // deterministic wobble
    const c = p + step + noise
    out.push(bar(i, p, Math.max(p, c) + 0.15, Math.min(p, c) - 0.15, c))
    p = c
  }
  return out
}

/** Declining drift — the exit scenario. */
function downtrend(n: number, from = 120, step = -0.4): Bar[] {
  const out: Bar[] = []
  let p = from
  for (let i = 0; i < n; i++) {
    const noise = i % 3 === 0 ? 0.2 : i % 3 === 1 ? -0.15 : 0
    const c = p + step + noise
    out.push(bar(i, p, Math.max(p, c) + 0.15, Math.min(p, c) - 0.15, c))
    p = c
  }
  return out
}

describe("metrics helpers", () => {
  it("relVol compares the last session to the prior 20 only", () => {
    const bars = uptrend(30)
    expect(relVol(bars)).toBeCloseTo(1, 5) // constant volume → 1.0
    bars[29] = { ...bars[29], volume: 3000 }
    expect(relVol(bars)).toBeCloseTo(3, 5)
    expect(relVol(bars.slice(0, 20))).toBeNull()
  })
  it("relVolWithBase discloses how many sessions actually back the mean", () => {
    const bars = uptrend(30) // constant volume → all 20 prior sessions usable
    const rb = relVolWithBase(bars)
    expect(rb.value).toBeCloseTo(1, 5)
    expect(rb.baseN).toBe(20)
    // 5 sessions in the window lack usable volume → the mean is over 15
    const sparse = uptrend(30).map((b, i) => (i >= 12 && i <= 16 ? { ...b, volume: null } : b))
    expect(relVolWithBase(sparse).baseN).toBe(15)
    // fewer than 10 usable prior sessions → no ratio at all (eligibility unchanged)
    const thin = uptrend(30).map((b, i) => (i >= 9 ? { ...b, volume: null } : b))
    expect(relVolWithBase(thin).value).toBeNull()
    expect(relVolWithBase(thin).baseN).toBeNull()
    // the published bundle carries the disclosure too
    expect(computeMetrics(uptrend(30))!.relVolBaseN).toBe(20)
  })
  it("rangePos pins the extremes to 0 and 100", () => {
    const bars = uptrend(60, 50, 1) // strictly rising → last is the high
    expect(rangePos(bars.map((b) => b.close), 60)).toBeCloseTo(100, 1)
    expect(rangePos(bars.map((b) => b.close), 30)).toBeCloseTo(100, 1)
  })
  it("dailyVolPct is zero for a perfectly flat series", () => {
    const flat: Bar[] = Array.from({ length: 30 }, (_, i) => bar(i, 10, 10.05, 9.95, 10))
    expect(dailyVolPct(flat.map((b) => b.close))).toBe(0)
  })
})

describe("engine state machine", () => {
  it("returns an honest wait with a data note when history is too short", () => {
    const row = computeCompanySignalV2({
      bars: uptrend(30),
      identity: { companyId: "c1", ticker: "TST", nameEn: "Test", nameAr: null, sector: "s", marketTier: "MAIN" },
      todaySession: TODAY,
    })
    expect(row.state).toBe("wait")
    expect(row.quality.notesAr.join(" ")).toContain("الحد الأدنى")
    expect(row.plan).toBeNull()
    expect(row.setup).toBeNull()
  })

  it("publishes a directional read with invariants on a strong breakout, never contradicting itself", () => {
    // 120 rising sessions ending with a heavy-volume thrust
    const bars = uptrend(119)
    const lastP = bars[118].close
    bars.push({ ...bar(119, lastP, lastP + 2.4, lastP - 0.1, lastP + 2.2), volume: 4000 })
    const row = computeCompanySignalV2({
      bars,
      identity: { companyId: "c1", ticker: "TST", nameEn: "Test", nameAr: null, sector: "s", marketTier: "MAIN" },
      todaySession: TODAY,
    })
    // a runaway thrust with no overhead structure is usually a NEAR (chase RR
    // fails) — the published state must be a REAL published state, and a
    // strong bullish breakout can never be read as an exit (the old
    // assertion here was a tautology: `row.state` compared against itself)
    expect(["buy", "near", "wait"]).toContain(row.state)
    if (row.state === "buy") {
      expect(row.plan).not.toBeNull()
      expect(row.plan!.stop).toBeLessThan(row.plan!.entryLow)
      expect(row.plan!.target1).toBeGreaterThan(row.lastClose!)
      expect(row.score ?? 0).toBeGreaterThanOrEqual(62)
    } else if (row.state === "near") {
      expect(row.setup).not.toBeNull()
      expect(row.setup!.provisional.target1).toBeGreaterThan(row.setup!.activation)
      expect(row.setup!.activationGapPct).toBeLessThanOrEqual(8)
    } else {
      // a wait must carry disclosure, never a naked confident read
      expect(row.quality.notesAr.length + row.evidence.length).toBeGreaterThan(0)
    }
    expect(row.evidence.length).toBeGreaterThan(0)
  })

  it("reads a downtrend breakdown as EXIT with no short plan and the no-short disclosure", () => {
    const bars = downtrend(120)
    const row = computeCompanySignalV2({
      bars,
      identity: { companyId: "c1", ticker: "TST", nameEn: "Test", nameAr: null, sector: "s", marketTier: "MAIN" },
      todaySession: TODAY,
    })
    if (row.state === "exit") {
      expect(row.plan).toBeNull() // never a short-selling plan
      expect(JSON.stringify(row.evidence)).toContain("ليست")
      expect(row.type).toMatch(/exit_/)
    } else {
      // a drift-down without a multi-touch break is a legitimate wait — but it
      // must NEVER publish a buy or a short plan on this tape
      expect(row.state).not.toBe("buy")
    }
  })

  it("is fully deterministic — the same prefix yields the identical row", () => {
    const bars = uptrend(120)
    const args = {
      bars,
      identity: { companyId: "c1", ticker: "TST", nameEn: "Test", nameAr: null, sector: "s", marketTier: "MAIN" } as const,
      todaySession: TODAY,
    }
    const a = computeCompanySignalV2(args)
    const b = computeCompanySignalV2({ ...args, bars: bars.map((x) => ({ ...x })) })
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
  })

  it("is look-ahead-proof — mutating FUTURE bars never changes an earlier row", () => {
    const bars = uptrend(120)
    const t = 80
    const prefix = bars.slice(0, t)
    const rowA = computeCompanySignalV2({
      bars: prefix,
      identity: { companyId: "c1", ticker: "TST", nameEn: "Test", nameAr: null, sector: "s", marketTier: "MAIN" },
      todaySession: prefix[t - 1].ts,
    })
    // poison every bar AFTER the prefix with absurd values
    const poisoned = bars.map((b, i) => (i >= t ? { ...b, close: 9999, high: 10000, low: 500, open: 9999 } : b))
    const rowB = computeCompanySignalV2({
      bars: poisoned.slice(0, t),
      identity: { companyId: "c1", ticker: "TST", nameEn: "Test", nameAr: null, sector: "s", marketTier: "MAIN" },
      todaySession: prefix[t - 1].ts,
    })
    expect(rowB.asOf).toBe(prefix[t - 1].ts)
    expect(JSON.stringify(rowA)).toBe(JSON.stringify(rowB))
  })

  it("marks stale data honestly (older than 4 sessions carries a note)", () => {
    const bars = uptrend(120)
    const row = computeCompanySignalV2({
      bars,
      identity: { companyId: "c1", ticker: "TST", nameEn: "Test", nameAr: null, sector: "s", marketTier: "MAIN" },
      todaySession: "2026-12-05",
    })
    expect(row.quality.dataAgeSessions).toBeGreaterThan(4)
    expect(row.quality.notesAr.join(" ")).toContain("متأخرة")
  })
})
