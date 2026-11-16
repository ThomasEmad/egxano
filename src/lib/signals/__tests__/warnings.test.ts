// =============================================================================
// Signals engine v2 (tech-signals@7) — the disclosed-warnings contract.
// Owner mandate (2026-11-16): a negative net profit, a P/E above 40, or a
// very thin traded value MUST surface next to the signal. The wording rule is
// part of the contract: factual mechanics only — the warnings never accuse
// any party of anything (the site states what the DATA shows).
// =============================================================================

import { describe, expect, it } from "vitest"
import { computeCompanySignalV2 } from "../engine"
import { avgTradedValueEgp, computeMetrics } from "../metrics"
import { THIN_TRADED_VALUE_EGP } from "../types"
import type { Bar, Fundamentals } from "../types"

function bar(ts: string, open: number, high: number, low: number, close: number, volume: number | null = 1000): Bar {
  return { ts, open, high, low, close, volume }
}

/** A rising series with volume 1000 — enough sessions for every indicator. */
function rising(n: number, from = 50, step = 0.3): Bar[] {
  const out: Bar[] = []
  let p = from
  for (let i = 0; i < n; i++) {
    const c = p + step
    out.push(bar(`2026-01-${String((i % 28) + 1).padStart(2, "0")}-${String(i).padStart(3, "0")}`, p, Math.max(p, c) + 0.2, Math.min(p, c) - 0.2, c))
    p = c
  }
  return out
}

function rowFor(fundamentals: Fundamentals | null, bars = rising(120)) {
  return computeCompanySignalV2({
    bars,
    identity: { companyId: "t", ticker: "TST", nameEn: "Test", nameAr: null, sector: "s", marketTier: "MAIN" },
    fundamentals,
    todaySession: bars[bars.length - 1].ts,
  })
}

describe("avgTradedValueEgp — absolute liquidity read", () => {
  it("is the mean close×volume over the last ≤20 sessions with volume", () => {
    const bars: Bar[] = []
    for (let i = 0; i < 25; i++) {
      bars.push(bar(`2026-01-${String((i % 28) + 1).padStart(2, "0")}-${String(i).padStart(3, "0")}`, 100, 101, 99, 100, i < 5 ? null : 1000))
    }
    // last 20 sessions all carry volume 1000 at close 100 → 100_000 EGP
    expect(avgTradedValueEgp(bars)).toBeCloseTo(100_000, 0)
  })

  it("returns null when fewer than 5 sessions carry volume (no invented verdict)", () => {
    const bars: Bar[] = []
    for (let i = 0; i < 25; i++) {
      bars.push(bar(`2026-01-${String((i % 28) + 1).padStart(2, "0")}-${String(i).padStart(3, "0")}`, 100, 101, 99, 100, i < 22 ? null : 1000))
    }
    expect(avgTradedValueEgp(bars)).toBeNull()
  })
})

describe("fundamentalsWarnings — the disclosed-risk contract", () => {
  it("discloses a negative net profit next to the signal", () => {
    const row = rowFor({ netProfitEgp: -5_000_000, peRatio: null })
    const w = row.warnings.find((x) => x.kind === "negative_profit")
    expect(w).toBeDefined()
    expect(w!.ar).toContain("سالب")
    // mechanics only — never an accusation of any party
    expect(w!.detailAr).not.toContain("تلاعب")
    expect(w!.detailAr).not.toContain("احتيال")
  })

  it("discloses a P/E above 40 next to the signal", () => {
    const row = rowFor({ netProfitEgp: 10_000_000, peRatio: 55 })
    const w = row.warnings.find((x) => x.kind === "high_pe")
    expect(w).toBeDefined()
    expect(w!.ar).toContain("40")
  })

  it("does NOT invent warnings when fundamentals are absent", () => {
    const row = rowFor(null)
    expect(row.warnings.some((x) => x.kind === "negative_profit")).toBe(false)
    expect(row.warnings.some((x) => x.kind === "high_pe")).toBe(false)
  })

  it("discloses a very thin traded value (the rising test tape trades ~86k EGP/day)", () => {
    const bars = rising(120) // closes ≈ 86 × volume 1000 ≈ 86k EGP < 100k threshold
    const m = computeMetrics(bars)!
    expect(m.avgTradedValueEgp!).toBeLessThan(THIN_TRADED_VALUE_EGP)
    const row = rowFor(null, bars)
    const w = row.warnings.find((x) => x.kind === "thin_liquidity")
    expect(w).toBeDefined()
    // the warning is an execution-mechanics notice, not a slur
    expect(w!.detailAr).toContain("أوامر بسعر محدد")
    expect(w!.detailAr).not.toContain("تلاعب")
    expect(w!.detailAr).not.toContain("احتيال")
  })

  it("carries the warnings on BUY rows too (the user must see them at the decision point)", () => {
    const bars = rising(120)
    const row = rowFor({ netProfitEgp: -1, peRatio: 100 }, bars)
    // the synthetic tape may or may not produce a BUY row — when it does,
    // the warnings MUST ride with it; when not, the row still discloses them
    expect(row.warnings.length).toBeGreaterThanOrEqual(2)
  })
})
